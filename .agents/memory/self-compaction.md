---
name: self-compaction
description: The coordinating agent may compact itself through herdr past 85% context, at a turn boundary, telling the user
metadata:
  node_type: memory
  ctime: 2026-10-31
  mtime: 2026-10-31
  spdx: GPL-3.0-only
  type: feedback
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.agents/memory/self-compaction.md
   -
   -->

On 2026-10-31 the user approved a standing rule: once its context passes
85% (`context_window.used_percentage`, as
[usage-limits](./usage-limits.md) says to read it), the coordinating
agent, `dorothy-main`, compacts itself by having herdr type
`/compact <instructions>` into its own pane, the instructions from the
`compact-summary` skill.

**Why:** no API compacts a running session, but input typed into its
terminal does; the user would rather the agent manage its own context
than wait to be told.

**How to apply:** only at a turn boundary, never mid-task with work in
flight that the summary would have to carry; write the instructions
first, with the open tasks, decisions and state; tell the user each
time. Typed input reads as the user's own, so use it for this alone.
