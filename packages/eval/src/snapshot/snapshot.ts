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
    lstat,
    mkdir,
    readdir,
    readFile,
    realpath,
    rename,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { Env } from "@dorothy/core";
import { z } from "zod";
import { codeOf, UsageError } from "../errors.js";

const snapshotInfoSchema = z.object({
    source: z.string(),
    at: z.string(),
    conversations: z.number().int().min(0),
    knowledge: z.number().int().min(0),
});
export type SnapshotInfo = z.infer<typeof snapshotInfoSchema>;

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

// The checkout this runs from, by the package's place in it: .git is no
// guide, as a checkout without one inside another repository would make
// that repository the root.
export const checkoutRoot = (here = import.meta.dir) =>
    realOf(resolve(here, "../../../.."));

// Only a missing directory holds nothing; any other failure must not look
// like an empty one.
async function count(
    dir: string,
    keep: (name: string) => boolean,
): Promise<number> {
    try {
        const names = await readdir(dir, { recursive: true });
        return names.filter((name) => keep(String(name))).length;
    } catch (error) {
        const code = codeOf(error);
        if (code === "ENOENT") {
            return 0;
        }
        throw new UsageError(`cannot count ${dir}: ${code ?? "failed"}`);
    }
}

// Neither .git, which holds history, nor a symbolic link, which would
// either lead the copy out of the data directory or keep a way back into it.
async function copiable(path: string): Promise<boolean> {
    return basename(path) !== ".git" && !(await lstat(path)).isSymbolicLink();
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
    // By real path, as a link may lead either into the other.
    const [realTarget, realSource] = [
        await realOf(target),
        await realOf(source),
    ];
    if (within(realTarget, realSource) || within(realSource, realTarget)) {
        throw new UsageError(
            "the work directory and the data directory must not contain each other",
        );
    }
    // Her data in clear must not land where git or the checks sweep it.
    if (within(realTarget, await checkoutRoot())) {
        throw new UsageError(
            `${target} is in the repository: choose a work directory outside it`,
        );
    }
    const copy = snapshotDir(target);
    const held = (await exists(infoPath(target))) || (await exists(copy));
    if (held && options.replace !== true) {
        throw new UsageError(
            `${target} holds a snapshot already: give --replace to take it again`,
        );
    }
    // Built apart, and swapped in only when whole, so a copy that fails
    // leaves the old snapshot as it was.
    const partial = `${copy}.partial`;
    const old = `${copy}.old`;
    await rm(partial, { recursive: true, force: true });
    await mkdir(partial, { recursive: true, mode: 0o700 });
    try {
        for (const name of COPIED) {
            if (await exists(join(source, name))) {
                await cp(join(source, name), join(partial, name), {
                    recursive: true,
                    filter: copiable,
                });
            }
        }
        const markdown = (name: string) => name.endsWith(".md");
        const info: SnapshotInfo = {
            source,
            at: (options.now?.() ?? new Date()).toISOString(),
            conversations: await count(join(partial, "transcripts"), (name) =>
                name.endsWith(".jsonl"),
            ),
            knowledge:
                (await count(join(partial, "knowledge"), markdown)) +
                (await count(join(partial, "facts"), markdown)),
        };
        await rm(old, { recursive: true, force: true });
        if (await exists(copy)) {
            await rename(copy, old);
        }
        try {
            await rename(partial, copy);
        } catch (error) {
            if (await exists(old)) {
                await rename(old, copy);
            }
            throw error;
        }
        await writeInfo(target, info);
        // The index was built from the old copy.
        await rm(join(target, "cache"), { recursive: true, force: true });
        await rm(old, { recursive: true, force: true });
        return info;
    } finally {
        await rm(partial, { recursive: true, force: true });
    }
}

// Written whole or not at all: a torn record would refuse every command.
async function writeInfo(work: string, info: SnapshotInfo): Promise<void> {
    const path = infoPath(work);
    const making = `${path}.${process.pid}.tmp`;
    try {
        await writeFile(making, `${JSON.stringify(info, null, 4)}\n`, {
            mode: 0o600,
        });
        await rename(making, path);
    } catch (error) {
        await rm(making, { force: true });
        throw error;
    }
}

// The record of the snapshot a work directory holds. Only a missing file
// is "no snapshot"; one that cannot be read or is no record is said so,
// with how to mend it.
export async function readSnapshot(work: string): Promise<SnapshotInfo> {
    const path = infoPath(work);
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        const code = codeOf(error);
        if (code === "ENOENT") {
            throw new UsageError(
                `${work} holds no snapshot: run \`bun run eval -- snapshot --from <data directory> --work ${work}\` first`,
            );
        }
        throw new UsageError(
            `cannot read ${path}: ${code ?? "failed"}; mend it, or take the snapshot again with --replace`,
        );
    }
    let read: unknown;
    try {
        read = JSON.parse(text);
    } catch {
        throw new UsageError(
            `${path} is not JSON; take the snapshot again with --replace`,
        );
    }
    const parsed = snapshotInfoSchema.safeParse(read);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new UsageError(
            `${path} is not a snapshot record (${issue?.path.join(".") || "its form"}: ${issue?.message}); take the snapshot again with --replace`,
        );
    }
    return parsed.data;
}
