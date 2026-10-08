// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/conversation.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { type ConversationEvent, type Turn, withSection } from "@dorothy/core";
import {
    COMPACTED_BY_CLI,
    Conversation,
    conversationOptions,
    type QueryFn,
} from "./conversation.js";
import {
    cliOptions,
    personaPrompt,
    systemPrompt,
    withHistory,
} from "./persona.js";

const WAIT_FOR_INTERRUPT = "wait-for-interrupt";
type Step = SDKMessage | typeof WAIT_FOR_INTERRUPT;

const init = () =>
    ({
        type: "system",
        subtype: "init",
        model: "test-model",
        session_id: "sdk-1",
    }) as unknown as SDKMessage;
const delta = (text: string) =>
    ({
        type: "stream_event",
        event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text },
        },
    }) as unknown as SDKMessage;
const result = (totalCostUsd: number, subtype = "success") =>
    ({
        type: "result",
        subtype,
        usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_input_tokens: 3000,
            cache_creation_input_tokens: 400,
        },
        total_cost_usd: totalCostUsd,
        duration_ms: 1500,
        ttft_ms: 300,
    }) as unknown as SDKMessage;
// How the CLI ends a turn the API refused (auth, rate limit, overload): a
// result flagged is_error, with the error text in place of the reply.
const apiError = (text: string) =>
    ({
        ...(result(0) as object),
        is_error: true,
        result: text,
    }) as unknown as SDKMessage;
const executionError = (errors: string[]) =>
    ({
        ...(result(0, "error_during_execution") as object),
        is_error: true,
        errors,
    }) as unknown as SDKMessage;
// What the CLI says each time a request's response arrives: the usage of
// that one request, not the turn's.
const usage = (input: number, cacheRead: number, cacheWrite: number) =>
    ({
        type: "assistant",
        message: {
            content: [],
            usage: {
                input_tokens: input,
                cache_read_input_tokens: cacheRead,
                cache_creation_input_tokens: cacheWrite,
                output_tokens: 1,
            },
        },
        parent_tool_use_id: null,
    }) as unknown as SDKMessage;
const compactBoundary = () =>
    ({
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { trigger: "auto", pre_tokens: 100 },
    }) as unknown as SDKMessage;

type Fake = {
    fn: QueryFn;
    options: Options | null;
    prompts: string[];
    interrupts: number;
    closed: boolean;
    inputEnded: boolean;
};

// Replays one scripted batch of messages per user message. WAIT_FOR_INTERRUPT
// pauses the batch until interrupt() is called.
function fakeQuery(
    turns: Step[][],
    { fail, endEarly }: { fail?: Error; endEarly?: boolean } = {},
): Fake {
    let release = () => {};
    const fake: Fake = {
        fn: (({ prompt, options }) => {
            fake.options = options;
            async function* run(): AsyncGenerator<SDKMessage> {
                yield init();
                if (endEarly) {
                    return;
                }
                let turn = 0;
                for await (const message of prompt) {
                    fake.prompts.push(String(message.message.content));
                    for (const step of turns[turn++] ?? []) {
                        if (step === WAIT_FOR_INTERRUPT) {
                            await new Promise<void>((resolve) => {
                                release = resolve;
                            });
                        } else {
                            yield step;
                        }
                    }
                    if (fail) {
                        throw fail;
                    }
                }
                fake.inputEnded = true;
            }
            return Object.assign(run(), {
                interrupt: async () => {
                    fake.interrupts++;
                    release();
                },
                close: () => {
                    fake.closed = true;
                },
            });
        }) as QueryFn,
        options: null,
        prompts: [],
        interrupts: 0,
        closed: false,
        inputEnded: false,
    };
    return fake;
}

function started(fake: Fake, history: Turn[] = []) {
    const conversation = new Conversation({ history, queryFn: fake.fn });
    const events: ConversationEvent[] = [];
    conversation.subscribe((event) => events.push(event));
    conversation.start();
    return { conversation, events };
}

async function until(predicate: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !predicate(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(predicate()).toBe(true);
}

const of = <T extends ConversationEvent["type"]>(
    events: ConversationEvent[],
    type: T,
) =>
    events.filter((e) => e.type === type) as Extract<
        ConversationEvent,
        { type: T }
    >[];

describe("Conversation", () => {
    it("emits ready from system/init", async () => {
        const { events } = started(fakeQuery([]));
        await until(() => of(events, "ready").length === 1);
        expect(of(events, "ready")[0]).toEqual({
            type: "ready",
            model: "test-model",
            sdkSessionId: "sdk-1",
        });
    });

    it("streams deltas and ends the turn with reply and stats", async () => {
        const fake = fakeQuery([[delta("Hel"), delta("lo"), result(0.002)]]);
        const { conversation, events } = started(fake);
        conversation.send("hi");
        await until(() => of(events, "turn-end").length === 1);
        expect(fake.prompts).toEqual(["hi"]);
        expect(of(events, "delta").map((e) => e.text)).toEqual(["Hel", "lo"]);
        expect(of(events, "turn-end")[0]).toEqual({
            type: "turn-end",
            reply: "Hello",
            interrupted: false,
            contextTokens: 3412,
            stats: {
                inputTokens: 10,
                cacheReadTokens: 3000,
                cacheWriteTokens: 400,
                outputTokens: 20,
                ttftMs: 300,
                durationMs: 1500,
                costUsd: 0.002,
                sessionCostUsd: 0.002,
            },
        });
    });

    it("costs a turn as the difference of running totals", async () => {
        const fake = fakeQuery([[result(0.002)], [result(0.005)]]);
        const { conversation, events } = started(fake);
        conversation.send("one");
        await until(() => of(events, "turn-end").length === 1);
        conversation.send("two");
        await until(() => of(events, "turn-end").length === 2);
        const second = of(events, "turn-end")[1]?.stats;
        expect(second?.costUsd).toBeCloseTo(0.003, 10);
        expect(second?.sessionCostUsd).toBe(0.005);
    });

    it("never costs a turn below zero", async () => {
        const fake = fakeQuery([[result(0.005)], [result(0)], [result(0.007)]]);
        const { conversation, events } = started(fake);
        for (const [index, text] of ["one", "two", "three"].entries()) {
            conversation.send(text);
            await until(() => of(events, "turn-end").length === index + 1);
        }
        const costs = of(events, "turn-end").map((e) => e.stats.costUsd);
        expect(costs[0]).toBe(0.005);
        expect(costs[1]).toBe(0);
        expect(costs[2]).toBeCloseTo(0.002, 10);
    });

    it("re-emits every SDK message as an sdk event", async () => {
        const fake = fakeQuery([[delta("a"), result(0.001)]]);
        const { conversation, events } = started(fake);
        conversation.send("hi");
        await until(() => of(events, "turn-end").length === 1);
        expect(of(events, "sdk")).toHaveLength(3);
    });

    it("keeps an interrupted partial reply", async () => {
        const fake = fakeQuery([
            [
                delta("Part"),
                WAIT_FOR_INTERRUPT,
                executionError(["Request was aborted."]),
            ],
        ]);
        const { conversation, events } = started(fake);
        conversation.send("hi");
        await until(() => of(events, "delta").length === 1);
        await conversation.interrupt();
        await until(() => of(events, "turn-end").length === 1);
        expect(fake.interrupts).toBe(1);
        expect(of(events, "turn-end")[0]).toMatchObject({
            reply: "Part",
            interrupted: true,
            stats: { ttftMs: null },
        });
    });

    it("ignores interrupt while idle", async () => {
        const fake = fakeQuery([]);
        const { conversation, events } = started(fake);
        await until(() => of(events, "ready").length === 1);
        await conversation.interrupt();
        expect(fake.interrupts).toBe(0);
    });

    it("closes by ending the input, without an error", async () => {
        const fake = fakeQuery([[result(0.001)]]);
        const { conversation, events } = started(fake);
        conversation.send("hi");
        await until(() => of(events, "turn-end").length === 1);
        await conversation.close();
        await conversation.close();
        expect(fake.inputEnded).toBe(true);
        expect(fake.closed).toBe(true);
        expect(of(events, "error")).toHaveLength(0);
    });

    it("emits error when the query throws", async () => {
        const fake = fakeQuery([[delta("x")]], { fail: new Error("boom") });
        const { conversation, events } = started(fake);
        conversation.send("hi");
        await until(() => of(events, "error").length === 1);
        expect(of(events, "error")[0]?.message).toBe("boom");
    });

    it("emits error when the session ends unexpectedly", async () => {
        const { events } = started(fakeQuery([], { endEarly: true }));
        await until(() => of(events, "error").length === 1);
        expect(of(events, "error")[0]?.message).toContain("ended unexpectedly");
    });

    it("uses the persona prompt unchanged without history", () => {
        const fake = fakeQuery([]);
        started(fake);
        expect(fake.options?.systemPrompt).toBe(systemPrompt);
        expect(fake.options?.tools).toEqual([]);
    });

    it("puts the persona in development mode when asked", () => {
        const fake = fakeQuery([]);
        const conversation = new Conversation({
            queryFn: fake.fn,
            persona: "development",
        });
        conversation.start();
        expect(fake.options?.systemPrompt).toBe(
            personaPrompt({ recall: false, mode: "development" }),
        );
    });

    it("starts with exactly the options conversationOptions gives", () => {
        const fake = fakeQuery([]);
        const setup = {
            history: [{ role: "user" as const, text: "Hi." }],
            memory: "<memory/>",
            recall: RECALL,
            persona: "development" as const,
        };
        const conversation = new Conversation({ ...setup, queryFn: fake.fn });
        conversation.start();
        expect(fake.options).toEqual(conversationOptions(setup));
    });

    it("keeps the CLI out of the user's Claude Code setup", () => {
        const fake = fakeQuery([]);
        started(fake);
        expect(fake.options).toMatchObject(cliOptions());
    });

    it("appends history to the system prompt", () => {
        const fake = fakeQuery([]);
        started(fake, [
            { role: "user", text: "My cat is Miso." },
            { role: "assistant", text: "Hello, Miso!" },
        ]);
        const prompt = String(fake.options?.systemPrompt);
        expect(prompt.startsWith(systemPrompt)).toBe(true);
        expect(prompt).toContain("User: My cat is Miso.");
    });

    it("starts with the memory block between the persona and the history", () => {
        const fake = fakeQuery([]);
        const history: Turn[] = [{ role: "user", text: "Earlier" }];
        new Conversation({
            history,
            memory: "<memory/>",
            queryFn: fake.fn,
        }).start();
        expect(fake.options?.systemPrompt).toBe(
            withHistory(withSection(systemPrompt, "<memory/>"), history),
        );
    });

    it("emits ready once, though the CLI sends init every turn", async () => {
        const fake = fakeQuery([
            [init(), result(0.001)],
            [init(), result(0.002)],
        ]);
        const { conversation, events } = started(fake);
        conversation.send("one");
        await until(() => of(events, "turn-end").length === 1);
        conversation.send("two");
        await until(() => of(events, "turn-end").length === 2);
        expect(of(events, "ready")).toHaveLength(1);
    });

    it("reports an API error result as an error, not an empty reply", async () => {
        const fake = fakeQuery([[apiError("Invalid API key")]]);
        const { conversation, events } = started(fake);
        conversation.send("hi");
        await until(() => of(events, "error").length === 1);
        expect(of(events, "error")[0]?.message).toBe("Invalid API key");
        expect(of(events, "turn-end")).toHaveLength(0);
    });

    it("reports an execution error result with its errors", async () => {
        const fake = fakeQuery([[executionError(["one", "two"])]]);
        const { conversation, events } = started(fake);
        conversation.send("hi");
        await until(() => of(events, "error").length === 1);
        expect(of(events, "error")[0]?.message).toBe("one; two");
    });

    it("measures the context from the last request, plus the reply", async () => {
        const fake = fakeQuery([
            [
                usage(5, 1000, 100),
                usage(7, 2000, 300),
                delta("12345678"),
                result(0.001),
            ],
        ]);
        const { conversation, events } = started(fake);
        conversation.send("hi");
        await until(() => of(events, "turn-end").length === 1);
        // 7 + 2000 + 300, and 8 characters of reply at 4 a token.
        expect(of(events, "turn-end")[0]?.contextTokens).toBe(2309);
    });

    it("falls back on the turn's usage when no request reported any", async () => {
        const fake = fakeQuery([[delta("Hello"), result(0.001)]]);
        const { conversation, events } = started(fake);
        conversation.send("hi");
        await until(() => of(events, "turn-end").length === 1);
        // 10 + 3000 + 400 from the result, and 5 characters of reply.
        expect(of(events, "turn-end")[0]?.contextTokens).toBe(3412);
    });

    it("measures each turn afresh", async () => {
        const fake = fakeQuery([
            [usage(1, 100, 0), result(0.001)],
            [result(0.002)],
        ]);
        const { conversation, events } = started(fake);
        conversation.send("one");
        await until(() => of(events, "turn-end").length === 1);
        conversation.send("two");
        await until(() => of(events, "turn-end").length === 2);
        expect(of(events, "turn-end").map((e) => e.contextTokens)).toEqual([
            101, 3410,
        ]);
    });

    it("measures the main context, not a subagent's", async () => {
        const fake = fakeQuery([
            [
                usage(7, 2000, 300),
                {
                    ...(usage(50, 90000, 900) as object),
                    parent_tool_use_id: "toolu_1",
                } as unknown as SDKMessage,
                delta("12345678"),
                result(0.001),
            ],
        ]);
        const { conversation, events } = started(fake);
        conversation.send("hi");
        await until(() => of(events, "turn-end").length === 1);
        expect(of(events, "turn-end")[0]?.contextTokens).toBe(2309);
    });

    it("warns of the CLI compacting on its own, and the turn goes on", async () => {
        const fake = fakeQuery([
            [
                usage(5, 1000, 100),
                delta("Hel"),
                compactBoundary(),
                delta("lo"),
                result(0.001),
            ],
        ]);
        const { conversation, events } = started(fake);
        conversation.send("hi");
        await until(() => of(events, "turn-end").length === 1);
        expect(of(events, "warning").map((e) => e.message)).toEqual([
            COMPACTED_BY_CLI,
        ]);
        expect(of(events, "error")).toEqual([]);
        const end = of(events, "turn-end")[0];
        expect(end?.reply).toBe("Hello");
        // The measurement before the boundary is stale: the result's usage,
        // 10 + 3000 + 400, and 5 characters of reply.
        expect(end?.contextTokens).toBe(3412);
    });

    it("hands the partial reply to the error when the session dies", async () => {
        const fake = fakeQuery([[delta("Par")]], { fail: new Error("boom") });
        const { conversation, events } = started(fake);
        conversation.send("hi");
        await until(() => of(events, "error").length === 1);
        expect(of(events, "error")[0]).toEqual({
            type: "error",
            message: "boom",
            partial: "Par",
        });
    });
});

const toolUse = (id: string, name: string, input: object) =>
    ({
        type: "assistant",
        message: { content: [{ type: "tool_use", id, name, input }] },
    }) as unknown as SDKMessage;
const toolResult = (id: string, text: string, isError = false) =>
    ({
        type: "user",
        message: {
            role: "user",
            content: [
                {
                    type: "tool_result",
                    tool_use_id: id,
                    content: [{ type: "text", text }],
                    is_error: isError,
                },
            ],
        },
        parent_tool_use_id: null,
    }) as unknown as SDKMessage;
const servers = (status: string) =>
    ({
        type: "system",
        subtype: "init",
        model: "test-model",
        session_id: "sdk-1",
        mcp_servers: [{ name: "memory", status }],
    }) as unknown as SDKMessage;
const RECALL = { command: "/bin/bun", args: ["index.ts", "--recall-server"] };
const SEARCHED = JSON.stringify({
    results: [
        {
            "@type": "Conversation",
            identifier: "a",
            dateCreated: "2026-10-04",
            dateModified: "2026-10-04",
            matches: [],
        },
    ],
    more: 1,
});

function startedWithRecall(fake: Fake) {
    const conversation = new Conversation({ queryFn: fake.fn, recall: RECALL });
    const events: ConversationEvent[] = [];
    conversation.subscribe((event) => events.push(event));
    conversation.start();
    return { conversation, events };
}

describe("Conversation with recall", () => {
    // A rendered earlier section; memory's tests pin how it is rendered.
    const EARLIER = "Earlier in this conversation:\n\n<earlier>\n</earlier>";

    it("seeds clusters between the memory and the tail, and offers recollect", () => {
        const fake = fakeQuery([]);
        const history: Turn[] = [{ role: "user", text: "Later" }];
        new Conversation({
            queryFn: fake.fn,
            recall: RECALL,
            memory: "<memory/>",
            earlier: EARLIER,
            recollect: true,
            history,
        }).start();
        expect(fake.options?.systemPrompt).toBe(
            withHistory(
                withSection(
                    withSection(personaPrompt({ recall: true }), "<memory/>"),
                    EARLIER,
                ),
                history,
            ),
        );
        expect(fake.options?.mcpServers).toEqual({
            memory: {
                type: "stdio",
                command: RECALL.command,
                args: [...RECALL.args, "--recollect"],
            },
        });
        expect(fake.options?.allowedTools).toEqual([
            "mcp__memory__search",
            "mcp__memory__open",
            "mcp__memory__tags",
            "mcp__memory__recollect",
        ]);
    });

    it("seeds clusters without recall, offering no tool", () => {
        const fake = fakeQuery([]);
        new Conversation({
            queryFn: fake.fn,
            earlier: EARLIER,
            recollect: true,
        }).start();
        expect(fake.options?.systemPrompt).toBe(
            withHistory(withSection(systemPrompt, EARLIER), []),
        );
        expect(fake.options?.mcpServers).toBeUndefined();
    });

    it("offers recollect only when the session asks for it", () => {
        const fake = fakeQuery([]);
        new Conversation({
            queryFn: fake.fn,
            recall: RECALL,
            earlier: EARLIER,
            recollect: false,
        }).start();
        expect(fake.options?.mcpServers).toEqual({
            memory: { type: "stdio", ...RECALL },
        });
        expect(fake.options?.allowedTools).not.toContain(
            "mcp__memory__recollect",
        );
    });

    it("launches the recall server and allows only its tools", () => {
        const fake = fakeQuery([]);
        startedWithRecall(fake);
        expect(fake.options?.mcpServers).toEqual({
            memory: { type: "stdio", ...RECALL },
        });
        expect(fake.options?.allowedTools).toEqual([
            "mcp__memory__search",
            "mcp__memory__open",
            "mcp__memory__tags",
        ]);
        expect(fake.options?.systemPrompt).toBe(
            withHistory(withSection(personaPrompt({ recall: true }), ""), []),
        );
    });

    it("launches nothing without recall", () => {
        const fake = fakeQuery([]);
        started(fake);
        expect(fake.options?.mcpServers).toBeUndefined();
        expect(fake.options?.allowedTools).toBeUndefined();
    });

    it("emits each lookup where it happened, and joins the reply's steps", async () => {
        const fake = fakeQuery([
            [
                delta("Let me check."),
                toolUse("toolu_1", "mcp__memory__search", { query: "render" }),
                toolResult("toolu_1", SEARCHED),
                delta("We were keeping"),
                delta(" artefacts down."),
                result(0.01),
            ],
        ]);
        const { conversation, events } = startedWithRecall(fake);
        conversation.send("what did we say?");
        await until(() => of(events, "turn-end").length === 1);
        expect(of(events, "lookup")).toEqual([
            {
                type: "lookup",
                id: "toolu_1",
                ok: true,
                offset: 13,
                lookup: { tool: "search", query: "render", hits: 2 },
            },
        ]);
        expect(of(events, "turn-end")[0]?.reply).toBe(
            "Let me check.\n\nWe were keeping artefacts down.",
        );
        expect(
            events.findIndex((event) => event.type === "lookup"),
        ).toBeLessThan(
            events.findIndex(
                (event) =>
                    event.type === "delta" && event.text.includes("We were"),
            ),
        );
    });

    it("adds no blank line when nothing came before the lookup", async () => {
        const fake = fakeQuery([
            [
                toolUse("toolu_1", "mcp__memory__search", { query: "x" }),
                toolResult("toolu_1", SEARCHED),
                delta("Found it."),
                result(0.01),
            ],
        ]);
        const { conversation, events } = startedWithRecall(fake);
        conversation.send("?");
        await until(() => of(events, "turn-end").length === 1);
        expect(of(events, "turn-end")[0]?.reply).toBe("Found it.");
        expect(of(events, "lookup")[0]?.offset).toBe(0);
    });

    it("reports a failed lookup, and ignores other tools", async () => {
        const fake = fakeQuery([
            [
                toolUse("toolu_1", "mcp__memory__open", {
                    conversation: "x",
                    purpose: "p",
                }),
                toolUse("toolu_2", "mcp__other__thing", {}),
                toolResult("toolu_1", "No conversation by that name.", true),
                toolResult("toolu_2", "whatever"),
                result(0.01),
            ],
        ]);
        const { conversation, events } = startedWithRecall(fake);
        conversation.send("?");
        await until(() => of(events, "turn-end").length === 1);
        expect(of(events, "lookup")).toEqual([
            {
                type: "lookup",
                id: "toolu_1",
                ok: false,
                offset: 0,
                lookup: {
                    tool: "open",
                    conversation: "x",
                    name: "x",
                    purpose: "p",
                    turns: null,
                },
            },
        ]);
    });

    it("reports a lookup cut short by an interruption", async () => {
        const fake = fakeQuery([
            [
                delta("Checking."),
                toolUse("toolu_1", "mcp__memory__search", { query: "x" }),
                WAIT_FOR_INTERRUPT,
                result(0.01),
            ],
        ]);
        const { conversation, events } = startedWithRecall(fake);
        conversation.send("?");
        await until(() => of(events, "delta").length === 1);
        await conversation.interrupt();
        await until(() => of(events, "turn-end").length === 1);
        expect(of(events, "lookup")).toEqual([
            {
                type: "lookup",
                id: "toolu_1",
                ok: false,
                offset: 9,
                lookup: { tool: "search", query: "x", hits: 0 },
            },
        ]);
        expect(
            events.findIndex((event) => event.type === "lookup"),
        ).toBeLessThan(events.findIndex((event) => event.type === "turn-end"));
    });

    it("warns once when the recall server failed", async () => {
        const fake = fakeQuery([
            [servers("failed"), result(0.01)],
            [servers("failed"), result(0.02)],
        ]);
        const { conversation, events } = startedWithRecall(fake);
        conversation.send("one");
        await until(() => of(events, "turn-end").length === 1);
        conversation.send("two");
        await until(() => of(events, "turn-end").length === 2);
        expect(of(events, "warning")).toEqual([
            {
                type: "warning",
                message: "memory: recall is unavailable (failed)",
            },
        ]);
    });

    it("does not warn of a server still starting", async () => {
        const fake = fakeQuery([[servers("pending"), result(0.01)]]);
        const { conversation, events } = startedWithRecall(fake);
        conversation.send("one");
        await until(() => of(events, "turn-end").length === 1);
        expect(of(events, "warning")).toEqual([]);
    });
});
