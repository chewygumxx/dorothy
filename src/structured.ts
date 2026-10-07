// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/structured.ts
//
//

import {
    type Options,
    query,
    type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
    StructuredCall,
    StructuredOutcome,
    StructuredRequest,
} from "./compaction/types.js";
import { baseOptions, cliOptions } from "./persona.js";
import { REAL_TIMERS, type Timers } from "./timers.js";

export type StructuredHandle = AsyncIterable<SDKMessage> & { close(): void };
// The SDK's query() fits this; tests pass a fake.
export type StructuredQueryFn = (params: {
    prompt: string;
    options: Options;
}) => StructuredHandle;

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// One-shot query() calls on Dorothy's model, answering with structured
// output: her reviews and her compactions. A timeout or a cancel ends the
// call even if the query never yields again.
export function structuredCall({
    queryFn = query,
    timers = REAL_TIMERS,
}: {
    queryFn?: StructuredQueryFn;
    timers?: Timers;
} = {}): StructuredCall {
    return (request) => run(queryFn, timers, request);
}

async function run(
    queryFn: StructuredQueryFn,
    timers: Timers,
    { what, system, prompt, schema, timeoutMs, signal }: StructuredRequest,
): Promise<StructuredOutcome> {
    if (signal?.aborted) {
        return { ok: false, reason: "cancelled", costUsd: 0 };
    }
    let handle: StructuredHandle;
    try {
        handle = queryFn({
            prompt,
            options: {
                ...baseOptions,
                ...cliOptions(),
                systemPrompt: system,
                includePartialMessages: false,
                outputFormat: { type: "json_schema", schema },
            },
        });
    } catch (error) {
        return { ok: false, reason: describeError(error), costUsd: 0 };
    }
    let stopped: string | null = null;
    let wake = () => {};
    const halted = new Promise<void>((resolve) => {
        wake = resolve;
    });
    const stop = (reason: string) => {
        stopped ??= reason;
        wake();
    };
    const timer = timers.set(
        () => stop(`timed out after ${timeoutMs / 1000}s`),
        timeoutMs,
    );
    const onAbort = () => stop("cancelled");
    signal?.addEventListener("abort", onAbort);

    let model = "unknown";
    let result: ResultMessage | null = null;
    let thrown: string | null = null;
    const consume = async () => {
        for await (const message of handle) {
            if (message.type === "system" && message.subtype === "init") {
                model = message.model;
            } else if (message.type === "result") {
                result = message;
                return;
            }
        }
    };
    try {
        await Promise.race([
            consume().catch((error: unknown) => {
                thrown = describeError(error);
            }),
            halted,
        ]);
    } finally {
        timers.clear(timer);
        signal?.removeEventListener("abort", onAbort);
        handle.close();
    }

    if (stopped !== null) {
        return { ok: false, reason: stopped, costUsd: 0 };
    }
    if (thrown !== null) {
        return { ok: false, reason: thrown, costUsd: 0 };
    }
    const final = result as ResultMessage | null;
    if (final === null) {
        return {
            ok: false,
            reason: `the ${what} ended without a result`,
            costUsd: 0,
        };
    }
    const costUsd = final.total_cost_usd;
    if (final.subtype !== "success") {
        return {
            ok: false,
            reason: final.errors.join("; ") || final.subtype,
            costUsd,
        };
    }
    if (final.is_error) {
        return { ok: false, reason: final.result || "error", costUsd };
    }
    return { ok: true, output: final.structured_output, model, costUsd };
}
