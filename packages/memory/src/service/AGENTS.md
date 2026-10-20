---
ctime: 2026-10-20
mtime: 2026-10-20
spdx: GPL-3.0-only
title: packages/memory/src/service/AGENTS.md
description: >-
  How the service and dorothy --sweep bind the recording sweep to the
  store, and when the service runs it.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/memory/src/service/AGENTS.md
   -
   -->

# packages/memory/src/service/AGENTS.md

The service's HTTP side is in [the contract's guide](../contract/AGENTS.md).
This guide holds what binds [the sweep](../recording/AGENTS.md) to a store.

## Files

- `recording.ts`: `sweepBinding` and `sweepDeps` give the sweep its
  `record` (the contract's `acceptRecord`, returning the conversation's
  phrase from the shared `sessions`), `recordClaude` (syncs before its first
  record per sweep), `conversation` (syncs
  the index, then looks the session up), `isPrivate` and `onRecorded`.
- `jobs.ts`: `startJobs` also runs `sweep` at the start and every
  `[recording] sweep-seconds`, one at a time, a line of counts to the log
  (`recording/report.ts`); `stop()` awaits one under way.
- `sweep-command.ts`: `runSweep`, for `dorothy --sweep`, opens the index and
  history as a hook does and prints a host and a count a line;
  `--backfill` records the backlog; `--reread` reads the halted sessions
  alone, whatever is set, and says which read to the end;
  `runSweepDismiss` stops a notice.

## Invariants

- `[recording] hosts` is empty by default: nothing is swept unless set.
  The service's first sweep starts as it serves, not holding up its start.
- The store's lock is taken only inside `acceptRecord` and
  `recordSession`, which both take it themselves: the sweep holds none
  while calling them, so nothing nests.
- None of Claude Code, Codex or Hermes marks a session private in its
  store, so `isPrivate` is false for them; OpenClaw's incognito will answer
  there when its reader joins.
- `onRecorded` calls `noteRecorded`: a backfilled phrase joins the
  backfilled set, a live one is queued for extraction and unmarked; the
  project joins `touched`. Recorders also persist a sidecar mark under
  the lock. Every reviewer and extraction reads it, across processes;
  only a live append clears it, including after a foreground sweep.
- A halted session of a harness besides Claude Code is told with
  `dorothy --sweep --reread` and `--sweep --dismiss <host> <session>`;
  Claude Code's keep `--claude-hook --reread` and `--dismiss`.
- The service and a foreground sweep may overlap: the store's lock orders
  their records, and `sweep.json` holds only skip hints.

## Tests

Temporary roots and rollouts of synthetic text; a lock that fails if
nested; no real store, no model.
