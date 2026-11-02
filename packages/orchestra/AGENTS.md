---
ctime: 2026-11-02
mtime: 2026-11-02
spdx: GPL-3.0-only
title: packages/orchestra/AGENTS.md
description: >-
  The orchestra package's guide: an MCP server that runs Claude Code and
  Codex workers boxed, answers their permission requests and pushes
  their work through a sealed broker.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/orchestra/AGENTS.md
   -
   -->

# packages/orchestra/AGENTS.md

`@dorothy/orchestra` runs Claude Code and Codex workers through acpx,
each in a bubblewrap box, answers their permission requests by rules,
a judge and the user, and pushes their work through a sealed broker.
Its design is the
[orchestration spec](../../docs/specs/2026-11-02-orchestration-design.md).

## Entry points and imports

None yet. It depends on `core` alone among Dorothy's packages, and
never on a model provider's SDK: the judge reaches a model as core's
`StructuredCall`.

## Files

- `config.ts`: `[orchestra]` in `config.toml` (`parseOrchestra`,
  `readOrchestra`), every fault an error; `hostName` and
  `isPlainWords`, which the proxy and the rules share.

## Invariants

- Every root, environment and clock is passed in; tests use temporary
  ones and never reach a real agent or provider.
