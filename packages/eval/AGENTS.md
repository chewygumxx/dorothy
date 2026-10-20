---
ctime: 2026-10-19
mtime: 2026-10-20
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
for her builders, run as `bun run eval -- <command>`; nothing imports
it, and it has no entry point.

## Entry points and imports

None. Of the `@dorothy` packages it depends on `core` and `memory`, and
of memory only `@dorothy/memory/evaluation`, which opens an archive. It
reads no file of memory's itself.

## Rules

- Every command but `snapshot` takes `--work` and runs with
  `workEnv(work)`, which points every root into the work directory.
  Nothing reads a data directory but `snapshot`, and only the one
  `--from` names.
- Tests build their archive with `writeFixtureData` or
  `snapshotFixture` from `src/testing.ts`, under a temporary root.
- A failure the user can mend is an `UsageError`, said by `runCli` in a
  line, or a line to each problem it lists; anything else is a fault
  and keeps its stack.

## Commands

`snapshot`, `mine`, `generate`, `review`, `run` and `compare`, in the
order a user meets them; the README's "Measuring her memory" shows
each. A new command is a `Command` in `cli.ts`'s table, with its
options declared and described for `--help`, its failures as
`UsageError`s, and a test through `runCli` with `fakeIo`.

## Files

- `main.ts`: the process around `runCli`, with the real terminal;
  `editor.ts`: the owner's editor, whose failure to start is thrown.
- `files.ts`: `readRecord`, which tells a missing JSON file from one
  unreadable or invalid, and `writeAtomic`, which writes whole or not
  at all.
- `cli.ts`: the command table and `runCli`.
- `command.ts`: `Io`, `Command` and the options' readers.
- `snapshot/`: `takeSnapshot`, which refuses a work directory in the
  checkout (found by the package's place, not by `.git`) or a sibling
  worktree, follows a
  link only at the top of what it copies, counts the rest and swaps a
  whole copy in, its record set aside before and written after;
  `readSnapshot`, which tells a missing record from a
  bad one; `workEnv`; and the `snapshot` command.
- `questions/file.ts`: the question file, its schema and ids; the
  commands that rewrite it do so through `updateQuestions`, which reads,
  changes and writes it under a lock file beside it, held by pid; the
  same lock, as `underLock`, serves `generated.json`.
- `questions/mine.ts`: lookup questions from her appraised reads, and
  the `mine` command.
- `questions/generate.ts`: samples, prompts and checks for drafting
  each type; `questions/generate-command.ts`: the `generate` command,
  which merges each call's drafts into the question file as they
  arrive and records each generation's seed in `generated.json`.
- `questions/review.ts`: the owner's pass over the drafts, and the
  `review` command; an edit goes through `editing.json` in the work
  directory, takes a new id from its text and evidence, cannot set the
  status, and if refused says why.
- `models/config.ts`: `eval.toml`, a base URL, model and key variable
  per role; `models/client.ts`: `Models`, one `ChatOpenAI` per role,
  with retries of its own (the client's are off: it does not retry a
  headerless 429) and the `--max-calls` cap.
- `systems/`: `System` and `makeSystem` (`system.ts`); the corpus, the
  snapshot's archive opened once, with items as text (`corpus.ts`);
  `termsOf` and `scoreOf` (`terms.ts`); and the three systems,
  `dorothy.ts`, `lexical.ts` and `full.ts`. A new system is a maker in
  `system.ts`'s table.
- `run/record.ts`: a run's directory, its records and settings; the last
  record per question and system stands.
- `run/judges.ts`: the answering prompt, the judges (openevals' strict
  prompt and ours) and `declines`; `run/run.ts`: `runEvaluation`, which
  appends a record per question and system and resumes where a run
  stopped, asking a failed record again (a paid answer only for the
  judgements it lacks) and refusing a changed snapshot, model or base
  URL, or a question removed or edited since the run began (its
  `definitions` in `run.json`, a digest of each, gold answer included).
  A run without every saved definition cannot be resumed;
  `run/command.ts`: the `run` command.
- `report/`: `summarise`, the Markdown report and `compareOf`, and the
  `compare` command with `writeRunReport`.
- `testing.ts`: `fakeIo`, temporary roots and the fixture archive.
