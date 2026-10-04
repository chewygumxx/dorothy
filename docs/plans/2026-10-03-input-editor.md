---
__cgxx: |
  # vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3:
  # SPDX-License-Identifier: GPL-3.0-only

  #
  #
  # ~chewygumxx/dorothy.git
  # ::: :/docs/plans/2026-10-03-input-editor.md
  #
  #

ctime: 2026-10-03
title: Input editor plan
description: "Implementation plan for the chat TUI's multi-line input editor"
tags:
  - dorothy
  - tui
  - plan
---

# Input Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-line `Input` with a multi-line editor: a cursor,
readline keys, Shift+Enter newlines, message recall, bracketed paste and
`$EDITOR`, usable while a reply streams.

**Architecture:** Pure `editor.ts` (draft edits, wrapped layout, cursor
movement) and `recall.ts` (message history) carry all behaviour; `Input.tsx`
maps Ink keys and pastes onto them and draws the visible rows; `App` owns the
draft, the quit keys, the row budget and Ctrl+G, which runs
`external-editor.ts` inside Ink's `suspendTerminal`.

**Tech Stack:** Bun 1.4, TypeScript 7, Ink 7 (`useInput`, `usePaste`,
`useApp().suspendTerminal`, `kittyKeyboard`), React 19, `string-width`,
`Intl.Segmenter`, `bun test` with `ink-testing-library`.

**Spec:** `docs/specs/2026-10-03-input-editor-design.md`

**Prerequisite:** the Markdown replies plan
(`docs/plans/2026-10-03-markdown-replies.md`) is complete:
`src/tui/markdown/spans.ts` exports `wrapSpans`, `rowText`, `graphemes` and
`PLAIN`, and `string-width` is a dependency.

## Amendments of 2026-10-04

Fixes landed on `main` after this plan was written (`76d583e` to `3b00d92`);
where a task disagrees, these win.

- **Row budget is done.** `fitLayout(rows, { showRaw, rawCount, warnings,
  inputRows })` takes the rows the input wants and returns
  `{ replyRows, rawRows, inputRows }`, the input's rows capped at
  `max(3, floor(rows / 3))` and by the room left. `STATUS_ROWS` is 2 and
  `warnings` is a count. Skip Task 5's layout steps; in App pass
  `inputRows: layoutDraft(draft, draftWidth(columns)).rows.length` and give
  `<Input>` `maxRows={layout.inputRows}` instead of `maxDraftRows(rows)`.
- **Typed newlines send.** Input uses `usePaste`, so a `\r` or `\n` inside a
  typed chunk is an Enter typed ahead, not pasted text: it submits at each
  newline and the rest becomes the draft. Keep that in Task 4 rather than
  inserting it through `cleanPaste`, and move the test "submits an Enter
  typed ahead in the same chunk" into `Input.test.tsx`. Shift+Enter arrives as
  its own escape sequence, never inside a chunk.
- **Closing.** Quitting sets status `closing`: `quit()` does nothing a second
  time and `submit` ignores messages. Task 4's `canSend` becomes
  `!state.streaming && state.status !== "closing"`.
- **State.** `ChatState` has `warnings: string[]` (the Header takes
  `warnings`) and `costUsd`; `initialState(history, warnings, costUsd)`.
- **SDK types.** The `sdk` event carries `RawMessage` from
  `conversation.ts`; `boundary.test.ts` fails on any Agent SDK import under
  `src/tui/`.
- Today's Input already windows a tall draft with an `↑` marker
  (`inputRows(value, columns)`), and App has the test "keeps a tall draft
  shorter than the window"; Task 4 replaces both with the editor's.

## Amendments of 2026-10-05

The statusline plan (`2026-10-05-statusline-and-minimum-size.md`) landed
first; where a task disagrees, these win.

- **The draft caps at 5 rows.** `fitLayout(rows, { showRaw, rawCount,
  warnings, statusRows, inputRows })` gives the input at most
  `INPUT_MAX_ROWS` (5, from `layout.ts`). Drop `maxDraftRows` from Task 2
  (its Produces line, its two test lines and its definition); Input's window
  is `maxRows={layout.inputRows}`.
- **The bottom box is warnings, input, statusline, header.** `Header` no
  longer takes `warnings`; `<Warnings>` and `<Statusline>` come from
  `Header.tsx`, and `App` computes `statusRows` with `moduleRows`. In App
  tests the input is `lines.at(-3)`, above the statusline and header.
- **App tests set the window.** `setup` calls `setSize(app, 100, 24)` and
  returns `resize`. Below 40 columns or `minRows` lines App draws only the
  Too Small message; Input is unmounted and only Ctrl+C and Ctrl+D act, so
  the editor's keys need no check for it.
- **History takes `replyStats`**, and resumed turns are `ResumedTurn`s that
  may carry `stats` and `chatCostUsd`.
- **App owns the editor's memory.** Input is unmounted while the window is
  too small, which would reset its kill buffer, goal column and recall
  state. Task 4 exports
  `type EditorMemory = { killed: string; goal: number | null; recall: Recall | null }`
  from `Input.tsx` and adds `memory: EditorMemory` to `InputProps`; Input
  reads and writes `memory.killed`, `memory.goal` and `memory.recall` where
  the plan has `killed.current`, `goal.current` and `recall.current`
  (`latest` stays Input's own ref). App keeps
  `const memory = useRef<EditorMemory>({ killed: "", goal: null, recall: null })`
  and passes `memory={memory.current}`; `Input.test.tsx` passes a fresh
  memory to each render. Task 4 adds the App test "keeps recall and the kill
  buffer through the Too Small screen": send "one", type "wip", press Up
  (`\u001B[A`), `resize(30, 10)`, `resize(100, 24)`, press Down
  (`\u001B[B`) and expect the draft `wip`; then Ctrl+U (`\u0015`),
  shrink, grow, Ctrl+Y (`\u0019`) and expect `wip` again.

## Global Constraints

- Shift+Enter is the only newline key; Enter sends; Ink renders with
  `kittyKeyboard: { mode: "auto" }`.
- No input row is wider than the terminal: the draft wraps at
  `columns - 3` (a 2-column gutter plus 1 column for a cursor drawn after a
  full row).
- The draft shows at most `max(3, floor(rows / 3))` rows.
- Ctrl+C: stop a reply; else clear a non-empty draft; else quit. Ctrl+D: quit
  on an empty draft; else delete forward.
- Key hints: `enter send · shift+enter newline · ctrl+g editor · esc stop · ctrl+r raw · ctrl+c quit`.
- `$EDITOR` order: `$VISUAL`, then `$EDITOR`, then `vi`, run as
  `sh -c '<editor> "$1"' sh <file>`; the file is `draft.md` in a fresh
  `mkdtemp` directory, mode `0600`, removed afterwards.
- Commit headers at most 50 characters, body lines at most 72, scope `tui`;
  `bunx biome check --write` on changed files before each commit; no em
  dashes; every new source file starts with the repository header comment
  (copy it from `src/tui/layout.ts`, changing the `::: :/` path line).

## Review Focus

- A paste containing escape sequences or other control characters: expect
  them stripped, never inserted. Test in Task 4.
- A terminal without the kitty protocol: Shift+Enter arrives as Enter and
  sends; expect the draft sent, not lost or duplicated. Test in Task 4
  (plain `\r`).
- Resizing narrower with a long draft: layout is recomputed from the current
  width on every render; expect no row wider than the new width. Test in
  Task 4 (width sweep at two widths via `draftWidth`).
- Up in a multi-line recalled message: expect row movement before older
  messages. Test in Task 4.
- Ctrl+G pressed twice quickly, or while the editor is already open: expect
  one editor. Test in Task 6.

## Plan-level decisions (refining the spec)

- `App` owns the `Draft` state (its Ctrl+C, Ctrl+D and Ctrl+G need it);
  `Input` owns the kill buffer, goal column and recall state, in refs.
- `DraftLayout.rows` are `{ text, start }` rows (`start` is the source offset
  of the row's first character), which up and down need to map a column back
  to an offset.
- `editDraft` returns `EditResult` (`{ ok: true, text }` or
  `{ ok: false, message }`) rather than `string | null`, so the warning text
  comes from where the failure is known.
- The draft window keeps the cursor on its bottom row when the draft is
  taller than the window (stateless scrolling).

## File map

- Create `src/tui/editor.ts`, `src/tui/editor.test.ts`: drafts, edits,
  layout, vertical movement, window.
- Create `src/tui/recall.ts`, `src/tui/recall.test.ts`: message recall.
- Create `src/tui/external-editor.ts`, `src/tui/external-editor.test.ts`:
  `$EDITOR`.
- Create `src/tui/Input.test.tsx`; rewrite `src/tui/Input.tsx`.
- Modify `src/tui/App.tsx`, `src/tui/App.test.tsx`, `src/tui/layout.ts`,
  `src/tui/layout.test.ts`, `src/tui/run.tsx`, `src/tui/components.test.tsx`
  (its `Input` tests move to `Input.test.tsx`), `README.md`.

---

### Task 1: Draft edits

**Files:**

- Create: `src/tui/editor.ts`
- Create: `src/tui/editor.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `type Draft = { text: string; cursor: number }`, `EMPTY_DRAFT: Draft`
  - `type Kill = { draft: Draft; killed: string }`
  - `insert(draft: Draft, text: string): Draft`
  - `backspace`, `deleteForward`, `left`, `right`, `wordLeft`, `wordRight`,
    `lineStart`, `lineEnd`: `(draft: Draft) => Draft`
  - `killLineEnd`, `killLineStart`, `killWordBack`: `(draft: Draft) => Kill`

- [ ] **Step 1: Write the failing tests**

Create `src/tui/editor.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/tui/editor.test.ts`
Expected: FAIL, `Cannot find module './editor.js'`.

- [ ] **Step 3: Implement**

Create `src/tui/editor.ts`:

```ts
// A draft is its text and a cursor, a UTF-16 offset that always sits on a
// grapheme boundary. Every edit is a pure function of a draft.
export type Draft = { text: string; cursor: number };
export type Kill = { draft: Draft; killed: string };

export const EMPTY_DRAFT: Draft = { text: "", cursor: 0 };

const segmenter = new Intl.Segmenter();

function boundaries(text: string): number[] {
    const offsets = Array.from(segmenter.segment(text), (part) => part.index);
    offsets.push(text.length);
    return offsets;
}

function previousBoundary(text: string, offset: number): number {
    let previous = 0;
    for (const boundary of boundaries(text)) {
        if (boundary >= offset) {
            break;
        }
        previous = boundary;
    }
    return previous;
}

const nextBoundary = (text: string, offset: number): number =>
    boundaries(text).find((boundary) => boundary > offset) ?? text.length;

const isSpace = (char: string | undefined) => char !== undefined && /\s/.test(char);

export function insert(draft: Draft, text: string): Draft {
    return {
        text: draft.text.slice(0, draft.cursor) + text + draft.text.slice(draft.cursor),
        cursor: draft.cursor + text.length,
    };
}

function cut(draft: Draft, from: number, to: number): Kill {
    return {
        draft: {
            text: draft.text.slice(0, from) + draft.text.slice(to),
            cursor: from,
        },
        killed: draft.text.slice(from, to),
    };
}

export const backspace = (draft: Draft): Draft =>
    cut(draft, previousBoundary(draft.text, draft.cursor), draft.cursor).draft;

export const deleteForward = (draft: Draft): Draft =>
    cut(draft, draft.cursor, nextBoundary(draft.text, draft.cursor)).draft;

export const left = (draft: Draft): Draft => ({
    ...draft,
    cursor: previousBoundary(draft.text, draft.cursor),
});

export const right = (draft: Draft): Draft => ({
    ...draft,
    cursor: nextBoundary(draft.text, draft.cursor),
});

export function wordLeft(draft: Draft): Draft {
    let cursor = draft.cursor;
    while (cursor > 0 && isSpace(draft.text[cursor - 1])) {
        cursor--;
    }
    while (cursor > 0 && !isSpace(draft.text[cursor - 1])) {
        cursor--;
    }
    return { ...draft, cursor };
}

export function wordRight(draft: Draft): Draft {
    let cursor = draft.cursor;
    while (cursor < draft.text.length && isSpace(draft.text[cursor])) {
        cursor++;
    }
    while (cursor < draft.text.length && !isSpace(draft.text[cursor])) {
        cursor++;
    }
    return { ...draft, cursor };
}

export const lineStart = (draft: Draft): Draft => ({
    ...draft,
    cursor: draft.text.lastIndexOf("\n", draft.cursor - 1) + 1,
});

export function lineEnd(draft: Draft): Draft {
    const newline = draft.text.indexOf("\n", draft.cursor);
    return { ...draft, cursor: newline === -1 ? draft.text.length : newline };
}

// At the end of a line with nothing after it, the newline itself goes.
export function killLineEnd(draft: Draft): Kill {
    const end = lineEnd(draft).cursor;
    return cut(
        draft,
        draft.cursor,
        end === draft.cursor && end < draft.text.length ? end + 1 : end,
    );
}

export const killLineStart = (draft: Draft): Kill =>
    cut(draft, lineStart(draft).cursor, draft.cursor);

export const killWordBack = (draft: Draft): Kill =>
    cut(draft, wordLeft(draft).cursor, draft.cursor);
```

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test src/tui/editor.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
bunx biome check --write src/tui/editor.ts src/tui/editor.test.ts
git add src/tui/editor.ts src/tui/editor.test.ts
git commit -m "feat(tui): Add pure draft edits"
```

---

### Task 2: Draft layout, vertical movement and window

**Files:**

- Modify: `src/tui/editor.ts`
- Modify: `src/tui/editor.test.ts`

**Interfaces:**

- Consumes: `wrapSpans`, `rowText`, `graphemes`, `PLAIN` from
  `./markdown/spans.js`; `Draft` from Task 1.
- Produces:
  - `type DraftRow = { text: string; start: number }`
  - `type DraftLayout = { rows: DraftRow[]; cursorRow: number; cursorColumn: number }`
  - `layoutDraft(draft: Draft, width: number): DraftLayout`
  - `offsetAt(row: DraftRow, column: number): number`
  - `up`, `down`: `(draft: Draft, width: number, column?: number) => Draft | null`
  - `draftWindow(layout: DraftLayout, maxRows: number): { first: number; last: number }`
  - `maxDraftRows(rows: number): number`

- [ ] **Step 1: Write the failing tests**

Add `down, draftWindow, layoutDraft, maxDraftRows, up` to the test's import
from `./editor.js` and append:

```ts
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

    it("allows a third of the window, at least 3 rows", () => {
        expect(maxDraftRows(24)).toBe(8);
        expect(maxDraftRows(6)).toBe(3);
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/tui/editor.test.ts`
Expected: FAIL, `layoutDraft` (and the others) not exported.

- [ ] **Step 3: Implement**

Add to the top of `src/tui/editor.ts`:

```ts
import stringWidth from "string-width";
import { graphemes, PLAIN, rowText, wrapSpans } from "./markdown/spans.js";
```

and append:

```ts
export type DraftRow = { text: string; start: number };
export type DraftLayout = {
    rows: DraftRow[];
    cursorRow: number;
    cursorColumn: number;
};

// Wraps each logical line as the transcript is wrapped (wrapSpans drops the
// one space it breaks at), keeping each row's offset into the draft. A cursor
// on a dropped space shows at the end of the row before it.
export function layoutDraft(draft: Draft, width: number): DraftLayout {
    const rows: DraftRow[] = [];
    let cursorRow = 0;
    let cursorColumn = 0;
    let lineOffset = 0;
    for (const line of draft.text.split("\n")) {
        const wrapped = wrapSpans([{ text: line, style: PLAIN }], width).map(
            rowText,
        );
        let start = 0;
        wrapped.forEach((text, index) => {
            const end = start + text.length;
            const next =
                index === wrapped.length - 1
                    ? line.length + 1
                    : end + (line[end] === " " ? 1 : 0);
            const cursor = draft.cursor - lineOffset;
            if (cursor >= start && cursor < next) {
                cursorRow = rows.length;
                cursorColumn = stringWidth(
                    text.slice(0, Math.min(cursor - start, text.length)),
                );
            }
            rows.push({ text, start: lineOffset + start });
            start = next;
        });
        lineOffset += line.length + 1;
    }
    return { rows, cursorRow, cursorColumn };
}

// The offset of the grapheme at a display column, or the row's end.
export function offsetAt(row: DraftRow, column: number): number {
    let used = 0;
    let offset = 0;
    for (const grapheme of graphemes(row.text)) {
        const width = stringWidth(grapheme);
        if (used + width > column) {
            break;
        }
        used += width;
        offset += grapheme.length;
    }
    return row.start + offset;
}

function vertical(
    draft: Draft,
    width: number,
    step: number,
    column: number | undefined,
): Draft | null {
    const layout = layoutDraft(draft, width);
    const row = layout.rows[layout.cursorRow + step];
    if (!row) {
        return null;
    }
    return { ...draft, cursor: offsetAt(row, column ?? layout.cursorColumn) };
}

export const up = (draft: Draft, width: number, column?: number) =>
    vertical(draft, width, -1, column);

export const down = (draft: Draft, width: number, column?: number) =>
    vertical(draft, width, 1, column);

// A draft taller than the window shows the rows ending at the cursor's.
export function draftWindow(
    layout: DraftLayout,
    maxRows: number,
): { first: number; last: number } {
    const count = Math.min(layout.rows.length, maxRows);
    const first = Math.min(
        Math.max(0, layout.cursorRow - count + 1),
        layout.rows.length - count,
    );
    return { first, last: first + count };
}

export const maxDraftRows = (rows: number): number =>
    Math.max(3, Math.floor(rows / 3));
```

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test src/tui/editor.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
bunx biome check --write src/tui/editor.ts src/tui/editor.test.ts
git add src/tui/editor.ts src/tui/editor.test.ts
git commit -m "feat(tui): Lay out drafts and move by row"
```

---

### Task 3: Message recall

**Files:**

- Create: `src/tui/recall.ts`
- Create: `src/tui/recall.test.ts`

**Interfaces:**

- Produces:
  - `type Recall = { messages: string[]; index: number | null; saved: string }`
  - `startRecall(messages: readonly string[]): Recall`
  - `older(recall: Recall, draft: string): { recall: Recall; text: string } | null`
  - `newer(recall: Recall): { recall: Recall; text: string } | null`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "bun:test";
import { newer, older, type Recall, startRecall } from "./recall.js";

// Walks older() until it stops, collecting what each step shows.
function walkOlder(recall: Recall, draft: string) {
    const shown: string[] = [];
    let current = recall;
    for (let step = older(current, draft); step; step = older(current, draft)) {
        shown.push(step.text);
        current = step.recall;
    }
    return { shown, recall: current };
}

describe("recall", () => {
    it("walks back from the newest message, collapsing repeats", () => {
        const { shown } = walkOlder(
            startRecall(["one", "two", "two", "three"]),
            "draft",
        );
        expect(shown).toEqual(["three", "two", "one"]);
    });

    it("walks forward again and restores the unsent draft", () => {
        const { recall } = walkOlder(startRecall(["one", "two"]), "wip");
        const first = newer(recall);
        expect(first?.text).toBe("two");
        const back = newer(first?.recall ?? recall);
        expect(back?.text).toBe("wip");
        expect(back?.recall.index).toBeNull();
        expect(newer(back?.recall ?? recall)).toBeNull();
    });

    it("has nothing to recall without messages", () => {
        expect(older(startRecall([]), "x")).toBeNull();
        expect(newer(startRecall(["a"]))).toBeNull();
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/tui/recall.test.ts`
Expected: FAIL, `Cannot find module './recall.js'`.

- [ ] **Step 3: Implement**

```ts
// The user's earlier messages, oldest first, walked newest first. The draft
// being written when recall starts is kept to come back to.
export type Recall = { messages: string[]; index: number | null; saved: string };

export function startRecall(messages: readonly string[]): Recall {
    return {
        messages: messages.filter(
            (message, index) => message !== messages[index - 1],
        ),
        index: null,
        saved: "",
    };
}

export function older(
    recall: Recall,
    draft: string,
): { recall: Recall; text: string } | null {
    const index =
        recall.index === null ? recall.messages.length - 1 : recall.index - 1;
    const text = recall.messages[index];
    if (text === undefined) {
        return null;
    }
    return {
        recall: {
            ...recall,
            index,
            saved: recall.index === null ? draft : recall.saved,
        },
        text,
    };
}

export function newer(recall: Recall): { recall: Recall; text: string } | null {
    if (recall.index === null) {
        return null;
    }
    const index = recall.index + 1;
    if (index >= recall.messages.length) {
        return { recall: { ...recall, index: null }, text: recall.saved };
    }
    return { recall: { ...recall, index }, text: recall.messages[index] ?? "" };
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test src/tui/recall.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
bunx biome check --write src/tui/recall.ts src/tui/recall.test.ts
git add src/tui/recall.ts src/tui/recall.test.ts
git commit -m "feat(tui): Add message recall"
```

---

### Task 4: The editor component

**Files:**

- Create: `src/tui/Input.test.tsx`
- Rewrite: `src/tui/Input.tsx`
- Modify: `src/tui/components.test.tsx` (remove its `Input` describe, its
  `Harness`, and the `Input`/`KEY_HINTS`/`useState` imports if now unused)
- Modify: `src/tui/App.tsx` (draft state and new `Input` props)
- Modify: `src/tui/App.test.tsx` (composing during a reply)

**Interfaces:**

- Consumes: Tasks 1 to 3; `graphemes` from `./markdown/spans.js`.
- Produces:
  - `KEY_HINTS: string`, `PROMPT_WIDTH = 2`
  - `draftWidth(columns: number): number` (`max(1, columns - 3)`)
  - `cleanPaste(text: string): string`
  - `type InputProps = { draft: Draft; messages: readonly string[]; canSend: boolean; maxRows: number; onChange(draft: Draft): void; onSubmit(text: string): void }`
  - `Input(props: InputProps)`

- [ ] **Step 1: Write the failing tests**

Create `src/tui/Input.test.tsx`:

```tsx
import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { useState } from "react";
import { type Draft, EMPTY_DRAFT } from "./editor.js";
import { cleanPaste, Input, KEY_HINTS } from "./Input.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const COLUMNS = 100;
const widest = (frame = "") =>
    Math.max(...frame.split("\n").map((line) => Array.from(line).length));

function Harness({
    canSend = true,
    messages = [],
    maxRows = 5,
    submitted,
}: {
    canSend?: boolean;
    messages?: string[];
    maxRows?: number;
    submitted: string[];
}) {
    const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
    return (
        <Input
            draft={draft}
            messages={messages}
            canSend={canSend}
            maxRows={maxRows}
            onChange={setDraft}
            onSubmit={(text) => {
                submitted.push(text);
                setDraft(EMPTY_DRAFT);
            }}
        />
    );
}

function setup(props: Partial<Parameters<typeof Harness>[0]> = {}) {
    const submitted: string[] = [];
    const app = render(<Harness submitted={submitted} {...props} />);
    const keys = async (...chunks: string[]) => {
        for (const chunk of chunks) {
            app.stdin.write(chunk);
            await tick();
        }
    };
    return { app, submitted, keys, frame: () => app.lastFrame() ?? "" };
}

const LEFT = "\u001B[D";
const UP = "\u001B[A";
const DOWN = "\u001B[B";
const SHIFT_ENTER = "\u001B[13;2u";

describe("Input", () => {
    it("edits and submits", async () => {
        const { keys, frame, submitted } = setup();
        await keys("hi");
        expect(frame()).toContain("› hi▏");
        await keys("\u007F", "\r");
        expect(submitted).toEqual(["h"]);
    });

    it("shows the key hints only while empty", async () => {
        const { keys, frame } = setup();
        expect(frame()).toContain(KEY_HINTS.slice(0, 40));
        await keys("x");
        expect(frame()).not.toContain("enter send");
    });

    it("inserts a newline on Shift+Enter and sends on Enter", async () => {
        const { keys, frame, submitted } = setup();
        await keys("a", SHIFT_ENTER, "b");
        expect(frame()).toContain("› a\n  b▏");
        await keys("\r");
        expect(submitted).toEqual(["a\nb"]);
    });

    it("keeps the draft when it cannot send", async () => {
        const { keys, frame, submitted } = setup({ canSend: false });
        await keys("hi", "\r");
        expect(submitted).toEqual([]);
        expect(frame()).toContain("› hi▏");
    });

    it("moves the cursor and inserts there", async () => {
        const { keys, frame } = setup();
        await keys("abc", LEFT, LEFT, "X");
        expect(frame()).toContain("› aXbc");
        await keys("\u001B[H", "<", "\u001B[F", ">");
        expect(frame()).toContain("› <aXbc>▏");
    });

    it("moves by words and to line ends with readline keys", async () => {
        const { keys, frame } = setup();
        await keys("one two", "\u0001", "[", "\u0005", "]");
        expect(frame()).toContain("› [one two]▏");
        await keys("\u001Bb", "_");
        expect(frame()).toContain("› [one _two]");
        await keys("\u001B[1;5D", "^", "\u0002", "\u0006", "\u0006");
        expect(frame()).toContain("› [one ^_two]");
    });

    it("kills and yanks", async () => {
        const { keys, frame } = setup();
        await keys("one two", "\u0017");
        expect(frame()).toContain("› one ▏");
        await keys("\u0019");
        expect(frame()).toContain("› one two▏");
        await keys("\u001B\u007F");
        expect(frame()).toContain("› one ▏");
        await keys("\u0001", "\u000B");
        expect(frame()).toContain(KEY_HINTS.slice(0, 20));
        await keys("ab", LEFT, "\u0015");
        expect(frame()).toContain("› b");
    });

    it("deletes forward with Delete and Ctrl+D", async () => {
        const { keys, frame } = setup();
        await keys("abc", LEFT, LEFT, "\u001B[3~");
        expect(frame()).toContain("› ac");
        await keys("\u0004");
        expect(frame()).toContain("› a▏");
    });

    it("applies every key of a single chunk", async () => {
        const { keys, frame } = setup();
        await keys("hello\u007F\u007F\u007F");
        expect(frame()).toContain("› he▏");
    });

    it("removes a whole composite emoji on backspace", async () => {
        const { keys, frame } = setup();
        await keys("a👩‍💻", "\u007F");
        expect(frame()).toContain("› a▏");
    });

    it("pastes as one edit, with newlines and without control characters", async () => {
        const { keys, frame, submitted } = setup();
        await keys("\u001B[200~one\r\ntwo\tthree\u001B[2J\u001B[201~");
        expect(frame()).toContain("› one\n  two    three[2J▏");
        expect(submitted).toEqual([]);
        expect(cleanPaste("a\rb\u0007")).toBe("a\nb");
    });

    it("recalls earlier messages past the first row, restoring the draft", async () => {
        const { keys, frame } = setup({ messages: ["first", "second"] });
        await keys("wip", UP);
        expect(frame()).toContain("› second▏");
        await keys(UP);
        expect(frame()).toContain("› first▏");
        await keys(DOWN, DOWN);
        expect(frame()).toContain("› wip▏");
    });

    it("moves between rows of a draft before recalling", async () => {
        const { keys, submitted } = setup({ messages: ["old"] });
        await keys("ab", SHIFT_ENTER, "c", UP, "X", "\r");
        expect(submitted).toEqual(["aXb\nc"]);
    });

    it("scrolls a tall draft, marking hidden rows", async () => {
        const { keys, frame } = setup({ maxRows: 3 });
        const lines = Array.from({ length: 6 }, (_, index) => `l${index}`);
        await keys(lines.join(SHIFT_ENTER));
        expect(frame()).toContain("↑ l3\n  l4\n  l5▏");
        await keys(UP, UP, UP, UP, UP);
        expect(frame()).toContain("› l0▏\n  l1\n↓ l2");
    });

    it("stays within the terminal width at every length and cursor", () => {
        const text = "lorem ipsum dolor ".repeat(12);
        const props = {
            messages: [],
            canSend: true,
            maxRows: 50,
            onChange() {},
            onSubmit() {},
        };
        const { rerender, lastFrame } = render(
            <Input draft={EMPTY_DRAFT} {...props} />,
        );
        for (let length = 0; length <= text.length; length += 7) {
            for (const cursor of [0, Math.floor(length / 2), length]) {
                rerender(
                    <Input
                        draft={{ text: text.slice(0, length), cursor }}
                        {...props}
                    />,
                );
                expect([length, cursor, widest(lastFrame())]).toEqual([
                    length,
                    cursor,
                    Math.min(widest(lastFrame()), COLUMNS),
                ]);
            }
        }
    });
});
```

In `src/tui/App.test.tsx`, replace the test
"ignores typing and Enter while a reply streams" with:

```tsx
    it("keeps composing while a reply streams, and sends after", async () => {
        const { app, session, type } = setup();
        await tick();
        await type("a");
        await type("\r");
        await type("b");
        await type("\r");
        expect(session().sent).toEqual(["a"]);
        expect(app.lastFrame()).toContain("› b▏");
        session().emit({
            type: "turn-end",
            reply: "ok",
            interrupted: false,
            stats,
        });
        await tick();
        await type("\r");
        expect(session().sent).toEqual(["a", "b"]);
    });

    it("recalls earlier messages, resumed ones included", async () => {
        const { app, type } = setup({
            history: [
                { role: "user", text: "earlier" },
                { role: "assistant", text: "yes" },
            ],
        });
        await tick();
        await type("\u001B[A");
        expect(app.lastFrame()).toContain("› earlier▏");
    });
```

Delete the `Input` describe block and the `Harness` function from
`src/tui/components.test.tsx`, and the imports they alone used.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/tui/Input.test.tsx src/tui/App.test.tsx`
Expected: FAIL; `Input` has no `draft` prop, `cleanPaste` is not exported,
and `App` still disables the input while streaming.

- [ ] **Step 3: Rewrite Input.tsx**

```tsx
import { Box, Text, useInput, usePaste, useWindowSize } from "ink";
import { type ReactNode, useRef } from "react";
import {
    backspace,
    type Draft,
    type DraftRow,
    deleteForward,
    down,
    draftWindow,
    insert,
    type Kill,
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
import { graphemes } from "./markdown/spans.js";
import { newer, older, type Recall, startRecall } from "./recall.js";

export type InputProps = {
    draft: Draft;
    messages: readonly string[];
    canSend: boolean;
    maxRows: number;
    onChange(draft: Draft): void;
    onSubmit(text: string): void;
};

export const KEY_HINTS =
    "enter send · shift+enter newline · ctrl+g editor · esc stop · ctrl+r raw · ctrl+c quit";
export const PROMPT_WIDTH = 2;

// Every row must fit the terminal (a row that wraps there takes a row Ink
// does not count), so the draft wraps one column short of the space beside
// the gutter, leaving room for a cursor drawn after a full row.
export const draftWidth = (columns: number): number =>
    Math.max(1, columns - PROMPT_WIDTH - 1);

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

export const cleanPaste = (text: string): string =>
    text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(CONTROLS, "");

function withCursor(row: DraftRow, cursor: number): ReactNode {
    const offset = Math.min(Math.max(cursor - row.start, 0), row.text.length);
    const [at, ...after] = graphemes(row.text.slice(offset));
    return (
        <>
            {row.text.slice(0, offset)}
            {at === undefined ? "▏" : <Text inverse>{at}</Text>}
            {after.join("")}
        </>
    );
}

export function Input({
    draft,
    messages,
    canSend,
    maxRows,
    onChange,
    onSubmit,
}: InputProps) {
    const { columns } = useWindowSize();
    const width = draftWidth(columns);
    // Ink splits one stdin chunk into several events before React re-renders,
    // so each edit builds on the last one here rather than on the prop.
    const latest = useRef(draft);
    latest.current = draft;
    const killed = useRef("");
    const goal = useRef<number | null>(null);
    const recall = useRef<Recall | null>(null);

    const change = (next: Draft, keepRecall = false) => {
        goal.current = null;
        if (!keepRecall) {
            recall.current = null;
        }
        latest.current = next;
        onChange(next);
    };
    const kill = ({ draft: next, killed: text }: Kill) => {
        if (text !== "") {
            killed.current = text;
        }
        change(next);
    };

    // Rows first; past the first or last row, the message history.
    const vertical = (direction: "up" | "down") => {
        const current = latest.current;
        const column = goal.current ?? layoutDraft(current, width).cursorColumn;
        const moved = (direction === "up" ? up : down)(current, width, column);
        if (moved) {
            latest.current = moved;
            onChange(moved);
            goal.current = column;
            return;
        }
        recall.current ??= startRecall(messages);
        const step =
            direction === "up"
                ? older(recall.current, current.text)
                : newer(recall.current);
        if (step) {
            recall.current = step.recall;
            change({ text: step.text, cursor: step.text.length }, true);
        }
    };

    const ctrl: Record<string, (current: Draft) => void> = {
        a: (current) => change(lineStart(current)),
        e: (current) => change(lineEnd(current)),
        b: (current) => change(left(current)),
        f: (current) => change(right(current)),
        w: (current) => kill(killWordBack(current)),
        u: (current) => kill(killLineStart(current)),
        k: (current) => kill(killLineEnd(current)),
        y: (current) => change(insert(current, killed.current)),
        // On an empty draft App quits instead.
        d: (current) => {
            if (current.text !== "") {
                change(deleteForward(current));
            }
        },
    };

    useInput((input, key) => {
        const current = latest.current;
        if (key.return) {
            if (key.shift) {
                change(insert(current, "\n"));
            } else if (canSend) {
                recall.current = null;
                onSubmit(current.text);
            }
        } else if (key.upArrow) {
            vertical("up");
        } else if (key.downArrow) {
            vertical("down");
        } else if (key.leftArrow) {
            change(key.ctrl || key.meta ? wordLeft(current) : left(current));
        } else if (key.rightArrow) {
            change(key.ctrl || key.meta ? wordRight(current) : right(current));
        } else if (key.home) {
            change(lineStart(current));
        } else if (key.end) {
            change(lineEnd(current));
        } else if (key.backspace) {
            if (key.meta) {
                kill(killWordBack(current));
            } else {
                change(backspace(current));
            }
        } else if (key.delete) {
            change(deleteForward(current));
        } else if (key.ctrl) {
            ctrl[input]?.(current);
        } else if (key.meta) {
            if (input === "b") {
                change(wordLeft(current));
            } else if (input === "f") {
                change(wordRight(current));
            }
        } else if (!key.escape && !key.tab && input) {
            change(insert(current, cleanPaste(input)));
        }
    });

    usePaste((text) => {
        change(insert(latest.current, cleanPaste(text)));
    });

    if (draft.text === "") {
        // The hints, right-aligned by padding, are cut short rather than
        // wrapped.
        const pad = Math.max(1, width - KEY_HINTS.length);
        return (
            <Box>
                <Box width={PROMPT_WIDTH} flexShrink={0}>
                    <Text>›</Text>
                </Box>
                <Text wrap="truncate">
                    ▏{" ".repeat(pad)}
                    <Text dimColor>{KEY_HINTS}</Text>
                </Text>
            </Box>
        );
    }

    const layout = layoutDraft(draft, width);
    const { first, last } = draftWindow(layout, maxRows);
    return (
        <Box flexDirection="column">
            {layout.rows.slice(first, last).map((row, offset) => {
                const index = first + offset;
                const gutter =
                    index === first && first > 0
                        ? "↑"
                        : index === last - 1 && last < layout.rows.length
                          ? "↓"
                          : index === 0
                            ? "›"
                            : "";
                return (
                    <Box key={row.start}>
                        <Box width={PROMPT_WIDTH} flexShrink={0}>
                            <Text dimColor={gutter !== "›"}>{gutter}</Text>
                        </Box>
                        <Text wrap="truncate">
                            {index === layout.cursorRow
                                ? withCursor(row, draft.cursor)
                                : row.text || " "}
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
}
```

Note `key={row.start}`: two rows never share a start offset.

- [ ] **Step 4: Wire App to the new Input**

In `src/tui/App.tsx`:

- `import { type Draft, EMPTY_DRAFT, maxDraftRows } from "./editor.js";`
- `const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);` replacing the
  string draft; in `submit`, `setDraft(EMPTY_DRAFT)` replacing
  `setDraft("")`.
- Before the `return`:

```tsx
    const messages = turns.current
        .filter((turn) => turn.role === "user")
        .map((turn) => turn.text);
```

- The `<Input>` element becomes:

```tsx
                <Input
                    draft={draft}
                    messages={messages}
                    canSend={!state.streaming}
                    maxRows={maxDraftRows(rows)}
                    onChange={setDraft}
                    onSubmit={submit}
                />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/tui`
Expected: PASS. If "scrolls a tall draft" fails on the exact frame, print
`frame()` and check the gutter rule against the spec (↑ on the top visible
row when rows are hidden above, ↓ on the bottom when hidden below, › on the
draft's first row) before touching the expectation.

- [ ] **Step 6: Check the width rule in a real terminal**

Run the pty probe from `.superpowers/probe/` (recreate it as in commit
`0cc90b8`'s investigation if missing: an `App` with a fake session, driven
under `uv run --with pyte python`) typing 200 characters with two Shift+Enter
(`\x1b[13;2u`) presses at 80 columns.
Expected: `lines wider than COLS: 0` and no stale `───` rows on screen.

- [ ] **Step 7: Commit**

```bash
bunx biome check --write src/tui
git add src/tui/Input.tsx src/tui/Input.test.tsx src/tui/components.test.tsx src/tui/App.tsx src/tui/App.test.tsx
git commit -m "feat(tui): Edit drafts over several lines"
```

---

### Task 5: Quit keys, row budget and the kitty protocol

**Files:**

- Modify: `src/tui/App.tsx`, `src/tui/App.test.tsx`
- Modify: `src/tui/layout.ts`, `src/tui/layout.test.ts`
- Modify: `src/tui/run.tsx`

**Interfaces:**

- Consumes: `draftWidth` (Task 4), `layoutDraft`, `draftWindow`,
  `maxDraftRows`, `EMPTY_DRAFT`.
- Produces: `fitLayout(rows, { showRaw, rawCount, warning, inputRows })`.

- [ ] **Step 1: Write the failing tests**

In `src/tui/layout.test.ts`, change `used` to count the input's rows, add
`inputRows: 1` to every existing `fitLayout` call and options object (their
expected numbers stay the same), and add a test:

```ts
const used = (
    rows: number,
    options: {
        showRaw: boolean;
        rawCount: number;
        warning: boolean;
        inputRows: number;
    },
) => {
    const { replyRows, rawRows } = fitLayout(rows, options);
    return (
        replyRows +
        rawRows +
        2 +
        options.inputRows +
        (options.warning ? 1 : 0) +
        (options.showRaw ? 3 : 0)
    );
};
```

```ts
    it("gives a tall draft its rows from the reply's", () => {
        for (const inputRows of [1, 4, 8]) {
            const options = {
                showRaw: true,
                rawCount: 20,
                warning: true,
                inputRows,
            };
            expect(used(24, options)).toBeLessThan(24);
        }
    });
```

In `src/tui/App.test.tsx` add:

```tsx
    it("clears a draft on Ctrl+C, then quits", async () => {
        const { app, session, type } = setup();
        await tick();
        await type("abc");
        await type("\u0003");
        expect(session().closed).toBe(false);
        expect(app.lastFrame()).toContain("enter send");
        await type("\u0003");
        expect(session().closed).toBe(true);
    });

    it("deletes forward on Ctrl+D while there is a draft", async () => {
        const { app, session, type } = setup();
        await tick();
        await type("ab");
        await type("\u001B[D");
        await type("\u0004");
        expect(session().closed).toBe(false);
        expect(app.lastFrame()).toContain("› a▏");
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/tui/layout.test.ts src/tui/App.test.tsx`
Expected: FAIL; "gives a tall draft its rows" exceeds 24 rows (`fitLayout`
ignores `inputRows`); Ctrl+C quits with a draft; Ctrl+D quits with a draft.

- [ ] **Step 3: Implement**

In `src/tui/layout.ts`, replace `STATUS_ROWS` and the options:

```ts
// Rows of the status bar besides the input (its border and the header), and
// of the raw pane's frame (two borders and its title).
const STATUS_ROWS = 2;
```

```ts
export function fitLayout(
    rows: number,
    {
        showRaw,
        rawCount,
        warning,
        inputRows,
    }: {
        showRaw: boolean;
        rawCount: number;
        warning: boolean;
        inputRows: number;
    },
): Layout {
    const fixed = STATUS_ROWS + inputRows + (warning ? 1 : 0) + SPARE_ROWS;
```

(the rest of the function is unchanged).

In `src/tui/App.tsx`, import `draftWidth` from `./Input.js` and
`draftWindow, layoutDraft` from `./editor.js`; compute the draft's rows and
pass them on:

```tsx
    const maxRows = maxDraftRows(rows);
    const { first, last } = draftWindow(
        layoutDraft(draft, draftWidth(columns)),
        maxRows,
    );
    const { replyRows, rawRows } = fitLayout(rows, {
        showRaw: state.showRaw,
        rawCount: state.raw.length,
        warning: state.warning !== null,
        inputRows: last - first,
    });
```

(pass `maxRows={maxRows}` to `<Input>`), and change the quit keys in
`useInput`:

```tsx
        } else if (key.ctrl && input === "c") {
            if (state.streaming) {
                interrupt();
            } else if (draft.text !== "") {
                setDraft(EMPTY_DRAFT);
            } else {
                quit();
            }
        } else if (key.ctrl && input === "d") {
            // With a draft, Input deletes forward instead.
            if (draft.text === "") {
                quit();
            }
        }
```

In `src/tui/run.tsx`, the render options become:

```tsx
        // Kitty-protocol terminals report Shift+Enter apart from Enter.
        { exitOnCtrlC: false, kittyKeyboard: { mode: "auto" } },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test`
Expected: PASS, the whole suite, including "interrupts on Ctrl+C while
streaming and quits when idle" and "quits on Ctrl+D" unchanged.

- [ ] **Step 5: Commit**

```bash
bunx biome check --write src/tui
git add src/tui/layout.ts src/tui/layout.test.ts
git commit -m "feat(tui): Budget rows for a tall draft"
git add src/tui/App.tsx src/tui/App.test.tsx
git commit -m "feat(tui): Clear a draft before quitting"
git add src/tui/run.tsx
git commit -m "feat(tui): Enable the kitty keyboard protocol"
```

(If `App.tsx` holds both the `fitLayout` call and the quit keys, commit
`layout.ts`, `layout.test.ts` and `App.tsx`'s whole change together as
`feat(tui): Budget rows for a tall draft` and the quit-key tests with it;
record that in the ledger.)

---

### Task 6: Edit the draft in $EDITOR

**Files:**

- Create: `src/tui/external-editor.ts`, `src/tui/external-editor.test.ts`
- Modify: `src/tui/App.tsx`, `src/tui/App.test.tsx`, `src/tui/run.tsx`
- Modify: `README.md`

**Interfaces:**

- Produces:
  - `type EditResult = { ok: true; text: string } | { ok: false; message: string }`
  - `editorCommand(env?: NodeJS.ProcessEnv): string`
  - `editInEditor(text: string, command?: string): Promise<EditResult>`
  - `AppProps.editDraft(text: string): Promise<EditResult>`

- [ ] **Step 1: Write the failing tests for the editor runner**

Create `src/tui/external-editor.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editInEditor, editorCommand } from "./external-editor.js";

describe("editInEditor", () => {
    it("returns what the editor saved, less one trailing newline", async () => {
        expect(await editInEditor("abc", "sed -i 's/a/b/'")).toEqual({
            ok: true,
            text: "bbc",
        });
        expect(await editInEditor("", "printf 'one\\ntwo\\n\\n' >")).toEqual({
            ok: true,
            text: "one\ntwo\n",
        });
    });

    it("reports an editor that fails or is missing", async () => {
        expect(await editInEditor("abc", "false")).toEqual({
            ok: false,
            message: "editor exited with 1",
        });
        expect(await editInEditor("abc", "no-such-editor-for-dorothy")).toEqual({
            ok: false,
            message: "editor exited with 127",
        });
    });

    it("writes a private file and removes it afterwards", async () => {
        const out = join(await mkdtemp(join(tmpdir(), "dorothy-test-")), "out");
        await editInEditor("x", `stat -c '%a %n' "$1" > ${out}; true`);
        const [mode, path] = (await readFile(out, "utf8")).trim().split(" ");
        expect(mode).toBe("600");
        expect(existsSync(path ?? "")).toBe(false);
    });
});

describe("editorCommand", () => {
    it("prefers VISUAL, then EDITOR, then vi", () => {
        expect(editorCommand({ VISUAL: "a", EDITOR: "b" })).toBe("a");
        expect(editorCommand({ EDITOR: "b" })).toBe("b");
        expect(editorCommand({ VISUAL: "" })).toBe("vi");
        expect(editorCommand({})).toBe("vi");
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/tui/external-editor.test.ts`
Expected: FAIL, `Cannot find module './external-editor.js'`.

- [ ] **Step 3: Implement the runner**

Create `src/tui/external-editor.ts`:

```ts
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type EditResult =
    | { ok: true; text: string }
    | { ok: false; message: string };

export function editorCommand(env: NodeJS.ProcessEnv = process.env): string {
    return env.VISUAL || env.EDITOR || "vi";
}

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// The command runs through sh so an EDITOR with arguments ("code --wait")
// works; the file is its "$1". mkdtemp makes a private directory.
export async function editInEditor(
    text: string,
    command: string = editorCommand(),
): Promise<EditResult> {
    const dir = await mkdtemp(join(tmpdir(), "dorothy-"));
    const file = join(dir, "draft.md");
    try {
        await writeFile(file, text, { mode: 0o600 });
        const status = await new Promise<number | null>((resolve, reject) => {
            const child = spawn("sh", ["-c", `${command} "$1"`, "sh", file], {
                stdio: "inherit",
            });
            child.on("error", reject);
            child.on("exit", resolve);
        });
        if (status !== 0) {
            return {
                ok: false,
                message: `editor exited with ${status ?? "a signal"}`,
            };
        }
        return { ok: true, text: (await readFile(file, "utf8")).replace(/\n$/, "") };
    } catch (error) {
        return { ok: false, message: `editor failed: ${describeError(error)}` };
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}
```

Run: `bun test src/tui/external-editor.test.ts`
Expected: PASS, 4 tests. (`sed -i` without a suffix and `stat -c` are GNU
forms; this repository and CI run on Linux.)

- [ ] **Step 4: Commit the runner**

```bash
bunx biome check --write src/tui/external-editor.ts src/tui/external-editor.test.ts
git add src/tui/external-editor.ts src/tui/external-editor.test.ts
git commit -m "feat(tui): Run \$EDITOR on a private draft file"
```

- [ ] **Step 5: Write the failing App tests**

In `src/tui/App.test.tsx`, add
`import type { EditResult } from "./external-editor.js";` and an
`editDraft` option to `setup`:

```tsx
function setup({
    history = [],
    failWrites = false,
    editDraft = async (text: string): Promise<EditResult> => ({
        ok: true,
        text,
    }),
}: {
    history?: Turn[];
    failWrites?: boolean;
    editDraft?: (text: string) => Promise<EditResult>;
} = {}) {
```

pass `editDraft={editDraft}` to `<App>`, and add:

```tsx
    it("replaces the draft with what the editor saved", async () => {
        const seen: string[] = [];
        const { app, type } = setup({
            editDraft: async (text) => {
                seen.push(text);
                return { ok: true, text: "from the editor" };
            },
        });
        await tick();
        await type("abc");
        await type("\u0007");
        await tick();
        expect(seen).toEqual(["abc"]);
        expect(app.lastFrame()).toContain("› from the editor▏");
    });

    it("keeps the draft and warns when the editor fails", async () => {
        const { app, type } = setup({
            editDraft: async () => ({
                ok: false,
                message: "editor exited with 1",
            }),
        });
        await tick();
        await type("abc");
        await type("\u0007");
        await tick();
        expect(app.lastFrame()).toContain("› abc▏");
        expect(app.lastFrame()).toContain("editor exited with 1");
    });

    it("opens one editor at a time", async () => {
        let calls = 0;
        let finish = (_: EditResult) => {};
        const { type } = setup({
            editDraft: () => {
                calls++;
                return new Promise((resolve) => {
                    finish = resolve;
                });
            },
        });
        await tick();
        await type("\u0007");
        await type("\u0007");
        expect(calls).toBe(1);
        finish({ ok: true, text: "" });
        await tick();
    });

    it("shows a reply that ended while the editor was open", async () => {
        let finish = (_: EditResult) => {};
        const { app, session, type } = setup({
            editDraft: () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        });
        await tick();
        await type("question");
        await type("\r");
        await type("\u0007");
        session().emit({
            type: "turn-end",
            reply: "Finished while editing",
            interrupted: false,
            stats,
        });
        await tick();
        finish({ ok: true, text: "next" });
        await tick();
        await tick();
        expect(app.lastFrame()).toContain("Finished while editing");
    });
```

- [ ] **Step 6: Run them to verify they fail**

Run: `bun test src/tui/App.test.tsx`
Expected: FAIL; `App` has no `editDraft` prop and ignores Ctrl+G. If "shows
a reply that ended while the editor was open" passes before Step 7's freeze
exists (the test renderer may not discard renders while suspended), record
`Ruling:` in the ledger and rely on Step 9's pty probe for that behaviour.

- [ ] **Step 7: Implement Ctrl+G in App**

In `src/tui/App.tsx`:

- `import type { EditResult } from "./external-editor.js";` and
  `import type { Line } from "./state.js";` (merge with the existing
  `./state.js` import).
- Add `editDraft(text: string): Promise<EditResult>;` to `AppProps` and
  destructure it.
- `const { exit, suspendTerminal } = useApp();`
- State and refs, after the draft state:

```tsx
    // Ink discards renders while the editor has the terminal, which would
    // lose <Static> lines printed meanwhile; History keeps the lines it had
    // until the editor closes, then prints the rest.
    const [frozenLines, setFrozenLines] = useState<Line[] | null>(null);
    const editing = useRef(false);
    const latestDraft = useRef(draft);
    latestDraft.current = draft;
```

- The editor action, beside `interrupt`:

```tsx
    const openEditor = () => {
        if (editing.current) {
            return;
        }
        editing.current = true;
        setFrozenLines(state.lines);
        let result: EditResult = { ok: false, message: "editor did not run" };
        suspendTerminal(async () => {
            result = await editDraft(latestDraft.current.text);
        })
            .catch((error: unknown) => {
                result = {
                    ok: false,
                    message: `editor failed: ${describeError(error)}`,
                };
            })
            .finally(() => {
                editing.current = false;
                setFrozenLines(null);
                if (result.ok) {
                    setDraft({ text: result.text, cursor: result.text.length });
                } else {
                    dispatch({ type: "warning", message: result.message });
                }
            });
    };
```

- In `useInput`, before the Ctrl+C branch:

```tsx
        } else if (key.ctrl && input === "g") {
            openEditor();
```

- `<History lines={frozenLines ?? state.lines} />`

In `src/tui/run.tsx`, `import { editInEditor } from "./external-editor.js";`
and pass `editDraft={(text) => editInEditor(text)}` to `<App>`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test`
Expected: PASS, the whole suite; `bunx tsc --noEmit -p .` clean.

- [ ] **Step 9: Probe the real editor in a pty**

Write `.superpowers/probe/editor.sh`:

```sh
#!/bin/sh
printf 'edited in a real editor\n' > "$1"
```

`chmod +x` it, render the probe driver's `App` with
`editDraft={(text) => editInEditor(text)}` and `kittyKeyboard: { mode: "auto" }`,
run it under the pty harness with `EDITOR=$PWD/.superpowers/probe/editor.sh`,
type `abc`, send `\x07`, wait 1 s, and print the screen.
Expected: the input row reads `› edited in a real editor▏`, no `───`
leftovers, `lines wider than COLS: 0`. Repeat with `EDITOR=false`:
expected `! editor exited with 1` in the header and `› abc▏` kept.

- [ ] **Step 10: Document the keys**

In `README.md`, replace the sentence beginning "Enter sends, Esc stops a
reply" with:

```markdown
Enter sends and Shift+Enter starts a new line (in terminals with the kitty
keyboard protocol). Arrows, Home, End and the usual readline keys move and
edit; Up and Down past the first or last line recall earlier messages, and
Ctrl+G opens the draft in `$VISUAL` or `$EDITOR`. You can keep writing while
a reply streams; Esc stops it. Ctrl+R shows the raw SDK messages. Ctrl+C
clears the draft, then quits; Ctrl+D or `/exit` quits too.
```

keeping the rest of that paragraph (the four-word phrase and transcript
path) as it is.

- [ ] **Step 11: Commit**

```bash
bunx biome check --write src/tui README.md
git add src/tui/App.tsx src/tui/App.test.tsx src/tui/run.tsx
git commit -m "feat(tui): Edit the draft in \$EDITOR with Ctrl+G"
git add README.md
git commit -m "docs: Document the input editor keys"
```
