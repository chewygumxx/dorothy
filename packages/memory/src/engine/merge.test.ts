// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/engine/merge.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { MemoryHit } from "@dorothy/core";
import { mergeHits } from "./merge.js";

const hit = (id: string): MemoryHit => ({
    id,
    kind: id.startsWith("k:") ? "knowledge" : "episode",
    scope: "personal",
    title: id,
    snippet: "",
});
const ids = (hits: MemoryHit[]) => hits.map((each) => each.id);
const k = ["k:personal/a", "k:personal/b", "k:personal/c"].map(hit);
const e = ["c:one", "c:two"].map(hit);

describe("mergeHits", () => {
    it("alternates by rank, the best episode first", () => {
        expect(ids(mergeHits(k, e, "alternate", 10))).toEqual([
            "c:one",
            "k:personal/a",
            "c:two",
            "k:personal/b",
            "k:personal/c",
        ]);
    });

    it("keeps every knowledge hit first when asked", () => {
        expect(ids(mergeHits(k, e, "knowledge-first", 4))).toEqual([
            "k:personal/a",
            "k:personal/b",
            "k:personal/c",
            "c:one",
        ]);
    });

    it("cuts to the limit after merging, so neither kind starves", () => {
        expect(ids(mergeHits(k, e, "alternate", 2))).toEqual([
            "c:one",
            "k:personal/a",
        ]);
    });

    it("takes either list empty", () => {
        expect(ids(mergeHits([], e, "alternate", 10))).toEqual(ids(e));
        expect(ids(mergeHits(k, [], "alternate", 10))).toEqual(ids(k));
        expect(mergeHits([], [], "alternate", 10)).toEqual([]);
    });
});
