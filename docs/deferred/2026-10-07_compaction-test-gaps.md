---
ctime: 2026-10-07
mtime: 2026-10-20
spdx: GPL-3.0-only
title: Compaction test gaps
description: >-
  What the compaction branch's tests still leave open: a live check of a
  split into several clusters, which costs API calls.
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

Branch `feat/compaction` (as of 07419db). Collected from the per-task
reviews, the whole-branch reviews and the follow-up reviews. The roadmap
sweep wrote a test for every behaviour that held without one, among them
an end to end test of turn numbering across App, the transcript, the
sidecar, the index and `recollect`
(`packages/memory/src/memory/open-compaction.test.ts`); only the live
checks remain.

## Highest value

1. **A topical split into several clusters, live.** The live probe (tail
   500) compacted one exchange per call, so the split was only exercised
   by unit tests and, since the sweep, by the end to end test with a
   fake model. Costs API calls.

## Live checks

Checks that drive a live chat, such as item 1 above and the live probe in
`docs/reports/2026-10-07-compaction.md`, are to run through herdr once its
skill is in `.claude/`, rather than through tmux as that report did.
