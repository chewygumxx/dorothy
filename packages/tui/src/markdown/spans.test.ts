// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/markdown/spans.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    breakSpans,
    PLAIN,
    type Row,
    rowText,
    rowWidth,
    type Span,
    splitLines,
    wrapSpans,
} from "./spans.js";

const plain = (text: string): Span => ({ text, style: PLAIN });
const BOLD = { bold: true };
const texts = (rows: Row[]) => rows.map(rowText);

describe("wrapSpans", () => {
    it("breaks at the last space that fits and drops it", () => {
        expect(texts(wrapSpans([plain("hello world foo")], 11))).toEqual([
            "hello world",
            "foo",
        ]);
        expect(texts(wrapSpans([plain("aaaa bbbb")], 6))).toEqual([
            "aaaa",
            "bbbb",
        ]);
    });

    it("hard-breaks a word wider than the width", () => {
        expect(texts(wrapSpans([plain("abcdefgh")], 3))).toEqual([
            "abc",
            "def",
            "gh",
        ]);
    });

    it("keeps styles across a break", () => {
        const bold = (text: string): Span => ({ text, style: BOLD });
        const spans = [plain("one "), bold("two three")];
        expect(wrapSpans(spans, 8)).toEqual([
            [plain("one "), bold("two")],
            [bold("three")],
        ]);
    });

    it("measures emoji and CJK as two columns", () => {
        expect(texts(wrapSpans([plain("中文中文")], 5))).toEqual([
            "中文",
            "中文",
        ]);
        expect(texts(wrapSpans([plain("👩‍💻👩‍💻👩‍💻")], 4))).toEqual([
            "👩‍💻👩‍💻",
            "👩‍💻",
        ]);
    });

    it("keeps newlines and blank lines", () => {
        expect(texts(wrapSpans([plain("a\n\nb")], 10))).toEqual(["a", "", "b"]);
    });

    it("expands a tab to four spaces", () => {
        expect(texts(wrapSpans([plain("\tx")], 10))).toEqual(["    x"]);
    });

    it("drops control characters", () => {
        expect(texts(wrapSpans([plain("a\u001B[2Jb\u0007c\rd")], 20))).toEqual([
            "a[2Jbcd",
        ]);
    });

    it("never yields a row wider than the width", () => {
        const text =
            "Thanks, that's useful 中文 👩‍💻 supercalifragilisticexpialidocious end.";
        for (let width = 2; width <= 30; width++) {
            for (const row of wrapSpans([plain(text)], width)) {
                expect(rowWidth(row)).toBeLessThanOrEqual(width);
            }
        }
    });
});

describe("breakSpans", () => {
    it("keeps every character, with a narrower width after the first row", () => {
        expect(texts(breakSpans([plain("abcdefgh")], 4, 2))).toEqual([
            "abcd",
            "ef",
            "gh",
        ]);
        expect(texts(breakSpans([plain("ab cd")], 3, 3))).toEqual([
            "ab ",
            "cd",
        ]);
    });

    it("yields one empty row for no spans", () => {
        expect(breakSpans([], 4, 4)).toEqual([[]]);
    });
});

describe("splitLines", () => {
    it("splits spans at newlines, keeping styles", () => {
        const bold = (text: string): Span => ({ text, style: BOLD });
        expect(splitLines([plain("a\nb"), bold("c\nd")])).toEqual([
            [plain("a")],
            [plain("b"), bold("c")],
            [bold("d")],
        ]);
    });
});
