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
    readSidecar,
    recordingFor,
    reviewDue,
    type Sidecar,
    sidecarPath,
    untagged,
    updateSidecar,
    writeLock,
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
    // A warning for the user, and what went wrong by kind alone, for a
    // log that must not hold a conversation's title or a model's words.
    warn: (message: string, problem: ReviewProblem) => void;
    cost: (usd: number) => void;
};

// What went wrong: the conversation, null for tags, and the kind. A
// failed call keeps its error, Dorothy's, the SDK's or the API's: the
// model's own words come back only in notes, which keep none.
export type ReviewProblem = {
    phrase: string | null;
    kind: "transcript" | "call" | "notes" | "save" | "tags";
    error?: string;
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

    get #lock(): Lock | undefined {
        return writeLock(this.#options.index, this.#options.versions);
    }

    #recording(message: string, also: readonly string[] = []) {
        return recordingFor(this.#options.versions, message, also);
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
                    { phrase: null, kind: "tags" },
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
        written: string[],
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
            written.push(path);
        }
        return tagged.tags;
    }

    // A conversation's name, a title or else its phrase, as last seen:
    // the catalogue is read once, when the first is asked for.
    #nameOf(): (phrase: string) => string {
        let names: Map<string, string> | undefined;
        return (phrase) => {
            names ??= new Map(
                [...this.#options.entries()].map((entry) => [
                    entry.phrase,
                    (entry.sidecar.kind === "ok"
                        ? entry.sidecar.sidecar.title
                        : null) ?? entry.phrase,
                ]),
            );
            return names.get(phrase) ?? phrase;
        };
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
        const current = await this.#current(phrase);
        if (current === undefined) {
            return { kind: "none" };
        }
        const vocabulary = await this.readVocabulary();
        const tagging = vocabulary !== null;
        const name = current?.title ?? phrase;
        const fail = (reason: string, kind: ReviewProblem["kind"]) =>
            this.#options.warn(`memory: couldn't review "${name}": ${reason}`, {
                phrase,
                kind,
                ...(kind === "call" ? { error: reason } : {}),
            });
        let turns: ResumedTurn[];
        try {
            turns = (
                await readTranscript(join(this.#options.dir, `${phrase}.jsonl`))
            ).turns;
        } catch (error) {
            fail(describeError(error), "transcript");
            return { kind: "none" };
        }
        const reads = pendingReads(
            turns,
            current?.appraisals ?? {},
            this.#nameOf(),
        );
        if (!reviewable(current, turns, reads, tagging) || signal.aborted) {
            return { kind: "none" };
        }
        // Every note and tag is the user's and nothing awaits appraisal: a
        // review could change nothing, so none is paid for.
        if (
            current !== null &&
            ownsAll(current, tagging) &&
            reads.length === 0
        ) {
            return this.#markUnchanged(phrase, turns.length);
        }
        const readIds = reads.map((read) => read.id);
        const outcome = await runReview({
            call: this.#options.call,
            systemPrompt: [
                withSection(this.#options.persona, this.#block(phrase)),
                instructions(reads.length > 0, current, tagging),
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
            fail(outcome.reason, outcome.stage);
            return this.#markFailed(phrase, at);
        }
        return this.#save(phrase, name, outcome, {
            at,
            turns: turns.length,
            signal,
        });
    }

    // The notes as they are, healed once if they can't be read; undefined
    // when no review is due. Unparseable notes were warned of at launch
    // and are never written; hidden ones are forgotten.
    async #current(phrase: string): Promise<Sidecar | null | undefined> {
        const { dir, versions } = this.#options;
        let read = await readSidecar(dir, phrase);
        if (
            read.kind === "unparseable" &&
            (await versions?.heal(sidecarPath(dir, phrase)))
        ) {
            read = await readSidecar(dir, phrase);
        }
        if (
            read.kind === "unparseable" ||
            (read.kind === "ok" && read.sidecar.hidden)
        ) {
            return undefined;
        }
        const current = read.kind === "ok" ? read.sidecar : null;
        return reviewDue(current, this.#options.now().getTime())
            ? current
            : undefined;
    }

    // Marked reviewed through the turns, with no call made.
    async #markUnchanged(phrase: string, turns: number): Promise<Reviewed> {
        const skipped = await updateSidecar(
            this.#options.dir,
            phrase,
            (latest) =>
                latest === null || latest.hidden
                    ? null
                    : markReviewed(latest, turns),
            this.#lock,
            this.#recording(`review: ${phrase} (dorothy, nothing new)`),
        );
        return skipped.kind === "written"
            ? { kind: "marked", sidecar: skipped.sidecar, turns }
            : { kind: "none" };
    }

    async #markFailed(phrase: string, at: string): Promise<Reviewed> {
        const failed = await updateSidecar(
            this.#options.dir,
            phrase,
            (latest) => (latest?.hidden ? null : markFailed(latest, at)),
            this.#lock,
            this.#recording(`review: ${phrase} (dorothy, failed)`),
        );
        return failed.kind === "written"
            ? { kind: "marked", sidecar: failed.sidecar, turns: null }
            : { kind: "none" };
    }

    // The review's notes merged into the notes as they are by then.
    // Quitting may land while the write waits its turn. Tags are applied
    // inside the same lock as the notes.
    async #save(
        phrase: string,
        name: string,
        outcome: Extract<Awaited<ReturnType<typeof runReview>>, { ok: true }>,
        {
            at,
            turns,
            signal,
        }: { at: string; turns: number; signal: AbortSignal },
    ): Promise<Reviewed> {
        const tagOutput = outcome.tags;
        const written: string[] = [];
        const result = await updateSidecar(
            this.#options.dir,
            phrase,
            async (latest) => {
                if (signal.aborted || latest?.hidden) {
                    return null;
                }
                const tags =
                    tagOutput === undefined
                        ? undefined
                        : await this.#tag(
                              latest,
                              tagOutput,
                              {
                                  at,
                                  model: outcome.model,
                              },
                              written,
                          );
                return mergeReview(latest, outcome.notes, {
                    model: outcome.model,
                    at,
                    throughTurn: turns,
                    costUsd: outcome.costUsd,
                    appraisals: outcome.appraisals,
                    ...(tags === undefined ? {} : { tags }),
                });
            },
            this.#lock,
            this.#recording(
                `review: ${phrase} (dorothy, ${outcome.model})`,
                written,
            ),
        );
        if (result.kind === "failed") {
            this.#options.warn(
                `memory: couldn't save notes on "${name}": ${result.reason}`,
                { phrase, kind: "save" },
            );
        }
        return result.kind === "written"
            ? { kind: "reviewed", sidecar: result.sidecar, turns }
            : { kind: "none" };
    }
}

// A review has something to do: turns past the last it read, reads to
// appraise, or, with tags, notes not yet tagged.
function reviewable(
    current: Sidecar | null,
    turns: readonly ResumedTurn[],
    reads: readonly unknown[],
    tagging: boolean,
): boolean {
    return (
        turns.length > (current?.reviewedThrough ?? 0) ||
        reads.length > 0 ||
        (tagging && untagged(current))
    );
}

// The review's instructions, with what this one is asked besides notes.
function instructions(
    reading: boolean,
    current: Sidecar | null,
    tagging: boolean,
): string {
    return [
        REVIEW_INSTRUCTIONS,
        ...(reading ? [READS_INSTRUCTION] : []),
        ...((current?.clusters.length ?? 0) > 0 ? [CLUSTERS_INSTRUCTION] : []),
        ...(tagging ? [TAGS_INSTRUCTION] : []),
    ].join(" ");
}
