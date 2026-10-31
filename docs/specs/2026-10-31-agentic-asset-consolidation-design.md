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
trusted the agent with the remaining rulings. A review by Codex before
the plan found thirteen faults, each settled here.

## Decisions

| Decision | Choice | Why, and the cost if wrong |
| --- | --- | --- |
| How many skills | Two of the repository's own, `agent-stewardship` and `agent-pre-screening`, in `.agents/skills/` and linked from `.claude/skills/`, as `worktrees` is: `.gitignore` excepts both trees and both links, `agents.test.ts` lists them as its own, and `skills-lock.json` never holds them | A skill loads only its description until triggered, so one per trigger: running agents, and pre-screening a test set. Cost: a broad description triggers on work that needs one reference |
| Inside a skill | `SKILL.md` holds the rules and an index; `references/` the detail by client and topic; `scripts/` the scripts | Claude Code's and Codex's differences each in one file, read on demand. Cost: an agent that skips a reference misses its detail; the index says when each is needed |
| Where their tests live | `scripts/agent-stewardship.test.ts`, running the skill's scripts by path | Bun's test discovery and `tsconfig.json` skip the hidden `.agents/`, so tests there would never run in CI. Cost: tests apart from what they test |
| What memory keeps | The preferences and their reasons: route by budget, approve Codex, compact past 85%, trust to proceed; each linking its skill | Memory is for facts and preferences; a procedure in memory is reloaded every session. Cost: none |
| Sending to an agent | `send-prompt.sh <agent> [--at <time> \| --in <span>]`, the message on stdin: text, then Enter apart, to the agent's pane | Claude Code swallows an Enter that arrives with a bracketed paste, which `herdr agent prompt` sends together. Cost: none |
| What a message holds | Nothing secret or private: a pointer, such as the resume note's path, never its content | Herdr takes the text in argv, and a scheduled message waits in the unit's properties, which `systemctl --user show` prints. Cost: none, as the note says the rest |
| One writer per pane | A lock per pane, `$XDG_RUNTIME_DIR/dorothy-agents/<pane>.lock`, held across every multi-write sequence, `send-prompt.sh`'s and `compact-self.sh`'s alike; the agent resolved to its pane and its status checked after the lock is taken, refusing one blocked on a dialog | A wake-up typed into a half-written `/compact` would corrupt both; a status read before waiting is stale. Cost: a sender waits behind another |
| Scheduling | `--at` takes a time with its date, resolved by `date -d` to a full timestamp with its zone, refused if past or dateless; `--in` becomes `--on-active`; one transient unit per send, collected after | A bare `02:31` recurs daily, as the user's one-shot did on 2026-10-31, and a past date never elapses. Cost: none |
| A refused delivery | A scheduled send that finds its agent blocked or absent before writing re-arms itself in five minutes, up to twelve times, recording each try in `$XDG_STATE_HOME/dorothy-agents/sends/`; one that fails after writing text is recorded and never resent | A wake-up lost while its agent cannot act loses the night's work; a duplicate prompt could act twice. Cost: an hour's retries, then a record for the user |
| Provenance | Every send opens `[from <agent>]`, `[from <agent>, scheduled]` when timed | A label for the reader, not proof: Agent Delegation Receipts are still an IETF proposal, and A2A does not carry over typed text. Cost: none |
| Arming a wake-up | Past 80% of the 5-hour window, or before a long unattended job, the agent schedules a prompt to itself at the window's `resets_at` plus five minutes; the same for Codex at its reset when its limit is met. A missing or past `resets_at` arms nothing and says so | A limit ends the turn, so recovery is armed before it. Cost: a wake-up that finds nothing pending, read and dropped |
| The resume note | `$XDG_STATE_HOME/dorothy-agents/<agent>.md`: the work in flight, the jobs running, their logs and the next step, rewritten as they change | One place a wake-up and a compaction both resume from, outside the public repository. Cost: a stale note; it carries its time |
| Long jobs | `job.sh <name> [--notify <agent>] -- <command> [args]`: a `systemd-run --user` unit in the caller's directory, its argv literal (`--expand-environment=no`), logging to `$XDG_STATE_HOME/dorothy-agents/jobs/<unit>.log` | Survives a limit, a memory-pressure reap and a client restart, which the client's background shell does not. Cost: a job sees only what is passed |
| A job's environment | An allowlist of names, never values that are secret: `PATH`, `HOME`, the `XDG_*` roots, `HERDR_SOCKET_PATH`, `SOPS_AGE_KEY_FILE`, `CLAUDE_CONFIG_DIR` and the `DOROTHY_CLAUDE_*` selectors; secrets are loaded inside the job, by the command itself | A unit starts with none of the caller's environment, and a property is readable. Cost: a job needing another variable is given it by name |
| A job's result | An `ExecStopPost` helper writes `jobs/<unit>.result` first, with systemd's `SERVICE_RESULT`, `EXIT_CODE` and `EXIT_STATUS`, then prompts the agent; a failed prompt is logged beside the result and never changes it | It runs after a crash, a kill or a failed start, and the collected unit keeps nothing. Cost: none |
| The account launcher | `with-claude.sh <command> [args]` exports only `DOROTHY_CLAUDE_TOKEN_VAR`; `eval` honours it as `dorothy` does, and stops before any model call if the named token is missing | No token in an environment string or `sops exec-env`; and a choice that fails must never fall back on another account's token already present. Cost: an older checkout ignores the name |
| Its choice | The primary account unless a reading under 10 minutes old has it at 90% of 5 hours or 80% of the week, then the reserve; no primary token, the reserve | As the first run used. Cost: a stale reading tries the primary, whose limit then stops the job for a retry |
| Wait and resume | `at-limit.sh [--wait S] [--tries N] [--retry CMD] -- <command> [args]`: reruns while it exits 75, a `--retry` shell string in place of the command after the first try | One wrapper for every command that stops at a limit. Cost: a fault that exits 75 retries up to N times |
| A run's models | `--models <file>` on every `eval` command that reads `eval.toml`, which stays the default in the work directory; a given path resolves against the current directory | The scripts copied files over `eval.toml` and back. Cost: none |
| Resuming a run | `eval run --resume latest`: the run in the work directory with the latest recorded `at`, resumed as by its id, so `--models` must name the models it ran with, as a resume checks | A retry needs no id parsed from a log. Cost: two runs started in one directory resume the newer |
| Backfill reviews | `dorothy --review-backfill -n all`: one pass over the marked sessions listed at its start, in batches of 25, each conversation claimed as now; a held one is skipped for the pass, not retried within it; a call that fails stops the pass and exits 75, the rest left marked; a pass that only met held sessions exits 0 and says so | The paced loop becomes one command under `at-limit.sh`, and a held session can no longer fill every batch. Cost: memory's review gains a list to skip |
| Rendering for agents | `eval review --render <dir> [--batches N] [--source <model>]` writes the drafts in file order, in N contiguous batches as even as can be, with their evidence as long as `--evidence` says, mode 0600; `--source` matches a draft's `source`, a bare model taken as `generated:<model>` | What agents pre-screen, from review's own evidence text. Cost: none |
| The owner's spot-check | `eval review --spot-check <file> [--per N]`: the unsure drafts, then N questions per reviewer drawn from those it accepted or edited, each resolved to its new id, still accepted, and named once | Edits are 50 of the 132 accepted, and the sample must test them too. Cost: a sample, not a census |
| Overturning a decision | `eval review --reopen <id> --reason <text>` returns an accepted question to draft, logged in `reviews.jsonl` as the owner's; review then decides it as any draft | The spot-check otherwise has no way to undo an agent's accept. Cost: none |
| Compacting itself | `compact-self.sh <instructions file>`, run in the background: waits for its pane to idle, takes the pane's lock, types `/compact` and a space, then the instructions, then Enter, each apart | The method that worked on 2026-10-31, showing `/compact [Pasted text #1]`; one paste of the whole line was swallowed, and `herdr agent prompt` delivers a message, not a command. Cost: a Claude Code change to input breaks it, and the agent sees no compaction |
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
to arm a wake-up and keep the resume note; long jobs as units; nothing
secret in a message; the `[from <agent>]` label; approve every Codex
prompt.

- `references/claude-code.md`: the status line's file, with
  `context_window` and `rate_limits` and when a reading is stale;
  `compact-summary` and `compact-self.sh`; subagents and the accounts
  they spend; the background shell and its reaping.
- `references/codex.md`: dispatch by brief and report files; reading "5h
  N% left", its reset time and "Context N% used"; its question UI (shift
  and left, the option's number, Enter; `ctrl+]` skips); approvals;
  effort and its cost; `/new` between tasks, Enter keeping its worktree.
- `references/herdr.md`: panes and agents, `agent wait`, `agent read`,
  the paste finding, the pane lock, `send-prompt.sh`, and the label's
  limits.
- `references/budgets.md`: estimating a job, splitting one that fits
  nowhere, the two Claude accounts and `with-claude.sh`, `at-limit.sh`,
  with an example run: `job.sh` around `at-limit.sh`, each try through
  `with-claude.sh` anew, `--retry` keeping `--models`.
- `references/recovery.md`: arming wake-ups for itself and for Codex,
  the resume note's shape, `job.sh` and its results, the record of
  sends, and what to do on waking: read the note, check each job's
  result and log, carry on or re-arm.
- `scripts/`: `send-prompt.sh`, `job.sh` with its stop helper,
  `with-claude.sh`, `at-limit.sh` and `compact-self.sh`.

### `agent-pre-screening`

A test set's drafts pre-screened by agents of a vendor other than the
generator's, against one brief; rendered with `review --render`, decided
as `review --apply` lines with the reviewer named, logged in
`reviews.jsonl`; the owner's `--spot-check`, and `--reopen` for what it
overturns; the first run's lesson, evidence long enough to judge.
`references/brief.md` holds the brief the first run used. Dispatching
the reviewers follows `agent-stewardship`.

## The scripts

The skill's scripts are POSIX shell with the house header, checked by
shellcheck and shfmt, which lint tracked shell at any depth. They find
the checkout from their own path, never a home directory, and depend on
GNU `date` and systemd, as the user's machine has. The primary account
defaults to the user's own, `claude-2` with
`CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2`, overridden by `DOROTHY_CLAUDE_PRIMARY`
and `DOROTHY_CLAUDE_PRIMARY_TOKEN_VAR`. No script prints a secret, puts
one in argv or a unit property, or reads one but to test that it
exists.

The token chooser now in `cli`'s `claude-hook.ts` moves to `core`, so
`eval`'s secrets loading calls the same function and, unlike today's
warning, stops on its failure.

## Testing

As `statusline.test.ts` does, `scripts/agent-stewardship.test.ts` runs
each script against stub commands (`sops`, `herdr`, `systemd-run`, `jq`
where needed) on a temporary `PATH`, `XDG_RUNTIME_DIR` and
`XDG_STATE_HOME`:

- `send-prompt.sh`: the label; text then Enter apart; the status checked
  after the lock; refusing a blocked agent; `--at` handed on as a full
  timestamp, a past or dateless one refused, and `--in` as
  `--on-active`; a scheduled send re-arming when refused before writing,
  recorded and not resent after; the message never in argv to
  `systemd-run`.
- `compact-self.sh`: its keystrokes in order, to its own pane, under the
  lock; a concurrent send waits for it.
- `job.sh`: the unit's name, directory, literal argv with spaces and
  dollar signs, allowlisted environment and log; the stop helper's
  result for an exit, a signal and a failed start, kept when the prompt
  fails.
- `with-claude.sh`: the choice for each reading, fresh, stale and
  missing, with and without the primary's token.
- `at-limit.sh`: rerunning on 75 alone, its tries, its wait and
  `--retry`.

`eval`'s tests cover `--models`, `--resume latest`, `--render`,
`--spot-check` with accepts and edits, and `--reopen`, over temporary
work directories, the sample's randomness injected; and a run stopping
before any call when a named token is missing while another is present.
`memory`'s and `dorothy`'s cover `-n all`: held sessions ahead of
reviewable ones, a pass of held ones alone, and exit 75. `core`'s cover
the chooser. `agents.test.ts` gains the two skills in its own list,
tracked and linked for every agent.

## Verification

- The coordinating session compacts itself once with `compact-self.sh`.
- A wake-up armed two minutes ahead arrives in its pane, labelled, and
  leaves no unit behind.
- A short job run with `job.sh` writes its result and prompts its agent.
- One small task goes to Codex by the skill.
- `with-claude.sh` prints the account it chose for the live reading.

The scratch scripts are then removed from `~/eval-bakeoff/tools`; their
copies stay in the private repository's `bakeoff/tools` as the record.

## Later

- Message provenance, once Agent Delegation Receipts settle, or A2A or
  another protocol carries it between agents in herdr.
- Private messages between agents, delivered from a file rather than
  typed, should a message ever need to carry more than a pointer.
- A peer or a timer watching each agent's context and budget, rather
  than each agent its own.
- Reading the reserve account's budget without a client drawing its
  status line.
