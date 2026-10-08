// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/tags-view.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    applyTagsEdit,
    parseTagsView,
    renderTagsTree,
    renderTagsView,
    type TagsEdit,
} from "./tags-view.js";
import {
    type Concept,
    EMPTY_VOCABULARY,
    type Vocabulary,
} from "./vocabulary.js";

const AT = "2026-10-07T12:00:00.000Z";
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
    model: "claude-opus-5-5",
    edited: null,
    ...fields,
});
const K = {
    dorothy: "k00000001",
    memory: "k00000002",
    compaction: "k00000003",
    tagging: "k00000004",
    persona: "k00000005",
    tui: "k00000006",
    rendering: "k00000007",
    misc: "k00000008",
};
const TREE: Vocabulary = {
    v: 1,
    rev: 1,
    concepts: {
        [K.dorothy]: concept("dorothy"),
        [K.memory]: concept("memory", { broader: [K.dorothy] }),
        [K.compaction]: concept("compaction", { broader: [K.memory] }),
        [K.tagging]: concept("tagging", { broader: [K.memory, K.tui] }),
        [K.persona]: concept("persona", { broader: [K.dorothy] }),
        [K.tui]: concept("tui"),
        [K.rendering]: concept("rendering", { broader: [K.tui] }),
        [K.misc]: concept("misc"),
        k00000009: { deleted: AT, labels: ["gone"] },
    },
};
const COUNTS = new Map([
    [K.dorothy, 12],
    [K.memory, 7],
    [K.compaction, 3],
    [K.tagging, 2],
    [K.persona, 4],
    [K.tui, 5],
    [K.rendering, 3],
]);

describe("renderTagsTree", () => {
    it("prints the hierarchy, a second parent's copy pointing above", () => {
        expect(renderTagsTree(TREE, COUNTS)).toBe(
            [
                "dorothy (12)",
                "  memory (7)",
                "    compaction (3)",
                "    tagging (2)",
                "  persona (4)",
                "misc (0)",
                "tui (5)",
                "  rendering (3)",
                "  tagging (2, see above)",
            ].join("\n"),
        );
    });

    it("prints nothing for an empty vocabulary", () => {
        expect(renderTagsTree(EMPTY_VOCABULARY, new Map())).toBe("");
    });
});

describe("the edit view", () => {
    const SMALL: Vocabulary = {
        v: 1,
        rev: 2,
        concepts: {
            k00000001: concept("dorothy"),
            k00000002: concept("memory", {
                altLabel: ["recall"],
                broader: ["k00000001"],
            }),
            k00000003: concept("recollection", { by: "user" }),
            k00000004: concept("tui", { edited: "2026-10-08T09:00:00.000Z" }),
            k00000005: concept("rendering", { broader: ["k00000004"] }),
            k00000009: { deleted: AT, labels: ["misc"] },
        },
    };
    const COUNTS = new Map([
        ["k00000001", 3],
        ["k00000002", 1],
    ]);
    const VIEW = renderTagsView(SMALL, COUNTS);
    const NOW = "2026-10-09T10:00:00.000Z";
    // Ids drawn in order, so created concepts are predictable.
    function draws() {
        let n = 0xa0;
        return () => Uint8Array.from([0, 0, 0, n++]);
    }
    const parse = (...swaps: [string, string][]) =>
        parseTagsView(
            swaps.reduce((text, [from, to]) => text.replace(from, to), VIEW),
            SMALL,
        );
    const editOf = (parsed: ReturnType<typeof parseTagsView>): TagsEdit => {
        if (parsed.kind !== "edit") {
            throw new Error(`expected an edit, got ${JSON.stringify(parsed)}`);
        }
        return parsed.edit;
    };
    const applied = (
        parsed: ReturnType<typeof parseTagsView>,
        current: Vocabulary = SMALL,
    ) => applyTagsEdit(current, editOf(parsed), NOW, draws());
    const vocabularyOf = (result: ReturnType<typeof applyTagsEdit>) => {
        if (!result.ok) {
            throw new Error(result.reason);
        }
        return result.vocabulary;
    };
    const block = (id: string, tag: string, rest: string[]) =>
        [`Concept: ${id}`, `Tag: ${tag}`, ...rest].join("\n");

    it("renders each live concept as a block, in label order", () => {
        expect(VIEW).toBe(
            [
                "# Dorothy's vocabulary. Lines starting with # are ignored.",
                "# Change a concept to make it yours. Delete a block to delete its concept;",
                "# Dorothy won't coin its labels again. Merge: folds a concept into another.",
                "# Add a block without Concept: to create one. Lists are separated by ;.",
                "",
                block("k00000001", "dorothy", [
                    "Also:",
                    "Under:",
                    "Note:",
                    "About dorothy.",
                    "# (Dorothy, claude-opus-5-5, 2026-10-07; 3 conversations)",
                ]),
                "",
                block("k00000002", "memory", [
                    "Also: recall",
                    "Under: dorothy",
                    "Note:",
                    "About memory.",
                    "# (Dorothy, claude-opus-5-5, 2026-10-07; 1 conversation)",
                ]),
                "",
                block("k00000003", "recollection", [
                    "Also:",
                    "Under:",
                    "Note:",
                    "About recollection.",
                    "# (yours, 2026-10-07; 0 conversations)",
                ]),
                "",
                block("k00000005", "rendering", [
                    "Also:",
                    "Under: tui",
                    "Note:",
                    "About rendering.",
                    "# (Dorothy, claude-opus-5-5, 2026-10-07; 0 conversations)",
                ]),
                "",
                block("k00000004", "tui", [
                    "Also:",
                    "Under:",
                    "Note:",
                    "About tui.",
                    "# (yours, 2026-10-08; 0 conversations)",
                ]),
                "",
            ].join("\n"),
        );
    });

    it("finds nothing changed in the view as rendered", () => {
        expect(parseTagsView(VIEW, SMALL)).toEqual({ kind: "unchanged" });
        expect(parseTagsView("", SMALL)).toEqual({ kind: "unchanged" });
    });

    it("recognises a rename by its id, and makes it the user's", () => {
        const parsed = parse(["Tag: memory", "Tag: remembering"]);
        expect(editOf(parsed).changed).toEqual(
            new Map([["k00000002", { tag: "remembering" }]]),
        );
        const after = vocabularyOf(applied(parsed));
        expect(after.concepts.k00000002).toMatchObject({
            prefLabel: "remembering",
            altLabel: ["recall"],
            edited: NOW,
        });
        expect(after.rev).toBe(SMALL.rev);
    });

    it("creates a block without an id as the user's", () => {
        const parsed = parseTagsView(
            `${VIEW}\nTag: tagging\nAlso: labels\nUnder: Recall; tui\nNote:\nGiving chats topics.\n`,
            SMALL,
        );
        const after = vocabularyOf(applied(parsed));
        expect(after.concepts.k000000a0).toEqual({
            prefLabel: "tagging",
            altLabel: ["labels"],
            broader: ["k00000002", "k00000004"],
            scopeNote: "Giving chats topics.",
            by: "user",
            at: NOW,
            edited: null,
        });
    });

    it("deletes a removed block, keeping its labels and freeing its children", () => {
        const parsed = parseTagsView(
            VIEW.replace(/Concept: k00000004\n[\s\S]*?conversations\)\n/, ""),
            SMALL,
        );
        expect(editOf(parsed).deleted).toEqual(["k00000004"]);
        const after = vocabularyOf(applied(parsed));
        expect(after.concepts.k00000004).toEqual({
            deleted: NOW,
            labels: ["tui"],
        });
        expect((after.concepts.k00000005 as Concept).broader).toEqual([]);
        expect(renderTagsTree(after, new Map())).toBe(
            [
                "dorothy (0)",
                "  memory (0)",
                "recollection (0)",
                "rendering (0)",
            ].join("\n"),
        );
    });

    it("folds a merged concept into the one named, labels and children too", () => {
        const parsed = parse(
            ["Tag: recollection\n", "Tag: recollection\nMerge: Recall\n"],
            ["Under: tui", "Under: tui; recollection"],
        );
        expect(editOf(parsed).merged).toEqual(
            new Map([["k00000003", "Recall"]]),
        );
        const after = vocabularyOf(applied(parsed));
        expect(after.concepts.k00000003).toEqual({
            mergedInto: "k00000002",
            at: NOW,
        });
        expect(after.concepts.k00000002).toMatchObject({
            altLabel: ["recall", "recollection"],
            edited: NOW,
        });
        expect((after.concepts.k00000005 as Concept).broader).toEqual([
            "k00000004",
            "k00000002",
        ]);
    });

    it("frees a deleted label the user gives to a concept", () => {
        const parsed = parse([
            "Also:\nUnder:\nNote:\nAbout tui.",
            "Also: misc\nUnder:\nNote:\nAbout tui.",
        ]);
        const after = vocabularyOf(applied(parsed));
        expect(after.concepts.k00000009).toBeUndefined();
        expect((after.concepts.k00000004 as Concept).altLabel).toEqual([
            "misc",
        ]);
    });

    it.each([
        [["Under: dorothy", "Owner: dorothy"], "there is no field Owner"],
        [
            ["Concept: k00000003", "Concept: k00000002"],
            "k00000002 appears twice",
        ],
        [
            ["Concept: k00000003", "Concept: k00000099"],
            "there is no concept k00000099",
        ],
        [["Tag: tui", "Tag:"], "k00000004: Tag can't be empty"],
        [["Tag: tui", "Tag: a;b"], '"a;b" contains ;'],
        [
            ["Also: recall", "Also: a; b; c; d; e; f"],
            "memory has more than 5 alternative labels",
        ],
        [
            ["Under: dorothy", "Under: dorothy\nUnder: tui"],
            "Under appears twice in one concept",
        ],
    ])("refuses %j", (swap, reason) => {
        expect(parse(swap as [string, string])).toEqual({
            kind: "error",
            reason,
        });
    });

    it("refuses a line in no concept and a new block that merges", () => {
        expect(parseTagsView(`stray words\n${VIEW}`, SMALL)).toEqual({
            kind: "error",
            reason: '"stray words" is in no concept',
        });
        expect(
            parseTagsView(
                `${VIEW}\nTag: new\nMerge: memory\nNote:\nN.\n`,
                SMALL,
            ),
        ).toEqual({
            kind: "error",
            reason: "new: a new concept can't be merged",
        });
        // A Tag: in a block that has one starts the next block.
        expect(parseTagsView(`${VIEW}\nTag: lonely\n`, SMALL)).toEqual({
            kind: "error",
            reason: "lonely: a new concept needs a Note:",
        });
    });

    it.each([
        [[["Under: tui", "Under: nowhere"]], "Under names no concept: nowhere"],
        [
            [
                [
                    "Under:\nNote:\nAbout dorothy.",
                    "Under: memory\nNote:\nAbout dorothy.",
                ],
            ],
            "dorothy is under itself",
        ],
        [[["Tag: tui", "Tag: memory"]], 'the label "memory" is used twice'],
        [
            [
                ["Tag: recollection\n", "Tag: recollection\nMerge: tui\n"],
                ["Tag: tui\n", "Tag: tui\nMerge: dorothy\n"],
            ],
            "tui is merged itself, so nothing can be merged into it",
        ],
        [
            [["Tag: recollection\n", "Tag: recollection\nMerge: misc\n"]],
            "Merge names no concept: misc",
        ],
    ])("refuses on applying %j", (swaps, reason) => {
        expect(applied(parse(...(swaps as [string, string][])))).toEqual({
            ok: false,
            reason,
        });
    });

    it.each([
        [
            "the intermediate block later",
            [
                ["Tag: recollection\n", "Tag: recollection\nMerge: tui\n"],
                ["Tag: tui\n", "Tag: tui\nMerge: dorothy\n"],
            ],
            "tui is merged itself, so nothing can be merged into it",
        ],
        [
            "the intermediate block earlier",
            [
                ["Tag: dorothy\n", "Tag: dorothy\nMerge: memory\n"],
                ["Tag: recollection\n", "Tag: recollection\nMerge: dorothy\n"],
            ],
            "dorothy is merged itself, so nothing can be merged into it",
        ],
    ])("refuses a merge chain, %s", (_order, swaps, reason) => {
        expect(applied(parse(...(swaps as [string, string][])))).toEqual({
            ok: false,
            reason,
        });
    });

    it("refuses a merge into a concept deleted in the same edit", () => {
        const parsed = parseTagsView(
            VIEW.replace(
                /Concept: k00000004\n[\s\S]*?conversations\)\n/,
                "",
            ).replace("Tag: recollection\n", "Tag: recollection\nMerge: tui\n"),
            SMALL,
        );
        expect(applied(parsed)).toEqual({
            ok: false,
            reason: "tui is deleted, so nothing can be merged into it",
        });
    });

    it("keeps what Dorothy coined meanwhile, unless the user's label clashes", () => {
        const meanwhile: Vocabulary = {
            ...SMALL,
            concepts: {
                ...SMALL.concepts,
                k000000ff: concept("tagging"),
            },
        };
        const kept = vocabularyOf(
            applied(parse(["Tag: tui", "Tag: terminal"]), meanwhile),
        );
        expect(kept.concepts.k000000ff).toEqual(concept("tagging"));
        expect(applied(parse(["Tag: tui", "Tag: Tagging"]), meanwhile)).toEqual(
            {
                ok: false,
                reason: 'the label "tagging" is used twice',
            },
        );
        const gone = { ...SMALL, concepts: { ...SMALL.concepts } };
        delete gone.concepts.k00000004;
        expect(applied(parse(["Tag: tui", "Tag: terminal"]), gone)).toEqual({
            ok: false,
            reason: "k00000004 has gone since the editor opened",
        });
    });
});
