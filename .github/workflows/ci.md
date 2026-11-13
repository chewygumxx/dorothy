---
ctime: 2026-11-11
mtime: 2026-11-11
spdx: GPL-3.0-only
title: .github/workflows/ci.md
description: >-
  What ci.yaml is for and promises: the shared standard checks, then this
  repository's own check against the commit the header sync pushed.
tags:
  - ci
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/.github/workflows/ci.md
   -
   -->

# .github/workflows/ci.md

`ci.yaml` runs two jobs, in this order. `pairs.test.ts` fails if the jobs
named here and the jobs in `ci.yaml` differ.

- `standard`: the shared standard checks (commitlint, header sync, generic
  lint and format, metadata sync), from `chewygumxx/.github`.
- `check`: this repository's own `bun run check`, run against the commit
  the header sync pushed, not the one that triggered the workflow.

A newer run never interrupts an earlier one: the header sync commits and
pushes, and cancelling it part-way through would leave that commit half
made.

A `workflow_dispatch` run re-runs the metadata sync once the
`METADATA_APP_*` secret and variable are corrected.
