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
