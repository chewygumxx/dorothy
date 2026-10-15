---
ctime: 2026-10-15
mtime: 2026-10-16
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

Dorothy's memory now reaches both her bodies. In `dorothy --claude`, with
`[memory] enabled`, the gateway places chat's memory block after her
identity, fixed for the launch; `claude` is offered her recall server as
`dorothy-memory`, its tools allowed in `--settings` so none prompts, and
auto memory is off. The server's `search` and `open` reach her facts as
well as her conversations, and `remember` writes, corrects and retires
facts of her own origin, in chat too, where it is a tool event marked
`memory: true`. The directory `claude` or chat starts in is synced as a
project. Recording her Claude Code sessions is the next plan's.

The probes decided that repeated `--settings` last-wins, so a user's own
is merged into Dorothy's (as a private file by path, so no secret reaches
`claude`'s command line), that repeated `--mcp-config` accumulates, and
that `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` beats a settings file. The
automated checks pass (`bun run check`, 1615 tests after the final
review's fixes), the end-to-end run on temporary data behaved as
expected, and the user's own check in `dorothy --claude` passed (see
Verification, By hand).

Claude Code version for the probes and the verification: 2.1.300.

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

Command: Steps 1 to 3 and 5 of the delivery plan's Task 1, whose
snippets are stale where the changes above apply; as run, the stand-in's
check and the runner's last line were:

```ts
const answered = JSON.stringify(body.messages ?? []).includes("tool_result");
```

```sh
timeout 120 ${PROBE_ENV:+env $PROBE_ENV} claude -p --no-session-persistence \
    --permission-mode default "$@"
```

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

Command: Steps 4 and 5 of the delivery plan's Task 1, with the memory-off
run handed its variable through `PROBE_ENV`, after the runner's unset of
`CLAUDE_CODE_*`, and the summary looking for the section's own words:

```sh
PROBE_ENV=CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 \
    "$P/run.sh" "$P/memory-off" --settings='{"autoMemoryEnabled":true}' hi
```

```sh
jq -s '[.[] | .system | tostring
    | test("persistent file-based memory"; "i")] | any' \
    "$P/$run"/request-*.json
```

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

## Recording probes

The probes ran the real `claude` 2.1.300 against a loopback stand-in,
as the delivery probes did, but on a temporary `CLAUDE_CONFIG_DIR` that
trusts the probe's directory and the stand-in's fake key, with
`DOROTHY_LAUNCH=probe-launch` on `claude`. Its hooks stood in for
`dorothy --claude-hook` and logged what they saw; a stdio MCP server
that never answers logged its environment. Print-mode runs passed
Dorothy's hooks in `--settings` beside a project's own `Stop` hook,
and three interactive runs drove `claude` under `script`.

What the plan's scripts needed, found by reading the runs:

- The stand-in looks at the last `user`-role message, and for a
  `tool_result` anywhere: as in the delivery probes, Claude Code ends
  the messages with a `system`-role reminder, so the first run was
  answered with the compaction summary and never called a tool.
- The runner passes `--permission-mode default`. Auto mode is Claude
  Code's default in 2.1.300; its classifier sent its own request to
  the stand-in, failed on the reply and refused the `Agent` call.
- The runners also unset `CLAUDE_PID`, `CLAUDE_EFFORT`, `CLAUDE_ALT`
  and `FORCE_COLOR`, inherited from the session running the probes,
  and set `DISABLE_AUTOUPDATER=1` and
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` after the unset, so the
  fresh configuration directory sends no update or telemetry traffic.
- `keys-clear.sh` sends its two Ctrl-D 0.3 seconds apart. One second
  apart, the second fell outside Claude Code's window, so `claude`
  stayed open until the timeout.
- The runs are driven by one script that logs `{"run": <name>}` to the
  hooks' log before each interactive run, so `hooks.json` shows which
  lines each run wrote.

The MCP server that never answers holds each print-mode run about 30
seconds before its first request, so every one took about 31.6 seconds.

### Claude Code's lines

Command: Steps 1 to 5 of the recording plan's Task 1. Step 6's survey of
the user's own transcripts was not taken again: the auto mode classifier
of the session running the probes refused the command as handling
personal data, and the refusal was left standing.
Output: [lines.json](./2026-10-15-memory-bodies/lines.json).

The six sessions' main transcripts held, without a `uuid`,
`api-request` (6), `api-request-blob` (12), `api-request-shape` (4),
`atis-latch` (15), `cost-state` (12), `file-history-snapshot` (6),
`last-prompt` (12), `mode` (12), `permission-mode` (6) and
`queue-operation` (12), every one on the planning survey's list and
in Task 4's `BOOKKEEPING`. The `api-request-blob` lines copy the
requests' message content, the user's words included, so they are
bookkeeping that is not empty: they are passed over and never stored.

With a `uuid` were only `user`, `assistant`, `attachment` and `system`.
The `system` subtypes were `compact_boundary`, `informational`,
`local_command`, `stop_hook_summary` and `turn_duration`, all on the
survey's list. The `attachment` subtypes were `agent_listing_delta`,
`auto_mode`, `date`, `environment`, `model`, `prompt_snapshot`,
`remote_session_change`, `session_context`, `skill_listing`,
`total_tokens_reminder` and `queued_command`, the last twice with
`commandMode` `task-notification` and a prompt opening
`<task-notification>`, the background agent's report. None carried the
user's words.

Each assistant line held one content block (15 `text`, 4 `tool_use`):
the stand-in's message of text and two calls became three lines. Two
assistant lines named the model `<synthetic>`, the "No response
requested." Claude Code writes on a resume. Of the user lines, 14 held
a string, 4 a `tool_result` each, one string was the
`isCompactSummary` summary and two strings were `isMeta`, the
`<local-command-caveat>`. `/compact` was written as a user line of
`<command-name>/compact</command-name>` markup and its output as one of
`<local-command-stdout>`, as Task 4's `spoken` expects.

The subagent wrote its own `subagents/agent-<id>.jsonl` beside a
`.meta.json`, under a directory named for the session: its lines are
all `isSidechain`, under the parent's `sessionId`.

Decision: `BOOKKEEPING` gains nothing, no type with a `uuid` is new, and
`spokenAttachment` stays `queued_command` with `commandMode` `prompt`
alone. The planning survey stands as the plan recorded it; the user may
take it again by hand.

### Resuming

Command: Step 4's resume, continue, fork and compact runs, and the
clear run.
Output: [resume.json](./2026-10-15-memory-bodies/resume.json).

`--resume <id>` and `--continue` appended to the first session's file
under its id: the file's 77 lines name that one session, and the hooks
of both runs reported its id and its transcript. `/compact` through
`--resume` did the same, appending a `compact_boundary` and the summary.
`--fork-session` wrote a new file under a new id whose 31 lines from the
first session repeat their `uuid`s and timestamps but name only the
fork's id in `sessionId`; no field names the session forked from.
`/clear` ran `SessionEnd` with
reason `clear` and went on under a new id in a new file, with no
repeated uuids.

Decision: Task 6 stands as written; `/clear` starting a new session id
under the same launch is as expected. A fork is new to Dorothy and its
copied lines predate the launch, so it is recorded from the launch on as
a conversation of its own, not joined to the one it forked from.

### Hooks

Command: Step 4's runs, and two checks by a hook that logs its start
and the signal that ends it.
Output: [hooks.json](./2026-10-15-memory-bodies/hooks.json).

Dorothy's hooks from `--settings` ran beside the project's `Stop`: each
interactive run logged both `slow` and `project` for each reply. In
print mode `slow` never logged: the check showed Claude Code starting
the async hook and sending it `SIGTERM` about 30 milliseconds later, as
`claude -p` exits. Interactive, an async `Stop` outlives `/exit`: the
check's hook finished 3.4 seconds after `SessionEnd`. The first run
took 31.70 seconds against 31.49 to 31.64 for the others, so `async`
kept the hook off the reply.

`SessionEnd` ran on every exit tried: reason `other` for each print-mode
run and for the hung-up terminal, `clear` for `/clear`, and
`prompt_input_exit` for both Ctrl-D twice and `/exit`. Each of the nine
was followed by `{"survived": true}`, written three seconds on by a
process the hook spawned detached, once the hook (and, but for
`/clear`, `claude`) had gone.

Decisions: hooks from `--settings` add to the user's own and Task 10's
merge stands; `async` stands. Task 8's detached `spawn` stands, with no
`setsid -f`. `SessionEnd` ran for `/clear`, Ctrl-D, `/exit` and the
hung-up terminal; the catch-up covers what it misses, a process killed
outright, and the last `Stop` of a `claude -p`, which Claude Code
terminates as it exits.

### What hooks and servers inherit

Output: [inherit.json](./2026-10-15-memory-bodies/inherit.json).

`DOROTHY_LAUNCH` set on `claude` reached the MCP server and every hook:
`server.launch` and the hooks' values are all `probe-launch`.

Decision: Task 10 passes `DOROTHY_LAUNCH` in the environment alone, and
no `--launch` flag is needed.

## Rulings

Made while planning, as carried out:

- **The resumed session's conversation is left out by Recording.**
  Finding a session's conversation needs `conversation_sessions`, the
  recording plan's, and before Recording no Claude Code session is ever
  recorded, so Delivery's block leaves nothing out. The spec says so.
- **Search results come as `{ facts, moreFacts, results, more }`**, facts
  first, each group capped at `limit`; a search lookup records
  conversations in `hits` and facts in `facts`.
- **Open's fact result** is `OpenFactResult`: id, scope, name, type,
  title, description, keywords (concept labels), importance, provenance,
  retired, body. A fact read's target in the index's `reads` is its id.
- **A tag is hers to see** when a visible conversation or a fact carries
  it, or nothing does yet.
- **Chat's `remember`** reaches the chat as a `remember` conversation
  event, recorded with `toolEntry` as tool `mcp__memory__remember`,
  `memory: true`, and shown as a dim line, as a lookup is.
- **`--recall-server` flags** come in any order: `[--exclude <phrase>]
  [--project <root>] [--recollect]`, `--recollect` only with
  `--exclude`.
- **History in the recall server and `syncDirectory`** is
  `commandHistory({ remindMirror: false })`: swept, committing, never
  pushing or reminding of the mirror.
- **Sync in chat** runs one at a time; a sync asked for while one runs
  runs once after it. Without the index and history there is no lock,
  and chat does not sync.

Made while carrying the plan out:

- **The search lookup records the searched kind as `searched`**, not
  `kind`, which would collide with a recall event's `kind: "recall"`.
- **A user's `--settings` file merged into Dorothy's is passed by path**,
  as a private 0600 file in `$XDG_RUNTIME_DIR/dorothy` (or a 0700
  per-user directory under the temporary directory), removed when the
  launch ends, so no secret reaches `claude`'s command line. Inline JSON
  and Dorothy's own settings stay inline.
- **Commit headers were shortened to 50 characters** for commitlint.
- **The `remember` tool's `from` is chat's conversation phrase.** Claude
  Code's server has none until Recording.

From the probes (Task 1's decisions):

- Repeated `--mcp-config` flags accumulate: a user's own `--mcp-config`
  is left as given, and `MERGED` holds `SETTINGS` alone.
- Repeated `--settings` flags: the last wins, so the user's is merged
  into Dorothy's.
- Permissions from `--settings` let her tool run with no prompt: the
  spec's permissions stand.
- The `=` form of the flags keeps the user's prompt.
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` wins over a settings file, so
  Dorothy's settings need no `"autoMemoryEnabled": false`.

## Verification

Run on 2026-10-15 from the repository on `feat/memory-delivery`, with
temporary XDG directories, nothing of the real
`$XDG_DATA_HOME/dorothy` or `$XDG_CACHE_HOME/dorothy` touched, and
`CLAUDECODE` and the session's `CLAUDE_CODE_*` unset:

```sh
P=/tmp/claude-1000/dorothy-delivery-verify
mkdir -p "$P/xdg"
export XDG_DATA_HOME="$P/xdg" XDG_CACHE_HOME="$P/xdg"
export XDG_CONFIG_HOME="$P/xdg" XDG_STATE_HOME="$P/xdg"
unset CLAUDECODE $(env | grep -o '^CLAUDE_CODE_[A-Z_]*')
export PATH=$(echo "$PATH" | tr : '\n' | grep -v 'mise/shims' | paste -sd:)
```

The last line is the one change to the plan's snippet. Here `claude` is a
mise shim, which reads `XDG_DATA_HOME` to find its install, so with the
temporary one the shim failed ("Config files ... are not trusted") and
the dump said `claude sent no request to dump (it exited 1)`. Without
the shims directory `claude` is `/usr/bin/claude`, version 2.1.300.

### The checks

```sh
bun run check
```

Passed: lint, types and the tests, `1611 pass`, `0 fail`, 83 files.

### The dump

```sh
bun run dev -- --claude --dump-context -- hi \
    | jq -r '.system[] | .text' | grep -c '<memory>'
```

Printed `0` and no error, and stderr held no warning that the identity
marker was missing (the system text names Dorothy). It runs the real
`claude` against Dorothy's own capture stand-in, so it spent no tokens.
Run again after the fact below was written, it still printed `0`: facts
stay out of the block until Layers.

### The recall server

The plan's pipe sent all four lines at once, and the server answered id 3
(an empty `facts` group) before id 2 had written: it handles requests as
they arrive, as an MCP client that waits for each answer never exposes.
So the lines were spaced, with the data directory emptied first:

```sh
(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize",...}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}'; sleep 2
 printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":
    {"name":"remember","arguments":{"action":"write","name":"tea",
    "scope":"personal","type":"user","title":"Tea at four",
    "description":"She takes tea at four.","body":"Every day."}}}'; sleep 3
 printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":
    {"name":"search","arguments":{"query":"tea"}}}'; sleep 3) \
    | bun run dev -- --recall-server --project "$PWD"
```

(The messages are the plan's, each on one line; `...` stands for the
`initialize` params as the plan has them.) Output:

```json
{"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"memory","version":"1.0.0"}},"jsonrpc":"2.0","id":1}
{"result":{"content":[{"type":"text","text":"{\"action\":\"written\",\"id\":\"personal/tea\"}"}]},"jsonrpc":"2.0","id":2}
{"result":{"content":[{"type":"text","text":"{\"facts\":[{\"id\":\"personal/tea\",\"scope\":\"personal\",\"type\":\"user\",\"title\":\"Tea at four\",\"description\":\"She takes tea at four.\",\"origin\":\"dorothy\",\"snippet\":\"«Tea» at four\"}],\"moreFacts\":0,\"results\":[],\"more\":0}"}]},"jsonrpc":"2.0","id":3}
```

Id 2 answered `{"action":"written","id":"personal/tea"}` and id 3 held a
`facts` group with `personal/tea`, origin `dorothy`.

### The facts

```sh
bun run dev -- --facts
```

```text
dorothy: memory has no mirror · dorothy --mirror <url>
personal
  user       tea  Tea at four
             She takes tea at four.
```

### By hand

The user ran `dorothy --claude` in this repository on 2026-10-15, in a
Herdr pane the controller read without sending input:

- **No prompts.** She found an earlier conversation with `search`, then
  `open` at the matching turn, and said no permission prompt appeared.
- **remember.** Told the user is in Melbourne, she called
  `dorothy-memory`'s `remember` and saved `personal/user-in-melbourne`.
- **Found again elsewhere.** In a new Claude Code session, asked where
  the user lives, she searched and found that fact first, ahead of
  repository facts matching only on common words. The fact was not in
  the memory block, as facts reach her only through recall until
  Layers. She could not say which conversation saved it: Claude Code's
  `remember` has no `from` until Recording.
- **Auto memory off.** `/memory` showed `Auto-memory false`.

The check found the fact again from Claude Code, not from chat; chat's
`remember` and search over facts are covered by the automated tests.

She also noticed that turn times are stored in UTC while `dateCreated`
and the `after` and `before` filters use the local date, so a chat
begun just after local midnight shows turns dated the day before. That
is outside delivery and left for a follow-up.

## Known limitations

- The block is fixed for the launch: a fact written in another body
  during a long session reaches this one only through recall.
- A resumed session's conversation is not left out of the block until
  Recording, which is what records sessions to leave out.
- Facts reach the block only with Layers; until then she finds them
  through recall.
- Text injected through a page or a tool can reach a project's facts
  through `remember`, which runs without a prompt, and at the next sync
  its repository, uncommitted for the user to see in `git status` (the
  spec's Known risks).
- A resumed chat does not redraw its `remember` lines: they show as they
  happen and are not drawn again when the conversation is resumed.
- The recall server answers requests as they arrive, not in order, so a
  client that sends a `search` before the `remember` before it has
  answered may not find the fact. A client that waits for each answer, as
  Claude Code and chat do, never meets this.
