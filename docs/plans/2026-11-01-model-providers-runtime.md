---
ctime: 2026-11-01
mtime: 2026-11-01
spdx: GPL-3.0-only
title: Model Providers, Part A
description: >-
  Implementation plan for Model Providers' first part: Dorothy's own
  runtime on the Vercel AI SDK 7, on Anthropic's Messages API with an
  API key, one model per role, and the Agent SDK retired.
tags:
  - dorothy
  - plan
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/plans/2026-11-01-model-providers-runtime.md
   -
   -->

# Model Providers, Part A: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dorothy's chat, reviews, compactions and one-shot replies run
on a runtime of her own, the Vercel AI SDK 7, reaching Anthropic's
Messages API on `ANTHROPIC_API_KEY`, with no package depending on the
Agent SDK.

**Architecture:** `@dorothy/core` gains the routing contracts
(`RouteEntry`, `Failure`, `Attempt`), `runRoute`, `Cooldowns`, a `Clock`,
Anthropic's price table and the default one-entry routes. `@dorothy/agent`
rebuilds `Conversation`, `structuredCall`, `runOneShot` and
`dumpRequest` on `streamText`, with a provider factory, a failure
classifier, a stall watchdog and an MCP stdio client for her recall
server. `@dorothy/memory` takes its review and compaction calls apart,
and `@dorothy/cli` hands each caller its role's route. Part B, routing
from `config.toml` and the other provider kinds, has its own plan.

**Tech Stack:** Bun and TypeScript; `ai` 7.0.159, `@ai-sdk/anthropic`
4.0.94, `@ai-sdk/mcp` 2.0.88 (with `@ai-sdk/mcp/mcp-stdio`), `ai/test`'s
`MockLanguageModelV4`; `bun:test`.

**Spec:** [`docs/specs/2026-11-01-model-providers-design.md`](../specs/2026-11-01-model-providers-design.md)

## Global Constraints

- New subsystems stay independent of any model provider's SDK, speaking
  standard protocols, with SDK types at a thin edge: `core` takes no
  SDK; only `agent` imports `ai` or an `@ai-sdk/` package.
- Dependencies, in `packages/agent/package.json` only: `ai` `^7.0.159`,
  `@ai-sdk/anthropic` `^4.0.94`, `@ai-sdk/mcp` `^2.0.88`; `zod` stays, as
  the AI SDK peers on it.
- Every model call sets `maxRetries: 0` and `onError: () => {}`, passes
  its base URL and its key explicitly, and fetches through `noRedirect`:
  no provider package reads `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` or
  any other variable of its own.
- `globalThis.AI_SDK_LOG_WARNINGS = false`, set in `providers.ts`: the
  AI SDK never writes to the console.
- Default models: chat `claude-opus-5-5`, review and compaction
  `claude-sonnet-5-5`, maintenance `claude-haiku-5-5`, each on the
  `anthropic` provider, base URL `https://api.anthropic.com` (Dorothy
  appends `/v1`), key `ANTHROPIC_API_KEY`.
- A label is `<provider>:<model>`, such as `anthropic:claude-opus-5-5`;
  `ready.model`, `turn-end.model` and `StructuredOutcome.model` carry it.
- Her memory tools keep the Agent SDK's names, `mcp__memory__<name>`.
- The recall server's environment is the caller's, less every key a
  route names, every variable ending `_API_KEY` and every
  `CLAUDE_CODE_OAUTH_TOKEN*`.
- Constants: `STALL_MS` 60000, `MAX_STEPS` 10, `DEFAULT_COOLDOWN_MS`
  300000, `CLOSE_GRACE_MS` as `core` has it.
- No test reaches a real provider or reads `secrets.json`; every root,
  key and environment is passed in. Wire tests use `fakeMessages` on
  loopback; behaviour tests use `mockModel` (`ai/test`).
- Tests on temporary XDG roots only:

  ```bash
  t=$(mktemp -d)
  XDG_DATA_HOME=$t/d XDG_CACHE_HOME=$t/c XDG_STATE_HOME=$t/s bun run check
  ```

- Every new file carries the house header, copied from a sibling;
  `bun run lint:header` syncs headers.
- The plan's code is not in biome's layout: run `bun run format` before
  every check; `bun run check` runs `format:check` first.
- `packages/cli/AGENTS.md` and `packages/memory/AGENTS.md` are at their
  150-line budget, the root `AGENTS.md` at 100: a line added means a
  line saved nearby.
- Conventional Commits, scopes the package names; headers at most 50
  characters, body lines at most 72; no em dash; no trailers.

## Review Focus

- A provider that takes the connection and never sends an event: the
  watchdog ends the attempt as `timeout` after `STALL_MS`, so neither a
  chat turn nor a review hangs (Task 7's wire test, Task 9's mock test).
- A user's shell, or Claude Code under `dorothy --claude`, exporting
  `ANTHROPIC_BASE_URL` at a stopped gateway: requests still reach the
  route's own base URL, never the exported one (Task 6).
- Closing the TUI mid-reply: no `error` event after `close()`, and the
  recall server's process is gone (Task 9).
- A resumed chat whose recall server fails to start: chat answers,
  warning once, with no tools offered (Task 9).
- Interrupting during a lookup: the lookup settles as failed, and the
  turn ends `interrupted` with its partial reply (Task 9).

## Departures from the spec

Ruled while planning, each with its cost if wrong:

1. **The stall watchdog is Dorothy's.** The probe found the AI SDK's
   `firstChunkMs` and `chunkMs` start only after a provider's first
   event, so a server that never answers is not caught. `Watchdog`
   aborts an attempt when no stream part has arrived for `STALL_MS`,
   from the request on. It also runs while a tool executes, when no
   part arrives; her tools answer in well under a minute. Cost: one
   small module.
2. **Thinking.** Models that always think, `claude-opus-5-5` and
   `claude-fable-5-1`, are sent `thinking: { type: "adaptive", display:
   "summarized" }`: the API's default display on them is `omitted`,
   which streams nothing during a think, and the provider drops `ping`
   events, so the watchdog would end a long think as a stall; a summary
   streams as reasoning parts and keeps it fed. Every other model is
   sent `{ type: "disabled" }`, which the provider turns into its
   lowest (`between_tools` on Sonnet 5.5). Opus keeps its default
   effort, `medium`; `effort: "low"` would trim her replies too, a
   quality call left to the user. Cost: Opus's thinking tokens.
3. **An interrupted turn keeps its streamed text only** in the session's
   messages, not its complete steps' tool calls. Cost: the model
   forgets an interrupted turn's lookups.
4. **Notes.** `StructuredOutcome.notes` is optional and set only when
   there are notes; memory's forwarding of them is Part B's, as Part A's
   routes have one entry, and so is a structured call's unpriced-model
   notice, as every default model is priced. Cost: none until Part B.
5. **`turn-end.model`** is shown in the header; the transcript does not
   record it in Part A. Cost: a turn's model is not in the transcript.
6. **The chat persona is unchanged**, its pin too: its plumbing sentence
   claims no CLI context. Development mode's plumbing is rewritten and
   gains the route line. Cost: a sentence about details she is not
   given.
7. **Reasons.** A failure on a one-entry route keeps today's reason, the
   failure's message (`timed out after 120s`, `cancelled`); with more
   entries, each is listed. Cost: none.
8. **The one-shot reply and the dump run through `Conversation`**, so
   they send what a chat sends. Cost: a one-shot reply starts a session
   object.
9. **The price table** carries Fable 5.1 beside the three defaults.
   Cost: none.
10. **The probe's MCP check runs a stand-in server**, as `agent` cannot
    launch `cli`; her real recall server is pinned in Task 11, through
    the agent's client, on a temporary root. Cost: a recall server
    failing under the client is found at Task 11, not Task 1.
11. **The roadmap** is revised when Part B merges, as the phase's
    Revising step asks; Part A's report says what is left. Cost: the
    roadmap lags one merge.
12. **Each caller's route** is checked by Task 13's live run (chat on
    `anthropic:claude-opus-5-5`, reviews and compactions on
    `anthropic:claude-sonnet-5-5`), not by a unit test: `run-tui.ts`,
    `reviewAgent` and the hook build their calls inline. Cost: a
    misrouted call is found live, before the merge.

---

## File structure

| File | Responsibility |
| --- | --- |
| `packages/core/src/contracts/model.ts` | Roles, kinds, `RouteEntry`, `Failure`, `Attempt`, `label` |
| `packages/core/src/timers.ts` | Gains `Clock` and `REAL_CLOCK` |
| `packages/core/src/models/prices.ts` | Anthropic's prices; `stepCost` |
| `packages/core/src/models/routes.ts` | `DEFAULT_MODELS`, `anthropicEntry`, `defaultRoutes` |
| `packages/core/src/models/cooldowns.ts` | `Cooldowns`: refusals remembered for the process |
| `packages/core/src/models/fallback.ts` | `runRoute`: attempts in order, notes, deadline |
| `packages/agent/src/testing.ts` | `fakeMessages`, `mockModel`, `manualTimers` for tests |
| `packages/agent/src/fake-mcp.ts` | A stand-in stdio MCP server for tests |
| `packages/agent/src/runtime.test.ts` | The probe: the AI SDK under Bun |
| `packages/agent/src/providers.ts` | `languageModel`, `keyOf`, `providerOptions`, `noRedirect` |
| `packages/agent/src/failures.ts` | `failureOf`, `classOf`, `retryAfterMs` |
| `packages/agent/src/cost.ts` | `stepUsage`, `unpricedNotice` |
| `packages/agent/src/attempt.ts` | `Watchdog`, `STALL_MS`, `secretFailure` |
| `packages/agent/src/structured.ts` | `structuredCall` on `streamText` |
| `packages/agent/src/recall-tools.ts` | `connectRecall`, `recallEnv` |
| `packages/agent/src/turn.ts` | `TurnState`: one turn's reply, calls and usage |
| `packages/agent/src/conversation.ts` | `Conversation`, `conversationSetup` |
| `packages/agent/src/one-shot.ts` | `runOneShot` through `Conversation` |
| `packages/agent/src/capture.ts` | `captureServer`, `dumpRequest` through `Conversation` |
| `packages/agent/src/persona.ts` | Loses the CLI's options; gains `routeLine` |
| `packages/cli/src/models.ts` | `ROUTES` and `COOLDOWNS` for the process |

---

### Task 1: Probe the AI SDK under Bun

This task gates the plan. If any test in Step 5 fails under Bun, stop
and report BLOCKED with the output: do not work around it, and do not
swap in another runtime.

**Files:**

- Modify: `packages/agent/package.json` (dependencies)
- Create: `packages/agent/src/testing.ts`
- Create: `packages/agent/src/fake-mcp.ts`
- Test: `packages/agent/src/runtime.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces, in `testing.ts`, for every later agent test:
  - `type WireUsage = { input_tokens: number; output_tokens: number;
    cache_read_input_tokens?: number; cache_creation_input_tokens?: number }`
  - `type Reply` (see Step 2) and
    `fakeMessages(replies: Reply[]): { url: string; bodies:
    Record<string, unknown>[]; keys: (string | null)[]; stop(): void }`,
    `url` without `/v1`.
  - `mockUsage(noCache?, output?, cacheRead?, cacheWrite?)`,
    `textChunks(text, usage?)`, `toolChunks(id, name, input, usage?)`,
    `type Script = { chunks: unknown[]; hang?: boolean } | Error` and
    `mockModel(scripts: Script[], modelId?): MockLanguageModelV4`.
  - `manualTimers(): Timers & { fire(ms: number): void; pending():
    number[] }`.
- Produces `fake-mcp.ts`, run as `bun fake-mcp.ts [args...]`: tools
  `search`, `open`, `tags`, `remember`, `recollect`, `extra`; every call
  answers one text block, the JSON
  `{ tool, input, args, data, key }` (`data` its `XDG_DATA_HOME`, `key`
  its `ANTHROPIC_API_KEY`, each or null), `isError` true for `extra`.

- [ ] **Step 1: Add the AI SDK beside the Agent SDK**

```bash
cd packages/agent
bun add ai@^7.0.159 @ai-sdk/anthropic@^4.0.94 @ai-sdk/mcp@^2.0.88
cd ../..
```

The Agent SDK stays until Task 11.

- [ ] **Step 2: Write `packages/agent/src/testing.ts`**

Copy the house header from `packages/agent/src/result.ts`, with this
file's path, then:

```ts
// Stand-ins for tests: the Messages API on a loopback port, answering
// each request with the next scripted reply and keeping its body; mock
// models scripted by stream parts; and timers fired by hand.

import type { Timers } from "@dorothy/core";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

export type WireUsage = {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
};

export type Reply =
    | { text: string; usage?: WireUsage }
    | {
          tool: { id: string; name: string; input: unknown };
          usage?: WireUsage;
      }
    | {
          status: number;
          type: string;
          message: string;
          headers?: Record<string, string>;
      }
    | { midstream: { type: string; message: string } }
    | { redirect: string }
    | { silent: true };

const USAGE: WireUsage = { input_tokens: 10, output_tokens: 5 };

const event = (name: string, data: unknown) =>
    `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

const started = (model: unknown, usage: WireUsage) =>
    event("message_start", {
        type: "message_start",
        message: {
            id: "msg",
            type: "message",
            role: "assistant",
            model,
            content: [],
            stop_reason: null,
            usage,
        },
    });

const ended = (reason: string, usage: WireUsage) =>
    event("message_delta", {
        type: "message_delta",
        delta: { stop_reason: reason },
        usage: { output_tokens: usage.output_tokens },
    }) + event("message_stop", { type: "message_stop" });

const block = (start: unknown, delta: unknown) =>
    event("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: start,
    }) +
    event("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta,
    }) +
    event("content_block_stop", { type: "content_block_stop", index: 0 });

const STREAM = { "content-type": "text/event-stream" };

function answer(reply: Reply, model: unknown): Response {
    if ("status" in reply) {
        return Response.json(
            { type: "error", error: { type: reply.type, message: reply.message } },
            { status: reply.status, headers: reply.headers ?? {} },
        );
    }
    if ("redirect" in reply) {
        return new Response(null, {
            status: 307,
            headers: { location: reply.redirect },
        });
    }
    if ("silent" in reply) {
        // Headers, then nothing, until the client gives up.
        return new Response(new ReadableStream({ start() {} }), {
            headers: STREAM,
        });
    }
    const usage = ("usage" in reply ? reply.usage : undefined) ?? USAGE;
    let body = started(model, usage);
    if ("midstream" in reply) {
        body += event("error", { type: "error", error: reply.midstream });
    } else if ("tool" in reply) {
        body +=
            block(
                {
                    type: "tool_use",
                    id: reply.tool.id,
                    name: reply.tool.name,
                    input: {},
                },
                {
                    type: "input_json_delta",
                    partial_json: JSON.stringify(reply.tool.input),
                },
            ) + ended("tool_use", usage);
    } else {
        body +=
            block(
                { type: "text", text: "" },
                { type: "text_delta", text: reply.text },
            ) + ended("end_turn", usage);
    }
    return new Response(body, { headers: STREAM });
}

// Each request takes the next reply; the last repeats. Only the key's
// header is read, and its value is a test's own.
export function fakeMessages(replies: Reply[]): {
    url: string;
    bodies: Record<string, unknown>[];
    keys: (string | null)[];
    stop: () => void;
} {
    const bodies: Record<string, unknown>[] = [];
    const keys: (string | null)[] = [];
    let next = 0;
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        async fetch(request) {
            const body = (await request.json()) as Record<string, unknown>;
            bodies.push(body);
            keys.push(request.headers.get("x-api-key"));
            const reply = replies[Math.min(next, replies.length - 1)];
            next += 1;
            return reply === undefined
                ? new Response("no reply scripted", { status: 500 })
                : answer(reply, body.model);
        },
    });
    return {
        url: `http://127.0.0.1:${server.port}`,
        bodies,
        keys,
        stop: () => {
            server.stop(true);
        },
    };
}

export const mockUsage = (
    noCache = 10,
    output = 5,
    cacheRead = 0,
    cacheWrite = 0,
) => ({
    inputTokens: {
        total: noCache + cacheRead + cacheWrite,
        noCache,
        cacheRead,
        cacheWrite,
    },
    outputTokens: { total: output, text: output, reasoning: 0 },
});

export const textChunks = (text: string, usage = mockUsage()): unknown[] => [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    { type: "finish", usage, finishReason: { unified: "stop", raw: "end_turn" } },
];

export const toolChunks = (
    id: string,
    name: string,
    input: unknown,
    usage = mockUsage(),
): unknown[] => [
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId: id, toolName: name, input: JSON.stringify(input) },
    {
        type: "finish",
        usage,
        finishReason: { unified: "tool-calls", raw: "tool_use" },
    },
];

// chunks, then the end of the stream; with hang, no end until the call
// is aborted. An Error is thrown by the call itself.
export type Script = { chunks: unknown[]; hang?: boolean } | Error;

export function mockModel(
    scripts: Script[],
    modelId = "claude-opus-5-5",
): MockLanguageModelV4 {
    let call = 0;
    return new MockLanguageModelV4({
        provider: "anthropic.messages",
        modelId,
        doStream: async ({ abortSignal }) => {
            const script = scripts[Math.min(call, scripts.length - 1)];
            call += 1;
            if (script === undefined) {
                throw new Error("no script");
            }
            if (script instanceof Error) {
                throw script;
            }
            if (script.hang !== true) {
                return {
                    stream: simulateReadableStream({
                        chunks: script.chunks as never[],
                    }),
                };
            }
            return {
                stream: new ReadableStream({
                    start(controller) {
                        for (const chunk of script.chunks) {
                            controller.enqueue(chunk as never);
                        }
                        abortSignal?.addEventListener("abort", () => {
                            controller.error(abortSignal.reason);
                        });
                    },
                }),
            };
        },
    });
}

// Timers a test fires by duration: fire(60_000) runs every pending
// timer set for that long.
export function manualTimers(): Timers & {
    fire(ms: number): void;
    pending(): number[];
} {
    let id = 0;
    const live = new Map<number, { fn: () => void; ms: number }>();
    return {
        set: (fn, ms) => {
            id += 1;
            live.set(id, { fn, ms });
            return id;
        },
        clear: (handle) => {
            live.delete(handle as number);
        },
        fire: (ms) => {
            for (const [key, timer] of [...live]) {
                if (timer.ms === ms) {
                    live.delete(key);
                    timer.fn();
                }
            }
        },
        pending: () => [...live.values()].map((timer) => timer.ms),
    };
}
```

- [ ] **Step 3: Write `packages/agent/src/fake-mcp.ts`**

House header with this file's path, then:

```ts
// A stand-in MCP server over stdio, for tests: it lists a few tools and
// answers every call with what it was started with, so that a test sees
// the arguments and environment its client gave it.

import { createInterface } from "node:readline";

const TOOLS = ["search", "open", "tags", "remember", "recollect", "extra"];

type Request = {
    id?: number;
    method: string;
    params?: { protocolVersion?: string; name?: string; arguments?: unknown };
};

const send = (message: unknown) => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
};

for await (const line of createInterface({ input: process.stdin })) {
    if (line.trim() === "") {
        continue;
    }
    const request = JSON.parse(line) as Request;
    if (request.id === undefined) {
        continue;
    }
    const { id } = request;
    switch (request.method) {
        case "initialize":
            send({
                jsonrpc: "2.0",
                id,
                result: {
                    protocolVersion: request.params?.protocolVersion,
                    capabilities: { tools: {} },
                    serverInfo: { name: "fake", version: "0" },
                },
            });
            break;
        case "tools/list":
            send({
                jsonrpc: "2.0",
                id,
                result: {
                    tools: TOOLS.map((name) => ({
                        name,
                        inputSchema: { type: "object" },
                    })),
                },
            });
            break;
        case "tools/call":
            send({
                jsonrpc: "2.0",
                id,
                result: {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                tool: request.params?.name,
                                input: request.params?.arguments,
                                args: process.argv.slice(2),
                                data: process.env.XDG_DATA_HOME ?? null,
                                key: process.env.ANTHROPIC_API_KEY ?? null,
                            }),
                        },
                    ],
                    isError: request.params?.name === "extra",
                },
            });
            break;
        default:
            send({
                jsonrpc: "2.0",
                id,
                error: { code: -32601, message: "no such method" },
            });
    }
}
```

- [ ] **Step 4: Write the probe, `packages/agent/src/runtime.test.ts`**

House header with this file's path, then:

```ts
// The probe this runtime opens with: the AI SDK under Bun, against a
// stand-in Messages API and a stand-in MCP server, before anything is
// built on it.

import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createMCPClient } from "@ai-sdk/mcp";
import { StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { jsonSchema, Output, stepCountIs, streamText, tool } from "ai";
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
        const schema = {
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
```

- [ ] **Step 5: Run the probe**

Run: `bun test packages/agent/src/runtime.test.ts`
Expected: 5 pass. Any failure: stop, report BLOCKED with the output.

- [ ] **Step 6: Run the checks and commit**

Run: `bun run format && bun run lint:header && bun run check`
on temporary XDG roots
(Global Constraints).
Expected: all pass.

```bash
git add packages/agent bun.lock
git commit -m "test(agent): Probe the AI SDK under Bun"
```

---

### Task 2: Routing contracts, a clock, prices and default routes

**Files:**

- Create: `packages/core/src/contracts/model.ts`
- Modify: `packages/core/src/timers.ts` (add `Clock`)
- Create: `packages/core/src/models/prices.ts`
- Create: `packages/core/src/models/routes.ts`
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/src/models/prices.test.ts`,
  `packages/core/src/models/routes.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces, all exported from `@dorothy/core`:
  - `ROLES`, `type Role`, `KINDS`, `type Kind`, `type RouteEntry`,
    `type Route`, `type Routes`, `type FailureClass`, `type Failure`,
    `type AttemptResult<T>`, `type Attempt<T>`,
    `label(entry: RouteEntry): string`.
  - `type Clock = { now(): number }`, `REAL_CLOCK`.
  - `type Price`, `ANTHROPIC_PRICES`, `type StepUsage = { noCache:
    number; cacheRead: number; cacheWrite: number; output: number }`,
    `stepCost(entry: RouteEntry, usage: StepUsage): number | null`.
  - `DEFAULT_MODELS: Record<Role, string>`, `ANTHROPIC_API_ROOT`,
    `ANTHROPIC_KEY`, `anthropicEntry(model: string): RouteEntry`,
    `defaultRoutes(): Routes`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/models/prices.test.ts`, house header, then:

```ts
import { describe, expect, it } from "bun:test";
import { anthropicEntry } from "./routes.js";
import { stepCost } from "./prices.js";

const usage = (noCache: number, output = 0, cacheRead = 0, cacheWrite = 0) => ({
    noCache,
    cacheRead,
    cacheWrite,
    output,
});

describe("stepCost", () => {
    it("prices an Anthropic step at its model's rates", () => {
        // Opus 5.5: $4 in, $0.20 cache reads, $5 cache writes, $20 out.
        expect(
            stepCost(
                anthropicEntry("claude-opus-5-5"),
                usage(1_000_000, 1_000_000, 1_000_000, 1_000_000),
            ),
        ).toBeCloseTo(4 + 20 + 0.2 + 5, 10);
    });

    it("prices Haiku 5.5 at its higher rates past 100,000 prompt tokens", () => {
        const haiku = anthropicEntry("claude-haiku-5-5");
        expect(stepCost(haiku, usage(100_000))).toBeCloseTo(0.01, 10);
        expect(stepCost(haiku, usage(100_001))).toBeCloseTo(
            (100_001 * 0.5) / 1_000_000,
            10,
        );
        // Cached tokens count towards the prompt's size.
        expect(stepCost(haiku, usage(1, 0, 100_000))).toBeCloseTo(
            (1 * 0.5 + 100_000 * 0.05) / 1_000_000,
            10,
        );
    });

    it("prices an entry by its own price, cache at its input rate", () => {
        const entry = { ...anthropicEntry("anything"), price: [1, 2] as [number, number] };
        expect(stepCost(entry, usage(1_000_000, 1_000_000, 1_000_000, 1_000_000))).toBeCloseTo(
            1 + 2 + 1 + 1,
            10,
        );
    });

    it("knows no price for an unknown Anthropic model", () => {
        expect(stepCost(anthropicEntry("claude-unknown"), usage(10))).toBeNull();
    });

    it("knows no price for another kind without one", () => {
        const entry = { ...anthropicEntry("m"), kind: "local" as const };
        expect(stepCost(entry, usage(10))).toBeNull();
    });
});
```

`packages/core/src/models/routes.test.ts`, house header, then:

```ts
import { describe, expect, it } from "bun:test";
import { label, ROLES } from "../contracts/model.js";
import { DEFAULT_MODELS, defaultRoutes } from "./routes.js";

describe("defaultRoutes", () => {
    it("gives every role its default model on Anthropic, one entry each", () => {
        const routes = defaultRoutes();
        expect(Object.keys(routes).sort()).toEqual([...ROLES].sort());
        for (const role of ROLES) {
            expect(routes[role]).toEqual([
                {
                    provider: "anthropic",
                    kind: "anthropic",
                    model: DEFAULT_MODELS[role],
                    baseUrl: "https://api.anthropic.com",
                    key: "ANTHROPIC_API_KEY",
                    price: null,
                },
            ]);
        }
    });

    it("chooses the spec's models", () => {
        expect(DEFAULT_MODELS).toEqual({
            chat: "claude-opus-5-5",
            review: "claude-sonnet-5-5",
            compaction: "claude-sonnet-5-5",
            maintenance: "claude-haiku-5-5",
        });
    });

    it("labels an entry by provider and model", () => {
        const [entry] = defaultRoutes().chat;
        if (entry === undefined) {
            throw new Error("no chat entry");
        }
        expect(label(entry)).toBe("anthropic:claude-opus-5-5");
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/core/src/models`
Expected: FAIL, the modules not found.

- [ ] **Step 3: Write `packages/core/src/contracts/model.ts`**

House header with this file's path, then:

```ts
// The models Dorothy's calls may take: each role's route, an ordered
// list of entries, and what one attempt on an entry comes to. Nothing
// here knows a provider's SDK or wire; agent turns its errors into
// Failures, and runRoute decides on them.

export const ROLES = ["chat", "review", "compaction", "maintenance"] as const;
export type Role = (typeof ROLES)[number];

export const KINDS = ["anthropic", "openrouter", "featherless", "local"] as const;
export type Kind = (typeof KINDS)[number];

// One model a role may use, with what reaching it needs.
export type RouteEntry = {
    // The provider it came from, [providers.<name>] in Part B's config.
    provider: string;
    kind: Kind;
    model: string;
    // Always explicit, never an environment variable's.
    baseUrl: string;
    // A secrets.json name, never a value; null for a keyless local server.
    key: string | null;
    // Dollars per million tokens, input and output, where no table has it.
    price: [number, number] | null;
};
export type Route = RouteEntry[];
export type Routes = Record<Role, Route>;

export type FailureClass =
    | "usage"
    | "rate-limit"
    | "overload"
    | "server"
    | "timeout"
    | "network"
    | "rejected"
    | "unparsed"
    | "secret"
    | "cancelled";

export type Failure = {
    class: FailureClass;
    message: string;
    retryAfterMs: number | null;
};

// One attempt on one entry. started: text has streamed or remember has
// run, so no other entry may take the turn over.
export type AttemptResult<T> =
    | { ok: true; value: T; costUsd: number }
    | { ok: false; failure: Failure; started: boolean; costUsd: number };

export type Attempt<T> = (
    entry: RouteEntry,
    signal: AbortSignal,
) => Promise<AttemptResult<T>>;

// An entry as notes and outcomes name it: anthropic:claude-opus-5-5.
export const label = (entry: RouteEntry) => `${entry.provider}:${entry.model}`;
```

- [ ] **Step 4: Add `Clock` to `packages/core/src/timers.ts`**

After `REAL_TIMERS`:

```ts
// Injected so whatever compares times, a cooldown among them, is tested
// without real time.
export type Clock = { now(): number };

export const REAL_CLOCK: Clock = { now: () => Date.now() };
```

- [ ] **Step 5: Write `packages/core/src/models/prices.ts`**

House header with this file's path, then:

```ts
// What a model's tokens cost, in dollars per million.

import type { RouteEntry } from "../contracts/model.js";

export type Price = {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
};

type Priced = Price & { over?: { tokens: number; price: Price } };

// Anthropic's prices, from
// https://platform.claude.com/docs/en/about-claude/pricing on
// 2026-11-01. Cache writes are at the five-minute rate, which Dorothy's
// breakpoints use; cache hits on Opus 5.5 and Sonnet 5.5 are 0.05 of
// input, as the page's footnote says; Haiku 5.5 costs more for prompts
// over 100,000 tokens.
export const ANTHROPIC_PRICES: Readonly<Record<string, Priced>> = {
    "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
    "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    "claude-haiku-5-5": {
        input: 0.1,
        output: 0.5,
        cacheRead: 0.01,
        cacheWrite: 0.125,
        over: {
            tokens: 100_000,
            price: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
        },
    },
};

// One request's tokens: the input the cache did not serve, cache reads
// and writes, and the output.
export type StepUsage = {
    noCache: number;
    cacheRead: number;
    cacheWrite: number;
    output: number;
};

function priceOf(entry: RouteEntry, usage: StepUsage): Price | null {
    if (entry.price !== null) {
        const [input, output] = entry.price;
        return { input, output, cacheRead: input, cacheWrite: input };
    }
    if (entry.kind !== "anthropic") {
        return null;
    }
    const priced = ANTHROPIC_PRICES[entry.model];
    if (priced === undefined) {
        return null;
    }
    const prompt = usage.noCache + usage.cacheRead + usage.cacheWrite;
    return priced.over !== undefined && prompt > priced.over.tokens
        ? priced.over.price
        : priced;
}

// A step's cost, or null when its model has no known price.
export function stepCost(entry: RouteEntry, usage: StepUsage): number | null {
    const price = priceOf(entry, usage);
    if (price === null) {
        return null;
    }
    return (
        (usage.noCache * price.input +
            usage.cacheRead * price.cacheRead +
            usage.cacheWrite * price.cacheWrite +
            usage.output * price.output) /
        1_000_000
    );
}
```

- [ ] **Step 6: Write `packages/core/src/models/routes.ts`**

House header with this file's path, then:

```ts
// Part A's routes: each role's default model on Anthropic's Messages
// API, one entry each, until config.toml routes them.

import { ROLES, type Role, type RouteEntry, type Routes } from "../contracts/model.js";

export const DEFAULT_MODELS: Readonly<Record<Role, string>> = {
    chat: "claude-opus-5-5",
    review: "claude-sonnet-5-5",
    compaction: "claude-sonnet-5-5",
    maintenance: "claude-haiku-5-5",
};

// Written as ANTHROPIC_BASE_URL is, without /v1, which agent appends.
export const ANTHROPIC_API_ROOT = "https://api.anthropic.com";
export const ANTHROPIC_KEY = "ANTHROPIC_API_KEY";

export function anthropicEntry(model: string): RouteEntry {
    return {
        provider: "anthropic",
        kind: "anthropic",
        model,
        baseUrl: ANTHROPIC_API_ROOT,
        key: ANTHROPIC_KEY,
        price: null,
    };
}

export function defaultRoutes(): Routes {
    return Object.fromEntries(
        ROLES.map((role) => [role, [anthropicEntry(DEFAULT_MODELS[role])]]),
    ) as Routes;
}
```

- [ ] **Step 7: Export them from `packages/core/src/index.ts`**

Add, keeping the list sorted by path:

```ts
export * from "./contracts/model.js";
export * from "./models/prices.js";
export * from "./models/routes.js";
```

- [ ] **Step 8: Run the tests**

Run: `bun test packages/core`
Expected: PASS.

- [ ] **Step 9: Commit**

Run `bun run format && bun run lint:header && bun run check`
on temporary XDG roots
first.

```bash
git add packages/core
git commit -m "feat(core): Add routes, prices and a clock"
```

---

### Task 3: Cooldowns and `runRoute`

**Files:**

- Create: `packages/core/src/models/cooldowns.ts`
- Create: `packages/core/src/models/fallback.ts`
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/src/models/cooldowns.test.ts`,
  `packages/core/src/models/fallback.test.ts`

**Interfaces:**

- Consumes: Task 2's `RouteEntry`, `Route`, `Failure`, `Attempt`,
  `label`, `Clock`, `REAL_CLOCK`; `Timers`, `REAL_TIMERS`.
- Produces, exported from `@dorothy/core`:
  - `DEFAULT_COOLDOWN_MS = 300_000`; `class Cooldowns { constructor(clock?:
    Clock); until(entry: RouteEntry): number | null; note(entry:
    RouteEntry, failure: Failure): void }`.
  - `type RouteOutcome<T> = { ok: true; value: T; entry: RouteEntry;
    costUsd: number; notes: string[] } | { ok: false; failure: Failure;
    reason: string; started: boolean; costUsd: number; notes: string[] }`.
  - `type RunRouteOptions = { cooldowns: Cooldowns; signal?: AbortSignal;
    deadlineMs: number | null; timers?: Timers }`.
  - `runRoute<T>(route: Route, attempt: Attempt<T>, options:
    RunRouteOptions): Promise<RouteOutcome<T>>`.
  - `CANCELLED: Failure`, `timedOut(ms: number): Failure`.

An attempt reports `cancelled` whenever the signal it was given fired;
`runRoute` knows which of its two signals fired, the caller's or the
deadline's, and says `cancelled` or `timeout` accordingly.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/models/cooldowns.test.ts`, house header, then:

```ts
import { describe, expect, it } from "bun:test";
import type { Failure } from "../contracts/model.js";
import { Cooldowns, DEFAULT_COOLDOWN_MS } from "./cooldowns.js";
import { anthropicEntry } from "./routes.js";

const clock = (at: number) => ({ now: () => at });
const failure = (kind: Failure["class"], retryAfterMs: number | null = null): Failure => ({
    class: kind,
    message: kind,
    retryAfterMs,
});

describe("Cooldowns", () => {
    const opus = anthropicEntry("claude-opus-5-5");
    const sonnet = anthropicEntry("claude-sonnet-5-5");

    it("cools the whole provider for a usage refusal", () => {
        let now = 1_000;
        const cooldowns = new Cooldowns({ now: () => now });
        cooldowns.note(opus, failure("usage"));
        expect(cooldowns.until(opus)).toBe(1_000 + DEFAULT_COOLDOWN_MS);
        expect(cooldowns.until(sonnet)).toBe(1_000 + DEFAULT_COOLDOWN_MS);
        now = 1_000 + DEFAULT_COOLDOWN_MS;
        expect(cooldowns.until(opus)).toBeNull();
    });

    it("cools only the model for a rate limit, for retry-after", () => {
        const cooldowns = new Cooldowns(clock(0));
        cooldowns.note(opus, failure("rate-limit", 41_000));
        expect(cooldowns.until(opus)).toBe(41_000);
        expect(cooldowns.until(sonnet)).toBeNull();
    });

    it("cools nothing for other failures", () => {
        const cooldowns = new Cooldowns(clock(0));
        for (const kind of ["overload", "server", "timeout", "network", "rejected", "unparsed", "secret", "cancelled"] as const) {
            cooldowns.note(opus, failure(kind, 1_000));
        }
        expect(cooldowns.until(opus)).toBeNull();
    });

    it("takes the later of the provider's and the model's times", () => {
        const cooldowns = new Cooldowns(clock(0));
        cooldowns.note(opus, failure("usage", 10_000));
        cooldowns.note(opus, failure("rate-limit", 20_000));
        expect(cooldowns.until(opus)).toBe(20_000);
        expect(cooldowns.until(sonnet)).toBe(10_000);
    });

    it("sets a cooldown afresh when noted again", () => {
        let now = 0;
        const cooldowns = new Cooldowns({ now: () => now });
        cooldowns.note(opus, failure("rate-limit", 50_000));
        now = 40_000;
        cooldowns.note(opus, failure("rate-limit", 5_000));
        expect(cooldowns.until(opus)).toBe(45_000);
    });
});
```

`packages/core/src/models/fallback.test.ts`, house header, then:

```ts
import { describe, expect, it } from "bun:test";
import type { AttemptResult, Failure, RouteEntry } from "../contracts/model.js";
import type { Timers } from "../timers.js";
import { Cooldowns } from "./cooldowns.js";
import { runRoute } from "./fallback.js";
import { anthropicEntry } from "./routes.js";

const A = anthropicEntry("model-a");
const B = { ...anthropicEntry("model-b"), provider: "other" };
const C = { ...anthropicEntry("model-c"), provider: "third" };

const fail = (kind: Failure["class"], started = false, costUsd = 0, retryAfterMs: number | null = null): AttemptResult<string> => ({
    ok: false,
    failure: { class: kind, message: `${kind} happened`, retryAfterMs },
    started,
    costUsd,
});
const win = (value: string, costUsd = 0): AttemptResult<string> => ({ ok: true, value, costUsd });

// Answers per entry, in turn; records the entries tried.
function scripted(answers: Record<string, AttemptResult<string>[]>) {
    const tried: string[] = [];
    const attempt = async (entry: RouteEntry, _signal: AbortSignal) => {
        tried.push(entry.model);
        const queue = answers[entry.model] ?? [];
        return queue.shift() ?? fail("server");
    };
    return { tried, attempt };
}

const clockAt = (at: number) => ({ now: () => at });

describe("runRoute", () => {
    it("answers from the first entry that succeeds", async () => {
        const { tried, attempt } = scripted({ "model-a": [win("a", 0.5)] });
        const outcome = await runRoute([A, B], attempt, { cooldowns: new Cooldowns(), deadlineMs: null });
        expect(outcome).toEqual({ ok: true, value: "a", entry: A, costUsd: 0.5, notes: [] });
        expect(tried).toEqual(["model-a"]);
    });

    it("moves to the next entry on a failure, noting it and summing costs", async () => {
        const { tried, attempt } = scripted({
            "model-a": [fail("rate-limit", false, 0.1, 41_000)],
            "model-b": [win("b", 0.2)],
        });
        const outcome = await runRoute([A, B], attempt, { cooldowns: new Cooldowns(clockAt(0)), deadlineMs: null });
        expect(tried).toEqual(["model-a", "model-b"]);
        expect(outcome.ok).toBe(true);
        expect(outcome.costUsd).toBeCloseTo(0.3, 10);
        expect(outcome.notes).toEqual([
            "anthropic:model-a refused (rate-limit: rate-limit happened, retry in 41s); answering with other:model-b",
        ]);
    });

    it("stops after a started attempt fails", async () => {
        const { tried, attempt } = scripted({ "model-a": [fail("server", true)] });
        const outcome = await runRoute([A, B], attempt, { cooldowns: new Cooldowns(), deadlineMs: null });
        expect(tried).toEqual(["model-a"]);
        expect(outcome).toMatchObject({ ok: false, started: true, reason: "server happened" });
    });

    it("stops when the caller cancels, as cancelled", async () => {
        const controller = new AbortController();
        const attempt = async () => {
            controller.abort();
            return fail("cancelled");
        };
        const outcome = await runRoute([A, B], attempt, { cooldowns: new Cooldowns(), signal: controller.signal, deadlineMs: null });
        expect(outcome).toMatchObject({ ok: false, failure: { class: "cancelled" }, reason: "cancelled" });
    });

    it("tries nothing when the caller has already cancelled", async () => {
        const controller = new AbortController();
        controller.abort();
        const { tried, attempt } = scripted({});
        const outcome = await runRoute([A], attempt, { cooldowns: new Cooldowns(), signal: controller.signal, deadlineMs: null });
        expect(tried).toEqual([]);
        expect(outcome).toMatchObject({ ok: false, reason: "cancelled" });
    });

    it("ends at the deadline as a timeout, trying no later entry", async () => {
        let fire = () => {};
        const timers: Timers = {
            set: (fn) => {
                fire = fn;
                return 1;
            },
            clear: () => {},
        };
        const tried: string[] = [];
        const attempt = async (entry: RouteEntry, signal: AbortSignal) => {
            tried.push(entry.model);
            fire();
            expect(signal.aborted).toBe(true);
            return fail("cancelled");
        };
        const outcome = await runRoute([A, B], attempt, { cooldowns: new Cooldowns(), deadlineMs: 120_000, timers });
        expect(tried).toEqual(["model-a"]);
        expect(outcome).toMatchObject({ ok: false, failure: { class: "timeout" }, reason: "timed out after 120s" });
    });

    it("lists every entry's failure when all fail", async () => {
        const { attempt } = scripted({ "model-a": [fail("overload")], "model-b": [fail("rejected")] });
        const outcome = await runRoute([A, B], attempt, { cooldowns: new Cooldowns(), deadlineMs: null });
        expect(outcome).toMatchObject({
            ok: false,
            reason: "anthropic:model-a: overload: overload happened; other:model-b: rejected: rejected happened",
        });
    });

    it("skips an entry in cooldown, saying so", async () => {
        const cooldowns = new Cooldowns(clockAt(0));
        cooldowns.note(A, { class: "usage", message: "spent", retryAfterMs: 60_000 });
        const { tried, attempt } = scripted({ "model-b": [win("b")] });
        const outcome = await runRoute([A, B], attempt, { cooldowns, deadlineMs: null });
        expect(tried).toEqual(["model-b"]);
        expect(outcome.notes).toHaveLength(1);
        expect(outcome.notes[0]).toMatch(/^anthropic:model-a in cooldown until \d\d:\d\d; answering with other:model-b$/);
    });

    it("tries only the soonest entry when every entry is in cooldown", async () => {
        const cooldowns = new Cooldowns(clockAt(0));
        cooldowns.note(A, { class: "usage", message: "spent", retryAfterMs: 90_000 });
        cooldowns.note(B, { class: "usage", message: "spent", retryAfterMs: 30_000 });
        cooldowns.note(C, { class: "usage", message: "spent", retryAfterMs: 60_000 });
        const { tried, attempt } = scripted({ "model-b": [fail("usage")] });
        const outcome = await runRoute([A, B, C], attempt, { cooldowns, deadlineMs: null });
        expect(tried).toEqual(["model-b"]);
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
            expect(outcome.reason).toMatch(/^anthropic:model-a: in cooldown until \d\d:\d\d; third:model-c: in cooldown until \d\d:\d\d; other:model-b: usage: usage happened$/);
        }
    });

    it("notes a usage refusal as a cooldown for the next call", async () => {
        const cooldowns = new Cooldowns(clockAt(0));
        const { attempt } = scripted({ "model-a": [fail("usage")], "model-b": [win("b"), win("b")] });
        await runRoute([A, B], attempt, { cooldowns, deadlineMs: null });
        expect(cooldowns.until(A)).not.toBeNull();
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/core/src/models`
Expected: FAIL, `cooldowns.js` and `fallback.js` not found.

- [ ] **Step 3: Write `packages/core/src/models/cooldowns.ts`**

House header with this file's path, then:

```ts
// Refusals for usage, remembered for the process: a provider out of
// credit, or a model rate-limited on it, is skipped until its time is
// up. One instance per process, shared by every call, so a refusal one
// call meets is skipped by the next.

import { type Failure, label, type RouteEntry } from "../contracts/model.js";
import { type Clock, REAL_CLOCK } from "../timers.js";

export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

export class Cooldowns {
    readonly #clock: Clock;
    // By provider name, and by label: the label holds a colon, the
    // provider's name never does, so the two never collide.
    readonly #until = new Map<string, number>();

    constructor(clock: Clock = REAL_CLOCK) {
        this.#clock = clock;
    }

    // When entry may be tried again, or null if it may be now.
    until(entry: RouteEntry): number | null {
        const now = this.#clock.now();
        const times = [this.#until.get(entry.provider), this.#until.get(label(entry))].filter(
            (time): time is number => time !== undefined && time > now,
        );
        return times.length === 0 ? null : Math.max(...times);
    }

    // usage cools the provider, rate-limit the provider's model; nothing
    // else cools down.
    note(entry: RouteEntry, failure: Failure): void {
        const key =
            failure.class === "usage"
                ? entry.provider
                : failure.class === "rate-limit"
                  ? label(entry)
                  : null;
        if (key !== null) {
            this.#until.set(key, this.#clock.now() + (failure.retryAfterMs ?? DEFAULT_COOLDOWN_MS));
        }
    }
}
```

- [ ] **Step 4: Write `packages/core/src/models/fallback.ts`**

House header with this file's path, then:

```ts
// A call on a route: its entries in order, skipping those in cooldown,
// until one answers. It decides on failures and never reads HTTP; agent
// turns a provider's errors into Failures.

import { type Attempt, type Failure, label, type Route, type RouteEntry } from "../contracts/model.js";
import { REAL_TIMERS, type Timers } from "../timers.js";
import type { Cooldowns } from "./cooldowns.js";

export type RouteOutcome<T> =
    | { ok: true; value: T; entry: RouteEntry; costUsd: number; notes: string[] }
    | {
          ok: false;
          failure: Failure;
          reason: string;
          started: boolean;
          costUsd: number;
          notes: string[];
      };

export type RunRouteOptions = {
    cooldowns: Cooldowns;
    // The caller's: an interrupt or a cancelled review.
    signal?: AbortSignal;
    // The whole call's time, its attempts' together; null for none, as
    // in chat, where a stall ends an attempt instead.
    deadlineMs: number | null;
    timers?: Timers;
};

export const CANCELLED: Failure = { class: "cancelled", message: "cancelled", retryAfterMs: null };

export const timedOut = (ms: number): Failure => ({
    class: "timeout",
    message: `timed out after ${ms / 1000}s`,
    retryAfterMs: null,
});

const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

const wait = (ms: number) =>
    ms >= 60_000 ? `${Math.ceil(ms / 60_000)}m` : `${Math.ceil(ms / 1000)}s`;

const describe = (failure: Failure) =>
    `${failure.class}: ${failure.message}${
        failure.retryAfterMs === null ? "" : `, retry in ${wait(failure.retryAfterMs)}`
    }`;

// The entries to try: those not in cooldown, in order; if every entry
// is, the one whose cooldown ends first.
function plan(route: Route, cooldowns: Cooldowns): { order: RouteEntry[]; cooling: [RouteEntry, number][] } {
    const cooling: [RouteEntry, number][] = [];
    const free: RouteEntry[] = [];
    for (const entry of route) {
        const until = cooldowns.until(entry);
        if (until === null) {
            free.push(entry);
        } else {
            cooling.push([entry, until]);
        }
    }
    if (free.length > 0 || cooling.length === 0) {
        return { order: free, cooling };
    }
    const soonest = cooling.reduce((a, b) => (b[1] < a[1] ? b : a));
    return { order: [soonest[0]], cooling: cooling.filter((pair) => pair !== soonest) };
}

export async function runRoute<T>(
    route: Route,
    attempt: Attempt<T>,
    { cooldowns, signal, deadlineMs, timers = REAL_TIMERS }: RunRouteOptions,
): Promise<RouteOutcome<T>> {
    const notes: string[] = [];
    const { order, cooling } = plan(route, cooldowns);
    const failures = cooling.map(([entry, until]) => `${label(entry)}: in cooldown until ${hhmm(until)}`);
    if (cooling.length > 0 && order[0] !== undefined) {
        notes.push(
            `${cooling.map(([entry, until]) => `${label(entry)} in cooldown until ${hhmm(until)}`).join(", ")}; answering with ${label(order[0])}`,
        );
    }
    const deadline = new AbortController();
    const timer = deadlineMs === null ? null : timers.set(() => deadline.abort(), deadlineMs);
    let costUsd = 0;
    let last: Failure = { class: "rejected", message: "the route has no entry", retryAfterMs: null };
    let started = false;
    try {
        for (const [index, entry] of order.entries()) {
            if (signal?.aborted) {
                last = CANCELLED;
                break;
            }
            const result = await attempt(
                entry,
                signal === undefined ? deadline.signal : AbortSignal.any([deadline.signal, signal]),
            );
            costUsd += result.costUsd;
            if (result.ok) {
                return { ok: true, value: result.value, entry, costUsd, notes };
            }
            // The attempt saw one signal; which of the two fired says why.
            const failure = signal?.aborted
                ? CANCELLED
                : deadline.signal.aborted && deadlineMs !== null
                  ? timedOut(deadlineMs)
                  : result.failure;
            cooldowns.note(entry, failure);
            failures.push(`${label(entry)}: ${describe(failure)}`);
            last = failure;
            started = result.started;
            const next = order[index + 1];
            if (
                started ||
                failure.class === "cancelled" ||
                deadline.signal.aborted ||
                next === undefined
            ) {
                break;
            }
            notes.push(`${label(entry)} refused (${describe(failure)}); answering with ${label(next)}`);
        }
    } finally {
        if (timer !== null) {
            timers.clear(timer);
        }
    }
    // One failure keeps its own words, as a one-entry route always has.
    const reason =
        last.class === "cancelled"
            ? CANCELLED.message
            : failures.length === 1
              ? last.message
              : failures.join("; ");
    return { ok: false, failure: last, reason, started, costUsd, notes };
}
```

- [ ] **Step 5: Export them from `packages/core/src/index.ts`**

```ts
export * from "./models/cooldowns.js";
export * from "./models/fallback.js";
```

- [ ] **Step 6: Run the tests**

Run: `bun test packages/core/src/models`
Expected: PASS.

- [ ] **Step 7: Commit**

Run `bun run format && bun run lint:header && bun run check`
on temporary XDG roots
first.

```bash
git add packages/core
git commit -m "feat(core): Add cooldowns and runRoute"
```

---

### Task 4: `ready` names its session id `sessionId`; `turn-end` its model

A rename across packages, made while the Agent SDK still runs chat, so
that Task 9's `Conversation` lands on the new shape. The transcript's
`SessionEvent.sdkSessionId` keeps its name: transcripts on disk carry
it.

**Files:**

- Modify: `packages/core/src/contracts/session.ts:39` and the
  `turn-end` member
- Modify: `packages/agent/src/conversation.ts:331`
- Modify: `packages/memory/src/memory/record.ts:61`,
  `packages/memory/src/memory/record.fixture.ts`
- Modify: `packages/tui/src/state.ts`, `packages/tui/src/Header.tsx`,
  `packages/tui/src/App.tsx:321`
- Test: every test that builds a `ready` event or reads the TUI state's
  session id (find them with `grep -rn 'type: "ready"' packages/*/src`
  and `grep -rn sdkSessionId packages/tui/src`)

**Interfaces:**

- Produces: `{ type: "ready"; model: string; sessionId: string }`;
  `turn-end` gains `model?: string`; `ChatState.sessionId: string |
  null`; `HeaderProps.sessionId`.

- [ ] **Step 1: Change the contract, `packages/core/src/contracts/session.ts`**

```ts
    | { type: "ready"; model: string; sessionId: string }
```

and in the `turn-end` member, after `contextTokens?: number;`:

```ts
          // The <provider>:<model> that answered, where the session says.
          model?: string;
```

- [ ] **Step 2: Follow it through**

- `packages/agent/src/conversation.ts:331`: `sessionId: message.session_id,`
- `packages/memory/src/memory/record.ts:61`:
  `sdkSessionId: event.sessionId,`
- `packages/memory/src/memory/record.fixture.ts`: the two emitted `ready`
  events take `sessionId: "sdk-1"` and `sessionId: "sdk-2"`; the
  expected transcript records keep `sdkSessionId: "sdk-1"` and
  `"sdk-2"`.
- `packages/tui/src/state.ts`: the field `sdkSessionId` becomes
  `sessionId` (type, initial `null`, the reset at line 446); the `ready`
  case sets `sessionId: event.sessionId`; the `turn-end` case adds
  `...(event.model === undefined ? {} : { model: event.model }),` to the
  state it returns, so the header names the model that answered.
- `packages/tui/src/Header.tsx`: the prop `sdkSessionId` becomes
  `sessionId`, and its label `session ${sessionId ? shortId(sessionId) : "…"}`
  in place of `sdk …`.
- `packages/tui/src/App.tsx:321`: `sessionId={state.sessionId}`.

- [ ] **Step 3: Update the tests**

Two a search misses: the multi-line `ready` in
`packages/memory/src/memory/open.test.ts` (around line 207), found by
its `type` line alone, and the header's expected `"sdk 3f2a…c91"` in
`packages/tui/src/components.test.tsx:50`, which becomes `"session
3f2a…c91"`.

In every test, a `ready` event's `sdkSessionId:` becomes `sessionId:`,
and the TUI state's and header's likewise; a transcript record's
(`kind: "session"`) `sdkSessionId` stays. A header test expecting
`sdk …` expects `session …`. Add to `packages/tui/src/state.test.ts`:

```ts
it("names the model a turn-end says answered", () => {
    const state = run(
        initialState([]),
        event({ type: "ready", model: "anthropic:a", sessionId: "s" }),
        event({
            type: "turn-end",
            reply: "hi",
            interrupted: false,
            stats,
            model: "anthropic:b",
        }),
    );
    expect(state.model).toBe("anthropic:b");
    expect(state.sessionId).toBe("s");
});
```

`run`, `event` and `stats` are the file's own helpers.

- [ ] **Step 4: Run the checks**

Run: `bun run format && bun run check` on temporary XDG roots.
Expected: PASS, and `grep -rn sdkSessionId packages/*/src` lists only
the transcript's `SessionEvent`, its writers in `memory` and tests
reading transcript records.

- [ ] **Step 5: Commit**

```bash
git add packages
git commit -m "refactor(core): Name ready's session id sessionId"
```

---

### Task 5: Memory takes its review and compaction calls apart

**Files:**

- Modify: `packages/memory/src/memory/open.ts` (`OpenMemoryOptions`,
  `openMemory`, its `startService` and `chatCompaction` calls)
- Modify: `packages/memory/src/compaction/session.ts:64-71` (`streams`)
- Modify: `packages/cli/src/run-tui.ts:36`
- Test: `packages/memory/src/memory/open*.test.ts`,
  `packages/memory/src/compaction/session.test.ts` (or the file testing
  `Compaction`'s queued interrupt)

**Interfaces:**

- Produces: `OpenMemoryOptions.calls: { review: StructuredCall;
  compaction: StructuredCall }` in place of `call`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

In `packages/memory/src/memory/open-compaction.test.ts`, the first test
that compacts: pass `calls: { review: wrong("review"), compaction: call }`
in place of `call`, with, at the top of the file:

```ts
// A call that says so if anything but its role reaches it; the test
// asserts no such reason is ever warned of or logged.
const wrong =
    (role: string): StructuredCall =>
    async (request) => ({
        ok: false,
        reason: request.what === role ? "not under test" : `${request.what} reached the ${role} call`,
        costUsd: 0,
    });
```

and, where it reviews (`open.test.ts`'s review tests, or any that waits
for a note), `calls: { review: call, compaction: wrong("compaction") }`.

For `streams`, in
`packages/memory/src/compaction/session-interrupt.test.ts`, the test
"interrupts a held message sent on after a failed compaction" ends:

```ts
        h.sessions[0]?.emit({
            type: "sdk",
            message: { type: "stream_event", event: { type: "message_start" } },
        });
        // A raw part alone is not the reply.
        expect(h.sessions[0]?.interrupts).toBe(0);
        h.sessions[0]?.emit({ type: "delta", text: "x" });
        expect(h.sessions[0]?.interrupts).toBe(1);
    });
```

and in "interrupts nothing after a held message that couldn't be sent",
the emitted `sdk` event becomes `{ type: "delta", text: "x" }`, its
expectation unchanged.

- [ ] **Step 2: Run them to see them fail**

Run:

```bash
bun test packages/memory/src/memory packages/memory/src/compaction
```

Expected: FAIL: `calls` is not an option yet; the sdk event still counts.

- [ ] **Step 3: Split the call in `open.ts`**

In `OpenMemoryOptions`, replace `call: StructuredCall;` with:

```ts
    // Each background job's model call: reviews in the service, the
    // chat's own compactions.
    calls: { review: StructuredCall; compaction: StructuredCall };
```

In `openMemory`, destructure `calls` for `call`, and pass
`call: calls.review` to `startService` and `call: calls.compaction` to
`chatCompaction`. Any other use of `call` in `openMemory` takes the
call its job is: a review's `calls.review`, a compaction's
`calls.compaction`.

- [ ] **Step 4: Drop the sdk clause from `streams`**

```ts
// The reply to a message sent has started: its text, a lookup or a
// remember.
const streams = (event: ConversationEvent) =>
    event.type === "delta" || event.type === "lookup" || event.type === "remember";
```

- [ ] **Step 5: Keep the TUI building**

In `packages/cli/src/run-tui.ts`, replace `call: structuredCall(),` with:

```ts
        calls: { review: structuredCall(), compaction: structuredCall() },
```

Task 11 gives each its route.

- [ ] **Step 6: Update the remaining tests**

Every `openMemory({ ..., call, ... })` in tests becomes
`calls: { review: call, compaction: call }`, unless Step 1 made it
specific.

- [ ] **Step 7: Run the checks and commit**

Run: `bun run format && bun run check` on temporary XDG roots.
Expected: PASS.

```bash
git add packages/memory packages/cli
git commit -m "refactor(memory): Split review from compaction"
```

---

### Task 6: Providers, failures and cost in the agent

**Files:**

- Create: `packages/agent/src/providers.ts`
- Create: `packages/agent/src/failures.ts`
- Create: `packages/agent/src/cost.ts`
- Test: `packages/agent/src/providers.test.ts`,
  `packages/agent/src/failures.test.ts`, `packages/agent/src/cost.test.ts`

**Interfaces:**

- Consumes: Task 1's `fakeMessages`; Task 2's `RouteEntry`, `Failure`,
  `FailureClass`, `StepUsage`, `label`, `anthropicEntry`.
- Produces:
  - `providers.ts`: `noRedirect: typeof fetch`; `type ModelFactory =
    (entry: RouteEntry, key: string) => LanguageModel`; `languageModel:
    ModelFactory`; `keyOf(entry: RouteEntry, env: Env): string | null`
    (`""` for a keyless entry, null for a missing key);
    `providerOptions(entry: RouteEntry)`.
  - `failures.ts`: `retryAfterMs(headers, now?): number | null`,
    `classOf(status: number, message: string): FailureClass`,
    `failureOf(error: unknown, now?): Failure`.
  - `cost.ts`: `stepUsage(usage: LanguageModelUsage): StepUsage`,
    `unpricedNotice(entry: RouteEntry): string | null`.

- [ ] **Step 1: Write the failing tests**

`packages/agent/src/failures.test.ts`, house header, then:

```ts
import { describe, expect, it } from "bun:test";
import { APICallError } from "ai";
import { classOf, failureOf, retryAfterMs } from "./failures.js";

const apiError = (statusCode: number, message: string, headers: Record<string, string> = {}) =>
    new APICallError({ message, url: "u", requestBodyValues: {}, statusCode, responseHeaders: headers });

describe("retryAfterMs", () => {
    it("reads seconds", () => {
        expect(retryAfterMs({ "retry-after": "41" })).toBe(41_000);
    });
    it("reads an HTTP date", () => {
        const now = Date.parse("2026-11-01T00:00:00Z");
        expect(retryAfterMs({ "retry-after": "Sun, 01 Nov 2026 00:00:30 GMT" }, now)).toBe(30_000);
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
        [400, "Your credit balance is too low to access the Anthropic API.", "usage"],
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
        expect(failureOf(apiError(429, "slow down", { "retry-after": "41" }))).toEqual({
            class: "rate-limit",
            message: "slow down",
            retryAfterMs: 41_000,
        });
    });
    it("keeps no retry-after for classes that do not cool down", () => {
        expect(failureOf(apiError(500, "boom", { "retry-after": "41" }))).toEqual({
            class: "server",
            message: "boom",
            retryAfterMs: null,
        });
    });
    it("reads a mid-stream error's type when it has no status", () => {
        const error = Object.assign(new Error("Overloaded"), { data: { type: "overloaded_error", message: "Overloaded" } });
        expect(failureOf(error).class).toBe("overload");
        const limited = Object.assign(new Error("slow"), { data: { type: "error", error: { type: "rate_limit_error" } } });
        expect(failureOf(limited).class).toBe("rate-limit");
    });
    it("takes an error with no status for the network", () => {
        expect(failureOf(new TypeError("Unable to connect"))).toEqual({
            class: "network",
            message: "Unable to connect",
            retryAfterMs: null,
        });
    });
});
```

`packages/agent/src/cost.test.ts`, house header, then:

```ts
import { describe, expect, it } from "bun:test";
import { anthropicEntry } from "@dorothy/core";
import { stepUsage, unpricedNotice } from "./cost.js";

describe("stepUsage", () => {
    it("takes the uncached input, cache reads and writes, and output", () => {
        expect(
            stepUsage({
                inputTokens: 21,
                inputTokenDetails: { noCacheTokens: 11, cacheReadTokens: 7, cacheWriteTokens: 3 },
                outputTokens: 5,
                outputTokenDetails: {},
                totalTokens: 26,
            } as never),
        ).toEqual({ noCache: 11, cacheRead: 7, cacheWrite: 3, output: 5 });
    });
    it("counts missing details as uncached input", () => {
        expect(stepUsage({ inputTokens: 9, outputTokens: 2 } as never)).toEqual({
            noCache: 9,
            cacheRead: 0,
            cacheWrite: 0,
            output: 2,
        });
    });
});

describe("unpricedNotice", () => {
    it("warns once a process per model", () => {
        const entry = anthropicEntry("claude-unpriced-test");
        expect(unpricedNotice(entry)).toBe(
            "no price is known for anthropic:claude-unpriced-test; its cost shows as $0",
        );
        expect(unpricedNotice(entry)).toBeNull();
    });
});
```

`packages/agent/src/providers.test.ts`, house header, then:

```ts
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
const entryAt = (url: string) => ({ ...anthropicEntry("claude-haiku-5-5"), baseUrl: url });

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
        const saved = { url: process.env.ANTHROPIC_BASE_URL, key: process.env.ANTHROPIC_API_KEY };
        process.env.ANTHROPIC_BASE_URL = decoy.url;
        process.env.ANTHROPIC_API_KEY = "exported-key";
        try {
            expect(await firstError(server.url)).toBeNull();
        } finally {
            for (const [name, value] of [["ANTHROPIC_BASE_URL", saved.url], ["ANTHROPIC_API_KEY", saved.key]] as const) {
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
        [{ status: 429, type: "rate_limit_error", message: "slow down", headers: { "retry-after": "41" } }, "rate-limit", 41_000],
        [{ status: 400, type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." }, "usage", null],
        [{ status: 400, type: "invalid_request_error", message: "bad field" }, "rejected", null],
        [{ status: 401, type: "authentication_error", message: "invalid x-api-key" }, "rejected", null],
        [{ status: 529, type: "overloaded_error", message: "Overloaded" }, "overload", null],
        [{ status: 500, type: "api_error", message: "boom" }, "server", null],
        [{ midstream: { type: "overloaded_error", message: "Overloaded" } }, "overload", null],
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
                anthropic: { thinking: { type: "adaptive", display: "summarized" } },
            });
        }
    });

    it("sends the summary on the wire", async () => {
        const server = serve([{ text: "hello" }]);
        const entry = { ...anthropicEntry("claude-opus-5-5"), baseUrl: server.url };
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
        expect(server.bodies[0]?.thinking).toMatchObject({ type: "adaptive", display: "summarized" });
    });
});
```

If the provider writes the display under another field on the wire,
read `@ai-sdk/anthropic`'s request builder and assert what it sends;
the summary must reach the request.

- [ ] **Step 2: Run them to see them fail**

Run:

```bash
bun test packages/agent/src/failures.test.ts packages/agent/src/cost.test.ts packages/agent/src/providers.test.ts
```

Expected: FAIL, the modules not found.

- [ ] **Step 3: Write `packages/agent/src/providers.ts`**

House header with this file's path, then:

```ts
// The AI SDK's model for a route entry. Every provider is given its base
// URL, its key and a fetch that follows no redirect, so that none falls
// back on ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY or any variable of its
// own, and a key goes only where its route says.

import { createAnthropic } from "@ai-sdk/anthropic";
import type { Env, RouteEntry } from "@dorothy/core";
import type { LanguageModel } from "ai";

// The AI SDK writes its warnings to the console, which would land on the
// TUI's screen; Dorothy reports what matters herself.
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

export const noRedirect: typeof fetch = Object.assign(
    (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        fetch(input, { ...init, redirect: "manual" }),
    { preconnect: fetch.preconnect },
);

export type ModelFactory = (entry: RouteEntry, key: string) => LanguageModel;

export const languageModel: ModelFactory = (entry, key) => {
    switch (entry.kind) {
        case "anthropic":
            return createAnthropic({
                baseURL: `${entry.baseUrl.replace(/\/+$/, "")}/v1`,
                apiKey: key,
                fetch: noRedirect,
            })(entry.model);
        default:
            throw new Error(`no provider for ${entry.kind} entries yet`);
    }
};

// The key an entry names, from env: "" for a keyless entry, null when
// the key it names is not set.
export function keyOf(entry: RouteEntry, env: Env): string | null {
    if (entry.key === null) {
        return "";
    }
    const value = env[entry.key];
    return value === undefined || value === "" ? null : value;
}

// Models that always think. Their default display is "omitted", which
// streams nothing while they think, and the provider drops pings, so a
// long think would look like a stall: they stream a summary instead.
const ALWAYS_THINKS = new Set(["claude-opus-5-5", "claude-fable-5-1"]);

type Thinking = { type: "disabled" } | { type: "adaptive"; display: "summarized" };

// Thinking at each model's lowest: "disabled", which the provider turns
// into the lowest a model allows, between_tools on Sonnet 5.5; adaptive,
// summarised, on models that always think.
export function providerOptions(entry: RouteEntry): Record<string, { thinking: Thinking }> {
    if (entry.kind !== "anthropic") {
        return {};
    }
    return {
        anthropic: {
            thinking: ALWAYS_THINKS.has(entry.model)
                ? { type: "adaptive", display: "summarized" }
                : { type: "disabled" },
        },
    };
}
```

- [ ] **Step 4: Write `packages/agent/src/failures.ts`**

House header with this file's path, then:

```ts
// A provider's error, thrown or streamed, as core's Failure. Only agent
// knows the wire; runRoute decides on the class.

import type { Failure, FailureClass } from "@dorothy/core";

// Words in a 400 or 403 that mean the account, not the request, is the
// trouble: spent credits, billing, a spending or usage limit.
const USAGE = /credit|billing|spend(ing)? limit|usage limit/i;

// A mid-stream error's type, as the status it would have had.
const STATUS_OF_TYPE: Readonly<Record<string, number>> = {
    rate_limit_error: 429,
    overloaded_error: 529,
    api_error: 500,
    billing_error: 402,
};

// retry-after, in seconds or as an HTTP date.
export function retryAfterMs(
    headers: Record<string, string> | undefined,
    now = Date.now(),
): number | null {
    const value = headers?.["retry-after"]?.trim();
    if (value === undefined || value === "") {
        return null;
    }
    if (/^\d+(\.\d+)?$/.test(value)) {
        return Number(value) * 1000;
    }
    const at = Date.parse(value);
    return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export function classOf(status: number, message: string): FailureClass {
    if (status === 402 || ((status === 400 || status === 403) && USAGE.test(message))) {
        return "usage";
    }
    if (status === 429) {
        return "rate-limit";
    }
    if (status === 503 || status === 529) {
        return "overload";
    }
    if (status >= 500) {
        return "server";
    }
    // A redirect refused, or a body cut off after a 200.
    if (status < 400) {
        return "network";
    }
    return "rejected";
}

type Wire = {
    statusCode?: unknown;
    responseHeaders?: Record<string, string>;
    data?: unknown;
    message?: unknown;
};

function statusOf(error: Wire): number | null {
    if (typeof error.statusCode === "number") {
        return error.statusCode;
    }
    const data = error.data as { type?: unknown; error?: { type?: unknown } } | undefined;
    const type =
        typeof data?.error?.type === "string"
            ? data.error.type
            : typeof data?.type === "string"
              ? data.type
              : null;
    return type === null ? null : (STATUS_OF_TYPE[type] ?? null);
}

// An error the AI SDK threw or streamed; one with no status never
// reached a provider that answered.
export function failureOf(error: unknown, now = Date.now()): Failure {
    const wire = (typeof error === "object" && error !== null ? error : {}) as Wire;
    const message =
        error instanceof Error
            ? error.message
            : typeof wire.message === "string"
              ? wire.message
              : String(error);
    const status = statusOf(wire);
    if (status === null) {
        return { class: "network", message, retryAfterMs: null };
    }
    const kind = classOf(status, message);
    return {
        class: kind,
        message,
        retryAfterMs:
            kind === "usage" || kind === "rate-limit"
                ? retryAfterMs(wire.responseHeaders, now)
                : null,
    };
}
```

- [ ] **Step 5: Write `packages/agent/src/cost.ts`**

House header with this file's path, then:

```ts
// A step's usage as core prices it, and the notice for a model with no
// price.

import { label, type RouteEntry, type StepUsage } from "@dorothy/core";
import type { LanguageModelUsage } from "ai";

export function stepUsage(usage: LanguageModelUsage): StepUsage {
    const details = usage.inputTokenDetails;
    return {
        noCache: details?.noCacheTokens ?? usage.inputTokens ?? 0,
        cacheRead: details?.cacheReadTokens ?? 0,
        cacheWrite: details?.cacheWriteTokens ?? 0,
        output: usage.outputTokens ?? 0,
    };
}

// Models already warned of, for the process.
const unpriced = new Set<string>();

// Once a process per model: its cost shows as $0.
export function unpricedNotice(entry: RouteEntry): string | null {
    const name = label(entry);
    if (unpriced.has(name)) {
        return null;
    }
    unpriced.add(name);
    return `no price is known for ${name}; its cost shows as $0`;
}
```

- [ ] **Step 6: Run the tests**

Run:

```bash
bun test packages/agent/src/failures.test.ts packages/agent/src/cost.test.ts packages/agent/src/providers.test.ts
```

Expected: PASS. If the AI SDK reports a mid-stream `overloaded_error`
with no `statusCode`, `statusOf` reads its `data`; if a row still
fails, print the error part's `statusCode`, `data` and `message` and fit
`statusOf` to them, never the test.

- [ ] **Step 7: Commit**

Run `bun run format && bun run lint:header && bun run check`
on temporary XDG roots
first.

```bash
git add packages/agent
git commit -m "feat(agent): Add providers, failures and cost"
```

---

### Task 7: The watchdog and `structuredCall` on the AI SDK

**Files:**

- Create: `packages/agent/src/attempt.ts`
- Rewrite: `packages/agent/src/structured.ts`
- Rewrite: `packages/agent/src/structured.test.ts`

**Interfaces:**

- Consumes: Tasks 2-3 (`runRoute`, `Cooldowns`, `defaultRoutes`,
  `stepCost`, `label`, `AttemptResult`, `Failure`), Task 6
  (`languageModel`, `ModelFactory`, `keyOf`, `providerOptions`,
  `failureOf`, `stepUsage`), Task 1 (`mockModel`, `textChunks`,
  `mockUsage`, `manualTimers`, `fakeMessages`).
- Produces:
  - `attempt.ts`: `STALL_MS = 60_000`; `class Watchdog { constructor(signal:
    AbortSignal, ms?: number, timers?: Timers); readonly signal:
    AbortSignal; touch(): void; dispose(): void; failure(): Failure }`;
    `secretFailure(entry: RouteEntry): Failure`.
  - `structured.ts`: `type StructuredDeps = { route?: Route; cooldowns?:
    Cooldowns; env?: Env; model?: ModelFactory; timers?: Timers;
    stallMs?: number }` and `structuredCall(deps?: StructuredDeps):
    StructuredCall`, its route defaulting to `defaultRoutes().review`.
  - `core/src/contracts/structured.ts`: `StructuredOutcome` gains
    `notes?: string[]` on both arms.

- [ ] **Step 1: Give `StructuredOutcome` its notes**

In `packages/core/src/contracts/structured.ts`, both arms of
`StructuredOutcome` gain `notes?: string[];`, with the comment:

```ts
// notes: what the call's route said on its way, a fallback's warning
// among them; set only when there is one.
```

- [ ] **Step 2: Write the failing tests**

Replace `packages/agent/src/structured.test.ts`, keeping its header,
with:

```ts
import { afterEach, describe, expect, it } from "bun:test";
import { anthropicEntry, type StructuredRequest } from "@dorothy/core";
import { APICallError } from "ai";
import { structuredCall } from "./structured.js";
import { fakeMessages, manualTimers, mockModel, mockUsage, type Script, textChunks } from "./testing.js";

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

const callWith = (scripts: Script[], extra: Parameters<typeof structuredCall>[0] = {}) => {
    const model = mockModel(scripts, "claude-sonnet-5-5");
    return { model, call: structuredCall({ route: [SONNET], env, model: () => model, ...extra }) };
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
            { chunks: textChunks('{"ok":true}', mockUsage(1_000_000, 1_000_000)) },
        ]);
        expect(await call(REQUEST)).toEqual({
            ok: true,
            output: { ok: true },
            model: "anthropic:claude-sonnet-5-5",
            costUsd: 12,
        });
        const sent = model.doStreamCalls[0];
        expect(sent?.prompt[0]).toEqual({ role: "system", content: "persona" });
        expect(sent?.responseFormat).toMatchObject({ type: "json", schema: SCHEMA });
        expect(sent?.providerOptions).toEqual({ anthropic: { thinking: { type: "disabled" } } });
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
        expect(await call(REQUEST)).toMatchObject({ ok: false, reason: "the review ended without a result" });
    });

    it("fails without a key, calling no model", async () => {
        const model = mockModel([{ chunks: textChunks("{}") }]);
        const call = structuredCall({ route: [SONNET], env: {}, model: () => model });
        expect(await call(REQUEST)).toEqual({ ok: false, reason: "ANTHROPIC_API_KEY is not set", costUsd: 0 });
        expect(model.doStreamCalls).toHaveLength(0);
    });

    it("ends an attempt that stalls", async () => {
        const timers = manualTimers();
        const { call, model } = callWith([{ chunks: [{ type: "stream-start", warnings: [] }], hang: true }], { timers });
        const pending = call(REQUEST);
        await until(() => model.doStreamCalls.length === 1);
        timers.fire(60_000);
        expect(await pending).toMatchObject({ ok: false, reason: "no response for 60s" });
    });

    it("ends the call at its deadline", async () => {
        const timers = manualTimers();
        const { call, model } = callWith([{ chunks: [{ type: "stream-start", warnings: [] }], hang: true }], { timers });
        const pending = call(REQUEST);
        await until(() => model.doStreamCalls.length === 1);
        timers.fire(120_000);
        expect(await pending).toMatchObject({ ok: false, reason: "timed out after 120s" });
    });

    it("ends the call when cancelled", async () => {
        const controller = new AbortController();
        const { call, model } = callWith([{ chunks: [{ type: "stream-start", warnings: [] }], hang: true }]);
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
        expect(await call(REQUEST)).toMatchObject({ ok: false, reason: "slow down" });
    });

    it("answers from the next entry after a refusal, with a note", async () => {
        const refusal = new APICallError({ message: "slow down", url: "u", requestBodyValues: {}, statusCode: 429 });
        const first = mockModel([refusal], "claude-sonnet-5-5");
        const second = mockModel([{ chunks: textChunks('{"ok":true}') }], "claude-haiku-5-5");
        const HAIKU = anthropicEntry("claude-haiku-5-5");
        const call = structuredCall({
            route: [SONNET, HAIKU],
            env,
            model: (entry) => (entry.model === SONNET.model ? first : second),
        });
        const outcome = await call(REQUEST);
        expect(outcome).toMatchObject({ ok: true, output: { ok: true }, model: "anthropic:claude-haiku-5-5" });
        expect(outcome.notes).toEqual([
            "anthropic:claude-sonnet-5-5 refused (rate-limit: slow down); answering with anthropic:claude-haiku-5-5",
        ]);
    });
});

describe("structuredCall's shared time", () => {
    it("leaves a second entry its time after a first that stalls", async () => {
        const timers = manualTimers();
        const first = mockModel([{ chunks: [{ type: "stream-start", warnings: [] }], hang: true }], "claude-sonnet-5-5");
        const second = mockModel([{ chunks: textChunks('{"ok":true}') }], "claude-haiku-5-5");
        const HAIKU = anthropicEntry("claude-haiku-5-5");
        const call = structuredCall({
            route: [SONNET, HAIKU],
            env,
            timers,
            model: (entry) => (entry.model === SONNET.model ? first : second),
        });
        const pending = call(REQUEST);
        await until(() => first.doStreamCalls.length === 1);
        timers.fire(60_000);
        expect(await pending).toMatchObject({ ok: true, model: "anthropic:claude-haiku-5-5" });
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
        expect(await call(REQUEST)).toMatchObject({ ok: false, reason: "no response for 0.05s" });
    });
});
```

The refusal sends no `retry-after`, so the note names no wait; the
cooldown it starts lasts `DEFAULT_COOLDOWN_MS`.

- [ ] **Step 3: Run them to see them fail**

Run: `bun test packages/agent/src/structured.test.ts`
Expected: FAIL: `attempt.js` not found, and the old `structuredCall`
takes no route.

- [ ] **Step 4: Write `packages/agent/src/attempt.ts`**

House header with this file's path, then:

```ts
// What every attempt shares: its own abort, and the failure of a
// missing key.

import { type Failure, REAL_TIMERS, type RouteEntry, type Timers } from "@dorothy/core";

export const STALL_MS = 60_000;

// An attempt's abort: its route's signal, or a stall, when nothing has
// arrived for ms since the request began or since the stream's last
// part. Every part counts, reasoning too, so a long think is no stall;
// the AI SDK's own chunk timeouts start only at a provider's first
// event, and so miss a server that never answers.
export class Watchdog {
    readonly #controller = new AbortController();
    readonly #route: AbortSignal;
    readonly #ms: number;
    readonly #timers: Timers;
    #timer: unknown = null;
    #stalled = false;
    readonly #onAbort = () => {
        this.#controller.abort();
    };

    constructor(signal: AbortSignal, ms = STALL_MS, timers: Timers = REAL_TIMERS) {
        this.#route = signal;
        this.#ms = ms;
        this.#timers = timers;
        if (signal.aborted) {
            this.#controller.abort();
        } else {
            signal.addEventListener("abort", this.#onAbort, { once: true });
        }
        this.touch();
    }

    get signal(): AbortSignal {
        return this.#controller.signal;
    }

    touch(): void {
        if (this.#timer !== null) {
            this.#timers.clear(this.#timer);
        }
        this.#timer = this.#timers.set(() => {
            this.#stalled = true;
            this.#controller.abort();
        }, this.#ms);
    }

    dispose(): void {
        if (this.#timer !== null) {
            this.#timers.clear(this.#timer);
            this.#timer = null;
        }
        this.#route.removeEventListener("abort", this.#onAbort);
    }

    // Why an aborted attempt ended: a stall, or its route's signal, which
    // runRoute tells apart as a cancel or its deadline.
    failure(): Failure {
        return this.#stalled
            ? { class: "timeout", message: `no response for ${this.#ms / 1000}s`, retryAfterMs: null }
            : { class: "cancelled", message: "cancelled", retryAfterMs: null };
    }
}

export const secretFailure = (entry: RouteEntry): Failure => ({
    class: "secret",
    message: `${entry.key} is not set`,
    retryAfterMs: null,
});
```

- [ ] **Step 5: Rewrite `packages/agent/src/structured.ts`**

Keep its header; replace the rest with:

```ts
// One-shot calls on a route, answering with structured output: her
// reviews and her compactions. Each attempt streams, so that a stall
// ends it while the call's time allows another; all of a call's attempts
// share its timeoutMs.

import {
    type AttemptResult,
    Cooldowns,
    defaultRoutes,
    type Env,
    type Failure,
    label,
    REAL_TIMERS,
    type Route,
    type RouteEntry,
    runRoute,
    stepCost,
    type StructuredCall,
    type StructuredRequest,
    type Timers,
} from "@dorothy/core";
import { jsonSchema, Output, streamText } from "ai";
import { secretFailure, STALL_MS, Watchdog } from "./attempt.js";
import { stepUsage } from "./cost.js";
import { failureOf } from "./failures.js";
import { keyOf, languageModel, type ModelFactory, providerOptions } from "./providers.js";

export type StructuredDeps = {
    route?: Route;
    cooldowns?: Cooldowns;
    env?: Env;
    model?: ModelFactory;
    timers?: Timers;
    stallMs?: number;
};

type AttemptDeps = Required<Pick<StructuredDeps, "env" | "model" | "timers" | "stallMs">>;

// JSON of the schema's top-level type; the caller judges the rest.
function fits(value: unknown, schema: Record<string, unknown>): boolean {
    switch (schema.type) {
        case "object":
            return typeof value === "object" && value !== null && !Array.isArray(value);
        case "array":
            return Array.isArray(value);
        default:
            return value !== undefined;
    }
}

export function structuredCall({
    route = defaultRoutes().review,
    cooldowns = new Cooldowns(),
    env = process.env,
    model = languageModel,
    timers = REAL_TIMERS,
    stallMs = STALL_MS,
}: StructuredDeps = {}): StructuredCall {
    const deps: AttemptDeps = { env, model, timers, stallMs };
    return async (request) => {
        if (request.signal?.aborted) {
            return { ok: false, reason: "cancelled", costUsd: 0 };
        }
        const outcome = await runRoute(
            route,
            (entry, signal) => attempt(entry, signal, request, deps),
            {
                cooldowns,
                deadlineMs: request.timeoutMs,
                timers,
                ...(request.signal === undefined ? {} : { signal: request.signal }),
            },
        );
        const notes = outcome.notes.length === 0 ? {} : { notes: outcome.notes };
        return outcome.ok
            ? {
                  ok: true,
                  output: outcome.value,
                  model: label(outcome.entry),
                  costUsd: outcome.costUsd,
                  ...notes,
              }
            : { ok: false, reason: outcome.reason, costUsd: outcome.costUsd, ...notes };
    };
}

async function attempt(
    entry: RouteEntry,
    signal: AbortSignal,
    { what, system, prompt, schema }: StructuredRequest,
    deps: AttemptDeps,
): Promise<AttemptResult<unknown>> {
    const key = keyOf(entry, deps.env);
    if (key === null) {
        return { ok: false, failure: secretFailure(entry), started: false, costUsd: 0 };
    }
    const watchdog = new Watchdog(signal, deps.stallMs, deps.timers);
    let costUsd = 0;
    let streamed: Failure | null = null;
    let aborted = false;
    try {
        const result = streamText({
            model: deps.model(entry, key),
            instructions: system,
            prompt,
            output: Output.object({ schema: jsonSchema(schema) }),
            maxRetries: 0,
            abortSignal: watchdog.signal,
            providerOptions: providerOptions(entry),
            onError: () => {},
        });
        for await (const part of result.fullStream) {
            watchdog.touch();
            if (part.type === "error") {
                streamed ??= failureOf(part.error);
            } else if (part.type === "abort") {
                aborted = true;
            } else if (part.type === "finish-step") {
                costUsd += stepCost(entry, stepUsage(part.usage)) ?? 0;
            }
        }
        if (aborted) {
            return { ok: false, failure: watchdog.failure(), started: false, costUsd };
        }
        if (streamed !== null) {
            return { ok: false, failure: streamed, started: false, costUsd };
        }
        const output = await result.output.then(
            (value) => value as unknown,
            () => undefined,
        );
        if (!fits(output, schema)) {
            return {
                ok: false,
                failure: { class: "unparsed", message: `the ${what} ended without a result`, retryAfterMs: null },
                started: false,
                costUsd,
            };
        }
        return { ok: true, value: output, costUsd };
    } catch (error) {
        return {
            ok: false,
            failure: watchdog.signal.aborted ? watchdog.failure() : failureOf(error),
            started: false,
            costUsd,
        };
    } finally {
        watchdog.dispose();
    }
}
```

- [ ] **Step 6: Run the tests**

Run: `bun test packages/agent/src/structured.test.ts`
Expected: PASS. `packages/cli` still calls `structuredCall()` with no
argument, which takes the review route; it compiles unchanged.

- [ ] **Step 7: Commit**

Run `bun run format && bun run lint:header && bun run check`
on temporary XDG roots
first.

```bash
git add packages/core packages/agent
git commit -m "feat(agent): Run structured calls on the AI SDK"
```

---

### Task 8: Her recall tools over MCP stdio

**Files:**

- Create: `packages/agent/src/recall-tools.ts`
- Test: `packages/agent/src/recall-tools.test.ts`

**Interfaces:**

- Consumes: Task 1's `fake-mcp.ts`; `ALLOWED_TOOLS`, `RECOLLECT_TOOL`,
  `SERVER_NAME`, `RecallLaunch`, `Route`, `Env` from core.
- Produces: `type RecallTools = { tools: ToolSet; close(): Promise<void> }`;
  `type ConnectRecall = (launch: RecallLaunch, recollect: boolean, env:
  Record<string, string>, startMs?: number) => Promise<RecallTools>`;
  `connectRecall: ConnectRecall`; `RECALL_START_MS = 10_000`;
  `recallCwd(env): string`; `recallEnv(env: Env, route: Route):
  Record<string, string>`.

- [ ] **Step 1: Write the failing tests**

`packages/agent/src/recall-tools.test.ts`, house header, then:

```ts
import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anthropicEntry } from "@dorothy/core";
import { connectRecall, recallCwd, recallEnv } from "./recall-tools.js";

const launch = { command: process.execPath, args: [join(import.meta.dir, "fake-mcp.ts")] };
const ENV = {
    PATH: process.env.PATH ?? "",
    XDG_DATA_HOME: "/tmp/recall-data",
    XDG_CACHE_HOME: join(tmpdir(), "dorothy-recall-tools-test"),
};

type Execute = (input: unknown, options: unknown) => Promise<{ content: { text: string }[]; isError: boolean }>;
const run = (tool: unknown, input: unknown) =>
    ((tool as { execute: Execute }).execute)(input, { toolCallId: "1", messages: [] });

describe("recallEnv", () => {
    it("passes the caller's environment on, less every credential", () => {
        const route = [{ ...anthropicEntry("m"), key: "MY_ROUTE_KEY" }];
        expect(
            recallEnv(
                {
                    PATH: "/bin",
                    XDG_DATA_HOME: "/d",
                    DOROTHY_MEMORY_URL: "http://127.0.0.1:1",
                    MY_ROUTE_KEY: "a",
                    ANTHROPIC_API_KEY: "b",
                    OPENROUTER_API_KEY: "c",
                    CLAUDE_CODE_OAUTH_TOKEN: "d",
                    CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2: "e",
                    UNSET: undefined,
                },
                route,
            ),
        ).toEqual({ PATH: "/bin", XDG_DATA_HOME: "/d", DOROTHY_MEMORY_URL: "http://127.0.0.1:1" });
    });
});

describe("connectRecall", () => {
    it("offers her tools by the names the model calls, and no others", async () => {
        const recall = await connectRecall(launch, false, ENV);
        try {
            expect(Object.keys(recall.tools).sort()).toEqual([
                "mcp__memory__open",
                "mcp__memory__remember",
                "mcp__memory__search",
                "mcp__memory__tags",
            ]);
        } finally {
            await recall.close();
        }
    });

    it("offers recollect when asked, starting the server with --recollect", async () => {
        const recall = await connectRecall(launch, true, ENV);
        try {
            expect(Object.keys(recall.tools)).toContain("mcp__memory__recollect");
            const out = await run(recall.tools.mcp__memory__recollect, { cluster: 1 });
            expect(JSON.parse(out.content[0]?.text ?? "").args).toEqual(["--recollect"]);
        } finally {
            await recall.close();
        }
    });

    it("starts the server in the environment it is given", async () => {
        const recall = await connectRecall(launch, false, ENV);
        try {
            const out = await run(recall.tools.mcp__memory__search, { query: "x" });
            expect(JSON.parse(out.content[0]?.text ?? "")).toMatchObject({
                tool: "search",
                data: "/tmp/recall-data",
                key: null,
            });
        } finally {
            await recall.close();
        }
    });

    it("fails when the server does not start", async () => {
        await expect(
            connectRecall({ command: process.execPath, args: ["-e", "process.exit(3)"] }, false, ENV),
        ).rejects.toThrow();
    });

    it("gives up on a server that never answers", async () => {
        const silent = { command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] };
        const began = Date.now();
        await expect(connectRecall(silent, false, ENV, 200)).rejects.toThrow();
        expect(Date.now() - began).toBeLessThan(2_000);
    });

    it("runs the server in a directory of Dorothy's, not the caller's", async () => {
        const cache = mkdtempSync(join(tmpdir(), "dorothy-recall-cwd-"));
        try {
            expect(recallCwd({ XDG_CACHE_HOME: cache })).toBe(join(cache, "dorothy"));
            expect(existsSync(join(cache, "dorothy"))).toBe(true);
        } finally {
            rmSync(cache, { recursive: true, force: true });
        }
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/agent/src/recall-tools.test.ts`
Expected: FAIL, `recall-tools.js` not found.

- [ ] **Step 3: Write `packages/agent/src/recall-tools.ts`**

House header with this file's path, then:

```ts
// Her memory tools in a chat: her recall server, this program again,
// over MCP stdio, its tools named as the model calls them,
// mcp__memory__search and so on, and only those a session may use.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createMCPClient } from "@ai-sdk/mcp";
import { StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import {
    ALLOWED_TOOLS,
    type Env,
    RECOLLECT_TOOL,
    type RecallLaunch,
    type Route,
    SERVER_NAME,
    xdgDir,
} from "@dorothy/core";
import type { ToolSet } from "ai";

export type RecallTools = { tools: ToolSet; close(): Promise<void> };

export type ConnectRecall = (
    launch: RecallLaunch,
    recollect: boolean,
    env: Record<string, string>,
    startMs?: number,
) => Promise<RecallTools>;

// What the recall server may see: the caller's environment, its XDG
// roots among it, less every credential: the keys a route names, any
// *_API_KEY and Claude's OAuth tokens.
export function recallEnv(env: Env, route: Route): Record<string, string> {
    const named = new Set(route.flatMap((entry) => (entry.key === null ? [] : [entry.key])));
    const kept: Record<string, string> = {};
    for (const [name, value] of Object.entries(env)) {
        if (
            value === undefined ||
            named.has(name) ||
            name.endsWith("_API_KEY") ||
            name.startsWith("CLAUDE_CODE_OAUTH_TOKEN")
        ) {
            continue;
        }
        kept[name] = value;
    }
    return kept;
}

// How long the server has to start and list its tools: one that never
// answers must not hold chat, or quitting, forever.
export const RECALL_START_MS = 10_000;

// Where the server runs: a directory of Dorothy's, never the user's
// project, whose .env and bunfig.toml Bun would otherwise read.
export function recallCwd(env: Record<string, string>): string {
    const dir = join(xdgDir(env, "XDG_CACHE_HOME", ".cache"), "dorothy");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}

function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`${what} took over ${ms / 1000}s`)), ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

// Its stderr is ignored, so that nothing it says lands on the TUI's
// screen.
export const connectRecall: ConnectRecall = async (launch, recollect, env, startMs = RECALL_START_MS) => {
    const client = await createMCPClient({
        transport: new StdioMCPTransport({
            command: launch.command,
            args: recollect ? [...launch.args, "--recollect"] : launch.args,
            env,
            cwd: recallCwd(env),
            stderr: "ignore",
        }),
        initializationOptions: { timeout: startMs },
    });
    try {
        const listed = await within(client.tools(), startMs, "listing the recall tools");
        const allowed = new Set<string>(recollect ? [...ALLOWED_TOOLS, RECOLLECT_TOOL] : ALLOWED_TOOLS);
        const tools: ToolSet = {};
        for (const [name, tool] of Object.entries(listed)) {
            const called = `mcp__${SERVER_NAME}__${name}`;
            if (allowed.has(called)) {
                tools[called] = tool;
            }
        }
        return { tools, close: () => client.close() };
    } catch (error) {
        await client.close().catch(() => {});
        throw error;
    }
};
```

- [ ] **Step 4: Run the tests**

Run: `bun test packages/agent/src/recall-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run `bun run format && bun run lint:header && bun run check`
on temporary XDG roots
first.

```bash
git add packages/agent
git commit -m "feat(agent): Reach her recall tools over MCP stdio"
```

---

### Task 9: `Conversation` on the AI SDK

The chat session, rebuilt: the session's messages held here, each turn
a `streamText` on the chat route through `runRoute`, streamed as the
`ConversationEvent`s the TUI already draws.

**Files:**

- Create: `packages/agent/src/turn.ts`
- Rewrite: `packages/agent/src/conversation.ts`
- Create: `packages/agent/src/legacy.ts` (the old `conversationOptions`,
  for `--dump-context` until Task 10)
- Modify: `packages/agent/src/persona.ts` (plumbing, `routeLine`)
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/cli/src/run-tui.ts` (`prompts.session`),
  `packages/cli/src/dump.ts` (its import)
- Rewrite: `packages/agent/src/conversation.test.ts`
- Test: `packages/agent/src/turn.test.ts`,
  `packages/agent/src/persona.test.ts`

**Interfaces:**

- Consumes: Tasks 2-3, 6-8: `runRoute`, `Cooldowns`, `defaultRoutes`,
  `stepCost`, `label`, `Watchdog`, `STALL_MS`, `secretFailure`,
  `languageModel`, `ModelFactory`, `keyOf`, `providerOptions`,
  `failureOf`, `stepUsage`, `unpricedNotice`, `connectRecall`,
  `recallEnv`, `ConnectRecall`, `RecallTools`.
- Produces:
  - `turn.ts`: `estimate(text): number`, `textOf(content): string`,
    `class TurnState`.
  - `conversation.ts`: `MAX_STEPS = 10`, `STEP_LIMIT_WARNING`,
    `type SessionSetup`, `type ConversationSetup = { system: string;
    recall: RecallLaunch | null; recollect: boolean }`,
    `conversationSetup(setup?: SessionSetup, route?: Route):
    ConversationSetup`, `type ConversationDeps = { route?; cooldowns?;
    env?; model?; connect?; timers?; stallMs?; now? }`,
    `class Conversation implements ChatSession`, constructed with
    `SessionSetup & ConversationDeps`.
  - `persona.ts`: `routeLine(route: Route): string`.

- [ ] **Step 1: Move the old options aside**

Move `conversationOptions`, with its imports, from
`packages/agent/src/conversation.ts` into a new
`packages/agent/src/legacy.ts` (house header), unchanged, its comment
gaining: `// The Agent SDK's options, for --dump-context until it moves
onto Conversation; removed then.` It imports `type SessionSetup` from
the new `./conversation.js`, and `withSection`, `SERVER_NAME`,
`ALLOWED_TOOLS` and `RECOLLECT_TOOL` from `@dorothy/core`, beside the
Agent SDK's `Options` and `persona.ts`'s `baseOptions`, `cliOptions`,
`personaPrompt` and `withHistory`. Export it from `index.ts` from there;
`packages/cli/src/dump.ts` keeps importing it from `@dorothy/agent`.

- [ ] **Step 2: Write `turn.test.ts` and `conversation.test.ts`, failing**

`packages/agent/src/turn.test.ts`, house header, then:

```ts
import { describe, expect, it } from "bun:test";
import type { ConversationEvent } from "@dorothy/core";
import { estimate, textOf, TurnState } from "./turn.js";

const turn = () => {
    const events: ConversationEvent[] = [];
    return { events, state: new TurnState((event) => events.push(event), 1_000) };
};

describe("TurnState", () => {
    it("streams text, timing the first", () => {
        const { events, state } = turn();
        state.text("Hel", 1_250);
        state.text("lo", 1_400);
        expect(state.reply).toBe("Hello");
        expect(state.ttftMs).toBe(250);
        expect(state.started).toBe(true);
        expect(events).toEqual([
            { type: "delta", text: "Hel" },
            { type: "delta", text: "lo" },
        ]);
    });

    it("joins the reply's steps after a lookup with a blank line", () => {
        const { events, state } = turn();
        state.text("Let me look.", 1_100);
        state.call("c1", "mcp__memory__search", { query: "kiln" });
        state.result("c1", { content: [{ type: "text", text: "{}" }], isError: false });
        state.text("Found it.", 1_300);
        expect(state.reply).toBe("Let me look.\n\nFound it.");
        expect(events.find((event) => event.type === "lookup")).toMatchObject({ id: "c1", ok: true, offset: 12 });
    });

    it("is not started by a lookup alone, but by remember", () => {
        const { state } = turn();
        state.call("c1", "mcp__memory__search", {});
        expect(state.started).toBe(false);
        state.call("c2", "mcp__memory__remember", { fact: "x" });
        expect(state.started).toBe(true);
    });

    it("reports an isError result as a failed lookup", () => {
        const { events, state } = turn();
        state.call("c1", "mcp__memory__open", { id: "x" });
        state.result("c1", { content: [{ type: "text", text: "no such" }], isError: true });
        expect(events[0]).toMatchObject({ type: "lookup", ok: false });
    });

    it("settles calls left unanswered as failed", () => {
        const { events, state } = turn();
        state.call("c1", "mcp__memory__search", {});
        state.call("c2", "mcp__memory__remember", { fact: "x" });
        state.settleCalls();
        expect(events.map((event) => [event.type, "ok" in event ? event.ok : null])).toEqual([
            ["lookup", false],
            ["remember", false],
        ]);
    });

    it("ignores other tools", () => {
        const { events, state } = turn();
        state.call("c1", "some_other_tool", {});
        state.result("c1", { content: [], isError: false });
        expect(events).toEqual([]);
    });

    it("sums usage into stats, and measures the context from the last step", () => {
        const { state } = turn();
        state.step({ noCache: 100, cacheRead: 50, cacheWrite: 10, output: 20 });
        state.step({ noCache: 30, cacheRead: 200, cacheWrite: 0, output: 5 });
        state.text("abcdefgh", 1_500);
        expect(state.stats(0.25, 1.5, 3_000)).toEqual({
            inputTokens: 130,
            cacheReadTokens: 250,
            cacheWriteTokens: 10,
            outputTokens: 25,
            ttftMs: 500,
            durationMs: 2_000,
            costUsd: 0.25,
            sessionCostUsd: 1.5,
        });
        expect(state.contextTokens()).toBe(230 + 2);
    });
});

describe("textOf and estimate", () => {
    it("joins text blocks, or takes a string", () => {
        expect(textOf([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }])).toBe("ab");
        expect(textOf("plain")).toBe("plain");
        expect(textOf(undefined)).toBe("");
    });
    it("counts four characters to a token", () => {
        expect(estimate("abcde")).toBe(2);
    });
});
```

Replace `packages/agent/src/conversation.test.ts`, keeping its header,
with:

```ts
import { describe, expect, it } from "bun:test";
import { anthropicEntry, type ConversationEvent, Cooldowns, type RouteEntry, withSection } from "@dorothy/core";
import { APICallError, jsonSchema, tool } from "ai";
import {
    Conversation,
    type ConversationDeps,
    conversationSetup,
    MAX_STEPS,
    type SessionSetup,
    STEP_LIMIT_WARNING,
} from "./conversation.js";
import { personaPrompt, withHistory } from "./persona.js";
import type { RecallTools } from "./recall-tools.js";
import { fakeMessages, manualTimers, mockModel, mockUsage, type Script, textChunks, toolChunks } from "./testing.js";

const env = { ANTHROPIC_API_KEY: "test-key" };
const OPUS = anthropicEntry("claude-opus-5-5");
const START = { type: "stream-start", warnings: [] };

function session(scripts: Script[], options: SessionSetup & ConversationDeps = {}) {
    const model = mockModel(scripts);
    const conversation = new Conversation({ env, model: () => model, ...options });
    const events: ConversationEvent[] = [];
    conversation.subscribe((event) => events.push(event));
    conversation.start();
    return { conversation, model, events };
}

async function until(done: () => boolean): Promise<void> {
    const end = Date.now() + 2000;
    while (!done()) {
        if (Date.now() > end) {
            throw new Error("timed out waiting");
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
}

const ended = (events: ConversationEvent[], count = 1) =>
    events.filter((event) => event.type === "turn-end" || event.type === "error").length >= count;

const of = <T extends ConversationEvent["type"]>(events: ConversationEvent[], type: T) =>
    events.filter((event): event is Extract<ConversationEvent, { type: T }> => event.type === type);

// Recall tools that answer each call as results says, recording calls.
function fakeRecall(results: Record<string, { text: string; isError?: boolean }>) {
    const calls: string[] = [];
    let closed = false;
    const recall: RecallTools = {
        tools: Object.fromEntries(
            Object.entries(results).map(([name, result]) => [
                name,
                tool({
                    inputSchema: jsonSchema({ type: "object" }),
                    execute: async () => {
                        calls.push(name);
                        return { content: [{ type: "text", text: result.text }], isError: result.isError ?? false };
                    },
                }),
            ]),
        ),
        close: async () => {
            closed = true;
        },
    };
    return { recall, calls, closed: () => closed };
}

const RECALL = { command: "dorothy", args: ["--recall-server"] };

describe("Conversation", () => {
    it("emits ready after start returns, naming the first entry", async () => {
        const model = mockModel([{ chunks: textChunks("hi") }]);
        const conversation = new Conversation({ env, model: () => model });
        const events: ConversationEvent[] = [];
        conversation.start();
        conversation.subscribe((event) => events.push(event));
        await until(() => events.length > 0);
        expect(events[0]).toMatchObject({ type: "ready", model: "anthropic:claude-opus-5-5" });
        expect(of(events, "ready")[0]?.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("streams deltas and ends the turn with its reply, stats and model", async () => {
        const { conversation, events } = session([{ chunks: textChunks("Hello there", mockUsage(1_000_000, 1_000_000)) }]);
        conversation.send("hi");
        await until(() => ended(events));
        expect(of(events, "delta").map((event) => event.text).join("")).toBe("Hello there");
        const end = of(events, "turn-end")[0];
        expect(end).toMatchObject({ reply: "Hello there", interrupted: false, model: "anthropic:claude-opus-5-5" });
        expect(end?.stats).toMatchObject({ inputTokens: 1_000_000, outputTokens: 1_000_000, costUsd: 24, sessionCostUsd: 24 });
        expect(end?.contextTokens).toBe(1_000_000 + 3);
    });

    it("keeps a running session cost", async () => {
        const { conversation, events } = session([
            { chunks: textChunks("one", mockUsage(1_000_000, 0)) },
            { chunks: textChunks("two", mockUsage(1_000_000, 0)) },
        ]);
        conversation.send("a");
        await until(() => ended(events));
        conversation.send("b");
        await until(() => ended(events, 2));
        expect(of(events, "turn-end").map((event) => event.stats.sessionCostUsd)).toEqual([4, 8]);
    });

    it("re-emits each stream part as an sdk event, with a text part's text", async () => {
        const { conversation, events } = session([{ chunks: textChunks("hi") }]);
        conversation.send("hi");
        await until(() => ended(events));
        expect(of(events, "sdk").map((event) => event.message)).toContainEqual({
            type: "text-delta",
            event: { type: "text-delta", delta: "hi" },
        });
    });

    it("sends the system prompt and the latest message with cache breakpoints, storing neither", async () => {
        const scripts = Array.from({ length: 6 }, (_, index) => ({ chunks: textChunks(`reply ${index}`) }));
        const { conversation, model, events } = session(scripts);
        for (let index = 0; index < 6; index += 1) {
            conversation.send(`message ${index}`);
            await until(() => ended(events, index + 1));
        }
        const last = model.doStreamCalls[5];
        expect(last?.prompt[0]).toMatchObject({
            role: "system",
            providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        });
        const marked = JSON.stringify(last?.prompt).match(/cacheControl/g) ?? [];
        expect(marked).toHaveLength(2);
        expect(last?.prompt.at(-1)).toMatchObject({ role: "user", content: [{ type: "text", text: "message 5" }] });
        expect(JSON.stringify(last?.prompt)).toContain("reply 4");
        expect(last?.providerOptions).toEqual({
            anthropic: { thinking: { type: "adaptive", display: "summarized" } },
        });
    });

    it("keeps an interrupted partial reply", async () => {
        const { conversation, events } = session([
            { chunks: [START, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Partial" }], hang: true },
        ]);
        conversation.send("hi");
        await until(() => of(events, "delta").length === 1);
        await conversation.interrupt();
        await until(() => ended(events));
        expect(of(events, "turn-end")[0]).toMatchObject({ reply: "Partial", interrupted: true });
        expect(of(events, "error")).toHaveLength(0);
    });

    it("ignores interrupt while idle", async () => {
        const { conversation, events } = session([{ chunks: textChunks("hi") }]);
        await conversation.interrupt();
        expect(of(events, "error")).toHaveLength(0);
    });

    it("closes without an error, mid-reply too", async () => {
        const { conversation, events } = session([{ chunks: [START], hang: true }]);
        conversation.send("hi");
        await until(() => of(events, "sdk").length > 0);
        await conversation.close();
        await conversation.close();
        expect(of(events, "error")).toHaveLength(0);
    });

    it("reports a provider's refusal as an error", async () => {
        const refusal = new APICallError({ message: "overloaded", url: "u", requestBodyValues: {}, statusCode: 529 });
        const { conversation, events } = session([refusal]);
        conversation.send("hi");
        await until(() => ended(events));
        expect(of(events, "error")[0]).toEqual({ type: "error", message: "overloaded" });
    });

    it("hands a partial reply and its stats to the error when the stream fails", async () => {
        const { conversation, events } = session([
            {
                chunks: [
                    START,
                    { type: "text-start", id: "t" },
                    { type: "text-delta", id: "t", delta: "Half" },
                    { type: "error", error: new APICallError({ message: "reset", url: "u", requestBodyValues: {}, statusCode: 500 }) },
                    { type: "finish", usage: mockUsage(), finishReason: { unified: "error", raw: undefined } },
                ],
            },
        ]);
        conversation.send("hi");
        await until(() => ended(events));
        expect(of(events, "error")[0]).toMatchObject({ message: "reset", partial: "Half" });
        expect(of(events, "error")[0]?.stats).toBeDefined();
    });

    it("fails a turn without a key, calling no model", async () => {
        const model = mockModel([{ chunks: textChunks("hi") }]);
        const conversation = new Conversation({ env: {}, model: () => model });
        const events: ConversationEvent[] = [];
        conversation.subscribe((event) => events.push(event));
        conversation.start();
        conversation.send("hi");
        await until(() => ended(events));
        expect(of(events, "error")[0]).toEqual({ type: "error", message: "ANTHROPIC_API_KEY is not set" });
        expect(model.doStreamCalls).toHaveLength(0);
    });

    it("ends a turn that stalls", async () => {
        const timers = manualTimers();
        const { conversation, model, events } = session([{ chunks: [START], hang: true }], { timers });
        conversation.send("hi");
        await until(() => model.doStreamCalls.length === 1);
        timers.fire(60_000);
        await until(() => ended(events));
        expect(of(events, "error")[0]).toMatchObject({ message: "no response for 60s" });
    });

    it("warns when ten steps end in a tool call, and ends on the text it has", async () => {
        const { recall } = fakeRecall({ mcp__memory__search: { text: "{}" } });
        const { conversation, events } = session([{ chunks: toolChunks("c", "mcp__memory__search", {}) }], {
            recall: RECALL,
            connect: async () => recall,
        });
        conversation.send("hi");
        await until(() => ended(events));
        expect(of(events, "lookup")).toHaveLength(MAX_STEPS);
        expect(of(events, "warning").map((event) => event.message)).toContain(STEP_LIMIT_WARNING);
        expect(of(events, "turn-end")).toHaveLength(1);
    });
});

describe("Conversation with recall", () => {
    it("offers the recall tools, emitting each lookup where it happened", async () => {
        const fake = fakeRecall({ mcp__memory__search: { text: '{"results":[]}' } });
        const { conversation, events } = session(
            [
                {
                    chunks: [
                        START,
                        { type: "text-start", id: "t" },
                        { type: "text-delta", id: "t", delta: "Let me look." },
                        { type: "text-end", id: "t" },
                        { type: "tool-call", toolCallId: "c1", toolName: "mcp__memory__search", input: '{"query":"kiln"}' },
                        { type: "finish", usage: mockUsage(), finishReason: { unified: "tool-calls", raw: "tool_use" } },
                    ],
                },
                { chunks: textChunks("Nothing on kilns.") },
            ],
            { recall: RECALL, connect: async () => fake.recall },
        );
        conversation.send("kiln?");
        await until(() => ended(events));
        expect(fake.calls).toEqual(["mcp__memory__search"]);
        expect(of(events, "lookup")[0]).toMatchObject({ id: "c1", ok: true, offset: 12 });
        expect(of(events, "turn-end")[0]?.reply).toBe("Let me look.\n\nNothing on kilns.");
    });

    it("emits a call to remember as a remember event", async () => {
        const fake = fakeRecall({ mcp__memory__remember: { text: "kept" } });
        const { conversation, events } = session(
            [{ chunks: toolChunks("r1", "mcp__memory__remember", { fact: "x" }) }, { chunks: textChunks("Noted.") }],
            { recall: RECALL, connect: async () => fake.recall },
        );
        conversation.send("remember x");
        await until(() => ended(events));
        expect(of(events, "remember")[0]).toMatchObject({ id: "r1", ok: true, input: { fact: "x" }, output: "kept" });
        expect(of(events, "lookup")).toHaveLength(0);
    });

    it("warns once and chats on when recall fails to start", async () => {
        const { conversation, model, events } = session([{ chunks: textChunks("hi") }], {
            recall: RECALL,
            connect: async () => {
                throw new Error("spawn failed");
            },
        });
        conversation.send("hi");
        await until(() => ended(events));
        expect(of(events, "warning").map((event) => event.message)).toEqual(["memory: recall is unavailable (spawn failed)"]);
        expect(model.doStreamCalls[0]?.tools ?? []).toHaveLength(0);
        expect(of(events, "turn-end")).toHaveLength(1);
    });

    it("settles a lookup cut short by an interrupt as failed", async () => {
        const slow = tool({
            inputSchema: jsonSchema({ type: "object" }),
            execute: (_input, { abortSignal }) =>
                new Promise((_resolve, reject) => {
                    abortSignal?.addEventListener("abort", () => reject(new Error("aborted")));
                }),
        });
        const { conversation, events } = session(
            [{ chunks: toolChunks("c1", "mcp__memory__search", {}) }],
            { recall: RECALL, connect: async () => ({ tools: { mcp__memory__search: slow }, close: async () => {} }) },
        );
        conversation.send("look");
        await until(() => of(events, "sdk").some((event) => event.message.type === "tool-call"));
        await conversation.interrupt();
        await until(() => ended(events));
        expect(of(events, "lookup")[0]).toMatchObject({ id: "c1", ok: false });
        expect(of(events, "turn-end")[0]).toMatchObject({ interrupted: true });
    });

    it("lets a tool call in flight finish when the session closes", async () => {
        let finished = false;
        const slow = tool({
            inputSchema: jsonSchema({ type: "object" }),
            execute: async () => {
                await new Promise((resolve) => setTimeout(resolve, 50));
                finished = true;
                return { content: [{ type: "text", text: "{}" }], isError: false };
            },
        });
        let closed = false;
        const { conversation, events } = session(
            [{ chunks: toolChunks("c1", "mcp__memory__search", {}) }, { chunks: textChunks("done") }],
            {
                recall: RECALL,
                connect: async () => ({
                    tools: { mcp__memory__search: slow },
                    close: async () => {
                        closed = true;
                    },
                }),
            },
        );
        conversation.send("look");
        await until(() => of(events, "sdk").some((event) => event.message.type === "tool-call"));
        await conversation.close();
        expect(finished).toBe(true);
        expect(of(events, "lookup")[0]).toMatchObject({ id: "c1", ok: true });
        expect(closed).toBe(true);
    });

    it("closes the recall server when the session closes", async () => {
        const fake = fakeRecall({});
        const { conversation, events } = session([{ chunks: textChunks("hi") }], { recall: RECALL, connect: async () => fake.recall });
        await until(() => of(events, "ready").length === 1);
        await conversation.close();
        expect(fake.closed()).toBe(true);
    });
});

describe("Conversation on the wire", () => {
    it("carries two cache breakpoints after six turns, under Anthropic's four", async () => {
        const server = fakeMessages(Array.from({ length: 6 }, (_, index) => ({ text: `reply ${index}` })));
        try {
            const conversation = new Conversation({ env, route: [{ ...OPUS, baseUrl: server.url }] });
            const events: ConversationEvent[] = [];
            conversation.subscribe((event) => events.push(event));
            conversation.start();
            for (let index = 0; index < 6; index += 1) {
                conversation.send(`message ${index}`);
                await until(() => ended(events, index + 1));
            }
            await conversation.close();
            expect(JSON.stringify(server.bodies[5]).match(/cache_control/g) ?? []).toHaveLength(2);
        } finally {
            server.stop();
        }
    });
});

describe("Conversation on a route of two", () => {
    const B: RouteEntry = { ...anthropicEntry("claude-sonnet-5-5"), provider: "other" };

    it("replays a turn that failed after lookups alone on the next entry", async () => {
        const fake = fakeRecall({ mcp__memory__search: { text: "{}" } });
        const first = mockModel([
            { chunks: toolChunks("c1", "mcp__memory__search", {}) },
            new APICallError({ message: "overloaded", url: "u", requestBodyValues: {}, statusCode: 529 }),
        ]);
        const second = mockModel([{ chunks: textChunks("From B.") }], B.model);
        const conversation = new Conversation({
            env,
            route: [OPUS, B],
            recall: RECALL,
            connect: async () => fake.recall,
            model: (entry) => (entry.model === OPUS.model ? first : second),
        });
        const events: ConversationEvent[] = [];
        conversation.subscribe((event) => events.push(event));
        conversation.start();
        conversation.send("look");
        await until(() => ended(events));
        expect(of(events, "turn-end")[0]).toMatchObject({ reply: "From B.", model: "other:claude-sonnet-5-5" });
        expect(of(events, "warning").map((event) => event.message)[0]).toStartWith("anthropic:claude-opus-5-5 refused (overload:");
    });

    it("never replays a turn whose text has streamed", async () => {
        const first = mockModel([
            {
                chunks: [
                    START,
                    { type: "text-start", id: "t" },
                    { type: "text-delta", id: "t", delta: "Half" },
                    { type: "error", error: new APICallError({ message: "reset", url: "u", requestBodyValues: {}, statusCode: 500 }) },
                    { type: "finish", usage: mockUsage(), finishReason: { unified: "error", raw: undefined } },
                ],
            },
        ]);
        const second = mockModel([{ chunks: textChunks("never") }], B.model);
        const conversation = new Conversation({ env, route: [OPUS, B], model: (entry) => (entry.model === OPUS.model ? first : second) });
        const events: ConversationEvent[] = [];
        conversation.subscribe((event) => events.push(event));
        conversation.start();
        conversation.send("hi");
        await until(() => ended(events));
        expect(of(events, "error")[0]).toMatchObject({ partial: "Half" });
        expect(second.doStreamCalls).toHaveLength(0);
    });

    it("sends another model no reasoning the first one made", async () => {
        const cooldowns = new Cooldowns({ now: () => 0 });
        const first = mockModel([
            {
                chunks: [
                    START,
                    { type: "reasoning-start", id: "r" },
                    { type: "reasoning-delta", id: "r", delta: "thinking hard" },
                    { type: "reasoning-end", id: "r" },
                    ...textChunks("A says hi").slice(1),
                ],
            },
        ]);
        const second = mockModel([{ chunks: textChunks("B says hi") }], B.model);
        const conversation = new Conversation({
            env,
            route: [OPUS, B],
            cooldowns,
            model: (entry) => (entry.model === OPUS.model ? first : second),
        });
        const events: ConversationEvent[] = [];
        conversation.subscribe((event) => events.push(event));
        conversation.start();
        conversation.send("one");
        await until(() => ended(events));
        cooldowns.note(OPUS, { class: "usage", message: "spent", retryAfterMs: 60_000 });
        conversation.send("two");
        await until(() => ended(events, 2));
        const sent = JSON.stringify(second.doStreamCalls[0]?.prompt);
        expect(sent).toContain("A says hi");
        expect(sent).not.toContain("thinking hard");
    });
});

describe("conversationSetup", () => {
    it("is the persona alone, without history", () => {
        expect(conversationSetup().system).toBe(personaPrompt({ recall: false, mode: "chat" }));
    });

    it("puts the memory block and earlier sessions between the persona and the history", () => {
        const history = [{ role: "user" as const, text: "hi" }];
        expect(conversationSetup({ memory: "MEMORY", earlier: "EARLIER", history }).system).toBe(
            withHistory(withSection(withSection(personaPrompt({ recall: false, mode: "chat" }), "MEMORY"), "EARLIER"), history),
        );
    });

    it("offers recollect only with recall and when asked", () => {
        expect(conversationSetup({ recall: RECALL, recollect: true }).recollect).toBe(true);
        expect(conversationSetup({ recall: RECALL }).recollect).toBe(false);
        expect(conversationSetup({ recollect: true }).recollect).toBe(false);
    });

    it("names the route's models at the end in development mode", () => {
        const system = conversationSetup({ persona: "development" }).system;
        expect(system.endsWith("Your chat runs on the first of these models to answer: anthropic:claude-opus-5-5.")).toBe(true);
        expect(conversationSetup().system).not.toContain("models to answer");
    });
});
```

In `packages/agent/src/persona.test.ts`: remove the `baseOptions`,
`cliOptions` and `prepareCliHome` imports' tests only if Step 5 removes
them (it does not; Task 11 does); add:

```ts
it("names the route's models in a line", () => {
    expect(routeLine([anthropicEntry("claude-opus-5-5"), { ...anthropicEntry("x"), provider: "other" }])).toBe(
        "Your chat runs on the first of these models to answer: anthropic:claude-opus-5-5, other:x.",
    );
});
```

with `anthropicEntry` from `@dorothy/core` and `routeLine` from
`./persona.js`.

- [ ] **Step 3: Run them to see them fail**

Run:

```bash
bun test packages/agent/src/turn.test.ts packages/agent/src/conversation.test.ts packages/agent/src/persona.test.ts
```

Expected: FAIL: `turn.js` not found, and `Conversation` still the
Agent SDK's.

- [ ] **Step 4: Write `packages/agent/src/turn.ts`**

House header with this file's path, then:

```ts
// One chat turn's progress across its attempts: the reply, the calls
// awaiting results, the usage, and whether anything has happened that
// another model may not repeat.

import {
    type ConversationEvent,
    describeLookup,
    REMEMBER_TOOL,
    type StepUsage,
    type Tool,
    type TurnStats,
    toolOf,
} from "@dorothy/core";

type PendingCall = { tool: Tool; input: unknown; offset: number };
type PendingRemember = { input: unknown; offset: number };

// Characters as the note limits count them, four to a token.
export const estimate = (text: string) => Math.ceil([...text].length / 4);

// A tool result's text: text blocks, or a string.
export function textOf(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }
    return Array.isArray(content)
        ? content.map((block) => (typeof block?.text === "string" ? block.text : "")).join("")
        : "";
}

export class TurnState {
    reply = "";
    // Text has streamed or remember has run: no other model may take the
    // turn over.
    started = false;
    ttftMs: number | null = null;
    steps = 0;
    readonly #emit: (event: ConversationEvent) => void;
    readonly #began: number;
    readonly #usage: StepUsage = { noCache: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
    #lastInput = 0;
    // The next text starts a new step of the reply.
    #afterLookup = false;
    readonly #calls = new Map<string, PendingCall>();
    readonly #remembers = new Map<string, PendingRemember>();

    constructor(emit: (event: ConversationEvent) => void, began: number) {
        this.#emit = emit;
        this.#began = began;
    }

    text(delta: string, at: number): void {
        if (delta === "") {
            return;
        }
        // Text after a lookup starts a new step of the reply.
        const text = this.#afterLookup && this.reply !== "" ? `\n\n${delta}` : delta;
        this.#afterLookup = false;
        this.reply += text;
        this.started = true;
        this.ttftMs ??= Math.round(at - this.#began);
        this.#emit({ type: "delta", text });
    }

    // A call of recall's or of remember, kept until its result comes.
    call(id: string, name: string, input: unknown): void {
        const pending = { input, offset: this.reply.length };
        const tool = toolOf(name);
        if (tool !== null && !this.#calls.has(id)) {
            this.#calls.set(id, { tool, ...pending });
        }
        if (name === REMEMBER_TOOL && !this.#remembers.has(id)) {
            this.#remembers.set(id, pending);
            this.started = true;
        }
    }

    // An MCP result: failed when it says isError.
    result(id: string, output: unknown): void {
        const result = output as { content?: unknown; isError?: unknown } | undefined;
        this.#settle(id, result?.isError !== true, result?.content);
    }

    // A tool that threw, as when the recall server has gone.
    error(id: string): void {
        this.#settle(id, false, "");
    }

    #settle(id: string, ok: boolean, content: unknown): void {
        const kept = this.#remembers.get(id);
        if (kept !== undefined) {
            this.#remembers.delete(id);
            this.#afterLookup = true;
            this.#emit({ type: "remember", id, ok, offset: kept.offset, input: kept.input, output: textOf(content) });
            return;
        }
        const call = this.#calls.get(id);
        if (call !== undefined) {
            this.#calls.delete(id);
            this.#afterLookup = true;
            this.#emit({
                type: "lookup",
                id,
                ok,
                offset: call.offset,
                lookup: describeLookup(call.tool, call.input, ok ? textOf(content) : null),
            });
        }
    }

    // Calls the turn ended without answering, as when it was interrupted.
    settleCalls(): void {
        for (const id of [...this.#calls.keys(), ...this.#remembers.keys()]) {
            this.#settle(id, false, "");
        }
        this.#afterLookup = false;
    }

    step(usage: StepUsage): void {
        this.#usage.noCache += usage.noCache;
        this.#usage.cacheRead += usage.cacheRead;
        this.#usage.cacheWrite += usage.cacheWrite;
        this.#usage.output += usage.output;
        this.#lastInput = usage.noCache + usage.cacheRead + usage.cacheWrite;
        this.steps += 1;
    }

    stats(costUsd: number, sessionCostUsd: number, now: number): TurnStats {
        return {
            inputTokens: this.#usage.noCache,
            cacheReadTokens: this.#usage.cacheRead,
            cacheWriteTokens: this.#usage.cacheWrite,
            outputTokens: this.#usage.output,
            ttftMs: this.ttftMs,
            durationMs: Math.round(now - this.#began),
            costUsd,
            sessionCostUsd,
        };
    }

    // What the next request starts from: what the last one read, plus
    // the reply it added.
    contextTokens(): number {
        return this.#lastInput + estimate(this.reply);
    }
}
```

`settleCalls` settles lookups first, then remembers, as today's
`Conversation` does and `turn.test.ts` expects; a remember's failed
output is `""`.

- [ ] **Step 5: Change `packages/agent/src/persona.ts`**

Replace the comment above `personaComponents` ("The persona by purpose
... how to treat.") with:

```ts
// The persona by purpose, in the order the prompt joins them.
```

Replace the development-mode `plumbing` text (the `: sentences(` branch
after `chat ?`) with:

```ts
                : sentences(
                      "Your context holds these instructions and what",
                      "Dorothy's own software adds to them: your notes,",
                      "your earlier conversations and, at its end, the",
                      "models you run on. When asked about your context,",
                      "describe it faithfully and in full, including which",
                      "company, model and software you run on, quoting it",
                      "where that helps and saying where each part appears.",
                      "Say only what your context shows, and say so when",
                      "you are unsure.",
                  ),
```

and add, after `withHistory`:

```ts
// Development mode's closing line: the chat route's models, in the
// order they are tried.
export function routeLine(route: Route): string {
    return `Your chat runs on the first of these models to answer: ${route.map(label).join(", ")}.`;
}
```

importing `label` and `type Route` from `@dorothy/core`. The chat
persona's text is unchanged, so its byte-for-byte pin holds.

- [ ] **Step 6: Rewrite `packages/agent/src/conversation.ts`**

Keep its header; replace the rest with:

```ts
// Dorothy's chat session on her own runtime: the session's messages,
// held here, and a turn per message on the chat route through
// runRoute, streamed as core's ConversationEvents.

import {
    type AttemptResult,
    type ChatSession,
    CLOSE_GRACE_MS,
    type ConversationEvent,
    Cooldowns,
    defaultRoutes,
    type Env,
    type Failure,
    label,
    type RawMessage,
    REAL_TIMERS,
    type RecallLaunch,
    type Route,
    type RouteEntry,
    runRoute,
    type SessionStart,
    stepCost,
    type Timers,
    withSection,
} from "@dorothy/core";
import { type ModelMessage, stepCountIs, streamText } from "ai";
import { secretFailure, STALL_MS, Watchdog } from "./attempt.js";
import { stepUsage, unpricedNotice } from "./cost.js";
import { failureOf } from "./failures.js";
import { type PersonaMode, personaPrompt, routeLine, withHistory } from "./persona.js";
import { keyOf, languageModel, type ModelFactory, providerOptions } from "./providers.js";
import { type ConnectRecall, connectRecall, type RecallTools, recallEnv } from "./recall-tools.js";
import { TurnState } from "./turn.js";

export const MAX_STEPS = 10;
export const STEP_LIMIT_WARNING = "the reply stopped after ten tool steps";

// Anthropic's prompt cache: the system prompt, and the latest message.
const BREAKPOINT = { anthropic: { cacheControl: { type: "ephemeral" as const } } };

// A session's start and the persona it speaks with. Every field may be
// left out, for tests and the dump.
export type SessionSetup = Partial<SessionStart> & { persona?: PersonaMode };

export type ConversationSetup = {
    system: string;
    recall: RecallLaunch | null;
    recollect: boolean;
};

// What a session starts with, shared with memory's estimate of a
// compacted session and with --dump-context.
export function conversationSetup(
    { history = [], memory = "", earlier = "", recall = null, recollect = false, persona = "chat" }: SessionSetup = {},
    route: Route = defaultRoutes().chat,
): ConversationSetup {
    const prompt = withHistory(
        withSection(withSection(personaPrompt({ recall: recall !== null, mode: persona }), memory), earlier),
        history,
    );
    return {
        system: persona === "chat" ? prompt : `${prompt}\n\n${routeLine(route)}`,
        recall,
        recollect: recall !== null && recollect,
    };
}

export type ConversationDeps = {
    route?: Route;
    cooldowns?: Cooldowns;
    env?: Env;
    model?: ModelFactory;
    connect?: ConnectRecall;
    timers?: Timers;
    stallMs?: number;
    now?: () => number;
};

// A message, and the model that made it, null for the user's and for
// text kept from an interrupted turn.
type Stored = { message: ModelMessage; by: string | null };
type Answer = { messages: ModelMessage[]; limited: boolean };

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
        work,
        new Promise<void>((resolve) => {
            timer = setTimeout(resolve, ms);
        }),
    ]);
    clearTimeout(timer);
}

// A stream part as the raw pane shows it: its type, and a text part's
// text; never a prompt, a header or a key.
function rawOf(part: { type: string; text?: unknown }): RawMessage {
    return part.type === "text-delta"
        ? { type: part.type, event: { type: part.type, delta: part.text } }
        : { type: part.type };
}

// Reasoning belongs to the model that made it; another is sent none.
function withoutReasoning(message: ModelMessage): ModelMessage {
    if (message.role !== "assistant" || typeof message.content === "string") {
        return message;
    }
    return { ...message, content: message.content.filter((part) => part.type !== "reasoning") };
}

// The user's message as sent: on Anthropic it carries the second cache
// breakpoint, in this copy only, never in the stored session.
const outgoingUser = (text: string, entry: RouteEntry): ModelMessage => ({
    role: "user",
    content: [{ type: "text", text, ...(entry.kind === "anthropic" ? { providerOptions: BREAKPOINT } : {}) }],
});

export class Conversation implements ChatSession {
    readonly #listeners = new Set<(event: ConversationEvent) => void>();
    readonly #setup: ConversationSetup;
    readonly #route: Route;
    readonly #cooldowns: Cooldowns;
    readonly #env: Env;
    readonly #model: ModelFactory;
    readonly #connect: ConnectRecall;
    readonly #timers: Timers;
    readonly #stallMs: number;
    readonly #now: () => number;
    readonly #id = crypto.randomUUID();
    readonly #messages: Stored[] = [];
    #recall: RecallTools | null = null;
    #started: Promise<void> | null = null;
    #work: Promise<void> = Promise.resolve();
    #turn: AbortController | null = null;
    #interrupted = false;
    #closed: Promise<void> | null = null;
    #sessionCost = 0;

    constructor({
        route = defaultRoutes().chat,
        cooldowns = new Cooldowns(),
        env = process.env,
        model = languageModel,
        connect = connectRecall,
        timers = REAL_TIMERS,
        stallMs = STALL_MS,
        now = () => performance.now(),
        ...setup
    }: SessionSetup & ConversationDeps = {}) {
        this.#route = route;
        this.#cooldowns = cooldowns;
        this.#env = env;
        this.#model = model;
        this.#connect = connect;
        this.#timers = timers;
        this.#stallMs = stallMs;
        this.#now = now;
        this.#setup = conversationSetup(setup, route);
    }

    start(): void {
        this.#started ??= this.#begin();
    }

    subscribe(listener: (event: ConversationEvent) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    send(text: string): void {
        this.start();
        this.#work = this.#work.then(() => this.#runTurn(text));
    }

    async interrupt(): Promise<void> {
        if (this.#turn === null) {
            return;
        }
        this.#interrupted = true;
        this.#turn.abort();
    }

    // A turn under way may finish within the grace period; then it is
    // stopped, and the recall server closed. Safe to call twice.
    close(): Promise<void> {
        this.#closed ??= (async () => {
            await settleWithin(this.#work, CLOSE_GRACE_MS);
            this.#turn?.abort();
            await settleWithin(this.#work, CLOSE_GRACE_MS);
            // A recall server still starting is closed by #begin.
            await settleWithin(this.#started ?? Promise.resolve(), CLOSE_GRACE_MS);
            const recall = this.#recall;
            this.#recall = null;
            await recall?.close().catch(() => {});
        })();
        return this.#closed;
    }

    #emit(event: ConversationEvent): void {
        for (const listener of this.#listeners) {
            listener(event);
        }
    }

    async #begin(): Promise<void> {
        // ready is never emitted inside start(): callers subscribe after.
        await Promise.resolve();
        const { recall, recollect } = this.#setup;
        if (recall !== null) {
            try {
                this.#recall = await this.#connect(recall, recollect, recallEnv(this.#env, this.#route));
            } catch (error) {
                this.#emit({ type: "warning", message: `memory: recall is unavailable (${describeError(error)})` });
            }
        }
        if (this.#closed !== null) {
            const late = this.#recall;
            this.#recall = null;
            await late?.close().catch(() => {});
            return;
        }
        const first = this.#route[0];
        this.#emit({ type: "ready", model: first === undefined ? "none" : label(first), sessionId: this.#id });
    }

    async #runTurn(text: string): Promise<void> {
        await this.#started;
        if (this.#closed !== null) {
            return;
        }
        const turn = new TurnState((event) => this.#emit(event), this.#now());
        const controller = new AbortController();
        this.#turn = controller;
        this.#interrupted = false;
        const tried: RouteEntry[] = [];
        const outcome = await runRoute(
            this.#route,
            (entry, signal) => {
                tried.push(entry);
                return this.#attempt(entry, signal, text, turn);
            },
            { cooldowns: this.#cooldowns, signal: controller.signal, deadlineMs: null, timers: this.#timers },
        );
        this.#turn = null;
        turn.settleCalls();
        for (const note of outcome.notes) {
            this.#emit({ type: "warning", message: note });
        }
        this.#sessionCost += outcome.costUsd;
        const stats = turn.stats(outcome.costUsd, this.#sessionCost, this.#now());
        const user: Stored = { message: { role: "user", content: text }, by: null };
        if (outcome.ok) {
            const by = label(outcome.entry);
            this.#messages.push(user, ...outcome.value.messages.map((message) => ({ message, by })));
            if (outcome.value.limited) {
                this.#emit({ type: "warning", message: STEP_LIMIT_WARNING });
            }
            this.#emit({
                type: "turn-end",
                reply: turn.reply,
                interrupted: false,
                stats,
                contextTokens: turn.contextTokens(),
                model: by,
            });
            return;
        }
        if (outcome.failure.class === "cancelled" && this.#interrupted) {
            this.#messages.push(user);
            if (turn.reply !== "") {
                this.#messages.push({ message: { role: "assistant", content: turn.reply }, by: null });
            }
            const last = tried.at(-1);
            this.#emit({
                type: "turn-end",
                reply: turn.reply,
                interrupted: true,
                stats,
                contextTokens: turn.contextTokens(),
                ...(last === undefined ? {} : { model: label(last) }),
            });
            return;
        }
        if (this.#closed !== null) {
            return;
        }
        this.#emit({
            type: "error",
            message: outcome.reason,
            ...(turn.reply === "" ? {} : { partial: turn.reply }),
            ...(turn.steps === 0 ? {} : { stats }),
        });
    }

    #outgoing(entry: RouteEntry, text: string): ModelMessage[] {
        const by = label(entry);
        return [
            ...this.#messages.map(({ message, by: from }) =>
                from === null || from === by ? message : withoutReasoning(message),
            ),
            outgoingUser(text, entry),
        ];
    }

    async #attempt(
        entry: RouteEntry,
        signal: AbortSignal,
        text: string,
        turn: TurnState,
    ): Promise<AttemptResult<Answer>> {
        const key = keyOf(entry, this.#env);
        if (key === null) {
            return { ok: false, failure: secretFailure(entry), started: false, costUsd: 0 };
        }
        const watchdog = new Watchdog(signal, this.#stallMs, this.#timers);
        let costUsd = 0;
        let failure: Failure | null = null;
        let aborted = false;
        let limited = false;
        try {
            const result = streamText({
                model: this.#model(entry, key),
                instructions:
                    entry.kind === "anthropic"
                        ? { role: "system", content: this.#setup.system, providerOptions: BREAKPOINT }
                        : this.#setup.system,
                messages: this.#outgoing(entry, text),
                ...(this.#recall === null ? {} : { tools: this.#recall.tools }),
                stopWhen: stepCountIs(MAX_STEPS),
                maxRetries: 0,
                abortSignal: watchdog.signal,
                providerOptions: providerOptions(entry),
                onError: () => {},
            });
            for await (const part of result.fullStream) {
                watchdog.touch();
                this.#emit({ type: "sdk", message: rawOf(part) });
                switch (part.type) {
                    case "text-delta":
                        turn.text(part.text, this.#now());
                        break;
                    case "tool-call":
                        turn.call(part.toolCallId, part.toolName, part.input);
                        break;
                    case "tool-result":
                        turn.result(part.toolCallId, part.output);
                        break;
                    case "tool-error":
                        turn.error(part.toolCallId);
                        break;
                    case "finish-step": {
                        const usage = stepUsage(part.usage);
                        turn.step(usage);
                        const cost = stepCost(entry, usage);
                        if (cost === null) {
                            const notice = unpricedNotice(entry);
                            if (notice !== null) {
                                this.#emit({ type: "warning", message: notice });
                            }
                        }
                        costUsd += cost ?? 0;
                        limited = part.finishReason === "tool-calls";
                        break;
                    }
                    case "error":
                        failure ??= failureOf(part.error);
                        break;
                    case "abort":
                        aborted = true;
                        break;
                }
            }
            if (aborted) {
                return { ok: false, failure: watchdog.failure(), started: turn.started, costUsd };
            }
            if (failure !== null) {
                return { ok: false, failure, started: turn.started, costUsd };
            }
            const steps = await result.steps;
            return { ok: true, value: { messages: steps.flatMap((step) => step.response.messages), limited }, costUsd };
        } catch (error) {
            return {
                ok: false,
                failure: watchdog.signal.aborted ? watchdog.failure() : failureOf(error),
                started: turn.started,
                costUsd,
            };
        } finally {
            watchdog.dispose();
            turn.settleCalls();
        }
    }
}
```

- [ ] **Step 7: Update the exports and the TUI's estimate**

`packages/agent/src/index.ts`: export `Conversation`, `type
ConversationDeps`, `conversationSetup`, `type ConversationSetup`,
`MAX_STEPS`, `type SessionSetup` from `./conversation.js`;
`conversationOptions` from `./legacy.js`; `routeLine` beside the other
persona exports; `connectRecall`, `type ConnectRecall`, `recallEnv` and
`type RecallTools` from `./recall-tools.js`. Its opening comment
becomes:

```ts
// @dorothy/agent: Dorothy's model side, the only package that talks to
// a model provider's SDK: a session, a structured call, her persona's
// prompts, the one-shot reply, and the request capture behind
// --dump-context.
```

In `packages/cli/src/run-tui.ts`, `prompts.session` becomes:

```ts
            session: (start) => conversationSetup({ ...start, persona }).system,
```

importing `conversationSetup` in place of `conversationOptions`.

- [ ] **Step 8: Run the tests**

Run: `bun test packages/agent packages/cli`
Expected: PASS. A failing `conversation.test.ts` case is fixed in
`conversation.ts` or `turn.ts`, never by loosening the test; if a stream
part's field differs from the AI SDK's types, read
`node_modules/ai/dist/index.d.ts` (`TextStreamPart`) and follow it.

- [ ] **Step 9: Commit**

Run `bun run format && bun run lint:header && bun run check`
on temporary XDG roots
first.

```bash
git add packages/agent packages/cli
git commit -m "feat(agent): Run chat on the AI SDK"
```

---

### Task 10: The one-shot reply and `--dump-context` through `Conversation`

**Files:**

- Rewrite: `packages/agent/src/one-shot.ts`, `packages/agent/src/one-shot.test.ts`
- Modify: `packages/agent/src/capture.ts` (`captureServer` takes
  `/chat/completions` too; `dumpRequest` rewritten),
  `packages/agent/src/capture.test.ts`
- Delete: `packages/agent/src/legacy.ts`
- Create: `packages/cli/src/models.ts`
- Modify: `packages/cli/src/dump.ts`, `packages/cli/src/dump.test.ts`
- Modify: `packages/agent/src/index.ts`

**Interfaces:**

- Consumes: Task 9's `Conversation`, `ConversationDeps`, `SessionSetup`,
  `conversationSetup`, `routeLine`; Task 2's `defaultRoutes`,
  `anthropicEntry`, `Cooldowns`.
- Produces:
  - `runOneShot(prompt: string, persona: PersonaMode, deps?: OneShotDeps):
    Promise<void>`, `type OneShotDeps = ConversationDeps & { write?: {
    out: (text: string) => void; err: (text: string) => void } }`.
  - `DUMP_KEY = "DOROTHY_DUMP_KEY"`; `dumpRequest({ setup, message, entry,
    env?, connect? }): Promise<unknown | null>`.
  - `packages/cli/src/models.ts`: `ROUTES: Routes`, `COOLDOWNS:
    Cooldowns`, `chatEntry(): RouteEntry`.
  - `runDump(request, { env?, dump?, write? })`, `dump` defaulting to
    `dumpRequest`.

- [ ] **Step 1: Write the failing tests**

Replace `packages/agent/src/one-shot.test.ts`, keeping its header, with:

```ts
import { afterEach, describe, expect, it } from "bun:test";
import { defaultRoutes } from "@dorothy/core";
import { APICallError } from "ai";
import { runOneShot } from "./one-shot.js";
import { personaPrompt, routeLine } from "./persona.js";
import { mockModel, mockUsage, textChunks } from "./testing.js";

const env = { ANTHROPIC_API_KEY: "test-key" };

function writer() {
    const out: string[] = [];
    const err: string[] = [];
    return {
        out,
        err,
        write: { out: (text: string) => out.push(text), err: (text: string) => err.push(text) },
    };
}

describe("runOneShot", () => {
    afterEach(() => {
        process.exitCode = 0;
    });

    it("streams a reply and ends the line", async () => {
        const model = mockModel([{ chunks: textChunks("Hello") }]);
        const output = writer();
        await runOneShot("hi", "chat", { env, model: () => model, write: output.write });
        expect(output.out.join("")).toBe("Hello\n");
        expect(output.err).toEqual([]);
        expect(process.exitCode).not.toBe(1);
    });

    it("speaks with the persona it is given, offering no tools", async () => {
        const model = mockModel([{ chunks: textChunks("Hello") }]);
        await runOneShot("hi", "development", { env, model: () => model, write: writer().write });
        expect(model.doStreamCalls[0]?.prompt[0]).toMatchObject({
            role: "system",
            content: `${personaPrompt({ recall: false, mode: "development" })}\n\n${routeLine(defaultRoutes().chat)}`,
        });
        expect(model.doStreamCalls[0]?.tools ?? []).toHaveLength(0);
    });

    it("fails on a refusal, saying why on stderr", async () => {
        const model = mockModel([new APICallError({ message: "overloaded", url: "u", requestBodyValues: {}, statusCode: 529 })]);
        const output = writer();
        await runOneShot("hi", "chat", { env, model: () => model, write: output.write });
        expect(output.err).toEqual(["overloaded\n"]);
        expect(process.exitCode).toBe(1);
    });

    it("keeps the reply streamed before a failure", async () => {
        const model = mockModel([
            {
                chunks: [
                    { type: "stream-start", warnings: [] },
                    { type: "text-start", id: "t" },
                    { type: "text-delta", id: "t", delta: "Half" },
                    { type: "error", error: new APICallError({ message: "reset", url: "u", requestBodyValues: {}, statusCode: 500 }) },
                    { type: "finish", usage: mockUsage(), finishReason: { unified: "error", raw: undefined } },
                ],
            },
        ]);
        const output = writer();
        await runOneShot("hi", "chat", { env, model: () => model, write: output.write });
        expect(output.out.join("")).toBe("Half");
        expect(output.err).toEqual(["reset\n"]);
        expect(process.exitCode).toBe(1);
    });

    it("fails without a key", async () => {
        const output = writer();
        await runOneShot("hi", "chat", { env: {}, model: () => mockModel([]), write: output.write });
        expect(output.err).toEqual(["ANTHROPIC_API_KEY is not set\n"]);
        expect(process.exitCode).toBe(1);
    });
});
```

In `packages/agent/src/capture.test.ts`, keep the `captureServer` tests;
replace the `dumpRequest` tests with:

```ts
describe("dumpRequest", () => {
    const FAKE_MCP = join(import.meta.dir, "fake-mcp.ts");
    const OPUS = anthropicEntry("claude-opus-5-5");

    it("returns the first request a chat would send, captured on loopback", async () => {
        const body = (await dumpRequest({ setup: {}, message: "hi", entry: OPUS, env: {} })) as Record<string, unknown>;
        expect(body.model).toBe("claude-opus-5-5");
        expect(body.system).toEqual([
            { type: "text", text: personaPrompt({ recall: false, mode: "chat" }), cache_control: { type: "ephemeral" } },
        ]);
        expect(body.messages).toEqual([
            { role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }] },
        ]);
    });

    it("carries the recall tools a chat would offer", async () => {
        const body = (await dumpRequest({
            setup: { recall: { command: process.execPath, args: [FAKE_MCP] } },
            message: "hi",
            entry: OPUS,
            env: { PATH: process.env.PATH ?? "" },
        })) as { tools: { name: string }[] };
        expect(body.tools.map((tool) => tool.name).sort()).toEqual([
            "mcp__memory__open",
            "mcp__memory__remember",
            "mcp__memory__search",
            "mcp__memory__tags",
        ]);
    });
});
```

and add to the `captureServer` tests:

```ts
    it("records a Chat Completions request too, answering in its shape", async () => {
        const server = captureServer();
        try {
            const response = await fetch(`${server.url}/v1/chat/completions`, {
                method: "POST",
                body: JSON.stringify({ model: "m" }),
            });
            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({
                error: { type: "invalid_request_error", message: "dorothy --dump-context" },
            });
            expect(server.bodies).toEqual([{ model: "m" }]);
        } finally {
            server.stop();
        }
    });
```

with `join` from `node:path`, `anthropicEntry` from `@dorothy/core` and
`personaPrompt` from `./persona.js` imported.

In `packages/cli/src/dump.test.ts`, the `queryFn` fakes give way to a
`dump` fake that records its options:

```ts
const recording = (body: unknown = { model: "claude-opus-5-5" }) => {
    const seen: Parameters<typeof dumpRequest>[0][] = [];
    const dump = async (options: Parameters<typeof dumpRequest>[0]) => {
        seen.push(options);
        return body;
    };
    return { seen, dump };
};
```

Each test that passed `queryFn` passes `dump: fake.dump`, and asserts on
`fake.seen[0]`: its `message`, its `setup.persona`, its
`setup.history`, `memory` and `recall` as the old tests asserted on the
options' prompt, and `entry` equal to `chatEntry()`. The test of a
silent CLI becomes: a `dump` answering `null` prints
`dorothy: the chat sent no request to dump` and returns 1.

- [ ] **Step 2: Run them to see them fail**

Run:

```bash
bun test packages/agent/src/one-shot.test.ts packages/agent/src/capture.test.ts packages/cli/src/dump.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Rewrite `packages/agent/src/one-shot.ts`**

Keep its header; replace the rest with:

```ts
// One reply, streamed to stdout, for dorothy <prompt>: no memory, no
// recall, no transcript. A session of its own, so that it sends what a
// chat sends; a failure is said on stderr, and the exit code set.

import { Conversation, type ConversationDeps } from "./conversation.js";
import type { PersonaMode } from "./persona.js";

export type OneShotDeps = ConversationDeps & {
    write?: { out: (text: string) => void; err: (text: string) => void };
};

const STDIO = {
    out: (text: string) => {
        process.stdout.write(text);
    },
    err: (text: string) => {
        process.stderr.write(text);
    },
};

export async function runOneShot(
    prompt: string,
    persona: PersonaMode,
    { write = STDIO, ...deps }: OneShotDeps = {},
): Promise<void> {
    const conversation = new Conversation({ ...deps, persona });
    const done = new Promise<void>((resolve) => {
        conversation.subscribe((event) => {
            switch (event.type) {
                case "delta":
                    write.out(event.text);
                    break;
                case "warning":
                    write.err(`dorothy: ${event.message}\n`);
                    break;
                case "turn-end":
                    write.out("\n");
                    resolve();
                    break;
                case "error":
                    write.err(`${event.message}\n`);
                    process.exitCode = 1;
                    resolve();
                    break;
            }
        });
    });
    conversation.start();
    conversation.send(prompt);
    await done;
    await conversation.close();
}
```

- [ ] **Step 4: Rewrite `dumpRequest` in `packages/agent/src/capture.ts`**

Replace the Agent SDK import and `CaptureQueryFn` with the imports
below; in `captureServer`, record a POST whose path ends `/messages` or
`/chat/completions`, answering the second with
`{ error: { type: "invalid_request_error", message: "dorothy --dump-context" } }`
(status 400) and the first as now. Replace `dumpRequest` with:

```ts
import type { Env, RouteEntry } from "@dorothy/core";
import { Conversation, type SessionSetup } from "./conversation.js";
import type { ConnectRecall } from "./recall-tools.js";

// The stand-in key the dump's entry names: the capture server never
// reads it, and no real key is ever sent there.
export const DUMP_KEY = "DOROTHY_DUMP_KEY";

// The first request a chat on this entry would send, as it would send
// it, recall tools included: a session of its own, pointed at the
// capture server with a stand-in key and no fallback, closed once the
// server has answered.
export async function dumpRequest({
    setup,
    message,
    entry,
    env = process.env,
    connect,
}: {
    setup: SessionSetup;
    message: string;
    entry: RouteEntry;
    env?: Env;
    connect?: ConnectRecall;
}): Promise<unknown | null> {
    const server = captureServer();
    const conversation = new Conversation({
        ...setup,
        route: [{ ...entry, baseUrl: server.url, key: DUMP_KEY }],
        env: { ...env, [DUMP_KEY]: "dorothy --dump-context" },
        ...(connect === undefined ? {} : { connect }),
    });
    try {
        const done = new Promise<void>((resolve) => {
            conversation.subscribe((event) => {
                if (event.type === "turn-end" || event.type === "error") {
                    resolve();
                }
            });
        });
        conversation.start();
        conversation.send(message);
        await done;
        return server.bodies[0] ?? null;
    } finally {
        await conversation.close();
        server.stop();
    }
}
```

`recallEnv` drops `DOROTHY_DUMP_KEY` from the recall server's
environment, as the dump's route entry names it.

- [ ] **Step 5: Write `packages/cli/src/models.ts`**

House header with this file's path, then:

```ts
// The routes Dorothy's calls take, each role's default model on
// Anthropic until config.toml routes them, and the refusals this process
// has met: one record, shared by every call, so that a refusal one call
// meets is skipped by the next.

import { Cooldowns, defaultRoutes, type RouteEntry, type Routes } from "@dorothy/core";

export const ROUTES: Routes = defaultRoutes();

export const COOLDOWNS = new Cooldowns();

// The entry a chat starts on, which --dump-context shows.
export function chatEntry(): RouteEntry {
    const entry = ROUTES.chat[0];
    if (entry === undefined) {
        throw new Error("the chat route has no entry");
    }
    return entry;
}
```

- [ ] **Step 6: Move `packages/cli/src/dump.ts` onto it**

Import `dumpRequest` and `type PersonaMode` from `@dorothy/agent` and
`chatEntry` from `./models.js`; the options take `dump?: typeof
dumpRequest` for `queryFn`; and:

```ts
    const body = await dump({
        setup: { ...preview.start, persona: request.persona },
        message: request.message,
        entry: chatEntry(),
        env,
    });
```

with `const { env = process.env, dump = dumpRequest, write = ... }`, and
the empty-body message `dorothy: the chat sent no request to dump`.

- [ ] **Step 7: Retire `legacy.ts`; update the exports**

Delete `packages/agent/src/legacy.ts`. In `index.ts`, export
`captureServer`, `DUMP_KEY` and `dumpRequest` from `./capture.js`,
`runOneShot` and `type OneShotDeps` from `./one-shot.js`, and drop
`conversationOptions` and `CaptureQueryFn`.

- [ ] **Step 8: Run the tests**

Run: `bun test packages/agent packages/cli`
Expected: PASS.

- [ ] **Step 9: Commit**

Run `bun run format && bun run lint:header && bun run check`
on temporary XDG roots
first.

```bash
git add packages/agent packages/cli
git commit -m "feat(agent): Send one-shots and dumps as chat"
```

---

### Task 11: Wire the routes into the CLI and retire the Agent SDK

**Files:**

- Modify: `packages/cli/src/index.ts` (`reviewAgent`, `forTheModel`,
  the `oneshot` runner)
- Modify: `packages/cli/src/run-tui.ts`
- Modify: `packages/cli/src/claude-hook.ts`, `packages/cli/src/claude.ts`,
  `packages/cli/src/review-backfill.ts` (its comment)
- Modify: `packages/agent/src/persona.ts`, `packages/agent/package.json`,
  `packages/agent/src/index.ts`; delete `packages/agent/src/result.ts`
- Modify: `workspace.test.ts`
- Test: `packages/cli/src/recall-tools.test.ts` (new), and the cli and
  agent tests the removals touch

**Interfaces:**

- Consumes: `ROUTES`, `COOLDOWNS` (Task 10); `structuredCall({ route,
  cooldowns, env })` (Task 7); `Conversation` with `route` and
  `cooldowns` (Task 9); `runOneShot(prompt, persona, deps)` (Task 10);
  `connectRecall`, `recallEnv` (Task 8).
- Produces: no package depends on `@anthropic-ai/claude-agent-sdk`.

- [ ] **Step 1: Write the integration test with her real recall server**

`packages/cli/src/recall-tools.test.ts`, house header, then:

```ts
import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectRecall, recallEnv } from "@dorothy/agent";
import { ROUTES } from "./models.js";

type Execute = (input: unknown, options: unknown) => Promise<{ isError?: boolean }>;

describe("her recall server, through the agent's client", () => {
    it("serves her tools on the root it is given, seeing no key", async () => {
        const root = mkdtempSync(join(tmpdir(), "dorothy-recall-"));
        const env = {
            ...process.env,
            XDG_DATA_HOME: join(root, "d"),
            XDG_CACHE_HOME: join(root, "c"),
            XDG_STATE_HOME: join(root, "s"),
            XDG_CONFIG_HOME: join(root, "cfg"),
            ANTHROPIC_API_KEY: "must-not-reach-the-server",
        };
        const launch = { command: process.execPath, args: [join(import.meta.dir, "index.ts"), "--recall-server"] };
        const recall = await connectRecall(launch, false, recallEnv(env, ROUTES.chat));
        try {
            expect(Object.keys(recall.tools).sort()).toEqual([
                "mcp__memory__open",
                "mcp__memory__remember",
                "mcp__memory__search",
                "mcp__memory__tags",
            ]);
            const search = recall.tools.mcp__memory__search as unknown as { execute: Execute };
            expect(await search.execute({ query: "teapot" }, { toolCallId: "1", messages: [] })).toMatchObject({
                isError: false,
            });
            expect(existsSync(join(root, "c", "dorothy", "recall.sqlite"))).toBe(true);
        } finally {
            await recall.close();
            rmSync(root, { recursive: true, force: true });
        }
    });
});
```

Run: `bun test packages/cli/src/recall-tools.test.ts`
Expected: the first test passes at once, pinning what Tasks 8 and 10
built against the real server (if it fails, the fault is in
`connectRecall` or `recallEnv`; fix there); the second fails until
`recall-launch.ts` passes `--no-env-file`.

Add to it, after the first test:

```ts
    it("hands the server no key, and Bun no project .env", () => {
        const env = { ANTHROPIC_API_KEY: "k", PATH: "/bin" };
        expect(recallEnv(env, ROUTES.chat).ANTHROPIC_API_KEY).toBeUndefined();
        expect(recallLaunch("phrase", null).args[0]).toBe("--no-env-file");
    });
```

importing `recallLaunch` from `./recall-launch.js`, and in
`packages/cli/src/recall-launch.ts` put `"--no-env-file"` first in
`args`, before the script's path, its comment gaining: "Bun reads no
.env of the directory it starts in; the recall server runs in one of
Dorothy's anyway (`recallCwd`)." Update `recall-launch`'s own test.

- [ ] **Step 2: Hand each caller its route in `packages/cli/src/index.ts`**

`reviewAgent` loses `stripClaude(env)` and `prepareCliHome`:

```ts
// Reviews for the service: Dorothy's secrets by path from this
// checkout, then the agent, whose calls name their own base URL and
// key, so nothing Claude Code exported reaches them. Off, and said, when
// either fails; the service keeps the reason in its log, as its stderr
// may be ignored.
export async function reviewAgent(
    deps: CredentialDeps = {},
): Promise<
    | { review: { call: StructuredCall; persona: string } }
    | { review: null; noReviews: string }
> {
    const write = deps.write ?? writeError;
    try {
        const env = deps.env ?? process.env;
        const failure = await loadCheckoutSecrets(env, deps);
        if (failure !== null) {
            throw new Error(`secrets.json did not load (${failure})`);
        }
        const { structuredCall, systemPrompt } = await import("@dorothy/agent");
        return {
            review: {
                call: structuredCall({ route: ROUTES.review, cooldowns: COOLDOWNS, env }),
                persona: systemPrompt,
            },
        };
    } catch (error) {
        const noReviews = error instanceof Error ? error.message : String(error);
        write(`dorothy: reviews are off: ${noReviews}\n`);
        return { review: null, noReviews };
    }
}
```

`forTheModel` becomes `loadCredentials` alone, its `prepare` option
gone (its comment: `// The modes that talk to the model load their
credentials first.`); its callers and tests follow. The `oneshot`
runner:

```ts
        await runOneShot(mode.prompt, mode.persona, { route: ROUTES.chat, cooldowns: COOLDOWNS });
```

- [ ] **Step 3: Route the TUI's calls in `packages/cli/src/run-tui.ts`**

```ts
        calls: {
            review: structuredCall({ route: ROUTES.review, cooldowns: COOLDOWNS }),
            compaction: structuredCall({ route: ROUTES.compaction, cooldowns: COOLDOWNS }),
        },
```

`prompts.session`:
`(start) => conversationSetup({ ...start, persona }, ROUTES.chat).system`,
and `connect`:

```ts
        connect: (start) => {
            const conversation = new Conversation({
                ...start,
                persona,
                route: ROUTES.chat,
                cooldowns: COOLDOWNS,
            });
            conversation.start();
            return conversation;
        },
```

- [ ] **Step 4: Retire the hook's environment surgery**

`loadAgent` takes the environment `runOnce` loaded the secrets into,
`loadAgent(env)`, and passes it as `structuredCall`'s `env`, so an
injected environment is the one reviews read.

In `packages/cli/src/claude-hook.ts`, delete `REVIEW_BASE_URL`,
`REVIEW_DROPPED`, `dropped`, `reviewEnv` and `stripClaude`, and the
`stripClaude(env)` call near line 200; `loadCheckoutSecrets` returns
`failure` without `chooseClaudeToken`; `loadAgent` becomes:

```ts
async function loadAgent(env: Env): Promise<Agent> {
    const { structuredCall, systemPrompt } = await import("@dorothy/agent");
    return {
        call: structuredCall({ route: ROUTES.review, cooldowns: COOLDOWNS, env }),
        persona: systemPrompt,
    };
}
```

Its opening comment becomes:

```ts
// dorothy --claude-hook: memory's hook process, given what its reviews
// need. Claude Code runs it with claude's environment: the gateway's
// URL, the launch, and claude's own variables and sign-in. Memory keeps
// that environment, to find the launch in it. Reviews name their own
// base URL and key, so none of it reaches them; Dorothy's secrets are
// loaded by path from this checkout, never the working directory's.
// The launch passes SOPS_AGE_KEY_FILE so another config directory cannot
// hide it. A review is billed to her API key, as chat is, and never
// reaches the stopped gateway or the live session.
```

In `packages/cli/src/claude.ts`, delete `withReviewBaseUrl` and its use:
`launchEnv` no longer sets `DOROTHY_ANTHROPIC_BASE_URL` (its comment
loses that sentence), and `catchUpEnv` is `passSopsKey({ ...env },
env)`, its comment losing the proxy. In
`packages/cli/src/review-backfill.ts`, the comment on `BackfillAgent`
loses "which drops Claude Code's variables".

The tests these removals break, each by name:

- `claude-hook.test.ts`, "the account Claude spends": keep its first
  case if it still holds without `chooseClaudeToken`, delete the rest
  (the `reviewEnv` case and the `it.each` "refuses a choice of %s",
  whose `SECRETS_INVALID` only `chooseClaudeToken` returned); the eval's
  own tests keep the token choice covered.
- `claude-hook.test.ts`, runHook "awaits Dorothy's secrets by checkout
  path once claude's variables are gone": claude's variables now stay;
  assert only the load path and that the agent loads lazily, and
  retitle it "awaits Dorothy's secrets by checkout path".
- `claude-hook.test.ts`, "sends a review through the user's proxy, and
  tells memory the environment it was given": delete.
- `index.test.ts`, "awaits the checkout loader before preparing the
  model" and the `it.each` "still prepares the model": drop `prepare`,
  the "prepared" event and the `prepared` flag.
- `index.test.ts`, "disables service reviews with a coded failure after
  stripping Claude variables": remove the two stripped-variable
  expectations inside its `load` fake, which would now throw and be
  taken for the `SOPS_FAILED` the test expects; retitle it "disables
  service reviews with a coded failure".
- `claude.test.ts`, "passes the user's own base URL on to the hook's
  reviews, and no other" and "starts its catch-ups where reviews find
  the user's own proxy": replace both with one test that a launch's and
  a catch-up's environments, with `ANTHROPIC_BASE_URL` set, carry no
  `DOROTHY_ANTHROPIC_BASE_URL`.

- [ ] **Step 5: Drop the Agent SDK from the agent**

```bash
cd packages/agent && bun remove @anthropic-ai/claude-agent-sdk && cd ../..
```

Delete `packages/agent/src/result.ts`. In `persona.ts`, delete
`baseOptions`, `cliHome`, `cliOptions` and `prepareCliHome`, with their
imports and comments, and their tests in `persona.test.ts`, whose
imports then left unused (`afterEach`, `beforeEach`, `chmodSync`,
`mkdirSync`, `mkdtempSync`, `rmSync`, `statSync`, `tmpdir`, `join`)
go too. `index.ts`
stops exporting `prepareCliHome`. `grep -rn
"claude-agent-sdk\|prepareCliHome\|cliOptions\|baseOptions" packages`
finds nothing outside `docs`.

- [ ] **Step 6: Pin the holder in `workspace.test.ts`**

Replace `const SDK = ...` and "leaves the Agent SDK to the agent" with:

```ts
// The Agent SDK, which nothing may declare now, and the AI SDK's
// packages, which only the agent may.
const AGENT_SDK = "@anthropic-ai/claude-agent-sdk";
const AI_SDK = /^(ai|@ai-sdk\/.+|@openrouter\/.+)$/;
```

```ts
    it("declares the Agent SDK nowhere", async () => {
        const holders: string[] = [];
        for (const name of Object.keys(GRAPH)) {
            if (AGENT_SDK in declared(await manifest(name))) {
                holders.push(name);
            }
        }
        expect(holders).toEqual([]);
    });

    it("leaves the AI SDK to the agent", async () => {
        const holders: string[] = [];
        for (const name of Object.keys(GRAPH)) {
            if (Object.keys(declared(await manifest(name))).some((dependency) => AI_SDK.test(dependency))) {
                holders.push(name);
            }
        }
        expect(holders).toEqual(["agent"]);
    });
```

and in "resolves only what a package declares", every
`Bun.resolveSync(SDK, from(X))` becomes `Bun.resolveSync("ai", from(X))`,
still expected to throw, with one more:
`expect(() => Bun.resolveSync("ai", from("agent"))).not.toThrow();`.

- [ ] **Step 7: Reinstall from clean and run the checks**

```bash
rm -rf node_modules packages/*/node_modules && bun install
```

Run: `bun run format && bun run check` on temporary XDG roots.
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A packages workspace.test.ts bun.lock
git commit -m "feat(cli): Route calls and retire the Agent SDK"
```

---

### Task 12: The guides and the README

**Files:**

- Modify: `README.md` (the opening line, Authentication)
- Rewrite: `packages/agent/AGENTS.md`
- Modify: `packages/core/AGENTS.md`, `packages/cli/AGENTS.md`,
  `packages/tui/AGENTS.md`, `AGENTS.md`

**Interfaces:** none; documentation only.

- [ ] **Step 1: The README**

`README.md:25`'s sentence on the Claude Agent SDK, with its "A later
iteration moves to Anthropic's Messages API.", is rewritten whole: she
runs on her own runtime, the Vercel AI SDK, reaching Anthropic's
Messages API with her own system prompt. `README.md:646-648`, on
`--dump-context` showing "whatever the SDK adds", now says the dump
shows exactly what Dorothy builds, her recall tools' schemas included.
Authentication's list and the paragraph after it become:

```markdown
- `ANTHROPIC_API_KEY`: the key Dorothy's own calls spend, her chat, her
  reviews and her compactions, through Anthropic's Messages API. A Max
  plan's monthly API credits cover it.
- `CLAUDE_CODE_OAUTH_TOKEN`: a Claude Pro/Max subscription token, minted
  by running `claude setup-token`, for `dorothy --claude` and the eval's
  `via = "claude"` clients, which run Claude Code itself.

With more than one Claude account, keep each token under its own name
beginning `CLAUDE_CODE_OAUTH_TOKEN`, such as
`CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2`, and choose the one eval spends by
setting `DOROTHY_CLAUDE_TOKEN_VAR` to its name. A name with no such
token stops eval before any model call.
```

- [ ] **Step 2: `packages/agent/AGENTS.md`**

Rewrite it, within 150 lines, header kept, to say:

- `@dorothy/agent` is Dorothy's model side, and the only package
  declaring a model provider's SDK: `ai`, `@ai-sdk/anthropic` and
  `@ai-sdk/mcp`, at a thin edge: core's contracts carry no SDK type.
  `zod` stays declared as the AI SDK's peer; never prune it.
- Its entry point's exports, as `index.ts` has them after Task 10.
- Files: `providers.ts` (models from route entries, base URL and key
  always explicit, no redirect, warnings off), `failures.ts` (errors to
  `Failure`), `cost.ts`, `attempt.ts` (`Watchdog`: the AI SDK's chunk
  timeouts miss a server that never answers), `structured.ts`,
  `recall-tools.ts` (the stdio client, its environment, the
  `mcp__memory__` names), `turn.ts`, `conversation.ts` (messages held
  here; cache breakpoints, the second never stored; reasoning kept to
  the model that made it; no fallback once text has streamed or
  remember has run), `one-shot.ts`, `capture.ts`, `persona.ts`
  (unchanged chat persona, its pin; development mode's route line),
  `testing.ts` and `fake-mcp.ts` (for tests only).
- Testing: wire tests on `fakeMessages`, behaviour on `mockModel`; no
  test reaches a provider.

Keep any section of the old file that still holds, such as the
persona's pin and `promptHash`.

- [ ] **Step 3: The other guides**

- `packages/core/AGENTS.md`: the routing contracts
  (`contracts/model.ts`), `models/` (`runRoute` decides and never reads
  HTTP; `Cooldowns` one per process; prices dated; `defaultRoutes`),
  `Clock`; `RawMessage` is any stream part's type now;
  `chooseClaudeToken` serves the eval alone. Within 150 lines.
- `packages/cli/AGENTS.md` (at its 150-line budget: reword, never add
  net lines): lines 31-33 and 131-132, on the Agent SDK's per-call
  environment, become the routes (`models.ts`) and the recall launch's
  environment (`recallEnv`, `recallCwd`, `--no-env-file`); line 47's
  "`openMemory` gets `structuredCall`" names its review and compaction
  calls; line 72 and 99-100, on `DOROTHY_ANTHROPIC_BASE_URL`, go.
- `packages/tui/AGENTS.md:24`: the `sdk` event is a stream part's type,
  with a text part's text.
- `AGENTS.md` (at 100 lines): "`workspace.test.ts` pins the graph, the
  entry points and the SDK's holder." stays true; change nothing unless
  a line names the Agent SDK.

- [ ] **Step 4: Lint and commit**

```bash
git add -A README.md AGENTS.md packages/*/AGENTS.md
bun run lint:md && bun run check
git commit -m "docs: Describe Dorothy's own runtime"
```

Expected: both pass; `agents.test.ts` holds every budget.

---

### Task 13: Verify live, and report

Run by the coordinating agent, not a subagent: it reads the real
`secrets.json`, the one sanctioned exception, on temporary XDG roots.

**Files:**

- Create: `docs/reports/2026-11-01-model-providers.md`

- [ ] **Step 1: A root of its own**

```bash
t=$(mktemp -d)
mkdir -p "$t/cfg/dorothy"
printf '[memory]\nidle-seconds = 10\n[compaction]\nsoft = 2000\nhard = 4000\ntail = 500\n' > "$t/cfg/dorothy/config.toml"
export XDG_DATA_HOME="$t/d" XDG_CACHE_HOME="$t/c" XDG_STATE_HOME="$t/s" XDG_CONFIG_HOME="$t/cfg"
export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"
```

- [ ] **Step 2: The one-shot reply and the dump**

```bash
bun run dev -- "Say hello in five words."
bun run dev -- --dump-context -- "Hello" | head -40
```

Expected: a five-word reply, exit 0; the dump's `model` is
`claude-opus-5-5`, its `system` carries `cache_control`, and its
`tools` are the four `mcp__memory__` names.

- [ ] **Step 3: A chat that recalls, reviews and compacts**

In a herdr pane with the environment of Step 1, run `bun run dev`. Send
"My kiln is called Brunhilde and fires at cone 6.", then "Search your
memory for kilns and tell me what you find.", then a few more turns
until the statusline's context passes 2,000 tokens. Wait past 10
seconds idle after a turn. Then quit.

Expected: the second reply shows a lookup line; the statusline shows a
nonzero cost; the transcript under `$XDG_DATA_HOME/dorothy` holds a
review's notes (`kind` note events, model
`anthropic:claude-sonnet-5-5`) and a compaction's clusters, each having
passed `validateReview` and `validateClusters` (a failure would show as
a warning on screen and no notes or clusters). A failure is
investigated before the merge, with `systematic-debugging`.

- [ ] **Step 4: Write the report**

`docs/reports/2026-11-01-model-providers.md`, header copied from
`docs/reports/2026-11-01-delivery.md`: the probe (Task 1's five
results), the planning departures above and any rulings the build
ledger records, and Steps 2-3 with their commands, output (abridged,
no secret, no personal text) and costs. Part B's verification is that
plan's.

- [ ] **Step 5: Commit**

```bash
git add docs/reports/2026-11-01-model-providers.md
bun run lint:md
git commit -m "docs: Report Model Providers' first part"
```
