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
import {
    Conversation,
    type ConversationEvent,
    type QueryFn,
} from "./conversation.js";
import { systemPrompt, type Turn, withHistory, withMemory } from "./persona.js";

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
            withHistory(withMemory(systemPrompt, "<memory/>"), history),
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
