---
ctime: 2026-11-01
mtime: 2026-11-01
spdx: GPL-3.0-only
title: Model Providers deferred findings
description: >-
  Review findings and live-run limits left after Model Providers' two
  parts merged, each with why it waited.
tags:
  - dorothy
  - models
  - deferred
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/deferred/2026-11-01_model-providers-deferred.md
   -
   -->

# Model Providers deferred findings

Left by the reviews of Part B (#113) and its live run; see the
[report](../reports/2026-11-01-model-providers.md#part-b-routing).
None sends a request down a wrong route or leaks a key.

## Behaviour

- A mid-stream error whose code is a word, such as
  `rate_limit_exceeded`, is classed `network`, so a streamed rate limit
  of that shape is not cooled down (`agent/src/failures.ts`). Every
  class but `cancelled` falls back, so only the message and the
  cooldown suffer.
- The Chat Completions kinds send no output limit, so each provider's
  default applies; a reply that reaches it now warns, but sending a
  limit of Dorothy's own waits, as a provider may refuse one.
- Thinking on the other kinds is the provider's default (Part B's
  Ruling 3), so reasoning models spend their default think.
- The TUI keeps a warning for the session, so the output-limit and
  ten-step warnings stay after later turns answer in full.
- A message of reasoning alone is dropped, which can leave two user
  messages in a row; a server whose chat template insists on
  alternating roles refuses it, and the next entry answers.
- featherless's plan allows one GLM-5.3-Flash request at a time, so a
  review and a chat on the same model collide; the README advises a
  second entry.
- The `local` kind has met only the live run's stand-in, as the user
  has no local model.

## Tests

- No test pins that each caller takes its own role's route: the default
  routes give review and compaction the same model, so a swap would pass.
- No test pins that the TUI's sessions take `chatDeps`, so dropping the
  key names there would pass; the line was verified by reading.
- The chat runners' exit 1 on a routing fault is tested through
  `chatRouting` only, and the service's and hook's `withNotes` wiring by
  reading only.
- Smaller gaps: a route naming a provider that faulted; the redirect
  test's failure class; Hugging Face's `:provider` suffix on the wire; a
  `length` finish on an earlier step followed by a normal last one.

## Tidying

- `routing.ts` casts `FIXED_ROOTS` and keeps empty base-url examples for
  kinds that take none; `prices.ts` casts after its own-property guard;
  `core` exports a type named `Provider`.
- `noUsageNotice` is exported but used only in `cost.ts`; the hook's log
  lines carry no `memory:` prefix, as its log is memory's own.
