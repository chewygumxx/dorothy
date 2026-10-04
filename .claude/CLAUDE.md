---
__cgxx: |
  # vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3:
  # SPDX-License-Identifier: GPL-3.0-only

  #
  #
  # ~chewygumxx/dorothy.git
  # ::: :/.claude/CLAUDE.md
  #
  #

ctime: 2026-09-29
title: CLAUDE.md
description: "Repository instructions"
tags:
  - claude
  - llm
---

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

`query()` spawns the SDK's bundled `claude` binary on every call, so
`baseOptions` (`src/persona.ts`) keeps that subprocess lean: `tools: []` drops
roughly 32k input tokens of tool definitions, and `settingSources: []` stops it
loading `~/.claude` and `.claude/` settings, which would otherwise run this
repository's `SessionStart` hook and every enabled plugin before the first
token. The CLI
still prepends its own identity line and environment context (working
directory, model, date) regardless of `systemPrompt`; the persona prompt tells
the model to treat those as incidental and not to volunteer its provenance.

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
