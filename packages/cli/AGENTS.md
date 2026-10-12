---
ctime: 2026-10-12
mtime: 2026-10-12
spdx: GPL-3.0-only
title: packages/cli/AGENTS.md
description: >-
  The CLI package's guide: the dorothy program, which wires memory, the
  agent and the TUI together, and auth.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/cli/AGENTS.md
   -
   -->

# packages/cli/AGENTS.md

`@dorothy/cli` is the `dorothy` program. It is run, not imported: it
exports nothing, and depends on all four other packages, wiring memory,
the agent and the TUI together.

## Entry points and imports

No entry points. `src/index.ts` parses the flags and loads each mode's
package lazily (`await import(...)`): memory's commands and recall server
through their own entry points (`@dorothy/memory/commands`,
`@dorothy/memory/recall-server`), and even `prepareCliHome` only for the
model modes, so `--help`, `--list` and `--recall-server` never load the
Agent SDK. Keep every new mode's import lazy.

## Files

- `index.ts`: the entry guard, the flags (`parseArgs`, `USAGE`) and the
  modes.
- `run-tui.ts`: `runTui` connects memory, the agent and `runApp`.
  `openMemory` gets `structuredCall`, the persona's prompts as text and a
  `connect` that starts a `Conversation`, and the screen runs over its
  `createSession`. Once `runTui` resolves, everything is closed and the
  CLI ends the process, so a push or repack still running never holds the
  terminal.
- `dump.ts`: `runDump` composes `previewStart` with `dumpRequest` for
  `--dump-context`.
- `recall-launch.ts`: `recallLaunch` launches this program again as the
  recall server, leaving out the conversation it serves.

## Invariants

- Auth comes from `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` in
  `.env`; the entry guard calls dotenvx's `config()` to decrypt it with
  the private key from Dotenvx Armor or a gitignored `.env.keys`.
- `@dotenvx/dotenvx` is declared here and again in the root's development
  dependencies, which the root's `lint:env` script and the pre-commit hook
  need.
- The CLI passes `commandHistory()` to memory's commands, and
  `editInEditor` to `--memory` and `--edit-tags`.

## Tests

Pass every root and environment in; no test decrypts the real `.env` or
starts a model.

## See also

- [Workspace modularity spec](../../docs/specs/2026-10-09-workspace-modularity-design.md)
- [Workspace modularity report](../../docs/reports/2026-10-09-workspace-modularity.md)
