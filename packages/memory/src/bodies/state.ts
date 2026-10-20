// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/state.ts
//
//

// Dorothy's state directory, $XDG_STATE_HOME/dorothy, where what the
// bodies keep for later lives: the launch notes, the lines left unread
// and the notices. The user's alone, written whole or not at all.

import { randomBytes } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Env, xdgDir } from "@dorothy/core";

export const stateDir = (env: Env) =>
    join(xdgDir(env, "XDG_STATE_HOME", ".local/state"), "dorothy");

// A name beside path for a file made whole before it is renamed: the
// process and a random suffix, as two writes of one process, or two
// processes, never share one.
export const beside = (path: string, what: string) =>
    `${path}.${process.pid}.${randomBytes(4).toString("hex")}.${what}`;

export async function privateDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
}

export async function writePrivate(path: string, text: string): Promise<void> {
    const making = beside(path, "tmp");
    await writeFile(making, text, { mode: 0o600 });
    await rename(making, path);
}
