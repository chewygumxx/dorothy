---
ctime: 2026-11-11
mtime: 2026-11-14
spdx: GPL-3.0-only
title: scripts/prepare.md
description: >-
  What prepare.sh is for and promises: when it runs, the production no-op
  and each development step.
tags:
  - scripts
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/scripts/prepare.md
   -
   -->

# scripts/prepare.md

`prepare.sh` runs on every `bun install`, as `package.json`'s `prepare`.

A production install has no development dependencies, so there are no
hooks, skills or agent memory to set up: without `node_modules/husky` the
script does nothing and exits 0.

Otherwise it runs these steps, in order. `pairs.test.ts` fails if the
commands named here and the ones in `prepare.sh` differ.

1. `husky`
   installs the git hooks.
2. `DO_NOT_TRACK=1 skills experimental_sync -y --agent claude-code codex
   ${CI:+--no-remote} || { echo "prepare: fetching remote skills failed;
   linking package skills alone" >&2; DO_NOT_TRACK=1 skills
   experimental_sync -y --agent claude-code codex --no-remote; }`
   links every skill `package.json`'s `skills` array declares, fetching
   each git source at its commit, and the packaged ones in
   `@dorothy/skills`. Under `CI` it adds `--no-remote`, so CI fetches
   nothing. A failed fetch, as offline, makes the sync exit 1: prepare
   then warns and re-runs it with `--no-remote`, linking the package's
   skills alone, and the install succeeds. A failure of that retry, such
   as a broken array or package, fails the install.
3. `bun test --bail agents.test.ts --test-name-pattern 'the skills'`
   checks the skills. The sync logs a skill it skips, such as one whose
   destination is a link elsewhere, and still exits 0, so these checks
   fail the install instead; a remote skill absent, as after a failed
   fetch, they skip.
4. `bun scripts/agent-memory.ts`
   points Claude at `docs/memory`.
