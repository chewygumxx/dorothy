// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/state.ts
//
//

import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { Env } from "@dorothy/core";
import { privateDir, stateDir, writePrivate } from "../bodies/state.js";
import type { Fingerprint, Host, SourceRead } from "./sources.js";

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
