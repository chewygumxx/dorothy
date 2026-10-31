// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/hosts/hermes-root.ts
//
//

import { basename, dirname } from "node:path";

// Hermes's own root from a HERMES_HOME: `hermes -p <name>` sets it to
// <root>/profiles/<name>, and the root is what holds every profile.
export function hermesRoot(home: string): string {
    return basename(dirname(home)) === "profiles"
        ? dirname(dirname(home))
        : home;
}
