// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recall/store.ts
//
//

import { Database } from "bun:sqlite";
import {
    chmodSync,
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type Env, xdgDir } from "@dorothy/core";
import type { Lock } from "../memory/sidecar.js";
import { exclusiveLock } from "../sqlite-lock.js";

// 8: a repository's knowledge is no longer confirmed, and the facts'
// confirmed column of a schema-7 index said it was.
export const SCHEMA_VERSION = 8;

// Times are milliseconds since the epoch. Each FTS table takes its text
// from the table beside it, which triggers keep them in step with.
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
        source TEXT NOT NULL DEFAULT 'chat',
        project TEXT,
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
    // Each body's session id a conversation's session events name, so a
    // hook finds its conversation without reading every transcript.
    `CREATE TABLE conversation_sessions (
        session TEXT PRIMARY KEY,
        phrase TEXT NOT NULL
    )`,
    `CREATE TABLE clusters (
        phrase TEXT NOT NULL,
        n INTEGER NOT NULL,
        first_turn INTEGER NOT NULL,
        last_turn INTEGER NOT NULL,
        PRIMARY KEY (phrase, n)
    )`,
    // tags.json as last read: its mtime (NULL: none), and why it could not
    // be read (NULL: it could).
    `CREATE TABLE vocabulary (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        mtime REAL,
        broken TEXT
    )`,
    `INSERT INTO vocabulary (id) VALUES (1)`,
    // Live concepts only; alt is a JSON array.
    `CREATE TABLE concepts (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        alt TEXT NOT NULL,
        scope_note TEXT NOT NULL
    )`,
    // Every live label, preferred and alternative, by its labelKey.
    `CREATE TABLE labels (norm TEXT PRIMARY KEY, id TEXT NOT NULL)`,
    `CREATE TABLE broader (
        id TEXT NOT NULL,
        parent TEXT NOT NULL,
        PRIMARY KEY (id, parent)
    )`,
    `CREATE TABLE merged (id TEXT PRIMARY KEY, into_id TEXT NOT NULL)`,
    // A sidecar's tags as written, n from 0, most important first.
    `CREATE TABLE tagged (
        phrase TEXT NOT NULL,
        n INTEGER NOT NULL,
        id TEXT NOT NULL,
        PRIMARY KEY (phrase, id)
    )`,
    // Every fact in the store, retired ones too; scope is "personal" or a
    // project id, created milliseconds since the epoch, confirmed 1 for
    // knowledge the user has confirmed.
    `CREATE TABLE facts (
        path TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        type TEXT NOT NULL,
        body TEXT NOT NULL,
        origin TEXT NOT NULL,
        importance INTEGER,
        created INTEGER NOT NULL,
        retired INTEGER NOT NULL,
        confirmed INTEGER NOT NULL,
        mtime REAL NOT NULL,
        hash TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE fact_tags (
        path TEXT NOT NULL,
        n INTEGER NOT NULL,
        id TEXT NOT NULL,
        PRIMARY KEY (path, id)
    )`,
    `CREATE VIRTUAL TABLE turns_fts USING fts5(
        text, content=turns,
        tokenize='porter unicode61 remove_diacritics 2'
    )`,
    `CREATE VIRTUAL TABLE notes_fts USING fts5(
        title, description, abstract, content=conversations,
        tokenize='porter unicode61 remove_diacritics 2'
    )`,
    `CREATE VIRTUAL TABLE facts_fts USING fts5(
        title, description, body, content=facts,
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
    `CREATE TRIGGER facts_ai AFTER INSERT ON facts BEGIN
        INSERT INTO facts_fts (rowid, title, description, body)
        VALUES (new.rowid, new.title, new.description, new.body);
    END`,
    `CREATE TRIGGER facts_ad AFTER DELETE ON facts BEGIN
        INSERT INTO facts_fts (facts_fts, rowid, title, description, body)
        VALUES ('delete', old.rowid, old.title, old.description, old.body);
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

const versionOf = (db: Database) =>
    (db.query("PRAGMA user_version").get() as { user_version: number })
        .user_version;

// Two processes may open a new index at once: the schema is made under the
// write lock, and whoever comes second finds it made. A current index is
// opened without the lock, so another process holding it for long does not
// keep this one out. The file is private before SQLite writes to it, and
// SQLite gives -wal and -shm its mode.
function prepare(path: string, busyMs: number): Database {
    closeSync(openSync(path, "a", 0o600));
    chmodSync(path, 0o600);
    const db = new Database(path, { create: true, strict: true });
    try {
        db.run(`PRAGMA busy_timeout = ${busyMs}`);
        db.run("PRAGMA journal_mode = WAL");
        if (versionOf(db) !== SCHEMA_VERSION) {
            db.transaction(() => {
                // Looked at again: another process may have got here first.
                const version = versionOf(db);
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
        }
        // A file that is not SQLite fails here rather than mid-query.
        db.query("SELECT count(*) FROM conversations").get();
        return db;
    } catch (error) {
        db.close();
        throw error;
    }
}

const FILES = ["", "-wal", "-shm"];

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// What an error says, with a note on what was done about it. It keeps its
// SQLite code and the error it noted.
function noted(error: unknown, note: string): Error {
    return Object.assign(
        new Error(`${describeError(error)} (${note})`, { cause: error }),
        { code: (error as { code?: unknown } | null)?.code },
    );
}

// Shows that no process but this one has the index open, if it can: an
// exclusive transaction on a connection that takes SQLite's exclusive
// locking mode, which in a WAL database fails while any other connection,
// even an idle one, has it open. The proof lasts until the returned lock
// is closed; null where it fails, as it does for a header SQLite cannot
// read, which says nothing of who holds the file.
//
// The probe leaves WAL mode first, where it can, so that closing it later
// has no -wal file to delete by name: that would take a new index's, were
// another process to make one in the moment between the old files being
// deleted and the probe closing.
function soleHolder(path: string): { close(): void } | null {
    if (!existsSync(path)) {
        return { close() {} };
    }
    let probe: Database | null = null;
    try {
        probe = new Database(path, { readwrite: true, strict: true });
        probe.run("PRAGMA busy_timeout = 0");
        probe.run("PRAGMA locking_mode = EXCLUSIVE");
        try {
            probe.run("PRAGMA journal_mode = DELETE");
        } catch {
            // A damaged log may not checkpoint; the proof below stands alone.
        }
        probe.run("BEGIN EXCLUSIVE");
        return probe;
    } catch {
        probe?.close();
        return null;
    }
}

const NOT_REBUILT =
    "it is corrupt and another process may have it open, so it is not rebuilt; delete it once none has";

// A new index in place of a corrupt one, where the proof shows no other
// process has the old open; the error, noted, where it does not or the
// deleting or making fails. The deleting happens while the proof holds.
function rebuild(path: string, busyMs: number, error: unknown): Database {
    const proof = soleHolder(path);
    if (proof === null) {
        throw noted(error, NOT_REBUILT);
    }
    try {
        for (const suffix of FILES) {
            rmSync(`${path}${suffix}`, { force: true });
        }
    } catch (failure) {
        throw noted(
            error,
            `it is corrupt; deleting it failed: ${describeError(failure)}`,
        );
    } finally {
        proof.close();
    }
    try {
        return prepare(path, busyMs);
    } catch (failure) {
        throw noted(
            error,
            `it is corrupt; rebuilding it failed: ${describeError(failure)}`,
        );
    }
}

// The derived index: deleting it costs a rebuild, never data.
export class RecallIndex {
    #db: Database;
    #lock: ReturnType<typeof exclusiveLock>;
    // Work holding the lock, one at a time, so that a rebuild never meets
    // another run on the file it replaces.
    #turn: Promise<unknown> = Promise.resolve();
    readonly #path: string;
    readonly #busyMs: number;

    private constructor(db: Database, path: string, busyMs: number) {
        this.#db = db;
        this.#lock = exclusiveLock(db);
        this.#path = path;
        this.#busyMs = busyMs;
    }

    // The database now in use: another after the index is rebuilt.
    get db(): Database {
        return this.#db;
    }

    // A file SQLite says is not a database is deleted and made again: no
    // valid index can be open on it, and it holds nothing that cannot be
    // rebuilt. One it finds corrupt is rebuilt only where no other process
    // has it open, as in use (see exclusive); where one may, or any other
    // failure such as the write lock staying held, the file is left alone,
    // for another process may be using it.
    static open(path: string, busyMs = 5000): RecallIndex {
        const dir = dirname(path);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        chmodSync(dir, 0o700);
        try {
            return new RecallIndex(prepare(path, busyMs), path, busyMs);
        } catch (error) {
            if (!unusable(error)) {
                throw error;
            }
            if ((error as { code?: unknown }).code !== "SQLITE_NOTADB") {
                return new RecallIndex(
                    rebuild(path, busyMs, error),
                    path,
                    busyMs,
                );
            }
            for (const suffix of FILES) {
                rmSync(`${path}${suffix}`, { force: true });
            }
            return new RecallIndex(prepare(path, busyMs), path, busyMs);
        }
    }

    // Runs work holding the index's write lock, which other processes wait
    // for (and SQLite releases if this one dies); work in this process takes
    // turns. A file that proves corrupt in use is rebuilt where no other
    // process has it open, and the failure, noted, still reaches the caller,
    // whose next call finds a new index. Where another process may hold it,
    // it is left as it is, for deleting a shared index leaves that process
    // writing to a file nothing else reads.
    readonly exclusive: <T>(work: () => T | Promise<T>) => Promise<T> = <T>(
        work: () => T | Promise<T>,
    ) => {
        const run = async (): Promise<T> => {
            try {
                return await this.#lock(work);
            } catch (error) {
                throw unusable(error) ? this.#recover(error) : error;
            }
        };
        const result = this.#turn.then(run, run);
        this.#turn = result.catch(() => {});
        return result;
    };

    #recover(error: unknown): Error {
        try {
            this.#db.close();
        } catch {
            // Closed already, or too damaged to say so.
        }
        try {
            this.#db = rebuild(this.#path, this.#busyMs, error);
            this.#lock = exclusiveLock(this.#db);
            return noted(
                error,
                "it was corrupt and has been rebuilt; ask again",
            );
        } catch (failure) {
            // Whatever is left is used as it was, failing as it did.
            try {
                this.#db = new Database(this.#path, { strict: true });
                this.#db.run(`PRAGMA busy_timeout = ${this.#busyMs}`);
                this.#lock = exclusiveLock(this.#db);
            } catch {
                // Left closed: every call says why.
            }
            return failure instanceof Error
                ? failure
                : noted(error, String(failure));
        }
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

    // A claim still held by owner lives ms from now; false when owner no
    // longer holds it, as after it expired.
    renew(
        phrase: string,
        owner: string,
        now: number,
        ms: number,
    ): Promise<boolean> {
        return this.exclusive(
            () =>
                this.db.run(
                    "UPDATE claims SET until = ? WHERE phrase = ? AND owner = ? AND until > ?",
                    [now + ms, phrase, owner, now],
                ).changes > 0,
        );
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
