// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/models.ts
//
//

// The routes Dorothy's calls take, each role's default model on
// Anthropic until config.toml routes them, and the refusals this process
// has met: one record, shared by every call, so that a refusal one call
// meets is skipped by the next.

import {
    Cooldowns,
    defaultRoutes,
    type RouteEntry,
    type Routes,
} from "@dorothy/core";

export const ROUTES: Routes = defaultRoutes();

export const COOLDOWNS = new Cooldowns();

// The entry a chat starts on, which --dump-context shows.
export function chatEntry(): RouteEntry {
    const entry = ROUTES.chat[0];
    if (entry === undefined) {
        throw new Error("the chat route has no entry");
    }
    return entry;
}
