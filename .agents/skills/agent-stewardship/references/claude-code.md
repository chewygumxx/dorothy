---
ctime: 2026-10-31
mtime: 2026-10-31
spdx: GPL-3.0-only
title: Claude Code
description: >-
  Reading Claude Code's budget and context, compacting a session from its
  own pane, the accounts subagents spend, and the background shell.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.agents/skills/agent-stewardship/references/claude-code.md
   -
   -->

# Claude Code

## Budget and context

Claude Code gives the plan's rate limits and the session's context to
its status line alone. This project's status line,
[`scripts/statusline.sh`](../../../../scripts/statusline.sh), writes
them at each render to `$XDG_RUNTIME_DIR/claude-usage-<account>.json`,
the account being the last part of `CLAUDE_CONFIG_DIR`, such as
`claude-2`:

- `at`: when it was written, in UTC.
- `rate_limits.five_hour` and `rate_limits.seven_day`: each a
  `used_percentage` and a `resets_at` in epoch seconds.
- `context_window`: `used_percentage` of `context_window_size`.

```sh
jq '{at, five: .rate_limits.five_hour, week: .rate_limits.seven_day,
    context: .context_window.used_percentage}' \
    "$XDG_RUNTIME_DIR/claude-usage-claude-2.json"
```

The file describes only the account of the session drawing the status
line, and goes stale while no client draws it. A reading over 10 minutes
old is unknown; the reserve account's budget is known only from its
limit messages.

## Compacting yourself

No API compacts a running session, but input typed into its pane does.
Past 85%, at a turn boundary:

1. Write the instructions with the `compact-summary` skill: the open
   tasks, decisions and state, pointing at the resume note
   ([recovery](./recovery.md)) for the rest. Save them to a file
   outside the repository, such as
   `$XDG_STATE_HOME/dorothy-agents/compact.md`.
2. Run `compact-self.sh <file>` detached, as Claude Code's background
   Bash does: it waits for your turn to end, then for your pane,
   `$HERDR_PANE_ID`, to idle.
3. Tell the user you are compacting, and end the turn.

The script then takes the pane's lock, checks the agent is still idle
(exit 5 if not), and types `/compact` and a space, the instructions,
then Enter, each apart and three seconds between
(`DOROTHY_COMPACT_PAUSE`). The pane shows `/compact [Pasted text #1]`
before Enter. One paste of the whole line did nothing visible, and
`herdr agent prompt` delivers a plain message, never a slash command.
Outside herdr, with no `$HERDR_PANE_ID`, it prints its usage and touches
nothing.

## Subagents and accounts

A subagent started with the Agent tool spends the coordinating session's
own plan, the account of its `CLAUDE_CONFIG_DIR`: route to one only when
the job leaves `dorothy-main` room to finish its own work. A command
that calls Claude itself, such as `eval run` or
`dorothy --review-backfill`, spends the token it is given instead:
start it through `with-claude.sh`, which chooses the account
([budgets](./budgets.md)).

## The background shell

A command run in the background from Claude Code's Bash belongs to the
session: memory pressure can reap it, and a limit or a restart leaves it
unwatched. Restart a reaped one only when the user asks. A job that may
outlast the window goes through `job.sh` ([recovery](./recovery.md)).
Short waits, such as `compact-self.sh` or `herdr agent wait`, belong in
the background shell, which tells the session when they end.
