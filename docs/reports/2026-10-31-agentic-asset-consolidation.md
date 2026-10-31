---
ctime: 2026-10-31
mtime: 2026-10-31
spdx: GPL-3.0-only
title: Agentic asset consolidation
description: >-
  The agents' procedures made declared assets: two skills with references
  and scripts, eval's and dorothy's new options, the memories trimmed to
  preferences; the tasks, reviews, rulings and live verification.
tags:
  - dorothy
  - agents
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-31-agentic-asset-consolidation.md
   -
   -->

# Agentic asset consolidation

## Summary

[The spec](../specs/2026-10-31-agentic-asset-consolidation-design.md)
and [the plan](../plans/2026-10-31-agentic-asset-consolidation.md) moved
the procedures the first evaluation ran on into the repository. Two
skills of its own hold them: `agent-stewardship`, for running agents
within their context and budgets and recovering when either runs out,
with references for Claude Code, Codex, herdr, budgets and recovery and
six scripts; and `agent-pre-screening`, for agents reviewing a test set.
`eval` gained `--models`, `run --resume latest`, `review --render`,
`--spot-check` and `--reopen`, and stops before any model call when the
token named by `DOROTHY_CLAUDE_TOKEN_VAR` is missing, the chooser now in
`core`. `dorothy --review-backfill -n all` reviews every marked
conversation in one pass and exits 75 at a limit. The memories keep the
user's preferences and link the skill. The scratch scripts are removed;
their copies stay in the private evaluation repository.

Before the plan, Codex reviewed the spec and found thirteen faults, all
settled in it. Eight tasks were built by Claude subagents and reviewed
one by one, then the whole branch on Opus; live verification found one
more fault, fixed and verified.

## The scripts

| Script | What it does |
| --- | --- |
| `send-prompt.sh` | Sends a labelled message to an agent's pane now, or at a time through a transient user timer, retrying a refused delivery and never resending one that may have been written |
| `compact-self.sh` | Types `/compact`, then the instructions, then Enter into its own pane at idle |
| `job.sh`, `job-stopped.sh` | Runs a long job as a user unit; on stopping, records its result, then prompts its agent |
| `with-claude.sh` | Chooses the Claude account by the status line's reading and exports only the token's name |
| `at-limit.sh` | Reruns a command while it exits 75 |
| `pane-lock.sh` | The lock one pane's writers share, and herdr lookups |

## Reviews

- Task 3's review found the spot-check credited an overturned accept to
  its first reviewer; a reopen now voids earlier decisions.
- Task 5's review found `compact-self.sh` typing instructions that open
  with `-` unguarded, where herdr takes no `--`; they gain a leading
  space.
- Task 8's review found the recovery reference's guard on a missing
  reset time false, as `jq` reads `null + 300` as 300.
- The whole-branch review found CI's `shellcheck` failing on the scripts'
  sourced helper, `compact-self.sh` able to lock a different file than
  `send-prompt.sh` for one pane after a pane move, a missing role's
  error naming `eval.toml` under `--models`, and two misleading texts;
  each was fixed in one wave and re-reviewed.

## Rulings

1. The first skill was listed as the repository's own in Task 5, ahead
   of its full text in Task 8, as `agents.test.ts` fails on a linked
   skill it does not know. Cost: a SKILL.md written twice.
2. `-n all` passes over the marked conversations with a set of those
   seen, not a list frozen at its start; one marked mid-pass may join
   it. Cost: none observed.
3. Commit headers take `type(scope):`, as commitlint requires; the plan
   wrote scopes alone. Cost: none.
4. The spot-check samples the agents' decisions only, never the owner's.
   Cost: none.
5. A wake-up's time goes to systemd in UTC, read in the user's zone, as
   numeric zone abbreviations may not parse. Cost: none.
6. A delivery whose text may have been written is never resent, even
   when herdr reports the write failed. Cost: a wake-up lost on a herdr
   fault, recorded in `sends/`.
7. `bun run check` does not lint shell; CI does, so implementers ran
   `shellcheck` and `shfmt` by hand. Cost: the whole-branch review
   caught a lint the hand runs missed.
8. `at-limit.sh --tries N` counts retries after the first run. Cost: one
   try more than a reading of N as total runs.

## Verification

`bun run check` passes under temporary XDG roots: 3,622 tests, one
existing skip; `shellcheck` over every tracked shell file is clean, as
CI runs it. On the live machine:

- `with-claude.sh` chose the primary account on the live reading and
  exported only `CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2`, the token's name.
- A job run with `job.sh` ran in its caller's directory, recorded
  `result=exit-code`, `exited 3`, then delivered its prompt.
- A wake-up armed two minutes ahead was delivered on the minute, and no
  unit was left behind.
- A task sent to Codex with `send-prompt.sh` sat in its input
  unsubmitted: Codex took an Enter arriving straight after the paste as
  part of it. `send-prompt.sh` now pauses a second before Enter
  (`DOROTHY_SEND_PAUSE`); sent again, Codex took the task unaided and
  wrote its result.
- The coordinating session compacts itself with `compact-self.sh` once
  this record is merged, as the last check.

## Deferred

The task reviews' minor findings the whole-branch review left for later,
none affecting behaviour in normal use:

- Tests: a brittle fake in eval's `cli.test.ts`; a fixed 300 ms wait in
  a lock test; a signal fixture using `9` where systemd says `KILL`.
- Edges: a re-render leaving stale `drafts-<k>.md`; `--spot-check` into
  a missing directory failing raw; `with-claude.sh` reading a string
  percentage or a future `at` as limited or fresh;
  `DOROTHY_SEND_PAUSE` unvalidated; `job.sh` making its state directory
  before refusing a path.
- Text: references restating `SKILL.md`'s rules beside their detail;
  the recovery reference's cancel recipe; a few lines over 80 columns
  in script comments.
