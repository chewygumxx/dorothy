---
ctime: 2026-10-05
mtime: 2026-10-05
spdx: GPL-3.0-only
title: Statusline and minimum size design
description: "Design spec for a configurable statusline and a minimum window"
tags:
  - dorothy
  - tui
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-05-statusline-and-minimum-size-design.md
   -
   -->

# Statusline and minimum size design

## Purpose

Three requests from the review of the deferred minors, designed together
because each changes the same row budget:

- **A minimum window.** Below a set number of lines and columns the TUI draws
  nothing but a message saying how large it needs to be, rather than a layout
  that no longer fits.
- **A configurable statusline.** The stats under each reply wrap once the
  cache counts appear. Both that line and a new persistent statusline take
  their modules, in priority order, from a configuration file; modules that do
  not fit are dropped from the right, or overflow onto up to a configured
  number of lines.
- **A five-row input.** A draft longer than five rows shows only five,
  scrolled to the cursor.

Success:

- At or above the minimum, every part of the live region fits however many
  warnings there are, whether the raw pane is open and however long the
  draft; nothing is squeezed.
- Below it, the live region is one line naming the minimum and the window's
  size, and quitting still works.
- No statusline row is ever wider than the window, and a module is never
  split across rows.
- A broken configuration file never stops Dorothy: it says what is wrong in a
  warning and uses the defaults.

This spec targets main as of `d6b275b` and is built before the Markdown
replies and input editor plans, which are then amended for it (see Order of
work).

## Decisions

- **Two lines, one catalogue.** The per-reply stats line stays under each
  reply. A persistent statusline sits under the input. Both are configured the
  same way from the same module names.
- **The header moves to the bottom** and is not configurable. It is truncated
  to one row rather than wrapped.
- **Warnings move above the input**, under the border.
- **Strict priority.** Modules fill rows left to right; the first that does
  not fit in the rows allowed ends the line, and nothing after it is drawn,
  even a shorter one that would fit.
- **TOML**, read once at startup with `Bun.TOML.parse`. No new dependency, no
  live reload.
- **The minimum is the worst case**, so it never depends on what is on screen
  at the moment: 40 columns and `19 + statusline max-lines` lines (20 with the
  default of one line; 19 when the statusline is hidden).
- **The input cap is a constant 5 rows**, which the minimum always leaves
  room for.

## Layout

The live region, top to bottom:

```text
<live reply>             at least 3 rows at the minimum, else what is left
<raw pane>               when shown: 3 frame rows and at least 1 entry
────────────────────     border
! warning                0 to 3 rows
› draft                  1 to 5 rows
<statusline>             0 to max-lines rows
dorothy · … · ready      header, 1 row
```

`fitLayout` (`src/tui/layout.ts`) stays the one arbiter of rows. It takes the
statusline's rendered row count as `statusRows` and gives the input
`min(wanted, 5)`. The fixed rows are the border, the header and the two spare
rows (one for a row Ink wraps despite the measuring, one so the live region
is never as tall as the window).

```ts
export const MIN_COLUMNS = 40;
export const INPUT_MAX_ROWS = 5;
export const minRows = (statusMaxLines: number): number => 19 + statusMaxLines;
```

19 is border 1, warnings 3, input 5, header 1, spare 2, raw frame 3, raw
entry 1 and reply 3. `App` passes the statusline's `max-lines`, or 0 when its
`modules` is empty. A `max-lines` of 5 makes the minimum 24.

### Too small

When `columns < MIN_COLUMNS` or `rows < minRows(statusline max-lines)`, `App`
renders only:

```text
Too Small: Dorothy's TUI needs at least 20 lines and 40 columns (this window is 14 × 80)
```

wrapped by Ink to the window's width. While the window is too small:

- Ctrl+C and Ctrl+D quit as usual; no other key does anything.
- The draft is kept.
- A streaming reply keeps arriving into state and the transcript; it is shown
  once the window is large enough again.
- `History` is unaffected: its `Static` lines are already in the scrollback.

The check uses `useWindowSize`, so resizing past the minimum in either
direction switches immediately.

## Configuration

### File

`$XDG_CONFIG_HOME/dorothy/config.toml`, or `$HOME/.config/dorothy/config.toml`
when `XDG_CONFIG_HOME` is empty or relative. The XDG resolution in
`src/transcript.ts` moves to a shared helper so both files agree:

```ts
// src/xdg.ts
export function xdgDir(
  env: Record<string, string | undefined>,
  variable: "XDG_DATA_HOME" | "XDG_CONFIG_HOME",
  fallback: string, // ".local/share" or ".config", joined under HOME
): string;
```

The defaults, which an absent file means:

```toml
[statusline]
modules = ["chat-cost", "cost", "in", "out", "ttft", "duration"]
max-lines = 1

[reply-stats]
modules = [
  "in", "cache-read", "cache-write", "out", "ttft", "duration", "cost",
  "chat-cost",
]
max-lines = 1
```

`modules = []` hides that line; for the statusline it also frees its row.

### `src/config.ts`

```ts
export type ModuleName =
  | "in"
  | "cache-read"
  | "cache-write"
  | "out"
  | "ttft"
  | "duration"
  | "cost"
  | "chat-cost";
export type LineConfig = { modules: ModuleName[]; maxLines: number };
export type Config = { statusline: LineConfig; replyStats: LineConfig };
export const DEFAULT_CONFIG: Config;

export function parseConfig(text: string): {
  config: Config;
  warnings: string[];
};
export async function readConfig(
  env: Record<string, string | undefined>,
): Promise<{ config: Config; warnings: string[] }>;
```

`parseConfig` is pure; `readConfig` resolves the path, reads it and calls
`parseConfig`. Neither imports the SDK or Ink, so `src/tui/` may import the
types. `run.tsx` calls `readConfig` beside `readTranscript` and passes the
config to `App` and its warnings into `initialWarnings`.

### Errors

Every problem is one warning and a fallback; Dorothy always starts.

| Problem                           | Fallback             | Warning                                |
| --------------------------------- | -------------------- | -------------------------------------- |
| No file                           | defaults             | none                                   |
| Unreadable file                   | defaults             | `config.toml: <reason>`                |
| Invalid TOML                      | defaults             | `config.toml line 3: <parser message>` |
| Unknown table or key              | ignored              | `config.toml: unknown key max_lines`   |
| `modules` not a list of strings   | that table's default | names the table                        |
| Unknown module name               | that name skipped    | names the module                       |
| Repeated module name              | later copy skipped   | names the module                       |
| `max-lines` not an integer 1 to 5 | 1                    | names the table                        |

The warnings share the existing three warning rows.

## Rendering

### Modules

`src/tui/statusline.ts` replaces `formatStats` in `LiveReply.tsx`:

```ts
export function renderModule(
  name: ModuleName,
  stats: TurnStats | null,
  chatCostUsd: number,
): string | null;
export function fitModules(
  pieces: string[],
  width: number,
  maxLines: number,
): string[];
```

| Module        | Text              | Renders nothing when           |
| ------------- | ----------------- | ------------------------------ |
| `in`          | `2 in`            | no turn yet                    |
| `cache-read`  | `1010 cache read` | no turn yet, or 0              |
| `cache-write` | `286 cache write` | no turn yet, or 0              |
| `out`         | `378 out`         | no turn yet                    |
| `ttft`        | `ttft 1.9s`       | no turn yet, or no first token |
| `duration`    | `5.3s`            | no turn yet                    |
| `cost`        | `$0.0051`         | no turn yet                    |
| `chat-cost`   | `chat $0.0168`    | never                          |

A module that renders nothing is skipped; it is not a module that failed to
fit.

### Fitting

`fitModules` joins pieces with `·` and measures by display width
(`string-width`). It places each piece on the current row if it fits with its
separator, else on a new row if fewer than `maxLines` rows are used, else it
stops and drops that piece and all after it. A piece never splits: at 40
columns or more every piece fits an empty row.

```text
width 40, max-lines 1   2 in · 1010 cache read · 286 cache write
width 40, max-lines 2   2 in · 1010 cache read · 286 cache write
                        378 out · ttft 1.9s · 5.3s · $0.0051
```

### Where each line draws

- **Reply stats**: `LineView` in `History.tsx`, under each Dorothy reply,
  dimmed, at `columns - LABEL_WIDTH`, with that turn's stats and the chat
  total after it (`line.chatCostUsd`). Like the rest of the scrollback it is
  drawn once, at the width of the moment.
- **Statusline**: a new `Statusline` component under the input, dimmed, at
  the full width, with the latest finished turn's stats (`null` before the
  first) and `state.costUsd`. Its rendered row count feeds `fitLayout`.

The transcript still records the raw numbers, so a changed configuration
also changes how resumed turns display.

## Order of work

1. This spec's plan, on a feature branch from main.
2. Amend the Markdown replies plan: `formatStats` is gone; `LineView` renders
   reply stats with `renderModule` and `fitModules`.
3. Amend the input editor plan: `maxDraftRows` becomes the constant
   `INPUT_MAX_ROWS`, `fitLayout` already takes `statusRows`, and the bottom
   box is warnings, input, statusline, header.
4. Run the two amended plans in turn.

## Testing

- `config.test.ts`: defaults for an empty file; each row of the errors table,
  one warning each; a full valid file; `readConfig` with a missing file, an
  unreadable one, and `XDG_CONFIG_HOME` relative or empty.
- `xdg.test.ts`: the cases `transcript.test.ts` covers for `XDG_DATA_HOME`,
  for both variables.
- `statusline.test.ts`: each module's text and its nothing cases; `fitModules`
  dropping from the right, never placing a later piece after a dropped one,
  overflowing to `maxLines`, a CJK piece measured at width 2, and no row
  wider than `width`.
- `layout.test.ts`: at every size from the minimum to 60 × 200, with 0 to 3
  warnings, the raw pane open or shut, 1 to 5 statusline rows and drafts of
  1 to 50 rows, the live region is at least two rows shorter than the window
  and every part gets its rows; the old small-window exceptions go.
- `App.test.tsx`: the Too Small message below each bound and not at it; a
  draft typed before shrinking survives; Ctrl+C quits while too small; the
  order of warnings, input, statusline and header; the statusline after a turn
  ends and with `modules = []`.
- `components.test.tsx`: the input shows five rows of a long draft with the
  `↑` marker; the header is one row at 40 columns.
- The pty probe at 80 × 24 and 40 × 20 with a long draft: no full clears.

## Out of scope

- Live reload of the configuration.
- Modules beyond the turn stats (model, session, status stay in the header).
- Configuring the header, colours, the separator or the input cap.
- A setting for the minimum size.

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
