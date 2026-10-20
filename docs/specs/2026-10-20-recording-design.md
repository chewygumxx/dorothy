---
ctime: 2026-10-20
mtime: 2026-10-20
spdx: GPL-3.0-only
title: Recording each harness's sessions
description: >-
  Design spec for recording the sessions of Claude Code, Codex, Hermes
  Agent and OpenClaw into Dorothy's archive: a reader per harness, a
  sweep of each one's session store by her service, and a backfill of
  the sessions they already hold, without a paid review apiece.
tags:
  - dorothy
  - memory
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-20-recording-design.md
   -
   -->

# Recording each harness's sessions

## Summary

Dorothy remembers only what reaches her archive, and today only her chat
and the Claude Code sessions begun through `dorothy --claude` do. A first
retrieval run of the [evaluation](./2026-10-18-memory-evaluation-design.md)
on 2026-10-20 found 10 conversations, while the user's two Claude Code
accounts hold some 970 sessions and Codex 7. This spec records every
session of the [harnesses chosen](../roadmap.md): Claude Code, Codex,
Hermes Agent and OpenClaw. Her service sweeps each one's session store,
a reader per harness turns what is new into her events, and one command
backfills what they already hold, recording it without a paid review
apiece. The [contract's](./2026-10-18-memory-contract-design.md) record
envelope is the way in; this spec says what each store yields.

## Decisions

| Decision | Choice | Why, and the cost if wrong |
| --- | --- | --- |
| Trigger | The service sweeps each store on a schedule and at start | Needs no change to any harness's configuration, which is delivery's; a hook would record sooner. Cost: up to one interval's lag |
| Backfill | `dorothy --sweep --backfill`, run by the user | Recording a thousand sessions is the user's call. Cost: one command to run |
| Reviews | No extraction for a backfilled session | A review per session would cost some 970 paid calls. Cost: backfilled sessions have no notes until reviewed later |
| Live reviews | A swept session is extracted once idle, as the contract says | As a hooked session is. Cost: one call per live session |
| Hosts | Opt-in per host, `[recording] hosts` | Recording every session a harness holds is not to be assumed. Cost: a line of configuration |
| Dorothy's own launches | One conversation per host session, whoever records it | `dorothy --claude`'s hooks and the sweep must not record a session twice. Cost: none |
| OpenClaw | Its reader waits until it is installed and probed | No session of it exists to read, and its store's format is unchecked. Cost: OpenClaw is recorded later |

## The sweep

A sweep visits each host in `[recording] hosts`. For each, it lists the
host's sessions, skips those unchanged since it last read them, reads
what is new in the rest, and records it through the contract's record
path, in the service's process, under the store's lock.

- **When:** at the service's start, then every
  `[recording] sweep-seconds` (default 300). `dorothy --sweep` runs one
  sweep in the foreground, for a user without the service.
- **What is new:** a session's events carry the harness's own ids as
  their `sourceId`, so a session read twice records each event once.
  For speed, the sweep keeps, per session file or row, its size, time
  and the offset or last id read, in
  `$XDG_STATE_HOME/dorothy/sweep.json`; losing it costs a slower sweep,
  never a duplicate.
- **The watermark:** the first sweep of a host records the time it
  started. A session whose events all precede it is left for the
  backfill; one with events after it is recorded whole.
- **The backfill:** `dorothy --sweep --backfill` records every session
  the hosts hold, regardless of the watermark, marked as backfilled, so
  no extraction runs on it. It prints what it recorded, a host and a
  count a line.
- **Projects:** a session's working directory, where the harness records
  one, names its project as `projects/identify.ts` does; one without is
  personal.
- **Private sessions:** a session its harness marks private, or
  incognito, is not recorded, as the contract says.
- **Scrubbing and trimming:** every event passes through the scrub and
  the trims that recording applies today.
- **Failure:** a session that cannot be read halts at its first bad
  record, as Claude Code's reader does today: what precedes it is
  recorded, the rest is kept aside and the user is told, through
  `bodies/unread.ts`. One host's failure never stops another's.

## The readers

Each reader is pure: a host's raw records in, her events out, with the
session's id, working directory, model and time. A record of a type it
neither maps nor lists as bookkeeping is passed over and kept once, as
today.

- **Claude Code:** `bodies/claude-code.ts`'s `readLines`, unchanged,
  over every directory `[service] claude-dirs` names and the default
  one. Subagents' transcripts and forks stay out, as before.
- **Codex:** a new reader of `~/.codex/sessions/**/rollout-*.jsonl`.
  `response_item` messages become user and assistant events,
  `function_call` and `custom_tool_call` with their outputs become tool
  events, `turn_context` gives the working directory and model, and
  reasoning, token counts and other bookkeeping are passed over. Its
  `sourceId` is the rollout's line ordinal.
- **Hermes Agent:** a new reader of `~/.hermes/state.db`, opened
  read-only: `sessions` and `messages` in order, user and assistant
  messages becoming events and tool calls with their results tool
  events. Its `sourceId` is the message's id. Sessions from a chat
  platform, which have no working directory, are personal.
- **OpenClaw:** left until OpenClaw is installed and a probe has
  captured its session files; then a reader of its session JSONL joins
  the others with no change to the sweep.

## Reviews and extraction

A swept session that is not backfilled is extracted once idle for
`[memory] idle-seconds`, by the engine, as a hooked session is, so its
notes and knowledge follow as they do today. A backfilled session is
searchable and openable at once but has no notes until reviewed; the
roadmap's later work may add a capped review of backfilled sessions.

## Configuration

```toml
[recording]
hosts = ["claude-code", "codex"]  # none by default
sweep-seconds = 300
```

`[service] claude-dirs` keeps its meaning. A host's store moves with its
own environment variable where the harness has one (`CLAUDE_CONFIG_DIR`,
`CODEX_HOME`, `HERMES_HOME`).

## Testing

- Each reader against fixtures shaped as the probe captured the real
  store, never the user's own files: every mapped type, a bookkeeping
  type passed over, an unknown type kept once, a malformed record
  halting.
- The sweep over temporary stores: a new session recorded, an unchanged
  one skipped, an appended one read from its offset, a lost
  `sweep.json` causing no duplicate, the watermark leaving old sessions
  to the backfill, a private session left out, one host's failure not
  stopping another.
- A session recorded by `dorothy --claude`'s hooks and then swept stays
  one conversation with each event once.
- The backfill marks its sessions so no extraction runs.

## Verification

A probe records a temporary copy of a few real Codex and Claude Code
sessions, scrubbed, as fixtures, and a retrieval run of the evaluation
on a backfilled snapshot reports how many conversations and questions it
now holds. Running the backfill on the user's real data is the user's
call.

## Later

- OpenClaw's reader, once installed and probed.
- A capped review of backfilled sessions.
- Recording through each harness's hooks or plugin, with delivery.
- Subagents' transcripts and forks linked to their parents.

## Out of scope

- Delivery into each harness: its own spec.
- The engine: its own spec, on the evaluation's numbers.
