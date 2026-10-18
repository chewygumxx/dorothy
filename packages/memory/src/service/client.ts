// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/client.ts
//
//

import { join } from "node:path";
import { type Env, xdgDir } from "@dorothy/core";

export const deviceTokenPath = (env: Env) =>
    join(
        xdgDir(env, "XDG_STATE_HOME", ".local/state"),
        "dorothy",
        "device-token",
    );
