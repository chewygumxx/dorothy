// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recall/sync.ts
//
//

import { open, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { isPhrase } from "@dorothy/core";
import {
    readSidecar,
    type Served,
    type SidecarRead,
    sidecarPath,
} from "../memory/sidecar.js";
import {
    isConcept,
    isMerged,
    labelKey,
    labelsOf,
    readVocabulary,
    type Term,
    type VocabularyRead,
} from "../memory/vocabulary.js";
import { sourceOf, toRecall, toTurn } from "../transcript.js";
import { syncFacts } from "./facts.js";
import type { RecallIndex } from "./store.js";

export type VisitRow = { userTurns: number; lastAt: number };
export type ReadRow = { at: number; served: Served };

const LEFTOVER = /\.meta\.json\.[0-9a-f]+\.tmp$/;
const LEFTOVER_AGE_MS = 3_600_000;

type Row = {
    phrase: string;
    t_size: number;
    t_ino: number;
    sessions: number;
    turns: number;
    first_at: number | null;
    last_at: number | null;
    s_mtime: number | null;
    // 1 for a conversation whose sidecar hides it: its turns are counted
    // but their text is not kept.
    hidden: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const codeOf = (error: unknown) => (error as { code?: unknown }).code;

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// Brings the index up to date with the transcripts directory: what was
// appended, replaced or deleted, and every sidecar that changed. A
// transcript that cannot be synced keeps the rows it had and is reported in
// the warnings, so one bad file does not take the rest of the index with it.
// With a vocabulary path, tags.json is synced too; without, its tables
// are left as they are. With the data directory as facts, the store's facts
// are synced too.
export async function syncIndex(
    index: RecallIndex,
    dir: string,
    now: number = Date.now(),
    vocabulary: string | null = null,
    facts: string | null = null,
): Promise<string[]> {
    const warnings: string[] = [];
    // Listed under the lock: another process may have indexed a new
    // transcript while this one waited, and a stale list would forget it.
    const names = await index.exclusive(async () => {
        const listing = await list(dir);
        const phrases = listing
            .filter((name) => name.endsWith(".jsonl"))
            .map((name) => name.slice(0, -".jsonl".length))
            .filter(isPhrase);
        const rows = new Map(
            (
                index.db
                    .query(
                        "SELECT phrase, t_size, t_ino, sessions, turns, first_at, last_at, s_mtime, hidden FROM conversations",
                    )
                    .all() as Row[]
            ).map((row) => [row.phrase, row]),
        );
        const present = new Set(phrases);
        for (const phrase of rows.keys()) {
            if (!present.has(phrase)) {
                forget(index, phrase);
            }
        }
        for (const phrase of phrases) {
            const problem = await inSavepoint(index, async () => {
                await syncConversation(index, dir, phrase, rows.get(phrase));
            });
            if (problem !== null) {
                warnings.push(`${join(dir, `${phrase}.jsonl`)}: ${problem}`);
            }
        }
        const problem =
            vocabulary === null
                ? null
                : await inSavepoint(index, () =>
                      syncVocabulary(index, vocabulary),
                  );
        if (problem !== null) {
            warnings.push(`${vocabulary}: ${problem}`);
        }
        return listing;
    });
    await removeLeftovers(dir, names, now);
    if (facts !== null) {
        warnings.push(...(await syncFacts(index, facts)));
    }
    return warnings;
}

// A conversation's transcript and sidecar. Its text is kept only while it
// is not hidden: hiding it drops what was kept, and showing it again
// reads the transcript afresh, as a new file is read.
async function syncConversation(
    index: RecallIndex,
    dir: string,
    phrase: string,
    known: Row | undefined,
): Promise<void> {
    if (!(await syncTranscript(index, dir, phrase, known))) {
        return;
    }
    if (await syncSidecar(index, dir, phrase)) {
        forget(index, phrase);
        if (!(await syncTranscript(index, dir, phrase, undefined))) {
            return;
        }
        await syncSidecar(index, dir, phrase);
    }
    index.db.run(
        "DELETE FROM turns WHERE phrase = ? AND phrase IN (SELECT phrase FROM conversations WHERE hidden = 1)",
        [phrase],
    );
}

// Work that fails is undone alone, and says why; null when it succeeds. A
// failure that leaves no savepoint to undo it to, because SQLite ended the
// transaction, is the whole sync's: it is thrown as it was, for the lock
// to roll back.
async function inSavepoint(
    index: RecallIndex,
    work: () => Promise<void>,
): Promise<string | null> {
    index.db.run("SAVEPOINT sync");
    try {
        await work();
    } catch (error) {
        try {
            index.db.run("ROLLBACK TO sync");
        } catch {
            throw error;
        }
        index.db.run("RELEASE sync");
        return describeError(error);
    }
    index.db.run("RELEASE sync");
    return null;
}

// A file's mtime; null for one that is not there.
async function mtimeOf(path: string): Promise<number | null> {
    try {
        return (await stat(path)).mtimeMs;
    } catch (error) {
        if (codeOf(error) !== "ENOENT") {
            throw error;
        }
        return null;
    }
}

async function list(dir: string): Promise<string[]> {
    try {
        return await readdir(dir);
    } catch (error) {
        if (codeOf(error) !== "ENOENT") {
            throw error;
        }
        return [];
    }
}

// A conversation's turns read from its transcript, numbered as the index
// numbers them, for the one conversation whose text the index leaves out
// because it is hidden but which is the chat itself. Whole lines only.
export async function transcriptTurns(
    dir: string,
    phrase: string,
): Promise<
    { turn: number; role: "user" | "assistant"; at: number; text: string }[]
> {
    const text = await readFile(join(dir, `${phrase}.jsonl`), "utf8");
    const turns: Awaited<ReturnType<typeof transcriptTurns>> = [];
    let latest: number | null = null;
    for (const line of text.slice(0, text.lastIndexOf("\n") + 1).split("\n")) {
        const parsed = parseEvent(line);
        const turn = parsed === null ? "ignore" : toTurn(parsed.event);
        if (parsed === null || turn === "ignore" || turn === "malformed") {
            continue;
        }
        const at = parsed.at ?? latest ?? 0;
        latest = Math.max(latest ?? at, at);
        turns.push({
            turn: turns.length + 1,
            role: turn.role,
            at,
            text: turn.text,
        });
    }
    return turns;
}

function forget(index: RecallIndex, phrase: string): void {
    for (const sql of [
        "DELETE FROM turns WHERE phrase = ?",
        "DELETE FROM visits WHERE phrase = ?",
        "DELETE FROM reads WHERE reader = ?",
        "DELETE FROM appraisals WHERE reader = ?",
        "DELETE FROM clusters WHERE phrase = ?",
        "DELETE FROM tagged WHERE phrase = ?",
        "DELETE FROM conversation_sessions WHERE phrase = ?",
        "DELETE FROM conversations WHERE phrase = ?",
    ]) {
        index.db.run(sql, [phrase]);
    }
}

// False when the transcript has gone since the directory was listed.
async function syncTranscript(
    index: RecallIndex,
    dir: string,
    phrase: string,
    known: Row | undefined,
): Promise<boolean> {
    const path = join(dir, `${phrase}.jsonl`);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
        info = await stat(path);
    } catch (error) {
        if (codeOf(error) !== "ENOENT") {
            throw error;
        }
        if (known !== undefined) {
            forget(index, phrase);
        }
        return false;
    }
    let row = known;
    // Appends only ever grow a transcript; anything else is a new file.
    if (
        row !== undefined &&
        (info.ino !== row.t_ino || info.size < row.t_size)
    ) {
        forget(index, phrase);
        row = undefined;
    }
    if (row === undefined) {
        index.db.run(
            "INSERT INTO conversations (phrase, t_size, t_ino) VALUES (?, 0, ?)",
            [phrase, info.ino],
        );
        row = {
            phrase,
            t_size: 0,
            t_ino: info.ino,
            sessions: 0,
            turns: 0,
            first_at: null,
            last_at: null,
            s_mtime: null,
            hidden: 0,
        };
    }
    if (info.size === row.t_size) {
        return true;
    }
    const bytes = Buffer.alloc(info.size - row.t_size);
    let handle: Awaited<ReturnType<typeof open>>;
    try {
        handle = await open(path, "r");
    } catch (error) {
        if (codeOf(error) !== "ENOENT") {
            throw error;
        }
        // Gone between the stat and the open.
        forget(index, phrase);
        return false;
    }
    try {
        await handle.read(bytes, 0, bytes.length, row.t_size);
    } finally {
        await handle.close();
    }
    // A half-written last line waits for the next sync.
    const end = bytes.lastIndexOf(0x0a);
    if (end === -1) {
        return true;
    }
    applyLines(index, row, bytes.subarray(0, end + 1).toString("utf8"));
    index.db.run(
        "UPDATE conversations SET t_size = ?, sessions = ?, turns = ?, first_at = ?, last_at = ? WHERE phrase = ?",
        [
            row.t_size + end + 1,
            row.sessions,
            row.turns,
            row.first_at,
            row.last_at,
            phrase,
        ],
    );
    return true;
}

// Turns, visits and reads from complete lines, continuing the counts in row.
function applyLines(index: RecallIndex, row: Row, text: string): void {
    for (const line of text.split("\n")) {
        const parsed = parseEvent(line);
        if (parsed === null) {
            continue;
        }
        const { event, at } = parsed;
        if (event.kind === "session") {
            applySession(index, row, event);
        } else if (event.kind === "recall") {
            applyRead(index, row, event, at);
        } else {
            applyTurn(index, row, event, at);
        }
    }
}

// An event and its time; null for a line that is no event.
function parseEvent(
    line: string,
): { event: Record<string, unknown>; at: number | null } | null {
    if (line.trim() === "") {
        return null;
    }
    let event: unknown;
    try {
        event = JSON.parse(line);
    } catch {
        return null;
    }
    if (!isRecord(event)) {
        return null;
    }
    const parsed = typeof event.at === "string" ? Date.parse(event.at) : NaN;
    return { event, at: Number.isFinite(parsed) ? parsed : null };
}

// The first session says which body, and which project, the conversation
// began in; each names the body's session it records.
function applySession(
    index: RecallIndex,
    row: Row,
    event: Record<string, unknown>,
): void {
    if (row.sessions === 0) {
        index.db.run(
            "UPDATE conversations SET source = ?, project = ? WHERE phrase = ?",
            [
                sourceOf(event),
                typeof event.project === "string" ? event.project : null,
                row.phrase,
            ],
        );
    }
    if (typeof event.sourceSession === "string") {
        index.db.run(
            "INSERT OR IGNORE INTO conversation_sessions (session, phrase) VALUES (?, ?)",
            [event.sourceSession, row.phrase],
        );
    }
    row.sessions++;
}

// A conversation or a fact she opened.
function applyRead(
    index: RecallIndex,
    row: Row,
    event: Record<string, unknown>,
    at: number | null,
): void {
    const recall = toRecall(event);
    if (recall?.tool === "open" && recall.ok) {
        index.db.run(
            "INSERT OR IGNORE INTO reads (id, reader, target, at) VALUES (?, ?, ?, ?)",
            [
                recall.id,
                row.phrase,
                "fact" in recall ? recall.fact : recall.conversation,
                at ?? row.last_at ?? 0,
            ],
        );
    }
}

function applyTurn(
    index: RecallIndex,
    row: Row,
    event: Record<string, unknown>,
    at: number | null,
): void {
    const turn = toTurn(event);
    if (turn === "ignore" || turn === "malformed") {
        return;
    }
    row.turns++;
    const turnAt = at ?? row.last_at ?? 0;
    if (row.hidden === 0) {
        index.db.run(
            "INSERT INTO turns (phrase, n, role, at, text) VALUES (?, ?, ?, ?, ?)",
            [row.phrase, row.turns, turn.role, turnAt, turn.text],
        );
    }
    row.first_at = Math.min(row.first_at ?? turnAt, turnAt);
    row.last_at = Math.max(row.last_at ?? turnAt, turnAt);
    // As visitsOf counts them: a visit opens at each session event, and
    // what came before the first belongs to the first.
    if (turn.role === "user") {
        index.db.run(
            `INSERT INTO visits (phrase, n, user_turns, last_at) VALUES (?, ?, 1, ?)
             ON CONFLICT (phrase, n) DO UPDATE SET
                 user_turns = user_turns + 1,
                 last_at = coalesce(excluded.last_at, last_at)`,
            [row.phrase, Math.max(0, row.sessions - 1), at],
        );
    }
}

// True when the conversation was hidden and its sidecar no longer hides it,
// so its text, left out meanwhile, is to be read again.
async function syncSidecar(
    index: RecallIndex,
    dir: string,
    phrase: string,
): Promise<boolean> {
    const mtime = await mtimeOf(sidecarPath(dir, phrase));
    const { s_mtime: known, hidden: wasHidden } = index.db
        .query("SELECT s_mtime, hidden FROM conversations WHERE phrase = ?")
        .get(phrase) as { s_mtime: number | null; hidden: number };
    if (known === mtime) {
        return false;
    }
    const read: SidecarRead =
        mtime === null ? { kind: "none" } : await readSidecar(dir, phrase);
    const sidecar = read.kind === "ok" ? read.sidecar : null;
    index.db.run(
        "UPDATE conversations SET s_mtime = ?, sidecar = ?, title = ?, description = ?, abstract = ?, hidden = ? WHERE phrase = ?",
        [
            mtime,
            JSON.stringify(read),
            sidecar?.title ?? null,
            sidecar?.description ?? null,
            sidecar?.abstract ?? null,
            sidecar?.hidden ? 1 : 0,
            phrase,
        ],
    );
    index.db.run("DELETE FROM appraisals WHERE reader = ?", [phrase]);
    for (const [id, appraisal] of Object.entries(sidecar?.appraisals ?? {})) {
        index.db.run(
            "INSERT INTO appraisals (reader, id, served) VALUES (?, ?, ?)",
            [phrase, id, appraisal.served],
        );
    }
    index.db.run("DELETE FROM clusters WHERE phrase = ?", [phrase]);
    for (const [at, cluster] of (sidecar?.clusters ?? []).entries()) {
        index.db.run(
            "INSERT INTO clusters (phrase, n, first_turn, last_turn) VALUES (?, ?, ?, ?)",
            [phrase, at + 1, cluster.from, cluster.through],
        );
    }
    index.db.run("DELETE FROM tagged WHERE phrase = ?", [phrase]);
    for (const [n, id] of (sidecar?.tags ?? []).entries()) {
        index.db.run(
            "INSERT OR IGNORE INTO tagged (phrase, n, id) VALUES (?, ?, ?)",
            [phrase, n, id],
        );
    }
    return wasHidden === 1 && !sidecar?.hidden;
}

// tags.json, when its mtime differs from the one recorded. Every table
// is replaced: the vocabulary is small, and sidecars' ids are resolved
// through merged at query time, so no sidecar is read again.
async function syncVocabulary(index: RecallIndex, path: string): Promise<void> {
    const mtime = await mtimeOf(path);
    const known = index.db
        .query("SELECT mtime FROM vocabulary WHERE id = 1")
        .get() as { mtime: number | null };
    if (known.mtime === mtime) {
        return;
    }
    const read: VocabularyRead =
        mtime === null ? { kind: "none" } : await readVocabulary(path);
    for (const table of ["concepts", "labels", "broader", "merged"]) {
        index.db.run(`DELETE FROM ${table}`);
    }
    index.db.run("UPDATE vocabulary SET mtime = ?, broken = ? WHERE id = 1", [
        mtime,
        read.kind === "unparseable" ? read.reason : null,
    ]);
    if (read.kind !== "ok") {
        return;
    }
    for (const [id, term] of Object.entries(read.vocabulary.concepts)) {
        insertTerm(index, id, term);
    }
}

function insertTerm(index: RecallIndex, id: string, term: Term): void {
    if (isMerged(term)) {
        index.db.run("INSERT INTO merged (id, into_id) VALUES (?, ?)", [
            id,
            term.mergedInto,
        ]);
    }
    if (!isConcept(term)) {
        return;
    }
    index.db.run(
        "INSERT INTO concepts (id, label, alt, scope_note) VALUES (?, ?, ?, ?)",
        [id, term.prefLabel, JSON.stringify(term.altLabel), term.scopeNote],
    );
    for (const label of labelsOf(term)) {
        index.db.run("INSERT INTO labels (norm, id) VALUES (?, ?)", [
            labelKey(label),
            id,
        ]);
    }
    for (const parent of term.broader) {
        index.db.run("INSERT INTO broader (id, parent) VALUES (?, ?)", [
            id,
            parent,
        ]);
    }
}

// A crash between writing a sidecar's temporary file and renaming it leaves
// the file behind.
async function removeLeftovers(
    dir: string,
    names: readonly string[],
    now: number,
): Promise<void> {
    for (const name of names) {
        if (!LEFTOVER.test(name)) {
            continue;
        }
        const path = join(dir, name);
        try {
            if (now - (await stat(path)).mtimeMs > LEFTOVER_AGE_MS) {
                await rm(path, { force: true });
            }
        } catch {
            // Gone already, or not ours to remove.
        }
    }
}

// The sessions the user spoke in, per conversation, oldest first.
export function visitsByPhrase(index: RecallIndex): Map<string, VisitRow[]> {
    const visits = new Map<string, VisitRow[]>();
    const rows = index.db
        .query(
            "SELECT phrase, user_turns AS userTurns, last_at AS lastAt FROM visits WHERE user_turns > 0 AND last_at IS NOT NULL ORDER BY phrase, n",
        )
        .all() as (VisitRow & { phrase: string })[];
    for (const { phrase, ...visit } of rows) {
        visits.set(phrase, [...(visits.get(phrase) ?? []), visit]);
    }
    return visits;
}

// Each conversation's reads by others that Dorothy has appraised.
export function readsByTarget(index: RecallIndex): Map<string, ReadRow[]> {
    const reads = new Map<string, ReadRow[]>();
    const rows = index.db
        .query(
            `SELECT r.target AS phrase, r.at AS at, a.served AS served
             FROM reads r JOIN appraisals a ON a.reader = r.reader AND a.id = r.id
             WHERE r.reader != r.target ORDER BY r.target, r.at`,
        )
        .all() as (ReadRow & { phrase: string })[];
    for (const { phrase, ...read } of rows) {
        reads.set(phrase, [...(reads.get(phrase) ?? []), read]);
    }
    return reads;
}

// The conversation a body's session belongs to, as its session events
// say; null for a session never recorded. A plain read, so callable
// inside exclusive.
export function sessionPhrase(
    index: RecallIndex,
    session: string,
): string | null {
    const row = index.db
        .query("SELECT phrase FROM conversation_sessions WHERE session = ?")
        .get(session) as { phrase: string } | null;
    return row?.phrase ?? null;
}
