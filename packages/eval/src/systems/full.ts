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

import { type Corpus, conversationText, knowledgeText } from "./corpus.js";
import { packItems, type System } from "./system.js";

export function fullSystem(corpus: Corpus): System {
    return {
        name: "full",
        async retrieve(asked, budget) {
            const items = [
                ...[...corpus.conversations.values()]
                    .filter((each) => each.phrase !== asked.exclude)
                    .map((each) => ({
                        id: each.id,
                        at: each.lastAt,
                        text: conversationText(each),
                    })),
                ...[...corpus.knowledge.values()].map((each) => ({
                    id: each.id,
                    at: each.at,
                    text: knowledgeText(each),
                })),
            ].sort(
                (a, b) =>
                    (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) ||
                    (a.id < b.id ? -1 : 1),
            );
            const context = packItems(items, budget);
            return {
                ranked: items
                    .map((each) => each.id)
                    .filter((id) => context.includes(`<item id="${id}">`)),
                context,
            };
        },
    };
}
