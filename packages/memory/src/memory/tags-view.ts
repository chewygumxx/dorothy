// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/tags-view.ts
//
//

import { viewLines, wrap } from "./edit-view.js";
import { localDay as day } from "./list.js";
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
    const lines = viewLines(text);
    if (lines === null) {
        return { kind: "unchanged" };
    }
    const blocks = readBlocks(lines);
    if (typeof blocks === "string") {
        return { kind: "error", reason: blocks };
    }
    const live = new Map(liveConcepts(shown));
    const seen = new Set<string>();
    const edit: TagsEdit = {
        changed: new Map(),
        created: [],
        deleted: [],
        merged: new Map(),
    };
    for (const block of blocks) {
        const fields = fieldsOf(block);
        const problem =
            blockProblem(fields) ??
            addBlock(edit, fields, { live, seen, shown });
        if (problem !== null) {
            return { kind: "error", reason: problem };
        }
    }
    edit.deleted.push(...[...live.keys()].filter((id) => !seen.has(id)));
    return isEmpty(edit) ? { kind: "unchanged" } : { kind: "edit", edit };
}

// A block of the view: each field it gives, with its lines.
type Block = Map<string, string[]>;

// The view's lines as blocks, or why they are not. A block starts at
// Concept:, or at a Tag: in no block that has one; a Note: runs on to the
// next field.
function readBlocks(lines: readonly string[]): Block[] | string {
    const blocks: Block[] = [];
    let block: Block | null = null;
    let inNote = false;
    for (const line of lines) {
        const field = FIELD.exec(line);
        if (field === null) {
            if (inNote) {
                block?.get("Note")?.push(line);
            } else if (line.trim() !== "") {
                return strayLine(line);
            }
            continue;
        }
        const [, name = "", rest = ""] = field;
        if (startsBlock(name, block)) {
            block = new Map();
            blocks.push(block);
        }
        if (block === null) {
            return `${name}: is in no concept`;
        }
        if (block.has(name)) {
            return `${name} appears twice in one concept`;
        }
        block.set(name, [rest]);
        inNote = name === "Note";
    }
    return blocks;
}

const startsBlock = (name: string, block: Block | null) =>
    name === "Concept" ||
    (name === "Tag" && (block === null || block.has("Tag")));

function strayLine(line: string): string {
    const unknown = UNKNOWN.exec(line);
    return unknown === null
        ? `"${line.trim()}" is in no concept`
        : `there is no field ${unknown[1]}`;
}

// A block's fields, normalised; undefined for one it leaves out.
type Fields = {
    id: string | undefined;
    tag: string | undefined;
    also: string[] | undefined;
    under: string[] | undefined;
    note: string | undefined;
    merge: string | undefined;
    // What its errors call it.
    name: string;
};

function fieldsOf(block: Block): Fields {
    const value = (name: string) => {
        const given = block.get(name);
        return given === undefined ? undefined : normalise(given.join(" "));
    };
    const listValue = (name: string) => {
        const text = value(name);
        return text === undefined ? undefined : listOf(text);
    };
    const id = value("Concept") || undefined;
    const tag = value("Tag");
    return {
        id,
        tag,
        also: listValue("Also"),
        under: listValue("Under"),
        note: value("Note"),
        merge: value("Merge") || undefined,
        name: tag || id || "a new concept",
    };
}

// What is wrong with a block's own fields, before it is compared.
function blockProblem({ name, tag, also, note }: Fields): string | null {
    if (tag === "") {
        return `${name}: Tag can't be empty`;
    }
    if (note === "") {
        return `${name}: Note can't be empty`;
    }
    for (const label of [
        ...(tag === undefined ? [] : [tag]),
        ...(also ?? []),
    ]) {
        const problem = labelProblem(label);
        if (problem !== null) {
            return problem;
        }
    }
    const noteProblem = note === undefined ? null : scopeNoteProblem(note);
    if (noteProblem !== null) {
        return noteProblem;
    }
    return also !== undefined && also.length > TAG_LIMITS.altLabels
        ? `${name} has more than ${TAG_LIMITS.altLabels} alternative labels`
        : null;
}

// Adds a block to the edit, as a new concept, a merge or a change to the
// concept it names; or says why it can't.
function addBlock(
    edit: TagsEdit,
    fields: Fields,
    {
        live,
        seen,
        shown,
    }: {
        live: ReadonlyMap<string, Concept>;
        seen: Set<string>;
        shown: Vocabulary;
    },
): string | null {
    const { id } = fields;
    if (id === undefined) {
        const draft = draftOf(fields);
        if (typeof draft === "string") {
            return draft;
        }
        edit.created.push(draft);
        return null;
    }
    const concept = live.get(id);
    if (seen.has(id)) {
        return `${id} appears twice`;
    }
    if (concept === undefined) {
        return `there is no concept ${id}`;
    }
    seen.add(id);
    if (fields.merge !== undefined) {
        edit.merged.set(id, fields.merge);
        return null;
    }
    const change = changeOf(fields, concept, shown);
    if (Object.keys(change).length > 0) {
        edit.changed.set(id, change);
    }
    return null;
}

function draftOf({
    name,
    tag,
    also,
    under,
    note,
    merge,
}: Fields): ConceptDraft | string {
    if (merge !== undefined) {
        return `${name}: a new concept can't be merged`;
    }
    if (tag === undefined) {
        return `${name}: a new concept needs a Tag:`;
    }
    if (note === undefined) {
        return `${name}: a new concept needs a Note:`;
    }
    return { tag, also: also ?? [], under: under ?? [], note };
}

// The fields that differ from the concept as it was shown.
function changeOf(
    { tag, also, under, note }: Fields,
    concept: Concept,
    shown: Vocabulary,
): ConceptChange {
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
    return change;
}

const isEmpty = (edit: TagsEdit) =>
    edit.changed.size === 0 &&
    edit.created.length === 0 &&
    edit.deleted.length === 0 &&
    edit.merged.size === 0;

// The user's edit, applied to the vocabulary as it is now: labels and notes
// first, so Under and Merge name concepts as they stand after the edit;
// then parents, merges and deletions; then the rules are checked whole.
export function applyTagsEdit(
    current: Vocabulary,
    edit: TagsEdit,
    at: string,
    random?: (size: number) => Uint8Array,
): { ok: true; vocabulary: Vocabulary } | { ok: false; reason: string } {
    const v: Vocabulary = { ...current, concepts: { ...current.concepts } };
    const gone = [
        ...edit.changed.keys(),
        ...edit.deleted,
        ...edit.merged.keys(),
    ].find((id) => !isConcept(v.concepts[id]));
    if (gone !== undefined) {
        return {
            ok: false,
            reason: `${gone} has gone since the editor opened`,
        };
    }
    relabel(v, edit.changed, at);
    const parents = [
        ...[...edit.changed].flatMap(([id, change]) =>
            change.under === undefined
                ? []
                : [[id, change.under] as [string, string[]]],
        ),
        ...create(v, edit.created, at, random),
    ];
    // Merge targets are named as the labels stand before any deletion or
    // merge, so a chain or a merge into a deleted concept is seen as one
    // whatever the order of the blocks.
    const targets = new Map(
        [...edit.merged].map(([source, label]) => [
            source,
            resolveLabel(v, label),
        ]),
    );
    for (const id of edit.deleted) {
        v.concepts[id] = { deleted: at, labels: labelsOf(conceptIn(v, id)) };
    }
    const problem = setParents(v, parents) ?? mergeAll(v, edit, targets, at);
    if (problem !== null) {
        return { ok: false, reason: problem };
    }
    forgetDeleted(v, new Set(edit.deleted));
    unblockLabels(v);
    const invalid = vocabularyProblem(v);
    return invalid === null
        ? { ok: true, vocabulary: v }
        : { ok: false, reason: invalid };
}

// A concept applyTagsEdit has checked is live.
const conceptIn = (v: Vocabulary, id: string) => v.concepts[id] as Concept;

// The changed labels and notes, made the user's.
function relabel(
    v: Vocabulary,
    changed: ReadonlyMap<string, ConceptChange>,
    at: string,
): void {
    for (const [id, change] of changed) {
        const old = conceptIn(v, id);
        v.concepts[id] = {
            ...old,
            prefLabel: change.tag ?? old.prefLabel,
            altLabel: change.also ?? old.altLabel,
            scopeNote: change.note ?? old.scopeNote,
            edited: at,
        };
    }
}

// The new concepts, the user's, with the parents each names.
function create(
    v: Vocabulary,
    drafts: readonly ConceptDraft[],
    at: string,
    random?: (size: number) => Uint8Array,
): [string, string[]][] {
    return drafts.map((draft) => {
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
        return [id, draft.under];
    });
}

// Each concept's parents, by label; or the first label that names none.
function setParents(
    v: Vocabulary,
    parents: readonly [string, string[]][],
): string | null {
    for (const [id, labels] of parents) {
        const broader: string[] = [];
        for (const label of labels) {
            const parent = resolveLabel(v, label);
            if (parent === null) {
                return `Under names no concept: ${label}`;
            }
            if (!broader.includes(parent)) {
                broader.push(parent);
            }
        }
        v.concepts[id] = { ...conceptIn(v, id), broader };
    }
    return null;
}

// Each merge, once checked against the others and the deletions.
function mergeAll(
    v: Vocabulary,
    edit: TagsEdit,
    targets: ReadonlyMap<string, string | null>,
    at: string,
): string | null {
    const sources = new Set(edit.merged.keys());
    for (const [source, label] of edit.merged) {
        const target = targets.get(source) ?? null;
        if (target === null) {
            return `Merge names no concept: ${label}`;
        }
        if (target === source) {
            return `${label} can't be merged into itself`;
        }
        if (sources.has(target)) {
            return `${label} is merged itself, so nothing can be merged into it`;
        }
        if (edit.deleted.includes(target)) {
            return `${label} is deleted, so nothing can be merged into it`;
        }
        merge(v, source, target, at);
    }
    return null;
}

// Folds source into target: its labels become the target's alternatives,
// as many as fit, and whatever pointed at it points at the target.
function merge(v: Vocabulary, source: string, target: string, at: string) {
    const from = conceptIn(v, source);
    const into = conceptIn(v, target);
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

// Nothing points at a deleted concept: a merge into it goes, and a child
// loses it as a parent.
function forgetDeleted(v: Vocabulary, deleted: ReadonlySet<string>): void {
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
}

// A label the user gave a live concept is no longer blocked.
function unblockLabels(v: Vocabulary): void {
    const liveKeys = new Set(
        Object.values(v.concepts)
            .filter(isConcept)
            .flatMap(labelsOf)
            .map(labelKey),
    );
    for (const [id, term] of Object.entries(v.concepts)) {
        if (!isDeleted(term)) {
            continue;
        }
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
