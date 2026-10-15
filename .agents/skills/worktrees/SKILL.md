---
name: worktrees
description: >-
  Use when creating, entering, checking, repairing or removing a git
  worktree of Dorothy's repository, or when a worktree lacks skills, git
  hooks or node_modules.
ctime: 2026-10-15
mtime: 2026-10-15
spdx: GPL-3.0-only
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.agents/skills/worktrees/SKILL.md
   -
   -->

# Worktrees

This repository may be worked in a worktree as well as in its main
checkout ([`AGENTS.md`](../../../AGENTS.md)). Here is how a worktree is
made, set up, checked, repaired and removed.

## Making one

- Use the user's own tools: worktrunk's `wt switch --create <branch>`,
  Claude Code's worktree, which worktrunk's hooks serve, or herdr's. Where
  worktrees go is theirs to say; never choose a path yourself.
- Never use superpowers' `using-git-worktrees`, which the `skills` script
  excludes, or a `.worktrees/` directory. Where a skill asks for either,
  `AGENTS.md` wins.
- For a subagent, make its worktree first with
  `wt switch --create <branch> --no-cd` and name the path in its prompt.
  The Agent tool's `isolation: "worktree"` makes a throwaway
  `agent-<id>` branch instead.

## What sets one up

Both steps are declared here, so a worktree made by any tool comes out
whole:

1. [`.husky/post-checkout`](../../../.husky/post-checkout): git checks a
   new worktree out from the null commit, and the hook runs
   `bun install`. That brings the dependencies, the git hooks, the links
   to superpowers' skills and auto memory's pointer, none of which a
   worktree shares.
2. [`.worktreeinclude`](../../../.worktreeinclude): Claude Code, and
   worktrunk's `wt step copy-ignored --require-include`, copy the skill
   directories from the main checkout. That brings the skills installed
   with `skills add`, such as herdr, which install cannot link. A copy
   skips whatever exists, so it never undoes install's links.

The repository's own skills, this one among them, are committed and come
with the checkout.

## Checking one

- `.husky/_/pre-commit` exists: without it, no commit is linted.
- `ls .claude/skills` lists what the main checkout's does.
- `bun test agents.test.ts` passes.

## Repairing one

From inside the worktree, run `bun install`, then
`wt step copy-ignored --require-include`, which copies from the main
checkout whichever branch it is on.

## What differs in a worktree

- `.claude/settings.local.json` is the worktree's own, written by
  install: auto memory points at the worktree's `.agents/memory/`, so a
  memory written there is committed on its branch. The user's
  permissions in the main checkout's file do not come with it.
- Dorothy's memory store takes a worktree as another root of the same
  project, read through its `.git` file.

## Probing

To try a hook or a copy, add a worktree in the session's scratchpad with
`git worktree add`, not `wt switch`, whose user hooks may open it in
herdr. Remove it with `git worktree remove`; `--force` only on a probe
whose changes are your own.

## Removing one

`finishing-a-development-branch` leaves a worktree outside `.worktrees/`
to its host. Once the branch is merged or abandoned, remove it with the
tool that made it, such as `wt remove <branch>`, or `wt merge` when
merging locally.
