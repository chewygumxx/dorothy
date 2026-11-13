// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/memory/src/recording/pi-source.ts
//
//

// Dorothy's Pi sessions as a recording source: the files below her own
// session root alone, each read whole without following a symlink, its
// fork's parent resolved before it. The sweep and the Pi hooks read
// through it alike. Invariants, pinned by pi-source.test.ts:
// - Only the dedicated root is listed, recursively, never through a
//   symlink; a path a header or hook names is taken only when its real
//   directory lies inside the root's, and a symlinked file is refused.
// - A fork's ancestry comes only from the parent file its header names,
//   resolved parents first, at most MAX_FORKS deep, a cycle refused. It
//   is that file's current complete read, or its sidecar while the file's
//   fingerprint still matches; a parent that is missing, outside, halted,
//   torn or unresolved itself holds the child (`orphan`), reading nothing.
// - Each read's owners are kept in its sidecar before the archive takes
//   a segment. A rewrite that would move a kept entry or segment halts
//   the file (`ownership`) and records nothing; the sidecar stays.
import { lstat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { Env } from "@dorothy/core";
import { piSessionRoot } from "../hosts/pi-root.js";
import { type PiAncestry, type PiRead, readPi } from "./pi.js";
import {
    entries,
    existing,
    type FileFingerprint,
    type FileRead,
    fileFingerprint,
    fileSessions,
    readFileSession,
    type Source,
    type SourceRead,
    sameFingerprint,
} from "./sources.js";
import { loadPiSidecar, type PiSidecar, savePiSidecar } from "./state.js";

export const PI_MAX_BYTES = 64 * 1024 * 1024;
// Forks above a file followed to find its ancestry.
const MAX_FORKS = 64;

export type PiFile = Extract<SourceRead, { kind: "pi" }>;
export type PiSessionFile =
    | { kind: "outside" }
    | { kind: "missing" }
    | { kind: "read"; file: PiFile };

type Roots = { lexical: string; real: string | null };
type Context = { env: Env; roots: Roots };
type Located =
    | { kind: "outside" }
    | { kind: "missing" }
    | { kind: "found"; path: string };

const within = (root: string, path: string) => path.startsWith(`${root}${sep}`);

async function rootsOf(env: Env): Promise<Roots> {
    const lexical = resolve(piSessionRoot(env));
    return { lexical, real: await existing(lexical) };
}

// A named session file's canonical path, if its real directory lies
// inside the root's; missing where no such directory exists yet.
async function locate(roots: Roots, path: string): Promise<Located> {
    if (!isAbsolute(path) || !path.endsWith(".jsonl"))
        return { kind: "outside" };
    const named = resolve(path);
    if (
        !within(roots.lexical, named) &&
        !(roots.real !== null && within(roots.real, named))
    )
        return { kind: "outside" };
    if (roots.real === null) return { kind: "missing" };
    let dir: string | null;
    try {
        dir = await existing(dirname(named));
    } catch {
        return { kind: "outside" };
    }
    if (dir === null) return { kind: "missing" };
    const canonical = join(dir, basename(named));
    return within(roots.real, canonical)
        ? { kind: "found", path: canonical }
        : { kind: "outside" };
}

async function sessionFiles(dir: string): Promise<string[]> {
    const paths: string[] = [];
    // Dirents describe the link itself: a symlink is neither kind.
    for (const entry of await entries(dir)) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) paths.push(...(await sessionFiles(path)));
        else if (entry.isFile() && entry.name.endsWith(".jsonl"))
            paths.push(path);
    }
    return paths;
}

// The parent file a header names, or null for none or no header.
function parentNamed(lines: readonly string[]): string | null {
    const first = lines.find((line) => line.trim() !== "");
    try {
        const header = JSON.parse(first ?? "") as Record<string, unknown>;
        return header?.type === "session" &&
            typeof header.parentSession === "string" &&
            header.parentSession !== ""
            ? header.parentSession
            : null;
    } catch {
        return null;
    }
}

// A last line cut short: a write still under way.
function torn(lines: readonly string[]): boolean {
    const last = lines.findLast((line) => line.trim() !== "");
    if (last === undefined) return false;
    try {
        JSON.parse(last);
        return false;
    } catch {
        return true;
    }
}

const lineOf = (lines: readonly string[], id: string | null) =>
    Math.max(
        0,
        lines.findIndex((line) => {
            try {
                return (JSON.parse(line) as { id?: unknown })?.id === id;
            } catch {
                return false;
            }
        }),
    );

// The first entry or segment this read would give another owner than the
// sidecar kept; a file now holding another session has nothing to keep.
function moved(kept: PiSidecar, read: PiRead): { id: string | null } | null {
    const ancestry = read.ancestry;
    if (
        ancestry === null ||
        ancestry.nativeSession !== kept.ancestry.nativeSession
    )
        return null;
    for (const [id, now] of Object.entries(ancestry.entries)) {
        const before = Object.hasOwn(kept.ancestry.entries, id)
            ? kept.ancestry.entries[id]
            : undefined;
        if (
            before &&
            (before.owner !== now.owner || before.origin !== now.origin)
        )
            return { id };
    }
    for (const segment of read.segments) {
        const before = kept.segments.find(
            (each) => each.session === segment.session,
        );
        if (
            before &&
            (before.parent !== segment.parent ||
                before.anchor !== segment.anchor)
        )
            return { id: segment.anchor };
    }
    return null;
}

// A file's read, its parent resolved first, its owners kept or refused.
async function decode(
    context: Context,
    path: string,
    file: FileRead,
    ended: boolean,
    visiting: ReadonlySet<string>,
): Promise<{ file: PiFile; complete: boolean }> {
    const named = parentNamed(file.lines);
    const parent =
        named === null ? null : await ancestryOf(context, named, visiting);
    const orphan = named !== null && parent === null;
    let read = readPi(file.lines, { parent, ended });
    let complete = false;
    const fingerprint = file.fingerprint as FileFingerprint;
    if (read.ancestry !== null) {
        const kept = await loadPiSidecar(context.env, path);
        const conflict = kept === null ? null : moved(kept, read);
        if (conflict !== null) {
            read = {
                ...read,
                segments: [],
                pending: false,
                halt: {
                    line: lineOf(file.lines, conflict.id),
                    code: "ownership",
                },
            };
        } else {
            complete = read.halt === null && !torn(file.lines);
            if (
                kept === null ||
                kept.complete !== complete ||
                !sameFingerprint(kept.fingerprint, fingerprint)
            )
                await savePiSidecar(context.env, {
                    v: 1,
                    path,
                    fingerprint,
                    complete,
                    ancestry: read.ancestry,
                    segments: read.segments.map(
                        ({ session, parent, anchor }) => ({
                            session,
                            parent,
                            anchor,
                        }),
                    ),
                });
        }
    }
    return {
        file: {
            kind: "pi",
            read,
            lines: file.lines,
            orphan,
            fingerprint: file.fingerprint,
            stable: file.stable,
        },
        complete,
    };
}

async function fingerprintOf(path: string): Promise<FileFingerprint | null> {
    try {
        const found = await lstat(path, { bigint: true });
        return found.isFile() ? fileFingerprint(found) : null;
    } catch {
        return null;
    }
}

// The complete ancestry of the parent file a header names, or null.
async function ancestryOf(
    context: Context,
    named: string,
    visiting: ReadonlySet<string>,
): Promise<PiAncestry | null> {
    if (visiting.size > MAX_FORKS) return null;
    const found = await locate(context.roots, named);
    if (found.kind !== "found" || visiting.has(found.path)) return null;
    const now = await fingerprintOf(found.path);
    if (now === null) return null;
    const kept = await loadPiSidecar(context.env, found.path);
    if (kept?.complete && sameFingerprint(kept.fingerprint, now))
        return kept.ancestry;
    let file: FileRead | null;
    try {
        file = await readFileSession(found.path, undefined, PI_MAX_BYTES);
    } catch {
        // Too large, or a symlink put in its place: held, never followed.
        return null;
    }
    if (file === null) return null;
    const read = await decode(
        context,
        found.path,
        file,
        true,
        new Set([...visiting, found.path]),
    );
    return read.complete ? read.file.read.ancestry : null;
}

async function readAt(
    context: Context,
    path: string,
    ended: boolean,
    previous?: SourceRead["fingerprint"],
): Promise<PiFile | null> {
    const file = await readFileSession(path, previous, PI_MAX_BYTES);
    if (file === null) return null;
    return (await decode(context, path, file, ended, new Set([path]))).file;
}

export function piSource(env: Env): Source {
    return {
        host: "pi",
        list: async () => {
            const context = { env, roots: await rootsOf(env) };
            const root = context.roots.real;
            if (root === null) return [];
            return fileSessions(
                "pi",
                await sessionFiles(root),
                (path) => (previous, options) =>
                    readAt(context, path, options?.ended ?? false, previous),
            );
        },
    };
}

// The session file a Pi hook names, read as the sweep reads it; outside
// for any path not confined to the root, or a symlink.
export async function readPiSession(
    env: Env,
    path: string,
    { ended }: { ended: boolean },
): Promise<PiSessionFile> {
    const context = { env, roots: await rootsOf(env) };
    const found = await locate(context.roots, path);
    if (found.kind !== "found") return found;
    try {
        const file = await readAt(context, found.path, ended);
        return file === null ? { kind: "missing" } : { kind: "read", file };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ELOOP")
            return { kind: "outside" };
        throw error;
    }
}
