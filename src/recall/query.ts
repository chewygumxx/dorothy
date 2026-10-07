// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/recall/query.ts
//
//

import { salience, tokens } from "../memory/rank.js";
import { characters, normalise } from "../memory/sidecar.js";
import type { RecallIndex } from "./store.js";
import { readsByTarget, visitsByPhrase } from "./sync.js";
import type {
    ConversationObject,
    Match,
    OpenInput,
    OpenResult,
    RecollectInput,
    RecollectResult,
    SearchInput,
    SearchResult,
    WindowTurn,
} from "./types.js";

// A mistake in what Dorothy asked for, worded for her to relay.
export class RecallError extends Error {}

export const NOT_FOUND = "No conversation by that name.";
export const NO_CLUSTER = "No cluster by that number.";
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

function objectOf(row: ConversationRow): ConversationObject {
    return {
        "@type": "Conversation",
        identifier: row.phrase,
        ...(row.title !== null ? { name: row.title } : {}),
        ...(row.description !== null ? { description: row.description } : {}),
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

export function search(
    index: RecallIndex,
    input: SearchInput,
    options: QueryOptions,
): SearchResult {
    const terms = termsOf(input.query);
    if (terms.length === 0) {
        throw new RecallError("Give some words to search for.");
    }
    const from = dayBound(input.after, "after");
    const to = dayBound(input.before, "before");
    const asked = input.limit;
    const limit = Math.min(
        MAX_LIMIT,
        Math.max(
            1,
            asked !== undefined && Number.isFinite(asked)
                ? Math.round(asked)
                : DEFAULT_LIMIT,
        ),
    );
    const exclude = options.exclude ?? "";
    let hits = findHits(index, terms.join(" "), from, to, exclude);
    if (hits.size === 0 && terms.length > 1) {
        hits = findHits(index, terms.join(" OR "), from, to, exclude);
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
            ...objectOf(row.get(hit.phrase) as ConversationRow),
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
        ...objectOf(row),
        ...(row.abstract !== null ? { abstract: row.abstract } : {}),
        turns: turns.length,
        window: isoWindow(turns, input.turn),
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
