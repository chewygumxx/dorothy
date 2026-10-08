---
ctime: 2026-10-09
mtime: 2026-10-09
spdx: GPL-3.0-only
title: Workspace modularity design
description: >-
  Design spec for splitting src/ into five Bun workspace packages with one
  public surface each, so boundaries are declared rather than tested.
tags:
  - dorothy
  - workspace
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-09-workspace-modularity-design.md
   -
   -->

# Workspace modularity design

## Purpose

Everything Dorothy is lives in one `src/` tree, and nothing but discipline
keeps its parts apart. Four `boundary.test.ts` files check imports by
scanning text, and they check only what someone thought to write down.
Elsewhere the tree has grown together: `memory` and `recall` import each
other, `memory/commands.ts` imports from `tui`, `memory/sidecar.ts` holds
the lock and history types that half the tree needs, and
`src/tui/run.tsx` reaches into memory's internals in some twenty places.

This phase splits `src/` into five workspace packages. Each declares what
it depends on, and each offers one designed surface: an importer uses what
a package exports without knowing how the package is laid out inside. The
boundaries become structural, so the coming phases build on them: the
agentic asset refactor gives each package its own guidance, cyclical
maintenance is built inside `memory`, and the Messages API move replaces
one package.

The package graph is drawn in
[the packages diagram](./2026-10-09-workspace-modularity-packages.html).

## Decisions

- **Five broad packages.** `core`, `memory`, `agent`, `tui` and `cli`,
  under `packages/`, named `@dorothy/<name>`. Breadth over granularity:
  everything specialised to her memory database is one package.
- **Dependencies point inward.** `memory`, `agent` and `tui` each depend
  on `core` alone and never on each other; `cli` depends on all four and
  wires them together. What one needs from another is injected by `cli`.
- **`core` holds contracts, not implementations.** The types the packages
  meet on, and the few basics everything uses: the XDG directories, the
  configuration, timers and session phrases.
- **Source packages, isolated linking.** Each package's `exports` point at
  its TypeScript source; there is no build between packages. Bun's
  isolated linker links into a package only what its `package.json`
  declares, so an undeclared import fails to resolve, under Bun and under
  `tsc` alike. A probe confirmed both.
- **Named entry points only.** A package's `exports` list each public
  entry point by name: `"."`, and where a separately launched process
  needs a smaller graph, a deliberate named entry such as
  `"./recall-server"`. No wildcards: an internal path never resolves.
- **The agent is the only SDK user.** `@anthropic-ai/claude-agent-sdk` is
  declared by `agent` alone. Memory takes its model calls as an injected
  `StructuredCall`, as compaction already does.
- **No behaviour changes.** Prompts, transcripts, sidecars, `tags.json`,
  the recall index and history are unchanged byte for byte; this phase
  moves and rewires code only.
- **`dist/` is retired.** Bun runs the source, and `start` was the only
  reader of the emitted tree.

## The packages

| Package  | Depends on | Holds                                          |
| -------- | ---------- | ---------------------------------------------- |
| `core`   | (none)     | contracts, XDG, configuration, timers, phrases |
| `memory` | `core`     | her memory database, in all its parts          |
| `agent`  | `core`     | her model side: persona, sessions, model calls |
| `tui`    | `core`     | the Ink interface                              |
| `cli`    | all four   | the entry point: flags, modes, their wiring    |

### Where today's modules go

- **`core`**: `xdg.ts`, `config.ts`, `timers.ts`, `session-id.ts` with
  `types/niceware.d.ts`, and `contracts/`, gathered from:
  - `conversation.ts`: `ChatSession`, `ConversationEvent`, `TurnStats`,
    `RawMessage`;
  - `persona.ts`: `Turn`;
  - `transcript.ts`: `ResumedTurn`;
  - `recall/types.ts`: `Lookup` and the types it is built from;
  - `compaction/types.ts`: `StructuredRequest`, `StructuredOutcome`,
    `StructuredCall`.
- **`memory`**: `memory/`, `recall/`, `compaction/` and `history/`, kept
  as subdirectories, with `transcript.ts` and `sqlite-lock.ts`; the
  memory half of `dump.ts`; and the memory wiring now in `tui/run.tsx`.
- **`agent`**: `conversation.ts`, `structured.ts` and `persona.ts`
  (`persona.test.ts`, which pins the chat prompt, moves with it); the SDK
  half of `dump.ts`; and the one-shot mode from `index.ts`.
- **`tui`**: `tui/` without `run.tsx`, `external-editor.ts` included.
- **`cli`**: `index.ts`, and what remains of `run.tsx` and `dump.ts`
  once their halves have moved: choosing a mode and passing each package
  what it needs.

External dependencies follow their users: `isomorphic-git`, `zod`,
`@modelcontextprotocol/sdk` and `@dotenvx/dotenvx` (history's `set`) in
`memory`; the Agent SDK in `agent`; `ink`, `react`, `marked`, `lowlight`
and `string-width` in `tui`; `niceware` in `core`; `@dotenvx/dotenvx` in
`cli` too, for the entry guard.

## The workspace

### Layout

```text
packages/<name>/
  package.json    "@dorothy/<name>", private, type module, its exports
                  and its dependencies
  src/index.ts    the public surface: named exports only
  src/**          internals, tests colocated as today
```

A package's manifest:

```json
{
    "name": "@dorothy/memory",
    "private": true,
    "type": "module",
    "exports": {
        ".": "./src/index.ts",
        "./recall-server": "./src/recall-server.ts",
        "./commands": "./src/commands.ts"
    },
    "dependencies": {
        "@dorothy/core": "workspace:*",
        "@dotenvx/dotenvx": "^2.32.4",
        "@modelcontextprotocol/sdk": "^1.31.0",
        "isomorphic-git": "1.43.1",
        "zod": "^4.6.5"
    }
}
```

### Entry points

| Package  | Entry points                              |
| -------- | ----------------------------------------- |
| `core`   | `.`                                       |
| `memory` | `.`, `./recall-server`, `./commands`      |
| `agent`  | `.`                                       |
| `tui`    | `.`                                       |
| `cli`    | none: it is run, not imported             |

A named entry point is public API like `"."`: a small module of its own
that imports only what its purpose needs. `./recall-server` exists because
every chat session launches one, and loading all of memory for it measured
about 290 ms against 90 ms for the server alone. `./commands` holds the
memory and history commands (`--list`, `--memory`, `--tags`,
`--edit-tags`, `--history`, `--restore`, `--rollback`, `--check`,
`--mirror`, `--recover`), each run once per process. `cli` keeps its lazy
`import()` per mode.

### Root

- `package.json` becomes the workspace root: `"workspaces":
  ["packages/*"]`, every development tool, and `@dorothy/cli` as its one
  dependency. Runtime dependencies move to the packages using them.
- `bunfig.toml` gains `[install] linker = "isolated"`; `[env] file =
  false` and the test preload stay.
- `tsconfig.json` stays one check-only project, including
  `packages/*/src` in place of `src`. TypeScript resolves through the same
  links as Bun, so the boundaries hold in `tsc` without project
  references.
- `bun test` at the root runs every package's tests with the shared
  preload, as now.

### Scripts

- `dev` runs `bun packages/cli/src/index.ts`, and so does `start`.
- `build`, `tsconfig.build.json` and `dist/` are removed.
- `typecheck`, `test` and `check` are unchanged in what they run.

### Commit scopes

One scope per package, `core`, `memory`, `agent`, `tui` and `cli`,
replaces `sdk`, whose description names `src/`. `api` stays for the
Messages API move; `config` and `claude` are unchanged.

## Public surfaces

What each package's `"."` offers, in outline; the plan settles the exact
signatures.

- **`@dorothy/core`**: the contracts listed above; `Env` and `xdgDir`;
  `readConfig` and `Config`; `Timers` and `REAL_TIMERS`; `newPhrase` and
  `isPhrase`.
- **`@dorothy/memory`**: `openMemory({ env, config, structured })`,
  resolving to a `Memory` handle with:
  - `sessionStart(phrase, mode)`: the plain values a session starts
    with, being the memory block's text, the cluster abstracts, the turns
    to seed and the recall server's launch command;
  - `wrap(session)`: the given `ChatSession` decorated with transcript
    writing, reviews, compaction and a history commit per turn, returned
    as a `ChatSession`;
  - `resume(phrase)`: the resumed turns, for the screen and the seed;
  - `notices`, the source of memory's and history's notices, and
    `close()`.

  `./recall-server` offers `runRecallServer`; `./commands` offers one
  function per command, each taking its arguments, an `Env` and, where it
  edits, an editor.
- **`@dorothy/agent`**: `Conversation`; `structuredCall`, the
  `StructuredCall` implementation; `conversationOptions(start)`, taking
  `sessionStart`'s values; `personaPrompt`, `promptHash` and
  `prepareCliHome`; `runOneShot`; and `dumpContext`.
- **`@dorothy/tui`**: `runApp({ session, notices, resume, editor,
  config })`, `editInEditor`, and the `NoticeSource` type.

## Seams

Four places where one package needs another, each crossed through `cli`:

1. **Model calls into memory.** Reviews and compaction take a
   `StructuredCall`; `cli` passes `agent`'s `structuredCall`.
   `memory/service.ts` stops importing `query`, and memory no longer
   reads the persona: the call runs on her persona inside `agent`.
2. **The editor into memory's commands.** `--memory` and `--edit-tags`
   take an editor; `cli` passes `tui`'s `editInEditor`.
3. **A session's start into the agent.** `memory.sessionStart` returns
   rendered text and a launch command; `cli` hands them to
   `conversationOptions`. `withMemory` and `withClusters` take that text
   rather than sidecar types, so the persona never sees memory's formats.
4. **The live session through all three.** `agent`'s `Conversation` goes
   into `memory.wrap`, and the result into `runApp`. Each knows it only
   as `core`'s `ChatSession`.

Transcript writing moves from `App` into `wrap`: today `App` records
each entry through an `append` port, and after this phase memory records
them from the session's events, the same entries in the same order. This
is the one move that could change a file on disk, so it is pinned by a
test (below).

## Migration

Untangle first, move second. Each commit either rewires code or moves
files, never both, and `bun run check` passes after every commit.

1. **Contracts.** Gather the shared types into `src/contracts/` and point
   their importers there. Nothing behaves differently.
2. **Seams.** Inject `StructuredCall` into memory's reviews, the editor
   into its commands, and rendered text into `withMemory` and
   `withClusters`. After this, nothing in memory imports `tui` or the
   SDK. `memory` and `recall` still import each other, which is harmless
   once both are inside the one package.
3. **Facades, still under `src/`.** `openMemory`, `wrap`, `resume` and
   the command functions take over `run.tsx`'s and `dump.ts`'s memory
   wiring; `dumpContext` and `runOneShot` take the SDK halves; `runApp`
   fronts the interface.
4. **The workspace.** Create `packages/`, the manifests, the entry points
   and the isolated linker; move files with `git mv` in commits holding
   only moves; switch imports to `@dorothy/*`; delete the four
   `boundary.test.ts`; run `bunx sync-header-metadata --update` for the
   moved files' headers.
5. **Tooling and documents.** Scripts, commit scopes, `bunfig.toml`'s
   comments, the retired build, `.claude/CLAUDE.md`, `README.md` and the
   roadmap.

## Testing

- **Every commit passes `bun run check`.** The only assertions retired are
  the boundary tests', each replaced by the linker and the graph test.
- **The graph test.** One root test reads every package's manifest and
  pins the graph: the `@dorothy/*` dependencies of each package are
  exactly those in [The packages](#the-packages), the Agent SDK is
  declared by `agent` alone, and each package's `exports` keys are exactly
  its entry points above. The linker enforces whatever the manifests say;
  this test keeps the manifests from drifting.
- **The transcript test.** A scripted session, with a stand-in
  `ChatSession` emitting a fixed series of events, is run through `wrap`,
  and the transcript it writes is compared, timestamps aside, with the one
  `App` writes today for the same series. The expected file is recorded
  before the move.
- **A deep-import probe.** `tsc` and Bun both reject an import of
  `@dorothy/memory/src/...` and of an undeclared package.
- **Launch probes,** under temporary XDG directories only, never the
  user's data:
  - a chat starts and its recall server answers;
  - the data repository's pre-commit hook, which names the entry script's
    absolute path, is rewritten to the new path at launch, as Dorothy
    rewrites any hook carrying her marker line;
  - `--list` and `--dump-context` run as before;
  - `./recall-server` loads in about the time the server alone does
    today.

## Documentation

- `.claude/CLAUDE.md`'s Architecture is rewritten by package: the graph,
  the entry point rule, the isolated linker and the seams, without
  `dist/`, `src/` paths or the boundary tests.
- `README.md`'s development commands follow the scripts.
- `docs/roadmap.md` records the phase as done, as its Revising section
  says.

## Known risks

- **A dependency that assumes hoisting.** Under the isolated linker a
  package that finds a peer by walking up `node_modules` may not find it.
  The Agent SDK locates its bundled CLI from its own package, which should
  hold, and the launch probe is where it is checked.
- **Lazy loading moves with the code.** `cli`'s per-mode `import()` is
  what keeps commands and the recall server fast; an import added to an
  entry point's small module brings its whole graph with it. The load
  time probe is the guard.

## Later

- A single binary with `bun build --compile` from `cli`.
- Splitting `memory` should it outgrow one package; its subdirectories
  are where the seams would fall.

## Out of scope

- Per-package agent guidance (`AGENTS.md`) and any rework of the Claude
  assets: the agentic asset refactor, the next phase.
- The Messages API move.
- Any change to behaviour, prompts or on-disk formats.
- Publishing packages, or versioning them apart.

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
