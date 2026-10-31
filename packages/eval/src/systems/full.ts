// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/full.ts
//
//

// The bound from above, where it fits: everything, newest first, until
// the budget. Its ranked ids are what fitted.

import {
    conversationText,
    type DeliveredItem,
    type EvidenceTurn,
    knowledgeText,
    packDelivery,
    type TurnRange,
} from "@dorothy/memory/evaluation";
import type { Corpus } from "./corpus.js";
import type { System } from "./system.js";

// A conversation's first turn to its last; null for one with none.
function rangeOf(turns: readonly EvidenceTurn[]): TurnRange | null {
    const first = turns[0];
    const last = turns[turns.length - 1];
    return first === undefined || last === undefined
        ? null
        : { from: first.n, through: last.n };
}

export function fullSystem(corpus: Corpus): System {
    // Everything, newest first, delivered whole, made once for the corpus; a
    // question only leaves its own conversation out.
    let items: {
        at: string;
        phrase: string | null;
        item: DeliveredItem;
    }[];
    const everything = () => {
        items ??= [
            ...[...corpus.conversations.values()].map((each) => ({
                at: each.lastAt,
                phrase: each.phrase,
                item: {
                    id: each.id,
                    kind: "episode" as const,
                    turns: rangeOf(each.turns),
                    text: conversationText(each),
                    cut: false,
                    opened: true,
                },
            })),
            ...[...corpus.knowledge.values()].map((each) => ({
                at: each.at,
                phrase: null,
                item: {
                    id: each.id,
                    kind: "knowledge" as const,
                    turns: null,
                    text: knowledgeText(each),
                    cut: false,
                    opened: true,
                },
            })),
        ].sort(
            (a, b) =>
                (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) ||
                (a.item.id < b.item.id ? -1 : 1),
        );
        return items;
    };
    return {
        name: "full",
        async retrieve(asked, budget) {
            const delivery = packDelivery(
                everything()
                    .filter(
                        (each) =>
                            asked.exclude === null ||
                            each.phrase !== asked.exclude,
                    )
                    .map((each) => each.item),
                budget,
            );
            return {
                ranked: delivery.items.map((item) => item.id),
                context: delivery.text,
                items: delivery.items,
            };
        },
    };
}
