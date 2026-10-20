---
ctime: 2026-10-15
mtime: 2026-10-20
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
- `launches.ts`: a launch's notes in the state directory's
  `launches/<launch>/`: `launch.json`, written once by
  `dorothy --claude` with the boot id it was made in (`readBootId`,
  from `/proc/sys/kernel/random/boot_id` where Linux gives one), and
  `sessions/<session>.json`, one a session, written by its hooks. A
  note must match its path. `liveSession` is the one noted last,
  unless it has ended; else the one `--session-id` named;
  `launchHolds` says whether a launch not over holds a session, for
  `--reread`; `staleLaunches` are those over: made in another boot,
  whatever the pid, or whose `dorothy` is gone. Notes an earlier
  Dorothy left in the runtime directory (`legacyLaunchesDir`) are
  read there, caught up and removed, never moved.
- `state.ts`: `stateDir`, `$XDG_STATE_HOME/dorothy`, and the private
  files written whole there (`writePrivate`, `beside`: a temporary
  name of pid and random suffix).
- `record.ts`: `recordSession` records a session into its conversation
  under the store's lock: found by the index's `conversation_sessions`,
  or by a scan without the index; read from the line after the last
  recorded `sourceUuid`; each event stamped with its line's time and
  uuid; the session's row written into the index itself, whose lock is
  not re-entrant; one history commit, `turn: <phrase> (claude-code)`.
- `unread.ts`: what could not be read, under
  `$XDG_STATE_HOME/dorothy/unread/`: a halt's record and the transcript
  from its line on, and one example line of each new type, in a file
  named for the type (a hash of it too where it is not a plain name);
  the notices a hook leaves for the next start (`notices.jsonl`);
  `startNotices` for both bodies, which tells a type once by a
  `.told` marker made only if none is there, and `unreadReport` for
  `--check`. A record's `host` (Claude Code where absent) names another
  harness, whose files take `<host>-<hash of the id>`; atomic `logged/`
  markers tell each halt or missing-session error once. `--reread` and
  `--dismiss` stay Claude Code's.
- `log.ts`: the hook's log, `$XDG_CACHE_HOME/dorothy/claude-hook.log`,
  a message to one line however it breaks, rotated past 1 MB to one
  `.1` file (`rotate` moves it aside first, so a log another hook
  already rotated is not put over `.1`).
- `hook.ts`: `runClaudeHook`. A `Stop` records, syncs and reviews by
  chat's rule (`afterStop`); a `SessionEnd` notes its session and hands
  it to a detached catch-up; a catch-up does what `SessionEnd` would
  for each session of a launch (`afterEnd`), then removes its notes;
  `--reread` and `--dismiss` resolve or silence a halt. Reviews run
  through `memory/reviewer.ts`'s `Reviewer`, as chat's do, under the
  index's claims, with an agent asked for (`HookDeps.agent`) when one
  runs. The detached catch-up starts in the environment `claude` gave
  the hook, never this process's; a launch whose store could not be
  locked keeps its notes for the next start.

## Invariants

- A hook and a catch-up write nothing to the terminal, which Claude
  Code owns, and always exit 0. What went wrong is in the log, which
  names lines by type and uuid, a failed review by its phrase, kind
  and a call's error (`ReviewProblem`), and never holds a transcript's
  text, a title, the model's words or a parser's quote of a file.
- A line of a mapped type in a shape the reader does not expect halts
  the reading there: the lines before it are recorded, the rest is kept
  aside, and the user is told at every start until it reads or is
  dismissed. A type the reader neither maps nor lists is passed over
  and kept once.
- What is kept aside stays outside the data directory, so history, the
  mirror and the index never see it: directories `0700`, files `0600`.
- A transcript has one writer at a time: recording takes the store's
  lock, history's combined lock or the index's; with neither, nothing is
  recorded, and the next start says so.
- A session new to Dorothy is hers from the launch's start; one she
  recorded continues its conversation.
- The recall server reads the launch's notes (`DOROTHY_LAUNCH`) to leave
  the live session's conversation out and name it in `remember`.
- Nothing here talks to a model but through the `StructuredCall` it is
  given: the CLI's, on Dorothy's own credentials.
