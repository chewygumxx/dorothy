// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recall/query.ts
//
//

import type {
    ConversationObject,
    Match,
    OpenInput,
    OpenResult,
    RecollectInput,
    RecollectResult,
    SearchInput,
    SearchResult,
    TagObject,
    TagsInput,
    TagsResult,
    WindowTurn,
} from "@dorothy/core";
import { salience, tokens } from "../memory/rank.js";
import { characters, normalise } from "../memory/sidecar.js";
import { byLabel } from "../memory/vocabulary.js";
import type { RecallIndex } from "./store.js";
import { readsByTarget, visitsByPhrase } from "./sync.js";
import {
    carriers,
    conceptByLabel,
    keywordsOf,
    listedConcepts,
    narrowerThan,
    vocabularyBroken,
} from "./tags.js";

// A mistake in what Dorothy asked for, worded for her to relay.
export class RecallError extends Error {}

export const NOT_FOUND = "No conversation by that name.";
export const NO_CLUSTER = "No cluster by that number.";
export const NO_TAG = "No tag by that name";
export const TAGS_UNAVAILABLE = "Tags are unavailable at the moment.";
const MAX_TAG_FILTERS = 5;
const DEFAULT_TAGS_LIMIT = 20;
const MAX_TAGS_LIMIT = 50;
export const WINDOW_TOKENS = 4000;
const MAX_TERMS = 16;
const MATCHES_PER_HIT = 3;
const SNIPPET_TOKENS = 12;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const PURPOSE_LIMIT = 160;
const CUT = "… [cut]";

export type QueryOptions = {
    exclude: string | null;
    now: number;
    halfLifeDays: number;
};

type ConversationRow = {
    phrase: string;
    title: string | null;
    description: string | null;
    abstract: string | null;
    first_at: number;
    last_at: number;
};

// Each word quoted, so nothing in a query is FTS5 syntax.
export function termsOf(query: string): string[] {
    return normalise(query)
        .split(" ")
        .filter((term) => term !== "")
        .slice(0, MAX_TERMS)
        .map((term) => `"${term.replaceAll('"', '""')}"`);
}

const pad = (value: number) => String(value).padStart(2, "0");
const localDate = (ms: number) => {
    const date = new Date(ms);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// A local date, inclusive: after from its first moment, before to its last.
function dayBound(value: string | undefined, name: "after" | "before"): number {
    if (value === undefined) {
        return name === "after"
            ? Number.MIN_SAFE_INTEGER
            : Number.MAX_SAFE_INTEGER;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const [year, month, date] = (match?.slice(1) ?? []).map(Number);
    const start =
        year === undefined || month === undefined || date === undefined
            ? null
            : new Date(year, month - 1, date);
    if (
        start === null ||
        start.getFullYear() !== year ||
        start.getMonth() !== (month as number) - 1 ||
        start.getDate() !== date
    ) {
        throw new RecallError(`${name} must be a date like 2026-10-05.`);
    }
    if (name === "after") {
        return start.getTime();
    }
    start.setDate(start.getDate() + 1);
    return start.getTime() - 1;
}

// A limit as asked for, rounded and clamped, or the default.
const clamp = (asked: number | undefined, fallback: number, max: number) =>
    Math.min(
        max,
        Math.max(
            1,
            asked !== undefined && Number.isFinite(asked)
                ? Math.round(asked)
                : fallback,
        ),
    );

function objectOf(
    row: ConversationRow,
    keywords: readonly string[] = [],
): ConversationObject {
    return {
        "@type": "Conversation",
        identifier: row.phrase,
        ...(row.title !== null ? { name: row.title } : {}),
        ...(row.description !== null ? { description: row.description } : {}),
        ...(keywords.length > 0 ? { keywords: [...keywords] } : {}),
        dateCreated: localDate(row.first_at),
        dateModified: localDate(row.last_at),
    };
}

type Hit = { phrase: string; best: number; matches: Match[] };

// BM25 is lower for a better match; a match in the notes counts double.
function findHits(
    index: RecallIndex,
    expression: string,
    from: number,
    to: number,
    exclude: string,
): Map<string, Hit> {
    const hits = new Map<string, Hit>();
    const hitOf = (phrase: string, score: number) => {
        const hit = hits.get(phrase) ?? { phrase, best: score, matches: [] };
        hit.best = Math.min(hit.best, score);
        hits.set(phrase, hit);
        return hit;
    };
    const turns = index.db
        .query(
            `SELECT t.phrase AS phrase, t.n AS turn, t.role AS role,
                bm25(turns_fts) AS score,
                snippet(turns_fts, 0, '«', '»', '…', ${SNIPPET_TOKENS}) AS text
             FROM turns_fts
             JOIN turns t ON t.rowid = turns_fts.rowid
             JOIN conversations c ON c.phrase = t.phrase
             WHERE turns_fts MATCH ? AND c.hidden = 0 AND c.phrase != ?
                 AND t.at BETWEEN ? AND ?
             ORDER BY score`,
        )
        .all(expression, exclude, from, to) as (Match & {
        phrase: string;
        score: number;
    })[];
    for (const { phrase, score, ...match } of turns) {
        const hit = hitOf(phrase, score);
        if (hit.matches.length < MATCHES_PER_HIT) {
            hit.matches.push(match);
        }
    }
    const notes = index.db
        .query(
            `SELECT c.phrase AS phrase, bm25(notes_fts) AS score
             FROM notes_fts JOIN conversations c ON c.rowid = notes_fts.rowid
             WHERE notes_fts MATCH ? AND c.hidden = 0 AND c.phrase != ?
                 AND c.first_at <= ? AND c.last_at >= ?`,
        )
        .all(expression, exclude, to, from) as {
        phrase: string;
        score: number;
    }[];
    for (const { phrase, score } of notes) {
        hitOf(phrase, score * 2);
    }
    return hits;
}

// The visible conversations that carry every concept named, or
// something narrower. A label naming no concept she may see is a
// mistake to relay.
function taggedWith(
    index: RecallIndex,
    labels: readonly string[],
    exclude: string,
): Set<string> {
    const rows = carriers(index);
    const listed = listedConcepts(index, exclude, rows);
    let allowed = null as Set<string> | null;
    for (const label of labels) {
        const id = conceptByLabel(index, label);
        if (id === null || !listed.has(id)) {
            throw new RecallError(`${NO_TAG}: ${label}.`);
        }
        const phrases = new Set(
            rows
                .filter(
                    (row) =>
                        row.id === id && !row.hidden && row.phrase !== exclude,
                )
                .map((row) => row.phrase),
        );
        const before: Set<string> | null = allowed;
        allowed =
            before === null
                ? phrases
                : new Set([...before].filter((phrase) => phrases.has(phrase)));
    }
    return allowed ?? new Set();
}

// Conversations found by tags alone: those active within the dates,
// with no matches to show.
function activeIn(
    index: RecallIndex,
    phrases: ReadonlySet<string>,
    from: number,
    to: number,
): Map<string, Hit> {
    const span = index.db.query(
        "SELECT first_at, last_at FROM conversations WHERE phrase = ? AND first_at IS NOT NULL",
    );
    const hits = new Map<string, Hit>();
    for (const phrase of phrases) {
        const row = span.get(phrase) as {
            first_at: number;
            last_at: number;
        } | null;
        if (row !== null && row.first_at <= to && row.last_at >= from) {
            hits.set(phrase, { phrase, best: 0, matches: [] });
        }
    }
    return hits;
}

export function search(
    index: RecallIndex,
    input: SearchInput,
    options: QueryOptions,
): SearchResult {
    const terms = termsOf(input.query ?? "");
    const labels = (input.tags ?? [])
        .map(normalise)
        .filter((label) => label !== "");
    if (terms.length === 0 && labels.length === 0) {
        throw new RecallError("Give some words or tags to search for.");
    }
    if (labels.length > MAX_TAG_FILTERS) {
        throw new RecallError(`Give at most ${MAX_TAG_FILTERS} tags.`);
    }
    const broken = vocabularyBroken(index) !== null;
    if (labels.length > 0 && broken) {
        throw new RecallError(TAGS_UNAVAILABLE);
    }
    const from = dayBound(input.after, "after");
    const to = dayBound(input.before, "before");
    const limit = clamp(input.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const exclude = options.exclude ?? "";
    const allowed =
        labels.length === 0 ? null : taggedWith(index, labels, exclude);
    const within = (found: Map<string, Hit>) =>
        allowed === null
            ? found
            : new Map([...found].filter(([phrase]) => allowed.has(phrase)));
    let hits =
        terms.length === 0
            ? activeIn(index, allowed ?? new Set(), from, to)
            : within(findHits(index, terms.join(" "), from, to, exclude));
    if (hits.size === 0 && terms.length > 1) {
        hits = within(findHits(index, terms.join(" OR "), from, to, exclude));
    }
    const visits = visitsByPhrase(index);
    const reads = readsByTarget(index);
    const scored = [...hits.values()].map((hit) => ({
        ...hit,
        salience: salience(
            visits.get(hit.phrase) ?? [],
            reads.get(hit.phrase) ?? [],
            options.now,
            options.halfLifeDays,
        ),
    }));
    scored.sort(
        (a, b) =>
            a.best - b.best ||
            b.salience - a.salience ||
            a.phrase.localeCompare(b.phrase),
    );
    const row = index.db.query(
        "SELECT phrase, title, description, abstract, first_at, last_at FROM conversations WHERE phrase = ?",
    );
    return {
        results: scored.slice(0, limit).map((hit) => ({
            ...objectOf(
                row.get(hit.phrase) as ConversationRow,
                broken ? [] : keywordsOf(index, hit.phrase),
            ),
            matches: hit.matches,
        })),
        more: Math.max(0, scored.length - limit),
    };
}

const cut = (text: string) =>
    `${[...text].slice(0, WINDOW_TOKENS * 4 - characters(CUT)).join("")}${CUT}`;

// The turns around the one asked for, growing forward and back in turn
// while they fit in WINDOW_TOKENS; a side stops at its first turn that does
// not fit. A turn too long for the window alone is cut to fit it.
export function windowOf<T extends { text: string }>(
    turns: readonly T[],
    turn: number | undefined,
): T[] {
    if (turns.length === 0) {
        return [];
    }
    const wanted =
        turn !== undefined && Number.isFinite(turn) ? Math.round(turn) : 1;
    let low = Math.min(turns.length, Math.max(1, wanted)) - 1;
    let high = low;
    const centre = turns[low] as T;
    let used = tokens(centre.text);
    if (used > WINDOW_TOKENS) {
        return [{ ...centre, text: cut(centre.text) }];
    }
    let forward = true;
    let canForward = true;
    let canBack = true;
    while (canForward || canBack) {
        const ahead = forward ? canForward : !canBack;
        const next = ahead ? high + 1 : low - 1;
        const candidate = turns[next];
        if (
            candidate === undefined ||
            used + tokens(candidate.text) > WINDOW_TOKENS
        ) {
            if (ahead) {
                canForward = false;
            } else {
                canBack = false;
            }
        } else {
            used += tokens(candidate.text);
            if (ahead) {
                high = next;
            } else {
                low = next;
            }
        }
        forward = !forward;
    }
    return turns.slice(low, high + 1);
}

// A turn as the index holds it, its time in milliseconds.
type TurnRow = {
    turn: number;
    role: "user" | "assistant";
    at: number;
    text: string;
};

// The window around turn, its times as ISO strings.
const isoWindow = (
    turns: readonly TurnRow[],
    turn: number | undefined,
): WindowTurn[] =>
    windowOf(turns, turn).map((row) => ({
        ...row,
        at: new Date(row.at).toISOString(),
    }));

export function openConversation(
    index: RecallIndex,
    input: OpenInput,
    options: { exclude: string | null },
): OpenResult {
    const purpose = normalise(input.purpose);
    if (purpose === "") {
        throw new RecallError("Say in purpose what you hope to find.");
    }
    const length = characters(purpose);
    if (length > PURPOSE_LIMIT) {
        throw new RecallError(
            `purpose is ${length} characters, over ${PURPOSE_LIMIT}.`,
        );
    }
    const row = index.db
        .query(
            `SELECT phrase, title, description, abstract, first_at, last_at
             FROM conversations
             WHERE phrase = ? AND hidden = 0 AND phrase != ?
                 AND first_at IS NOT NULL`,
        )
        .get(
            input.conversation,
            options.exclude ?? "",
        ) as ConversationRow | null;
    if (row === null) {
        throw new RecallError(NOT_FOUND);
    }
    const turns = index.db
        .query(
            "SELECT n AS turn, role, at, text FROM turns WHERE phrase = ? ORDER BY n",
        )
        .all(row.phrase) as TurnRow[];
    return {
        ...objectOf(
            row,
            vocabularyBroken(index) === null
                ? keywordsOf(index, row.phrase)
                : [],
        ),
        ...(row.abstract !== null ? { abstract: row.abstract } : {}),
        turns: turns.length,
        window: isoWindow(turns, input.turn),
    };
}

type ConceptRow = {
    id: string;
    label: string;
    alt: string;
    scope_note: string;
};

// The concepts she may see, most salient first: a concept's frecency
// is the summed salience of its visible carriers.
export function listTags(
    index: RecallIndex,
    input: TagsInput,
    options: QueryOptions,
): TagsResult {
    if (vocabularyBroken(index) !== null) {
        throw new RecallError(TAGS_UNAVAILABLE);
    }
    const exclude = options.exclude ?? "";
    const rows = carriers(index);
    const listed = listedConcepts(index, exclude, rows);
    let scope = listed;
    if (input.under !== undefined) {
        const label = normalise(input.under);
        const root = conceptByLabel(index, label);
        if (root === null || !listed.has(root)) {
            throw new RecallError(`${NO_TAG}: ${label}.`);
        }
        const below = narrowerThan(index, root);
        scope = new Set([...listed].filter((id) => below.has(id)));
    }
    const visits = visitsByPhrase(index);
    const reads = readsByTarget(index);
    const scores = new Map<string, number>();
    const score = (phrase: string) => {
        const known = scores.get(phrase);
        if (known !== undefined) {
            return known;
        }
        const value = salience(
            visits.get(phrase) ?? [],
            reads.get(phrase) ?? [],
            options.now,
            options.halfLifeDays,
        );
        scores.set(phrase, value);
        return value;
    };
    const carriedBy = new Map<string, string[]>();
    for (const row of rows) {
        if (!row.hidden && row.phrase !== exclude) {
            carriedBy.set(row.id, [
                ...(carriedBy.get(row.id) ?? []),
                row.phrase,
            ]);
        }
    }
    const spans = new Map(
        (
            index.db
                .query(
                    "SELECT phrase, first_at, last_at FROM conversations WHERE first_at IS NOT NULL",
                )
                .all() as {
                phrase: string;
                first_at: number;
                last_at: number;
            }[]
        ).map((span) => [span.phrase, span]),
    );
    const concepts = index.db
        .query("SELECT id, label, alt, scope_note FROM concepts")
        .all() as ConceptRow[];
    const labelOf = new Map(concepts.map((c) => [c.id, c.label]));
    const edges = index.db.query("SELECT id, parent FROM broader").all() as {
        id: string;
        parent: string;
    }[];
    // Neighbours she may see, by preferred label.
    const named = (ids: string[]) =>
        ids
            .filter((id) => listed.has(id))
            .map((id) => labelOf.get(id) as string)
            .sort(byLabel);
    const ranked = concepts
        .filter((c) => scope.has(c.id))
        .map((c) => {
            const phrases = carriedBy.get(c.id) ?? [];
            return {
                c,
                phrases,
                frecency: phrases.reduce((sum, p) => sum + score(p), 0),
            };
        })
        .sort(
            (a, b) => b.frecency - a.frecency || byLabel(a.c.label, b.c.label),
        );
    const limit = clamp(input.limit, DEFAULT_TAGS_LIMIT, MAX_TAGS_LIMIT);
    return {
        results: ranked.slice(0, limit).map(({ c, phrases }): TagObject => {
            const alt = JSON.parse(c.alt) as string[];
            const broader = named(
                edges.filter((e) => e.id === c.id).map((e) => e.parent),
            );
            const narrower = named(
                edges.filter((e) => e.parent === c.id).map((e) => e.id),
            );
            const active = phrases.flatMap((p) => {
                const span = spans.get(p);
                return span === undefined ? [] : [span];
            });
            return {
                "@type": "DefinedTerm",
                name: c.label,
                ...(alt.length > 0 ? { alternateName: alt } : {}),
                description: c.scope_note,
                ...(broader.length > 0 ? { broader } : {}),
                ...(narrower.length > 0 ? { narrower } : {}),
                conversations: phrases.length,
                ...(active.length > 0
                    ? {
                          dateCreated: localDate(
                              Math.min(...active.map((s) => s.first_at)),
                          ),
                          dateModified: localDate(
                              Math.max(...active.map((s) => s.last_at)),
                          ),
                      }
                    : {}),
            };
        }),
        more: Math.max(0, ranked.length - limit),
    };
}

// A cluster of the live conversation, read from turn (its first by
// default) and never past its last. With words, the window centres on the
// first turn from there on that holds them all, or any of them.
export function recollect(
    index: RecallIndex,
    input: RecollectInput,
    options: { phrase: string | null },
): RecollectResult {
    const phrase = options.phrase;
    // A cluster is a whole number or nothing: no rounding, so the cluster
    // opened is the cluster the transcript records, and a refused call
    // records nothing opened.
    const n = Number.isInteger(input.cluster) ? input.cluster : 0;
    const range =
        phrase === null
            ? null
            : (index.db
                  .query(
                      "SELECT first_turn AS first, last_turn AS last FROM clusters WHERE phrase = ? AND n = ?",
                  )
                  .get(phrase, n) as { first: number; last: number } | null);
    if (phrase === null || range === null) {
        throw new RecallError(NO_CLUSTER);
    }
    let start = range.first;
    if (input.turn !== undefined) {
        const turn = Number.isFinite(input.turn)
            ? Math.round(input.turn)
            : Number.NaN;
        if (!(turn >= range.first && turn <= range.last)) {
            throw new RecallError(
                `turn must be from ${range.first} to ${range.last}, within cluster ${n}.`,
            );
        }
        start = turn;
    }
    let centre = start;
    let matched: boolean | undefined;
    if (input.words !== undefined) {
        if (normalise(input.words) === "") {
            throw new RecallError("Give some words to look for.");
        }
        const terms = termsOf(input.words);
        const find = (expression: string) =>
            index.db
                .query(
                    `SELECT t.n AS n FROM turns_fts
                     JOIN turns t ON t.rowid = turns_fts.rowid
                     WHERE turns_fts MATCH ? AND t.phrase = ?
                         AND t.n BETWEEN ? AND ?
                     ORDER BY t.n LIMIT 1`,
                )
                .get(expression, phrase, start, range.last) as {
                n: number;
            } | null;
        const hit =
            find(terms.join(" ")) ??
            (terms.length > 1 ? find(terms.join(" OR ")) : null);
        matched = hit !== null;
        centre = hit?.n ?? start;
    }
    const turns = index.db
        .query(
            "SELECT n AS turn, role, at, text FROM turns WHERE phrase = ? AND n BETWEEN ? AND ? ORDER BY n",
        )
        .all(phrase, start, range.last) as TurnRow[];
    const total =
        (
            index.db
                .query("SELECT turns FROM conversations WHERE phrase = ?")
                .get(phrase) as { turns: number } | null
        )?.turns ?? 0;
    const at = turns.findIndex((turn) => turn.turn === centre);
    return {
        cluster: n,
        turns: [range.first, range.last],
        total,
        ...(matched === undefined ? {} : { matched }),
        window: isoWindow(turns, at === -1 ? 1 : at + 1),
    };
}
