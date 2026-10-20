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
