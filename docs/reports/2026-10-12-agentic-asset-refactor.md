---
ctime: 2026-10-12
mtime: 2026-10-12
spdx: GPL-3.0-only
title: Agentic asset refactor report
description: >-
  How the agent guidance, skills and memory moved into conventions every
  coding agent reads: the probes, the measurements, the rulings and what
  is left.
tags:
  - dorothy
  - agents
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-12-agentic-asset-refactor.md
   -
   -->

# Agentic asset refactor report

## Summary

Written last.

## The probes

### Header verification

`bunx sync-header-metadata@2.4.2` in verify mode, on this branch before
any change but the spec's and plan's: 249 files parsed, 213 breadcrumbs
correct, none out of sync, 36 files without one (warnings only). Exit 0.

### The skills

`bun install` under the isolated linker installed superpowers from GitHub,
pinned in `bun.lock` to its tag's commit
(`+ superpowers@github:obra/superpowers#b92c4fa`), and `prepare`'s sync
found its skills in `node_modules`: "Found 11 skills in node_modules",
the four excluded never offered. Each landed as a link,
`.agents/skills/<name>` into `node_modules/superpowers/skills/<name>` and
`.claude/skills/<name>` into `.agents/skills/<name>`, and the lock records
eleven `node_modules` entries with superpowers' version, 6.4.1.

The first `bun run skills` skipped herdr: "installed with `skills add`
from herdrdev/herdr". The sync claims only the remote skills it installed
itself, marked by a `via` field, and the lock's herdr entry came from the
hand-made install of 2026-10-09. With that entry deleted, the sync
installed herdr and recorded it with `"via": "."`.

The remote's behaviour, captured in `sync.txt` with the CLI's spinner and
colour codes stripped and its em dashes made hyphens, as the repository
allows none:

- With herdr removed, `bun run skills --no-remote` synced the eleven and
  kept herdr's lock entry, and `bun test agents.test.ts` passed with
  herdr's test skipped (`1 skip`, `0 fail`), as in CI.
- `bun run skills` then cloned herdrdev/herdr and installed it
  ("Installed herdr from herdrdev/herdr").
- Run again with herdr present, it fetched nothing: the eleven synced,
  and no clone.

`prepare` with its sync replaced by `false` exits 1, so a failing sync
fails `bun install`; with husky's directory absent and the sync replaced
by `true` it exits 0, so a missing husky does not.

## Measurements

A one-word prompt (`claude -p --output-format json "hi"`), from the root
and from `packages/tui/src/`, with the user's settings as they are. Raw
fields are in `2026-10-12-agentic-asset-refactor/`.

Nearly the whole prompt is served from or written to the cache, so the
uncached `input_tokens` is 2 either way; the prompt's size is the Total,
input plus cache write plus cache read, and that is what the phase is
judged on.

| When   | From               | Input | Cache write | Cache read | Total | Wall (ms) |
| ------ | ------------------ | ----- | ----------- | ---------- | ----- | --------- |
| Before | root               | 2     | 17981       | 8350       | 26333 | 9500      |
| Before | `packages/tui/src` | 2     | 13464       | 9821       | 23287 | 5634      |

Plugins enabled before: `plugins-before.txt`, listed from `/tmp`, so it
shows the user's own plugin state (every plugin disabled outside a
project that enables it). Codex: not installed.

## Rulings made during execution

## Verification

## Commits

## Known limitations
