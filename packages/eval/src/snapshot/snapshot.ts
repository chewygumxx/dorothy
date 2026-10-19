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
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { Env } from "@dorothy/core";
import { z } from "zod";
import { codeOf, UsageError } from "../errors.js";
import { readRecord, writeAtomic } from "../files.js";

const snapshotInfoSchema = z.object({
    source: z.string(),
    at: z.string(),
    conversations: z.number().int().min(0),
    knowledge: z.number().int().min(0),
    // The symbolic links below the top that the copy did not follow; a
    // snapshot taken before they were counted has none.
    skippedLinks: z.number().int().min(0).optional(),
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

// The checkout and the other worktrees of its repository, read from the
// layout git leaves (a main checkout lists its worktrees; a worktree's
// .git file names the main one), with no git run. A checkout without that
// layout is itself alone.
export async function checkoutRoots(here = import.meta.dir): Promise<string[]> {
    const root = await checkoutRoot(here);
    const roots = [root];
    let common = join(root, ".git");
    try {
        if ((await stat(common)).isFile()) {
            const named = /^gitdir:\s*(.+)$/m.exec(
                await readFile(common, "utf8"),
            );
            if (named?.[1] === undefined) {
                return roots;
            }
            // <main>/.git/worktrees/<name> to <main>/.git, the path
            // relative to the directory of the file that holds it.
            common = resolve(dirname(common), named[1], "..", "..");
            if (basename(common) === ".git") {
                roots.push(await realOf(dirname(common)));
            }
        }
    } catch {
        // No git layout to read.
        return roots;
    }
    let names: string[];
    try {
        names = await readdir(join(common, "worktrees"));
    } catch {
        return [...new Set(roots)];
    }
    for (const name of names) {
        // An entry gone stale or unreadable costs only itself.
        try {
            const entry = join(common, "worktrees", name);
            const listed = (
                await readFile(join(entry, "gitdir"), "utf8")
            ).trim();
            roots.push(await realOf(dirname(resolve(entry, listed))));
        } catch {
            // Not listed.
        }
    }
    return [...new Set(roots)];
}

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

// What a copy leaves out: .git, which holds history, and a symbolic link,
// which would lead it out of the data directory or keep a way back into
// it; each link is counted. The entries a snapshot takes are followed if
// they are links themselves (see `entryOf`), but nothing below them.
function copying(entry: string): {
    filter: (path: string) => Promise<boolean>;
    skipped: () => number;
} {
    let skipped = 0;
    return {
        filter: async (path) => {
            // The entry itself is what was asked for, whatever it is named.
            if (path === entry) {
                return true;
            }
            if (basename(path) === ".git") {
                return false;
            }
            if ((await lstat(path)).isSymbolicLink()) {
                skipped++;
                return false;
            }
            return true;
        },
        skipped: () => skipped,
    };
}

// Where an entry of the data directory really is, if it is there: a
// directory stowed elsewhere is a link at the top, and is followed. It may
// not lead into the work directory, nor around it.
async function entryOf(
    source: string,
    name: string,
    realTarget: string,
): Promise<string | null> {
    const path = join(source, name);
    try {
        await lstat(path);
    } catch (error) {
        const code = codeOf(error);
        if (code === "ENOENT") {
            return null;
        }
        throw new UsageError(`cannot read ${path}: ${code ?? "failed"}`);
    }
    // A link that dangles or loops is there, and leads to nothing.
    let real: string;
    try {
        real = await realpath(path);
    } catch (error) {
        throw new UsageError(
            `${path} is a link that leads nowhere (${codeOf(error) ?? "failed"}); mend or remove it`,
        );
    }
    if (within(real, realTarget) || within(realTarget, real)) {
        throw new UsageError(
            `${path} leads to ${real}, and it and the work directory must not contain each other`,
        );
    }
    return real;
}

export async function takeSnapshot(
    from: string,
    work: string,
    options: {
        replace?: boolean;
        now?: () => Date;
        // Where the checkout is looked for from; the package's own place.
        checkout?: string;
    } = {},
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
    for (const root of await checkoutRoots(options.checkout)) {
        if (within(realTarget, root)) {
            throw new UsageError(
                `${target} is in the repository: choose a work directory outside it`,
            );
        }
    }
    const copy = snapshotDir(target);
    const old = `${copy}.old`;
    // A swap a crash cut short left the old copy aside, the only one.
    if (!(await exists(copy)) && (await exists(old))) {
        await rename(old, copy);
    }
    const held = (await exists(infoPath(target))) || (await exists(copy));
    if (held && options.replace !== true) {
        throw new UsageError(
            `${target} holds a snapshot already: give --replace to take it again`,
        );
    }
    // Built apart, and swapped in only when whole, so a copy that fails
    // leaves the old snapshot as it was.
    const partial = `${copy}.partial`;
    await rm(partial, { recursive: true, force: true });
    await mkdir(partial, { recursive: true, mode: 0o700 });
    try {
        let skippedLinks = 0;
        for (const name of COPIED) {
            const real = await entryOf(source, name, realTarget);
            if (real !== null) {
                const links = copying(real);
                await cp(real, join(partial, name), {
                    recursive: true,
                    filter: links.filter,
                });
                skippedLinks += links.skipped();
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
            skippedLinks,
        };
        if (await exists(copy)) {
            // Any `old` left is stale: the copy it was aside from is back.
            await rm(old, { recursive: true, force: true });
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
        // The index was built from the old copy.
        await rm(join(target, "cache"), { recursive: true, force: true });
        await writeAtomic(
            infoPath(target),
            `${JSON.stringify(info, null, 4)}\n`,
        );
        await rm(old, { recursive: true, force: true });
        return info;
    } finally {
        await rm(partial, { recursive: true, force: true });
    }
}

// The record of the snapshot a work directory holds. Only a missing file
// is "no snapshot"; one that cannot be read or is no record is said so,
// with how to mend it.
export const readSnapshot = (work: string): Promise<SnapshotInfo> =>
    readRecord(infoPath(work), {
        missing: `${work} holds no snapshot: run \`bun run eval -- snapshot --from <data directory> --work ${work}\` first`,
        what: "a snapshot record",
        again: "take the snapshot again with --replace",
        check: (read) => {
            const parsed = snapshotInfoSchema.safeParse(read);
            const issue = parsed.success ? null : parsed.error.issues[0];
            return parsed.success
                ? parsed.data
                : `${issue?.path.join(".") || "its form"}: ${issue?.message}`;
        },
    });
