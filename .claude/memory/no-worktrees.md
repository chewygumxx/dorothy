---
name: no-worktrees
description: "work on plain branches in the main checkout, not git worktrees"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 2ccf70ee-6409-47ee-beb4-47238d16379f
  modified: 2026-10-06T21:02:23.489Z
---

Work on a plain branch in the main checkout (`/home/chewygumxx/dev/dorothy`),
not in a git worktree, unless the user asks for one.

**Why:** the user rarely runs agents in parallel on one repository and never
has on this one. In a worktree session Claude Code's guard refused their own
`!` commands twice (anything with variables, `$(...)`, `if` or `cd`), which
frustrated them; and a worktree as working directory leaked worktree
instructions into Dorothy's context (see
docs/reports/2026-10-07-context-leak.md).

**How to apply:** branch from an up-to-date main with `git switch -c`; skip
superpowers' worktree setup step and say so. Researching how to disable the
guard is postponed until it blocks something else.
