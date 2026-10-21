---
ctime: 2026-10-21
mtime: 2026-10-21
spdx: GPL-3.0-only
title: Secrets with sops and age, implementation plan
description: >-
  Task-by-task plan for moving Dorothy's secrets from dotenvx's .env to
  a sops-encrypted secrets.json, and removing dotenvx.
tags:
  - dorothy
  - config
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-21-sops-secrets.md
   -
   -->

# Secrets with sops and age, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `subagent-driven-development` to carry out this plan task by task, one
> subagent at a time, never in parallel. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** every reader and writer of `.env` uses `secrets.json`, as
[the spec](../specs/2026-10-21-sops-secrets-design.md) says, and
dotenvx is gone.

**Architecture:** `packages/core/src/secrets.ts` exports `loadSecrets`
and `saveSecret`, which run `sops`; `cli`, `memory` and `eval` call them
where they called dotenvx. `mise.toml`, `.sops.yaml` and `secrets.json`
are already committed on this branch.

## Global Constraints

- Every new file carries the house header, copied from a sibling.
- Imports end in `.js`; a package imports only what its `package.json`
  declares; `workspace.test.ts` holds.
- Tests never read `~/.config/sops`, the checkout's `secrets.json`, nor
  `$XDG_*/dorothy`: every key, file and environment is made in a
  `mkdtemp` directory and passed in. A test that runs `sops` sets
  `SOPS_AGE_KEY_FILE` to its own key.
- Never print, log or put on a command line a secret's value; an error
  from `sops` is reported by code, never by its text.
- Commits: Conventional Commits, header at most 50 characters, body
  lines at most 72, no agent trailers, no em dash. Scopes are the
  package names, `config`, `claude` and `api`. Run
  `bunx biome check --write <paths>` before each commit.
- Markdown lines at most 80 characters; AGENTS.md budgets hold.
- Test-first for every behaviour; `bun run check` passes before each
  task's last commit, with the XDG roots under a temporary directory.

## Review Focus

1. No secret's value reaches a log, an error message or argv. Every task.
2. A variable already set is never overwritten by the file. Task 1.
3. Nothing in a test touches the user's key or `secrets.json`. Every
   task.

### Task 1: `core`'s secrets

`packages/core/src/secrets.ts`, exported from `core`'s entry.

- [ ] `loadSecrets(path, into, run?)` returns `null` or a code, as the
  spec's Reading says; `run` defaults to spawning `sops` from `PATH`
  with stdin closed and stderr discarded.
- [ ] `saveSecret(path, name, value, run?)` as the spec's Writing says;
  a new file is written mode 0600; a failure throws an error naming a
  code alone.
- [ ] Tests with a real `sops` and a key from `age-keygen` in a
  temporary directory, and with a fake `run` for `SOPS_MISSING`: every
  case in the spec's Testing.

### Task 2: the CLI

`packages/cli/src/`.

- [ ] `index.ts`: `loadCredentials` and the hook's entry load the
  checkout's `secrets.json` with `loadSecrets`; `loadDotenv` goes, and
  the hook's failure line names the code as before.
- [ ] `claude.ts`: where it called `passSession`, set
  `SOPS_AGE_KEY_FILE` in the launch's and catch-up's environment to the
  key file sops would use (`SOPS_AGE_KEY_FILE`, else
  `$XDG_CONFIG_HOME/sops/age/keys.txt`, else
  `~/.config/sops/age/keys.txt`) when it exists and the variable is
  unset; `claude-hook.ts` drops `useSession`.
- [ ] Delete `dotenvx-session.ts` and its test; update the tests that
  named `DOROTHY_DOTENVX_CONFIG`, and comments naming dotenvx.

### Task 3: the mirror and the evaluation

- [ ] `memory/src/history/commands.ts`: `saveSecret` writes
  `DOROTHY_MIRROR_KEY` to `<cwd>/secrets.json` through `core`; the
  precondition requires `<cwd>/.sops.yaml` in place of `.env`; the
  messages here and in `mirror.ts` name `secrets.json`, `sops edit
  secrets.json` and `sops decrypt --extract '["DOROTHY_MIRROR_KEY"]'
  secrets.json`. Tests updated to match.
- [ ] `eval`: before `generate` and a `run` that calls models, load its
  checkout's `secrets.json` with `loadSecrets`, a failure warned by
  code; the missing-key message says `sops edit secrets.json`. Tests.

### Task 4: tooling and documents

- [ ] Remove `@dotenvx/dotenvx` from the root's, `cli`'s and `memory`'s
  `package.json`, reinstall from clean, and fix what breaks.
- [ ] Delete `.env` and `.env.example`. `.gitignore` drops its `.env`
  note and ignores `.env*` and `keys.txt`.
- [ ] `.husky/pre-commit` and a `lint:secrets` script (replacing
  `lint:env` in `check`): refuse a staged or tracked `secrets.json` with
  a top-level value, other than `sops`, not starting `ENC[`, or with no
  `sops` key; any `.env` file; and any added line holding
  `AGE-SECRET-KEY-`. Use `jq`, which `mise.toml` declares.
- [ ] `bunfig.toml`'s comment, README (credentials, mirror, evaluation
  sections), the root `AGENTS.md` working rule, and `cli`'s, `core`'s,
  `memory`'s and `eval`'s `AGENTS.md` describe `secrets.json`, the key
  and its backup.

### Task 5: verification and record

- [ ] With the real key, by the controller: the spec's Verification.
- [ ] `docs/reports/2026-10-21-sops-secrets.md`, and the roadmap's
  Revisions line.
