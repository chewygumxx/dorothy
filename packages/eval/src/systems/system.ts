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
