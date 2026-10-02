// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/App.test.tsx
//
//

import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import type {
    ChatSession,
    ConversationEvent,
    TurnStats,
} from "../conversation.js";
import type { Turn } from "../persona.js";
import type { TranscriptEntry } from "../transcript.js";
import { App } from "./App.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const stats: TurnStats = {
    inputTokens: 1,
    outputTokens: 2,
    ttftMs: 300,
    durationMs: 1500,
    costUsd: 0.001,
    sessionCostUsd: 0.001,
};

class FakeSession implements ChatSession {
    readonly listeners = new Set<(event: ConversationEvent) => void>();
    readonly sent: string[] = [];
    interrupts = 0;
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
    async interrupt(): Promise<void> {
        this.interrupts++;
    }
    async close(): Promise<void> {
        this.closed = true;
    }
    emit(event: ConversationEvent): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }
}

function setup({
    history = [],
    failWrites = false,
}: {
    history?: Turn[];
    failWrites?: boolean;
} = {}) {
    const sessions: FakeSession[] = [];
    const histories: Turn[][] = [];
    const entries: TranscriptEntry[] = [];
    const app = render(
        <App
            phrase="tumble-orchid-vapor-lantern"
            promptSha256="abc"
            history={history}
            createSession={(turns) => {
                histories.push([...turns]);
                const session = new FakeSession();
                sessions.push(session);
                return session;
            }}
            transcript={{
                append: async (entry) => {
                    if (failWrites) {
                        throw new Error("disk full");
                    }
                    entries.push(entry);
                },
            }}
        />,
    );
    const session = () => sessions.at(-1) as FakeSession;
    const type = async (text: string) => {
        app.stdin.write(text);
        await tick();
    };
    return { app, sessions, histories, entries, session, type };
}

describe("App", () => {
    it("starts a session and records it once ready", async () => {
        const { app, session, entries } = setup();
        await tick();
        expect(app.lastFrame()).toContain("tumble-orchid-vapor-lantern");
        expect(app.lastFrame()).toContain("starting");
        session().emit({
            type: "ready",
            model: "test-model",
            sdkSessionId: "sdk-1",
        });
        await tick();
        expect(app.lastFrame()).toContain("test-model");
        expect(entries).toEqual([
            {
                kind: "session",
                phrase: "tumble-orchid-vapor-lantern",
                sdkSessionId: "sdk-1",
                model: "test-model",
                promptSha256: "abc",
                resumed: false,
            },
        ]);
    });

    it("sends a message, streams the reply and records the turn", async () => {
        const { app, session, entries, type } = setup();
        await tick();
        await type("hello");
        await type("\r");
        expect(session().sent).toEqual(["hello"]);
        session().emit({ type: "delta", text: "Hi th" });
        await tick();
        expect(app.lastFrame()).toContain("Hi th▍");
        session().emit({
            type: "turn-end",
            reply: "Hi there",
            interrupted: false,
            stats,
        });
        await tick();
        expect(app.lastFrame()).toContain("Hi there");
        expect(app.lastFrame()).toContain("1 in · 2 out");
        expect(entries).toEqual([
            { kind: "user", text: "hello" },
            { kind: "assistant", text: "Hi there", interrupted: false },
            { kind: "stats", ...stats },
        ]);
    });

    it("ignores an empty or whitespace-only Enter", async () => {
        const { session, entries, type } = setup();
        await tick();
        await type("\r");
        await type("   ");
        await type("\r");
        expect(session().sent).toEqual([]);
        expect(entries).toEqual([]);
    });

    it("ignores typing and Enter while a reply streams", async () => {
        const { session, type } = setup();
        await tick();
        await type("a");
        await type("\r");
        await type("b");
        await type("\r");
        expect(session().sent).toEqual(["a"]);
    });

    it("interrupts on Esc only while streaming", async () => {
        const { session, type } = setup();
        await tick();
        await type("\u001B");
        expect(session().interrupts).toBe(0);
        await type("a");
        await type("\r");
        await type("\u001B");
        expect(session().interrupts).toBe(1);
    });

    it("toggles the raw pane with Ctrl+R", async () => {
        const { app, type } = setup();
        await tick();
        expect(app.lastFrame()).not.toContain("raw (ctrl+r)");
        await type("\u0012");
        expect(app.lastFrame()).toContain("raw (ctrl+r)");
        await type("\u0012");
        expect(app.lastFrame()).not.toContain("raw (ctrl+r)");
    });

    it("reconnects with full history after the session dies mid-reply", async () => {
        const { app, sessions, histories, type } = setup({
            history: [
                { role: "user", text: "earlier" },
                { role: "assistant", text: "yes" },
            ],
        });
        await tick();
        await type("hello");
        await type("\r");
        sessions[0]?.emit({ type: "delta", text: "Par" });
        sessions[0]?.emit({ type: "error", message: "boom" });
        await tick();
        expect(app.lastFrame()).toContain("Par [interrupted]");
        expect(app.lastFrame()).toContain("boom");
        expect(app.lastFrame()).toContain("disconnected");
        await type("again");
        await type("\r");
        expect(sessions).toHaveLength(2);
        expect(sessions[0]?.closed).toBe(true);
        expect(histories[1]).toEqual([
            { role: "user", text: "earlier" },
            { role: "assistant", text: "yes" },
            { role: "user", text: "hello" },
        ]);
        expect(sessions[1]?.sent).toEqual(["again"]);
    });

    it("records a resumed session as resumed", async () => {
        const { session, entries } = setup({
            history: [{ role: "user", text: "earlier" }],
        });
        await tick();
        session().emit({ type: "ready", model: "m", sdkSessionId: "s" });
        await tick();
        expect(entries[0]).toMatchObject({ kind: "session", resumed: true });
    });

    it("interrupts on Ctrl+C while streaming and quits when idle", async () => {
        const { session, type } = setup();
        await tick();
        await type("a");
        await type("\r");
        await type("\u0003");
        expect(session().interrupts).toBe(1);
        expect(session().closed).toBe(false);
        session().emit({
            type: "turn-end",
            reply: "ok",
            interrupted: true,
            stats,
        });
        await tick();
        await type("\u0003");
        expect(session().closed).toBe(true);
    });

    it("quits on Ctrl+D", async () => {
        const { session, type } = setup();
        await tick();
        await type("\u0004");
        expect(session().closed).toBe(true);
    });

    it("quits on /exit", async () => {
        const { session, type } = setup();
        await tick();
        await type("/exit");
        await type("\r");
        expect(session().closed).toBe(true);
        expect(session().sent).toEqual([]);
    });

    it("warns once when the transcript cannot be written, and keeps chatting", async () => {
        const { app, session, type } = setup({ failWrites: true });
        await tick();
        await type("hello");
        await type("\r");
        expect(app.lastFrame()).toContain("transcript not saved: disk full");
        expect(session().sent).toEqual(["hello"]);
    });
});
