// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/structured.test.ts
//
//

import { afterEach, describe, expect, it } from "bun:test";
import { anthropicEntry, type StructuredRequest } from "@dorothy/core";
import { APICallError } from "ai";
import { STALL_MS } from "./attempt.js";
import { STRUCTURED_REPAIRS, structuredCall } from "./structured.js";
import {
    fakeMessages,
    manualTimers,
    mockModel,
    mockUsage,
    type Script,
    textChunks,
} from "./testing.js";

const SCHEMA = { type: "object", properties: { ok: { type: "boolean" } } };
const REQUEST: StructuredRequest = {
    what: "review",
    system: "persona",
    prompt: "the chat",
    schema: SCHEMA,
    timeoutMs: 120_000,
};
const env = { ANTHROPIC_API_KEY: "test-key" };
const SONNET = anthropicEntry("claude-sonnet-5-5");

const callWith = (
    scripts: Script[],
    extra: Parameters<typeof structuredCall>[0] = {},
) => {
    const model = mockModel(scripts, "claude-sonnet-5-5");
    return {
        model,
        call: structuredCall({
            route: [SONNET],
            env,
            model: () => model,
            ...extra,
        }),
    };
};

async function until(done: () => boolean): Promise<void> {
    const end = Date.now() + 2000;
    while (!done()) {
        if (Date.now() > end) {
            throw new Error("timed out waiting");
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
}

describe("structuredCall", () => {
    it("answers with the output, the entry's label and its cost", async () => {
        const { call, model } = callWith([
            {
                chunks: textChunks(
                    '{"ok":true}',
                    mockUsage(1_000_000, 1_000_000),
                ),
            },
        ]);
        expect(await call(REQUEST)).toEqual({
            ok: true,
            output: { ok: true },
            model: "anthropic:claude-sonnet-5-5",
            costUsd: 12,
        });
        const sent = model.doStreamCalls[0];
        expect(sent?.prompt[0]).toEqual({
            role: "system",
            content: "persona",
            providerOptions: {
                anthropic: { cacheControl: { type: "ephemeral" } },
            },
        });
        expect(sent?.responseFormat).toMatchObject({
            type: "json",
            schema: SCHEMA,
        });
        expect(sent?.providerOptions).toEqual({
            anthropic: { thinking: { type: "disabled" } },
        });
    });

    it("fails output that is not JSON", async () => {
        const { call } = callWith([{ chunks: textChunks("not json") }]);
        expect(await call(REQUEST)).toMatchObject({
            ok: false,
            reason: "the review ended without a result",
        });
    });

    it("says nothing of usage on a step an error ended", async () => {
        const entry = { ...SONNET, model: "claude-error-step-test" };
        const model = mockModel(
            [
                {
                    chunks: [
                        { type: "stream-start", warnings: [] },
                        { type: "error", error: new Error("boom") },
                        {
                            type: "finish",
                            usage: {
                                inputTokens: {
                                    total: undefined,
                                    noCache: undefined,
                                    cacheRead: undefined,
                                    cacheWrite: undefined,
                                },
                                outputTokens: {
                                    total: undefined,
                                    text: undefined,
                                    reasoning: undefined,
                                },
                            },
                            finishReason: { unified: "error", raw: undefined },
                        },
                    ],
                },
            ],
            entry.model,
        );
        const outcome = await structuredCall({
            route: [entry],
            env,
            model: () => model,
        })(REQUEST);
        expect(outcome).toEqual({ ok: false, reason: "boom", costUsd: 0 });
    });

    it("fails JSON of another shape than the schema's", async () => {
        const { call } = callWith([{ chunks: textChunks("[1,2]") }]);
        expect(await call(REQUEST)).toMatchObject({
            ok: false,
            reason: "the review ended without a result",
        });
    });

    it("fails without a key, calling no model", async () => {
        const model = mockModel([{ chunks: textChunks("{}") }]);
        const call = structuredCall({
            route: [SONNET],
            env: {},
            model: () => model,
        });
        expect(await call(REQUEST)).toEqual({
            ok: false,
            reason: "ANTHROPIC_API_KEY is not set",
            costUsd: 0,
        });
        expect(model.doStreamCalls).toHaveLength(0);
    });

    it("fails, rather than throws, when the model factory throws", async () => {
        const call = structuredCall({
            route: [SONNET],
            env,
            model: () => {
                throw new Error("no such model");
            },
        });
        expect(await call(REQUEST)).toMatchObject({
            ok: false,
            reason: expect.stringContaining("no such model"),
            costUsd: 0,
        });
    });

    it("ends an attempt that stalls", async () => {
        const timers = manualTimers();
        const { call, model } = callWith(
            [{ chunks: [{ type: "stream-start", warnings: [] }], hang: true }],
            { timers },
        );
        const pending = call(REQUEST);
        await until(() => model.doStreamCalls.length === 1);
        timers.fire(STALL_MS);
        expect(await pending).toMatchObject({
            ok: false,
            reason: "no response for 60s",
        });
    });

    it("ends the call at its deadline", async () => {
        const timers = manualTimers();
        const { call, model } = callWith(
            [{ chunks: [{ type: "stream-start", warnings: [] }], hang: true }],
            { timers },
        );
        const pending = call(REQUEST);
        await until(() => model.doStreamCalls.length === 1);
        timers.fire(120_000);
        expect(await pending).toMatchObject({
            ok: false,
            reason: "timed out after 120s",
        });
    });

    it("ends the call when cancelled", async () => {
        const controller = new AbortController();
        const { call, model } = callWith([
            { chunks: [{ type: "stream-start", warnings: [] }], hang: true },
        ]);
        const pending = call({ ...REQUEST, signal: controller.signal });
        await until(() => model.doStreamCalls.length === 1);
        controller.abort();
        expect(await pending).toMatchObject({ ok: false, reason: "cancelled" });
    });

    it("calls nothing when already cancelled", async () => {
        const controller = new AbortController();
        controller.abort();
        const { call, model } = callWith([{ chunks: textChunks("{}") }]);
        expect(await call({ ...REQUEST, signal: controller.signal })).toEqual({
            ok: false,
            reason: "cancelled",
            costUsd: 0,
        });
        expect(model.doStreamCalls).toHaveLength(0);
    });

    it("says a provider's refusal", async () => {
        const refusal = new APICallError({
            message: "slow down",
            url: "u",
            requestBodyValues: {},
            statusCode: 429,
            responseHeaders: { "retry-after": "41" },
        });
        const { call } = callWith([refusal]);
        expect(await call(REQUEST)).toMatchObject({
            ok: false,
            reason: "slow down",
        });
    });

    it("answers from the next entry after a refusal, with a note", async () => {
        const refusal = new APICallError({
            message: "slow down",
            url: "u",
            requestBodyValues: {},
            statusCode: 429,
        });
        const first = mockModel([refusal], "claude-sonnet-5-5");
        const second = mockModel(
            [{ chunks: textChunks('{"ok":true}') }],
            "claude-haiku-5-5",
        );
        const HAIKU = anthropicEntry("claude-haiku-5-5");
        const call = structuredCall({
            route: [SONNET, HAIKU],
            env,
            model: (entry) => (entry.model === SONNET.model ? first : second),
        });
        const outcome = await call(REQUEST);
        expect(outcome).toMatchObject({
            ok: true,
            output: { ok: true },
            model: "anthropic:claude-haiku-5-5",
        });
        expect(outcome.notes).toEqual([
            "anthropic:claude-sonnet-5-5 refused (rate-limit: slow down); answering with anthropic:claude-haiku-5-5",
        ]);
    });
});

describe("structuredCall's repairs", () => {
    const TITLED = {
        type: "object",
        properties: { title: { type: "string", maxLength: 5 } },
        required: ["title"],
        additionalProperties: false,
    };
    const TITLE_REQUEST = { ...REQUEST, schema: TITLED };
    const answer = (text: string) => ({
        chunks: textChunks(text, mockUsage(1_000_000, 0)),
    });

    it("asks again after an overshoot, and sums the cost", async () => {
        const { call, model } = callWith([
            answer('{"title":"too long"}'),
            answer('{"title":"short"}'),
        ]);
        expect(await call(TITLE_REQUEST)).toEqual({
            ok: true,
            output: { title: "short" },
            model: "anthropic:claude-sonnet-5-5",
            costUsd: 4,
        });
        expect(model.doStreamCalls).toHaveLength(2);
        expect(model.doStreamCalls[1]?.prompt.slice(1)).toEqual([
            {
                role: "user",
                content: [{ type: "text", text: "the chat" }],
                providerOptions: undefined,
            },
            {
                role: "assistant",
                content: [{ type: "text", text: '{"title":"too long"}' }],
                providerOptions: undefined,
            },
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: expect.stringMatching(
                            /^That answer does not match the schema: title: .*\. Answer again, with JSON that matches it\.$/,
                        ),
                    },
                ],
                providerOptions: undefined,
            },
        ]);
    });

    it("repairs a missing required field the same way", async () => {
        const { call, model } = callWith([
            answer("{}"),
            answer('{"title":"ok"}'),
        ]);
        expect(await call(TITLE_REQUEST)).toMatchObject({
            ok: true,
            output: { title: "ok" },
        });
        expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
            "title: ",
        );
    });

    it("keeps the conversation growing across repairs", async () => {
        const { call, model } = callWith([
            answer('{"title":"first long"}'),
            answer('{"title":"second long"}'),
            answer('{"title":"fine"}'),
        ]);
        expect(await call(TITLE_REQUEST)).toMatchObject({ ok: true });
        expect(model.doStreamCalls[2]?.prompt.map((m) => m.role)).toEqual([
            "system",
            "user",
            "assistant",
            "user",
            "assistant",
            "user",
        ]);
    });

    it("fails after the last repair still overshoots", async () => {
        const { call, model } = callWith([
            answer('{"title":"too long"}'),
            answer('{"title":"too long"}'),
            answer('{"title":"too long"}'),
        ]);
        expect(STRUCTURED_REPAIRS).toBe(2);
        expect(await call(TITLE_REQUEST)).toEqual({
            ok: false,
            reason: expect.stringMatching(
                /^the review did not match its schema: title: /,
            ),
            costUsd: 6,
        });
        expect(model.doStreamCalls).toHaveLength(3);
    });

    it("makes one call for a valid answer", async () => {
        const { call, model } = callWith([answer('{"title":"fine"}')]);
        expect(await call(TITLE_REQUEST)).toMatchObject({ ok: true });
        expect(model.doStreamCalls).toHaveLength(1);
    });

    it("does not repair output that is not JSON", async () => {
        const { call, model } = callWith([answer("nope")]);
        expect(await call(TITLE_REQUEST)).toMatchObject({
            ok: false,
            reason: "the review ended without a result",
        });
        expect(model.doStreamCalls).toHaveLength(1);
    });

    it("fails an abort during a repair as during the first request", async () => {
        const timers = manualTimers();
        const { call, model } = callWith(
            [
                answer('{"title":"too long"}'),
                {
                    chunks: [{ type: "stream-start", warnings: [] }],
                    hang: true,
                },
            ],
            { timers },
        );
        const pending = call(TITLE_REQUEST);
        await until(() => model.doStreamCalls.length === 2);
        timers.fire(STALL_MS);
        expect(await pending).toMatchObject({
            ok: false,
            reason: "no response for 60s",
            costUsd: 2,
        });
    });

    it("validates by its top-level type when the schema is unreadable", async () => {
        const unreadable = {
            type: "object",
            properties: { a: { $ref: "#/definitions/missing" } },
        };
        const { call, model } = callWith([answer('{"a":1}')]);
        expect(await call({ ...REQUEST, schema: unreadable })).toMatchObject({
            ok: true,
            output: { a: 1 },
        });
        expect(model.doStreamCalls).toHaveLength(1);
    });
});

describe("structuredCall's shared time", () => {
    it("leaves a second entry its time after a first that stalls", async () => {
        const timers = manualTimers();
        const first = mockModel(
            [{ chunks: [{ type: "stream-start", warnings: [] }], hang: true }],
            "claude-sonnet-5-5",
        );
        const second = mockModel(
            [{ chunks: textChunks('{"ok":true}') }],
            "claude-haiku-5-5",
        );
        const HAIKU = anthropicEntry("claude-haiku-5-5");
        const call = structuredCall({
            route: [SONNET, HAIKU],
            env,
            timers,
            model: (entry) => (entry.model === SONNET.model ? first : second),
        });
        const pending = call(REQUEST);
        await until(() => first.doStreamCalls.length === 1);
        timers.fire(STALL_MS);
        expect(await pending).toMatchObject({
            ok: true,
            model: "anthropic:claude-haiku-5-5",
        });
        expect(timers.pending()).toEqual([]);
    });
});

describe("structuredCall on the wire", () => {
    const stops: (() => void)[] = [];
    afterEach(() => {
        for (const stop of stops.splice(0)) {
            stop();
        }
    });

    it("ends an attempt on a server that never sends an event", async () => {
        const server = fakeMessages([{ silent: true }]);
        stops.push(server.stop);
        const call = structuredCall({
            route: [{ ...SONNET, baseUrl: server.url }],
            env,
            stallMs: 50,
        });
        expect(await call(REQUEST)).toMatchObject({
            ok: false,
            reason: "no response for 0.05s",
        });
    });
});

describe("a model with no price", () => {
    it("says so once in notes", async () => {
        const entry = { ...SONNET, model: "claude-unpriced-structured-test" };
        const model = mockModel(
            [
                { chunks: textChunks('{"ok":true}') },
                { chunks: textChunks('{"ok":true}') },
            ],
            entry.model,
        );
        const call = structuredCall({
            route: [entry],
            env,
            model: () => model,
        });
        expect(await call(REQUEST)).toMatchObject({
            ok: true,
            notes: [
                "no price is known for anthropic:claude-unpriced-structured-test; its cost shows as $0",
            ],
        });
        expect((await call(REQUEST)).notes).toBeUndefined();
    });
});
