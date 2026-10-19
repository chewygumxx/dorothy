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
import { packed, type System } from "./system.js";

export function fullSystem(corpus: Corpus): System {
    // Everything, newest first, with its text, made once for the corpus; a
    // question only leaves its own conversation out.
    let items: {
        id: string;
        at: string;
        phrase: string | null;
        text: string;
    }[];
    const everything = () => {
        items ??= [
            ...[...corpus.conversations.values()].map((each) => ({
                id: each.id,
                at: each.lastAt,
                phrase: each.phrase,
                text: conversationText(each),
            })),
            ...[...corpus.knowledge.values()].map((each) => ({
                id: each.id,
                at: each.at,
                phrase: null,
                text: knowledgeText(each),
            })),
        ].sort(
            (a, b) =>
                (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) ||
                (a.id < b.id ? -1 : 1),
        );
        return items;
    };
    return {
        name: "full",
        async retrieve(asked, budget) {
            const fitted = packed(
                everything().filter(
                    (each) =>
                        asked.exclude === null || each.phrase !== asked.exclude,
                ),
                budget,
            );
            return { ranked: fitted.ids, context: fitted.text };
        },
    };
}
