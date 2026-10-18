---
ctime: 2026-10-18
mtime: 2026-10-18
spdx: GPL-3.0-only
title: Dorothy's memory contract implementation
description: >-
  Progress, rulings and verification of the memory contract plan, carried
  out task by task by subagents on the branch feat/memory-contract.
tags:
  - dorothy
  - memory
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-18-memory-contract.md
   -
   -->

# Dorothy's memory contract implementation

## Summary

The [plan](../plans/2026-10-18-memory-contract.md) for the
[memory contract](../specs/2026-10-18-memory-contract-design.md) is
carried out on the branch `feat/memory-contract`, from `main` at
`3141323`, one subagent at a time: an implementer per task, then a
reviewer of its diff. Each task's outcome is recorded here as it
completes, so a later session resumes at the first task not marked
complete.

## Rulings

1. The preflight scan for conflicts between tasks was cut short, as
   usage was scarce; the plan had already passed two review rounds
   (`42f628b`, `d29a7a1`). If wrong, a conflict costs a fix round when
   it surfaces.
2. Implementers and reviewers run on a mid-tier model, as the plan
   carries its code in full. If wrong, a weaker pass costs a fix round.

## Tasks

Each entry gives the task, its commits and its review.

### Task 1: the service table and the extraction cap

Complete in `7c55313`; review clean, and `config.test.ts` passes 32 of
32. Minor findings deferred to the final review:

- "reads both tables" asserts nothing of `service` under `toEqual`, as
  the plan wrote it.
- The `listen` address pattern admits values such as `-` or `:`, as the
  plan wrote it; a failed bind must surface as a clear error.
- No test covers `listen`'s de-duplication, a `listen` not a list, a
  port out of range or an `extract-cap` over 100.
- `README.md` names neither `extract-cap` nor `[service]`; Task 19
  documents them.

### Task 2: facts in the Open Knowledge Format

Complete in `076fe1d`; review clean, and the whole suite passes 1750 of
1750. Minor findings deferred to the final review:

- `actorOf` renders any `host`, but `writingOf` refuses one outside
  `HOST`: whatever first sets `host` must check it the same way.
- `dorothy.origin` and `generated.by` are not checked against each
  other, so `extraction` written by a user re-renders as `model`.
- A hand-edited `dorothy.metadata.type` is dropped without an error.
- Tests do not cover `retired` without `deprecated`, bad foreign keys,
  `otherSources`, `handEdited` keeping foreign keys, or `generated`
  without `dorothy.origin`.
- Foreign keys and other sources have no size cap; `readCommon` serves
  only `legacy.ts`.

`packages/memory/AGENTS.md` still calls `file.ts` the one canonical
form until Task 19, and old fact files do not parse until Task 4
migrates them.

### Task 3: the knowledge directory

Complete in `f21020e`; review clean, and the memory package passes 1145
of 1145. A search found no hard-coded `facts/` data path left. Minor
findings deferred to the final review:

- A comment in `store.ts` says "today's `scopeDir`", as the plan wrote
  it, and will go stale.
- No test pins the old `facts/personal/` layout as `other` in the lint,
  nor passes `under` a directory other than the default.

## Verification

Recorded at the end of each part, with `bun run check`.
