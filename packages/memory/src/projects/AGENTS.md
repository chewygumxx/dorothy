---
ctime: 2026-10-15
mtime: 2026-10-15
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
  and, root by root, the directory last synced and the hash of each fact
  as both sides last held it there.
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
- `MEMORY.md` is rewritten only when it is absent or every line is one
  sync writes (an entry, or its description indented two spaces, no list
  item and no blank line before it), a live fact exists, and no skipped
  file is one it links; else it is left, and the report says why. An
  imported fact's title is its entry's, in sync's form or Claude Code's
  one-line one, else the store's, else its name.
- Each root keeps its own record of what it last synced, so one remote's
  checkouts never undo each other. A record of another directory than
  `memoryDir`, after the user edits it, is none: a first sync, which
  retires nothing.
- Sync never commits or pushes, never writes outside the memory
  directory, and refuses a memory directory that escapes by `..` or
  through a symlink at any step from the root down.
