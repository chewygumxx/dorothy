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
    knowledgeText,
    pack,
    passage,
    scoreOf,
    termsOf,
} from "@dorothy/memory/evaluation";
import type { Corpus } from "./corpus.js";
import type { System } from "./system.js";

type Scored = { id: string; score: number; at: string; text: () => string };

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
                        text: () =>
                            passage(
                                conversation,
                                terms,
                                Math.floor(budget / 3),
                            ),
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
                        text: () => knowledgeText(knowledge),
                    });
                }
            }
            scored.sort(newestFirst);
            const best = scored.slice(0, 20);
            const fitted = pack(
                best.map((each) => ({ id: each.id, text: each.text() })),
                budget,
            );
            return { ranked: fitted.ids, context: fitted.text };
        },
    };
}
