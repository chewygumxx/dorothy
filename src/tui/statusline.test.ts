// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/statusline.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { MODULE_NAMES, type TurnStats } from "@dorothy/core";
import stringWidth from "string-width";
import { fitModules, moduleRows, renderModule } from "./statusline.js";

const stats: TurnStats = {
    inputTokens: 12,
    cacheReadTokens: 3000,
    cacheWriteTokens: 400,
    outputTokens: 40,
    ttftMs: 900,
    durationMs: 2100,
    costUsd: 0.0012,
    sessionCostUsd: 0.0034,
};

describe("renderModule", () => {
    it("renders each module of a turn", () => {
        expect(
            MODULE_NAMES.map((name) =>
                renderModule(name, stats, 0.005, 0.0841),
            ),
        ).toEqual([
            "12 in",
            "3000 cache read",
            "400 cache write",
            "40 out",
            "ttft 0.9s",
            "2.1s",
            "$0.0012",
            "chat $0.0050",
            "memory $0.0841",
        ]);
    });

    it("renders the memory's cost only once a review has cost something", () => {
        expect(renderModule("memory-cost", null, 0, 0)).toBeNull();
        expect(renderModule("memory-cost", null, 0, 0.0123)).toBe(
            "memory $0.0123",
        );
    });

    it("renders nothing for cache use or a first token there was none of", () => {
        const none = {
            ...stats,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            ttftMs: null,
        };
        expect(
            (["cache-read", "cache-write", "ttft"] as const).map((name) =>
                renderModule(name, none, 0),
            ),
        ).toEqual([null, null, null]);
    });

    it("renders only the chat's cost before the first turn", () => {
        expect(
            MODULE_NAMES.map((name) => renderModule(name, null, 0.25)),
        ).toEqual([
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            "chat $0.2500",
            null,
        ]);
    });
});

describe("fitModules", () => {
    const pieces = [
        "2 in",
        "1010 cache read",
        "286 cache write",
        "378 out",
        "ttft 1.9s",
        "5.3s",
        "$0.0051",
    ];

    it("joins what fits on one row", () => {
        expect(fitModules(["2 in", "378 out"], 40, 1)).toEqual([
            "2 in · 378 out",
        ]);
    });

    it("drops from the right what does not fit", () => {
        expect(fitModules(pieces, 40, 1)).toEqual([
            "2 in · 1010 cache read · 286 cache write",
        ]);
    });

    it("overflows onto up to maxLines rows", () => {
        expect(fitModules(pieces, 40, 2)).toEqual([
            "2 in · 1010 cache read · 286 cache write",
            "378 out · ttft 1.9s · 5.3s · $0.0051",
        ]);
    });

    it("never draws a piece after one it dropped", () => {
        expect(fitModules(["aaaa", "bbbbbbbbbb", "c"], 12, 1)).toEqual([
            "aaaa",
        ]);
    });

    it("measures wide characters as two columns", () => {
        expect(fitModules(["会話", "ab"], 8, 1)).toEqual(["会話"]);
        expect(fitModules(["会話", "ab"], 9, 1)).toEqual(["会話 · ab"]);
    });

    it("draws only the rows it uses", () => {
        expect(fitModules(["a"], 40, 3)).toEqual(["a"]);
        expect(fitModules([], 40, 3)).toEqual([]);
    });

    it("keeps every row within the width", () => {
        for (let width = 10; width <= 60; width++) {
            for (const maxLines of [1, 2, 3]) {
                for (const row of fitModules(pieces, width, maxLines)) {
                    expect(stringWidth(row)).toBeLessThanOrEqual(width);
                }
            }
        }
    });
});

describe("moduleRows", () => {
    it("renders a line's modules in its order and fits them", () => {
        expect(
            moduleRows(
                { modules: ["out", "in", "ttft"], maxLines: 1 },
                { ...stats, ttftMs: null },
                0,
                40,
            ),
        ).toEqual(["40 out · 12 in"]);
    });
});
