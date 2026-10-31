// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/engine/merge.ts
//
//

// Knowledge and episode hits as one list. Their BM25 scores come from
// different tables, so rank is all they share: alternating them is what
// reciprocal rank fusion gives two lists that never share an item.

import type { MemoryHit } from "@dorothy/core";

export const HIT_ORDERS = ["alternate", "knowledge-first"] as const;
export type HitOrder = (typeof HIT_ORDERS)[number];

// At most limit hits: alternating by rank, the best episode first, or
// every knowledge hit first, as the baseline gave them before.
export function mergeHits(
    knowledge: readonly MemoryHit[],
    episodes: readonly MemoryHit[],
    order: HitOrder,
    limit: number,
): MemoryHit[] {
    if (order === "knowledge-first") {
        return [...knowledge, ...episodes].slice(0, Math.max(0, limit));
    }
    const merged: MemoryHit[] = [];
    const longest = Math.max(knowledge.length, episodes.length);
    for (let at = 0; at < longest; at++) {
        for (const hit of [episodes[at], knowledge[at]]) {
            if (hit !== undefined) {
                merged.push(hit);
            }
        }
    }
    return merged.slice(0, Math.max(0, limit));
}
