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

Compose single-line commits for granular commits and continuously commit as you
work.

## Architecture

`src/index.ts` is the entry point, a near fork of `chewygumxx/claude-sysprompt`.
It calls `query()` from `@anthropic-ai/claude-agent-sdk` with a custom
`options.systemPrompt` string (replacing Claude Code's default preset entirely)
and streams the `text_delta` events of `stream_event` messages to stdout
(`includePartialMessages: true`). The Agent SDK is deliberate for now; a later
iteration moves to Anthropic's Messages API (the `api` commit scope), which is
the only way to fully control the system prompt.

`query()` spawns the SDK's bundled `claude` binary on every call, so the
exported `options` keep that subprocess lean: `tools: []` drops roughly 32k
input tokens of tool definitions, and `settingSources: []` stops it loading
`~/.claude` and `.claude/` settings, which would otherwise run this repository's
`SessionStart` hook and every enabled plugin before the first token. The CLI
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
