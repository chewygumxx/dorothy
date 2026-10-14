---
ctime: 2026-10-12
mtime: 2026-10-15
spdx: GPL-3.0-only
title: packages/agent/AGENTS.md
description: >-
  The agent package's guide: Dorothy's model side, the persona, and the
  Agent SDK's single holder.
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

`@dorothy/agent` is Dorothy's model side, and the only package declaring
`@anthropic-ai/claude-agent-sdk`. It calls `query()` with a custom
`systemPrompt` string, replacing Claude Code's preset entirely, and
streams the `text_delta` events of `stream_event` messages
(`includePartialMessages: true`). Model Providers is to replace it.

## Entry points and imports

One entry point, `"."` (`src/index.ts`): `Conversation`,
`conversationOptions`, `runOneShot`, `structuredCall`, `dumpRequest`,
`personaPrompt`, `systemPrompt`, `promptHash` and `prepareCliHome`. Of the
`@dorothy` packages it depends on `core` and `identity`. It declares `zod`
because the Agent SDK takes it as a peer; never prune it as unused.

## Files

- `conversation.ts`: `Conversation`, core's `ChatSession`, keeping one
  `query()` alive in streaming input mode and emitting `ready`, `delta`,
  `turn-end`, `sdk`, `lookup` and `error`; recall's tool calls become
  `lookup` events. `conversationOptions()` builds what a session starts
  with from `SessionStart` and the persona, joining the memory block and
  the earlier section with `withSection` and the turns with `withHistory`.
- `one-shot.ts`: `runOneShot`, a one-shot prompt streamed to stdout.
- `structured.ts`: `structuredCall`, the `StructuredCall` reviews and
  compaction take.
- `persona.ts`: the persona, composed from `personaComponents` (identity,
  voice and provenance from `@dorothy/identity`; capabilities, plumbing
  and memory its own) in chat mode or development mode (`--dev`: a mode
  component, and Dorothy describes her context); `baseOptions` and
  `cliOptions`; `promptHash` (`xxh3:<hex>`), which transcripts record and
  nothing reads back.
- `capture.ts`: `dumpRequest` sends a chat's first request to a loopback
  stand-in for the API and returns the body, for `--dump-context`.

## Invariants

- `query()` spawns the SDK's bundled `claude` binary on every call, so
  `baseOptions` keeps it lean: `tools: []` drops some 32k input tokens of
  tool definitions, and `settingSources: []` stops it loading settings,
  hooks and plugins.
- Every call spreads `cliOptions()`: the CLI runs in a private home
  (`$XDG_CACHE_HOME/dorothy/claude`, 0700, made by `prepareCliHome`) as
  both `CLAUDE_CONFIG_DIR` and `cwd`, with
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and `DISABLE_COMPACT=1`. It is a
  function because dotenvx loads the credentials after import.
- The CLI still prepends its identity line and appends a system message
  after each user turn (working directory, platform, model, date). The
  persona has the model treat those as incidental and not volunteer its
  provenance.
- The CLI's own compaction is off; a `compact_boundary` message is
  reported as a warning, as an error would end the turn on screen.
- Reconnecting seeds a new session with the turns held in memory, and
  `--resume` with the transcript's.

## Tests

- `persona.test.ts` pins the chat prompt byte for byte, and that every
  persona is well formed: change the pin only when the persona is meant
  to change.
- Inject `query()` (`QueryFn`, `StructuredQueryFn`, `CaptureQueryFn`);
  no test reaches the API.

## See also

- [Context leak findings](../../docs/reports/2026-10-07-context-leak.md)
- [Compaction probes](../../docs/reports/2026-10-07-compaction.md)
