---
ctime: 2026-09-29
mtime: 2026-10-09
spdx: GPL-3.0-only
title: CLAUDE.md
description: >-
  Claude Code's guide to Dorothy: how to commit, and its architecture: the five
  workspace packages, memory, the agent, the TUI, the CLI and auth.
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

`docs/roadmap.md` orders the phases of work. Once a phase merges, revise it as
its Revising section says before starting the next phase, and add work found
along the way where it would serve best.

## Architecture

Dorothy is five Bun workspace packages under `packages/`, each named
`@dorothy/<name>`. `core` holds the contracts the others meet on
(`ChatSession`, `SessionStart`, `StructuredCall`, the notices and the
editor) and the basics they share. `memory`, `agent` and `tui` depend on
`core` alone, never on each other; `cli` depends on all four and wires
them together. Each package exports only the entry points its
`package.json` names (`"."`, and memory's `./recall-server` and
`./commands`), and `cli` exports nothing. Under Bun's isolated linker a package
resolves what it declares and what the root declares (its development tools and
`@dorothy/cli`), since the root's `node_modules` is an ancestor of every
package; an undeclared package or an internal path of a `@dorothy` one fails
under Bun and `tsc`. `workspace.test.ts` pins the `@dorothy` graph, the entry
points and the Agent SDK's single holder.

`core` (`packages/core/src/`) also holds the XDG directories (`xdg.ts`), the
configuration (`config.ts`), timers, session phrases and the recall tools' names
and shapes (`contracts/recall.ts`). `withSection` (`contracts/start.ts`) joins a
section to a system prompt, as the memory block and the earlier turns' abstracts
are joined.

Memory (`packages/memory/src/`) is Dorothy's memory database in all its parts,
as subdirectories: notes (`memory/`), recall, compaction and history, with
transcripts (`transcript.ts`), private JSONL under `$XDG_DATA_HOME/dorothy/`.
`openMemory` (`memory/open.ts`) opens a chat's memory and returns its
`createSession(turns)`, whose sessions are compacting, tracked by memory, and
recorded to the transcript by `sessionRecorder` (`memory/record.ts`). Each
starts from `SessionStart` values memory renders (the turns after the clusters,
the memory block, `earlierSection`'s abstracts, the recall launch and whether to
offer recollect), handed to the `connect` the CLI passes. Reviews and compaction
take an injected `StructuredCall` and their prompts as text (`MemoryPrompts`),
so memory never imports the agent or the SDK. `previewStart`
(`memory/preview.ts`) gives `--dump-context` a chat's start without opening
history.

Notes (`packages/memory/src/memory/`) are kept on each conversation in a JSON
sidecar beside its transcript (`<phrase>.meta.json`, `sidecar.ts`). At launch
`openMemory` loads the catalogue from the recall index, and a `MemoryService`
(`service.ts`) builds the memory block each new session starts with, frozen for
the session, and schedules reviews: one-shot structured calls that never block
the chat (`review.ts`, `scheduler.ts`). `trackMemory` (`track.ts`) decorates the
`ChatSession`; `App` sees only a `notices` source. Ranking, the block, the edit
view and the list are pure; `--list` and `--memory` live in `commands.ts`.

Recall (`packages/memory/src/recall/`) is Dorothy's search over past
conversations: a derived SQLite FTS5 index in the XDG cache (`store.ts`), synced
from the transcripts and sidecars before every query (`sync.ts`), with `search`
and `open` (`query.ts`). `server.ts` serves them over MCP on stdio as
`dorothy --recall-server`, which the Agent SDK launches through `mcpServers`; it
is the only file importing `@modelcontextprotocol/sdk`, and memory's
`./recall-server` entry loads it without the rest of memory. `Conversation`
turns the tool calls into `lookup` events, which the TUI shows as dim lines and
the recorder writes as `recall` transcript events; reviews appraise each read
into the sidecar, and `salience()` (the notes' `rank.ts`) weighs appraised reads
with visits. The index doubles as the sidecar write lock and holds review
claims, so two TUIs never review one conversation at once.

Compaction (`packages/memory/src/compaction/`) keeps a long chat within
Dorothy's context. Past `[compaction] soft` tokens, at the next idle (past
`hard`, before the next message), `compact()` asks her through the injected
`StructuredCall` to split the turns leaving the verbatim tail into topical
clusters with an abstract each (`clusters.ts`, `plan.ts`). `Compaction`
(`session.ts`) wraps the `ChatSession`; a pass (`run.ts`, on the shared state in
`shared.ts`) appends the clusters to the sidecar and writes a `compaction`
transcript event, and `Compaction` swaps in a new session seeded with the
abstracts and the turns after them; every session `createSession` makes is
seeded that way, and the memory block charges the abstracts to its budget first.
`recollect` on the recall server opens a cluster word for word; the server
registers it only with `--recollect`, which `conversationOptions` adds when
there are clusters. The CLI's own compaction is off: `cliOptions()` sets
`DISABLE_COMPACT=1`, and a `compact_boundary` message is reported as a warning,
as an error would end the turn on screen while the CLI's goes on. Probes:
`docs/reports/2026-10-07-compaction.md`.

Tags give Dorothy a SKOS-style vocabulary. `tags.json` in the data directory
(`packages/memory/src/memory/vocabulary.ts`) holds concepts (`prefLabel`,
`altLabel`, `broader`, `scopeNote`) and the tombstones of deleted and merged
ones; each sidecar holds its conversation's concept ids. The idle review shows
her the vocabulary and asks for tags; `applyTagging` (`tagging.ts`) checks them
leniently, a bad tag never failing the notes, and coins concepts inside the
sidecar's lock, since `updateSidecar`'s change may be async, so two runs never
coin one label twice. The recall index mirrors both
(`packages/memory/src/recall/tags.ts`): the `tags` tool lists concepts by their
carriers' summed salience, `search` takes `tags`, results carry `keywords`, and
a concept only hidden conversations carry is never shown to her. `--tags` prints
the hierarchy, `--edit-tags` edits it in `$EDITOR` (`tags-view.ts`), and a
`Tags:` line in `--memory` sets a chat's tags. The vocabulary path is always
passed (`vocabularyPath()`), never derived from the transcripts directory, so
tests keep to their temporary directories.

History (`packages/memory/src/history/`) keeps the data directory as a git
repository. `MemoryRepo` (`repo.ts`) has two engines, the git binary run
isolated from the user's configuration (`binary.ts`) and isomorphic-git
(`iso.ts`), chosen once per process (`open.ts`); one contract test runs against
both, and across them. `MemoryHistory` (`history.ts`) adopts the directory,
commits each logical change inside the lock it was written under, sweeps up
outside changes first, and restores a file that fails the lint (`lint.ts`,
`heal.ts`), keeping its bytes under `broken/`. The notes never import history,
and only `openMemory` wires the two: writers take a `Recording` through
`updateSidecar` and `updateVocabulary`, the service a `HistoryHandle` as
`versions`, and memory's commands an `OpenHistory`, which the CLI passes from
`commandHistory()` (`commands.ts`). Healing takes the lock, so it happens only
outside it. The lock is the recall index's when it is open, and otherwise
history's `FileLock` (`lock.ts`) on `.git/dorothy.lock`; both are
`exclusiveLock` (`packages/memory/src/sqlite-lock.ts`), a SQLite
`BEGIN IMMEDIATE` write lock. `mirror.ts` seals new commits as AES-256-GCM
bundles (`seal.ts`) on the orphan branch `sealed`, pushes it to the remote
`mirror` under `DOROTHY_MIRROR_KEY`, and `--recover` rebuilds from it; a key
that does not open the newest bundle seals nothing. `openMemory` opens the index
and history before it reads anything, commits each turn once the transcript is
flushed, and shows history's notices with memory's. Once `runTui` resolves,
everything is closed and the CLI ends the process, so a push or repack still
running never holds the terminal. Tests pass every root, key and environment in,
and the binary's tests shut out the user's git configuration.

The agent (`packages/agent/src/`) is Dorothy's model side, and the only package
declaring `@anthropic-ai/claude-agent-sdk`; it began as a near fork of
`chewygumxx/claude-sysprompt`. It calls `query()` with a custom
`options.systemPrompt` string (replacing Claude Code's default preset entirely)
and streams the `text_delta` events of `stream_event` messages
(`includePartialMessages: true`): to stdout for a one-shot prompt (`runOneShot`,
`one-shot.ts`), and through `Conversation` (`conversation.ts`), core's
`ChatSession`, which keeps one `query()` alive in streaming input mode and emits
`ready`, `delta`, `turn-end`, `sdk`, `lookup` and `error` events.
`structuredCall` (`structured.ts`) is the `StructuredCall` reviews and
compaction take. The Agent SDK is deliberate for now; a later iteration moves to
Anthropic's Messages API (the `api` commit scope), which is the only way to
fully control the system prompt, by replacing this package.

The persona (`persona.ts`) is composed from components by purpose
(`personaComponents`: identity, voice, capabilities, plumbing, provenance,
memory), in chat mode or in development mode (`--dev`), which adds a mode
component, drops provenance and has Dorothy describe her context; the chat
prompt is pinned byte for byte in `persona.test.ts`. Transcripts record the
prompt as `promptHash` (`xxh3:<hex>`), which nothing reads back.
`conversationOptions()` builds what a session starts with from `SessionStart`
values and the persona, joining the memory block and the earlier section with
`withSection` and the turns with `withHistory`. Reconnecting seeds a new session
with the turns held in memory, and `--resume` with the transcript's.
`dumpRequest` (`capture.ts`) sends a chat's first request to a loopback stand-in
for the API and returns the body, for `--dump-context`.

`query()` spawns the SDK's bundled `claude` binary on every call, so
`baseOptions` (`persona.ts`) keeps that subprocess lean: `tools: []` drops
roughly 32k input tokens of tool definitions, and `settingSources: []` stops it
loading `~/.claude` and `.claude/` settings, which would otherwise run this
repository's `SessionStart` hook and every enabled plugin before the first
token. Settings files are not all it reads, though: from its config directory it
takes the signed-in account and tells the model the user's email, and from the
working directory's repository its auto-memory, git status and worktree
instructions. So every call also spreads `cliOptions()`, which runs the CLI in a
private home (`$XDG_CACHE_HOME/dorothy/claude`, created 0700 by
`prepareCliHome`) as both `CLAUDE_CONFIG_DIR` and `cwd`, with
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; it is a function because dotenvx loads the
credentials after import. The CLI still prepends its own identity line, and
appends a system message after each user turn with the working directory,
platform, shell, OS version, model, a token budget and the date, regardless of
`systemPrompt`; the persona prompt tells the model to treat those as incidental
and not to volunteer its provenance. Findings:
`docs/reports/2026-10-07-context-leak.md`.

The TUI (`packages/tui/src/`) is the Ink chat, which `runApp` (`run-app.tsx`)
renders until it exits. It knows a session only as core's `ChatSession`, made by
the `createSession` it is given; the `sdk` event carries core's structural
`RawMessage`, so the raw pane needs no SDK types. `state.ts` is a pure reducer,
so screen logic is tested without Ink. The input editor is pure too: `editor.ts`
(draft edits, wrapped layout, cursor movement) and `recall.ts`, with `Input.tsx`
only mapping keys onto them. `App` owns the draft and the editor's memory (kill
buffer, goal column, recall), since the Too Small screen unmounts `Input`, and
runs Ctrl+G's `$EDITOR` (`editInEditor`, `external-editor.ts`) inside Ink's
`suspendTerminal`; the CLI passes `editInEditor` to `--memory` and `--edit-tags`
too.

The CLI (`packages/cli/src/`) is run, not imported. Its entry point (`index.ts`)
parses the flags and loads each mode's package lazily (`await import(...)`),
memory's commands and recall server through their own entry points
(`@dorothy/memory/commands`, `@dorothy/memory/recall-server`), and even
`prepareCliHome` only for the model modes, so `--help`, `--list` and
`--recall-server` never load the Agent SDK. `runTui` (`run-tui.ts`) connects
memory, the agent and `runApp`: `openMemory` gets `structuredCall`, the
persona's prompts as text and a `connect` that starts a `Conversation`, and the
screen runs over its `createSession`. `runDump` (`dump.ts`) composes
`previewStart` with `dumpRequest`. `recallLaunch` (`recall-launch.ts`) launches
this program again as the recall server, leaving out the conversation it serves.

Auth comes from `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` in `.env`,
which is committed encrypted by dotenvx; set values only with `dotenvx set`. The
entry guard in `packages/cli/src/index.ts` calls dotenvx's `config()` to decrypt
it with the private key from Dotenvx Armor (or a gitignored `.env.keys`).
`.husky/pre-commit` rejects any staged env file holding a plaintext value.
`@dotenvx/dotenvx` is declared by `cli` and again in the root's devDependencies,
since under the isolated linker the root's `lint:env` script and
`.husky/pre-commit` need its binary linked at the root. `zod` is declared by
`agent` because the Agent SDK takes it as a peer, so it must not be pruned as
unused. `bunfig.toml` disables
Bun's own `.env` autoload (`[env] file = false`): otherwise Bun preloads the raw
ciphertext, `config()` declines to overwrite it, and the API rejects the
ciphertext as a bearer token.

There is no build: Bun runs the source, `bun run dev` and `bun run start` alike.
`tsconfig.json` is check-only (`noEmit`) and covers `packages/*/src` plus the
config files and `workspace.test.ts`. Under the isolated linker, removing a
`@dorothy` dependency from a manifest and running `bun install` leaves the old
link in place; reinstall from clean
(`rm -rf node_modules packages/*/node_modules && bun install`) to see the
boundary again. `bun run check` ends with `bun run test`, which is how CI's
shared `lint.yaml` runs the tests. Commit scopes are the package names, with
`config`, `claude` and `api`; `sdk` remains only so commits from before the
packages still lint. Design: `docs/specs/`, plans: `docs/plans/`.

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
