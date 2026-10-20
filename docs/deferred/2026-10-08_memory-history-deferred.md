---
ctime: 2026-10-08
mtime: 2026-10-20
spdx: GPL-3.0-only
title: Memory history deferred findings
description: >-
  History growth and bundle accumulation retained by the roadmap sweep.
tags:
  - dorothy
  - memory
  - history
  - deferred
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/deferred/2026-10-08_memory-history-deferred.md
   -
   -->

# Memory history deferred findings

The roadmap sweep closed the parked behaviours, small code points and
all test gaps from `feat/memory-history`. See the
[sweep report](../reports/2026-10-19-roadmap-sweep.md#task-6-history).

## Later work

- **Bundles accumulate and history grows without bound.** The sweep left
  consolidation and pruning because they rewrite or remove history and
  need their own design, as the
  [history spec](../specs/2026-10-08-memory-history-design.md#later) and
  [sweep spec](../specs/2026-10-19-roadmap-sweep-design.md#left-and-why)
  require.
