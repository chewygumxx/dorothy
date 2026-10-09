// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/layout.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    fitLayout,
    INPUT_MAX_ROWS,
    MIN_COLUMNS,
    minRows,
    tooSmallMessage,
    tooSmallShort,
} from "./layout.js";

type Options = Parameters<typeof fitLayout>[1];
// Every row of the live region: the reply, the raw pane and its frame, the
// border, the warnings, the input, the statusline and the header.
const used = (rows: number, options: Options) => {
    const { replyRows, rawRows, inputRows } = fitLayout(rows, options);
    return (
        replyRows +
        rawRows +
        (options.showRaw ? 3 : 0) +
        1 +
        options.warnings +
        inputRows +
        options.statusRows +
        1
    );
};

describe("minRows", () => {
    it("is 19 lines and the statusline's", () => {
        expect([minRows(0), minRows(1), minRows(5)]).toEqual([19, 20, 24]);
        expect([MIN_COLUMNS, INPUT_MAX_ROWS]).toEqual([40, 5]);
    });
});

describe("tooSmallMessage", () => {
    it("names the minimum and the window", () => {
        expect(tooSmallMessage(20, 14, 80)).toBe(
            "Too Small: Dorothy's TUI needs at least 20 lines and 40 columns (this window is 14 × 80)",
        );
    });

    it("has a short form that leads with the sizes", () => {
        expect(tooSmallShort(20, 3, 20)).toBe("Needs 20 × 40 (is 3 × 20)");
    });
});

describe("fitLayout", () => {
    it("fits every part, two rows short of the window, from the minimum up", () => {
        for (let statusLines = 0; statusLines <= 5; statusLines++) {
            for (let rows = minRows(statusLines); rows <= 60; rows++) {
                for (const showRaw of [false, true]) {
                    for (let warnings = 0; warnings <= 3; warnings++) {
                        for (
                            let statusRows = 0;
                            statusRows <= statusLines;
                            statusRows++
                        ) {
                            for (const wanted of [1, 3, 5, 6, 50]) {
                                const options = {
                                    showRaw,
                                    rawCount: 20,
                                    warnings,
                                    statusRows,
                                    inputRows: wanted,
                                };
                                const layout = fitLayout(rows, options);
                                expect(used(rows, options)).toBe(rows - 2);
                                expect(layout.replyRows).toBeGreaterThanOrEqual(
                                    3,
                                );
                                expect(layout.inputRows).toBe(
                                    Math.min(wanted, 5),
                                );
                                expect(layout.rawRows > 0).toBe(showRaw);
                            }
                        }
                    }
                }
            }
        }
    });

    it("gives the reply the room the raw pane does not use", () => {
        const options = {
            showRaw: false,
            rawCount: 20,
            warnings: 0,
            statusRows: 1,
            inputRows: 1,
        };
        expect(fitLayout(24, options)).toEqual({
            replyRows: 18,
            rawRows: 0,
            inputRows: 1,
        });
        expect(fitLayout(24, { ...options, showRaw: true })).toEqual({
            replyRows: 10,
            rawRows: 5,
            inputRows: 1,
        });
    });

    it("shows no more raw rows than there are messages", () => {
        expect(
            fitLayout(50, {
                showRaw: true,
                rawCount: 2,
                warnings: 0,
                statusRows: 1,
                inputRows: 1,
            }).rawRows,
        ).toBe(2);
    });

    it("caps the input at five rows", () => {
        const options = {
            showRaw: false,
            rawCount: 0,
            warnings: 0,
            statusRows: 1,
            inputRows: 30,
        };
        expect(fitLayout(60, options).inputRows).toBe(5);
        expect(fitLayout(60, { ...options, inputRows: 2 }).inputRows).toBe(2);
    });
});
