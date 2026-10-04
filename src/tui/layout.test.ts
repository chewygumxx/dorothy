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
type Options = Parameters<typeof fitLayout>[1];
const used = (rows: number, options: Options) => {
    const { replyRows, rawRows, inputRows } = fitLayout(rows, options);
    return (
        replyRows +
        rawRows +
        2 +
        inputRows +
        (options.warning ? 1 : 0) +
        (options.showRaw ? 3 : 0)
    );
};

describe("fitLayout", () => {
    it("keeps the live region shorter than the terminal", () => {
        for (const rows of [10, 24, 50]) {
            for (const showRaw of [false, true]) {
                for (const warning of [false, true]) {
                    for (const inputRows of [1, 3, 30]) {
                        const options = {
                            showRaw,
                            rawCount: 20,
                            warning,
                            inputRows,
                        };
                        expect(used(rows, options)).toBeLessThan(rows);
                    }
                }
            }
        }
    });

    it("gives the reply the room the raw pane does not use", () => {
        expect(
            fitLayout(24, {
                showRaw: false,
                rawCount: 20,
                warning: false,
                inputRows: 1,
            }),
        ).toEqual({
            replyRows: 19,
            rawRows: 0,
            inputRows: 1,
        });
        expect(
            fitLayout(24, {
                showRaw: true,
                rawCount: 20,
                warning: false,
                inputRows: 1,
            }),
        ).toEqual({
            replyRows: 10,
            rawRows: 6,
            inputRows: 1,
        });
    });

    it("shows no more raw rows than there are messages", () => {
        expect(
            fitLayout(50, {
                showRaw: true,
                rawCount: 2,
                warning: false,
                inputRows: 1,
            }).rawRows,
        ).toBe(2);
    });

    it("always leaves the reply one row", () => {
        expect(
            fitLayout(4, {
                showRaw: true,
                rawCount: 20,
                warning: true,
                inputRows: 1,
            }).replyRows,
        ).toBe(1);
    });

    it("caps the input at a third of the terminal", () => {
        const options = {
            showRaw: false,
            rawCount: 0,
            warning: false,
            inputRows: 30,
        };
        expect(fitLayout(24, options)).toEqual({
            replyRows: 12,
            rawRows: 0,
            inputRows: 8,
        });
        expect(fitLayout(24, { ...options, inputRows: 2 }).inputRows).toBe(2);
        expect(fitLayout(6, options).inputRows).toBe(1);
    });
});
