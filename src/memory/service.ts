// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/service.ts
//
//

import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { MemoryConfig } from "../config.js";
import { systemPrompt, type Turn, withMemory } from "../persona.js";
import type { RecallIndex } from "../recall/store.js";
import { type ResumedTurn, readTranscript } from "../transcript.js";
import type { Entry } from "./catalogue.js";
import { buildMemory } from "./rank.js";
import {
    pendingReads,
    READS_INSTRUCTION,
    REVIEW_INSTRUCTIONS,
    REVIEW_TIMEOUT_MS,
    type ReviewQueryFn,
    reviewPrompt,
    reviewSchema,
    runReview,
} from "./review.js";
import { REAL_TIMERS, ReviewScheduler, type Timers } from "./scheduler.js";
import {
    markFailed,
    markReviewed,
    mergeReview,
    ownsAll,
    provisionalTitle,
    readSidecar,
    reviewDue,
    type Sidecar,
    updateSidecar,
    withProvisional,
} from "./sidecar.js";
import type { MemoryHooks } from "./track.js";

// The same shapes as App's notices.
export type Notice =
    | { type: "warning"; message: string }
    | { type: "memory-cost"; usd: number };

export type MemoryServiceOptions = {
    // The transcripts directory.
    dir: string;
    // The live conversation, and the turns it was resumed with.
    phrase: string;
    history: readonly Turn[];
    config: MemoryConfig;
    // The catalogue as loaded at launch.
    entries: readonly Entry[];
    // Resolves once the live transcript's queued appends have landed; null
    // when the transcript is not being saved, and the live conversation is
    // then left alone.
    flushed: (() => Promise<void>) | null;
    // The recall index, for the write lock and review claims; null without.
    index?: RecallIndex | null;
    queryFn?: ReviewQueryFn;
    now?: () => Date;
    timers?: Timers;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// A claim outlives the longest review by this much.
const CLAIM_MARGIN_MS = 30_000;

// It has turns no review has covered, Dorothy may review it, and its
// back-off is over.
function isStale(entry: Entry, now: number): boolean {
    if (entry.sidecar.kind === "none") {
        return entry.turns > 0;
    }
    if (entry.sidecar.kind === "unparseable") {
        return false;
    }
    const { sidecar } = entry.sidecar;
    return (
        !sidecar.hidden &&
        entry.turns > sidecar.reviewedThrough &&
        reviewDue(sidecar, now)
    );
}

// One TUI run's memory: the catalogue, the block new sessions start with,
// and the reviews that keep the notes current.
export class MemoryService implements MemoryHooks {
    readonly #dir: string;
    readonly #phrase: string;
    readonly #history: readonly Turn[];
    readonly #config: MemoryConfig;
    readonly #flushed: (() => Promise<void>) | null;
    readonly #index: RecallIndex | null;
    // Who this run's claims belong to.
    readonly #owner = `${process.pid}-${randomBytes(4).toString("hex")}`;
    readonly #queryFn: ReviewQueryFn;
    readonly #now: () => Date;
    readonly #timers: Timers;
    readonly #entries: Map<string, Entry>;
    readonly #listeners = new Set<(notice: Notice) => void>();
    readonly #scheduler: ReviewScheduler;
    readonly #initialWarnings: string[];
    // The pin warning's count changes with every review of a pinned note, so
    // it is told once a run, not once per wording.
    #pinWarned: boolean;
    #block: string;
    #titled = false;
    #caughtUp = false;
    // The live conversation's first review is done, or asked for.
    #reviewedOnce: boolean;
    #stopped = false;

    constructor(options: MemoryServiceOptions) {
        this.#dir = options.dir;
        this.#phrase = options.phrase;
        this.#history = options.history;
        this.#config = options.config;
        this.#flushed = options.flushed;
        this.#index = options.index ?? null;
        this.#queryFn = options.queryFn ?? query;
        this.#now = options.now ?? (() => new Date());
        this.#timers = options.timers ?? REAL_TIMERS;
        this.#entries = new Map(
            options.entries.map((entry) => [entry.phrase, entry]),
        );
        const live = this.#entries.get(options.phrase)?.sidecar;
        this.#reviewedOnce =
            live?.kind === "ok" && live.sidecar.reviewedThrough > 0;
        this.#scheduler = new ReviewScheduler({
            review: (phrase, signal) =>
                this.#review(phrase, signal).catch((error: unknown) => {
                    this.#warn(`memory: ${describeError(error)}`);
                }),
            idleMs: options.config.idleSeconds * 1000,
            timers: this.#timers,
        });
        const built = this.#build(options.phrase);
        this.#block = built.block;
        this.#initialWarnings = built.warnings;
        this.#pinWarned = built.warnings.length > 0;
    }

    // The block a new session starts with, as of the latest review.
    block(): string {
        return this.#block;
    }

    // What building the first block found wrong, for the startup warnings.
    warnings(): string[] {
        return [...this.#initialWarnings];
    }

    subscribe(listener: (notice: Notice) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    sent(text: string): void {
        this.#scheduler.cancelIdle();
        if (this.#titled || this.#flushed === null) {
            return;
        }
        this.#titled = true;
        const first =
            this.#history.find((turn) => turn.role === "user")?.text ?? text;
        const title = provisionalTitle(first);
        if (title === null) {
            return;
        }
        const at = this.#now().toISOString();
        void updateSidecar(
            this.#dir,
            this.#phrase,
            (current) => withProvisional(current, title, at),
            this.#index?.lock,
        ).then((result) => {
            if (result.kind === "failed") {
                this.#warn(`memory: couldn't save a title: ${result.reason}`);
            }
        });
    }

    ready(): void {
        if (this.#caughtUp) {
            return;
        }
        this.#caughtUp = true;
        const now = this.#now().getTime();
        const stale = [...this.#entries.values()]
            .filter(
                (entry) => entry.phrase !== this.#phrase && isStale(entry, now),
            )
            .sort((a, b) => b.lastActive - a.lastActive)
            .slice(0, this.#config.catchUp)
            .map((entry) => entry.phrase);
        this.#scheduler.later(stale);
    }

    turnEnded(): void {
        if (this.#flushed === null) {
            return;
        }
        if (this.#reviewedOnce) {
            this.#scheduler.idle(this.#phrase);
            return;
        }
        this.#reviewedOnce = true;
        this.#scheduler.now(this.#phrase);
    }

    // Quitting says nothing more and saves nothing. The running review is
    // cancelled, not waited on for its answer; the promise settles once it
    // has let go of its claim, so the index may then be closed.
    stop(): Promise<void> {
        this.#stopped = true;
        return this.#scheduler.stop();
    }

    #emit(notice: Notice): void {
        if (this.#stopped) {
            return;
        }
        for (const listener of this.#listeners) {
            listener(notice);
        }
    }

    #warn(message: string): void {
        this.#emit({ type: "warning", message });
    }

    #build(exclude: string): { block: string; warnings: string[] } {
        return buildMemory([...this.#entries.values()], {
            now: this.#now().getTime(),
            config: this.#config,
            exclude,
        });
    }

    async #review(phrase: string, signal: AbortSignal): Promise<void> {
        const index = this.#index;
        if (
            index !== null &&
            !(await index.claim(
                phrase,
                this.#owner,
                this.#now().getTime(),
                REVIEW_TIMEOUT_MS + CLAIM_MARGIN_MS,
            ))
        ) {
            return;
        }
        try {
            await this.#reviewClaimed(phrase, signal);
        } finally {
            await index?.release(phrase, this.#owner);
        }
    }

    #nameOf(phrase: string): string {
        const sidecar = this.#entries.get(phrase)?.sidecar;
        return (
            (sidecar?.kind === "ok" ? sidecar.sidecar.title : null) ?? phrase
        );
    }

    // A written sidecar replaces the one held for the block and catch-up.
    #remember(phrase: string, sidecar: Sidecar, turns: number | null): void {
        const entry = this.#entries.get(phrase);
        if (entry !== undefined) {
            this.#entries.set(phrase, {
                ...entry,
                sidecar: { kind: "ok", sidecar },
                turns: turns ?? entry.turns,
            });
        }
    }

    async #reviewClaimed(phrase: string, signal: AbortSignal): Promise<void> {
        if (phrase === this.#phrase) {
            await this.#flushed?.();
        }
        const read = await readSidecar(this.#dir, phrase);
        // Unparseable: warned of at launch and never written. Hidden:
        // forgotten.
        if (
            read.kind === "unparseable" ||
            (read.kind === "ok" && read.sidecar.hidden)
        ) {
            return;
        }
        const current = read.kind === "ok" ? read.sidecar : null;
        if (!reviewDue(current, this.#now().getTime())) {
            return;
        }
        const name = current?.title ?? phrase;
        const fail = (reason: string) =>
            this.#warn(`memory: couldn't review "${name}": ${reason}`);
        let turns: ResumedTurn[];
        try {
            turns = (await readTranscript(join(this.#dir, `${phrase}.jsonl`)))
                .turns;
        } catch (error) {
            fail(describeError(error));
            return;
        }
        const reads = pendingReads(turns, current?.appraisals ?? {}, (of) =>
            this.#nameOf(of),
        );
        if (
            (turns.length <= (current?.reviewedThrough ?? 0) &&
                reads.length === 0) ||
            signal.aborted
        ) {
            return;
        }
        const lock = this.#index?.lock;
        // Every note is the user's and nothing awaits appraisal: a review
        // could change nothing, so none is paid for.
        if (current !== null && ownsAll(current) && reads.length === 0) {
            const skipped = await updateSidecar(
                this.#dir,
                phrase,
                (latest) =>
                    latest === null || latest.hidden
                        ? null
                        : markReviewed(latest, turns.length),
                lock,
            );
            if (skipped.kind === "written") {
                this.#remember(phrase, skipped.sidecar, turns.length);
            }
            return;
        }
        const readIds = reads.map((read) => read.id);
        const outcome = await runReview({
            queryFn: this.#queryFn,
            systemPrompt: [
                withMemory(systemPrompt, this.#build(phrase).block),
                reads.length > 0
                    ? `${REVIEW_INSTRUCTIONS} ${READS_INSTRUCTION}`
                    : REVIEW_INSTRUCTIONS,
            ].join("\n\n"),
            prompt: reviewPrompt(turns, current, reads),
            schema: reviewSchema(readIds),
            readIds,
            signal,
            timers: this.#timers,
        });
        if (signal.aborted) {
            return;
        }
        if (outcome.costUsd > 0) {
            this.#emit({ type: "memory-cost", usd: outcome.costUsd });
        }
        const at = this.#now().toISOString();
        if (!outcome.ok) {
            fail(outcome.reason);
            const failed = await updateSidecar(
                this.#dir,
                phrase,
                (latest) => (latest?.hidden ? null : markFailed(latest, at)),
                lock,
            );
            if (failed.kind === "written") {
                this.#remember(phrase, failed.sidecar, null);
            }
            return;
        }
        // Quitting may land while the write waits its turn.
        const result = await updateSidecar(
            this.#dir,
            phrase,
            (latest) =>
                signal.aborted || latest?.hidden
                    ? null
                    : mergeReview(latest, outcome.notes, {
                          model: outcome.model,
                          at,
                          throughTurn: turns.length,
                          costUsd: outcome.costUsd,
                          appraisals: outcome.appraisals,
                      }),
            lock,
        );
        if (result.kind === "failed") {
            this.#warn(
                `memory: couldn't save notes on "${name}": ${result.reason}`,
            );
            return;
        }
        if (result.kind !== "written") {
            return;
        }
        this.#remember(phrase, result.sidecar, turns.length);
        // The live conversation is left out of its own sessions' block.
        if (phrase !== this.#phrase) {
            const built = this.#build(this.#phrase);
            this.#block = built.block;
            const [warning] = built.warnings;
            if (warning !== undefined && !this.#pinWarned) {
                this.#pinWarned = true;
                this.#warn(warning);
            }
        }
    }
}
