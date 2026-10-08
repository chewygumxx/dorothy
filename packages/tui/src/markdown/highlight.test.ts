// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/markdown/highlight.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { highlight } from "./highlight.js";

describe("highlight", () => {
    it("colours keywords, strings and comments, keeping the text", () => {
        const spans = highlight("const x = 'a'; // c", "ts");
        expect(spans).toContainEqual({
            text: "const",
            style: { color: "magenta" },
        });
        expect(spans).toContainEqual({
            text: "'a'",
            style: { color: "green" },
        });
        expect(spans).toContainEqual({ text: "// c", style: { dim: true } });
        expect(spans?.map((span) => span.text).join("")).toBe(
            "const x = 'a'; // c",
        );
    });

    it("colours a function's name blue", () => {
        expect(highlight("function f() {}", "js")).toContainEqual({
            text: "f",
            style: { color: "blue" },
        });
    });

    it("reads the language from the first word of the info string", () => {
        expect(highlight("x = 1", "python {linenos}")).not.toBeNull();
    });

    it("returns null for a missing or unknown language", () => {
        expect(highlight("x", undefined)).toBeNull();
        expect(highlight("x", "")).toBeNull();
        expect(highlight("x", "no-such-language")).toBeNull();
    });
});
