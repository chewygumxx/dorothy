---
ctime: 2026-10-30
mtime: 2026-10-30
spdx: GPL-3.0-only
title: The evaluation's plan limits and review tools, implementation plan
description: >-
  Task-by-task plan for stopping at a plan's limit, review's evidence
  length, and review --apply.
tags:
  - dorothy
  - eval
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-30-eval-review-tools.md
   -
   -->

# The evaluation's plan limits and review tools, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `subagent-driven-development` to carry out this plan task by task, one
> subagent at a time, never in parallel. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** as [the spec](../specs/2026-10-30-eval-review-tools-design.md)
says.

## Global Constraints

- Every new file carries the house header, copied from a sibling.
- Imports end in `.js`; `eval` imports only what it declares.
- Tests never spawn `claude` or `codex`, nor read `~/eval`,
  `secrets.json` or `$XDG_*/dorothy`: runners and work directories are
  injected or made in `mkdtemp` directories.
- No secret or snapshot text reaches argv, a log or an error.
- Commits: Conventional Commits with a capitalised subject, header at
  most 50 characters, body lines at most 72, no agent trailers, no em
  dash; scope `eval`. Run `bunx biome check --write <paths>` first.
- Markdown lines at most 80 characters; AGENTS.md budgets hold.
- Test-first; `bun run check` passes before each task's last commit.

### Task 1: a plan's limit stops the run

- [ ] `models/cli.ts` recognises each CLI's limit reply, as the spec
  says, and throws an error that `run` and `generate` treat as they
  treat `CallCap`.
- [ ] Tests as the spec's Testing says, including `--resume` after.

### Task 2: review's evidence and `--apply`

- [ ] `review --evidence <chars>`, default 6,000.
- [ ] `review --apply <file> --reviewer <name> [--dry-run]`, and the
  `reviews.jsonl` log for agents' and interactive decisions.
- [ ] README's evaluation section and `eval`'s `AGENTS.md`.
- [ ] Tests as the spec's Testing says.
