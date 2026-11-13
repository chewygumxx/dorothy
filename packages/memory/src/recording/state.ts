// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/memory/src/recording/state.ts
//
//

// The sweep's private state: `sweep.json`'s skip hints, and each Pi
// file's ancestry sidecar. Neither is evidence of what the archive holds.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { Env } from "@dorothy/core";
import { privateDir, stateDir, writePrivate } from "../bodies/state.js";
import type { PiAncestry } from "./pi.js";
import type {
    FileFingerprint,
    Fingerprint,
    Host,
    SourceRead,
} from "./sources.js";

export type SweepState = {
    v: 1;
    sessions: Record<string, Fingerprint>;
};
export function emptySweepState(): SweepState {
    return {
        v: 1,
        sessions: Object.create(null),
    };
}
export function sweepPath(env: Env): string {
    if (!isAbsolute(env.XDG_STATE_HOME ?? "") && !isAbsolute(env.HOME ?? ""))
        throw new RangeError("missing recording state root");
    return join(stateDir(env), "sweep.json");
}
type Json = Record<string, unknown>;
const object = (value: unknown): value is Json =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value: Json, keys: string[]) =>
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
const natural = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function fingerprint(value: unknown): value is Fingerprint {
    if (!object(value)) return false;
    if (value.kind === "rows")
        return (
            exact(value, ["kind", "maxId", "count"]) &&
            natural(value.maxId) &&
            natural(value.count)
        );
    return (
        value.kind === "file" &&
        exact(value, ["kind", "size", "mtime", "inode", "device"]) &&
        natural(value.size) &&
        typeof value.mtime === "string" &&
        /^-?\d+$/.test(value.mtime) &&
        typeof value.inode === "string" &&
        /^\d+$/.test(value.inode) &&
        typeof value.device === "string" &&
        /^\d+$/.test(value.device)
    );
}
function normalize(value: unknown): SweepState | null {
    if (
        !object(value) ||
        !exact(value, ["v", "sessions"]) ||
        value.v !== 1 ||
        !object(value.sessions)
    )
        return null;
    const state = emptySweepState();
    for (const [key, stamp] of Object.entries(value.sessions)) {
        if (!key || !fingerprint(stamp)) return null;
        Object.defineProperty(state.sessions, key, {
            value: { ...stamp },
            enumerable: true,
            writable: true,
            configurable: true,
        });
    }
    return state;
}
export async function loadSweepState(
    env: Env,
    warn: (message: string) => void,
): Promise<SweepState> {
    const path = sweepPath(env);
    try {
        const state = normalize(JSON.parse(await readFile(path, "utf8")));
        if (state !== null) return state;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            // A first run, or a state lost: nothing to say.
            return emptySweepState();
        }
    }
    // Never include parser or filesystem errors: they can quote contents.
    warn("recording: sweep state unreadable or invalid; starting fresh");
    return emptySweepState();
}
export async function saveSweepState(
    env: Env,
    state: SweepState,
): Promise<void> {
    const checked = normalize(state);
    if (checked === null) throw new RangeError("invalid sweep state");
    const path = sweepPath(env);
    await privateDir(dirname(path));
    await writePrivate(path, `${JSON.stringify(checked)}\n`);
}
// Call only after the archive accepted this read (and unread diagnostics
// were saved). Fingerprints are skip hints, never evidence of ownership.
export function rememberRead(
    state: SweepState,
    key: string,
    read: Pick<SourceRead, "stable" | "fingerprint">,
): boolean {
    if (read.stable !== true) return false;
    if (!key || !fingerprint(read.fingerprint))
        throw new RangeError("invalid sweep observation");
    Object.defineProperty(state.sessions, key, {
        value: { ...read.fingerprint },
        enumerable: true,
        writable: true,
        configurable: true,
    });
    return true;
}
// Drops the hints of a host's sessions its listing no longer names, so the
// file does not grow with every session a host has ever held.
export function forgetMissing(
    state: SweepState,
    host: Host,
    listed: ReadonlySet<string>,
): void {
    for (const key of Object.keys(state.sessions)) {
        let owner: unknown;
        try {
            owner = (JSON.parse(key) as unknown[])[0];
        } catch {
            continue;
        }
        if (owner === host && !listed.has(key)) delete state.sessions[key];
    }
}

// What a Pi file's last read found of its graph, keyed by the file's
// canonical path: each entry's segment and origin and each segment's
// anchor, never speech. `complete` when the read held no halt, torn tail
// or unresolved parent, so a fork may inherit from it unchanged.
export type PiSidecar = {
    v: 1;
    path: string;
    fingerprint: FileFingerprint;
    complete: boolean;
    ancestry: PiAncestry;
    segments: {
        session: string;
        parent: string | null;
        anchor: string | null;
    }[];
};
export function piSidecarPath(env: Env, path: string): string {
    if (!isAbsolute(env.XDG_STATE_HOME ?? "") && !isAbsolute(env.HOME ?? ""))
        throw new RangeError("missing recording state root");
    const name = createHash("sha256").update(path).digest("hex");
    return join(stateDir(env), "pi", "recording", `${name}.json`);
}
const nullable = (value: unknown) =>
    value === null || typeof value === "string";
function piSidecar(value: unknown, path: string): value is PiSidecar {
    if (
        !object(value) ||
        !exact(value, [
            "v",
            "path",
            "fingerprint",
            "complete",
            "ancestry",
            "segments",
        ]) ||
        value.v !== 1 ||
        value.path !== path ||
        !fingerprint(value.fingerprint) ||
        value.fingerprint.kind !== "file" ||
        typeof value.complete !== "boolean" ||
        !object(value.ancestry) ||
        !exact(value.ancestry, ["nativeSession", "entries"]) ||
        typeof value.ancestry.nativeSession !== "string" ||
        !object(value.ancestry.entries) ||
        !Array.isArray(value.segments)
    )
        return false;
    return (
        Object.values(value.ancestry.entries).every(
            (entry) =>
                object(entry) &&
                exact(entry, [
                    "owner",
                    "origin",
                    "parentId",
                    "payloadDigest",
                ]) &&
                typeof entry.owner === "string" &&
                typeof entry.origin === "string" &&
                nullable(entry.parentId) &&
                typeof entry.payloadDigest === "string",
        ) &&
        value.segments.every(
            (segment: unknown) =>
                object(segment) &&
                exact(segment, ["session", "parent", "anchor"]) &&
                typeof segment.session === "string" &&
                nullable(segment.parent) &&
                nullable(segment.anchor),
        )
    );
}
// The file's sidecar, or null when there is none or it cannot be trusted:
// the source then recomputes it from the file.
export async function loadPiSidecar(
    env: Env,
    path: string,
): Promise<PiSidecar | null> {
    try {
        const value: unknown = JSON.parse(
            await readFile(piSidecarPath(env, path), "utf8"),
        );
        if (!piSidecar(value, path)) return null;
        // Entry ids are data: none may reach a prototype.
        const entries: PiAncestry["entries"] = Object.create(null);
        for (const [id, entry] of Object.entries(value.ancestry.entries))
            Object.defineProperty(entries, id, {
                value: { ...entry },
                enumerable: true,
                writable: true,
                configurable: true,
            });
        return { ...value, ancestry: { ...value.ancestry, entries } };
    } catch {
        return null;
    }
}
export async function savePiSidecar(
    env: Env,
    sidecar: PiSidecar,
): Promise<void> {
    if (!piSidecar(sidecar, sidecar.path))
        throw new RangeError("invalid Pi sidecar");
    const path = piSidecarPath(env, sidecar.path);
    await privateDir(dirname(path));
    await writePrivate(path, `${JSON.stringify(sidecar)}\n`);
}
