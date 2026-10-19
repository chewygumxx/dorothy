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

// Path, relative to the data directory with forward slashes, to the hash
// of the bytes Dorothy last wrote there.
export async function pendingWrites(
    root: string,
): Promise<ReadonlyMap<string, string>> {
    const pending = new Map<string, string>();
    let text: string;
    try {
        text = await readFile(pendingPath(root), "utf8");
    } catch {
        return pending;
    }
    for (const line of text.split("\n")) {
        const space = line.indexOf(" ");
        if (space > 0) {
            pending.set(line.slice(space + 1), line.slice(0, space));
        }
    }
    return pending;
}

// Written under the lock the write was made under. With no repository
// yet there is nothing to sweep, and nothing is kept; one that cannot be
// kept leaves the write to be taken for an outside one.
export async function notePending(
    root: string,
    path: string,
    bytes: string | Uint8Array,
): Promise<void> {
    try {
        if (!(await stat(join(root, ".git"))).isDirectory()) {
            return;
        }
        await appendFile(pendingPath(root), `${hashOf(bytes)} ${path}\n`, {
            mode: 0o600,
        });
    } catch {
        // The write stands.
    }
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
            [...pending].map(([path, hash]) => `${hash} ${path}\n`).join(""),
        );
    } catch {
        // A stale entry matches only the bytes Dorothy wrote.
    }
}
