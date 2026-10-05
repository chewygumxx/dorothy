// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/state.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { ConversationEvent, TurnStats } from "../conversation.js";
import type { Lookup } from "../recall/types.js";
import {
    type ChatState,
    initialState,
    lookupLine,
    RAW_LIMIT,
    reduce,
} from "./state.js";

const stats: TurnStats = {
    inputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 2,
    ttftMs: 300,
    durationMs: 1500,
    costUsd: 0.001,
    sessionCostUsd: 0.001,
};
const message = { type: "system" };

function streaming(): ChatState {
    return reduce(initialState([]), { type: "sent", text: "hi" });
}

describe("initialState", () => {
    it("keeps the latest turn's stats, starting from a resumed reply's", () => {
        expect(initialState([]).lastStats).toBeNull();
        const resumed = initialState([
            { role: "assistant", text: "b", stats, chatCostUsd: 0.5 },
            { role: "user", text: "c" },
        ]);
        expect(resumed.lastStats).toEqual(stats);
        const later = { ...stats, outputTokens: 99 };
        expect(
            reduce(resumed, {
                type: "event",
                event: {
                    type: "turn-end",
                    reply: "d",
                    interrupted: false,
                    stats: later,
                },
            }).lastStats,
        ).toEqual(later);
    });

    it("initialState gives resumed replies their stats", () => {
        expect(
            initialState([
                { role: "user", text: "a" },
                { role: "assistant", text: "b", stats, chatCostUsd: 0.5 },
            ]).lines,
        ).toEqual([
            { id: 0, role: "you", text: "a" },
            { id: 1, role: "dorothy", text: "b", stats, chatCostUsd: 0.5 },
        ]);
    });

    it("initialState keeps the last three distinct warnings", () => {
        expect(initialState([], ["a", "b", "a", "c", "d"]).warnings).toEqual([
            "b",
            "c",
            "d",
        ]);
    });

    it("renders resumed history as finished lines", () => {
        const state = initialState([
            { role: "user", text: "a" },
            { role: "assistant", text: "b" },
        ]);
        expect(state.lines).toEqual([
            { id: 0, role: "you", text: "a" },
            { id: 1, role: "dorothy", text: "b" },
        ]);
        expect(state.status).toBe("starting");
        expect(state.streaming).toBe(false);
    });

    it("totals the chat's cost across sessions, from what was spent before", () => {
        const end = (sessionCostUsd: number) => ({
            type: "event" as const,
            event: {
                type: "turn-end" as const,
                reply: "ok",
                interrupted: false,
                stats: { ...stats, costUsd: 0.001, sessionCostUsd },
            },
        });
        let state = reduce(initialState([], [], 0.01), end(0.001));
        state = reduce(state, {
            type: "event",
            event: { type: "error", message: "boom" },
        });
        state = reduce(state, { type: "reconnecting" });
        state = reduce(state, end(0.001));
        const costs = state.lines.map((line) => line.chatCostUsd);
        expect(costs[0]).toBeCloseTo(0.011, 10);
        expect(costs[2]).toBeCloseTo(0.012, 10);
    });

    it("carries the initial warnings", () => {
        expect(initialState([], ["careful"]).warnings).toEqual(["careful"]);
    });
});

describe("reduce", () => {
    it("records a sent message and starts streaming", () => {
        const state = streaming();
        expect(state.lines.at(-1)).toEqual({ id: 0, role: "you", text: "hi" });
        expect(state.streaming).toBe(true);
    });

    it("tracks ready", () => {
        const state = reduce(initialState([]), {
            type: "event",
            event: { type: "ready", model: "m", sdkSessionId: "s" },
        });
        expect(state).toMatchObject({
            status: "ready",
            model: "m",
            sdkSessionId: "s",
        });
    });

    it("accumulates deltas, then finishes the turn", () => {
        let state = streaming();
        state = reduce(state, {
            type: "event",
            event: { type: "delta", text: "Hel" },
        });
        state = reduce(state, {
            type: "event",
            event: { type: "delta", text: "lo" },
        });
        expect(state.live).toBe("Hello");
        state = reduce(state, {
            type: "event",
            event: {
                type: "turn-end",
                reply: "Hello",
                interrupted: false,
                stats,
            },
        });
        expect(state.lines.at(-1)).toEqual({
            id: 1,
            role: "dorothy",
            text: "Hello",
            stats,
            chatCostUsd: 0.001,
            interrupted: false,
            continued: false,
        });
        expect(state.live).toBe("");
        expect(state.streaming).toBe(false);
    });

    it("keeps a partial reply when the session dies mid-reply", () => {
        let state = streaming();
        state = reduce(state, {
            type: "event",
            event: { type: "delta", text: "Part" },
        });
        state = reduce(state, {
            type: "event",
            event: { type: "error", message: "boom" },
        });
        expect(state.lines.slice(-2)).toEqual([
            {
                id: 1,
                role: "dorothy",
                text: "Part",
                interrupted: true,
                continued: false,
            },
            { id: 2, role: "error", text: "boom" },
        ]);
        expect(state.status).toBe("disconnected");
        expect(state.streaming).toBe(false);
        expect(state.live).toBe("");
    });

    it("keeps only the last RAW_LIMIT raw messages, with stable ids", () => {
        let state = initialState([]);
        for (let i = 0; i < RAW_LIMIT + 5; i++) {
            state = reduce(state, {
                type: "event",
                event: { type: "sdk", message },
            });
        }
        expect(state.raw).toHaveLength(RAW_LIMIT);
        expect(state.raw[0]?.id).toBe(5);
        expect(state.raw.at(-1)?.id).toBe(RAW_LIMIT + 4);
    });

    it("toggles the raw pane", () => {
        const once = reduce(initialState([]), { type: "toggle-raw" });
        expect(once.showRaw).toBe(true);
        expect(reduce(once, { type: "toggle-raw" }).showRaw).toBe(false);
    });

    it("resets connection details when reconnecting", () => {
        let state = reduce(initialState([]), {
            type: "event",
            event: { type: "error", message: "boom" },
        });
        state = reduce(state, { type: "reconnecting" });
        expect(state).toMatchObject({
            status: "starting",
            model: null,
            sdkSessionId: null,
        });
    });

    it("keeps each distinct warning, the last three at most", () => {
        let state = initialState([], ["first"]);
        for (const message of ["second", "first", "third", "fourth"]) {
            state = reduce(state, { type: "warning", message });
        }
        expect(state.warnings).toEqual(["second", "third", "fourth"]);
    });
});

describe("memory-cost", () => {
    it("adds up what this run's reviews cost", () => {
        let state = initialState([]);
        expect(state.memoryCostUsd).toBe(0);
        state = reduce(state, { type: "memory-cost", usd: 0.25 });
        state = reduce(state, { type: "memory-cost", usd: 0.5 });
        expect(state.memoryCostUsd).toBe(0.75);
    });
});

const searched = {
    tool: "search" as const,
    query: "render",
    hits: 2,
};
const opened = {
    tool: "open" as const,
    conversation: "amber-otter-quietly-sings",
    name: "Terminal rendering chaos",
    purpose: "the render bug",
    turns: [3, 5] as [number, number],
};
const event = (event: ConversationEvent) => ({ type: "event" as const, event });
const lookupAt = (offset: number, lookup: Lookup = searched, ok = true) =>
    event({ type: "lookup", id: `toolu_${offset}`, ok, offset, lookup });
const deltaOf = (text: string) => event({ type: "delta", text });
const endOf = (reply: string) =>
    event({ type: "turn-end", reply, interrupted: false, stats });
const run = (state: ChatState, ...actions: Parameters<typeof reduce>[1][]) =>
    actions.reduce(reduce, state);

describe("lookupLine", () => {
    it("says what was searched and found", () => {
        expect(lookupLine(true, searched)).toEqual({
            text: '⌕ searched "render" · 2 conversations',
        });
        expect(lookupLine(true, { ...searched, hits: 1 }).text).toBe(
            '⌕ searched "render" · 1 conversation',
        );
        expect(lookupLine(true, { ...searched, hits: 0 }).text).toBe(
            '⌕ searched "render" · nothing found',
        );
        expect(lookupLine(false, searched).text).toBe(
            '⌕ couldn\'t search "render"',
        );
    });

    it("says what was opened, and why", () => {
        expect(lookupLine(true, opened)).toEqual({
            text: "⌕ opened Terminal rendering chaos",
            detail: "for: the render bug",
        });
        expect(
            lookupLine(false, { ...opened, name: opened.conversation }),
        ).toEqual({ text: "⌕ couldn't open amber-otter-quietly-sings" });
    });
});

describe("lookups in a live reply", () => {
    it("moves the text so far above the lookup, and continues below it", () => {
        const state = run(
            streaming(),
            deltaOf("Let me check."),
            lookupAt(13, opened),
            deltaOf("\n\nWe were"),
            deltaOf(" keeping it down."),
            endOf("Let me check.\n\nWe were keeping it down."),
        );
        expect(state.lines.slice(1)).toEqual([
            { id: 1, role: "dorothy", text: "Let me check.", continued: false },
            {
                id: 2,
                role: "lookup",
                text: "⌕ opened Terminal rendering chaos",
                detail: "for: the render bug",
            },
            {
                id: 3,
                role: "dorothy",
                text: "We were keeping it down.",
                stats,
                chatCostUsd: stats.costUsd,
                interrupted: false,
                continued: true,
            },
        ]);
        expect(state.live).toBe("");
        expect(state.continued).toBe(false);
        expect(state.replyOffset).toBe(0);
    });

    it("adds no empty line for a lookup with no text before it", () => {
        const state = run(streaming(), lookupAt(0), lookupAt(0, opened));
        expect(state.lines.slice(1).map((line) => line.role)).toEqual([
            "lookup",
            "lookup",
        ]);
    });

    it("keeps a lookup when the connection then fails", () => {
        const state = run(
            streaming(),
            deltaOf("Checking."),
            lookupAt(9),
            deltaOf("\n\nHalf"),
            event({ type: "error", message: "gone" }),
        );
        expect(
            state.lines.slice(1).map((line) => [line.role, line.text]),
        ).toEqual([
            ["dorothy", "Checking."],
            ["lookup", '⌕ searched "render" · 2 conversations'],
            ["dorothy", "\n\nHalf"],
            ["error", "gone"],
        ]);
        const next = run(
            state,
            { type: "sent", text: "again" },
            endOf("Fresh."),
        );
        expect(next.lines.at(-1)).toMatchObject({
            text: "Fresh.",
            continued: false,
        });
    });
});

describe("lookups in a resumed reply", () => {
    it("places each lookup where it happened", () => {
        const recall = (offset: number, ok = true) => ({
            v: 1 as const,
            kind: "recall" as const,
            at: "t",
            id: `toolu_${offset}`,
            ok,
            offset,
            ...searched,
        });
        expect(
            initialState([
                { role: "user", text: "a" },
                {
                    role: "assistant",
                    text: "One.\n\nTwo.",
                    stats,
                    chatCostUsd: 0.5,
                    lookups: [recall(4)],
                },
            ]).lines,
        ).toEqual([
            { id: 0, role: "you", text: "a" },
            { id: 1, role: "dorothy", text: "One.", continued: false },
            {
                id: 2,
                role: "lookup",
                text: '⌕ searched "render" · 2 conversations',
            },
            {
                id: 3,
                role: "dorothy",
                text: "Two.",
                stats,
                chatCostUsd: 0.5,
                continued: true,
            },
        ]);
    });

    it("clamps offsets past the end of a cut-short reply", () => {
        const lines = initialState([
            {
                role: "assistant",
                text: "Short.",
                lookups: [
                    {
                        v: 1,
                        kind: "recall",
                        at: "t",
                        id: "toolu_1",
                        ok: false,
                        offset: 400,
                        ...searched,
                    },
                ],
            },
        ]).lines;
        expect(lines.map((line) => [line.role, line.text])).toEqual([
            ["dorothy", "Short."],
            ["lookup", '⌕ couldn\'t search "render"'],
            ["dorothy", ""],
        ]);
    });
});
