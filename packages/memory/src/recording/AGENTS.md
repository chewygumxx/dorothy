---
ctime: 2026-10-20
mtime: 2026-10-20
spdx: GPL-3.0-only
title: packages/memory/src/recording/AGENTS.md
description: >-
  Harness readers, sources, synthetic fixtures and the sweep's private
  change hints and watermarks.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/memory/src/recording/AGENTS.md
   -
   -->

# packages/memory/src/recording/AGENTS.md

Harness readers return core's `RecordEvent` values and session metadata.
Decoding is pure; Hermes's query edge opens only its supplied path,
read-only. Sources and the sweep persist through `contract/record.ts`;
readers never open a Dorothy store.

## Files

- `codex.ts`: `readCodex(lines, options?)` reads rollout JSONL into
  `session`, `cwd`, `model`, `at`, `events`, `halt`, `unknown`, `pending`;
  the latest valid `turn_context` gives directory and model.
- `hermes.ts`: `readHermes(dbPath, since = 0, session?, options?)` opens
  SQLite read-only, selecting a session before fetching payloads; a read
  has the same fields plus `parent` and `source`. `since` floors stable
  source ids, exclusively; sources pass zero: those ids are not monotonic.
- `sources.ts`: `claudeSource`, `codexSource`, `hermesSource`; each lists
  descriptors with key, path, time, fingerprint and `read(prev?, opts?)`.
- `state.ts`: private `sweep.json`, per-key skip fingerprints alone.
- `watermark.ts`: a host's first sweep time, in the data directory's
  `recording.json`, committed to history, never in `sweep.json`.
- `sweep.ts`: `sweep(deps)`, one pass over the hosts; read below.
- `fixtures.ts`, `hermes-fixtures.ts`, `sweep-testing.ts`: synthetic
  records, Hermes tables and the sweep's rig; nothing from a real store.

## Invariants

- Codex source ids are one-based physical line ordinals as decimal strings;
  blank and bookkeeping lines count. `lineOffset` supplies the number of
  preceding physical lines when reading an appended slice. A tail has
  only the metadata it contains; the source must retain session metadata.
- Codex's `halt.line`, `unknown.line` and `pending` index supplied lines
  from zero. A malformed mapped record halts; unknown types are kept once per
  read. Diagnostics name the problem without quoting record contents.
- Codex tool events use the call's pairing, timestamp and line ordinal.
  Function and custom calls pair only with their own output family.
  Repeated ids pair the nth call with the nth output in physical order;
  an extra output cannot replace an earlier answer. `ok: true` means
  answered, not execution success: outputs carry no success flag.
  An unanswered call holds subsequent events, with `pending` naming it;
  replay from there when its output arrives. Reused ids need their prior
  occurrence counts too, so replay the full rollout in that case.
  Only `ended: true` records an unanswered call as failed. Output
  lookahead stops at a halt.
- Host prompts, reasoning and known bookkeeping yield no events.
  User-role environment and AGENTS/instruction wrappers are host context;
  remove their leading wrapped blocks, keeping speech that follows.
  `metadata.client_authored: false` also occurs on ordinary speech.
- `input_image` becomes `[image]`; known file, audio, refusal, reasoning,
  summary and encrypted blocks are skipped. Unknown block tags and text
  blocks without string text halt; no image or attachment is opened.
- The reader returns raw tool strings; the canonical record path owns
  scrubbing and trimming. Nothing here writes or calls a model.

## Hermes invariants

- `parent` names `parent_session_id` for the contract's parent link.
  A uid held by that parent session is not emitted again in the child.
  Decode carried calls as correlation context for new child results.
- The installed schema records a directory in `sessions.cwd`.
  `source` and `origin_json` describe transport/routing, never a fallback
  to this process's directory. No recorded cwd means a personal session.
- Messages are decoded by integer id, never by timestamp (Unix seconds).
  A malformed mapped row halts only its session, preserving the prefix;
  `halt.id` names the bad row, or is null for metadata or an invalid id.
  Unknown roles and tool types are retained once with their first `id`.
- User and assistant speech use their stable message ids; a tool uses
  its result message's stable id and time. Each event stays unique when
  one assistant row has both speech and multiple calls. `ok` means answered.
  Durable tool occurrence uids pair first; older rows use the latest
  preceding call with that provider id within the same user turn.
  Folded UID maps can hold one uid per occurrence in a list; shared
  response uids consume their calls in order, once per result.
- `pending` is the earliest unanswered assistant row's id, holding
  later events; its own speech can emit. Replay retains earlier rows,
  so an answer after `since` can find its call. With `ended` and no halt
  the call is recorded failed (source id `<row>:<id>[:n]`, id escaped),
  releasing the rest; else it stays pending.
- A uid's source id is its lowest physical row id in that session,
  including rewind rows (`active=0, compacted=0`). Decode only visible
  rows (`active=1` or `compacted=1`); an entirely invisible uid emits
  nothing. Compare `since` with that stable id. Pending and halt still
  use physical positions, so a later copied event cannot bypass a gap.
- `absorbed_message_uids` lists a merge's other constituents; the
  survivor keeps its first constituent's uid. Suppress composites that
  share an already held uid. A newly emitted merge holds all its members,
  including on cursor replay; the parent also holds its merge members.
  Correlation still decodes suppressed copies; no string matching splits
  or merges speech, and malformed visible witnesses halt that session.
- Legacy copies can get fresh random uids from Hermes's insert trigger
  and cannot be linked to originals: such stores can yield duplicates.
  Never merge on text. Rows without uids keep their physical ids.
- Keep original compacted rows; omit inactive rewind rows, model-only
  composites, synthetic display rows and compression handoffs. Read
  `content`, never `api_content`; strip user-role host wrappers and
  memory fences, keeping speech. Assistant text and tool strings skip that.
- Sentinel `\0json:` content decodes once. Plain JSON-looking prose stays
  prose; typed image blocks become `[image]`, known multimodal envelopes
  yield their text summary. Malformed text or unknown block types halt.

## Tests

Tests use synthetic lines and temporary roots; never open a real store.

## Sources and the sweep

- Every root comes from an injected `Env`, never the process home.
  Claude covers its default account and all `claude-dirs`, no subagents.
- An unchanged file matches size, nanosecond mtime, inode and device;
  Hermes matches maximum physical row id and row count, including
  invisible rows, but not an in-place UPDATE: a known limit. These are
  equality hints, never event cursors; archive sourceId dedupe decides
  what is new, so losing `sweep.json` costs a whole reread only.
- Changed sessions are read whole, files at `lineOffset: 0`. No byte or
  maximum-sourceId cursor is persisted; shrink, replacement, rewrites and
  torn tails therefore keep the reader's whole context. `read` returns
  null for unchanged or vanished: a vanished entry skips, not its host.
- `sweep` takes the contract's `record`, Claude's `recordClaude`
  (`bodies/record.ts`, continuing `dorothy --claude`'s conversation) and
  `conversation`. A session waits for the backfill when its mtime or all
  its events precede the watermark, yet keeps its diagnostics. A
  backfill ignores hints and marks its conversations in `onRecorded`;
  `noteRecorded` (`jobs.ts`) unmarks one a live record reaches.
  `isPrivate` sessions send only `private: true`.
- Remember a read (`rememberRead`) only after the archive took it and
  unread diagnostics are saved. Never a halted or unstable read, one
  whose type was not kept, nor one holding lines behind an unanswered
  call (Claude's `held`, others' `pending`) until `ended`: backfilled, or
  untouched an hour.
- A halt keeps its rest in `bodies/unread.ts` under its host (Hermes
  counts rows). A record failure stops that host, not others.
