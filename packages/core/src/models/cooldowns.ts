// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/core/src/models/cooldowns.ts
//
//

// Refusals for usage, remembered for the process: a provider out of
// credit, or a model rate-limited on it, is skipped until its time is
// up. One instance per process, shared by every call, so a refusal one
// call meets is skipped by the next.

import { type Failure, label, type RouteEntry } from "../contracts/model.js";
import { type Clock, REAL_CLOCK } from "../timers.js";

export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

export class Cooldowns {
    readonly #clock: Clock;
    // By provider name, and by label: the label holds a colon, the
    // provider's name never does, so the two never collide.
    readonly #until = new Map<string, number>();

    constructor(clock: Clock = REAL_CLOCK) {
        this.#clock = clock;
    }

    // When entry may be tried again, or null if it may be now.
    until(entry: RouteEntry): number | null {
        const now = this.#clock.now();
        const times = [
            this.#until.get(entry.provider),
            this.#until.get(label(entry)),
        ].filter((time): time is number => time !== undefined && time > now);
        return times.length === 0 ? null : Math.max(...times);
    }

    // usage cools the provider, rate-limit the provider's model; nothing
    // else cools down.
    note(entry: RouteEntry, failure: Failure): void {
        const key =
            failure.class === "usage"
                ? entry.provider
                : failure.class === "rate-limit"
                  ? label(entry)
                  : null;
        if (key !== null) {
            this.#until.set(
                key,
                this.#clock.now() +
                    (failure.retryAfterMs ?? DEFAULT_COOLDOWN_MS),
            );
        }
    }
}
