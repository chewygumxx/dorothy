---
ctime: 2026-11-01
mtime: 2026-11-01
spdx: GPL-3.0-only
title: packages/cli/src/hosts/AGENTS.md
description: >-
  How the CLI runs Dorothy in hosts other than Claude Code: Codex's launcher
  and Hermes's install.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/cli/src/hosts/AGENTS.md
   -
   -->

# packages/cli/src/hosts/AGENTS.md

Dorothy in hosts other than Claude Code, whose launcher is `claude.ts`.

## Files

- `codex.ts`: `dorothy --codex`. `codexArgs` gives her persona as
  `developer_instructions` (the user's own after it), her MCP server,
  her two hooks and Codex's memories off, all as session flags;
  nothing of Codex's is written, and hook trust is Codex's prompt,
  never bypassed. `--codex --dump` prints the command.
- `hermes.ts`: `dorothy --install hermes`, a profile `dorothy` made by
  `hermes profile create --no-alias --clone`; she owns its `SOUL.md`,
  `plugins/dorothy/`, `dorothy.json` and four keys, nothing else.
- `../../assets/hermes/`: her provider, Python's standard library
  alone, running `--hook hermes`; `test_dorothy.py` stubs Hermes's
  base, and `hermes-plugin.test.ts` runs it under `bun test`.
