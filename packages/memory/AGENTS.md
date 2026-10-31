---
ctime: 2026-10-12
mtime: 2026-10-29
spdx: GPL-3.0-only
title: packages/memory/AGENTS.md
description: >-
  The memory package's guide: transcripts, notes, facts, projects, recall,
  compaction, tags and history, and the locks that hold them together.
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

`@dorothy/memory` holds transcripts, notes, facts, projects, recall,
compaction, tags and history. It imports neither the agent nor a model
provider's SDK: reviews and compaction take core's `StructuredCall`
and prompts as text (`MemoryPrompts`).

## Entry points and imports

- `"."` (`src/index.ts`): `openMemory`, `previewStart`, and what
  `--claude` asks of memory; `"./claude-hook"` (`src/claude-hook.ts`):
  `runClaudeHook`, for its hooks. Read [their guide](./src/bodies/AGENTS.md).
- `"./commands"` (`src/commands.ts`): `--list`, `--memory`, `--tags`,
  `--edit-tags`, `--facts`, `--retire`, `--revive`, `--verify`, `--sync`,
  `--projects`, the history commands and `commandHistory()`.
- `"./recall-server"` (`src/recall-server.ts`): `runRecallServer` alone;
  `"./service"`, `"./client"`, `"./bridge"`, `"./evaluation"`: [the contract's guide](./src/contract/AGENTS.md).

## Files

- `transcript.ts`: private JSONL under `$XDG_DATA_HOME/dorothy/`.
  Sessions name their `source`, events their `sourceUuid`. Tool text is
  scrubbed (`scrub.ts`) and trimmed to 2,000 characters a side. Chat's
  appends and backfill unmarks share `TranscriptWriter`'s common lock.
- `memory/open.ts`: `openMemory` opens a chat's memory and returns its
  `createSession(turns)`, whose sessions are compacting, tracked by memory
  and recorded by `sessionRecorder` (`record.ts`). Each starts from the
  `SessionStart` values memory renders, handed to the CLI's `connect`. It
  records chat's project and, with memory on, syncs it at the start and
  after each turn; it refuses to resume a Claude Code conversation.
  `preview.ts` gives `--dump-context` a start without history.
  `catalogue.ts`'s `indexCatalogue` loads each conversation's sidecar,
  visits and reads from the index for `openMemory`, `previewStart` and `--list`.
- `memory/sidecar.ts`: the notes, kept in `<phrase>.meta.json` beside the
  transcript, including a durable backfill mark cleared by live appends.
  `service.ts`'s `MemoryService` freezes each session's block and schedules
  reviews (`scheduler.ts`; `reviewer.ts`, also the hooks'), never blocking
  chat. `track.ts`'s `trackMemory` decorates the `ChatSession`, so `App` sees
  only notices. `rank.ts`, `block.ts`, `edit-view.ts` and `list.ts` are
  pure; `commands.ts` has `--list`, `--memory`, `--tags`, `--edit-tags`.
- `memory/review-backfill.ts`: `runReviewBackfill`: newest `-n` marked sidecars
  but `skip`'s, each reviewed; a failed call restores its mark and stops.
- `memory/vocabulary.ts`, `tagging.ts`, `tags-view.ts`: tags, a SKOS-style
  vocabulary in `tags.json` (concepts with `prefLabel`, `altLabel`,
  `broader` and `scopeNote`, and the tombstones of deleted and merged
  ones). Each sidecar holds its conversation's concept ids. `applyTagging`
  checks a review's tags leniently, a bad tag never failing the notes, and
  coins concepts inside the sidecar's lock.
- `facts/`: facts as OKF Markdown under `knowledge/` (`file.ts`; `migrate.ts`
  moves `legacy.ts`'s old form once), personal or a project's, written under
  the lock (`store.ts`); `yaml` checks duplicate keys; `commands.ts` theirs.
- `projects/`: a project's identity, registry, exported form and sync
  with its repository; read [its own guide](./src/projects/AGENTS.md).
- `recall/`: search over past conversations and facts. `store.ts` is a derived
  SQLite FTS5 index in the XDG cache; `sync.ts` syncs it from the transcripts
  and sidecars before every query: a conversation's source and project from its
  first session, its body sessions (`sessionPhrase`) too, a hidden one's turns
  counted but their text left out, and `facts.ts` the facts by content hash.
  `query.ts` has `search`, `open`, `recollect` (a hidden chat's turns from its
  transcript); `tags.ts` mirrors the vocabulary; `remember.ts` writes her facts;
  `server.ts` serves them over MCP on stdio as `dorothy --recall-server`, one
  call at a time, history opened without the mirror. Reviews appraise each read
  into the sidecar, and `salience()` (`rank.ts`) weighs appraised reads.
- `compaction/`: past `[compaction] soft` tokens, at the next idle (past
  `hard`, before the next message), `compact()` splits the turns before
  the verbatim tail into topical clusters with an abstract each; read
  [its own guide](./src/compaction/AGENTS.md).
- `history/`: the data directory as a git repository. `MemoryRepo` (`repo.ts`)
  has two engines, the git binary run isolated from the user's configuration
  (`binary.ts`) and isomorphic-git (`iso.ts`), chosen once per process
  (`open.ts`). `MemoryHistory` (`history.ts`) commits each logical change,
  sweeps up outside changes first, and restores a file that fails `lint.ts`
  (`heal.ts`), keeping its bytes under `broken/`. The lint knows facts and
  `projects.json`. The sweep keeps a fact as hers if `facts/pending.ts` noted
  its hash. A damaged journal warns, commits without changing attribution, then
  repairs; outside edits are user's. `mirror.ts` seals new commits as
  AES-256-GCM bundles (`seal.ts`) on the orphan branch `sealed` and pushes it
  to the remote `mirror` under `DOROTHY_MIRROR_KEY`; `--recover` rebuilds from
  it. `commands.ts` has `commandHistory`, history/restore/rollback/check and
  mirror/recover commands. Commands that advance main await a push on close;
  mirror keys use sops in `secrets.json`. `lock.ts` is the common `FileLock`.
- `recording/`: readers and the sweep, [guide](./src/recording/AGENTS.md);
  `service/` binds it, [guide](./src/service/AGENTS.md).
- `sqlite-lock.ts`: `exclusiveLock`, a SQLite `BEGIN IMMEDIATE` lock.

## Invariants

- The recall index doubles as the sidecar write lock and holds review
  claims, so two TUIs never review one conversation at once; a corrupt
  one is rebuilt in place only if `soleHolder` shows no other process has
  it open. History's `FileLock` (`.git/dorothy.lock`) excludes all history
  writers, with the index's lock taken first when available; history
  commits inside it, and healing takes it, so only outside it.
- `updateSidecar`'s change may be async, so coining a concept inside its
  lock means two runs never coin one label twice.
- The notes never import history; only `openMemory` wires the two.
  Writers take a `Recording` through `updateSidecar` and
  `updateVocabulary`, the service a `HistoryHandle`, and the commands an
  `OpenHistory`, which the CLI passes from `commandHistory()`.
- `openMemory` opens the index and history before it reads anything, and
  commits each turn once the transcript is flushed.
- The memory block charges the earlier turns' abstracts first.
- `recollect` is served only with `--recollect`, for a chat with clusters.
- Hidden chats carry no catalogue concepts; backfills are reviewed on request.
- Nothing deletes a fact: one retired stays indexed, searchable and in history.
  Its origin is set by the code that writes it, never read from its text, and
  only the user raises it.
- A key that does not open the newest sealed bundle seals nothing.
- `vocabularyPath()` is always passed, never derived from the transcripts dir.

## Tests

- Pass every root, key and environment in; tests keep to temporary
  directories (`history/testing.ts` has `tempRoot` and `TEST_ENV`).
- Git tests isolate config; local HTTPS uses git http-backend and OpenSSL.
- One contract test runs against both history engines, and across them.
- `memory/fake-session.ts` fakes a `ChatSession`; `*-testing.ts` share fixtures.

## See also

- Specs: [catalogue](../../docs/specs/2026-10-05-conversation-catalogue-design.md),
  [recall](../../docs/specs/2026-10-06-recall-design.md),
  [compaction](../../docs/specs/2026-10-07-compaction-design.md),
  [tags](../../docs/specs/2026-10-07-tags-design.md),
  [history](../../docs/specs/2026-10-08-memory-history-design.md),
  [memory store](../../docs/specs/2026-10-15-memory-store-design.md),
  [bodies](../../docs/specs/2026-10-15-memory-bodies-design.md)
- Reports: [recall](../../docs/reports/2026-10-06-recall.md),
  [compaction](../../docs/reports/2026-10-07-compaction.md),
  [tags](../../docs/reports/2026-10-08-tags.md),
  [history](../../docs/reports/2026-10-08-memory-history.md)
