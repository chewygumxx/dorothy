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
| Mark | Cleared under the lock, as a live record clears it, just before the review | A failed review then retries as any other does. Cost: a conversation whose review fails is reviewed by the service later |
| Running service | The command takes the review claim the index holds, so the service never reviews the same conversation at once | As two chats never do. Cost: none |
| Output | A line a conversation (its phrase and `reviewed`, `marked` or `failed`) and a total | Progress through a long batch. Cost: none |

## Testing

Over a temporary store with backfilled and live conversations and a
fake call: the newest `-n` backfilled ones reviewed, live ones and the
rest untouched; the mark cleared only for those reviewed; a failed call
leaving its conversation for a later review; a held claim skipped.

## Verification

A batch of 3 on the real store, its sidecars then holding titles,
abstracts and tags.
