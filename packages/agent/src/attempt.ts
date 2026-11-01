// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/attempt.ts
//
//

// What every attempt shares: its own abort, and the failure of a
// missing key.

import {
    type Failure,
    REAL_TIMERS,
    type RouteEntry,
    type Timers,
} from "@dorothy/core";

export const STALL_MS = 60_000;

// An attempt's abort: its route's signal, or a stall, when nothing has
// arrived for ms since the request began or since the stream's last
// part. Every part counts, reasoning too, so a long think is no stall;
// the AI SDK's own chunk timeouts start only at a provider's first
// event, and so miss a server that never answers.
export class Watchdog {
    readonly #controller = new AbortController();
    readonly #route: AbortSignal;
    readonly #ms: number;
    readonly #timers: Timers;
    #timer: unknown = null;
    #stalled = false;
    readonly #onAbort = () => {
        this.#controller.abort();
    };

    constructor(
        signal: AbortSignal,
        ms = STALL_MS,
        timers: Timers = REAL_TIMERS,
    ) {
        this.#route = signal;
        this.#ms = ms;
        this.#timers = timers;
        if (signal.aborted) {
            this.#controller.abort();
        } else {
            signal.addEventListener("abort", this.#onAbort, { once: true });
        }
        this.touch();
    }

    get signal(): AbortSignal {
        return this.#controller.signal;
    }

    touch(): void {
        if (this.#timer !== null) {
            this.#timers.clear(this.#timer);
        }
        this.#timer = this.#timers.set(() => {
            this.#stalled = true;
            this.#controller.abort();
        }, this.#ms);
    }

    dispose(): void {
        if (this.#timer !== null) {
            this.#timers.clear(this.#timer);
            this.#timer = null;
        }
        this.#route.removeEventListener("abort", this.#onAbort);
    }

    // Why an aborted attempt ended: a stall, or its route's signal, which
    // runRoute tells apart as a cancel or its deadline.
    failure(): Failure {
        return this.#stalled
            ? {
                  class: "timeout",
                  message: `no response for ${this.#ms / 1000}s`,
                  retryAfterMs: null,
              }
            : { class: "cancelled", message: "cancelled", retryAfterMs: null };
    }
}

export const secretFailure = (entry: RouteEntry): Failure => ({
    class: "secret",
    message: `${entry.key} is not set`,
    retryAfterMs: null,
});
