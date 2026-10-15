---
ctime: 2026-10-15
mtime: 2026-10-15
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
- `run.ts`, on `shared.ts`'s state: a pass appends the clusters to the
  sidecar, writes a `compaction` transcript event, and swaps in a session
  seeded with the abstracts and the turns after them.
