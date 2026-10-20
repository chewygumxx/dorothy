// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/hermes.test.ts
//
//

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readHermes } from "./hermes.js";
import {
    HERMES_SCHEMA,
    hermesAt,
    hermesCall,
    hermesContent,
    hermesMessage,
    hermesSession,
} from "./hermes-fixtures.js";

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(
        roots
            .splice(0)
            .map((root) => rm(root, { recursive: true, force: true })),
    );
});
async function fixture(seed: (db: Database) => void) {
    const root = await mkdtemp(join(tmpdir(), "dorothy-hermes-"));
    roots.push(root);
    const path = join(root, "state.db");
    const writer = new Database(path);
    try {
        writer.exec(HERMES_SCHEMA);
        seed(writer);
    } finally {
        writer.close();
    }
    return path;
}

describe("readHermes messages", () => {
    it("reads session metadata and messages by id rather than clock order", async () => {
        const path = await fixture((db) => {
            hermesSession(db, "fixture-session", { cwd: "/fixture/project" });
            hermesMessage(db, 8, "assistant", "Synthetic answer.", {
                second: 1,
            });
            hermesMessage(db, 3, "user", "Synthetic question.", { second: 5 });
        });
        const [read] = readHermes(path, 0);
        expect(read).toMatchObject({
            session: "fixture-session",
            source: "cli",
            cwd: "/fixture/project",
            model: "fixture-model",
            at: hermesAt(0),
            halt: null,
            unknown: [],
            pending: null,
        });
        expect(read?.events).toEqual([
            {
                kind: "user",
                text: "Synthetic question.",
                sourceId: "3",
                at: hermesAt(5),
            },
            {
                kind: "assistant",
                text: "Synthetic answer.",
                sourceId: "8",
                at: hermesAt(1),
                interrupted: false,
            },
        ]);
    });
    it("keeps a chat-platform session personal without inferring a local directory", async () => {
        const path = await fixture((db) => {
            hermesSession(db, "fixture-chat", {
                source: "telegram",
                origin: JSON.stringify({
                    platform: "telegram",
                    chat_id: "fixture-chat",
                    chat_type: "dm",
                    user_id: "fixture-person",
                }),
            });
            hermesMessage(db, 1, "user", "Synthetic remote words.", {
                session: "fixture-chat",
            });
            hermesSession(db, "fixture-cli", { source: "cli" });
        });
        const reads = readHermes(path, 0);
        expect(reads).toHaveLength(2);
        expect(reads.map((read) => read.cwd)).toEqual([null, null]);
        expect(reads[0]?.events[0]).toMatchObject({
            text: "Synthetic remote words.",
        });
    });
    it("uses an explicit cwd even when the session source is another local transport", async () => {
        const path = await fixture((db) =>
            hermesSession(db, "fixture-tui", {
                source: "tui",
                cwd: "/fixture/tui",
            }),
        );
        expect(readHermes(path, 0)[0]?.cwd).toBe("/fixture/tui");
    });
    it("reads after an exclusive message-id cursor and retains session metadata", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Before.");
            hermesMessage(db, 4, "assistant", "After.");
        });
        expect(readHermes(path, 1)[0]?.events).toEqual([
            {
                kind: "assistant",
                text: "After.",
                sourceId: "4",
                at: hermesAt(4),
                interrupted: false,
            },
        ]);
        expect(readHermes(path, 100)[0]?.events).toEqual([]);
        expect(readHermes(path, 100)[0]?.session).toBe("fixture-session");
    });
    it("decodes sentinel content, preserving literal JSON and escaped sentinel strings", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", '{"literal":"Synthetic prose."}');
            hermesMessage(
                db,
                2,
                "assistant",
                hermesContent([
                    { type: "text", text: "First." },
                    {
                        type: "image_url",
                        image_url: { url: "https://fixture.invalid/image" },
                    },
                    { type: "text", text: "Last." },
                ]),
            );
            hermesMessage(
                db,
                3,
                "user",
                hermesContent("\0json:Synthetic literal."),
            );
        });
        expect(
            readHermes(path, 0)[0]?.events.map((event) =>
                event.kind !== "tool" ? event.text : null,
            ),
        ).toEqual([
            '{"literal":"Synthetic prose."}',
            "First.\n\n[image]\n\nLast.",
            "\0json:Synthetic literal.",
        ]);
    });
    it("skips host roles and reasoning columns while retaining an unknown role once", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "system", "Synthetic host prompt.");
            hermesMessage(db, 2, "developer", "Synthetic instructions.");
            hermesMessage(db, 3, "new-role", "Synthetic unknown.");
            hermesMessage(db, 4, "new-role", "Another unknown.");
            hermesMessage(db, 5, "assistant", "Synthetic answer.");
            db.run(
                "UPDATE messages SET reasoning = 'Synthetic reasoning.' WHERE id = 5",
            );
        });
        const [read] = readHermes(path, 0);
        expect(read?.events).toHaveLength(1);
        expect(read?.events[0]).toMatchObject({
            sourceId: "5",
            text: "Synthetic answer.",
        });
        expect(read?.unknown).toEqual([{ id: 3, type: "new-role" }]);
        expect(read?.halt).toBeNull();
    });
    it("opens the database read-only without changing its bytes or side files", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Synthetic words.");
        });
        const before = await readFile(path);
        const files = await readdir(dirname(path));
        expect(readHermes(path, 0)[0]?.events).toHaveLength(1);
        expect(await readFile(path)).toEqual(before);
        expect(await readdir(dirname(path))).toEqual(files);
    });
    it("does not create a missing database", async () => {
        const root = await mkdtemp(join(tmpdir(), "dorothy-hermes-missing-"));
        roots.push(root);
        expect(() => readHermes(join(root, "absent.db"), 0)).toThrow();
        expect(await readdir(root)).toEqual([]);
    });
    for (const since of [
        -1,
        0.5,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
    ]) {
        it(`refuses an invalid cursor (${since}) before opening a database`, () => {
            expect(() => readHermes("/synthetic/absent.db", since)).toThrow(
                "invalid message cursor",
            );
        });
    }
});

describe("readHermes tools", () => {
    it("records every result of a multi-call assistant row with unique message ids", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Do two things.");
            hermesMessage(db, 2, "assistant", "Starting.", {
                calls: JSON.stringify([
                    hermesCall("first", "fixture-one", '{"value":1}'),
                    hermesCall("second", "fixture-two", "second input"),
                ]),
            });
            hermesMessage(db, 3, "tool", "Second output.", {
                callId: "second",
            });
            hermesMessage(
                db,
                4,
                "tool",
                hermesContent([{ type: "text", text: "First output." }]),
                { callId: "first" },
            );
        });
        const [read] = readHermes(path, 0);
        expect(read?.events).toEqual([
            {
                kind: "user",
                text: "Do two things.",
                sourceId: "1",
                at: hermesAt(1),
            },
            {
                kind: "assistant",
                text: "Starting.",
                sourceId: "2",
                at: hermesAt(2),
                interrupted: false,
            },
            {
                kind: "tool",
                name: "fixture-two",
                input: "second input",
                output: "Second output.",
                ok: true,
                sourceId: "3",
                at: hermesAt(3),
            },
            {
                kind: "tool",
                name: "fixture-one",
                input: '{"value":1}',
                output: "First output.",
                ok: true,
                sourceId: "4",
                at: hermesAt(4),
            },
        ]);
        expect(read?.pending).toBeNull();
        expect(read?.unknown).toEqual([]);
    });
    it("pairs a later result with a call before since, and treats ok as answered", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "assistant", null, {
                calls: JSON.stringify([hermesCall("call")]),
            });
            hermesMessage(
                db,
                2,
                "tool",
                '{"error":"Synthetic tool failure."}',
                { callId: "call" },
            );
        });
        expect(readHermes(path, 1)[0]?.events).toEqual([
            {
                kind: "tool",
                name: "fixture",
                input: "{}",
                output: '{"error":"Synthetic tool failure."}',
                ok: true,
                sourceId: "2",
                at: hermesAt(2),
            },
        ]);
    });
    it("holds later events at an unanswered call and resolves it on replay", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "assistant", "Starting.", {
                calls: JSON.stringify([hermesCall("later")]),
            });
            hermesMessage(db, 2, "assistant", "After.");
        });
        const [waiting] = readHermes(path, 0);
        expect(waiting?.events).toEqual([
            {
                kind: "assistant",
                text: "Starting.",
                sourceId: "1",
                at: hermesAt(1),
                interrupted: false,
            },
        ]);
        expect(waiting?.pending).toBe(1);
        const writer = new Database(path);
        try {
            hermesMessage(writer, 3, "tool", "Done.", { callId: "later" });
        } finally {
            writer.close();
        }
        const [answered] = readHermes(path, 1);
        expect(answered?.pending).toBeNull();
        expect(
            answered?.events.map((event) => [event.kind, event.sourceId]),
        ).toEqual([
            ["assistant", "2"],
            ["tool", "3"],
        ]);
    });
    it("uses call_id before id and strips a bridge response-item suffix", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "assistant", null, {
                calls: JSON.stringify([
                    {
                        ...hermesCall("wrong"),
                        call_id: " right |response_item_fixture",
                    },
                ]),
            });
            hermesMessage(db, 2, "tool", "Done.", { callId: "right" });
        });
        expect(readHermes(path, 0)[0]?.events[0]).toMatchObject({
            kind: "tool",
            output: "Done.",
            sourceId: "2",
        });
    });
    it("uses durable occurrence uids to pair reused ids even when results arrive out of order", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "assistant", null, {
                calls: JSON.stringify([
                    hermesCall("same", "fixture-one", "one"),
                ]),
            });
            hermesMessage(db, 2, "assistant", null, {
                calls: JSON.stringify([
                    hermesCall("same", "fixture-two", "two"),
                ]),
            });
            db.run("UPDATE messages SET tool_call_uids = ? WHERE id = 1", [
                JSON.stringify({ same: "uid-one" }),
            ]);
            db.run("UPDATE messages SET tool_call_uids = ? WHERE id = 2", [
                JSON.stringify({ same: "uid-two" }),
            ]);
            hermesMessage(db, 3, "tool", "Two.", { callId: "same" });
            hermesMessage(db, 4, "tool", "One.", { callId: "same" });
            db.run(
                "UPDATE messages SET tool_call_uid = 'uid-two' WHERE id = 3",
            );
            db.run(
                "UPDATE messages SET tool_call_uid = 'uid-one' WHERE id = 4",
            );
        });
        const [read] = readHermes(path, 0);
        expect(
            read?.events.map((event) =>
                event.kind === "tool" ? [event.input, event.output] : null,
            ),
        ).toEqual([
            ["two", "Two."],
            ["one", "One."],
        ]);
        expect(read?.pending).toBeNull();
    });
    it("does not fall back to a provider id when a result has a different durable uid", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "assistant", null, {
                calls: JSON.stringify([hermesCall("same")]),
            });
            db.run("UPDATE messages SET tool_call_uids = ? WHERE id = 1", [
                JSON.stringify({ same: "uid-one" }),
            ]);
            hermesMessage(db, 2, "tool", "Wrong occurrence.", {
                callId: "same",
            });
            db.run(
                "UPDATE messages SET tool_call_uid = 'uid-other' WHERE id = 2",
            );
        });
        const [read] = readHermes(path, 0);
        expect(read?.events).toEqual([]);
        expect(read?.pending).toBe(1);
    });
    it("never pairs a result across a user turn or another session", async () => {
        const path = await fixture((db) => {
            hermesSession(db, "fixture-session");
            hermesSession(db, "other-session");
            hermesMessage(db, 1, "assistant", null, {
                calls: JSON.stringify([hermesCall("same")]),
            });
            hermesMessage(db, 2, "user", "Next turn.");
            hermesMessage(db, 3, "tool", "Wrong turn.", { callId: "same" });
            hermesMessage(db, 4, "tool", "Wrong session.", {
                callId: "same",
                session: "other-session",
            });
        });
        const reads = readHermes(path, 0);
        expect(reads.flatMap((read) => read.events)).toEqual([]);
        expect(reads[0]?.pending).toBe(1);
        expect(reads[1]?.pending).toBeNull();
    });
    it("validates orphan results but does not invent their input or execution outcome", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "tool", "Orphan answer.", {
                callId: "missing",
            });
            hermesMessage(db, 2, "user", "After.");
        });
        const [read] = readHermes(path, 0);
        expect(read?.events).toEqual([
            { kind: "user", text: "After.", sourceId: "2", at: hermesAt(2) },
        ]);
        expect(read?.unknown).toEqual([]);
        expect(read?.halt).toBeNull();
    });
    for (const calls of [
        "{",
        "{}",
        "[null]",
        JSON.stringify([
            {
                type: "function",
                function: { name: "fixture", arguments: "{}" },
            },
        ]),
        JSON.stringify([
            { id: "call", type: "function", function: { arguments: "{}" } },
        ]),
        JSON.stringify([
            {
                id: "call",
                type: "function",
                function: { name: "fixture", arguments: {} },
            },
        ]),
    ]) {
        it("halts atomically at malformed assistant tool calls", async () => {
            const path = await fixture((db) => {
                hermesSession(db);
                hermesMessage(db, 1, "user", "Before.");
                hermesMessage(db, 2, "assistant", "Uncommitted prose.", {
                    calls,
                });
                hermesMessage(db, 3, "assistant", "Beyond the halt.");
            });
            const [read] = readHermes(path, 0);
            expect(read?.events).toEqual([
                {
                    kind: "user",
                    text: "Before.",
                    sourceId: "1",
                    at: hermesAt(1),
                },
            ]);
            expect(read?.halt).toMatchObject({ id: 2, type: "assistant" });
        });
    }
});

describe("readHermes host context", () => {
    for (const prefix of [
        "[System:",
        "[CONTEXT",
        "[PRIOR CONTEXT",
        "[IMPORTANT: Background",
        "[Your active task list",
        "[Planning state preserved",
        "[ASYNC DELEGATION",
        "[OUT-OF-BAND",
        "Cronjob Response:",
    ]) {
        it(`omits the installed host prefix ${prefix}`, async () => {
            const path = await fixture((db) => {
                hermesSession(db);
                hermesMessage(
                    db,
                    1,
                    "user",
                    `${prefix} Synthetic host context.`,
                );
                hermesMessage(db, 2, "user", "Actual fixture speech.");
            });
            expect(readHermes(path, 0)[0]?.events).toEqual([
                {
                    kind: "user",
                    text: "Actual fixture speech.",
                    sourceId: "2",
                    at: hermesAt(2),
                },
            ]);
        });
    }
    it("strips memory fences from user blocks, ignores api_content and preserves assistant/tool text", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(
                db,
                1,
                "user",
                hermesContent([
                    {
                        type: "text",
                        text: "Before. <memory-context>Synthetic recalled material.</memory-context> After.",
                    },
                    {
                        type: "text",
                        text: "<MEMORY-CONTEXT>Synthetic context only.</MEMORY-CONTEXT>",
                    },
                ]),
                { api: "Synthetic API-only injection." },
            );
            hermesMessage(
                db,
                2,
                "assistant",
                "<memory-context>Assistant quotation.</memory-context>",
                { calls: JSON.stringify([hermesCall("call")]) },
            );
            hermesMessage(
                db,
                3,
                "tool",
                "<memory-context>Raw tool bytes.</memory-context>",
                { callId: "call" },
            );
        });
        const [read] = readHermes(path, 0);
        expect(read?.events[0]).toMatchObject({
            kind: "user",
            text: "Before.  After.",
        });
        expect(read?.events[1]).toMatchObject({
            kind: "assistant",
            text: "<memory-context>Assistant quotation.</memory-context>",
        });
        expect(read?.events[2]).toMatchObject({
            kind: "tool",
            output: "<memory-context>Raw tool bytes.</memory-context>",
        });
    });
    it("does not attribute an unterminated memory fence to the user", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(
                db,
                1,
                "user",
                "Keep this. <memory-context>Synthetic partial host material.",
            );
        });
        expect(readHermes(path, 0)[0]?.events[0]).toMatchObject({
            text: "Keep this.",
        });
    });
    it("keeps the user's words on either side of a merged compression handoff", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(
                db,
                1,
                "user",
                "Before.\n[END OF PRIOR CONTEXT \u2014 COMPACTION SUMMARY BELOW]\n[CONTEXT SUMMARY]: Synthetic handoff.\n--- END OF CONTEXT SUMMARY \u2014 respond to the message below, not the summary above ---\nAfter.",
                { summary: 1 },
            );
        });
        expect(readHermes(path, 0)[0]?.events[0]).toMatchObject({
            text: "Before.\n\nAfter.",
        });
    });
    it("keeps speech following a standalone handoff's end marker", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(
                db,
                1,
                "user",
                "[CONTEXT COMPACTION \u2014 REFERENCE ONLY] Synthetic handoff.\n--- END OF CONTEXT SUMMARY \u2014 respond to the message below, not the summary above ---\nActual speech.",
                { summary: 1, display: "hidden" },
            );
        });
        expect(readHermes(path, 0)[0]?.events[0]).toMatchObject({
            text: "Actual speech.",
        });
    });
    it("omits known synthetic display rows and model-only composites but keeps steering speech", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Synthetic handoff.", { summary: 1 });
            hermesMessage(db, 2, "user", "Synthetic notification.", {
                display: "async_delegation_complete",
            });
            hermesMessage(db, 3, "user", "Synthetic hidden host note.", {
                display: "hidden",
            });
            hermesMessage(db, 4, "user", "Duplicate model-only composite.");
            db.run("UPDATE messages SET display_metadata = ? WHERE id = 4", [
                '{"model_only":true}',
            ]);
            hermesMessage(db, 5, "user", "Actual steering speech.", {
                display: "steer",
            });
        });
        expect(readHermes(path, 0)[0]?.events).toEqual([
            {
                kind: "user",
                text: "Actual steering speech.",
                sourceId: "5",
                at: hermesAt(5),
            },
        ]);
    });
    it("keeps compacted original rows and omits rewound copies", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Original history.", {
                active: 0,
                compacted: 1,
            });
            hermesMessage(db, 2, "user", "Rewound draft.", { active: 0 });
            hermesMessage(db, 3, "user", "Current speech.");
        });
        expect(
            readHermes(path, 0)[0]?.events.map((event) => event.sourceId),
        ).toEqual(["1", "3"]);
    });
});

describe("readHermes halt boundaries", () => {
    for (const bad of [
        "UPDATE messages SET content = X'FF' WHERE id = 2",
        "UPDATE messages SET timestamp = 'invalid fixture time' WHERE id = 2",
        "UPDATE messages SET role = '' WHERE id = 2",
    ]) {
        it("keeps the valid prefix and continues other sessions after a bad mapped row", async () => {
            const path = await fixture((db) => {
                hermesSession(db);
                hermesSession(db, "other-session");
                hermesMessage(db, 1, "user", "Before.");
                hermesMessage(db, 2, "user", "Invalid fixture row.");
                hermesMessage(db, 3, "assistant", "Beyond the halt.");
                hermesMessage(db, 4, "user", "Another session.", {
                    session: "other-session",
                });
                db.exec(bad);
            });
            const reads = readHermes(path, 0);
            expect(reads[0]?.events).toEqual([
                {
                    kind: "user",
                    text: "Before.",
                    sourceId: "1",
                    at: hermesAt(1),
                },
            ]);
            expect(reads[0]?.halt?.id).toBe(2);
            expect(reads[0]?.halt?.reason).not.toContain(
                "Invalid fixture row.",
            );
            expect(reads[1]?.events[0]).toMatchObject({
                text: "Another session.",
            });
        });
    }
    for (const value of [
        "\0json:{",
        hermesContent({ text: "Unsupported envelope." }),
        hermesContent([{ type: "text" }]),
        hermesContent([{ type: "text", text: 42 }]),
        hermesContent([{}]),
        hermesContent([{ type: "future_block" }]),
    ]) {
        it("halts at malformed structured content without coercing it to speech", async () => {
            const path = await fixture((db) => {
                hermesSession(db);
                hermesMessage(db, 1, "user", value);
                hermesMessage(db, 2, "assistant", "After.");
            });
            const [read] = readHermes(path, 0);
            expect(read?.events).toEqual([]);
            expect(read?.halt).toMatchObject({ id: 1, type: "user" });
        });
    }
    it("retains pending and halt and never acknowledges with an answer beyond the halt", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "assistant", null, {
                calls: JSON.stringify([hermesCall("waiting")]),
            });
            hermesMessage(db, 2, "tool", "Bad answer.", { callId: "waiting" });
            db.run(
                "UPDATE messages SET timestamp = 'invalid fixture time' WHERE id = 2",
            );
            hermesMessage(db, 3, "tool", "Beyond halt.", { callId: "waiting" });
        });
        const [read] = readHermes(path, 0);
        expect(read?.events).toEqual([]);
        expect(read?.pending).toBe(1);
        expect(read?.halt).toEqual({
            id: 2,
            type: "tool",
            reason: "invalid timestamp",
        });
    });
    for (const bad of [
        "UPDATE sessions SET cwd = ''",
        "UPDATE sessions SET started_at = 'invalid fixture time'",
        "UPDATE sessions SET model = ''",
        "UPDATE sessions SET source = ''",
    ]) {
        it("halts malformed session metadata before emitting messages", async () => {
            const path = await fixture((db) => {
                hermesSession(db);
                hermesMessage(db, 1, "user", "After invalid metadata.");
                db.exec(bad);
            });
            const [read] = readHermes(path, 0);
            expect(read?.events).toEqual([]);
            expect(read?.halt).toMatchObject({ id: null, type: "session" });
        });
    }
    it("keeps the first unknown tool type without treating it as a function", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "assistant", "Before.", {
                calls: JSON.stringify([
                    { type: "future_tool" },
                    { type: "future_tool" },
                ]),
            });
            hermesMessage(db, 2, "assistant", "After.");
        });
        const [read] = readHermes(path, 0);
        expect(read?.unknown).toEqual([
            { id: 1, type: "tool_call/future_tool" },
        ]);
        expect(read?.events).toHaveLength(2);
        expect(read?.halt).toBeNull();
    });
    it("never guesses a result for an ended session's unanswered call", async () => {
        const path = await fixture((db) => {
            hermesSession(db, "fixture-session", { ended: 1 });
            hermesMessage(db, 1, "assistant", null, {
                calls: JSON.stringify([hermesCall("unanswered")]),
            });
        });
        const [read] = readHermes(path, 0);
        expect(read?.events).toEqual([]);
        expect(read?.pending).toBe(1);
    });
});

describe("readHermes memory notices", () => {
    it("removes the recalled-memory system note while keeping speech after it", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(
                db,
                1,
                "user",
                "[System note: The following is recalled memory context, NOT new user input. Synthetic header.]\n<memory-context>Synthetic recalled facts.</memory-context>\nActual speech.",
            );
        });
        expect(readHermes(path, 0)[0]?.events[0]).toMatchObject({
            text: "Actual speech.",
        });
    });
});

describe("readHermes stored shapes", () => {
    it("keeps unknown roles without interpreting their unrelated columns", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "future-role", null);
            db.run(
                "UPDATE messages SET content = X'FF', display_metadata = '{' WHERE id = 1",
            );
            hermesMessage(db, 2, "user", "After.");
        });
        const [read] = readHermes(path, 0);
        expect(read?.unknown).toEqual([{ id: 1, type: "future-role" }]);
        expect(read?.events[0]).toMatchObject({ text: "After." });
        expect(read?.halt).toBeNull();
    });
    it("reads the known multimodal tool envelope without opening its image", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "assistant", null, {
                calls: JSON.stringify([hermesCall("call")]),
            });
            hermesMessage(
                db,
                2,
                "tool",
                hermesContent({
                    _multimodal: true,
                    text_summary: "Synthetic image description.",
                    content: [
                        {
                            type: "image",
                            source: { type: "base64", data: "synthetic" },
                        },
                    ],
                }),
                { callId: "call" },
            );
        });
        const [read] = readHermes(path, 0);
        expect(read?.events[0]).toMatchObject({
            kind: "tool",
            output: "Synthetic image description.",
            sourceId: "2",
        });
        expect(read?.halt).toBeNull();
    });
    for (const type of ["input_text", "output_text"]) {
        it(`decodes the installed retry parser's ${type} text alias`, async () => {
            const path = await fixture((db) => {
                hermesSession(db);
                hermesMessage(
                    db,
                    1,
                    "user",
                    hermesContent([{ type, text: "Synthetic text." }]),
                );
            });
            expect(readHermes(path, 0)[0]?.events[0]).toMatchObject({
                text: "Synthetic text.",
            });
        });
    }
});
