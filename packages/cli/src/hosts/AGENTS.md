---
ctime: 2026-11-01
mtime: 2026-11-14
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
   - ~xxdorothy/dorothy.git
   - ::: :/packages/cli/src/hosts/AGENTS.md
   -
   -->

# packages/cli/src/hosts/AGENTS.md

## Files

- `codex.ts`: `dorothy --codex`. `codexArgs` gives her persona as
  `developer_instructions` (the user's own after it), her MCP server,
  her hooks, memories off and native subagents off, as session flags;
  nothing of Codex's is written, and hook trust is Codex's prompt,
  never bypassed. `--codex --dump` prints the command.
- `hermes.ts`: `dorothy --install hermes`, a profile `dorothy` made by
  `hermes profile create --no-alias --clone`; she owns its `SOUL.md`,
  `plugins/dorothy/`, `dorothy.json` and four keys, nothing else.
- `../../assets/hermes/`: her provider, Python's standard library
  alone, running `--hook hermes`; `test_dorothy.py` stubs Hermes's
  base, and `hermes-plugin.test.ts` runs it under `bun test`.
- `pi/runtime.ts`: `resolvePiRuntime(cliDir, env)` checks the exact
  `1.5.0` dependency, installed metadata and public `.bin/pi` link.
  It uses the passed `PATH`'s Node `>=22.19.0`, never a global `pi`.
  Failures give codes and paths alone; its executable test is offline,
  on private roots, without inherited credentials.
- `pi/models.ts`: `selectPiModel` picks the first Featherless chat entry
  or exact requested `provider:model`, offering its provider's checked
  models alone, never falling back. Route prices override the catalog
  and say so in `sources`. `readPiCatalog` reads
  `../../assets/pi/models.json`: revalidate before paid runs, never
  update silently. `sessionDirFor` is `<sha256(cwd)>/--<Pi's name>--`;
  `PiLaunchManifest` names a key variable, never a credential.
- `pi/profile.ts`: `preparePiProfile` claims `$XDG_CONFIG_HOME/dorothy/pi`
  with `dorothy-owner.json`, refusing an unmarked nonempty directory;
  settings, keybindings and trust stay. Sessions live below
  `$XDG_DATA_HOME/dorothy/pi/sessions`; atomic 0600 launch files in
  runtime's `pi-<id>`, removed alone by `cleanup`, also on setup failure.
  Profile and project MCP files are read as data; `dorothy-memory` is
  refused, the rest listed in `mcpServers`. `piProfileArgs` sets sessions,
  disables discovered extensions and skills, keeps built-in MCP and
  loads Dorothy's assets by path.
- `pi/launch.ts`: `runPi`, for `dorothy --pi [--model <provider:id>]
  [--steward <registry>] [--dump] [-- <Pi arguments>]` (`args.ts` reads
  hers before `--`). With `--steward` see [its guide](./pi/steward/AGENTS.md).
  In order:
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
- `--pi-hook` (`index.ts` `piHook`, `readBounded` of `../bounded.ts`):
  one request of at most 128 KiB on
  stdin, `runPiHostHook` with the memory client and `sendRecord`, one JSON
  reply on stdout (64 KiB at most, else its context dropped as
  `pi_reply_too_large`), exit 0. Too large or not JSON is `null`, which
  memory answers `pi_request_invalid`.
- `../../assets/pi/`: her extension, which Pi loads under Node with the
  manifest `DOROTHY_PI_MANIFEST` names: [its guide](../../assets/pi/AGENTS.md).
- `pi/testing.ts`: `startFakeProvider` scripts loopback Chat Completions,
  with held replies for killed turns; `piRoots` isolates roots, a fake
  `dorothy` logs hook and MCP calls, and `runPi` runs published Pi.
  `extension.test.ts` drives a fake API, `wire.test.ts` the native wire,
  and `launch.test.ts` injected and published launches, resume/fork,
  path collisions, preferences, prompt discovery and Bun's Node alias.
- `pi/native-launch.ts` runs `runPi` from a `NativePlan` with injected
  routes and synthetic key. Tests never run `index.ts --pi` or `--serve`:
  those decrypt secrets. `pi/delivery-testing.ts` starts memory directly
  on private roots, drives a PTY (`launchNative`), sweeps and archives.
  `wire.test.ts` covers real hooks/MCP, interruption, reload, resume,
  compaction, fork, killed launches and idempotent sweeps.
- `pi/steward/`: stewardship, Dorothy in Pi coordinating declared Codex
  and Claude workers in herdr panes: the strict registry, the herdr
  observation, SQLite ledger, engine, helper and fixtures
  ([guide](./pi/steward/AGENTS.md)). Plain Pi needs no herdr or worker tool.
- Root `scripts/probe-pi-delivery.ts`: budgeted offline/live smoke probe,
  never a test ([report](../../../../docs/reports/2026-11-03_pi-delivery.md)).
  `scripts/probe-pi-stewardship.ts`: simulated workers offline; live
  `pi-stewardship-trial.ts` supplies herdr, logins, memory, proxy and
  versions, leaving missing home/budget pending. `--release <task-id>`
  frees stranded tasks. Probes may import CLI files by relative path
  ([fixture guide](../../assets/pi/stewardship/fixture/AGENTS.md)).

## Subagents

The core and layers are Dorothy's alone. Probes on 2026-11-14 used this
CLI and private roots. Records are in `~/dev/xxdy/eval`, branch `persona`:

- Codex 0.167.0 inherits her instructions and `persona` tool even with
  `fork_turns=none`: `persona/hosts/20261114/codex.json`.
  `codexArgs` now sets documented `agents.enabled=false`. No spawn tool
  was offered, even over an agents-enabled user config:
  `persona/hosts/20261114/codex-guarded.json`. Native delegation is off.
- Packaged Pi 1.5.0 has no native subagents. `--no-extensions` disables
  discovery; plain Pi loads only built-in MCP and Dorothy's extension.
  Its live tool inventory and provider payload offer no delegation:
  `persona/hosts/20261114/pi.json`. The observer registered no tools;
  the parent retains `persona`. Extra extensions and `--steward`'s
  separate worker protocol were not tested by this probe.
- Claude Code: both memory servers expose `persona` without a caller-role
  check. Any agent sharing the server can list and call its layers,
  subject to host permissions; the tool's description enforces nothing.
  This follows the registrations, not a live Claude subagent probe;
  the installed CLI was 2.1.322.

Raw logs are under `persona/hosts/20261114/raw/`. These guards cover the
loadout above, not code launching hosts or explicit tool-config changes.
