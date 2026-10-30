---
ctime: 2026-10-31
mtime: 2026-10-31
spdx: GPL-3.0-only
title: Agentic asset consolidation
description: >-
  Design spec for making the agents' own procedures declared assets:
  context stewardship, Codex dispatch, budget routing and agent
  pre-screening as skills, and the first evaluation's scratch scripts
  brought into the repository as tested scripts and commands.
tags:
  - dorothy
  - agents
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-31-agentic-asset-consolidation-design.md
   -
   -->

# Agentic asset consolidation

## Summary

The [first evaluation](../reports/2026-10-31-first-evaluation.md) ran on
procedures the repository does not declare. One coordinating session,
`dorothy-main`, dispatched work to Codex and to Claude subagents across
two accounts, waited out plan limits overnight, and compacted itself;
agents pre-screened the test set crosswise. How to do each lived in
memories, which load whole into every session, and in scratch scripts
under `~/eval-bakeoff/tools`, which import the evaluation's internals by
absolute path and break the rule that every utility is declared here.

This phase moves each procedure into a skill, loaded when the work calls
for it, and leaves memory the user's preferences and the reasons for
them. The scripts worth keeping come in as scripts under `scripts/` or
as commands of `eval` and `dorothy`, with tests; the rest are dropped,
superseded by what is already built. The user agreed the scope on
2026-10-30 and 31 and trusted the agent with its rulings.

## Decisions

| Decision | Choice | Why, and the cost if wrong |
| --- | --- | --- |
| Where procedures live | Four skills of the repository's own, in `.agents/skills/` and linked from `.claude/skills/`, as `worktrees` is | Loaded on demand, read by Claude Code and Codex alike. Cost: a skill an agent does not load is a procedure it does not follow; each description names its triggers |
| What memory keeps | The preferences and their reasons: route by budget, approve Codex, compact past 85%, trust to proceed; each linking its skill | Memory is for facts and preferences; a procedure in memory is reloaded every session. Cost: none |
| The account launcher | `scripts/with-claude.sh <command> [args]` exports only `DOROTHY_CLAUDE_TOKEN_VAR`; `eval` honours it as `dorothy` does | No token in an environment string or `sops exec-env`; one rule for both. Cost: an older checkout ignores the name |
| Its choice | The primary account unless a reading under 10 minutes old has it at 90% of 5 hours or 80% of the week, then the reserve; no primary token, the reserve | As the first run used. Cost: a stale reading tries the primary, whose limit then stops the job for a retry |
| Wait and resume | `scripts/at-limit.sh [--wait S] [--tries N] [--retry CMD] -- <command>`: reruns while it exits 75, a `--retry` shell string in place of the command after the first try | One wrapper for every command that stops at a limit. Cost: a fault that exits 75 retries up to N times |
| Resuming a run | `eval run --resume latest`: the work directory's newest run | A retry needs no id parsed from a log. Cost: two runs started in one directory resume the newer |
| A run's models | `--models <file>` on every `eval` command that reads `eval.toml`, which stays the default | The scripts copied files over `eval.toml` and back. Cost: none |
| Backfill reviews | `dorothy --review-backfill -n all` reviews every marked session in batches of 25, renewing its claim between them; a batch stopped by a failed call exits 75, sessions left marked | The paced loop becomes one command under `at-limit.sh`. Cost: a lasting fault retries until the tries run out |
| Rendering for agents | `eval review --render <dir> [--batches N] [--source <model>]` writes drafts with their evidence, as long as `--evidence` says, mode 0600 | What agents pre-screen, from review's own evidence text. Cost: none |
| The owner's spot-check | `eval review --spot-check <file> [--per N]`: the unsure drafts and N accepts per reviewer | Rendered from `reviews.jsonl`. Cost: a sample, not a census |
| Compacting itself | `scripts/compact-self.sh <instructions file>`, run in the background: waits for its pane to idle, types `/compact`, a space, the instructions, Enter | The method that worked on 2026-10-31: one paste of the whole line did nothing, and `herdr agent prompt` delivers a message, not a command. Cost: a Claude Code change to input breaks it, and the agent sees no compaction |
| Messages between agents | Text an agent sends through herdr opens with `[from <agent>]` | A label for the reader, not proof; provenance stays a candidate. Cost: none |
| Dropped scripts | `apply-review.ts`, `render-drafts.ts`, `run*.sh`, the first `review-backfill-loop.sh`, `probe-sub.ts`, `repro-claude.ts`, `usage.ts` | Superseded by `review --apply`, the commands above, and the routes' own tests; the probes were one-offs, recorded in their reports. Cost: OpenRouter's spend is read on its site |

## The skills

Each is a `SKILL.md` with the house header, its description opening
"Use when", and no procedure another skill already holds; each links
the others it relies on.

- **`context-stewardship`**: reading the session's own context
  (`context_window.used_percentage` in the status line's file) and
  Codex's ("Context N% used" in its pane); compacting past 85%, at a
  turn boundary only, with `compact-summary`'s instructions and
  `compact-self.sh`, telling the user each time; resetting Codex with
  `/new` between tasks, Enter keeping its worktree.
- **`codex-dispatch`**: a brief and report as files; `herdr agent prompt
  dorothy-codex`, then `herdr agent wait --until idle`, in the
  background; approving every prompt, answering its question UI (shift
  and left, then the option's number, then Enter; `ctrl+]` skips);
  reading "5h N% left" and the reset time; effort and what it costs.
- **`budget-routing`**: estimating a job; Codex if it fits, else a Claude
  subagent on the primary account leaving room for `dorothy-main`, else
  the reserve, else a wait for the first reset; splitting a job that
  fits nowhere; `with-claude.sh` and `at-limit.sh`, in the background,
  never a polling loop; a job reaped under memory pressure is restarted
  only when the user asks.
- **`agent-pre-screening`**: a test set's drafts pre-screened by agents
  of a vendor other than the generator's, against one brief; rendered
  with `review --render`, decided as `review --apply` lines with the
  reviewer named, logged in `reviews.jsonl`; the owner's
  `--spot-check`; and the first run's lesson, evidence long enough to
  judge.

## The scripts

`with-claude.sh`, `at-limit.sh` and `compact-self.sh` go in `scripts/`,
POSIX shell, with the house header, checked by shellcheck and shfmt as
the others are. They find the checkout from their own path, never a
home directory. The primary account defaults to the user's own,
`claude-2` with `CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2`, and is overridden by
`DOROTHY_CLAUDE_PRIMARY` and `DOROTHY_CLAUDE_PRIMARY_TOKEN_VAR`. No
script prints a secret, puts one in argv, or reads one but to test that
it exists.

The token chooser now in `cli`'s `claude-hook.ts` moves to `core`, so
`eval`'s secrets loading calls the same function.

## Testing

As `statusline.test.ts` does, each script runs against stub commands
(`sops`, `herdr`, `jq` where needed) on a temporary `PATH` and
`XDG_RUNTIME_DIR`: the launcher's choice for each reading, fresh, stale
and missing, with and without the primary's token; `at-limit.sh`
rerunning on 75 alone, its tries, its wait and `--retry`;
`compact-self.sh`'s keystrokes in order, to its own pane. `eval`'s
tests cover `--models`, `--resume latest`, `--render` and
`--spot-check` over temporary work directories, the sample's randomness
injected; `dorothy`'s, `-n all` and exit 75; `core`'s, the chooser
`eval` now calls. `agents.test.ts` gains the four skills in its own
list, linked for every agent.

## Verification

The coordinating session compacts itself once with `compact-self.sh`,
and dispatches one small task to Codex by the skill. `with-claude.sh`
prints the account it chose for the live reading. The scratch scripts
are then removed from `~/eval-bakeoff/tools`; their copies stay in the
private repository's `bakeoff/tools` as the record.

## Later

- Message provenance, by A2A, Agent Delegation Receipts or both.
- A peer or a timer watching each agent's context and budget, rather
  than each agent its own.
- Reading the reserve account's budget without a client drawing its
  status line.
