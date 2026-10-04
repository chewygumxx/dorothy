// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/markdown/render.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { decodeEntities, renderMarkdown } from "./render.js";
import { PLAIN, type Row, rowText, type Span } from "./spans.js";

const plain = (text: string): Span => ({ text, style: PLAIN });
const texts = (rows: Row[]) => rows.map(rowText);
const md = (text: string, width = 40) => renderMarkdown(text, width);

describe("renderMarkdown inline", () => {
    it("styles bold and italic text without its markers", () => {
        expect(md("Some **bold** and *it*")).toEqual([
            [
                plain("Some "),
                { text: "bold", style: { bold: true } },
                plain(" and "),
                { text: "it", style: { italic: true } },
            ],
        ]);
    });

    it("shows inline code in cyan without backticks", () => {
        expect(md("`x`")).toEqual([[{ text: "x", style: { color: "cyan" } }]]);
    });

    it("strikes deleted text through", () => {
        expect(md("~~gone~~")).toEqual([
            [{ text: "gone", style: { strikethrough: true } }],
        ]);
    });

    it("underlines a link and adds its URL dimmed", () => {
        expect(md("[a](http://x)")).toEqual([
            [
                { text: "a", style: { underline: true } },
                { text: " (http://x)", style: { dim: true } },
            ],
        ]);
        expect(md("<http://x>")).toEqual([
            [{ text: "http://x", style: { underline: true } }],
        ]);
    });

    it("names an image instead of drawing it", () => {
        expect(md("![cat](c.png)")).toEqual([
            [plain("[image: cat]"), { text: " (c.png)", style: { dim: true } }],
        ]);
    });

    it("decodes entities outside code only", () => {
        expect(texts(md("a &amp; b &#39;c&#x27; `&amp;`"))).toEqual([
            "a & b 'c' &amp;",
        ]);
        expect(decodeEntities("&bogus; &#99999999;")).toBe(
            "&bogus; &#99999999;",
        );
    });

    it("breaks rows at hard breaks and joins soft ones", () => {
        expect(texts(md("a  \nb"))).toEqual(["a", "b"]);
        expect(texts(md("a\nb"))).toEqual(["a b"]);
    });

    it("shows escaped characters literally", () => {
        expect(texts(md("\\*x\\*"))).toEqual(["*x*"]);
    });

    it("keeps unclosed markup as text", () => {
        expect(texts(md("so **bol"))).toEqual(["so **bol"]);
    });
});

describe("renderMarkdown blocks", () => {
    it("bolds headings, underlining the top two levels", () => {
        expect(md("# Title")).toEqual([
            [{ text: "Title", style: { bold: true, underline: true } }],
        ]);
        expect(md("### Small")).toEqual([
            [{ text: "Small", style: { bold: true } }],
        ]);
    });

    it("separates blocks by one empty row, with none around them", () => {
        expect(texts(md("a\n\n\n\nb"))).toEqual(["a", "", "b"]);
        expect(md("")).toEqual([]);
    });

    it("draws a rule across the width", () => {
        expect(md("---", 5)).toEqual([
            [{ text: "─────", style: { dim: true } }],
        ]);
    });

    it("labels and highlights a code block behind a gutter", () => {
        const rows = md("```ts\nconst a = 1;\n```");
        expect(rows[0]).toEqual([{ text: "ts", style: { dim: true } }]);
        expect(rowText(rows[1] ?? [])).toBe("┃ const a = 1;");
        expect(rows[1]?.[0]).toEqual({ text: "┃ ", style: { dim: true } });
        expect(rows[1]).toContainEqual({
            text: "const",
            style: { color: "magenta" },
        });
    });

    it("wraps a long code line with a continuation marker", () => {
        expect(texts(md("```\nabcdefghij\n```", 8))).toEqual([
            "┃ abcdef",
            "┃ ↪ ghij",
        ]);
    });

    it("leaves an unlabelled code block plain", () => {
        const rows = md("```\nconst a = 1;\n```");
        expect(rows).toEqual([
            [{ text: "┃ ", style: { dim: true } }, plain("const a = 1;")],
        ]);
    });

    it("keeps an unclosed code fence as a code block", () => {
        expect(texts(md("```js\nlet a"))).toEqual(["js", "┃ let a"]);
    });

    it("shows raw HTML as text", () => {
        expect(texts(md("<div>x</div>"))).toEqual(["<div>x</div>"]);
    });
});

describe("renderMarkdown lists and quotes", () => {
    it("bullets an unordered list", () => {
        expect(texts(md("- one\n- two"))).toEqual(["• one", "• two"]);
    });

    it("numbers an ordered list from its start, right-aligned", () => {
        expect(texts(md("3. a\n4. b"))).toEqual(["3. a", "4. b"]);
        expect(texts(md("9. a\n10. b"))).toEqual([" 9. a", "10. b"]);
    });

    it("hangs wrapped item text under the item's first word", () => {
        expect(texts(md("- aaaa bbbb", 8))).toEqual(["• aaaa", "  bbbb"]);
    });

    it("nests a list under its parent item's text", () => {
        expect(texts(md("- a\n  - b\n    - c"))).toEqual([
            "• a",
            "  • b",
            "    • c",
        ]);
    });

    it("shows task items with boxes", () => {
        expect(texts(md("- [x] done\n- [ ] todo"))).toEqual([
            "• ☑ done",
            "• ☐ todo",
        ]);
    });

    it("spaces a loose list's items", () => {
        expect(texts(md("- a\n\n- b"))).toEqual(["• a", "", "• b"]);
    });

    it("puts a quote behind a dim bar", () => {
        expect(md("> a\n> b")).toEqual([
            [{ text: "│ ", style: { dim: true } }, plain("a b")],
        ]);
        expect(texts(md("> aaa bbb", 5))).toEqual(["│ aaa", "│ bbb"]);
    });
});
