// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/agent/src/structured.ts
//
//

// One-shot calls on a route, answering with structured output: her
// reviews and her compactions. Each attempt streams, so that a stall
// ends it while the call's time allows another; all of a call's attempts
// share its timeoutMs. Anthropic's structured output does not enforce
// maxLength, minimum and the like, so an answer is checked against the
// whole schema and, on a mismatch, the model is asked again.

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
    type Timers,
} from "@dorothy/core";
import { jsonSchema, type ModelMessage, Output, streamText } from "ai";
import { z } from "zod";
import { STALL_MS, secretFailure, Watchdog } from "./attempt.js";
import { failureOf } from "./failures.js";
import {
    instructionsFor,
    keyOf,
    languageModel,
    type ModelFactory,
} from "./providers.js";
import { readStream, requestBase } from "./stream.js";

// Times a model is asked again after an answer that breaks its schema.
export const STRUCTURED_REPAIRS = 2;

// How many of a mismatch's issues a repair message names.
const ISSUES_NAMED = 3;

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
> & { notice: (message: string) => void };

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

// The schema's issues with an output, as the repair message gives them,
// as the Agent SDK validated against the full schema and retried. A
// schema zod cannot read is held to `fits` alone.
function validatorFor(
    schema: Record<string, unknown>,
): (value: unknown) => string[] {
    let validator: z.ZodType;
    try {
        validator = z.fromJSONSchema(schema as z.core.JSONSchema.JSONSchema);
    } catch {
        return () => [];
    }
    return (value) => {
        const parsed = validator.safeParse(value);
        return parsed.success
            ? []
            : parsed.error.issues
                  .slice(0, ISSUES_NAMED)
                  .map(({ path, message }) =>
                      path.length === 0
                          ? message
                          : `${path.join(".")}: ${message}`,
                  );
    };
}

export function structuredCall({
    route = defaultRoutes().review,
    cooldowns = new Cooldowns(),
    env = process.env,
    model = languageModel,
    timers = REAL_TIMERS,
    stallMs = STALL_MS,
}: StructuredDeps = {}): StructuredCall {
    return async (request) => {
        if (request.signal?.aborted) {
            return { ok: false, reason: "cancelled", costUsd: 0 };
        }
        // A cost unknown is said beside the route's own notes.
        const notices: string[] = [];
        const deps: AttemptDeps = {
            env,
            model,
            timers,
            stallMs,
            notice: (message) => notices.push(message),
        };
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
        const said = [...outcome.notes, ...notices];
        const notes = said.length === 0 ? {} : { notes: said };
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

type Round = {
    // Null when the request failed, else the model's JSON, if any.
    output: unknown;
    failure: Failure | null;
    costUsd: number;
};

// One request to the model: its parsed output, or how it failed.
async function ask(
    entry: RouteEntry,
    key: string,
    watchdog: Watchdog,
    { system, schema }: StructuredRequest,
    messages: ModelMessage[],
    deps: AttemptDeps,
): Promise<Round> {
    const read = await readStream(
        entry,
        watchdog,
        () =>
            streamText({
                ...requestBase(entry, key, "structured", deps.model, watchdog),
                instructions: instructionsFor(entry, system),
                messages,
                output: Output.object({ schema: jsonSchema(schema) }),
            }),
        { notice: deps.notice },
    );
    if (!read.ok) {
        return {
            output: undefined,
            failure: read.failure,
            costUsd: read.costUsd,
        };
    }
    const output = await read.result.output.then(
        (value) => value as unknown,
        () => undefined,
    );
    return { output, failure: null, costUsd: read.costUsd };
}

const unparsed = (message: string): Failure => ({
    class: "unparsed",
    message,
    retryAfterMs: null,
});

async function attempt(
    entry: RouteEntry,
    signal: AbortSignal,
    request: StructuredRequest,
    deps: AttemptDeps,
): Promise<AttemptResult<unknown>> {
    const { what, prompt, schema } = request;
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
    const fail = (failure: Failure): AttemptResult<unknown> => ({
        ok: false,
        failure,
        started: false,
        costUsd,
    });
    try {
        const issuesOf = validatorFor(schema);
        const messages: ModelMessage[] = [{ role: "user", content: prompt }];
        for (let repairs = 0; ; repairs++) {
            const round = await ask(
                entry,
                key,
                watchdog,
                request,
                messages,
                deps,
            );
            costUsd += round.costUsd;
            if (round.failure !== null) {
                return fail(round.failure);
            }
            if (!fits(round.output, schema)) {
                return fail(unparsed(`the ${what} ended without a result`));
            }
            const issues = issuesOf(round.output);
            if (issues.length === 0) {
                return { ok: true, value: round.output, costUsd };
            }
            if (repairs === STRUCTURED_REPAIRS) {
                return fail(
                    unparsed(
                        `the ${what} did not match its schema: ${issues[0]}`,
                    ),
                );
            }
            messages.push(
                { role: "assistant", content: JSON.stringify(round.output) },
                {
                    role: "user",
                    content: `That answer does not match the schema: ${issues.join("; ")}. Answer again, with JSON that matches it.`,
                },
            );
        }
    } catch (error) {
        return fail(
            watchdog.signal.aborted ? watchdog.failure() : failureOf(error),
        );
    } finally {
        watchdog.dispose();
    }
}
