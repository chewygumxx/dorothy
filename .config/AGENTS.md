---
ctime: 2026-11-11
mtime: 2026-11-11
spdx: GPL-3.0-only
title: .config/AGENTS.md
description: >-
  The tools configured in .config/ and what mise supplies for each to
  find its configuration there.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.config/AGENTS.md
   -
   -->

# .config/AGENTS.md

Tool configuration lives here wherever the tool can be pointed at it.
Each line names a tool, its file and what mise supplies to reach it.

- mise: `mise/config.toml` (tools, `[env]`) and `mise/tasks.toml` (tasks);
  mise reads both natively, nothing is supplied.
- Tombi: `tombi.toml`; Tombi finds it natively, nothing is supplied.
- remark: `remarkrc.json`; the `lint:md` task passes
  `--rc-path .config/remarkrc.json`.
- markdownlint-cli2: `markdownlint-cli2.jsonc`; the `lint:md` task passes
  `--config .config/markdownlint-cli2.jsonc`, and the overrides in
  `.github/` and `.agents/memory/` still merge over it.
- yamllint: no file here; `mise/config.toml`'s `[env]` sets
  `YAMLLINT_CONFIG_FILE` to `@chewygumxx/yamllint-config`.

Biome (`.biome.json`) and commitlint (`.commitlintrc.mts`) stay at the
root: Biome refuses a configuration in a subdirectory as a second root,
and commitlint's search omits `.config/`.
