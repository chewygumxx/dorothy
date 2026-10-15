// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/contracts/recall.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    ALLOWED_TOOLS,
    CLAUDE_ALLOWED_TOOLS,
    describeLookup,
    type OpenResult,
    RECOLLECT_TOOL,
    REMEMBER_TOOL,
    type RecollectResult,
    type SearchHit,
    type SearchResult,
    toolOf,
} from "./recall.js";

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
            "mcp__memory__tags",
            "mcp__memory__remember",
        ]);
    });
});

describe("describeLookup", () => {
    it("counts a search's hits, those past the limit too", () => {
        const result: SearchResult = {
            facts: [],
            moreFacts: 0,
            results: [hit("a"), hit("b")],
            more: 3,
        };
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
            facts: 0,
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

    it("records the tags a search was narrowed by", () => {
        expect(
            describeLookup(
                "search",
                { tags: ["memory", 3, "tui"] },
                JSON.stringify({ results: [], more: 2 }),
            ),
        ).toEqual({
            tool: "search",
            query: "",
            tags: ["memory", "tui"],
            hits: 2,
        });
    });

    it("records a listing of tags and how many there were", () => {
        expect(
            describeLookup(
                "tags",
                { under: "memory" },
                JSON.stringify({
                    results: [{ "@type": "DefinedTerm", name: "a" }],
                    more: 4,
                }),
            ),
        ).toEqual({ tool: "tags", under: "memory", hits: 5 });
        expect(describeLookup("tags", {}, null)).toEqual({
            tool: "tags",
            hits: 0,
        });
    });
});

describe("recollect's vocabulary", () => {
    it("names recollect, but keeps it out of the external pair", () => {
        expect(toolOf("mcp__memory__recollect")).toBe("recollect");
        expect(RECOLLECT_TOOL).toBe("mcp__memory__recollect");
        expect(ALLOWED_TOOLS).not.toContain(RECOLLECT_TOOL);
    });

    it("describes a recollection by its cluster, words and turns", () => {
        const result: RecollectResult = {
            cluster: 2,
            turns: [15, 31],
            total: 40,
            matched: true,
            window: [
                { turn: 18, role: "user", at: "x", text: "a" },
                { turn: 24, role: "assistant", at: "y", text: "b" },
            ],
        };
        expect(
            describeLookup(
                "recollect",
                { cluster: 2, words: "render" },
                JSON.stringify(result),
            ),
        ).toEqual({
            tool: "recollect",
            cluster: 2,
            words: "render",
            turns: [18, 24],
        });
    });

    it("describes a failed recollection with no turns", () => {
        expect(describeLookup("recollect", { cluster: 7 }, null)).toEqual({
            tool: "recollect",
            cluster: 7,
            turns: null,
        });
        expect(describeLookup("recollect", {}, null)).toEqual({
            tool: "recollect",
            cluster: 0,
            turns: null,
        });
    });

    it("records 0 for a cluster that was never a whole number from 1", () => {
        for (const cluster of [0, -1, 1.5, Number.NaN, "2", null]) {
            expect(describeLookup("recollect", { cluster }, null)).toEqual({
                tool: "recollect",
                cluster: 0,
                turns: null,
            });
        }
    });
});

describe("the memory tools' names", () => {
    it("gives chat remember, and Claude Code a server of its own", () => {
        expect(ALLOWED_TOOLS).toEqual([
            "mcp__memory__search",
            "mcp__memory__open",
            "mcp__memory__tags",
            "mcp__memory__remember",
        ]);
        expect(CLAUDE_ALLOWED_TOOLS).toEqual([
            "mcp__dorothy-memory__search",
            "mcp__dorothy-memory__open",
            "mcp__dorothy-memory__tags",
            "mcp__dorothy-memory__remember",
        ]);
        expect(REMEMBER_TOOL).toBe("mcp__memory__remember");
    });

    it("never takes remember for a lookup", () => {
        expect(toolOf(REMEMBER_TOOL)).toBeNull();
    });
});

describe("describeLookup over facts", () => {
    it("counts a search's facts apart, and keeps its kind", () => {
        const result = JSON.stringify({
            facts: [{ id: "personal/tea" }],
            moreFacts: 2,
            results: [],
            more: 0,
        });
        expect(
            describeLookup("search", { query: "tea", kind: "facts" }, result),
        ).toEqual({
            tool: "search",
            query: "tea",
            searched: "facts",
            hits: 0,
            facts: 3,
        });
    });

    it("records no facts for a search of conversations alone", () => {
        const result = JSON.stringify({
            facts: [],
            moreFacts: 0,
            results: [],
            more: 0,
        });
        expect(
            describeLookup(
                "search",
                { query: "x", kind: "conversations" },
                result,
            ),
        ).toEqual({
            tool: "search",
            query: "x",
            searched: "conversations",
            hits: 0,
        });
    });

    it("names an opened fact by its title", () => {
        const result = JSON.stringify({
            id: "personal/tea",
            title: "Tea at four",
        });
        expect(
            describeLookup(
                "open",
                { fact: "personal/tea", purpose: "her tea" },
                result,
            ),
        ).toEqual({
            tool: "open",
            fact: "personal/tea",
            name: "Tea at four",
            purpose: "her tea",
            turns: null,
        });
        expect(
            describeLookup(
                "open",
                { fact: "personal/tea", purpose: "p" },
                null,
            ),
        ).toEqual({
            tool: "open",
            fact: "personal/tea",
            name: "personal/tea",
            purpose: "p",
            turns: null,
        });
    });
});
