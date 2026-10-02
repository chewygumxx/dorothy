---
__cgxx: |
  # vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3:
  # SPDX-License-Identifier: GPL-3.0-only

  #
  #
  # ~chewygumxx/dorothy.git
  # ::: :/docs/specs/2026-10-03-markdown-replies-design.md
  #
  #

ctime: 2026-10-03
title: Markdown replies design
description: "Design spec for rendering Dorothy's Markdown replies in the TUI"
tags:
  - dorothy
  - tui
  - markdown
  - spec
---

# Markdown replies design

## Purpose

The first live test of the chat TUI showed Dorothy's Markdown printed raw:
literal `**` around bold text, `-` bullets and backticks. Dorothy writes
Markdown by habit, in the spirit of <https://claude.ai>, so the TUI renders it
rather than the prompt forbidding it.

Success:

- A finished reply shows bold, italics, code, lists, quotes, rules, links and
  tables as formatted terminal text, with no Markdown syntax left over.
- Labelled code blocks are syntax highlighted in the terminal's own colours.
- No rendered row is wider than the space beside the label column, at any
  terminal width, for any reply. A wider row wraps again in the terminal and
  breaks the layout (see the fixes of 2026-10-03, `b8c0c5a` and `0cc90b8`).

## Decisions

- **Full Markdown**, tables and links included, GFM on.
- **Plain while streaming.** `LiveReply` keeps showing the raw text as it
  arrives; the reply is rendered once the turn ends and it moves to `History`.
  Streaming, the live region's row budget (`fitLayout`) and `Conversation` do
  not change.
- **Our own renderer on `marked`'s lexer.** `marked` parses; our code turns
  tokens into rows of styled spans and Ink draws each row. Rows are computed by
  us rather than by Ink flex boxes, so table borders line up exactly and no row
  starts with the space Ink's wrapping breaks at.
- **Wide content wraps inside its block.** Table columns shrink and cells wrap;
  long code lines wrap with a continuation marker. Nothing is truncated except
  as Ink's last-resort safety net.
- **Syntax highlighting with `lowlight`** (highlight.js), synchronous, mapped to
  the 16 ANSI colours so it follows the terminal's theme. Only blocks with a
  language label lowlight knows are highlighted.
- Transcripts keep the raw Markdown; `--resume` renders it again.
- `you` and `error` lines stay plain text: the user's own asterisks are theirs.

## Units

### `src/tui/markdown/spans.ts`

```ts
type Style = {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    dim?: boolean;
    color?: string; // an Ink colour name
};
type Span = { text: string; style: Style };
type Row = Span[];

function wrapSpans(spans: Span[], width: number): Row[];
```

`wrapSpans` is a greedy word wrap over styled spans, measured with
`string-width`:

- It breaks at the last space that fits and drops that space.
- It hard-breaks a word wider than the width, by grapheme.
- It keeps `\n` as a row break and blank lines as empty rows.
- A row is never wider than `max(1, width)` columns.

`wrapRows(text, width)` in `LiveReply.tsx` becomes plain-text sugar over it,
which fixes the early wrap of emoji and CJK (they are two columns wide).

### `src/tui/markdown/render.ts`

```ts
function renderMarkdown(text: string, width: number): Row[];
```

Pure. `marked.lexer(text, { gfm: true })`, then one block renderer per token
type, each returning rows no wider than the width it is given. Nested blocks
(list items, quotes) render their children at the width left after their
gutter and prefix the gutter to each row.

### `src/tui/markdown/highlight.ts`

```ts
function highlight(code: string, lang: string | undefined): Row[] | null;
```

Uses `createLowlight(common)` and walks the hast tree to spans. It returns
`null` when the language is missing or unknown, and the code block falls back
to plain text. Class to colour:

| highlight.js classes                     | Colour  |
| ---------------------------------------- | ------- |
| `keyword`, `built_in`, `type`, `literal` | magenta |
| `string`, `regexp`, `symbol`             | green   |
| `number`                                 | yellow  |
| `comment`, `quote`                       | dim     |
| `title`, `function`, `class`, `section`  | blue    |
| `attr`, `attribute`, `property`, `variable`, `params` | cyan |
| anything else                            | default |

A nested class takes its own colour; one without a mapping inherits its
parent's.

### `src/tui/Markdown.tsx`

`<Markdown text width />` draws each row as one `<Text wrap="truncate">` with a
nested `<Text>` per span. `LineView` in `History.tsx` uses it for `dorothy`
lines with `width = columns - LABEL_WIDTH`, appending ` [interrupted]` as a
final dim span when the line is interrupted.

## Rendering rules

| Token          | Rendering                                                                              |
| -------------- | -------------------------------------------------------------------------------------- |
| Paragraph      | Inline spans, wrapped                                                                  |
| Heading        | Bold; levels 1 and 2 also underlined                                                   |
| Strong, em, del | Bold, italic, strikethrough                                                           |
| Inline code    | Cyan, backticks dropped                                                                |
| Code block     | Dim language label row if labelled, then each line behind a dim `┃ ` gutter; highlighted when the language is known; a wrapped line's continuation rows start with a dim `↪ ` |
| List           | `• ` or `N. ` with a hanging indent; nested lists 2 further in; task items `☐ ` / `☑ ` |
| Blockquote     | Children behind a dim `│ ` gutter                                                      |
| Rule           | `─` across the width, dim                                                              |
| Table          | Box-drawn borders, bold header row, cells aligned per the table's alignment row        |
| Link           | Text underlined, then dim ` (url)`, unless the text is the URL                         |
| Image          | `[image: alt]` then dim ` (url)`                                                       |
| HTML, unknown  | Raw text                                                                               |
| Line break     | Row break                                                                              |
| Escape, entity | The character it stands for                                                            |

Blocks are separated by one empty row; no leading or trailing empty rows.

### Table widths

Each column's natural width is its widest cell. Borders and one space of
padding either side of each cell take `3 * columns + 1`. If the natural widths
fit the rest, they are used. Otherwise each column shrinks in proportion to its
natural width, never below 3, and cells wrap within their column. A table that
cannot fit even at 3 per column renders as one plain row per table row, its
cells joined with ` │ `, wrapped like a paragraph.

## Testing

- `wrapSpans`: breaking at a space, dropping it, hard-breaking long words,
  styles kept across a break, emoji and CJK measured as two columns, blank
  lines kept.
- `renderMarkdown`: one case per row of the rendering rules table, asserting
  the rows' text and styles.
- `highlight`: a TypeScript snippet gets a magenta keyword and green string;
  an unknown or missing language returns `null`.
- Width property: a corpus (the replies from the first live test, a wide
  table, a long code line, nested lists, emoji, CJK) rendered at widths 20, 40
  and 91 never yields a row wider than the width.
- `History`: a bold reply reaches the frame without `**`; a `you` line keeps
  its asterisks.

## Out of scope

- Rendering while streaming.
- Clickable links (OSC 8), images, Mermaid or maths.
- A theme setting.
- Changing the system prompt.
