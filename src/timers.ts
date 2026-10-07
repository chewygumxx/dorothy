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

// A wait that ends early, and quietly, when the signal aborts.
export function sleep(
    timers: Timers,
    ms: number,
    signal: AbortSignal,
): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve();
            return;
        }
        const timer = timers.set(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            timers.clear(timer);
            resolve();
        };
        signal.addEventListener("abort", onAbort, { once: true });
    });
}
