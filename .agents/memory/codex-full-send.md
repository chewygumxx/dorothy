---
name: codex-full-send
description: "Approve every Codex prompt; Codex runs never-ask, full access"
metadata:
  node_type: memory
  ctime: 2026-10-20
  mtime: 2026-10-20
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
herdr (`herdr agent send-keys <name> y`) rather than relay it to them.
`~/.codex/config.toml` now sets `approval_policy = "never"` and
`sandbox_mode = "danger-full-access"`; a Codex session started before
that still asks until restarted.

**Why:** they offload work to Codex to save Claude usage, and a prompt
waiting on them stalls the work.

**How to apply:** approve Codex's prompts yourself; restart a Codex
agent that predates the config. Claude Code's own permission prompts are
not covered by this.
