// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/list.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { Entry } from "./catalogue.js";
import { formatList, listRows } from "./list.js";
import { rank, tier } from "./rank.js";
import { EMPTY_SIDECAR, type Sidecar } from "./sidecar.js";

// Local noon, so the local dates below hold in any time zone.
const NOON = new Date(2026, 9, 5, 12).getTime();
const DAY = 86_400_000;

function entry(
    phrase: string,
    fields: Partial<Sidecar> | null,
    daysAgo: number,
    turns = 2,
): Entry {
    const lastAt = NOON - daysAgo * DAY;
    return {
        phrase,
        sidecar:
            fields === null
                ? { kind: "none" }
                : { kind: "ok", sidecar: { ...EMPTY_SIDECAR, ...fields } },
        visits: [{ userTurns: 1, lastAt }],
        reads: [],
        turns,
        lastActive: lastAt,
    };
}

const entries: Entry[] = [
    entry("d", { title: "Probe", hidden: true, reviewedThrough: 2 }, 3, 4),
    entry(
        "a",
        {
            title: "Memory and metadata",
            description: "Designing memory.",
            abstract: "Tiers.",
            pinned: true,
            reviewedThrough: 2,
        },
        0,
    ),
    entry("e", null, 4),
    entry(
        "c",
        {
            title: "Hey there o/",
            fields: { title: { by: "prompt", at: "2026-10-03T00:00:00.000Z" } },
        },
        2,
    ),
    entry(
        "b",
        {
            title: "Rendering artefacts",
            description: "Chasing escape codes.",
            reviewedThrough: 2,
        },
        1,
    ),
];

describe("formatList", () => {
    it("lists every conversation as a new session would rank it", () => {
        const tiered = tier(
            rank(entries, { now: NOON, halfLifeDays: 30 }),
            2000,
        );
        expect(formatList(listRows(entries, tiered))).toBe(
            [
                "   last active  tier       phrase  title",
                " * 2026-10-05   full       a       Memory and metadata",
                "   2026-10-04   described  b       Rendering artefacts",
                "   2026-10-03   titled     c       Hey there o/ (provisional)",
                " h 2026-10-02   hidden     d       Probe (stale)",
                "   2026-10-01   omitted    e       (untitled)",
            ].join("\n"),
        );
    });

    it("marks what the budget left out", () => {
        const tiered = tier(rank(entries, { now: NOON, halfLifeDays: 30 }), 0);
        const rows = listRows(entries, tiered);
        expect(rows.find((row) => row.phrase === "b")?.tier).toBe("omitted");
        expect(rows.find((row) => row.phrase === "a")?.tier).toBe("full");
    });

    it("prints the header alone with no conversations", () => {
        expect(formatList([])).toBe("   last active  tier       phrase  title");
    });
});
