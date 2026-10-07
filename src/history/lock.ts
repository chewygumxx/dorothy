// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/lock.ts
//
//

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Lock } from "../memory/sidecar.js";

// History's own write lock, for when there is no recall index to hold
// one: SQLite's, on a file of its own, the way the index holds its lock.
// Other processes wait for it, and SQLite lets go if this one dies; work
// in this process takes turns.
export class FileLock {
    readonly #db: Database;
    #queue: Promise<unknown> = Promise.resolve();

    private constructor(db: Database) {
        this.#db = db;
    }

    static open(path: string, busyMs = 5000): FileLock {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        const db = new Database(path, { create: true });
        db.run(`PRAGMA busy_timeout = ${busyMs}`);
        return new FileLock(db);
    }

    readonly lock: Lock = <T>(work: () => Promise<T>): Promise<T> => {
        const run = async (): Promise<T> => {
            this.#db.run("BEGIN IMMEDIATE");
            try {
                const value = await work();
                this.#db.run("COMMIT");
                return value;
            } catch (error) {
                try {
                    this.#db.run("ROLLBACK");
                } catch {
                    // A failed statement may have ended the transaction.
                }
                throw error;
            }
        };
        const result = this.#queue.then(run, run);
        this.#queue = result.catch(() => {});
        return result;
    };

    close(): void {
        this.#db.close();
    }
}
