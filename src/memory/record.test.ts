// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/record.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { ChatSession, ConversationEvent, Notice } from "@dorothy/core";
import type { TranscriptEntry } from "../transcript.js";
import { FakeSession } from "./fake-session.js";
import { EXPECTED, HASH, PHRASE, SCRIPT } from "./record.fixture.js";
import { noticeChannel, sessionRecorder } from "./record.js";

function recorded(options: { resumed?: boolean; fail?: boolean } = {}) {
    const entries: TranscriptEntry[] = [];
    const warnings: string[] = [];
    const wrap = sessionRecorder({
        sink: {
            append: async (entry) => {
                if (options.fail) {
                    throw new Error("disk full");
                }
                entries.push(entry);
            },
        },
        phrase: PHRASE,
        promptHash: HASH,
        resumed: options.resumed ?? false,
        warn: (message) => {
            warnings.push(message);
        },
    });
    return { entries, warnings, wrap };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("sessionRecorder", () => {
    // As App drives sessions: a send after an error closes the dead
    // session and opens a new one before sending.
    it("records the scripted chat as App did", async () => {
        const { entries, wrap } = recorded();
        const inner: FakeSession[] = [];
        let current = null as ChatSession | null;
        let dead = false;
        const connect = () => {
            void current?.close();
            const next = new FakeSession();
            inner.push(next);
            current = wrap(next);
        };
        connect();
        for (const step of SCRIPT) {
            if ("send" in step) {
                if (dead) {
                    connect();
                    dead = false;
                }
                current?.send(step.send);
            } else {
                const target =
                    step.session === undefined
                        ? inner.at(-1)
                        : inner[step.session];
                target?.emit(step.emit);
                dead ||= step.emit.type === "error";
            }
        }
        await settle();
        expect(entries).toEqual(EXPECTED);
    });

    it("records a resumed chat's first session as resumed", async () => {
        const { entries, wrap } = recorded({ resumed: true });
        const inner = new FakeSession();
        wrap(inner);
        inner.emit({ type: "ready", model: "m", sdkSessionId: "s" });
        await settle();
        expect(entries[0]).toMatchObject({ kind: "session", resumed: true });
    });

    it("passes events and messages through", async () => {
        const { wrap } = recorded();
        const inner = new FakeSession();
        const session = wrap(inner);
        const heard: ConversationEvent[] = [];
        session.subscribe((event) => heard.push(event));
        inner.emit({ type: "delta", text: "Hi" });
        session.send("hello");
        expect(heard).toEqual([{ type: "delta", text: "Hi" }]);
        expect(inner.sent).toEqual(["hello"]);
    });

    it("warns when an entry cannot be written, and goes on", async () => {
        const { warnings, wrap } = recorded({ fail: true });
        const inner = new FakeSession();
        wrap(inner).send("hello");
        await settle();
        expect(warnings).toEqual(["transcript not saved: disk full"]);
        expect(inner.sent).toEqual(["hello"]);
    });
});

describe("noticeChannel", () => {
    it("tells each listener of a warning until it stops listening", () => {
        const channel = noticeChannel();
        const heard: Notice[] = [];
        const stop = channel.subscribe((notice) => heard.push(notice));
        channel.warn("one");
        stop();
        channel.warn("two");
        expect(heard).toEqual([{ type: "warning", message: "one" }]);
    });
});
