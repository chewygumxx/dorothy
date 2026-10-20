// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/service.ts
//
//

import { randomBytes } from "node:crypto";
import {
    type MemoryConfig,
    type Notice,
    REAL_TIMERS,
    type StructuredCall,
    sleep,
    type Timers,
    type Turn,
} from "@dorothy/core";
import type { RecallIndex } from "../recall/store.js";
import type { Entry } from "./catalogue.js";
import { buildMemory } from "./rank.js";
import { REVIEW_TIMEOUT_MS } from "./review.js";
import { Reviewer } from "./reviewer.js";
import { ReviewScheduler } from "./scheduler.js";
import {
    type HistoryHandle,
    type Lock,
    provisionalTitle,
    recordingFor,
    reviewDue,
    type Sidecar,
    untagged,
    updateSidecar,
    withProvisional,
    writeLock,
} from "./sidecar.js";
import type { MemoryHooks } from "./track.js";

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
    // tags.json; null leaves tags alone, as when memory runs without a
    // data directory to keep them in.
    vocabulary?: string | null;
    // History: each write is committed, and a broken file is restored
    // before a review reads it. Null or absent without.
    versions?: HistoryHandle | null;
    // How a review asks the model; the agent supplies the real one.
    call: StructuredCall;
    // The persona reviews run on: the chat persona without recall.
    persona: string;
    now?: () => Date;
    timers?: Timers;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// A claim outlives the longest review by this much.
const CLAIM_MARGIN_MS = 30_000;
// How often a review of the live conversation asks again for a claim
// another holds, a compaction at the same idle most often. Compaction's
// retry is its own, in src/compaction/, which memory does not import.
export const REVIEW_CLAIM_RETRY_MS = 2000;

// It has turns no review has covered, or was reviewed before tags while
// Dorothy tags; she may review it, and its back-off is over.
export function isStale(entry: Entry, now: number, tagging: boolean): boolean {
    if (entry.sidecar.kind === "none") {
        return entry.turns > 0;
    }
    if (entry.sidecar.kind === "unparseable") {
        return false;
    }
    const { sidecar } = entry.sidecar;
    return (
        !sidecar.hidden &&
        (entry.turns > sidecar.reviewedThrough ||
            (tagging && untagged(sidecar))) &&
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
    readonly #vocabulary: string | null;
    readonly #versions: HistoryHandle | null;
    // Who this run's claims belong to.
    readonly #owner = `${process.pid}-${randomBytes(4).toString("hex")}`;
    readonly #reviewer: Reviewer;
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
    // A review of the live conversation waiting for its claim, which a
    // message sent ends.
    #waiting: AbortController | null = null;

    constructor(options: MemoryServiceOptions) {
        this.#dir = options.dir;
        this.#phrase = options.phrase;
        this.#history = options.history;
        this.#config = options.config;
        this.#flushed = options.flushed;
        this.#index = options.index ?? null;
        this.#vocabulary = options.vocabulary ?? null;
        this.#versions = options.versions ?? null;
        this.#now = options.now ?? (() => new Date());
        this.#timers = options.timers ?? REAL_TIMERS;
        this.#entries = new Map(
            options.entries.map((entry) => [entry.phrase, entry]),
        );
        this.#reviewer = new Reviewer({
            dir: options.dir,
            config: options.config,
            index: this.#index,
            vocabulary: this.#vocabulary,
            versions: this.#versions,
            call: options.call,
            persona: options.persona,
            now: this.#now,
            entries: () => this.#entries.values(),
            warn: (message) => this.#warn(message),
            cost: (usd) => this.#emit({ type: "memory-cost", usd }),
        });
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

    // The block a new session starts with, as of the latest review, with
    // reserved tokens of the live conversation's own abstracts charged
    // first. A pin overrun is told once a run.
    block(reserved = 0): string {
        if (reserved === 0) {
            return this.#block;
        }
        const built = this.#build(this.#phrase, reserved);
        const [warning] = built.warnings;
        if (warning !== undefined && !this.#pinWarned) {
            this.#pinWarned = true;
            this.#warn(warning);
        }
        return built.block;
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
        this.#waiting?.abort();
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
            this.#lock,
            this.#recording(`title: ${this.#phrase} (prompt)`),
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
        if (this.#vocabulary === null) {
            this.#catchUp(false);
            return;
        }
        void this.#reviewer.readVocabulary().then((vocabulary) => {
            this.#catchUp(vocabulary !== null);
        });
    }

    // While the vocabulary is broken, conversations owed only their tags
    // wait, or a broken file would cost a review at every launch.
    #catchUp(tagging: boolean): void {
        if (this.#stopped) {
            return;
        }
        const now = this.#now().getTime();
        const stale = [...this.#entries.values()]
            .filter(
                (entry) =>
                    entry.phrase !== this.#phrase &&
                    isStale(entry, now, tagging),
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

    get #lock(): Lock | undefined {
        return writeLock(this.#index, this.#versions);
    }

    #recording(message: string, also: readonly string[] = []) {
        return recordingFor(this.#versions, message, also);
    }

    #build(
        exclude: string,
        reserved = 0,
    ): { block: string; warnings: string[] } {
        return buildMemory([...this.#entries.values()], {
            now: this.#now().getTime(),
            config: this.#config,
            exclude,
            reserved,
        });
    }

    async #review(phrase: string, signal: AbortSignal): Promise<void> {
        const index = this.#index;
        if (index !== null && !(await this.#claim(index, phrase, signal))) {
            return;
        }
        try {
            if (phrase === this.#phrase) {
                await this.#flushed?.();
            }
            const reviewed = await this.#reviewer.review(phrase, signal);
            if (reviewed.kind === "none") {
                return;
            }
            this.#remember(phrase, reviewed.sidecar, reviewed.turns);
            // The live conversation is left out of its own sessions' block.
            if (reviewed.kind === "reviewed" && phrase !== this.#phrase) {
                const built = this.#build(this.#phrase);
                this.#block = built.block;
                const [warning] = built.warnings;
                if (warning !== undefined && !this.#pinWarned) {
                    this.#pinWarned = true;
                    this.#warn(warning);
                }
            }
        } finally {
            await index?.release(phrase, this.#owner);
        }
    }

    // Takes the conversation's claim. At a shared idle compaction takes it
    // first, and the live conversation's review waits for it, asking again
    // until it is granted, a message is sent or the run stops. Another
    // conversation's is left to whoever holds it: one review runs at a
    // time, and the live conversation's would wait behind it.
    async #claim(
        index: RecallIndex,
        phrase: string,
        signal: AbortSignal,
    ): Promise<boolean> {
        const take = () =>
            index.claim(
                phrase,
                this.#owner,
                this.#now().getTime(),
                REVIEW_TIMEOUT_MS + CLAIM_MARGIN_MS,
            );
        if (await take()) {
            return true;
        }
        if (phrase !== this.#phrase || signal.aborted) {
            return false;
        }
        const waiting = new AbortController();
        const stop = () => waiting.abort();
        signal.addEventListener("abort", stop, { once: true });
        this.#waiting = waiting;
        try {
            for (;;) {
                await sleep(
                    this.#timers,
                    REVIEW_CLAIM_RETRY_MS,
                    waiting.signal,
                );
                if (waiting.signal.aborted) {
                    return false;
                }
                if (await take()) {
                    if (!waiting.signal.aborted) {
                        return true;
                    }
                    // A message was sent while the claim was asked for.
                    await index.release(phrase, this.#owner);
                    return false;
                }
            }
        } finally {
            signal.removeEventListener("abort", stop);
            if (this.#waiting === waiting) {
                this.#waiting = null;
            }
        }
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
}
