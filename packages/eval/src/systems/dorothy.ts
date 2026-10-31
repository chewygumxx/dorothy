// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/dorothy.ts
//
//

// Dorothy's memory as a host receives it: her opening block with its
// share of the budget, then her search's hits, knowledge and episodes
// merged, delivered as passages and knowledge within the rest.

import {
    clip,
    deliver,
    HIT_ORDERS,
    type HitOrder,
    ITEM_SHARE,
    mergeHits,
    PASSAGE_SEEDS,
    type PassageSeeds,
} from "@dorothy/memory/evaluation";
import { UsageError } from "../errors.js";
import { type Corpus, corpusEvidence } from "./corpus.js";
import type { System } from "./system.js";

export type DorothyOptions = {
    // The block's share of the budget.
    block: number;
    order: HitOrder;
    // One item's share of the budget at most.
    cap: number;
    seeds: PassageSeeds;
    // Whether knowledge the block gave in full is left out of the hits.
    dedupe: boolean;
    // Whether knowledge goes in whole, past the cap, as it did before.
    wholeKnowledge: boolean;
};
export const DOROTHY_DEFAULTS: DorothyOptions = {
    block: 0.4,
    order: "alternate",
    cap: ITEM_SHARE,
    seeds: "search",
    dedupe: true,
    wholeKnowledge: false,
};
const KEYS = ["block", "order", "cap", "seeds", "dedupe", "knowledge"] as const;

export function dorothyOptions(
    raw: ReadonlyMap<string, string>,
    name = "dorothy",
): DorothyOptions {
    const options = { ...DOROTHY_DEFAULTS };
    for (const [key, value] of raw) {
        const wrong = (allowed: string) =>
            new UsageError(`${name}: ${key} takes ${allowed}, not ${value}`);
        const among = <T extends string>(allowed: readonly T[]): T => {
            if (!(allowed as readonly string[]).includes(value)) {
                throw wrong(allowed.join(" or "));
            }
            return value as T;
        };
        switch (key) {
            case "block": {
                const share = Number(value);
                if (!(share >= 0 && share < 1)) {
                    throw wrong("a share from 0 to under 1");
                }
                options.block = share;
                break;
            }
            case "cap": {
                const share = Number(value);
                if (!(share > 0 && share <= 1)) {
                    throw wrong("a share above 0, up to 1");
                }
                options.cap = share;
                break;
            }
            case "order":
                options.order = among(HIT_ORDERS);
                break;
            case "seeds":
                options.seeds = among(PASSAGE_SEEDS);
                break;
            case "dedupe":
                options.dedupe = among(["on", "off"] as const) === "on";
                break;
            case "knowledge":
                options.wholeKnowledge =
                    among(["capped", "whole"] as const) === "whole";
                break;
            default:
                throw new UsageError(
                    `${name}: dorothy takes ${KEYS.join(", ")}, not ${key}`,
                );
        }
    }
    return options;
}

export function dorothySystem(
    corpus: Corpus,
    options: DorothyOptions = DOROTHY_DEFAULTS,
): System {
    return {
        name: "dorothy",
        async retrieve(asked, budget) {
            // At a share of nothing there is no block, not even the
            // closing reminder buildBlock gives a budget too small.
            const block =
                options.block === 0
                    ? { text: "", ids: [], full: [] }
                    : await corpus.archive.block({
                          project: asked.project,
                          budget: Math.floor(budget * options.block),
                          exclude: asked.exclude,
                      });
            const room =
                block.text === "" ? budget : budget - block.text.length - 1;
            const search = (kind: "knowledge" | "episodes") =>
                corpus.archive.engine.search({
                    query: asked.text,
                    within: "all",
                    kind,
                    limit: 10,
                    project: asked.project,
                    exclude: asked.exclude,
                });
            const hits = mergeHits(
                await search("knowledge"),
                await search("episodes"),
                options.order,
                10,
            );
            const delivery = await deliver(
                {
                    query: asked.text,
                    hits,
                    budget: Math.max(0, room),
                    policy: {
                        cap: Math.floor(budget * options.cap),
                        seeds: options.seeds,
                        shown: options.dedupe
                            ? block.full.map((item) => item.id)
                            : [],
                        wholeKnowledge: options.wholeKnowledge,
                    },
                },
                corpusEvidence(corpus),
            );
            const delivered = delivery.items.map((item) => item.id);
            const given = new Set(delivered);
            return {
                // Her hits that went in, then what the block gave
                // besides.
                ranked: [
                    ...delivered,
                    ...block.ids.filter((id) => !given.has(id)),
                ],
                context:
                    block.text === ""
                        ? delivery.text
                        : clip(`${block.text}\n${delivery.text}`, budget),
                found: hits.map((hit) => hit.id),
                // The block's knowledge given in full is delivered too,
                // for the stages, as the line the model read; ranked
                // keeps to what the hits gave.
                items: [
                    ...delivery.items,
                    ...block.full
                        .filter((item) => item.id.startsWith("k:"))
                        .map((item) => ({
                            id: item.id,
                            kind: "knowledge" as const,
                            turns: null,
                            text: item.text,
                            cut: false,
                            opened: true,
                            block: true as const,
                        })),
                ],
            };
        },
    };
}
