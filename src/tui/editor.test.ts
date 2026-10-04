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
    insert,
    killLineEnd,
    killLineStart,
    killWordBack,
    left,
    lineEnd,
    lineStart,
    right,
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
