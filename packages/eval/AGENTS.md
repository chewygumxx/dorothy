---
ctime: 2026-10-19
mtime: 2026-11-01
spdx: GPL-3.0-only
title: packages/eval/AGENTS.md
description: >-
  The evaluation package's guide: measuring Dorothy's memory on
  questions drawn from her own data.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/eval/AGENTS.md
   -
   -->

# packages/eval/AGENTS.md

`@dorothy/eval` measures Dorothy's memory, as
[its spec](../../docs/specs/2026-10-18-memory-evaluation-design.md)
says: a snapshot of a data directory, questions mined and generated
from it, systems asked them, answers judged, and a report. It is a tool
for her builders, run as `bun run eval -- <command>`.

## Entry points and imports

None; nothing imports it. It depends on `core` and `memory`, of memory
only `@dorothy/memory/evaluation`, which opens an archive.

## Rules

- Every command but `snapshot` takes `--work` and runs with
  `workEnv(work)`, which points every root into the work directory.
  Only `snapshot` reads a data directory, the one `--from` names.
- Tests build their archive with `writeFixtureData` or
  `snapshotFixture` from `src/testing.ts`, under a temporary root.
- A failure the user can mend is a `UsageError`, said by `runCli` in a
  line, or one to each problem it lists; anything else is a fault and
  keeps its stack.

## Commands

`snapshot`, `mine`, `generate`, `review`, `run` and `compare`, in the
order a user meets them; the README's "Measuring her memory" shows
each. A new command is a `Command` in `cli.ts`'s table, its options
declared and described for `--help`, its failures `UsageError`s, with a
test through `runCli` and `fakeIo`.

## Files

- `main.ts`: the process around `runCli`, with the real terminal;
  `editor.ts`: the owner's editor, whose failure to start is thrown.
- `files.ts`: `readRecord`, which tells a missing JSON file from one
  unreadable or invalid, and `writeAtomic`, whole or not at all.
- `cli.ts`: the command table and `runCli`.
- `command.ts`: `Io`, `Command`, the options' readers and `--models`, which
  `run` and `generate` take. `modelOptions` injects model runners, files
  and CLI lookup; commands own env and caps.
- `secrets.ts`: `loadModelSecrets` awaits core's loader on the checkout's
  `secrets.json` before paid model calls, with code-only warnings, then
  `chooseClaudeToken`; false if `DOROTHY_CLAUDE_TOKEN_VAR` names no token,
  and `run` and `generate` return 1. Tests inject `Io.loadSecrets`.
- `snapshot/`: `takeSnapshot`, which refuses a work directory in the
  checkout (found by the package's place, not by `.git`) or a sibling
  worktree, follows a link only at the top of what it copies, counts the
  rest and swaps a whole copy in, its record set aside before and written
  after; `readSnapshot`, which tells a missing record from a bad one;
  `workEnv`; the `snapshot` command.
- `questions/file.ts`: the question file, its schema and ids; the
  commands that rewrite it do so through `updateQuestions`, which reads,
  changes and writes it under a lock file beside it, held by pid; the
  same lock, as `underLock`, serves `generated.json`.
- `questions/mine.ts`: the `mine` command: lookup questions from her
  appraised reads (a backfilled session has none).
- `questions/generate.ts`: samples, prompts and checks for drafting each
  type; `questions/generate-command.ts`: the `generate` command, which
  merges each call's drafts into the question file as they arrive and
  records each generation's seed and any role tokens in `generated.json`.
- `questions/review.ts`: the owner's pass over the drafts and the
  `review` command (`--evidence`: characters shown of each
  conversation); an edit goes through `editing.json` in the work
  directory, takes a new id from its text and evidence, cannot set the
  status, and if refused says why. `--apply` runs an agent's decisions
  through the same `checkedEdit` and `place`, in one locked write (none
  on `--dry-run`), reporting and skipping a bad line: a key it does not
  know, or an edit that gives nothing or changes nothing. Each decision,
  the owner's too (an edit by old id and new), is a `reviews.jsonl`
  line; `reopen` makes an accepted question a draft, logging why. The
  modes `--apply`, `--render`, `--spot-check`, `--reopen` (`modeOf`)
  exclude each other and each other's options.
- `questions/render.ts`: `renderDrafts` writes drafts as `drafts-<k>.md`;
  `spotCheck`, the unsure ones and a sample of each agent's accepts, not
  the owner's, the first to name one keeping it, a `reopen` voiding it.
- `models/config.ts`: `eval.toml`, or the file `--models` names (which
  must exist), each role's route (`api` by default, `claude` or `codex`),
  model, API credentials or Codex effort; errors name the file.
- `models/client.ts`: `Models`, dispatch, retries and `--max-calls`;
  `tokens` snapshots reported usage by role, with openevals' judge usage
  from a raw API completion callback; CLI replies count before schema
  validation. `prepare` checks CLI availability before a call. The API
  client's own retries are off.
- `models/cli.ts`: isolated CLI attempts, private prompt/schema files,
  stdin, filtered environments, reply parsing and token events. A
  timeout terminates the detached process group; signals stop all live
  groups and remove their directories, with handlers only while live.
  Startup errors do not retry; cleanup is best effort. Codex error events
  may be retry notices; exit, turn.failed and the reply decide success.
  A reply that says the plan's usage limit is reached, read before the
  exit code, is a `PlanLimit`, never retried: a `RunStop`, as `CallCap`
  is, so `run` and `generate` stop with what is done; a run resumes
  after the reset, generate is run again. Either exits 75
  (`EXIT_TEMPFAIL`) for a wrapper to wait on; a `CallCap` exits 0. What
  it says: Claude, an error reply with status 429, or text with "usage
  limit", "usage credits", "out of credits", "rate limit", "hit your ...
  limit" (its session, weekly, Opus, Sonnet or Fable limit) or "limit
  reached"; Codex, an error or turn.failed event with the first four, but
  only when the turn did not complete: a retry notice that a completed
  turn outlived is no limit. The reset time ("try again at", or Claude's
  "resets") is kept only if it is a time or date. A Codex notice that
  the plan "automatically switched" the model "due to usage limits"
  also stops the run, even from a completed turn, as the reply is not
  the role's model's; only the text names it. `models/testing.ts`:
  injected in-memory runner and files; integration tests use temp scripts.
- `systems/`: the corpus and the systems a run asks, `dorothy`, `lexical`,
  `full` and the `cited` ceiling: [the systems' guide](./src/systems/AGENTS.md).
- `run/record.ts`: a run's directory, records (retrieval by stage: found,
  delivered, covered) and settings; `run.json` keeps cumulative role
  tokens, optional on older runs. The last record per question and
  system stands. `latestRunId`, for `--resume latest`: the greatest `at`,
  ties by id, skipping a directory with no valid `run.json`.
- `run/judges.ts`: the answering prompt, the judges (openevals' strict
  prompt and ours, strict and lenient behind `MEMORY_NOTE`) and
  `declines`; `run/run.ts`: `runEvaluation`, which appends a record per
  question and system and resumes where a run stopped, asking a failed
  record again (a paid answer only for the judgements it lacks) and
  refusing a changed snapshot, model or base
  URL, or a question removed or edited since the run began (its
  `definitions` in `run.json`, a digest of each, gold answer included).
  A run without every saved definition cannot be resumed. Reported
  token deltas are saved even for capped or failed work; a resumed
  older run marks new totals partial. `run/command.ts`: the command.
- `report/`: `summarise`, whose cells count found, delivered and covered,
  the Markdown report with role token totals beside the answer costs,
  `compareOf`, the `compare` command and `writeRunReport`. Older runs say
  totals were not kept.
- `testing.ts`: `fakeIo`, temporary roots and the fixture archive.
