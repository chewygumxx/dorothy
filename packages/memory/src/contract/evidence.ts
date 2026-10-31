// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/evidence.ts
//
//

// What delivery reads of Dorothy's own archive: a visible conversation's
// turns from the recall index by contract id, under the index's lock,
// and a piece of knowledge from its own file.

import { knowledgeId, parseMemoryId } from "@dorothy/core";
import { knowledgePath } from "../engine/engine.js";
import type { Fact } from "../facts/file.js";
import {
    factPath,
    PERSONAL,
    readFactFile,
    type Scope,
} from "../facts/store.js";
import type { RecallIndex } from "../recall/store.js";
import type { EvidenceSource } from "./deliver.js";
import type {
    EvidenceConversation,
    EvidenceKnowledge,
    EvidenceTurn,
} from "./passage.js";

type TurnRow = {
    n: number;
    role: "user" | "assistant";
    at: number;
    text: string;
};
type ConversationRow = {
    project: string | null;
    title: string | null;
    first_at: number;
    last_at: number;
};

const iso = (ms: number) => new Date(ms).toISOString();

export function turnsOf(index: RecallIndex, phrase: string): EvidenceTurn[] {
    return (
        index.db
            .query(
                "SELECT n, role, at, text FROM turns WHERE phrase = ? ORDER BY n",
            )
            .all(phrase) as TurnRow[]
    ).map((turn) => ({ ...turn, at: iso(turn.at) }));
}

export function knowledgeRecord(scope: Scope, fact: Fact): EvidenceKnowledge {
    return {
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
    };
}

// A knowledge id's scope and name: personal/<name>, or
// projects/<id>/<name>, whose id may hold slashes.
function scopeOf(path: string): { scope: Scope; name: string } | null {
    const at = path.lastIndexOf("/");
    const [where, name] = [path.slice(0, at), path.slice(at + 1)];
    if (where === "personal") {
        return { scope: PERSONAL, name };
    }
    return where.startsWith("projects/")
        ? { scope: { kind: "project", id: where.slice(9) }, name }
        : null;
}

export function indexEvidence(
    index: RecallIndex,
    root: string,
): EvidenceSource {
    return {
        async conversation(id): Promise<EvidenceConversation | undefined> {
            const parsed = parseMemoryId(id);
            if (parsed === null || parsed.kind !== "conversation") {
                return undefined;
            }
            return index.exclusive(() => {
                const row = index.db
                    .query(
                        `SELECT project, title, first_at, last_at
                         FROM conversations
                         WHERE phrase = ? AND hidden = 0
                             AND first_at IS NOT NULL`,
                    )
                    .get(parsed.phrase) as ConversationRow | null;
                return row === null
                    ? undefined
                    : {
                          id,
                          phrase: parsed.phrase,
                          project: row.project,
                          title: row.title,
                          firstAt: iso(row.first_at),
                          lastAt: iso(row.last_at),
                          turns: turnsOf(index, parsed.phrase),
                      };
            });
        },
        async knowledge(id) {
            const parsed = parseMemoryId(id);
            const target =
                parsed?.kind === "knowledge" ? scopeOf(parsed.path) : null;
            if (target === null) {
                return undefined;
            }
            const read = await readFactFile(
                factPath(root, target.scope, target.name),
                target.name,
            );
            return read.kind === "ok"
                ? knowledgeRecord(target.scope, read.fact)
                : undefined;
        },
    };
}
