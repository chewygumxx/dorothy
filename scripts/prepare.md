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
2. `bun run skills --no-remote`
   links the packaged skills, not the remote ones.
3. `bun test --bail agents.test.ts --test-name-pattern 'the skills'`
   checks the skills. The sync logs a skill it skips, such as one whose
   destination is a link elsewhere, and still exits 0, so these checks
   fail the install instead.
4. `bun scripts/agent-memory.ts`
   points Claude at `docs/memory`.
