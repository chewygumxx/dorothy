---
ctime: 2026-10-12
mtime: 2026-10-12
spdx: GPL-3.0-only
title: packages/tui/AGENTS.md
description: >-
  The TUI package's guide: the Ink chat, its pure reducer and its input
  editor.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/tui/AGENTS.md
   -
   -->

# packages/tui/AGENTS.md

`@dorothy/tui` is the Ink chat. It knows a session only as core's
`ChatSession`, made by the `createSession` it is given, and needs no SDK
types: the `sdk` event carries core's structural `RawMessage`.

## Entry points and imports

One entry point, `"."` (`src/index.ts`): `runApp`, which renders the chat
until it exits, and `editInEditor`, which the CLI also passes to
`--memory` and `--edit-tags`. Of the `@dorothy` packages it depends on
`core` alone.

## Files

- `run-app.tsx`: `runApp`. `App.tsx`: the screen. It owns the draft and
  the editor's memory (kill buffer, goal column, input history), since the
  Too Small screen unmounts `Input`, and runs Ctrl+G's `$EDITOR`
  (`external-editor.ts`) inside Ink's `suspendTerminal`.
- `state.ts`: a pure reducer over the chat's state.
- `editor.ts` (draft edits, wrapped layout, cursor movement) and
  `recall.ts` (the input's history, not memory's recall): the pure input
  editor. `Input.tsx` only maps keys onto them.
- `layout.ts`: the minimum size and the Too Small screen.
- `Header.tsx`, `statusline.ts`: the header and its status line.
- `History.tsx`, `LiveReply.tsx`, `RawPane.tsx`: past turns, the reply
  streaming in, and the raw SDK messages.
- `Markdown.tsx` and `markdown/`: replies rendered as Markdown
  (`render.ts`, `spans.ts`), code highlighted by lowlight
  (`highlight.ts`).

## Invariants

- Screen logic lives in the pure modules (`state.ts`, `editor.ts`,
  `recall.ts`, `layout.ts`, `statusline.ts`, `markdown/`), so it is tested
  without Ink; components map keys and events onto them and render.

## Tests

Frame tests compare rendered frames as plain text: `test-setup.ts`,
preloaded by `bunfig.toml`, sets `FORCE_COLOR=0` before Ink loads.

## See also

- Specs: [TUI chat](../../docs/specs/2026-10-03-tui-chat-design.md),
  [input editor](../../docs/specs/2026-10-03-input-editor-design.md),
  [Markdown replies](../../docs/specs/2026-10-03-markdown-replies-design.md),
  [status line](../../docs/specs/2026-10-05-statusline-and-minimum-size-design.md)
