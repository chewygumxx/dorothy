---
ctime: 2026-10-20
mtime: 2026-10-20
spdx: GPL-3.0-only
title: Recording each harness's sessions, implementation plan
description: >-
  Task-by-task plan for recording: Codex's and Hermes's readers, the
  sources that list each store's sessions, the sweep with its watermark
  and backfill, the service's schedule and `dorothy --sweep`, a probe and
  the record.
tags:
  - dorothy
  - memory
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-20-recording.md
   -
   -->

# Recording each harness's sessions, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `subagent-driven-development` to carry out this plan task by task, one
> subagent at a time, never in parallel. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** record every session of the chosen harnesses into Dorothy's
archive, as [the spec](../specs/2026-10-20-recording-design.md) says.

**Architecture:** new code lives in `packages/memory/src/recording/`,
with its own `AGENTS.md`: `codex.ts` and `hermes.ts` (pure readers),
`sources.ts` (each store's sessions and what is new in them),
`sweep.ts` (one sweep over the hosts), and `state.ts` (`sweep.json`).
Claude Code's reader stays `bodies/claude-code.ts`. The sweep records
through the contract's record path (`contract/record.ts`), so a session
is one conversation and each event lands once by its `sourceId`. The
service schedules it (`service/jobs.ts`); the CLI's `--sweep` runs it
once.

## Global Constraints

- Every new file carries the house header, copied from a sibling: for a
  `.ts` file the `vim:set` line, the SPDX line and the breadcrumb
  (`// ::: :/<path from the repository root>`); JSON files carry none.
- Imports end in `.js`; a package imports only what its `package.json`
  declares and only declared entry points; `workspace.test.ts` holds.
- Tests never read the user's real stores or data: not
  `~/.config/claude*`, `~/.codex`, `~/.hermes`, nor `$XDG_*/dorothy`.
  Every root is a `mkdtemp` directory, and fixtures are synthetic text
  in the shapes the probe captured.
- No secret, token, email address or session content from the user's
  own stores enters a fixture, a log, a report or a commit.
- Reading a store never writes to it: SQLite opened read-only
  (`mode=ro`), files read, never touched.
- Commits: Conventional Commits, header at most 50 characters, body
  lines at most 72, no agent trailers, no em dash. Scopes are the
  package names, `config`, `claude` and `api`. Run
  `bunx biome check --write <paths>` before each commit.
- Markdown lines at most 80 characters; AGENTS.md budgets hold (root
  100, docs 60, a package's 150, a nested one 150).
- Test-first for every behaviour; `bun run check` passes before each
  task's last commit, with the XDG roots under a temporary directory.

## Review Focus

1. A session swept twice, or recorded by `dorothy --claude`'s hooks and
   then swept, is one conversation with each event once. Task 4.
2. A backfilled session is never extracted. Task 4.
3. Nothing reads or writes the user's real stores in a test. Every task.
4. A session the harness marks private is not recorded. Task 4.

### Task 1: Codex's reader

`packages/memory/src/recording/codex.ts`, pure.

- [ ] Capture shapes, not content: from the user's rollouts, record
  each record type's keys and nesting (as the probe in Task 6 will
  document), and write synthetic fixtures in `recording/fixtures.ts`.
- [ ] `readCodex(lines)` returns the session's id, working directory,
  model, and her events: `response_item` messages of role user and
  assistant as user and assistant events, `function_call` and
  `custom_tool_call` paired with their outputs by call id as tool
  events, each stamped with its record's time and a `sourceId` of the
  line's ordinal. Reasoning, token counts and other bookkeeping types
  pass over in silence; an unknown type is kept once; a mapped type in
  an unexpected shape halts, as `bodies/claude-code.ts` does.
- [ ] Tests for each mapped type, bookkeeping, an unknown type, a halt,
  a call without its output, and the working directory and model taken
  from `turn_context`.

### Task 2: Hermes's reader

`packages/memory/src/recording/hermes.ts`.

- [ ] Take the schema from the installed source
  (`~/.hermes/hermes-agent`, read only): `sessions` and `messages`, and
  how tool calls and results are stored.
- [ ] `readHermes(db, since)` reads `messages` of each session in id
  order from a read-only database: user and assistant messages as
  events, tool calls with their results as tool events, `sourceId` the
  message id. A session's `source` or `origin_json` says whether it has
  a working directory; without one it is personal.
- [ ] Tests over a temporary SQLite database built with Hermes's schema
  and synthetic rows.

### Task 3: the sources and the sweep's state

`packages/memory/src/recording/sources.ts` and `state.ts`.

- [ ] A source per host lists its sessions with a key, size or last id,
  and time: Claude Code over the default projects directory and every
  `[service] claude-dirs` entry; Codex under `$CODEX_HOME` or
  `~/.codex`; Hermes under `$HERMES_HOME` or `~/.hermes`. Each source
  takes its roots from an injected environment.
- [ ] `sweep.json` under the state directory keeps, per session, what
  was read last (an offset for a file, a last id for a row) and the
  host's watermark; it is written whole, private, as `bodies/state.ts`
  writes; a missing or broken one is started afresh with a warning.
- [ ] Tests: an unchanged session skipped, an appended file read from
  its offset, a shrunk or replaced file read whole, a lost state file.

### Task 4: the sweep

`packages/memory/src/recording/sweep.ts`.

- [ ] `sweep({ hosts, backfill, env, store, record })` visits each host,
  reads what is new, and records each session through the contract's
  record path, under the store's lock, with its project from
  `projects/identify.ts` and its private flag.
- [ ] The watermark: a host's first sweep stores its start time; a
  session whose events all precede it waits for the backfill.
- [ ] Backfill records every session, marking each so the service's
  extraction passes it over; check how `service/jobs.ts` chooses idle
  conversations, and add the mark there.
- [ ] One conversation per host session: use the mapping
  `bodies/record.ts` uses (`conversation_sessions`), so a session
  `dorothy --claude` recorded continues its conversation.
- [ ] A halt keeps the rest aside through `bodies/unread.ts`; one host's
  failure is logged and the others go on.
- [ ] Tests for every item, including the first Review Focus point
  across the hooks' path and the sweep.

### Task 5: the service, the CLI and the configuration

- [ ] `[recording] hosts` (default empty) and `sweep-seconds` (default
  300) in memory's configuration, validated as the rest is.
- [ ] `service/jobs.ts` runs a sweep at start and on the interval, never
  two at once, and logs a line per sweep with its counts.
- [ ] `dorothy --sweep` runs one sweep and prints a host and a count a
  line; `--backfill` with it records the backlog. Both in `--help`.
- [ ] README: recording other harnesses, the configuration and the
  backfill; memory's `AGENTS.md` and `recording/AGENTS.md`.

### Task 6: the probe

- [ ] With throwaway Dorothy roots, back-fill from temporary copies of a
  few of the user's Codex and Claude Code sessions: record the counts,
  the conversations made, and a scrubbed excerpt of shapes only, in
  `docs/reports/2026-10-20-recording/`.
- [ ] Snapshot that throwaway data directory into a throwaway work
  directory and run the evaluation's `mine` and a retrieval-only run;
  record the conversation and question counts.
- [ ] Fix what the probe finds, if small.

### Task 7: the record

- [ ] `docs/reports/2026-10-20-recording.md`: tasks, rulings with their
  costs, the probe, and what was left.
- [ ] The roadmap: Dorothy's Memory's status and links; OpenClaw's
  reader under Candidates; a Revisions line.
