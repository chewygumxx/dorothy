---
ctime: 2026-10-29
mtime: 2026-10-29
spdx: GPL-3.0-only
title: Reviewing backfilled conversations
description: >-
  Design spec for `dorothy --review-backfill`, which reviews backfilled
  conversations in capped batches through the reviewer the hooks and
  service use, on the user's Claude plan.
tags:
  - dorothy
  - memory
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-29-backfill-review-design.md
   -
   -->

# Reviewing backfilled conversations

## Summary

[Recording](./2026-10-20-recording-design.md) marks a backfilled
conversation so no review runs on it, to spare some 300 paid calls; the
spec left "a capped review of backfilled sessions" for later. On
2026-10-29 the user found 305 of 314 sidecars empty, no title, abstract,
tags or knowledge, and chose to review them on the Claude plan the
reviews already use, after a baseline evaluation on the frozen
snapshot, so a rerun measures what reviews add.

## Decisions

| Decision | Choice | Why, and the cost if wrong |
| --- | --- | --- |
| Trigger | `dorothy --review-backfill [-n <count>]`, run by the user or the agent | Spending a plan's usage is a choice. Cost: a command per batch |
| Batch | `-n`, default 25; newest first | A plan's limits are watched between batches; recent work matters most. Cost: about 12 batches for 305 |
| Reviewer | The `Reviewer` the service builds, with its persona, vocabulary, history and lock | One review, wherever it runs. Cost: none |
| Mark | Cleared under the lock, as a live record clears it, just before the review; a failed model call (thrown, or reported by the reviewer) restores the mark and the earlier failures under the lock and stops the batch | A limit or an outage would fail every call after it, and a conversation left unmarked is offered no more by the command. The rest stay marked and untouched. Cost: a conversation failing for another reason (notes, save) stays unmarked, and a chat's catch-up retries it |
| Running service | The command takes the review claim the index holds, which keeps chats and hooks off the conversation; the service takes no claim | The service reviews only conversations a live record queued. Cost: a live record during a batch may bring one extra review, merged under the lock |
| Output | A line a conversation (its phrase and `reviewed`, `marked`, `unchanged`, `held` or `failed`), a total, and where a failed call stopped the batch, why, with exit 1 | Progress through a long batch. Cost: none |

## Later

- The service's reviews to take the index's review claim, as chats and
  hooks do, closing the overlap above for every reviewer.

## Testing

Over a temporary store with backfilled and live conversations and a
fake call: the newest `-n` backfilled ones reviewed, live ones and the
rest untouched; the mark cleared only for those reviewed; a failed call
restoring its conversation's mark and stopping the batch, the rest
untouched; a held claim skipped.

## Verification

A batch of 3 on the real store, its sidecars then holding titles,
abstracts and tags.
