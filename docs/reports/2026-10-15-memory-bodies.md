---
ctime: 2026-10-15
mtime: 2026-10-15
spdx: GPL-3.0-only
title: Dorothy's memory in her bodies report
description: >-
  How Dorothy's memory reached Claude Code and chat: the probes, the
  rulings, the verification and what is left.
tags:
  - dorothy
  - memory
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-15-memory-bodies.md
   -
   -->

# Dorothy's memory in her bodies report

## Summary

Written last.

## Delivery probes

Both probes ran the real `claude` (`-p`, `--no-session-persistence`)
against a loopback stand-in for the API, so they spent no tokens. The stand-in
recorded each request body and never a header; it answered a request that
offered the probe's MCP tools with a call to both `tags` tools, and any
other with "done". Each MCP server was the real `--recall-server` on
temporary XDG directories. The runner unset `CLAUDECODE` and every
`CLAUDE_CODE_*` variable, so the session running the probes was not
joined, and ran `claude` in an empty directory.

Two things in the plan's probe needed a change, both found by reading
the captured requests (kept outside the repository, as they hold personal
context):

- The stand-in decided whether a tool result had come back by looking
  at the last message. Claude Code ends the conversation with a
  `system`-role reminder, so the last message was never the result, the
  stand-in called the tools again each turn and the run only stopped at
  the 120 second timeout, after over a thousand requests. It now looks for
  a `tool_result` anywhere in the messages.
- The first run's tool calls all failed with "Cannot call ... while in
  plan mode": the `CLAUDE_CONFIG_DIR` the runner keeps sets
  `permissions.defaultMode` to `plan`. The runner now passes
  `--permission-mode default`, so that a tool outside `permissions.allow`
  is refused for want of a grant and not for the mode.

### Repeated flags and permissions

Command: Steps 1 to 3 and 5 of the delivery plan's Task 1.
Output: [flags.json](./2026-10-15-memory-bodies/flags.json).

With two `--mcp-config` flags the request offered the tools of both
`dorothy-memory` and `probe-b`, so repeated `--mcp-config` flags
accumulate. With two `--settings` flags, each allowing one server's
`tags` tool, the call to `dorothy-memory` was refused ("you haven't
granted it yet") and the call to `probe-b` ran: of repeated `--settings`
the last wins, they do not merge. With one `--settings` allowing
`dorothy-memory`, its call ran with no prompt, so permissions from
`--settings` let her tool run. (In that run the call to `probe-b` failed
for there being no such tool, as expected.) The prompt `hi` reached the
first request of both runs, so the `=` form of the flags keeps it.

Decisions: Task 8 leaves the user's own `--mcp-config` as given, its
`MERGED` constant holds `SETTINGS` and not `MCP_CONFIG`, and the
spec's permissions stand.

### Auto memory

Command: Steps 4 and 5 of the delivery plan's Task 1.
Output: [auto-memory.json](./2026-10-15-memory-bodies/auto-memory.json).

The plan looked for "auto memory" in the system prompt and found it in
neither run. The section is headed `# Memory` and opens "You have a
persistent file-based memory", so the summary looks for that phrase. With
`autoMemoryEnabled` true in both a project settings file and `--settings`,
the section was present; adding `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` to the
environment removed it. (The runner unsets `CLAUDE_CODE_*`, so the
variable is handed through after the unset, as `PROBE_ENV`.)

Decision: the variable wins over a settings file, and Task 8 needs no
`"autoMemoryEnabled": false` in Dorothy's settings object.

## Rulings

## Verification

## Known limitations
