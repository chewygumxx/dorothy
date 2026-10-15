---
ctime: 2026-10-15
mtime: 2026-10-15
spdx: GPL-3.0-only
title: packages/gateway/AGENTS.md
description: >-
  The gateway package's guide: a loopback stand-in for the API that adds
  Dorothy's identity to an agentic client's main thread.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/gateway/AGENTS.md
   -
   -->

# packages/gateway/AGENTS.md

`@dorothy/gateway` stands between an agentic client and the API. It
forwards every request, and in one whose system prompt carries the
marker, which `dorothy --claude` appends, it puts Dorothy's identity in
the marker's place. Dorothy's Gateway is to grow it with memory, budgets
and model routing.

## Entry points and imports

One entry point, `"."` (`src/index.ts`): `startGateway`, `upstreamFrom`,
`DEFAULT_UPSTREAM`, `MARKER`, `injectIdentity`, `rewriteRequest` and
their types. It depends on `core` and `identity`,
never on a model provider's SDK.

## Files

- `anthropic.ts`: the Anthropic protocol. `MARKER`, `injectIdentity` (the
  identity with a section after it, after the first block that is not
  the billing header, the marker and the space around it gone, an
  emptied block's `cache_control` moved to the block before) and
  `rewriteRequest` (gzip, parsing, drift; a marker only in the messages
  is a quotation, not drift). An OpenAI adapter would sit beside it.
- `server.ts`: `startGateway`, and the section it is started with, on
  `127.0.0.1`, port `0`, `idleTimeout: 0`;
  `POST .../v1/messages` and `.../count_tokens` go to `rewriteRequest`,
  everything else through byte for byte, to the upstream's path and
  query joined with the request's. A client's abort reaches the
  upstream; an upstream that cannot be reached gets a 502 in the API's
  shape (its origin only, never credentials), and one that drops a
  reply ends it quietly, an event stream with the API's `error` event.

## Invariants

- Additive: only the marker is removed. The billing header, the client's
  identity line, the rest of its text, messages and headers stay as
  sent.
- Never record or log a header or a body; write nothing to the terminal,
  which the client owns. `stats` counts injections and drift instead.
- A request without the marker passes byte for byte, so a client that
  changes fails safe, and drift tells of it.
- The gateway learns nothing of memory: the section, the memory block
  `dorothy --claude` renders, is opaque text it places as given, fixed
  for the launch so the prompt cache holds.

## Tests

`anthropic.test.ts` covers the rewrite on fixtures, one of them the
shape the probe found; `server.test.ts` runs the gateway against a
stand-in upstream on loopback, streams and dropped replies among them.
No test reaches the API.

## See also

- [Dorothy's identity spec](../../docs/specs/2026-10-15-identity-gateway-design.md)
- [The probes](../../docs/reports/2026-10-15-identity-gateway.md)
