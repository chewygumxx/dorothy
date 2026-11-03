---
ctime: 2026-11-04
mtime: 2026-11-04
spdx: GPL-3.0-only
title: packages/memory/src/recording/AGENTS.pi.md
description: >-
  Pi's part of the recording guide: its reader, its confined source, its
  ancestry sidecars and how the sweep and hooks record its segments.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/memory/src/recording/AGENTS.pi.md
   -
   -->

# packages/memory/src/recording/AGENTS.pi.md

Pi's sessions, split from [the recording guide](./AGENTS.md) by source,
which holds what every host shares. No Pi package is imported here.

## Files

- `pi.ts`, `pi-tree.ts`: `readPi(lines, { parent, ended })`, a session
  file's branch segments; their invariants sit atop each file.
- `pi-source.ts`: `piSource(env)`, the files below `piSessionRoot(env)`
  (`../hosts/pi-root.ts`, `$XDG_DATA_HOME/dorothy/pi/sessions`), and
  `readPiSession`, the file a hook names, read alike; invariants atop it.
- `state.ts`: `loadPiSidecar` and `savePiSidecar`, a versioned sidecar
  per file under `$XDG_STATE_HOME/dorothy/pi/recording`, named by the
  SHA-256 of its canonical path.
- `pi-fixtures.ts`: synthetic entries, and a session and its fork.

## Invariants

- Only the dedicated root is read, never through a symlink. A path a
  header or a hook names counts only when its real directory lies inside
  the root's; anything else is `outside`, and never opened.
- A read is `{ kind: "pi", read, lines, orphan }`. Each segment is its
  own archive conversation, `pi:<segment>`, its `parent` the segment it
  branched from, which may be another file's. The sweep and the hooks
  record them in order, through the one record route.
- A fork's ancestry is its named parent's complete read (no halt, torn
  tail or unresolved parent of its own), resolved first, the chain at
  most 64 deep, a cycle refused; or the parent's sidecar while its file
  is unchanged. Else the fork is `orphan`: held, its events unsent,
  counted in the sweep's `held` and logged once.
- A sidecar holds owners, origins, digests and anchors, never speech;
  lost, it is rebuilt from the file. It is written before the archive
  takes a segment, so a rewrite that would move a kept entry or segment
  halts the file at that entry (`ownership`), recording nothing.
- A file past 64 MiB is unreadable; a halt is kept under host `pi` and
  the native session, `--sweep --reread` and `--dismiss pi` serve it.
- Pi's ended rule is the sweep's hour, or a hook's `end`.
- A `dorothy.tool-final` custom entry (`{ entryId, toolCallId, content,
  isError }`), written by the CLI's Pi extension for a call Pi finalized
  without a saved result, answers that call with its own identity. It
  counts only where the named assistant entry is its ancestor and no
  ordinary result in the file answered the call; a malformed one is
  ignored. So a result, a final and a failure never double-emit.
