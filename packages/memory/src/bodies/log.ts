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

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Env, xdgDir } from "@dorothy/core";

export const LOG_LIMIT = 1_000_000;

export const hookLogPath = (env: Env) =>
    join(xdgDir(env, "XDG_CACHE_HOME", ".cache"), "dorothy", "claude-hook.log");

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
                if (statSync(path).size > limit) {
                    renameSync(path, `${path}.1`);
                }
            } catch {
                // No log yet.
            }
            appendFileSync(
                path,
                `${now().toISOString()} ${level} ${process.pid} ${message.replaceAll(/\s*\n\s*/g, " ")}\n`,
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
