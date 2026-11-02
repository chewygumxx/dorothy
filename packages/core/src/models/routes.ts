// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/models/routes.ts
//
//

// Each role's default model on Anthropic's Messages API, one entry
// each: the routes when config.toml names none, and the API roots of
// the kinds whose root is fixed.

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
    approval: "claude-haiku-5-5",
};

// Written as ANTHROPIC_BASE_URL is, without /v1, which agent appends.
export const ANTHROPIC_API_ROOT = "https://api.anthropic.com";
export const ANTHROPIC_KEY = "ANTHROPIC_API_KEY";

// The kinds whose root no config may change: their API roots, as each
// provider documents them.
export const FIXED_ROOTS = {
    openrouter: "https://openrouter.ai/api/v1",
    featherless: "https://api.featherless.ai/v1",
    huggingface: "https://router.huggingface.co/v1",
} as const;

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
