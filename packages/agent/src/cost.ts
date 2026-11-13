// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/agent/src/cost.ts
//
//

// A step's usage and cost, and the notices for a cost unknown.

import {
    label,
    type RouteEntry,
    type StepUsage,
    stepCost,
} from "@dorothy/core";
import type { LanguageModelUsage, ProviderMetadata } from "ai";

export function stepUsage(usage: LanguageModelUsage): StepUsage {
    const details = usage.inputTokenDetails;
    const cacheRead = details?.cacheReadTokens ?? 0;
    const cacheWrite = details?.cacheWriteTokens ?? 0;
    // Without the uncached count, the rest of inputTokens, which also
    // counts the cache's reads and writes.
    const noCache =
        details?.noCacheTokens ??
        Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite);
    return {
        noCache,
        cacheRead,
        cacheWrite,
        output: usage.outputTokens ?? 0,
    };
}

// Notices already given, for the process: one of each kind per model.
const warned = new Set<string>();

function once(kind: string, entry: RouteEntry, message: string): string | null {
    const key = `${kind} ${label(entry)}`;
    if (warned.has(key)) {
        return null;
    }
    warned.add(key);
    return message;
}

// Once a process per model: its cost shows as $0.
export function unpricedNotice(entry: RouteEntry): string | null {
    return once(
        "price",
        entry,
        `no price is known for ${label(entry)}; its cost shows as $0`,
    );
}

export function noUsageNotice(entry: RouteEntry): string | null {
    return once(
        "usage",
        entry,
        `${label(entry)} reported no usage; its cost shows as $0`,
    );
}

// OpenRouter's own figure for a step, which usage.include asks for.
function openRouterCost(metadata: ProviderMetadata | undefined): number | null {
    const usage = metadata?.openrouter?.usage as { cost?: unknown } | undefined;
    return typeof usage?.cost === "number" ? usage.cost : null;
}

// A step's cost, and the notice, once a process per model, of a cost
// unknown: no price, or no usage to price. A free entry, priced [0, 0],
// is never warned of.
export function stepPrice(
    entry: RouteEntry,
    usage: LanguageModelUsage,
    metadata: ProviderMetadata | undefined,
): { costUsd: number; notice: string | null } {
    if (entry.price?.[0] === 0 && entry.price[1] === 0) {
        return { costUsd: 0, notice: null };
    }
    if (usage.inputTokens === undefined && usage.outputTokens === undefined) {
        return { costUsd: 0, notice: noUsageNotice(entry) };
    }
    const cost =
        entry.kind === "openrouter"
            ? openRouterCost(metadata)
            : stepCost(entry, stepUsage(usage));
    return cost === null
        ? { costUsd: 0, notice: unpricedNotice(entry) }
        : { costUsd: cost, notice: null };
}
