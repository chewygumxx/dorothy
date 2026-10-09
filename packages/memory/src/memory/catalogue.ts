// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/catalogue.ts
//
//

import type { RecallIndex } from "../recall/store.js";
import { readsByTarget, syncIndex, visitsByPhrase } from "../recall/sync.js";
import { type Served, type SidecarRead, sidecarPath } from "./sidecar.js";

// One session in which the user said something: how much, and when last.
export type Visit = { userTurns: number; lastAt: number };

// A read of this conversation from another, as Dorothy appraised it.
export type Read = { at: number; served: Served };

export type Entry = {
    phrase: string;
    sidecar: SidecarRead;
    visits: Visit[];
    reads: Read[];
    // As parseTranscript counts them; more than reviewedThrough is stale.
    turns: number;
    lastActive: number;
};

// Behind an interface; recall's SQLite index provides it.
export interface Catalogue {
    load(): Promise<{ entries: Entry[]; warnings: string[] }>;
}

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// Brings the index up to date, then reads every conversation the user spoke
// in from it. Conversations the user never spoke in are left out.
export function indexCatalogue(
    index: RecallIndex,
    dir: string,
    vocabulary: string | null = null,
): Catalogue {
    return {
        async load() {
            let synced: string[];
            try {
                synced = await syncIndex(index, dir, Date.now(), vocabulary);
            } catch (error) {
                return {
                    entries: [],
                    warnings: [`memory: ${describeError(error)}`],
                };
            }
            // Read in the queue: other work on the shared connection may be
            // holding a transaction open across awaits.
            try {
                return await index.exclusive(() => {
                    const visits = visitsByPhrase(index);
                    const reads = readsByTarget(index);
                    const rows = index.db
                        .query(
                            "SELECT phrase, sidecar, turns FROM conversations ORDER BY phrase",
                        )
                        .all() as {
                        phrase: string;
                        sidecar: string;
                        turns: number;
                    }[];
                    const entries: Entry[] = [];
                    const warnings = synced.map(
                        (warning) => `memory: ${warning}`,
                    );
                    for (const row of rows) {
                        const own = visits.get(row.phrase) ?? [];
                        if (own.length === 0) {
                            continue;
                        }
                        const sidecar = JSON.parse(row.sidecar) as SidecarRead;
                        if (sidecar.kind === "unparseable") {
                            warnings.push(
                                `memory: ${sidecarPath(dir, row.phrase)}: ${sidecar.reason}`,
                            );
                        }
                        entries.push({
                            phrase: row.phrase,
                            sidecar,
                            visits: own,
                            reads: reads.get(row.phrase) ?? [],
                            turns: row.turns,
                            lastActive: Math.max(
                                ...own.map((visit) => visit.lastAt),
                            ),
                        });
                    }
                    return { entries, warnings };
                });
            } catch (error) {
                return {
                    entries: [],
                    warnings: [`memory: ${describeError(error)}`],
                };
            }
        },
    };
}
