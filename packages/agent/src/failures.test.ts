// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/agent/src/failures.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    APICallError,
    InvalidPromptError,
    InvalidResponseDataError,
    JSONParseError,
    NoSuchModelError,
    UnsupportedFunctionalityError,
} from "ai";
import { classOf, failureOf, retryAfterMs } from "./failures.js";

const apiError = (
    statusCode: number,
    message: string,
    headers: Record<string, string> = {},
) =>
    new APICallError({
        message,
        url: "u",
        requestBodyValues: {},
        statusCode,
        responseHeaders: headers,
    });

describe("retryAfterMs", () => {
    it("reads seconds", () => {
        expect(retryAfterMs({ "retry-after": "41" })).toBe(41_000);
    });
    it("reads an HTTP date", () => {
        const now = Date.parse("2026-11-01T00:00:00Z");
        expect(
            retryAfterMs(
                { "retry-after": "Sun, 01 Nov 2026 00:00:30 GMT" },
                now,
            ),
        ).toBe(30_000);
    });
    it("gives null for nothing, or nonsense", () => {
        expect(retryAfterMs(undefined)).toBeNull();
        expect(retryAfterMs({})).toBeNull();
        expect(retryAfterMs({ "retry-after": "soon" })).toBeNull();
    });
});

describe("classOf", () => {
    it.each([
        [402, "", "usage"],
        [
            400,
            "Your credit balance is too low to access the Anthropic API.",
            "usage",
        ],
        [403, "You have reached your specified API usage limits.", "usage"],
        [400, "billing problem", "usage"],
        [400, "messages: field required", "rejected"],
        [401, "invalid x-api-key", "rejected"],
        [404, "model not found", "rejected"],
        [429, "slow down", "rate-limit"],
        [529, "Overloaded", "overload"],
        [503, "unavailable", "overload"],
        [500, "boom", "server"],
        [307, "Temporary Redirect", "network"],
        [200, "Failed to process successful response", "network"],
    ] as const)("classes %d %s as %s", (status, message, kind) => {
        expect(classOf(status, message)).toBe(kind);
    });
});

describe("failureOf", () => {
    it("keeps a rate limit's retry-after", () => {
        expect(
            failureOf(apiError(429, "slow down", { "retry-after": "41" })),
        ).toEqual({
            class: "rate-limit",
            message: "slow down",
            retryAfterMs: 41_000,
        });
    });
    it("keeps no retry-after for classes that do not cool down", () => {
        expect(
            failureOf(apiError(500, "boom", { "retry-after": "41" })),
        ).toEqual({
            class: "server",
            message: "boom",
            retryAfterMs: null,
        });
    });
    it("reads a mid-stream error's type when it has no status", () => {
        const error = Object.assign(new Error("Overloaded"), {
            data: { type: "overloaded_error", message: "Overloaded" },
        });
        expect(failureOf(error).class).toBe("overload");
        const limited = Object.assign(new Error("slow"), {
            data: { type: "error", error: { type: "rate_limit_error" } },
        });
        expect(failureOf(limited).class).toBe("rate-limit");
    });
    it("takes a streamed billing error as usage, whatever its status", () => {
        // The provider gives a streamed billing_error a status of 400, and
        // its message names no usage words.
        const error = Object.assign(new Error("Account problem"), {
            statusCode: 400,
            data: { type: "error", error: { type: "billing_error" } },
        });
        expect(failureOf(error).class).toBe("usage");
    });
    it("takes an error with no status for the network", () => {
        expect(failureOf(new TypeError("Unable to connect"))).toEqual({
            class: "network",
            message: "Unable to connect",
            retryAfterMs: null,
        });
    });
    it("takes a connection the SDK could not make for the network", () => {
        const error = new APICallError({
            message: "Cannot connect to API: Unable to connect",
            url: "http://127.0.0.1:1/v1/chat/completions",
            requestBodyValues: {},
            isRetryable: true,
        });
        expect(failureOf(error).class).toBe("network");
    });
    it.each([
        [
            "AI_JSONParseError",
            new JSONParseError({ text: "{not json", cause: null }),
            "server",
        ],
        [
            "AI_InvalidResponseDataError",
            new InvalidResponseDataError({ data: {}, message: "no choices" }),
            "server",
        ],
        [
            "AI_InvalidPromptError",
            new InvalidPromptError({ prompt: "", message: "bad" }),
            "rejected",
        ],
        [
            "AI_UnsupportedFunctionalityError",
            new UnsupportedFunctionalityError({ functionality: "audio" }),
            "rejected",
        ],
        [
            "AI_NoSuchModelError",
            new NoSuchModelError({ modelId: "x", modelType: "languageModel" }),
            "rejected",
        ],
    ] as const)(
        "classes %s, which has no status, by its name",
        (_name, error, kind) => {
            expect(failureOf(error).class).toBe(kind);
        },
    );
    it("takes a thrown non-Error value for the network, by its text", () => {
        expect(failureOf("connection reset")).toEqual({
            class: "network",
            message: "connection reset",
            retryAfterMs: null,
        });
    });
});
