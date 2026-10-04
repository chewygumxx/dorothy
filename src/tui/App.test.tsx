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
import { type Config, DEFAULT_CONFIG } from "../config.js";
import type {
    ChatSession,
    ConversationEvent,
    TurnStats,
} from "../conversation.js";
import type { Turn } from "../persona.js";
import type { ResumedTurn, TranscriptEntry } from "../transcript.js";
import { App } from "./App.js";
import type { EditResult } from "./external-editor.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
// ink-testing-library leaves rows unset, so Ink would take the size of the
// terminal running the tests; every test gets 100 × 24 unless it resizes.
const setSize = (
    app: ReturnType<typeof render>,
    columns: number,
    rows: number,
) => {
    Object.defineProperty(app.stdout, "columns", {
        value: columns,
        configurable: true,
    });
    Object.defineProperty(app.stdout, "rows", {
        value: rows,
        configurable: true,
    });
    app.stdout.emit("resize");
};
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

class FakeSession implements ChatSession {
    readonly listeners = new Set<(event: ConversationEvent) => void>();
    readonly sent: string[] = [];
    interrupts = 0;
    closed = false;
    closes = 0;
    failInterrupt = false;
    // Resolves close() when set; stands for the subprocess's grace period.
    closing: Promise<void> | null = null;
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
        if (this.failInterrupt) {
            throw new Error("subprocess gone");
        }
    }
    async close(): Promise<void> {
        this.closed = true;
        this.closes++;
        await this.closing;
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
    config = DEFAULT_CONFIG,
    editDraft = async (text: string): Promise<EditResult> => ({
        ok: true,
        text,
    }),
}: {
    history?: ResumedTurn[];
    failWrites?: boolean;
    config?: Config;
    editDraft?: (text: string) => Promise<EditResult>;
} = {}) {
    const sessions: FakeSession[] = [];
    const histories: Turn[][] = [];
    const entries: TranscriptEntry[] = [];
    const app = render(
        <App
            config={config}
            editDraft={editDraft}
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
    setSize(app, 100, 24);
    const session = () => sessions.at(-1) as FakeSession;
    const type = async (text: string) => {
        app.stdin.write(text);
        await tick();
    };
    const resize = async (columns: number, rows: number) => {
        setSize(app, columns, rows);
        await tick();
    };
    return { app, sessions, histories, entries, session, type, resize };
}

describe("App", () => {
    // The message wraps at narrow widths; joining its rows restores it.
    const flat = (frame = "") => frame.split("\n").join(" ");

    it("asks for a larger window below either minimum, and not at it", async () => {
        const { app, resize } = setup();
        await tick();
        await resize(39, 24);
        expect(flat(app.lastFrame())).toContain(
            "Too Small: Dorothy's TUI needs at least 20 lines and 40 columns (this window is 24 × 39)",
        );
        expect(app.lastFrame()).not.toContain("tumble-orchid-vapor-lantern");
        await resize(40, 19);
        expect(flat(app.lastFrame())).toContain("(this window is 19 × 40)");
        await resize(40, 20);
        expect(app.lastFrame()).not.toContain("Too Small");
        expect(app.lastFrame()).toContain("tumble-orchid-vapor-lantern");
    });

    it("needs a line more for each statusline line, and none when hidden", async () => {
        const tall = setup({
            config: {
                ...DEFAULT_CONFIG,
                statusline: { ...DEFAULT_CONFIG.statusline, maxLines: 3 },
            },
        });
        await tick();
        await tall.resize(100, 21);
        expect(flat(tall.app.lastFrame())).toContain("at least 22 lines");
        const hidden = setup({
            config: {
                ...DEFAULT_CONFIG,
                statusline: { modules: [], maxLines: 1 },
            },
        });
        await tick();
        await hidden.resize(100, 19);
        expect(hidden.app.lastFrame()).not.toContain("Too Small");
    });

    it("keeps the draft, the reply and the scrollback while too small", async () => {
        const { app, session, type, resize } = setup();
        await tick();
        await type("hi");
        await type("\r");
        session().emit({
            type: "turn-end",
            reply: "Hi there",
            interrupted: false,
            stats,
        });
        await tick();
        await type("draft");
        await type("\r");
        await resize(30, 10);
        session().emit({ type: "delta", text: "Streamed" });
        await type("x");
        await type("\u0012");
        await type("\u001B");
        await resize(100, 24);
        const frame = app.lastFrame() ?? "";
        expect(frame).toContain("Streamed▍");
        expect(frame).not.toContain("raw (ctrl+r)");
        expect(session().interrupts).toBe(0);
        expect(frame.split("Hi there")).toHaveLength(2);
        expect(session().sent).toEqual(["hi", "draft"]);
    });

    it("quits on Ctrl+C while too small", async () => {
        const { session, type, resize } = setup();
        await tick();
        await resize(30, 10);
        await type("\u0003");
        expect(session().closed).toBe(true);
    });

    it("keeps the message shorter than a tiny window", async () => {
        const { app, resize } = setup();
        await tick();
        await resize(20, 3);
        expect((app.lastFrame() ?? "").split("\n")).toHaveLength(2);
        // The full message would be cut before its sizes.
        expect(flat(app.lastFrame())).toContain("Needs 20 × 40 (is 3 × 20)");
    });

    it("prints a reply that ends while too small at the grown width", async () => {
        const { app, session, type, resize } = setup();
        await tick();
        await type("hi");
        await type("\r");
        await resize(30, 10);
        const reply = "Hello there, this reply is long enough to wrap";
        session().emit({ type: "delta", text: reply });
        session().emit({ type: "turn-end", reply, interrupted: false, stats });
        await tick();
        await resize(100, 24);
        const frame = app.lastFrame() ?? "";
        expect(frame).toContain(`dorothy  ${reply}`);
        expect(frame).toContain(
            "1 in · 2 out · ttft 0.3s · 1.5s · $0.0010 · chat $0.0010",
        );
        expect(frame.split(reply)).toHaveLength(2);
    });

    it("keeps a draft typed before the window shrank", async () => {
        const { app, type, resize } = setup();
        await tick();
        await type("draft");
        await resize(30, 10);
        await type("x");
        await resize(100, 24);
        expect(app.lastFrame()).toContain("› draft▏");
    });

    it("orders warnings, input, statusline and header under the border", async () => {
        const { app, session, type } = setup({ failWrites: true });
        await tick();
        await type("hello");
        await type("\r");
        session().emit({
            type: "turn-end",
            reply: "Hi there",
            interrupted: false,
            stats,
        });
        await tick();
        const lines = (app.lastFrame() ?? "").split("\n");
        const warning = lines.findIndex((line) =>
            line.startsWith("! transcript not saved"),
        );
        expect(lines[warning - 1]).toStartWith("────");
        expect(lines[warning + 1]).toStartWith("›");
        expect(lines.at(-2)).toBe(
            "chat $0.0010 · $0.0010 · 1 in · 2 out · ttft 0.3s · 1.5s",
        );
        expect(lines.at(-1)).toStartWith(
            "dorothy · tumble-orchid-vapor-lantern",
        );
    });

    it("shows the chat's cost in the statusline before the first reply", async () => {
        const { app } = setup();
        await tick();
        expect((app.lastFrame() ?? "").split("\n").at(-2)).toBe("chat $0.0000");
    });

    it("draws no statusline when it has no modules", async () => {
        const { app } = setup({
            config: {
                ...DEFAULT_CONFIG,
                statusline: { modules: [], maxLines: 1 },
            },
        });
        await tick();
        expect((app.lastFrame() ?? "").split("\n").at(-2)).toStartWith("›");
    });

    it("shows a resumed reply's stats", async () => {
        const { app } = setup({
            history: [
                { role: "user", text: "earlier" },
                {
                    role: "assistant",
                    text: "yes",
                    stats,
                    chatCostUsd: 0.002,
                },
            ],
        });
        await tick();
        expect(app.lastFrame()).toContain(
            "1 in · 2 out · ttft 0.3s · 1.5s · $0.0010 · chat $0.0020",
        );
    });

    it("draws reply stats as configured", async () => {
        const { app, session, type } = setup({
            // No statusline, whose defaults would show "1 in" too.
            config: {
                statusline: { modules: [], maxLines: 1 },
                replyStats: { modules: ["out"], maxLines: 1 },
            },
        });
        await tick();
        await type("hello");
        await type("\r");
        session().emit({
            type: "turn-end",
            reply: "Hi there",
            interrupted: false,
            stats,
        });
        await tick();
        expect(app.lastFrame()).toContain(`${" ".repeat(9)}2 out`);
        expect(app.lastFrame()).not.toContain("1 in");
    });

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

    it("keeps composing while a reply streams, and sends after", async () => {
        const { app, session, type } = setup();
        await tick();
        await type("a");
        await type("\r");
        await type("b");
        await type("\r");
        expect(session().sent).toEqual(["a"]);
        expect(app.lastFrame()).toContain("› b▏");
        session().emit({
            type: "turn-end",
            reply: "ok",
            interrupted: false,
            stats,
        });
        await tick();
        await type("\r");
        expect(session().sent).toEqual(["a", "b"]);
    });

    it("recalls earlier messages, resumed ones included", async () => {
        const { app, type } = setup({
            history: [
                { role: "user", text: "earlier" },
                { role: "assistant", text: "yes" },
            ],
        });
        await tick();
        await type("\u001B[A");
        expect(app.lastFrame()).toContain("› earlier▏");
    });

    it("keeps recall and the kill buffer through the Too Small screen", async () => {
        const { app, type, resize } = setup();
        await tick();
        await type("one");
        await type("\r");
        await type("wip");
        await type("\u001B[A");
        await resize(30, 10);
        await resize(100, 24);
        await type("\u001B[B");
        expect(app.lastFrame()).toContain("› wip▏");
        await type("\u0015");
        await resize(30, 10);
        await resize(100, 24);
        await type("\u0019");
        expect(app.lastFrame()).toContain("› wip▏");
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
        const { app, sessions, histories, entries, type } = setup({
            history: [
                { role: "user", text: "earlier" },
                { role: "assistant", text: "yes" },
            ],
        });
        await tick();
        await type("hello");
        await type("\r");
        sessions[0]?.emit({ type: "delta", text: "Par" });
        sessions[0]?.emit({ type: "error", message: "boom", partial: "Par" });
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
            { role: "assistant", text: "Par" },
        ]);
        expect(entries).toContainEqual({
            kind: "assistant",
            text: "Par",
            interrupted: true,
        });
        expect(sessions[1]?.sent).toEqual(["again"]);
    });

    it("survives an interrupt that rejects", async () => {
        const { app, session, type } = setup();
        await tick();
        session().failInterrupt = true;
        await type("a");
        await type("\r");
        await type("\u001B");
        await tick();
        expect(session().interrupts).toBe(1);
        expect(app.lastFrame()).toContain("interrupt failed: subprocess gone");
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

    it("keeps a tall draft shorter than the window", async () => {
        const { app, type } = setup();
        await tick();
        await type("word ".repeat(600));
        const lines = (app.lastFrame() ?? "").split("\n");
        expect(lines.length).toBeLessThan(24);
        expect(lines.at(-3)).toContain("▏");
        const top = lines.findIndex((line) => line.startsWith("↑"));
        expect(lines.length - 3 - top + 1).toBe(5);
    });

    it("clears a draft on Ctrl+C, then quits", async () => {
        const { app, session, type } = setup();
        await tick();
        await type("abc");
        await type("\u0003");
        expect(session().closed).toBe(false);
        expect(app.lastFrame()).toContain("enter send");
        await type("\u0003");
        expect(session().closed).toBe(true);
    });

    it("deletes forward on Ctrl+D while there is a draft", async () => {
        const { app, session, type } = setup();
        await tick();
        await type("ab");
        await type("\u001B[D");
        await type("\u0004");
        expect(session().closed).toBe(false);
        expect(app.lastFrame()).toContain("› a▏");
    });

    it("replaces the draft with what the editor saved", async () => {
        const seen: string[] = [];
        const { app, type } = setup({
            editDraft: async (text) => {
                seen.push(text);
                return { ok: true, text: "from the editor" };
            },
        });
        await tick();
        await type("abc");
        await type("\u0007");
        await tick();
        expect(seen).toEqual(["abc"]);
        expect(app.lastFrame()).toContain("› from the editor▏");
    });

    it("keeps the draft and warns when the editor fails", async () => {
        const { app, type } = setup({
            editDraft: async () => ({
                ok: false,
                message: "editor exited with 1",
            }),
        });
        await tick();
        await type("abc");
        await type("\u0007");
        await tick();
        expect(app.lastFrame()).toContain("› abc▏");
        expect(app.lastFrame()).toContain("editor exited with 1");
    });

    it("opens one editor at a time", async () => {
        let calls = 0;
        let finish = (_: EditResult) => {};
        const { type } = setup({
            editDraft: () => {
                calls++;
                return new Promise((resolve) => {
                    finish = resolve;
                });
            },
        });
        await tick();
        await type("\u0007");
        await type("\u0007");
        expect(calls).toBe(1);
        finish({ ok: true, text: "" });
        await tick();
    });

    it("shows a reply that ended while the editor was open", async () => {
        let finish = (_: EditResult) => {};
        const { app, session, type } = setup({
            editDraft: () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        });
        await tick();
        await type("question");
        await type("\r");
        await type("\u0007");
        session().emit({
            type: "turn-end",
            reply: "Finished while editing",
            interrupted: false,
            stats,
        });
        await tick();
        finish({ ok: true, text: "next" });
        await tick();
        await tick();
        expect(app.lastFrame()).toContain("Finished while editing");
    });

    it("ends recall when the editor returns a draft", async () => {
        const { app, type } = setup({
            editDraft: async () => ({ ok: true, text: "one edited" }),
        });
        await tick();
        await type("one");
        await type("\r");
        await type("wip");
        await type("\u001B[A");
        await type("\u0007");
        await tick();
        await type("\u001B[B");
        expect(app.lastFrame()).toContain("› one edited▏");
    });

    it("cleans the editor's text as a paste is cleaned", async () => {
        const { app, type } = setup({
            editDraft: async () => ({ ok: true, text: "x\r\na\u001Bb\tcd" }),
        });
        await tick();
        await type("\u0007");
        await tick();
        await type("X");
        expect(app.lastFrame()).toContain("› x\n  ab    cdX▏");
    });

    it("quits on Ctrl+D while too small, keeping a draft", async () => {
        const { session, type, resize } = setup();
        await tick();
        await type("abc");
        await resize(30, 10);
        await type("\u0004");
        expect(session().closed).toBe(true);
    });

    it("quits on Ctrl+C while too small rather than clearing the draft", async () => {
        const { session, type, resize } = setup();
        await tick();
        await type("abc");
        await resize(30, 10);
        await type("\u0003");
        expect(session().closed).toBe(true);
    });

    it("quits on Ctrl+D", async () => {
        const { session, type } = setup();
        await tick();
        await type("\u0004");
        expect(session().closed).toBe(true);
    });

    it("takes no message while closing, and closes once", async () => {
        const { app, session, entries, type } = setup();
        await tick();
        session().closing = new Promise(() => {});
        await type("\u0004");
        await type("late");
        await type("\r");
        await type("\u0004");
        expect(app.lastFrame()).toContain("closing");
        expect(entries.filter((entry) => entry.kind === "user")).toEqual([]);
        expect(session().closes).toBe(1);
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
