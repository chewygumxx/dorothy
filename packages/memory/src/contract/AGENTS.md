---
ctime: 2026-10-18
mtime: 2026-10-18
spdx: GPL-3.0-only
title: packages/memory/src/contract/AGENTS.md
description: >-
  The memory contract: what every harness receives from her memory and
  gives back, and the service, client and bridge that carry it.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/memory/src/contract/AGENTS.md
   -
   -->

# packages/memory/src/contract/AGENTS.md

The memory contract: what every harness receives from her memory and
gives back, and the service that speaks it. The spec is
[the memory contract](../../../../docs/specs/2026-10-18-memory-contract-design.md).

## Files

- `schemas.ts`: zod schemas of core's contract types, held to them by
  `satisfies`; `parseWith` throws a `ContractError` (`errors.ts`) of 400.
- `block.ts`: the opening block, knowledge of the user, then of the
  project, then conversations, packed into a host's budget; `frozen.ts`
  keeps each session's, so `resume` gives it byte for byte.
- `recall.ts`: passages for a prompt, for the user's turn, `within`
  personal and its project's scopes (`recall/query.ts`'s option).
- `record.ts`: records into the archive, each host session one
  conversation, each event once by its `sourceId`, under the lock.
- `remember.ts`: `remember` over knowledge ids, as `recall/remember.ts`
  guards it.
- `tools.ts`: the four MCP tools, an unexpected error reading
  `Memory failed.`; `testing.ts`: a fake engine.
- `../engine/`: `MemoryEngine`, and the baseline over today's index,
  salience and reviewer.
- `../hosts/`: host profiles, one JSON file a harness.
- `../service/`: the HTTP service (`service.ts`, refusing what a web
  page could send), device tokens (`tokens.ts`), the client
  (`client.ts`), the stdio bridge (`bridge.ts`, its own entry point,
  `"./bridge"`) and the CLI's runners (`run.ts`). `loopback.ts` tells
  loopback addresses and URLs; `confine.ts` admits a transcript path.
  `recall/server.ts`, `tools.ts` and `../service/` alone import
  `@modelcontextprotocol/sdk`.

## Invariants

- An engine proposes; the service validates and writes, so the files
  stay the truth.
- Harnesses write through the service, under the store's lock, which her
  commands take too.
- Scope is the service's to enforce: a request sees personal knowledge
  and its own project's. `open` refuses another's (403); it is reached
  only by `search` with `scope: all`. On a connection with a project,
  `open` and `remember` refuse an argument naming another (403).
- A transcript path is taken only over loopback, and only a regular
  `.jsonl` file of at most 64 MiB under Claude Code's `projects`
  directory or one of `[service] claude-dirs`, by its real path; anything
  else gets one fixed 403, and the service warns once.
  Anything else from beyond loopback carries a device token. A local
  proxy or tunnel to 127.0.0.1 looks like loopback, so none may front it.
- The client fails open: a 2xx is delivered, and a record refused for
  good (400, 403, 404, 413, 415 or 422) is dropped. The queue stops at
  anything else not delivered: network failure, timeout, 401, 408, 421,
  429 or 5xx. It never throws and never waits past its deadline.
- A request whose `Host` is not one the service listens on gets 421, so
  a client reaching it by another name keeps its records; the service
  warns once per name. A web page's `Origin` is refused with 403.
- Migration leaves a fact in `facts/`, with a warning, when its
  `knowledge/` target exists or the file fails; it overwrites nothing.
