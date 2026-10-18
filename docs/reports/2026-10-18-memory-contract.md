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

### Task 4: moving facts/ to knowledge/

Complete in `336c9c0` and `3a29dbb`, after one fix round. The review
found two faults in the plan's code, and both rulings below keep user
data safe where the spec's Migration section says nothing:

- `migrateFacts` wrote a legacy fact over an existing `knowledge/` file
  and deleted the legacy copy. Ruling: it now leaves the legacy file in
  `facts/` and warns, as a knowledge file may be newer and not yet
  committed by history. If wrong, a duplicate waits in `facts/` for the
  user.
- One file failing to read or write stopped the migration, and with it
  recall's sync and history. Ruling: it now warns of that file, leaves
  it in place and moves the rest. If wrong, a failure is quieter than an
  abort.

The re-review found both addressed. Minor findings deferred to the
final review:

- The unreadable-file test relies on `chmod 000`, which root ignores.
- The unwritable-target test fails at the existence check, not the
  write; a file made between check and write would still be
  overwritten, though the store's lock is held.
- Files in `facts/` the store does not list are left unmentioned, a
  leftover warns on every launch, and pruning follows a linked
  directory.

### Task 5: the contract's types

Complete in `f087d1b`; review clean, and `core` passes 75 of 75. The
implementer added the `contracts/memory.ts` bullet to
`packages/core/AGENTS.md` that Task 19 was to add. Ruling: the bullet
stays, and Task 19 moves it after the `contracts/recall.ts` bullet
rather than adding a second. If wrong, one bullet sits a line off.
Minor finding deferred: the tests check neither a `.` segment in a
memory id nor the length cap of a host id.

### Task 6: the contract's schemas

Complete in `80f5b1b`; review approved, and the contract's tests pass
5 of 5. The review found, as the plan wrote it, that the `open` and
`remember` tool ids are checked for length alone. Ruling: the schemas
stay so, as `remember` (Task 12) and the `open` tool (Task 13) run
`parseMemoryId` on them. If wrong, a malformed id reaches a handler
that forgets to parse it; the final review checks both. Minor findings
deferred to the final review:

- `search`'s `after` and `before` are unchecked strings, and event
  texts and response arrays have no cap but the body's 8 MiB.
- `from` is not checked against `through`, and a private record may
  still carry a transcript.
- A strict schema's message names the unknown key the client sent.
- The tests cover the plan's cases alone, not the responses, the tool
  shapes or the caps.

### Task 7: host profiles

Complete in `8cfd322`; review clean, and the profiles' tests pass 3 of
3. Minor findings deferred to the final review:

- A profile that is not JSON throws without naming its file, and a
  schema failure reports its first issue alone, without the field.
- An empty profile directory loads without complaint.
- The test of the shipped profiles checks two of their values.
- Codex's profile allows 512 characters of instructions, where the
  constraints say under 512; Task 13's instructions settle it.

### Task 8: the engine interface and the baseline engine

Complete in `556cfbb` and `f6ac009`, after one fix round; the memory
package passes 1169 of 1169. The review found two faults:

- The baseline narrowed a search to its scope only after recall cut it
  to ten, so a scoped search could come back empty while matches
  existed. Ruling: narrow before the cut, without changing recall for
  its present callers. `recall/query.ts` gained an optional `within`.
  If wrong, a costlier query.
- Search gave retired facts as live, which the block's ranking leaves
  out. Ruling: the baseline drops them. If wrong, a retired fact is
  found by `--facts` alone.

The re-review found both addressed. Minor findings deferred to the
final review:

- The baseline's `extract` lets the reviewer write notes and tags
  itself, as the plan has it, and its index sync may run the facts
  migration without the store's lock.
- A project lookup runs once a hit, outside the index's exclusive
  section; `rankEpisodes` uses the clock, not the `now` passed in, and
  drops the catalogue's warnings; its comparator breaks on a bad date;
  `extract` drops the review's outcome.
- Tests do not cover the `all` and `episodes` kinds, `exclude` or a
  missing reviewer; `knowledgePath` would sit better beside the
  interface.

## Verification

Recorded at the end of each part, with `bun run check`.

Part 1, at `3a29dbb`:

```text
$ bun run check
 1758 pass
 1 skip
 0 fail
 136103 expect() calls
Ran 1759 tests across 104 files. [19.52s]
```
