// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/passage.ts
//
//

// Items as text a model reads: a conversation's passages by its matching
// turns, knowledge as a page, and packing them within a budget.

import { firstTermAt, scoreOf } from "./terms.js";

export type EvidenceTurn = {
    n: number;
    role: "user" | "assistant";
    at: string;
    text: string;
};
export type EvidenceConversation = {
    id: string;
    phrase: string;
    project: string | null;
    title: string | null;
    firstAt: string;
    lastAt: string;
    turns: EvidenceTurn[];
};
export type EvidenceKnowledge = {
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

export const clip = (text: string, chars: number) =>
    text.length <= chars ? text : text.slice(0, Math.max(0, chars));

const day = (at: string) => at.slice(0, 10);
const minute = (at: string) => at.slice(0, 16).replace("T", " ");

export function conversationText(
    conversation: EvidenceConversation,
    turns: EvidenceTurn[] = conversation.turns,
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

export function knowledgeText(knowledge: EvidenceKnowledge): string {
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
    conversation: EvidenceConversation,
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
                .map((at) => turns[at] as EvidenceTurn),
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
                          turns[near] as EvidenceTurn,
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
    conversation: EvidenceConversation,
    turn: EvidenceTurn,
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

// Items as <item> elements within budget, the last one cut to fit, and
// the ids of the items that went in.
export function pack(
    items: readonly { id: string; text: string }[],
    budget: number,
): { text: string; ids: string[] } {
    const parts: string[] = [];
    const ids: string[] = [];
    let left = budget;
    for (const item of items) {
        const open = `<item id="${item.id}">\n`;
        const close = "\n</item>\n";
        const room = left - open.length - close.length;
        if (room <= 0) {
            break;
        }
        const text = item.text.slice(0, room);
        parts.push(open + text + close);
        ids.push(item.id);
        left -= open.length + text.length + close.length;
        if (text.length < item.text.length) {
            break;
        }
    }
    return { text: parts.join(""), ids };
}
