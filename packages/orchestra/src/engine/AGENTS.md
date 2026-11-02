---
ctime: 2026-11-02
mtime: 2026-11-02
spdx: GPL-3.0-only
title: packages/orchestra/src/engine/AGENTS.md
description: >-
  The orchestra's engine: workers on acpx's embedded runtime, each in its
  box with one session for its life, their turns, statuses and waits.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/orchestra/src/engine/AGENTS.md
   -
   -->

# packages/orchestra/src/engine/AGENTS.md

The workers, and the functions the server's tools call.

## Files

- `engine.ts`: `Engine`. `start` refuses at once an agent outside
  `[orchestra] agents`, an API key login without its key in the secrets
  passed in, a repository whose origin names no GitHub repository, a
  branch a live worker holds and a start past `max-workers`; else it
  names the worker (`codex-1`) and begins its start operation: the base,
  the reservation (a refusal deleting the base ref), the clone, the
  session, then the task as its first turn. `prompt`, `stop`, `read`,
  `wait` (at most `WAIT_SECONDS`), `list` and `close` serve the other
  tools; `operations` is the server's `Operations`, whose close stops
  every worker.
- `session.ts`: `openSession`, a worker's box behind its own proxy and,
  for an API key, gateway; an acpx runtime of its own, `deny-all`, no
  filesystem or terminal, its permission callback the gate; one
  persistent session set to the box's mode (`MODES`). `oneBox` refuses
  a second spawn and reports the agent's exit. acpx's types stay here.

## Invariants

- A worker has one agent process, one box and its home, for its life:
  no turn timeout, and its agent exiting or starting again fails it,
  its session lost, its clone and reservation kept.
- Each turn runs only after the session reports the box's mode
  (Codex's `workspace-write`, Claude's `default`); any other fails the
  worker before its turn.
- The gate gets a worker's clone and cwd from the engine, never from
  its output; a worker's end aborts its gate's signal and stops its
  questions, and every decision reaches the server's log.
- A worker's turns are operations queued under its name, so they run in
  order, and `stop` cancels those pending.
- Startup broker reads and preparation carry cancellation through every
  process; close cancels preflight reads too. Each worker shares one
  cleanup promise, including resources acquired as startup unwinds.
