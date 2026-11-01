// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/providers.test.ts
//
//

import { afterEach, describe, expect, it } from "bun:test";
import { anthropicEntry } from "@dorothy/core";
import { streamText } from "ai";
import { failureOf } from "./failures.js";
import { keyOf, languageModel, providerOptions } from "./providers.js";
import { fakeMessages, type Reply } from "./testing.js";

const stops: (() => void)[] = [];
afterEach(() => {
    for (const stop of stops.splice(0)) {
        stop();
    }
});
const serve = (replies: Reply[]) => {
    const server = fakeMessages(replies);
    stops.push(server.stop);
    return server;
};
const entryAt = (url: string) => ({
    ...anthropicEntry("claude-haiku-5-5"),
    baseUrl: url,
});

// The first error part of a one-message stream, or null.
async function firstError(url: string): Promise<unknown> {
    const result = streamText({
        model: languageModel(entryAt(url), "test-key"),
        prompt: "hi",
        maxRetries: 0,
        onError: () => {},
    });
    for await (const part of result.fullStream) {
        if (part.type === "error") {
            return part.error;
        }
    }
    return null;
}

describe("languageModel", () => {
    it("posts to the entry's base URL with its key", async () => {
        const server = serve([{ text: "hello" }]);
        expect(await firstError(server.url)).toBeNull();
        expect(server.bodies[0]?.model).toBe("claude-haiku-5-5");
        expect(server.keys[0]).toBe("test-key");
    });

    it("reads neither ANTHROPIC_BASE_URL nor ANTHROPIC_API_KEY", async () => {
        const decoy = serve([{ text: "wrong" }]);
        const server = serve([{ text: "hello" }]);
        const saved = {
            url: process.env.ANTHROPIC_BASE_URL,
            key: process.env.ANTHROPIC_API_KEY,
        };
        process.env.ANTHROPIC_BASE_URL = decoy.url;
        process.env.ANTHROPIC_API_KEY = "exported-key";
        try {
            expect(await firstError(server.url)).toBeNull();
        } finally {
            for (const [name, value] of [
                ["ANTHROPIC_BASE_URL", saved.url],
                ["ANTHROPIC_API_KEY", saved.key],
            ] as const) {
                if (value === undefined) {
                    delete process.env[name];
                } else {
                    process.env[name] = value;
                }
            }
        }
        expect(decoy.bodies).toHaveLength(0);
        expect(server.keys).toEqual(["test-key"]);
    });

    it("refuses a redirect, so its key never follows it", async () => {
        const elsewhere = serve([{ text: "followed" }]);
        const server = serve([{ redirect: `${elsewhere.url}/v1/messages` }]);
        const error = await firstError(server.url);
        expect(failureOf(error).class).toBe("network");
        expect(elsewhere.bodies).toHaveLength(0);
    });

    it.each([
        [
            {
                status: 429,
                type: "rate_limit_error",
                message: "slow down",
                headers: { "retry-after": "41" },
            },
            "rate-limit",
            41_000,
        ],
        [
            {
                status: 400,
                type: "invalid_request_error",
                message:
                    "Your credit balance is too low to access the Anthropic API.",
            },
            "usage",
            null,
        ],
        [
            {
                status: 400,
                type: "invalid_request_error",
                message: "bad field",
            },
            "rejected",
            null,
        ],
        [
            {
                status: 401,
                type: "authentication_error",
                message: "invalid x-api-key",
            },
            "rejected",
            null,
        ],
        [
            { status: 529, type: "overloaded_error", message: "Overloaded" },
            "overload",
            null,
        ],
        [{ status: 500, type: "api_error", message: "boom" }, "server", null],
        [
            { midstream: { type: "overloaded_error", message: "Overloaded" } },
            "overload",
            null,
        ],
    ] as const)("classes the wire's %o as %s", async (reply, kind, retry) => {
        const server = serve([reply as Reply]);
        const failure = failureOf(await firstError(server.url));
        expect(failure.class).toBe(kind);
        expect(failure.retryAfterMs).toBe(retry);
    });

    it("takes a server that refuses connections for the network", async () => {
        const server = serve([{ text: "x" }]);
        const url = server.url;
        server.stop();
        expect(failureOf(await firstError(url)).class).toBe("network");
    });
});

describe("keyOf", () => {
    const entry = anthropicEntry("m");
    it("reads the entry's key from env", () => {
        expect(keyOf(entry, { ANTHROPIC_API_KEY: "k" })).toBe("k");
    });
    it("gives null for a key missing or empty", () => {
        expect(keyOf(entry, {})).toBeNull();
        expect(keyOf(entry, { ANTHROPIC_API_KEY: "" })).toBeNull();
    });
    it("gives an empty key to a keyless entry", () => {
        expect(keyOf({ ...entry, key: null }, {})).toBe("");
    });
});

describe("providerOptions", () => {
    it("asks Anthropic models for no thinking, which each takes as its lowest", () => {
        expect(providerOptions(anthropicEntry("claude-sonnet-5-5"))).toEqual({
            anthropic: { thinking: { type: "disabled" } },
        });
    });

    it("asks models that always think for a summary, so a think streams", () => {
        for (const model of ["claude-opus-5-5", "claude-fable-5-1"]) {
            expect(providerOptions(anthropicEntry(model))).toEqual({
                anthropic: {
                    thinking: { type: "adaptive", display: "summarized" },
                },
            });
        }
    });

    it("sends the summary on the wire", async () => {
        const server = serve([{ text: "hello" }]);
        const entry = {
            ...anthropicEntry("claude-opus-5-5"),
            baseUrl: server.url,
        };
        const result = streamText({
            model: languageModel(entry, "test-key"),
            prompt: "hi",
            maxRetries: 0,
            onError: () => {},
            providerOptions: providerOptions(entry),
        });
        for await (const _ of result.fullStream) {
            // Drained.
        }
        expect(server.bodies[0]?.thinking).toMatchObject({
            type: "adaptive",
            display: "summarized",
        });
    });
});
