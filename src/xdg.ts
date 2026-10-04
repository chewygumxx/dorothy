// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/xdg.ts
//
//

import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export type Env = Record<string, string | undefined>;

// XDG treats an empty or relative base directory as unset. An empty HOME
// would otherwise put files under the working directory.
export function xdgDir(
    env: Env,
    variable: "XDG_DATA_HOME" | "XDG_CONFIG_HOME",
    fallback: string,
): string {
    const xdg = env[variable] ?? "";
    return isAbsolute(xdg) ? xdg : join(env.HOME || homedir(), fallback);
}
