---
name: usage-limits
description: "Route work by usage budget: Codex if it fits, else a Claude subagent that leaves room for dorothy-main, else wait for the first reset"
metadata:
  node_type: memory
  ctime: 2026-10-29
  mtime: 2026-10-30
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
user wants the agent to account for that. Before dispatching a job,
estimate what it will spend, then route it, in this order:

1. **Codex** (`dorothy-codex`, through herdr) when the job predictably
   fits in its remaining 5-hour budget. Its status line, read with
   `herdr agent read dorothy-codex`, shows it ("5h 59% left") and,
   once spent, the reset time.
2. **A Claude subagent** when it fits in the Claude plan's budget and
   still leaves room for `dorothy-main`, the herdr-hosted session that
   coordinates (the agent itself): subagents draw on the same plan.
3. **Wait** for whichever limit resets first, Codex's or Claude's, and
   route the job there; a background timer, never a polling loop.

Claude has two accounts, each a `CLAUDE_CONFIG_DIR`: `claude-2`, which
the coordinating session runs on and spends first, and `claude`, a
reserve for when `claude-2` is spent for the week. The OAuth token in
`secrets.json` as `CLAUDE_CODE_OAUTH_TOKEN` is the reserve's, and the
evaluation's `claude` route and Dorothy's reviews spend whatever token
they are given, an exported one winning over `secrets.json`; a token
for `claude-2` is `CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2`. The user lets the
agent juggle both: `claude-2` while its budget allows, the reserve when
it does not, else wait for the first reset.

A job that fits nowhere whole is split: part now, the rest after a
reset. Say when a job will not fit rather than finding out mid-run.
Effort counts: Codex at `xhigh` spends far faster than at `high`.

**Why:** on 2026-10-29 a 136-draft review sent to Codex at `xhigh` with
59% left ran out halfway. The user then set out the order above.

**How to apply:** Claude's budget is read from
`$XDG_RUNTIME_DIR/claude-usage-<account>.json` (the account is
`CLAUDE_CONFIG_DIR`'s last part), which this project's status line
(`scripts/statusline.sh`) writes from Claude Code's `rate_limits` at
each render: the 5-hour and 7-day `used_percentage` and `resets_at` in
epoch seconds, with `at`, when it was written. The file describes only
the account of the session drawing the status line, and goes stale
while no client draws it: treat a reading over 10 minutes old as
unknown, and the reserve's budget as known only by its limit messages.
In late October 2026 Codex's limits were reset often by a promotion, so
the user said to spend them freely. See
[codex-full-send](./codex-full-send.md).
