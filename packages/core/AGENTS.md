---
ctime: 2026-10-12
mtime: 2026-10-21
spdx: GPL-3.0-only
title: packages/core/AGENTS.md
description: >-
  The core package's guide: the contracts the other packages meet on and
  the basics they share.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/core/AGENTS.md
   -
   -->

# packages/core/AGENTS.md

`@dorothy/core` holds the contracts the other packages meet on and the
basics they share. Every other package but `identity` depends on it; it
depends on none.

## Entry points and imports

One entry point, `"."` (`src/index.ts`), which re-exports every module
below. It declares `niceware` alone, and never imports another
`@dorothy` package or any model provider's SDK.

## Files

- `contracts/session.ts`: `ChatSession`, its `ConversationEvent`s, `Turn`
  and `RawMessage`, the structural stand-in for an SDK message.
- `contracts/start.ts`: `SessionStart`, the values a session starts from,
  and `withSection`, which joins a section (the memory block, the earlier
  turns' abstracts) to a system prompt.
- `contracts/structured.ts`: `StructuredCall`, the one-shot call reviews
  and compaction take.
- `contracts/notices.ts`: `Notice` and `NoticeSource`, what memory and
  history show on screen.
- `contracts/editor.ts`: `Editor`, the external editor's contract.
- `contracts/recall.ts`: the memory tools' names and shapes: chat's server
  and Claude Code's, `toolOf` on either server, the lookups, `remember`,
  and search and open over facts.
- `contracts/memory.ts`: the memory contract's types, ids and constants,
  which `memory` gives zod schemas.
- `secrets.ts`: `loadSecrets` reads sops-encrypted JSON into an injected
  environment, preserving nonempty values. `saveSecret` sends values on
  stdin, uses the adjacent `.sops.yaml` when creating a private file,
  and updates existing files with `sops set`. Failures carry codes alone.
  Names needing escapes or brackets in sops paths fail before any write.
  Both take a runner; the default closes unused stdin and discards stderr.
- `config.ts`: `config.toml` (`readConfig`, `parseConfig`).
- `xdg.ts`: the XDG directories (`xdgDir`), the state directory among
  them.
- `session-id.ts`: session phrases, and `isUuid` for the ids that name
  files; `timers.ts`: injectable timers.

## Invariants

- Secrets live in `secrets.json`, encrypted by sops; the age key is
  `~/.config/sops/age/keys.txt`. Back it up off this machine.
- Contracts are structural and free of SDK types, so no consumer of a
  session needs the SDK.
- A function that reads or writes the filesystem takes its directory or
  environment as a parameter (`Env`), so tests pass temporary ones.

## Tests

Tests sit beside their modules (`*.test.ts`). Pass every environment in;
never read the user's XDG directories.

## See also

- [Workspace modularity spec](../../docs/specs/2026-10-09-workspace-modularity-design.md)
