// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/rank.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { DEFAULT_CONFIG } from "../config.js";
import { type Note, renderEntry, type Tier } from "./block.js";
import type { Entry, Visit } from "./catalogue.js";
import {
    buildMemory,
    type Candidate,
    rank,
    salience,
    tier,
    tokens,
} from "./rank.js";
import { EMPTY_SIDECAR, type Sidecar } from "./sidecar.js";

const NOW = Date.parse("2026-10-05T00:00:00.000Z");
const DAY = 86_400_000;
const once = (lastAt = NOW): Visit[] => [{ userTurns: 1, lastAt }];

function entry(
    phrase: string,
    fields: Partial<Sidecar>,
    visits: Visit[] = once(),
): Entry {
    return {
        phrase,
        sidecar: { kind: "ok", sidecar: { ...EMPTY_SIDECAR, ...fields } },
        visits,
        reads: [],
        turns: 2,
        lastActive: Math.max(...visits.map((visit) => visit.lastAt)),
    };
}
const full = (title: string, extra: Partial<Sidecar> = {}) => ({
    title,
    description: `About ${title}.`,
    abstract: `All about ${title}.`,
    ...extra,
});
function candidate(title: string, extra: Partial<Note> = {}): Candidate {
    return {
        phrase: title,
        note: {
            title,
            description: `About ${title}.`,
            abstract: "x".repeat(400),
            pinned: false,
            ...extra,
        },
        score: 1,
        lastActive: NOW,
    };
}
const cost = (note: Note, at: Tier) => tokens(renderEntry({ note, tier: at }));

describe("salience", () => {
    it("weighs a visit by the log of its user turns", () => {
        expect(salience(once(), [], NOW, 30)).toBeCloseTo(1 + Math.log(2));
        const long = salience([{ userTurns: 99, lastAt: NOW }], [], NOW, 30);
        const returns = salience(
            Array.from({ length: 4 }, () => ({ userTurns: 1, lastAt: NOW })),
            [],
            NOW,
            30,
        );
        expect(long).toBeLessThan(returns);
    });

    it("halves a visit's weight every half-life", () => {
        const fresh = salience(once(), [], NOW, 30);
        expect(salience(once(NOW - 30 * DAY), [], NOW, 30)).toBeCloseTo(
            fresh / 2,
        );
        expect(salience(once(NOW - 60 * DAY), [], NOW, 30)).toBeCloseTo(
            fresh / 4,
        );
    });

    it("treats a visit from the future as from now", () => {
        expect(salience(once(NOW + 5 * DAY), [], NOW, 30)).toBeCloseTo(
            1 + Math.log(2),
        );
    });

    it("adds what each read gave her", () => {
        const read = (served: "none" | "slight" | "useful" | "essential") => ({
            at: NOW,
            served,
        });
        expect(salience([], [read("none")], NOW, 30)).toBe(0);
        expect(salience([], [read("slight")], NOW, 30)).toBe(0.5);
        expect(salience([], [read("useful")], NOW, 30)).toBe(1);
        expect(salience([], [read("essential")], NOW, 30)).toBe(2);
    });

    it("decays a read from when it happened", () => {
        const now = Date.parse("2026-10-05T00:00:00.000Z");
        const at = now - 30 * 86_400_000;
        expect(salience([], [{ at, served: "essential" }], now, 30)).toBe(1);
    });
});

describe("rank", () => {
    it("puts pins first, then the rest by score", () => {
        const entries = [
            entry("a", full("Old"), once(NOW - 90 * DAY)),
            entry("b", full("New")),
            entry("c", full("Pinned", { pinned: true }), once(NOW - 365 * DAY)),
        ];
        expect(
            rank(entries, { now: NOW, halfLifeDays: 30 }).map(
                (found) => found.note.title,
            ),
        ).toEqual(["Pinned", "New", "Old"]);
    });

    it("ranks a conversation that served her above an equal one", () => {
        const served = {
            ...entry("b", full("Served")),
            reads: [{ at: NOW, served: "useful" as const }],
        };
        expect(
            rank([entry("a", full("Unserved")), served], {
                now: NOW,
                halfLifeDays: 30,
            }).map((candidate) => candidate.phrase),
        ).toEqual(["b", "a"]);
    });

    it("leaves out the current, hidden, untitled and unreadable conversations", () => {
        const entries: Entry[] = [
            entry("a", full("Current")),
            entry("b", full("Hidden", { hidden: true })),
            entry("c", { description: "No title." }),
            {
                ...entry("d", {}),
                sidecar: { kind: "unparseable", reason: "bad" },
            },
            { ...entry("e", {}), sidecar: { kind: "none" } },
            entry("f", full("Kept")),
        ];
        expect(
            rank(entries, { now: NOW, halfLifeDays: 30, exclude: "a" }).map(
                (found) => found.phrase,
            ),
        ).toEqual(["f"]);
    });
});

describe("tier", () => {
    it("gives each the richest tier that fits, never richer than one before", () => {
        const [a, b, c, d] = [
            candidate("A"),
            candidate("B"),
            candidate("C", { abstract: "x" }),
            candidate("D"),
        ];
        const budget =
            cost(a.note, "full") +
            cost(b.note, "described") +
            cost(c.note, "full");
        const tiered = tier([a, b, c, d], budget);
        expect(
            tiered.placed.map((placed) => [placed.phrase, placed.tier]),
        ).toEqual([
            ["A", "full"],
            ["B", "described"],
            ["C", "described"],
        ]);
        expect(tiered.omitted.map((left) => left.phrase)).toEqual(["D"]);
    });

    it("lowers the cap for the budget, not for a missing field", () => {
        const a = candidate("A", { description: null, abstract: null });
        const tiered = tier([a, candidate("B")], 10_000);
        expect(tiered.placed.map((placed) => placed.tier)).toEqual([
            "titled",
            "full",
        ]);
    });

    it("puts every pin in full, even over the budget", () => {
        const [p1, p2, a] = [
            candidate("P1", { pinned: true }),
            candidate("P2", { pinned: true }),
            candidate("A"),
        ];
        const tiered = tier([p1, p2, a], cost(p1.note, "full"));
        expect(
            tiered.placed.map((placed) => [placed.phrase, placed.tier]),
        ).toEqual([
            ["P1", "full"],
            ["P2", "full"],
        ]);
        expect(tiered.omitted.map((left) => left.phrase)).toEqual(["A"]);
        expect(tiered.pinTokens).toBe(
            cost(p1.note, "full") + cost(p2.note, "full"),
        );
    });
});

describe("buildMemory", () => {
    it("renders the ranked notes, without the current conversation", () => {
        const { block, warnings } = buildMemory(
            [entry("a", full("Kept")), entry("b", full("Current"))],
            { now: NOW, config: DEFAULT_CONFIG.memory, exclude: "b" },
        );
        expect(block).toContain("<title>Kept</title>");
        expect(block).not.toContain("Current");
        expect(warnings).toEqual([]);
    });

    it("warns when the pins alone overrun the budget", () => {
        const big = full("Pinned", {
            pinned: true,
            abstract: "x".repeat(1000),
        });
        const { warnings } = buildMemory([entry("a", big)], {
            now: NOW,
            config: { ...DEFAULT_CONFIG.memory, budget: 200 },
            exclude: null,
        });
        expect(warnings).toEqual([
            expect.stringMatching(
                /^memory: pinned notes take ~\d+ tokens, over the budget of 200$/,
            ),
        ]);
    });

    it("is empty with nothing to remember", () => {
        expect(
            buildMemory([], {
                now: NOW,
                config: DEFAULT_CONFIG.memory,
                exclude: null,
            }).block,
        ).toBe("");
    });
});
