// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/compaction/plan.ts
//
//

import { tokens } from "../memory/rank.js";
import type { Cluster } from "../memory/sidecar.js";
import { type Turn, withClusters } from "../persona.js";

// Turns from to through, counting from 1, both included.
export type Range = { from: number; through: number };

// The last turn the clusters cover; 0 for none.
export const covered = (clusters: readonly Cluster[]): number =>
    clusters.at(-1)?.through ?? 0;

// What a session is seeded with in full: the turns after the clusters.
export function seedTurns<T>(
    turns: readonly T[],
    clusters: readonly Cluster[],
): T[] {
    return turns.slice(covered(clusters));
}

// The turns that leave the context: after the clusters, before the newest
// turns that fit in tail. The latest exchange, from the user's last message
// on, always stays, however large. Null when nothing would leave.
export function outgoing(
    turns: readonly Turn[],
    clusters: readonly Cluster[],
    tail: number,
): Range | null {
    const done = covered(clusters);
    const lastUser = turns.findLastIndex((turn) => turn.role === "user");
    // The index of the first turn kept.
    let keep = Math.max(done, lastUser === -1 ? turns.length : lastUser);
    let used = turns
        .slice(keep)
        .reduce((sum, turn) => sum + tokens(turn.text), 0);
    while (keep > done) {
        const size = tokens((turns[keep - 1] as Turn).text);
        if (used + size > tail) {
            break;
        }
        used += size;
        keep--;
    }
    return keep > done ? { from: done + 1, through: keep } : null;
}

// What the abstracts cost in a session's prompt, charged to the memory
// budget before any note on another conversation.
export function clusterTokens(
    clusters: readonly Cluster[],
    recollect: boolean,
): number {
    return clusters.length === 0
        ? 0
        : tokens(withClusters("", clusters, recollect));
}

export type Pressure = "none" | "soft" | "hard";

export function pressure(
    context: number,
    { soft, hard }: { soft: number; hard: number },
): Pressure {
    return context > hard ? "hard" : context > soft ? "soft" : "none";
}
