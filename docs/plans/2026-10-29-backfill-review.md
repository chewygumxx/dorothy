---
ctime: 2026-10-29
mtime: 2026-10-29
spdx: GPL-3.0-only
title: Reviewing backfilled conversations, implementation plan
description: >-
  Task-by-task plan for `dorothy --review-backfill`, a capped review of
  backfilled conversations through the service's reviewer.
tags:
  - dorothy
  - memory
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-29-backfill-review.md
   -
   -->

# Reviewing backfilled conversations, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `subagent-driven-development` to carry out this plan task by task, one
> subagent at a time, never in parallel. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** `dorothy --review-backfill [-n <count>]` reviews the newest
backfilled conversations, as
[the spec](../specs/2026-10-29-backfill-review-design.md) says.

**Architecture:** `memory` gains `runReviewBackfill`, which selects
backfilled sidecars, and for each takes the index's review claim, clears
the mark under the write lock and runs a `Reviewer` built as
`service/service.ts` builds it. `cli` parses the flag, loads secrets as
the model modes do, and passes the review call as the hooks' reviewer
receives it.

## Global Constraints

- Every new file carries the house header, copied from a sibling.
- Imports end in `.js`; packages import only what they declare;
  `workspace.test.ts` holds.
- Tests never touch `$XDG_DATA_HOME/dorothy`, `$XDG_STATE_HOME/dorothy`
  nor `secrets.json`: every root is a `mkdtemp` directory, and the model
  call is faked.
- No conversation title, model output or secret reaches a log beyond
  what the reviewer's own warnings already allow.
- Commits: Conventional Commits with a capitalised subject, header at
  most 50 characters, body lines at most 72, no agent trailers, no em
  dash; scopes `memory` and `cli`. Run `bunx biome check --write` first.
- Markdown lines at most 80 characters; AGENTS.md budgets hold.
- Test-first; `bun run check` passes before each task's last commit,
  with the XDG roots under a temporary directory.

## Review Focus

1. Only backfilled conversations are touched, the newest `-n`, and a
   mark is cleared only for a conversation whose review ran. Task 1.
2. A claim held by the service or a chat is skipped, never waited on or
   stolen. Task 1.
3. The reviewer is the service's, with its persona, vocabulary, history
   and lock, so a review here equals one there. Task 1.

### Task 1: `runReviewBackfill`

- [ ] Select backfilled conversations from the sidecars, newest first by
  their transcript's last event, up to `count` (default 25).
- [ ] For each: take the review claim, or skip it as held; clear the mark
  with `setBackfilled(..., false)` under the write lock; run the
  `Reviewer`; report `reviewed`, `marked`, `held` or `failed`; release
  the claim.
- [ ] Return the counts; tests over a temporary store as the spec's
  Testing says.

### Task 2: the CLI and documents

- [ ] `--review-backfill [-n <count>]` in `args.ts` and `--help`; the
  runner loads secrets and builds the call as the model modes do,
  prints a line a conversation and a total, and exits non-zero when
  every review failed.
- [ ] README (memory section) and `memory`'s and `cli`'s `AGENTS.md`.
- [ ] Tests for parsing and the runner with a fake call.

### Task 3: verification and record

- [ ] By the controller: a batch of 3 on the real store.
- [ ] `docs/reports/2026-10-29-backfill-review.md`.
