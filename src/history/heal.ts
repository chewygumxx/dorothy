// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/heal.ts
//
//

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { writeAtomic } from "../memory/sidecar.js";
import { lint } from "./lint.js";
import type { MemoryRepo } from "./repo.js";

export type Version = { sha: string; at: string; bytes: Uint8Array };
export type Healed =
    | {
          kind: "restored";
          path: string;
          from: string;
          at: string;
          broken: string;
      }
    | { kind: "unrecoverable"; path: string; broken: string };

// How many of a file's commits recovery looks through for a good one.
export const RECOVERY_DEPTH = 200;

// A UTC time safe in a file name: 2026-10-15T09-12-03-123Z.
export const stamp = (now: Date) => now.toISOString().replaceAll(/[:.]/g, "-");

// The newest committed version of a file that passes the lint on its own.
export async function goodVersion(
    repo: MemoryRepo,
    path: string,
): Promise<Version | null> {
    for (const commit of await repo.log(path, RECOVERY_DEPTH)) {
        const bytes = await repo.show(path, commit.sha);
        if (bytes !== null && lint(path, bytes, null) === null) {
            return { sha: commit.sha, at: commit.at, bytes };
        }
    }
    return null;
}

// Keeps a file's bytes under broken/, beside the path they came from and
// named for when; when the newest copy already holds them, that copy is
// returned rather than another made. The path is relative to root.
export async function keepCopy(
    root: string,
    path: string,
    bytes: Uint8Array,
    now: Date,
): Promise<string> {
    const folder = join("broken", dirname(path));
    const name = basename(path);
    let copies: string[] = [];
    try {
        copies = (await readdir(join(root, folder)))
            .filter((entry) => entry.startsWith(`${name}.`))
            .sort();
    } catch {
        // No copies yet.
    }
    const newest = copies.at(-1);
    if (
        newest !== undefined &&
        Buffer.compare(await readFile(join(root, folder, newest)), bytes) === 0
    ) {
        return join(folder, newest);
    }
    const copy = join(folder, `${name}.${stamp(now)}`);
    await mkdir(join(root, folder), { recursive: true, mode: 0o700 });
    await writeFile(join(root, copy), bytes, { mode: 0o600 });
    return copy;
}

// Writes a version in place, keeping what it replaces, and commits both;
// the copy's path, or null when no file was there.
export async function putBack(
    repo: MemoryRepo,
    root: string,
    path: string,
    version: Version,
    now: Date,
): Promise<string | null> {
    const full = join(root, path);
    const copy = existsSync(full)
        ? await keepCopy(root, path, await readFile(full), now)
        : null;
    await writeAtomic(full, version.bytes);
    await repo.commit(
        copy === null ? [path] : [copy, path],
        `restore: ${path} from ${version.sha.slice(0, 7)} (broken kept)`,
    );
    return copy;
}

// A file that failed the lint: put back its newest good version, or, when
// it has none, keep a copy and leave it.
export async function recoverFile(
    repo: MemoryRepo,
    root: string,
    path: string,
    now: Date,
): Promise<Healed> {
    const good = await goodVersion(repo, path);
    if (good === null) {
        const broken = await keepCopy(
            root,
            path,
            await readFile(join(root, path)),
            now,
        );
        await repo.commit([broken], `broken: ${path} kept, no good version`);
        return { kind: "unrecoverable", path, broken };
    }
    const broken = (await putBack(repo, root, path, good, now)) ?? "";
    return { kind: "restored", path, from: good.sha, at: good.at, broken };
}
