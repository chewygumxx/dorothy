---
__cgxx: |
  # vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3:
  # SPDX-License-Identifier: GPL-3.0-only

  #
  #
  # ~chewygumxx/dorothy.git
  # ::: :/docs/specs/2026-10-03-tui-chat-design.md
  #
  #

ctime: 2026-10-03
title: TUI chat design
description: "Design spec for Dorothy's terminal chat interface"
tags:
  - dorothy
  - tui
  - spec
---

# TUI chat design

## Purpose

Turn Dorothy from a one-shot CLI into a terminal chat interface. The long-term
goal is both a daily-driver chat and a persona testbed; **v1 leads with the
testbed**: holding a real multi-turn conversation while seeing what the SDK is
doing, so the system prompt can be iterated on. Polish (Markdown rendering,
richer layout) follows in a later version.

Success for v1:

- A natural multi-turn conversation in which Dorothy remembers earlier turns,
  with replies streaming smoothly and interruptible mid-reply.
- Per-turn stats, session info and a raw SDK event view on screen.
- Every conversation autosaved as a JSONL transcript that can be resumed.
- `bun run check` green, with the conversation logic covered by tests that never
  spawn the real subprocess.

## Constraints

- The Claude Agent SDK stays the backend for now; a later iteration moves to the
  Messages API. Nothing in the UI may depend on the SDK directly.
- The persona prompt and the lean options (`tools: []`, `settingSources: []`,
  `persistSession: false`, `includePartialMessages: true`) are unchanged.
- Single-user tool for the author's own terminal; not distributed.
- Runtime is Bun; the TUI uses Ink 7 with React 19.

## Out of scope for v1

- Live persona editing or prompt reload.
- Markdown rendering of replies (plain text only).
- Multi-line input.
- Persisting raw SDK events.
- The Messages API backend, and OpenTUI.

## Architecture

```text
src/
  persona.ts        systemPrompt + baseOptions (moved from index.ts, unchanged)
  session-id.ts     newPhrase(): four-word niceware phrase
  transcript.ts     JSONL event types, append-only writer, reader for --resume
  conversation.ts   Conversation: one long-lived query() fed by a message queue
  tui/
    App.tsx         wires Conversation and Transcript to the components
    Header.tsx      phrase, model, SDK session id, connection state
    History.tsx     finished turns via Ink's <Static> (terminal scrollback)
    LiveReply.tsx   streaming reply and the per-turn stats line
    RawPane.tsx     toggleable view of the last 20 SDK messages
    Input.tsx       single-line prompt box
  index.ts          calls dotenvx config(), then dispatches on argv
```

### `session-id.ts`

`newPhrase()` returns four lowercase words from the `niceware` package joined by
hyphens, for example `tumble-orchid-vapor-lantern` (8 random bytes, 64 bits).
The source of random bytes is injectable for tests. The phrase is Dorothy's
session id: it is shown in the header and names the transcript file. The SDK's
own session id must be a UUID (`Options.sessionId`), so the SDK keeps its own
id, which is recorded in the transcript but never used as Dorothy's id.

### `conversation.ts`

`Conversation` owns a single `query()` call in streaming input mode: its
`prompt` is an async iterable backed by a queue, so one `claude` subprocess
lives for the whole chat. The `query` function is injected so tests can replace
it with a scripted fake.

- `send(text)` pushes an `SDKUserMessage` onto the queue.
- `interrupt()` calls the query's `interrupt()`.
- `close()` ends the queue, which ends the session, and awaits the subprocess.
- Events, emitted to subscribers:
  - `ready { model, sdkSessionId }` from the `system`/`init` message.
  - `delta { text }` from `stream_event` `content_block_delta` `text_delta`.
  - `turn-end { reply, interrupted, stats }` from each `result` message.
  - `sdk { message }` for every SDK message, for the raw pane.
  - `error { message }` when the query throws or the subprocess exits.

Stats come from the `result` message: `usage` input and output tokens,
`ttft_ms`, `duration_ms` and `total_cost_usd`. `total_cost_usd` is treated as
the running session total, and the turn cost is the difference from the
previous `result`. The live smoke test confirms this; if it proves per-turn,
only that subtraction changes.

On resume, the prior turns are appended to the system prompt as a final
"conversation so far" section rather than sent as a fabricated user message, so
they never speak in the user's voice.

### `transcript.ts`

Transcripts live at `$XDG_DATA_HOME/dorothy/transcripts/<phrase>.jsonl`,
falling back to `~/.local/share` when `XDG_DATA_HOME` is unset. The file is
opened for append and written one event per line as events happen (autosave):

```jsonc
{"v":1,"kind":"session","at":"<iso8601>","phrase":"tumble-orchid-vapor-lantern","sdkSessionId":"<uuid>","model":"<model>","promptSha256":"<hex>","resumed":false}
{"v":1,"kind":"user","at":"<iso8601>","text":"What is your name?"}
{"v":1,"kind":"assistant","at":"<iso8601>","text":"I'm Dorothy.","interrupted":false}
{"v":1,"kind":"stats","at":"<iso8601>","inputTokens":12,"outputTokens":40,"ttftMs":900,"durationMs":2100,"costUsd":0.0012,"sessionCostUsd":0.0012}
```

- `v` versions the format so later backends can still read old files.
- `promptSha256` hashes the base persona prompt only (not the resume section),
  so transcripts group by persona version.
- `delta` events are not written; the final reply is written once as
  `assistant`.
- The reader returns the `user` and `assistant` lines in order and skips
  malformed lines, reporting how many it skipped.
- A resumed session keeps its phrase and appends a new `session` line with
  `"resumed": true` to the same file.

`transcript.ts` and `conversation.ts` do not import each other; `App.tsx`
subscribes the transcript writer to the conversation's events.

### Entry modes

Mode selection is a pure function, `parseArgs(argv, isTTY)`. Below, `dorothy`
stands for `bun run dev --` or `bun start --`:

| Invocation                  | Mode                                 |
| --------------------------- | ------------------------------------ |
| `dorothy "prompt"`          | One-shot, unchanged behaviour        |
| `dorothy` in a TTY          | TUI, new session                     |
| `dorothy --resume <phrase>` | TUI, resumed from that transcript    |
| `dorothy` without a TTY     | Usage message on stderr, exit code 2 |

## TUI

```text
 dorothy · tumble-orchid-vapor-lantern · <model> · sdk 3f2a…c91 · ready
 ───────────────────────────────────────────────────────────────────────
 you      What is your name?
 dorothy  I'm Dorothy! It's lovely to meet you.
          12 in · 40 out · ttft 0.9s · 2.1s · $0.0012 (session $0.0012)
 dorothy  Well, that depends on whether▍
 ─ raw (ctrl+r) ────────────────────────────────────────────────────────
 stream_event content_block_delta {"type":"text_delta","text":"whether"}
 ───────────────────────────────────────────────────────────────────────
 › _                        enter send · esc stop · ctrl+r raw · ctrl+c quit
```

The header's connection state is `starting` until `ready` arrives, then
`ready`, and `disconnected` after an `error`; model and SDK id show once known.
Finished turns render through `<Static>`, so only the header, live reply, raw
pane and input are redrawn. The input is locked while a reply streams and
unlocks on `turn-end`.

| Key               | Action                                 |
| ----------------- | -------------------------------------- |
| Enter             | Send                                   |
| Esc               | Interrupt the streaming reply          |
| Ctrl+R            | Toggle the raw pane                    |
| Ctrl+C            | Interrupt if streaming, otherwise quit |
| Ctrl+D or `/exit` | Quit                                   |

An interrupted reply is kept, marked `interrupted`, and its stats come from the
`result` that follows the interrupt.

## Error handling

- **Subprocess or query error** (auth, network, crash): the error shows in
  History in red and the header shows `disconnected`. Pressing Enter reconnects
  by starting a new session from the transcript, the same path as `--resume`.
- **Transcript write failure**: one warning in the header; the chat continues.
- **`--resume` with an unknown phrase or unreadable file**: exit before the TUI
  starts, naming the path that was tried.
- **Quit**: close the queue, await the subprocess so no `claude` process is
  left behind, then flush and close the transcript.

## Testing

Test-first, unit by unit. No test spawns the real subprocess or calls the API.

| Unit              | Coverage                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-id.ts`   | Four hyphenated words from niceware's list; deterministic with injected bytes                                                                                                      |
| `transcript.ts`   | Write and read back under a temporary `XDG_DATA_HOME`; `~/.local/share` fallback; malformed lines skipped and counted; turns extracted in order; resumed `session` line appended   |
| `conversation.ts` | Scripted fake `query`: `ready`, `delta`, `turn-end` with stats and cost difference, interrupted partial reply, `close()` ends the queue, resume section added to the system prompt |
| `index.ts`        | `parseArgs` for all four modes                                                                                                                                                     |
| `tui/*`           | `ink-testing-library` with a fake `Conversation`: header content, History, input lock while streaming, Ctrl+R toggle, Esc calls `interrupt()`                                      |
| `persona.ts`      | The existing tests, moved with the code                                                                                                                                            |

Manual smoke checkpoints:

1. Before building the TUI, a minimal Ink app renders and accepts input under
   Bun (Ink declares `node >=22`).
2. `bun run dev` holds a multi-turn chat, Esc interrupts, and the cumulative
   `total_cost_usd` assumption is confirmed.
3. Quit, then `bun run dev -- --resume <phrase>`: Dorothy recalls the earlier
   conversation.

`bun run check` stays green after every commit, and `bun run build` still
produces a working `dist/index.js` with the `.tsx` files compiled.

## Configuration changes

- `tsconfig.json`: `"jsx": "react-jsx"`.
- `package.json`: `ink`, `react`, `niceware` as dependencies; `@types/react`
  and `ink-testing-library` as dev dependencies. `Input.tsx` is hand-rolled on
  Ink's `useInput` (it must own Esc and Ctrl+R anyway), so `ink-text-input` is
  not added.
- `.commitlintrc.mts`: a `tui` scope for `src/tui/`.
