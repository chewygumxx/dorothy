---
ctime: 2026-11-01
mtime: 2026-11-01
spdx: GPL-3.0-only
title: packages/memory/src/hooks/AGENTS.md
description: >-
  dorothy --hook for the hosts other than Claude Code: Codex's hooks and
  her Hermes provider, answered from her memory service.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/memory/src/hooks/AGENTS.md
   -
   -->

# packages/memory/src/hooks/AGENTS.md

`dorothy --hook <host> <event>` for hosts other than Claude Code, whose
hooks are in [bodies](../bodies/AGENTS.md).

## Files

- `payload.ts`: `parseHookInput` reads Codex's hook payload, and her
  Hermes provider's in the same shape, into a session, a working
  directory, a block reason and a prompt; null for anything else.
- `run.ts`: `runHostHook` finds the project, starts the service where
  it can, and answers the block or recall in Codex's hook shape; `""`
  for nothing or any failure, never a throw.
- `fixtures.ts`: the payloads Task 1's probe recorded.
