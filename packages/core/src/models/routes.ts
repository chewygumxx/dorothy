// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/models/routes.ts
//
//

// Part A's routes: each role's default model on Anthropic's Messages
// API, one entry each, until config.toml routes them.

import {
    ROLES,
    type Role,
    type RouteEntry,
    type Routes,
} from "../contracts/model.js";

export const DEFAULT_MODELS: Readonly<Record<Role, string>> = {
    chat: "claude-opus-5-5",
    review: "claude-sonnet-5-5",
    compaction: "claude-sonnet-5-5",
    maintenance: "claude-haiku-5-5",
};

// Written as ANTHROPIC_BASE_URL is, without /v1, which agent appends.
export const ANTHROPIC_API_ROOT = "https://api.anthropic.com";
export const ANTHROPIC_KEY = "ANTHROPIC_API_KEY";

export function anthropicEntry(model: string): RouteEntry {
    return {
        provider: "anthropic",
        kind: "anthropic",
        model,
        baseUrl: ANTHROPIC_API_ROOT,
        key: ANTHROPIC_KEY,
        price: null,
    };
}

export function defaultRoutes(): Routes {
    return Object.fromEntries(
        ROLES.map((role) => [role, [anthropicEntry(DEFAULT_MODELS[role])]]),
    ) as Routes;
}
