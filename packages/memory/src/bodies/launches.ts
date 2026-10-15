// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/launches.ts
//
//

// The launches of dorothy --claude and their sessions, noted in
// Dorothy's runtime directory under launches/, apart from anything else
// there: launch.json, written once by the launch, and one file a
// session, written by its hooks, so no two processes rewrite one file.
// A launch's catch-up reads them and removes them when it is done.

import {
    chmod,
    mkdir,
    readdir,
    readFile,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { type Env, isUuid, xdgDir } from "@dorothy/core";

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
        typeof value.claude === "string"
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

// $XDG_RUNTIME_DIR/dorothy, or the cache directory's without one.
export function runtimeDir(env: Env): string {
    const runtime = env.XDG_RUNTIME_DIR ?? "";
    return isAbsolute(runtime)
        ? join(runtime, "dorothy")
        : join(xdgDir(env, "XDG_CACHE_HOME", ".cache"), "dorothy");
}

export const launchesDir = (env: Env) => join(runtimeDir(env), "launches");

function launchDir(env: Env, launch: string): string {
    if (!isUuid(launch)) {
        throw new Error(`not a launch id: ${launch}`);
    }
    return join(launchesDir(env), launch);
}

async function readJson(path: string): Promise<unknown> {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    } catch {
        return null;
    }
}

// Made whole beside, then renamed into place: a launch is never seen
// without its launch.json, which a stale scan would take for a dead one.
export async function noteLaunch(
    env: Env,
    note: Omit<LaunchNote, "v">,
): Promise<void> {
    const dir = launchDir(env, note.launch);
    const making = join(launchesDir(env), `.${note.launch}.tmp`);
    await mkdir(join(making, "sessions"), { recursive: true, mode: 0o700 });
    await chmod(launchesDir(env), 0o700);
    await writeFile(
        join(making, "launch.json"),
        `${JSON.stringify({ v: 1, ...note })}\n`,
        {
            mode: 0o600,
        },
    );
    await rename(making, dir);
}

export async function readLaunch(
    env: Env,
    launch: string,
): Promise<LaunchNote | null> {
    if (!isUuid(launch)) {
        return null;
    }
    const note = await readJson(join(launchDir(env, launch), "launch.json"));
    return isLaunchNote(note) ? note : null;
}

export async function noteSession(
    env: Env,
    launch: string,
    note: Omit<SessionNote, "v">,
): Promise<void> {
    if (!isUuid(note.session)) {
        throw new Error(`not a session id: ${note.session}`);
    }
    const dir = join(launchDir(env, launch), "sessions");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${note.session}.json`);
    const making = `${path}.${process.pid}.tmp`;
    await writeFile(making, `${JSON.stringify({ v: 1, ...note })}\n`, {
        mode: 0o600,
    });
    await rename(making, path);
}

// The launch's sessions, the one noted last at the end.
export async function launchSessions(
    env: Env,
    launch: string,
): Promise<SessionNote[]> {
    const dir = join(launchDir(env, launch), "sessions");
    let names: string[];
    try {
        names = await readdir(dir);
    } catch {
        return [];
    }
    const notes: SessionNote[] = [];
    for (const name of names.filter((name) => name.endsWith(".json"))) {
        const note = await readJson(join(dir, name));
        if (isSessionNote(note)) {
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
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as { code?: unknown }).code === "EPERM";
    }
};

// Launches whose dorothy is gone, and those whose note cannot be read,
// left for a catch-up.
export async function staleLaunches(
    env: Env,
    alive: (pid: number) => boolean = pidAlive,
): Promise<string[]> {
    let names: string[];
    try {
        names = await readdir(launchesDir(env));
    } catch {
        return [];
    }
    const stale: string[] = [];
    for (const name of names.filter(isUuid).sort()) {
        const note = await readLaunch(env, name);
        if (note === null || !alive(note.pid)) {
            stale.push(name);
        }
    }
    return stale;
}

export async function removeLaunch(env: Env, launch: string): Promise<void> {
    await rm(launchDir(env, launch), { recursive: true, force: true });
}
