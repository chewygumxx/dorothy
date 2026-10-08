// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/track.ts
//
//

import type { ChatSession, ConversationEvent } from "@dorothy/core";

export type MemoryHooks = {
    sent(text: string): void;
    ready(): void;
    turnEnded(): void;
};

// Passes everything through unchanged. Memory hears of an event only after
// the chat's own listeners, so the transcript has queued the reply before a
// review flushes it.
export function trackMemory(
    session: ChatSession,
    hooks: MemoryHooks,
): ChatSession {
    const listeners = new Set<(event: ConversationEvent) => void>();
    session.subscribe((event) => {
        for (const listener of listeners) {
            listener(event);
        }
        if (event.type === "ready") {
            hooks.ready();
        } else if (event.type === "turn-end") {
            hooks.turnEnded();
        }
    });
    return {
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        send(text) {
            hooks.sent(text);
            session.send(text);
        },
        interrupt: () => session.interrupt(),
        close: () => session.close(),
    };
}
