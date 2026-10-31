// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/passage.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { escapeXml } from "../memory/block.js";
import {
    type EvidenceConversation,
    pack,
    passage,
    turnsIn,
} from "./passage.js";
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
        expect(pack(items, 0)).toEqual({
            text: "",
            ids: [],
            texts: [],
            cut: false,
        });
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
        const { text } = passage(long, ["bicycle"], 300);
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
        const { text } = passage(long, ["bicycle"], 300);
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
            const { text } = passage(long, terms, 300);
            expect(text.length).toBeLessThanOrEqual(300);
            expect(text).toContain(answer);
        });
    }

    it("excerpts the start of a long first turn where none match", () => {
        const long = longTurn(`Opening words. ${"padding ".repeat(1000)}`);
        const { text } = passage(long, ["zebra"], 300);
        expect(text.length).toBeLessThanOrEqual(300);
        expect(text).toContain("Opening words.");
    });
});

const AT = "2026-10-01T09:00:00.000Z";
const talk: EvidenceConversation = {
    id: "c:talk",
    phrase: "talk",
    project: null,
    title: "Talk",
    firstAt: AT,
    lastAt: AT,
    turns: [
        { n: 1, role: "user", at: AT, text: "Hello there." },
        { n: 2, role: "assistant", at: AT, text: "Hi." },
        { n: 3, role: "user", at: AT, text: "My bicycle is crimson." },
        { n: 4, role: "assistant", at: AT, text: "Noted, crimson." },
        { n: 5, role: "user", at: AT, text: "Anything else?" },
    ],
};

describe("passage seeds", () => {
    it("takes the seeds and their neighbours alone", () => {
        // Turn 1 matches the query, but seeds rule out overlap.
        const found = passage(talk, ["hello"], 1000, [3]);
        expect(found.turns).toEqual({ from: 2, through: 4 });
        expect(found.text).toContain("[3] user");
        expect(found.text).not.toContain("Hello there.");
        const tight = passage(talk, ["hello"], 130, [3]);
        expect(tight.text).toContain("crimson");
        expect(tight.turns).toEqual({ from: 2, through: 3 });
    });

    it("falls back to overlap for seeds the conversation lacks", () => {
        expect(passage(talk, ["hello"], 1000, [99]).turns).toEqual({
            from: 1,
            through: 2,
        });
    });

    it("keeps the match of an excerpt when escaping swells it", () => {
        const long: EvidenceConversation = {
            ...talk,
            turns: [
                {
                    n: 1,
                    role: "user",
                    at: AT,
                    text: `${"&".repeat(1000)} bicycle crimson ${"&".repeat(1000)}`,
                },
            ],
        };
        const cost = (text: string) => escapeXml(text).length;
        const found = passage(long, ["bicycle"], 200, [], cost);
        expect(cost(found.text)).toBeLessThanOrEqual(200);
        expect(found.text).toContain("bicycle");
    });

    it("reads the turns a text holds", () => {
        const { text } = passage(talk, ["bicycle"], 1000, [3]);
        expect(turnsIn(text)).toEqual({ from: 2, through: 4 });
        expect(turnsIn("Talk, 2026-10-01 to 2026-10-01")).toBeNull();
    });

    it("gives no range when only the head fits", () => {
        const found = passage(talk, ["bicycle"], 10);
        expect(found.turns).toBeNull();
        expect(found.text.length).toBeLessThanOrEqual(10);
    });

    it("gives an excerpt's turn as its range", () => {
        const long: EvidenceConversation = {
            ...talk,
            turns: [
                {
                    n: 7,
                    role: "user",
                    at: AT,
                    text: `My bicycle is crimson. ${"word ".repeat(500)}`,
                },
            ],
        };
        const found = passage(long, ["bicycle"], 200);
        expect(found.turns).toEqual({ from: 7, through: 7 });
        expect(found.cut).toBe(true);
        expect(passage(talk, ["bicycle"], 1000).cut).toBe(false);
    });
});

describe("pack's account", () => {
    it("gives each item's text as it went in, and whether one was cut", () => {
        const items = [
            { id: "c:a", text: "x".repeat(50) },
            { id: "c:b", text: "y".repeat(50) },
        ];
        const whole = pack(items, 400);
        expect(whole.texts).toEqual(["x".repeat(50), "y".repeat(50)]);
        expect(whole.cut).toBe(false);
        const cut = pack(items, 120);
        expect(cut.ids).toEqual(["c:a", "c:b"]);
        expect(cut.texts[1]?.length).toBeLessThan(50);
        expect(cut.cut).toBe(true);
        expect(pack(items, 0)).toEqual({
            text: "",
            ids: [],
            texts: [],
            cut: false,
        });
    });
});
