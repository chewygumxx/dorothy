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
