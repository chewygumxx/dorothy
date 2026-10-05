// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/recall/sync.ts
//
//

import { open, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
    readSidecar,
    type Served,
    type SidecarRead,
    sidecarPath,
} from "../memory/sidecar.js";
import { isPhrase } from "../session-id.js";
import { toRecall, toTurn } from "../transcript.js";
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
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const codeOf = (error: unknown) => (error as { code?: unknown }).code;

// Brings the index up to date with the transcripts directory: what was
// appended, replaced or deleted, and every sidecar that changed.
export async function syncIndex(
    index: RecallIndex,
    dir: string,
    now: number = Date.now(),
): Promise<void> {
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
                        "SELECT phrase, t_size, t_ino, sessions, turns, first_at, last_at, s_mtime FROM conversations",
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
            if (await syncTranscript(index, dir, phrase, rows.get(phrase))) {
                await syncSidecar(index, dir, phrase);
            }
        }
        return listing;
    });
    await removeLeftovers(dir, names, now);
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

function forget(index: RecallIndex, phrase: string): void {
    for (const sql of [
        "DELETE FROM turns WHERE phrase = ?",
        "DELETE FROM visits WHERE phrase = ?",
        "DELETE FROM reads WHERE reader = ?",
        "DELETE FROM appraisals WHERE reader = ?",
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
        };
    }
    if (info.size === row.t_size) {
        return true;
    }
    const bytes = Buffer.alloc(info.size - row.t_size);
    const handle = await open(path, "r");
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
        if (line.trim() === "") {
            continue;
        }
        let event: unknown;
        try {
            event = JSON.parse(line);
        } catch {
            continue;
        }
        const parsed =
            isRecord(event) && typeof event.at === "string"
                ? Date.parse(event.at)
                : Number.NaN;
        const at = Number.isFinite(parsed) ? parsed : null;
        const kind = isRecord(event) ? event.kind : undefined;
        if (kind === "session") {
            row.sessions++;
            continue;
        }
        if (kind === "recall") {
            const recall = toRecall(event);
            if (recall?.tool === "open" && recall.ok) {
                index.db.run(
                    "INSERT OR IGNORE INTO reads (id, reader, target, at) VALUES (?, ?, ?, ?)",
                    [
                        recall.id,
                        row.phrase,
                        recall.conversation,
                        at ?? row.last_at ?? 0,
                    ],
                );
            }
            continue;
        }
        const turn = toTurn(event);
        if (turn === "ignore" || turn === "malformed") {
            continue;
        }
        row.turns++;
        const turnAt = at ?? row.last_at ?? 0;
        index.db.run(
            "INSERT INTO turns (phrase, n, role, at, text) VALUES (?, ?, ?, ?, ?)",
            [row.phrase, row.turns, turn.role, turnAt, turn.text],
        );
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
}

async function syncSidecar(
    index: RecallIndex,
    dir: string,
    phrase: string,
): Promise<void> {
    let mtime: number | null = null;
    try {
        mtime = (await stat(sidecarPath(dir, phrase))).mtimeMs;
    } catch (error) {
        if (codeOf(error) !== "ENOENT") {
            throw error;
        }
    }
    const { s_mtime: known } = index.db
        .query("SELECT s_mtime FROM conversations WHERE phrase = ?")
        .get(phrase) as { s_mtime: number | null };
    if (known === mtime) {
        return;
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
