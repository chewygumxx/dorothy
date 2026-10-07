---
ctime: 2026-10-07
mtime: 2026-10-07
spdx: GPL-3.0-only
title: Token budgets and a gateway
description: >-
  An idea from the compaction work: keep every token budget in one module
  that runs consult, and enforce them in a proxy between the SDK and the API.
tags:
  - dorothy
  - sdk
  - notes
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-10-07_budgets-gateway.md
   -
   -->

# Token budgets and a gateway

## The idea

The budgets that shape Dorothy's context are scattered and arbitrary:
`[memory] budget`, `[compaction] soft`, `hard` and `tail`, and, once
compaction caps the turns it sends in one call, that cap too. They belong
in a separate module that any part of a run can query, and that a gateway
enforces: a proxy between the SDK and the API URL that every request passes
through.

## What exists to build on

- `src/dump.ts` already starts a local `Bun.serve` and points the CLI at it
  through `ANTHROPIC_BASE_URL`, to capture the first request for
  `--dump-context`. The gateway is the same move kept up for the whole run,
  forwarding instead of answering.
- Compaction measures context from the last assistant message's usage plus
  an estimate of the reply, and the memory block counts tokens as
  `ceil(characters / 4)`. A gateway sees every request and the usage of
  every response, so budgets could be enforced on measured tokens rather
  than estimates.
- The compaction design keeps `src/compaction/` free of the Agent SDK. A
  gateway at the HTTP boundary works the same whether Dorothy talks to the
  API through the SDK's CLI or the Messages API directly.

## Open questions

- Is the module the single source of the values, with `config.toml` only
  overriding its defaults, or does it read the config itself?
- What does the gateway do with a request over budget: refuse it, hold it
  for a compaction, or only report it?
- Does the gateway see the reviews' and compaction's own calls, which run as
  separate one-shot queries, or only the chat?
- How does a budget relate to the model's window when the model changes
  mid-run?

## Next

Its own brainstorm and spec, after the compaction branch lands.
