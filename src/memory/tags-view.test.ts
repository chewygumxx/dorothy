// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/tags-view.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { renderTagsTree } from "./tags-view.js";
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
