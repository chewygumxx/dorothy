// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/contracts/memory.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    conversationId,
    HOST_ID,
    knowledgeId,
    parseMemoryId,
} from "./memory.js";

const PHRASE = "bingo-overabundance-mazer-kasha";

describe("parseMemoryId", () => {
    it("reads knowledge and conversation ids", () => {
        expect(parseMemoryId(knowledgeId("personal/likes-tea"))).toEqual({
            kind: "knowledge",
            path: "personal/likes-tea",
        });
        expect(parseMemoryId("k:projects/github.com/me/app/uses-rust")).toEqual(
            {
                kind: "knowledge",
                path: "projects/github.com/me/app/uses-rust",
            },
        );
        expect(parseMemoryId(conversationId(PHRASE))).toEqual({
            kind: "conversation",
            phrase: PHRASE,
        });
    });

    it("refuses anything else", () => {
        for (const id of [
            "",
            "likes-tea",
            "k:likes-tea",
            "k:personal/Likes",
            "k:projects/../likes-tea",
            "k:personal/../../etc/passwd",
            "c:not-a-phrase",
            "x:personal/likes-tea",
        ]) {
            expect({ id, parsed: parseMemoryId(id) }).toEqual({
                id,
                parsed: null,
            });
        }
    });
});

describe("HOST_ID", () => {
    it("takes profile names and nothing else", () => {
        expect(HOST_ID.test("claude-code")).toBe(true);
        expect(HOST_ID.test("deepseek-harness")).toBe(true);
        expect(HOST_ID.test("Claude")).toBe(false);
        expect(HOST_ID.test("a/b")).toBe(false);
        expect(HOST_ID.test("")).toBe(false);
    });
});
