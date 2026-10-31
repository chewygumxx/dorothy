---
name: codex-full-send
description: "Approve every Codex prompt yourself; never relay one to the user"
metadata:
  node_type: memory
  ctime: 2026-10-20
  mtime: 2026-10-31
  spdx: GPL-3.0-only
  type: feedback
  originSessionId: fb965535-b7ef-4fd4-8065-6767fb16ee58
  modified: 2026-10-19T19:21:13.344Z
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.agents/memory/codex-full-send.md
   -
   -->

On 2026-10-20 the user asked that Codex never ask, "full send all risk",
and that a coordinating agent approve every pending Codex prompt through
herdr rather than relay it to them.

**Why:** they offload work to Codex to save Claude usage, and a prompt
waiting on them stalls the work.

**How to apply:** approve Codex's prompts yourself, as
[agent-stewardship](../skills/agent-stewardship/SKILL.md)'s Codex
reference says. Claude Code's own permission prompts are not covered.
