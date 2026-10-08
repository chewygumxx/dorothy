// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/tagging.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    applyTagging,
    readTagOutput,
    reviewConcepts,
    type TagOutput,
} from "./tagging.js";
import type { Concept, Vocabulary } from "./vocabulary.js";

const AT = "2026-10-07T12:00:00.000Z";
const STAMP = { at: AT, model: "claude-test" };
const concept = (
    prefLabel: string,
    fields: Partial<Concept> = {},
): Concept => ({
    prefLabel,
    altLabel: [],
    broader: [],
    scopeNote: `About ${prefLabel}.`,
    by: "dorothy",
    at: AT,
    model: "claude-test",
    edited: null,
    ...fields,
});
const MEMORY = "k00000001";
const TUI = "k00000002";
const GONE = "k00000003";
const BASE: Vocabulary = {
    v: 1,
    rev: 3,
    concepts: {
        [MEMORY]: concept("memory", { altLabel: ["recall"] }),
        [TUI]: concept("R&D <tui>"),
        [GONE]: { deleted: AT, labels: ["misc"] },
    },
};
// Ids drawn in order, so coined concepts are predictable.
function draws() {
    let n = 0xa0;
    return () => Uint8Array.from([0, 0, 0, n++]);
}
const output = (fields: Partial<TagOutput>): TagOutput => ({
    tags: [],
    coined: [],
    ...fields,
});
const coin = (prefLabel: string, fields: object = {}) => ({
    prefLabel,
    altLabel: [],
    broader: [],
    scopeNote: `About ${prefLabel}.`,
    ...fields,
});

describe("readTagOutput", () => {
    it("reads tags and coined concepts, unescaped and normalised", () => {
        expect(
            readTagOutput({
                tags: [" memory ", "R&amp;D &lt;tui&gt;", 7],
                coined: [
                    {
                        prefLabel: "go",
                        altLabel: ["golang", null],
                        broader: ["memory"],
                        scopeNote: "The  language.",
                    },
                    { prefLabel: "no note" },
                    "junk",
                ],
            }),
        ).toEqual({
            tags: ["memory", "R&D <tui>"],
            coined: [
                {
                    prefLabel: "go",
                    altLabel: ["golang"],
                    broader: ["memory"],
                    scopeNote: "The language.",
                },
            ],
        });
    });

    it("reads escaped quotes as quotes, and &amp;quot; as &quot;", () => {
        expect(
            readTagOutput({
                tags: ["say &quot;hi&quot;", "&amp;quot;"],
                coined: [
                    {
                        prefLabel: "say &quot;bye&quot;",
                        scopeNote: "About &quot;bye&quot;.",
                    },
                ],
            }),
        ).toEqual({
            tags: ['say "hi"', "&quot;"],
            coined: [
                {
                    prefLabel: 'say "bye"',
                    altLabel: [],
                    broader: [],
                    scopeNote: 'About "bye".',
                },
            ],
        });
    });

    it("reads anything else as no tags", () => {
        expect(readTagOutput(null)).toEqual({ tags: [], coined: [] });
        expect(readTagOutput({ tags: "memory", coined: {} })).toEqual({
            tags: [],
            coined: [],
        });
    });
});

describe("applyTagging", () => {
    it("reuses a concept by any label", () => {
        const tagged = applyTagging(
            BASE,
            output({ tags: ["Recall", "r&d <TUI>"] }),
            STAMP,
        );
        expect(tagged.tags).toEqual([MEMORY, TUI]);
        expect(tagged.coined).toBe(0);
        expect(tagged.vocabulary).toEqual(BASE);
    });

    it("resolves a label with a quote echoed back escaped", () => {
        const quoted: Vocabulary = {
            ...BASE,
            concepts: { ...BASE.concepts, k00000010: concept('say "hi"') },
        };
        const tagged = applyTagging(
            quoted,
            readTagOutput({ tags: ["say &quot;hi&quot;"] }),
            STAMP,
        );
        expect(tagged.tags).toEqual(["k00000010"]);
    });

    it("stores a coined label's quotes as quotes", () => {
        const tagged = applyTagging(
            BASE,
            readTagOutput({
                tags: ["say &quot;bye&quot;"],
                coined: [coin("say &quot;bye&quot;")],
            }),
            STAMP,
            draws(),
        );
        expect(tagged.coined).toBe(1);
        expect(
            (tagged.vocabulary.concepts.k000000a0 as Concept).prefLabel,
        ).toBe('say "bye"');
        expect(tagged.tags).toEqual(["k000000a0"]);
    });

    it("coins what nothing fits, under its broader concepts", () => {
        const tagged = applyTagging(
            BASE,
            output({
                tags: ["tagging", "memory"],
                coined: [
                    coin("tagging", {
                        altLabel: ["labels", "Recall", "labels"],
                        broader: ["memory", "nowhere"],
                    }),
                ],
            }),
            STAMP,
            draws(),
        );
        expect(tagged.coined).toBe(1);
        expect(tagged.tags).toEqual(["k000000a0", MEMORY]);
        expect(tagged.vocabulary.concepts.k000000a0).toEqual({
            prefLabel: "tagging",
            altLabel: ["labels"],
            broader: [MEMORY],
            scopeNote: "About tagging.",
            by: "dorothy",
            at: AT,
            model: "claude-test",
            edited: null,
        });
        expect(tagged.dropped).toEqual([
            'alternative label "Recall"',
            'alternative label "labels"',
            'broader "nowhere"',
        ]);
        // The vocabulary it was given is left as it was.
        expect(BASE.concepts.k000000a0).toBeUndefined();
    });

    it("makes a coin of a known label a reuse", () => {
        const tagged = applyTagging(
            BASE,
            output({ tags: ["RECALL"], coined: [coin("recall")] }),
            STAMP,
            draws(),
        );
        expect(tagged.coined).toBe(0);
        expect(tagged.tags).toEqual([MEMORY]);
    });

    it("never coins a label the user deleted, nor tags with it", () => {
        const tagged = applyTagging(
            BASE,
            output({ tags: ["misc", "memory"], coined: [coin("Misc")] }),
            STAMP,
            draws(),
        );
        expect(tagged.coined).toBe(0);
        expect(tagged.tags).toEqual([MEMORY]);
        expect(tagged.dropped).toEqual([
            '"Misc" was deleted by the user',
            'tag "misc"',
        ]);
    });

    it("drops a coin with a bad label or note", () => {
        const tagged = applyTagging(
            BASE,
            output({
                coined: [
                    coin("a;b"),
                    coin("x".repeat(51)),
                    coin("fine", { scopeNote: "" }),
                ],
            }),
            STAMP,
            draws(),
        );
        expect(tagged.coined).toBe(0);
        expect(tagged.dropped).toHaveLength(3);
    });

    it("makes two coins of one label one concept", () => {
        const tagged = applyTagging(
            BASE,
            output({ tags: ["go"], coined: [coin("go"), coin("Go")] }),
            STAMP,
            draws(),
        );
        expect(tagged.coined).toBe(1);
        expect(tagged.tags).toEqual(["k000000a0"]);
    });

    it("drops the edge that would close a cycle among her coins", () => {
        const tagged = applyTagging(
            BASE,
            output({
                coined: [
                    coin("a", { broader: ["b"] }),
                    coin("b", { broader: ["a"] }),
                ],
            }),
            STAMP,
            draws(),
        );
        const a = tagged.vocabulary.concepts.k000000a0 as Concept;
        const b = tagged.vocabulary.concepts.k000000a1 as Concept;
        expect(a.broader).toEqual(["k000000a1"]);
        expect(b.broader).toEqual([]);
        expect(tagged.dropped).toEqual(['broader "a"']);
    });

    it("keeps the first 5 tags, each once", () => {
        const many: Vocabulary = {
            ...BASE,
            concepts: {
                ...BASE.concepts,
                k00000011: concept("a"),
                k00000012: concept("b"),
                k00000013: concept("c"),
                k00000014: concept("d"),
                k00000015: concept("e"),
            },
        };
        const tagged = applyTagging(
            many,
            output({ tags: ["memory", "recall", "a", "b", "c", "d", "e"] }),
            STAMP,
        );
        expect(tagged.tags).toEqual([
            MEMORY,
            "k00000011",
            "k00000012",
            "k00000013",
            "k00000014",
        ]);
    });

    it("coins at most 3 a review, dropping the rest", () => {
        const tagged = applyTagging(
            BASE,
            output({
                coined: ["a", "b", "c", "d"].map((label) => coin(label)),
            }),
            STAMP,
            draws(),
        );
        expect(tagged.coined).toBe(3);
        expect(tagged.dropped).toEqual(['coined "d"']);
    });
});

describe("reviewConcepts", () => {
    const PARENT = "k00000004";
    const v: Vocabulary = {
        v: 1,
        rev: 1,
        concepts: {
            [MEMORY]: concept("memory", { broader: [PARENT] }),
            [TUI]: concept("tui"),
            [PARENT]: concept("dorothy"),
            k00000005: concept("unused"),
            k00000006: { mergedInto: TUI, at: AT },
        },
    };

    it("leaves out what only hidden conversations carry", () => {
        expect(
            reviewConcepts(v, [
                { tags: [MEMORY], hidden: false },
                { tags: ["k00000006"], hidden: true },
            ]).map(([, c]) => c.prefLabel),
        ).toEqual(["dorothy", "memory", "unused"]);
    });

    it("keeps what a visible conversation carries beneath it", () => {
        expect(
            reviewConcepts(v, [
                { tags: [MEMORY], hidden: true },
                { tags: [MEMORY, TUI], hidden: false },
            ]).map(([, c]) => c.prefLabel),
        ).toEqual(["dorothy", "memory", "tui", "unused"]);
    });
});
