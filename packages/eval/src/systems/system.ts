// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/system.ts
//
//

// What every system meets: a question, a budget of characters, and back
// its ids best first with the context the answering model reads.

import { UsageError } from "../errors.js";
import type { Corpus } from "./corpus.js";
import { dorothySystem } from "./dorothy.js";
import { fullSystem } from "./full.js";
import { lexicalSystem } from "./lexical.js";

export type Asked = {
    text: string;
    asOf: string;
    project: string | null;
    // The phrase of a conversation left out of retrieval.
    exclude: string | null;
};
// Contract ids best first, for evidence recall, and the context. Every
// ranked id is in the context: an item the budget cut off is not ranked.
export type Retrieved = { ranked: string[]; context: string };

export interface System {
    readonly name: string;
    retrieve(asked: Asked, budget: number): Promise<Retrieved>;
    // For systems with a store of their own, as providers have.
    prepare?(): Promise<void>;
    close?(): Promise<void>;
}

const MAKERS = {
    dorothy: dorothySystem,
    lexical: lexicalSystem,
    full: fullSystem,
} as const;
export const SYSTEM_NAMES = Object.keys(MAKERS) as (keyof typeof MAKERS)[];

export function makeSystem(name: string, corpus: Corpus): System {
    const make = MAKERS[name as keyof typeof MAKERS];
    if (make === undefined) {
        throw new UsageError(
            `no system ${name}; the systems are ${SYSTEM_NAMES.join(", ")}`,
        );
    }
    return make(corpus);
}

// Items as <item> elements within budget, the last one cut to fit, and
// the ids of the items that went in.
export function packed(
    items: { id: string; text: string }[],
    budget: number,
): { text: string; ids: string[] } {
    const parts: string[] = [];
    const ids: string[] = [];
    let left = budget;
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
        left -= open.length + text.length + close.length;
        if (text.length < item.text.length) {
            break;
        }
    }
    return { text: parts.join(""), ids };
}

export const packItems = (
    items: { id: string; text: string }[],
    budget: number,
): string => packed(items, budget).text;
