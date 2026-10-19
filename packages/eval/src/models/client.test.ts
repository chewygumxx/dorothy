// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/models/client.test.ts
//
//

import { afterEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { UsageError } from "../errors.js";
import { type StubReply, stubModels } from "../testing.js";
import { CallCap, failureOf, Models } from "./client.js";
import type { EvalConfig } from "./config.js";

let stub: ReturnType<typeof stubModels> | null = null;
afterEach(() => {
    stub?.stop();
    stub = null;
});

const serve = (reply: (count: number) => StubReply) => {
    stub = stubModels((_request, count) => reply(count));
    return stub;
};
const configOf = (url: string, key: string | null = null): EvalConfig => ({
    generate: { baseUrl: url, model: "generate/model", key },
    answer: { baseUrl: url, model: "answer/model", key },
    judge: { baseUrl: url, model: "judge/model", key },
});
const ask = [{ role: "user" as const, content: "Hello?" }];

describe("Models", () => {
    it("completes, with the tokens it used", async () => {
        const { url, requests } = serve(() => ({ content: "Hi." }));
        const models = new Models(configOf(url), { env: {} });
        const done = await models.complete("answer", ask);
        expect(done).toMatchObject({ text: "Hi.", input: 11, output: 7 });
        expect(requests[0]?.path).toBe("/v1/chat/completions");
        expect(requests[0]?.body.model).toBe("answer/model");
        expect(models.calls).toBe(1);
    });

    it("sends the key from its variable", async () => {
        const { url, requests } = serve(() => ({ content: "Hi." }));
        const models = new Models(configOf(url, "EVAL_KEY"), {
            env: { EVAL_KEY: "secret" },
        });
        await models.complete("answer", ask);
        expect(requests[0]?.authorization).toBe("Bearer secret");
    });

    it("names a variable that is not set, and calls nothing", async () => {
        const { url, requests } = serve(() => ({ content: "Hi." }));
        const models = new Models(configOf(url, "EVAL_KEY"), { env: {} });
        await expect(models.complete("answer", ask)).rejects.toThrow(
            "EVAL_KEY is not set: set it with `bunx dotenvx set EVAL_KEY`, then run under `bunx dotenvx run --`",
        );
        expect(requests).toHaveLength(0);
    });

    it("retries a headerless 429 twice", async () => {
        const { url, requests } = serve((count) =>
            count < 3 ? { status: 429 } : { content: "Hi." },
        );
        const models = new Models(configOf(url), { env: {}, retryMs: 1 });
        expect((await models.complete("answer", ask)).text).toBe("Hi.");
        expect(requests).toHaveLength(3);
        expect(models.calls).toBe(3);
    });

    it("gives up after two retries of a server's fault", async () => {
        const { url, requests } = serve(() => ({ status: 500 }));
        const models = new Models(configOf(url), { env: {}, retryMs: 1 });
        const error = await models.complete("answer", ask).catch((e) => e);
        expect(failureOf(error)).toStartWith("500");
        expect(requests).toHaveLength(3);
    });

    it("puts out a key a refusal echoes", async () => {
        const { url } = serve(() => ({
            status: 401,
            body: "bad key secret-123",
        }));
        const models = new Models(configOf(url, "EVAL_KEY"), {
            env: { EVAL_KEY: "secret-123" },
        });
        const error = await models.complete("answer", ask).catch((e) => e);
        expect(failureOf(error)).toStartWith("401");
        expect(failureOf(error)).not.toContain("secret-123");
    });

    it("puts out a key in a thrown value that is no Error", async () => {
        const models = new Models(configOf("http://127.0.0.1:9", "EVAL_KEY"), {
            env: { EVAL_KEY: "secret-123" },
        });
        models.chat("answer");
        const error = await models
            .call(() => Promise.reject("bad key secret-123"))
            .catch((e) => e);
        expect(failureOf(error)).toBe("bad key [key]");
    });

    it("turns LangSmith's tracing off", () => {
        for (const name of [
            "LANGSMITH_TRACING",
            "LANGSMITH_TRACING_V2",
            "LANGCHAIN_TRACING",
            "LANGCHAIN_TRACING_V2",
        ]) {
            expect(process.env[name]).toBe("false");
        }
    });

    it("never retries a request the server refuses", async () => {
        const { url, requests } = serve(() => ({ status: 400 }));
        const models = new Models(configOf(url), { env: {}, retryMs: 1 });
        await expect(models.complete("answer", ask)).rejects.toThrow();
        expect(requests).toHaveLength(1);
    });

    it("stops at --max-calls", async () => {
        const { url, requests } = serve(() => ({ content: "Hi." }));
        const models = new Models(configOf(url), { env: {}, maxCalls: 2 });
        await models.complete("answer", ask);
        await models.complete("answer", ask);
        await expect(models.complete("answer", ask)).rejects.toThrow(CallCap);
        expect(requests).toHaveLength(2);
    });

    it("parses a structured reply against its schema", async () => {
        const { url, requests } = serve(() => ({ json: { n: 3 } }));
        const models = new Models(configOf(url), { env: {} });
        const done = await models.structured(
            "generate",
            z.object({ n: z.number() }),
            "count",
            ask,
        );
        expect(done.value).toEqual({ n: 3 });
        expect(
            (requests[0]?.body.response_format as { type: string } | undefined)
                ?.type,
        ).toBe("json_schema");
    });

    it("refuses a reply that does not match, without retrying it", async () => {
        const { url, requests } = serve(() => ({ json: { n: "three" } }));
        const models = new Models(configOf(url), { env: {}, retryMs: 1 });
        await expect(
            models.structured(
                "generate",
                z.object({ n: z.number() }),
                "count",
                ask,
            ),
        ).rejects.toThrow(UsageError);
        expect(requests).toHaveLength(1);
    });
});
