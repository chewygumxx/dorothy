---
ctime: 2026-11-14
mtime: 2026-11-14
spdx: GPL-3.0-only
title: packages/skills/AGENTS.md
description: >-
  The skills package's guide: the repository's own agent skills, which
  agents reach through the skills CLI's sync and the CLI through its
  exports.
tags:
  - agents
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/packages/skills/AGENTS.md
   -
   -->

# packages/skills/AGENTS.md

`@dorothy/skills` holds the repository's own agent skills, each in
`skills/<name>/` with its `SKILL.md`: `agent-pre-screening`,
`agent-stewardship`, `development-evidence` and `worktrees`. They serve
this repository alone.

## How agents reach them

Only through the skills CLI's sync, which `prepare` runs on every
`bun install`: the root declares this package as a development
dependency, and the sync links each skill into `.agents/skills/<name>`
through `node_modules/@dorothy/skills`, links `.claude/skills/<name>` to
that, and records it in `skills-lock.json` as this package's. Neither
directory is edited by hand; after adding, renaming or removing a skill,
run `bun install` and commit the lock it writes.

## Entry points and imports

One entry point, `"."` (`src/index.ts`): `sendPrompt` and
`sendInterrupt`, the absolute paths of the stewardship skill's
`send-prompt.sh` and `send-interrupt.sh`, through which `cli`'s Pi
stewardship runs them. It depends on nothing and does no I/O.

## Invariants

- A script finds the checkout by climbing physically from its own
  directory (`with-claude.sh`: five levels), so it runs alike through the
  package, `node_modules` and both links. Moving a skill deeper or
  shallower changes that count.
- A relative link inside a skill is written from its place here, not
  from `.agents/skills/`.

## Tests

`src/index.test.ts` checks that the exported scripts exist and are
executable. The stewardship scripts' tests are
`scripts/agent-stewardship.test.ts` at the root; `agents.test.ts` checks
the links and the lock.
