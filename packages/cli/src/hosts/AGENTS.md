---
ctime: 2026-11-01
mtime: 2026-11-04
spdx: GPL-3.0-only
title: packages/cli/src/hosts/AGENTS.md
description: >-
  How the CLI runs Dorothy in hosts other than Claude Code: Codex's launcher,
  Hermes's install, and Pi's launcher, runtime, profile and extension.
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
- `pi/launch.ts`: `runPi`, for `dorothy --pi [--model <provider:id>]
  [--dump] [-- <Pi arguments>]` (`args.ts` reads hers before `--`). In
  order:
  - `readPiArgs` reads Pi's arguments with Pi 1.5.0's own arity, so an
    option word that is a value (`--system-prompt --api-key`, `-p "say
    --model"`) is not taken for one. It refuses by name alone, exit 2,
    `--api-key`, `--provider`, `--model`, `--session-dir` and `--no-mcp`,
    `--flag=value` forms too. A `--session` or `--fork` path, resolved as
    Pi resolves it, must lie below the session root, links followed;
    an id is Pi's to look up in the cwd's session directory.
  - The route and `selectPiModel` are checked, and the selection printed,
    before any secret is decrypted. Pi runs in the user shell's directory
    (`userShell`), canonical, under the Node `resolvePiRuntime` finds on a
    `PATH` without Bun's `node` alias (`nodePath`).
  - `loadSecrets` fills an isolated environment, seeded with the caller's
    own value of the selected key alone; only that key is copied into
    Pi's, under the entry's variable name. Native `--help` and
    `--version`, and `--dump`, load none; help runs without her
    extension and model, which would ask for the key.
  - `preparePiProfile` writes the persona and the manifest, which names
    it (`persona`) for her extension; other MCP servers it found are said
    before Pi starts, so before its project trust, and a `--no-session`
    launch is said to record nothing.
  - Pi gets `--offline`, `piProfileArgs` and `--model
    <provider>/<model>`, then the user's arguments, through
    `runForwarding`; the launch files go in `finally`,
    and a spawn failure is said by its code. Prompt templates and themes
    stay discoverable: they are Markdown and JSON, never executed. The
    dump prints the command, cwd and variable names, never a value.
- `pi/env.ts`: the environments, each an allowlist (`passedEnv`):
  terminal, `PATH`, home, `XDG_*`, locale (`LANG`, `LC_*`), proxies and
  their certificates, and herdr's pane; never a provider key, OAuth
  token, `NODE_OPTIONS`, `BUN_OPTIONS`, preload or foreign `PI_*`. Pi's
  (`piEnvOf`) adds `PI_CODING_AGENT_DIR`, the profile's, without which Pi
  reads the user's own `~/.pi/agent`, `DOROTHY_PI_MANIFEST` and the key.
  The helpers' (`helperEnvOf`, the manifest's `helperEnv`) adds
  `DOROTHY_MEMORY_URL` and the age key's path, and holds no key.
- `--pi-hook` (`index.ts` `piHook`): one request of at most 128 KiB on
  stdin, `runPiHostHook` with the memory client and `sendRecord`, one JSON
  reply on stdout (64 KiB at most, else its context dropped as
  `pi_reply_too_large`), exit 0. Too large or not JSON is `null`, which
  memory answers `pi_request_invalid`.
- `../../assets/pi/`: her extension, which Pi loads under Node with the
  manifest `DOROTHY_PI_MANIFEST` names: [its guide](../../assets/pi/AGENTS.md).
- `pi/testing.ts`: `startFakeProvider`, a scripted Chat Completions
  endpoint on loopback, its replies a list or chosen per request (and
  held back, as a killed turn needs); `piRoots`, private roots; a
  stand-in `dorothy` for `--pi-hook` and `--mcp`, logging beside itself
  unless told where;
  `runPi`, the published CLI under Node. `pi/extension.test.ts` drives
  the extension through a fake Pi API, `pi/wire.test.ts` the CLI on the
  wire, with a synthetic key alone. `pi/launch.test.ts` injects every
  dependency of the launcher, then runs it through the published Pi:
  new, `-c`, `--fork` and `--session` launches, two paths Pi names
  alike, preferences kept, Pi's `APPEND_SYSTEM.md` beside her persona,
  and Bun's alias first on `PATH`.
- `pi/native-launch.ts`: `runPi` as a process, for a pseudo-terminal,
  from a plan file (`NativePlan`: roots' env, cwd, `self`, base URL, Pi's
  arguments); the routing and a synthetic key are injected, so nothing
  decrypts `secrets.json`. Never drive `index.ts --pi` in a test: it
  would. `pi/delivery-testing.ts`: her real memory service on the roots
  (`startMemoryService`, from `@dorothy/memory/service`, never `--serve`,
  which loads secrets), `launchNative` (Bun's `terminal` spawn: type,
  wait for text, kill the process group), `sweepOnce` (this checkout's
  `--sweep`) and `archive`. `pi/wire.test.ts` "Pi in its own terminal"
  runs the native interface with the real `--pi-hook` and `--mcp`: tool
  calls, one interrupted, `/reload`, `--resume`, `/compact`, `/fork`,
  the launcher killed mid-turn, two sweeps, each event once.
- `pi/steward/`: stewardship, Dorothy in Pi coordinating declared Codex
  and Claude workers in herdr panes: the strict registry, the herdr
  observation, the SQLite task ledger, the engine over them and the
  fixtures ([guide](./pi/steward/AGENTS.md)).
  `../../assets/pi/stewardship/` holds a synthetic registry example.
  Normal `--pi` needs no herdr.
- `scripts/probe-pi-delivery.ts` (repository root): the bounded smoke
  test, offline or live, through its own counting, budgeted forwarding
  proxy ([report](../../../../docs/reports/2026-11-03_pi-delivery.md)).
  Never part of `bun run test`.
