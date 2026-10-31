---
ctime: 2026-10-31
mtime: 2026-10-31
spdx: GPL-3.0-only
title: Budgets
description: >-
  Estimating a job against the plans' budgets, splitting one that fits
  nowhere, the two Claude accounts and with-claude.sh, and at-limit.sh,
  with an example run.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.agents/skills/agent-stewardship/references/budgets.md
   -
   -->

# Budgets

## Estimating a job

Before dispatching, read what is left: Claude's usage file
([Claude Code](./claude-code.md)) and Codex's footer
([Codex](./codex.md)). Then estimate what the job spends, from a like
job's spend if one ran: the share of a window one batch took, times the
batches. Count the effort it runs at: Codex at `xhigh` spends far
faster than at `high`. Route it as the skill's rules say, and when a
job fits nowhere whole, split it: a part that fits now, the rest after a
reset, each part a whole unit of work with its own report. Say a job
will not fit before it starts.

## The Claude accounts

Two accounts, each a `CLAUDE_CONFIG_DIR`, each with an OAuth token in
`secrets.json`:

- The primary, `claude-2`, which `dorothy-main` runs on and spends
  first; its token is `CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2`.
  `DOROTHY_CLAUDE_PRIMARY` and `DOROTHY_CLAUDE_PRIMARY_TOKEN_VAR`
  override the two names.
- The reserve, `claude`, for when the primary is spent; its token is
  `CLAUDE_CODE_OAUTH_TOKEN`.

`with-claude.sh <command> [args]` runs a command on the account to
spend. It picks the primary when its token is in `secrets.json`, unless
the primary's usage file, under 10 minutes old, has it past 90% of the
5-hour window or 80% of the week; then the reserve. No reading, a stale
one or a malformed one tries the primary, whose limit then stops the
job for a retry. It exports only the token's name, as
`DOROTHY_CLAUDE_TOKEN_VAR`, which `eval` and `dorothy` read; neither
falls back on another token, and `eval` stops before any model call if
the named one is missing. It prints the account chosen to stderr.

## Waiting at a limit

`eval run`, `eval generate` and `dorothy --review-backfill -n all` exit
75 when a plan's limit stops them, keeping what is done.
`at-limit.sh` reruns such a command:

```text
at-limit.sh [--wait S] [--tries N] [--retry CMD] -- <command> [args]
```

While the command exits 75, it waits S seconds (1200) and runs it
again, up to N more times (40). `--retry` gives a shell string run with
`sh -c` in place of the command after the first try, such as a resume.
It exits with the last run's code.

## An example run

The baseline evaluation, from the checkout, as a unit that outlives the
session, each try choosing its account anew:

```sh
S=.agents/skills/agent-stewardship/scripts
W=~/eval M=~/eval/eval.baseline.toml
E="bun run eval -- run --work $W --models $M"
"$S/job.sh" rerun --notify dorothy-main -- "$S/at-limit.sh" \
    --retry "$S/with-claude.sh $E --resume latest" \
    -- "$S/with-claude.sh" sh -c "$E"
```

- `job.sh` runs the rest as a systemd unit in the current directory,
  so start it from the checkout, and prompts `dorothy-main` when it
  stops ([recovery](./recovery.md)).
- `at-limit.sh` reruns on 75 alone. Its first try starts the run; each
  retry runs `--retry` instead, resuming the latest run.
- `with-claude.sh` stands inside each try, so the account is chosen
  again after every wait, from the reading then.
- `--retry` keeps `--models`, as a resume checks that the models are
  the ones the run began with.

A review of every backfilled conversation is the same shape, with no
resume to name, as `-n all` takes up what is still marked:

```sh
"$S/job.sh" backfill --notify dorothy-main -- "$S/at-limit.sh" \
    -- "$S/with-claude.sh" bun run dev -- --review-backfill -n all
```
