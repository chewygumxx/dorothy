// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/models/prices.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { stepCost } from "./prices.js";
import { anthropicEntry } from "./routes.js";

const usage = (noCache: number, output = 0, cacheRead = 0, cacheWrite = 0) => ({
    noCache,
    cacheRead,
    cacheWrite,
    output,
});

describe("stepCost", () => {
    it("prices an Anthropic step at its model's rates", () => {
        // Opus 5.5: $4 in, $0.20 cache reads, $5 cache writes, $20 out.
        expect(
            stepCost(
                anthropicEntry("claude-opus-5-5"),
                usage(1_000_000, 1_000_000, 1_000_000, 1_000_000),
            ),
        ).toBeCloseTo(4 + 20 + 0.2 + 5, 10);
    });

    it("prices Haiku 5.5 at its higher rates past 100,000 prompt tokens", () => {
        const haiku = anthropicEntry("claude-haiku-5-5");
        expect(stepCost(haiku, usage(100_000))).toBeCloseTo(0.01, 10);
        expect(stepCost(haiku, usage(100_001))).toBeCloseTo(
            (100_001 * 0.5) / 1_000_000,
            10,
        );
        // Cached tokens count towards the prompt's size.
        expect(stepCost(haiku, usage(1, 0, 100_000))).toBeCloseTo(
            (1 * 0.5 + 100_000 * 0.05) / 1_000_000,
            10,
        );
    });

    it("prices an entry by its own price, cache at its input rate", () => {
        const entry = {
            ...anthropicEntry("anything"),
            price: [1, 2] as [number, number],
        };
        expect(
            stepCost(entry, usage(1_000_000, 1_000_000, 1_000_000, 1_000_000)),
        ).toBeCloseTo(1 + 2 + 1 + 1, 10);
    });

    it("knows no price for an unknown Anthropic model", () => {
        expect(
            stepCost(anthropicEntry("claude-unknown"), usage(10)),
        ).toBeNull();
    });

    it("knows no price for a model named as an object's own property", () => {
        for (const model of ["constructor", "toString", "__proto__"]) {
            expect(stepCost(anthropicEntry(model), usage(1000))).toBeNull();
        }
    });

    it("knows no price for another kind without one", () => {
        const entry = { ...anthropicEntry("m"), kind: "local" as const };
        expect(stepCost(entry, usage(10))).toBeNull();
    });
});
