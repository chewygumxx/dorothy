// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/track.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { ChatSession, ConversationEvent } from "@dorothy/core";
import { trackMemory } from "./track.js";

const stats = {
    inputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 2,
    ttftMs: 300,
    durationMs: 1500,
    costUsd: 0.001,
    sessionCostUsd: 0.001,
};

function fakeSession(log: string[]) {
    const listeners = new Set<(event: ConversationEvent) => void>();
    const session: ChatSession = {
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        send: (text) => log.push(`send ${text}`),
        interrupt: async () => {
            log.push("interrupt");
        },
        close: async () => {
            log.push("close");
        },
    };
    const emit = (event: ConversationEvent) => {
        for (const listener of listeners) {
            listener(event);
        }
    };
    return { session, emit };
}

function setup() {
    const log: string[] = [];
    const { session, emit } = fakeSession(log);
    const tracked = trackMemory(session, {
        sent: (text) => log.push(`hook sent ${text}`),
        ready: () => log.push("hook ready"),
        turnEnded: () => log.push("hook turn-end"),
    });
    return { log, tracked, emit };
}

describe("trackMemory", () => {
    it("passes every event to the chat before memory hears of it", () => {
        const { log, tracked, emit } = setup();
        tracked.subscribe((event) => log.push(`chat ${event.type}`));
        emit({ type: "ready", model: "m", sdkSessionId: "s" });
        emit({ type: "delta", text: "Hi" });
        emit({ type: "turn-end", reply: "Hi", interrupted: false, stats });
        emit({ type: "error", message: "gone" });
        expect(log).toEqual([
            "chat ready",
            "hook ready",
            "chat delta",
            "chat turn-end",
            "hook turn-end",
            "chat error",
        ]);
    });

    it("tells memory of a send, then sends", () => {
        const { log, tracked } = setup();
        tracked.send("Hello");
        expect(log).toEqual(["hook sent Hello", "send Hello"]);
    });

    it("passes interrupt and close through", async () => {
        const { log, tracked } = setup();
        await tracked.interrupt();
        await tracked.close();
        expect(log).toEqual(["interrupt", "close"]);
    });

    it("stops telling a listener that unsubscribed", () => {
        const { log, tracked, emit } = setup();
        const unsubscribe = tracked.subscribe((event) => log.push(event.type));
        unsubscribe();
        emit({ type: "delta", text: "Hi" });
        expect(log).toEqual([]);
    });
});
