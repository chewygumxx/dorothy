// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/runtime.test.ts
//
//

// The probe this runtime opens with: the AI SDK under Bun, against a
// stand-in Messages API and a stand-in MCP server, before anything is
// built on it.

import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createMCPClient } from "@ai-sdk/mcp";
import { StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import {
    type JSONSchema7,
    jsonSchema,
    Output,
    stepCountIs,
    streamText,
    tool,
} from "ai";
import { fakeMessages, type Reply } from "./testing.js";

(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const FAKE_MCP = join(import.meta.dir, "fake-mcp.ts");

describe("the AI SDK under Bun", () => {
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
    const model = (url: string) =>
        createAnthropic({ baseURL: `${url}/v1`, apiKey: "test-key" })(
            "claude-sonnet-5-5",
        );

    it("streams a tool loop and its reply, with usage per step", async () => {
        const server = serve([
            { tool: { id: "t1", name: "echo", input: { q: "x" } } },
            {
                text: "hello",
                usage: {
                    input_tokens: 11,
                    output_tokens: 5,
                    cache_read_input_tokens: 7,
                    cache_creation_input_tokens: 3,
                },
            },
        ]);
        const result = streamText({
            model: model(server.url),
            instructions: {
                role: "system",
                content: "persona",
                providerOptions: {
                    anthropic: { cacheControl: { type: "ephemeral" } },
                },
            },
            messages: [{ role: "user", content: "hi" }],
            tools: {
                echo: tool({
                    inputSchema: jsonSchema<{ q: string }>({
                        type: "object",
                        properties: { q: { type: "string" } },
                    }),
                    execute: async ({ q }) => q,
                }),
            },
            stopWhen: stepCountIs(10),
            maxRetries: 0,
            onError: () => {},
        });
        const types: string[] = [];
        for await (const part of result.fullStream) {
            types.push(part.type);
        }
        expect(types).toContain("tool-call");
        expect(types).toContain("tool-result");
        expect(types).toContain("text-delta");
        const steps = await result.steps;
        expect(steps).toHaveLength(2);
        expect(steps[1]?.usage.inputTokenDetails).toEqual({
            noCacheTokens: 11,
            cacheReadTokens: 7,
            cacheWriteTokens: 3,
        });
        expect(
            steps.flatMap((step) => step.response.messages).map((m) => m.role),
        ).toEqual(["assistant", "tool", "assistant"]);
        expect(server.bodies[0]?.system).toEqual([
            {
                type: "text",
                text: "persona",
                cache_control: { type: "ephemeral" },
            },
        ]);
        expect(server.keys[0]).toBe("test-key");
    });

    it("parses structured output against a schema the API enforces", async () => {
        const server = serve([{ text: '{"ok":true}' }]);
        const schema: JSONSchema7 = {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
            additionalProperties: false,
        };
        const result = streamText({
            model: model(server.url),
            instructions: "review",
            prompt: "go",
            output: Output.object({ schema: jsonSchema(schema) }),
            maxRetries: 0,
            onError: () => {},
        });
        for await (const _ of result.fullStream) {
            // Drained, as structuredCall drains it.
        }
        expect(await result.output).toEqual({ ok: true });
        expect(server.bodies[0]?.output_config).toEqual({
            format: { type: "json_schema", schema },
        });
    });

    it("streams an HTTP refusal as an error part with its headers", async () => {
        const server = serve([
            {
                status: 429,
                type: "rate_limit_error",
                message: "slow down",
                headers: { "retry-after": "41" },
            },
        ]);
        const result = streamText({
            model: model(server.url),
            prompt: "hi",
            maxRetries: 0,
            onError: () => {},
        });
        const errors: unknown[] = [];
        for await (const part of result.fullStream) {
            if (part.type === "error") {
                errors.push(part.error);
            }
        }
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            statusCode: 429,
            responseHeaders: { "retry-after": "41" },
        });
    });

    it("streams an abort as an abort part", async () => {
        const server = serve([{ silent: true }]);
        const controller = new AbortController();
        const result = streamText({
            model: model(server.url),
            prompt: "hi",
            maxRetries: 0,
            onError: () => {},
            abortSignal: controller.signal,
        });
        setTimeout(() => controller.abort(), 50);
        const types: string[] = [];
        for await (const part of result.fullStream) {
            types.push(part.type);
        }
        expect(types).toContain("abort");
    });

    it("runs an MCP server over stdio with the environment it is given", async () => {
        const client = await createMCPClient({
            transport: new StdioMCPTransport({
                command: process.execPath,
                args: [FAKE_MCP, "--flag"],
                env: {
                    PATH: process.env.PATH ?? "",
                    XDG_DATA_HOME: "/tmp/probe-data",
                },
                stderr: "ignore",
            }),
        });
        try {
            const tools = await client.tools();
            expect(Object.keys(tools).sort()).toEqual([
                "extra",
                "open",
                "recollect",
                "remember",
                "search",
                "tags",
            ]);
            const execute = tools.search?.execute as unknown as (
                input: unknown,
                options: unknown,
            ) => Promise<{ content: { text: string }[] }>;
            const out = await execute(
                { query: "x" },
                { toolCallId: "1", messages: [] },
            );
            expect(JSON.parse(out.content[0]?.text ?? "")).toEqual({
                tool: "search",
                input: { query: "x" },
                args: ["--flag"],
                data: "/tmp/probe-data",
                key: null,
            });
        } finally {
            await client.close();
        }
    });
});
