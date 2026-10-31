---
ctime: 2026-11-01
mtime: 2026-11-01
spdx: GPL-3.0-only
title: Delivery's host probes
description: >-
  What Codex's hooks and Hermes's profiles and plugins do, found on
  temporary homes, and the payload fixtures Delivery's tasks test
  against.
tags:
  - dorothy
  - memory
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-11-01-delivery/probes.md
   -
   -->

# Delivery's host probes

## Summary

Task 1 of [the plan](../../plans/2026-11-01-delivery.md). Hermes was
probed on a temporary `HERMES_HOME` and answered every question. Codex
was not: both Codex probes wait for the user, as Codex's usage is spent
until 5 November and the probe needs the user to sign a temporary home
in and trust its hooks. The fixtures use the payload shape that Codex
0.165.0's binary strings name, and Task 9 confirms it.

## Codex hooks from session flags

Waiting for the user, after 5 November 17:23 (Australia/Melbourne).
Not run: no `CODEX_HOME` was made, and `~/.codex` was not touched.

Open until then: what the trust screen shows, what Codex writes to
`$CODEX_HOME/config.toml`, whether each payload arrives and its fields,
the exit, and whether a hook is **skipped as untrusted** (`exec` runs
untrusted hooks never) or a flag is **ignored or refused**. Only the
second is **Codex: plugin route**, for Task 4's Step 6.

## Codex's additive instructions key

Waiting for the user, after 5 November 17:23, on the same signed-in
home. Open: whether `developer_instructions` is accepted with no
unknown key warning, and echoed.

## Hermes profiles and plugins

Run on a temporary home, Hermes Agent v0.22.2 (2026.9.24), checkout
`d923a5eb48`. The checkout under `~/.hermes/hermes-agent` was only
read.

```sh
probe=$(mktemp -d) && export HERMES_HOME="$probe/hermes"
hermes profile create --help
hermes profile create dorothy --no-alias --clone ; echo "exit=$?"
```

The create exited 0 and printed that the profile was created at
`$HERMES_HOME/profiles/dorothy`, cloned from `default`. It called no
model.

- **The profile's directory.** `$HERMES_HOME/profiles/dorothy`. Hermes
  anchors the profiles root to the Hermes root, not to the current home
  when that home is itself a profile. A `HERMES_HOME` outside
  `~/.hermes` is its own root (`get_default_hermes_root`), so the probe
  never reached the user's profiles. The profile holds `.env`
  (placeholder comments only), `SOUL.md`, and empty `cron`, `home`,
  `logs`, `memories`, `plans`, `sessions`, `skills`, `skins` and
  `workspace` directories. Its `config.yaml` is absent, as the empty
  source home had none to clone.
- **`--no-alias` is honoured.** `_profile_create` writes the wrapper
  script only `if not no_alias`; `~/.local/bin` was unchanged.
- **`--clone` copies no auth file.** It copies `config.yaml`, `.env`,
  `SOUL.md`, installed skills, `memories/MEMORY.md` and `USER.md`,
  installed plugins and the memory provider's config
  (`_CLONE_CONFIG_FILES`, `_CLONE_SUBDIR_FILES`, `_clone_plugins`).
  `auth.json` is not in that list, and `--clone-all` drops cloned
  single-use OAuth grants. But `.env` is copied, and it may hold API
  keys, so clone from an empty or key-free home, or write the profile
  without `--clone`. The probe's source was empty; no auth file landed.
- **Where a profile's plugins load from.** `user_plugins_dir()` in
  `plugins/plugin_loader.py` is `$HERMES_HOME/plugins`, and under
  `hermes -p dorothy` `HERMES_HOME` is the profile, so a profile's
  plugins are in `profiles/dorothy/plugins/<name>/`, each with an
  `__init__.py`. A project's `./.hermes/plugins/` also counts, only
  with `HERMES_ENABLE_PROJECT_PLUGINS`.
- **How `memory.provider` names a plugin outside Hermes's tree.**
  `config.yaml`'s `memory.provider` is a bare name. `plugins/memory`'s
  `load_memory_provider` finds it in, in order, the bundled
  `plugins/memory/<name>/`, the user's `$HERMES_HOME/plugins/<name>/`
  (it must mention `register_memory_provider` or `MemoryProvider`), the
  project's, then a pip entry point in the group
  `hermes_agent.memory_providers`. A bundled name wins over a user one,
  so Dorothy's name must not collide with a bundled provider. One
  provider is active at a time. `agent/agent_init.py` loads it, and
  warns once if it is unavailable.
- **How a profile is chosen.** `hermes -p dorothy <command>` (or
  `--profile`) is pre-parsed in `hermes_cli/main.py` and sets
  `HERMES_HOME` to `<root>/profiles/dorothy`; with no flag, a sticky
  `<root>/active_profile` (`hermes profile use`) is read. Confirmed:
  `hermes -p dorothy profile show dorothy` printed the temporary
  profile's path.

### What landed outside the temporary home

`~/.local/bin` and `~/.config` were unchanged. Running Hermes from its
source wrote Python bytecode into the checkout's ignored `__pycache__`
directories: four files on the create (`hermes_cli`, `pm`,
`plugins/memory`, the last in a new directory) and two on the `-p`
check (`hermes_cli`, `gateway`). Only those files, and the one new
directory, were removed; the Hermes checkout's tracked files and the
user's `~/.hermes` data were not written. The temporary home itself
also gained Hermes's dependency runtime under `installs/` and `cache/`
on first use, which is inside `$probe` and removed with it.

## Fixtures

`packages/memory/src/hooks/fixtures.ts` holds the plan's four payloads
unchanged: Codex's `SessionStart` and `UserPromptSubmit`, and Hermes's
two in Codex's shape. Nothing was captured, so no field was replaced.
The Codex shape (`session_id`, `cwd`, `source`, `prompt`,
`hook_event_name`, with `hookSpecificOutput`, `hookEventName` and
`additionalContext` in a reply) is the one Codex 0.165.0's binary
strings name; Task 9 confirms it against a live Codex.

The Hermes payloads are Dorothy's own, sent by her provider to her
hook, so Hermes's source does not constrain them.
