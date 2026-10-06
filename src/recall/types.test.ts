// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/recall/types.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    ALLOWED_TOOLS,
    describeLookup,
    type OpenResult,
    type SearchHit,
    type SearchResult,
    toolOf,
} from "./types.js";

const hit = (identifier: string): SearchHit => ({
    "@type": "Conversation",
    identifier,
    dateCreated: "2026-10-04",
    dateModified: "2026-10-05",
    matches: [],
});

describe("toolOf", () => {
    it("names the memory server's tools", () => {
        expect(toolOf("mcp__memory__search")).toBe("search");
        expect(toolOf("mcp__memory__open")).toBe("open");
    });

    it("refuses any other tool", () => {
        expect(toolOf("mcp__other__search")).toBeNull();
        expect(toolOf("mcp__memory__delete")).toBeNull();
        expect(toolOf("Read")).toBeNull();
    });

    it("lists the tools the CLI must allow", () => {
        expect(ALLOWED_TOOLS).toEqual([
            "mcp__memory__search",
            "mcp__memory__open",
        ]);
    });
});

describe("describeLookup", () => {
    it("counts a search's hits, those past the limit too", () => {
        const result: SearchResult = { results: [hit("a"), hit("b")], more: 3 };
        expect(
            describeLookup(
                "search",
                { query: "render", after: "2026-10-01" },
                JSON.stringify(result),
            ),
        ).toEqual({
            tool: "search",
            query: "render",
            after: "2026-10-01",
            hits: 5,
        });
    });

    it("names an opened conversation and the turns shown", () => {
        const result: OpenResult = {
            ...hit("amber-otter-quietly-sings"),
            name: "Terminal rendering chaos",
            turns: 9,
            window: [
                {
                    turn: 3,
                    role: "user",
                    at: "2026-10-04T00:00:00.000Z",
                    text: "a",
                },
                {
                    turn: 4,
                    role: "assistant",
                    at: "2026-10-04T00:00:01.000Z",
                    text: "b",
                },
            ],
        };
        expect(
            describeLookup(
                "open",
                {
                    conversation: "amber-otter-quietly-sings",
                    purpose: "the render bug",
                    turn: 3,
                },
                JSON.stringify(result),
            ),
        ).toEqual({
            tool: "open",
            conversation: "amber-otter-quietly-sings",
            name: "Terminal rendering chaos",
            purpose: "the render bug",
            turns: [3, 4],
        });
    });

    it("keeps the input of a call that failed", () => {
        expect(
            describeLookup("open", { conversation: "x", purpose: "p" }, null),
        ).toEqual({
            tool: "open",
            conversation: "x",
            name: "x",
            purpose: "p",
            turns: null,
        });
    });

    it("counts nothing from a result it cannot read", () => {
        expect(describeLookup("search", { query: "q" }, "not json")).toEqual({
            tool: "search",
            query: "q",
            hits: 0,
        });
        expect(describeLookup("search", { query: "q" }, "{}")).toEqual({
            tool: "search",
            query: "q",
            hits: 0,
        });
    });

    it("tolerates input of the wrong shape", () => {
        expect(describeLookup("search", 7, null)).toEqual({
            tool: "search",
            query: "",
            hits: 0,
        });
    });
});
