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
// knowledge/, which is never overwritten, one that fails to move, and
// anything else left there that the store does not list.

import type { Dirent } from "node:fs";
import { readdir, readFile, rm, rmdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { parseLegacyFact } from "./legacy.js";
import { type FactFile, factFiles, factPath, putFact } from "./store.js";

const OLD = "facts";

const codeOf = (error: unknown) => (error as { code?: unknown }).code;

// Removes empty directories under dir, dir itself last. A link is not
// followed: what it points at is not facts/'s to tidy.
async function prune(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
        if (codeOf(error) === "ENOENT") {
            return;
        }
        throw error;
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            await prune(join(dir, entry.name)).catch(() => {});
        }
    }
    await rmdir(dir).catch(() => {});
}

// Everything left under dir that is not a directory, links included.
async function leftovers(dir: string): Promise<Dirent[]> {
    const left: Dirent[] = [];
    let entries: Dirent[];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return left;
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            left.push(...(await leftovers(join(dir, entry.name))));
        } else {
            left.push(entry);
        }
    }
    return left;
}

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

type Reader = typeof readFile;

// Moves one file; the warning is why it stayed, null when it moved.
async function move(
    root: string,
    file: FactFile,
    read: Reader,
): Promise<string | null> {
    const shown = relative(root, file.path).split(sep).join("/");
    let source: string;
    try {
        source = await read(file.path, "utf8");
    } catch (error) {
        // Another process moved it first.
        if (codeOf(error) === "ENOENT") {
            return null;
        }
        throw error;
    }
    const parsed = parseLegacyFact(source, file.name);
    if (parsed.kind !== "ok") {
        return `${shown} was left in facts/: ${parsed.reason}`;
    }
    // Never over a file already there, which may be newer, nor one made
    // while this one was read.
    try {
        await putFact(root, file.scope, parsed.fact, { keep: true });
    } catch (error) {
        if (codeOf(error) === "EEXIST") {
            const target = factPath(root, file.scope, file.name);
            const into = relative(root, target).split(sep).join("/");
            return `${shown} was left in facts/: ${into} exists`;
        }
        throw error;
    }
    await rm(file.path, { force: true });
    return null;
}

export async function migrateFacts(
    root: string,
    { read = readFile }: { read?: Reader } = {},
): Promise<string[]> {
    const files = await factFiles(root, undefined, OLD);
    const warnings: string[] = [];
    const said = new Set<string>();
    for (const file of files) {
        try {
            const warning = await move(root, file, read);
            if (warning !== null) {
                warnings.push(warning);
            }
        } catch (error) {
            const shown = relative(root, file.path).split(sep).join("/");
            warnings.push(
                `${shown} was left in facts/: ${describeError(error)}`,
            );
        }
        said.add(file.path);
    }
    await prune(join(root, OLD));
    for (const entry of await leftovers(join(root, OLD))) {
        const path = join(entry.parentPath, entry.name);
        if (!said.has(path)) {
            const shown = relative(root, path).split(sep).join("/");
            warnings.push(
                `${shown} was left in facts/: ${entry.isSymbolicLink() ? "it is a link" : "it is no fact the store lists"}`,
            );
        }
    }
    return warnings;
}
