---
ctime: 2026-10-15
mtime: 2026-10-18
spdx: GPL-3.0-only
title: packages/memory/src/compaction/AGENTS.md
description: >-
  How a long conversation is compacted into clusters, each with an
  abstract.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/memory/src/compaction/AGENTS.md
   -
   -->

# packages/memory/src/compaction/AGENTS.md

Past `[compaction] soft` tokens, at the next idle (past `hard`, before the
next message), `compact()` (`compact.ts`) splits the turns before the
verbatim tail into topical clusters with an abstract each.

## Files

- `clusters.ts`: the prompt and its checks.
- `plan.ts`: the turns' ranges and pressure.
- `session.ts`: `Compaction` wraps the session.
- `run.ts`, on `shared.ts`'s state: a pass first checks (`ready`) that the
  notes can be read and the turns leaving are the transcript's own at
  those numbers (`turnsAgree`, in `memory/open.ts`), for another chat on
  the conversation puts its turns between this chat's, and compaction is
  then off until the next launch. It appends the clusters to the sidecar,
  writes a `compaction` transcript event, and swaps in a session seeded
  with the abstracts and the turns after them.

## Tests

`Compaction`'s tests are one file a topic, `session*.test.ts`: handover
and holding, chains, quitting, claims, saves and interrupts. They share
`testing.ts`'s harness and fixtures.
