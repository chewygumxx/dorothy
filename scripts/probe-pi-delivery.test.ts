// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/probe-pi-delivery.test.ts
//
//

// The probe's own rules, against a scripted upstream on loopback: no
// spending without a stated limit, one model and path forwarded with the
// upstream's key, worst-case reservations, and a stop when a reply's
// usage is missing. The probe itself is never run here.

import { afterEach, describe, expect, it } from "bun:test";
import {
    type FakeProvider,
    finish,
    MODEL,
    reply,
    SYNTHETIC_KEY,
    said,
    startFakeProvider,
} from "../packages/cli/src/hosts/pi/testing.js";
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
afterEach(async () => {
    await proxy?.close();
    await upstream?.close();
    proxy = null;
    upstream = null;
});

const start = (script: Parameters<typeof startFakeProvider>[0], over = {}) => {
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
});
