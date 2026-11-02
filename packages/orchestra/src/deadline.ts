// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/deadline.ts
//
//

import type { Clock, Timers } from "@dorothy/core";

type Settled<T> =
    | { status: "value"; value: T }
    | { status: "timeout" | "aborted" | "failed" };

// Both races are enforced here, even if the callback ignores its signal.
// A normal answer leaves its signal alone: aborting it would cancel an
// already answered SDK request.
export function beforeDeadline<T>(
    work: (signal: AbortSignal) => Promise<T>,
    deadline: number,
    signal: AbortSignal,
    clock: Clock,
    timers: Timers,
): Promise<Settled<T>> {
    if (signal.aborted) return Promise.resolve({ status: "aborted" });
    if (clock.now() >= deadline) return Promise.resolve({ status: "timeout" });
    return new Promise((resolve) => {
        const controller = new AbortController();
        let done = false;
        let timer: unknown;
        const finish = (result: Settled<T>) => {
            if (done) return;
            done = true;
            timers.clear(timer);
            signal.removeEventListener("abort", aborted);
            if (result.status !== "value") controller.abort(result.status);
            resolve(result);
        };
        const aborted = () => finish({ status: "aborted" });
        signal.addEventListener("abort", aborted, { once: true });
        timer = timers.set(
            () => finish({ status: "timeout" }),
            deadline - clock.now(),
        );
        Promise.resolve()
            .then(() => {
                if (done) return;
                return work(controller.signal);
            })
            .then(
                (value) => {
                    if (done) return;
                    if (clock.now() >= deadline) finish({ status: "timeout" });
                    else finish({ status: "value", value: value as T });
                },
                () => finish({ status: "failed" }),
            );
    });
}
