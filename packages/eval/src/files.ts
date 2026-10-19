// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/files.ts
//
//

// The small JSON files a work directory holds: read so that a missing one
// is told from one that cannot be read or is no record, and written whole
// or not at all.

import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { codeOf, UsageError } from "./errors.js";

// The record in a JSON file. Only a missing file is `missing`; one that
// cannot be read, or is not JSON, or fails `check` (which gives the
// problem, or the record) is said so, with how to mend it.
export async function readRecord<T>(
    path: string,
    options: {
        missing: string;
        what: string;
        again: string;
        check: (value: unknown) => T | string;
    },
): Promise<T> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        const code = codeOf(error);
        if (code === "ENOENT") {
            throw new UsageError(options.missing);
        }
        throw new UsageError(
            `cannot read ${path}: ${code ?? "failed"}; mend it, or ${options.again}`,
        );
    }
    let read: unknown;
    try {
        read = JSON.parse(text);
    } catch {
        throw new UsageError(`${path} is not JSON; ${options.again}`);
    }
    const checked = options.check(read);
    if (typeof checked === "string") {
        throw new UsageError(
            `${path} is not ${options.what} (${checked}); ${options.again}`,
        );
    }
    return checked;
}

// Whether a process of this pid is still there (EPERM: there, not ours).
const alive = (pid: number) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return codeOf(error) !== "ESRCH";
    }
};

// A temporary file's name is the process's and the write's own, so that
// writers of one file, in one process or two, never share one.
let writes = 0;

// What a Ctrl-C left: temporary files of the path made by processes that
// are gone. Those of a live process may be mid-write.
async function sweepStrays(path: string): Promise<void> {
    const name = basename(path);
    try {
        for (const entry of await readdir(dirname(path))) {
            const stray = new RegExp(
                `^${escapeRegExp(name)}\\.(\\d+)\\.\\d+\\.tmp$`,
            ).exec(entry);
            if (stray !== null && !alive(Number(stray[1]))) {
                await rm(join(dirname(path), entry), { force: true });
            }
        }
    } catch {
        // The write says what is wrong with the directory.
    }
}

const escapeRegExp = (text: string) =>
    text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Written whole or not at all: a torn file would refuse every command.
// A write that a Ctrl-C cut short leaves its temporary file, which the
// next write of the path removes.
export async function writeAtomic(
    path: string,
    text: string,
    mode = 0o600,
): Promise<void> {
    await sweepStrays(path);
    const making = `${path}.${process.pid}.${++writes}.tmp`;
    try {
        await writeFile(making, text, { mode });
        await rename(making, path);
    } catch (error) {
        await rm(making, { force: true });
        throw error;
    }
}
