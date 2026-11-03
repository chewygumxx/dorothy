---
ctime: 2026-11-01
mtime: 2026-11-04
spdx: GPL-3.0-only
title: packages/cli/src/hosts/AGENTS.md
description: >-
  How the CLI runs Dorothy in hosts other than Claude Code: Codex's launcher,
  Hermes's install and Pi's pinned runtime boundary.
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
- `pi/runtime.ts`: `resolvePiRuntime(cliDir, env)` checks the CLI's
  exact `1.5.0` dependency and installed package metadata as files,
  resolves its public `node_modules/.bin/pi` link and checks the Node
  selected by the passed `PATH` against `>=22.19.0`. The command uses
  that Node and the resolved package binary, never a global `pi`.
  Failures expose codes and paths, without probe output or environment.
  The packaged executable test uses offline mode, private roots and
  an environment without inherited credentials.
- `pi/models.ts`: `selectPiModel` picks the first Featherless entry of the
  chat route, or the exact `provider:model` asked for. It offers only that
  provider's checked models, never falls back, and names an unlisted
  model. A route price overrides input and output prices and says so in
  `sources`. `readPiCatalog` reads `../../assets/pi/models.json`, the
  checked limits and prices; revalidate before a paid run, never update
  silently. `sessionDirFor` is `<sha256(cwd)>/--<Pi's name>--`.
  `PiLaunchManifest` holds no credential, only the key's variable name.
- `pi/profile.ts`: `preparePiProfile` claims `$XDG_CONFIG_HOME/dorothy/pi`
  with the exclusive marker `dorothy-owner.json`, refusing an unmarked
  nonempty directory, and never touches settings, keybindings or trust.
  Sessions go below `$XDG_DATA_HOME/dorothy/pi/sessions`. Each launch has
  private files (0600, atomic) in `pi-<id>` of Dorothy's runtime directory;
  `cleanup` removes that alone, also on setup failure. It reads Pi's MCP
  files (`<agent dir>/mcp.json`, `<cwd>/.pi/mcp.json`) as data, refuses a
  `dorothy-memory` name and lists the rest in `mcpServers`. `piProfileArgs`
  gives `--session-dir`, discovered extensions and skills off, built-in MCP
  kept, then Dorothy's by path.
