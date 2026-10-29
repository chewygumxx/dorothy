---
ctime: 2026-10-29
mtime: 2026-10-29
spdx: GPL-3.0-only
title: Reviewing backfilled conversations
description: >-
  `dorothy --review-backfill`: its tasks, rulings, reviews, and the
  first batch on the real store.
tags:
  - dorothy
  - memory
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-29-backfill-review.md
   -
   -->

# Reviewing backfilled conversations

## Summary

305 of the store's 314 sidecars were empty: backfilled conversations,
which recording keeps from every review. The user chose to review them
on their Claude plan, after a baseline evaluation on the frozen
snapshot. Following [the spec](../specs/2026-10-29-backfill-review-design.md)
and [the plan](../plans/2026-10-29-backfill-review.md),
`dorothy --review-backfill [-n <count>]` reviews the newest backfilled
conversations in batches, 25 by default, through the reviewer the
service builds. Codex built Task 1 until its five-hour limit neared;
Claude subagents then took the fix rounds and Task 2, at the user's
word, and reviewed every task and the branch.

## Rulings

1. The service takes no review claim, so the command's claim keeps
   chats and hooks off a conversation, not the service; the spec says
   so, and the service's taking claims is left for later. Cost if
   wrong: a live record during a batch may bring one extra review,
   merged under the lock.
2. A failed model call restores that conversation's mark, and its
   failure stamp as it was, and stops the batch, leaving the rest
   marked. Otherwise a plan limit or an outage would unmark a whole
   batch within seconds, never to be offered again, and chat catch-ups
   would retry them on the plan unbidden. Cost if wrong: a transient
   failure ends a batch early, and a rerun resumes it.
3. A review that writes nothing, a backoff or a mark cleared by a live
   append, reports `unchanged`, apart from `marked`, which wrote notes.
   Cost: none.

## Reviews

Task 1's review found a bare `catch` that hid every failure's reason
and gave a thrown call no backoff, and the spec's premise about the
service; both were settled in one fix round. Task 2's review approved
it. The whole-branch review found the failing batch above, settled in a
final fix pass; its re-review found nothing new. A pre-existing reviewer
warning quotes a conversation's title on stderr; on the user's own
terminal, as chat shows it, it stays.

## Verification

`bun run check` passes under temporary XDG roots: 3,383 tests, one
existing skip. With the real store, backed up first, by the controller:
`bun run dev -- --review-backfill -n 3` reviewed the three newest in
58 s and exited 0, with two commits a conversation (the cleared mark,
the review). Each sidecar then held a title of 47 to 58 characters, an
abstract of some 950 and two or three tags, with its mark cleared; 302
conversations stay marked.
