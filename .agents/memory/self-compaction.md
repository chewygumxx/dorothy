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
85%, the coordinating agent, `dorothy-main`, compacts itself by typing
`/compact` with instructions into its own pane, at a turn boundary, and
tells the user each time.

**Why:** no API compacts a running session, but input typed into its
terminal does; the user would rather the agent manage its own context
than wait to be told.

**How to apply:** follow
[agent-stewardship](../skills/agent-stewardship/SKILL.md): never
mid-task with work in flight, and typed input reads as the user's own,
so type into your own pane for this alone.
