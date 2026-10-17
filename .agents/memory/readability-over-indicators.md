---
name: readability-over-indicators
description: "Fix what makes code hard to read, not the metric or tool output that points at it"
metadata:
  node_type: memory
  ctime: 2026-10-18
  mtime: 2026-10-18
  spdx: GPL-3.0-only
  type: feedback
  originSessionId: 47233e46-7657-45bc-931f-233c26152dcb
  modified: 2026-10-17T17:14:40.415Z
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.agents/memory/readability-over-indicators.md
   -
   -->

The user wants the code readable. Complexity warnings (lizard, Biome's
cognitive complexity) only point at code worth reviewing; their numbers
are not the goal. They rejected a ripgrep `.ignore` for `docs/plans/` as
"lazily addressing the indicator rather than what's causing it", and
enabling a complexity lint rule as useless.

**Why:** the token usage note
([2026-10-16](../../docs/notes/2026-10-16_claude-conversation-token-usage.md))
traced cost to hard-to-read code and heavy process; hiding the symptoms
changes neither.

**How to apply:** refactor the flagged code itself, one hotspot per
branch: a short design in chat, approval, tests unchanged, then a PR.
Use the metric only to check the result. Do not propose ignore files,
suppressions or lint gates as fixes.
