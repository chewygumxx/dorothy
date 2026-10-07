// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/vocabulary.ts
//
//

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Env, xdgDir } from "../xdg.js";
import {
    CONCEPT_ID,
    characters,
    type Lock,
    normalise,
    type Recording,
    writeAtomic,
} from "./sidecar.js";

// In code points, as JSON Schema's maxLength counts them.
export const TAG_LIMITS = {
    label: 50,
    altLabels: 5,
    scopeNote: 160,
    tags: 5,
    coined: 3,
} as const;

export type Concept = {
    prefLabel: string;
    altLabel: string[];
    // Ids of live concepts; following them never comes back here.
    broader: string[];
    scopeNote: string;
    by: "dorothy" | "user";
    at: string;
    model?: string;
    // When the user last changed it.
    edited: string | null;
};
// A deleted concept keeps its labels, so they are never coined again.
export type Deleted = { deleted: string; labels: string[] };
// A merged concept points at the live concept it was folded into.
export type Merged = { mergedInto: string; at: string };
export type Term = Concept | Deleted | Merged;
export type Vocabulary = {
    v: 1;
    rev: number;
    concepts: Record<string, Term>;
};

export type VocabularyRead =
    | { kind: "none" }
    | { kind: "ok"; vocabulary: Vocabulary }
    | { kind: "unparseable"; reason: string };

export type VocabularyUpdate =
    | { kind: "written"; vocabulary: Vocabulary }
    | { kind: "unchanged"; vocabulary: Vocabulary }
    | { kind: "unparseable"; reason: string }
    | { kind: "failed"; reason: string };

export const EMPTY_VOCABULARY: Vocabulary = Object.freeze({
    v: 1,
    rev: 0,
    concepts: Object.freeze({}),
}) as Vocabulary;

export function vocabularyPath(env: Env = process.env): string {
    return join(
        xdgDir(env, "XDG_DATA_HOME", ".local/share"),
        "dorothy",
        "tags.json",
    );
}

export const isConcept = (term: Term | undefined): term is Concept =>
    term !== undefined && "prefLabel" in term;
export const isDeleted = (term: Term | undefined): term is Deleted =>
    term !== undefined && "deleted" in term;
export const isMerged = (term: Term | undefined): term is Merged =>
    term !== undefined && "mergedInto" in term;

// Two labels are one when their normal forms agree, case aside.
export const labelKey = (label: string) =>
    normalise(label).normalize("NFC").toLowerCase();

export const byLabel = (a: string, b: string) =>
    labelKey(a).localeCompare(labelKey(b)) || a.localeCompare(b);

export function labelProblem(label: string): string | null {
    if (label === "") {
        return "a tag label is empty";
    }
    if (label.includes(";")) {
        return `"${label}" contains ;`;
    }
    const count = characters(label);
    return count > TAG_LIMITS.label
        ? `"${label}" is ${count} characters, over ${TAG_LIMITS.label}`
        : null;
}

export function scopeNoteProblem(note: string): string | null {
    if (note === "") {
        return "a tag's note is empty";
    }
    const count = characters(note);
    return count > TAG_LIMITS.scopeNote
        ? `a tag's note is ${count} characters, over ${TAG_LIMITS.scopeNote}`
        : null;
}

export const labelsOf = (concept: Concept) => [
    concept.prefLabel,
    ...concept.altLabel,
];

export function liveConcepts(v: Vocabulary): [string, Concept][] {
    return Object.entries(v.concepts)
        .filter((entry): entry is [string, Concept] => isConcept(entry[1]))
        .sort(([, a], [, b]) => byLabel(a.prefLabel, b.prefLabel));
}

// The live concept a label names, by its preferred or an alternative label.
export function resolveLabel(v: Vocabulary, label: string): string | null {
    const key = labelKey(label);
    for (const [id, term] of Object.entries(v.concepts)) {
        if (
            isConcept(term) &&
            labelsOf(term).some((own) => labelKey(own) === key)
        ) {
            return id;
        }
    }
    return null;
}

// A label a deleted concept left behind, which nobody coins again.
export function isBlocked(v: Vocabulary, label: string): boolean {
    const key = labelKey(label);
    return Object.values(v.concepts).some(
        (term) =>
            isDeleted(term) && term.labels.some((own) => labelKey(own) === key),
    );
}

// The live concept an id stands for now: itself, or its merge's survivor.
export function resolveId(v: Vocabulary, id: string): string | null {
    const term = v.concepts[id];
    if (isConcept(term)) {
        return id;
    }
    return isMerged(term) && isConcept(v.concepts[term.mergedInto])
        ? term.mergedInto
        : null;
}

// A conversation's tags as they stand: merges followed, the gone dropped,
// no duplicates, at most 5.
export function resolveTags(v: Vocabulary, ids: readonly string[]): string[] {
    const tags: string[] = [];
    for (const id of ids) {
        const live = resolveId(v, id);
        if (live !== null && !tags.includes(live)) {
            tags.push(live);
        }
    }
    return tags.slice(0, TAG_LIMITS.tags);
}

// A concept and everything broader, through every parent; finite even if
// a cycle slipped in.
export function ancestorsOf(v: Vocabulary, id: string): Set<string> {
    const seen = new Set<string>();
    const stack = [id];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
        if (seen.has(next)) {
            continue;
        }
        seen.add(next);
        const term = v.concepts[next];
        if (isConcept(term)) {
            stack.push(...term.broader);
        }
    }
    return seen;
}

// Putting id under parent would make id broader than itself.
export const wouldCycle = (v: Vocabulary, id: string, parent: string) =>
    ancestorsOf(v, parent).has(id);

// Each live concept's live children, in label order.
export function narrowerOf(v: Vocabulary): Map<string, string[]> {
    const children = new Map<string, string[]>();
    for (const [id, concept] of liveConcepts(v)) {
        for (const parent of concept.broader) {
            children.set(parent, [...(children.get(parent) ?? []), id]);
        }
    }
    return children;
}

export function parentLabels(v: Vocabulary, concept: Concept): string[] {
    return concept.broader
        .map((parent) => v.concepts[parent])
        .filter(isConcept)
        .map((parent) => parent.prefLabel)
        .sort(byLabel);
}

export function newId(
    v: Vocabulary,
    random: (size: number) => Uint8Array = randomBytes,
): string {
    for (;;) {
        const id = `k${Buffer.from(random(4)).toString("hex")}`;
        if (!Object.hasOwn(v.concepts, id)) {
            return id;
        }
    }
}

// What breaks the vocabulary's rules, worded for the user, or null.
export function vocabularyProblem(v: Vocabulary): string | null {
    const owners = new Set<string>();
    for (const [id, term] of Object.entries(v.concepts)) {
        const labels = isConcept(term)
            ? labelsOf(term)
            : isDeleted(term)
              ? term.labels
              : [];
        for (const label of labels) {
            const key = labelKey(label);
            if (owners.has(key)) {
                return `the label "${label}" is used twice`;
            }
            owners.add(key);
        }
        if (isConcept(term)) {
            for (const parent of term.broader) {
                if (!isConcept(v.concepts[parent])) {
                    return `${term.prefLabel} is under ${parent}, which is not a concept`;
                }
            }
        }
        if (isMerged(term) && !isConcept(v.concepts[term.mergedInto])) {
            return `${id} was merged into ${term.mergedInto}, which is not a concept`;
        }
    }
    for (const [id, term] of Object.entries(v.concepts)) {
        if (
            isConcept(term) &&
            term.broader.some((parent) => wouldCycle(v, id, parent))
        ) {
            return `${term.prefLabel} is under itself`;
        }
    }
    return null;
}

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const isList = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string");

// A concept or tombstone as written, or the reason it cannot be read.
function readTerm(id: string, value: unknown): Term | string {
    if (!CONCEPT_ID.test(id)) {
        return `${id} is not a concept id`;
    }
    if (!isRecord(value)) {
        return `${id} is not an object`;
    }
    if ("prefLabel" in value || "scopeNote" in value) {
        if (typeof value.prefLabel !== "string") {
            return `${id} has no prefLabel`;
        }
        if (typeof value.scopeNote !== "string") {
            return `${id} has no scopeNote`;
        }
        const altLabel = value.altLabel ?? [];
        const broader = value.broader ?? [];
        if (!isList(altLabel) || !isList(broader)) {
            return `${id}'s altLabel and broader must be lists`;
        }
        if (
            (value.by !== "dorothy" && value.by !== "user") ||
            typeof value.at !== "string" ||
            (value.model !== undefined && typeof value.model !== "string") ||
            (value.edited !== undefined &&
                value.edited !== null &&
                typeof value.edited !== "string")
        ) {
            return `${id}'s by, at, model or edited is not as written`;
        }
        const concept: Concept = {
            prefLabel: normalise(value.prefLabel),
            altLabel: altLabel.map(normalise),
            broader: [...new Set(broader)],
            scopeNote: normalise(value.scopeNote),
            by: value.by,
            at: value.at,
            ...(typeof value.model === "string" ? { model: value.model } : {}),
            edited: typeof value.edited === "string" ? value.edited : null,
        };
        if (concept.altLabel.length > TAG_LIMITS.altLabels) {
            return `${id} has more than ${TAG_LIMITS.altLabels} alternative labels`;
        }
        const problem =
            labelsOf(concept)
                .map(labelProblem)
                .find((p) => p !== null) ?? scopeNoteProblem(concept.scopeNote);
        return problem === null ? concept : `${id}: ${problem}`;
    }
    if ("deleted" in value) {
        return typeof value.deleted === "string" && isList(value.labels)
            ? {
                  deleted: value.deleted,
                  labels: value.labels
                      .map(normalise)
                      .filter((label) => label !== ""),
              }
            : `${id}'s deleted or labels is not as written`;
    }
    if ("mergedInto" in value) {
        return typeof value.mergedInto === "string" &&
            typeof value.at === "string"
            ? { mergedInto: value.mergedInto, at: value.at }
            : `${id}'s mergedInto or at is not as written`;
    }
    return `${id} is neither a concept nor a tombstone`;
}

// Unlike a sidecar, any departure from the rules makes the whole file
// unparseable: tags are paused rather than guessed at.
export function parseVocabulary(
    text: string,
): Exclude<VocabularyRead, { kind: "none" }> {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (error) {
        return { kind: "unparseable", reason: describeError(error) };
    }
    if (!isRecord(data)) {
        return { kind: "unparseable", reason: "not a JSON object" };
    }
    if (data.v !== 1) {
        return {
            kind: "unparseable",
            reason: `unknown version ${JSON.stringify(data.v)}`,
        };
    }
    if (!isRecord(data.concepts)) {
        return { kind: "unparseable", reason: "concepts is not an object" };
    }
    const vocabulary: Vocabulary = {
        v: 1,
        rev:
            typeof data.rev === "number" &&
            Number.isInteger(data.rev) &&
            data.rev >= 0
                ? data.rev
                : 0,
        concepts: {},
    };
    for (const [id, value] of Object.entries(data.concepts)) {
        const term = readTerm(id, value);
        if (typeof term === "string") {
            return { kind: "unparseable", reason: term };
        }
        vocabulary.concepts[id] = term;
    }
    const problem = vocabularyProblem(vocabulary);
    return problem === null
        ? { kind: "ok", vocabulary }
        : { kind: "unparseable", reason: problem };
}

export async function readVocabulary(path: string): Promise<VocabularyRead> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") {
            return { kind: "none" };
        }
        return { kind: "unparseable", reason: describeError(error) };
    }
    return parseVocabulary(text);
}

// For a writer already holding the lock, as a review's sidecar write does.
export function writeVocabulary(path: string, v: Vocabulary): Promise<void> {
    return writeAtomic(path, `${JSON.stringify(v, null, 2)}\n`);
}

// Writers in this process take turns, as updateSidecar's do.
const queues = new Map<string, Promise<VocabularyUpdate>>();

// The change sees the vocabulary as it is now; a missing file is empty,
// and a broken one is never written.
export function updateVocabulary(
    path: string,
    change: (current: Vocabulary) => Vocabulary | null,
    lock?: Lock,
    record?: Recording,
): Promise<VocabularyUpdate> {
    const write = async (): Promise<VocabularyUpdate> => {
        const read = await readVocabulary(path);
        if (read.kind === "unparseable") {
            return read;
        }
        const current = read.kind === "ok" ? read.vocabulary : EMPTY_VOCABULARY;
        const next = change(current);
        if (next === null) {
            return { kind: "unchanged", vocabulary: current };
        }
        const vocabulary = { ...next, rev: current.rev + 1 };
        await writeVocabulary(path, vocabulary);
        await record?.recorder([path, ...(record.also ?? [])], record.message);
        return { kind: "written", vocabulary };
    };
    const run = lock === undefined ? write : () => lock(write);
    const result = (queues.get(path) ?? Promise.resolve()).then(run).catch(
        (error: unknown): VocabularyUpdate => ({
            kind: "failed",
            reason: describeError(error),
        }),
    );
    queues.set(path, result);
    void result.then(() => {
        if (queues.get(path) === result) {
            queues.delete(path);
        }
    });
    return result;
}
