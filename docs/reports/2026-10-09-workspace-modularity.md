---
ctime: 2026-10-09
mtime: 2026-10-09
spdx: GPL-3.0-only
title: Workspace modularity report
description: "How Dorothy became five workspace packages: the launch probes, the rulings made along the way, every commit and what is left"
tags:
  - dorothy
  - workspace
  - modularity
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-09-workspace-modularity.md
   -
   -->

# Workspace modularity report

## Summary

Dorothy is now five Bun workspace packages under the isolated linker, in
place of one `src/` directory held apart by boundary tests:

- `@dorothy/core`: the contracts the others meet on and the basics they
  share;
- `@dorothy/memory`, `@dorothy/agent` and `@dorothy/tui`: each depends on
  `core` alone;
- `@dorothy/cli`: depends on all four and wires them together.

Prompts, transcripts, sidecars, `tags.json`, the recall index and history
are byte for byte as they were. `persona.test.ts` pins the chat prompt and
passed unchanged throughout.

- Spec: [`docs/specs/2026-10-09-workspace-modularity-design.md`](../specs/2026-10-09-workspace-modularity-design.md)
- Plan: [`docs/plans/2026-10-09-workspace-modularity.md`](../plans/2026-10-09-workspace-modularity.md)
- Branch: `feat/workspace-modularity`, from `main` at `60cc328`

At the head of the branch (before this report) `bun run check` passes with
1118 tests, up from 1106 at `1f821e7`.

Live probes ran under throwaway XDG directories. Four ran as expected and
one is open:

- the dump built a request through the Agent SDK's CLI under the isolated
  linker, and the recall server's tools reached it;
- the recall server's entry point loads in about 100 ms, against about
  230 ms for all of memory;
- the commands ran clean;
- the TUI launched and quit on Ctrl+D with exit status 0, and the data
  repository's hook names the CLI's new entry script and is rewritten on
  launch;
- **open:** the session never became ready. dotenvx reported
  `DECRYPTION_FAILED` at launch and the header showed no model name for
  30 s, so the Agent SDK's chat session through `openMemory` was not seen
  to start (see [Known limitations](#known-limitations) for the step that
  remains).

## How it was built

The plan's 17 tasks were built in order; this report is the 17th. For each
task:

1. One agent implemented it from the plan's text.
2. A fresh reviewer checked the diff against the plan, the spec and the
   constraints.
3. A task moved on only when its review found nothing Critical or
   Important.

Two tasks needed a fix round:

- **Task 2** (`cb1cb12`): the plan said `structured.test.ts` covered every
  `runReview` test it deleted. It lacked the case where the query cannot
  start, which was added.
- **Task 7**: the reviewer showed that the wrap order the controller's
  ruling wanted to pin is unobservable (the recorder records before it
  forwards, and the tracker calls its listeners before its hooks). A test
  that the reply is in the transcript when a review reads it pins the
  invariant that matters instead (`7b4443b` to `c68e9a4`).

Task 16 was interrupted once by a usage limit after `4a5bef4` and resumed
to finish.

Three moves came in order:

1. The shared types and the contracts (`StructuredCall`, the session and
   the notices, the editor) were gathered in `src/contracts/`, with their
   users rewired.
2. The wiring that had lived in the TUI's `run.tsx` moved to memory
   (`openMemory`), the CLI (`runTui`, `recallLaunch`, `runDump`) and the
   TUI (`runApp`), each in commits of their own.
3. The files moved into packages in five commits (`core`, `tui`, `agent`,
   `memory`, `cli`), each changing nothing in them but import specifiers,
   then a test pinned the graph.

## The probes

Every probe ran with `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`
and `XDG_STATE_HOME` under one `mktemp -d` directory, echoed before each
run and checked not to be under `~/.local/share`, `~/.cache`, `~/.config`
or `~/.local/state`. No message was sent, and none of `--mirror`,
`--recover`, `--rollback` and `--restore` was run.

### The dump

`bun run dev --dump-context hello`

The Agent SDK's bundled CLI ran under the isolated linker and built a
request that the loopback stand-in for the API returned, at no cost:

- the `system` blocks start with the CLI's identity line, then the chat
  persona (`You are Dorothy, a warm, ...`);
- the tools include `mcp__memory__open`, `mcp__memory__search` and
  `mcp__memory__tags`, so the SDK launched the recall server through
  `recallLaunch` (the packages' entry script, `packages/cli/src/index.ts`)
  and listed what it serves. The request body does not carry
  `mcpServers`; the tools are the evidence.

### The recall server's load time

A one-line script in `packages/cli/src/` imported
`@dorothy/memory/recall-server` and timed it, three runs each:

| Import | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| `@dorothy/memory/recall-server` | 100 ms | 97 ms | 110 ms |
| `@dorothy/memory` (all of it) | 252 ms | 225 ms | 227 ms |

That matches Task 12's own measurement (81 to 89 ms for the entry point,
188 to 202 ms for `"."`): the server's entry loads without the rest of
memory, at under half the cost. The script was removed afterwards.

### A chat, and the hook

`bun run dev` in tmux, 120 by 40, then Ctrl+D without sending anything.

- **The session was never ready.** At launch dotenvx reported
  `DECRYPTION_FAILED` for `CLAUDE_CODE_OAUTH_TOKEN`,
  `DOROTHY_MIRROR_TOKEN` and `DOROTHY_MIRROR_KEY` (the message is
  paraphrased here). This machine has neither a private key in the
  environment nor a `.env.keys`. For 30 s the status line read
  `dorothy · <phrase> · … · sdk … · starting`, with no model name. The
  cause is most likely the missing credentials, but that is inferred: the
  failed decryption and the stuck "starting" were seen, not shown to be
  linked. It was not worked around, and the step stays open (see
  [Known limitations](#known-limitations)).
- **The TUI otherwise came up whole**, with the memory notice (`memory has
  no mirror`), the input and the footer. Ctrl+D ended the process in about
  a second with exit status 0.
- **The hook names the new entry script.** Adopting the data directory
  wrote `.git/hooks/pre-commit` (mode 0700), which ends:

  ```sh
  exec '.../bin/bun' '/home/chewygumxx/dev/dorothy/packages/cli/src/index.ts' --check --staged
  ```

- **It is rewritten.** I edited its path to `src/index.ts` (a file that
  does not exist), launched and quit again, and read it back: the
  `packages/cli/src/index.ts` path was restored.
- Run by hand in the data directory, the hook printed `All 0 files pass.`

### The commands

- `bun run dev --list` printed the empty catalogue (its header row) and
  exited 0.
- `bun run dev --history` printed three commits, newest first (`turn` for
  each of the two launches, and the `adopt: 1 files` before them), and
  exited 0.
- `bun run dev --help` printed the usage, and `--recall-server` started
  without error.

## Rulings made during execution

The ledger's `Ruling:` lines, each with what it costs if wrong. Rulings
the plan itself carries are in the plan's own Rulings section.

| Ruling | Cost if wrong |
| --- | --- |
| Task 6 keeps `src/tui/run.tsx`'s name; Task 7 moves it with a pure `git mv` to `src/memory/open.ts` (a rename and a rewrite in one commit would break "a move changes only specifiers") | One extra rename |
| Task 17's chat probe runs under tmux with throwaway XDG directories; without tmux the controller would report the step for the user to run | One manual probe |
| Task 2: add the missing synchronous-throw test to `structured.test.ts`, since the plan's claim that it covered every deleted `runReview` test was wrong | One small test |
| Task 7's move commit may change `src/tui/boundary.test.ts`'s expectations from `["run.tsx"]` to `[]`, the one non-specifier edit allowed, since the move is what changes them and the check must stay green | Nothing: the file is deleted in Task 10 |
| Task 7: accept the implementer's test that the reply is in the transcript when a review reads it, in place of pinning the wrap order, which is unobservable | Nothing: the invariant is pinned either way |
| Task 9: where every name imported from a module is a type, keep `import type {...}`; inline `type` modifiers only in mixed declarations, since inline-only compiles to a side-effect `import {}` under `verbatimModuleSyntax` | A style nit |
| Task 9: `bun run build` and `start` are broken from `3f95af5` until Task 15 retires them (`tsconfig.build.json` still includes only `src`) | Nothing, unless someone runs `start` mid-branch |
| Task 13 points the root `dev` script at `packages/cli/src/index.ts`, since `src/index.ts` disappears in Task 13 | Nothing |
| Task 13 keeps `@dotenvx/dotenvx` in the root's devDependencies as well as `cli`'s dependencies | A duplicate declaration |
| Task 14: the graph test stands unweakened; its "`@dorothy/agent` resolves from memory" failure was a stale link (see the findings) | Nothing |
| Task 16 links the roadmap's Done entry to the spec and plan only, and Task 17 adds the report link | Nothing |

The plan also ruled, on the spec (the plan's Rulings on the spec section,
reproduced here as they shaped the code):

- **Sessions come from a factory, not one session.** `openMemory` takes
  `connect(start)` and returns `createSession(turns)`, since compaction
  and every reconnect start a new `Conversation`. If wrong, only
  `Memory`'s shape changes.
- **`recallLaunch` belongs to the CLI**, whose flags it is; memory takes
  it as an option.
- **Memory renders the earlier section, preamble included**, since
  compaction measures that text.
- **`QUIT_GRACE_MS` is `CLOSE_GRACE_MS`**, one constant in `core`.
- **Memory's surface is `openMemory` and `previewStart`.**
- **The dump stays in the CLI**: `runDump` composes memory's preview with
  the agent's `dumpRequest`.
- **`runApp` takes App's props**, with an optional renderer for its tests.
- **`runReview`'s SDK-level tests are retired, not moved**, as
  `structuredCall`'s tests cover them (but see Task 2 above).

## Findings worth keeping

- **Bun's isolated install keeps a stale link.** After removing a
  `@dorothy` dependency from a manifest, `bun install` does not prune the
  link, so the old import keeps resolving and the boundary looks intact.
  The graph test failed this way when the boundary was deliberately
  broken. Reinstall from clean to see it again:
  `rm -rf node_modules packages/*/node_modules && bun install`. This is in
  `.claude/CLAUDE.md`.
- **`@dotenvx/dotenvx` is declared twice.** `cli` depends on it, but under
  the isolated linker the root's `lint:env` script and `.husky/pre-commit`
  need its binary linked at the root, and a clean install without the root
  devDependency failed `lint:env`.
- **Loading the agent costs +55 ms.** A static import of the agent's
  index, which loads the Agent SDK, added about 55 ms to every mode (239
  ms each), `--help` and `--list` included. So the CLI loads each mode's
  package lazily, and `prepareCliHome`, which sits in the agent, is
  loaded only for the model modes, after dotenvx's `config()`.
- **The recall server's entry loads in about 100 ms**, against about 230
  ms for memory's whole index, which is what `./recall-server` being its
  own entry point buys: every chat launches it as a subprocess.
- **The credentials did not decrypt here.** Probing the ready session
  probably needs the private key; the dump and the commands needed none.

## Verification

- `bun run check` passes with 1118 tests, up from 1106 at `1f821e7`. It
  runs the typecheck, Biome, remark and yamllint, dotenvx's check and the
  em dash lint, then `bun test`.
- **The package graph is pinned** by `workspace.test.ts`: who depends on
  whom, each package's entry points, the Agent SDK declared by `agent`
  alone, and that each undeclared import fails to resolve.
- **Tests retired**, with what replaced them:
  - the four boundary test files (`src/compaction/`, `src/history/`,
    `src/recall/` and `src/tui/boundary.test.ts`, 13 cases), by the
    package graph itself and `workspace.test.ts`;
  - the test keeping `QUIT_GRACE_MS` equal to `CLOSE_GRACE_MS` across what
    became two packages ("give a quit's save as long as the CLI gets to
    exit"), by one constant in `core`;
  - the `runReview` SDK-level tests (error result, throw or no result,
    timeout, cancellation), by `structuredCall`'s tests, with the
    cannot-start case added in `cb1cb12`;
  - the App recording tests (the scripted chat, the lookups, a resumed
    session, an unwritable transcript), by `record.test.ts` in memory,
    after `7650a58` pinned what App recorded.
- **Tests moved, not retired:** `src/dump.test.ts` is now the CLI's, and
  `recall/types.test.ts` moved to `core` with its contract.
- **Nothing in a test or a probe touched real data**: every root and
  environment is passed in or temporary.

## Commits

30 commits, oldest first, from the base `1f821e7`. Scopes follow
`.commitlintrc.mts`: `sdk` and `tui` while the code was still under `src/`,
then the package names.

### Contracts and wiring (Tasks 1 to 8)

- `30452b0` refactor(sdk): Move the shared types to contracts
- `f23442d` refactor(sdk): Gather the session contracts
- `c7dfbfe` refactor(sdk): Give reviews a StructuredCall
- `cb1cb12` test(sdk): Cover a query that cannot start
- `9b477b3` refactor(sdk): Render the earlier turns in memory
- `bea901f` refactor(sdk): Pass memory's commands their editor
- `7650a58` test(tui): Pin the transcript App records
- `9e7970b` feat(sdk): Record a chat's sessions in memory
- `4ad1da7` refactor(tui): Leave the transcript to memory
- `b8b0a09` refactor(tui): Front the screen with runApp
- `7f90935` refactor(sdk): Move the chat's wiring to memory
- `51cf832` refactor(sdk): Move recallLaunch to the CLI
- `c67d54e` refactor(sdk): Open memory for a chat in one call
- `7b4443b` style(tui): Name who supplies App's props
- `c68e9a4` test(sdk): Pin the review prompt; reword wrapping
- `aa02c02` refactor(sdk): Move the one-shot reply from index
- `838d7e7` refactor(sdk): Split the capture from the dump
- `75f8012` refactor(sdk): Preview a chat's start in memory
- `91f6520` refactor(sdk): Cut a directory path from a comment

### The packages (Tasks 9 to 13)

- `08862cd` chore(config): Add the package commit scopes
- `3f95af5` refactor(core): Make core a workspace package
- `e302b3e` refactor(tui): Make the TUI a workspace package
- `bd1e550` refactor(agent): Make agent a workspace package
- `906e6ae` refactor(memory): Make memory a workspace package
- `0521385` refactor(cli): Make the CLI a workspace package
- `35f36d5` refactor(cli): Merge the commands imports

### The graph, the clean-up and the docs (Tasks 14 to 17)

- `02976fd` test(config): Pin the workspace's package graph
- `d2d1a77` chore(config): Retire the build and the sdk scope
- `4a5bef4` ai: Describe Dorothy by package
- `fd5f20a` docs: Record the workspace packages

This report and the roadmap's link to it follow.

## Known limitations

One probe step is open, and no other limitation is known to block merge.
Merging is the user's call once that step is done.

- **The ready-session probe is open.** The dump shows that the Agent SDK's
  CLI starts and launches the recall server under the isolated linker. It
  goes through `previewStart` and `dumpRequest`, though, not through
  `openMemory`'s `createSession` and `connect` or the streaming
  `Conversation` that emits `ready`, so that wiring is unconfirmed live.
  The remaining step, on a machine where `.env` decrypts: run
  `bun run dev` (optionally with the four XDG variables pointed at a
  temporary directory), wait for the model's name in the header, and quit
  with Ctrl+D without sending a message. The hook, the quit and the
  commands were probed live.
- **Minor review findings were left**, each judged safe:
  - `declared()` in the graph test ignores `peerDependencies` and
    `optionalDependencies`;
  - the resolution test depends on install state, so reinstall from clean
    after removing a `@dorothy` dependency;
  - six resolution assertions share one `it()`;
  - `run-tui.test.ts` repeats `open.test.ts`'s XDG save and restore;
  - `describeError` is duplicated in memory's `record.ts` and the TUI's
    `App.tsx`;
  - `runDump` has no test on a resumed chat for its one spread line, and
    `previewStart`'s resume-failure case checks only that it failed;
  - the `posting` helper is duplicated in `capture.test.ts` and
    `dump.test.ts`;
  - `.claude/CLAUDE.md` names two different `commands.ts` files in
    neighbouring paragraphs, and its CLI paragraph lost "no argument
    opens the TUI, a prompt runs one-shot";
  - the comment at `packages/memory/src/memory/open.test.ts:446` still
    names `boundary.test.ts`.
- **Follow-ups for later.** The roadmap's Candidates section gains three
  from this work: memory's commands taking their dependencies
  injected more widely, a single binary with `bun build --compile` from
  `cli`, and a split of `memory` should it outgrow one package.
