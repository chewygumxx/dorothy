---
ctime: 2026-10-19
mtime: 2026-10-19
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
- A failure the user can mend is an `UsageError`, said in one line by
  `runCli`; anything else is a fault and keeps its stack.

## Files

- `main.ts`: the process around `runCli`, with the real terminal.
- `cli.ts`: the command table and `runCli`.
- `command.ts`: `Io`, `Command` and the options' readers.
- `snapshot/`: `takeSnapshot`, `readSnapshot`, `workEnv`, and the
  `snapshot` command.
- `questions/file.ts`: the question file, its schema and ids; the
  commands that rewrite it read it with `readQuestionsToRewrite`.
- `questions/mine.ts`: lookup questions from her appraised reads, and
  the `mine` command.
- `questions/generate.ts`: samples, prompts and checks for drafting
  each type; `questions/generate-command.ts`: the `generate` command,
  which records each generation's seed in `generated.json`.
- `questions/review.ts`: the owner's pass over the drafts, and the
  `review` command; an edit goes through `editing.json` in the work
  directory, and takes a new id from its text and evidence.
- `models/config.ts`: `eval.toml`, a base URL, model and key variable
  per role; `models/client.ts`: `Models`, one `ChatOpenAI` per role,
  with retries of its own (the client's are off: it does not retry a
  headerless 429) and the `--max-calls` cap.
- `systems/`: `System` and `makeSystem` (`system.ts`); the corpus, the
  snapshot's archive opened once, with items as text (`corpus.ts`);
  `termsOf` and `scoreOf` (`terms.ts`); and the three systems,
  `dorothy.ts`, `lexical.ts` and `full.ts`. A new system is a maker in
  `system.ts`'s table.
- `run/record.ts`: a run's directory, its records and settings;
  `report/`: `summarise`, the Markdown report and `compareOf`, and the
  `compare` command with `writeRunReport`.
- `testing.ts`: `fakeIo`, temporary roots and the fixture archive.
