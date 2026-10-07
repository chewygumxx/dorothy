// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/recall/tags.ts
//
//

import { labelKey } from "../memory/vocabulary.js";
import type { RecallIndex } from "./store.js";

// Why tags.json could not be read when last synced; null when it could,
// or there is none.
export function vocabularyBroken(index: RecallIndex): string | null {
    const row = index.db
        .query("SELECT broken FROM vocabulary WHERE id = 1")
        .get() as { broken: string | null } | null;
    return row?.broken ?? null;
}

export type CarrierRow = { id: string; phrase: string; hidden: boolean };

// Each live concept with every conversation that carries it or anything
// narrower, merged ids followed. UNION keeps the walk finite through a
// diamond, or a cycle should one ever slip through.
export function carriers(index: RecallIndex): CarrierRow[] {
    const rows = index.db
        .query(
            `WITH RECURSIVE under (ancestor, id) AS (
                SELECT id, id FROM concepts
                UNION
                SELECT u.ancestor, b.id FROM under u
                JOIN broader b ON b.parent = u.id
            )
            SELECT DISTINCT u.ancestor AS id, t.phrase AS phrase,
                c.hidden AS hidden
            FROM tagged t
            LEFT JOIN merged m ON m.id = t.id
            JOIN under u ON u.id = coalesce(m.into_id, t.id)
            JOIN conversations c ON c.phrase = t.phrase`,
        )
        .all() as { id: string; phrase: string; hidden: number }[];
    return rows.map((row) => ({ ...row, hidden: row.hidden !== 0 }));
}

// The concepts Dorothy may see: all but those whose every carrier is
// hidden or the excluded conversation. One nobody carries is listed.
export function listedConcepts(
    index: RecallIndex,
    exclude: string,
    rows: readonly CarrierRow[] = carriers(index),
): Set<string> {
    const carried = new Set<string>();
    const visible = new Set<string>();
    for (const row of rows) {
        carried.add(row.id);
        if (!row.hidden && row.phrase !== exclude) {
            visible.add(row.id);
        }
    }
    const ids = index.db.query("SELECT id FROM concepts").all() as {
        id: string;
    }[];
    return new Set(
        ids
            .map((row) => row.id)
            .filter((id) => !carried.has(id) || visible.has(id)),
    );
}

// The live concept a label names, by its preferred or an alternative label.
export function conceptByLabel(
    index: RecallIndex,
    label: string,
): string | null {
    const row = index.db
        .query("SELECT id FROM labels WHERE norm = ?")
        .get(labelKey(label)) as { id: string } | null;
    return row?.id ?? null;
}

// The preferred labels of the concepts a conversation carries itself, in
// its order, merges followed.
export function keywordsOf(index: RecallIndex, phrase: string): string[] {
    const rows = index.db
        .query(
            `SELECT c.label AS label FROM tagged t
             LEFT JOIN merged m ON m.id = t.id
             JOIN concepts c ON c.id = coalesce(m.into_id, t.id)
             WHERE t.phrase = ? ORDER BY t.n`,
        )
        .all(phrase) as { label: string }[];
    return [...new Set(rows.map((row) => row.label))];
}

// How many conversations carry each concept, hidden ones too: the user's
// count, never Dorothy's.
export function carrierCounts(index: RecallIndex): Map<string, number> {
    const counts = new Map<string, number>();
    for (const row of carriers(index)) {
        counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
    }
    return counts;
}

// The concepts strictly beneath one.
export function narrowerThan(index: RecallIndex, id: string): Set<string> {
    const rows = index.db
        .query(
            `WITH RECURSIVE below (id) AS (
                SELECT id FROM broader WHERE parent = ?
                UNION
                SELECT b.id FROM broader b JOIN below ON b.parent = below.id
            )
            SELECT id FROM below`,
        )
        .all(id) as { id: string }[];
    return new Set(rows.map((row) => row.id));
}
