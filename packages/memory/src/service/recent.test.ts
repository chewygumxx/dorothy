// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/recent.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { Recent } from "./recent.js";

describe("Recent", () => {
    it("keeps its limit of the keys set last, the oldest going first", () => {
        const recent = new Recent<string, number>(3);
        for (const [key, value] of [
            ["a", 1],
            ["b", 2],
            ["c", 3],
            ["d", 4],
        ] as const) {
            recent.set(key, value);
        }
        expect([...recent.keys()]).toEqual(["b", "c", "d"]);
        // Setting a key again makes it the newest.
        recent.set("b", 20);
        recent.set("e", 5);
        expect([...recent]).toEqual([
            ["d", 4],
            ["b", 20],
            ["e", 5],
        ]);
        expect(recent.get("c")).toBeUndefined();
    });
});
