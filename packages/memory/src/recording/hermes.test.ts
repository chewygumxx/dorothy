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
    it("records an unanswered call failed when the session has ended, releasing what follows", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Go.");
            hermesMessage(db, 2, "assistant", "Starting.", {
                calls: JSON.stringify([hermesCall("lost", "run", '{"a":1}')]),
            });
            hermesMessage(db, 3, "assistant", "After.");
        });
        const [live] = readHermes(path, 0, "fixture-session");
        expect(live?.events.map((event) => event.sourceId)).toEqual(["1", "2"]);
        expect(live?.pending).toBe(2);
        const [over] = readHermes(path, 0, "fixture-session", { ended: true });
        expect(over?.pending).toBeNull();
        expect(over?.events).toEqual([
            { kind: "user", text: "Go.", sourceId: "1", at: hermesAt(1) },
            {
                kind: "assistant",
                text: "Starting.",
                sourceId: "2",
                at: hermesAt(2),
                interrupted: false,
            },
            {
                kind: "tool",
                name: "run",
                input: '{"a":1}',
                output: "",
                ok: false,
                sourceId: "2:lost",
                at: hermesAt(2),
            },
            {
                kind: "assistant",
                text: "After.",
                sourceId: "3",
                at: hermesAt(3),
                interrupted: false,
            },
        ]);
    });
    it("keeps an unanswered call pending after a halt even when the session has ended", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "assistant", null, {
                calls: JSON.stringify([hermesCall("lost")]),
            });
            hermesMessage(db, 2, "user", "\0json:{");
        });
        const [read] = readHermes(path, 0, undefined, { ended: true });
        expect(read?.halt).toMatchObject({ id: 2 });
        expect(read?.pending).toBe(1);
        expect(read?.events).toEqual([]);
    });
    it("records no failure for a call a parent already holds or the floor passed", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "assistant", null, {
                calls: JSON.stringify([hermesCall("lost")]),
            });
            hermesMessage(db, 2, "assistant", "After.");
        });
        const [read] = readHermes(path, 1, undefined, { ended: true });
        expect(read?.events.map((event) => event.sourceId)).toEqual(["2"]);
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

describe("readHermes compaction copies", () => {
    it("keeps the first message id when compaction copies a durable message uid", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Original words.", {
                active: 0,
                compacted: 0,
            });
            hermesMessage(db, 2, "user", "Original words.", { second: 1 });
            db.run("UPDATE messages SET message_uid = 'fixture-uid'");
        });
        expect(readHermes(path, 0)[0]?.events).toEqual([
            {
                kind: "user",
                text: "Original words.",
                sourceId: "1",
                at: hermesAt(1),
            },
        ]);
        expect(readHermes(path, 1)[0]?.events).toEqual([]);
    });
    it("keeps identical real turns with different durable uids", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Repeated words.");
            hermesMessage(db, 2, "user", "Repeated words.", { second: 1 });
            db.run(
                "UPDATE messages SET message_uid = 'fixture-first' WHERE id = 1",
            );
            db.run(
                "UPDATE messages SET message_uid = 'fixture-second' WHERE id = 2",
            );
        });
        expect(
            readHermes(path, 0)[0]?.events.map((event) => event.sourceId),
        ).toEqual(["1", "2"]);
    });
});

describe("readHermes stable ids across real tail flags", () => {
    it("does not emit a carried copy again after its original was swept", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 3, "user", "Original speech.");
            db.run("UPDATE messages SET message_uid = 'fixture-carried'");
        });
        expect(readHermes(path, 0)[0]?.events).toEqual([
            {
                kind: "user",
                text: "Original speech.",
                sourceId: "3",
                at: hermesAt(3),
            },
        ]);
        const writer = new Database(path);
        try {
            writer.run(
                "UPDATE messages SET active = 0, compacted = 0 WHERE id = 3",
            );
            hermesMessage(writer, 9, "user", "Original speech.", { second: 3 });
            writer.run(
                "UPDATE messages SET message_uid = 'fixture-carried' WHERE id = 9",
            );
        } finally {
            writer.close();
        }
        expect(readHermes(path, 3)[0]?.events).toEqual([]);
        expect(readHermes(path, 0)[0]?.events).toEqual([
            {
                kind: "user",
                text: "Original speech.",
                sourceId: "3",
                at: hermesAt(3),
            },
        ]);
    });
    it("uses the visible payload and the lowest physical id, without reviving an invisible uid", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Earlier payload.", { active: 0 });
            hermesMessage(db, 2, "user", "Rewound speech.", { active: 0 });
            hermesMessage(db, 8, "user", "Visible payload.");
            db.run(
                "UPDATE messages SET message_uid = 'fixture-copied' WHERE id IN (1, 8)",
            );
            db.run(
                "UPDATE messages SET message_uid = 'fixture-rewound' WHERE id = 2",
            );
        });
        expect(readHermes(path, 0)[0]?.events).toEqual([
            {
                kind: "user",
                text: "Visible payload.",
                sourceId: "1",
                at: hermesAt(8),
            },
        ]);
    });
    it("preserves result ids through cloned call and result rows", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            const calls = JSON.stringify([hermesCall("call")]);
            hermesMessage(db, 1, "assistant", null, { calls, active: 0 });
            hermesMessage(db, 2, "tool", "Answer.", {
                callId: "call",
                active: 0,
            });
            hermesMessage(db, 6, "assistant", null, { calls, second: 1 });
            hermesMessage(db, 7, "tool", "Answer.", {
                callId: "call",
                second: 2,
            });
            db.run(
                "UPDATE messages SET message_uid = 'fixture-call' WHERE id IN (1, 6)",
            );
            db.run(
                "UPDATE messages SET message_uid = 'fixture-result' WHERE id IN (2, 7)",
            );
        });
        expect(readHermes(path, 0)[0]?.events).toEqual([
            {
                kind: "tool",
                name: "fixture",
                input: "{}",
                output: "Answer.",
                ok: true,
                sourceId: "2",
                at: hermesAt(2),
            },
        ]);
        expect(readHermes(path, 2)[0]?.events).toEqual([]);
    });
    it("holds a later copied event by physical position when its stable id is earlier", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "assistant", null, {
                calls: JSON.stringify([hermesCall("waiting")]),
                active: 0,
            });
            hermesMessage(db, 3, "assistant", "Later speech.", { active: 0 });
            hermesMessage(db, 6, "assistant", null, {
                calls: JSON.stringify([hermesCall("waiting")]),
            });
            hermesMessage(db, 8, "assistant", "Later speech.", { second: 3 });
            db.run(
                "UPDATE messages SET message_uid = 'fixture-call' WHERE id IN (1, 6)",
            );
            db.run(
                "UPDATE messages SET message_uid = 'fixture-speech' WHERE id IN (3, 8)",
            );
        });
        const [read] = readHermes(path, 0);
        expect(read?.pending).toBe(6);
        expect(read?.events).toEqual([]);
    });
});

describe("readHermes compression children", () => {
    it("names the parent and emits only the child's new uids regardless of session sort order", async () => {
        const path = await fixture((db) => {
            hermesSession(db, "z-parent");
            hermesSession(db, "a-child");
            db.run(
                "UPDATE sessions SET parent_session_id = 'z-parent' WHERE id = 'a-child'",
            );
            hermesMessage(db, 1, "user", "Carried speech.", {
                session: "z-parent",
            });
            hermesMessage(db, 4, "user", "Carried speech.", {
                session: "a-child",
                second: 1,
            });
            hermesMessage(db, 5, "user", "New child speech.", {
                session: "a-child",
            });
            db.run(
                "UPDATE messages SET message_uid = 'fixture-carried' WHERE id IN (1, 4)",
            );
            db.run(
                "UPDATE messages SET message_uid = 'fixture-new' WHERE id = 5",
            );
        });
        const reads = readHermes(path, 0);
        expect(reads[0]?.parent).toBe("z-parent");
        expect(reads[0]?.events).toEqual([
            {
                kind: "user",
                text: "New child speech.",
                sourceId: "5",
                at: hermesAt(5),
            },
        ]);
        expect(reads[1]?.parent).toBeNull();
        expect(reads[1]?.events).toEqual([
            {
                kind: "user",
                text: "Carried speech.",
                sourceId: "1",
                at: hermesAt(1),
            },
        ]);
        expect(
            readHermes(path, 1)[0]?.events.map((event) => event.sourceId),
        ).toEqual(["5"]);
    });
    it("does not emit a uid held by an invisible parent row", async () => {
        const path = await fixture((db) => {
            hermesSession(db, "parent");
            hermesSession(db, "child");
            db.run(
                "UPDATE sessions SET parent_session_id = 'parent' WHERE id = 'child'",
            );
            hermesMessage(db, 1, "user", "Carried.", {
                session: "parent",
                active: 0,
            });
            hermesMessage(db, 2, "user", "Carried.", { session: "child" });
            db.run("UPDATE messages SET message_uid = 'fixture-carried'");
        });
        const reads = readHermes(path, 0);
        expect(reads.flatMap((read) => read.events)).toEqual([]);
        expect(reads[0]?.parent).toBe("parent");
    });
    it("keeps identical uids in unrelated sessions", async () => {
        const path = await fixture((db) => {
            hermesSession(db, "first");
            hermesSession(db, "second");
            hermesMessage(db, 1, "user", "First.", { session: "first" });
            hermesMessage(db, 2, "user", "Second.", { session: "second" });
            db.run("UPDATE messages SET message_uid = 'fixture-unrelated'");
        });
        expect(
            readHermes(path, 0).flatMap((read) =>
                read.events.map((event) => event.sourceId),
            ),
        ).toEqual(["1", "2"]);
    });
    it("retains a carried call as correlation context for a new child result", async () => {
        const path = await fixture((db) => {
            hermesSession(db, "parent");
            hermesSession(db, "child");
            db.run(
                "UPDATE sessions SET parent_session_id = 'parent' WHERE id = 'child'",
            );
            const calls = JSON.stringify([
                hermesCall("running", "fixture", "child input"),
            ]);
            hermesMessage(db, 1, "assistant", "Starting.", {
                session: "parent",
                calls,
            });
            hermesMessage(db, 3, "assistant", "Starting.", {
                session: "child",
                calls,
                second: 1,
            });
            hermesMessage(db, 4, "tool", "Child answer.", {
                session: "child",
                callId: "running",
            });
            db.run(
                "UPDATE messages SET message_uid = 'fixture-call' WHERE id IN (1, 3)",
            );
        });
        const child = readHermes(path, 1).find(
            (read) => read.session === "child",
        );
        expect(child?.events).toEqual([
            {
                kind: "tool",
                name: "fixture",
                input: "child input",
                output: "Child answer.",
                ok: true,
                sourceId: "4",
                at: hermesAt(4),
            },
        ]);
        expect(child?.pending).toBeNull();
        expect(child?.halt).toBeNull();
    });
    it("rejects a malformed parent as session metadata", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            db.run("UPDATE sessions SET parent_session_id = ''");
            hermesMessage(db, 1, "user", "After bad metadata.");
        });
        const [read] = readHermes(path, 0);
        expect(read?.events).toEqual([]);
        expect(read?.halt).toMatchObject({ id: null, type: "session" });
    });
});

describe("readHermes absorbed message uids", () => {
    const carrier =
        "[CONTEXT SUMMARY]: Synthetic handoff.\n--- END OF CONTEXT SUMMARY \u2014 respond to the message below, not the summary above ---\nActual speech.";
    it("does not re-emit an original through a new carrier uid that absorbed it", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Actual speech.");
            hermesMessage(db, 4, "user", carrier, {
                summary: 1,
                display: "hidden",
            });
            db.run(
                "UPDATE messages SET message_uid = 'fixture-original' WHERE id = 1",
            );
            db.run(
                "UPDATE messages SET message_uid = 'fixture-carrier', absorbed_message_uids = ? WHERE id = 4",
                ['["fixture-original"]'],
            );
        });
        expect(readHermes(path, 0)[0]?.events).toEqual([
            {
                kind: "user",
                text: "Actual speech.",
                sourceId: "1",
                at: hermesAt(1),
            },
        ]);
        expect(readHermes(path, 1)[0]?.events).toEqual([]);
    });
    it("recognizes originals swept before they acquired rewind flags", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Actual speech.", { active: 0 });
            hermesMessage(db, 4, "user", carrier, {
                summary: 1,
                display: "hidden",
            });
            db.run(
                "UPDATE messages SET message_uid = 'fixture-original' WHERE id = 1",
            );
            db.run(
                "UPDATE messages SET message_uid = 'fixture-carrier', absorbed_message_uids = ? WHERE id = 4",
                ['["fixture-original"]'],
            );
        });
        expect(readHermes(path, 1)[0]?.events).toEqual([]);
        expect(readHermes(path, 0)[0]?.events).toEqual([
            {
                kind: "user",
                text: "Actual speech.",
                sourceId: "4",
                at: hermesAt(4),
            },
        ]);
    });
    it("holds every constituent after emitting a fresh merge, including on a later read", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "First.\n\nSecond.");
            hermesMessage(db, 5, "user", "Second.");
            db.run(
                "UPDATE messages SET message_uid = 'fixture-first', absorbed_message_uids = ? WHERE id = 1",
                ['["fixture-second","fixture-second"]'],
            );
            db.run(
                "UPDATE messages SET message_uid = 'fixture-second' WHERE id = 5",
            );
        });
        expect(readHermes(path, 0)[0]?.events).toEqual([
            {
                kind: "user",
                text: "First.\n\nSecond.",
                sourceId: "1",
                at: hermesAt(1),
            },
        ]);
        expect(readHermes(path, 1)[0]?.events).toEqual([]);
    });
    it("does not emit a child carrier for a uid its parent holds", async () => {
        const path = await fixture((db) => {
            hermesSession(db, "parent");
            hermesSession(db, "child");
            db.run(
                "UPDATE sessions SET parent_session_id = 'parent' WHERE id = 'child'",
            );
            hermesMessage(db, 1, "user", "Actual speech.", {
                session: "parent",
            });
            hermesMessage(db, 5, "user", carrier, {
                session: "child",
                summary: 1,
                display: "hidden",
            });
            db.run(
                "UPDATE messages SET message_uid = 'fixture-original' WHERE id = 1",
            );
            db.run(
                "UPDATE messages SET message_uid = 'fixture-carrier', absorbed_message_uids = ? WHERE id = 5",
                ['["fixture-original"]'],
            );
        });
        const child = readHermes(path, 0).find(
            (read) => read.session === "child",
        );
        expect(child?.parent).toBe("parent");
        expect(child?.events).toEqual([]);
    });
    for (const [name, value] of [
        ["JSON", "{"],
        ["object", "{}"],
        ["nonstring uid", "[42]"],
        ["empty uid", '[""]'],
    ] as const) {
        it(`halts at malformed absorbed ${name} without dropping its valid prefix`, async () => {
            const path = await fixture((db) => {
                hermesSession(db);
                hermesMessage(db, 1, "user", "Before.");
                hermesMessage(db, 2, "user", "Invalid merge.");
                db.run(
                    "UPDATE messages SET absorbed_message_uids = ? WHERE id = 2",
                    [value],
                );
                hermesMessage(db, 3, "user", "Beyond halt.");
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
            expect(read?.halt).toMatchObject({ id: 2, type: "user" });
        });
    }
});

describe("readHermes parent merge witnesses", () => {
    it("treats a parent's emitted merge constituents as held in its child", async () => {
        const path = await fixture((db) => {
            hermesSession(db, "parent");
            hermesSession(db, "child");
            db.run(
                "UPDATE sessions SET parent_session_id = 'parent' WHERE id = 'child'",
            );
            hermesMessage(db, 1, "user", "First.\n\nSecond.", {
                session: "parent",
            });
            hermesMessage(db, 4, "user", "Second.", { session: "child" });
            db.run(
                "UPDATE messages SET message_uid = 'fixture-first', absorbed_message_uids = ? WHERE id = 1",
                ['["fixture-second"]'],
            );
            db.run(
                "UPDATE messages SET message_uid = 'fixture-second' WHERE id = 4",
            );
        });
        const reads = readHermes(path, 0);
        expect(reads.find((read) => read.session === "child")?.events).toEqual(
            [],
        );
        expect(reads.find((read) => read.session === "parent")?.events).toEqual(
            [
                {
                    kind: "user",
                    text: "First.\n\nSecond.",
                    sourceId: "1",
                    at: hermesAt(1),
                },
            ],
        );
    });
});

describe("readHermes merged tool uid lists", () => {
    for (const [name, uids] of [
        ["distinct folded occurrences", ["fixture-one", "fixture-two"]],
        ["a shared response uid", ["fixture-shared", "fixture-shared"]],
    ] as const) {
        it(`pairs ${name} in call order without losing a pending call`, async () => {
            const path = await fixture((db) => {
                hermesSession(db);
                hermesMessage(db, 1, "assistant", null, {
                    calls: JSON.stringify([
                        hermesCall("repeated", "fixture", "first input"),
                        hermesCall("repeated", "fixture", "second input"),
                    ]),
                });
                db.run(
                    "UPDATE messages SET message_uid = 'fixture-first', absorbed_message_uids = ?, tool_call_uids = ? WHERE id = 1",
                    ['["fixture-second"]', JSON.stringify({ repeated: uids })],
                );
                hermesMessage(db, 3, "tool", "First answer.", {
                    callId: "repeated",
                });
                hermesMessage(db, 4, "tool", "Second answer.", {
                    callId: "repeated",
                });
                db.run("UPDATE messages SET tool_call_uid = ? WHERE id = 3", [
                    uids[0],
                ]);
                db.run("UPDATE messages SET tool_call_uid = ? WHERE id = 4", [
                    uids[1],
                ]);
            });
            const [read] = readHermes(path, 0);
            expect(read?.events).toEqual([
                {
                    kind: "tool",
                    name: "fixture",
                    input: "first input",
                    output: "First answer.",
                    ok: true,
                    sourceId: "3",
                    at: hermesAt(3),
                },
                {
                    kind: "tool",
                    name: "fixture",
                    input: "second input",
                    output: "Second answer.",
                    ok: true,
                    sourceId: "4",
                    at: hermesAt(4),
                },
            ]);
            expect(read?.pending).toBeNull();
            expect(read?.halt).toBeNull();
        });
    }
    it("halts an incomplete occurrence list before emitting the assistant row", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "assistant", "Uncommitted prose.", {
                calls: JSON.stringify([
                    hermesCall("repeated"),
                    hermesCall("repeated"),
                ]),
            });
            db.run("UPDATE messages SET tool_call_uids = ? WHERE id = 1", [
                '{"repeated":["fixture-only-one"]}',
            ]);
        });
        const [read] = readHermes(path, 0);
        expect(read?.events).toEqual([]);
        expect(read?.halt).toMatchObject({ id: 1, type: "assistant" });
    });
});

describe("readHermes payload selection", () => {
    function guardPayload(db: Database, condition: string) {
        db.exec(`ALTER TABLE messages RENAME TO physical_messages;
            CREATE VIEW messages AS SELECT id, session_id, role,
                CASE WHEN ${condition} THEN json('unreadable fixture payload')
                    ELSE content END AS content,
                timestamp, tool_calls, tool_call_id, tool_call_uids,
                tool_call_uid, active, compacted, _compressed_summary,
                display_kind, display_metadata, message_uid,
                absorbed_message_uids FROM physical_messages`);
    }
    it("does not fetch invisible payloads while keeping their uid minimum", async () => {
        const path = await fixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Earlier physical row.", {
                active: 0,
            });
            hermesMessage(db, 7, "user", "Visible speech.");
            db.run("UPDATE messages SET message_uid = 'fixture-shared'");
            guardPayload(db, "active = 0 AND compacted = 0");
        });
        expect(readHermes(path, 0)[0]?.events).toEqual([
            {
                kind: "user",
                text: "Visible speech.",
                sourceId: "1",
                at: hermesAt(7),
            },
        ]);
    });
    it("fetches only the selected session's payload without losing parent ownership", async () => {
        const path = await fixture((db) => {
            hermesSession(db, "parent");
            hermesSession(db, "child");
            db.run(
                "UPDATE sessions SET parent_session_id = 'parent' WHERE id = 'child'",
            );
            hermesMessage(db, 1, "user", "Parent speech.", {
                session: "parent",
            });
            hermesMessage(db, 3, "user", "Parent speech.", {
                session: "child",
            });
            hermesMessage(db, 4, "user", "Child speech.", { session: "child" });
            db.run(
                "UPDATE messages SET message_uid = 'fixture-carried' WHERE id IN (1, 3)",
            );
            guardPayload(db, "session_id = 'parent'");
        });
        const reads = readHermes(path, 0, "child");
        expect(reads).toHaveLength(1);
        expect(reads[0]?.parent).toBe("parent");
        expect(reads[0]?.events).toEqual([
            {
                kind: "user",
                text: "Child speech.",
                sourceId: "4",
                at: hermesAt(4),
            },
        ]);
        expect(readHermes(path, 0, "absent")).toEqual([]);
    });
});
