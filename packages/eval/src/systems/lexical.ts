// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/lexical.ts
//
//

// The bound from below: every turn and knowledge file scored by how many
// of the question's terms it holds, with no index, as grep would find.

import {
    type DeliveredItem,
    knowledgeText,
    packDelivery,
    passage,
    scoreOf,
    termsOf,
} from "@dorothy/memory/evaluation";
import type { Corpus } from "./corpus.js";
import type { System } from "./system.js";

type Scored = {
    id: string;
    score: number;
    at: string;
    item: () => DeliveredItem;
};

const newestFirst = (a: Scored, b: Scored) =>
    b.score - a.score ||
    (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) ||
    (a.id < b.id ? -1 : 1);

export function lexicalSystem(corpus: Corpus): System {
    return {
        name: "lexical",
        async retrieve(asked, budget) {
            const terms = termsOf(asked.text);
            const scored: Scored[] = [];
            for (const conversation of corpus.conversations.values()) {
                if (conversation.phrase === asked.exclude) {
                    continue;
                }
                let score = 0;
                for (const turn of conversation.turns) {
                    score = Math.max(score, scoreOf(turn.text, terms));
                }
                if (score > 0) {
                    scored.push({
                        id: conversation.id,
                        score,
                        at: conversation.lastAt,
                        item: () => {
                            const found = passage(
                                conversation,
                                terms,
                                Math.floor(budget / 3),
                            );
                            return {
                                id: conversation.id,
                                kind: "episode",
                                turns: found.turns,
                                text: found.text,
                                cut: found.cut,
                                opened: true,
                            };
                        },
                    });
                }
            }
            for (const knowledge of corpus.knowledge.values()) {
                const score = scoreOf(knowledgeText(knowledge), terms);
                if (score > 0) {
                    scored.push({
                        id: knowledge.id,
                        score,
                        at: knowledge.at,
                        item: () => ({
                            id: knowledge.id,
                            kind: "knowledge",
                            turns: null,
                            text: knowledgeText(knowledge),
                            cut: false,
                            opened: true,
                        }),
                    });
                }
            }
            scored.sort(newestFirst);
            const best = scored.slice(0, 20);
            const delivery = packDelivery(
                best.map((each) => each.item()),
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
