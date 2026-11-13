// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/identity/src/strip.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { stripHouseHeader } from "./strip.js";

const BODY = "You are Dorothy.\n\nSecond paragraph.";

function fixture(body = BODY, mtime = "2026-11-14"): string {
    return [
        "---",
        "ctime: 2026-11-13",
        `mtime: ${mtime}`,
        "---",
        "",
        "<!--\n   -\n   - ~xxdorothy/dorothy.git\n   - ::: :/x.md\n   -\n   -->",
        "",
        body,
        "",
        "<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->",
    ].join("\n");
}

describe("stripHouseHeader", () => {
    it("returns the body alone", () => {
        expect(stripHouseHeader(fixture())).toBe(BODY);
    });

    it("ignores the header's dates", () => {
        expect(stripHouseHeader(fixture(BODY, "2026-11-14"))).toBe(
            stripHouseHeader(fixture(BODY, "2026-11-15")),
        );
    });

    it("reads CRLF and a BOM as LF", () => {
        const source = `\uFEFF${fixture().replaceAll("\n", "\r\n")}`;
        expect(stripHouseHeader(source)).toBe(BODY);
    });

    it("leaves other comments in the body", () => {
        const body = "You are Dorothy.\n\n<!-- note -->\n\nSecond paragraph.";
        expect(stripHouseHeader(fixture(body))).toBe(body);
    });

    it("throws on a header with no body", () => {
        expect(() => stripHouseHeader(fixture(""))).toThrow("empty");
    });
});
