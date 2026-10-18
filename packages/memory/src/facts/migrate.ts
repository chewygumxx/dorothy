// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/facts/migrate.ts
//
//

// facts/, in the store's form before the Open Knowledge Format, moved
// once to knowledge/ in it. The caller holds the store's lock; history's
// next sweep commits the move as Dorothy's own, each new file canonical
// with no committed version. A file the old reader cannot read stays in
// facts/ and is named in a warning, as is one whose twin is already in
// knowledge/, which is never overwritten, and one that fails to move.

import { readdir, readFile, rm, rmdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { parseLegacyFact } from "./legacy.js";
import { type FactFile, factFiles, factPath, putFact } from "./store.js";

const OLD = "facts";

const codeOf = (error: unknown) => (error as { code?: unknown }).code;

// Removes empty directories under dir, dir itself last.
async function prune(dir: string): Promise<void> {
    let entries: string[];
    try {
        entries = await readdir(dir);
    } catch (error) {
        if (codeOf(error) === "ENOENT") {
            return;
        }
        throw error;
    }
    for (const entry of entries) {
        await prune(join(dir, entry)).catch(() => {});
    }
    await rmdir(dir).catch(() => {});
}

const exists = (path: string) =>
    stat(path).then(
        () => true,
        (error) => {
            if (codeOf(error) === "ENOENT") {
                return false;
            }
            throw error;
        },
    );

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// Moves one file; the warning is why it stayed, null when it moved.
async function move(root: string, file: FactFile): Promise<string | null> {
    const shown = relative(root, file.path).split(sep).join("/");
    let source: string;
    try {
        source = await readFile(file.path, "utf8");
    } catch (error) {
        // Another process moved it first.
        if (codeOf(error) === "ENOENT") {
            return null;
        }
        throw error;
    }
    const read = parseLegacyFact(source, file.name);
    if (read.kind !== "ok") {
        return `${shown} was left in facts/: ${read.reason}`;
    }
    // Never over a file already there, which may be newer.
    const target = factPath(root, file.scope, file.name);
    if (await exists(target)) {
        const into = relative(root, target).split(sep).join("/");
        return `${shown} was left in facts/: ${into} exists`;
    }
    await putFact(root, file.scope, read.fact);
    await rm(file.path, { force: true });
    return null;
}

export async function migrateFacts(root: string): Promise<string[]> {
    const files = await factFiles(root, undefined, OLD);
    const warnings: string[] = [];
    for (const file of files) {
        try {
            const warning = await move(root, file);
            if (warning !== null) {
                warnings.push(warning);
            }
        } catch (error) {
            const shown = relative(root, file.path).split(sep).join("/");
            warnings.push(
                `${shown} was left in facts/: ${describeError(error)}`,
            );
        }
    }
    await prune(join(root, OLD));
    return warnings;
}
