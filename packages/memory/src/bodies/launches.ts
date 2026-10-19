// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/launches.ts
//
//

// The launches of dorothy --claude and their sessions, noted in
// Dorothy's state directory under launches/, apart from anything else
// there: launch.json, written once by the launch, and one file a
// session, written by its hooks, so no two processes rewrite one file.
// A launch's catch-up reads them and removes them when it is done. They
// outlive a reboot, so a launch notes the boot it was made in, and one
// of another boot is over whatever its pid. Notes an earlier Dorothy
// left in the runtime directory are read there, once more, and caught
// up; nothing is moved.

import {
    mkdir,
    readdir,
    readFile,
    rename,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { type Env, isUuid, xdgDir } from "@dorothy/core";
import { privateDir, stateDir, writePrivate } from "./state.js";

export type LaunchNote = {
    v: 1;
    launch: string;
    // dorothy's own process: the launch is over once it is gone.
    pid: number;
    started: string;
    // The directory claude started in.
    dir: string;
    // The session --session-id named; null when the arguments resumed one.
    session: string | null;
    // Claude Code's config directory, under whose projects/ its
    // transcripts are.
    claude: string;
    // The boot it was made in, where the system gives one; a pid means
    // nothing in another boot. Notes from the runtime directory have none.
    boot?: string;
};
export type SessionNote = {
    v: 1;
    session: string;
    transcript: string;
    cwd: string;
    seen: string;
    // Noted by its SessionEnd: the session is over, live no longer.
    ended?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function isLaunchNote(value: unknown): value is LaunchNote {
    return (
        isRecord(value) &&
        value.v === 1 &&
        typeof value.launch === "string" &&
        Number.isInteger(value.pid) &&
        typeof value.started === "string" &&
        typeof value.dir === "string" &&
        (value.session === null || typeof value.session === "string") &&
        typeof value.claude === "string" &&
        (value.boot === undefined || typeof value.boot === "string")
    );
}

function isSessionNote(value: unknown): value is SessionNote {
    return (
        isRecord(value) &&
        value.v === 1 &&
        typeof value.session === "string" &&
        typeof value.transcript === "string" &&
        typeof value.cwd === "string" &&
        typeof value.seen === "string" &&
        (value.ended === undefined || typeof value.ended === "boolean")
    );
}

export const BOOT_ID = "/proc/sys/kernel/random/boot_id";

// The id of this boot, where Linux gives one; null elsewhere.
export async function readBootId(path = BOOT_ID): Promise<string | null> {
    try {
        const id = (await readFile(path, "utf8")).trim();
        return id === "" ? null : id;
    } catch {
        return null;
    }
}

// Where notes are kept now, and where an earlier Dorothy kept them:
// $XDG_RUNTIME_DIR/dorothy, or the cache directory's without one.
export const launchesDir = (env: Env) => join(stateDir(env), "launches");
export function legacyLaunchesDir(env: Env): string {
    const runtime = env.XDG_RUNTIME_DIR ?? "";
    return join(
        isAbsolute(runtime) ? runtime : xdgDir(env, "XDG_CACHE_HOME", ".cache"),
        "dorothy",
        "launches",
    );
}

const exists = (path: string) =>
    stat(path).then(
        () => true,
        () => false,
    );

// A launch's directory: the state directory's, else a left-over one in
// the runtime directory's, else where it would be made.
async function launchDir(env: Env, launch: string): Promise<string> {
    if (!isUuid(launch)) {
        throw new Error(`not a launch id: ${launch}`);
    }
    const now = join(launchesDir(env), launch);
    const before = join(legacyLaunchesDir(env), launch);
    return !(await exists(now)) && (await exists(before)) ? before : now;
}

async function names(dir: string): Promise<string[]> {
    try {
        return await readdir(dir);
    } catch {
        return [];
    }
}

// The ids of the launches noted, in either directory.
async function launchIds(env: Env): Promise<string[]> {
    const ids = new Set<string>();
    for (const dir of [launchesDir(env), legacyLaunchesDir(env)]) {
        for (const name of await names(dir)) {
            if (isUuid(name)) {
                ids.add(name);
            }
        }
    }
    return [...ids].sort();
}

async function readJson(path: string): Promise<unknown> {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    } catch {
        return null;
    }
}

const TEMPORARY = /^\.[0-9a-f-]{36}\.tmp$/;
// A launch is made whole in a moment: older than this, a temporary
// directory is what a crash left.
const TEMPORARY_AGE_MS = 60_000;

async function reapTemporaries(env: Env, now: number): Promise<void> {
    for (const name of await names(launchesDir(env))) {
        const path = join(launchesDir(env), name);
        if (!TEMPORARY.test(name)) {
            continue;
        }
        const age = await stat(path).then(
            (info) => now - info.mtimeMs,
            () => 0,
        );
        if (age > TEMPORARY_AGE_MS) {
            await rm(path, { recursive: true, force: true });
        }
    }
}

// Made whole beside, then renamed into place: a launch is never seen
// without its launch.json, which a stale scan would take for a dead one.
export async function noteLaunch(
    env: Env,
    note: Omit<LaunchNote, "v" | "boot">,
    { boot = readBootId, now = Date.now }: NoteOptions = {},
): Promise<void> {
    if (!isUuid(note.launch)) {
        throw new Error(`not a launch id: ${note.launch}`);
    }
    const making = join(launchesDir(env), `.${note.launch}.tmp`);
    await privateDir(launchesDir(env));
    await reapTemporaries(env, now());
    await mkdir(join(making, "sessions"), { recursive: true, mode: 0o700 });
    const id = await boot();
    await writeFile(
        join(making, "launch.json"),
        `${JSON.stringify({ v: 1, ...note, ...(id === null ? {} : { boot: id }) })}\n`,
        { mode: 0o600 },
    );
    await rename(making, join(launchesDir(env), note.launch));
}

export type NoteOptions = {
    // This boot's id.
    boot?: () => Promise<string | null>;
    now?: () => number;
};

// A note is its launch's only if it says so: a note under another
// name, or moved there, is none.
export async function readLaunch(
    env: Env,
    launch: string,
): Promise<LaunchNote | null> {
    if (!isUuid(launch)) {
        return null;
    }
    const note = await readJson(
        join(await launchDir(env, launch), "launch.json"),
    );
    return isLaunchNote(note) && note.launch === launch ? note : null;
}

// Only into a launch that is still there: one a catch-up removed is not
// made again, which a stale scan would take for another to catch up.
export async function noteSession(
    env: Env,
    launch: string,
    note: Omit<SessionNote, "v">,
): Promise<void> {
    if (!isUuid(note.session)) {
        throw new Error(`not a session id: ${note.session}`);
    }
    await writePrivate(
        join(await launchDir(env, launch), "sessions", `${note.session}.json`),
        `${JSON.stringify({ v: 1, ...note })}\n`,
    );
}

// The launch's sessions, the one noted last at the end. A note is its
// file's session's only if it says so.
export async function launchSessions(
    env: Env,
    launch: string,
): Promise<SessionNote[]> {
    const dir = join(await launchDir(env, launch), "sessions");
    const notes: SessionNote[] = [];
    for (const name of await names(dir)) {
        const note = await readJson(join(dir, name));
        if (
            isSessionNote(note) &&
            isUuid(note.session) &&
            name === `${note.session}.json`
        ) {
            notes.push(note);
        }
    }
    return notes.sort((a, b) => a.seen.localeCompare(b.seen));
}

// The session live in a launch: the one a hook noted last, unless that
// session has ended; else the one --session-id named. Null for a launch
// it cannot read, and between a session's end and the next one's hook.
export async function liveSession(
    env: Env,
    launch: string,
): Promise<string | null> {
    if (!isUuid(launch)) {
        return null;
    }
    const noted = (await launchSessions(env, launch)).at(-1);
    if (noted !== undefined) {
        return noted.ended === true ? null : noted.session;
    }
    return (await readLaunch(env, launch))?.session ?? null;
}

const pidAlive = (pid: number) => {
    // 0 and below name a process group or every process, which exist.
    if (pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as { code?: unknown }).code === "EPERM";
    }
};

export type Liveness = {
    alive?: (pid: number) => boolean;
    // This boot's id.
    boot?: () => Promise<string | null>;
};

// Whether a launch is over: its note cannot be read, it was made in
// another boot, or its dorothy is gone.
async function isOver(
    env: Env,
    launch: string,
    boot: string | null,
    alive: (pid: number) => boolean,
): Promise<boolean> {
    const note = await readLaunch(env, launch);
    if (note === null) {
        return true;
    }
    if (note.boot !== undefined && boot !== null && note.boot !== boot) {
        return true;
    }
    return !alive(note.pid);
}

// Whether a launch's notes still hold the session: noted by a hook and
// not ended, or named by --session-id and not yet noted, in a launch
// not over. A session none holds is over.
export async function launchHolds(
    env: Env,
    session: string,
    { alive = pidAlive, boot = readBootId }: Liveness = {},
): Promise<boolean> {
    const id = await boot();
    for (const launch of await launchIds(env)) {
        if (await isOver(env, launch, id, alive)) {
            continue;
        }
        const noted = (await launchSessions(env, launch)).find(
            (note) => note.session === session,
        );
        if (
            noted !== undefined
                ? noted.ended !== true
                : (await readLaunch(env, launch))?.session === session
        ) {
            return true;
        }
    }
    return false;
}

// Launches that are over, left for a catch-up.
export async function staleLaunches(
    env: Env,
    { alive = pidAlive, boot = readBootId }: Liveness = {},
): Promise<string[]> {
    const id = await boot();
    const stale: string[] = [];
    for (const launch of await launchIds(env)) {
        if (await isOver(env, launch, id, alive)) {
            stale.push(launch);
        }
    }
    return stale;
}

export async function removeLaunch(env: Env, launch: string): Promise<void> {
    if (!isUuid(launch)) {
        throw new Error(`not a launch id: ${launch}`);
    }
    for (const dir of [launchesDir(env), legacyLaunchesDir(env)]) {
        await rm(join(dir, launch), { recursive: true, force: true });
    }
}
