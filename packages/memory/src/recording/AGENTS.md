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

Pure harness readers return core's `RecordEvent` values and session
metadata. Sources and the sweep will supply files and persist those
values through `contract/record.ts`; readers never open a store.

## Files

- `codex.ts`: `readCodex(lines, options?)`, Codex rollout JSONL. It returns
  `session`, `cwd`, `model`, `at`, `events`, `halt`, `unknown` and `pending`.
  Session metadata gives the id and start time; the latest valid
  `turn_context` gives the working directory and model. Separate decoders
  validate session, context, message, call and output records before the
  ordered emission pass pairs calls inside the valid prefix.
- `fixtures.ts`: synthetic text in observed record shapes. No real
  session id, message, tool input/output, credential or account address.

## Invariants

- A source id is the one-based physical line ordinal as a decimal string;
  blank and bookkeeping lines count. `lineOffset` supplies the number of
  preceding physical lines when reading an appended slice. A tail has
  only the metadata it contains; the source must retain session metadata.
- `halt.line`, `unknown.line` and `pending` index the supplied lines from
  zero. A malformed mapped record halts; unknown types are kept once per
  read. Diagnostics name the problem without quoting record contents.
- Tool events use the call's id pairing, timestamp and line ordinal.
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

## Tests

`codex.test.ts` uses only synthetic in-memory lines. Never open a real
harness store in a test. Shape inspection outside tests prints only
record discriminators, keys and nesting, with dynamic map keys masked.

## Later

`event_msg/item_completed` carries `exit_code` and `status` keys. A future
reader could use those for execution outcomes if its `id` can be linked
to the response item's `call_id`; that linkage is not established here.
