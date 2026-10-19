// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/claude-code.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { type ReadOptions, readLines, spoken } from "./claude-code.js";
import {
    assistantLine,
    at,
    meta,
    queued,
    result,
    SESSION,
    text,
    use,
    userLine,
} from "./fixtures.js";

const entries = (lines: string[], options: ReadOptions = {}) =>
    readLines(lines, options).events.map((event) => event.entry);

describe("readLines", () => {
    it("maps the user and her replies, each with its line's uuid and time", () => {
        const read = readLines([
            userLine("u1", 0, "hello"),
            assistantLine("a1", 1, [text("Hi.")]),
        ]);
        expect(read.events).toEqual([
            { entry: { kind: "user", text: "hello" }, uuid: "u1", at: at(0) },
            {
                entry: { kind: "assistant", text: "Hi.", interrupted: false },
                uuid: "a1",
                at: at(1),
            },
        ]);
        expect(read.model).toBe("claude-opus-5-5");
        expect(read.sessions).toEqual([SESSION]);
        expect(read.halt).toBeNull();
    });

    it("maps several blocks in a line in order, and keeps no thinking", () => {
        expect(
            entries([
                assistantLine("a1", 1, [
                    { type: "thinking", thinking: "hmm", signature: "x" },
                    text("One."),
                    text("Two."),
                ]),
            ]),
        ).toEqual([
            { kind: "assistant", text: "One.", interrupted: false },
            { kind: "assistant", text: "Two.", interrupted: false },
        ]);
    });

    it("makes a call and its later result one tool event, at the call's line", () => {
        const read = readLines([
            assistantLine("a1", 1, [use("t1", "Bash", { command: "ls" })]),
            meta("mode"),
            userLine("r1", 2, [result("t1", "a\nb")]),
            assistantLine("a2", 3, [use("t2", "Read", { file_path: "/x" })]),
            userLine("r2", 4, [result("t2", [text("no such file")], true)]),
        ]);
        expect(read.events).toEqual([
            {
                entry: {
                    kind: "tool",
                    name: "Bash",
                    input: '{"command":"ls"}',
                    output: "a\nb",
                    ok: true,
                    cut: { input: 0, output: 0 },
                },
                uuid: "a1",
                at: at(1),
            },
            {
                entry: {
                    kind: "tool",
                    name: "Read",
                    input: '{"file_path":"/x"}',
                    output: "no such file",
                    ok: false,
                    cut: { input: 0, output: 0 },
                },
                uuid: "a2",
                at: at(3),
            },
        ]);
    });

    it("records her lookups as recall events and her remember as her own", () => {
        const found = JSON.stringify({
            facts: [],
            moreFacts: 0,
            results: [{ identifier: "x" }],
            more: 2,
        });
        expect(
            entries([
                assistantLine("a1", 1, [
                    use("t1", "mcp__dorothy-memory__search", { query: "tea" }),
                ]),
                userLine("r1", 2, [result("t1", [text(found)])]),
                assistantLine("a2", 3, [
                    use("t2", "mcp__dorothy-memory__remember", {
                        action: "write",
                        name: "tea",
                    }),
                ]),
                userLine("r2", 4, [
                    result("t2", '{"action":"written","id":"personal/tea"}'),
                ]),
            ]),
        ).toEqual([
            {
                kind: "recall",
                id: "t1",
                ok: true,
                offset: 0,
                tool: "search",
                query: "tea",
                hits: 3,
                facts: 0,
            },
            {
                kind: "tool",
                name: "mcp__dorothy-memory__remember",
                input: '{"action":"write","name":"tea"}',
                output: '{"action":"written","id":"personal/tea"}',
                ok: true,
                cut: { input: 0, output: 0 },
                memory: true,
            },
        ]);
    });

    it("keeps a subagent as its call, prompt and result", () => {
        expect(
            entries([
                assistantLine("a1", 1, [
                    use("t1", "Agent", { description: "d", prompt: "look" }),
                ]),
                userLine("s1", 2, "inside", { isSidechain: true }),
                userLine("r1", 3, [result("t1", [text("found it")])]),
            ]),
        ).toEqual([
            {
                kind: "tool",
                name: "Agent",
                input: '{"description":"d","prompt":"look"}',
                output: "found it",
                ok: true,
                cut: { input: 0, output: 0 },
            },
        ]);
    });

    it("holds back from a call not yet answered, and records it failed once the session ends", () => {
        const lines = [
            userLine("u1", 0, "go"),
            assistantLine("a1", 1, [
                text("Running."),
                use("t1", "Bash", { command: "sleep" }),
            ]),
            assistantLine("a2", 2, [text("Later.")]),
        ];
        expect(entries(lines)).toEqual([{ kind: "user", text: "go" }]);
        expect(entries(lines, { ended: true })).toEqual([
            { kind: "user", text: "go" },
            { kind: "assistant", text: "Running.", interrupted: false },
            {
                kind: "tool",
                name: "Bash",
                input: '{"command":"sleep"}',
                output: "",
                ok: false,
                cut: { input: 0, output: 0 },
            },
            { kind: "assistant", text: "Later.", interrupted: false },
        ]);
    });

    it("passes over meta, summaries, sidechains, system lines and bookkeeping", () => {
        const read = readLines([
            userLine("m1", 0, "injected", { isMeta: true }),
            userLine("c1", 0, "summary", { isCompactSummary: true }),
            assistantLine("s1", 0, [text("aside")], { isSidechain: true }),
            JSON.stringify({
                type: "system",
                subtype: "compact_boundary",
                uuid: "y1",
                timestamp: at(0),
            }),
            meta("file-history-snapshot"),
            meta("ai-title"),
            userLine("u1", 1, "real"),
        ]);
        expect(read.events.map((event) => event.entry)).toEqual([
            { kind: "user", text: "real" },
        ]);
        expect(read.unknown).toEqual([]);
    });

    it("passes over a new type, with or without a uuid, and says so", () => {
        const read = readLines([
            meta("brand-new"),
            JSON.stringify({ type: "newer", uuid: "n1", timestamp: at(0) }),
            userLine("u1", 1, "still read"),
        ]);
        expect(read.unknown).toEqual([
            { line: 0, type: "brand-new" },
            { line: 1, type: "newer" },
        ]);
        expect(read.events.map((event) => event.entry)).toEqual([
            { kind: "user", text: "still read" },
        ]);
        expect(read.halt).toBeNull();
    });

    it("takes the words of a prompt queued while she worked, and no task's notice", () => {
        expect(
            entries([
                queued("q1", 1, "also this"),
                queued(
                    "q2",
                    2,
                    "<task-notification>done</task-notification>",
                    "task-notification",
                ),
            ]),
        ).toEqual([{ kind: "user", text: "also this" }]);
    });

    it("keeps an image the user gave as a mark", () => {
        expect(
            entries([
                userLine("u1", 0, [text("see"), { type: "image", source: {} }]),
            ]),
        ).toEqual([{ kind: "user", text: "see\n\n[image]" }]);
    });

    it("passes over the lines already recorded, and those before the launch", () => {
        const lines = [
            userLine("u1", 0, "old"),
            userLine("u2", 5, "new"),
            userLine("u3", 6, "newer"),
        ];
        expect(
            entries(lines, {
                recorded: new Set(["u2"]),
                since: Date.parse(at(1)),
            }),
        ).toEqual([{ kind: "user", text: "newer" }]);
    });

    it("passes over a line of an unexpected shape from before the launch", () => {
        const bad = (uuid: string, minute: number) =>
            assistantLine(uuid, minute, [], {
                message: { role: "assistant", content: "plain" },
            });
        const since = Date.parse(at(3));
        const before = readLines([bad("a1", 0), userLine("u2", 5, "new")], {
            since,
        });
        expect(before.halt).toBeNull();
        expect(before.events.map((event) => event.entry)).toEqual([
            { kind: "user", text: "new" },
        ]);
        const after = readLines([userLine("u2", 5, "new"), bad("a2", 6)], {
            since,
        });
        expect(after.halt).toMatchObject({
            line: 1,
            reason: "an assistant line without its content",
        });
    });

    it("names the model of the first assistant line that is not synthetic", () => {
        const read = readLines([
            assistantLine("a1", 0, [text("x")], {
                message: {
                    role: "assistant",
                    model: "<synthetic>",
                    content: [text("x")],
                },
            }),
            assistantLine("a2", 1, [text("y")]),
        ]);
        expect(read.model).toBe("claude-opus-5-5");
    });

    describe("halting", () => {
        it("halts at a line that is not JSON, keeping what came before", () => {
            const read = readLines([
                userLine("u1", 0, "fine"),
                "{not json",
                userLine("u2", 1, "after"),
            ]);
            expect(read.events.map((event) => event.uuid)).toEqual(["u1"]);
            expect(read.halt).toEqual({
                line: 1,
                type: null,
                uuid: null,
                reason: "not a JSON object",
            });
        });

        it("halts at a user line of a shape it does not know", () => {
            const read = readLines([
                JSON.stringify({
                    type: "user",
                    uuid: "u1",
                    timestamp: at(0),
                    message: { content: 7 },
                }),
            ]);
            expect(read.halt).toEqual({
                line: 0,
                type: "user",
                uuid: "u1",
                reason: "a user line without its content",
            });
        });

        it("halts at an assistant line without a uuid, recording none of its blocks", () => {
            const bad = JSON.stringify({
                type: "assistant",
                timestamp: at(0),
                message: { content: [text("x")] },
            });
            const read = readLines([bad]);
            expect(read.events).toEqual([]);
            expect(read.halt?.reason).toBe("no uuid");
        });

        it("halts at a queued command without its prompt", () => {
            expect(readLines([queued("q1", 0, 3)]).halt?.reason).toBe(
                "a queued command without its prompt",
            );
        });

        it("drops a halting line's earlier blocks", () => {
            const read = readLines([
                assistantLine("a1", 0, [
                    text("kept?"),
                    { type: "tool_use", id: 3 },
                ]),
            ]);
            expect(read.events).toEqual([]);
            expect(read.halt?.reason).toBe(
                "a tool call without its id or name",
            );
        });
    });
});

describe("command markup and gaps in a line", () => {
    const COMPACT =
        "<command-name>/compact</command-name>\n<command-args>tea</command-args>";

    it("takes a command from a whole user line, whether text or blocks", () => {
        expect(
            entries([
                userLine("u1", 0, COMPACT),
                userLine("u2", 1, [text(COMPACT)]),
                userLine(
                    "u3",
                    2,
                    "<local-command-stdout>ok</local-command-stdout>",
                ),
            ]),
        ).toEqual([
            { kind: "user", text: "/compact tea" },
            { kind: "user", text: "/compact tea" },
        ]);
    });

    it("takes a queued prompt that names no command mode as a prompt", () => {
        expect(entries([queued("q1", 0, "also this", null)])).toEqual([
            { kind: "user", text: "also this" },
        ]);
        expect(entries([queued("q2", 0, "ls", "bash")])).toEqual([]);
    });

    it("halts at a tool result without its call's id", () => {
        const read = readLines([
            userLine("u1", 0, [
                { type: "tool_result", content: "ok" },
                text("after"),
            ]),
        ]);
        expect(read.events).toEqual([]);
        expect(read.halt?.reason).toBe("a tool result without its call's id");
    });
});

describe("spoken", () => {
    it("takes a command as typed, and none of Claude Code's own output", () => {
        expect(
            spoken(
                "<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>focus on tea</command-args>",
            ),
        ).toBe("/compact focus on tea");
        expect(
            spoken(
                "<command-message>herdr</command-message>\n<command-name>/herdr</command-name>",
            ),
        ).toBe("/herdr");
        expect(spoken("<bash-input>ls -l</bash-input>")).toBe("! ls -l");
        for (const own of [
            "<local-command-stdout>ok</local-command-stdout>",
            "<local-command-caveat>x</local-command-caveat>",
            "<bash-stdout>a</bash-stdout><bash-stderr></bash-stderr>",
            "<task-notification>t</task-notification>",
            "[Request interrupted by user]",
            "[Request interrupted by user for tool use]",
            "  ",
        ]) {
            expect(spoken(own)).toBeNull();
        }
        expect(spoken("plain words")).toBe("plain words");
    });

    it("keeps markup in her words, and no command without its name", () => {
        const asked =
            "Why does the reader turn a line like <command-name>/compact</command-name> into a command?";
        expect(spoken(asked)).toBe(asked);
        expect(spoken("see <command-name></command-name> here")).toBe(
            "see <command-name></command-name> here",
        );
        expect(
            spoken(
                "<command-name></command-name>\n<command-args>x</command-args>",
            ),
        ).toBeNull();
        expect(
            spoken(
                "<command-message>m</command-message>\n<command-name> </command-name>",
            ),
        ).toBeNull();
        expect(spoken("<command-message>herdr</command-message>")).toBeNull();
        expect(
            spoken(
                "<command-message>m</command-message>\n<command-args>x</command-args>",
            ),
        ).toBeNull();
    });

    it("emits no event for a command without its name", () => {
        const read = readLines([
            userLine("u1", 0, "<command-name></command-name>"),
        ]);
        expect(read.events).toEqual([]);
        expect(read.halt).toBeNull();
    });
});
