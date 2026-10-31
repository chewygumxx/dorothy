// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/dorothy.ts
//
//

// Her memory as a harness gets it today, without a model choosing the
// calls: the opening block for the question's project, then search over
// every scope, then the top hits opened until the budget is spent. Its
// ranked ids are the hits that fitted, then the block's.

import {
    clip,
    knowledgeText,
    pack,
    passage,
    termsOf,
} from "@dorothy/memory/evaluation";
import type { Corpus } from "./corpus.js";
import type { System } from "./system.js";

// The block's share of the budget; the hits take the rest.
const BLOCK_SHARE = 0.4;

export function dorothySystem(corpus: Corpus): System {
    return {
        name: "dorothy",
        async retrieve(asked, budget) {
            const block = await corpus.archive.block({
                project: asked.project,
                budget: Math.floor(budget * BLOCK_SHARE),
                exclude: asked.exclude,
            });
            const hits = await corpus.archive.engine.search({
                query: asked.text,
                within: "all",
                kind: "all",
                limit: 10,
                project: asked.project,
                exclude: asked.exclude,
            });
            const terms = termsOf(asked.text);
            const opened = hits.map((hit) => {
                const conversation = corpus.conversations.get(hit.id);
                const knowledge = corpus.knowledge.get(hit.id);
                return {
                    id: hit.id,
                    text:
                        conversation !== undefined
                            ? passage(
                                  conversation,
                                  terms,
                                  Math.floor(budget / 4),
                              )
                            : knowledge !== undefined
                              ? knowledgeText(knowledge)
                              : `${hit.title}: ${hit.snippet}`,
                };
            });
            const left = budget - block.text.length - 1;
            const fitted = pack(opened, Math.max(0, left));
            const found = new Set(fitted.ids);
            return {
                // Her search's hits that fitted, then what the block gave
                // besides.
                ranked: [
                    ...fitted.ids,
                    ...block.ids.filter((id) => !found.has(id)),
                ],
                context: clip(`${block.text}\n${fitted.text}`, budget),
            };
        },
    };
}
