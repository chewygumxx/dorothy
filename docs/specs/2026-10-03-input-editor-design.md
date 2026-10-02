---
__cgxx: |
  # vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3:
  # SPDX-License-Identifier: GPL-3.0-only

  #
  #
  # ~chewygumxx/dorothy.git
  # ::: :/docs/specs/2026-10-03-input-editor-design.md
  #
  #

ctime: 2026-10-03
title: Input editor design
description: "Design spec for the chat TUI's multi-line input editor"
tags:
  - dorothy
  - tui
  - spec
---

# Input editor design

## Purpose

The first live test of the chat TUI found the input too thin for real use:
Shift+Enter sent the message, there was no cursor to move, and no way to
compose a long message in a proper editor. This replaces the single-line
`Input` with a multi-line editor: a buffer with a cursor, readline-style keys,
message recall, and `$EDITOR`.

Success:

- Shift+Enter inserts a newline in a terminal speaking the kitty keyboard
  protocol; Enter sends.
- The cursor moves by character, word, line and visual row, and the familiar
  readline keys edit around it.
- Up and Down recall earlier messages once past the draft's first or last row.
- Ctrl+G opens the draft in `$EDITOR` and takes the result back.
- The draft can be composed while a reply streams.
- No row of the input is ever wider than the terminal, and the live region
  never fills the window, however long the draft (see `fitLayout`).

Depends on the Markdown replies spec
(`2026-10-03-markdown-replies-design.md`) for `wrapSpans`, so it is built
after that one.

## Decisions

- **Newline is Shift+Enter only.** Ink renders with
  `kittyKeyboard: { mode: "auto" }`, which queries the terminal and enables the
  protocol where supported. Elsewhere Shift+Enter arrives as Enter and sends;
  a paste (which keeps its newlines) and Ctrl+G remain the ways to write
  several lines there.
- **Up and Down move by visual row first**, keeping the cursor's display
  column; above the first row or below the last they walk the message history.
- **Compose during a reply; send after.** Typing, editing, recall and Ctrl+G
  work while a reply streams. Enter does nothing then and keeps the draft. Esc
  still stops the reply.
- **Ctrl+C and Ctrl+D act like a shell's.** Ctrl+C stops a streaming reply;
  otherwise it clears a non-empty draft, and quits on an empty one. Ctrl+D
  quits on an empty draft and deletes forward otherwise.
- **The draft's height is capped** at `max(3, floor(rows / 3))` rows,
  scrolled to keep the cursor visible.

## Units

### `src/tui/editor.ts`

Pure; no Ink.

```ts
type Draft = { text: string; cursor: number }; // cursor: UTF-16 offset on a grapheme boundary
```

Edits are functions from a `Draft` (and arguments) to a new `Draft`:

- `insert(draft, text)`.
- `backspace`, `deleteForward`: one grapheme, by `Intl.Segmenter`.
- `left`, `right`: one grapheme. `wordLeft`, `wordRight`: to the previous word
  start or the next word end, words being runs of non-space.
- `lineStart`, `lineEnd`: within the current logical line (between `\n`s).
- `killLineEnd`, `killLineStart`, `killWordBack`: return
  `{ draft, killed }`; the caller keeps `killed` for `yank`. Killing at the end
  of a line with nothing after it kills the `\n`.

```ts
type DraftLayout = { rows: string[]; cursorRow: number; cursorColumn: number };
function layoutDraft(draft: Draft, width: number): DraftLayout;
function up(draft: Draft, width: number, column?: number): Draft | null;
function down(draft: Draft, width: number, column?: number): Draft | null;
```

`layoutDraft` wraps the text with `wrapSpans` from the Markdown replies spec
(`string-width`, breaking at a space and dropping it) and finds the cursor's
row and display column. When the cursor sits on a space a wrap dropped, it
shows at the end of the row before. `up` and `down` return `null` on the first
or last row, which hands the key to recall. The goal column `column` is kept by
the caller across consecutive vertical moves, so moving through a short row
does not lose it.

### `src/tui/recall.ts`

Pure.

```ts
type Recall = { messages: string[]; index: number | null; saved: string };
function startRecall(messages: string[]): Recall;
function older(recall: Recall, draft: string): { recall: Recall; text: string } | null;
function newer(recall: Recall): { recall: Recall; text: string } | null;
```

`messages` are the user's earlier messages in this chat, resumed ones
included, oldest first. The first `older` saves the draft; `newer` past the
newest message restores it. Sending a message or editing a recalled one ends
recall (`index` back to `null`). Consecutive duplicates appear once.

### `src/tui/Input.tsx`

A key map from `useInput` and `usePaste` onto `editor.ts` and `recall.ts`; it
owns the draft, the kill buffer, the goal column and recall state. It renders
the visible window of `layoutDraft` rows behind a 2-column gutter: `› ` on the
draft's first row, `↑ ` on the top visible row when rows are hidden above,
`↓ ` on the bottom one when rows are hidden below, and spaces otherwise. The
cursor is drawn as an inverse cell (or `▏` at a row's end). The key hints show,
padded and truncated, only while the draft is empty.

A paste inserts at the cursor as one edit, with `\r\n` and `\r` turned into
`\n` and each tab into 4 spaces.

### `src/tui/App.tsx`, `layout.ts`, `run.tsx`

- `App` takes `editDraft(text: string): Promise<string | null>`; `null` means
  "keep the old draft". It reports the draft's visible row count to
  `fitLayout`, which subtracts it from the reply's rows (replacing the one row
  `STATUS_ROWS` assumed for the input).
- While `editDraft` runs, `History` is passed the lines it had when the editor
  opened, so `<Static>` writes nothing during the suspension (Ink discards
  renders then) and prints the lines that arrived meanwhile after resume.
- `run.tsx` renders with `kittyKeyboard: { mode: "auto" }` and supplies the
  real `editDraft`:
  1. Write the draft to `draft.md` in a fresh `mkdtemp` directory under
     `os.tmpdir()`, mode `0600`.
  2. Inside `useApp().suspendTerminal(...)`, run
     `sh -c '<editor> "$1"' sh <file>`, with `<editor>` being `$VISUAL`, else
     `$EDITOR`, else `vi`, inheriting stdio, and await its exit.
  3. Exit status 0: read the file and drop one trailing newline. Otherwise
     return `null` and raise the warning `editor exited with <status>`; a
     launch failure warns `editor failed: <message>`.
  4. Remove the directory either way.

## Keys

| Key                         | Action                                                       |
| --------------------------- | ------------------------------------------------------------ |
| Enter                       | Send, unless a reply is streaming or the draft is blank      |
| Shift+Enter                 | Insert a newline                                             |
| Left, Right, Ctrl+B, Ctrl+F | Move one grapheme                                            |
| Alt+B, Alt+F, Ctrl+Left, Ctrl+Right | Move one word                                        |
| Home, End, Ctrl+A, Ctrl+E   | Start or end of the line                                     |
| Up, Down                    | Move one visual row; past the first or last, recall          |
| Backspace, Delete           | Delete one grapheme back or forward                          |
| Ctrl+W, Alt+Backspace       | Kill the previous word                                       |
| Ctrl+U, Ctrl+K              | Kill to the start or end of the line                         |
| Ctrl+Y                      | Yank the last kill                                           |
| Ctrl+G                      | Edit the draft in `$EDITOR`                                  |
| Ctrl+C                      | Stop a reply; else clear the draft; else quit                |
| Ctrl+D                      | Quit on an empty draft; else delete forward                  |
| Esc                         | Stop a reply                                                 |
| Ctrl+R                      | Toggle the raw pane                                          |

The key hints become
`enter send · shift+enter newline · ctrl+g editor · esc stop · ctrl+r raw · ctrl+c quit`,
truncated where the terminal is narrower.

## Testing

- `editor.ts`: every edit, with ASCII, a composite emoji (`👩‍💻`) and CJK;
  `layoutDraft` at a width that wraps, including the cursor on a dropped space;
  `up` and `down` across wrapped rows, across logical lines, keeping the goal
  column, and returning `null` at the edges.
- `recall.ts`: older and newer through the list, the saved draft restored,
  duplicates collapsed, recall ended by an edit.
- `Input` through stdin: Shift+Enter as kitty `ESC[13;2u`, Enter, arrows,
  Ctrl+W then Ctrl+Y, bracketed paste (`ESC[200~ ... ESC[201~`) with
  newlines, and a width sweep over draft lengths and cursor positions.
- `App` with a fake `editDraft`: the result replaces the draft; `null` keeps
  it; a reply that ends while it is pending reaches `History` afterwards;
  Enter during a reply keeps the draft; Ctrl+C and Ctrl+D per the table;
  `fitLayout` keeps the live region shorter than the window with a tall draft
  and the raw pane open.
- A pty probe of the real `editDraft` with `EDITOR` set to a script that
  rewrites the file, and one with a script that exits 1.

## Out of scope

- Undo, a kill ring beyond the last kill, mouse input, search through recall.
- Alt+Enter, Ctrl+J or backslash-Enter as newline keys.
- Syntax highlighting or Markdown rendering of the draft.
