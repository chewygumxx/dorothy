// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/tags-view.ts
//
//

import {
    type Concept,
    liveConcepts,
    narrowerOf,
    type Vocabulary,
} from "./vocabulary.js";

// The hierarchy for the user, roots first, children indented two spaces,
// each level in label order. A concept with several parents appears under
// each; its subtree is printed the first time only.
export function renderTagsTree(
    v: Vocabulary,
    counts: ReadonlyMap<string, number>,
): string {
    const children = narrowerOf(v);
    const lines: string[] = [];
    const shown = new Set<string>();
    const visit = (id: string, depth: number) => {
        const concept = v.concepts[id] as Concept;
        const count = counts.get(id) ?? 0;
        const indent = "  ".repeat(depth);
        if (shown.has(id)) {
            lines.push(`${indent}${concept.prefLabel} (${count}, see above)`);
            return;
        }
        shown.add(id);
        lines.push(`${indent}${concept.prefLabel} (${count})`);
        for (const child of children.get(id) ?? []) {
            visit(child, depth + 1);
        }
    };
    for (const [id, concept] of liveConcepts(v)) {
        if (concept.broader.length === 0) {
            visit(id, 0);
        }
    }
    return lines.join("\n");
}
