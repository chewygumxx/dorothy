---
name: usage-limits
description: "Check Codex's remaining 5-hour budget before dispatching; size jobs to fit"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 23f06ef0-8bfb-4a45-b87d-d5ac8dcf1296
  modified: 2026-10-29T12:26:19.303Z
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.agents/memory/usage-limits.md
   -
   -->

The user's Claude and Codex plans hit their usage limits often, and the
user wants the agent to take account of that. Codex's status line, read
with `herdr agent read dorothy-codex`, shows the 5-hour budget left
("5h 59% left") and the reset time once it is spent.

**Why:** on 2026-10-29 a 136-draft review sent to Codex at `xhigh`
effort with 59% left ran out halfway, costing hours of waiting.

**How to apply:** before a Codex dispatch, read its budget and size the
job to fit, splitting it or sending part to Claude subagents; the user
has said to spend Claude usage when Codex is short. Say when a job will
not fit rather than finding out mid-run. See [codex-full-send](./codex-full-send.md).
