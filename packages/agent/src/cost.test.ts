// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/agent/src/cost.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { anthropicEntry } from "@dorothy/core";
import { stepPrice, stepUsage, unpricedNotice } from "./cost.js";

describe("stepUsage", () => {
    it("takes the uncached input, cache reads and writes, and output", () => {
        expect(
            stepUsage({
                inputTokens: 21,
                inputTokenDetails: {
                    noCacheTokens: 11,
                    cacheReadTokens: 7,
                    cacheWriteTokens: 3,
                },
                outputTokens: 5,
                outputTokenDetails: {},
                totalTokens: 26,
            } as never),
        ).toEqual({ noCache: 11, cacheRead: 7, cacheWrite: 3, output: 5 });
    });
    it("takes the uncached input from the total less the cache", () => {
        expect(
            stepUsage({
                inputTokens: 30,
                inputTokenDetails: { cacheReadTokens: 20, cacheWriteTokens: 4 },
                outputTokens: 1,
            } as never),
        ).toEqual({ noCache: 6, cacheRead: 20, cacheWrite: 4, output: 1 });
    });
    it("counts missing details as uncached input", () => {
        expect(stepUsage({ inputTokens: 9, outputTokens: 2 } as never)).toEqual(
            {
                noCache: 9,
                cacheRead: 0,
                cacheWrite: 0,
                output: 2,
            },
        );
    });
});

describe("unpricedNotice", () => {
    it("warns once a process per model", () => {
        const entry = anthropicEntry("claude-unpriced-test");
        expect(unpricedNotice(entry)).toBe(
            "no price is known for anthropic:claude-unpriced-test; its cost shows as $0",
        );
        expect(unpricedNotice(entry)).toBeNull();
    });
});

describe("stepPrice", () => {
    const usage = (input: number, output: number) =>
        ({
            inputTokens: input,
            inputTokenDetails: { noCacheTokens: input },
            outputTokens: output,
        }) as never;
    const openrouter = {
        ...anthropicEntry("x/y"),
        provider: "openrouter",
        kind: "openrouter" as const,
    };

    it("prices an Anthropic step by core's table", () => {
        expect(
            stepPrice(
                anthropicEntry("claude-sonnet-5-5"),
                usage(1_000_000, 1_000_000),
                undefined,
            ),
        ).toEqual({ costUsd: 12, notice: null });
    });

    it("takes OpenRouter's own figure for its steps", () => {
        expect(
            stepPrice(openrouter, usage(10, 5), {
                openrouter: { usage: { cost: 0.0042 } },
            }),
        ).toEqual({ costUsd: 0.0042, notice: null });
    });

    it("warns once of an OpenRouter step that gave no figure", () => {
        const entry = { ...openrouter, model: "x/no-figure" };
        expect(stepPrice(entry, usage(10, 5), undefined)).toEqual({
            costUsd: 0,
            notice: "no price is known for openrouter:x/no-figure; its cost shows as $0",
        });
        expect(stepPrice(entry, usage(10, 5), undefined).notice).toBeNull();
    });

    it("warns once of a step with no usage", () => {
        const entry = anthropicEntry("claude-no-usage-test");
        const none = {} as never;
        expect(stepPrice(entry, none, undefined)).toEqual({
            costUsd: 0,
            notice: "anthropic:claude-no-usage-test reported no usage; its cost shows as $0",
        });
        expect(stepPrice(entry, none, undefined).notice).toBeNull();
    });

    it("warns of nothing on a free entry, usage or none", () => {
        const entry = {
            ...anthropicEntry("free-test"),
            kind: "local" as const,
            price: [0, 0] as [number, number],
        };
        expect(stepPrice(entry, {} as never, undefined)).toEqual({
            costUsd: 0,
            notice: null,
        });
        expect(stepPrice(entry, usage(10, 5), undefined)).toEqual({
            costUsd: 0,
            notice: null,
        });
    });
});
