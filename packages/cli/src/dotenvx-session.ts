// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/dotenvx-session.ts
//
//

// Where dotenvx keeps its session, which holds Dorothy's private key when
// the key is in Dotenvx Armor: a directory of its own, `DOTENVX_CONFIG`,
// else `dotenvx` in the user's configuration directory. A `claude` started
// with another `XDG_CONFIG_HOME` loses the second, and its hooks' reviews
// their credentials. So the launch names the directory it finds in a
// variable of Dorothy's own, which the hook sets `DOTENVX_CONFIG` from. Only
// the directory's name travels; no key is read here.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Env } from "@dorothy/core";

export const SESSION_DIR = "DOROTHY_DOTENVX_CONFIG";

// The directory dotenvx looks in, as it computes it.
function configDir(env: Env): string {
    if (env.DOTENVX_CONFIG) {
        return env.DOTENVX_CONFIG;
    }
    const home = env.HOME || homedir();
    return process.platform === "darwin"
        ? join(home, "Library", "Preferences", "dotenvx")
        : join(env.XDG_CONFIG_HOME || join(home, ".config"), "dotenvx");
}

// The directory holding a session in env's view, or null for none.
export function findSession(env: Env): string | null {
    const dir = configDir(env);
    return existsSync(join(dir, ".env")) ? dir : null;
}

// target carries the directory env finds, or none: an outer launch's is
// not this one's.
export function passSession(target: Env, env: Env): Env {
    const dir = findSession(env);
    if (dir === null) {
        delete target[SESSION_DIR];
    } else {
        target[SESSION_DIR] = dir;
    }
    return target;
}

// Points dotenvx at the directory the launch passed on, where it did; else
// it looks where it would.
export function useSession(env: Env, given: Env): void {
    const dir = given[SESSION_DIR];
    if (dir !== undefined && dir !== "") {
        env.DOTENVX_CONFIG = dir;
    }
}
