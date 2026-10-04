// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/editor.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    backspace,
    type Draft,
    deleteForward,
    down,
    draftWindow,
    insert,
    killLineEnd,
    killLineStart,
    killWordBack,
    layoutDraft,
    left,
    lineEnd,
    lineStart,
    right,
    up,
    wordLeft,
    wordRight,
} from "./editor.js";

const at = (text: string, cursor = text.length): Draft => ({ text, cursor });
const DEV = "👩‍💻"; // one grapheme, five UTF-16 units

describe("editing a draft", () => {
    it("inserts at the cursor", () => {
        expect(insert(at("ac", 1), "b")).toEqual(at("abc", 2));
    });

    it("deletes one grapheme back or forward", () => {
        expect(backspace(at(`a${DEV}`))).toEqual(at("a"));
        expect(backspace(at("ab", 0))).toEqual(at("ab", 0));
        expect(deleteForward(at(`a${DEV}b`, 1))).toEqual(at("ab", 1));
        expect(deleteForward(at("ab"))).toEqual(at("ab"));
    });

    it("moves one grapheme, stopping at the ends", () => {
        expect(left(at(`a${DEV}`))).toEqual(at(`a${DEV}`, 1));
        expect(right(at(`a${DEV}b`, 1))).toEqual(at(`a${DEV}b`, 6));
        expect(left(at("ab", 0)).cursor).toBe(0);
        expect(right(at("ab")).cursor).toBe(2);
    });

    it("moves by words of non-space", () => {
        expect(wordLeft(at("one two  three")).cursor).toBe(9);
        expect(wordLeft(at("one two  three", 9)).cursor).toBe(4);
        expect(wordRight(at("one two", 0)).cursor).toBe(3);
        expect(wordRight(at("one two", 3)).cursor).toBe(7);
    });

    it("moves to the start or end of the logical line", () => {
        expect(lineStart(at("ab\ncd", 4)).cursor).toBe(3);
        expect(lineEnd(at("ab\ncd", 1)).cursor).toBe(2);
        expect(lineEnd(at("ab\ncd", 4)).cursor).toBe(5);
    });

    it("kills to the end of the line, or the newline at its end", () => {
        expect(killLineEnd(at("ab\ncd", 1))).toEqual({
            draft: at("a\ncd", 1),
            killed: "b",
        });
        expect(killLineEnd(at("ab\ncd", 2))).toEqual({
            draft: at("abcd", 2),
            killed: "\n",
        });
        expect(killLineEnd(at("ab")).killed).toBe("");
    });

    it("kills to the start of the line and the previous word", () => {
        expect(killLineStart(at("ab\ncd"))).toEqual({
            draft: at("ab\n"),
            killed: "cd",
        });
        expect(killWordBack(at("one two"))).toEqual({
            draft: at("one "),
            killed: "two",
        });
        expect(killWordBack(at("one two "))).toEqual({
            draft: at("one "),
            killed: "two ",
        });
    });
});

const rowsOf = (draft: Draft, width: number) =>
    layoutDraft(draft, width).rows.map((row) => row.text);

describe("layoutDraft", () => {
    it("wraps at the width, dropping the space at a break", () => {
        expect(layoutDraft(at("aaaa bbbb"), 6)).toEqual({
            rows: [
                { text: "aaaa", start: 0 },
                { text: "bbbb", start: 5 },
            ],
            cursorRow: 1,
            cursorColumn: 4,
        });
    });

    it("shows a cursor on a dropped space at the end of the row before", () => {
        const layout = layoutDraft(at("aaaa bbbb", 4), 6);
        expect([layout.cursorRow, layout.cursorColumn]).toEqual([0, 4]);
        const after = layoutDraft(at("aaaa bbbb", 5), 6);
        expect([after.cursorRow, after.cursorColumn]).toEqual([1, 0]);
    });

    it("puts a cursor at a hard break on the next row", () => {
        expect(rowsOf(at("abcdefgh"), 3)).toEqual(["abc", "def", "gh"]);
        const layout = layoutDraft(at("abcdefgh", 3), 3);
        expect([layout.cursorRow, layout.cursorColumn]).toEqual([1, 0]);
    });

    it("keeps blank lines as rows", () => {
        const layout = layoutDraft(at("ab\n\ncd", 3), 10);
        expect(layout.rows).toEqual([
            { text: "ab", start: 0 },
            { text: "", start: 3 },
            { text: "cd", start: 4 },
        ]);
        expect([layout.cursorRow, layout.cursorColumn]).toEqual([1, 0]);
    });

    it("counts columns by display width", () => {
        expect(rowsOf(at("中文中"), 4)).toEqual(["中文", "中"]);
        const layout = layoutDraft(at("中文中", 1), 4);
        expect([layout.cursorRow, layout.cursorColumn]).toEqual([0, 2]);
    });

    it("lays out an empty draft as one empty row", () => {
        expect(layoutDraft(at(""), 10).rows).toEqual([{ text: "", start: 0 }]);
    });
});

describe("up and down", () => {
    it("move by visual row, keeping the column", () => {
        expect(up(at("aaaa bbbb", 7), 6)).toEqual(at("aaaa bbbb", 2));
        expect(down(at("aaaa bbbb", 2), 6)).toEqual(at("aaaa bbbb", 7));
    });

    it("return null past the first or last row", () => {
        expect(up(at("aaaa bbbb", 2), 6)).toBeNull();
        expect(down(at("aaaa bbbb", 7), 6)).toBeNull();
    });

    it("stop short of a hard break, which belongs to the next row", () => {
        expect(up(at("abcdef"), 3)).toEqual(at("abcdef", 2));
        expect(down(at("abcdefgh", 0), 3, 3)).toEqual(at("abcdefgh", 5));
        expect(up(at("中中中中"), 5)).toEqual(at("中中中中", 1));
    });

    it("keep a goal column through a shorter row", () => {
        const text = "abcdef\nab\nabcdef";
        const once = down(at(text, 5), 20, 5);
        expect(once).toEqual(at(text, 9));
        expect(down(once ?? at(text), 20, 5)).toEqual(at(text, 15));
    });
});

describe("draftWindow", () => {
    const layout = (rows: number, cursorRow: number) => ({
        rows: Array.from({ length: rows }, (_, start) => ({ text: "", start })),
        cursorRow,
        cursorColumn: 0,
    });

    it("shows every row of a short draft", () => {
        expect(draftWindow(layout(2, 1), 3)).toEqual({ first: 0, last: 2 });
    });

    it("keeps the cursor in view of a tall draft", () => {
        expect(draftWindow(layout(10, 0), 3)).toEqual({ first: 0, last: 3 });
        expect(draftWindow(layout(10, 5), 3)).toEqual({ first: 3, last: 6 });
        expect(draftWindow(layout(10, 9), 3)).toEqual({ first: 7, last: 10 });
    });
});
