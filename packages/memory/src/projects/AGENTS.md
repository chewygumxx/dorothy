---
ctime: 2026-10-15
mtime: 2026-10-20
spdx: GPL-3.0-only
title: packages/memory/src/projects/AGENTS.md
description: >-
  How a project's facts are identified, exported and synced with its
  repository.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/memory/src/projects/AGENTS.md
   -
   -->

# packages/memory/src/projects/AGENTS.md

A project is the git repository a path is in. Its facts live in the
store under `facts/projects/<id>/` and are synced to the repository's
memory directory, `.agents/memory/` by default.

## Files

- `identify.ts`: `identify` finds the repository root and reads its
  `origin` from the config file, never through `git`; `normaliseRemote`
  drops scheme, credentials, port and `.git`. No `origin`, or a local
  one, is `local-` and the root's hash.
- `registry.ts`: `projects.json`, each project's roots, memory directory
  and, by root and then by memory directory, the hash of each fact as
  both sides last held it there, with the directory each root synced
  last.
- `export.ts`: the exported form Claude Code's auto-memory reads, its
  hash by content, and `MEMORY.md` within 200 lines and 25,000 bytes.
- `sync.ts`: `syncProject`, the reconciliation.

## Invariants

- Only a project's own directory is exported: a personal fact can never
  reach a repository.
- A fact changed in both places takes the repository's version; a file
  is overwritten only when its content still matches the last sync.
- A repository file that is no fact, a symlink, unreadable or over
  64 KiB, or no regular file, is skipped and named, never imported,
  overwritten or retired.
- A file is overwritten or removed only after sync reads it again and
  finds it as it first read it, so an edit made meanwhile survives.
- A repository file is a fact's whatever its stem names one: Claude Code's
  `feedback_testing.md` is the fact `feedback-testing` (`nameOfStem`),
  its frontmatter naming either. It keeps its file name: an export or a
  removal goes to that file, `MEMORY.md` links it, and the report names
  the file (`renamed`). A file named as the fact beats a snake-case twin,
  which is skipped and named.
- `MEMORY.md` is rewritten only when it is absent or every line is one
  sync writes (an entry, or its description indented two spaces, no list
  item and no blank line before it), and no skipped file is one it links;
  else it is left, and the report says why. Past the last live fact it is
  emptied only if it lists nothing but the store's facts. An entry whose
  fact's description did not change keeps its hook lines, which a hand
  may have written. It is written only once found as first read, so an
  edit made meanwhile survives. An imported fact's title is its entry's,
  in sync's form or Claude Code's one-line one, else the store's, else
  its name.
- An import keeps what only the store holds: tags, importance, creation,
  foreign keys and other sources. Its origin is `repo`, which confirms
  nothing. A verification stays only for the words it confirmed: one
  the store held for the same words, or one the file carries
  (`verified`, each entry with the `wordsDigest` of its words, which
  the export writes), so changed words or a renamed title drop it.
- A form without verifications hashes as it always has, so records made
  before verifications travelled stay valid.
- A fact retired in the store has the form removed from the repository
  recorded (`removed:<hash>`): the file reappearing as it was is removed
  again, changed is the repository's version, and a revival exports.
- A recorder that throws leaves the report, with `unrecorded`; the writes
  stand and history sweeps them up.
- Each root keeps its own record of what it last synced with each
  memory directory, so one remote's checkouts never undo each other and
  a directory switched away from and back is synced from what it last
  held. A sync touches only the record of its root and `memoryDir`;
  with none it is a first sync, which retires nothing. Others are kept,
  never pruned. A directory absent from disk keeps its record only if
  the root synced it last, so only a deletion retires, never a move.
- Sync never commits or pushes, never writes outside the memory
  directory, and refuses a memory directory that escapes by `..` or
  through a symlink at any step from the root down.
