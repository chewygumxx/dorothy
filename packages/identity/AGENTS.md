---
ctime: 2026-10-15
mtime: 2026-10-15
spdx: GPL-3.0-only
title: packages/identity/AGENTS.md
description: >-
  The identity package's guide: who Dorothy is, in text any host can
  give a model.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/identity/AGENTS.md
   -
   -->

# packages/identity/AGENTS.md

`@dorothy/identity` says who Dorothy is, how she speaks and what she says
of what runs her, in text that names no host, protocol or provider. Her
chat persona (`agent`) and the gateway behind `dorothy --claude`
(`gateway`) both take it, so she is the same Dorothy in either.

## Entry points and imports

One entry point, `"."` (`src/index.ts`): `identityComponents`,
`identityPrompt` and `IdentityComponent`. It depends on nothing, not even
`core`, and does no I/O.

## Files

- `identity.ts`: the `identity`, `voice` and `provenance` components, in
  the order `identityPrompt` joins them.

## Invariants

- The same text on every call: a request carrying it keeps its prompt
  cache, so nothing in it may vary by time, host or environment.
- What a host lets her do and how it runs her (capabilities, plumbing)
  belong to the host, not here.

## Tests

`identity.test.ts` pins the prompt byte for byte: change it only when
Dorothy is meant to change, and re-pin `agent`'s `persona.test.ts` with
it.

## See also

- [Dorothy's identity spec](../../docs/specs/2026-10-15-identity-gateway-design.md)
