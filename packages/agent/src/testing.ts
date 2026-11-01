// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/testing.ts
//
//

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
            {
                type: "error",
                error: { type: reply.type, message: reply.message },
            },
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
    {
        type: "finish",
        usage,
        finishReason: { unified: "stop", raw: "end_turn" },
    },
];

export const toolChunks = (
    id: string,
    name: string,
    input: unknown,
    usage = mockUsage(),
): unknown[] => [
    { type: "stream-start", warnings: [] },
    {
        type: "tool-call",
        toolCallId: id,
        toolName: name,
        input: JSON.stringify(input),
    },
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
