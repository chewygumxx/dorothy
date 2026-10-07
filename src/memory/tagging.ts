// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/tagging.ts
//
//

import { unescapeXml } from "./block.js";
import { normalise } from "./sidecar.js";
import {
    ancestorsOf,
    type Concept,
    isBlocked,
    labelKey,
    labelProblem,
    liveConcepts,
    newId,
    resolveLabel,
    resolveTags,
    scopeNoteProblem,
    TAG_LIMITS,
    type Vocabulary,
    wouldCycle,
} from "./vocabulary.js";

export type Coined = {
    prefLabel: string;
    altLabel: string[];
    broader: string[];
    scopeNote: string;
};
export type TagOutput = { tags: string[]; coined: Coined[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
// What the model echoes of escaped text is read as text.
const clean = (text: string) => normalise(unescapeXml(text));
const strings = (value: unknown): string[] =>
    Array.isArray(value)
        ? value
              .filter((item): item is string => typeof item === "string")
              .map(clean)
        : [];

// Read leniently: a bad tag never fails a review, so whatever is not as
// asked reads as absent.
export function readTagOutput(output: unknown): TagOutput {
    const fields = isRecord(output) ? output : {};
    const coined = (Array.isArray(fields.coined) ? fields.coined : []).flatMap(
        (item): Coined[] =>
            isRecord(item) &&
            typeof item.prefLabel === "string" &&
            typeof item.scopeNote === "string"
                ? [
                      {
                          prefLabel: clean(item.prefLabel),
                          altLabel: strings(item.altLabel),
                          broader: strings(item.broader),
                          scopeNote: clean(item.scopeNote),
                      },
                  ]
                : [],
    );
    return { tags: strings(fields.tags), coined };
}

export type Tagged = {
    vocabulary: Vocabulary;
    // How many concepts were coined; none means the vocabulary is as given.
    coined: number;
    // The conversation's tags, by id.
    tags: string[];
    // What was left out, for tests.
    dropped: string[];
};

// Her tags against the vocabulary as it stands: a coin of a known label is
// a reuse, a deleted label is never coined, and an edge that would close a
// cycle is dropped. The vocabulary given is not changed.
export function applyTagging(
    current: Vocabulary,
    output: TagOutput,
    stamp: { at: string; model: string },
    random?: (size: number) => Uint8Array,
): Tagged {
    const vocabulary: Vocabulary = {
        ...current,
        concepts: { ...current.concepts },
    };
    const dropped: string[] = [];
    const made: { concept: Concept; id: string; broader: string[] }[] = [];
    for (const coin of output.coined) {
        const label = coin.prefLabel;
        if (resolveLabel(vocabulary, label) !== null) {
            continue;
        }
        if (made.length === TAG_LIMITS.coined) {
            dropped.push(`coined "${label}"`);
            continue;
        }
        const problem =
            labelProblem(label) ??
            (isBlocked(vocabulary, label)
                ? `"${label}" was deleted by the user`
                : null) ??
            scopeNoteProblem(coin.scopeNote);
        if (problem !== null) {
            dropped.push(problem);
            continue;
        }
        const keys = new Set([labelKey(label)]);
        const altLabel: string[] = [];
        for (const alt of coin.altLabel) {
            if (
                keys.has(labelKey(alt)) ||
                labelProblem(alt) !== null ||
                resolveLabel(vocabulary, alt) !== null ||
                isBlocked(vocabulary, alt) ||
                altLabel.length === TAG_LIMITS.altLabels
            ) {
                dropped.push(`alternative label "${alt}"`);
                continue;
            }
            keys.add(labelKey(alt));
            altLabel.push(alt);
        }
        const id = newId(vocabulary, random);
        const concept: Concept = {
            prefLabel: label,
            altLabel,
            broader: [],
            scopeNote: coin.scopeNote,
            by: "dorothy",
            at: stamp.at,
            model: stamp.model,
            edited: null,
        };
        vocabulary.concepts[id] = concept;
        made.push({ concept, id, broader: coin.broader });
    }
    // Once every coin has its label, so a coin may sit under a later one.
    for (const { concept, id, broader } of made) {
        for (const label of broader) {
            const parent = resolveLabel(vocabulary, label);
            if (
                parent === null ||
                concept.broader.includes(parent) ||
                wouldCycle(vocabulary, id, parent)
            ) {
                dropped.push(`broader "${label}"`);
                continue;
            }
            concept.broader.push(parent);
        }
    }
    const tags: string[] = [];
    for (const label of output.tags) {
        const id = resolveLabel(vocabulary, label);
        if (id === null) {
            dropped.push(`tag "${label}"`);
        } else if (!tags.includes(id) && tags.length < TAG_LIMITS.tags) {
            tags.push(id);
        }
    }
    return { vocabulary, coined: made.length, tags, dropped };
}

// A conversation as far as listing concepts goes.
export type Carrier = { tags: readonly string[]; hidden: boolean };

// The concepts a review may see, in label order: every live concept but
// those carried, themselves or through something narrower, only by hidden
// conversations. Were she to coin one of those labels again, it would be a
// reuse.
export function reviewConcepts(
    v: Vocabulary,
    carriers: readonly Carrier[],
): [string, Concept][] {
    const carried = new Set<string>();
    const visible = new Set<string>();
    for (const carrier of carriers) {
        for (const id of resolveTags(v, carrier.tags)) {
            for (const ancestor of ancestorsOf(v, id)) {
                carried.add(ancestor);
                if (!carrier.hidden) {
                    visible.add(ancestor);
                }
            }
        }
    }
    return liveConcepts(v).filter(
        ([id]) => !carried.has(id) || visible.has(id),
    );
}
