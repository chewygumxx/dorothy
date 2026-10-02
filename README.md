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

## CI

`.github/workflows/ci.yaml` calls the shared
[standard workflow](https://github.com/chewygumxx/.github#standard-workflow):
commitlint, the header sync, generic lint and format checks for workflows,
shell and zsh scripts, TOML, YAML and `.editorconfig`, and the metadata sync.
This repository's own `bun run check` follows, against the commit the header
sync pushed.

## Development

- `bun run commit` composes a commit interactively.
- `bun run check` runs the typecheck, format check, lint, Markdown lint and YAML
  checks (prettier, then yamllint with `@chewygumxx/yamllint-config`) that CI
  runs.
- `bun run format` applies Biome formatting, and prettier's to YAML, which Biome
  does not read.

The pre-commit hook runs the same checks on staged files, and rejects em dashes.
The commit-msg hook runs commitlint.
