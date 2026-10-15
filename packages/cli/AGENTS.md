---
ctime: 2026-10-12
mtime: 2026-10-15
spdx: GPL-3.0-only
title: packages/cli/AGENTS.md
description: >-
  The CLI package's guide: the dorothy program, which wires memory, the
  agent, the TUI and the gateway together, and auth.
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
exports nothing, and depends on every other package but `identity`,
wiring memory, the agent, the TUI and the gateway together.

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
- `run-tui.ts`: `runTui` connects memory, the agent and `runApp`, with
  the directory the user ran it from (`userShell`), whose project chat
  records and syncs.
  `openMemory` gets `structuredCall`, the persona's prompts as text and a
  `connect` that starts a `Conversation`, and the screen runs over its
  `createSession`. Once `runTui` resolves, everything is closed and the
  CLI ends the process, so a push or repack still running never holds the
  terminal.
- `dump.ts`: `runDump` composes `previewStart` with `dumpRequest` for
  `--dump-context`.
- `claude.ts`: `launchClaude`, for `--claude` and its dump, starts the
  gateway and readies `claude` from `PATH` with `ANTHROPIC_BASE_URL` at
  it, `ENABLE_TOOL_SEARCH=1` unless the user set it, and the marker
  appended to its prompt (with the user's own `--append-system-prompt`,
  as Claude Code keeps only the last; `claudeArgs`). With
  `[memory] enabled` it syncs the project `claude` starts in, gives the
  gateway chat's memory block as its section, and sets
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; with `recall` too, `--mcp-config=`
  offers the recall server as `dorothy-memory` with `--project`, and
  `--settings=` allows its tools, a user's own `--settings` merged in
  (`dorothyFlags`). A merged settings file may hold secrets and argv is
  world-readable, so the merge goes to a private file (mode 0600, in
  `$XDG_RUNTIME_DIR/dorothy` or a 0700 `dorothy-<uid>` under the temporary
  directory; `privateWriter`) passed by path, removed by `Launch.cleanup`
  when `claude` exits; inline JSON stays inline. `runClaude` runs it for
  `--claude`, forwards `SIGTERM` and `SIGHUP`, ignores `SIGINT` (the
  terminal sends it to `claude` too), and exits with `claude`'s code.
  From a package script (`bun run dev`), `userShell` gives `claude` the
  directory it was run from and the `PATH` before Bun prepended its
  `node_modules/.bin` entries.
- `claude-dump.ts`: `runClaudeDump` for `--claude --dump-context`: the
  gateway's upstream is `captureServer` from `@dorothy/agent`, `claude`
  runs quietly in print mode without saving its session, and is stopped
  at the first request, which is printed with a warning if the gateway
  injected nothing, with the block alone: no sync, recall or
  permissions. Imported lazily, so `--claude` never loads the SDK.
- `recall-launch.ts`: `recallLaunch` launches this program again as the
  recall server, leaving out the conversation it serves and, with
  `--project`, naming the directory chat started in.

## Invariants

- Auth comes from `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` in
  `.env`; the entry guard calls dotenvx's `config()` to decrypt it with
  the private key from Dotenvx Armor or a gitignored `.env.keys`.
- `--claude` loads no `.env`: `claude` signs in as the user's own Claude
  Code does, and memory is read without credentials.
- `@dotenvx/dotenvx` is declared here, by `memory`, whose history commands
  save the mirror's key with its `set`, and in the root's development
  dependencies, which the root's `lint:env` script and the pre-commit
  hook need.
- The CLI passes `commandHistory()` to memory's commands, the fact and
  project commands among them, and `editInEditor` to `--memory` and
  `--edit-tags`.

## Tests

Pass every root and environment in; no test decrypts the real `.env` or
starts a model.

## See also

- [Workspace modularity spec](../../docs/specs/2026-10-09-workspace-modularity-design.md)
- [Workspace modularity report](../../docs/reports/2026-10-09-workspace-modularity.md)
