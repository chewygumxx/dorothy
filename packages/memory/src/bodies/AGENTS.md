---
ctime: 2026-10-15
mtime: 2026-10-16
spdx: GPL-3.0-only
title: packages/memory/src/bodies/AGENTS.md
description: >-
  How memory serves Dorothy's bodies other than chat: what dorothy --claude
  asks of it, and the hooks that record her Claude Code sessions.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/memory/src/bodies/AGENTS.md
   -
   -->


# packages/memory/src/bodies/AGENTS.md

Dorothy's bodies other than chat. Chat opens memory with `openMemory`;
`dorothy --claude` asks memory, through the package's `"."` entry
point, for what its launch needs, and Claude Code's hooks run
`dorothy --claude-hook`, served from `"./claude-hook"`, which loads the
reader, the store and reviews alone. The CLI loads both lazily.

## Files

- `launch.ts`: `claudeBlock` renders chat's memory block with chat's
  code, preamble and budget, leaving out the conversation of a session
  resumed by id; `syncDirectory` syncs the project of the directory
  `claude` starts in, under the index's lock, history committing
  without the mirror.
- `claude-code.ts`: `readLines`, Claude Code's transcript lines as
  Dorothy's events, pure; `BOOKKEEPING` lists the types passed over in
  silence. `fixtures.ts` holds lines shaped as the recording probe
  found them, for its tests and the hook's.
- `launches.ts`: a launch's notes in the runtime directory's
  `launches/<launch>/`: `launch.json`, written once by
  `dorothy --claude`, and `sessions/<session>.json`, one a session,
  written by its hooks. `liveSession` is the one noted last, else the
  one `--session-id` named; `staleLaunches` are those whose `dorothy`
  is gone.
- `record.ts`: `recordSession` records a session into its conversation
  under the store's lock: found by the index's `conversation_sessions`,
  or by a scan without the index; read from the line after the last
  recorded `sourceUuid`; each event stamped with its line's time and
  uuid; the session's row written into the index itself, whose lock is
  not re-entrant; one history commit, `turn: <phrase> (claude-code)`.
- `unread.ts`: what could not be read, under
  `$XDG_STATE_HOME/dorothy/unread/`: a halt's record and the transcript
  from its line on, and one example line of each new type; the notices
  a hook leaves for the next start (`notices.jsonl`); `startNotices`
  for both bodies and `unreadReport` for `--check`.
- `log.ts`: the hook's log, `$XDG_CACHE_HOME/dorothy/claude-hook.log`,
  rotated past 1 MB to one `.1` file.
- `hook.ts`: `runClaudeHook`. A `Stop` records, syncs and reviews by
  chat's rule (`afterStop`); a `SessionEnd` notes its session and hands
  it to a detached catch-up; a catch-up does what `SessionEnd` would
  for each session of a launch (`afterEnd`), then removes its notes;
  `--reread` and `--dismiss` resolve or silence a halt. Reviews run
  through `memory/reviewer.ts`'s `Reviewer`, as chat's do, under the
  index's claims.

## Invariants

- A hook and a catch-up write nothing to the terminal, which Claude
  Code owns, and always exit 0. What went wrong is in the log, which
  names lines by type and uuid and never holds a transcript's text.
- A line of a mapped type in a shape the reader does not expect halts
  the reading there: the lines before it are recorded, the rest is kept
  aside, and the user is told at every start until it reads or is
  dismissed. A type the reader neither maps nor lists is passed over
  and kept once.
- What is kept aside stays outside the data directory, so history, the
  mirror and the index never see it: directories `0700`, files `0600`.
- A transcript has one writer at a time: recording takes the store's
  lock, the index's or history's; with neither, nothing is recorded and
  the next start says so.
- A session new to Dorothy is hers from the launch's start; one she
  recorded continues its conversation.
- The recall server reads the launch's notes (`DOROTHY_LAUNCH`) to leave
  the live session's conversation out and name it in `remember`.
- Nothing here talks to a model but through the `StructuredCall` it is
  given: the CLI's, on Dorothy's own credentials.
