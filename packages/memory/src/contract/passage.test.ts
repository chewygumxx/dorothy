// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/passage.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { type EvidenceConversation, pack, passage } from "./passage.js";
import { scoreOf, termsOf } from "./terms.js";

describe("items", () => {
    it("pack within the budget, the last cut to fit", () => {
        const packed = pack(
            [
                { id: "c:a", text: "x".repeat(50) },
                { id: "c:b", text: "y".repeat(50) },
            ],
            120,
        ).text;
        expect(packed.length).toBeLessThanOrEqual(120);
        expect(packed).toStartWith('<item id="c:a">\n');
        expect(packed).toContain('<item id="c:b">');
    });

    it("report the ids that went in, not those the budget cut off", () => {
        const items = [
            { id: "c:a", text: "x".repeat(50) },
            { id: "c:b", text: "y".repeat(50) },
            { id: "c:c", text: "z".repeat(50) },
        ];
        const whole = pack(items, 400);
        expect(whole.ids).toEqual(["c:a", "c:b", "c:c"]);
        // The second is cut to fit and counts; the third never gets in.
        const cut = pack(items, 120);
        expect(cut.ids).toEqual(["c:a", "c:b"]);
        expect(cut.text).not.toContain("c:c");
        expect(pack(items, 0)).toEqual({ text: "", ids: [] });
    });
});

describe("passage", () => {
    const longTurn = (text: string): EvidenceConversation => ({
        id: "c:long",
        phrase: "long",
        project: null,
        title: "Discussion",
        firstAt: "2026-10-01T00:00:00Z",
        lastAt: "2026-10-01T00:00:00Z",
        turns: [{ n: 1, role: "user", at: "2026-10-01T00:00:00Z", text }],
    });

    it("excerpts a matching turn too long to fit, not drops it", () => {
        const long = longTurn(
            `My bicycle is crimson. ${"details ".repeat(1000)}`,
        );
        const text = passage(long, ["bicycle"], 300);
        expect(text.length).toBeLessThanOrEqual(300);
        expect(text).toStartWith(
            "Discussion, 2026-10-01 to 2026-10-01\n[1] user",
        );
        expect(text).toContain("My bicycle is crimson.");
    });

    it("centres the excerpt on the match, wherever it lies", () => {
        const long = longTurn(
            `${"filler ".repeat(500)}my bicycle is crimson${" filler".repeat(500)}`,
        );
        const text = passage(long, ["bicycle"], 300);
        expect(text.length).toBeLessThanOrEqual(300);
        expect(text).toContain("my bicycle is crimson");
    });

    for (const [word, query, padding] of [
        ["cafe\u0301", "café", "ﬃ filler "],
        ["㍿", "株式会社", "ﬃ filler "],
        ["cafe\u0301", "café", "\uffa1\uffc2 filler "],
    ] as const) {
        it(`keeps a normalized ${query} match after ${padding}`, () => {
            // Normalization expands ligatures and composes halfwidth jamo,
            // so its offsets cannot be used to slice the original turn.
            const answer = `My ${word} order is espresso.`;
            const long = longTurn(
                `${padding.repeat(500)}${answer}${" filler".repeat(500)}`,
            );
            const terms = termsOf(query);
            expect(scoreOf(long.turns[0]?.text ?? "", terms)).toBe(1);
            const text = passage(long, terms, 300);
            expect(text.length).toBeLessThanOrEqual(300);
            expect(text).toContain(answer);
        });
    }

    it("excerpts the start of a long first turn where none match", () => {
        const long = longTurn(`Opening words. ${"padding ".repeat(1000)}`);
        const text = passage(long, ["zebra"], 300);
        expect(text.length).toBeLessThanOrEqual(300);
        expect(text).toContain("Opening words.");
    });
});
