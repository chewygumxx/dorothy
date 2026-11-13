---
ctime: 2026-11-03
mtime: 2026-11-03
spdx: GPL-3.0-only
title: The terminal
description: >-
  Dorothy's terminal chat as built: the session and screen, the input
  editor, Markdown replies, the stats catalogue and statusline, and the
  layout and minimum window, with what was specified and not built.
tags:
  - wiki
  - tui
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/wiki/topics/terminal.md
   -
   -->

# The terminal

[Wiki home](../../README.md)

`dorothy` with no argument, in a terminal, opens a chat: a screen of finished
turns, a reply streaming in, an input to write in and two lines of status.
It is `@dorothy/tui`, built on Ink 7 with React 19 under Bun. This page
describes the chat as the code does today. The early specs describe an
earlier chat on the Agent SDK, and later specs amended them; where a
spec's text no longer holds, the page says so, and what a spec named and
the code does not have is marked not built.

State: built, with frame tests rendering the screen as plain text and pure
modules for the logic
([package guide](../../../packages/tui/AGENTS.md)). No report in the records
is a live check of the TUI by itself. The live runs of other phases drove it,
as the model providers report's three turns on a fallback route did
([report](../../reports/2026-11-01-model-providers.md#the-live-run-1)).

## What the package knows

The TUI knows a session only as core's `ChatSession`, made by the
`createSession` it is given, and needs no model SDK type: its `sdk` event
carries a stream part's type and, for text, its text
([guide](../../../packages/tui/AGENTS.md)). It has two entry points. `"."`
exports `runApp`, which renders the chat until it exits; `"./editor"`
exports `editInEditor`, so that `--memory` and `--edit-tags` open an editor
without loading Ink. It depends on `core` alone.

The screen logic sits in pure modules (`state.ts`, `editor.ts`, `recall.ts`,
`layout.ts`, `statusline.ts`, `markdown/`) that are tested without Ink;
components map keys and events onto them. `recall.ts` here is the input's
message history, not memory's recall.

## The chat

Three modes start from `parseArgs`, which takes whether the input is a
terminal: `dorothy "prompt"` streams one reply to standard output;
`dorothy` in a terminal opens the chat; `dorothy --resume <phrase>` opens it
seeded from a saved transcript. Without a terminal and without a prompt it
prints usage. The root README gives the commands
([README](../../../README.md)).

A chat is named by a four-word phrase from the `niceware` list, shown in the
header, and saved as it happens as a transcript under the user's data
directory, readable by the user only. The phrase is Dorothy's session id; the
model provider's session id is a separate value the header shows as
`session`. The original spec named it `sdk` and described a long-lived Agent
SDK subprocess; the runtime replaced that, and `Conversation` now holds the
messages itself
([spec](../../specs/2026-11-01-model-providers-design.md#chat)).

On screen, a line is one of four kinds: what the user said, what Dorothy
said, a dim line for a memory lookup or a kept fact, or an error. Finished
turns are printed once through Ink's `<Static>`, into the terminal's own
scrollback. Only the live region is redrawn: the reply streaming in, the
raw pane when shown, the warnings, the input, the statusline and the header.
A resumed chat shows its earlier turns first.

The lifecycle, from `App.tsx`:

- A reply streams as plain text and is interruptible with Esc, or with
  Ctrl+C while streaming. An interrupted reply is kept, marked
  `[interrupted]`, and what streamed is carried into the next turn.
- An error shows in red and the header says `disconnected`. Pressing Enter
  reconnects, by starting a new session seeded with every turn so far. The
  same path serves the first start, `--resume` and a reconnect.
- Quitting (Ctrl+D or Ctrl+C on an empty draft, or `/exit`) sends no more
  and gives the session a grace period to close, the header saying
  `closing`. A second quit key does not cut it short.
- Warnings are collected from the session and from memory, three rows at
  most, above the input.

Memory shows in the chat as dim lines and notices. A lookup she made, a
search, an opened conversation, a tag listing or a recollection, appears as
a row such as a search with the count it found; a kept or retired fact
appears as another. Memory's warnings and its review cost arrive as notices
the TUI subscribes to. What those lookups and reviews do is on
[memory](./memory.md). The listing and correcting of what she remembers
(`--list`, `--memory`) belongs to the CLI and memory, not to the chat screen;
the early catalogue spec put them there
([spec](../../specs/2026-10-05-conversation-catalogue-design.md#user-control)).

## The input

The input is a multi-line editor with a cursor, replacing the first design's
single line
([spec](../../specs/2026-10-03-input-editor-design.md)). The design's
decisions hold in the code:

- Enter sends and Shift+Enter inserts a newline. Ink is rendered with
  `kittyKeyboard: { mode: "auto" }`, which asks the terminal to report
  Shift+Enter apart from Enter where it can. Where it cannot, Shift+Enter
  arrives as Enter and sends; a paste, which keeps its newlines, and Ctrl+G
  remain the ways to write several lines.
- The cursor moves by grapheme, word, line and visual row, and the usual
  readline keys edit (Ctrl+A, Ctrl+E, Ctrl+W, Ctrl+U, Ctrl+K, Ctrl+Y). Up
  and Down move by visual row first, keeping the display column, and past the
  first or last row walk the user's earlier messages, restoring the draft when
  they come back.
- Ctrl+G opens the draft in `$VISUAL`, else `$EDITOR`, else `vi`, in a
  private temporary file, with Ink's terminal suspended meanwhile. A failure
  keeps the old draft and warns.
- The user can write while a reply streams. Enter then does nothing and keeps
  the draft; Esc still stops the reply.
- Ctrl+C stops a streaming reply, otherwise clears a non-empty draft and
  quits on an empty one; Ctrl+D quits on an empty draft and deletes forward
  otherwise.
- A paste is one edit: escape sequences are dropped whole, `\r\n` and `\r`
  become `\n`, tabs become four spaces and other control characters are
  dropped.
- The draft shows at most five rows, scrolled to the cursor, with `↑` and `↓`
  markers when rows are hidden.

The editor's pure logic is `editor.ts` (edits, wrapped layout, cursor
movement) and `recall.ts`; `Input.tsx` only maps keys onto them. Not built,
by the design's own Out of scope: undo, a kill ring beyond the last kill,
mouse input, search through the message history, and Alt+Enter or Ctrl+J as
newline keys. The roadmap's candidates list undo among the TUI's deferred
features ([roadmap](../../roadmap.md#candidates)).

## Rendering replies

A reply streams as plain text. When the turn ends it moves to the history and
is rendered as Markdown ([spec](../../specs/2026-10-03-markdown-replies-design.md#decisions)):
bold, italics, strikethrough, inline code, headings, lists with task items,
quotes, rules, links and tables, with GitHub-flavoured Markdown on. The
user's own lines and error lines stay plain, so asterisks the user typed are
theirs. Transcripts keep the raw Markdown, and `--resume` renders it again.

`marked` parses; Dorothy's own renderer in `markdown/` turns the tokens into
rows of styled spans, each row measured by display width, and Ink draws each
row. Doing rows by hand rather than with Ink's flex boxes lets table
borders line up exactly and no row start with the space a wrap broke at. The
rule that governs it is that no rendered row is wider than the room beside
the label column: wide content wraps inside its block, table columns shrink
and cells wrap, and a long code line wraps with a continuation marker. Fenced
code with a language label that `lowlight` knows is highlighted, mapped to
the sixteen ANSI colours so that it follows the terminal's theme.

A link shows its text underlined and then its address dimmed, unless the text
is the address. An image shows as `[image: alt]` and its address. HTML
and unknown tokens show as raw text.

Not built, by the design's Out of scope: rendering while streaming, clickable
links (OSC 8), images, diagrams or maths, and a theme setting. The roadmap
lists rendering while streaming, OSC 8 links and a theme among the TUI's
deferred features ([roadmap](../../roadmap.md#candidates)).

## The stats catalogue and the statusline

Two lines show a turn's numbers, and both take their modules from a named
catalogue, in priority order, from `config.toml`
([spec](../../specs/2026-10-05-statusline-and-minimum-size-design.md#decisions)).
The reply stats sit under each reply; the statusline sits under the input and
shows the latest finished turn. The catalogue has nine module names:
`in`, `cache-read`, `cache-write`, `out`, `ttft`, `duration`, `cost`,
`chat-cost` and `memory-cost`. A module with nothing to say, such as cache
reads of zero or a turn that has not happened, renders nothing and is skipped
rather than counted as unfit.

The statusline spec listed eight modules; `memory-cost`, what this run's
memory reviews and compactions have cost, was added later, and `core`'s
`MODULE_NAMES` is the authority
([`config.ts`](../../../packages/core/src/config.ts)). The defaults in the
code differ from the spec's accordingly: the statusline reads chat cost,
memory cost, cost, in, out, ttft and duration, and the reply stats read in,
the two cache counts, out, ttft, duration, cost and the chat total. The
root README shows the defaults the code has.

How a line fits is strict. Modules fill rows left to right, joined by a
separator, and never split; the first that fits neither the current row nor a
new one, within `max-lines` (1 to 5), ends the line, and nothing after it is
drawn, even a shorter piece that would fit
([`statusline.ts`](../../../packages/tui/src/statusline.ts)). An empty
`modules` hides a line, and for the statusline it also frees its rows.

The file is `$XDG_CONFIG_HOME/dorothy/config.toml`, read once at startup,
without live reload. A mistake in it shows as a warning that names it, and
the defaults apply, so a broken file never stops Dorothy. The one exception
is the routing tables, whose faults are errors
([models and routing](./models-and-routing.md#providers-and-routes)). The
costs shown come from the accounting described there.

## Layout and the minimum window

The live region, top to bottom: the reply streaming in, the raw pane if shown
(the last twenty stream parts, toggled with Ctrl+R), a border, the warnings,
the input, the statusline and, last, the header. The header was first above
the input and moved below it: Ink always draws `<Static>` output above the
live region, so a header that updates cannot stay pinned above the
scrollback. It reads the name, the phrase, the latest turn's model, the
session id and a status of `starting`, `ready`, `disconnected` or `closing`,
cut to one row rather than wrapped.

`fitLayout` in [`layout.ts`](../../../packages/tui/src/layout.ts) is the one
arbiter of rows. Ink clears the terminal, scrollback included, and repaints
every line on each frame once the live region is as tall as the window, so
the streaming reply and the raw pane share the rows the rest leaves, and the
live region is kept at least two rows short of the window. The input takes
at most five rows.

The minimum is the worst case, so it never depends on what is on screen: 40
columns, and `19 + statusline max-lines` lines, which is 20 with the default
and 19 with the statusline hidden. Below it the TUI draws nothing but a line
naming the minimum and the window's size:

```text
Too Small: Dorothy's TUI needs at least 20 lines and 40 columns ...
```

and for a window too short even for that line, a shorter message, which the
code added to the spec. While the window is too small, only Ctrl+C and
Ctrl+D act. The draft is kept, a streaming reply keeps arriving into state
and the transcript, and the lines that finish meanwhile are printed once the
window is large enough, as `<Static>` prints a line once at the width of the
moment.

## Not built, and conflicts between sources

- The early TUI spec's SDK-bound parts, its `sdk` header field, its
  subprocess and its original keys table, were superseded by the model
  providers runtime, the input editor and the statusline spec. The spec
  itself says it was amended for the last two.
- The catalogue named in the early records as a conversation catalogue is
  memory's, and is explained on [memory](./memory.md). This page uses the
  word for the stats modules, which the statusline spec calls one catalogue.
- Not built: undo, mouse input, rendering while streaming, OSC 8 links, a
  theme, configuration reloaded live, and a setting for the minimum size. The
  statusline spec rules out configuring the header, colours or the separator.

## Records

Every dated record of this subject is under
[the terminal](../records.md#terminal). The designs are the
[TUI chat](../../specs/2026-10-03-tui-chat-design.md),
[input editor](../../specs/2026-10-03-input-editor-design.md),
[Markdown replies](../../specs/2026-10-03-markdown-replies-design.md) and
[statusline and minimum size](../../specs/2026-10-05-statusline-and-minimum-size-design.md)
specs, each with its plan.

## Related

- [Models and routing](./models-and-routing.md)
- [Memory](./memory.md)
- [Packages](../profiles/packages.md)
- [Decisions](../decisions.md)
- [Problems](../problems.md)
