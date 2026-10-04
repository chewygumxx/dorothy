---
name: bg-session-force-color
description: "Claude Code background sessions export FORCE_COLOR=3; the user's own shell does not"
metadata:
  node_type: memory
  type: reference
  originSessionId: 4a3e48ae-7145-48e9-ace9-ed4dc9f0042f
  modified: 2026-10-04T20:20:14.359Z
---

Claude Code background sessions (`claude --bg`, which have `CLAUDE_JOB_DIR`
set) export `FORCE_COLOR=3` to their tools and to `!` commands. The user's
own shell and regular sessions leave it unset. On 2026-10-05 this made 12
Ink frame tests fail inside a background session; `test-setup.ts` (a
`bun test` preload) now forces colour off.

**How to apply:** when output differs between a background session and the
user's terminal, check the session's environment before blaming their
shell.
