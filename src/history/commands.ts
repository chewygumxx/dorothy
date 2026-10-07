// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/commands.ts
//
//

import { resolve } from "node:path";
import { readConfig } from "../config.js";
import type { OpenHistory } from "../memory/sidecar.js";
import type { Env } from "../xdg.js";
import { type HookCommand, historyRoot, openHistory } from "./history.js";
import { MIRROR, NO_MIRROR } from "./repo.js";

export type Output = { write(text: string): unknown };

// How the pre-commit hook runs this Dorothy: the same bun, the same entry
// script.
export function entryHook(): HookCommand | null {
    const script = process.argv[1];
    return script === undefined
        ? null
        : { exec: process.execPath, script: resolve(script) };
}

// For memory's commands: history under the index's lock (or its own),
// swept before the command reads anything. Null when the config turns it
// off, or when it can't be used, which is said on err.
export function commandHistory({
    env = process.env,
    err = process.stderr,
    hook = entryHook(),
}: {
    env?: Env;
    err?: Output;
    hook?: HookCommand | null;
} = {}): OpenHistory {
    return async (index) => {
        const { config } = await readConfig(env);
        if (!config.history.enabled) {
            return null;
        }
        const warn = (message: string) => err.write(`dorothy: ${message}\n`);
        const opened = await openHistory({
            root: historyRoot(env),
            index,
            hook,
            warn,
        });
        if (!opened.ok) {
            warn(opened.reason);
            return null;
        }
        await opened.history.sweep();
        if ((await opened.history.repo.remote(MIRROR)) === null) {
            warn(NO_MIRROR);
        }
        return opened.history.handle(opened.close);
    };
}
