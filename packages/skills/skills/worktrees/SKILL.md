---
name: worktrees
description: >-
  Use when creating, entering, checking, repairing or removing a git
  worktree of Dorothy's repository, or when a worktree lacks skills, git
  hooks or node_modules.
ctime: 2026-10-15
mtime: 2026-11-14
spdx: GPL-3.0-only
tags:
  - agents
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/packages/skills/skills/worktrees/SKILL.md
   -
   -->

# Worktrees

This repository may be worked in a worktree as well as in its main
checkout ([`AGENTS.md`](../../../../AGENTS.md)). Here is how a worktree is
made, set up, checked, repaired and removed.

## Making one

- Use the user's own tools: worktrunk's `wt switch --create <branch>`,
  Claude Code's worktree, which worktrunk's hooks serve, or herdr's. Where
  worktrees go is theirs to say; never choose a path yourself.
- Never use superpowers' `using-git-worktrees`, which the `skills`
  array leaves out, or a `.worktrees/` directory. Where a skill asks for
  either, `AGENTS.md` wins.
- For a subagent, make its worktree first with
  `wt switch --create <branch> --no-cd` and name the path in its prompt.
  The Agent tool's `isolation: "worktree"` makes a throwaway
  `agent-<id>` branch instead.

## What sets one up

One declared step makes a worktree come out whole, whichever tool made
it: [`.husky/post-checkout`](../../../../.husky/post-checkout). Git checks
a new worktree out from the null commit, and the hook runs
`bun install`. That brings the dependencies, the git hooks, the links to
every skill and auto memory's pointer, none of which a worktree shares.
Nothing is copied from the main checkout.

`prepare` links every skill: the repository's own, in `@dorothy/skills`
(`packages/skills/`), offline, and the third-party ones `package.json`'s
`skills` array declares, fetched at their pinned commits. A failed fetch,
as offline, warns and links the package's skills alone.

## Checking one

- `.husky/_/pre-commit` exists: without it, no commit is linted.
- `ls .claude/skills` lists what the main checkout's does.
- `bun test agents.test.ts` passes.

## Repairing one

From inside the worktree, run `bun install`, or `mise run skills` to
relink the skills alone.

## What differs in a worktree

- `.claude/settings.local.json` is the worktree's own, written by
  install: auto memory points at the worktree's `docs/memory/`, so a
  memory written there is committed on its branch. The user's
  permissions in the main checkout's file do not come with it.
- Dorothy's memory store takes a worktree as another root of the same
  project, read through its `.git` file.

## Probing

To try a hook, add a worktree in the session's scratchpad with
`git worktree add`, not `wt switch`, whose user hooks may open it in
herdr. Remove it with `git worktree remove`; `--force` only on a probe
whose changes are your own.

## Removing one

`finishing-a-development-branch` leaves a worktree outside `.worktrees/`
to its host. Once the branch is merged or abandoned, remove it with the
tool that made it, such as `wt remove <branch>`, or `wt merge` when
merging locally.
