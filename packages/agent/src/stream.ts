// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/agent/src/stream.ts
//
//

// One request's stream, read as chat's attempts and structured calls'
// both read it: every part feeds the watchdog; an error or abort part,
// or a throw, becomes the attempt's Failure; each step's usage becomes
// its cost, with a notice where that cost is unknown.

import type { Failure, RouteEntry } from "@dorothy/core";
import type { TextStreamPart, ToolSet } from "ai";
import type { Watchdog } from "./attempt.js";
import { stepPrice } from "./cost.js";
import { failureOf } from "./failures.js";
import { type ModelFactory, providerOptions, type Use } from "./providers.js";

// What every request sets, beside its own prompt: the entry's model, no
// retries, the attempt's own abort, the model's thinking, and nothing
// written to the console.
export function requestBase(
    entry: RouteEntry,
    key: string,
    use: Use,
    model: ModelFactory,
    watchdog: Watchdog,
) {
    return {
        model: model(entry, key, use),
        maxRetries: 0,
        abortSignal: watchdog.signal,
        providerOptions: providerOptions(entry),
        onError: () => {},
    };
}

export type Streamed<R> =
    | { ok: true; result: R; costUsd: number }
    | { ok: false; failure: Failure; costUsd: number };

export type ReadOptions = {
    // Each part, after the watchdog has seen it. It may throw: the
    // attempt then fails, as a throw from the stream would.
    onPart?: (part: TextStreamPart<ToolSet>) => void;
    // A cost unknown, once a process per model.
    notice: (message: string) => void;
};

export async function readStream<
    R extends { fullStream: AsyncIterable<TextStreamPart<ToolSet>> },
>(
    entry: RouteEntry,
    watchdog: Watchdog,
    start: () => R,
    { onPart, notice }: ReadOptions,
): Promise<Streamed<R>> {
    let costUsd = 0;
    let failure: Failure | null = null;
    let aborted = false;
    try {
        const result = start();
        for await (const part of result.fullStream) {
            watchdog.touch();
            onPart?.(part);
            if (part.type === "error") {
                failure ??= failureOf(part.error);
            } else if (part.type === "abort") {
                aborted = true;
            } else if (part.type === "finish-step") {
                // A step an error ended has no usage of its own: it costs
                // nothing, and is no sign of a provider that reports none.
                if (
                    part.finishReason === "error" &&
                    part.usage.inputTokens === undefined &&
                    part.usage.outputTokens === undefined
                ) {
                    continue;
                }
                const step = stepPrice(
                    entry,
                    part.usage,
                    part.providerMetadata,
                );
                costUsd += step.costUsd;
                if (step.notice !== null) {
                    notice(step.notice);
                }
            }
        }
        if (aborted) {
            return { ok: false, failure: watchdog.failure(), costUsd };
        }
        return failure === null
            ? { ok: true, result, costUsd }
            : { ok: false, failure, costUsd };
    } catch (error) {
        return {
            ok: false,
            failure: watchdog.signal.aborted
                ? watchdog.failure()
                : failureOf(error),
            costUsd,
        };
    }
}
