// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/contracts/start.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { withSection } from "./start.js";

describe("withSection", () => {
    it("adds a section after a blank line", () => {
        expect(withSection("You are Dorothy.", "<memory/>")).toBe(
            "You are Dorothy.\n\n<memory/>",
        );
    });

    it("leaves the prompt alone for an empty section", () => {
        expect(withSection("You are Dorothy.", "")).toBe("You are Dorothy.");
    });
});
