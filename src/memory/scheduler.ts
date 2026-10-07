// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/scheduler.ts
//
//

import { REAL_TIMERS, type Timers } from "../timers.js";

export type Review = (phrase: string, signal: AbortSignal) => Promise<void>;

// One review at a time. The live conversation's go ahead of catch-up's, and
// a request for the one under review runs it once more when it finishes.
export class ReviewScheduler {
    readonly #review: Review;
    readonly #idleMs: number;
    readonly #timers: Timers;
    #queue: string[] = [];
    #running: {
        phrase: string;
        controller: AbortController;
        done: Promise<void>;
    } | null = null;
    #dirty = false;
    #idle: unknown = null;
    #stopped = false;

    constructor({
        review,
        idleMs,
        timers = REAL_TIMERS,
    }: {
        review: Review;
        idleMs: number;
        timers?: Timers;
    }) {
        this.#review = review;
        this.#idleMs = idleMs;
        this.#timers = timers;
    }

    // Ahead of everything queued.
    now(phrase: string): void {
        if (this.#stopped) {
            return;
        }
        if (this.#running?.phrase === phrase) {
            this.#dirty = true;
            return;
        }
        this.#queue = [
            phrase,
            ...this.#queue.filter((queued) => queued !== phrase),
        ];
        this.#next();
    }

    // Behind everything queued: catch-up.
    later(phrases: readonly string[]): void {
        if (this.#stopped) {
            return;
        }
        for (const phrase of phrases) {
            if (
                this.#running?.phrase !== phrase &&
                !this.#queue.includes(phrase)
            ) {
                this.#queue.push(phrase);
            }
        }
        this.#next();
    }

    // (Re)starts the idle timer; when it fires, the review goes ahead.
    idle(phrase: string): void {
        this.cancelIdle();
        if (this.#stopped) {
            return;
        }
        this.#idle = this.#timers.set(() => {
            this.#idle = null;
            this.now(phrase);
        }, this.#idleMs);
    }

    cancelIdle(): void {
        if (this.#idle !== null) {
            this.#timers.clear(this.#idle);
            this.#idle = null;
        }
    }

    // The timer and queue go, and the running review is told to stop. The
    // promise settles once that review has finished (never rejecting), for
    // whatever it holds to be let go.
    stop(): Promise<void> {
        this.#stopped = true;
        this.cancelIdle();
        this.#queue = [];
        this.#running?.controller.abort();
        return this.#running?.done ?? Promise.resolve();
    }

    #next(): void {
        if (this.#running !== null || this.#stopped) {
            return;
        }
        const phrase = this.#queue.shift();
        if (phrase === undefined) {
            return;
        }
        const controller = new AbortController();
        const done = this.#review(phrase, controller.signal)
            .catch(() => {})
            .then(() => {
                this.#running = null;
                if (this.#dirty) {
                    this.now(phrase);
                } else {
                    this.#next();
                }
            });
        this.#running = { phrase, controller, done };
        this.#dirty = false;
    }
}
