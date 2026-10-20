// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recall/store.test.ts
//
//

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { closeSync, openSync, writeSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { indexPath, RecallIndex, SCHEMA_VERSION, unusable } from "./store.js";

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

describe("unusable", () => {
    it("names a file that is not a database or is corrupt, however extended", () => {
        for (const code of [
            "SQLITE_NOTADB",
            "SQLITE_CORRUPT",
            "SQLITE_CORRUPT_VTAB",
            "SQLITE_CORRUPT_INDEX",
        ]) {
            expect(unusable({ code })).toBe(true);
        }
    });

    it("says nothing of other failures", () => {
        for (const error of [
            { code: "SQLITE_BUSY" },
            { code: "SQLITE_FULL" },
            { code: 11 },
            new Error("corrupt"),
            null,
        ]) {
            expect(unusable(error)).toBe(false);
        }
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

    it("keeps each body's session with its conversation", () => {
        const index = RecallIndex.open(path);
        index.db.run(
            "INSERT INTO conversation_sessions (session, phrase) VALUES (?, ?)",
            ["s-1", "a-b-c-d"],
        );
        expect(() =>
            index.db.run(
                "INSERT INTO conversation_sessions (session, phrase) VALUES (?, ?)",
                ["s-1", "e-f-g-h"],
            ),
        ).toThrow();
        index.close();
    });

    it("has the clusters, vocabulary and facts tables at the current version", () => {
        const index = RecallIndex.open(path);
        try {
            expect(version(index)).toBe(SCHEMA_VERSION);
            const tables = (
                index.db
                    .query(
                        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('clusters', 'vocabulary', 'concepts', 'labels', 'broader', 'merged', 'tagged', 'facts', 'fact_tags') ORDER BY name",
                    )
                    .all() as { name: string }[]
            ).map((row) => row.name);
            expect(tables).toEqual([
                "broader",
                "clusters",
                "concepts",
                "fact_tags",
                "facts",
                "labels",
                "merged",
                "tagged",
                "vocabulary",
            ]);
        } finally {
            index.close();
        }
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

    it("rebuilds a schema-7 index, which took a repository's knowledge as confirmed", async () => {
        const old = RecallIndex.open(path);
        insert(old, "a");
        old.db.run("PRAGMA user_version = 7");
        old.close();
        const index = RecallIndex.open(path);
        expect(version(index)).toBe(SCHEMA_VERSION);
        expect(count(index)).toBe(0);
        index.close();
    });

    it("rebuilds an index of another version in place", async () => {
        const old = RecallIndex.open(path);
        insert(old, "a");
        old.db.run("CREATE TABLE extra (x)");
        old.db.run("PRAGMA user_version = 6");
        old.close();
        const before = (await stat(path)).ino;
        const index = RecallIndex.open(path);
        expect((await stat(path)).ino).toBe(before);
        expect(version(index)).toBe(SCHEMA_VERSION);
        expect(count(index)).toBe(0);
        expect(
            index.db
                .query("SELECT name FROM sqlite_master WHERE name = 'extra'")
                .all(),
        ).toEqual([]);
        expect(await index.claim("a", "me", 1000, 500)).toBe(true);
        index.close();
    });

    // Holds the write lock until the file named release exists.
    const holdLock = (release: string) =>
        Bun.spawn(
            [
                process.execPath,
                "-e",
                `const { Database } = require("bun:sqlite");
                 const { existsSync } = require("node:fs");
                 const db = new Database(${JSON.stringify(path)});
                 db.run("PRAGMA busy_timeout = 5000");
                 db.run("BEGIN IMMEDIATE");
                 console.log("locked");
                 while (!existsSync(${JSON.stringify(release)})) Bun.sleepSync(10);
                 db.run("COMMIT");`,
            ],
            { stdout: "pipe" },
        );

    it("opens a current index while another process holds the lock", async () => {
        const first = RecallIndex.open(path);
        insert(first, "a");
        first.close();
        const release = join(dir, "release");
        const child = holdLock(release);
        await child.stdout.getReader().read();
        // Were the open to wait for the lock, it would sit out the whole
        // busy timeout and throw, with the child still holding it.
        const index = RecallIndex.open(path, 5000);
        expect(child.exitCode).toBeNull();
        expect(count(index)).toBe(1);
        index.close();
        await writeFile(release, "");
        await child.exited;
    });

    it("leaves a file that needs migrating alone when the lock stays held", async () => {
        const first = RecallIndex.open(path);
        insert(first, "a");
        first.db.run("PRAGMA user_version = 6");
        first.close();
        const before = (await stat(path)).ino;
        const release = join(dir, "release");
        const child = holdLock(release);
        await child.stdout.getReader().read();
        expect(() => RecallIndex.open(path, 100)).toThrow();
        await writeFile(release, "");
        await child.exited;
        expect((await stat(path)).ino).toBe(before);
        // Looked at without migrating it: the rows are still there.
        const raw = new Database(path, { readonly: true });
        expect(
            raw.query("SELECT count(*) AS n FROM conversations").get(),
        ).toEqual({ n: 1 });
        raw.close();
    });

    describe("a file that turns corrupt in use", () => {
        const corruptError = (code = "SQLITE_CORRUPT") =>
            Object.assign(new Error("database disk image is malformed"), {
                code,
            });
        // Overwrites the schema page, as a bad disk or a stray write would.
        const damage = (index: RecallIndex, bytes: Buffer) => {
            index.db.run("PRAGMA wal_checkpoint(TRUNCATE)");
            const fd = openSync(path, "r+");
            writeSync(fd, bytes, 0, bytes.length, 100);
            closeSync(fd);
        };
        // Another process with the index open and idle, until release.
        const holder = (release: string) =>
            Bun.spawn(
                [
                    process.execPath,
                    "-e",
                    `const { Database } = require("bun:sqlite");
                     const { existsSync } = require("node:fs");
                     const db = new Database(${JSON.stringify(path)});
                     db.run("PRAGMA journal_mode = WAL");
                     db.query("SELECT count(*) FROM conversations").get();
                     console.log("holding");
                     while (!existsSync(${JSON.stringify(release)})) Bun.sleepSync(10);`,
                ],
                { stdout: "pipe" },
            );

        it("is rebuilt in place when no other process holds it", async () => {
            const index = RecallIndex.open(path);
            insert(index, "a");
            damage(index, Buffer.alloc(300, 0xff));
            const before = (await stat(path)).ino;
            const failure = await index
                .exclusive(() => {
                    throw corruptError();
                })
                .catch((error: unknown) => error);
            expect(String(failure)).toContain(
                "database disk image is malformed",
            );
            expect(String(failure)).toContain("rebuilt");
            expect((await stat(path)).ino).not.toBe(before);
            expect(version(index)).toBe(SCHEMA_VERSION);
            expect(count(index)).toBe(0);
            // The next calls work on the new file.
            await index.exclusive(() => insert(index, "b"));
            expect(await index.claim("b", "me", 1000, 500)).toBe(true);
            index.close();
            const again = RecallIndex.open(path);
            expect(count(again)).toBe(1);
            again.close();
        });

        it("is left alone while another process holds it", async () => {
            const index = RecallIndex.open(path);
            insert(index, "a");
            index.db.run("PRAGMA wal_checkpoint(TRUNCATE)");
            const release = join(dir, "release");
            const child = holder(release);
            const before = (await stat(path)).ino;
            let failure: unknown;
            try {
                await child.stdout.getReader().read();
                damage(index, Buffer.alloc(300, 0xff));
                failure = await index
                    .exclusive(() => {
                        throw corruptError();
                    })
                    .catch((error: unknown) => error);
            } finally {
                await writeFile(release, "");
                await child.exited;
            }
            expect(String(failure)).toContain(
                "database disk image is malformed",
            );
            expect(String(failure)).toContain("not rebuilt");
            expect((await stat(path)).ino).toBe(before);
            // With the other process gone, the next failure rebuilds it.
            const later = await index
                .exclusive(() => {
                    throw corruptError("SQLITE_CORRUPT_VTAB");
                })
                .catch((error: unknown) => error);
            expect(String(later)).toContain("rebuilt");
            expect((await stat(path)).ino).not.toBe(before);
            expect(count(index)).toBe(0);
            index.close();
        });

        it("is left alone when it cannot be shown to be unshared", async () => {
            const index = RecallIndex.open(path);
            insert(index, "a");
            index.db.run("PRAGMA wal_checkpoint(TRUNCATE)");
            // A header SQLite cannot read says nothing of who has it open.
            damage(index, Buffer.from("not a database at all, not even close"));
            const fd = openSync(path, "r+");
            writeSync(fd, Buffer.from("x".repeat(100)), 0, 100, 0);
            closeSync(fd);
            const before = (await stat(path)).ino;
            const failure = await index
                .exclusive(() => {
                    throw corruptError("SQLITE_NOTADB");
                })
                .catch((error: unknown) => error);
            expect(String(failure)).toContain("not rebuilt");
            expect((await stat(path)).ino).toBe(before);
            index.close();
        });

        it("is reported, not deleted, when deleting it fails", async () => {
            const index = RecallIndex.open(path);
            insert(index, "a");
            damage(index, Buffer.alloc(300, 0xff));
            const before = (await stat(path)).ino;
            // A directory nothing can be removed from.
            await chmod(dirname(path), 0o500);
            try {
                const failure = await index
                    .exclusive(() => {
                        throw corruptError();
                    })
                    .catch((error: unknown) => error);
                expect(String(failure)).toContain("deleting it failed");
            } finally {
                await chmod(dirname(path), 0o700);
            }
            expect((await stat(path)).ino).toBe(before);
            // Reopened as it was, failing as it did, not closed.
            expect(() => index.db.query("SELECT 1").get()).not.toThrow(
                /closed/i,
            );
            index.close();
        });

        it("does not rebuild for other failures", async () => {
            const index = RecallIndex.open(path);
            insert(index, "a");
            const before = (await stat(path)).ino;
            await expect(
                index.exclusive(() => {
                    throw Object.assign(new Error("full"), {
                        code: "SQLITE_FULL",
                    });
                }),
            ).rejects.toThrow("full");
            expect((await stat(path)).ino).toBe(before);
            expect(count(index)).toBe(1);
            index.close();
        });
    });

    describe("opening a file that is corrupt", () => {
        const holder = (release: string) =>
            Bun.spawn(
                [
                    process.execPath,
                    "-e",
                    `const { Database } = require("bun:sqlite");
                     const { existsSync } = require("node:fs");
                     const db = new Database(${JSON.stringify(path)});
                     db.run("PRAGMA journal_mode = WAL");
                     db.query("SELECT count(*) FROM conversations").get();
                     console.log("holding");
                     while (!existsSync(${JSON.stringify(release)})) Bun.sleepSync(10);`,
                ],
                { stdout: "pipe" },
            );
        const damageSchema = () => {
            const fd = openSync(path, "r+");
            writeSync(fd, Buffer.alloc(300, 0xff), 0, 300, 100);
            closeSync(fd);
        };
        const made = () => {
            const first = RecallIndex.open(path);
            insert(first, "a");
            first.db.run("PRAGMA wal_checkpoint(TRUNCATE)");
            return first;
        };

        it("rebuilds it where no other process has it open", async () => {
            made().close();
            damageSchema();
            const before = (await stat(path)).ino;
            const index = RecallIndex.open(path);
            expect((await stat(path)).ino).not.toBe(before);
            expect(count(index)).toBe(0);
            index.close();
        });

        it("is left alone while another process holds it", async () => {
            const first = made();
            const release = join(dir, "release");
            const child = holder(release);
            let failure: unknown;
            const before = (await stat(path)).ino;
            try {
                await child.stdout.getReader().read();
                first.close();
                damageSchema();
                try {
                    RecallIndex.open(path);
                } catch (error) {
                    failure = error;
                }
            } finally {
                await writeFile(release, "");
                await child.exited;
            }
            expect(String(failure)).toContain("not rebuilt");
            expect((await stat(path)).ino).toBe(before);
        });
    });

    it("keeps the index and its journal files private", async () => {
        const umask = process.umask(0o022);
        try {
            await mkdir(join(dir, "dorothy"), { mode: 0o755 });
            const index = RecallIndex.open(path);
            await index.exclusive(() => insert(index, "a"));
            expect((await stat(join(dir, "dorothy"))).mode & 0o777).toBe(0o700);
            for (const suffix of ["", "-wal", "-shm"]) {
                expect((await stat(`${path}${suffix}`)).mode & 0o777).toBe(
                    0o600,
                );
            }
            index.close();
        } finally {
            process.umask(umask);
        }
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

    it("renews only its owner's claim, and only while it holds", async () => {
        const index = RecallIndex.open(path);
        const other = RecallIndex.open(path);
        expect(await index.claim("a", "me", 1000, 500)).toBe(true);
        expect(await other.renew("a", "them", 1100, 500)).toBe(false);
        expect(await index.renew("a", "me", 1400, 500)).toBe(true);
        expect(await other.claim("a", "them", 1600, 500)).toBe(false);
        expect(await index.renew("a", "me", 1900, 500)).toBe(false);
        expect(await other.claim("a", "them", 1900, 500)).toBe(true);
        expect(await index.renew("b", "me", 1900, 500)).toBe(false);
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
