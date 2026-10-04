// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/state.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { TurnStats } from "../conversation.js";
import { type ChatState, initialState, RAW_LIMIT, reduce } from "./state.js";

const stats: TurnStats = {
    inputTokens: 1,
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

    it("carries an initial warning", () => {
        expect(initialState([], "careful").warning).toBe("careful");
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
            interrupted: false,
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
            { id: 1, role: "dorothy", text: "Part", interrupted: true },
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

    it("keeps only the first warning", () => {
        let state = reduce(initialState([]), {
            type: "warning",
            message: "first",
        });
        state = reduce(state, { type: "warning", message: "second" });
        expect(state.warning).toBe("first");
    });
});
