---
ctime: 2026-10-07
mtime: 2026-10-07
spdx: GPL-3.0-only
title: Compaction test gaps
description: >-
  Behaviours on the compaction branch that hold today but have no test of
  their own, left for a later review.
tags:
  - dorothy
  - sdk
  - deferred
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/deferred/2026-10-07_compaction-test-gaps.md
   -
   -->

# Compaction test gaps

Branch `feat/compaction` (as of 07419db). Collected from the per-task reviews,
the whole-branch reviews and the follow-up reviews; entries later tests
covered are gone. None blocks merge; each is a behaviour that holds today (by
reading or by an indirect test) but has no test of its own.

## Highest value

1. **Turn numbering, end to end.** No single test drives App with a
   `Compaction` over fake `Conversation`s and a real `TranscriptWriter` in a
   temp dir, then reads the transcript back, syncs an index and calls
   `recollect`. The final review checked by hand that App, the wrapper, the
   transcript, sidecar clusters, the index `clusters` table and `recollect`
   all count the same turns; this test would pin it.
2. **A topical split into several clusters, live.** The live probe
   (tail 500) compacted one exchange per call, so the split was only
   exercised by unit tests. Costs API calls.

## By task

- **Task 3** (`src/memory/sidecar.test.ts`): the "stop at the first
  invalid" test derives its expected value from the input
  (`clusters[0]?.from === 1 ? [4] : []`) and loops without a per-case
  message, so a failure doesn't say which case.
- **Task 5** (`src/recall/store.test.ts`, `sync.test.ts`):
  `expect(SCHEMA_VERSION).toBe(2)` pins the constant and will fail on the
  next bump (plan-mandated; consider asserting the rebuild instead); the
  growth test checks only the row count, not that the new row is
  `n: 2, first: 5, last: 6`.
- **Task 7** (`src/persona.test.ts`, `src/memory/block.test.ts`): the
  cluster rendering is asserted in both files; no explicit
  `conversationOptions` test that recall on with no clusters gives no
  `--recollect` (covered only implicitly by the older recall test).
- **Task 8** (`src/memory/service.test.ts`, `review.test.ts`,
  `block.test.ts`): no service-level test that the over-budget warning from
  `block(reserved)` fires once per run; no review test that a pending read
  made in a compacted turn is listed in `<reads>` with no mark in the text
  (a spec sentence); the `unescapeXml` test sits outside a `describe`.
- **Task 9** (`src/structured.test.ts`): the cancel-during-the-call case
  doesn't assert `hang.closed`; no direct tests for a `queryFn` that throws
  synchronously, or for `subtype: "success"` with `is_error: true`.
- **Task 10** (`src/compaction/plan.test.ts`): `outgoing` with no user turn
  (`lastUser === -1`) is untested; no test for a cluster reaching past the
  last user turn (e.g. `outgoing(SIX, [cluster(1, 5)], 1)` is null).
- **Task 11** (`src/compaction/clusters.test.ts`, `compact.test.ts`): no
  test for a non-object cluster item (`clusters: ["x"]`); none for an
  abstract of exactly 1000 code points, or with astral characters; every
  `compact` test passes `clusters: []`, so the hand-off of `outgoing` past
  earlier clusters into `clusterPrompt` is never exercised end to end.
- **Task 12** (`src/compaction/session.test.ts`): the quit tests don't
  exercise the abort guard after Dorothy's call in `run.ts`: the harness's
  fake call answers `cancelled` on abort, so removing the guard still
  passes (checked by removing it). Add `expect(warnings(h.events)).toEqual([])`
  and a variant where the call returns clustered output after the abort.
  And the composition of a real `Compaction` inside `trackMemory`
  (turn-ends, `ready`, flushes) is tested only with a structural fake,
  because `src/tui/` may not import `src/compaction/` outside `run.tsx`.
- **Task 14** (`src/dump.test.ts`): no test pins `reserved` (the abstracts'
  tokens charged first in the dumped memory block), nor the fallback to the
  full history when the sidecar is unparseable or missing.

## Live checks

Checks that drive a live chat, such as item 2 above and the live probe in
`docs/reports/2026-10-07-compaction.md`, are to run through herdr once its
skill is in `.claude/`, rather than through tmux as that report did.
