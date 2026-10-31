// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/system.ts
//
//

// What every system meets: a question, a budget of characters, and back
// its ids best first with the context the answering model reads. A system
// is named <system>[:<key>=<value>]..., as dorothy:block=0.2:order=
// knowledge-first.

import type { DeliveredItem } from "@dorothy/memory/evaluation";
import { UsageError } from "../errors.js";
import type { Corpus } from "./corpus.js";
import { dorothyOptions, dorothySystem } from "./dorothy.js";
import { fullSystem } from "./full.js";
import { lexicalSystem } from "./lexical.js";

export type Asked = {
    text: string;
    asOf: string;
    project: string | null;
    // The phrase of a conversation left out of retrieval.
    exclude: string | null;
    // The question's evidence ids, for the cited ceiling alone.
    evidence: readonly string[];
};
// Contract ids best first, for evidence recall, and the context. Every
// ranked id is in the context: an item the budget cut off is not ranked.
export type Retrieved = {
    ranked: string[];
    context: string;
    // The engine's hits before packing, best first; systems with an
    // engine only.
    found?: string[];
    // What went into the context, as delivered; dorothy adds the
    // knowledge her block gave in full, marked block.
    items?: (DeliveredItem & { block?: true })[];
};

export interface System {
    readonly name: string;
    retrieve(asked: Asked, budget: number): Promise<Retrieved>;
    // For systems with a store of their own, as providers have.
    prepare?(): Promise<void>;
    close?(): Promise<void>;
}

export const DEFAULT_SYSTEMS = ["dorothy", "lexical", "full"] as const;

// What a system takes for options, checked before anything opens.
const OPTIONS = {
    dorothy: dorothyOptions,
    lexical: noOptions,
    full: noOptions,
};
const MAKERS: {
    [K in keyof typeof OPTIONS]: (
        corpus: Corpus,
        options: ReturnType<(typeof OPTIONS)[K]>,
    ) => System;
} = {
    dorothy: dorothySystem,
    lexical: (corpus) => lexicalSystem(corpus),
    full: (corpus) => fullSystem(corpus),
};
type SystemName = keyof typeof MAKERS;
export const SYSTEM_NAMES = Object.keys(MAKERS) as SystemName[];

export const baseOf = (name: string) => name.split(":")[0] as string;

function noOptions(raw: ReadonlyMap<string, string>, name: string): null {
    if (raw.size > 0) {
        throw new UsageError(`${name}: ${baseOf(name)} takes no options`);
    }
    return null;
}

export function parseSystemName(name: string): {
    base: SystemName;
    options: Map<string, string>;
} {
    const [base = "", ...pairs] = name.split(":");
    if (!(SYSTEM_NAMES as readonly string[]).includes(base)) {
        throw new UsageError(
            `no system ${base}; the systems are ${SYSTEM_NAMES.join(", ")}`,
        );
    }
    const options = new Map<string, string>();
    for (const pair of pairs) {
        const match = /^([a-z]+)=([^\s:=]+)$/.exec(pair);
        if (match === null) {
            throw new UsageError(
                `${name}: each option is key=value, not "${pair}"`,
            );
        }
        const [, key, value] = match as unknown as [string, string, string];
        if (options.has(key)) {
            throw new UsageError(`${name}: ${key} is given twice`);
        }
        options.set(key, value);
    }
    return { base: base as SystemName, options };
}

export function checkSystem(name: string): void {
    const { base, options } = parseSystemName(name);
    OPTIONS[base](options, name);
}

export function makeSystem(name: string, corpus: Corpus): System {
    const { base, options } = parseSystemName(name);
    const make = MAKERS[base] as (corpus: Corpus, options: unknown) => System;
    return { ...make(corpus, OPTIONS[base](options, name)), name };
}
