// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/recall/store.ts
//
//

import { Database } from "bun:sqlite";
import { chmodSync, closeSync, mkdirSync, openSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Lock } from "../memory/sidecar.js";
import { type Env, xdgDir } from "../xdg.js";

export const SCHEMA_VERSION = 1;

// Times are milliseconds since the epoch. Both FTS tables take their text
// from the table beside them, which triggers keep them in step with.
const SCHEMA = [
    `CREATE TABLE conversations (
        phrase TEXT PRIMARY KEY,
        t_size INTEGER NOT NULL,
        t_ino INTEGER NOT NULL,
        sessions INTEGER NOT NULL DEFAULT 0,
        turns INTEGER NOT NULL DEFAULT 0,
        s_mtime REAL,
        sidecar TEXT NOT NULL DEFAULT '{"kind":"none"}',
        title TEXT,
        description TEXT,
        abstract TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        first_at INTEGER,
        last_at INTEGER
    )`,
    `CREATE TABLE turns (
        phrase TEXT NOT NULL,
        n INTEGER NOT NULL,
        role TEXT NOT NULL,
        at INTEGER NOT NULL,
        text TEXT NOT NULL,
        PRIMARY KEY (phrase, n)
    )`,
    `CREATE TABLE visits (
        phrase TEXT NOT NULL,
        n INTEGER NOT NULL,
        user_turns INTEGER NOT NULL,
        last_at INTEGER,
        PRIMARY KEY (phrase, n)
    )`,
    `CREATE TABLE reads (
        id TEXT PRIMARY KEY,
        reader TEXT NOT NULL,
        target TEXT NOT NULL,
        at INTEGER NOT NULL
    )`,
    `CREATE TABLE appraisals (
        reader TEXT NOT NULL,
        id TEXT NOT NULL,
        served TEXT NOT NULL,
        PRIMARY KEY (reader, id)
    )`,
    `CREATE TABLE claims (
        phrase TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        until INTEGER NOT NULL
    )`,
    `CREATE VIRTUAL TABLE turns_fts USING fts5(
        text, content=turns,
        tokenize='porter unicode61 remove_diacritics 2'
    )`,
    `CREATE VIRTUAL TABLE notes_fts USING fts5(
        title, description, abstract, content=conversations,
        tokenize='porter unicode61 remove_diacritics 2'
    )`,
    `CREATE TRIGGER turns_ai AFTER INSERT ON turns BEGIN
        INSERT INTO turns_fts (rowid, text) VALUES (new.rowid, new.text);
    END`,
    `CREATE TRIGGER turns_ad AFTER DELETE ON turns BEGIN
        INSERT INTO turns_fts (turns_fts, rowid, text)
        VALUES ('delete', old.rowid, old.text);
    END`,
    `CREATE TRIGGER notes_ai AFTER INSERT ON conversations BEGIN
        INSERT INTO notes_fts (rowid, title, description, abstract)
        VALUES (new.rowid, new.title, new.description, new.abstract);
    END`,
    `CREATE TRIGGER notes_ad AFTER DELETE ON conversations BEGIN
        INSERT INTO notes_fts (notes_fts, rowid, title, description, abstract)
        VALUES ('delete', old.rowid, old.title, old.description, old.abstract);
    END`,
    `CREATE TRIGGER notes_au AFTER UPDATE OF title, description, abstract
    ON conversations BEGIN
        INSERT INTO notes_fts (notes_fts, rowid, title, description, abstract)
        VALUES ('delete', old.rowid, old.title, old.description, old.abstract);
        INSERT INTO notes_fts (rowid, title, description, abstract)
        VALUES (new.rowid, new.title, new.description, new.abstract);
    END`,
];

export function indexPath(env: Env = process.env): string {
    return join(
        xdgDir(env, "XDG_CACHE_HOME", ".cache"),
        "dorothy",
        "recall.sqlite",
    );
}

// SQLite names an unusable file by these codes; any other failure (a lock
// held too long, a full disk) says nothing about the file.
export function unusable(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return (
        typeof code === "string" &&
        (code === "SQLITE_NOTADB" || code.startsWith("SQLITE_CORRUPT"))
    );
}

// Clears whatever schema is there, whichever version made it, so every
// process keeps sharing the one file.
function dropSchema(db: Database): void {
    const objects = (where: string) =>
        db
            .query(
                `SELECT name FROM sqlite_master WHERE ${where} AND name NOT LIKE 'sqlite_%'`,
            )
            .all() as { name: string }[];
    const drop = (kind: string, where: string) => {
        for (const { name } of objects(where)) {
            db.run(`DROP ${kind} IF EXISTS "${name.replaceAll('"', '""')}"`);
        }
    };
    drop("TRIGGER", "type = 'trigger'");
    drop("VIEW", "type = 'view'");
    // A virtual table takes its shadow tables with it.
    drop("TABLE", "type = 'table' AND sql LIKE 'CREATE VIRTUAL%'");
    drop("TABLE", "type = 'table'");
}

// Two processes may open a new index at once: the schema is made under the
// write lock, and whoever comes second finds it made. The file is private
// before SQLite writes to it, and SQLite gives -wal and -shm its mode.
function prepare(path: string, busyMs: number): Database {
    closeSync(openSync(path, "a", 0o600));
    chmodSync(path, 0o600);
    const db = new Database(path, { create: true, strict: true });
    try {
        db.run(`PRAGMA busy_timeout = ${busyMs}`);
        db.run("PRAGMA journal_mode = WAL");
        db.transaction(() => {
            const { user_version: version } = db
                .query("PRAGMA user_version")
                .get() as { user_version: number };
            if (version === SCHEMA_VERSION) {
                return;
            }
            if (version !== 0) {
                dropSchema(db);
            }
            for (const statement of SCHEMA) {
                db.run(statement);
            }
            db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
        }).immediate();
        // A file that is not SQLite fails here rather than mid-query.
        db.query("SELECT count(*) FROM conversations").get();
        return db;
    } catch (error) {
        db.close();
        throw error;
    }
}

// The derived index: deleting it costs a rebuild, never data.
export class RecallIndex {
    readonly db: Database;
    #queue: Promise<unknown> = Promise.resolve();

    private constructor(db: Database) {
        this.db = db;
    }

    // A file SQLite says is not a database is deleted and made again; it
    // holds nothing that cannot be rebuilt. Any other failure, such as the
    // write lock staying held, leaves the file alone: another process may
    // be using it.
    static open(path: string, busyMs = 5000): RecallIndex {
        const dir = dirname(path);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        chmodSync(dir, 0o700);
        try {
            return new RecallIndex(prepare(path, busyMs));
        } catch (error) {
            if (!unusable(error)) {
                throw error;
            }
            for (const suffix of ["", "-wal", "-shm"]) {
                rmSync(`${path}${suffix}`, { force: true });
            }
            return new RecallIndex(prepare(path, busyMs));
        }
    }

    // Runs work holding the index's write lock, which other processes wait
    // for (and SQLite releases if this one dies); work in this process takes
    // turns.
    exclusive<T>(work: () => T | Promise<T>): Promise<T> {
        const run = async (): Promise<T> => {
            this.db.run("BEGIN IMMEDIATE");
            try {
                const value = await work();
                this.db.run("COMMIT");
                return value;
            } catch (error) {
                try {
                    this.db.run("ROLLBACK");
                } catch {
                    // A failed statement may have ended the transaction.
                }
                throw error;
            }
        };
        const result = this.#queue.then(run, run);
        this.#queue = result.catch(() => {});
        return result;
    }

    // For updateSidecar: a sidecar's read, change and rename happen under
    // the lock.
    readonly lock: Lock = (work) => this.exclusive(work);

    // A review claims its conversation so no other process reviews it too;
    // an abandoned claim expires.
    claim(
        phrase: string,
        owner: string,
        now: number,
        ms: number,
    ): Promise<boolean> {
        return this.exclusive(() => {
            this.db.run("DELETE FROM claims WHERE until <= ?", [now]);
            this.db.run(
                "INSERT OR IGNORE INTO claims (phrase, owner, until) VALUES (?, ?, ?)",
                [phrase, owner, now + ms],
            );
            const row = this.db
                .query("SELECT owner FROM claims WHERE phrase = ?")
                .get(phrase) as { owner: string } | null;
            return row?.owner === owner;
        });
    }

    release(phrase: string, owner: string): Promise<void> {
        return this.exclusive(() => {
            this.db.run("DELETE FROM claims WHERE phrase = ? AND owner = ?", [
                phrase,
                owner,
            ]);
        });
    }

    close(): void {
        this.db.close();
    }
}
