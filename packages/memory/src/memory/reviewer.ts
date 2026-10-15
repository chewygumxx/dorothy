// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/reviewer.ts
//
//

// One review of one conversation, for whoever holds its claim: chat's
// MemoryService between replies, and dorothy --claude-hook after them.
// It reads the transcript and notes, asks the model on Dorothy's persona
// with her memory block beside, and writes notes, tags and appraisals
// under the lock, committed to history. A caller reviewing a live
// conversation flushes its transcript first.

import { join } from "node:path";
import {
    type MemoryConfig,
    type ResumedTurn,
    type StructuredCall,
    withSection,
} from "@dorothy/core";
import type { RecallIndex } from "../recall/store.js";
import { readTranscript } from "../transcript.js";
import type { Entry } from "./catalogue.js";
import { buildMemory } from "./rank.js";
import {
    CLUSTERS_INSTRUCTION,
    pendingReads,
    READS_INSTRUCTION,
    REVIEW_INSTRUCTIONS,
    reviewPrompt,
    reviewSchema,
    runReview,
    TAGS_INSTRUCTION,
} from "./review.js";
import {
    type HistoryHandle,
    type Lock,
    markFailed,
    markReviewed,
    mergeReview,
    ownsAll,
    type Recording,
    readSidecar,
    reviewDue,
    type Sidecar,
    sidecarPath,
    untagged,
    updateSidecar,
} from "./sidecar.js";
import { applyTagging, reviewConcepts, type TagOutput } from "./tagging.js";
import {
    EMPTY_VOCABULARY,
    readVocabulary,
    resolveTags,
    type Vocabulary,
    vocabularyProblem,
    writeVocabulary,
} from "./vocabulary.js";

export type ReviewerOptions = {
    // The transcripts directory.
    dir: string;
    config: MemoryConfig;
    // For the write lock; null without.
    index: RecallIndex | null;
    // tags.json; null leaves tags alone.
    vocabulary: string | null;
    // History: each write committed, a broken file restored before it
    // is read. Null without.
    versions: HistoryHandle | null;
    call: StructuredCall;
    // The persona reviews run on: the chat persona without recall.
    persona: string;
    now: () => Date;
    // The catalogue as last seen: the block a review is given, the
    // names of conversations it read, and the carriers of tags.
    entries: () => Iterable<Entry>;
    warn: (message: string) => void;
    cost: (usd: number) => void;
};

// What a review wrote: notes reviewed, or only marked (nothing new to
// pay for, or a failure). turns is the transcript's count, null where
// unknown.
export type Reviewed =
    | { kind: "reviewed"; sidecar: Sidecar; turns: number }
    | { kind: "marked"; sidecar: Sidecar; turns: number | null }
    | { kind: "none" };

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

export class Reviewer {
    readonly #options: ReviewerOptions;
    // A broken vocabulary is told once a reviewer.
    #vocabularyWarned = false;

    constructor(options: ReviewerOptions) {
        this.#options = options;
    }

    // The lock writes take: the index's, or history's own without it.
    get #lock(): Lock | undefined {
        return this.#options.index?.lock ?? this.#options.versions?.lock;
    }

    #recording(
        message: string,
        also: readonly string[] = [],
    ): Recording | undefined {
        const versions = this.#options.versions;
        return versions === null
            ? undefined
            : { recorder: versions.recorder, message, also };
    }

    // The vocabulary as the file holds it, empty when there is none; null
    // when tags are off or the file is broken.
    async readVocabulary(): Promise<Vocabulary | null> {
        const path = this.#options.vocabulary;
        if (path === null) {
            return null;
        }
        let read = await readVocabulary(path);
        // Restored from history, it is read again. Never inside the
        // lock: healing takes it.
        if (
            read.kind === "unparseable" &&
            (await this.#options.versions?.heal(path))
        ) {
            read = await readVocabulary(path);
        }
        if (read.kind === "unparseable") {
            if (!this.#vocabularyWarned) {
                this.#vocabularyWarned = true;
                this.#options.warn(
                    `memory: tags are paused: ${path}: ${read.reason}`,
                );
            }
            return null;
        }
        return read.kind === "ok" ? read.vocabulary : EMPTY_VOCABULARY;
    }

    // Each conversation's tags and whether it is hidden, as last seen.
    #carriers(): { tags: readonly string[]; hidden: boolean }[] {
        return [...this.#options.entries()].flatMap((entry) =>
            entry.sidecar.kind === "ok"
                ? [
                      {
                          tags: entry.sidecar.sidecar.tags,
                          hidden: entry.sidecar.sidecar.hidden,
                      },
                  ]
                : [],
        );
    }

    // Under the sidecar's lock: the vocabulary is read again, so a concept
    // another run coined since the review began is reused, not coined
    // twice. The user's set is kept, merges followed. Undefined leaves the
    // sidecar's tags as they are, as when the file has broken meanwhile.
    // The read, rev + 1 and write repeat updateVocabulary's, which would
    // take the lock again: RecallIndex.exclusive is not re-entrant.
    async #tag(
        latest: Sidecar | null,
        output: TagOutput,
        stamp: { at: string; model: string },
    ): Promise<string[] | undefined> {
        const path = this.#options.vocabulary;
        if (path === null) {
            return undefined;
        }
        const read = await readVocabulary(path);
        if (read.kind === "unparseable") {
            return undefined;
        }
        const vocabulary =
            read.kind === "ok" ? read.vocabulary : EMPTY_VOCABULARY;
        if (latest?.fields.tags?.by === "user") {
            return resolveTags(vocabulary, latest.tags);
        }
        const tagged = applyTagging(vocabulary, output, stamp);
        if (tagged.coined > 0) {
            // One breaking the rules would pause tags everywhere: it is
            // never written, nor tags taken from it.
            if (vocabularyProblem(tagged.vocabulary) !== null) {
                return undefined;
            }
            await writeVocabulary(path, {
                ...tagged.vocabulary,
                rev: vocabulary.rev + 1,
            });
        }
        return tagged.tags;
    }

    #nameOf(phrase: string): string {
        for (const entry of this.#options.entries()) {
            if (entry.phrase === phrase) {
                return (
                    (entry.sidecar.kind === "ok"
                        ? entry.sidecar.sidecar.title
                        : null) ?? phrase
                );
            }
        }
        return phrase;
    }

    // The block a review is given: every note but its own conversation's.
    #block(phrase: string): string {
        return buildMemory([...this.#options.entries()], {
            now: this.#options.now().getTime(),
            config: this.#options.config,
            exclude: phrase,
        }).block;
    }

    async review(phrase: string, signal: AbortSignal): Promise<Reviewed> {
        const { dir, versions } = this.#options;
        let read = await readSidecar(dir, phrase);
        if (
            read.kind === "unparseable" &&
            (await versions?.heal(sidecarPath(dir, phrase)))
        ) {
            read = await readSidecar(dir, phrase);
        }
        // Unparseable: warned of at launch and never written. Hidden:
        // forgotten.
        if (
            read.kind === "unparseable" ||
            (read.kind === "ok" && read.sidecar.hidden)
        ) {
            return { kind: "none" };
        }
        const current = read.kind === "ok" ? read.sidecar : null;
        if (!reviewDue(current, this.#options.now().getTime())) {
            return { kind: "none" };
        }
        const vocabulary = await this.readVocabulary();
        const tagging = vocabulary !== null;
        const name = current?.title ?? phrase;
        const fail = (reason: string) =>
            this.#options.warn(`memory: couldn't review "${name}": ${reason}`);
        let turns: ResumedTurn[];
        try {
            turns = (await readTranscript(join(dir, `${phrase}.jsonl`))).turns;
        } catch (error) {
            fail(describeError(error));
            return { kind: "none" };
        }
        const reads = pendingReads(turns, current?.appraisals ?? {}, (of) =>
            this.#nameOf(of),
        );
        if (
            (turns.length <= (current?.reviewedThrough ?? 0) &&
                reads.length === 0 &&
                !(tagging && untagged(current))) ||
            signal.aborted
        ) {
            return { kind: "none" };
        }
        const lock = this.#lock;
        // Every note and tag is the user's and nothing awaits appraisal: a
        // review could change nothing, so none is paid for.
        if (
            current !== null &&
            ownsAll(current, tagging) &&
            reads.length === 0
        ) {
            const skipped = await updateSidecar(
                dir,
                phrase,
                (latest) =>
                    latest === null || latest.hidden
                        ? null
                        : markReviewed(latest, turns.length),
                lock,
                this.#recording(`review: ${phrase} (dorothy, nothing new)`),
            );
            return skipped.kind === "written"
                ? {
                      kind: "marked",
                      sidecar: skipped.sidecar,
                      turns: turns.length,
                  }
                : { kind: "none" };
        }
        const readIds = reads.map((read) => read.id);
        const instructions = [
            REVIEW_INSTRUCTIONS,
            ...(reads.length > 0 ? [READS_INSTRUCTION] : []),
            ...((current?.clusters.length ?? 0) > 0
                ? [CLUSTERS_INSTRUCTION]
                : []),
            ...(tagging ? [TAGS_INSTRUCTION] : []),
        ].join(" ");
        const outcome = await runReview({
            call: this.#options.call,
            systemPrompt: [
                withSection(this.#options.persona, this.#block(phrase)),
                instructions,
            ].join("\n\n"),
            prompt: reviewPrompt(
                turns,
                current,
                reads,
                vocabulary === null
                    ? undefined
                    : {
                          vocabulary,
                          concepts: reviewConcepts(
                              vocabulary,
                              this.#carriers(),
                          ),
                      },
            ),
            schema: reviewSchema(readIds, tagging),
            readIds,
            tagging,
            signal,
        });
        if (signal.aborted) {
            return { kind: "none" };
        }
        if (outcome.costUsd > 0) {
            this.#options.cost(outcome.costUsd);
        }
        const at = this.#options.now().toISOString();
        if (!outcome.ok) {
            fail(outcome.reason);
            const failed = await updateSidecar(
                dir,
                phrase,
                (latest) => (latest?.hidden ? null : markFailed(latest, at)),
                lock,
                this.#recording(`review: ${phrase} (dorothy, failed)`),
            );
            return failed.kind === "written"
                ? { kind: "marked", sidecar: failed.sidecar, turns: null }
                : { kind: "none" };
        }
        // Quitting may land while the write waits its turn. Tags are
        // applied inside the same lock as the notes.
        const tagOutput = outcome.tags;
        const result = await updateSidecar(
            dir,
            phrase,
            async (latest) => {
                if (signal.aborted || latest?.hidden) {
                    return null;
                }
                const tags =
                    tagOutput === undefined
                        ? undefined
                        : await this.#tag(latest, tagOutput, {
                              at,
                              model: outcome.model,
                          });
                return mergeReview(latest, outcome.notes, {
                    model: outcome.model,
                    at,
                    throughTurn: turns.length,
                    costUsd: outcome.costUsd,
                    appraisals: outcome.appraisals,
                    ...(tags === undefined ? {} : { tags }),
                });
            },
            lock,
            this.#recording(
                `review: ${phrase} (dorothy, ${outcome.model})`,
                this.#options.vocabulary === null
                    ? []
                    : [this.#options.vocabulary],
            ),
        );
        if (result.kind === "failed") {
            this.#options.warn(
                `memory: couldn't save notes on "${name}": ${result.reason}`,
            );
            return { kind: "none" };
        }
        if (result.kind !== "written") {
            return { kind: "none" };
        }
        return {
            kind: "reviewed",
            sidecar: result.sidecar,
            turns: turns.length,
        };
    }
}
