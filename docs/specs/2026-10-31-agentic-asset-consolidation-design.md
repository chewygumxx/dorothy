---
ctime: 2026-10-31
mtime: 2026-10-31
spdx: GPL-3.0-only
title: Agentic asset consolidation
description: >-
  Design spec for making the agents' own procedures declared assets:
  stewardship of context, budgets and recovery, and agent pre-screening,
  as two skills with references and scripts; and the first evaluation's
  scratch scripts brought into the repository as tested scripts and
  commands.
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
Recovery from a limit met unawares relied on the user scheduling a
message by hand with a script of their own.

This phase moves each procedure into a skill, loaded when the work calls
for it, and leaves memory the user's preferences and the reasons for
them. Two skills hold it all, each a short `SKILL.md` of rules with
references and scripts beside it, so that what differs between Claude
Code and Codex has one place and loads only when needed. Recovery no
longer waits on the agent's client or the user: an agent arms its own
wake-up before a limit can stop it, keeps a note to resume from, and
runs long jobs outside its client. The scripts worth keeping come in as
skill scripts or as commands of `eval` and `dorothy`, with tests; the
rest are dropped, superseded by what is already built. The user agreed
the scope on 2026-10-30 and 31, shaped the skills and recovery, and
trusted the agent with the remaining rulings.

## Decisions

| Decision | Choice | Why, and the cost if wrong |
| --- | --- | --- |
| How many skills | Two of the repository's own, `agent-stewardship` and `agent-pre-screening`, in `.agents/skills/` and linked from `.claude/skills/`, as `worktrees` is | A skill loads only its description until triggered, so one per trigger: running agents, and pre-screening a test set. Cost: a broad description triggers on work that needs one reference |
| Inside a skill | `SKILL.md` holds the rules and an index; `references/` the detail by client and topic; `scripts/` the scripts | Claude Code's and Codex's differences each in one file, read on demand. Cost: an agent that skips a reference misses its detail; the index says when each is needed |
| What memory keeps | The preferences and their reasons: route by budget, approve Codex, compact past 85%, trust to proceed; each linking its skill | Memory is for facts and preferences; a procedure in memory is reloaded every session. Cost: none |
| Sending to an agent | `send-prompt.sh <agent> [--at <time> \| --in <span>]`, the message on stdin: text, then Enter apart, to the agent's pane | Claude Code swallows an Enter that arrives with a bracketed paste, which `herdr agent prompt` sends together. Cost: none |
| Its safeguards | As the user's `herdr-send`: a lock per pane, so sends do not interleave; refusing an agent blocked on a dialog; the message in the unit, never in argv | Proven in the user's use. Cost: none |
| Scheduling | `--at` resolved by `date -d` to a full date before `systemd-run --user --on-calendar`, `--in` as `--on-active`; one transient unit per send, collected after | A bare `02:31` recurs daily, as the user's one-shot did on 2026-10-31. Cost: none |
| Provenance | Every send opens `[from <agent>]`, `[from <agent>, scheduled]` when timed | A label for the reader, not proof: Agent Delegation Receipts are still an IETF proposal, and A2A does not carry over typed text. Cost: none |
| Arming a wake-up | Past 80% of the 5-hour window, or before a long unattended job, the agent schedules a prompt to itself at the window's `resets_at` plus five minutes; the same for Codex at its reset when its limit is met | A limit ends the turn, so recovery is armed before it. Cost: a wake-up that finds nothing pending, read and dropped |
| The resume note | `$XDG_STATE_HOME/dorothy-agents/<agent>.md`: the work in flight, the jobs running, their logs and the next step, rewritten as they change | One place a wake-up and a compaction both resume from, outside the public repository. Cost: a stale note; it carries its time |
| Long jobs | `job.sh <name> [--notify <agent>] -- <command>`: a `systemd-run --user` unit, logging to a named file, prompting the agent when it stops, with its exit | Survives a limit, a memory-pressure reap and a client restart, which the client's background shell does not. Cost: a job's environment is passed explicitly |
| The account launcher | `with-claude.sh <command> [args]` exports only `DOROTHY_CLAUDE_TOKEN_VAR`; `eval` honours it as `dorothy` does | No token in an environment string or `sops exec-env`; one rule for both. Cost: an older checkout ignores the name |
| Its choice | The primary account unless a reading under 10 minutes old has it at 90% of 5 hours or 80% of the week, then the reserve; no primary token, the reserve | As the first run used. Cost: a stale reading tries the primary, whose limit then stops the job for a retry |
| Wait and resume | `at-limit.sh [--wait S] [--tries N] [--retry CMD] -- <command>`: reruns while it exits 75, a `--retry` shell string in place of the command after the first try | One wrapper for every command that stops at a limit. Cost: a fault that exits 75 retries up to N times |
| Resuming a run | `eval run --resume latest`: the work directory's newest run | A retry needs no id parsed from a log. Cost: two runs started in one directory resume the newer |
| A run's models | `--models <file>` on every `eval` command that reads `eval.toml`, which stays the default | The scripts copied files over `eval.toml` and back. Cost: none |
| Backfill reviews | `dorothy --review-backfill -n all` reviews every marked session in batches of 25, renewing its claim between them; a batch stopped by a failed call exits 75, sessions left marked | The paced loop becomes one command under `at-limit.sh`. Cost: a lasting fault retries until the tries run out |
| Rendering for agents | `eval review --render <dir> [--batches N] [--source <model>]` writes drafts with their evidence, as long as `--evidence` says, mode 0600 | What agents pre-screen, from review's own evidence text. Cost: none |
| The owner's spot-check | `eval review --spot-check <file> [--per N]`: the unsure drafts and N accepts per reviewer | Rendered from `reviews.jsonl`. Cost: a sample, not a census |
| Compacting itself | `compact-self.sh <instructions file>`, run in the background: waits for its pane to idle, types `/compact` and a space, then the instructions, then Enter, each apart | The method that worked on 2026-10-31, showing `/compact [Pasted text #1]`; one paste of the whole line was swallowed, and `herdr agent prompt` delivers a message, not a command. Cost: a Claude Code change to input breaks it, and the agent sees no compaction |
| Dropped scripts | `apply-review.ts`, `render-drafts.ts`, `run*.sh`, the first `review-backfill-loop.sh`, `probe-sub.ts`, `repro-claude.ts`, `usage.ts` | Superseded by `review --apply`, the commands above, and the routes' own tests; the probes were one-offs, recorded in their reports. Cost: OpenRouter's spend is read on its site |

## The skills

Each `SKILL.md` carries the house header, a description opening "Use
when", the rules, and an index saying when each reference is needed. No
procedure is held twice.

### `agent-stewardship`

Running agents within their context and budgets, and recovering when
either runs out. `SKILL.md` holds the rules: compact past 85% at a turn
boundary, telling the user; the routing order, Codex if a job fits, else
a Claude subagent on the primary account leaving room for
`dorothy-main`, else the reserve, else a wait for the first reset; when
to arm a wake-up and keep the resume note; long jobs as units; the
`[from <agent>]` label; approve every Codex prompt.

- `references/claude-code.md`: the status line's file, with
  `context_window` and `rate_limits` and when a reading is stale;
  `compact-summary` and `compact-self.sh`; subagents and the accounts
  they spend; the background shell and its reaping.
- `references/codex.md`: dispatch by brief and report files; reading "5h
  N% left", its reset time and "Context N% used"; its question UI (shift
  and left, the option's number, Enter; `ctrl+]` skips); approvals;
  effort and its cost; `/new` between tasks, Enter keeping its worktree.
- `references/herdr.md`: panes and agents, `agent wait`, `agent read`,
  the paste finding, `send-prompt.sh`, and the label's limits.
- `references/budgets.md`: estimating a job, splitting one that fits
  nowhere, the two Claude accounts and `with-claude.sh`, `at-limit.sh`.
- `references/recovery.md`: arming wake-ups for itself and for Codex,
  the resume note's shape, `job.sh`, and what to do on waking: read the
  note, check each job's unit and log, carry on or re-arm.
- `scripts/`: `send-prompt.sh`, `job.sh`, `with-claude.sh`,
  `at-limit.sh` and `compact-self.sh`.

### `agent-pre-screening`

A test set's drafts pre-screened by agents of a vendor other than the
generator's, against one brief; rendered with `review --render`, decided
as `review --apply` lines with the reviewer named, logged in
`reviews.jsonl`; the owner's `--spot-check`; the first run's lesson,
evidence long enough to judge. `references/brief.md` holds the brief
the first run used. Dispatching the reviewers follows
`agent-stewardship`.

## The scripts

The skill's scripts are POSIX shell with the house header, checked by
shellcheck and shfmt as `scripts/` is, and tested beside them. They find
the checkout from their own path, never a home directory. The primary
account defaults to the user's own, `claude-2` with
`CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2`, overridden by `DOROTHY_CLAUDE_PRIMARY`
and `DOROTHY_CLAUDE_PRIMARY_TOKEN_VAR`. No script prints a secret, puts
one in argv, or reads one but to test that it exists. A scheduled send
or a job's unit passes `PATH`, `HERDR_SOCKET_PATH` and
`XDG_RUNTIME_DIR` explicitly, as a user unit starts without them.

The token chooser now in `cli`'s `claude-hook.ts` moves to `core`, so
`eval`'s secrets loading calls the same function.

## Testing

As `statusline.test.ts` does, each script runs against stub commands
(`sops`, `herdr`, `systemd-run`, `jq` where needed) on a temporary
`PATH`, `XDG_RUNTIME_DIR` and `XDG_STATE_HOME`:

- `send-prompt.sh`: the label; text then Enter apart; refusing a
  blocked agent; `--at` handed on as a full date, and `--in` as
  `--on-active`; the message never in argv.
- `job.sh`: the unit's name, log and environment, and the prompt on
  stopping with its exit.
- `with-claude.sh`: the choice for each reading, fresh, stale and
  missing, with and without the primary's token.
- `at-limit.sh`: rerunning on 75 alone, its tries, its wait and
  `--retry`.
- `compact-self.sh`: its keystrokes in order, to its own pane.

`eval`'s tests cover `--models`, `--resume latest`, `--render` and
`--spot-check` over temporary work directories, the sample's randomness
injected; `dorothy`'s, `-n all` and exit 75; `core`'s, the chooser `eval`
now calls. `agents.test.ts` gains the two skills in its own list, linked
for every agent.

## Verification

- The coordinating session compacts itself once with `compact-self.sh`.
- A wake-up armed two minutes ahead arrives in its pane, labelled, and
  leaves no unit behind.
- A short job run with `job.sh` prompts its agent when it stops.
- One small task goes to Codex by the skill.
- `with-claude.sh` prints the account it chose for the live reading.

The scratch scripts are then removed from `~/eval-bakeoff/tools`; their
copies stay in the private repository's `bakeoff/tools` as the record.

## Later

- Message provenance, once Agent Delegation Receipts settle, or A2A or
  another protocol carries it between agents in herdr.
- A peer or a timer watching each agent's context and budget, rather
  than each agent its own.
- Reading the reserve account's budget without a client drawing its
  status line.
