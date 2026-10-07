// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/timers.ts
//
//

// Injected so whatever waits, a review, a compaction or a call's timeout,
// is tested without real time.
export type Timers = {
    set(fn: () => void, ms: number): unknown;
    clear(handle: unknown): void;
};

export const REAL_TIMERS: Timers = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
