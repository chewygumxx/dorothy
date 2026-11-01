// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/models/fallback.ts
//
//

// A call on a route: its entries in order, skipping those in cooldown,
// until one answers. It decides on failures and never reads HTTP; agent
// turns a provider's errors into Failures.

import {
    type Attempt,
    type Failure,
    label,
    type Route,
    type RouteEntry,
} from "../contracts/model.js";
import { REAL_TIMERS, type Timers } from "../timers.js";
import type { Cooldowns } from "./cooldowns.js";

export type RouteOutcome<T> =
    | {
          ok: true;
          value: T;
          entry: RouteEntry;
          costUsd: number;
          notes: string[];
      }
    | {
          ok: false;
          failure: Failure;
          reason: string;
          started: boolean;
          costUsd: number;
          notes: string[];
      };

export type RunRouteOptions = {
    cooldowns: Cooldowns;
    // The caller's: an interrupt or a cancelled review.
    signal?: AbortSignal;
    // The whole call's time, its attempts' together; null for none, as
    // in chat, where a stall ends an attempt instead.
    deadlineMs: number | null;
    timers?: Timers;
};

export const CANCELLED: Failure = {
    class: "cancelled",
    message: "cancelled",
    retryAfterMs: null,
};

export const timedOut = (ms: number): Failure => ({
    class: "timeout",
    message: `timed out after ${ms / 1000}s`,
    retryAfterMs: null,
});

const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

const wait = (ms: number) =>
    ms >= 60_000 ? `${Math.ceil(ms / 60_000)}m` : `${Math.ceil(ms / 1000)}s`;

const describeFailure = (failure: Failure) =>
    `${failure.class}: ${failure.message}${
        failure.retryAfterMs === null
            ? ""
            : `, retry in ${wait(failure.retryAfterMs)}`
    }`;

// The entries to try: those not in cooldown, in order; if every entry
// is, the one whose cooldown ends first.
function plan(
    route: Route,
    cooldowns: Cooldowns,
): { order: RouteEntry[]; cooling: [RouteEntry, number][] } {
    const cooling: [RouteEntry, number][] = [];
    const free: RouteEntry[] = [];
    for (const entry of route) {
        const until = cooldowns.until(entry);
        if (until === null) {
            free.push(entry);
        } else {
            cooling.push([entry, until]);
        }
    }
    if (free.length > 0 || cooling.length === 0) {
        return { order: free, cooling };
    }
    const soonest = cooling.reduce((a, b) => (b[1] < a[1] ? b : a));
    return {
        order: [soonest[0]],
        cooling: cooling.filter((pair) => pair !== soonest),
    };
}

export async function runRoute<T>(
    route: Route,
    attempt: Attempt<T>,
    { cooldowns, signal, deadlineMs, timers = REAL_TIMERS }: RunRouteOptions,
): Promise<RouteOutcome<T>> {
    const notes: string[] = [];
    const { order, cooling } = plan(route, cooldowns);
    const failures = cooling.map(
        ([entry, until]) => `${label(entry)}: in cooldown until ${hhmm(until)}`,
    );
    const first = order[0];
    if (cooling.length > 0 && first !== undefined) {
        const skipped = cooling
            .map(
                ([entry, until]) =>
                    `${label(entry)} in cooldown until ${hhmm(until)}`,
            )
            .join(", ");
        notes.push(`${skipped}; answering with ${label(first)}`);
    }
    const deadline = new AbortController();
    const timer =
        deadlineMs === null
            ? null
            : timers.set(() => deadline.abort(), deadlineMs);
    let costUsd = 0;
    let last: Failure = {
        class: "rejected",
        message: "the route has no entry",
        retryAfterMs: null,
    };
    let started = false;
    try {
        for (const [index, entry] of order.entries()) {
            if (signal?.aborted) {
                last = CANCELLED;
                break;
            }
            const result = await attempt(
                entry,
                signal === undefined
                    ? deadline.signal
                    : AbortSignal.any([deadline.signal, signal]),
            );
            costUsd += result.costUsd;
            if (result.ok) {
                return { ok: true, value: result.value, entry, costUsd, notes };
            }
            // The attempt saw one signal; which of the two fired says why.
            const failure = signal?.aborted
                ? CANCELLED
                : deadline.signal.aborted && deadlineMs !== null
                  ? timedOut(deadlineMs)
                  : result.failure;
            cooldowns.note(entry, failure);
            failures.push(`${label(entry)}: ${describeFailure(failure)}`);
            last = failure;
            started = result.started;
            const next = order[index + 1];
            if (
                started ||
                failure.class === "cancelled" ||
                deadline.signal.aborted ||
                next === undefined
            ) {
                break;
            }
            notes.push(
                `${label(entry)} refused (${describeFailure(failure)}); answering with ${label(next)}`,
            );
        }
    } finally {
        if (timer !== null) {
            timers.clear(timer);
        }
    }
    // One failure, or none, keeps its own words: a one-entry route's
    // message, or an empty route's.
    const reason =
        last.class === "cancelled"
            ? CANCELLED.message
            : failures.length <= 1
              ? last.message
              : failures.join("; ");
    return { ok: false, failure: last, reason, started, costUsd, notes };
}
