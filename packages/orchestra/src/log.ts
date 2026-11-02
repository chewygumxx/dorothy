// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/log.ts
//
//

// The server's log, its durable trace: one JSON object a line, appended
// by the operations, the gate and the server, each entry its writer's
// own. Never a key or a body: writers log what was decided and why.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Env, xdgDir } from "@dorothy/core";

export type Log = (entry: Record<string, unknown>) => void;

export const logPath = (env: Env, server: string) =>
    join(
        xdgDir(env, "XDG_STATE_HOME", ".local/state"),
        "dorothy",
        "orchestra",
        `${server}.jsonl`,
    );

// Appended whole, in order, as each entry comes.
export function openLog(path: string): Log {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    return (entry) =>
        appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}
