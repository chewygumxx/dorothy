---
ctime: 2026-10-12
mtime: 2026-10-12
spdx: GPL-3.0-only
title: packages/memory/AGENTS.md
description: >-
  The memory package's guide: transcripts, notes, recall, compaction, tags
  and history, and the locks and wiring that hold them together.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/memory/AGENTS.md
   -
   -->

# packages/memory/AGENTS.md

`@dorothy/memory` is Dorothy's memory database in all its parts:
transcripts, the notes on each conversation, recall, compaction, tags and
history. It never imports the agent or a model provider's SDK: reviews and
compaction take core's `StructuredCall` and their prompts as text
(`MemoryPrompts`).

## Entry points and imports

- `"."` (`src/index.ts`): `openMemory` and `previewStart`.
- `"./commands"` (`src/commands.ts`): `--list`, `--memory`, `--tags`,
  `--edit-tags`, the history commands and `commandHistory()`.
- `"./recall-server"` (`src/recall-server.ts`): `runRecallServer`, loaded
  without the rest of memory.

Of the `@dorothy` packages it depends on `core` alone. `recall/server.ts`
is the only file importing `@modelcontextprotocol/sdk`.

## Files

- `transcript.ts`: transcripts, private JSONL under
  `$XDG_DATA_HOME/dorothy/`. A `tool` event keeps a body's call, run
  through `scrub.ts` and trimmed to 2,000 characters a side; a session
  event may name its `source`.
- `memory/open.ts`: `openMemory` opens a chat's memory and returns its
  `createSession(turns)`, whose sessions are compacting, tracked by memory
  and recorded by `sessionRecorder` (`record.ts`). Each starts from the
  `SessionStart` values memory renders, handed to the `connect` the CLI
  passes. `preview.ts` gives `--dump-context` a start without history.
  `catalogue.ts`'s `indexCatalogue` loads each conversation's sidecar,
  visits and reads from the recall index, for `openMemory`,
  `previewStart` and `--list`.
- `memory/sidecar.ts`: the notes, kept in `<phrase>.meta.json` beside the
  transcript. `service.ts`'s `MemoryService` builds the memory block each
  session starts with, frozen for the session, and schedules reviews
  (`review.ts`, `scheduler.ts`): one-shot calls that never block the chat.
  `track.ts`'s `trackMemory` decorates the `ChatSession`, so `App` sees
  only notices. `rank.ts`, `block.ts`, `edit-view.ts` and `list.ts` are
  pure; `commands.ts` has `--list`, `--memory`, `--tags` and
  `--edit-tags`.
- `memory/vocabulary.ts`, `tagging.ts`, `tags-view.ts`: tags, a SKOS-style
  vocabulary in `tags.json` (concepts with `prefLabel`, `altLabel`,
  `broader` and `scopeNote`, and the tombstones of deleted and merged
  ones). Each sidecar holds its conversation's concept ids. `applyTagging`
  checks a review's tags leniently, a bad tag never failing the notes, and
  coins concepts inside the sidecar's lock.
- `recall/`: search over past conversations. `store.ts` is a derived
  SQLite FTS5 index in the XDG cache; `sync.ts` syncs it from the
  transcripts and sidecars before every query; `query.ts` has `search` and
  `open`; `tags.ts` mirrors the vocabulary; `server.ts` serves them over
  MCP on stdio as `dorothy --recall-server`. Reviews appraise each read
  into the sidecar, and `salience()` (`rank.ts`) weighs appraised reads
  with visits.
- `compaction/`: past `[compaction] soft` tokens, at the next idle (past
  `hard`, before the next message), `compact()` (`compact.ts`) splits the
  turns before the verbatim tail into topical clusters with an abstract
  each: the prompt and its checks in `clusters.ts`, the turns' ranges and
  pressure in `plan.ts`. `Compaction` (`session.ts`) wraps the
  session; a pass (`run.ts`, on `shared.ts`'s state) appends the clusters
  to the sidecar, writes a `compaction` transcript event, and swaps in a
  session seeded with the abstracts and the turns after them.
- `history/`: the data directory as a git repository. `MemoryRepo`
  (`repo.ts`) has two engines, the git binary run isolated from the
  user's configuration (`binary.ts`) and isomorphic-git (`iso.ts`), chosen
  once per process (`open.ts`). `MemoryHistory` (`history.ts`) commits
  each logical change, sweeps up outside changes first, and restores a
  file that fails `lint.ts` (`heal.ts`), keeping its bytes under
  `broken/`. The lint knows facts and `projects.json`; the sweep rewrites
  a hand-edited fact canonically, as the user's, before linting it.
  `mirror.ts` seals new commits as AES-256-GCM bundles (`seal.ts`) on the
  orphan branch `sealed` and pushes it to the remote
  `mirror` under `DOROTHY_MIRROR_KEY`; `--recover` rebuilds from it.
  `commands.ts` has `commandHistory` and `--history`, `--restore`,
  `--rollback`, `--check`, `--mirror` and `--recover`, saving the
  mirror's key with dotenvx's `set`; `lock.ts` is the `FileLock`.
- `sqlite-lock.ts`: `exclusiveLock`, a SQLite `BEGIN IMMEDIATE` write
  lock.

## Invariants

- The recall index doubles as the sidecar write lock and holds review
  claims, so two TUIs never review one conversation at once. Without the
  index, history's `FileLock` (`.git/dorothy.lock`) is the lock; both are
  `exclusiveLock`. History commits a change inside the lock it was written
  under; healing takes the lock, so it happens only outside it.
- `updateSidecar`'s change may be async, so coining a concept inside its
  lock means two runs never coin one label twice.
- The notes never import history; only `openMemory` wires the two.
  Writers take a `Recording` through `updateSidecar` and
  `updateVocabulary`, the service a `HistoryHandle`, and the commands an
  `OpenHistory`, which the CLI passes from `commandHistory()`.
- `openMemory` opens the index and history before it reads anything, and
  commits each turn once the transcript is flushed.
- The memory block charges the earlier turns' abstracts to its budget
  first.
- `recollect` is registered only with `--recollect`, which the agent adds
  when a chat has clusters.
- A concept only hidden conversations carry is never shown to her.
- A key that does not open the newest sealed bundle seals nothing.
- The vocabulary path is always passed (`vocabularyPath()`), never derived
  from the transcripts directory.

## Tests

- Pass every root, key and environment in; tests keep to temporary
  directories (`history/testing.ts` has `tempRoot` and `TEST_ENV`).
- The git binary's tests shut out the user's git configuration.
- One contract test runs against both history engines, and across them.
- `memory/fake-session.ts` stands in for a `ChatSession`.

## See also

- Specs: [catalogue](../../docs/specs/2026-10-05-conversation-catalogue-design.md),
  [recall](../../docs/specs/2026-10-06-recall-design.md),
  [compaction](../../docs/specs/2026-10-07-compaction-design.md),
  [tags](../../docs/specs/2026-10-07-tags-design.md),
  [history](../../docs/specs/2026-10-08-memory-history-design.md)
- Reports: [recall](../../docs/reports/2026-10-06-recall.md),
  [compaction](../../docs/reports/2026-10-07-compaction.md),
  [tags](../../docs/reports/2026-10-08-tags.md),
  [history](../../docs/reports/2026-10-08-memory-history.md)
