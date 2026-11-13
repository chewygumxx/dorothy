---
ctime: 2026-11-01
mtime: 2026-11-04
spdx: GPL-3.0-only
title: packages/memory/src/hooks/AGENTS.md
description: >-
  dorothy --hook for the hosts other than Claude Code: Codex's hooks and
  her Hermes provider, and dorothy --pi-hook for her Pi extension.
tags:
  - agents
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/packages/memory/src/hooks/AGENTS.md
   -
   -->

# packages/memory/src/hooks/AGENTS.md

`dorothy --hook <host> <event>` for hosts other than Claude Code, whose
hooks are in [bodies](../bodies/AGENTS.md).

## Files

- `payload.ts`: `parseHookInput` reads Codex's hook payload, and her
  Hermes provider's in the same shape, into a session, a working
  directory, a block reason and a prompt; null for anything else.
- `run.ts`: `runHostHook` finds the project, starts the service where
  it can, and answers the block or recall in Codex's hook shape; `""`
  for nothing or any failure, never a throw. `hostContext` is its answer
  as text, null when the service gave none, which Pi's hook shares.
- `pi.ts`: `runPiHostHook`, `dorothy --pi-hook`'s JSON (`PiHookRequest`,
  `PiHookReply`), which `host-hook.ts` imports when it runs, so Codex's
  and Hermes's hooks never load it, the Pi source or `bun:sqlite`
  (`lazy.test.ts`). A start or prompt asks for the archive segment owning
  the active leaf, or the native session where the file names none: a
  fork held for its parent gets `pi_ancestry_missing` and no guess. A
  settled turn sends the leaf's segment, an end every one, ended, read by
  [the Pi source](../recording/AGENTS.pi.md) and sent through `record`,
  the CLI's client queue, in parts of 4 MiB at most. Private, file-less
  or refused sessions are `off`; `delivered` only when every part was
  taken and the file holds nothing back. Records take the project of the
  file's header cwd, as the sweep's do; context the request's `cwd`. A
  file of another session than `sessionId` is neither mapped nor sent.
  Warnings are stable codes: `pi_request_invalid`, `pi_session_outside`,
  `pi_session_unreadable`, `pi_session_mismatch`, `pi_ancestry_missing`,
  `pi_session_halted`, `pi_record_queued` and `pi_memory_unavailable`.
  Never a throw.
- `fixtures.ts`: the payloads Task 1's probe recorded.
