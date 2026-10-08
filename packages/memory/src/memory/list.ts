// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/list.ts
//
//

import type { Tier } from "./block.js";
import type { Entry } from "./catalogue.js";
import type { Tiered } from "./rank.js";

export type ListRow = {
    marker: " " | "*" | "h";
    lastActive: number;
    tier: Tier | "hidden" | "omitted";
    phrase: string;
    title: string;
};

function titleOf(entry: Entry): string {
    if (entry.sidecar.kind !== "ok") {
        return "(untitled)";
    }
    const { sidecar } = entry.sidecar;
    const { title } = sidecar;
    if (title === null) {
        return "(untitled)";
    }
    // A provisional title is always awaiting review, so it says only that.
    if (sidecar.fields.title?.by === "prompt") {
        return `${title} (provisional)`;
    }
    return entry.turns > sidecar.reviewedThrough ? `${title} (stale)` : title;
}

// Those a new session would rank, in its order, then the rest by when they
// were last active.
export function listRows(entries: readonly Entry[], tiered: Tiered): ListRow[] {
    const byPhrase = new Map(entries.map((entry) => [entry.phrase, entry]));
    const tiers = new Map(
        tiered.placed.map((placed) => [placed.phrase, placed.tier]),
    );
    const ranked = [...tiered.placed, ...tiered.omitted].map(
        (candidate) => candidate.phrase,
    );
    const rest = entries
        .filter((entry) => !ranked.includes(entry.phrase))
        .sort((a, b) => b.lastActive - a.lastActive)
        .map((entry) => entry.phrase);
    return [...ranked, ...rest].flatMap((phrase): ListRow[] => {
        const entry = byPhrase.get(phrase);
        if (entry === undefined) {
            return [];
        }
        const sidecar =
            entry.sidecar.kind === "ok" ? entry.sidecar.sidecar : null;
        const hidden = sidecar?.hidden === true;
        return [
            {
                marker: hidden ? "h" : sidecar?.pinned ? "*" : " ",
                lastActive: entry.lastActive,
                tier: hidden ? "hidden" : (tiers.get(phrase) ?? "omitted"),
                phrase,
                title: titleOf(entry),
            },
        ];
    });
}

const pad2 = (value: number) => String(value).padStart(2, "0");

export function localDate(ms: number): string {
    const date = new Date(ms);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatList(
    rows: readonly ListRow[],
    date: (ms: number) => string = localDate,
): string {
    const width = Math.max(
        "phrase".length,
        ...rows.map((row) => row.phrase.length),
    );
    const line = (
        marker: string,
        last: string,
        tier: string,
        phrase: string,
        title: string,
    ) =>
        ` ${marker} ${last.padEnd(11)}  ${tier.padEnd(9)}  ${phrase.padEnd(width)}  ${title}`;
    return [
        line(" ", "last active", "tier", "phrase", "title"),
        ...rows.map((row) =>
            line(
                row.marker,
                date(row.lastActive),
                row.tier,
                row.phrase,
                row.title,
            ),
        ),
    ].join("\n");
}
