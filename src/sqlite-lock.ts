// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/sqlite-lock.ts
//
//

import type { Database } from "bun:sqlite";

// A write lock held on a SQLite database: work runs inside BEGIN
// IMMEDIATE, which other processes wait for (up to the database's busy
// timeout, and SQLite releases it if this one dies); work in this process
// takes turns, in the order asked. The work's failure rolls it back.
export function exclusiveLock(
    db: Database,
): <T>(work: () => T | Promise<T>) => Promise<T> {
    let queue: Promise<unknown> = Promise.resolve();
    return <T>(work: () => T | Promise<T>): Promise<T> => {
        const run = async (): Promise<T> => {
            db.run("BEGIN IMMEDIATE");
            try {
                const value = await work();
                db.run("COMMIT");
                return value;
            } catch (error) {
                try {
                    db.run("ROLLBACK");
                } catch {
                    // A failed statement may have ended the transaction.
                }
                throw error;
            }
        };
        const result = queue.then(run, run);
        queue = result.catch(() => {});
        return result;
    };
}
