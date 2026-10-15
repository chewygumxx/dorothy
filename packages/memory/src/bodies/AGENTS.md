---
ctime: 2026-10-15
mtime: 2026-10-15
spdx: GPL-3.0-only
title: packages/memory/src/bodies/AGENTS.md
description: >-
  How memory serves Dorothy's bodies other than chat: what dorothy --claude
  asks of it.
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
`dorothy --claude` asks it only for what its launch needs, through the
package's `"."` entry point, which the CLI loads lazily.

## Files

- `launch.ts`: `claudeBlock` renders chat's memory block with chat's
  code, preamble and budget, leaving no conversation out, and
  `syncDirectory` syncs the project of the directory `claude` starts
  in, under the index's lock, history committing without the mirror.
- `claude-code.ts`: `readLines`, pure: Claude Code's transcript lines in,
  Dorothy's events out, each with its line's uuid and time. A line of a
  mapped type in a shape it does not expect halts the reading there; a
  type it neither maps nor lists in `BOOKKEEPING` is passed over and
  reported. `fixtures.ts` shapes the lines for tests.

## Invariants

- Nothing here talks to a model or writes to the terminal but through
  what it returns: the CLI reports, before `claude` takes the terminal.
- The recording plan adds the hook here, which reads the transcript
  files and appends what the reader returns.
