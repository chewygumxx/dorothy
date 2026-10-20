// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/log.ts
//
//

// The hook's log. Claude Code owns the terminal, so what a hook would
// say goes here: types, uuids, paths and errors, never a transcript's
// text. Rotated past a megabyte to one .1 file. A log that cannot be
// written says nothing: the hook must still exit 0.

import {
    appendFileSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Env, xdgDir } from "@dorothy/core";

export const LOG_LIMIT = 1_000_000;

export const hookLogPath = (env: Env) =>
    join(xdgDir(env, "XDG_CACHE_HOME", ".cache"), "dorothy", "claude-hook.log");

const sizeOf = (path: string) => {
    try {
        return statSync(path).size;
    } catch {
        return 0;
    }
};

// Moves the log aside as .1 when it is over its limit. seen is the size
// the caller saw: between its look and the move, another hook may have
// rotated, and what is moved is then a fresh log, which goes back whole
// rather than over the .1 that holds the old.
export function rotate(path: string, limit: number, seen = sizeOf(path)): void {
    if (seen <= limit) {
        return;
    }
    const aside = `${path}.${process.pid}.rotating`;
    renameSync(path, aside);
    if (sizeOf(aside) > limit) {
        renameSync(aside, `${path}.1`);
    } else {
        appendFileSync(path, readFileSync(aside), { mode: 0o600 });
        rmSync(aside, { force: true });
    }
}

// One line however it is worded: every line break JavaScript knows,
// which a multiline pattern would take for the start of another line.
export const oneLine = (message: string) =>
    message.replaceAll(/\s*[\n\r\u2028\u2029]\s*/g, " ");

export type HookLog = {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
};

export function hookLog(
    env: Env,
    {
        now = () => new Date(),
        limit = LOG_LIMIT,
    }: { now?: () => Date; limit?: number } = {},
): HookLog {
    const path = hookLogPath(env);
    const write = (level: string, message: string) => {
        try {
            mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
            try {
                rotate(path, limit);
            } catch {
                // No log yet, or one moved away meanwhile.
            }
            appendFileSync(
                path,
                `${now().toISOString()} ${level} ${process.pid} ${oneLine(message)}\n`,
                { mode: 0o600 },
            );
        } catch {
            // Unwritable: said nowhere.
        }
    };
    return {
        info: (message) => write("info", message),
        warn: (message) => write("warn", message),
        error: (message) => write("error", message),
    };
}

// Whether the current log holds an error, for dorothy --check.
export async function logHasErrors(env: Env): Promise<boolean> {
    try {
        const text = await readFile(hookLogPath(env), "utf8");
        return /^\S+ error /m.test(text);
    } catch {
        return false;
    }
}
