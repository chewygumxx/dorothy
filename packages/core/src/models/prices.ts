// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/core/src/models/prices.ts
//
//

// What a model's tokens cost, in dollars per million.

import type { RouteEntry } from "../contracts/model.js";

export type Price = {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
};

type Priced = Price & { over?: { tokens: number; price: Price } };

// Anthropic's prices, from
// https://platform.claude.com/docs/en/about-claude/pricing on
// 2026-11-01. Cache writes are at the five-minute rate, which Dorothy's
// breakpoints use; cache hits on Opus 5.5 and Sonnet 5.5 are 0.05 of
// input, as the page's footnote says; Haiku 5.5 costs more for prompts
// over 100,000 tokens.
export const ANTHROPIC_PRICES: Readonly<Record<string, Priced>> = {
    "claude-fable-5-1": {
        input: 10,
        output: 50,
        cacheRead: 0.25,
        cacheWrite: 12.5,
    },
    "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    "claude-sonnet-5-5": {
        input: 2,
        output: 10,
        cacheRead: 0.1,
        cacheWrite: 2.5,
    },
    "claude-haiku-5-5": {
        input: 0.1,
        output: 0.5,
        cacheRead: 0.01,
        cacheWrite: 0.125,
        over: {
            tokens: 100_000,
            price: {
                input: 0.5,
                output: 2.5,
                cacheRead: 0.05,
                cacheWrite: 0.625,
            },
        },
    },
};

// One request's tokens: the input the cache did not serve, cache reads
// and writes, and the output.
export type StepUsage = {
    noCache: number;
    cacheRead: number;
    cacheWrite: number;
    output: number;
};

function priceOf(entry: RouteEntry, usage: StepUsage): Price | null {
    if (entry.price !== null) {
        const [input, output] = entry.price;
        return { input, output, cacheRead: input, cacheWrite: input };
    }
    if (entry.kind !== "anthropic") {
        return null;
    }
    // Own keys only: a model named "constructor" has no price.
    if (!Object.hasOwn(ANTHROPIC_PRICES, entry.model)) {
        return null;
    }
    const priced = ANTHROPIC_PRICES[entry.model] as Priced;
    const prompt = usage.noCache + usage.cacheRead + usage.cacheWrite;
    return priced.over !== undefined && prompt > priced.over.tokens
        ? priced.over.price
        : priced;
}

// A step's cost, or null when its model has no known price.
export function stepCost(entry: RouteEntry, usage: StepUsage): number | null {
    const price = priceOf(entry, usage);
    if (price === null) {
        return null;
    }
    return (
        (usage.noCache * price.input +
            usage.cacheRead * price.cacheRead +
            usage.cacheWrite * price.cacheWrite +
            usage.output * price.output) /
        1_000_000
    );
}
