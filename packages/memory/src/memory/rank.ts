// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/rank.ts
//
//

import type { MemoryConfig } from "@dorothy/core";
import { type Note, renderBlock, renderEntry, type Tier } from "./block.js";
import type { Entry, Read, Visit } from "./catalogue.js";
import { characters, type Served } from "./sidecar.js";

const DAY_MS = 86_400_000;
// Richest first; a tier's index is how far it is from full.
const TIERS: readonly Tier[] = ["full", "described", "titled"];

// A read weighs what it gave her: nothing, unless it served.
export const SERVED_WEIGHT: Record<Served, number> = {
    none: 0,
    slight: 0.5,
    useful: 1,
    essential: 2,
};

// Accesses weighted by what they were worth, each decaying from when it
// happened. The log stops one long session from outweighing several
// returns.
export function salience(
    visits: readonly Visit[],
    reads: readonly Read[],
    now: number,
    halfLifeDays: number,
): number {
    const decay = (at: number) =>
        0.5 ** (Math.max(0, now - at) / DAY_MS / halfLifeDays);
    let score = 0;
    for (const visit of visits) {
        score += (1 + Math.log(1 + visit.userTurns)) * decay(visit.lastAt);
    }
    for (const read of reads) {
        score += SERVED_WEIGHT[read.served] * decay(read.at);
    }
    return score;
}

export type Candidate = {
    phrase: string;
    note: Note;
    score: number;
    lastActive: number;
};

// The notes a new session could see: pins first, then by score.
export function rank(
    entries: readonly Entry[],
    {
        now,
        halfLifeDays,
        exclude = null,
    }: { now: number; halfLifeDays: number; exclude?: string | null },
): Candidate[] {
    const candidates: Candidate[] = [];
    for (const entry of entries) {
        if (entry.phrase === exclude || entry.sidecar.kind !== "ok") {
            continue;
        }
        const { sidecar } = entry.sidecar;
        if (sidecar.hidden || sidecar.title === null) {
            continue;
        }
        candidates.push({
            phrase: entry.phrase,
            note: {
                title: sidecar.title,
                description: sidecar.description,
                abstract: sidecar.abstract,
                pinned: sidecar.pinned,
            },
            score: salience(entry.visits, entry.reads, now, halfLifeDays),
            lastActive: entry.lastActive,
        });
    }
    return candidates.sort(
        (a, b) =>
            Number(b.note.pinned) - Number(a.note.pinned) ||
            b.score - a.score ||
            b.lastActive - a.lastActive ||
            a.phrase.localeCompare(b.phrase),
    );
}

// Characters as the note limits count them.
export const tokens = (text: string) => Math.ceil(characters(text) / 4);

// The richest tier a note's own fields can fill.
export function richest(note: Note): Tier {
    if (note.description === null) {
        return "titled";
    }
    return note.abstract === null ? "described" : "full";
}

export type TieredCandidate = Candidate & { tier: Tier };
export type Tiered = {
    placed: TieredCandidate[];
    omitted: Candidate[];
    pinTokens: number;
};

// Pins come first, whole, whatever they cost. The rest each get the
// richest tier that fits what is left, never richer than the last one the
// budget cut short; the first whose title alone does not fit ends the walk.
export function tier(candidates: readonly Candidate[], budget: number): Tiered {
    const placed: TieredCandidate[] = [];
    const rest: Candidate[] = [];
    let left = budget;
    let pinTokens = 0;
    for (const candidate of candidates) {
        if (!candidate.note.pinned) {
            rest.push(candidate);
            continue;
        }
        const at = richest(candidate.note);
        const size = tokens(renderEntry({ note: candidate.note, tier: at }));
        pinTokens += size;
        left -= size;
        placed.push({ ...candidate, tier: at });
    }
    let cap = 0;
    let index = 0;
    for (; index < rest.length; index++) {
        const candidate = rest[index] as Candidate;
        const allowed = Math.max(cap, TIERS.indexOf(richest(candidate.note)));
        const fit = TIERS.findIndex(
            (at, rung) =>
                rung >= allowed &&
                tokens(renderEntry({ note: candidate.note, tier: at })) <= left,
        );
        if (fit === -1) {
            break;
        }
        if (fit > allowed) {
            cap = fit;
        }
        const at = TIERS[fit] as Tier;
        left -= tokens(renderEntry({ note: candidate.note, tier: at }));
        placed.push({ ...candidate, tier: at });
    }
    return { placed, omitted: rest.slice(index), pinTokens };
}

// reserved: tokens already spent on this conversation's own abstracts,
// which come before every note on other conversations.
export function buildMemory(
    entries: readonly Entry[],
    {
        now,
        config,
        exclude,
        reserved = 0,
    }: {
        now: number;
        config: MemoryConfig;
        exclude: string | null;
        reserved?: number;
    },
): { block: string; tiered: Tiered; warnings: string[] } {
    const tiered = tier(
        rank(entries, { now, halfLifeDays: config.halfLifeDays, exclude }),
        Math.max(0, config.budget - reserved),
    );
    const over = reserved + tiered.pinTokens > config.budget;
    const warnings = !over
        ? []
        : reserved === 0
          ? [
                `memory: pinned notes take ~${tiered.pinTokens} tokens, over the budget of ${config.budget}`,
            ]
          : [
                `memory: this conversation's summaries take ~${reserved} tokens and pinned notes ~${tiered.pinTokens}, over the budget of ${config.budget}`,
            ];
    return {
        block: renderBlock(tiered.placed, tiered.omitted.length),
        tiered,
        warnings,
    };
}
