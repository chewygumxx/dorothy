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

import { readFile, rename, rm, writeFile } from "node:fs/promises";
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

// Written whole or not at all: a torn file would refuse every command.
// The temporary name is fixed, so one that a Ctrl-C leaves is written
// over by the next write; the callers keep their writes apart.
export async function writeAtomic(
    path: string,
    text: string,
    mode = 0o600,
): Promise<void> {
    const making = `${path}.tmp`;
    try {
        await writeFile(making, text, { mode });
        await rename(making, path);
    } catch (error) {
        await rm(making, { force: true });
        throw error;
    }
}
