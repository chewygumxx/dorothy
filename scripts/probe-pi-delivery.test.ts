// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/scripts/probe-pi-delivery.test.ts
//
//

// The probe's own rules, against a scripted upstream on loopback: no
// spending without a stated limit, one model and path forwarded with the
// upstream's key, worst-case reservations, and a stop when a reply's
// usage is missing or its stream is cut. The probe itself is never run
// here.

import { afterEach, describe, expect, it } from "bun:test";
import {
    type FakeProvider,
    finish,
    MODEL,
    reply,
    SYNTHETIC_KEY,
    said,
    startFakeProvider,
    usage,
} from "../packages/cli/src/hosts/pi/testing.js";
import { metadataProblem } from "./pi-proxy.js";
import {
    costOf,
    type ForwardingProxy,
    parseProbeArgs,
    startForwardingProxy,
} from "./probe-pi-delivery.js";

const UPSTREAM_KEY = "upstream-fixture-key";
const PRICE = { input: 0.225, output: 0.9, cacheRead: 0.006 };

let upstream: FakeProvider | null = null;
let proxy: ForwardingProxy | null = null;
let stalled: { close(): Promise<void> } | null = null;
afterEach(async () => {
    await proxy?.close();
    await upstream?.close();
    await stalled?.close();
    proxy = null;
    upstream = null;
    stalled = null;
});

// An upstream that streams one chunk of a reply, then nothing, ever:
// the cut a cancel or a timeout ends. It counts what reaches it.
function startStalled() {
    let asked = 0;
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        fetch() {
            asked++;
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(
                        new TextEncoder().encode(
                            `data: ${JSON.stringify(said("Partial"))}\n\n`,
                        ),
                    );
                },
            });
            return new Response(stream, {
                headers: { "content-type": "text/event-stream" },
            });
        },
    });
    stalled = { close: () => server.stop(true) };
    return {
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        asked: () => asked,
    };
}

// An upstream that sends a complete reply and [DONE], then leaves the
// HTTP body open: Pi reads DONE and may cancel before the connection ends.
function startDoneOpen(chunks: readonly Record<string, unknown>[]) {
    let asked = 0;
    const encoder = new TextEncoder();
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        fetch() {
            asked++;
            const first = asked === 1;
            const stream = new ReadableStream({
                start(controller) {
                    for (const chunk of chunks)
                        controller.enqueue(
                            encoder.encode(
                                `data: ${JSON.stringify(chunk)}\n\n`,
                            ),
                        );
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                    // The body Pi leaves open; a later call closes, so a
                    // test can show the proxy still forwards it.
                    if (!first) controller.close();
                },
            });
            return new Response(stream, {
                headers: { "content-type": "text/event-stream" },
            });
        },
    });
    stalled = { close: () => server.stop(true) };
    return {
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        asked: () => asked,
    };
}

const until = async (done: () => boolean) => {
    const deadline = Date.now() + 5_000;
    while (!done()) {
        if (Date.now() > deadline) throw new Error("never settled");
        await Bun.sleep(20);
    }
};

const start = (
    script: Parameters<typeof startFakeProvider>[0],
    over: Partial<Parameters<typeof startForwardingProxy>[0]> = {},
) => {
    upstream = startFakeProvider(script);
    proxy = startForwardingProxy({
        upstream: upstream.baseUrl,
        model: MODEL,
        key: UPSTREAM_KEY,
        maxUsd: 1,
        maxTurns: 6,
        timeoutMs: 10_000,
        contextWindow: 262144,
        maxTokens: 32768,
        price: PRICE,
        ...over,
    });
    return proxy;
};
const ask = (at: ForwardingProxy, body: Record<string, unknown>, path = "") =>
    fetch(`${at.baseUrl}${path || "/chat/completions"}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${SYNTHETIC_KEY}`,
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [{ role: "system", content: "s" }],
            max_completion_tokens: 32768,
            ...body,
        }),
    }).then(async (response) => ({
        status: response.status,
        text: await response.text(),
    }));

describe("the probe's arguments", () => {
    it("never runs live without a spending limit", () => {
        expect(parseProbeArgs(["--live", "--out", "/tmp/x"])).toContain(
            "--live needs --max-usd",
        );
        expect(
            parseProbeArgs([
                "--live",
                "--out",
                "/tmp/x",
                "--max-usd",
                "5",
                "--max-turns",
                "6",
                "--timeout-ms",
                "120000",
            ]),
        ).toEqual({
            mode: "live",
            out: "/tmp/x",
            maxUsd: 5,
            maxTurns: 6,
            timeoutMs: 120000,
        });
        expect(parseProbeArgs(["--offline", "--out", "/tmp/x"])).toEqual({
            mode: "offline",
            out: "/tmp/x",
            maxUsd: 0,
            maxTurns: 6,
            timeoutMs: 120000,
        });
        expect(parseProbeArgs(["--offline", "--live", "--out", "x"])).toContain(
            "one of",
        );
        expect(parseProbeArgs(["--offline"])).toContain("usage:");
    });
});

describe("the probe's forwarding proxy", () => {
    it("accepts only complete metadata matching the reviewed manifest", () => {
        const declared = {
            id: MODEL,
            contextWindow: 262144,
            maxTokens: 32768,
            reasoning: true,
            input: ["text" as const],
            price: PRICE,
            checkedAt: "2026-11-03",
            sources: [],
        };
        const valid = {
            checkedAt: "2026-11-05",
            source: "fixture",
            found: true,
            contextWindow: 262144,
            maxTokens: 32768,
            price: { input: 0.225, output: 0.9 },
            drift: [],
        };
        expect(metadataProblem(valid, declared)).toBeNull();
        for (const bad of [
            null,
            { ...valid, found: false },
            { ...valid, drift: ["price changed"] },
            { ...valid, maxTokens: -1 },
            { ...valid, price: { input: Number.NaN, output: 0.9 } },
        ]) {
            expect(metadataProblem(bad, declared)).not.toBeNull();
        }
    });
    it("forwards Chat Completions for its model with the upstream's key", async () => {
        const at = start([reply("Fine.")]);
        const answer = await ask(at, {
            chat_template_kwargs: { thinking: true },
        });
        expect(answer.status).toBe(200);
        expect(answer.text).toContain("Fine.");
        expect(upstream?.requests.map((r) => r.authorization)).toEqual([
            `Bearer ${UPSTREAM_KEY}`,
        ]);
        const [call] = at.calls;
        expect(call).toMatchObject({
            status: 200,
            refused: null,
            syntheticKey: true,
            roles: ["system"],
            store: false,
            maxCompletionTokens: 32768,
            thinking: true,
            reply: {
                finish: "stop",
                usage: { prompt: 10, completion: 5, cached: 0 },
            },
        });
        const cost = costOf({ prompt: 10, completion: 5, cached: 0 }, PRICE);
        expect(call?.costUsd).toBeCloseTo(cost, 12);
        expect(at.spentUsd()).toBeCloseTo(cost, 12);
        expect(at.stopped()).toBeNull();
    });

    it("refuses another model or path without forwarding it", async () => {
        const at = start([reply("Never.")]);
        expect((await ask(at, { model: "other/model" })).status).toBe(400);
        expect((await ask(at, {}, "/embeddings")).status).toBe(404);
        expect(upstream?.requests).toEqual([]);
        expect(at.calls.map((call) => call.refused)).toEqual([
            "model",
            "path /v1/embeddings",
        ]);
    });

    it("reserves a call's worst cost before forwarding it", async () => {
        // A full context in and the largest reply out: about US$0.088.
        const at = start([reply("Never.")], { maxUsd: 0.05 });
        expect((await ask(at, {})).status).toBe(400);
        expect(upstream?.requests).toEqual([]);
        expect(at.stopped()).toBe("budget US$0.05");
    });

    it("stops after its turns", async () => {
        const at = start([reply("one"), reply("two")], { maxTurns: 1 });
        expect((await ask(at, {})).status).toBe(200);
        expect((await ask(at, {})).status).toBe(400);
        expect(upstream?.requests).toHaveLength(1);
        expect(at.stopped()).toBe("turn limit 1");
    });

    it("keeps the reservation and stops when a reply has no usage", async () => {
        const at = start([[said("No usage."), finish("stop")], reply("two")]);
        expect((await ask(at, {})).text).toContain("No usage.");
        expect(at.calls[0]?.costUsd).toBeNull();
        expect(at.spentUsd()).toBeCloseTo(at.calls[0]?.reservedUsd ?? 0, 12);
        expect(at.stopped()).toBe("usage unavailable");
        expect((await ask(at, {})).status).toBe(400);
        expect(upstream?.requests).toHaveLength(1);
    });

    it("treats incomplete or malformed usage as unknown cost", async () => {
        for (const bad of [
            { prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } },
            { prompt_tokens: -1, completion_tokens: 2 },
            { prompt_tokens: 10, completion_tokens: 1.5 },
            {
                prompt_tokens: 10,
                completion_tokens: 2,
                prompt_tokens_details: { cached_tokens: 11 },
            },
        ]) {
            const at = start([
                [said("Bad usage"), finish("stop"), { ...usage, usage: bad }],
            ]);
            expect((await ask(at, {})).status).toBe(200);
            expect(at.calls[0]?.reply.usage).toBeNull();
            expect(at.calls[0]?.costUsd).toBeNull();
            expect(at.stopped()).toBe("usage invalid");
            expect(upstream?.requests).toHaveLength(1);
            await proxy?.close();
            await upstream?.close();
        }
    });

    it("rejects negative limits and normalizes oversized output bounds", async () => {
        const at = start([reply("bounded")]);
        expect((await ask(at, { max_completion_tokens: -1 })).status).toBe(400);
        expect(upstream?.requests).toEqual([]);
        expect(
            (
                await ask(at, {
                    max_completion_tokens: 999_999,
                    max_tokens: 888_888,
                })
            ).status,
        ).toBe(200);
        expect(upstream?.requests[0]?.body).toMatchObject({
            max_completion_tokens: 32768,
            max_tokens: 32768,
        });
        expect(at.calls[1]?.maxCompletionTokens).toBe(32768);
    });

    it("injects the reserved output cap when the client omits both fields", async () => {
        const at = start([reply("bounded")]);
        const response = await fetch(`${at.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${SYNTHETIC_KEY}`,
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: "system", content: "s" }],
            }),
        });
        expect(response.status).toBe(200);
        await response.text();
        expect(upstream?.requests[0]?.body).toMatchObject({
            max_completion_tokens: 32768,
        });
        expect(upstream?.requests[0]?.body).not.toHaveProperty("max_tokens");
        expect(at.calls[0]?.maxCompletionTokens).toBe(32768);
        const expected =
            (262144 * PRICE.input) / 1_000_000 +
            (32768 * PRICE.output) / 1_000_000;
        expect(at.calls[0]?.reservedUsd).toBeCloseTo(expected, 12);
    });

    it("aborts an in-flight upstream stream when the wall stops", async () => {
        const cut = startStalled();
        const at = start([], { upstream: cut.baseUrl });
        const response = await fetch(`${at.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: MODEL, messages: [] }),
        });
        const reader = response.body?.getReader();
        expect(
            new TextDecoder().decode((await reader?.read())?.value),
        ).toContain("Partial");
        at.stop("time limit");
        await until(() => at.calls[0]?.refused === "time limit");
        expect(at.calls[0]?.costUsd).toBeNull();
        expect(at.spentUsd()).toBeCloseTo(at.calls[0]?.reservedUsd ?? 0, 12);
        expect((await ask(at, {})).status).toBe(400);
    });

    it("settles a complete reply at DONE when Pi cancels before EOF", async () => {
        const open = startDoneOpen([said("Fine."), finish("stop"), usage]);
        const at = start([reply("Next.")], { upstream: open.baseUrl });
        const abort = new AbortController();
        const response = await fetch(`${at.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: MODEL, messages: [] }),
            signal: abort.signal,
        });
        const reader = response.body?.getReader();
        let text = "";
        while (!text.includes("[DONE]")) {
            const read = await reader?.read();
            if (!read || read.done) break;
            text += new TextDecoder().decode(read.value);
        }
        expect(text).toContain("[DONE]");
        // Let the proxy read DONE before Pi's cancellation reaches it.
        await Bun.sleep(20);
        abort.abort();
        await Bun.sleep(20);
        const [call] = at.calls;
        const used = { prompt: 10, completion: 5, cached: 0 };
        expect(at.stopped()).toBeNull();
        expect(call?.reply).toMatchObject({ finish: "stop", usage: used });
        expect(call?.costUsd).toBeCloseTo(costOf(used, PRICE), 12);
        expect(at.spentUsd()).toBeCloseTo(costOf(used, PRICE), 12);
        // The next permitted call is forwarded, not refused for the last.
        expect((await ask(at, {})).status).toBe(200);
        expect(open.asked()).toBe(2);
        expect(at.calls[1]?.refused).toBeNull();
    });

    it("does not settle DONE without a finish marker as complete", async () => {
        const open = startDoneOpen([said("Unfinished."), usage]);
        const at = start([reply("Next.")], { upstream: open.baseUrl });
        const abort = new AbortController();
        const response = await fetch(`${at.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: MODEL, messages: [] }),
            signal: abort.signal,
        });
        const reader = response.body?.getReader();
        let text = "";
        while (!text.includes("[DONE]")) {
            const read = await reader?.read();
            if (!read || read.done) break;
            text += new TextDecoder().decode(read.value);
        }
        expect(text).toContain("[DONE]");
        await Bun.sleep(20);
        abort.abort();
        await until(() => at.stopped() !== null);
        expect(at.stopped()).toBe("stream cut: no finish");
        expect(at.calls[0]?.costUsd).toBeNull();
        expect(at.spentUsd()).toBeCloseTo(at.calls[0]?.reservedUsd ?? 0, 12);
        expect(open.asked()).toBe(1);
    });

    it("keeps the reservation and stops when Pi cancels a reply", async () => {
        const cut = startStalled();
        const at = start([], { upstream: cut.baseUrl });
        const abort = new AbortController();
        const response = await fetch(`${at.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: MODEL, messages: [] }),
            signal: abort.signal,
        });
        const reader = response.body?.getReader();
        expect(
            new TextDecoder().decode((await reader?.read())?.value),
        ).toContain("Partial");
        abort.abort();
        await until(() => at.stopped() !== null);
        expect(at.stopped()).toStartWith("stream cut");
        expect(at.calls[0]?.costUsd).toBeNull();
        expect(at.spentUsd()).toBeCloseTo(at.calls[0]?.reservedUsd ?? 0, 12);
        expect((await ask(at, {})).status).toBe(400);
        expect(cut.asked()).toBe(1);
    });

    it("keeps the reservation and stops when a reply outlives its time", async () => {
        const cut = startStalled();
        const at = start([], { upstream: cut.baseUrl, timeoutMs: 300 });
        const answer = await fetch(`${at.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: MODEL, messages: [] }),
        });
        // The reply starts, then breaks off when the call's time is up.
        await answer.text().catch(() => "");
        await until(() => at.stopped() !== null);
        expect(at.stopped()).toBe("time limit");
        expect(at.calls[0]?.refused).toStartWith("stream cut");
        expect(at.calls[0]?.costUsd).toBeNull();
        expect(at.spentUsd()).toBeCloseTo(at.calls[0]?.reservedUsd ?? 0, 12);
        expect((await ask(at, {})).status).toBe(400);
        expect(cut.asked()).toBe(1);
    });
});
