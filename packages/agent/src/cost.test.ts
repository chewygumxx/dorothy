// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/cost.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { anthropicEntry } from "@dorothy/core";
import { stepUsage, unpricedNotice } from "./cost.js";

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
