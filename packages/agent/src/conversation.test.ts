// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/conversation.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    anthropicEntry,
    type ConversationEvent,
    Cooldowns,
    type RouteEntry,
    withSection,
} from "@dorothy/core";
import { APICallError, jsonSchema, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
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
import {
    fakeMessages,
    manualTimers,
    mockModel,
    mockUsage,
    type Script,
    textChunks,
    toolChunks,
} from "./testing.js";

const env = { ANTHROPIC_API_KEY: "test-key" };
const OPUS = anthropicEntry("claude-opus-5-5");
const START = { type: "stream-start", warnings: [] };

function session(
    scripts: Script[],
    options: SessionSetup & ConversationDeps = {},
) {
    const model = mockModel(scripts);
    const conversation = new Conversation({
        env,
        model: () => model,
        ...options,
    });
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
    events.filter(
        (event) => event.type === "turn-end" || event.type === "error",
    ).length >= count;

const of = <T extends ConversationEvent["type"]>(
    events: ConversationEvent[],
    type: T,
) =>
    events.filter((event): event is Extract<ConversationEvent, { type: T }> => {
        return event.type === type;
    });

// Recall tools that answer each call as results says, recording calls.
function fakeRecall(
    results: Record<string, { text: string; isError?: boolean }>,
) {
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
                        return {
                            content: [{ type: "text", text: result.text }],
                            isError: result.isError ?? false,
                        };
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
        expect(events[0]).toMatchObject({
            type: "ready",
            model: "anthropic:claude-opus-5-5",
        });
        expect(of(events, "ready")[0]?.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("streams deltas and ends the turn with its reply, stats and model", async () => {
        const { conversation, events } = session([
            {
                chunks: textChunks(
                    "Hello there",
                    mockUsage(1_000_000, 1_000_000),
                ),
            },
        ]);
        conversation.send("hi");
        await until(() => ended(events));
        expect(
            of(events, "delta")
                .map((event) => event.text)
                .join(""),
        ).toBe("Hello there");
        const end = of(events, "turn-end")[0];
        expect(end).toMatchObject({
            reply: "Hello there",
            interrupted: false,
            model: "anthropic:claude-opus-5-5",
        });
        expect(end?.stats).toMatchObject({
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            costUsd: 24,
            sessionCostUsd: 24,
        });
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
        expect(
            of(events, "turn-end").map((event) => event.stats.sessionCostUsd),
        ).toEqual([4, 8]);
    });

    it("re-emits each stream part as an sdk event, with a text part's text", async () => {
        const { conversation, events } = session([
            { chunks: textChunks("hi") },
        ]);
        conversation.send("hi");
        await until(() => ended(events));
        expect(of(events, "sdk").map((event) => event.message)).toContainEqual({
            type: "text-delta",
            event: { delta: "hi" },
        });
    });

    it("sends the system prompt and the latest message with cache breakpoints, storing neither", async () => {
        const scripts = Array.from({ length: 6 }, (_, index) => ({
            chunks: textChunks(`reply ${index}`),
        }));
        const { conversation, model, events } = session(scripts);
        for (let index = 0; index < 6; index += 1) {
            conversation.send(`message ${index}`);
            await until(() => ended(events, index + 1));
        }
        const last = model.doStreamCalls[5];
        expect(last?.prompt[0]).toMatchObject({
            role: "system",
            providerOptions: {
                anthropic: { cacheControl: { type: "ephemeral" } },
            },
        });
        const marked =
            JSON.stringify(last?.prompt).match(/cacheControl/g) ?? [];
        expect(marked).toHaveLength(2);
        expect(last?.prompt.at(-1)).toMatchObject({
            role: "user",
            content: [{ type: "text", text: "message 5" }],
        });
        expect(JSON.stringify(last?.prompt)).toContain("reply 4");
        expect(last?.providerOptions).toEqual({
            anthropic: {
                thinking: { type: "adaptive", display: "summarized" },
            },
        });
    });

    it("keeps an interrupted partial reply", async () => {
        const { conversation, events } = session([
            {
                chunks: [
                    START,
                    { type: "text-start", id: "t" },
                    { type: "text-delta", id: "t", delta: "Partial" },
                ],
                hang: true,
            },
        ]);
        conversation.send("hi");
        await until(() => of(events, "delta").length === 1);
        await conversation.interrupt();
        await until(() => ended(events));
        expect(of(events, "turn-end")[0]).toMatchObject({
            reply: "Partial",
            interrupted: true,
        });
        expect(of(events, "error")).toHaveLength(0);
    });

    it("ends a message queued behind recall's start as interrupted, calling no model", async () => {
        let start: (tools: RecallTools) => void = () => {};
        const recall = fakeRecall({});
        const { conversation, model, events } = session(
            [{ chunks: textChunks("later") }],
            {
                recall: RECALL,
                connect: () =>
                    new Promise<RecallTools>((resolve) => {
                        start = resolve;
                    }),
            },
        );
        conversation.send("hi");
        await conversation.interrupt();
        start(recall.recall);
        await until(() => ended(events));
        expect(of(events, "turn-end")[0]).toMatchObject({
            reply: "",
            interrupted: true,
        });
        expect(model.doStreamCalls).toHaveLength(0);
        conversation.send("again");
        await until(() => ended(events, 2));
        expect(of(events, "turn-end")[1]).toMatchObject({
            reply: "later",
            interrupted: false,
        });
        expect(model.doStreamCalls).toHaveLength(1);
        expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain("hi");
    });

    it("keeps working when a listener throws on turn-end", async () => {
        const { conversation, model, events } = session([
            { chunks: textChunks("one") },
            { chunks: textChunks("two") },
        ]);
        let thrown = false;
        conversation.subscribe((event) => {
            if (event.type === "turn-end" && !thrown) {
                thrown = true;
                throw new Error("listener bug");
            }
        });
        conversation.send("a");
        await until(() => of(events, "error").length === 1);
        expect(of(events, "error")[0]).toMatchObject({
            message: "listener bug",
        });
        conversation.send("b");
        await until(() => of(events, "turn-end").length === 2);
        expect(of(events, "turn-end")[1]).toMatchObject({ reply: "two" });
        expect(model.doStreamCalls).toHaveLength(2);
        await conversation.close();
    });

    it("keeps working when a listener throws on ready", async () => {
        const unhandled: unknown[] = [];
        const catcher = (reason: unknown) => unhandled.push(reason);
        process.on("unhandledRejection", catcher);
        try {
            const model = mockModel([{ chunks: textChunks("hello") }]);
            const conversation = new Conversation({
                env,
                model: () => model,
            });
            const events: ConversationEvent[] = [];
            conversation.subscribe((event) => events.push(event));
            let thrown = false;
            conversation.subscribe((event) => {
                if (event.type === "ready" && !thrown) {
                    thrown = true;
                    throw new Error("ready bug");
                }
            });
            conversation.send("a");
            await until(() => of(events, "turn-end").length === 1);
            expect(of(events, "error")[0]).toMatchObject({
                message: "ready bug",
            });
            expect(of(events, "turn-end")[0]).toMatchObject({
                reply: "hello",
            });
            await conversation.close();
            await new Promise((resolve) => setTimeout(resolve, 5));
            expect(unhandled).toEqual([]);
        } finally {
            process.off("unhandledRejection", catcher);
        }
    });

    it("keeps working when a listener throws on a warning at start", async () => {
        const unhandled: unknown[] = [];
        const catcher = (reason: unknown) => unhandled.push(reason);
        process.on("unhandledRejection", catcher);
        try {
            const model = mockModel([{ chunks: textChunks("hello") }]);
            const conversation = new Conversation({
                env,
                model: () => model,
                recall: RECALL,
                connect: async () => {
                    throw new Error("spawn failed");
                },
            });
            const events: ConversationEvent[] = [];
            conversation.subscribe((event) => events.push(event));
            conversation.subscribe((event) => {
                if (event.type === "warning") {
                    throw new Error("warning bug");
                }
            });
            conversation.send("a");
            await until(() => of(events, "turn-end").length === 1);
            expect(of(events, "ready")).toHaveLength(1);
            expect(of(events, "error")[0]).toMatchObject({
                message: "warning bug",
            });
            expect(of(events, "turn-end")[0]).toMatchObject({
                reply: "hello",
            });
            expect(model.doStreamCalls).toHaveLength(1);
            await conversation.close();
            await new Promise((resolve) => setTimeout(resolve, 5));
            expect(unhandled).toEqual([]);
        } finally {
            process.off("unhandledRejection", catcher);
        }
    });

    it("is not looped by a listener that throws on error too", async () => {
        const { conversation, events } = session([
            { chunks: textChunks("one") },
            { chunks: textChunks("two") },
        ]);
        conversation.subscribe((event) => {
            if (event.type === "turn-end" || event.type === "error") {
                throw new Error("always");
            }
        });
        conversation.send("a");
        await until(() => of(events, "error").length === 1);
        conversation.send("b");
        await until(() => of(events, "error").length === 2);
        await conversation.close();
        expect(of(events, "turn-end")).toHaveLength(2);
        expect(of(events, "error")).toHaveLength(2);
    });

    it("ignores interrupt while idle", async () => {
        const { conversation, events } = session([
            { chunks: textChunks("hi") },
        ]);
        await conversation.interrupt();
        expect(of(events, "error")).toHaveLength(0);
        conversation.send("hello");
        await until(() => ended(events));
        expect(of(events, "error")).toHaveLength(0);
        expect(of(events, "turn-end")[0]).toMatchObject({
            reply: "hi",
            interrupted: false,
        });
    });

    it("closes without an error, mid-reply too, and the recall server with it", async () => {
        const fake = fakeRecall({});
        const { conversation, events } = session(
            [{ chunks: [START], hang: true }],
            { recall: RECALL, connect: async () => fake.recall },
        );
        conversation.send("hi");
        await until(() => of(events, "sdk").length > 0);
        await conversation.close();
        await conversation.close();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(events.filter((event) => event.type === "error")).toHaveLength(
            0,
        );
        expect(of(events, "turn-end")).toHaveLength(0);
        expect(fake.closed()).toBe(true);
    });

    it("reports a provider's refusal as an error", async () => {
        const refusal = new APICallError({
            message: "overloaded",
            url: "u",
            requestBodyValues: {},
            statusCode: 529,
        });
        const { conversation, events } = session([refusal]);
        conversation.send("hi");
        await until(() => ended(events));
        expect(of(events, "error")[0]).toEqual({
            type: "error",
            message: "overloaded",
        });
    });

    it("hands a partial reply and its stats to the error when the stream fails", async () => {
        const { conversation, events } = session([
            {
                chunks: [
                    START,
                    { type: "text-start", id: "t" },
                    { type: "text-delta", id: "t", delta: "Half" },
                    {
                        type: "error",
                        error: new APICallError({
                            message: "reset",
                            url: "u",
                            requestBodyValues: {},
                            statusCode: 500,
                        }),
                    },
                    {
                        type: "finish",
                        usage: mockUsage(),
                        finishReason: { unified: "error", raw: undefined },
                    },
                ],
            },
        ]);
        conversation.send("hi");
        await until(() => ended(events));
        expect(of(events, "error")[0]).toMatchObject({
            message: "reset",
            partial: "Half",
        });
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
        expect(of(events, "error")[0]).toEqual({
            type: "error",
            message: "ANTHROPIC_API_KEY is not set",
        });
        expect(model.doStreamCalls).toHaveLength(0);
    });

    it("ends a turn that stalls", async () => {
        const timers = manualTimers();
        const { conversation, model, events } = session(
            [{ chunks: [START], hang: true }],
            { timers },
        );
        conversation.send("hi");
        await until(() => model.doStreamCalls.length === 1);
        timers.fire(60_000);
        await until(() => ended(events));
        expect(of(events, "error")[0]).toMatchObject({
            message: "no response for 60s",
        });
    });

    it("ends a turn whose provider never sends an event as a timeout", async () => {
        const timers = manualTimers();
        const { conversation, model, events } = session(
            [{ chunks: [], hang: true }],
            { timers },
        );
        conversation.send("hi");
        await until(() => model.doStreamCalls.length === 1);
        expect(timers.pending()).toEqual([60_000]);
        timers.fire(60_000);
        await until(() => ended(events));
        expect(of(events, "error")).toEqual([
            { type: "error", message: "no response for 60s" },
        ]);
    });

    it("does not stall on a long reasoning-only start", async () => {
        const timers = manualTimers();
        let rearmed = 0;
        let controller!: ReadableStreamDefaultController;
        const model = new MockLanguageModelV4({
            provider: "anthropic.messages",
            modelId: "claude-opus-5-5",
            doStream: async () => ({
                stream: new ReadableStream({
                    start(started) {
                        controller = started;
                    },
                }),
            }),
        });
        const { conversation, events } = session([], {
            model: () => model,
            timers: {
                ...timers,
                set: (fn, ms) => {
                    rearmed += 1;
                    return timers.set(fn, ms);
                },
            },
        });
        const push = async (chunk: unknown) => {
            const seen = of(events, "sdk").length;
            controller.enqueue(chunk as never);
            await until(() => of(events, "sdk").length > seen);
        };
        conversation.send("think");
        await until(() => controller !== undefined);
        controller.enqueue(START as never);
        const parts = [
            { type: "reasoning-start", id: "r" },
            { type: "reasoning-delta", id: "r", delta: "hmm" },
            { type: "reasoning-delta", id: "r", delta: "hmm, hmm" },
            { type: "reasoning-end", id: "r" },
        ];
        for (const part of parts) {
            const before = rearmed;
            await push(part);
            expect(rearmed).toBeGreaterThan(before);
            expect(timers.pending()).toEqual([60_000]);
        }
        for (const chunk of textChunks("Done thinking.").slice(1)) {
            controller.enqueue(chunk as never);
        }
        controller.close();
        await until(() => ended(events));
        expect(of(events, "error")).toHaveLength(0);
        expect(of(events, "turn-end")[0]).toMatchObject({
            reply: "Done thinking.",
            interrupted: false,
        });
    });

    it("disposes the stall timer when a turn ends, however it ends", async () => {
        const timers = manualTimers();
        const refusal = new APICallError({
            message: "overloaded",
            url: "u",
            requestBodyValues: {},
            statusCode: 529,
        });
        const { conversation, events } = session(
            [
                { chunks: textChunks("fine") },
                refusal,
                { chunks: [START], hang: true },
            ],
            { timers },
        );
        conversation.send("one");
        await until(() => ended(events));
        expect(of(events, "turn-end")).toHaveLength(1);
        expect(timers.pending()).toEqual([]);
        conversation.send("two");
        await until(() => ended(events, 2));
        expect(of(events, "error")).toHaveLength(1);
        expect(timers.pending()).toEqual([]);
        conversation.send("three");
        await until(() => timers.pending().length === 1);
        await conversation.interrupt();
        await until(() => ended(events, 3));
        expect(of(events, "turn-end")[1]).toMatchObject({ interrupted: true });
        expect(timers.pending()).toEqual([]);
    });

    it("warns when ten steps end in a tool call, and ends on the text it has", async () => {
        const { recall } = fakeRecall({ mcp__memory__search: { text: "{}" } });
        const { conversation, events } = session(
            [{ chunks: toolChunks("c", "mcp__memory__search", {}) }],
            { recall: RECALL, connect: async () => recall },
        );
        conversation.send("hi");
        await until(() => ended(events));
        expect(of(events, "lookup")).toHaveLength(MAX_STEPS);
        expect(of(events, "warning").map((event) => event.message)).toContain(
            STEP_LIMIT_WARNING,
        );
        expect(of(events, "turn-end")).toHaveLength(1);
    });
});

describe("Conversation with recall", () => {
    it("offers the recall tools, emitting each lookup where it happened", async () => {
        const fake = fakeRecall({
            mcp__memory__search: { text: '{"results":[]}' },
        });
        const { conversation, events } = session(
            [
                {
                    chunks: [
                        START,
                        { type: "text-start", id: "t" },
                        { type: "text-delta", id: "t", delta: "Let me look." },
                        { type: "text-end", id: "t" },
                        {
                            type: "tool-call",
                            toolCallId: "c1",
                            toolName: "mcp__memory__search",
                            input: '{"query":"kiln"}',
                        },
                        {
                            type: "finish",
                            usage: mockUsage(),
                            finishReason: {
                                unified: "tool-calls",
                                raw: "tool_use",
                            },
                        },
                    ],
                },
                { chunks: textChunks("Nothing on kilns.") },
            ],
            { recall: RECALL, connect: async () => fake.recall },
        );
        conversation.send("kiln?");
        await until(() => ended(events));
        expect(fake.calls).toEqual(["mcp__memory__search"]);
        expect(of(events, "lookup")[0]).toMatchObject({
            id: "c1",
            ok: true,
            offset: 12,
        });
        expect(of(events, "turn-end")[0]?.reply).toBe(
            "Let me look.\n\nNothing on kilns.",
        );
    });

    it("emits a call to remember as a remember event", async () => {
        const fake = fakeRecall({ mcp__memory__remember: { text: "kept" } });
        const { conversation, events } = session(
            [
                {
                    chunks: toolChunks("r1", "mcp__memory__remember", {
                        fact: "x",
                    }),
                },
                { chunks: textChunks("Noted.") },
            ],
            { recall: RECALL, connect: async () => fake.recall },
        );
        conversation.send("remember x");
        await until(() => ended(events));
        expect(of(events, "remember")[0]).toMatchObject({
            id: "r1",
            ok: true,
            input: { fact: "x" },
            output: "kept",
        });
        expect(of(events, "lookup")).toHaveLength(0);
    });

    it("warns once and chats on when recall fails to start", async () => {
        const { conversation, model, events } = session(
            [{ chunks: textChunks("hi") }],
            {
                recall: RECALL,
                connect: async () => {
                    throw new Error("spawn failed");
                },
            },
        );
        conversation.send("hi");
        await until(() => ended(events));
        expect(of(events, "warning").map((event) => event.message)).toEqual([
            "memory: recall is unavailable (spawn failed)",
        ]);
        expect(model.doStreamCalls[0]?.tools ?? []).toHaveLength(0);
        expect(of(events, "turn-end")).toHaveLength(1);
    });

    it("settles a lookup cut short by an interrupt as failed, keeping the partial reply", async () => {
        const slow = tool({
            inputSchema: jsonSchema({ type: "object" }),
            execute: (_input, { abortSignal }) =>
                new Promise((_resolve, reject) => {
                    abortSignal?.addEventListener("abort", () =>
                        reject(new Error("aborted")),
                    );
                }),
        });
        const { conversation, model, events } = session(
            [
                {
                    chunks: [
                        START,
                        { type: "text-start", id: "t" },
                        { type: "text-delta", id: "t", delta: "Let me look." },
                        { type: "text-end", id: "t" },
                        {
                            type: "tool-call",
                            toolCallId: "c1",
                            toolName: "mcp__memory__search",
                            input: "{}",
                        },
                        {
                            type: "finish",
                            usage: mockUsage(),
                            finishReason: {
                                unified: "tool-calls",
                                raw: "tool_use",
                            },
                        },
                    ],
                },
                { chunks: textChunks("Back.") },
            ],
            {
                recall: RECALL,
                connect: async () => ({
                    tools: { mcp__memory__search: slow },
                    close: async () => {},
                }),
            },
        );
        conversation.send("look");
        await until(() =>
            of(events, "sdk").some(
                (event) => event.message.type === "tool-call",
            ),
        );
        await conversation.interrupt();
        await until(() => ended(events));
        expect(of(events, "lookup")[0]).toMatchObject({ id: "c1", ok: false });
        expect(of(events, "turn-end")[0]).toMatchObject({
            reply: "Let me look.",
            interrupted: true,
        });
        expect(of(events, "error")).toHaveLength(0);
        // The session keeps the user's message and the partial text only.
        conversation.send("again");
        await until(() => ended(events, 2));
        const kept = model.doStreamCalls[1]?.prompt.map((message) => [
            message.role,
            typeof message.content === "string"
                ? message.content
                : message.content.map((part) => part.type),
        ]);
        expect(kept).toEqual([
            ["system", expect.any(String)],
            ["user", ["text"]],
            ["assistant", ["text"]],
            ["user", ["text"]],
        ]);
        expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
            "Let me look.",
        );
    });

    it("ends the attempt as cancelled, not thrown, when a listener throws on a lookup settled by an interrupt", async () => {
        const slow = tool({
            inputSchema: jsonSchema({ type: "object" }),
            execute: (_input, { abortSignal }) =>
                new Promise((_resolve, reject) => {
                    abortSignal?.addEventListener("abort", () =>
                        reject(new Error("aborted")),
                    );
                }),
        });
        const { conversation, events } = session(
            [{ chunks: toolChunks("c1", "mcp__memory__search", {}) }],
            {
                recall: RECALL,
                connect: async () => ({
                    tools: { mcp__memory__search: slow },
                    close: async () => {},
                }),
            },
        );
        conversation.subscribe((event) => {
            if (event.type === "lookup") {
                throw new Error("lookup listener bug");
            }
        });
        conversation.send("look");
        await until(() =>
            of(events, "sdk").some(
                (event) => event.message.type === "tool-call",
            ),
        );
        await conversation.interrupt();
        await until(() => ended(events));
        expect(of(events, "turn-end")[0]).toMatchObject({ interrupted: true });
        expect(of(events, "error")).toHaveLength(0);
        await conversation.close();
    });

    it("lets a tool call in flight finish when the session closes", async () => {
        let finished = false;
        const slow = tool({
            inputSchema: jsonSchema({ type: "object" }),
            execute: async () => {
                await new Promise((resolve) => setTimeout(resolve, 50));
                finished = true;
                return {
                    content: [{ type: "text", text: "{}" }],
                    isError: false,
                };
            },
        });
        let closed = false;
        const { conversation, events } = session(
            [
                { chunks: toolChunks("c1", "mcp__memory__search", {}) },
                { chunks: textChunks("done") },
            ],
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
        await until(() =>
            of(events, "sdk").some(
                (event) => event.message.type === "tool-call",
            ),
        );
        await conversation.close();
        expect(finished).toBe(true);
        expect(of(events, "lookup")[0]).toMatchObject({ id: "c1", ok: true });
        expect(closed).toBe(true);
    });

    it("closes the recall server when the session closes", async () => {
        const fake = fakeRecall({});
        const { conversation, events } = session(
            [{ chunks: textChunks("hi") }],
            { recall: RECALL, connect: async () => fake.recall },
        );
        await until(() => of(events, "ready").length === 1);
        await conversation.close();
        expect(fake.closed()).toBe(true);
    });
});

describe("Conversation on the wire", () => {
    it("carries two cache breakpoints after six turns, under Anthropic's four", async () => {
        const server = fakeMessages(
            Array.from({ length: 6 }, (_, index) => ({
                text: `reply ${index}`,
            })),
        );
        try {
            const conversation = new Conversation({
                env,
                route: [{ ...OPUS, baseUrl: server.url }],
            });
            const events: ConversationEvent[] = [];
            conversation.subscribe((event) => events.push(event));
            conversation.start();
            for (let index = 0; index < 6; index += 1) {
                conversation.send(`message ${index}`);
                await until(() => ended(events, index + 1));
            }
            await conversation.close();
            expect(
                JSON.stringify(server.bodies[5]).match(/cache_control/g) ?? [],
            ).toHaveLength(2);
        } finally {
            server.stop();
        }
    });
});

describe("Conversation on a route of two", () => {
    const B: RouteEntry = {
        ...anthropicEntry("claude-sonnet-5-5"),
        provider: "other",
    };

    it("replays a turn that failed after lookups alone on the next entry", async () => {
        const fake = fakeRecall({ mcp__memory__search: { text: "{}" } });
        const first = mockModel([
            { chunks: toolChunks("c1", "mcp__memory__search", {}) },
            new APICallError({
                message: "overloaded",
                url: "u",
                requestBodyValues: {},
                statusCode: 529,
            }),
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
        expect(of(events, "turn-end")[0]).toMatchObject({
            reply: "From B.",
            model: "other:claude-sonnet-5-5",
        });
        expect(
            of(events, "warning").map((event) => event.message)[0],
        ).toStartWith("anthropic:claude-opus-5-5 refused (overload:");
    });

    it("never replays a turn whose text has streamed", async () => {
        const first = mockModel([
            {
                chunks: [
                    START,
                    { type: "text-start", id: "t" },
                    { type: "text-delta", id: "t", delta: "Half" },
                    {
                        type: "error",
                        error: new APICallError({
                            message: "reset",
                            url: "u",
                            requestBodyValues: {},
                            statusCode: 500,
                        }),
                    },
                    {
                        type: "finish",
                        usage: mockUsage(),
                        finishReason: { unified: "error", raw: undefined },
                    },
                ],
            },
        ]);
        const second = mockModel([{ chunks: textChunks("never") }], B.model);
        const conversation = new Conversation({
            env,
            route: [OPUS, B],
            model: (entry) => (entry.model === OPUS.model ? first : second),
        });
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
                    {
                        type: "reasoning-delta",
                        id: "r",
                        delta: "thinking hard",
                    },
                    { type: "reasoning-end", id: "r" },
                    ...textChunks("A says hi").slice(1),
                ],
            },
        ]);
        const second = mockModel(
            [{ chunks: textChunks("B says hi") }],
            B.model,
        );
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
        cooldowns.note(OPUS, {
            class: "usage",
            message: "spent",
            retryAfterMs: 60_000,
        });
        conversation.send("two");
        await until(() => ended(events, 2));
        const sent = JSON.stringify(second.doStreamCalls[0]?.prompt);
        expect(sent).toContain("A says hi");
        expect(sent).not.toContain("thinking hard");
    });
});

describe("conversationSetup", () => {
    it("is the persona alone, without history", () => {
        expect(conversationSetup().system).toBe(
            personaPrompt({ recall: false, mode: "chat" }),
        );
    });

    it("puts the memory block and earlier sessions between the persona and the history", () => {
        const history = [{ role: "user" as const, text: "hi" }];
        expect(
            conversationSetup({ memory: "MEMORY", earlier: "EARLIER", history })
                .system,
        ).toBe(
            withHistory(
                withSection(
                    withSection(
                        personaPrompt({ recall: false, mode: "chat" }),
                        "MEMORY",
                    ),
                    "EARLIER",
                ),
                history,
            ),
        );
    });

    it("offers recollect only with recall and when asked", () => {
        expect(
            conversationSetup({ recall: RECALL, recollect: true }).recollect,
        ).toBe(true);
        expect(conversationSetup({ recall: RECALL }).recollect).toBe(false);
        expect(conversationSetup({ recollect: true }).recollect).toBe(false);
    });

    it("names the route's models at the end in development mode", () => {
        const system = conversationSetup({ persona: "development" }).system;
        expect(
            system.endsWith(
                "Your chat runs on the first of these models to answer: anthropic:claude-opus-5-5.",
            ),
        ).toBe(true);
        expect(conversationSetup().system).not.toContain("models to answer");
    });
});

describe("a model with no price", () => {
    it("warns once, as chat's warning, that its cost shows as $0", async () => {
        const { conversation, events } = session(
            [{ chunks: textChunks("one") }, { chunks: textChunks("two") }],
            { route: [anthropicEntry("claude-unpriced-chat-test")] },
        );
        conversation.send("hi");
        await until(() => ended(events));
        conversation.send("again");
        await until(() => ended(events, 2));
        expect(of(events, "warning").map((event) => event.message)).toEqual([
            "no price is known for anthropic:claude-unpriced-chat-test; its cost shows as $0",
        ]);
    });
});
