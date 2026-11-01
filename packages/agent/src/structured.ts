// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/structured.ts
//
//

// One-shot calls on a route, answering with structured output: her
// reviews and her compactions. Each attempt streams, so that a stall
// ends it while the call's time allows another; all of a call's attempts
// share its timeoutMs.

import {
    type AttemptResult,
    Cooldowns,
    defaultRoutes,
    type Env,
    type Failure,
    label,
    REAL_TIMERS,
    type Route,
    type RouteEntry,
    runRoute,
    type StructuredCall,
    type StructuredRequest,
    stepCost,
    type Timers,
} from "@dorothy/core";
import { jsonSchema, Output, streamText } from "ai";
import { STALL_MS, secretFailure, Watchdog } from "./attempt.js";
import { stepUsage } from "./cost.js";
import { failureOf } from "./failures.js";
import {
    keyOf,
    languageModel,
    type ModelFactory,
    providerOptions,
} from "./providers.js";

export type StructuredDeps = {
    route?: Route;
    cooldowns?: Cooldowns;
    env?: Env;
    model?: ModelFactory;
    timers?: Timers;
    stallMs?: number;
};

type AttemptDeps = Required<
    Pick<StructuredDeps, "env" | "model" | "timers" | "stallMs">
>;

// JSON of the schema's top-level type; the caller judges the rest.
function fits(value: unknown, schema: Record<string, unknown>): boolean {
    switch (schema.type) {
        case "object":
            return (
                typeof value === "object" &&
                value !== null &&
                !Array.isArray(value)
            );
        case "array":
            return Array.isArray(value);
        default:
            return value !== undefined;
    }
}

export function structuredCall({
    route = defaultRoutes().review,
    cooldowns = new Cooldowns(),
    env = process.env,
    model = languageModel,
    timers = REAL_TIMERS,
    stallMs = STALL_MS,
}: StructuredDeps = {}): StructuredCall {
    const deps: AttemptDeps = { env, model, timers, stallMs };
    return async (request) => {
        if (request.signal?.aborted) {
            return { ok: false, reason: "cancelled", costUsd: 0 };
        }
        const outcome = await runRoute(
            route,
            (entry, signal) => attempt(entry, signal, request, deps),
            {
                cooldowns,
                deadlineMs: request.timeoutMs,
                timers,
                ...(request.signal === undefined
                    ? {}
                    : { signal: request.signal }),
            },
        );
        const notes =
            outcome.notes.length === 0 ? {} : { notes: outcome.notes };
        return outcome.ok
            ? {
                  ok: true,
                  output: outcome.value,
                  model: label(outcome.entry),
                  costUsd: outcome.costUsd,
                  ...notes,
              }
            : {
                  ok: false,
                  reason: outcome.reason,
                  costUsd: outcome.costUsd,
                  ...notes,
              };
    };
}

async function attempt(
    entry: RouteEntry,
    signal: AbortSignal,
    { what, system, prompt, schema }: StructuredRequest,
    deps: AttemptDeps,
): Promise<AttemptResult<unknown>> {
    const key = keyOf(entry, deps.env);
    if (key === null) {
        return {
            ok: false,
            failure: secretFailure(entry),
            started: false,
            costUsd: 0,
        };
    }
    const watchdog = new Watchdog(signal, deps.stallMs, deps.timers);
    let costUsd = 0;
    let streamed: Failure | null = null;
    let aborted = false;
    try {
        const result = streamText({
            model: deps.model(entry, key),
            instructions: system,
            prompt,
            output: Output.object({ schema: jsonSchema(schema) }),
            maxRetries: 0,
            abortSignal: watchdog.signal,
            providerOptions: providerOptions(entry),
            onError: () => {},
        });
        for await (const part of result.fullStream) {
            watchdog.touch();
            if (part.type === "error") {
                streamed ??= failureOf(part.error);
            } else if (part.type === "abort") {
                aborted = true;
            } else if (part.type === "finish-step") {
                costUsd += stepCost(entry, stepUsage(part.usage)) ?? 0;
            }
        }
        if (aborted) {
            return {
                ok: false,
                failure: watchdog.failure(),
                started: false,
                costUsd,
            };
        }
        if (streamed !== null) {
            return { ok: false, failure: streamed, started: false, costUsd };
        }
        const output = await result.output.then(
            (value) => value as unknown,
            () => undefined,
        );
        if (!fits(output, schema)) {
            return {
                ok: false,
                failure: {
                    class: "unparsed",
                    message: `the ${what} ended without a result`,
                    retryAfterMs: null,
                },
                started: false,
                costUsd,
            };
        }
        return { ok: true, value: output, costUsd };
    } catch (error) {
        return {
            ok: false,
            failure: watchdog.signal.aborted
                ? watchdog.failure()
                : failureOf(error),
            started: false,
            costUsd,
        };
    } finally {
        watchdog.dispose();
    }
}
