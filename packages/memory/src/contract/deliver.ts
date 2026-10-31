// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/deliver.ts
//
//

// Ranked hits as the text a model reads, within a budget: each episode
// as a passage around the turns search matched, each piece of knowledge
// as its text, none past its cap. Recall and the evaluation both deliver
// through it, so the evaluation measures what hosts receive.

import type { MemoryHit } from "@dorothy/core";
import { escapeXml } from "../memory/block.js";
import {
    clip,
    type EvidenceConversation,
    type EvidenceKnowledge,
    knowledgeText,
    pack,
    passage,
    type TurnRange,
    turnsIn,
} from "./passage.js";
import { termsOf } from "./terms.js";

// What delivery reads, by contract id: undefined for what it cannot
// open.
export type EvidenceSource = {
    conversation(id: string): Promise<EvidenceConversation | undefined>;
    knowledge(id: string): Promise<EvidenceKnowledge | undefined>;
};
export const PASSAGE_SEEDS = ["search", "overlap"] as const;
export type PassageSeeds = (typeof PASSAGE_SEEDS)[number];
// The share of a budget one item may take, by default.
export const ITEM_SHARE = 0.25;
export type DeliveryPolicy = {
    // Characters at most for one item.
    cap: number;
    // Whether a passage starts from search's matched turns, or from the
    // turns sharing most of the query's words.
    seeds: PassageSeeds;
    // Ids given in full already: knowledge among them is left out.
    shown: readonly string[];
    // Whether knowledge goes in whole, past the cap, as the evaluation's
    // dorothy system gave it before delivery was shared.
    wholeKnowledge: boolean;
};
export type DeliveredItem = {
    id: string;
    kind: "knowledge" | "episode";
    // A passage's first and last turn; null for anything else.
    turns: TurnRange | null;
    // As it went into the text.
    text: string;
    cut: boolean;
    // False where its title and snippet stood in for its source.
    opened: boolean;
};
export type Delivery = { text: string; items: DeliveredItem[] };
export type DeliveryRequest = {
    query: string;
    hits: readonly MemoryHit[];
    budget: number;
    policy?: Partial<DeliveryPolicy>;
    // Escaped for an XML frame, as recall's is; the evaluation reads
    // raw text.
    escape?: boolean;
};

// How an item's text is made ready: escaped or not, then cut to a
// length, never inside an entity the escaping made.
type Finish = (text: string, chars: number) => string;

// An escaped text without an entity cut off at its end.
const unfinished = (text: string) => text.replace(/&[a-z]*$/, "");

const raw: Finish = (text, chars) => clip(text, chars);
const escaped: Finish = (text, chars) =>
    unfinished(clip(escapeXml(text), chars));

// One hit as an item, its text whole (within its cap) and finished.
async function render(
    hit: MemoryHit,
    source: EvidenceSource,
    terms: readonly string[],
    policy: DeliveryPolicy,
    finish: Finish,
    cost: (text: string) => number,
): Promise<DeliveredItem> {
    const mark = hit.unconfirmed === undefined ? "" : `[${hit.unconfirmed}]\n`;
    const item = (
        text: string,
        chars: number,
        fields: Pick<DeliveredItem, "turns" | "opened"> & { cut?: boolean },
    ): DeliveredItem => {
        const whole = finish(text, Infinity);
        const fitted = finish(text, chars);
        return {
            id: hit.id,
            kind: hit.kind,
            turns: fields.turns,
            text: fitted,
            cut: (fields.cut ?? false) || fitted.length < whole.length,
            opened: fields.opened,
        };
    };
    try {
        if (hit.kind === "episode") {
            const conversation = await source.conversation(hit.id);
            if (conversation !== undefined) {
                const seeds =
                    policy.seeds === "search" ? (hit.turns ?? []) : [];
                const found = passage(
                    conversation,
                    terms,
                    policy.cap,
                    seeds,
                    cost,
                );
                return item(found.text, policy.cap, {
                    turns: found.turns,
                    opened: true,
                    cut: found.cut,
                });
            }
        } else {
            const knowledge = await source.knowledge(hit.id);
            if (knowledge !== undefined) {
                return item(
                    mark + knowledgeText(knowledge),
                    policy.wholeKnowledge ? Infinity : policy.cap,
                    { turns: null, opened: true },
                );
            }
        }
    } catch {
        // An unreadable source stands in as its title and snippet.
    }
    return item(`${mark}${hit.title}: ${hit.snippet}`, policy.cap, {
        turns: null,
        opened: false,
    });
}

// Items, each with its whole text, packed within budget: each
// delivered item's text as it went in, cut marked, and a cut
// passage's range what its text still holds.
export function packDelivery(
    items: readonly DeliveredItem[],
    budget: number,
    trim?: (text: string) => string,
): Delivery {
    const packed = pack(items, Math.max(0, budget), trim);
    const last = packed.ids.length - 1;
    return {
        text: packed.text,
        items: packed.ids.map((_, at) => {
            const item = items[at] as DeliveredItem;
            const text = packed.texts[at] as string;
            const cut = at === last && packed.cut;
            return {
                ...item,
                text,
                cut: item.cut || cut,
                // A passage cut by packing holds only the turns whose
                // lines survived; the head alone holds none.
                turns:
                    cut && item.kind === "episode" ? turnsIn(text) : item.turns,
            };
        }),
    };
}

export async function deliver(
    request: DeliveryRequest,
    source: EvidenceSource,
): Promise<Delivery> {
    const policy: DeliveryPolicy = {
        cap: Math.floor(request.budget * ITEM_SHARE),
        seeds: "search",
        shown: [],
        wholeKnowledge: false,
        ...request.policy,
    };
    const escaping = request.escape === true;
    const finish = escaping ? escaped : raw;
    const cost = escaping
        ? (text: string) => escapeXml(text).length
        : (text: string) => text.length;
    const terms = termsOf(request.query);
    const shown = new Set(policy.shown);
    const items: DeliveredItem[] = [];
    for (const hit of request.hits) {
        if (hit.kind === "knowledge" && shown.has(hit.id)) {
            continue;
        }
        items.push(await render(hit, source, terms, policy, finish, cost));
    }
    return packDelivery(
        items,
        request.budget,
        escaping ? unfinished : undefined,
    );
}
