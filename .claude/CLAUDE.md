---
ctime: 2026-09-29
mtime: 2026-10-07
spdx: GPL-3.0-only
title: CLAUDE.md
description: >-
  Claude Code's guide to Dorothy: how to commit, and its architecture: the Agent
  SDK entry point, the Ink TUI, memory, auth and the build.
tags:
  - claude
  - llm
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.claude/CLAUDE.md
   -
   -->

# CLAUDE.md

Continuously granularly commit as you work. Compose single-line commit messages
whenever appropriate. If the granular commit does indeed warrant further
context, include such within the commit message body.

When appropriate and worthwhile to compact, append the following
newline-delimited items to your response:

- A `/compact <summary>`
- Appraisal rating scaled 1-100
- Risk assessment rating scaled 1-100
- Terse single-sentence justification.

## Architecture

`src/index.ts` is the entry point, a near fork of `chewygumxx/claude-sysprompt`.
It calls `query()` from `@anthropic-ai/claude-agent-sdk` with a custom
`options.systemPrompt` string (replacing Claude Code's default preset entirely)
and streams the `text_delta` events of `stream_event` messages to stdout
(`includePartialMessages: true`). The Agent SDK is deliberate for now; a later
iteration moves to Anthropic's Messages API (the `api` commit scope), which is
the only way to fully control the system prompt.

With no argument the entry point opens an Ink TUI (`src/tui/`). The TUI talks
only to `Conversation` (`src/conversation.ts`), which keeps one `query()` alive
in streaming input mode and emits `ready`, `delta`, `turn-end`, `sdk` and
`error` events; keep SDK types out of `src/tui/` (the `sdk` event carries a
structural `RawMessage`, and `src/tui/boundary.test.ts` fails on any SDK
import there).
`src/tui/state.ts` is a pure reducer, so screen logic is tested without Ink.
The input editor is pure too: `src/tui/editor.ts` (draft edits, wrapped layout,
cursor movement) and `recall.ts`, with `Input.tsx` only mapping keys onto them.
`App` owns the draft and the editor's memory (kill buffer, goal column,
recall), since the Too Small screen unmounts `Input`, and runs Ctrl+G's
`$EDITOR` (`external-editor.ts`) inside Ink's `suspendTerminal`.
Transcripts (`src/transcript.ts`) are private JSONL under
`$XDG_DATA_HOME/dorothy/`. Reconnecting seeds a new session with the turns held
in memory, and `--resume` with the transcript's, both via `withHistory`
(`src/persona.ts`). Design: `docs/specs/`, plans: `docs/plans/`.
The persona is composed from components by purpose (`personaComponents`:
identity, voice, capabilities, plumbing, provenance, memory), in chat mode or
in development mode (`--dev`), which adds a mode component, drops provenance
and has Dorothy describe her context; the chat prompt is pinned byte for byte
in `persona.test.ts`. Transcripts record the prompt as `promptHash`
(`xxh3:<hex>`), which nothing reads back. `conversationOptions()` builds what
a session starts with, for `Conversation` and for `--dump-context`
(`src/dump.ts`), which sends a chat's first request to a loopback stand-in for
the API and prints the body.

Memory (`src/memory/`) keeps Dorothy's notes on each conversation in a JSON
sidecar beside its transcript (`<phrase>.meta.json`, `sidecar.ts`). At launch
`run.tsx` loads the catalogue from the recall index, and a `MemoryService`
(`service.ts`) builds the memory block each new `Conversation` starts with
(`withMemory`), frozen for the session, and schedules reviews: one-shot
`query()` calls with `outputFormat` that never block the chat (`review.ts`,
`scheduler.ts`). `trackMemory` decorates the `ChatSession`; `App` sees only a
`notices` source, and `run.tsx` is the one file under `src/tui/` that imports
`src/memory/`. Ranking, the block, the edit view and the list are pure;
`--list` and `--memory` live in `commands.ts`.

Recall (`src/recall/`) is Dorothy's search over past conversations: a
derived SQLite FTS5 index in the XDG cache (`store.ts`), synced from the
transcripts and sidecars before every query (`sync.ts`), with `search` and
`open` (`query.ts`). `server.ts` serves them over MCP on stdio as
`dorothy --recall-server`, which the Agent SDK launches through
`mcpServers`; it is the only file importing `@modelcontextprotocol/sdk`, and
nothing in `src/recall/` imports the Agent SDK (`boundary.test.ts`).
`Conversation` turns the tool calls into `lookup` events, which the TUI shows
as dim lines and records as `recall` transcript events; reviews appraise
each read into the sidecar, and `salience()` (`rank.ts`) weighs appraised
reads with visits. The index doubles as the sidecar write lock and holds
review claims, so two TUIs never review one conversation at once.

Compaction (`src/compaction/`) keeps a long chat within Dorothy's context.
Past `[compaction] soft` tokens, at the next idle (past `hard`, before the
next message), `compact()` asks her through an injected `StructuredCall`
to split the turns leaving the verbatim tail into topical clusters with an
abstract each (`clusters.ts`, `plan.ts`). `Compaction` (`session.ts`)
wraps the `ChatSession`; a pass (`run.ts`, on the shared state in `shared.ts`)
appends the clusters to the sidecar and writes a `compaction` transcript
event, and `Compaction` swaps in a new `Conversation` seeded by
`withClusters` with the abstracts and the turns after them; every session
in `run.tsx` is seeded that way, and the memory block charges the abstracts
to its budget first. `recollect` on the recall server opens a cluster word
for word; the server registers it only with `--recollect`, which
`conversationOptions` adds when there are clusters. Nothing in
`src/compaction/` imports the Agent SDK (`boundary.test.ts`);
`src/structured.ts` is the SDK side, and reviews use it too. The CLI's own
compaction is off: `cliOptions()` sets `DISABLE_COMPACT=1`, and a
`compact_boundary` message is reported as a warning, as an error would end the
turn on screen while the CLI's goes on. Probes:
`docs/reports/2026-10-07-compaction.md`.

`query()` spawns the SDK's bundled `claude` binary on every call, so
`baseOptions` (`src/persona.ts`) keeps that subprocess lean: `tools: []` drops
roughly 32k input tokens of tool definitions, and `settingSources: []` stops it
loading `~/.claude` and `.claude/` settings, which would otherwise run this
repository's `SessionStart` hook and every enabled plugin before the first
token. Settings files are not all it reads, though: from its config directory
it takes the signed-in account and tells the model the user's email, and from
the working directory's repository its auto-memory, git status and worktree
instructions. So every call also spreads `cliOptions()`, which runs the CLI in
a private home (`$XDG_CACHE_HOME/dorothy/claude`, created 0700 by the entry
guard) as both `CLAUDE_CONFIG_DIR` and `cwd`, with
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; it is a function because dotenvx loads the
credentials after import. The CLI still prepends its own identity line, and
appends a system message after each user turn with the working directory,
platform, shell, OS version, model, a token budget and the date, regardless of
`systemPrompt`; the persona prompt tells the model to treat those as incidental
and not to volunteer its provenance. Findings:
`docs/reports/2026-10-07-context-leak.md`.

Auth comes from `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` in `.env`,
which is committed encrypted by dotenvx; set values only with `dotenvx set`.
The entry guard in `src/index.ts` calls dotenvx's `config()` to decrypt it with
the private key from Dotenvx Armor (or a gitignored `.env.keys`).
`.husky/pre-commit` rejects any staged env file holding a plaintext value.
`bunfig.toml` disables Bun's own `.env` autoload (`[env] file = false`):
otherwise Bun preloads the raw ciphertext, `config()` declines to overwrite it,
and the API rejects the ciphertext as a bearer token.

`tsconfig.json` is check-only (`noEmit`) and covers `src/` plus the config
files; `tsconfig.build.json` extends it to emit `src/` to the gitignored `dist/`
(`bun run build`), excluding the colocated `src/**/*.test.ts`. Never edit
`dist/` directly. `bun run check` ends with `bun run test`, which is how CI's
shared `lint.yaml` runs the tests.

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
