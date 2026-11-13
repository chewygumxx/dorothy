---
ctime: 2026-10-12
mtime: 2026-11-04
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
   - ~xxdorothy/dorothy.git
   - ::: :/packages/cli/AGENTS.md
   -
   -->

# packages/cli/AGENTS.md

`@dorothy/cli` wires every package into `dorothy`; its application has
no imports, with only the evidence scrubber boundary below exported.

## Entry points and imports

`src/scrub.ts` exports memory's scrubber as `@dorothy/cli/scrub` for evidence.
`src/index.ts` runs each mode from `RUNNERS`; `tsc` requires every mode
and each runner loads its package lazily (`await import(...)`): memory's
commands, recall server and hooks through their own entry points
(`@dorothy/memory/commands`, `/recall-server`, `/claude-hook`,
`/host-hook`), and the agent only for model modes, so `--help`, `--list`
and `--recall-server` never load the AI SDK. Keep new mode imports lazy.

## Files

- `index.ts`: the entry guard, which runs the mode `parseArgs` gives from
  `RUNNERS`, each runner returning its exit code, or nothing where it set its
  own (`runOneShot`).
- `ambient.ts`: `ambient`, the process's environment, streams and entry script,
  passed to memory's history commands.
- `args.ts`: the flags (`parseArgs`, `USAGE`) and the modes they give:
  `COMMANDS` maps each flag to a reader of the words after it, those taking
  options through `node:util`'s `parseArgs`.
- `run-tui.ts`: `runTui` connects memory, the agent and `runApp`, with the
  directory the user ran it from (`userShell`), whose project chat records and
  syncs. `openMemory` gets `calls` (a `structuredCall` on the review route and
  one on compaction's), the persona's prompts as text and a `connect` that
  starts a `Conversation`, and the screen runs over its `createSession`. Once
  `runTui` resolves, everything is closed and the CLI ends the process, so a
  push or repack still running never holds the terminal.
- `models.ts`: the process's one `COOLDOWNS`; `chatRouting`, config's routes
  or each fault said, on which chat, one-shot and dump exit 1, and
  `loadRouting`, which throws them, so the service's and hook's reviews fail.
- `dump.ts`: `runDump` composes `previewStart` with `dumpRequest` for
  `--dump-context`.
- `claude.ts`: `launchClaude`, for `--claude` and its dump, starts the gateway
  and `claude` with its base URL there. With a proxy set, the gateway host joins
  both bypass lists. It sets `ENABLE_TOOL_SEARCH=1` unless set, and the marker
  joins the user's own `--append-system-prompt` (Claude Code keeps only the
  last; `claudeArgs`). With `[memory] enabled` it syncs the project `claude`
  starts in, gives the gateway chat's memory block as its section, and sets
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; with `recall` too, `--mcp-config=` offers
  the recall server as `dorothy-memory` with `--project`, and `--settings=`
  allows its tools, a user's own `--settings` merged in (`dorothyFlags`). A
  merged settings file may hold secrets and argv is world-readable, so the merge
  goes to a private file (mode 0600, in `$XDG_RUNTIME_DIR/dorothy` or a 0700
  `dorothy-<uid>` under the temporary directory; `privateWriter`) passed by
  path, removed by `Launch.cleanup` when `claude` exits; inline JSON stays
  inline. If the private write fails, the user's original arguments are kept and
  a warning says Dorothy's settings could not be added. With `[memory] enabled`
  it also notes the launch (`DOROTHY_LAUNCH`), passes `Stop` and `SessionEnd`
  hooks running `dorothy --claude-hook` (`hookSettings`) and, for a new session,
  `--session-id` (`claudeSession`: a resume decides wherever a `--session-id`
  stands, `-r<id>` counts, and a free-text flag's value is no flag); the block
  leaves out a session resumed by id. It sets `SOPS_AGE_KEY_FILE` from the
  explicit path or the existing default age key under the configuration
  directory (`sops-key.ts`), without reading it. `runClaude` runs it through
  `runForwarding` and exits with `claude`'s code. Before `claude` starts it
  starts a detached catch-up of each launch a killed `dorothy` left behind,
  memory off or on, and says what hooks left to tell; once `claude` exits, or
  fails to start, a catch-up of its own launch, whatever else its teardown
  throws. From a package script (`bun run dev`), `userShell` gives `claude` the
  directory it was run from and the `PATH` before Bun prepended its
  `node_modules/.bin` entries.
- `self.ts`: `selfCommand`, this program as `bun --no-env-file <entry>`, so a
  project's `.env` never reaches a hook or server (`selfServe`, `shellWord`);
  `mainEntry`, the main checkout's entry, which an install writes;
  `runForwarding`, for `--claude`, `--codex` and `--pi`: `SIGINT` ignored (the
  terminal sends it to the host too), `SIGTERM` and `SIGHUP` forwarded.
- `hosts/`: Codex, Hermes and Pi: [guide](./src/hosts/AGENTS.md).
- `claude-dump.ts`: `runClaudeDump` for `--claude --dump-context`: the gateway's
  upstream is `captureServer` from `@dorothy/agent`, `claude` runs quietly in
  print mode without saving its session, and is stopped at the first request,
  which is printed with a warning if the gateway injected nothing, with the
  block alone: no sync, recall or permissions.
- `claude-hook.ts`: `runHook`, for `--claude-hook`, gives memory's
  `runClaudeHook` the environment `claude` gave the hook, in which it finds the
  launch, and reviews on the review route, whose entries name their own base
  URL and key, so nothing of `claude`'s reaches them. `loadCheckoutSecrets`
  awaits core's loader on this checkout's `secrets.json`, into `process.env`.
  `SOPS_AGE_KEY_FILE`, passed by the launch, keeps the key discoverable if
  Claude Code changes its config directory. Failure is logged by code alone,
  and the agent loads when a review asks. Memory gets the original launch
  environment for catch-up, the agent the one with loaded secrets. Hooks and
  catch-up log failures through memory's `hookLog` and exit 0.
- `index.ts` also runs `--serve` (memory's service through
  `@dorothy/memory/service`, with reviews from the agent, Dorothy's
  `secrets.json` loaded by path from this checkout; off, and said, if either
  fails), its token commands, `--sweep` (`runSweep`, `runSweepDismiss`),
  `--hook <host> <event>` and `--pi-hook` (`piHook`; Codex's, Hermes's and
  Pi's hooks, via `@dorothy/memory/host-hook`) and `--mcp`, memory's stdio
  bridge (`@dorothy/memory/bridge`), which starts `--serve` when none answers.
- `review-backfill.ts`: `runBackfillReview`, for `--review-backfill`, runs
  memory's `runReviewBackfill` on `reviewAgent`'s agent (this checkout's
  secrets, her API key). It prints `<phrase>: <outcome>`, then a total; exits
  1 if none was reviewed or marked and one failed, or a failed call stopped
  it. `-n all` repeats batches of 25; stopped exits 75.
- `recall-launch.ts`: `recallLaunch` launches this program again as the recall
  server, leaving out the conversation it serves and, with `--project`, naming
  the directory chat started in. `--no-env-file` keeps the user's `.env` out.

## Invariants

- Auth comes from the `secrets.json` keys config.toml's providers name
  (`ANTHROPIC_API_KEY` by default), decrypted by core's async `loadSecrets`
  through sops. The model modes, mirror and recover await `loadCredentials`.
  A failed load warns by code; mirror won't create a key after one.
- Routes (`models.ts`) name their own base URL and key; no provider reads
  its variables. The recall server runs with `recallEnv`, withheld every
  provider's key and OAuth token, in `recallCwd`, never the user's project.
- `--claude` loads no secrets: `claude` signs in as the user's own Claude
  Code does, and memory is read without credentials. `--claude-hook`
  loads the checkout's `secrets.json` by path for reviews, never the
  working directory's; `claude`'s variables stay, no provider reads them.
  `--pi` loads the selected key alone, after its route is checked.
- The CLI passes `ambient()` to memory's history commands, and
  `commandHistory(...)` of it to memory's commands, the fact and project
  commands among them, and `editInEditor` (from `@dorothy/tui/editor`) to
  `--memory` and `--edit-tags`.

## Tests

Pass every root and environment in; no test decrypts the real
`secrets.json` or starts a model.

## See also

- [Workspace modularity spec](../../docs/specs/2026-10-09-workspace-modularity-design.md)
- [Workspace modularity report](../../docs/reports/2026-10-09-workspace-modularity.md)
