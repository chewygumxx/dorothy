---
name: plan-commit-headers
description: commitlint caps headers at 50 and body lines at 72; plans must too
metadata:
  node_type: memory
  ctime: 2026-10-15
  mtime: 2026-10-15
  spdx: GPL-3.0-only
  type: feedback
  originSessionId: ff990297-3157-4bac-a62b-babbba4639b4
  modified: 2026-10-15T08:45:56.169Z
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.agents/memory/plan-commit-headers.md
   -
   -->

commitlint here rejects a commit header over 50 characters and a body
line over 72. The delivery plan's commit messages ran to 60 and more,
and every task had to shorten them.

**Why:** the limits come from the shared `@chewygumxx/commitlint-config`,
not from `.commitlintrc.mts`, so they are easy to miss when planning.

**How to apply:** when writing a plan's commit steps, keep each header
at most 50 characters, scope included, and wrap bodies at 72. See also
[Recording plan carry-overs](./recording-plan-carry-overs.md).
