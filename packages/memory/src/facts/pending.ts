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
import { appendFile, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomic } from "../memory/sidecar.js";

export const pendingPath = (root: string) =>
    join(root, ".git", "dorothy-pending");

export const hashOf = (bytes: string | Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");

// Paths to hashes noted before replacement. Keep earlier hashes until
// commit too: a failed replacement must not lose its predecessor.
export async function pendingWrites(
    root: string,
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
    const pending = new Map<string, Set<string>>();
    let text: string;
    try {
        text = await readFile(pendingPath(root), "utf8");
    } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") {
            return pending;
        }
        throw new Error(`${pendingPath(root)}: attribution unavailable`, {
            cause: error,
        });
    }
    for (const line of text.split("\n")) {
        if (line === "") {
            continue;
        }
        const match = /^([a-f0-9]{64}) (.+)$/.exec(line);
        if (match === null) {
            throw new Error(`${pendingPath(root)}: invalid attribution record`);
        }
        const hash = match[1] as string;
        const path = match[2] as string;
        const hashes = pending.get(path) ?? new Set<string>();
        hashes.add(hash);
        pending.set(path, hashes);
    }
    return pending;
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
    await appendFile(pendingPath(root), `${hashOf(bytes)} ${path}\n`, {
        mode: 0o600,
    });
}

// Once the paths are committed, they are nobody's pending writes.
export async function clearPending(
    root: string,
    paths: readonly string[],
): Promise<void> {
    try {
        const pending = new Map(await pendingWrites(root));
        const before = pending.size;
        for (const path of paths) {
            pending.delete(path);
        }
        if (pending.size === before) {
            return;
        }
        if (pending.size === 0) {
            await rm(pendingPath(root), { force: true });
            return;
        }
        await writeAtomic(
            pendingPath(root),
            [...pending]
                .flatMap(([path, hashes]) =>
                    [...hashes].map((hash) => `${hash} ${path}\n`),
                )
                .join(""),
        );
    } catch {
        // A stale entry matches only the bytes Dorothy wrote.
    }
}
