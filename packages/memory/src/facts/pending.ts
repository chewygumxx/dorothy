// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/facts/pending.ts
//
//

// The facts Dorothy has written and history has not committed yet, as
// the hash of each file's bytes, kept beside the data directory's git
// repository. A file's own provenance is a claim anyone able to write
// the file can make; this is Dorothy's record of what she wrote, which
// is how the sweep tells her uncommitted write, left by a crash, from
// an outside writer's.

import { createHash } from "node:crypto";
import { open, readFile, rm, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomic } from "../memory/sidecar.js";

export const pendingPath = (root: string) =>
    join(root, ".git", "dorothy-pending");

export const hashOf = (bytes: string | Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");

// Paths to hashes noted before replacement. Keep earlier hashes until
// commit too: a failed replacement must not lose its predecessor.
// A damaged journal can still hold good records. Missing records cannot
// establish an outside edit while any part of the journal is unreadable.
export type PendingWrites = {
    writes: ReadonlyMap<string, ReadonlySet<string>>;
    problem: Error | null;
};

export async function pendingWrites(root: string): Promise<PendingWrites> {
    const pending = new Map<string, Set<string>>();
    let problem: Error | null = null;
    let text: string;
    try {
        text = await readFile(pendingPath(root), "utf8");
    } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") {
            return { writes: pending, problem };
        }
        return {
            writes: pending,
            problem: new Error(
                `${pendingPath(root)}: attribution unavailable`,
                {
                    cause: error,
                },
            ),
        };
    }
    for (const line of text.split("\n")) {
        if (line === "") {
            continue;
        }
        const match = /^([a-f0-9]{64}) (.+)$/.exec(line);
        if (match === null) {
            problem = new Error(
                `${pendingPath(root)}: invalid attribution record`,
            );
            continue;
        }
        const hash = match[1] as string;
        const path = match[2] as string;
        const hashes = pending.get(path) ?? new Set<string>();
        hashes.add(hash);
        pending.set(path, hashes);
    }
    return { writes: pending, problem };
}

// Written under the store lock, before replacing the fact. With no
// repository yet there is nothing to sweep. Any other failure must stop
// the replacement, never leave an unrecorded write to be called a user edit.
export async function notePending(
    root: string,
    path: string,
    bytes: string | Uint8Array,
): Promise<void> {
    try {
        if (!(await stat(join(root, ".git"))).isDirectory()) {
            throw new Error(`${join(root, ".git")}: not a directory`);
        }
    } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") {
            return;
        }
        throw error;
    }
    const file = await open(pendingPath(root), "a+", 0o600);
    try {
        const { size } = await file.stat();
        const tail = new Uint8Array(1);
        if (size > 0) {
            await file.read(tail, 0, 1, size - 1);
        }
        const separator = size > 0 && tail[0] !== 0x0a ? "\n" : "";
        await file.writeFile(`${separator}${hashOf(bytes)} ${path}\n`);
    } finally {
        await file.close();
    }
}

// Once the paths are committed, they are nobody's pending writes. Call
// after the whole sweep: repairing a damaged journal earlier would let
// the next sweep promote facts an interruption left uncommitted.
export async function clearPending(
    root: string,
    paths: readonly string[],
): Promise<string | null> {
    try {
        const { writes, problem } = await pendingWrites(root);
        const pending = new Map(writes);
        const before = pending.size;
        for (const path of paths) {
            pending.delete(path);
        }
        if (pending.size === before && problem === null) {
            return null;
        }
        // An empty directory is recoverable too; never remove its contents.
        if ((await stat(pendingPath(root))).isDirectory()) {
            await rmdir(pendingPath(root));
        }
        if (pending.size === 0) {
            await rm(pendingPath(root), { force: true });
            return null;
        }
        await writeAtomic(
            pendingPath(root),
            [...pending]
                .flatMap(([path, hashes]) =>
                    [...hashes].map((hash) => `${hash} ${path}\n`),
                )
                .join(""),
        );
        return null;
    } catch (error) {
        // Stale entries are conservative, but failed repair must be visible.
        return `${pendingPath(root)}: ${error instanceof Error ? error.message : String(error)}`;
    }
}
