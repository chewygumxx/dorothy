// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/hosts/pi-root.ts
//
//

import { join } from "node:path";
import { type Env, xdgDir } from "@dorothy/core";

// Where `dorothy --pi` keeps Pi's sessions, by the XDG defaults the CLI's
// launcher uses: the one root the Pi source reads and its hooks may name.
export const piSessionRoot = (env: Env): string =>
    join(
        xdgDir(env, "XDG_DATA_HOME", ".local/share"),
        "dorothy",
        "pi",
        "sessions",
    );
