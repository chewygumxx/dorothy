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
    call,
    context,
    hostEnvironment,
    hostInstructions,
    inputImage,
    line,
    message,
    meta,
    output,
    SESSION,
    userBlocks,
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

    it("halts rather than coercing an object used as a text block type", () => {
        const read = readCodex([
            line("response_item", {
                type: "message",
                role: "user",
                content: [
                    { type: { toString: null }, text: "Synthetic text." },
                ],
            }),
        ]);
        expect(read.events).toEqual([]);
        expect(read.halt?.line).toBe(0);
        expect(read.halt?.reason).toBe("an unsupported text block");
    });
});

describe("Codex incremental line numbering", () => {
    it("keeps source ids when a source supplies only an appended tail", () => {
        const tail = [
            call("function_call", "tail", "fixture", "{}"),
            output("function_call_output", "tail", "Done."),
        ];
        const full = readCodex([meta(), context(), ...tail]);
        const appended = readCodex(tail, { lineOffset: 2 });
        expect(appended.events).toEqual(full.events);
        expect(appended.events[0]?.sourceId).toBe("3");
    });
    for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER]) {
        it(`refuses an invalid or overflowing line offset (${offset})`, () => {
            expect(() =>
                readCodex([message("user", "Synthetic.")], {
                    lineOffset: offset,
                }),
            ).toThrow("invalid line offset");
        });
    }
});

describe("Codex tool pairs", () => {
    for (const family of ["function", "custom_tool"] as const) {
        it(`pairs ${family} calls by id at the call's ordinal and timestamp`, () => {
            const read = readCodex([
                call(
                    `${family}_call`,
                    "first",
                    "fixture-one",
                    "first input",
                    2,
                ),
                call(
                    `${family}_call`,
                    "second",
                    "fixture-two",
                    "second input",
                    3,
                ),
                output(`${family}_call_output`, "second", "second output", 4),
                output(
                    `${family}_call_output`,
                    "first",
                    [
                        { type: "input_text", text: "first output" },
                        { type: "input_text", text: "continued" },
                    ],
                    5,
                ),
            ]);
            expect(read.events).toEqual([
                {
                    kind: "tool",
                    name: "fixture-one",
                    input: "first input",
                    output: "first output\ncontinued",
                    ok: true,
                    sourceId: "1",
                    at: at(2),
                },
                {
                    kind: "tool",
                    name: "fixture-two",
                    input: "second input",
                    output: "second output",
                    ok: true,
                    sourceId: "2",
                    at: at(3),
                },
            ]);
            expect(read.halt).toBeNull();
            expect(read.unknown).toEqual([]);
            expect(read.pending).toBeNull();
        });
    }
    it("waits at an unanswered call and resumes without changing source ids", () => {
        const lines = [
            message("user", "Before."),
            call("function_call", "later", "fixture", '{"value":1}', 2),
            message("assistant", "After.", 3),
        ];
        const first = readCodex(lines);
        expect(first.events).toHaveLength(1);
        expect(first.pending).toBe(1);
        expect(first.halt).toBeNull();
        const next = readCodex([
            ...lines,
            output("function_call_output", "later", "Done.", 4),
        ]);
        expect(next.events[0]).toEqual(first.events[0]);
        expect(
            next.events.map((event) => [event.kind, event.sourceId]),
        ).toEqual([
            ["user", "1"],
            ["tool", "2"],
            ["assistant", "3"],
        ]);
        expect(next.pending).toBeNull();
    });
    it("records an unanswered call as failed only when the session has ended", () => {
        const read = readCodex(
            [call("custom_tool_call", "missing", "fixture", "patch", 4)],
            { ended: true },
        );
        expect(read.events).toEqual([
            {
                kind: "tool",
                name: "fixture",
                input: "patch",
                output: "",
                ok: false,
                sourceId: "1",
                at: at(4),
            },
        ]);
        expect(read.pending).toBeNull();
    });
    it("does not pair across a malformed line or mix tool families", () => {
        const waiting = call("function_call", "id", "fixture", "{}", 1);
        const read = readCodex([
            waiting,
            "{",
            output("function_call_output", "id", "Too late."),
        ]);
        expect(read.events).toEqual([]);
        expect(read.halt?.line).toBe(1);
        expect(read.pending).toBe(0);
        expect(
            readCodex([
                waiting,
                output("custom_tool_call_output", "id", "Wrong family."),
            ]).events,
        ).toEqual([]);
    });
    it("leaves an unmatched output as bookkeeping and validates it", () => {
        const read = readCodex([
            output("function_call_output", "unmatched", "Synthetic output."),
            message("assistant", "Done."),
        ]);
        expect(read.events.map((event) => event.kind)).toEqual(["assistant"]);
        expect(read.unknown).toEqual([]);
        expect(read.halt).toBeNull();
    });
    for (const payload of [
        { type: "function_call", name: "fixture", arguments: "{}" },
        { type: "custom_tool_call", call_id: "id", input: "patch" },
        {
            type: "function_call",
            call_id: "id",
            name: "fixture",
            arguments: {},
        },
        {
            type: "custom_tool_call",
            call_id: "id",
            name: "fixture",
            input: null,
        },
        { type: "function_call_output", output: "Synthetic." },
        { type: "custom_tool_call_output", call_id: "id", output: 4 },
        {
            type: "function_call_output",
            call_id: "id",
            output: [{ type: "input_text" }],
        },
    ]) {
        it(`halts at malformed ${payload.type} without leaking its contents`, () => {
            const read = readCodex([
                message("user", "Before."),
                line("response_item", payload),
                message("assistant", "After."),
            ]);
            expect(read.events).toHaveLength(1);
            expect(read.halt?.line).toBe(1);
            expect(read.halt?.reason).not.toContain("Synthetic.");
        });
    }
});

describe("Codex injected user context", () => {
    for (const [name, block] of [
        ["environment", hostEnvironment],
        ["AGENTS instructions", hostInstructions],
        [
            "instruction wrapper",
            "<INSTRUCTIONS>\nSynthetic rules.\n</INSTRUCTIONS>",
        ],
    ] as const) {
        it(`omits host ${name} without changing later source ids`, () => {
            const read = readCodex([
                userBlocks([`  ${block}`]),
                message("user", "A real fixture prompt."),
            ]);
            expect(read.events).toEqual([
                {
                    kind: "user",
                    text: "A real fixture prompt.",
                    sourceId: "2",
                    at: at(1),
                },
            ]);
            expect(read.halt).toBeNull();
        });
    }
    it("omits both context blocks while retaining speech in a mixed message", () => {
        const read = readCodex([
            userBlocks([
                hostInstructions,
                hostEnvironment,
                "Keep these fixture words.",
            ]),
        ]);
        expect(read.events).toEqual([
            {
                kind: "user",
                text: "Keep these fixture words.",
                sourceId: "1",
                at: at(1),
            },
        ]);
    });
    it("retains speech after a closed context wrapper in the same block", () => {
        const read = readCodex([
            userBlocks([`${hostEnvironment}\nWhat is moss?`]),
        ]);
        expect(read.events[0]).toMatchObject({
            kind: "user",
            text: "What is moss?",
        });
    });
    it("keeps ordinary client-authored-false messages and quoted markers", () => {
        const record = JSON.parse(
            message(
                "user",
                "Discuss <environment_context> and # AGENTS.md instructions as text.",
            ),
        );
        record.metadata = { client_authored: false };
        const read = readCodex([
            JSON.stringify(record),
            message("assistant", hostEnvironment),
        ]);
        expect(read.events.map((event) => event.kind)).toEqual([
            "user",
            "assistant",
        ]);
        expect(read.events[0]).toMatchObject({
            text: "Discuss <environment_context> and # AGENTS.md instructions as text.",
        });
        expect(read.events[1]).toMatchObject({ text: hostEnvironment });
    });
    it("does not record an incomplete host wrapper as user speech", () => {
        expect(
            readCodex([
                userBlocks([
                    "<environment_context>\nSynthetic partial context.",
                ]),
            ]).events,
        ).toEqual([]);
    });
});

describe("Codex non-text content", () => {
    it("keeps an image-only user turn without reading its image", () => {
        const read = readCodex([
            line("response_item", {
                type: "message",
                role: "user",
                content: [inputImage],
            }),
        ]);
        expect(read.events).toEqual([
            { kind: "user", text: "[image]", sourceId: "1", at: at(0) },
        ]);
        expect(read.halt).toBeNull();
    });
    it("keeps text and image placeholders in block order", () => {
        const read = readCodex([
            line("response_item", {
                type: "message",
                role: "assistant",
                content: [
                    { type: "output_text", text: "First." },
                    inputImage,
                    { type: "refusal", refusal: "Synthetic refusal." },
                    { type: "output_text", text: "Last." },
                ],
            }),
        ]);
        expect(read.events[0]).toMatchObject({
            kind: "assistant",
            text: "First.\n\n[image]\n\nLast.",
        });
        expect(read.halt).toBeNull();
    });
    it("keeps image markers in tool output block arrays", () => {
        const read = readCodex([
            call("function_call", "image", "fixture", "{}"),
            output("function_call_output", "image", [inputImage]),
        ]);
        expect(read.events[0]).toMatchObject({
            kind: "tool",
            output: "[image]",
            ok: true,
        });
        expect(read.halt).toBeNull();
    });
    for (const block of [
        {
            type: "input_file",
            filename: "fixture.txt",
            file_data: "Synthetic file.",
        },
        {
            type: "input_audio",
            input_audio: { data: "synthetic", format: "wav" },
        },
        { type: "refusal", refusal: "Synthetic refusal." },
        { type: "reasoning_text", text: "Synthetic reasoning." },
        { type: "summary_text", text: "Synthetic summary." },
        { type: "encrypted_content", encrypted_content: "synthetic" },
    ]) {
        it(`passes known ${block.type} blocks without recording their content`, () => {
            const read = readCodex([
                line("response_item", {
                    type: "message",
                    role: "user",
                    content: [block],
                }),
                message("user", "After."),
            ]);
            expect(read.events).toEqual([
                { kind: "user", text: "After.", sourceId: "2", at: at(1) },
            ]);
            expect(read.halt).toBeNull();
        });
    }
    it("still halts on an unknown or missing block tag", () => {
        for (const block of [{ type: "future_content" }, {}, { type: "" }]) {
            const read = readCodex([
                line("response_item", {
                    type: "message",
                    role: "user",
                    content: [block],
                }),
            ]);
            expect(read.halt?.line).toBe(0);
            expect(read.events).toEqual([]);
        }
    });
});

describe("Codex unobserved bookkeeping", () => {
    for (const type of [
        "agent_reasoning",
        "turn_aborted",
        "context_compacted",
    ]) {
        it(`reports ${type} once instead of assuming its shape`, () => {
            const read = readCodex([
                line("event_msg", { type }),
                line("event_msg", { type }),
                message("user", "After."),
            ]);
            expect(read.unknown).toEqual([
                { line: 0, type: `event_msg/${type}` },
            ]);
            expect(read.halt).toBeNull();
            expect(read.events[0]).toMatchObject({
                sourceId: "3",
                text: "After.",
            });
        });
    }
});
