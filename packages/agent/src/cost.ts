// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/cost.ts
//
//

// A step's usage as core prices it, and the notice for a model with no
// price.

import { label, type RouteEntry, type StepUsage } from "@dorothy/core";
import type { LanguageModelUsage } from "ai";

export function stepUsage(usage: LanguageModelUsage): StepUsage {
    const details = usage.inputTokenDetails;
    return {
        noCache: details?.noCacheTokens ?? usage.inputTokens ?? 0,
        cacheRead: details?.cacheReadTokens ?? 0,
        cacheWrite: details?.cacheWriteTokens ?? 0,
        output: usage.outputTokens ?? 0,
    };
}

// Models already warned of, for the process.
const unpriced = new Set<string>();

// Once a process per model: its cost shows as $0.
export function unpricedNotice(entry: RouteEntry): string | null {
    const name = label(entry);
    if (unpriced.has(name)) {
        return null;
    }
    unpriced.add(name);
    return `no price is known for ${name}; its cost shows as $0`;
}
