// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/agent/src/turn.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { ConversationEvent } from "@dorothy/core";
import { estimate, TurnState, textOf } from "./turn.js";

const turn = () => {
    const events: ConversationEvent[] = [];
    return {
        events,
        state: new TurnState((event) => events.push(event), 1_000),
    };
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
        state.result("c1", {
            content: [{ type: "text", text: "{}" }],
            isError: false,
        });
        state.text("Found it.", 1_300);
        expect(state.reply).toBe("Let me look.\n\nFound it.");
        expect(events.find((event) => event.type === "lookup")).toMatchObject({
            id: "c1",
            ok: true,
            offset: 12,
        });
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
        state.result("c1", {
            content: [{ type: "text", text: "no such" }],
            isError: true,
        });
        expect(events[0]).toMatchObject({ type: "lookup", ok: false });
    });

    it("settles calls left unanswered as failed", () => {
        const { events, state } = turn();
        state.call("c1", "mcp__memory__search", {});
        state.call("c2", "mcp__memory__remember", { fact: "x" });
        state.settleCalls();
        expect(
            events.map((event) => [
                event.type,
                "ok" in event ? event.ok : null,
            ]),
        ).toEqual([
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

    it.each([false, true])(
        "records one persona read at its call offset (isError: %s)",
        (isError) => {
            const { events, state } = turn();
            state.text("Reading 🫖", 1_100);
            state.call("p1", "mcp__memory__persona", { layer: "character" });
            state.call("p1", "mcp__memory__persona", { layer: "voice" });
            expect(events).toHaveLength(1);
            state.text("...", 1_200);
            state.result("p1", {
                content: [{ type: "text", text: "Her layer." }],
                isError,
            });
            state.result("p1", { content: [], isError });
            expect(events.slice(2)).toEqual([
                {
                    type: "persona",
                    layer: "character",
                    ok: !isError,
                    offset: 10,
                },
            ]);
            state.text("Read.", 1_300);
            expect(state.reply).toBe("Reading 🫖...\n\nRead.");
        },
    );

    it.each(["error", "settleCalls"] as const)(
        "settles an unanswered persona read as failed through %s",
        (method) => {
            const { events, state } = turn();
            state.call("p1", "mcp__memory__persona", { layer: "soul" });
            expect(state.started).toBe(false);
            if (method === "error") {
                state.error("p1");
            } else {
                state.settleCalls();
            }
            state.settleCalls();
            expect(events).toEqual([
                { type: "persona", layer: "soul", ok: false, offset: 0 },
            ]);
        },
    );

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
        expect(
            textOf([
                { type: "text", text: "a" },
                { type: "image" },
                { type: "text", text: "b" },
            ]),
        ).toBe("ab");
        expect(textOf("plain")).toBe("plain");
        expect(textOf(undefined)).toBe("");
    });
    it("counts four characters to a token", () => {
        expect(estimate("abcde")).toBe(2);
    });
});
