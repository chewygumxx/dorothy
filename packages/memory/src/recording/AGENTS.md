---
ctime: 2026-10-20
mtime: 2026-10-20
spdx: GPL-3.0-only
title: packages/memory/src/recording/AGENTS.md
description: >-
  Readers for external harness sessions, their synthetic fixtures and
  the contracts the later sweep consumes.
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

- `codex.ts`: `readCodex(lines, options?)`, Codex rollout JSONL. It returns
  `session`, `cwd`, `model`, `at`, `events`, `halt`, `unknown` and `pending`.
  Session metadata gives the id and start time; the latest valid
  `turn_context` gives the working directory and model. Separate decoders
  validate session, context, message, call and output records before the
  ordered emission pass pairs calls inside the valid prefix.
- `hermes.ts`: `readHermes(dbPath, since = 0)` opens Hermes SQLite
  read-only and returns one `HermesRead` per session, in session-id order.
  Each has `session`, `parent`, `source`, `cwd`, `model`, `at`, `events`,
  `halt`, `unknown` and `pending`. Only emitted events are filtered by `since`;
  decode earlier rows too, for call correlation and stable identities.
- `hermes-fixtures.ts`: installed Hermes v31 `sessions`/`messages` table
  DDL and synthetic row builders. Writers create only temporary fixtures.
- `fixtures.ts`: synthetic text in observed record shapes. No real
  session id, message, tool input/output, credential or account address.

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
  `since` is an exclusive global message-id floor for emitted events.
  A malformed mapped row halts only its session, preserving the prefix;
  `halt.id` names the bad row, or is null for metadata or an invalid id.
  Unknown roles and tool types are retained once with their first `id`.
- User and assistant speech use their stable message ids; a tool uses
  its result message's stable id and time. Each event stays unique when
  one assistant row has both speech and multiple calls. `ok` means answered.
  Durable tool occurrence uids pair first; older rows use the latest
  preceding call with that provider id within the same user turn.
- `pending` is the earliest unanswered assistant row's id, holding
  later events; its own speech can emit. Replay retains earlier rows,
  so an answer after `since` can find its call. An ended session with
  no result remains pending; no result id or outcome is invented.
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
- Legacy copies can acquire fresh random uids from Hermes's insert
  trigger and cannot be linked to their originals; such stores can
  yield duplicate events. Never merge on text. Rows without uids retain
  their physical ids; distinct uids stay distinct even for equal text.
- Keep original compacted rows; omit inactive rewind rows, model-only
  composites, synthetic display rows and standalone compression handoffs.
  Read `content`, never `api_content`; remove user-role host wrappers and
  memory fences, keeping actual speech around a compression handoff.
  Assistant text and raw tool strings are not passed through that filter.
- Sentinel `\0json:` content decodes once. Plain JSON-looking prose stays
  prose; typed image blocks become `[image]`, known multimodal envelopes
  yield their text summary. Malformed text or unknown block types halt.

## Tests

`codex.test.ts` uses synthetic in-memory lines; `hermes.test.ts` builds
SQLite fixtures under `mkdtemp` roots and removes them after each test.
Never open a real harness store in a test. Shape inspection outside tests
prints record discriminators, keys and nesting, with dynamic map keys
masked.

## Later

`event_msg/item_completed` carries `exit_code` and `status` keys. A future
reader could use those for execution outcomes if its `id` can be linked
to the response item's `call_id`; that linkage is not established here.
