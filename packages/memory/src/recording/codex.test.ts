// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/codex.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { readCodex } from "./codex.js";
import {
    at,
    bookkeeping,
    context,
    line,
    message,
    meta,
    SESSION,
} from "./fixtures.js";

describe("readCodex", () => {
    it("reads session metadata and the latest turn's directory and model", () => {
        const read = readCodex([
            meta(),
            context(),
            context("/fixture/other", "fixture-other"),
        ]);
        expect(read.session).toBe(SESSION);
        expect(read.cwd).toBe("/fixture/other");
        expect(read.model).toBe("fixture-other");
        expect(read.at).toBe(at(0));
        expect(read.events).toEqual([]);
        expect(read.halt).toBeNull();
    });
    it("maps messages in order with physical line ordinals and record times", () => {
        const read = readCodex([
            meta(),
            context(),
            "",
            message("user", "Tell me about moss.", 4),
            message("assistant", "Moss likes moisture.", 5),
        ]);
        expect(read.events).toEqual([
            {
                kind: "user",
                text: "Tell me about moss.",
                sourceId: "4",
                at: at(4),
            },
            {
                kind: "assistant",
                text: "Moss likes moisture.",
                interrupted: false,
                sourceId: "5",
                at: at(5),
            },
        ]);
        expect(read.halt).toBeNull();
    });
    it("joins text blocks in one message and skips empty and host messages", () => {
        const read = readCodex([
            message("developer", "Synthetic host instructions."),
            message("system", "Synthetic system instructions."),
            message("user", "  "),
            line("response_item", {
                type: "message",
                role: "assistant",
                content: [
                    { type: "output_text", text: "First." },
                    { type: "output_text", text: "Second." },
                ],
            }),
        ]);
        expect(read.events).toEqual([
            {
                kind: "assistant",
                text: "First.\n\nSecond.",
                interrupted: false,
                sourceId: "4",
                at: at(0),
            },
        ]);
    });
    it("passes known bookkeeping without duplicating event-message text", () => {
        const read = readCodex([
            ...bookkeeping,
            line("event_msg", {
                type: "user_message",
                message: "Duplicate user text.",
            }),
            line("event_msg", {
                type: "agent_message",
                message: "Duplicate assistant text.",
            }),
        ]);
        expect(read.events).toEqual([]);
        expect(read.unknown).toEqual([]);
        expect(read.halt).toBeNull();
    });
    it("keeps only the first occurrence of each unknown record type", () => {
        const read = readCodex([
            line("new_record", {}),
            line("new_record", {}),
            line("response_item", { type: "new_item" }),
            line("event_msg", { type: "new_event" }),
        ]);
        expect(read.unknown).toEqual([
            { line: 0, type: "new_record" },
            { line: 2, type: "response_item/new_item" },
            { line: 3, type: "event_msg/new_event" },
        ]);
        expect(read.halt).toBeNull();
    });
    for (const [name, bad] of [
        ["JSON", "{"],
        ["non-object", "[]"],
        ["missing type", "{}"],
        ["missing payload", JSON.stringify({ type: "response_item" })],
        ["missing subtype", line("response_item", {})],
        ["bad session", line("session_meta", { id: 5 })],
        ["bad context", line("turn_context", { cwd: "/fixture" })],
        [
            "bad message",
            line("response_item", {
                type: "message",
                role: "user",
                content: [{ type: "input_text" }],
            }),
        ],
        ["bad role", message("unknown-role", "Synthetic text.")],
        [
            "bad content",
            line("response_item", {
                type: "message",
                role: "assistant",
                content: {},
            }),
        ],
        [
            "bad time",
            JSON.stringify({
                type: "response_item",
                timestamp: "never",
                payload: { type: "message", role: "user", content: [] },
            }),
        ],
    ] as const) {
        it(`halts at ${name}, keeping only earlier events and static diagnostics`, () => {
            const read = readCodex([
                message("user", "Before."),
                bad,
                message("assistant", "After."),
            ]);
            expect(read.events).toEqual([
                { kind: "user", text: "Before.", sourceId: "1", at: at(1) },
            ]);
            expect(read.halt?.line).toBe(1);
            expect(read.halt?.reason.length).toBeGreaterThan(0);
            expect(read.halt?.reason).not.toContain(bad);
        });
    }
    it("does not replace the session identity or hide a malformed nested text", () => {
        const bad = line("session_meta", { id: "another-fixture-session" });
        expect(readCodex([meta(), bad]).halt?.line).toBe(1);
        const read = readCodex([
            line("response_item", {
                type: "message",
                role: "user",
                content: [
                    { type: "input_text", text: "Partial." },
                    { type: "input_text", text: 4 },
                ],
            }),
        ]);
        expect(read.events).toEqual([]);
        expect(read.halt?.line).toBe(0);
    });
});
