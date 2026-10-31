// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/terms.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { scoreOf, termsOf } from "./terms.js";

describe("terms", () => {
    it("keeps words of three letters or more, not the common ones", () => {
        expect(termsOf("What do I drink at four in the afternoon?")).toEqual([
            "drink",
            "four",
            "afternoon",
        ]);
    });

    it("counts the terms a text holds", () => {
        expect(
            scoreOf("I drink green tea at four.", ["drink", "four", "plot"]),
        ).toBe(2);
    });
});
