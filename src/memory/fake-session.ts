// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/fake-session.ts
//
//

// A session for tests: it keeps what is sent, and emits what a test
// tells it to.

import type { ChatSession, ConversationEvent } from "../contracts/session.js";

export class FakeSession implements ChatSession {
    readonly listeners = new Set<(event: ConversationEvent) => void>();
    readonly sent: string[] = [];
    closed = false;
    subscribe(listener: (event: ConversationEvent) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    send(text: string): void {
        this.sent.push(text);
    }
    async interrupt(): Promise<void> {}
    async close(): Promise<void> {
        this.closed = true;
    }
    emit(event: ConversationEvent): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }
}
