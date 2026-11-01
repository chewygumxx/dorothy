---
ctime: 2026-10-12
mtime: 2026-11-01
spdx: GPL-3.0-only
title: packages/agent/AGENTS.md
description: >-
  The agent package's guide: Dorothy's model side, her runtime on the
  Vercel AI SDK, the persona, and the model SDKs' single holder.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/agent/AGENTS.md
   -
   -->

# packages/agent/AGENTS.md

`@dorothy/agent` is Dorothy's model side, and the only package declaring a
model provider's SDK: `ai`, `@ai-sdk/anthropic` and `@ai-sdk/mcp`, at a
thin edge, as core's contracts carry no SDK type. It runs her on the
Vercel AI SDK, reaching Anthropic's Messages API with her own system
prompt, one route per role.

## Entry points and imports

One entry point, `"."` (`src/index.ts`): `Conversation`,
`conversationSetup`, `MAX_STEPS`, `runOneShot`, `structuredCall`,
`dumpRequest`, `captureServer`, `DUMP_KEY`, `connectRecall`,
`recallEnv`, `personaPrompt`, `systemPrompt`, `promptHash`, `routeLine`
and their types. Of the `@dorothy` packages it depends on `core` and
`identity`. It declares `zod` as the AI SDK's peer; never prune it as
unused.

## Files

- `providers.ts`: `languageModel`, the AI SDK's model for a route entry.
  Every provider gets its base URL (Dorothy appends `/v1`) and key
  explicitly and `noRedirect` as its fetch, so none reads
  `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` or any variable of its own;
  `keyOf` reads an entry's key from the environment passed in. It turns
  the AI SDK's console warnings off and sets `providerOptions`.
- `failures.ts`: `failureOf`, a provider's error, thrown or streamed, as
  core's `Failure`; only this package knows the wire.
- `cost.ts`: `stepUsage`, a step's usage as core's `stepCost` prices
  it, and `unpricedNotice`, once a process per model with no price.
- `attempt.ts`: `STALL_MS`; `Watchdog`, an attempt's abort (its route's
  signal, or a stall: no stream part for `STALL_MS`), as the AI SDK's own
  chunk timeouts miss a server that never answers; `secretFailure`.
- `structured.ts`: `structuredCall`, the `StructuredCall` reviews and
  compaction take: `streamText` with `Output.object` on a route, run by
  `runRoute`, all attempts sharing the request's `timeoutMs`. Anthropic
  does not enforce `maxLength` and the like, so an answer is validated
  with zod's `fromJSONSchema` (a schema it cannot read keeps the
  top-level type check), and one that fails is put back to the model up
  to `STRUCTURED_REPAIRS` times within the attempt.
- `recall-tools.ts`: `connectRecall`, an MCP stdio client of the recall
  server (this program again, from `RecallLaunch`), its tools named
  `mcp__memory__<name>` and only those a session may use. `recallEnv`
  is the caller's environment less every key a route names, every
  `*_API_KEY` and every `CLAUDE_CODE_OAUTH_TOKEN*`; `recallCwd` is a
  directory of Dorothy's, never the user's project.
- `turn.ts`: `TurnState`, one turn's progress across its attempts: the
  reply, calls awaiting results, usage, and whether text has streamed or
  `remember` has run, after which no other model takes the turn over.
- `conversation.ts`: `Conversation`, core's `ChatSession`, the messages
  held here, a turn per message through `runRoute` on the chat route,
  with at most `MAX_STEPS` tool steps. Events: `ready` (its `model` a
  label), `delta`, `turn-end`, `sdk` (a stream part), `lookup`,
  `remember`, `warning` and `error`. Cache breakpoints sit on the system
  prompt and the latest user message, the second never stored. Reasoning
  is kept to the model that made it. `conversationSetup()` builds what a
  session starts with from `SessionStart` and the persona, joining the
  memory block and the earlier section with `withSection` and the turns
  with `withHistory`; development mode ends with `routeLine`.
- `one-shot.ts`: `runOneShot`, a one-shot prompt streamed to stdout from
  a session of its own; a failure goes to stderr, exit status 1.
- `persona.ts`: the persona, composed from `personaComponents` (identity,
  voice and provenance from `@dorothy/identity`; capabilities, plumbing
  and memory its own, memory telling her to keep lasting facts with
  `remember` when she has recall) in chat mode or development mode
  (`--dev`: a mode component, Dorothy describes her context, and
  `routeLine` ends it with the chat route's models);
  `promptHash` (`xxh3:<hex>`), which transcripts record and nothing
  reads back.
- `capture.ts`: `captureServer`, a loopback stand-in for the API that
  records request bodies and answers with an error; `dumpRequest` sends a
  chat's first request to it and returns the body, for `--dump-context`.
  The CLI's `--claude --dump-context` puts it behind the gateway.
- `testing.ts` and `fake-mcp.ts`: for tests only, `fakeMessages`, mock
  models, hand-fired timers and a stand-in MCP server.

## Invariants

- Every model call sets `maxRetries: 0` and `onError: () => {}`: retries
  and fallback are `runRoute`'s, and the AI SDK writes nothing itself.
- No fallback once text has streamed or `remember` has run.
- Reconnecting seeds a new session with the turns held in memory, and
  `--resume` with the transcript's.

## Tests

- `persona.test.ts` pins the chat prompt byte for byte, and that every
  persona is well formed: change the pin only when the persona is meant
  to change.
- Wire tests run on `fakeMessages` on loopback, behaviour tests on
  `mockModel` (`ai/test`); no test reaches a provider or reads
  `secrets.json`.

## See also

- [Context leak findings](../../docs/reports/2026-10-07-context-leak.md)
- [Compaction probes](../../docs/reports/2026-10-07-compaction.md)
