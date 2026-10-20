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
