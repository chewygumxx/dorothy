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
import { structuredCall } from "./structured.js";
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
        expect(sent?.prompt[0]).toEqual({ role: "system", content: "persona" });
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
