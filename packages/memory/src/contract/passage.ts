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

export type TurnRange = { from: number; through: number };
// A passage, its first and last turn, and whether its text was cut
// short rather than ended at a turn.
export type Passage = {
    text: string;
    turns: TurnRange | null;
    cut: boolean;
};

// The turns that best match, each with its neighbours, in order, within
// chars: search's matched turns where the conversation still holds any
// (the seeds, by number), else the turns by how many terms they hold;
// the first turn where nothing matches. A first turn too long for chars
// is excerpted around its first match, not left out. cost is what a
// text costs against chars: its escaped length where the caller
// escapes.
export function passage(
    conversation: EvidenceConversation,
    terms: readonly string[],
    chars: number,
    seeds: readonly number[] = [],
    cost: (text: string) => number = (text) => text.length,
): Passage {
    const turns = conversation.turns;
    const seeded = [
        ...new Set(
            seeds
                .map((n) => turns.findIndex((turn) => turn.n === n))
                .filter((at) => at >= 0),
        ),
    ];
    const scored = turns
        .map((turn, at) => ({ at, score: scoreOf(turn.text, terms) }))
        .filter((each) => each.score > 0)
        .sort((a, b) => b.score - a.score || a.at - b.at)
        .map((each) => each.at);
    const order = seeded.length > 0 ? seeded : scored.length > 0 ? scored : [0];
    const chosen = new Set<number>();
    const picked = () =>
        [...chosen]
            .sort((a, b) => a - b)
            .map((at) => turns[at] as EvidenceTurn);
    const result = (whole: string): Passage => {
        const numbers = picked().map((turn) => turn.n);
        const [from, through] = [numbers[0], numbers.at(-1)];
        const text = clip(whole, chars);
        return {
            text,
            turns:
                from === undefined || through === undefined
                    ? null
                    : { from, through },
            cut: text.length < whole.length,
        };
    };
    const render = () => conversationText(conversation, picked());
    for (const at of order) {
        for (const near of [at, at - 1, at + 1]) {
            if (near < 0 || near >= turns.length || chosen.has(near)) {
                continue;
            }
            chosen.add(near);
            if (cost(render()) > chars) {
                chosen.delete(near);
                return chosen.size === 0
                    ? excerpt(
                          conversation,
                          turns[near] as EvidenceTurn,
                          terms,
                          chars,
                          cost,
                      )
                    : result(render());
            }
        }
    }
    return result(render());
}

const ELLIPSIS = "\u2026";

// One turn cut to the room chars leaves it, around the first of terms it
// holds, or from its start; narrowed until its cost fits.
function excerpt(
    conversation: EvidenceConversation,
    turn: EvidenceTurn,
    terms: readonly string[],
    chars: number,
    cost: (text: string) => number,
): Passage {
    const hit = firstTermAt(turn.text, terms);
    let room =
        chars -
        cost(conversationText(conversation, [{ ...turn, text: "" }])) -
        2 * ELLIPSIS.length;
    while (room > 0) {
        const end = Math.min(
            turn.text.length,
            Math.max(0, (hit ?? 0) - Math.floor(room / 4)) + room,
        );
        const start = Math.max(0, end - room);
        const text = `${start > 0 ? ELLIPSIS : ""}${turn.text.slice(start, end)}${end < turn.text.length ? ELLIPSIS : ""}`;
        const rendered = conversationText(conversation, [{ ...turn, text }]);
        const over = cost(rendered) - chars;
        if (over <= 0) {
            return {
                text: rendered,
                turns: { from: turn.n, through: turn.n },
                cut: true,
            };
        }
        // Over is in cost, room in characters: shrink room by the share
        // of the window's cost that fits, at least one a time.
        const spent = Math.max(1, cost(text));
        room = Math.min(
            room - 1,
            Math.floor((room * Math.max(0, spent - over)) / spent),
        );
    }
    return {
        text: clip(conversationText(conversation, []), chars),
        turns: null,
        cut: true,
    };
}

const TURN_LINE = /^\[(\d+)\] (?:user|assistant), /gm;

// The first and last turn whose line a passage's text holds, as
// conversationText writes them; null where it holds none.
export function turnsIn(text: string): TurnRange | null {
    const numbers = [...text.matchAll(TURN_LINE)].map((match) =>
        Number(match[1]),
    );
    return numbers.length === 0
        ? null
        : { from: Math.min(...numbers), through: Math.max(...numbers) };
}

// Items as <item> elements within budget, the last one cut to fit: the
// text, the ids that went in, each one's text as it went in, and
// whether the last was cut.
export function pack(
    items: readonly { id: string; text: string }[],
    budget: number,
): { text: string; ids: string[]; texts: string[]; cut: boolean } {
    const parts: string[] = [];
    const ids: string[] = [];
    const texts: string[] = [];
    let left = budget;
    let cut = false;
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
        texts.push(text);
        left -= open.length + text.length + close.length;
        if (text.length < item.text.length) {
            cut = true;
            break;
        }
    }
    return { text: parts.join(""), ids, texts, cut };
}
