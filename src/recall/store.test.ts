// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/recall/store.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexPath, RecallIndex, SCHEMA_VERSION } from "./store.js";

let dir = "";
let path = "";
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-store-"));
    path = join(dir, "dorothy", "recall.sqlite");
});
afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

const version = (index: RecallIndex) =>
    (index.db.query("PRAGMA user_version").get() as { user_version: number })
        .user_version;
const count = (index: RecallIndex) =>
    (
        index.db.query("SELECT count(*) AS n FROM conversations").get() as {
            n: number;
        }
    ).n;
const insert = (index: RecallIndex, phrase: string) =>
    index.db.run(
        "INSERT INTO conversations (phrase, t_size, t_ino) VALUES (?, 0, 0)",
        [phrase],
    );

describe("indexPath", () => {
    it("lives in the cache directory", () => {
        expect(indexPath({ XDG_CACHE_HOME: "/c" })).toBe(
            "/c/dorothy/recall.sqlite",
        );
        expect(indexPath({ HOME: "/h" })).toBe(
            "/h/.cache/dorothy/recall.sqlite",
        );
    });
});

describe("RecallIndex", () => {
    it("creates a private index at the current version", async () => {
        const index = RecallIndex.open(path);
        expect(version(index)).toBe(SCHEMA_VERSION);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect((await stat(join(dir, "dorothy"))).mode & 0o777).toBe(0o700);
        index.close();
    });

    it("keeps what it holds across opens", () => {
        const first = RecallIndex.open(path);
        insert(first, "a");
        first.close();
        const second = RecallIndex.open(path);
        expect(count(second)).toBe(1);
        second.close();
    });

    it("rebuilds a file that is not an index", async () => {
        await RecallIndex.open(path).close();
        await writeFile(path, "not a database at all, not even close");
        const index = RecallIndex.open(path);
        expect(count(index)).toBe(0);
        index.close();
    });

    it("rebuilds an index of another version", () => {
        const old = RecallIndex.open(path);
        insert(old, "a");
        old.db.run("PRAGMA user_version = 7");
        old.close();
        const index = RecallIndex.open(path);
        expect(version(index)).toBe(SCHEMA_VERSION);
        expect(count(index)).toBe(0);
        index.close();
    });

    it("commits exclusive work, and rolls back work that throws", async () => {
        const index = RecallIndex.open(path);
        await index.exclusive(() => insert(index, "a"));
        await expect(
            index.exclusive(() => {
                insert(index, "b");
                throw new Error("no");
            }),
        ).rejects.toThrow("no");
        expect(count(index)).toBe(1);
        index.close();
    });

    it("runs this process's exclusive work in turn", async () => {
        const index = RecallIndex.open(path);
        const order: string[] = [];
        await Promise.all([
            index.exclusive(async () => {
                order.push("a start");
                await new Promise((resolve) => setTimeout(resolve, 20));
                order.push("a end");
            }),
            index.exclusive(() => {
                order.push("b");
            }),
        ]);
        expect(order).toEqual(["a start", "a end", "b"]);
        index.close();
    });

    it("waits for another process holding the lock", async () => {
        const index = RecallIndex.open(path);
        const child = Bun.spawn(
            [
                process.execPath,
                "-e",
                `const { Database } = require("bun:sqlite");
                 const db = new Database(${JSON.stringify(path)});
                 db.run("PRAGMA busy_timeout = 5000");
                 db.run("BEGIN IMMEDIATE");
                 console.log("locked");
                 Bun.sleepSync(300);
                 db.run("COMMIT");`,
            ],
            { stdout: "pipe" },
        );
        const reader = child.stdout.getReader();
        await reader.read();
        const start = performance.now();
        await index.exclusive(() => insert(index, "a"));
        expect(performance.now() - start).toBeGreaterThan(150);
        await child.exited;
        index.close();
    });

    it("gives a claim to one owner until it expires", async () => {
        const index = RecallIndex.open(path);
        const other = RecallIndex.open(path);
        expect(await index.claim("a", "me", 1000, 500)).toBe(true);
        expect(await index.claim("a", "me", 1100, 500)).toBe(true);
        expect(await other.claim("a", "them", 1200, 500)).toBe(false);
        expect(await other.claim("a", "them", 1500, 500)).toBe(true);
        expect(await index.claim("a", "me", 1600, 500)).toBe(false);
        index.close();
        other.close();
    });

    it("releases only its owner's claim", async () => {
        const index = RecallIndex.open(path);
        await index.claim("a", "me", 1000, 500);
        await index.release("a", "them");
        expect(await index.claim("a", "them", 1100, 500)).toBe(false);
        await index.release("a", "me");
        expect(await index.claim("a", "them", 1200, 500)).toBe(true);
        index.close();
    });
});
