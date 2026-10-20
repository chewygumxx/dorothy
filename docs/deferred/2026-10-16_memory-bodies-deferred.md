---
ctime: 2026-10-16
mtime: 2026-10-20
spdx: GPL-3.0-only
title: Memory bodies deferred findings
description: >-
  Review factoring and probe caveats retained by the roadmap sweep.
tags:
  - dorothy
  - memory
  - deferred
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/deferred/2026-10-16_memory-bodies-deferred.md
   -
   -->

# Memory bodies deferred findings

The roadmap sweep closed the launch-note, recording, hook and CLI code
findings from `feat/memory-recording` (#24), including mixed history/index
locking in Task 6. See the
[sweep report](../reports/2026-10-19-roadmap-sweep.md#task-3-recording).

## The review

`Reviewer` and `MemoryService` still each call the pure `buildMemory`
function with their own arguments. The sweep left these calls because
the service also supplies reserved space and warnings; sharing stateful
lock and recording helpers and precomputing names closed the actionable
parts of the original finding.

## Probe method caveats

The [bodies report](../reports/2026-10-15-memory-bodies.md) keeps its
print-mode async timings and its three-second survival check. The sweep
left them because the saved output contains no alternate timings, and
the sleep is a method caveat rather than a figure to correct. The saved
`hooks.json` has a `clear` marker before the compact run's `survived`,
but still shows all nine SessionEnd hooks followed by `survived`, as
claimed. Its user-line count was corrected to 17 strings (14 plain,
one summary, two isMeta).
