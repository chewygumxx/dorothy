---
__cgxx: |
  # vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3:
  # SPDX-License-Identifier: GPL-3.0-only

  #
  #
  # ~chewygumxx/dorothy.git
  # ::: :/docs/plans/2026-10-03-markdown-replies.md
  #
  #

ctime: 2026-10-03
title: Markdown replies plan
description: "Implementation plan for rendering Dorothy's Markdown replies"
tags:
  - dorothy
  - tui
  - markdown
  - plan
---

# Markdown Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render each finished Dorothy reply in the TUI as formatted Markdown
(GFM, tables, highlighted code) that never passes the terminal's width.

**Architecture:** A pure pipeline under `src/tui/markdown/`: `marked.lexer`
tokens become rows of styled spans (`renderMarkdown`), wrapped by our own
width-aware `wrapSpans`, with code coloured by `lowlight`. `History`'s
`LineView` draws those rows with Ink `<Text>`; streaming stays plain.

**Tech Stack:** Bun 1.4, TypeScript 7, Ink 7, React 19, `marked` 18, `lowlight`
3, `string-width` 8, `bun test` with `ink-testing-library`.

**Spec:** `docs/specs/2026-10-03-markdown-replies-design.md`

## Amendments of 2026-10-04

Fixes landed on `main` after this plan was written; where a task disagrees,
these win.

- `string-width` `^8.3.0` is already a dependency (`13960f8`): skip Task 1's
  Step 1 and its `build(tui): Add string-width` commit.
- `wrapRows` already wraps by grapheme and display width, expands tabs and
  drops control characters (`9ae453f`), with tests for wide characters,
  composite emoji, tabs and controls in `components.test.tsx`. Task 1 Step 6
  still moves it onto `wrapSpans`; those tests must keep passing.
- `formatStats(stats, chatCostUsd)` takes the chat's running cost, and
  `TurnStats` has `cacheReadTokens` and `cacheWriteTokens` (`3b00d92`). Task 6
  keeps History's stats row as it is now.

## Global Constraints

- No rendered row is wider than the width it was rendered for (for widths of
  2 or more; a single two-column grapheme cannot fit in one column).
- Streaming (`LiveReply`), `fitLayout`, `Conversation` and transcripts do not
  change; transcripts keep raw Markdown.
- `you` and `error` lines stay plain text.
- Highlight colours: `keyword built_in type literal` magenta, `string regexp
  symbol` green, `number` yellow, `comment quote` dim, `title function class
  section` blue, `attr attribute property variable params` cyan.
- Commit headers at most 50 characters, body lines at most 72, scope `tui`
  (or `build` type for dependencies); run `bunx biome check --write` on
  changed files before each commit; no em dashes anywhere.
- Every source file starts with the repository's header comment (copy it from
  `src/tui/layout.ts`, changing the `::: :/` path line).

## Review Focus

- A reply containing raw control characters (ESC, BEL, a stray `\r`):
  expect them dropped, never written to the terminal. Test in Task 1.
- A reply cut off mid-markup (`**bol`, an unclosed code fence) by an
  interrupt: expect literal text or an open code block, no crash. Test in
  Task 3.
- A long URL or unbroken token inside a link, list or table cell at width
  20: expect hard breaks, no overflow. Covered by the corpus in Task 6.
- Deep nesting (quote in list in list) at width 20: expect every row within
  the width. Covered by the corpus in Task 6.
- An empty reply (interrupted before the first token): expect the `dorothy`
  label on its own row, no crash. Test in Task 6.

## Plan-level decisions (refining the spec)

- `highlight` returns `Span[] | null` (with `\n` inside) rather than
  `Row[] | null`: the code block splits lines and wraps them itself.
- Code lines are broken by `breakSpans`, which keeps every character (spaces
  matter in code), rather than by the word wrap.
- A nested list starts under its parent item's text (2 columns in under a
  bullet, the number's width plus 2 under a number), which is what "2 further
  in" means for bullets.
- Soft line breaks inside a paragraph become spaces, as in Markdown; only
  hard breaks (`br`) start a new row.

## File map

- Create `src/tui/markdown/spans.ts`: `Style`, `Span`, `Row`, `PLAIN`,
  `graphemes`, `rowText`, `rowWidth`, `splitLines`, `wrapSpans`, `breakSpans`.
- Create `src/tui/markdown/highlight.ts`: `highlight`.
- Create `src/tui/markdown/render.ts`: `renderMarkdown`, `decodeEntities`,
  `fitColumns`.
- Create `src/tui/Markdown.tsx`: `RowsView`.
- Tests beside each: `spans.test.ts`, `highlight.test.ts`, `render.test.ts`.
- Modify `src/tui/LiveReply.tsx` (`wrapRows` over `wrapSpans`),
  `src/tui/History.tsx` (`LineView` draws rows), `src/tui/components.test.tsx`,
  `README.md`, `package.json`, `bun.lock`.

---

### Task 1: Styled spans and width-aware wrapping

**Files:**

- Create: `src/tui/markdown/spans.ts`
- Create: `src/tui/markdown/spans.test.ts`
- Modify: `src/tui/LiveReply.tsx` (`wrapRows`)
- Modify: `package.json`, `bun.lock`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `type Style = { bold?; italic?; underline?; strikethrough?; dim?: boolean; color?: string }`
  - `type Span = { text: string; style: Style }`, `type Row = Span[]`
  - `const PLAIN: Style`
  - `graphemes(text: string): string[]`
  - `rowText(row: Row): string`, `rowWidth(row: Row): number`
  - `splitLines(spans: Span[]): Span[][]`
  - `wrapSpans(spans: Span[], width: number): Row[]`
  - `breakSpans(spans: Span[], first: number, rest: number): Row[]`
  - `wrapRows(text, width): string[]` keeps its signature.

- [ ] **Step 1: Add string-width**

Run: `bun add string-width@^8.3.0`
Expected: `package.json` gains `"string-width": "^8.3.0"` under
`dependencies`; `bun.lock` updates.

- [ ] **Step 2: Write the failing tests**

Create `src/tui/markdown/spans.test.ts` (header comment first):

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/tui/markdown/spans.test.ts`
Expected: FAIL, `Cannot find module './spans.js'`.

- [ ] **Step 4: Implement spans.ts**

Create `src/tui/markdown/spans.ts` (header comment first):

```ts
import stringWidth from "string-width";

export type Style = {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    dim?: boolean;
    color?: string;
};
export type Span = { text: string; style: Style };
export type Row = Span[];

export const PLAIN: Style = {};

const segmenter = new Intl.Segmenter();

export function graphemes(text: string): string[] {
    return Array.from(segmenter.segment(text), (part) => part.segment);
}

export const rowText = (row: Row): string =>
    row.map((span) => span.text).join("");

export const rowWidth = (row: Row): number =>
    row.reduce((sum, span) => sum + stringWidth(span.text), 0);

type Cell = { text: string; width: number; style: Style };

// Control characters would reach the terminal as commands, so they are
// dropped; a tab, which string-width measures as nothing, becomes spaces.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const CONTROL = /^[\u0000-\u0008\u000B-\u001F\u007F]+$/;

function cellLines(spans: Span[]): Cell[][] {
    const lines: Cell[][] = [];
    let line: Cell[] = [];
    lines.push(line);
    for (const span of spans) {
        for (const text of graphemes(span.text)) {
            if (text === "\n" || text === "\r\n") {
                line = [];
                lines.push(line);
            } else if (text === "\t") {
                for (let i = 0; i < 4; i++) {
                    line.push({ text: " ", width: 1, style: span.style });
                }
            } else if (!CONTROL.test(text)) {
                line.push({ text, width: stringWidth(text), style: span.style });
            }
        }
    }
    return lines;
}

// Adjacent cells that share a style object become one span.
function toRow(cells: Cell[]): Row {
    const row: Row = [];
    for (const cell of cells) {
        const last = row.at(-1);
        if (last && last.style === cell.style) {
            last.text += cell.text;
        } else {
            row.push({ text: cell.text, style: cell.style });
        }
    }
    return row;
}

const cellsWidth = (cells: Cell[]) =>
    cells.reduce((sum, cell) => sum + cell.width, 0);

function wrapLine(cells: Cell[], limit: number): Row[] {
    const rows: Row[] = [];
    let row: Cell[] = [];
    let used = 0;
    for (const cell of cells) {
        if (used + cell.width <= limit) {
            row.push(cell);
            used += cell.width;
            continue;
        }
        if (cell.text === " ") {
            rows.push(toRow(row));
            row = [];
            used = 0;
            continue;
        }
        const space = row.findLastIndex((each) => each.text === " ");
        if (space > 0) {
            rows.push(toRow(row.slice(0, space)));
            row = row.slice(space + 1);
        } else if (row.length > 0) {
            rows.push(toRow(row));
            row = [];
        }
        row.push(cell);
        used = cellsWidth(row);
    }
    rows.push(toRow(row));
    return rows;
}

// Greedy word wrap over styled spans, measured in terminal columns. A row
// breaks at its last space, which is dropped (Ink would start the next row
// with it), or inside a word wider than the width.
export function wrapSpans(spans: Span[], width: number): Row[] {
    const limit = Math.max(1, width);
    return cellLines(spans).flatMap((cells) => wrapLine(cells, limit));
}

// Breaks one line by grapheme, keeping every character: for code, where
// spaces matter. Rows after the first get `rest` columns.
export function breakSpans(spans: Span[], first: number, rest: number): Row[] {
    const rows: Row[] = [];
    let row: Cell[] = [];
    let used = 0;
    for (const cell of cellLines(spans).flat()) {
        const limit = Math.max(1, rows.length === 0 ? first : rest);
        if (used + cell.width > limit && row.length > 0) {
            rows.push(toRow(row));
            row = [];
            used = 0;
        }
        row.push(cell);
        used += cell.width;
    }
    rows.push(toRow(row));
    return rows;
}

export function splitLines(spans: Span[]): Span[][] {
    const lines: Span[][] = [];
    let line: Span[] = [];
    lines.push(line);
    for (const span of spans) {
        span.text.split("\n").forEach((part, index) => {
            if (index > 0) {
                line = [];
                lines.push(line);
            }
            if (part !== "") {
                line.push({ text: part, style: span.style });
            }
        });
    }
    return lines;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/tui/markdown/spans.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Move wrapRows onto wrapSpans**

In `src/tui/LiveReply.tsx`, replace the body of `wrapRows` and its comment:

```ts
import { PLAIN, rowText, wrapSpans } from "./markdown/spans.js";

// Plain-text rows for the streaming reply, measured in terminal columns.
export function wrapRows(text: string, width: number): string[] {
    return wrapSpans([{ text, style: PLAIN }], width).map(rowText);
}
```

- [ ] **Step 7: Run the TUI tests**

Run: `bun test src/tui`
Expected: PASS, including the existing `wrapRows` and `LiveReply height`
tests unchanged.

- [ ] **Step 8: Commit**

```bash
bunx biome check --write src/tui/markdown src/tui/LiveReply.tsx
git add package.json bun.lock
git commit -m "build(tui): Add string-width"
git add src/tui/markdown/spans.ts src/tui/markdown/spans.test.ts src/tui/LiveReply.tsx
git commit -m "feat(tui): Wrap styled spans by terminal width"
```

---

### Task 2: Syntax highlighting

**Files:**

- Create: `src/tui/markdown/highlight.ts`
- Create: `src/tui/markdown/highlight.test.ts`
- Modify: `package.json`, `bun.lock`

**Interfaces:**

- Consumes: `Span`, `Style`, `PLAIN` from Task 1.
- Produces: `highlight(code: string, lang: string | undefined): Span[] | null`

- [ ] **Step 1: Add lowlight**

Run: `bun add lowlight@^3.3.0`
Expected: `"lowlight": "^3.3.0"` in `dependencies`.

- [ ] **Step 2: Write the failing tests**

Create `src/tui/markdown/highlight.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { highlight } from "./highlight.js";

describe("highlight", () => {
    it("colours keywords, strings and comments, keeping the text", () => {
        const spans = highlight("const x = 'a'; // c", "ts");
        expect(spans).toContainEqual({
            text: "const",
            style: { color: "magenta" },
        });
        expect(spans).toContainEqual({ text: "'a'", style: { color: "green" } });
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/tui/markdown/highlight.test.ts`
Expected: FAIL, `Cannot find module './highlight.js'`.

- [ ] **Step 4: Implement highlight.ts**

```ts
import { common, createLowlight } from "lowlight";
import { PLAIN, type Span, type Style } from "./spans.js";

const lowlight = createLowlight(common);

const MAGENTA: Style = { color: "magenta" };
const GREEN: Style = { color: "green" };
const YELLOW: Style = { color: "yellow" };
const DIM: Style = { dim: true };
const BLUE: Style = { color: "blue" };
const CYAN: Style = { color: "cyan" };

// The 16 ANSI colours, so code follows the terminal's own theme.
const COLOURS: Record<string, Style> = {
    keyword: MAGENTA,
    built_in: MAGENTA,
    type: MAGENTA,
    literal: MAGENTA,
    string: GREEN,
    regexp: GREEN,
    symbol: GREEN,
    number: YELLOW,
    comment: DIM,
    quote: DIM,
    title: BLUE,
    function: BLUE,
    class: BLUE,
    section: BLUE,
    attr: CYAN,
    attribute: CYAN,
    property: CYAN,
    variable: CYAN,
    params: CYAN,
};

// The parts of lowlight's hast tree this walks.
type Node = {
    type: string;
    value?: string;
    properties?: { className?: unknown };
    children?: Node[];
};

// "hljs-title function_" maps by its first known class; an element without
// one inherits its parent's colour.
function styleOf(className: unknown, inherited: Style): Style {
    if (!Array.isArray(className)) {
        return inherited;
    }
    for (const name of className) {
        const style =
            COLOURS[String(name).replace(/^hljs-/, "").replace(/_+$/, "")];
        if (style) {
            return style;
        }
    }
    return inherited;
}

function collect(node: Node, style: Style, spans: Span[]): void {
    if (node.type === "text") {
        spans.push({ text: node.value ?? "", style });
        return;
    }
    const own =
        node.type === "element"
            ? styleOf(node.properties?.className, style)
            : style;
    for (const child of node.children ?? []) {
        collect(child, own, spans);
    }
}

export function highlight(
    code: string,
    lang: string | undefined,
): Span[] | null {
    const name = lang?.trim().split(/\s+/)[0];
    if (!name || !lowlight.registered(name)) {
        return null;
    }
    const spans: Span[] = [];
    collect(lowlight.highlight(name, code) as unknown as Node, PLAIN, spans);
    return spans;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/tui/markdown/highlight.test.ts`
Expected: PASS, 4 tests. If the `function` test fails, print
`JSON.stringify(lowlight.highlight("js", "function f() {}"))` and check the
class name highlight.js gives `f`; map it in `COLOURS` rather than changing
the expectation.

- [ ] **Step 6: Commit**

```bash
bunx biome check --write src/tui/markdown
git add package.json bun.lock
git commit -m "build(tui): Add lowlight"
git add src/tui/markdown/highlight.ts src/tui/markdown/highlight.test.ts
git commit -m "feat(tui): Highlight code in ANSI colours"
```

---

### Task 3: Inline Markdown and simple blocks

**Files:**

- Create: `src/tui/markdown/render.ts`
- Create: `src/tui/markdown/render.test.ts`
- Modify: `package.json`, `bun.lock`

**Interfaces:**

- Consumes: Task 1's spans API, Task 2's `highlight`.
- Produces: `renderMarkdown(text: string, width: number): Row[]`,
  `decodeEntities(text: string): string`; internal `blocks`, `block`,
  `inline`, `withGutter` that Tasks 4 and 5 extend.

- [ ] **Step 1: Add marked**

Run: `bun add marked@^18.0.14`
Expected: `"marked": "^18.0.14"` in `dependencies`.

- [ ] **Step 2: Write the failing tests**

Create `src/tui/markdown/render.test.ts`:

```ts
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
        expect(md("---", 5)).toEqual([[{ text: "─────", style: { dim: true } }]]);
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/tui/markdown/render.test.ts`
Expected: FAIL, `Cannot find module './render.js'`.

- [ ] **Step 4: Implement render.ts**

```ts
import { type MarkedToken, marked, type Token } from "marked";
import { highlight } from "./highlight.js";
import {
    breakSpans,
    PLAIN,
    type Row,
    type Span,
    type Style,
    splitLines,
    wrapSpans,
} from "./spans.js";

const DIM: Style = { dim: true };
const GUTTER: Span = { text: "┃ ", style: DIM };
const CONTINUED: Span = { text: "↪ ", style: DIM };

const ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
};

// marked leaves text as written, so only entities the model typed need
// decoding; unknown names and invalid code points stay as they are.
export function decodeEntities(text: string): string {
    return text.replace(
        /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g,
        (match, name: string) => {
            if (!name.startsWith("#")) {
                return ENTITIES[name] ?? match;
            }
            const code =
                name[1] === "x" || name[1] === "X"
                    ? Number.parseInt(name.slice(2), 16)
                    : Number(name.slice(1));
            return code <= 0x10ffff ? String.fromCodePoint(code) : match;
        },
    );
}

function inline(tokens: Token[] | undefined, style: Style): Span[] {
    return (tokens ?? []).flatMap((token) =>
        inlineToken(token as MarkedToken, style),
    );
}

function inlineToken(token: MarkedToken, style: Style): Span[] {
    switch (token.type) {
        case "text":
            return token.tokens
                ? inline(token.tokens, style)
                : [
                      {
                          text: decodeEntities(token.text).replace(/\n/g, " "),
                          style,
                      },
                  ];
        case "strong":
            return inline(token.tokens, { ...style, bold: true });
        case "em":
            return inline(token.tokens, { ...style, italic: true });
        case "del":
            return inline(token.tokens, { ...style, strikethrough: true });
        case "codespan":
            return [{ text: token.text, style: { ...style, color: "cyan" } }];
        case "br":
            return [{ text: "\n", style }];
        case "escape":
            return [{ text: token.text, style }];
        case "link": {
            const text = inline(token.tokens, { ...style, underline: true });
            return token.text === token.href
                ? text
                : [...text, { text: ` (${token.href})`, style: { ...style, dim: true } }];
        }
        case "image":
            return [
                { text: `[image: ${token.text}]`, style },
                { text: ` (${token.href})`, style: { ...style, dim: true } },
            ];
        case "html":
            return [{ text: token.text, style }];
        case "checkbox":
            return [];
        default:
            return [{ text: decodeEntities(token.raw), style }];
    }
}

export function withGutter(rows: Row[], first: Span, rest: Span): Row[] {
    return rows.map((row, index) => [index === 0 ? first : rest, ...row]);
}

function codeBlock(
    code: string,
    lang: string | undefined,
    width: number,
): Row[] {
    const source = code.replace(/\t/g, "    ");
    const spans = highlight(source, lang) ?? [{ text: source, style: PLAIN }];
    const rows: Row[] = lang ? wrapSpans([{ text: lang, style: DIM }], width) : [];
    for (const line of splitLines(spans)) {
        breakSpans(line, width - 2, width - 4).forEach((row, index) => {
            rows.push(index === 0 ? [GUTTER, ...row] : [GUTTER, CONTINUED, ...row]);
        });
    }
    return rows;
}

function block(token: MarkedToken, width: number): Row[] {
    switch (token.type) {
        case "space":
        case "def":
        case "checkbox":
            return [];
        case "paragraph":
            return wrapSpans(inline(token.tokens, PLAIN), width);
        case "text":
            return wrapSpans(
                token.tokens
                    ? inline(token.tokens, PLAIN)
                    : [{ text: decodeEntities(token.text), style: PLAIN }],
                width,
            );
        case "heading":
            return wrapSpans(
                inline(token.tokens, {
                    bold: true,
                    ...(token.depth <= 2 ? { underline: true } : {}),
                }),
                width,
            );
        case "hr":
            return [[{ text: "─".repeat(Math.max(1, width)), style: DIM }]];
        case "code":
            return codeBlock(token.text, token.lang, width);
        case "html":
            return wrapSpans(
                [{ text: token.text.replace(/\n+$/, ""), style: PLAIN }],
                width,
            );
        default:
            return wrapSpans([{ text: token.raw.trimEnd(), style: PLAIN }], width);
    }
}

// Blocks are separated by one empty row; a tight list item's blocks are not.
function blocks(tokens: Token[], width: number, gap = true): Row[] {
    const rows: Row[] = [];
    for (const token of tokens) {
        const own = block(token as MarkedToken, width);
        if (own.length === 0) {
            continue;
        }
        if (gap && rows.length > 0) {
            rows.push([]);
        }
        rows.push(...own);
    }
    return rows;
}

export function renderMarkdown(text: string, width: number): Row[] {
    return blocks(marked.lexer(text, { gfm: true }), width);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/tui/markdown/render.test.ts`
Expected: PASS, 17 tests. `bunx tsc --noEmit -p .` is clean. If marked
types reject `token.lang` as possibly `undefined` on `Tokens.Code`, keep the
`string | undefined` parameter; if the `default` branch is typed `never`,
cast: `(token as { raw: string }).raw`.

- [ ] **Step 6: Commit**

```bash
bunx biome check --write src/tui/markdown
git add package.json bun.lock
git commit -m "build(tui): Add marked"
git add src/tui/markdown/render.ts src/tui/markdown/render.test.ts
git commit -m "feat(tui): Render inline Markdown and blocks"
```

---

### Task 4: Lists and quotes

**Files:**

- Modify: `src/tui/markdown/render.ts`
- Modify: `src/tui/markdown/render.test.ts`

**Interfaces:**

- Consumes: `blocks`, `withGutter`, `inline` from Task 3.
- Produces: `block` handles `list` and `blockquote`.

- [ ] **Step 1: Write the failing tests**

Append to `render.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/tui/markdown/render.test.ts`
Expected: the 7 new tests FAIL (lists and quotes print as raw text).

- [ ] **Step 3: Implement**

In `render.ts`, add `import stringWidth from "string-width";`, change the
marked import to `import { type MarkedToken, marked, type Token, type Tokens } from "marked";`,
add the quote gutter beside `GUTTER`:

```ts
const QUOTE: Span = { text: "│ ", style: DIM };
```

add `list` above `block`:

```ts
// Each item hangs its text under its first word; a nested list starts there.
function list(token: Tokens.List, width: number): Row[] {
    const start = token.start === "" ? 1 : token.start;
    const numbers = token.items.map((_, index) => `${start + index}.`);
    const numberWidth = Math.max(...numbers.map((number) => number.length));
    const rows: Row[] = [];
    token.items.forEach((item, index) => {
        const bullet = token.ordered
            ? (numbers[index] ?? "").padStart(numberWidth)
            : "•";
        const box = item.task ? (item.checked ? " ☑" : " ☐") : "";
        const marker = `${bullet}${box} `;
        const indent = stringWidth(marker);
        const body = blocks(item.tokens, width - indent, item.loose);
        if (item.loose && index > 0) {
            rows.push([]);
        }
        rows.push(
            ...withGutter(
                body.length > 0 ? body : [[]],
                { text: marker, style: PLAIN },
                { text: " ".repeat(indent), style: PLAIN },
            ),
        );
    });
    return rows;
}
```

and two cases in `block`, before `default`:

```ts
        case "blockquote":
            return withGutter(blocks(token.tokens, width - 2), QUOTE, QUOTE);
        case "list":
            return list(token, width);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/tui/markdown`
Expected: PASS, all render, spans and highlight tests.

- [ ] **Step 5: Commit**

```bash
bunx biome check --write src/tui/markdown
git add src/tui/markdown/render.ts src/tui/markdown/render.test.ts
git commit -m "feat(tui): Render Markdown lists and quotes"
```

---

### Task 5: Tables

**Files:**

- Modify: `src/tui/markdown/render.ts`
- Modify: `src/tui/markdown/render.test.ts`

**Interfaces:**

- Consumes: `inline`, `wrapSpans`, `rowWidth` (import it from `spans.js`).
- Produces: `fitColumns(natural: number[], room: number): number[] | null`;
  `block` handles `table`.

- [ ] **Step 1: Write the failing tests**

Change the test file's import to
`import { decodeEntities, fitColumns, renderMarkdown } from "./render.js";`
and append:

```ts
describe("fitColumns", () => {
    it("keeps natural widths that fit", () => {
        expect(fitColumns([3, 5], 20)).toEqual([3, 5]);
    });

    it("shrinks columns in proportion, to at least 3", () => {
        expect(fitColumns([10, 30], 20)).toEqual([5, 15]);
        expect(fitColumns([2, 40], 10)).toEqual([3, 7]);
    });

    it("gives up when 3 columns each cannot fit", () => {
        expect(fitColumns([5, 5, 5], 8)).toBeNull();
    });
});

describe("renderMarkdown tables", () => {
    const small = "| a | b |\n|:--|--:|\n| 1 | 22 |";

    it("draws a bordered table with an aligned, bold header", () => {
        const rows = md(small);
        expect(texts(rows)).toEqual([
            "┌───┬────┐",
            "│ a │  b │",
            "├───┼────┤",
            "│ 1 │ 22 │",
            "└───┴────┘",
        ]);
        expect(rows[1]).toContainEqual({ text: "a", style: { bold: true } });
    });

    it("wraps cells when the table is too wide", () => {
        const table = "| a | b |\n|---|---|\n| x | one two three |";
        expect(texts(md(table, 16))).toEqual([
            "┌─────┬────────┐",
            "│ a   │ b      │",
            "├─────┼────────┤",
            "│ x   │ one    │",
            "│     │ two    │",
            "│     │ three  │",
            "└─────┴────────┘",
        ]);
    });

    it("falls back to plain rows when even narrow columns cannot fit", () => {
        const table = "| a | b |\n|---|---|\n| x | one two three |";
        expect(texts(md(table, 6))).toEqual([
            "a │ b",
            "x │",
            "one",
            "two",
            "three",
        ]);
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/tui/markdown/render.test.ts`
Expected: FAIL, `fitColumns` is not exported; table tests print raw text.

- [ ] **Step 3: Implement**

Add `rowWidth` to the `spans.js` import, then add above `block`:

```ts
const MIN_COLUMN = 3;
const BORDER: Style = DIM;

export function fitColumns(natural: number[], room: number): number[] | null {
    const total = natural.reduce((sum, width) => sum + width, 0);
    if (total <= room) {
        return natural;
    }
    if (MIN_COLUMN * natural.length > room) {
        return null;
    }
    const widths = natural.map((width) =>
        Math.max(MIN_COLUMN, Math.floor((width * room) / total)),
    );
    let excess = widths.reduce((sum, width) => sum + width, 0) - room;
    while (excess > 0) {
        const widest = widths.indexOf(Math.max(...widths));
        widths[widest] = (widths[widest] ?? MIN_COLUMN) - 1;
        excess--;
    }
    return widths;
}

const naturalWidth = (spans: Span[]) =>
    Math.max(0, ...wrapSpans(spans, Number.MAX_SAFE_INTEGER).map(rowWidth));

type Align = Tokens.Table["align"][number];

function pad(row: Row, width: number, align: Align): Row {
    const space = Math.max(0, width - rowWidth(row));
    const before =
        align === "right"
            ? space
            : align === "center"
              ? Math.floor(space / 2)
              : 0;
    return [
        { text: " ".repeat(before), style: PLAIN },
        ...row,
        { text: " ".repeat(space - before), style: PLAIN },
    ];
}

function tableRow(cells: Span[][], widths: number[], align: Align[]): Row[] {
    const wrapped = widths.map((width, column) =>
        wrapSpans(cells[column] ?? [], width),
    );
    const height = Math.max(...wrapped.map((rows) => rows.length));
    const rows: Row[] = [];
    for (let line = 0; line < height; line++) {
        const row: Row = [{ text: "│ ", style: BORDER }];
        widths.forEach((width, column) => {
            if (column > 0) {
                row.push({ text: " │ ", style: BORDER });
            }
            row.push(
                ...pad(wrapped[column]?.[line] ?? [], width, align[column] ?? null),
            );
        });
        row.push({ text: " │", style: BORDER });
        rows.push(row);
    }
    return rows;
}

function plainTable(header: Span[][], body: Span[][][], width: number): Row[] {
    const separator: Span = { text: " │ ", style: BORDER };
    return [header, ...body].flatMap((cells) =>
        wrapSpans(
            cells.flatMap((spans, column) =>
                column === 0 ? spans : [separator, ...spans],
            ),
            width,
        ),
    );
}

// Borders and a space either side of each cell take 3 * columns + 1.
function table(token: Tokens.Table, width: number): Row[] {
    const header = token.header.map((cell) =>
        inline(cell.tokens, { bold: true }),
    );
    const body = token.rows.map((row) =>
        row.map((cell) => inline(cell.tokens, PLAIN)),
    );
    const natural = header.map((_, column) =>
        Math.max(
            1,
            ...[header, ...body].map((cells) => naturalWidth(cells[column] ?? [])),
        ),
    );
    const widths = fitColumns(natural, width - (3 * natural.length + 1));
    if (!widths) {
        return plainTable(header, body, width);
    }
    const border = (left: string, join: string, right: string): Row => [
        {
            text:
                left +
                widths.map((each) => "─".repeat(each + 2)).join(join) +
                right,
            style: BORDER,
        },
    ];
    return [
        border("┌", "┬", "┐"),
        ...tableRow(header, widths, token.align),
        border("├", "┼", "┤"),
        ...body.flatMap((cells) => tableRow(cells, widths, token.align)),
        border("└", "┴", "┘"),
    ];
}
```

and a case in `block`, before `default`:

```ts
        case "table":
            return table(token, width);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/tui/markdown`
Expected: PASS. Check by hand: in "wraps cells", room is `16 - 7 = 9`,
natural `[1, 13]`, proportional `[3, 8]` = 11, trimmed to `[3, 6]`.

- [ ] **Step 5: Commit**

```bash
bunx biome check --write src/tui/markdown
git add src/tui/markdown/render.ts src/tui/markdown/render.test.ts
git commit -m "feat(tui): Render Markdown tables"
```

---

### Task 6: Show rendered replies in History

**Files:**

- Create: `src/tui/Markdown.tsx`
- Modify: `src/tui/History.tsx` (`LineView`)
- Modify: `src/tui/markdown/render.test.ts` (corpus)
- Modify: `src/tui/components.test.tsx`
- Modify: `README.md`

**Interfaces:**

- Consumes: `renderMarkdown`, `wrapSpans`, `rowWidth`, `Row`, `Span`.
- Produces: `RowsView({ rows }: { rows: Row[] })`.

- [ ] **Step 1: Write the failing tests**

Append the corpus to `render.test.ts` (import `rowWidth` from `spans.js`):

```ts
// Replies from the first live test, plus the shapes most likely to overflow.
const CORPUS = [
    "Thanks for testing me! I can only speak to what I see from my side.\n\n- **Formatting:** ask for a list, a table, or a code snippet and see how it displays.\n- **Longer responses:** request something multi-paragraph.",
    "1. Tell me about the display. If the prompt says the output is a plain-text terminal with a narrow text column, I can skip markdown.\n\n2. Keep the prompt focused.",
    "| Option | Trade-off | Cost |\n|---|:-:|--:|\n| Subset | cheaper, but tables print raw | medium |\n| Full | everything renders, more dependencies | high |",
    "```ts\nconst total = items.reduce((sum, item) => sum + item.cost, 0); // a long line of code\n```",
    "See [the documentation](https://example.com/a/very/long/path/that/never/ends/and/keeps/going/on) or https://example.com/another/very/long/unbroken/address",
    "> - quoted list\n>   - nested in a quote\n>     1. deeper still with words that wrap around",
    "中文中文中文中文中文中文中文中文 👩‍💻👩‍💻👩‍💻👩‍💻👩‍💻👩‍💻👩‍💻👩‍💻👩‍💻👩‍💻 supercalifragilisticexpialidocious",
];

describe("renderMarkdown width", () => {
    it("never yields a row wider than the width", () => {
        for (const width of [20, 40, 91]) {
            for (const text of CORPUS) {
                for (const row of renderMarkdown(text, width)) {
                    expect([width, rowWidth(row)]).toEqual([
                        width,
                        Math.min(rowWidth(row), width),
                    ]);
                }
            }
        }
    });
});
```

In `components.test.tsx`, add to the `History and LiveReply` describe:

```ts
    it("renders a reply's Markdown, not its markers", () => {
        const { lastFrame } = render(
            <History
                lines={[
                    { id: 0, role: "you", text: "is **this** bold?" },
                    { id: 1, role: "dorothy", text: "Yes, **this** is." },
                ]}
            />,
        );
        expect(lastFrame()).toContain("is **this** bold?");
        expect(lastFrame()).toContain("Yes, this is.");
    });

    it("shows the label of an empty reply", () => {
        const { lastFrame } = render(
            <History
                lines={[{ id: 0, role: "dorothy", text: "", interrupted: true }]}
            />,
        );
        expect(lastFrame()).toContain("dorothy");
        expect(lastFrame()).toContain("[interrupted]");
    });
```

- [ ] **Step 2: Run them to verify the new History test fails**

Run: `bun test src/tui`
Expected: the corpus test PASSES already (the renderer is done; this pins
it); "renders a reply's Markdown" FAILS because the frame shows
`Yes, **this** is.`; the empty-reply test may pass.

- [ ] **Step 3: Implement RowsView**

Create `src/tui/Markdown.tsx`:

```tsx
import { Box, Text } from "ink";
import type { Row } from "./markdown/spans.js";

// One <Text> per row, already wrapped to the width; truncation is only a
// safety net. An empty row keeps its height with a space.
export function RowsView({ rows }: { rows: Row[] }) {
    return (
        <Box flexDirection="column">
            {(rows.length > 0 ? rows : [[]]).map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
                <Text key={index} wrap="truncate">
                    {row.length === 0
                        ? " "
                        : row.map((span, at) => (
                              <Text
                                  // biome-ignore lint/suspicious/noArrayIndexKey: spans are positional.
                                  key={at}
                                  bold={span.style.bold}
                                  italic={span.style.italic}
                                  underline={span.style.underline}
                                  strikethrough={span.style.strikethrough}
                                  dimColor={span.style.dim}
                                  color={span.style.color}
                              >
                                  {span.text}
                              </Text>
                          ))}
                </Text>
            ))}
        </Box>
    );
}
```

- [ ] **Step 4: Draw LineView through it**

In `src/tui/History.tsx`, replace the imports from `./LiveReply.js` with
`import { formatStats, LABEL_WIDTH } from "./LiveReply.js";`, add

```ts
import { RowsView } from "./Markdown.js";
import { renderMarkdown } from "./markdown/render.js";
import {
    PLAIN,
    type Row,
    rowWidth,
    type Span,
    wrapSpans,
} from "./markdown/spans.js";

const RED = { color: "red" };
const INTERRUPTED: Span = { text: " [interrupted]", style: PLAIN };

function rowsOf(line: Line, width: number): Row[] {
    const rows =
        line.role === "dorothy"
            ? renderMarkdown(line.text, width)
            : wrapSpans(
                  [{ text: line.text, style: line.role === "error" ? RED : PLAIN }],
                  width,
              );
    if (line.interrupted) {
        const last = rows.at(-1);
        if (last && rowWidth(last) + rowWidth([INTERRUPTED]) <= width) {
            last.push(INTERRUPTED);
        } else {
            rows.push([{ text: INTERRUPTED.text.trim(), style: PLAIN }]);
        }
    }
    return rows;
}
```

and in `LineView` replace the `text` computation and the text `<Text>` with:

```tsx
    const { columns } = useWindowSize();
    const rows = rowsOf(line, columns - LABEL_WIDTH);
```

```tsx
                <RowsView rows={rows} />
```

(the label `<Box width={LABEL_WIDTH} flexShrink={0}>` stays as it is).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test`
Expected: PASS, the whole suite, including the earlier width tests
("wraps finished lines to the terminal width", "starts no wrapped row with
the space it broke at") and `App`'s `Par [interrupted]` check.

- [ ] **Step 6: Document it**

In `README.md`, after the paragraph beginning "Enter sends", add:

```markdown
Replies stream as plain text, then render as Markdown once complete:
emphasis, lists, quotes, tables and code blocks, highlighted when labelled
with a language.
```

- [ ] **Step 7: Verify in a terminal**

Recreate the pty probe if `.superpowers/probe/driver.tsx` is gone (an `App`
with a fake session whose reply is the third `CORPUS` entry, run under
`uv run --with pyte` at 80 columns as in commit `0cc90b8`'s investigation)
and confirm the table draws with borders and no line exceeds 80 columns.
Expected: `lines wider than COLS: 0`.

- [ ] **Step 8: Commit**

```bash
bunx biome check --write src/tui README.md
git add src/tui/Markdown.tsx src/tui/History.tsx src/tui/markdown/render.test.ts src/tui/components.test.tsx
git commit -m "feat(tui): Render finished replies as Markdown"
git add README.md
git commit -m "docs: Mention Markdown replies"
```
