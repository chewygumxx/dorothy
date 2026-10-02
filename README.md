---
__cgxx: |
  # vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3:
  # SPDX-License-Identifier: GPL-3.0-only

  #
  #
  # ~chewygumxx/dorothy.git
  # ::: :/README.md
  #
  #

ctime: 2026-09-29
title: "dorothy"
description: "Conversational LLM interface"
tags:
  - llm
  - chatbot
  - dorothy
---

# dorothy

Conversational LLM interface

Dorothy is a conversational assistant in the spirit of <https://claude.ai>,
built for now on the Claude Agent SDK with a custom system prompt. A later
iteration moves to Anthropic's Messages API.

## Prerequisites

- Bun >=1.4
- Either an Anthropic API key or a Claude Pro/Max subscription

[mise](https://mise.jdx.dev) supplies a matching Bun version from `mise.toml`:

```sh
mise trust
mise install
```

## Installation

```sh
bun install
```

## Authentication

`.env` is committed, encrypted with [dotenvx](https://dotenvx.com), and
decrypted at startup with the private key from Dotenvx Armor (or a gitignored
`.env.keys`). Set one of the two variables `.env.example` documents, never as
plaintext:

- `ANTHROPIC_API_KEY`: pay-per-token API credits.
- `CLAUDE_CODE_OAUTH_TOKEN`: a Claude Pro/Max subscription token, minted by
  running `claude setup-token`.

```sh
bunx dotenvx set CLAUDE_CODE_OAUTH_TOKEN <token>
```

## Usage

Run directly from source, no build step required:

```sh
bun run dev -- "What is your name?"
```

Or build once and run the compiled output:

```sh
bun run build
bun start -- "What is your name?"
```

Either command streams one reply to stdout as it is generated, in character as
Dorothy per the system prompt in `src/persona.ts`.

Run with no argument for a chat in the terminal:

```sh
bun run dev
```

Enter sends, Esc stops a reply, Ctrl+R shows the raw SDK messages and Ctrl+C
or `/exit` quits. Each chat is named by a four-word phrase shown in the status
bar and saved as it happens to
`~/.local/share/dorothy/transcripts/<phrase>.jsonl` (`$XDG_DATA_HOME` if set).
Continue one with:

```sh
bun run dev -- --resume <phrase>
```

## CI

`.github/workflows/ci.yaml` calls the shared
[standard workflow](https://github.com/chewygumxx/.github#standard-workflow):
commitlint, the header sync, generic lint and format checks for workflows,
shell and zsh scripts, TOML, YAML and `.editorconfig`, and the metadata sync.
This repository's own `bun run check` follows, against the commit the header
sync pushed.

## Development

- `bun run commit` composes a commit interactively.
- `bun run check` runs the typecheck, format check, lint, Markdown lint, YAML
  checks (prettier, then yamllint with `@chewygumxx/yamllint-config`) and tests
  that CI runs.
- `bun run test` runs the `bun test` suite alone.
- `bun run format` applies Biome formatting, and prettier's to YAML, which Biome
  does not read.

The pre-commit hook runs the same checks on staged files, and rejects em dashes
and plaintext values in any env file.
The commit-msg hook runs commitlint.
