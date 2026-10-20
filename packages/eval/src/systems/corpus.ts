// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/corpus.ts
//
//

// The snapshot's archive, opened once for every system, and its items as
// text a model reads.

import type { Env } from "@dorothy/core";
import {
    type Archive,
    type ArchiveConversation,
    type ArchiveKnowledge,
    type ArchiveTurn,
    openArchive,
} from "@dorothy/memory/evaluation";
import { firstTermAt, scoreOf } from "./terms.js";

export type Corpus = {
    archive: Archive;
    // By contract id.
    conversations: Map<string, ArchiveConversation>;
    knowledge: Map<string, ArchiveKnowledge>;
    close(): void;
};

export async function openCorpus(env: Env): Promise<Corpus> {
    const archive = await openArchive(env);
    try {
        return {
            archive,
            conversations: new Map(
                archive.conversations().map((each) => [each.id, each]),
            ),
            knowledge: new Map(
                (await archive.knowledge()).map((each) => [each.id, each]),
            ),
            close: () => archive.close(),
        };
    } catch (error) {
        archive.close();
        throw error;
    }
}

export const clip = (text: string, chars: number) =>
    text.length <= chars ? text : text.slice(0, Math.max(0, chars));

const day = (at: string) => at.slice(0, 10);
const minute = (at: string) => at.slice(0, 16).replace("T", " ");

export function conversationText(
    conversation: ArchiveConversation,
    turns: ArchiveTurn[] = conversation.turns,
): string {
    const project =
        conversation.project === null ? "" : ` (${conversation.project})`;
    const head = `${conversation.title ?? "Untitled"}${project}, ${day(conversation.firstAt)} to ${day(conversation.lastAt)}`;
    return [
        head,
        ...turns.map(
            (turn) =>
                `[${turn.n}] ${turn.role}, ${minute(turn.at)}: ${turn.text}`,
        ),
    ].join("\n");
}

export function knowledgeText(knowledge: ArchiveKnowledge): string {
    const retired =
        knowledge.retired === null
            ? ""
            : `, retired ${day(knowledge.retired.at)}: ${knowledge.retired.why}`;
    return [
        `${knowledge.title} (${knowledge.type}, ${knowledge.scope}, ${day(knowledge.at)}${retired})`,
        knowledge.description,
        knowledge.body,
    ]
        .filter((line) => line !== "")
        .join("\n");
}

// The turns that best match terms, each with its neighbours, in order,
// within chars; the first turns where none match. A first turn too long
// for chars is excerpted around its first match, not left out.
export function passage(
    conversation: ArchiveConversation,
    terms: readonly string[],
    chars: number,
): string {
    const turns = conversation.turns;
    const scored = turns
        .map((turn, at) => ({ at, score: scoreOf(turn.text, terms) }))
        .filter((each) => each.score > 0)
        .sort((a, b) => b.score - a.score || a.at - b.at);
    const order = scored.length > 0 ? scored : [{ at: 0, score: 0 }];
    const chosen = new Set<number>();
    const render = () =>
        conversationText(
            conversation,
            [...chosen]
                .sort((a, b) => a - b)
                .map((at) => turns[at] as ArchiveTurn),
        );
    for (const { at } of order) {
        for (const near of [at, at - 1, at + 1]) {
            if (near < 0 || near >= turns.length || chosen.has(near)) {
                continue;
            }
            chosen.add(near);
            if (render().length > chars) {
                chosen.delete(near);
                return chosen.size === 0
                    ? excerpt(
                          conversation,
                          turns[near] as ArchiveTurn,
                          terms,
                          chars,
                      )
                    : clip(render(), chars);
            }
        }
    }
    return clip(render(), chars);
}

const ELLIPSIS = "\u2026";

// One turn cut to the room chars leaves it, around the first of terms it
// holds, or from its start.
function excerpt(
    conversation: ArchiveConversation,
    turn: ArchiveTurn,
    terms: readonly string[],
    chars: number,
): string {
    const room =
        chars -
        conversationText(conversation, [{ ...turn, text: "" }]).length -
        2 * ELLIPSIS.length;
    if (room <= 0) {
        return clip(conversationText(conversation, []), chars);
    }
    const hit = firstTermAt(turn.text, terms);
    const end = Math.min(
        turn.text.length,
        Math.max(0, (hit ?? 0) - Math.floor(room / 4)) + room,
    );
    const start = Math.max(0, end - room);
    const text = `${start > 0 ? ELLIPSIS : ""}${turn.text.slice(start, end)}${end < turn.text.length ? ELLIPSIS : ""}`;
    return conversationText(conversation, [{ ...turn, text }]);
}
