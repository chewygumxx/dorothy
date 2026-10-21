// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/sops-key.ts
//
//

import { statSync } from "node:fs";
import { join } from "node:path";
import { type Env, xdgDir } from "@dorothy/core";

// Pin the key's path before Claude Code can change XDG_CONFIG_HOME.
// Explicit choices stand even if unavailable; only default paths are probed.
// No key contents are read or copied.
export function passSopsKey(target: Env, env: Env): Env {
    if (target.SOPS_AGE_KEY_FILE) return target;
    if (env.SOPS_AGE_KEY_FILE) {
        target.SOPS_AGE_KEY_FILE = env.SOPS_AGE_KEY_FILE;
        return target;
    }
    const path = join(
        xdgDir(env, "XDG_CONFIG_HOME", ".config"),
        "sops",
        "age",
        "keys.txt",
    );
    try {
        if (statSync(path).isFile()) target.SOPS_AGE_KEY_FILE = path;
    } catch {
        // No accessible default key; let sops report its coded failure later.
    }
    return target;
}
