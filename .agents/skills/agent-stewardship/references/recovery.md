---
ctime: 2026-10-31
mtime: 2026-10-31
spdx: GPL-3.0-only
title: Recovery
description: >-
  Arming wake-ups for yourself and for Codex, the resume note, long jobs
  with job.sh and their results, the record of scheduled sends, and what
  to do on waking.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.agents/skills/agent-stewardship/references/recovery.md
   -
   -->

# Recovery

A limit ends the turn, so recovery is armed before it. Nothing here
waits on the client or the user: a timer wakes the agent, a note says
where it was, and its jobs run on as units.

## Arming a wake-up

Past 80% of the 5-hour window, or before a long unattended job,
schedule a prompt to yourself for five minutes after the window resets.
The message is a pointer to the resume note, never its content:

```sh
S=.agents/skills/agent-stewardship/scripts
f=$XDG_RUNTIME_DIR/claude-usage-claude-2.json
note=${XDG_STATE_HOME:-$HOME/.local/state}/dorothy-agents/dorothy-main.md
t=$(jq -er '.rate_limits.five_hour.resets_at | numbers | . + 300' \
    "$f") &&
    printf 'Woken at the reset: read %s\n' "$note" |
    "$S/send-prompt.sh" --at "@$t" dorothy-main
```

A missing or non-numeric `resets_at` leaves `numbers` nothing to pass,
so `jq -e` prints nothing and fails; a past one `send-prompt.sh`
refuses. Either way nothing is armed, and you say so.

For Codex, once its limit is met, its footer's warning gives the reset
([Codex](./codex.md)): arm a prompt to `dorothy-codex` for five minutes
after it, pointing at its brief or report, with the date in the time.

`--at` takes a time with its date, `YYYY-MM-DD HH:MM` or `@<epoch>`, as
a bare time would recur daily, and refuses a past one; `--in` takes a
span, such as `90min`. It prints the unit and when it fires. Each
send is its own transient timer, collected once it has run.

## The resume note

`$XDG_STATE_HOME/dorothy-agents/<agent>.md`, outside the public
repository, rewritten whenever what it says changes:

```markdown
Written 2026-10-31T14:05Z.

- Work: the plan and task in flight, its branch and checkout.
- Jobs: each unit, its log and its result file.
- Wake-ups: each armed unit and when it fires.
- Next: the one step to take on waking.
```

A wake-up and a compaction both resume from it; a stale note shows its
time.

## Long jobs

```text
job.sh <name> [--notify <agent>] [--env NAME]... -- <command> [args]
```

The command runs as the user unit `dorothy-job-<name>-<epoch ns>`, in
the current directory, its argv as written, nothing expanded. Its output
goes to `jobs/<unit>.log` under `$XDG_STATE_HOME/dorothy-agents/`. A unit
has none of your environment: only `PATH`, `HOME`, the `XDG_*` roots,
`HERDR_SOCKET_PATH`, `SOPS_AGE_KEY_FILE`, `CLAUDE_CONFIG_DIR`, the
`DOROTHY_CLAUDE_*` names and those given by `--env` cross, by name,
never a value in an argument. A secret is loaded inside the job, by the
command itself. It prints the unit and the log.

When the job stops, however it stops, `job-stopped.sh` writes
`jobs/<unit>.result` first: `result`, `exit_code` and `exit_status`
from systemd, and `at`. Then it prompts the `--notify` agent,
`[from job:<name>, scheduled] job <unit> stopped: ...` with the log's
path; a failed prompt goes to `jobs/<unit>.notify.log` and never
changes the result. `systemctl --user stop <unit>` stops a job.

## The record of sends

A scheduled send keeps its message in `sends/<id>.msg` under the state
directory, the id being `<agent>-<epoch ns>`, and arms the unit
`dorothy-send-<id>`, whose timer runs `send-prompt.sh --deliver <id>`.
No message is in a unit or its arguments.

- A delivery that finds its agent blocked or absent, before writing,
  re-arms itself in five minutes, up to twelve times, counting in
  `<id>.tries`, then gives up.
- A delivery that fails after writing anything is recorded as partial
  and never resent: a duplicate prompt could act twice.
- `<id>.log` records each try: `delivered`, `refused blocked, re-armed`,
  `gave up`, `partial: ...`. A delivered message's file is removed.

`systemctl --user list-timers 'dorothy-send-*'` lists what is armed;
stopping a send's `.timer` unit and removing its `.msg` cancels it.

## On waking

1. Read the resume note.
2. For each job, read its result file and the end of its log; a job
   with no result is still running (`systemctl --user status <unit>`).
3. Read the sends' logs for any partial or abandoned delivery.
4. If the limit still holds, re-arm and stop; else carry on from the
   next step, and rewrite the note.

A wake-up that finds nothing pending is read and dropped.
