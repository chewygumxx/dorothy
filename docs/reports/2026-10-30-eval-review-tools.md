---
ctime: 2026-10-30
mtime: 2026-10-30
spdx: GPL-3.0-only
title: The evaluation's plan limits and review tools
description: >-
  A plan's usage limit stopping a run for --resume, review's evidence
  length and --apply, and the status line that lets agents read Claude's
  budget: tasks, reviews and what they found.
tags:
  - dorothy
  - eval
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-30-eval-review-tools.md
   -
   -->

# The evaluation's plan limits and review tools

## Summary

Preparing the first full run surfaced three faults, which
[the spec](../specs/2026-10-30-eval-review-tools-design.md) and
[the plan](../plans/2026-10-30-eval-review-tools.md) fixed. A plan's
usage limit, met through the `claude` or `codex` route, now stops a run
or a generation as `--max-calls` does, exiting 75, and `--resume`
finishes the run with no miss recorded. `review` shows 6,000 characters
of each cited conversation, not 1,500, after an agent rejected some
forty drafts for evidence it was never shown. `review --apply` applies
an agent's decisions with review's own checks, and `reviews.jsonl`
records who decided each. Claude subagents built and reviewed it, Codex
having spent its limit.

## Reading Claude's budget

Claude Code gives the plan's `rate_limits` to the status line alone. The
project's status line, `scripts/statusline.sh`, writes them to
`$XDG_RUNTIME_DIR/claude-usage-<account>.json` and then draws the user's
`ccstatusline`, or a minimal line without it. The agent reads the file
before it dispatches, as `.agents/memory/usage-limits.md` sets out: Codex
when a job fits its budget, else a Claude subagent that leaves room for
the coordinating session, else a wait for the first reset.

## Reviews

- Task 1's review found Codex's recovered retry notices, some naming a
  rate limit, read as a plan limit: a paid answer would be discarded.
  A limit is now read from a turn that did not complete.
- Task 2's review approved it.
- The whole-branch review found an `--apply` edit with a mistyped field
  applied silently as no change, now refused by a strict line schema,
  and Claude's current wording ("You've hit your session limit") not
  recognised. It also noted that Codex may switch models under limit
  pressure, unseen by the run; such a notice now stops the run, matched
  by its text, as no Codex event names the model.

## Verification

`bun run check` passes under temporary XDG roots: 3,467 tests, one
existing skip, before one last fix keeping a run limited once any
worker meets a plan limit. The status line wrote the live budget on its first
render (5-hour 43%, weekly 16%). The real use follows: the agents'
remaining decisions applied with `--apply`, and the baseline run.
