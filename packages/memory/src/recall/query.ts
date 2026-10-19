// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recall/query.ts
//
//

import {
    type ConversationObject,
    type FactHit,
    type Match,
    type OpenFactResult,
    type OpenInput,
    type OpenResult,
    type RecollectInput,
    type RecollectResult,
    SEARCH_KINDS,
    type SearchInput,
    type SearchResult,
    type TagObject,
    type TagsInput,
    type TagsResult,
    type WindowTurn,
} from "@dorothy/core";
import { isConfirmed, UNCONFIRMED } from "../facts/file.js";
import {
    factPath,
    parseTarget,
    readFactFile,
    scopeLabel,
} from "../facts/store.js";
import { salience, tokens } from "../memory/rank.js";
import { characters, normalise } from "../memory/sidecar.js";
import { byLabel } from "../memory/vocabulary.js";
import type { RecallIndex } from "./store.js";
import { readsByTarget, visitsByPhrase } from "./sync.js";
import {
    type CarrierRow,
    carriers,
    conceptByLabel,
    conceptLabels,
    factCarriers,
    keywordsOf,
    listedConcepts,
    narrowerThan,
    vocabularyBroken,
} from "./tags.js";

// A mistake in what Dorothy asked for, worded for her to relay.
export class RecallError extends Error {}

export const NOT_FOUND = "No conversation by that name.";
export const NO_FACT = "No fact by that name.";
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
    project?: string | null;
    // The scope labels allowed, "personal" and project ids, applied before
    // the cut to a search's limit; unset, all.
    within?: readonly string[] | undefined;
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

// Each label's concept, a mistake to relay unless she may see it: a
// visible conversation or a fact carries it, or nothing does yet.
function conceptsOf(
    index: RecallIndex,
    labels: readonly string[],
    exclude: string,
    rows: readonly CarrierRow[],
    facts: readonly { id: string }[],
): string[] {
    const listed = listedConcepts(index, exclude, rows);
    const ofFacts = new Set(facts.map((row) => row.id));
    return labels.map((label) => {
        const id = conceptByLabel(index, label);
        if (id === null || !(listed.has(id) || ofFacts.has(id))) {
            throw new RecallError(`${NO_TAG}: ${label}.`);
        }
        return id;
    });
}

// What carries every one of the concepts, from [concept, carrier] pairs.
function carryingAll(
    pairs: readonly (readonly [string, string])[],
    ids: readonly string[],
): Set<string> {
    let allowed = null as Set<string> | null;
    for (const id of ids) {
        const keys = new Set(
            pairs.filter(([of]) => of === id).map(([, key]) => key),
        );
        if (allowed === null) {
            allowed = keys;
        } else {
            for (const key of allowed) {
                if (!keys.has(key)) allowed.delete(key);
            }
        }
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

type FactRow = {
    path: string;
    scope: string;
    name: string;
    title: string;
    description: string;
    type: string;
    origin: string;
    retired: number;
    confirmed: number;
    score: number;
    snippet: string;
};
const FACT_COLUMNS =
    "f.path AS path, f.scope AS scope, f.name AS name, f.title AS title, f.description AS description, f.type AS type, f.origin AS origin, f.retired AS retired, f.confirmed AS confirmed";

// BM25 is lower for a better match; the snippet is from whichever of
// title, description and body matched best.
function findFacts(
    index: RecallIndex,
    expression: string,
    from: number,
    to: number,
): FactRow[] {
    return index.db
        .query(
            `SELECT ${FACT_COLUMNS}, bm25(facts_fts) AS score,
                snippet(facts_fts, -1, '«', '»', '…', ${SNIPPET_TOKENS}) AS snippet
             FROM facts_fts JOIN facts f ON f.rowid = facts_fts.rowid
             WHERE facts_fts MATCH ? AND f.created BETWEEN ? AND ?`,
        )
        .all(expression, from, to) as FactRow[];
}

// Facts found by tags alone, created within the dates.
function factsAt(
    index: RecallIndex,
    paths: ReadonlySet<string>,
    from: number,
    to: number,
): FactRow[] {
    const row = index.db.query(
        `SELECT ${FACT_COLUMNS}, 0 AS score, '' AS snippet FROM facts f
         WHERE f.path = ? AND f.created BETWEEN ? AND ?`,
    );
    return [...paths].flatMap((path) => {
        const found = row.get(path, from, to) as FactRow | null;
        return found === null ? [] : [found];
    });
}

const factHit = (row: FactRow): FactHit => ({
    id: `${row.scope}/${row.name}`,
    scope: row.scope,
    type: row.type,
    title: row.title,
    description: row.description,
    origin: row.origin,
    snippet: row.snippet,
    ...(row.retired !== 0 ? { retired: true as const } : {}),
    ...(row.confirmed === 0 ? { unconfirmed: UNCONFIRMED } : {}),
});

// Live facts before retired ones, personal and this project's before
// other projects', then by match.
function searchFacts(
    index: RecallIndex,
    terms: readonly string[],
    allowed: ReadonlySet<string> | null,
    span: { from: number; to: number; limit: number },
    project: string | null,
    scopes?: readonly string[],
): Pick<SearchResult, "facts" | "moreFacts"> {
    const within = (rows: FactRow[]) =>
        allowed === null ? rows : rows.filter((row) => allowed.has(row.path));
    const scoped = (rows: FactRow[]) =>
        scopes === undefined
            ? rows
            : rows.filter((row) => scopes.includes(row.scope));
    let rows = scoped(
        terms.length === 0
            ? factsAt(index, allowed ?? new Set(), span.from, span.to)
            : within(findFacts(index, terms.join(" "), span.from, span.to)),
    );
    if (rows.length === 0 && terms.length > 1) {
        rows = scoped(
            within(findFacts(index, terms.join(" OR "), span.from, span.to)),
        );
    }
    const far = (scope: string) =>
        scope === "personal" || scope === project ? 0 : 1;
    rows.sort(
        (a, b) =>
            a.retired - b.retired ||
            far(a.scope) - far(b.scope) ||
            a.score - b.score ||
            a.path.localeCompare(b.path),
    );
    return {
        facts: rows.slice(0, span.limit).map(factHit),
        moreFacts: Math.max(0, rows.length - span.limit),
    };
}

function rankConversations(
    index: RecallIndex,
    hits: Map<string, Hit>,
    limit: number,
    broken: boolean,
    options: QueryOptions,
): Pick<SearchResult, "results" | "more"> {
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

export function search(
    index: RecallIndex,
    input: SearchInput,
    options: QueryOptions,
): SearchResult {
    const { terms, labels, kind, broken } = searchQuery(index, input);
    const from = dayBound(input.after, "after");
    const to = dayBound(input.before, "before");
    const limit = clamp(input.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const exclude = options.exclude ?? "";
    const rows = labels.length === 0 ? [] : carriers(index);
    const factRows = labels.length === 0 ? [] : factCarriers(index);
    const ids = conceptsOf(index, labels, exclude, rows, factRows);
    const tagged = (pairs: (readonly [string, string])[]) =>
        labels.length === 0 ? null : carryingAll(pairs, ids);
    const facts =
        kind === "conversations"
            ? { facts: [], moreFacts: 0 }
            : searchFacts(
                  index,
                  terms,
                  tagged(factRows.map((row) => [row.id, row.path] as const)),
                  { from, to, limit },
                  options.project ?? null,
                  options.within,
              );
    if (kind === "facts") {
        return { ...facts, results: [], more: 0 };
    }
    const allowed = tagged(
        rows
            .filter((row) => !row.hidden && row.phrase !== exclude)
            .map((row) => [row.id, row.phrase] as const),
    );
    const hits = conversationHits(index, terms, allowed, {
        from,
        to,
        exclude,
        inScope: scopeFilter(index, options.within),
    });
    return {
        ...facts,
        ...rankConversations(index, hits, limit, broken, options),
    };
}

// A search's words and tags, refused where it asks what can't be given.
function searchQuery(
    index: RecallIndex,
    input: SearchInput,
): {
    terms: string[];
    labels: string[];
    kind: SearchInput["kind"];
    broken: boolean;
} {
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
    const kind = input.kind;
    if (
        kind !== undefined &&
        !(SEARCH_KINDS as readonly string[]).includes(kind)
    ) {
        throw new RecallError("kind must be conversations or facts.");
    }
    const broken = vocabularyBroken(index) !== null;
    if (labels.length > 0 && broken) {
        throw new RecallError(TAGS_UNAVAILABLE);
    }
    return { terms, labels, kind, broken };
}

// Whether a conversation is in one of the scopes allowed, "personal" for
// one outside any project; every conversation when none are named.
function scopeFilter(
    index: RecallIndex,
    within: readonly string[] | undefined,
): (phrase: string) => boolean {
    if (within === undefined) {
        return () => true;
    }
    const project = index.db.query(
        "SELECT project FROM conversations WHERE phrase = ?",
    );
    return (phrase) => {
        const row = project.get(phrase) as { project: string | null } | null;
        return within.includes(row?.project ?? "personal");
    };
}

// Conversations with every word, else any of them; with no words, those
// active in the dates. allowed: the conversations tags leave, or null. Both
// the tags and the scopes narrow the conversations found before the choice
// of any word, so that a match outside them cannot stand in for the
// matches within.
function conversationHits(
    index: RecallIndex,
    terms: readonly string[],
    allowed: Set<string> | null,
    {
        from,
        to,
        exclude,
        inScope,
    }: {
        from: number;
        to: number;
        exclude: string;
        inScope: (phrase: string) => boolean;
    },
): Map<string, Hit> {
    if (terms.length === 0) {
        const active = activeIn(index, allowed ?? new Set(), from, to);
        return new Map([...active].filter(([phrase]) => inScope(phrase)));
    }
    const within = (found: Map<string, Hit>) =>
        new Map(
            [...found].filter(
                ([phrase]) =>
                    inScope(phrase) &&
                    (allowed === null || allowed.has(phrase)),
            ),
        );
    const hits = within(findHits(index, terms.join(" "), from, to, exclude));
    return hits.size === 0 && terms.length > 1
        ? within(findHits(index, terms.join(" OR "), from, to, exclude))
        : hits;
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
    // One turn more on a side, if it fits.
    const extend = (ahead: boolean): boolean => {
        const next = ahead ? high + 1 : low - 1;
        const candidate = turns[next];
        if (
            candidate === undefined ||
            used + tokens(candidate.text) > WINDOW_TOKENS
        ) {
            return false;
        }
        used += tokens(candidate.text);
        if (ahead) {
            high = next;
        } else {
            low = next;
        }
        return true;
    };
    // The sides take turns, forward first; a side that has stopped gives
    // its turn to the other.
    const open = { ahead: true, back: true };
    for (let forward = true; open.ahead || open.back; forward = !forward) {
        const ahead = forward ? open.ahead : !open.back;
        if (!extend(ahead)) {
            open[ahead ? "ahead" : "back"] = false;
        }
    }
    return turns.slice(low, high + 1);
}

// A turn as the index holds it, its time in milliseconds.
export type TurnRow = {
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

function checkPurpose(text: string): void {
    const purpose = normalise(text);
    if (purpose === "") {
        throw new RecallError("Say in purpose what you hope to find.");
    }
    const length = characters(purpose);
    if (length > PURPOSE_LIMIT) {
        throw new RecallError(
            `purpose is ${length} characters, over ${PURPOSE_LIMIT}.`,
        );
    }
}

export function openConversation(
    index: RecallIndex,
    input: OpenInput & { conversation: string },
    options: { exclude: string | null },
): OpenResult {
    checkPurpose(input.purpose);
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

export async function openFact(
    index: RecallIndex,
    input: OpenInput,
    root: string,
): Promise<OpenFactResult> {
    checkPurpose(input.purpose);
    const target = parseTarget(input.fact ?? "");
    if (target === null) {
        throw new RecallError(NO_FACT);
    }
    const read = await readFactFile(
        factPath(root, target.scope, target.name),
        target.name,
    );
    if (read.kind === "none") {
        throw new RecallError(NO_FACT);
    }
    if (read.kind === "unparseable" || read.kind === "unreadable") {
        throw new RecallError(`That fact cannot be read: ${read.reason}`);
    }
    const { fact } = read;
    const scope = scopeLabel(target.scope);
    return {
        id: `${scope}/${fact.name}`,
        scope,
        name: fact.name,
        type: fact.type,
        title: fact.title,
        description: fact.description,
        keywords:
            vocabularyBroken(index) === null
                ? conceptLabels(index, fact.tags)
                : [],
        importance: fact.importance,
        provenance: fact.provenance,
        retired: fact.retired,
        body: fact.body,
        ...(isConfirmed(fact) ? {} : { unconfirmed: UNCONFIRMED }),
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
    const factCount = liveFactCounts(index);
    const listed = new Set([
        ...listedConcepts(index, exclude, rows),
        ...factCount.keys(),
    ]);
    const scope = tagScope(index, input.under, listed);
    const score = salienceOf(index, options);
    const carriedBy = carriersOf(rows, exclude);
    const concepts = index.db
        .query("SELECT id, label, alt, scope_note FROM concepts")
        .all() as ConceptRow[];
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
    const describe = tagObject(index, concepts, listed, factCount);
    return {
        results: ranked
            .slice(0, limit)
            .map(({ c, phrases }) => describe(c, phrases)),
        more: Math.max(0, ranked.length - limit),
    };
}

// A concept a live fact carries is hers to see, as search finds it, and
// its tag counts those facts. fact_tags holds retired facts' tags too,
// which search wants and the tags list does not.
function liveFactCounts(index: RecallIndex): Map<string, number> {
    const live = new Set(
        (
            index.db
                .query("SELECT path FROM facts WHERE retired = 0")
                .all() as {
                path: string;
            }[]
        ).map((row) => row.path),
    );
    const counts = new Map<string, number>();
    for (const row of factCarriers(index)) {
        if (live.has(row.path)) {
            counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
        }
    }
    return counts;
}

// The concepts listed, or those under the one named.
function tagScope(
    index: RecallIndex,
    under: string | undefined,
    listed: ReadonlySet<string>,
): ReadonlySet<string> {
    if (under === undefined) {
        return listed;
    }
    const label = normalise(under);
    if (label === "") return listed;
    const root = conceptByLabel(index, label);
    if (root === null || !listed.has(root)) {
        throw new RecallError(`${NO_TAG}: ${label}.`);
    }
    const below = narrowerThan(index, root);
    return new Set([...listed].filter((id) => below.has(id)));
}

// Each conversation's salience, worked out once.
function salienceOf(
    index: RecallIndex,
    options: QueryOptions,
): (phrase: string) => number {
    const visits = visitsByPhrase(index);
    const reads = readsByTarget(index);
    const scores = new Map<string, number>();
    return (phrase) => {
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
}

// The conversations she may see that carry each concept.
function carriersOf(
    rows: ReturnType<typeof carriers>,
    exclude: string,
): Map<string, string[]> {
    const carriedBy = new Map<string, string[]>();
    for (const row of rows) {
        if (!row.hidden && row.phrase !== exclude) {
            carriedBy.set(row.id, [
                ...(carriedBy.get(row.id) ?? []),
                row.phrase,
            ]);
        }
    }
    return carriedBy;
}

type Span = { phrase: string; first_at: number; last_at: number };

function conversationSpans(index: RecallIndex): Map<string, Span> {
    return new Map(
        (
            index.db
                .query(
                    "SELECT phrase, first_at, last_at FROM conversations WHERE first_at IS NOT NULL",
                )
                .all() as Span[]
        ).map((span) => [span.phrase, span]),
    );
}

// A concept as schema.org's DefinedTerm: its neighbours she may see, by
// preferred label, and the dates of the conversations that carry it.
function tagObject(
    index: RecallIndex,
    concepts: readonly ConceptRow[],
    listed: ReadonlySet<string>,
    factCount: ReadonlyMap<string, number>,
): (c: ConceptRow, phrases: string[]) => TagObject {
    const spans = conversationSpans(index);
    const labelOf = new Map(concepts.map((c) => [c.id, c.label]));
    const edges = index.db.query("SELECT id, parent FROM broader").all() as {
        id: string;
        parent: string;
    }[];
    const named = (ids: string[]) =>
        ids
            .filter((id) => listed.has(id))
            .map((id) => labelOf.get(id) as string)
            .sort(byLabel);
    return (c, phrases) => {
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
            ...(factCount.has(c.id)
                ? { facts: factCount.get(c.id) as number }
                : {}),
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
    };
}

// A cluster of the live conversation, read from turn (its first by
// default) and never past its last. With words, the window centres on the
// first turn from there on that holds them all, or any of them.
// The turn a recollection starts from: the one asked for, which must be in
// the cluster, else its first.
function startTurn(
    asked: number | undefined,
    range: { first: number; last: number },
    n: number,
): number {
    if (asked === undefined) {
        return range.first;
    }
    const turn = Number.isFinite(asked) ? Math.round(asked) : Number.NaN;
    if (!(turn >= range.first && turn <= range.last)) {
        throw new RecallError(
            `turn must be from ${range.first} to ${range.last}, within cluster ${n}.`,
        );
    }
    return turn;
}

// The first turn from start to last with every word, else any of them.
function findWords(
    index: RecallIndex,
    words: string,
    phrase: string,
    start: number,
    last: number,
): { n: number } | null {
    if (normalise(words) === "") {
        throw new RecallError("Give some words to look for.");
    }
    const terms = termsOf(words);
    const find = (expression: string) =>
        index.db
            .query(
                `SELECT t.n AS n FROM turns_fts
                 JOIN turns t ON t.rowid = turns_fts.rowid
                 WHERE turns_fts MATCH ? AND t.phrase = ?
                     AND t.n BETWEEN ? AND ?
                 ORDER BY t.n LIMIT 1`,
            )
            .get(expression, phrase, start, last) as { n: number } | null;
    return (
        find(terms.join(" ")) ??
        (terms.length > 1 ? find(terms.join(" OR ")) : null)
    );
}

// The words of a text, lowercased: runs of letters and digits.
const wordsOf = (text: string): string[] =>
    text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

// The first turn from start to last with every word, else any of them,
// among turns read from the transcript rather than found by FTS: the words
// match whole, in any case, without stemming.
function findWordsIn(
    turns: readonly TurnRow[],
    words: string,
    start: number,
    last: number,
): { n: number } | null {
    if (normalise(words) === "") {
        throw new RecallError("Give some words to look for.");
    }
    const terms = wordsOf(words).slice(0, MAX_TERMS);
    const within = turns
        .filter((row) => row.turn >= start && row.turn <= last)
        .map((row) => ({ turn: row.turn, words: new Set(wordsOf(row.text)) }));
    const find = (every: boolean) => {
        const found = within.find((row) =>
            every
                ? terms.every((term) => row.words.has(term))
                : terms.some((term) => row.words.has(term)),
        );
        return found === undefined ? null : { n: found.turn };
    };
    return terms.length === 0
        ? null
        : (find(true) ?? (terms.length > 1 ? find(false) : null));
}

// kept: the conversation's turns read from its transcript, for one the
// index keeps no text of because it is hidden.
export function recollect(
    index: RecallIndex,
    input: RecollectInput,
    options: { phrase: string | null; kept?: readonly TurnRow[] },
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
    const start = startTurn(input.turn, range, n);
    const kept = options.kept;
    const found =
        input.words === undefined
            ? null
            : kept === undefined
              ? findWords(index, input.words, phrase, start, range.last)
              : findWordsIn(kept, input.words, start, range.last);
    const centre = found?.n ?? start;
    const matched = input.words === undefined ? undefined : found !== null;
    const turns =
        kept === undefined
            ? (index.db
                  .query(
                      "SELECT n AS turn, role, at, text FROM turns WHERE phrase = ? AND n BETWEEN ? AND ? ORDER BY n",
                  )
                  .all(phrase, start, range.last) as TurnRow[])
            : kept.filter((row) => row.turn >= start && row.turn <= range.last);
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
