// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/sources.ts
//
//

import { Database } from "bun:sqlite";
import { type BigIntStats, constants } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Env } from "@dorothy/core";
import { type HermesRead, readHermes } from "./hermes.js";

export type Host = "claude-code" | "codex" | "hermes";
export type FileFingerprint = {
    kind: "file";
    size: number;
    mtime: string;
    inode: string;
    device: string;
};
export type RowsFingerprint = { kind: "rows"; maxId: number; count: number };
export type Fingerprint = FileFingerprint | RowsFingerprint;
export type SourceRead = {
    fingerprint: Fingerprint;
    stable: boolean;
} & (
    | { kind: "file"; lines: string[]; lineOffset: 0 }
    | { kind: "hermes"; read: HermesRead }
);
// The session is over: a call never answered is recorded failed.
export type ReadOptions = { ended?: boolean };
export type SourceSession = {
    host: Host;
    key: string;
    path: string;
    session?: string;
    fingerprint: Fingerprint;
    at: string | null;
    read(
        previous?: Fingerprint,
        options?: ReadOptions,
    ): Promise<SourceRead | null>;
};
export type Source = { host: Host; list(): Promise<SourceSession[]> };

export function sameFingerprint(
    a: Fingerprint | undefined,
    b: Fingerprint,
): boolean {
    if (a === undefined || a.kind !== b.kind) return false;
    if (a.kind === "rows" && b.kind === "rows")
        return a.maxId === b.maxId && a.count === b.count;
    if (a.kind === "file" && b.kind === "file")
        return (
            a.size === b.size &&
            a.mtime === b.mtime &&
            a.inode === b.inode &&
            a.device === b.device
        );
    return false;
}
function absolute(path: string): string {
    if (!isAbsolute(path)) throw new RangeError("invalid recording root");
    return path;
}
function hostRoot(env: Env, key: string, fallback: string): string {
    if (env[key]) return absolute(env[key]);
    if (!env.HOME) throw new RangeError("missing recording root");
    return join(absolute(env.HOME), fallback);
}
const vanished = (error: unknown) =>
    (error as NodeJS.ErrnoException).code === "ENOENT";
// An entry removed between a listing and its use is skipped, never the
// host: its session is either gone or listed again next sweep.
async function existing(path: string): Promise<string | null> {
    try {
        return await realpath(path);
    } catch (error) {
        if (vanished(error)) return null;
        throw error;
    }
}
async function entries(path: string) {
    try {
        return await readdir(path, { withFileTypes: true });
    } catch (error) {
        if (vanished(error)) return [];
        throw error;
    }
}
function fileFingerprint(found: BigIntStats): FileFingerprint {
    if (found.size > BigInt(Number.MAX_SAFE_INTEGER))
        throw new RangeError("recording file is too large");
    return {
        kind: "file",
        size: Number(found.size),
        mtime: String(found.mtimeNs),
        inode: String(found.ino),
        device: String(found.dev),
    };
}
async function readFileSession(
    path: string,
    previous?: Fingerprint,
): Promise<SourceRead | null> {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
        if (vanished(error)) return null;
        throw error;
    }
    try {
        const before = fileFingerprint(await handle.stat({ bigint: true }));
        if (sameFingerprint(previous, before)) return null;
        const bytes = await handle.readFile();
        const after = fileFingerprint(await handle.stat({ bigint: true }));
        const lines =
            bytes.length === 0 ? [] : bytes.toString("utf8").split("\n");
        if (bytes.at(-1) === 10) lines.pop();
        return {
            kind: "file",
            fingerprint: before,
            lines,
            lineOffset: 0,
            stable:
                sameFingerprint(before, after) &&
                bytes.length === after.size &&
                (bytes.length === 0 || bytes.at(-1) === 10),
        };
    } finally {
        await handle.close();
    }
}
export async function fileSessions(
    host: "claude-code" | "codex",
    paths: string[],
): Promise<SourceSession[]> {
    const result: SourceSession[] = [];
    for (const path of paths.sort()) {
        const found = await stat(path, { bigint: true }).catch(
            (error: unknown) => {
                if (vanished(error)) return null;
                throw error;
            },
        );
        if (found === null || !found.isFile()) continue;
        result.push({
            host,
            key: JSON.stringify([host, path]),
            path,
            fingerprint: fileFingerprint(found),
            at: new Date(Number(found.mtimeMs)).toISOString(),
            read: (previous) => readFileSession(path, previous),
        });
    }
    return result;
}
async function rollouts(root: string): Promise<string[]> {
    const paths: string[] = [];
    for (const entry of await entries(root)) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) paths.push(...(await rollouts(path)));
        else if (
            entry.isFile() &&
            entry.name.startsWith("rollout-") &&
            entry.name.endsWith(".jsonl")
        )
            paths.push(path);
    }
    return paths;
}
export function claudeSource(env: Env, dirs: readonly string[] = []): Source {
    return {
        host: "claude-code",
        list: async () => {
            const roots = [
                hostRoot(env, "CLAUDE_CONFIG_DIR", ".claude"),
                ...dirs.map(absolute),
            ];
            const projects = new Set<string>();
            for (const root of roots) {
                const found = await existing(join(root, "projects"));
                if (found !== null) projects.add(found);
            }
            const paths: string[] = [];
            for (const root of projects)
                for (const project of await entries(root)) {
                    if (!project.isDirectory()) continue;
                    const dir = join(root, project.name);
                    for (const entry of await entries(dir))
                        if (
                            entry.isFile() &&
                            entry.name.endsWith(".jsonl") &&
                            !entry.name.startsWith("agent-")
                        )
                            paths.push(join(dir, entry.name));
                }
            return fileSessions("claude-code", paths);
        },
    };
}
export function codexSource(env: Env): Source {
    return {
        host: "codex",
        list: async () => {
            const root = await existing(
                join(hostRoot(env, "CODEX_HOME", ".codex"), "sessions"),
            );
            return root === null
                ? []
                : fileSessions("codex", await rollouts(root));
        },
    };
}
type Summary = { id: string; maxId: number; count: number; at: number | null };
function rowSummaries(path: string, session: string | null = null): Summary[] {
    const db = new Database(path, { readonly: true, create: false });
    try {
        const rows = db
            .query<Summary, [string | null, string | null]>(
                `SELECT s.id, COALESCE(MAX(m.id), 0) AS maxId, COUNT(m.id) AS count,
                    COALESCE(MAX(m.timestamp), s.started_at) AS at
             FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
             WHERE (? IS NULL OR s.id = ?) GROUP BY s.id ORDER BY s.id`,
            )
            .all(session, session);
        for (const row of rows)
            if (
                typeof row.id !== "string" ||
                !Number.isSafeInteger(row.maxId) ||
                row.maxId < 0 ||
                !Number.isSafeInteger(row.count) ||
                row.count < 0
            )
                throw new Error("invalid Hermes session summary");
        return rows;
    } finally {
        db.close();
    }
}
function rowsFingerprint(summary: Summary): RowsFingerprint {
    return { kind: "rows", maxId: summary.maxId, count: summary.count };
}
function summaryTime(value: unknown): string | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const date = new Date(value * 1000);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
async function readHermesSession(
    path: string,
    session: string,
    previous?: Fingerprint,
    { ended = false }: ReadOptions = {},
): Promise<SourceRead | null> {
    const before = rowSummaries(path, session)[0];
    if (!before) return null;
    const fingerprint = rowsFingerprint(before);
    if (sameFingerprint(previous, fingerprint)) return null;
    // A physical max is a change hint, never the reader's source-id floor.
    const read = readHermes(path, 0, session, { ended })[0];
    if (!read) return null;
    const after = rowSummaries(path, session)[0];
    return {
        kind: "hermes",
        read,
        fingerprint,
        stable:
            after !== undefined &&
            sameFingerprint(fingerprint, rowsFingerprint(after)),
    };
}
// The default profile's database, then each named profile's, in name order.
async function hermesDatabases(home: string): Promise<string[]> {
    const profiles = (await entries(join(home, "profiles")))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    return [
        join(home, "state.db"),
        ...profiles.map((name) => join(home, "profiles", name, "state.db")),
    ];
}
export function hermesSource(env: Env): Source {
    return {
        host: "hermes",
        list: async () => {
            const home = hostRoot(env, "HERMES_HOME", ".hermes");
            const found: SourceSession[] = [];
            for (const candidate of await hermesDatabases(home)) {
                const path = await existing(candidate);
                if (path === null) continue;
                found.push(
                    ...rowSummaries(path).map((row) => ({
                        host: "hermes" as const,
                        path,
                        key: JSON.stringify(["hermes", path, row.id]),
                        session: row.id,
                        fingerprint: rowsFingerprint(row),
                        at: summaryTime(row.at),
                        read: (previous?: Fingerprint, options?: ReadOptions) =>
                            readHermesSession(path, row.id, previous, options),
                    })),
                );
            }
            return found;
        },
    };
}
