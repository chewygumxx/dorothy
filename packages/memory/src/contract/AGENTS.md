---
ctime: 2026-10-18
mtime: 2026-10-20
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
- `block.ts`: the opening block, confirmed knowledge of the user, then
  of the project, then unconfirmed knowledge, fenced as claims, then
  conversations, packed into a host's budget; `frozen.ts` keeps each
  session's, so `resume` gives it byte for byte.
- `recall.ts`: passages for a prompt, for the user's turn, `within`
  personal and its project's scopes (`recall/query.ts`'s option).
- `record.ts`: records into the archive, each host session one
  conversation, each event once by its `sourceId`, under the lock, a
  torn tail cut off before an append (`cutTornTail`, `../transcript.ts`).
- `remember.ts`: `remember` over knowledge ids, as `recall/remember.ts`
  guards it.
- `tools.ts`: the four MCP tools, an unexpected error reading
  `Memory failed.`; `testing.ts`: a fake engine.
- `../engine/`: `MemoryEngine`, and the baseline over today's index,
  salience and reviewer.
- `../hosts/`: host profiles, one JSON file a harness.
- `../service/`: the HTTP service (`service.ts`, its routes; `guard.ts`
  refuses what a web page could send; `jobs.ts` extracts, consolidates
  and exports in the background; `http.ts`, `recent.ts` are theirs),
  device tokens (`tokens.ts`), the client (`client.ts`), the stdio
  bridge (`bridge.ts`, its own entry point, `"./bridge"`) and the CLI's
  runners (`run.ts`). `loopback.ts` tells loopback addresses and URLs;
  `confine.ts` admits a transcript path. `direct.ts` is the client's
  and the bridge's fetch, which reaches loopback and the addresses in
  `[service] listen` over `node:http`, as Bun's fetch would take even
  loopback through `HTTP_PROXY`.
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
- Knowledge is confirmed when the user wrote it or verified it
  (`isConfirmed`, `../facts/file.ts`); a repository's files, which a
  model may write, confirm nothing. The rest sits in the block's own
  fenced section, below every confirmed piece for the budget, and
  `search`, `open` and recall carry `UNCONFIRMED` on it.
  Only `--verify`, the user's, adds a `verified` entry; a write by
  anyone else drops it. Sync carries it in the exported file, bound to
  its words by `wordsDigest`, and an import keeps it only for them.
- Migration leaves a fact in `facts/`, with a warning, when its
  `knowledge/` target exists or the file fails; it overwrites nothing,
  and names what else it finds there.
- A hook request's `project` is a project's id as the client makes it,
  or a 400; the tools take an id or a path. `brief` keeps to the named
  host's `blockBudget`, as the opening block does, and, like `open` and
  `remember`, refuses (403) a project other than its connection's own.
- With reviews off the service still takes idle conversations off its
  list, and writes why to its log (`claude-hook.log`).

## The evaluation's door

`"./evaluation"` (`src/evaluation.ts`) is for `@dorothy/eval` alone:
`openArchive` opens the baseline engine over an environment's roots and
lists its conversations, knowledge and appraised reads as plain
records; `writeArchive` writes a small archive for its tests. It writes
only the recall index, where the environment points. Appraised reads
leave out a hidden reader's, counted, and name a transcript it could
not read.
