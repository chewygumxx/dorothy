// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/tags-view.ts
//
//

import { wrap } from "./edit-view.js";
import { normalise } from "./sidecar.js";
import {
    type Concept,
    isConcept,
    isDeleted,
    isMerged,
    labelKey,
    labelProblem,
    labelsOf,
    liveConcepts,
    narrowerOf,
    newId,
    parentLabels,
    resolveLabel,
    scopeNoteProblem,
    TAG_LIMITS,
    type Vocabulary,
    vocabularyProblem,
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

const FIELD = /^(Concept|Tag|Also|Under|Merge|Note):(.*)$/;
const UNKNOWN = /^([A-Z][A-Za-z-]*):/;
const day = (at: string) => at.slice(0, 10);
const list = (labels: readonly string[]) => labels.join("; ");
const listOf = (text: string) =>
    text
        .split(";")
        .map(normalise)
        .filter((label) => label !== "");

const HEADER_LINES = [
    "# Dorothy's vocabulary. Lines starting with # are ignored.",
    "# Change a concept to make it yours. Delete a block to delete its concept;",
    "# Dorothy won't coin its labels again. Merge: folds a concept into another.",
    "# Add a block without Concept: to create one. Lists are separated by ;.",
];

// Who made it, and how many chats carry it, hidden ones too.
function provenance(concept: Concept, count: number): string {
    const who =
        concept.edited !== null
            ? `yours, ${day(concept.edited)}`
            : concept.by === "user"
              ? `yours, ${day(concept.at)}`
              : [
                    "Dorothy",
                    ...(concept.model === undefined ? [] : [concept.model]),
                    day(concept.at),
                ].join(", ");
    return `# (${who}; ${count} ${count === 1 ? "conversation" : "conversations"})`;
}

export function renderTagsView(
    v: Vocabulary,
    counts: ReadonlyMap<string, number>,
): string {
    const lines = [...HEADER_LINES];
    for (const [id, concept] of liveConcepts(v)) {
        lines.push(
            "",
            `Concept: ${id}`,
            `Tag: ${concept.prefLabel}`,
            `Also: ${list(concept.altLabel)}`.trimEnd(),
            `Under: ${list(parentLabels(v, concept))}`.trimEnd(),
            "Note:",
            ...wrap(concept.scopeNote, undefined, FIELD),
            provenance(concept, counts.get(id) ?? 0),
        );
    }
    return `${lines.join("\n")}\n`;
}

// A field left out keeps its value; Under and Merge name concepts by label.
export type ConceptChange = {
    tag?: string;
    also?: string[];
    under?: string[];
    note?: string;
};
export type ConceptDraft = {
    tag: string;
    also: string[];
    under: string[];
    note: string;
};
export type TagsEdit = {
    changed: Map<string, ConceptChange>;
    created: ConceptDraft[];
    deleted: string[];
    // Each folded concept, and the label of the one it folds into.
    merged: Map<string, string>;
};
export type TagsParse =
    | { kind: "unchanged" }
    | { kind: "error"; reason: string }
    | { kind: "edit"; edit: TagsEdit };

// shown: the vocabulary the view was rendered from. Only what differs from
// it, whitespace aside, is an edit; a rendered block that is gone is a
// deletion.
export function parseTagsView(text: string, shown: Vocabulary): TagsParse {
    const error = (reason: string): TagsParse => ({ kind: "error", reason });
    // Some editors save a byte order mark at the start of the file.
    const lines = text
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .filter((line) => !line.startsWith("#"));
    if (lines.every((line) => line.trim() === "")) {
        return { kind: "unchanged" };
    }
    // A block starts at Concept:, or at a Tag: in no block that has one.
    const blocks: Map<string, string[]>[] = [];
    let block: Map<string, string[]> | null = null;
    let inNote = false;
    for (const line of lines) {
        const field = FIELD.exec(line);
        if (field === null) {
            if (inNote && block !== null) {
                block.get("Note")?.push(line);
                continue;
            }
            if (line.trim() === "") {
                continue;
            }
            const unknown = UNKNOWN.exec(line);
            return error(
                unknown === null
                    ? `"${line.trim()}" is in no concept`
                    : `there is no field ${unknown[1]}`,
            );
        }
        const [, name = "", rest = ""] = field;
        if (
            name === "Concept" ||
            (name === "Tag" && (block === null || block.has("Tag")))
        ) {
            block = new Map();
            blocks.push(block);
        }
        if (block === null) {
            return error(`${name}: is in no concept`);
        }
        if (block.has(name)) {
            return error(`${name} appears twice in one concept`);
        }
        block.set(name, [rest]);
        inNote = name === "Note";
    }

    const live = new Map(liveConcepts(shown));
    const edit: TagsEdit = {
        changed: new Map(),
        created: [],
        deleted: [],
        merged: new Map(),
    };
    const seen = new Set<string>();
    for (const fields of blocks) {
        const value = (name: string) => {
            const given = fields.get(name);
            return given === undefined ? undefined : normalise(given.join(" "));
        };
        const id = value("Concept") || undefined;
        const tag = value("Tag");
        const note = value("Note");
        const merge = value("Merge") || undefined;
        const alsoText = value("Also");
        const underText = value("Under");
        const also = alsoText === undefined ? undefined : listOf(alsoText);
        const under = underText === undefined ? undefined : listOf(underText);
        const name = tag || id || "a new concept";
        if (tag === "") {
            return error(`${name}: Tag can't be empty`);
        }
        if (note === "") {
            return error(`${name}: Note can't be empty`);
        }
        for (const label of [
            ...(tag === undefined ? [] : [tag]),
            ...(also ?? []),
        ]) {
            const problem = labelProblem(label);
            if (problem !== null) {
                return error(problem);
            }
        }
        const noteProblem = note === undefined ? null : scopeNoteProblem(note);
        if (noteProblem !== null) {
            return error(noteProblem);
        }
        if (also !== undefined && also.length > TAG_LIMITS.altLabels) {
            return error(
                `${name} has more than ${TAG_LIMITS.altLabels} alternative labels`,
            );
        }
        if (id === undefined) {
            if (merge !== undefined) {
                return error(`${name}: a new concept can't be merged`);
            }
            if (tag === undefined || note === undefined) {
                return error(`${name}: a new concept needs a Note:`);
            }
            edit.created.push({
                tag,
                also: also ?? [],
                under: under ?? [],
                note,
            });
            continue;
        }
        const concept = live.get(id);
        if (seen.has(id)) {
            return error(`${id} appears twice`);
        }
        if (concept === undefined) {
            return error(`there is no concept ${id}`);
        }
        seen.add(id);
        if (merge !== undefined) {
            edit.merged.set(id, merge);
            continue;
        }
        const change: ConceptChange = {};
        if (tag !== undefined && tag !== concept.prefLabel) {
            change.tag = tag;
        }
        if (also !== undefined && list(also) !== list(concept.altLabel)) {
            change.also = also;
        }
        if (
            under !== undefined &&
            list(under) !== list(parentLabels(shown, concept))
        ) {
            change.under = under;
        }
        if (note !== undefined && note !== concept.scopeNote) {
            change.note = note;
        }
        if (Object.keys(change).length > 0) {
            edit.changed.set(id, change);
        }
    }
    for (const id of live.keys()) {
        if (!seen.has(id)) {
            edit.deleted.push(id);
        }
    }
    const nothing =
        edit.changed.size === 0 &&
        edit.created.length === 0 &&
        edit.deleted.length === 0 &&
        edit.merged.size === 0;
    return nothing ? { kind: "unchanged" } : { kind: "edit", edit };
}

// The user's edit, applied to the vocabulary as it is now: labels and notes
// first, so Under and Merge name concepts as they stand after the edit;
// then parents, merges and deletions; then the rules are checked whole.
export function applyTagsEdit(
    current: Vocabulary,
    edit: TagsEdit,
    at: string,
    random?: (size: number) => Uint8Array,
): { ok: true; vocabulary: Vocabulary } | { ok: false; reason: string } {
    const fail = (reason: string) => ({ ok: false as const, reason });
    const v: Vocabulary = { ...current, concepts: { ...current.concepts } };
    const live = (id: string) => v.concepts[id] as Concept;
    for (const id of [
        ...edit.changed.keys(),
        ...edit.deleted,
        ...edit.merged.keys(),
    ]) {
        if (!isConcept(v.concepts[id])) {
            return fail(`${id} has gone since the editor opened`);
        }
    }
    for (const [id, change] of edit.changed) {
        const old = live(id);
        v.concepts[id] = {
            ...old,
            prefLabel: change.tag ?? old.prefLabel,
            altLabel: change.also ?? old.altLabel,
            scopeNote: change.note ?? old.scopeNote,
            edited: at,
        };
    }
    const parents: [string, string[]][] = [];
    for (const [id, change] of edit.changed) {
        if (change.under !== undefined) {
            parents.push([id, change.under]);
        }
    }
    for (const draft of edit.created) {
        const id = newId(v, random);
        v.concepts[id] = {
            prefLabel: draft.tag,
            altLabel: draft.also,
            broader: [],
            scopeNote: draft.note,
            by: "user",
            at,
            edited: null,
        };
        parents.push([id, draft.under]);
    }
    // Merge targets are named as the labels stand before any deletion or
    // merge, so a chain or a merge into a deleted concept is seen as one
    // whatever the order of the blocks.
    const targets = new Map<string, string | null>();
    for (const [source, label] of edit.merged) {
        targets.set(source, resolveLabel(v, label));
    }
    for (const id of edit.deleted) {
        v.concepts[id] = { deleted: at, labels: labelsOf(live(id)) };
    }
    for (const [id, labels] of parents) {
        const broader: string[] = [];
        for (const label of labels) {
            const parent = resolveLabel(v, label);
            if (parent === null) {
                return fail(`Under names no concept: ${label}`);
            }
            if (!broader.includes(parent)) {
                broader.push(parent);
            }
        }
        v.concepts[id] = { ...live(id), broader };
    }
    const sources = new Set(edit.merged.keys());
    for (const [source, label] of edit.merged) {
        const target = targets.get(source) ?? null;
        if (target === null) {
            return fail(`Merge names no concept: ${label}`);
        }
        if (target === source) {
            return fail(`${label} can't be merged into itself`);
        }
        if (sources.has(target)) {
            return fail(
                `${label} is merged itself, so nothing can be merged into it`,
            );
        }
        if (edit.deleted.includes(target)) {
            return fail(
                `${label} is deleted, so nothing can be merged into it`,
            );
        }
        const from = live(source);
        const into = live(target);
        v.concepts[source] = { mergedInto: target, at };
        const taken = new Set(labelsOf(into).map(labelKey));
        const altLabel = [...into.altLabel];
        for (const moved of labelsOf(from)) {
            if (
                altLabel.length < TAG_LIMITS.altLabels &&
                !taken.has(labelKey(moved))
            ) {
                altLabel.push(moved);
                taken.add(labelKey(moved));
            }
        }
        v.concepts[target] = { ...into, altLabel, edited: at };
        for (const [id, term] of Object.entries(v.concepts)) {
            if (isConcept(term) && term.broader.includes(source)) {
                v.concepts[id] = {
                    ...term,
                    broader: [
                        ...new Set(
                            term.broader.map((parent) =>
                                parent === source ? target : parent,
                            ),
                        ),
                    ].filter((parent) => parent !== id),
                };
            } else if (isMerged(term) && term.mergedInto === source) {
                v.concepts[id] = { ...term, mergedInto: target };
            }
        }
    }
    const deleted = new Set(edit.deleted);
    for (const [id, term] of Object.entries(v.concepts)) {
        if (isMerged(term) && deleted.has(term.mergedInto)) {
            delete v.concepts[id];
        } else if (
            isConcept(term) &&
            term.broader.some((parent) => deleted.has(parent))
        ) {
            v.concepts[id] = {
                ...term,
                broader: term.broader.filter((parent) => !deleted.has(parent)),
            };
        }
    }
    // A label the user gave a live concept is no longer blocked.
    const liveKeys = new Set(
        Object.values(v.concepts)
            .filter(isConcept)
            .flatMap(labelsOf)
            .map(labelKey),
    );
    for (const [id, term] of Object.entries(v.concepts)) {
        if (isDeleted(term)) {
            const labels = term.labels.filter(
                (label) => !liveKeys.has(labelKey(label)),
            );
            if (labels.length === 0) {
                delete v.concepts[id];
            } else if (labels.length !== term.labels.length) {
                v.concepts[id] = { ...term, labels };
            }
        }
    }
    const problem = vocabularyProblem(v);
    return problem === null ? { ok: true, vocabulary: v } : fail(problem);
}
