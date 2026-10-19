// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/snapshot/snapshot.ts
//
//

// A copy of a data directory in the work directory, so that nothing the
// evaluation does reaches her archive, and the environment that points
// every root at it.

import {
    cp,
    mkdir,
    readdir,
    readFile,
    realpath,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { Env } from "@dorothy/core";
import { UsageError } from "../errors.js";

export type SnapshotInfo = {
    source: string;
    at: string;
    conversations: number;
    knowledge: number;
};

// What a snapshot takes of a data directory: never .git, which holds
// history, nor anything not named here. facts/ is there only where the
// directory has not yet moved it to knowledge/.
const COPIED = ["transcripts", "knowledge", "facts", "tags.json"];

export const snapshotDir = (work: string) => join(work, "data", "dorothy");
const infoPath = (work: string) => join(work, "snapshot.json");

export function workEnv(work: string): Env {
    return {
        HOME: join(work, "home"),
        XDG_DATA_HOME: join(work, "data"),
        XDG_CACHE_HOME: join(work, "cache"),
        XDG_STATE_HOME: join(work, "state"),
        XDG_CONFIG_HOME: join(work, "config"),
    };
}

const exists = (path: string) =>
    stat(path).then(
        () => true,
        () => false,
    );
const within = (path: string, dir: string) =>
    path === dir || path.startsWith(dir + sep);

// A path's real path, through the nearest ancestor that exists.
async function realOf(path: string): Promise<string> {
    try {
        return await realpath(path);
    } catch {
        const parent = dirname(path);
        return parent === path
            ? path
            : join(await realOf(parent), basename(path));
    }
}

// The checkout this runs from: the nearest directory above holding .git,
// or else its root by the package's place in it.
async function repositoryRoot(): Promise<string> {
    for (let dir = import.meta.dir; ; dir = dirname(dir)) {
        if (await exists(join(dir, ".git"))) {
            return realOf(dir);
        }
        if (dirname(dir) === dir) {
            return realOf(resolve(import.meta.dir, "../../../.."));
        }
    }
}

async function count(
    dir: string,
    keep: (name: string) => boolean,
): Promise<number> {
    try {
        const names = await readdir(dir, { recursive: true });
        return names.filter((name) => keep(String(name))).length;
    } catch {
        return 0;
    }
}

export async function takeSnapshot(
    from: string,
    work: string,
    options: { replace?: boolean; now?: () => Date } = {},
): Promise<SnapshotInfo> {
    const source = resolve(from);
    const target = resolve(work);
    if (!(await exists(join(source, "transcripts")))) {
        throw new UsageError(
            `${source} is no data directory of Dorothy's: it has no transcripts/`,
        );
    }
    if (within(target, source) || within(source, target)) {
        throw new UsageError(
            "the work directory and the data directory must not contain each other",
        );
    }
    // Her data in clear must not land where git or the checks sweep it.
    if (within(await realOf(target), await repositoryRoot())) {
        throw new UsageError(
            `${target} is in the repository: choose a work directory outside it`,
        );
    }
    const copy = snapshotDir(target);
    if ((await exists(infoPath(target))) || (await exists(copy))) {
        if (options.replace !== true) {
            throw new UsageError(
                `${target} holds a snapshot already: give --replace to take it again`,
            );
        }
        await rm(copy, { recursive: true, force: true });
        // The index was built from the old copy.
        await rm(join(target, "cache"), { recursive: true, force: true });
    }
    await mkdir(copy, { recursive: true, mode: 0o700 });
    for (const name of COPIED) {
        if (await exists(join(source, name))) {
            await cp(join(source, name), join(copy, name), {
                recursive: true,
                filter: (path) => basename(path) !== ".git",
            });
        }
    }
    const markdown = (name: string) => name.endsWith(".md");
    const info: SnapshotInfo = {
        source,
        at: (options.now?.() ?? new Date()).toISOString(),
        conversations: await count(join(copy, "transcripts"), (name) =>
            name.endsWith(".jsonl"),
        ),
        knowledge:
            (await count(join(copy, "knowledge"), markdown)) +
            (await count(join(copy, "facts"), markdown)),
    };
    await writeFile(infoPath(target), `${JSON.stringify(info, null, 4)}\n`, {
        mode: 0o600,
    });
    return info;
}

export async function readSnapshot(work: string): Promise<SnapshotInfo> {
    try {
        return JSON.parse(
            await readFile(infoPath(work), "utf8"),
        ) as SnapshotInfo;
    } catch {
        throw new UsageError(
            `${work} holds no snapshot: run \`bun run eval -- snapshot --from <data directory> --work ${work}\` first`,
        );
    }
}
