---
ctime: 2026-10-12
mtime: 2026-10-20
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

No entry points. `src/index.ts` runs each mode from `RUNNERS`, whose
type has `tsc` require a runner for every mode, and each runner loads
its package lazily (`await import(...)`): memory's commands, recall server
and hooks through their own entry points (`@dorothy/memory/commands`,
`@dorothy/memory/recall-server`, `@dorothy/memory/claude-hook`), and even
`prepareCliHome` only for the model modes, so `--help`, `--list` and
`--recall-server` never load the Agent SDK. Keep every new mode's import
lazy.

## Files

- `index.ts`: the entry guard, which runs the mode `parseArgs` gives
  from `RUNNERS`, each runner returning its exit code, or nothing where
  it set its own (`runOneShot`).
- `ambient.ts`: `ambient`, the process's environment, streams and entry
  script, passed to memory's history commands.
- `args.ts`: the flags (`parseArgs`, `USAGE`) and the modes they give:
  `COMMANDS` maps each flag to a reader of the words after it, those
  taking options through `node:util`'s `parseArgs`.
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
  gateway and starts `claude` with its base URL there, its host in both
  proxy bypass lists, `ENABLE_TOOL_SEARCH=1` unless set, and the marker
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
  when `claude` exits; inline JSON stays inline. If the private write
  fails, the user's original arguments are kept and a warning says
  Dorothy's settings could not be added.
  With `[memory] enabled` it also notes the launch (`DOROTHY_LAUNCH`),
  passes `Stop` and `SessionEnd` hooks running `dorothy --claude-hook`
  (`hookSettings`) and, for a new session, `--session-id`
  (`claudeSession`: a resume decides wherever a `--session-id`
  stands, `-r<id>` counts, and a free-text flag's value is no flag);
  the block leaves out a session resumed by id. It sets
  `DOROTHY_ANTHROPIC_BASE_URL` from the user's `ANTHROPIC_BASE_URL`, and
  `DOROTHY_DOTENVX_CONFIG` from the directory of Dotenvx Armor's session
  it finds (`dotenvx-session.ts`). `runClaude` runs it for `--claude`,
  forwards `SIGTERM` and `SIGHUP`, ignores `SIGINT` (the terminal sends
  it to `claude` too), and exits with `claude`'s code. This program runs
  again as `bun --no-env-file`, so a project's `.env` never reaches a
  hook, a catch-up or the recall server. Before `claude` starts it
  starts a detached catch-up of each launch a killed `dorothy` left
  behind, memory off or on, and says what hooks left to tell; once
  `claude` exits, or fails to start, a catch-up of its own launch,
  whatever else its teardown throws.
  From a package script (`bun run dev`), `userShell` gives `claude` the
  directory it was run from and the `PATH` before Bun prepended its
  `node_modules/.bin` entries.
- `claude-dump.ts`: `runClaudeDump` for `--claude --dump-context`: the
  gateway's upstream is `captureServer` from `@dorothy/agent`, `claude`
  runs quietly in print mode without saving its session, and is stopped
  at the first request, which is printed with a warning if the gateway
  injected nothing, with the block alone: no sync, recall or
  permissions. Imported lazily, so `--claude` never loads the SDK.
- `claude-hook.ts`: `runHook`, for `--claude-hook`, gives memory's
  `runClaudeHook` the environment `claude` gave the hook, in which it
  finds the launch, and reviews: `process.env` loses the gateway's URL,
  `ENABLE_TOOL_SEARCH`, `DOROTHY_LAUNCH`, `CLAUDECODE` and every
  `CLAUDE_CODE_` variable (`reviewEnv`), but for the user's own base
  URL, which the launch passes on as `DOROTHY_ANTHROPIC_BASE_URL` and
  reviews take as `ANTHROPIC_BASE_URL`; then Dorothy's `.env` is loaded
  by path from this checkout (`loadDotenv`), with `DOTENVX_CONFIG` set
  from `DOROTHY_DOTENVX_CONFIG` so that a `claude` with another
  `XDG_CONFIG_HOME` still finds Armor's session, the console silenced
  around the load and a failure logged by its code alone, and the agent
  loaded when a review asks. A hook and a catch-up log whatever fails,
  through memory's `hookLog`, and always exit 0.
- `index.ts` also runs `--serve` (memory's service through
  `@dorothy/memory/service`, with reviews from the agent, Claude Code's
  variables dropped and Dorothy's `.env` loaded by path from this
  checkout; off, and said, if either fails), its `--token-add` and
  `--token-revoke`, and `--mcp`, memory's stdio bridge
  (`@dorothy/memory/bridge`), which starts `--serve` as
  `bun --no-env-file` when none answers.
- `recall-launch.ts`: `recallLaunch` launches this program again as the
  recall server, leaving out the conversation it serves and, with
  `--project`, naming the directory chat started in.

## Invariants

- Auth comes from `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` in
  `.env`; the entry guard calls dotenvx's `config()` to decrypt it with
  the private key from Dotenvx Armor or a gitignored `.env.keys`.
- `--claude` loads no `.env`: `claude` signs in as the user's own Claude
  Code does, and memory is read without credentials. `--claude-hook`
  loads the checkout's `.env` by path for reviews, once `claude`'s
  variables are gone, never the working directory's.
- `@dotenvx/dotenvx` is declared here, by `memory`, whose history commands
  save the mirror's key with its `set`, and in the root's development
  dependencies, which the root's `lint:env` script and the pre-commit
  hook need.
- The CLI passes `ambient()` to memory's history commands, and
  `commandHistory(...)` of it to memory's commands, the fact and
  project commands among them, and `editInEditor` (from
  `@dorothy/tui/editor`) to `--memory` and `--edit-tags`.

## Tests

Pass every root and environment in; no test decrypts the real `.env` or
starts a model.

## See also

- [Workspace modularity spec](../../docs/specs/2026-10-09-workspace-modularity-design.md)
- [Workspace modularity report](../../docs/reports/2026-10-09-workspace-modularity.md)
