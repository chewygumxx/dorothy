---
name: usage-limits
description: "Route work by usage budget: Codex if it fits, else Claude on the primary leaving room, else the reserve, else wait"
metadata:
  node_type: memory
  ctime: 2026-10-29
  mtime: 2026-10-31
  spdx: GPL-3.0-only
  type: feedback
  originSessionId: 23f06ef0-8bfb-4a45-b87d-d5ac8dcf1296
  modified: 2026-10-29T13:13:09.575Z
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.agents/memory/usage-limits.md
   -
   -->

The user's Claude and Codex plans hit their usage limits often, and the
user wants the agent to account for that: estimate what a job will
spend, then route it to Codex if it fits, else a Claude subagent on the
primary account that leaves room for `dorothy-main`, else the reserve
account, else wait for the first reset. The user lets the agent juggle
both Claude accounts. In late October 2026 Codex's limits were reset
often by a promotion, so the user said to spend them freely.

**Why:** on 2026-10-29 a 136-draft review sent to Codex at `xhigh` with
59% left ran out halfway. The user then set out the order above.

**How to apply:** follow
[agent-stewardship](../skills/agent-stewardship/SKILL.md): its rules,
and its budgets reference for reading each plan and choosing an account.
See also [codex-full-send](./codex-full-send.md).
