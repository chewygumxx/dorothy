// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/cited.ts
//
//

// A ceiling, never a contender: each question's own evidence, delivered
// as Dorothy delivers, to show how far passage selection alone can go.

import type { MemoryHit } from "@dorothy/core";
import { deliver } from "@dorothy/memory/evaluation";
import { type Corpus, corpusEvidence } from "./corpus.js";
import type { System } from "./system.js";

export function citedSystem(corpus: Corpus): System {
    return {
        name: "cited",
        async retrieve(asked, budget) {
            const hits: MemoryHit[] = asked.evidence.flatMap(
                (id): MemoryHit[] => {
                    const conversation = corpus.conversations.get(id);
                    if (conversation !== undefined) {
                        return [
                            {
                                id,
                                kind: "episode",
                                scope: conversation.project ?? "personal",
                                title: conversation.title ?? "Untitled",
                                snippet: "",
                            },
                        ];
                    }
                    const knowledge = corpus.knowledge.get(id);
                    return knowledge === undefined
                        ? []
                        : [
                              {
                                  id,
                                  kind: "knowledge",
                                  scope: knowledge.scope,
                                  title: knowledge.title,
                                  snippet: knowledge.description,
                              },
                          ];
                },
            );
            const delivery = await deliver(
                {
                    query: asked.text,
                    hits,
                    budget,
                    policy: {
                        cap: Math.floor(budget / Math.max(1, hits.length)),
                        seeds: "overlap",
                        wholeKnowledge: true,
                    },
                },
                corpusEvidence(corpus),
            );
            return {
                ranked: delivery.items.map((item) => item.id),
                context: delivery.text,
                items: delivery.items,
            };
        },
    };
}
