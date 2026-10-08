// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/structured.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { StructuredRequest } from "./contracts/structured.js";
import { baseOptions, cliOptions } from "./persona.js";
import { type StructuredQueryFn, structuredCall } from "./structured.js";
import type { Timers } from "./timers.js";

const init = (model = "claude-test") =>
    ({
        type: "system",
        subtype: "init",
        model,
        session_id: "s",
    }) as unknown as SDKMessage;
const success = (output: unknown, cost = 0.25) =>
    ({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
        structured_output: output,
        total_cost_usd: cost,
    }) as unknown as SDKMessage;
const failure = (errors: string[]) =>
    ({
        type: "result",
        subtype: "error_max_structured_output_retries",
        is_error: true,
        errors,
        total_cost_usd: 0.5,
    }) as unknown as SDKMessage;

type Fake = {
    fn: StructuredQueryFn;
    prompt: string | null;
    options: Options | null;
    closed: boolean;
};

// "hang" never yields, standing for a call that never answers.
function fakeQuery(script: SDKMessage[] | "hang" | Error): Fake {
    const fake: Fake = {
        fn: ({ prompt, options }) => {
            fake.prompt = prompt;
            fake.options = options;
            async function* run(): AsyncGenerator<SDKMessage> {
                if (script === "hang") {
                    await new Promise(() => {});
                    return;
                }
                if (script instanceof Error) {
                    throw script;
                }
                yield* script;
            }
            return Object.assign(run(), {
                close: () => {
                    fake.closed = true;
                },
            });
        },
        prompt: null,
        options: null,
        closed: false,
    };
    return fake;
}

// Timers that fire only when told to.
function manualTimers() {
    const pending = new Map<number, () => void>();
    let next = 1;
    const timers: Timers = {
        set: (fn) => {
            const id = next++;
            pending.set(id, fn);
            return id;
        },
        clear: (handle) => {
            pending.delete(handle as number);
        },
    };
    const fire = () => {
        for (const [id, fn] of [...pending]) {
            pending.delete(id);
            fn();
        }
    };
    return { timers, pending, fire };
}

const REQUEST: StructuredRequest = {
    what: "compaction",
    system: "You are Dorothy.",
    prompt: "<turns/>",
    schema: { type: "object" },
    timeoutMs: 120_000,
};

describe("structuredCall", () => {
    it("asks once, with no tools, on the CLI's private home", async () => {
        const fake = fakeQuery([init(), success({ a: 1 })]);
        await structuredCall({ queryFn: fake.fn })(REQUEST);
        expect(fake.prompt).toBe("<turns/>");
        expect(fake.options).toEqual({
            ...baseOptions,
            ...cliOptions(),
            systemPrompt: "You are Dorothy.",
            includePartialMessages: false,
            outputFormat: { type: "json_schema", schema: { type: "object" } },
        });
        expect(fake.closed).toBe(true);
    });

    it("answers with the output, the model and the cost", async () => {
        const fake = fakeQuery([init("claude-x"), success({ a: 1 }, 0.3)]);
        expect(await structuredCall({ queryFn: fake.fn })(REQUEST)).toEqual({
            ok: true,
            output: { a: 1 },
            model: "claude-x",
            costUsd: 0.3,
        });
    });

    it("fails with the errors, keeping the cost", async () => {
        const fake = fakeQuery([init(), failure(["bad output"])]);
        expect(await structuredCall({ queryFn: fake.fn })(REQUEST)).toEqual({
            ok: false,
            reason: "bad output",
            costUsd: 0.5,
        });
    });

    it("names itself when it ends without a result", async () => {
        const fake = fakeQuery([init()]);
        expect(await structuredCall({ queryFn: fake.fn })(REQUEST)).toEqual({
            ok: false,
            reason: "the compaction ended without a result",
            costUsd: 0,
        });
    });

    it("fails with what the query threw", async () => {
        const fake = fakeQuery(new Error("offline"));
        expect(await structuredCall({ queryFn: fake.fn })(REQUEST)).toEqual({
            ok: false,
            reason: "offline",
            costUsd: 0,
        });
    });

    it("fails when the query cannot start", async () => {
        const throwing: StructuredQueryFn = () => {
            throw new Error("bad options");
        };
        expect(await structuredCall({ queryFn: throwing })(REQUEST)).toEqual({
            ok: false,
            reason: "bad options",
            costUsd: 0,
        });
    });

    it("times out, closing the query", async () => {
        const fake = fakeQuery("hang");
        const { timers, fire } = manualTimers();
        const answer = structuredCall({ queryFn: fake.fn, timers })(REQUEST);
        fire();
        expect(await answer).toEqual({
            ok: false,
            reason: "timed out after 120s",
            costUsd: 0,
        });
        expect(fake.closed).toBe(true);
    });

    it("stops when cancelled, before or during", async () => {
        const controller = new AbortController();
        controller.abort();
        const before = fakeQuery([init(), success({})]);
        expect(
            await structuredCall({ queryFn: before.fn })({
                ...REQUEST,
                signal: controller.signal,
            }),
        ).toEqual({ ok: false, reason: "cancelled", costUsd: 0 });
        expect(before.prompt).toBeNull();
        const during = new AbortController();
        const hang = fakeQuery("hang");
        const { timers, pending } = manualTimers();
        const answer = structuredCall({ queryFn: hang.fn, timers })({
            ...REQUEST,
            signal: during.signal,
        });
        during.abort();
        expect(await answer).toEqual({
            ok: false,
            reason: "cancelled",
            costUsd: 0,
        });
        expect(pending.size).toBe(0);
    });
});
