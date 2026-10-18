// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/engine/archive.ts
//
//

// The archive as the memory evaluation reads it: the baseline engine over
// an environment's roots, and the conversations, knowledge and appraised
// reads it holds, as plain records. It writes only the recall index,
// where the environment points.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
    conversationId,
    DEFAULT_CONFIG,
    type Env,
    knowledgeId,
} from "@dorothy/core";
import { buildBlock } from "../contract/block.js";
import { dataRoot, listFacts } from "../facts/store.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { keywordsOf, vocabularyBroken } from "../recall/tags.js";
import { readTranscript, transcriptPath } from "../transcript.js";
import { baselineEngine, knowledgePath } from "./baseline.js";
import type { MemoryEngine } from "./engine.js";

export type ArchiveTurn = {
    n: number;
    role: "user" | "assistant";
    at: string;
    text: string;
};
export type ArchiveConversation = {
    id: string;
    phrase: string;
    project: string | null;
    title: string | null;
    // Her concepts' labels.
    tags: string[];
    firstAt: string;
    lastAt: string;
    turns: ArchiveTurn[];
};
export type ArchiveKnowledge = {
    id: string;
    // "personal", or the project's id.
    scope: string;
    type: string;
    title: string;
    description: string;
    body: string;
    at: string;
    retired: { at: string; why: string } | null;
};
// A read her review judged useful or essential: her purpose, and what
// she opened for it, as a contract id.
export type AppraisedRead = {
    reader: string;
    target: string;
    purpose: string;
    served: "useful" | "essential";
    at: string;
};
export type Archive = {
    engine: MemoryEngine;
    block(request: {
        project: string | null;
        budget: number;
        exclude: string | null;
    }): Promise<{ text: string; ids: string[] }>;
    conversations(): ArchiveConversation[];
    knowledge(): Promise<ArchiveKnowledge[]>;
    appraisedReads(): Promise<AppraisedRead[]>;
    close(): void;
};

type ConversationRow = {
    phrase: string;
    project: string | null;
    title: string | null;
    first_at: number;
    last_at: number;
};
type TurnRow = {
    n: number;
    role: "user" | "assistant";
    at: number;
    text: string;
};
type ReadRow = {
    id: string;
    reader: string;
    target: string;
    at: number;
    served: "useful" | "essential";
};

const iso = (ms: number) => new Date(ms).toISOString();

// The purpose of each open in a transcript, by its tool call's id.
async function purposesOf(path: string): Promise<Map<string, string>> {
    const byId = new Map<string, string>();
    try {
        const { turns } = await readTranscript(path);
        for (const turn of turns) {
            for (const lookup of turn.lookups ?? []) {
                if (lookup.tool === "open") {
                    byId.set(lookup.id, lookup.purpose);
                }
            }
        }
    } catch {
        // A transcript gone since the index was built has no purposes.
    }
    return byId;
}

export async function openArchive(
    env: Env,
    options: { now?: () => number } = {},
): Promise<Archive> {
    mkdirSync(dirname(indexPath(env)), { recursive: true, mode: 0o700 });
    const index = RecallIndex.open(indexPath(env));
    const engine = baselineEngine({
        env,
        index,
        halfLifeDays: DEFAULT_CONFIG.memory.halfLifeDays,
        reviewer: null,
        now: options.now,
    });
    try {
        await engine.index();
    } catch (error) {
        index.close();
        throw error;
    }
    const isConversation = (phrase: string) =>
        index.db
            .query("SELECT 1 FROM conversations WHERE phrase = ?")
            .get(phrase) !== null;
    // A fact as recall names it, personal/<name> or <project>/<name>; a
    // phrase no longer in the index names nothing.
    const targetOf = (target: string): string | null =>
        isConversation(target)
            ? conversationId(target)
            : target.includes("/")
              ? knowledgeId(
                    target.startsWith("personal/")
                        ? target
                        : `projects/${target}`,
                )
              : null;
    return {
        engine,
        async block(request) {
            const response = await buildBlock(request, engine);
            return {
                text: response.text,
                ids: response.items.map((item) => item.id),
            };
        },
        conversations() {
            const labelled = vocabularyBroken(index) === null;
            const rows = index.db
                .query(
                    `SELECT phrase, project, title, first_at, last_at
                     FROM conversations
                     WHERE hidden = 0 AND first_at IS NOT NULL
                     ORDER BY first_at, phrase`,
                )
                .all() as ConversationRow[];
            const turns = index.db.query(
                "SELECT n, role, at, text FROM turns WHERE phrase = ? ORDER BY n",
            );
            return rows.map((row) => ({
                id: conversationId(row.phrase),
                phrase: row.phrase,
                project: row.project,
                title: row.title,
                tags: labelled ? keywordsOf(index, row.phrase) : [],
                firstAt: iso(row.first_at),
                lastAt: iso(row.last_at),
                turns: (turns.all(row.phrase) as TurnRow[]).map((turn) => ({
                    n: turn.n,
                    role: turn.role,
                    at: iso(turn.at),
                    text: turn.text,
                })),
            }));
        },
        async knowledge() {
            const { facts } = await listFacts(dataRoot(env));
            return facts.map(({ scope, fact }) => ({
                id: knowledgeId(knowledgePath(scope, fact.name)),
                scope: scope.kind === "personal" ? "personal" : scope.id,
                type: fact.type,
                title: fact.title,
                description: fact.description,
                body: fact.body,
                at: fact.provenance.at,
                retired:
                    fact.retired === null
                        ? null
                        : { at: fact.retired.at, why: fact.retired.why },
            }));
        },
        async appraisedReads() {
            const rows = index.db
                .query(
                    `SELECT r.id, r.reader, r.target, r.at, a.served
                     FROM reads r
                     JOIN appraisals a ON a.reader = r.reader AND a.id = r.id
                     WHERE a.served IN ('useful', 'essential')
                     ORDER BY r.at, r.id`,
                )
                .all() as ReadRow[];
            const purposes = new Map<string, Map<string, string>>();
            const found: AppraisedRead[] = [];
            for (const row of rows) {
                let byId = purposes.get(row.reader);
                if (byId === undefined) {
                    byId = await purposesOf(transcriptPath(row.reader, env));
                    purposes.set(row.reader, byId);
                }
                const purpose = byId.get(row.id);
                const target = targetOf(row.target);
                if (purpose === undefined || target === null) {
                    continue;
                }
                found.push({
                    reader: row.reader,
                    target,
                    purpose,
                    served: row.served,
                    at: iso(row.at),
                });
            }
            return found;
        },
        close() {
            index.close();
        },
    };
}
