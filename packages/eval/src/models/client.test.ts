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
import { draftsSchema } from "../questions/generate.js";
import { type StubReply, stubModels } from "../testing.js";
import { CallCap, failureOf, Models } from "./client.js";
import type { CliConfig, EvalConfig } from "./config.js";
import { fakeCli } from "./testing.js";

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

    it("sums API tokens separately by role across concurrent calls", async () => {
        const { url } = serve(() => ({ json: { n: 3 } }));
        const models = new Models(configOf(url), { env: {} });
        await Promise.all([
            models.complete("answer", ask),
            models.complete("answer", ask),
            models.structured(
                "generate",
                z.object({ n: z.number() }),
                "count",
                ask,
            ),
            models.structured(
                "judge",
                z.object({ n: z.number() }),
                "count",
                ask,
            ),
        ]);
        expect(models.tokens).toEqual({
            answer: { input: 22, output: 14 },
            generate: { input: 11, output: 7 },
            judge: { input: 11, output: 7 },
        });
        const saved = models.tokens;
        await models.complete("answer", ask);
        expect(saved.answer).toEqual({ input: 22, output: 14 });
        expect(models.tokens.answer).toEqual({ input: 33, output: 21 });
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
            "EVAL_KEY is not set: add it with `sops edit secrets.json`",
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

    it("retries by the status, not by what the message says", async () => {
        const { url, requests } = serve(() => ({
            status: 400,
            body: "connection timed out, network socket fetch failed",
        }));
        const models = new Models(configOf(url), { env: {}, retryMs: 1 });
        await expect(models.complete("answer", ask)).rejects.toThrow();
        expect(requests).toHaveLength(1);
    });

    it("retries a request whose connection is lost", async () => {
        const dead = stubModels(() => ({}));
        dead.stop();
        const models = new Models(configOf(dead.url), {
            env: {},
            retryMs: 1,
        });
        await expect(models.complete("answer", ask)).rejects.toThrow();
        expect(models.calls).toBe(3);
    });

    it("retries a timeout twice, then gives up", async () => {
        const { url, requests } = serve(() => ({ delayMs: 500 }));
        const models = new Models(configOf(url), {
            env: {},
            retryMs: 1,
            timeoutMs: 40,
        });
        const error = await models.complete("answer", ask).catch((e) => e);
        expect(error).toBeInstanceOf(Error);
        expect(failureOf(error)).toMatch(/timed out/i);
        expect(requests).toHaveLength(3);
        expect(models.calls).toBe(3);
    });

    it("keeps the failure when --max-calls is reached mid-retry", async () => {
        const { url, requests } = serve(() => ({
            status: 500,
            body: "upstream down for secret-123",
        }));
        const models = new Models(configOf(url, "EVAL_KEY"), {
            env: { EVAL_KEY: "secret-123" },
            maxCalls: 2,
            retryMs: 1,
        });
        const error = await models.complete("answer", ask).catch((e) => e);
        expect(error).toBeInstanceOf(CallCap);
        expect(requests).toHaveLength(2);
        expect(failureOf(error)).toStartWith("reached --max-calls (2)");
        expect(failureOf(error)).toContain("500");
        expect(failureOf(error)).not.toContain("secret-123");
        // The message alone carries the failure: a cause object might
        // hold a key in a property no redaction reads.
        expect(error.cause).toBeUndefined();
    });

    it("says only the cap when it is reached before any failure", async () => {
        const { url } = serve(() => ({ content: "Hi." }));
        const models = new Models(configOf(url), { env: {}, maxCalls: 1 });
        await models.complete("answer", ask);
        const error = await models.complete("answer", ask).catch((e) => e);
        expect(error.message).toBe("reached --max-calls (1)");
    });

    it("asks an endpoint with no key for no Bearer", async () => {
        const { url, requests } = serve(() => ({ content: "Hi." }));
        const models = new Models(configOf(url, null), { env: {} });
        expect((await models.complete("answer", ask)).text).toBe("Hi.");
        expect(requests[0]?.authorization).toBeNull();
    });

    it("does not wait to say the cap is reached", async () => {
        const { url, requests } = serve(() => ({ status: 500 }));
        const models = new Models(configOf(url), {
            env: {},
            maxCalls: 1,
            retryMs: 5000,
        });
        const started = performance.now();
        const error = await models.complete("answer", ask).catch((e) => e);
        expect(error).toBeInstanceOf(CallCap);
        expect(performance.now() - started).toBeLessThan(2000);
        expect(requests).toHaveLength(1);
        expect(error.message).toContain("500");
    });

    it("never spends past --max-calls with callers retrying together", async () => {
        // The first four requests fail, one for each caller; all four
        // wait, then retry, with room for two more calls.
        const { url, requests } = serve((count) =>
            count <= 4 ? { status: 500 } : { content: "Hi." },
        );
        const models = new Models(configOf(url), {
            env: {},
            maxCalls: 6,
            retryMs: 20,
        });
        const settled = await Promise.allSettled(
            Array.from({ length: 4 }, () => models.complete("answer", ask)),
        );
        expect(models.calls).toBe(6);
        expect(requests).toHaveLength(6);
        expect(
            settled.filter((each) => each.status === "fulfilled"),
        ).toHaveLength(2);
        const stopped = settled.filter(
            (each): each is PromiseRejectedResult => each.status === "rejected",
        );
        expect(stopped).toHaveLength(2);
        for (const { reason } of stopped) {
            expect(reason).toBeInstanceOf(CallCap);
            expect(reason.message).toContain("while retrying");
        }
    });

    it("names the variable as configured", async () => {
        // Models takes the name as eval.toml gave it; the config alone
        // decides what a name may be (capitals, digits, underscores).
        const { url } = serve(() => ({ content: "Hi." }));
        const models = new Models(configOf(url, "Eval_Key"), { env: {} });
        await expect(models.complete("answer", ask)).rejects.toThrow(
            "Eval_Key is not set: add it with `sops edit secrets.json`",
        );
    });

    it("survives a thrown value that cannot be made a string", async () => {
        const models = new Models(configOf("http://127.0.0.1:9", "EVAL_KEY"), {
            env: { EVAL_KEY: "secret-123" },
        });
        models.chat("answer");
        const bare = Object.create(null);
        const error = await models
            .call(() => Promise.reject(bare))
            .catch((e) => e);
        expect(error).toBe(bare);
        expect(failureOf(error)).toBe("a value that cannot be printed");
        const throwing = {
            toString() {
                throw new Error("no");
            },
        };
        await expect(models.call(() => Promise.reject(throwing))).rejects.toBe(
            throwing,
        );
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

const routes: CliConfig[] = [
    { via: "claude", model: "claude-haiku-5-5" },
    { via: "codex", model: "gpt-6.1-terra", effort: "medium" },
];
const cliEnv = {
    PATH: "/bin",
    HOME: "/fake",
    CLAUDE_CODE_OAUTH_TOKEN: "test-oauth",
};
const cliModels = (
    config: CliConfig,
    options: Partial<ConstructorParameters<typeof Models>[1]>,
) =>
    new Models(
        { generate: config, answer: config, judge: config },
        { env: cliEnv, retryMs: 1, ...options },
    );

describe.each(routes)("Models through $via", (config) => {
    const reply = (value: unknown, count: number, broken = false) => {
        const fake = fakeCli((request, attempt) => {
            const body =
                broken && attempt < count
                    ? "unreadable private snapshot test-oauth"
                    : JSON.stringify(value);
            if (config.via === "codex") {
                fake.contents.set(`${request.cwd}/reply.txt`, body);
                return {
                    stdout: '{"type":"turn.completed","usage":{"input_tokens":11,"output_tokens":7}}',
                };
            }
            return {
                stdout:
                    broken && attempt < count
                        ? body
                        : JSON.stringify({
                              result: "Hi.",
                              structured_output: value,
                              usage: { input_tokens: 11, output_tokens: 7 },
                          }),
            };
        });
        return fake;
    };

    it("dispatches a completion without an API client", async () => {
        const fake = reply("Hi.", 1);
        const models = cliModels(config, fake);
        expect(await models.complete("answer", ask)).toMatchObject({
            text: config.via === "claude" ? "Hi." : '"Hi."',
            input: 11,
            output: 7,
        });
        expect(models.calls).toBe(1);
    });

    it("sums CLI tokens by role across completion and structured calls", async () => {
        const fake = reply({ n: 3 }, 1);
        const models = cliModels(config, fake);
        await Promise.all([
            models.complete("answer", ask),
            models.complete("answer", ask),
            models.structured(
                "generate",
                z.object({ n: z.number() }),
                "count",
                ask,
            ),
            models.structured(
                "judge",
                z.object({ n: z.number() }),
                "count",
                ask,
            ),
        ]);
        expect(models.tokens).toEqual({
            answer: { input: 22, output: 14 },
            generate: { input: 11, output: 7 },
            judge: { input: 11, output: 7 },
        });
    });

    it("records zero tokens when the CLI gives no usage", async () => {
        const fake = fakeCli((request) => {
            fake.contents.set(`${request.cwd}/reply.txt`, "A reply");
            return {
                stdout: config.via === "claude" ? '{"result":"A reply"}' : "",
            };
        });
        const models = cliModels(config, fake);
        await models.complete("answer", ask);
        expect(models.tokens).toEqual({ answer: { input: 0, output: 0 } });
    });

    it("requests and checks the same structured schema", async () => {
        const fake = reply({ questions: [] }, 1);
        const models = cliModels(config, fake);
        expect(
            await models.structured("generate", draftsSchema, "drafts", ask),
        ).toEqual({ value: { questions: [] }, input: 11, output: 7 });
        const request = fake.requests[0];
        const json =
            config.via === "claude"
                ? request?.args[
                      (request?.args.indexOf("--json-schema") ?? -2) + 1
                  ]
                : fake.contents.get(`${request?.cwd}/schema.json`);
        const schema = JSON.parse(json ?? "null");
        // claude refuses a schema naming its draft by $schema.
        expect(schema).not.toHaveProperty("$schema");
        expect(schema.additionalProperties).toBe(false);
        expect(schema.required).toEqual(["questions"]);
        expect(schema.properties.questions.items.additionalProperties).toBe(
            false,
        );
        expect(schema.properties.questions.items.required).toEqual([
            "question",
            "answer",
            "evidence",
            "older",
        ]);
    });

    it("retries an unreadable reply and spends each attempt", async () => {
        const fake = reply({ n: 3 }, 3, true);
        const models = cliModels(config, fake);
        expect(
            (
                await models.structured(
                    "generate",
                    z.object({ n: z.number() }),
                    "count",
                    ask,
                )
            ).value,
        ).toEqual({ n: 3 });
        expect(models.calls).toBe(3);
        expect(new Set(fake.requests.map((request) => request.cwd)).size).toBe(
            3,
        );
        expect(fake.removed).toHaveLength(3);
        expect(models.tokens).toEqual({ generate: { input: 11, output: 7 } });
    });

    it("does not retry a parsed schema mismatch or expose its value", async () => {
        const fake = reply({ n: "Private snapshot test-oauth" }, 1);
        const models = cliModels(config, fake);
        const error = await models
            .structured("generate", z.object({ n: z.number() }), "count", ask)
            .catch((e) => e);
        expect(error).toBeInstanceOf(UsageError);
        expect(error.message).toBe(
            "the model's reply did not match its schema",
        );
        expect(models.tokens).toEqual({ generate: { input: 11, output: 7 } });
        expect(models.calls).toBe(1);
    });

    it.each(["exit", "timeout"])(
        "retries a %s failure without exposing output",
        async (kind) => {
            const fake = fakeCli(() => {
                return {
                    exitCode: 19,
                    stdout: "private snapshot test-oauth",
                    timedOut: kind === "timeout",
                };
            });
            const models = cliModels(config, fake);
            const error = await models.complete("answer", ask).catch((e) => e);
            expect(models.calls).toBe(3);
            expect(failureOf(error)).toStartWith(
                `${config.via} exited with code`,
            );
            expect(String(error)).not.toContain("snapshot");
            expect(String(error)).not.toContain("test-oauth");
        },
    );

    it.each(["ENOENT", "EACCES", "UNKNOWN"])(
        "does not retry a %s failure to start",
        async (code) => {
            const fake = fakeCli(() => {
                throw Object.assign(new Error("private snapshot test-oauth"), {
                    code,
                });
            });
            const models = cliModels(config, fake);
            const error = await models
                .complete("answer", ask)
                .catch((e: unknown) => e);
            expect(error).toBeInstanceOf(UsageError);
            expect((error as Error).message).toContain(config.via);
            expect((error as Error).message).toContain(
                code === "ENOENT" ? "missing" : "not runnable",
            );
            expect(String(error)).not.toContain("snapshot");
            expect(String(error)).not.toContain("test-oauth");
            expect(models.calls).toBe(1);
            expect(fake.requests).toHaveLength(1);
        },
    );

    it("enforces the cap before running and between retries", async () => {
        const fake = fakeCli(() => ({
            exitCode: 19,
            stdout: "private snapshot test-oauth",
        }));
        const models = cliModels(config, { ...fake, maxCalls: 2 });
        const error = await models.complete("answer", ask).catch((e) => e);
        expect(error).toBeInstanceOf(CallCap);
        expect(error.message).toContain(`${config.via} exited with code 19`);
        expect(fake.requests).toHaveLength(2);
        const capped = cliModels(config, { ...fake, maxCalls: 0 });
        await expect(capped.complete("answer", ask)).rejects.toBeInstanceOf(
            CallCap,
        );
        expect(fake.requests).toHaveLength(2);
    });
});

it("requires Claude OAuth from the supplied environment before spending a call", async () => {
    const fake = fakeCli(() => ({ stdout: "{}" }));
    const models = cliModels(
        { via: "claude", model: "m" },
        { ...fake, env: {} },
    );
    await expect(models.complete("answer", ask)).rejects.toThrow(
        "CLAUDE_CODE_OAUTH_TOKEN is not set",
    );
    expect(models.calls).toBe(0);
    expect(fake.requests).toHaveLength(0);
});
