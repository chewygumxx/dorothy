// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/layout.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { fitLayout } from "./layout.js";

// Rows the live region takes besides the reply and the raw entries: the
// status bar's border, header and input, plus the raw pane's border and title.
const used = (
    rows: number,
    options: { showRaw: boolean; rawCount: number; warning: boolean },
) => {
    const { replyRows, rawRows } = fitLayout(rows, options);
    return (
        replyRows +
        rawRows +
        3 +
        (options.warning ? 1 : 0) +
        (options.showRaw ? 3 : 0)
    );
};

describe("fitLayout", () => {
    it("keeps the live region shorter than the terminal", () => {
        for (const rows of [10, 24, 50]) {
            for (const showRaw of [false, true]) {
                for (const warning of [false, true]) {
                    const options = { showRaw, rawCount: 20, warning };
                    expect(used(rows, options)).toBeLessThan(rows);
                }
            }
        }
    });

    it("gives the reply the room the raw pane does not use", () => {
        expect(
            fitLayout(24, { showRaw: false, rawCount: 20, warning: false }),
        ).toEqual({
            replyRows: 19,
            rawRows: 0,
        });
        expect(
            fitLayout(24, { showRaw: true, rawCount: 20, warning: false }),
        ).toEqual({
            replyRows: 10,
            rawRows: 6,
        });
    });

    it("shows no more raw rows than there are messages", () => {
        expect(
            fitLayout(50, { showRaw: true, rawCount: 2, warning: false })
                .rawRows,
        ).toBe(2);
    });

    it("always leaves the reply one row", () => {
        expect(
            fitLayout(4, { showRaw: true, rawCount: 20, warning: true })
                .replyRows,
        ).toBe(1);
    });
});
