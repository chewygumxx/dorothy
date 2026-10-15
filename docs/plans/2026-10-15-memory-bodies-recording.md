---
ctime: 2026-10-15
mtime: 2026-10-15
spdx: GPL-3.0-only
title: Dorothy's memory in her bodies, recording plan
description: >-
  Implementation plan for the second of the bodies spec's two plans:
  her Claude Code sessions recorded as conversations from Claude Code's
  own transcript by hooks, synced and reviewed after each reply, caught
  up at exit and at the next launch, with unreadable lines kept aside.
tags:
  - dorothy
  - memory
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-15-memory-bodies-recording.md
   -
   -->

# Dorothy's Memory in Her Bodies: Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every session in a `dorothy --claude` launch becomes one of
her conversations: hooks read Claude Code's own transcript after each
reply and at the session's end, record it under the store's lock, sync
the project and review it by chat's rule, a catch-up covers what the
hooks miss, a line the reader cannot read halts loudly and is kept
aside, and recall in Claude Code leaves the live conversation out.

**Architecture:** `memory/src/bodies/` gains a pure reader of Claude
Code's lines (`claude-code.ts`), the launch notes (`launches.ts`), the
lines kept aside and start notices (`unread.ts`), the hook's log
(`log.ts`), recording under the lock (`record.ts`) and the hook process
itself (`hook.ts`), served from a new entry point,
`@dorothy/memory/claude-hook`. The review is taken out of
`MemoryService` into a `Reviewer` both use. The index gains
`conversation_sessions` (schema 5). The CLI gives `claude` a launch id,
notes, hooks and `--session-id`, starts the catch-up, and runs
`dorothy --claude-hook` with Dorothy's own credentials.

**Tech Stack:** Bun 1.4.2 (`bun:sqlite`, `Bun.spawn`, `bun test`),
`node:child_process` for detached processes, TypeScript 7, zod 4,
`@modelcontextprotocol/sdk` 1.31, dotenvx 2, Biome 2.5, remark, Claude
Code 2.1.300.

**Spec:** `docs/specs/2026-10-15-memory-bodies-design.md` (its Recording
sections; Delivery is done, in
`docs/plans/2026-10-15-memory-bodies-delivery.md`).

## Global Constraints

- Every new file carries the house header, copied from a sibling;
  `bun run lint:header` checks the breadcrumb against the path.
- No em dash (U+2014) anywhere; Markdown lines at most 80 characters;
  Markdown links, never `[[...]]`.
- Commits in Conventional Commits, scopes the package names, `config`,
  `claude` and `api`; agent assets take `ai`; no agent trailers. A
  header is at most 50 characters, scope included, and body lines at
  most 72 (the shared commitlint config).
- No test reaches the API, runs a real `claude`, or touches
  `$XDG_DATA_HOME/dorothy`, `$XDG_CACHE_HOME/dorothy`,
  `$XDG_STATE_HOME/dorothy` or `$XDG_RUNTIME_DIR/dorothy`: every root,
  key, environment and stdin is passed in. Probes run `claude` against
  a loopback stand-in only, with a temporary `CLAUDE_CONFIG_DIR`, the
  session's `CLAUDE_CODE_*` variables and `CLAUDECODE` unset, and every
  Dorothy process given temporary XDG directories.
- A hook never blocks or fails Claude Code: `dorothy --claude-hook`
  writes nothing to the terminal in its hook and catch-up modes, always
  exits 0, and logs what went wrong to
  `$XDG_CACHE_HOME/dorothy/claude-hook.log`, which holds types, uuids
  and errors, never a transcript's text.
- Nothing secret goes in `--settings`, `--mcp-config` or a hook's
  command line: paths, a launch id, tool names and flags only. `claude`
  itself still loads no `.env`.
- A review's environment drops `ANTHROPIC_BASE_URL`,
  `ENABLE_TOOL_SEARCH`, `DOROTHY_LAUNCH`, `CLAUDECODE` and every
  `CLAUDE_CODE_*` variable it inherited, before Dorothy's own `.env` is
  loaded by explicit path from the checkout `dorothy` runs from (that
  `.env` holds Dorothy's own `CLAUDE_CODE_OAUTH_TOKEN`).
- Unreadable lines are kept under `$XDG_STATE_HOME/dorothy/unread/`,
  directory `0700`, files `0600`, never in the data directory.
- Claude Code's server is `dorothy-memory` (`CLAUDE_SERVER_NAME`); a
  call to its `search`, `open` or `tags` is a `recall` event, to its
  `remember` a tool event marked `memory: true`.
- With `[memory] enabled` false, `dorothy --claude` passes no hooks and
  writes no notes, but still starts the catch-up of launches left
  behind.
- The package graph is unchanged: `memory` depends on `core` alone; the
  CLI loads `@dorothy/memory` and `@dorothy/agent` lazily.
- Agent guides: the root `AGENTS.md` at most 100 lines, each package's
  at most 150 (`memory`'s is at 150, so detail goes in
  `src/bodies/AGENTS.md`), `docs/AGENTS.md` 60; `agents.test.ts`
  enforces them.
- Every commit passes `bun run check`.

## Review Focus

- **A plain session resumed in her launch.** `dorothy --claude --resume
  <id>` of a session she never recorded records only its lines from the
  launch's start on, and nothing before. Pinned in Task 6.
- **Two hooks of one session at once.** A `Stop` still recording when
  the next `Stop`, or the `SessionEnd` catch-up, records the same
  session: every event is appended once, in order. Pinned in Task 6.
- **A line of a shape the reader does not expect.** The lines before it
  are recorded, the rest is copied aside, the user is told at every
  start, and `--reread` takes up from that line once the reader knows
  it. Pinned in Tasks 4, 6 and 8.
- **`dorothy` killed before its catch-up.** The next `dorothy --claude`
  catches up the launch whose `dorothy` is gone, and a session no hook
  ran for is recorded and told. Pinned in Tasks 8 and 10.
- **A review never reaches the gateway or the live session.** The
  hook's environment loses the gateway's URL and `claude`'s variables
  before Dorothy's `.env` is loaded, so her own token survives. Pinned
  in Task 9.

## Rulings on the spec

Made while planning; Task 12 records them in the report and amends the
spec.

- **Launch notes live in `launches/<launch>/`** under Dorothy's runtime
  directory: `launch.json`, written once by `dorothy --claude`, and
  `sessions/<session>.json`, one per session, written by its hooks.
  The merged settings files beside them (`settings-<uuid>.json`) are
  never scanned, and no two processes rewrite one file.
- **The live session of a launch** is the one a hook noted last, else
  the session `--session-id` named.
- **`SessionEnd` hands its work** to a detached
  `dorothy --claude-hook --catch-up <launch> --session <id>`, which does
  for one session what the launch's catch-up does for all, and keeps
  the launch's notes.
- **Mapping beyond the spec's list**, from the planning survey of
  Claude Code 2.1.300's lines: a `user` line with `isCompactSummary` is
  skipped as `isMeta` is; a user text of Claude Code's command markup
  becomes the command as typed (`/compact focus`, `! ls`), and its
  output (`<local-command-stdout>`, `<bash-stdout>` and the like),
  `<task-notification>` and `[Request interrupted by user]` are
  skipped; a `queued_command` attachment is a user event only with
  `commandMode` `prompt` (task notifications use it too); an assistant
  line names its model, and the session event takes the first one that
  is not `<synthetic>`, else `unknown`.
- **A new type is kept once, not per session**: one example line per
  type in `unread/types/<type>.jsonl`, told once. A record
  `unread/<session id>.json` exists only for a halt.
- **One-shot notices** (Claude Code ran no hooks; nothing was recorded
  for want of a lock) go to `$XDG_STATE_HOME/dorothy/notices.jsonl`,
  told at the next start of either body and then cleared.
- **The idle check** after a later `Stop` looks for a main-thread
  `user`, `assistant` or `attachment` line after what it recorded;
  bookkeeping lines Claude Code appends after a reply do not count.
- **The hook's commit** is `turn: <phrase> (claude-code)`.
- **Without the index**, a hook under history's lock finds a session's
  conversation by scanning the transcripts for its session event, and
  asks for no review.
- **`--session-id`** is passed unless the arguments before `--` hold
  `-c`, `--continue`, `-r`, `--resume`, `--session-id` or `--from-pr`.
  The block leaves out the conversation of `--resume <id>`, `-r <id>`
  or `--resume=<id>` when the id is a recorded session's.
- **`listTags` sees facts** (a carry-over from delivery): a concept a
  fact carries is listed, and its tag gains `facts`, the count of live
  facts carrying it.
- **The review function is a `Reviewer`** (`memory/reviewer.ts`), which
  `MemoryService` and the hook share; claims stay with each caller.

## File Structure

- `packages/core/src/xdg.ts`, `contracts/recall.ts` and their tests:
  `XDG_STATE_HOME`, `toolOf` by server, `CLAUDE_REMEMBER_TOOL`,
  `TagObject.facts`.
- `packages/memory/src/transcript.ts`, `recall/store.ts`,
  `recall/sync.ts`, `recall/query.ts` and their tests: the stamp,
  schema 5, `sessionPhrase`, tags over facts.
- `packages/memory/src/bodies/claude-code.ts`, `launches.ts`,
  `unread.ts`, `log.ts`, `record.ts`, `hook.ts` and their tests: new.
- `packages/memory/src/bodies/fixtures.ts`: new, the reader's fixture
  lines, shaped by the probe.
- `packages/memory/src/memory/reviewer.ts`, `reviewer.test.ts`: new;
  `memory/service.ts`: uses it.
- `packages/memory/src/claude-hook.ts`, `package.json`, `src/index.ts`:
  the new entry point and exports.
- `packages/memory/src/recall/server.ts`, `memory/open.ts`,
  `history/commands.ts`, `bodies/launch.ts` and their tests.
- `packages/cli/src/claude-hook.ts`, `claude-hook.test.ts`: new;
  `claude.ts`, `index.ts` and their tests.
- `workspace.test.ts`: the new entry point.
- `test-setup.ts`: temporary state and runtime directories for every
  test; `packages/cli/src/claude-dump.test.ts`: the fake memory.
- Package `AGENTS.md` files; `docs/reports/2026-10-15-memory-bodies.md`
  and its directory; the spec.

## Branch

Work on `feat/memory-recording`, made from `main` after delivery
merged; this plan is its first commit
(`docs: Plan the recording of her Claude Code`).

---

### Task 1: The probes

Fixes how Claude Code writes, resumes and ends sessions, and what its
hooks and servers inherit, before code depends on it. Spends no tokens:
a loopback stand-in answers, and `claude` runs on a temporary config
directory.

**Files:**

- Modify: `docs/reports/2026-10-15-memory-bodies.md`
- Create: `docs/reports/2026-10-15-memory-bodies/lines.json`,
  `resume.json`, `hooks.json`, `inherit.json`

**Interfaces:**

- Produces: the decisions in Step 8, which Tasks 4, 6, 8 and 10 follow.

- [ ] **Step 1: The stand-in, outside the repository**

`P=/tmp/claude-1000/dorothy-recording-probe` throughout. `$P/standin.ts`:

```ts
// Records each POST .../messages body, never a header. A request whose
// last user message asks for tools, with no tool result yet, is answered
// with text and two calls in one message, Bash and Agent; a compaction
// request with a summary; any other with "done".
const out = process.argv[2] ?? "/tmp/claude-1000/dorothy-recording-probe/out";
let count = 0;
const sse = (events: object[]) =>
    new Response(
        events
            .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
            .join(""),
        { headers: { "content-type": "text/event-stream" } },
    );
const start = {
    type: "message_start",
    message: {
        id: `msg_probe_${Date.now()}`, type: "message", role: "assistant",
        model: "claude-probe", content: [], stop_reason: null,
        stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    },
};
const end = (reason: string) => [
    { type: "message_delta", delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
];
const text = (index: number, words: string) => [
    { type: "content_block_start", index, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index, delta: { type: "text_delta", text: words } },
    { type: "content_block_stop", index },
];
const call = (index: number, id: string, name: string, input: object) => [
    { type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } },
    { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
    { type: "content_block_stop", index },
];
const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
        const { pathname } = new URL(request.url);
        if (request.method !== "POST" || !pathname.endsWith("/messages")) {
            return Response.json({});
        }
        count += 1;
        const body = (await request.json().catch(() => ({}))) as {
            messages?: { content?: unknown }[];
        };
        await Bun.write(`${out}/request-${count}.json`, JSON.stringify(body));
        const last = JSON.stringify(body.messages?.at(-1) ?? {});
        if (last.includes("use tools") && !last.includes("tool_result")) {
            return sse([
                start,
                ...text(0, "Calling."),
                ...call(1, `toolu_b${count}`, "Bash", { command: "echo probe", description: "probe" }),
                ...call(2, `toolu_a${count}`, "Agent", { description: "probe", prompt: "say done", subagent_type: "general-purpose" }),
                ...end("tool_use"),
            ]);
        }
        if (/summar/i.test(last)) {
            return sse([start, ...text(0, "<summary>Probe summary.</summary>"), ...end("end_turn")]);
        }
        return sse([start, ...text(0, "done"), ...end("end_turn")]);
    },
});
console.log(server.port);
```

- [ ] **Step 2: A temporary Claude Code and a runner**

`$P/setup.sh` makes the config directory `claude` runs on, trusting the
probe's directory and accepting the stand-in's fake key, so no
onboarding screen or prompt appears:

```sh
#!/usr/bin/env bash
set -eu
P=/tmp/claude-1000/dorothy-recording-probe
rm -rf "$P/cfg" "$P/cwd" "$P/xdg"
mkdir -p "$P/cfg" "$P/cwd/.claude" "$P/xdg" "$P/out"
KEY=sk-ant-probe-000000000000000000000000000000
jq -n --arg cwd "$P/cwd" --arg tail "${KEY: -20}" '{
    hasCompletedOnboarding: true, theme: "dark",
    projects: {($cwd): {hasTrustDialogAccepted: true,
                        hasCompletedProjectOnboarding: true}},
    customApiKeyResponses: {approved: [$tail], rejected: []}}' \
    >"$P/cfg/.claude.json"
echo "$KEY" >"$P/key"
```

`$P/run.sh` runs `claude` in print mode against the stand-in, the
session's variables unset:

```sh
#!/usr/bin/env bash
# run.sh <outdir> <claude args...>
set -u
P=/tmp/claude-1000/dorothy-recording-probe
out=$1; shift
mkdir -p "$out"
bun "$P/standin.ts" "$out" >"$P/port" &
pid=$!
sleep 1
unset CLAUDECODE $(env | grep -o '^CLAUDE_CODE_[A-Z_]*')
(cd "$P/cwd" &&
    CLAUDE_CONFIG_DIR="$P/cfg" ANTHROPIC_API_KEY="$(cat "$P/key")" \
        ANTHROPIC_BASE_URL="http://127.0.0.1:$(cat "$P/port")" \
        DOROTHY_LAUNCH=probe-launch ENABLE_TOOL_SEARCH=0 \
        timeout 120 claude -p "$@") \
    >"$out/stdout.txt" 2>"$out/stderr.txt" || true
kill "$pid"
```

`$P/tty.sh` runs it interactively under a pseudo-terminal, typing what
`$P/keys-<name>.sh` prints on its stdout, with pauses:

```sh
#!/usr/bin/env bash
# tty.sh <name> <claude args...>: keys from keys-<name>.sh; the
# terminal's own record in out-<name>/typescript.
set -u
P=/tmp/claude-1000/dorothy-recording-probe
name=$1; shift
out="$P/out-$name"
mkdir -p "$out"
bun "$P/standin.ts" "$out" >"$P/port" &
pid=$!
sleep 1
unset CLAUDECODE $(env | grep -o '^CLAUDE_CODE_[A-Z_]*')
cmd="cd $P/cwd && CLAUDE_CONFIG_DIR=$P/cfg ANTHROPIC_API_KEY=$(cat "$P/key") \
ANTHROPIC_BASE_URL=http://127.0.0.1:$(cat "$P/port") \
DOROTHY_LAUNCH=probe-launch ENABLE_TOOL_SEARCH=0 claude $*"
bash "$P/keys-$name.sh" | timeout 120 script -qfec "$cmd" "$out/typescript" || true
kill "$pid"
```

Each `keys-<name>.sh` sleeps, prints keys, and ends by sleeping long
enough for `claude` to exit; `\r` is Enter and `\x04` is Ctrl-D:

```sh
# keys-clear.sh: a reply, /clear, a reply, Ctrl-D twice.
sleep 4; printf 'hi\r'; sleep 4; printf '/clear\r'; sleep 3
printf 'again\r'; sleep 4; printf '\x04'; sleep 1; printf '\x04'; sleep 6
```

```sh
# keys-exit.sh: a reply, then /exit.
sleep 4; printf 'hi\r'; sleep 4; printf '/exit\r'; sleep 6
```

```sh
# keys-kill.sh: a reply, then the terminal goes: script is hung up.
sleep 4; printf 'hi\r'; sleep 4
pkill -HUP -f "script -qfec cd /tmp/claude-1000/dorothy-recording-probe"; sleep 6
```

If the screen in `typescript` shows a prompt the keys do not answer
(an onboarding step, a trust or key question), add the key it needs
to `setup.sh`'s `.claude.json` or to the keys, and run again; record
the change in the report.

- [ ] **Step 3: The hooks and the server that report what they see**

`$P/hook.sh`, the stand-in for `dorothy --claude-hook`: it appends the
event, the reason, the session, the transcript's name and whether
`DOROTHY_LAUNCH` reached it, and on `SessionEnd` starts a detached
process that writes once the teardown is over:

```sh
#!/usr/bin/env bash
P=/tmp/claude-1000/dorothy-recording-probe
input=$(cat)
started=$(date +%s.%N)
[ "$1" = slow ] && sleep 5
jq -c --arg who "$1" --arg launch "${DOROTHY_LAUNCH:-}" --arg t "$started" \
    '{who: $who, event: .hook_event_name, reason: (.reason // null),
      session: .session_id, transcript: (.transcript_path | split("/") | .[-1]),
      launch: $launch, at: $t}' <<<"$input" >>"$P/hooks.log"
if [ "$(jq -r .hook_event_name <<<"$input")" = SessionEnd ]; then
    bun "$P/detach.ts"
fi
```

`$P/detach.ts`, started from the `SessionEnd` hook as Task 8 starts
its catch-up, writes once the hook and `claude` are gone:

```ts
import { spawn } from "node:child_process";
spawn(
    "bash",
    ["-c", `sleep 3; echo '{"survived":true}' >>/tmp/claude-1000/dorothy-recording-probe/hooks.log`],
    { detached: true, stdio: "ignore" },
).unref();
```

`$P/server.ts`, a stdio MCP server that records its environment and
serves nothing:

```ts
await Bun.write(
    "/tmp/claude-1000/dorothy-recording-probe/server-env.json",
    JSON.stringify({ launch: process.env.DOROTHY_LAUNCH ?? null }),
);
for await (const _ of process.stdin) {
    // Claude Code gives up on a server that never answers; that is fine.
}
```

Dorothy's settings, and a project's own Stop hook beside them:

```sh
P=/tmp/claude-1000/dorothy-recording-probe
chmod +x "$P"/*.sh
jq -nc --arg h "$P/hook.sh" '{hooks: {
    Stop: [{hooks: [{type: "command", command: "\($h) slow", async: true}]}],
    SessionEnd: [{hooks: [{type: "command", command: "\($h) end", timeout: 10}]}]}}' \
    >"$P/settings.json"
jq -nc --arg h "$P/hook.sh" '{hooks: {
    Stop: [{hooks: [{type: "command", command: "\($h) project"}]}]}}' \
    >"$P/cwd/.claude/settings.json"
jq -nc --arg s "$P/server.ts" --arg bun "$(command -v bun)" \
    '{mcpServers: {"dorothy-memory": {type: "stdio", command: $bun, args: [$s]}}}' \
    >"$P/mcp.json"
```

- [ ] **Step 4: Run them**

```sh
P=/tmp/claude-1000/dorothy-recording-probe
bash "$P/setup.sh" && bash "$P/hooks-setup.sh" && : >"$P/hooks.log"
S=$(cat /proc/sys/kernel/random/uuid)
FLAGS=(--settings="$(cat "$P/settings.json")" --mcp-config="$P/mcp.json"
       --allowedTools=Bash,Agent)
time "$P/run.sh" "$P/out/new" "${FLAGS[@]}" --session-id="$S" "use tools"
"$P/run.sh" "$P/out/resume" "${FLAGS[@]}" --resume "$S" "and more"
"$P/run.sh" "$P/out/continue" "${FLAGS[@]}" --continue "once more"
"$P/run.sh" "$P/out/fork" "${FLAGS[@]}" --resume "$S" --fork-session "forked"
"$P/run.sh" "$P/out/compact" "${FLAGS[@]}" --resume "$S" "/compact"
echo "$S" >"$P/session"
for name in clear exit kill; do
    "$P/tty.sh" "$name" "--settings=$(cat "$P/settings.json")"
    sleep 5
done
```

(`hooks-setup.sh` is the last block of Step 3, saved as a file; it runs
after `setup.sh`, which empties the probe's directory.)

Expected: `time` for the first run well under the slow hook's 5
seconds plus the reply, `$P/cfg/projects/*/` holding the sessions'
transcripts, and `$P/hooks.log` holding lines from both `who: slow`
and `who: project`.

- [ ] **Step 5: Summarise, without anything personal**

Each summary keeps types, keys, counts, flags and names of files, never
text:

```sh
P=/tmp/claude-1000/dorothy-recording-probe
D=docs/reports/2026-10-15-memory-bodies
S=$(cat "$P/session")
T=$(dirname "$(ls "$P"/cfg/projects/*/"$S".jsonl)")
# Probe 1: every line's type, subtype, flags and keys, and the content
# blocks of user and assistant lines.
cat "$T"/*.jsonl | jq -sc '
  [.[] | {type, sub: (.subtype // .attachment.type // null),
          mode: (.attachment.commandMode // null),
          uuid: has("uuid"), meta: (.isMeta // false),
          side: (.isSidechain // false), compact: (.isCompactSummary // false),
          blocks: (if (.message.content | type) == "array"
                   then [.message.content[].type] else (.message.content | type) end),
          keys: keys}]
  | group_by([.type, .sub, .mode, .uuid, .meta, .side, .compact, .blocks])
  | map(.[0] + {count: length})' >"$D/lines.json"
ls "$T" "$T/$S" 2>/dev/null | jq -Rsc 'split("\n") | map(select(. != ""))' \
  >"$P/listing.json"
# Probe 2: which files each run wrote, the sessions each names, and
# uuids repeated across files.
for f in "$T"/*.jsonl; do
  jq -sc --arg f "$(basename "$f")" '{file: $f, lines: length,
      sessions: ([.[].sessionId // empty] | unique),
      uuids: [.[].uuid // empty]}' "$f"
done | jq -sc --slurpfile listing "$P/listing.json" --arg s "$S" '{
  first: $s, listing: $listing[0],
  files: map({file, lines, sessions, uuidCount: (.uuids | length)}),
  repeated: ([.[].uuids[]] | group_by(.) | map(select(length > 1)) | length)}' \
  >"$D/resume.json"
# Probe 3: the hooks that ran, in order, and each survival.
jq -sc '{hooks: map(del(.at))}' "$P/hooks.log" >"$D/hooks.json"
# Probe 4: what the server and the hooks saw of DOROTHY_LAUNCH ("" for
# nothing).
jq -sc '{server: .[0], hooks: ([.[1][] | select(.event) | .launch] | unique)}' \
  "$P/server-env.json" <(jq -s . "$P/hooks.log") >"$D/inherit.json"
cat "$D"/{lines,resume,hooks,inherit}.json | head -c 4000
grep -c 'chewygumxx\|/home/' "$D"/{lines,resume,hooks,inherit}.json || true
```

Expected: the last command prints `0` for each file. The `who: slow`
lines' `at` was dropped; note in the report how long the first run took
against the slow hook's 5 seconds.

- [ ] **Step 6: Survey the user's recent transcripts, types only**

The planning survey below was taken from the user's own Claude Code
transcripts of the last 30 days, types and subtypes alone. Take it
again, the same way, and record the counts in the report beside
`lines.json`; never print anything but these three fields:

```sh
cd "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects" &&
find . -name '*.jsonl' -mtime -30 -not -path '*/subagents/*' -print0 |
xargs -0 cat | jq -c -R 'fromjson? | select(.type) | [.type,
    (if .type == "system" then .subtype elif .type == "attachment"
     then .attachment.type else null end), has("uuid")]' |
sort | uniq -c | sort -rn
```

Planning found these types without a `uuid`, all bookkeeping:
`last-prompt`, `atis-latch`, `mode`, `ai-title`, `permission-mode`,
`agent-name`, `queue-operation`, `file-history-delta`,
`file-history-snapshot`, `relocated`, `pr-link`, `custom-title`,
`cost-state`, `api-request-blob`, `api-request`, `api-request-shape`,
`agent-setting`, `continued-in`, `worktree-state`; with one, `user`,
`assistant`, `attachment` (some forty subtypes, of which only
`queued_command` with `commandMode: "prompt"` carries the user's
words) and `system` (`turn_duration`, `stop_hook_summary`,
`compact_boundary`, `local_command`, `informational`,
`scheduled_task_fire`, `permission_retry`). Assistant lines held one
content block each.

- [ ] **Step 7: Begin the report's recording part**

In `docs/reports/2026-10-15-memory-bodies.md`, after the Delivery
probes, add:

```markdown
## Recording probes

### Claude Code's lines

Command: Steps 1 to 5 of the recording plan's Task 1, and Step 6's
survey of the user's own transcripts, types only.
Output: [lines.json](./2026-10-15-memory-bodies/lines.json).

<the types, subtypes and flags found, the blocks per line, and how the
survey compares with the plan's list>

### Resuming

Command: Step 4's resume, continue, fork and compact runs, and the
clear run.
Output: [resume.json](./2026-10-15-memory-bodies/resume.json).

<whether --resume and --continue keep the session's id and file,
whether a fork repeats uuids, and what /clear did>

### Hooks

Command: Step 4's runs.
Output: [hooks.json](./2026-10-15-memory-bodies/hooks.json).

<whether Dorothy's hooks ran beside the project's, whether the async
Stop held the reply, which exits ran SessionEnd and with what reason,
and whether the detached process survived>

### What hooks and servers inherit

Output: [inherit.json](./2026-10-15-memory-bodies/inherit.json).

<whether DOROTHY_LAUNCH reached the hooks and the server>
```

Fill each `<...>` with what the JSON shows, and the decisions taken.

- [ ] **Step 8: Decide**

- **Lines.** Every type `lines.json` or the survey shows without a
  uuid, and not in Task 4's `BOOKKEEPING`, joins it there, provided it
  carries no conversation; a type with a uuid that is not `user`,
  `assistant`, `attachment` or `system` is reported to the user before
  Task 4: the mapping needs revising. An `attachment` subtype other than
  `queued_command` that carries the user's words joins Task 4's
  `spokenAttachment`.
- **Resuming.** If `resume.json` shows `--resume` and `--continue`
  appending to the first session's file under its id, Task 6 stands as
  written. If they write a new file under a new id whose repeated lines
  name the first session in `sessionId`, Task 6's lookup by the lines'
  `sessionId`s finds the conversation: it stands as written. If the
  repeated lines name only the new id, stop and report to the user: the
  spec's resume rule needs revising.
- **/clear** starting a new session id under the same launch is
  expected; if it reuses the id, note it: the session continues its
  conversation, and nothing changes.
- **Hooks.** Dorothy's `Stop` and the project's both ran: hooks from
  `--settings` add to the user's own, and Task 10's merge stands. If
  only one ran, stop and report. If the first run took 5 seconds more
  than the others, `async` does not keep the hook off the reply: stop
  and report.
- **SessionEnd.** Record which of `/clear`, Ctrl-D, `/exit` and the
  hung-up terminal ran it and its `reason`; the catch-up covers the
  rest, and Task 12's report says so. `survived` after each
  `SessionEnd`: Task 8's detached `spawn` stands. If it is missing, Task
  8 starts the catch-up through `setsid -f` instead (`spawnDetached`
  takes `["setsid", "-f", ...cmd]`).
- **Inheriting.** `inherit.json`'s `server.launch` and `hooks` both
  `probe-launch`: Task 10 passes `DOROTHY_LAUNCH` in the environment
  alone. If either is missing, Task 10 also passes `--launch <id>` in
  that one's command (the recall server's `args`, or the hook's command
  line), and Tasks 8 and 11 read the flag before the variable.

- [ ] **Step 9: Commit**

```bash
git add docs/reports/2026-10-15-memory-bodies.md docs/reports/2026-10-15-memory-bodies
git commit -m "docs: Probe Claude Code for recording"
```

---

### Task 2: Core's names for recording

**Files:**

- Modify: `packages/core/src/xdg.ts`, `session-id.ts`,
  `contracts/recall.ts`
- Test: `packages/core/src/xdg.test.ts`, `session-id.test.ts`,
  `contracts/recall.test.ts`

**Interfaces:**

- Produces (all from `@dorothy/core`):
  - `xdgDir(env, "XDG_STATE_HOME", ".local/state")` is accepted.
  - `isUuid(value: string): boolean`.
  - `toolOf(name: string, server: string = SERVER_NAME): Tool | null`.
  - `CLAUDE_REMEMBER_TOOL = "mcp__dorothy-memory__remember"`.
  - `TagObject.facts?: number`.

- [ ] **Step 1: Write the failing tests**

In `xdg.test.ts`, beside the existing cases:

```ts
it("takes the state directory, falling back under HOME", () => {
    expect(xdgDir({ XDG_STATE_HOME: "/s" }, "XDG_STATE_HOME", ".local/state")).toBe("/s");
    expect(xdgDir({ HOME: "/h" }, "XDG_STATE_HOME", ".local/state")).toBe("/h/.local/state");
});
```

In `session-id.test.ts`:

```ts
describe("isUuid", () => {
    it("takes a uuid in either case and nothing path-like", () => {
        expect(isUuid("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(true);
        expect(isUuid("0F8FAD5B-D9CB-469F-A165-70867728950E")).toBe(true);
        expect(isUuid("../0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(false);
        expect(isUuid("0f8fad5b-d9cb-469f-a165-70867728950")).toBe(false);
        expect(isUuid("")).toBe(false);
    });
});
```

In `recall.test.ts`'s `toolOf` block:

```ts
it("names a lookup on another server when asked", () => {
    expect(toolOf("mcp__dorothy-memory__search", CLAUDE_SERVER_NAME)).toBe("search");
    expect(toolOf("mcp__dorothy-memory__search")).toBeNull();
    expect(toolOf("mcp__memory__search", CLAUDE_SERVER_NAME)).toBeNull();
    expect(toolOf(CLAUDE_REMEMBER_TOOL, CLAUDE_SERVER_NAME)).toBeNull();
    expect(CLAUDE_REMEMBER_TOOL).toBe("mcp__dorothy-memory__remember");
});
```

(Import `CLAUDE_REMEMBER_TOOL`, `CLAUDE_SERVER_NAME` and `isUuid` where
the files import from.)

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/core`
Expected: FAIL (`isUuid` and `CLAUDE_REMEMBER_TOOL` are not exported;
the state directory is not a variable `xdgDir` takes).

- [ ] **Step 3: Implement**

`xdg.ts`: the variable's type becomes
`"XDG_DATA_HOME" | "XDG_CONFIG_HOME" | "XDG_CACHE_HOME" | "XDG_STATE_HOME"`.

`session-id.ts`, after `isPhrase`:

```ts
// Guards a launch's or a Claude Code session's id, which becomes a file
// name: only a uuid passes.
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
    return UUID.test(value);
}
```

`contracts/recall.ts`: after `REMEMBER_TOOL`, add
`export const CLAUDE_REMEMBER_TOOL = named(CLAUDE_SERVER_NAME, REMEMBER);`,
remove `PREFIX`, and make `toolOf`:

```ts
// A lookup's name as the model calls it on a server, chat's unless
// another is named, or null for any other tool, remember among them.
export function toolOf(name: string, server: string = SERVER_NAME): Tool | null {
    const prefix = `mcp__${server}__`;
    const tool = name.startsWith(prefix) ? name.slice(prefix.length) : "";
    return (TOOLS as readonly string[]).includes(tool) ? (tool as Tool) : null;
}
```

`TagObject` gains, after `conversations: number;`:

```ts
    // The facts that carry it, when any do.
    facts?: number;
```

- [ ] **Step 4: Run the tests**

Run: `bun test packages/core && bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): Name what recording needs"
```

---

### Task 3: Stamped events, schema 5 and tags over facts

**Files:**

- Modify: `packages/memory/src/transcript.ts`, `recall/store.ts`,
  `recall/sync.ts`, `recall/query.ts`
- Test: `packages/memory/src/transcript.test.ts`,
  `recall/store.test.ts`, `recall/sync.test.ts`,
  `recall/query.test.ts`

**Interfaces:**

- Consumes: `TagObject.facts` (Task 2).
- Produces:
  - `type Stamp = { at?: string; sourceUuid?: string }`;
    `TranscriptWriter.append(entry, stamp?: Stamp)`.
  - `SCHEMA_VERSION = 5`; table `conversation_sessions (session TEXT
    PRIMARY KEY, phrase TEXT NOT NULL)`.
  - `sessionPhrase(index: RecallIndex, session: string): string | null`
    in `recall/sync.ts`, a plain read, callable inside `exclusive`.
  - `listTags` lists a concept any fact carries, with `facts`.

- [ ] **Step 1: Write the failing tests**

`transcript.test.ts`, beside the `TranscriptWriter` tests (use the
file's temporary directory helper):

```ts
it("takes an event's own time and source uuid where given", async () => {
    const path = join(dir, "stamped.jsonl");
    const writer = await TranscriptWriter.open(path, () => new Date("2026-10-15T10:00:00.000Z"));
    await writer.append({ kind: "user", text: "hi" }, { at: "2026-10-15T09:00:00.000Z", sourceUuid: "u-1" });
    await writer.append({ kind: "user", text: "now" });
    await writer.close();
    const [first, second] = (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(first).toEqual({ v: 1, kind: "user", at: "2026-10-15T09:00:00.000Z", text: "hi", sourceUuid: "u-1" });
    expect(second).toEqual({ v: 1, kind: "user", at: "2026-10-15T10:00:00.000Z", text: "now" });
});
```

`store.test.ts`: the pinned version (line 91) becomes `5`, and:

```ts
it("keeps each body's session with its conversation", () => {
    const index = RecallIndex.open(join(dir, "recall.sqlite"));
    index.db.run("INSERT INTO conversation_sessions (session, phrase) VALUES (?, ?)", ["s-1", "a-b-c-d"]);
    expect(() =>
        index.db.run("INSERT INTO conversation_sessions (session, phrase) VALUES (?, ?)", ["s-1", "e-f-g-h"]),
    ).toThrow();
    index.close();
});
```

(Use the file's own directory variable and helpers if they are named
otherwise.)

`sync.test.ts`, with the file's helpers for writing a transcript and
syncing:

```ts
describe("conversation_sessions", () => {
    it("is filled from session events naming a body's session, and forgotten with them", async () => {
        await writeTranscript(A, [
            { v: 1, kind: "session", at: AT, phrase: A, sdkSessionId: "", model: "m", promptHash: "", resumed: false, source: "claude-code", sourceSession: "s-1" },
            { v: 1, kind: "user", at: AT, text: "hi" },
            { v: 1, kind: "session", at: AT, phrase: A, sdkSessionId: "", model: "m", promptHash: "", resumed: true, source: "claude-code", sourceSession: "s-2" },
        ]);
        await syncIndex(index, dir);
        expect(sessionPhrase(index, "s-1")).toBe(A);
        expect(sessionPhrase(index, "s-2")).toBe(A);
        expect(sessionPhrase(index, "s-3")).toBeNull();
        await rm(join(dir, `${A}.jsonl`));
        await syncIndex(index, dir);
        expect(sessionPhrase(index, "s-1")).toBeNull();
    });
});
```

If `sync.test.ts` names its helpers otherwise, write the transcript
with `writeFile(join(dir, `${A}.jsonl`), lines.map(...).join("\n") +
"\n")` and an `AT` of its own.

`query.test.ts`, inside `describe("search by a tag facts carry")`
(import `listTags`):

```ts
    it("lists a tag a fact carries, though only hidden conversations do besides", async () => {
        await putFact(dir, PERSONAL, fact("poem", { tags: ["k00000002"] }));
        await syncIndex(index, dir, Date.parse(day(20)), join(dir, "tags.json"), dir);
        const tags = listTags(index, {}, withProject).results;
        expect(tags.map((tag) => [tag.name, tag.conversations, tag.facts])).toEqual([
            ["drinks", 0, 1],
            ["secret", 0, 1],
        ]);
    });
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/memory/src/transcript.test.ts packages/memory/src/recall`
Expected: FAIL (no stamp; schema 4; `sessionPhrase` not exported;
`secret` not listed).

- [ ] **Step 3: The stamp**

In `transcript.ts`, before `TranscriptWriter`:

```ts
// An event's own time, where it is not the moment it is written, and
// the uuid of the Claude Code line it was recorded from, by which the
// next reading knows where to take up.
export type Stamp = { at?: string; sourceUuid?: string };
```

and `append` becomes:

```ts
    append(entry: TranscriptEntry, stamp: Stamp = {}): Promise<void> {
        const { kind, ...fields } = entry;
        const event = {
            v: 1,
            kind,
            at: stamp.at ?? this.#now().toISOString(),
            ...fields,
            ...(stamp.sourceUuid === undefined
                ? {}
                : { sourceUuid: stamp.sourceUuid }),
        };
```

with the rest of the method unchanged.

- [ ] **Step 4: Schema 5**

In `recall/store.ts`, `SCHEMA_VERSION = 5`, and after the `claims`
table:

```ts
    // Each body's session id a conversation's session events name, so a
    // hook finds its conversation without reading every transcript.
    `CREATE TABLE conversation_sessions (
        session TEXT PRIMARY KEY,
        phrase TEXT NOT NULL
    )`,
```

In `recall/sync.ts`, `forget` gains
`"DELETE FROM conversation_sessions WHERE phrase = ?",` before the
conversations' row; `applyLines`'s session branch, before
`row.sessions++`:

```ts
            if (isRecord(event) && typeof event.sourceSession === "string") {
                index.db.run(
                    "INSERT OR IGNORE INTO conversation_sessions (session, phrase) VALUES (?, ?)",
                    [event.sourceSession, row.phrase],
                );
            }
```

and at the end of the file:

```ts
// The conversation a body's session belongs to, as its session events
// say; null for a session never recorded. A plain read, so callable
// inside exclusive.
export function sessionPhrase(
    index: RecallIndex,
    session: string,
): string | null {
    const row = index.db
        .query("SELECT phrase FROM conversation_sessions WHERE session = ?")
        .get(session) as { phrase: string } | null;
    return row?.phrase ?? null;
}
```

- [ ] **Step 5: Tags over facts**

In `recall/query.ts`'s `listTags`, import `factCarriers` beside
`listedConcepts` if it is not imported, and replace
`const listed = listedConcepts(index, exclude, rows);` with:

```ts
    // A concept a fact carries is hers to see, as search finds it, and
    // its tag counts the facts.
    const factCount = new Map<string, number>();
    for (const row of factCarriers(index)) {
        factCount.set(row.id, (factCount.get(row.id) ?? 0) + 1);
    }
    const listed = new Set([
        ...listedConcepts(index, exclude, rows),
        ...factCount.keys(),
    ]);
```

and in the returned `TagObject`, after `conversations: phrases.length,`:

```ts
                ...(factCount.has(c.id)
                    ? { facts: factCount.get(c.id) as number }
                    : {}),
```

`factCarriers` follows `broader`, so a fact's narrower concept counts
toward its broader ones, as conversations' do in search. If an existing
`tags.test.ts` expectation now shows a fact-carried tag it did not
before, the fixture carries a fact: add the `facts` field to the
expectation.

- [ ] **Step 6: Run the tests**

Run: `bun test packages/memory`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/memory
git commit -m "feat(memory): Stamp events and index body sessions"
```

---

### Task 4: The reader of Claude Code's lines

Pure: lines in, events out. The hook (Task 6) reads files and appends.

**Files:**

- Create: `packages/memory/src/bodies/claude-code.ts`,
  `claude-code.test.ts`, `fixtures.ts`

**Interfaces:**

- Consumes: `toolOf(name, CLAUDE_SERVER_NAME)`, `CLAUDE_REMEMBER_TOOL`
  (Task 2); `describeLookup` (core); `toolEntry`, `TranscriptEntry`
  (`transcript.ts`).
- Produces:
  - `readLines(lines: readonly string[], options?: ReadOptions):
    LinesRead`, with `ReadOptions = { ended?: boolean; recorded?:
    ReadonlySet<string>; since?: number | null }` and `LinesRead = {
    events: ReadEvent[]; model: string | null; sessions: string[];
    halt: Halt | null; unknown: Unknown[] }`.
  - `ReadEvent = { entry: TranscriptEntry; uuid: string; at: string }`;
    `Halt = { line: number; type: string | null; uuid: string | null;
    reason: string }`; `Unknown = { line: number; type: string }`;
    `line` is an index into the lines given.
  - `BOOKKEEPING: ReadonlySet<string>`, `spoken(text): string | null`.
  - From `fixtures.ts`: `SESSION`, `at(minute)`, `userLine`,
    `assistantLine`, `text`, `use`, `result`, `queued`, `meta`.

- [ ] **Step 1: The fixtures**

`packages/memory/src/bodies/fixtures.ts` (header copied from a
sibling), shaped as the probe's `lines.json` shows Claude Code 2.1.300
writing them; if the probe showed a key the reader reads under another
name, use the probe's:

```ts
// Claude Code's transcript lines as the recording probe found them, for
// the reader's and the hook's tests. Only the keys the reader looks at,
// and the ones that tell a line apart, are filled.

export const SESSION = "0f8fad5b-d9cb-469f-a165-70867728950e";
export const at = (minute: number) =>
    new Date(Date.UTC(2026, 9, 15, 9, minute)).toISOString();

type Fields = Record<string, unknown>;
const base = (type: string, uuid: string, minute: number, fields: Fields) =>
    JSON.stringify({
        type,
        uuid,
        parentUuid: null,
        isSidechain: false,
        sessionId: SESSION,
        timestamp: at(minute),
        cwd: "/work",
        version: "2.1.300",
        ...fields,
    });

export const text = (words: string) => ({ type: "text", text: words });
export const use = (id: string, name: string, input: unknown = {}) => ({
    type: "tool_use",
    id,
    name,
    input,
});
export const result = (id: string, content: unknown, isError = false) => ({
    type: "tool_result",
    tool_use_id: id,
    content,
    ...(isError ? { is_error: true } : {}),
});

export const userLine = (
    uuid: string,
    minute: number,
    content: unknown,
    fields: Fields = {},
) => base("user", uuid, minute, { message: { role: "user", content }, ...fields });

export const assistantLine = (
    uuid: string,
    minute: number,
    content: unknown[],
    fields: Fields = {},
) =>
    base("assistant", uuid, minute, {
        message: { role: "assistant", model: "claude-opus-5-5", content },
        ...fields,
    });

export const queued = (uuid: string, minute: number, prompt: unknown, mode = "prompt") =>
    base("attachment", uuid, minute, {
        attachment: { type: "queued_command", prompt, commandMode: mode },
    });

// A bookkeeping line, as most of Claude Code's are: a type, no uuid.
export const meta = (type: string, fields: Fields = {}) =>
    JSON.stringify({ type, sessionId: SESSION, ...fields });
```

- [ ] **Step 2: Write the failing tests**

`packages/memory/src/bodies/claude-code.test.ts` (header copied):

```ts
import { describe, expect, it } from "bun:test";
import { type ReadOptions, readLines, spoken } from "./claude-code.js";
import {
    assistantLine,
    at,
    meta,
    queued,
    result,
    SESSION,
    text,
    use,
    userLine,
} from "./fixtures.js";

const entries = (lines: string[], options: ReadOptions = {}) =>
    readLines(lines, options).events.map((event) => event.entry);

describe("readLines", () => {
    it("maps the user and her replies, each with its line's uuid and time", () => {
        const read = readLines([
            userLine("u1", 0, "hello"),
            assistantLine("a1", 1, [text("Hi.")]),
        ]);
        expect(read.events).toEqual([
            { entry: { kind: "user", text: "hello" }, uuid: "u1", at: at(0) },
            { entry: { kind: "assistant", text: "Hi.", interrupted: false }, uuid: "a1", at: at(1) },
        ]);
        expect(read.model).toBe("claude-opus-5-5");
        expect(read.sessions).toEqual([SESSION]);
        expect(read.halt).toBeNull();
    });

    it("maps several blocks in a line in order, and keeps no thinking", () => {
        expect(
            entries([
                assistantLine("a1", 1, [
                    { type: "thinking", thinking: "hmm", signature: "x" },
                    text("One."),
                    text("Two."),
                ]),
            ]),
        ).toEqual([
            { kind: "assistant", text: "One.", interrupted: false },
            { kind: "assistant", text: "Two.", interrupted: false },
        ]);
    });

    it("makes a call and its later result one tool event, at the call's line", () => {
        const read = readLines([
            assistantLine("a1", 1, [use("t1", "Bash", { command: "ls" })]),
            meta("mode"),
            userLine("r1", 2, [result("t1", "a\nb")]),
            assistantLine("a2", 3, [use("t2", "Read", { file_path: "/x" })]),
            userLine("r2", 4, [result("t2", [text("no such file")], true)]),
        ]);
        expect(read.events).toEqual([
            {
                entry: { kind: "tool", name: "Bash", input: '{"command":"ls"}', output: "a\nb", ok: true, cut: { input: 0, output: 0 } },
                uuid: "a1",
                at: at(1),
            },
            {
                entry: { kind: "tool", name: "Read", input: '{"file_path":"/x"}', output: "no such file", ok: false, cut: { input: 0, output: 0 } },
                uuid: "a2",
                at: at(3),
            },
        ]);
    });

    it("records her lookups as recall events and her remember as her own", () => {
        const found = JSON.stringify({ facts: [], moreFacts: 0, results: [{ identifier: "x" }], more: 2 });
        expect(
            entries([
                assistantLine("a1", 1, [use("t1", "mcp__dorothy-memory__search", { query: "tea" })]),
                userLine("r1", 2, [result("t1", [text(found)])]),
                assistantLine("a2", 3, [use("t2", "mcp__dorothy-memory__remember", { action: "write", name: "tea" })]),
                userLine("r2", 4, [result("t2", '{"action":"written","id":"personal/tea"}')]),
            ]),
        ).toEqual([
            { kind: "recall", id: "t1", ok: true, offset: 0, tool: "search", query: "tea", hits: 3, facts: 0 },
            {
                kind: "tool",
                name: "mcp__dorothy-memory__remember",
                input: '{"action":"write","name":"tea"}',
                output: '{"action":"written","id":"personal/tea"}',
                ok: true,
                cut: { input: 0, output: 0 },
                memory: true,
            },
        ]);
    });

    it("keeps a subagent as its call, prompt and result", () => {
        expect(
            entries([
                assistantLine("a1", 1, [use("t1", "Agent", { description: "d", prompt: "look" })]),
                userLine("s1", 2, "inside", { isSidechain: true }),
                userLine("r1", 3, [result("t1", [text("found it")])]),
            ]),
        ).toEqual([
            {
                kind: "tool",
                name: "Agent",
                input: '{"description":"d","prompt":"look"}',
                output: "found it",
                ok: true,
                cut: { input: 0, output: 0 },
            },
        ]);
    });

    it("holds back from a call not yet answered, and records it failed once the session ends", () => {
        const lines = [
            userLine("u1", 0, "go"),
            assistantLine("a1", 1, [text("Running."), use("t1", "Bash", { command: "sleep" })]),
            assistantLine("a2", 2, [text("Later.")]),
        ];
        expect(entries(lines)).toEqual([{ kind: "user", text: "go" }]);
        expect(entries(lines, { ended: true })).toEqual([
            { kind: "user", text: "go" },
            { kind: "assistant", text: "Running.", interrupted: false },
            { kind: "tool", name: "Bash", input: '{"command":"sleep"}', output: "", ok: false, cut: { input: 0, output: 0 } },
            { kind: "assistant", text: "Later.", interrupted: false },
        ]);
    });

    it("passes over meta, summaries, sidechains, system lines and bookkeeping", () => {
        const read = readLines([
            userLine("m1", 0, "injected", { isMeta: true }),
            userLine("c1", 0, "summary", { isCompactSummary: true }),
            assistantLine("s1", 0, [text("aside")], { isSidechain: true }),
            JSON.stringify({ type: "system", subtype: "compact_boundary", uuid: "y1", timestamp: at(0) }),
            meta("file-history-snapshot"),
            meta("ai-title"),
            userLine("u1", 1, "real"),
        ]);
        expect(read.events.map((event) => event.entry)).toEqual([{ kind: "user", text: "real" }]);
        expect(read.unknown).toEqual([]);
    });

    it("passes over a new type, with or without a uuid, and says so", () => {
        const read = readLines([
            meta("brand-new"),
            JSON.stringify({ type: "newer", uuid: "n1", timestamp: at(0) }),
            userLine("u1", 1, "still read"),
        ]);
        expect(read.unknown).toEqual([
            { line: 0, type: "brand-new" },
            { line: 1, type: "newer" },
        ]);
        expect(read.events.map((event) => event.entry)).toEqual([{ kind: "user", text: "still read" }]);
        expect(read.halt).toBeNull();
    });

    it("takes the words of a prompt queued while she worked, and no task's notice", () => {
        expect(
            entries([
                queued("q1", 1, "also this"),
                queued("q2", 2, "<task-notification>done</task-notification>", "task-notification"),
            ]),
        ).toEqual([{ kind: "user", text: "also this" }]);
    });

    it("keeps an image the user gave as a mark", () => {
        expect(
            entries([userLine("u1", 0, [text("see"), { type: "image", source: {} }])]),
        ).toEqual([{ kind: "user", text: "see\n\n[image]" }]);
    });

    it("passes over the lines already recorded, and those before the launch", () => {
        const lines = [userLine("u1", 0, "old"), userLine("u2", 5, "new"), userLine("u3", 6, "newer")];
        expect(entries(lines, { recorded: new Set(["u2"]), since: Date.parse(at(1)) })).toEqual([
            { kind: "user", text: "newer" },
        ]);
    });

    it("names the model of the first assistant line that is not synthetic", () => {
        const read = readLines([
            assistantLine("a1", 0, [text("x")], { message: { role: "assistant", model: "<synthetic>", content: [text("x")] } }),
            assistantLine("a2", 1, [text("y")]),
        ]);
        expect(read.model).toBe("claude-opus-5-5");
    });

    describe("halting", () => {
        it("halts at a line that is not JSON, keeping what came before", () => {
            const read = readLines([userLine("u1", 0, "fine"), "{not json", userLine("u2", 1, "after")]);
            expect(read.events.map((event) => event.uuid)).toEqual(["u1"]);
            expect(read.halt).toEqual({ line: 1, type: null, uuid: null, reason: "not a JSON object" });
        });

        it("halts at a user line of a shape it does not know", () => {
            const read = readLines([JSON.stringify({ type: "user", uuid: "u1", timestamp: at(0), message: { content: 7 } })]);
            expect(read.halt).toEqual({ line: 0, type: "user", uuid: "u1", reason: "a user line without its content" });
        });

        it("halts at an assistant line without a uuid, recording none of its blocks", () => {
            const bad = JSON.stringify({ type: "assistant", timestamp: at(0), message: { content: [text("x")] } });
            const read = readLines([bad]);
            expect(read.events).toEqual([]);
            expect(read.halt?.reason).toBe("no uuid");
        });

        it("halts at a queued command without its prompt", () => {
            expect(readLines([queued("q1", 0, 3)]).halt?.reason).toBe("a queued command without its prompt");
        });

        it("drops a halting line's earlier blocks", () => {
            const read = readLines([assistantLine("a1", 0, [text("kept?"), { type: "tool_use", id: 3 }])]);
            expect(read.events).toEqual([]);
            expect(read.halt?.reason).toBe("a tool call without its id or name");
        });
    });
});

describe("spoken", () => {
    it("takes a command as typed, and none of Claude Code's own output", () => {
        expect(spoken("<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>focus on tea</command-args>")).toBe("/compact focus on tea");
        expect(spoken("<command-message>herdr</command-message>\n<command-name>/herdr</command-name>")).toBe("/herdr");
        expect(spoken("<bash-input>ls -l</bash-input>")).toBe("! ls -l");
        for (const own of [
            "<local-command-stdout>ok</local-command-stdout>",
            "<local-command-caveat>x</local-command-caveat>",
            "<bash-stdout>a</bash-stdout><bash-stderr></bash-stderr>",
            "<task-notification>t</task-notification>",
            "[Request interrupted by user]",
            "[Request interrupted by user for tool use]",
            "  ",
        ]) {
            expect(spoken(own)).toBeNull();
        }
        expect(spoken("plain words")).toBe("plain words");
    });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `bun test packages/memory/src/bodies/claude-code.test.ts`
Expected: FAIL (`claude-code.js` does not exist).

- [ ] **Step 4: Implement**

`packages/memory/src/bodies/claude-code.ts` (header copied):

```ts
// Claude Code's transcript lines as Dorothy's events. Pure: the hook
// reads the file and appends what this returns, so the mapping is tested
// on fixture lines alone. Main thread only; thinking is not kept, as
// chat keeps none; a call and its result are one event, at the call's
// line. A line of a type it maps but in a shape it does not expect halts
// the reading there, so a format that changes loses nothing.

import {
    CLAUDE_REMEMBER_TOOL,
    CLAUDE_SERVER_NAME,
    describeLookup,
    toolOf,
} from "@dorothy/core";
import { type TranscriptEntry, toolEntry } from "../transcript.js";

// Claude Code's bookkeeping, passed over in silence: the recording probe
// and the planning survey found these, none with a uuid.
export const BOOKKEEPING: ReadonlySet<string> = new Set([
    "agent-name",
    "agent-setting",
    "ai-title",
    "api-request",
    "api-request-blob",
    "api-request-shape",
    "atis-latch",
    "continued-in",
    "cost-state",
    "custom-title",
    "file-history-delta",
    "file-history-snapshot",
    "last-prompt",
    "mode",
    "permission-mode",
    "pr-link",
    "queue-operation",
    "relocated",
    "summary",
    "worktree-state",
]);
// The types the reader maps. system lines are all bookkeeping, but a
// type it knows.
const MAPPED: ReadonlySet<string> = new Set([
    "user",
    "assistant",
    "attachment",
    "system",
]);

export type ReadEvent = { entry: TranscriptEntry; uuid: string; at: string };
// Where the reading halted and why; line indexes the lines given.
export type Halt = {
    line: number;
    type: string | null;
    uuid: string | null;
    reason: string;
};
// A line of a type the reader neither maps nor lists, passed over.
export type Unknown = { line: number; type: string };
export type LinesRead = {
    events: ReadEvent[];
    // The first model an assistant line names, but Claude Code's own
    // <synthetic>.
    model: string | null;
    // The session ids the lines name, in order.
    sessions: string[];
    halt: Halt | null;
    unknown: Unknown[];
};
export type ReadOptions = {
    // The session is over: a call never answered is recorded failed,
    // not waited for.
    ended?: boolean;
    // The uuids already recorded, whose lines are passed over.
    recorded?: ReadonlySet<string>;
    // Lines before this time, in milliseconds, are not recorded: a
    // session new to Dorothy is hers from the launch on.
    since?: number | null;
};

type Json = Record<string, unknown>;
type Result = { text: string; ok: boolean };

const isRecord = (value: unknown): value is Json =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// A shape the reader does not expect: the reading halts.
class Unreadable extends Error {}

const OWN_OUTPUT =
    /^<(local-command-stdout|local-command-stderr|local-command-caveat|bash-stdout|bash-stderr|task-notification)>/;
const INTERRUPTED = /^\[Request interrupted by user[^\]]*\]$/;
const COMMAND = /<command-name>([^<]*)<\/command-name>/;
const ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
const BASH = /^<bash-input>([\s\S]*)<\/bash-input>$/;

// What the user said in a user text: a command as typed, or the text;
// null for Claude Code's own output and markers.
export function spoken(text: string): string | null {
    const trimmed = text.trim();
    if (trimmed === "" || OWN_OUTPUT.test(trimmed) || INTERRUPTED.test(trimmed)) {
        return null;
    }
    const command = COMMAND.exec(trimmed);
    if (command !== null) {
        const args = ARGS.exec(trimmed)?.[1]?.trim() ?? "";
        return `${(command[1] ?? "").trim()} ${args}`.trim();
    }
    const bash = BASH.exec(trimmed);
    return bash === null ? text : `! ${bash[1]}`;
}

// The user's words an attachment carries: a prompt queued while she
// worked. Any other attachment is bookkeeping.
function spokenAttachment(attachment: Json): string | null {
    if (attachment.type !== "queued_command") {
        return null;
    }
    if (attachment.commandMode !== undefined && attachment.commandMode !== "prompt") {
        return null;
    }
    if (typeof attachment.prompt !== "string") {
        throw new Unreadable("a queued command without its prompt");
    }
    return spoken(attachment.prompt);
}

// A result's content as text: other blocks by their type.
function resultText(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }
    if (!Array.isArray(content)) {
        return "";
    }
    return content
        .map((block) =>
            isRecord(block) && block.type === "text" && typeof block.text === "string"
                ? block.text
                : `[${isRecord(block) && typeof block.type === "string" ? block.type : "block"}]`,
        )
        .join("\n");
}

function contentOf(line: Json, what: string): Json[] | string {
    const content = isRecord(line.message) ? line.message.content : undefined;
    if (typeof content === "string") {
        return content;
    }
    if (
        Array.isArray(content) &&
        content.every((block) => isRecord(block) && typeof block.type === "string")
    ) {
        return content as Json[];
    }
    throw new Unreadable(`${what} line without its content`);
}

function timeOf(line: Json): string {
    const time = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : Number.NaN;
    if (!Number.isFinite(time)) {
        throw new Unreadable("no timestamp");
    }
    return new Date(time).toISOString();
}

// A call with its result: her lookups as recall events, her remember as
// her own tool event, any other as the store keeps tools.
function callEntry(
    id: string,
    name: string,
    input: unknown,
    answer: Result | undefined,
): TranscriptEntry {
    const output = answer?.text ?? "";
    const ok = answer?.ok ?? false;
    const tool = toolOf(name, CLAUDE_SERVER_NAME);
    if (tool !== null) {
        return {
            kind: "recall",
            id,
            ok,
            offset: 0,
            ...describeLookup(tool, input, ok ? output : null),
        };
    }
    return toolEntry({
        name,
        input: JSON.stringify(input ?? null),
        output,
        ok,
        memory: name === CLAUDE_REMEMBER_TOOL,
    });
}

// Every result in the lines, by its call's id, so a call is recorded
// with its answer wherever that came.
function resultsIn(lines: readonly (Json | null)[]): Map<string, Result> {
    const results = new Map<string, Result>();
    for (const line of lines) {
        if (line?.type !== "user" || line.isSidechain === true) {
            continue;
        }
        const content = isRecord(line.message) ? line.message.content : undefined;
        for (const block of Array.isArray(content) ? content : []) {
            if (isRecord(block) && block.type === "tool_result" && typeof block.tool_use_id === "string") {
                results.set(block.tool_use_id, {
                    text: resultText(block.content),
                    ok: block.is_error !== true,
                });
            }
        }
    }
    return results;
}

export function readLines(
    lines: readonly string[],
    { ended = false, recorded = new Set(), since = null }: ReadOptions = {},
): LinesRead {
    const parsed = lines.map((text): Json | null => {
        try {
            const value: unknown = JSON.parse(text);
            return isRecord(value) ? value : null;
        } catch {
            return null;
        }
    });
    const results = resultsIn(parsed);
    const read: LinesRead = { events: [], model: null, sessions: [], halt: null, unknown: [] };
    const sessions = new Set<string>();

    // Maps one line; false when the reading waits here for a call's
    // answer. Throws Unreadable for a shape it does not expect.
    const map = (line: Json, index: number, type: string): boolean => {
        if (!MAPPED.has(type)) {
            if (!BOOKKEEPING.has(type)) {
                read.unknown.push({ line: index, type });
            }
            return true;
        }
        if (
            type === "system" ||
            line.isSidechain === true ||
            line.isMeta === true ||
            line.isCompactSummary === true
        ) {
            return true;
        }
        let words: string | null = null;
        let content: Json[] | string = [];
        if (type === "attachment") {
            if (!isRecord(line.attachment)) {
                throw new Unreadable("an attachment without its object");
            }
            words = spokenAttachment(line.attachment);
            if (words === null) {
                return true;
            }
        } else {
            content = contentOf(line, type === "user" ? "a user" : "an assistant");
            if (type === "assistant" && typeof content === "string") {
                throw new Unreadable("an assistant line without its content");
            }
        }
        if (typeof line.uuid !== "string") {
            throw new Unreadable("no uuid");
        }
        const uuid = line.uuid;
        const time = timeOf(line);
        if (recorded.has(uuid) || (since !== null && Date.parse(time) < since)) {
            return true;
        }
        const emit = (entry: TranscriptEntry) => read.events.push({ entry, uuid, at: time });
        if (words !== null) {
            emit({ kind: "user", text: words });
            return true;
        }
        if (type === "user") {
            if (typeof content === "string") {
                const said = spoken(content);
                if (said !== null) {
                    emit({ kind: "user", text: said });
                }
                return true;
            }
            const parts: string[] = [];
            for (const block of content) {
                if (block.type === "text") {
                    const said = typeof block.text === "string" ? spoken(block.text) : null;
                    if (said !== null) {
                        parts.push(said);
                    }
                } else if (block.type === "image") {
                    parts.push("[image]");
                } else if (block.type === "tool_result" && typeof block.tool_use_id !== "string") {
                    throw new Unreadable("a tool result without its call's id");
                }
            }
            if (parts.length > 0) {
                emit({ kind: "user", text: parts.join("\n\n") });
            }
            return true;
        }
        const model = isRecord(line.message) ? line.message.model : undefined;
        if (read.model === null && typeof model === "string" && model !== "<synthetic>") {
            read.model = model;
        }
        for (const block of content as Json[]) {
            if (block.type === "text") {
                if (typeof block.text !== "string") {
                    throw new Unreadable("a text block without its text");
                }
                if (block.text.trim() !== "") {
                    emit({ kind: "assistant", text: block.text, interrupted: false });
                }
            } else if (block.type === "tool_use") {
                if (typeof block.id !== "string" || typeof block.name !== "string") {
                    throw new Unreadable("a tool call without its id or name");
                }
                const answer = results.get(block.id);
                if (answer === undefined && !ended) {
                    return false;
                }
                emit(callEntry(block.id, block.name, block.input, answer));
            }
        }
        return true;
    };

    for (const [index, line] of parsed.entries()) {
        if ((lines[index] ?? "").trim() === "") {
            continue;
        }
        const mark = read.events.length;
        const type = typeof line?.type === "string" ? line.type : null;
        try {
            if (line === null) {
                throw new Unreadable("not a JSON object");
            }
            if (type === null) {
                throw new Unreadable("no type");
            }
            if (typeof line.sessionId === "string" && !sessions.has(line.sessionId)) {
                sessions.add(line.sessionId);
                read.sessions.push(line.sessionId);
            }
            if (!map(line, index, type)) {
                // The line is read again with its answer: none of it now.
                read.events.length = mark;
                break;
            }
        } catch (error) {
            if (!(error instanceof Unreadable)) {
                throw error;
            }
            read.events.length = mark;
            read.halt = {
                line: index,
                type,
                uuid: typeof line?.uuid === "string" ? line.uuid : null,
                reason: error.message,
            };
            break;
        }
    }
    return read;
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test packages/memory/src/bodies && bun run lint:header`
Expected: PASS. Where a test's expected `recall` event differs from
`describeLookup`'s fields (the search's `facts` count, say), the
contract is `describeLookup`'s: fix the expectation, not the reader.

- [ ] **Step 6: Commit**

```bash
git add packages/memory
git commit -m "feat(memory): Read Claude Code's transcript lines"
```

---

### Task 5: Launch notes, lines kept aside and the hook's log

The files recording keeps beside the store. No model, no index.

**Files:**

- Create: `packages/memory/src/bodies/launches.ts`, `launches.test.ts`,
  `unread.ts`, `unread.test.ts`, `log.ts`, `log.test.ts`

**Interfaces:**

- Consumes: `isUuid`, `xdgDir(env, "XDG_STATE_HOME", ...)` (Task 2).
- Produces, from `launches.ts`:
  - `LaunchNote = { v: 1; launch: string; pid: number; started:
    string; dir: string; session: string | null; claude: string }`
    (`claude` is Claude Code's config directory);
    `SessionNote = { v: 1; session: string; transcript: string; cwd:
    string; seen: string }`.
  - `runtimeDir(env)`, `launchesDir(env)`;
    `noteLaunch(env, note: Omit<LaunchNote, "v">)`,
    `readLaunch(env, launch): Promise<LaunchNote | null>`,
    `noteSession(env, launch, note: Omit<SessionNote, "v">)`,
    `launchSessions(env, launch): Promise<SessionNote[]>` (oldest
    `seen` first), `liveSession(env, launch): Promise<string | null>`,
    `staleLaunches(env, alive?): Promise<string[]>`,
    `removeLaunch(env, launch)`.
- From `unread.ts`:
  - `UnreadRecord = { v: 1; session; conversation: string | null;
    transcript; dir; since: number | null; line: number; type: string |
    null; uuid: string | null; reason; at; dismissed?: true }`, `line`
    1-based in the transcript.
  - `stateDir(env)`, `unreadDir(env)`, `copyPath(env, session)`;
    `keepHalt(env, record: Omit<UnreadRecord, "v" | "dismissed">, rest:
    readonly string[]): Promise<string>`, `keepNewType(env, type,
    line)`, `readRecord(env, session)`, `halts(env)`,
    `dismissHalt(env, session): Promise<boolean>`,
    `resolveHalt(env, session)`, `addNotice(env, message, now?)`,
    `startNotices(env): Promise<string[]>`,
    `unreadReport(env): Promise<string[]>`.
- From `log.ts`: `LOG_LIMIT = 1_000_000`, `hookLogPath(env)`,
  `HookLog = { info; warn; error }` each `(message: string) => void`,
  `hookLog(env, { now?, limit? }?)`, `logHasErrors(env):
  Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

Each test file makes its own temporary `HOME` and passes an `env` of
`XDG_*` directories under it, as `bodies/launch.test.ts` does, with
`XDG_RUNTIME_DIR` set to a directory under it too.

`launches.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    launchesDir,
    launchSessions,
    liveSession,
    noteLaunch,
    noteSession,
    readLaunch,
    removeLaunch,
    runtimeDir,
    staleLaunches,
} from "./launches.js";

const LAUNCH = "6c84fb90-12c4-11e1-840d-7b25c5ee775a";
const OTHER = "7d95fc01-23d5-42f2-951e-8c36d6ff886b";
const S1 = "0f8fad5b-d9cb-469f-a165-70867728950e";
const S2 = "1a9fbe6c-eadc-4a7f-b276-81978839a61f";

let home = "";
let env: Record<string, string>;
beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dorothy-launches-"));
    env = { HOME: home, XDG_CACHE_HOME: join(home, "cache"), XDG_RUNTIME_DIR: join(home, "run") };
});
afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

const note = (launch: string, pid = 100) => ({
    launch,
    pid,
    started: "2026-10-15T09:00:00.000Z",
    dir: "/work",
    session: S1,
    claude: "/home/u/.claude",
});

describe("launch notes", () => {
    it("keep a launch privately, beside nothing else in the runtime directory", async () => {
        await noteLaunch(env, note(LAUNCH));
        expect(await readLaunch(env, LAUNCH)).toEqual({ v: 1, ...note(LAUNCH) });
        expect(launchesDir(env)).toBe(join(home, "run", "dorothy", "launches"));
        expect((await stat(join(launchesDir(env), LAUNCH, "launch.json"))).mode & 0o777).toBe(0o600);
        expect((await stat(join(launchesDir(env), LAUNCH))).mode & 0o777).toBe(0o700);
    });

    it("fall back to the cache directory without a runtime directory", () => {
        expect(runtimeDir({ HOME: home, XDG_CACHE_HOME: join(home, "cache") })).toBe(join(home, "cache", "dorothy"));
    });

    it("refuse an id that is no uuid", async () => {
        await expect(noteLaunch(env, note("../x"))).rejects.toThrow("not a launch id");
        expect(await readLaunch(env, "../x")).toBeNull();
        expect(await liveSession(env, "../x")).toBeNull();
    });

    it("keep each session apart, the live one noted last, else the one named", async () => {
        await noteLaunch(env, note(LAUNCH));
        expect(await liveSession(env, LAUNCH)).toBe(S1);
        await noteSession(env, LAUNCH, { session: S2, transcript: "/t/2.jsonl", cwd: "/work", seen: "2026-10-15T09:02:00.000Z" });
        await noteSession(env, LAUNCH, { session: S1, transcript: "/t/1.jsonl", cwd: "/work", seen: "2026-10-15T09:01:00.000Z" });
        expect((await launchSessions(env, LAUNCH)).map((s) => s.session)).toEqual([S1, S2]);
        expect(await liveSession(env, LAUNCH)).toBe(S2);
    });

    it("find the launches whose dorothy is gone, and remove one", async () => {
        await noteLaunch(env, note(LAUNCH, 1));
        await noteLaunch(env, note(OTHER, 2));
        await mkdir(join(launchesDir(env), `.${S1}.tmp`), { recursive: true });
        expect(await staleLaunches(env, (pid) => pid === 2)).toEqual([LAUNCH]);
        await removeLaunch(env, LAUNCH);
        expect(await readLaunch(env, LAUNCH)).toBeNull();
        expect(await staleLaunches(env, () => false)).toEqual([OTHER]);
    });
});
```

`unread.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookLog } from "./log.js";
import {
    addNotice,
    copyPath,
    dismissHalt,
    halts,
    keepHalt,
    keepNewType,
    readRecord,
    resolveHalt,
    startNotices,
    unreadDir,
    unreadReport,
} from "./unread.js";

const S1 = "0f8fad5b-d9cb-469f-a165-70867728950e";
let home = "";
let env: Record<string, string>;
beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dorothy-unread-"));
    env = { HOME: home, XDG_STATE_HOME: join(home, "state"), XDG_CACHE_HOME: join(home, "cache") };
});
afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

const halt = (line = 7) => ({
    session: S1,
    conversation: "a-b-c-d",
    transcript: "/t/s.jsonl",
    dir: "/work",
    since: null,
    line,
    type: "user",
    uuid: "u7",
    reason: "a user line without its content",
    at: "2026-10-15T09:00:00.000Z",
});

describe("lines kept aside", () => {
    it("keeps a halt's lines and record outside the data directory, the user's alone", async () => {
        const copy = await keepHalt(env, halt(), ["{bad", "{\"type\":\"user\"}"]);
        expect(copy).toBe(join(home, "state", "dorothy", "unread", `${S1}.jsonl`));
        expect(await readFile(copy, "utf8")).toBe("{bad\n{\"type\":\"user\"}\n");
        expect((await stat(copy)).mode & 0o777).toBe(0o600);
        expect((await stat(unreadDir(env))).mode & 0o777).toBe(0o700);
        expect(await readRecord(env, S1)).toEqual({ v: 1, ...halt() });
        expect((await halts(env)).map((r) => r.session)).toEqual([S1]);
    });

    it("tells a halt at every start until it is dismissed, then keeps its copy", async () => {
        await keepHalt(env, halt(), ["{bad"]);
        const told = await startNotices(env);
        expect(told).toHaveLength(1);
        expect(told[0]).toContain(`past line 7 (a user line without its content)`);
        expect(told[0]).toContain("dorothy --claude-hook --reread");
        expect(await startNotices(env)).toHaveLength(1);
        expect(await dismissHalt(env, S1)).toBe(true);
        expect(await startNotices(env)).toEqual([]);
        expect(await readFile(copyPath(env, S1), "utf8")).toBe("{bad\n");
        expect(await dismissHalt(env, "1a9fbe6c-eadc-4a7f-b276-81978839a61f")).toBe(false);
    });

    it("tells a halt again once it halts at another line, dismissed or not", async () => {
        await keepHalt(env, halt(7), ["{bad"]);
        await dismissHalt(env, S1);
        await keepHalt(env, halt(7), ["{bad"]);
        expect(await startNotices(env)).toEqual([]);
        await keepHalt(env, halt(9), ["{worse"]);
        expect(await startNotices(env)).toHaveLength(1);
    });

    it("goes once resolved", async () => {
        await keepHalt(env, halt(), ["{bad"]);
        await resolveHalt(env, S1);
        expect(await halts(env)).toEqual([]);
        await expect(readFile(copyPath(env, S1), "utf8")).rejects.toThrow();
        await resolveHalt(env, S1);
    });

    it("keeps one example of a new type, told once", async () => {
        await keepNewType(env, "brand-new", '{"type":"brand-new","n":1}');
        await keepNewType(env, "brand-new", '{"type":"brand-new","n":2}');
        await keepNewType(env, "../odd type", '{"type":"../odd type"}');
        expect(await readFile(join(unreadDir(env), "types", "brand-new.jsonl"), "utf8")).toBe('{"type":"brand-new","n":1}\n');
        const [told] = await startNotices(env);
        expect(told).toContain("___odd_type, brand-new");
        expect(await startNotices(env)).toEqual([]);
    });

    it("tells a hook's notice once, at the next start", async () => {
        await addNotice(env, "memory: Claude Code ran no hooks");
        await addNotice(env, "memory: and again");
        expect(await startNotices(env)).toEqual(["memory: Claude Code ran no hooks", "memory: and again"]);
        expect(await startNotices(env)).toEqual([]);
    });

    it("reports what is kept, and errors in the hook's log, for --check", async () => {
        expect(await unreadReport(env)).toEqual([]);
        await keepHalt(env, halt(), ["{bad"]);
        hookLog(env).error("session x halted");
        const report = await unreadReport(env);
        expect(report[0]).toStartWith(`unread: ${S1} (a-b-c-d), line 7: a user line without its content`);
        expect(report.at(-1)).toContain("claude-hook.log holds errors");
    });
});
```

`log.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookLog, hookLogPath, logHasErrors } from "./log.js";

let home = "";
let env: Record<string, string>;
beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dorothy-log-"));
    env = { HOME: home, XDG_CACHE_HOME: join(home, "cache") };
});
afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe("the hook's log", () => {
    it("writes a line per message, privately, one line however it is worded", async () => {
        const log = hookLog(env, { now: () => new Date("2026-10-15T09:00:00.000Z") });
        log.info("recorded 3 events");
        log.warn("two\nlines");
        const text = await readFile(hookLogPath(env), "utf8");
        expect(text).toBe(
            `2026-10-15T09:00:00.000Z info ${process.pid} recorded 3 events\n` +
                `2026-10-15T09:00:00.000Z warn ${process.pid} two lines\n`,
        );
        expect((await stat(hookLogPath(env))).mode & 0o777).toBe(0o600);
        expect(await logHasErrors(env)).toBe(false);
        log.error("broke");
        expect(await logHasErrors(env)).toBe(true);
    });

    it("rotates past its limit to one .1 file", async () => {
        const log = hookLog(env, { limit: 100 });
        for (let n = 0; n < 5; n += 1) {
            log.info("x".repeat(40));
        }
        expect((await stat(`${hookLogPath(env)}.1`)).size).toBeGreaterThan(100);
        expect((await stat(hookLogPath(env))).size).toBeLessThanOrEqual(150);
    });

    it("never throws when it cannot write", () => {
        const log = hookLog({ HOME: "/nonexistent/x", XDG_CACHE_HOME: "/proc/no" });
        expect(() => log.error("lost")).not.toThrow();
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/memory/src/bodies`
Expected: FAIL (the modules do not exist).

- [ ] **Step 3: `log.ts`**

```ts
// The hook's log. Claude Code owns the terminal, so what a hook would
// say goes here: types, uuids, paths and errors, never a transcript's
// text. Rotated past a megabyte to one .1 file. A log that cannot be
// written says nothing: the hook must still exit 0.

import {
    appendFileSync,
    mkdirSync,
    renameSync,
    statSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Env, xdgDir } from "@dorothy/core";

export const LOG_LIMIT = 1_000_000;

export const hookLogPath = (env: Env) =>
    join(xdgDir(env, "XDG_CACHE_HOME", ".cache"), "dorothy", "claude-hook.log");

export type HookLog = {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
};

export function hookLog(
    env: Env,
    { now = () => new Date(), limit = LOG_LIMIT }: { now?: () => Date; limit?: number } = {},
): HookLog {
    const path = hookLogPath(env);
    const write = (level: string, message: string) => {
        try {
            mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
            try {
                if (statSync(path).size > limit) {
                    renameSync(path, `${path}.1`);
                }
            } catch {
                // No log yet.
            }
            appendFileSync(
                path,
                `${now().toISOString()} ${level} ${process.pid} ${message.replaceAll(/\s*\n\s*/g, " ")}\n`,
                { mode: 0o600 },
            );
        } catch {
            // Unwritable: said nowhere.
        }
    };
    return {
        info: (message) => write("info", message),
        warn: (message) => write("warn", message),
        error: (message) => write("error", message),
    };
}

// Whether the current log holds an error, for dorothy --check.
export async function logHasErrors(env: Env): Promise<boolean> {
    try {
        const text = await readFile(hookLogPath(env), "utf8");
        return /^\S+ error /m.test(text);
    } catch {
        return false;
    }
}
```

- [ ] **Step 4: `launches.ts`**

```ts
// The launches of dorothy --claude and their sessions, noted in
// Dorothy's runtime directory under launches/, apart from anything else
// there: launch.json, written once by the launch, and one file a
// session, written by its hooks, so no two processes rewrite one file.
// A launch's catch-up reads them and removes them when it is done.

import {
    chmod,
    mkdir,
    readdir,
    readFile,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { type Env, isUuid, xdgDir } from "@dorothy/core";

export type LaunchNote = {
    v: 1;
    launch: string;
    // dorothy's own process: the launch is over once it is gone.
    pid: number;
    started: string;
    // The directory claude started in.
    dir: string;
    // The session --session-id named; null when the arguments resumed one.
    session: string | null;
    // Claude Code's config directory, under whose projects/ its
    // transcripts are.
    claude: string;
};
export type SessionNote = {
    v: 1;
    session: string;
    transcript: string;
    cwd: string;
    seen: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function isLaunchNote(value: unknown): value is LaunchNote {
    return (
        isRecord(value) &&
        value.v === 1 &&
        typeof value.launch === "string" &&
        Number.isInteger(value.pid) &&
        typeof value.started === "string" &&
        typeof value.dir === "string" &&
        (value.session === null || typeof value.session === "string") &&
        typeof value.claude === "string"
    );
}

function isSessionNote(value: unknown): value is SessionNote {
    return (
        isRecord(value) &&
        value.v === 1 &&
        typeof value.session === "string" &&
        typeof value.transcript === "string" &&
        typeof value.cwd === "string" &&
        typeof value.seen === "string"
    );
}

// $XDG_RUNTIME_DIR/dorothy, or the cache directory's without one.
export function runtimeDir(env: Env): string {
    const runtime = env.XDG_RUNTIME_DIR ?? "";
    return isAbsolute(runtime)
        ? join(runtime, "dorothy")
        : join(xdgDir(env, "XDG_CACHE_HOME", ".cache"), "dorothy");
}

export const launchesDir = (env: Env) => join(runtimeDir(env), "launches");

function launchDir(env: Env, launch: string): string {
    if (!isUuid(launch)) {
        throw new Error(`not a launch id: ${launch}`);
    }
    return join(launchesDir(env), launch);
}

async function readJson(path: string): Promise<unknown> {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    } catch {
        return null;
    }
}

// Made whole beside, then renamed into place: a launch is never seen
// without its launch.json, which a stale scan would take for a dead one.
export async function noteLaunch(
    env: Env,
    note: Omit<LaunchNote, "v">,
): Promise<void> {
    const dir = launchDir(env, note.launch);
    const making = join(launchesDir(env), `.${note.launch}.tmp`);
    await mkdir(join(making, "sessions"), { recursive: true, mode: 0o700 });
    await chmod(launchesDir(env), 0o700);
    await writeFile(join(making, "launch.json"), `${JSON.stringify({ v: 1, ...note })}\n`, {
        mode: 0o600,
    });
    await rename(making, dir);
}

export async function readLaunch(
    env: Env,
    launch: string,
): Promise<LaunchNote | null> {
    if (!isUuid(launch)) {
        return null;
    }
    const note = await readJson(join(launchDir(env, launch), "launch.json"));
    return isLaunchNote(note) ? note : null;
}

export async function noteSession(
    env: Env,
    launch: string,
    note: Omit<SessionNote, "v">,
): Promise<void> {
    if (!isUuid(note.session)) {
        throw new Error(`not a session id: ${note.session}`);
    }
    const dir = join(launchDir(env, launch), "sessions");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${note.session}.json`);
    const making = `${path}.${process.pid}.tmp`;
    await writeFile(making, `${JSON.stringify({ v: 1, ...note })}\n`, { mode: 0o600 });
    await rename(making, path);
}

// The launch's sessions, the one noted last at the end.
export async function launchSessions(
    env: Env,
    launch: string,
): Promise<SessionNote[]> {
    const dir = join(launchDir(env, launch), "sessions");
    let names: string[];
    try {
        names = await readdir(dir);
    } catch {
        return [];
    }
    const notes: SessionNote[] = [];
    for (const name of names.filter((name) => name.endsWith(".json"))) {
        const note = await readJson(join(dir, name));
        if (isSessionNote(note)) {
            notes.push(note);
        }
    }
    return notes.sort((a, b) => a.seen.localeCompare(b.seen));
}

// The session live in a launch: the one a hook noted last, else the one
// --session-id named. Null for a launch it cannot read.
export async function liveSession(
    env: Env,
    launch: string,
): Promise<string | null> {
    if (!isUuid(launch)) {
        return null;
    }
    const noted = (await launchSessions(env, launch)).at(-1)?.session;
    return noted ?? (await readLaunch(env, launch))?.session ?? null;
}

const pidAlive = (pid: number) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as { code?: unknown }).code === "EPERM";
    }
};

// Launches whose dorothy is gone, and those whose note cannot be read,
// left for a catch-up.
export async function staleLaunches(
    env: Env,
    alive: (pid: number) => boolean = pidAlive,
): Promise<string[]> {
    let names: string[];
    try {
        names = await readdir(launchesDir(env));
    } catch {
        return [];
    }
    const stale: string[] = [];
    for (const name of names.filter(isUuid).sort()) {
        const note = await readLaunch(env, name);
        if (note === null || !alive(note.pid)) {
            stale.push(name);
        }
    }
    return stale;
}

export async function removeLaunch(env: Env, launch: string): Promise<void> {
    await rm(launchDir(env, launch), { recursive: true, force: true });
}
```

- [ ] **Step 5: `unread.ts`**

```ts
// What Dorothy could not read of Claude Code's transcripts, kept aside
// under $XDG_STATE_HOME/dorothy/unread/: outside the data directory, so
// history, the mirror and the index never see it, and the user's alone,
// as tool output in it was never scrubbed. A halt keeps its record and
// the transcript from the halting line on; a new type, one example
// line. Beside them, the notices a hook leaves for the next start, which
// it cannot tell itself.

import {
    appendFile,
    chmod,
    mkdir,
    readdir,
    readFile,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { type Env, isUuid, xdgDir } from "@dorothy/core";
import { hookLogPath, logHasErrors } from "./log.js";

export type UnreadRecord = {
    v: 1;
    session: string;
    conversation: string | null;
    // Claude Code's transcript, the launch's directory and its start,
    // for reading it again.
    transcript: string;
    dir: string;
    since: number | null;
    // The halting line, from 1, and its type and uuid where it had them.
    line: number;
    type: string | null;
    uuid: string | null;
    reason: string;
    at: string;
    dismissed?: true;
};

const codeOf = (error: unknown) => (error as { code?: unknown }).code;

export const stateDir = (env: Env) =>
    join(xdgDir(env, "XDG_STATE_HOME", ".local/state"), "dorothy");
export const unreadDir = (env: Env) => join(stateDir(env), "unread");
const typesDir = (env: Env) => join(unreadDir(env), "types");
const noticesPath = (env: Env) => join(stateDir(env), "notices.jsonl");

function sessionFile(env: Env, session: string, suffix: string): string {
    if (!isUuid(session)) {
        throw new Error(`not a session id: ${session}`);
    }
    return join(unreadDir(env), `${session}${suffix}`);
}
export const copyPath = (env: Env, session: string) =>
    sessionFile(env, session, ".jsonl");
const recordPath = (env: Env, session: string) =>
    sessionFile(env, session, ".json");

async function privateDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
}

async function writePrivate(path: string, text: string): Promise<void> {
    const making = `${path}.${process.pid}.tmp`;
    await writeFile(making, text, { mode: 0o600 });
    await rename(making, path);
}

async function list(dir: string): Promise<string[]> {
    try {
        return await readdir(dir);
    } catch {
        return [];
    }
}

export async function readRecord(
    env: Env,
    session: string,
): Promise<UnreadRecord | null> {
    if (!isUuid(session)) {
        return null;
    }
    try {
        const record = JSON.parse(await readFile(recordPath(env, session), "utf8"));
        return record?.v === 1 && record.session === session ? record : null;
    } catch {
        return null;
    }
}

// A halt: its record, and its transcript from the halting line on, as
// they were. A later halt of the session writes both again; one
// dismissed stays so while it halts at the same line.
export async function keepHalt(
    env: Env,
    record: Omit<UnreadRecord, "v" | "dismissed">,
    rest: readonly string[],
): Promise<string> {
    await privateDir(unreadDir(env));
    const before = await readRecord(env, record.session);
    const copy = copyPath(env, record.session);
    await writePrivate(copy, rest.map((line) => `${line}\n`).join(""));
    const dismissed = before?.dismissed === true && before.line === record.line;
    await writePrivate(
        recordPath(env, record.session),
        `${JSON.stringify({ v: 1, ...record, ...(dismissed ? { dismissed: true } : {}) })}\n`,
    );
    return copy;
}

// A line of a type the reader does not know: the first example of each.
export async function keepNewType(
    env: Env,
    type: string,
    line: string,
): Promise<void> {
    const name = type.replaceAll(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "_";
    await privateDir(typesDir(env));
    try {
        await writeFile(join(typesDir(env), `${name}.jsonl`), `${line}\n`, {
            mode: 0o600,
            flag: "wx",
        });
    } catch (error) {
        if (codeOf(error) !== "EEXIST") {
            throw error;
        }
    }
}

export async function halts(env: Env): Promise<UnreadRecord[]> {
    const records: UnreadRecord[] = [];
    for (const name of (await list(unreadDir(env))).sort()) {
        const session = name.endsWith(".json") ? name.slice(0, -".json".length) : "";
        const record = await readRecord(env, session);
        if (record !== null) {
            records.push(record);
        }
    }
    return records;
}

// Stops a halt's notice; the copy stays. False when there is none.
export async function dismissHalt(env: Env, session: string): Promise<boolean> {
    const record = await readRecord(env, session);
    if (record === null) {
        return false;
    }
    await writePrivate(
        recordPath(env, session),
        `${JSON.stringify({ ...record, dismissed: true })}\n`,
    );
    return true;
}

// The session reads to its end: its copy and record go.
export async function resolveHalt(env: Env, session: string): Promise<void> {
    if (!isUuid(session)) {
        return;
    }
    await rm(copyPath(env, session), { force: true });
    await rm(recordPath(env, session), { force: true });
}

export async function addNotice(
    env: Env,
    message: string,
    now: Date = new Date(),
): Promise<void> {
    await privateDir(stateDir(env));
    await appendFile(
        noticesPath(env),
        `${JSON.stringify({ at: now.toISOString(), message })}\n`,
        { mode: 0o600 },
    );
}

const haltNotice = (env: Env, record: UnreadRecord) =>
    `memory: a Claude Code session (${record.session}) could not be read past line ${record.line} (${record.reason}); the rest is kept in ${copyPath(env, record.session)}. dorothy --claude-hook --reread tries again; --dismiss ${record.session} stops this notice`;

// What to tell at a start of either body: each halt not dismissed, every
// time; new types and hooks' notices, once.
export async function startNotices(env: Env): Promise<string[]> {
    const told = (await halts(env))
        .filter((record) => record.dismissed !== true)
        .map((record) => haltNotice(env, record));
    const toldPath = join(unreadDir(env), "types.json");
    let known: string[] = [];
    try {
        const read: unknown = JSON.parse(await readFile(toldPath, "utf8"));
        known = Array.isArray(read) ? read.filter((t) => typeof t === "string") : [];
    } catch {
        // None told yet.
    }
    const fresh = (await list(typesDir(env)))
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => name.slice(0, -".jsonl".length))
        .filter((type) => !known.includes(type))
        .sort();
    if (fresh.length > 0) {
        told.push(
            `memory: Claude Code wrote lines of a type Dorothy does not know (${fresh.join(", ")}); they were passed over, and an example of each is kept in ${typesDir(env)}`,
        );
        await writePrivate(toldPath, `${JSON.stringify([...known, ...fresh].sort())}\n`);
    }
    // Taken away first, so a notice added meanwhile waits for the next.
    const taking = `${noticesPath(env)}.${process.pid}.taking`;
    try {
        await rename(noticesPath(env), taking);
    } catch {
        return told;
    }
    const text = await readFile(taking, "utf8").catch(() => "");
    await rm(taking, { force: true });
    for (const line of text.split("\n")) {
        try {
            const notice: unknown = JSON.parse(line);
            const message = (notice as { message?: unknown } | null)?.message;
            if (typeof message === "string") {
                told.push(message);
            }
        } catch {
            // A torn line is lost with the file.
        }
    }
    return told;
}

// For dorothy --check: what is kept aside, and whether the hook's log
// holds errors.
export async function unreadReport(env: Env): Promise<string[]> {
    const lines = (await halts(env)).map(
        (record) =>
            `unread: ${record.session} (${record.conversation ?? "no conversation yet"}), line ${record.line}: ${record.reason}; kept in ${copyPath(env, record.session)}${record.dismissed ? " (dismissed)" : ""}`,
    );
    const types = (await list(typesDir(env)))
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => name.slice(0, -".jsonl".length))
        .sort();
    if (types.length > 0) {
        lines.push(`unread: new types kept in ${typesDir(env)}: ${types.join(", ")}`);
    }
    if (await logHasErrors(env)) {
        lines.push(`hook: ${hookLogPath(env)} holds errors`);
    }
    return lines;
}
```

(The test's `toContain("claude-hook.log holds errors")` matches the
last line.)

- [ ] **Step 6: Run the tests**

Run: `bun test packages/memory/src/bodies && bun run lint:header`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/memory
git commit -m "feat(memory): Keep launch notes and unread lines"
```

---

### Task 6: Recording a session

**Files:**

- Create: `packages/memory/src/bodies/record.ts`, `record.test.ts`

**Interfaces:**

- Consumes: `readLines` (Task 4); `keepHalt`, `keepNewType`,
  `resolveHalt`, `HookLog` (Task 5); `sessionPhrase`, the stamp (Task
  3).
- Produces:
  - `SessionReport = { session: string; transcript: string; dir:
    string; since: number | null; ended: boolean }`.
  - `RecordDeps = { env: Env; index: RecallIndex | null; versions:
    HistoryHandle | null; log: HookLog; project: string | null; now?:
    () => Date }`.
  - `Recorded = { kind: "recorded"; phrase: string; appended: number;
    size: number; halted: boolean } | { kind: "nothing"; size: number }
    | { kind: "missing"; reason: string } | { kind: "unlocked" }`;
    `size` is the bytes of Claude Code's transcript read.
  - `recordSession(report, deps): Promise<Recorded>`.
  - `recordedUuids(text): { uuids: Set<string>; last: string | null }`.

- [ ] **Step 1: Write the failing tests**

`packages/memory/src/bodies/record.test.ts` (header copied):

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HistoryHandle, Lock } from "../memory/sidecar.js";
import { RecallIndex } from "../recall/store.js";
import { sessionPhrase } from "../recall/sync.js";
import { transcriptDir } from "../transcript.js";
import { assistantLine, at, meta, result, SESSION, text, use, userLine } from "./fixtures.js";
import { hookLog } from "./log.js";
import {
    type RecordDeps,
    recordedUuids,
    recordSession,
    type SessionReport,
} from "./record.js";
import { copyPath, readRecord, unreadDir } from "./unread.js";

// Runs work one at a time, as the index's lock does across processes.
function serial(): Lock {
    let chain: Promise<unknown> = Promise.resolve();
    return (work) => {
        const run = chain.then(work);
        chain = run.catch(() => {});
        return run;
    };
}

let home = "";
let env: Record<string, string>;
let index: RecallIndex;
let commits: string[];
let claude = "";
beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dorothy-record-"));
    env = {
        HOME: home,
        XDG_DATA_HOME: join(home, "data"),
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_STATE_HOME: join(home, "state"),
    };
    index = RecallIndex.open(join(home, "recall.sqlite"));
    commits = [];
    claude = join(home, "claude.jsonl");
});
afterEach(async () => {
    index.close();
    await rm(home, { recursive: true, force: true });
});

const versions = (lock: Lock = index.lock): HistoryHandle => ({
    recorder: async (_paths, message) => {
        commits.push(message);
    },
    lock,
    sweep: async () => {},
    heal: async () => false,
    close: () => {},
});
const deps = (overrides: Partial<RecordDeps> = {}): RecordDeps => ({
    env,
    index,
    versions: versions(),
    log: hookLog(env),
    project: "github.com/u/here",
    ...overrides,
});
const report = (fields: Partial<SessionReport> = {}): SessionReport => ({
    session: SESSION,
    transcript: claude,
    dir: "/work",
    since: null,
    ended: false,
    ...fields,
});
const write = (lines: string[]) => writeFile(claude, lines.map((line) => `${line}\n`).join(""));
const add = (lines: string[]) => appendFile(claude, lines.map((line) => `${line}\n`).join(""));
const events = async (phrase: string) =>
    (await readFile(join(transcriptDir(env), `${phrase}.jsonl`), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

describe("recordSession", () => {
    it("records a new session as a conversation of its own, from its lines", async () => {
        await write([userLine("u1", 0, "hello"), assistantLine("a1", 1, [text("Hi.")]), meta("ai-title")]);
        const recorded = await recordSession(report(), deps());
        expect(recorded).toMatchObject({ kind: "recorded", appended: 2, halted: false });
        if (recorded.kind !== "recorded") {
            throw new Error(recorded.kind);
        }
        expect(await events(recorded.phrase)).toEqual([
            {
                v: 1,
                kind: "session",
                at: at(0),
                phrase: recorded.phrase,
                sdkSessionId: "",
                model: "claude-opus-5-5",
                promptHash: "",
                resumed: false,
                source: "claude-code",
                sourceSession: SESSION,
                project: "github.com/u/here",
            },
            { v: 1, kind: "user", at: at(0), text: "hello", sourceUuid: "u1" },
            { v: 1, kind: "assistant", at: at(1), text: "Hi.", interrupted: false, sourceUuid: "a1" },
        ]);
        expect(sessionPhrase(index, SESSION)).toBe(recorded.phrase);
        expect(commits).toEqual([`turn: ${recorded.phrase} (claude-code)`]);
    });

    it("takes up after the last line recorded, with no second session event", async () => {
        await write([userLine("u1", 0, "hello")]);
        const first = await recordSession(report(), deps());
        await add([assistantLine("a1", 1, [text("Hi.")]), userLine("u2", 2, "more")]);
        const second = await recordSession(report(), deps());
        expect(second).toMatchObject({ kind: "recorded", appended: 2 });
        if (first.kind !== "recorded") {
            throw new Error(first.kind);
        }
        const kinds = (await events(first.phrase)).map((event) => event.sourceUuid ?? event.kind);
        expect(kinds).toEqual(["session", "u1", "a1", "u2"]);
    });

    it("records a plain session resumed in a launch from the launch on", async () => {
        await write([userLine("u1", 0, "before"), assistantLine("a1", 1, [text("old")]), userLine("u2", 5, "after")]);
        const recorded = await recordSession(report({ since: Date.parse(at(3)) }), deps());
        if (recorded.kind !== "recorded") {
            throw new Error(recorded.kind);
        }
        expect((await events(recorded.phrase)).map((event) => event.text ?? event.kind)).toEqual(["session", "after"]);
    });

    it("appends each event once when two hooks record at once", async () => {
        await write([userLine("u1", 0, "a"), assistantLine("a1", 1, [text("b")]), userLine("u2", 2, "c")]);
        const both = await Promise.all([recordSession(report(), deps()), recordSession(report(), deps())]);
        const phrase = both.find((one) => one.kind === "recorded" && one.appended > 0);
        if (phrase?.kind !== "recorded") {
            throw new Error("nothing recorded");
        }
        expect((await events(phrase.phrase)).map((event) => event.sourceUuid ?? event.kind)).toEqual(["session", "u1", "a1", "u2"]);
        expect(both.map((one) => (one.kind === "recorded" ? one.appended : -1)).sort()).toEqual([0, 3]);
    });

    it("cuts a torn last line of her transcript before appending", async () => {
        await write([userLine("u1", 0, "a")]);
        const first = await recordSession(report(), deps());
        if (first.kind !== "recorded") {
            throw new Error(first.kind);
        }
        await appendFile(join(transcriptDir(env), `${first.phrase}.jsonl`), '{"v":1,"kind":"us');
        await add([userLine("u2", 1, "b")]);
        await recordSession(report(), deps());
        expect((await events(first.phrase)).map((event) => event.sourceUuid ?? event.kind)).toEqual(["session", "u1", "u2"]);
    });

    it("leaves a line Claude Code is still writing for the next reading", async () => {
        await writeFile(claude, `${userLine("u1", 0, "a")}\n${userLine("u2", 1, "b").slice(0, 20)}`);
        const recorded = await recordSession(report(), deps());
        expect(recorded).toMatchObject({ kind: "recorded", appended: 1, size: Buffer.byteLength(`${userLine("u1", 0, "a")}\n`) });
    });

    it("waits for a call's answer, then records it at the call's place", async () => {
        await write([userLine("u1", 0, "go"), assistantLine("a1", 1, [use("t1", "Bash", { command: "ls" })])]);
        const first = await recordSession(report(), deps());
        expect(first).toMatchObject({ appended: 1 });
        await add([userLine("r1", 2, [result("t1", "x")]), assistantLine("a2", 3, [text("Done.")])]);
        const second = await recordSession(report(), deps());
        expect(second).toMatchObject({ appended: 2 });
        if (first.kind !== "recorded") {
            throw new Error(first.kind);
        }
        expect((await events(first.phrase)).map((event) => event.kind)).toEqual(["session", "user", "tool", "assistant"]);
    });

    it("halts at a line it cannot read, keeps the rest aside, and resolves once read", async () => {
        await write([userLine("u1", 0, "fine"), "{torn but whole", userLine("u2", 1, "after")]);
        const halted = await recordSession(report(), deps());
        expect(halted).toMatchObject({ kind: "recorded", appended: 1, halted: true });
        expect(await readFile(copyPath(env, SESSION), "utf8")).toBe(`{torn but whole\n${userLine("u2", 1, "after")}\n`);
        expect(await readRecord(env, SESSION)).toMatchObject({ line: 2, type: null, reason: "not a JSON object" });
        // The reader is fixed, as an update would: the line is now whole.
        await write([userLine("u1", 0, "fine"), userLine("u3", 0, "mended"), userLine("u2", 1, "after")]);
        const read = await recordSession(report(), deps());
        expect(read).toMatchObject({ appended: 2, halted: false });
        expect(await readRecord(env, SESSION)).toBeNull();
    });

    it("keeps one example of a new type, and reads on", async () => {
        await write([meta("brand-new"), userLine("u1", 0, "a")]);
        expect(await recordSession(report(), deps())).toMatchObject({ appended: 1, halted: false });
        expect(await readFile(join(unreadDir(env), "types", "brand-new.jsonl"), "utf8")).toBe(`${meta("brand-new")}\n`);
    });

    it("continues the conversation of a session its lines name", async () => {
        await write([userLine("u1", 0, "a")]);
        const first = await recordSession(report(), deps());
        const next = "1a9fbe6c-eadc-4a7f-b276-81978839a61f";
        await writeFile(claude, `${userLine("u1", 0, "a")}\n${userLine("u2", 1, "b", { sessionId: next })}\n`);
        const second = await recordSession(report({ session: next }), deps());
        if (first.kind !== "recorded" || second.kind !== "recorded") {
            throw new Error("not recorded");
        }
        expect(second.phrase).toBe(first.phrase);
        const read = await events(first.phrase);
        expect(read.map((event) => event.sourceSession ?? event.sourceUuid)).toEqual([SESSION, "u1", next, "u2"]);
        expect(read[2]).toMatchObject({ kind: "session", resumed: true });
    });

    it("finds the conversation without the index, under history's lock", async () => {
        await write([userLine("u1", 0, "a")]);
        const first = await recordSession(report(), deps());
        await add([userLine("u2", 1, "b")]);
        const second = await recordSession(report(), deps({ index: null, versions: versions(serial()) }));
        expect(second).toMatchObject({ kind: "recorded", appended: 1 });
        if (first.kind !== "recorded" || second.kind !== "recorded") {
            throw new Error("not recorded");
        }
        expect(second.phrase).toBe(first.phrase);
    });

    it("records nothing without a lock, a transcript or a word of hers", async () => {
        await write([meta("mode")]);
        expect(await recordSession(report(), deps({ index: null, versions: null }))).toEqual({ kind: "unlocked" });
        expect(await recordSession(report({ transcript: join(home, "gone.jsonl") }), deps())).toMatchObject({ kind: "missing" });
        expect(await recordSession(report(), deps())).toEqual({ kind: "nothing", size: Buffer.byteLength(`${meta("mode")}\n`) });
    });
});

describe("recordedUuids", () => {
    it("collects the uuids recorded and the last of them", () => {
        const text = [
            JSON.stringify({ kind: "session" }),
            JSON.stringify({ kind: "user", sourceUuid: "u1" }),
            "{torn",
            JSON.stringify({ kind: "assistant", sourceUuid: "a1" }),
        ].join("\n");
        expect(recordedUuids(text)).toEqual({ uuids: new Set(["u1", "a1"]), last: "a1" });
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/memory/src/bodies/record.test.ts`
Expected: FAIL (`record.js` does not exist).

- [ ] **Step 3: Implement**

`packages/memory/src/bodies/record.ts` (header copied):

```ts
// A Claude Code session recorded into its conversation, under the
// store's lock: the conversation found by the session's id, or by a
// session its lines name; the transcript read from the resume point,
// the line after the last one recorded; what is new appended with each
// line's time and uuid; the session's row of conversation_sessions
// written into the index itself, as the index's lock is not re-entrant;
// and the change committed to history, as chat commits a turn. A line
// it cannot read halts the reading and is kept aside.

import { readdir, readFile, truncate } from "node:fs/promises";
import { join } from "node:path";
import { type Env, newPhrase } from "@dorothy/core";
import type { HistoryHandle, Lock } from "../memory/sidecar.js";
import type { RecallIndex } from "../recall/store.js";
import { sessionPhrase } from "../recall/sync.js";
import { TranscriptWriter, transcriptDir } from "../transcript.js";
import { readLines } from "./claude-code.js";
import type { HookLog } from "./log.js";
import { keepHalt, keepNewType, resolveHalt } from "./unread.js";

export type SessionReport = {
    session: string;
    // Claude Code's transcript of the session, or its copy kept aside.
    transcript: string;
    // The launch's directory.
    dir: string;
    // The launch's start: a session new to Dorothy is hers from here.
    since: number | null;
    // The session is over: a call never answered is recorded failed.
    ended: boolean;
};

export type RecordDeps = {
    env: Env;
    index: RecallIndex | null;
    versions: HistoryHandle | null;
    log: HookLog;
    // The project of the launch's directory, for the session event.
    project: string | null;
    now?: () => Date;
};

export type Recorded =
    | {
          kind: "recorded";
          phrase: string;
          appended: number;
          // The bytes of Claude Code's transcript read.
          size: number;
          halted: boolean;
      }
    | { kind: "nothing"; size: number }
    | { kind: "missing"; reason: string }
    | { kind: "unlocked" };

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

function parsed(line: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(line);
        return typeof value === "object" && value !== null
            ? (value as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

// The uuids of the Claude Code lines a conversation already holds, and
// the last of them, from its transcript's text.
export function recordedUuids(text: string): {
    uuids: Set<string>;
    last: string | null;
} {
    const uuids = new Set<string>();
    let last: string | null = null;
    for (const line of text.split("\n")) {
        const uuid = parsed(line)?.sourceUuid;
        if (typeof uuid === "string") {
            uuids.add(uuid);
            last = uuid;
        }
    }
    return { uuids, last };
}

// The body sessions a conversation's session events name.
function sessionsIn(text: string): Set<string> {
    const sessions = new Set<string>();
    for (const line of text.split("\n")) {
        const event = parsed(line);
        if (event?.kind === "session" && typeof event.sourceSession === "string") {
            sessions.add(event.sourceSession);
        }
    }
    return sessions;
}

// Without the index: the transcript whose session event names it.
async function scanFor(dir: string, session: string): Promise<string | null> {
    let names: string[];
    try {
        names = await readdir(dir);
    } catch {
        return null;
    }
    for (const name of names.filter((name) => name.endsWith(".jsonl"))) {
        const text = await readFile(join(dir, name), "utf8").catch(() => "");
        if (text.includes(session) && sessionsIn(text).has(session)) {
            return name.slice(0, -".jsonl".length);
        }
    }
    return null;
}

// A writer killed mid-append leaves a line that was never a whole
// event: it is cut off before anything is appended.
async function cutTornTail(path: string): Promise<string> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch {
        return "";
    }
    if (text === "" || text.endsWith("\n")) {
        return text;
    }
    const whole = text.slice(0, text.lastIndexOf("\n") + 1);
    await truncate(path, Buffer.byteLength(whole));
    return whole;
}

export async function recordSession(
    report: SessionReport,
    deps: RecordDeps,
): Promise<Recorded> {
    const lock: Lock | undefined = deps.index?.lock ?? deps.versions?.lock;
    if (lock === undefined) {
        return { kind: "unlocked" };
    }
    const dir = transcriptDir(deps.env);
    const now = deps.now ?? (() => new Date());
    return lock(async (): Promise<Recorded> => {
        let text: string;
        try {
            text = await readFile(report.transcript, "utf8");
        } catch (error) {
            return { kind: "missing", reason: describeError(error) };
        }
        // A line Claude Code is still writing waits for the next reading.
        const whole = text.slice(0, text.lastIndexOf("\n") + 1);
        const size = Buffer.byteLength(whole);
        const lines = whole === "" ? [] : whole.slice(0, -1).split("\n");
        const named: string[] = [];
        for (const line of lines) {
            const id = parsed(line)?.sessionId;
            if (typeof id === "string" && !named.includes(id)) {
                named.push(id);
            }
        }
        let found: string | null = null;
        for (const id of [report.session, ...named.filter((id) => id !== report.session)]) {
            found =
                deps.index === null
                    ? await scanFor(dir, id)
                    : sessionPhrase(deps.index, id);
            if (found !== null) {
                break;
            }
        }
        let recorded = { uuids: new Set<string>(), last: null as string | null };
        let joined = false;
        if (found !== null) {
            const own = await cutTornTail(join(dir, `${found}.jsonl`));
            recorded = recordedUuids(own);
            joined = sessionsIn(own).has(report.session);
        }
        const at =
            recorded.last === null
                ? -1
                : lines.findIndex((line) => parsed(line)?.uuid === recorded.last);
        const from = at + 1;
        const read = readLines(lines.slice(from), {
            ended: report.ended,
            recorded: recorded.uuids,
            since: found === null ? report.since : null,
        });
        for (const unknown of read.unknown) {
            const line = lines[from + unknown.line] ?? "";
            await keepNewType(deps.env, unknown.type, line);
            deps.log.warn(
                `session ${report.session}: line ${from + unknown.line + 1} is of a new type, ${unknown.type}; passed over`,
            );
        }
        let phrase = found;
        if (read.events.length > 0) {
            phrase ??= newPhrase();
            const path = join(dir, `${phrase}.jsonl`);
            const writer = await TranscriptWriter.open(path, now);
            try {
                if (!joined) {
                    await writer.append(
                        {
                            kind: "session",
                            phrase,
                            sdkSessionId: "",
                            model: read.model ?? "unknown",
                            promptHash: "",
                            resumed: found !== null,
                            source: "claude-code",
                            sourceSession: report.session,
                            ...(deps.project === null ? {} : { project: deps.project }),
                        },
                        { at: read.events[0]?.at },
                    );
                    deps.index?.db.run(
                        "INSERT OR IGNORE INTO conversation_sessions (session, phrase) VALUES (?, ?)",
                        [report.session, phrase],
                    );
                }
                for (const event of read.events) {
                    await writer.append(event.entry, {
                        at: event.at,
                        sourceUuid: event.uuid,
                    });
                }
            } finally {
                await writer.close();
            }
            await deps.versions?.recorder([path], `turn: ${phrase} (claude-code)`);
        }
        if (read.halt !== null) {
            const line = from + read.halt.line;
            await keepHalt(
                deps.env,
                {
                    session: report.session,
                    conversation: phrase,
                    transcript: report.transcript,
                    dir: report.dir,
                    since: report.since,
                    line: line + 1,
                    type: read.halt.type,
                    uuid: read.halt.uuid,
                    reason: read.halt.reason,
                    at: now().toISOString(),
                },
                lines.slice(line),
            );
            deps.log.error(
                `session ${report.session}: halted at line ${line + 1} (${read.halt.type ?? "no type"}, ${read.halt.uuid ?? "no uuid"}): ${read.halt.reason}`,
            );
        } else {
            await resolveHalt(deps.env, report.session);
        }
        if (phrase === null) {
            return { kind: "nothing", size };
        }
        deps.log.info(
            `session ${report.session}: ${read.events.length} events into ${phrase}`,
        );
        return {
            kind: "recorded",
            phrase,
            appended: read.events.length,
            size,
            halted: read.halt !== null,
        };
    });
}
```

A halt's copy reads again by `--reread` (Task 8): its lines are the
halting one on, the last recorded uuid is not among them, so the
reading starts at its first line with the recorded uuids passed over.

- [ ] **Step 4: Run the tests**

Run: `bun test packages/memory/src/bodies`
Expected: PASS. In the halting test the copy is from the halting line
(the second, `line: 2`) to the end.

- [ ] **Step 5: Commit**

```bash
git add packages/memory
git commit -m "feat(memory): Record a Claude Code session"
```

---

### Task 7: The review, out of `MemoryService`

A move, not a change: chat's reviews behave exactly as before, and the
hook reviews with the same code.

**Files:**

- Create: `packages/memory/src/memory/reviewer.ts`, `reviewer.test.ts`
- Modify: `packages/memory/src/memory/service.ts`
- Test: `packages/memory/src/memory/service.test.ts` (unchanged; it
  must pass as it is)

**Interfaces:**

- Produces:
  - `ReviewerOptions = { dir: string; config: MemoryConfig; index:
    RecallIndex | null; vocabulary: string | null; versions:
    HistoryHandle | null; call: StructuredCall; persona: string; now: ()
    => Date; entries: () => Iterable<Entry>; warn: (message: string) =>
    void; cost: (usd: number) => void }`.
  - `Reviewed = { kind: "reviewed"; sidecar: Sidecar; turns: number } |
    { kind: "marked"; sidecar: Sidecar; turns: number | null } | {
    kind: "none" }`.
  - `class Reviewer { constructor(options); readVocabulary():
    Promise<Vocabulary | null>; review(phrase: string, signal:
    AbortSignal): Promise<Reviewed> }`. The caller holds the claim and
    flushes a live transcript first.

- [ ] **Step 1: Write the failing test**

`packages/memory/src/memory/reviewer.test.ts` (header copied):

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, newPhrase, type StructuredCall } from "@dorothy/core";
import { Reviewer } from "./reviewer.js";
import { readSidecar } from "./sidecar.js";

const NOW = new Date("2026-10-15T09:00:00.000Z");
const PHRASE = newPhrase(() => Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
const NOTES = { title: "Tea", description: "About tea.", abstract: "Tea at four." };

let dir = "";
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-reviewer-"));
    await writeFile(
        join(dir, `${PHRASE}.jsonl`),
        [
            { v: 1, kind: "user", at: NOW.toISOString(), text: "tea?" },
            { v: 1, kind: "assistant", at: NOW.toISOString(), text: "At four.", interrupted: false },
        ]
            .map((event) => JSON.stringify(event))
            .join("\n") + "\n",
    );
});
afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

const reviewer = (call: StructuredCall, said: string[] = [], spent: number[] = []) =>
    new Reviewer({
        dir,
        config: DEFAULT_CONFIG.memory,
        index: null,
        vocabulary: null,
        versions: null,
        call,
        persona: "You are Dorothy.",
        now: () => NOW,
        entries: () => [],
        warn: (message) => said.push(message),
        cost: (usd) => spent.push(usd),
    });

describe("Reviewer", () => {
    it("reviews a conversation alone, writing its notes and saying what it cost", async () => {
        const spent: number[] = [];
        const reviewed = await reviewer(
            async () => ({ ok: true, output: NOTES, model: "m", costUsd: 0.25 }),
            [],
            spent,
        ).review(PHRASE, new AbortController().signal);
        expect(reviewed).toMatchObject({ kind: "reviewed", turns: 2 });
        const read = await readSidecar(dir, PHRASE);
        expect(read.kind === "ok" && read.sidecar.title).toBe("Tea");
        expect(spent).toEqual([0.25]);
    });

    it("marks a failure and says why", async () => {
        const said: string[] = [];
        const reviewed = await reviewer(
            async () => ({ ok: false, reason: "no credentials", costUsd: 0 }),
            said,
        ).review(PHRASE, new AbortController().signal);
        expect(reviewed.kind).toBe("marked");
        expect(said).toEqual([`memory: couldn't review "${PHRASE}": no credentials`]);
    });

    it("does nothing for a conversation already reviewed through its end", async () => {
        const call: StructuredCall = async () => ({ ok: true, output: NOTES, model: "m", costUsd: 0 });
        const one = reviewer(call);
        await one.review(PHRASE, new AbortController().signal);
        expect(await one.review(PHRASE, new AbortController().signal)).toEqual({ kind: "none" });
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test packages/memory/src/memory/reviewer.test.ts`
Expected: FAIL (`reviewer.js` does not exist).

- [ ] **Step 3: Write `reviewer.ts`, moving the code**

`packages/memory/src/memory/reviewer.ts` (header copied). Its body is
`MemoryService`'s review, moved: `#readVocabulary`, `#carriers`,
`#tag`, `#nameOf`, the review half of `#build` and `#reviewClaimed`,
with `this.#entries` read through `entries()`, `this.#warn` through
`warn`, the cost notice through `cost`, and each write's result
returned instead of remembered:

```ts
// One review of one conversation, for whoever holds its claim: chat's
// MemoryService between replies, and dorothy --claude-hook after them.
// It reads the transcript and notes, asks the model on Dorothy's persona
// with her memory block beside, and writes notes, tags and appraisals
// under the lock, committed to history. A caller reviewing a live
// conversation flushes its transcript first.

import { join } from "node:path";
import {
    type MemoryConfig,
    type ResumedTurn,
    type StructuredCall,
    withSection,
} from "@dorothy/core";
import type { RecallIndex } from "../recall/store.js";
import { readTranscript } from "../transcript.js";
import type { Entry } from "./catalogue.js";
import { buildMemory } from "./rank.js";
import {
    CLUSTERS_INSTRUCTION,
    pendingReads,
    READS_INSTRUCTION,
    REVIEW_INSTRUCTIONS,
    reviewPrompt,
    reviewSchema,
    runReview,
    TAGS_INSTRUCTION,
} from "./review.js";
import {
    type HistoryHandle,
    type Lock,
    markFailed,
    markReviewed,
    mergeReview,
    ownsAll,
    type Recording,
    readSidecar,
    reviewDue,
    type Sidecar,
    sidecarPath,
    untagged,
    updateSidecar,
} from "./sidecar.js";
import { applyTagging, reviewConcepts, type TagOutput } from "./tagging.js";
import {
    EMPTY_VOCABULARY,
    readVocabulary,
    resolveTags,
    type Vocabulary,
    vocabularyProblem,
    writeVocabulary,
} from "./vocabulary.js";

export type ReviewerOptions = {
    // The transcripts directory.
    dir: string;
    config: MemoryConfig;
    // For the write lock; null without.
    index: RecallIndex | null;
    // tags.json; null leaves tags alone.
    vocabulary: string | null;
    // History: each write committed, a broken file restored before it
    // is read. Null without.
    versions: HistoryHandle | null;
    call: StructuredCall;
    // The persona reviews run on: the chat persona without recall.
    persona: string;
    now: () => Date;
    // The catalogue as last seen: the block a review is given, the
    // names of conversations it read, and the carriers of tags.
    entries: () => Iterable<Entry>;
    warn: (message: string) => void;
    cost: (usd: number) => void;
};

// What a review wrote: notes reviewed, or only marked (nothing new to
// pay for, or a failure). turns is the transcript's count, null where
// unknown.
export type Reviewed =
    | { kind: "reviewed"; sidecar: Sidecar; turns: number }
    | { kind: "marked"; sidecar: Sidecar; turns: number | null }
    | { kind: "none" };

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

export class Reviewer {
    readonly #options: ReviewerOptions;
    // A broken vocabulary is told once a reviewer.
    #vocabularyWarned = false;

    constructor(options: ReviewerOptions) {
        this.#options = options;
    }

    // The lock writes take: the index's, or history's own without it.
    get #lock(): Lock | undefined {
        return this.#options.index?.lock ?? this.#options.versions?.lock;
    }

    #recording(message: string, also: readonly string[] = []): Recording | undefined {
        const versions = this.#options.versions;
        return versions === null
            ? undefined
            : { recorder: versions.recorder, message, also };
    }

    // ... readVocabulary(): MemoryService's #readVocabulary, public, with
    // this.#vocabulary as this.#options.vocabulary, this.#versions as
    // this.#options.versions and this.#warn as this.#options.warn.

    // ... #carriers(), #tag(latest, output, stamp): moved unchanged but
    // for [...this.#entries.values()] becoming [...this.#options.entries()]
    // and this.#vocabulary becoming this.#options.vocabulary.

    #nameOf(phrase: string): string {
        for (const entry of this.#options.entries()) {
            if (entry.phrase === phrase) {
                return (
                    (entry.sidecar.kind === "ok" ? entry.sidecar.sidecar.title : null) ??
                    phrase
                );
            }
        }
        return phrase;
    }

    // The block a review is given: every note but its own conversation's.
    #block(phrase: string): string {
        return buildMemory([...this.#options.entries()], {
            now: this.#options.now().getTime(),
            config: this.#options.config,
            exclude: phrase,
        }).block;
    }

    async review(phrase: string, signal: AbortSignal): Promise<Reviewed> {
        // MemoryService's #reviewClaimed from `let read = await
        // readSidecar(...)` to its end, with these changes and no others:
        // - `this.#dir` is `this.#options.dir`, `this.#versions` is
        //   `this.#options.versions`, `this.#call` is `this.#options.call`,
        //   `this.#persona` is `this.#options.persona`, `this.#now` is
        //   `this.#options.now`, `this.#readVocabulary()` is
        //   `this.readVocabulary()`, `this.#warn` is `this.#options.warn`,
        //   and `this.#build(phrase).block` is `this.#block(phrase)`;
        // - the cost notice, `this.#emit({ type: "memory-cost", usd })`,
        //   is `this.#options.cost(outcome.costUsd)`;
        // - every bare `return;` is `return { kind: "none" };`;
        // - the nothing-new branch's
        //   `this.#remember(phrase, skipped.sidecar, turns.length)` and
        //   its `return` become
        //   `return skipped.kind === "written" ? { kind: "marked", sidecar: skipped.sidecar, turns: turns.length } : { kind: "none" };`;
        // - the failure branch's `this.#remember(phrase, failed.sidecar, null)`
        //   and its `return` become
        //   `return failed.kind === "written" ? { kind: "marked", sidecar: failed.sidecar, turns: null } : { kind: "none" };`;
        // - the end, from `this.#remember(phrase, result.sidecar, turns.length);`
        //   on, becomes
        //   `return { kind: "reviewed", sidecar: result.sidecar, turns: turns.length };`
        //   (the block's rebuild stays in MemoryService).
    }
}
```

The comments marked `...` are instructions for the move, not code to
keep: replace each with the moved method, and the body of `review`
with the moved body as its comment says. Keep each moved method's own
comments. `REVIEW_TIMEOUT_MS` stays imported by `MemoryService`, which
claims.

- [ ] **Step 4: `MemoryService` uses it**

In `service.ts`:

- Remove the moved methods and the imports only they used (`join`,
  `readTranscript`, `CLUSTERS_INSTRUCTION`, `pendingReads`,
  `READS_INSTRUCTION`, `REVIEW_INSTRUCTIONS`, `reviewPrompt`,
  `reviewSchema`, `runReview`, `TAGS_INSTRUCTION`, `markFailed`,
  `markReviewed`, `mergeReview`, `ownsAll`, `readSidecar`,
  `sidecarPath`, `untagged`, `applyTagging`, `reviewConcepts`,
  `TagOutput`, `EMPTY_VOCABULARY`, `readVocabulary`, `resolveTags`,
  `Vocabulary`, `vocabularyProblem`, `writeVocabulary`,
  `withSection`, `ResumedTurn`, and `#vocabularyWarned`), keeping
  what `isStale`, `sent` and `#build` still use; `tsc` names the rest.
- Add the field `readonly #reviewer: Reviewer;` and, in the
  constructor, after `this.#entries` is set:

```ts
        this.#reviewer = new Reviewer({
            dir: options.dir,
            config: options.config,
            index: this.#index,
            vocabulary: this.#vocabulary,
            versions: this.#versions,
            call: options.call,
            persona: options.persona,
            now: this.#now,
            entries: () => this.#entries.values(),
            warn: (message) => this.#warn(message),
            cost: (usd) => this.#emit({ type: "memory-cost", usd }),
        });
```

- `ready()` calls `this.#reviewer.readVocabulary()` where it called
  `this.#readVocabulary()`.
- `#review` becomes:

```ts
    async #review(phrase: string, signal: AbortSignal): Promise<void> {
        const index = this.#index;
        if (index !== null && !(await this.#claim(index, phrase, signal))) {
            return;
        }
        try {
            if (phrase === this.#phrase) {
                await this.#flushed?.();
            }
            const reviewed = await this.#reviewer.review(phrase, signal);
            if (reviewed.kind === "none") {
                return;
            }
            this.#remember(phrase, reviewed.sidecar, reviewed.turns);
            // The live conversation is left out of its own sessions' block.
            if (reviewed.kind === "reviewed" && phrase !== this.#phrase) {
                const built = this.#build(this.#phrase);
                this.#block = built.block;
                const [warning] = built.warnings;
                if (warning !== undefined && !this.#pinWarned) {
                    this.#pinWarned = true;
                    this.#warn(warning);
                }
            }
        } finally {
            await index?.release(phrase, this.#owner);
        }
    }
```

`#nameOf` is removed with the rest; `#remember` stays.

- [ ] **Step 5: Run the tests**

Run: `bun test packages/memory/src/memory && bun run check`
Expected: PASS, `service.test.ts` unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/memory
git commit -m "refactor(memory): Take reviews out of the service"
```

---

### Task 8: The hook process

**Files:**

- Create: `packages/memory/src/bodies/hook.ts`, `hook.test.ts`,
  `packages/memory/src/claude-hook.ts`
- Modify: `packages/memory/package.json`, `packages/memory/src/index.ts`,
  `workspace.test.ts`

**Interfaces:**

- Consumes: everything in Tasks 3 to 7; `syncProject`
  (`projects/sync.ts`), `identify`, `indexCatalogue`, `commandHistory`
  with `remindMirror: false`, `REVIEW_TIMEOUT_MS`.
- Produces:
  - `HookMode = { kind: "hook" } | { kind: "catch-up"; launch: string;
    session: string | null } | { kind: "reread" } | { kind: "dismiss";
    session: string }`.
  - `HookDeps = { env?: Env; stdin?: () => Promise<string>; call:
    StructuredCall; persona: string; self: readonly string[];
    spawnDetached?: (cmd: string[]) => void; timers?: Timers; now?: ()
    => Date; out?: Output; err?: Output }`, `Output = { write(text:
    string): unknown }`.
  - `runClaudeHook(mode: HookMode, deps: HookDeps): Promise<number>`,
    from `@dorothy/memory/claude-hook`.
  - `Steps`, `afterStop(steps, idleMs)`, `afterEnd(steps)`,
    `activitySince(path, size): Promise<boolean>`,
    `parseHookInput(text): HookInput | null`.
  - From `@dorothy/memory` (`"."`): `noteLaunch`, `staleLaunches`,
    `startNotices`, `type LaunchNote`.

- [ ] **Step 1: Write the failing tests**

`packages/memory/src/bodies/hook.test.ts` (header copied):

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StructuredCall } from "@dorothy/core";
import { transcriptDir } from "../transcript.js";
import { assistantLine, meta, SESSION, text, userLine } from "./fixtures.js";
import {
    activitySince,
    afterEnd,
    afterStop,
    parseHookInput,
    runClaudeHook,
    type Steps,
} from "./hook.js";
import { hookLogPath } from "./log.js";
import { launchesDir, noteLaunch, noteSession, readLaunch } from "./launches.js";
import type { Recorded } from "./record.js";
import { keepHalt, readRecord, startNotices } from "./unread.js";

const LAUNCH = "6c84fb90-12c4-11e1-840d-7b25c5ee775a";
const NOTES = { title: "Hello", description: "A greeting.", abstract: "They said hello." };

// The steps as calls, each answering from a script.
function steps(script: {
    records?: Recorded[];
    state?: { reviewedThrough: number; turns: number; hidden: boolean }[];
    activity?: boolean;
}) {
    const calls: string[] = [];
    const records = [...(script.records ?? [])];
    const states = [...(script.state ?? [])];
    const fake: Steps = {
        record: async (ended) => {
            calls.push(`record${ended ? " ended" : ""}`);
            return records.shift() ?? { kind: "nothing", size: 0 };
        },
        sync: async () => {
            calls.push("sync");
        },
        state: async () => {
            calls.push("state");
            return states.shift() ?? { reviewedThrough: 0, turns: 0, hidden: false };
        },
        review: async (phrase) => {
            calls.push(`review ${phrase}`);
        },
        activity: async (size) => {
            calls.push(`activity ${size}`);
            return script.activity ?? false;
        },
        sleep: async (ms) => {
            calls.push(`sleep ${ms}`);
        },
    };
    return { fake, calls };
}
const recorded = (size = 10): Recorded => ({ kind: "recorded", phrase: "a-b-c-d", appended: 1, size, halted: false });

describe("afterStop", () => {
    it("asks for the first review at once", async () => {
        const { fake, calls } = steps({ records: [recorded()], state: [{ reviewedThrough: 0, turns: 2, hidden: false }] });
        await afterStop(fake, 60_000);
        expect(calls).toEqual(["record", "sync", "state", "review a-b-c-d"]);
    });

    it("waits while idle, then records again and reviews what is uncovered", async () => {
        const { fake, calls } = steps({
            records: [recorded(10), recorded(10)],
            state: [
                { reviewedThrough: 2, turns: 4, hidden: false },
                { reviewedThrough: 2, turns: 4, hidden: false },
            ],
        });
        await afterStop(fake, 60_000);
        expect(calls).toEqual(["record", "sync", "state", "sleep 60000", "activity 10", "record", "state", "review a-b-c-d"]);
    });

    it("leaves the conversation to a later hook once a line has come", async () => {
        const { fake, calls } = steps({
            records: [recorded()],
            state: [{ reviewedThrough: 2, turns: 4, hidden: false }],
            activity: true,
        });
        await afterStop(fake, 60_000);
        expect(calls.at(-1)).toBe("activity 10");
    });

    it("reviews nothing covered, hidden, or not recorded", async () => {
        const covered = steps({
            records: [recorded(), recorded()],
            state: [
                { reviewedThrough: 4, turns: 4, hidden: false },
                { reviewedThrough: 4, turns: 4, hidden: false },
            ],
        });
        await afterStop(covered.fake, 1000);
        expect(covered.calls.some((call) => call.startsWith("review"))).toBe(false);
        const hidden = steps({ records: [recorded()], state: [{ reviewedThrough: 0, turns: 2, hidden: true }] });
        await afterStop(hidden.fake, 1000);
        expect(hidden.calls).toEqual(["record", "sync", "state"]);
        const none = steps({});
        await afterStop(none.fake, 1000);
        expect(none.calls).toEqual(["record"]);
    });
});

describe("afterEnd", () => {
    it("records to the end, syncs, and reviews what is uncovered", async () => {
        const { fake, calls } = steps({ records: [recorded()], state: [{ reviewedThrough: 2, turns: 3, hidden: false }] });
        await afterEnd(fake);
        expect(calls).toEqual(["record ended", "sync", "state", "review a-b-c-d"]);
    });
});

describe("activitySince", () => {
    it("sees a main-thread line after what was read, not bookkeeping or a sidechain", async () => {
        const dir = await mkdtemp(join(tmpdir(), "dorothy-activity-"));
        const path = join(dir, "t.jsonl");
        const first = `${userLine("u1", 0, "a")}\n`;
        await writeFile(path, `${first}${meta("ai-title")}\n${userLine("s1", 1, "x", { isSidechain: true })}\n`);
        expect(await activitySince(path, Buffer.byteLength(first))).toBe(false);
        await writeFile(path, `${first}${meta("ai-title")}\n${userLine("u2", 2, "b")}\n`);
        expect(await activitySince(path, Buffer.byteLength(first))).toBe(true);
        expect(await activitySince(join(dir, "gone"), 0)).toBe(false);
        await rm(dir, { recursive: true, force: true });
    });
});

describe("parseHookInput", () => {
    it("takes the fields a hook gives, and nothing malformed", () => {
        expect(
            parseHookInput(JSON.stringify({ hook_event_name: "Stop", session_id: SESSION, transcript_path: "/t.jsonl", cwd: "/w", stop_hook_active: false })),
        ).toEqual({ event: "Stop", session: SESSION, transcript: "/t.jsonl", cwd: "/w" });
        expect(parseHookInput("{")).toBeNull();
        expect(parseHookInput(JSON.stringify({ hook_event_name: "Stop", session_id: "../x", transcript_path: "/t", cwd: "/w" }))).toBeNull();
    });
});

describe("runClaudeHook", () => {
    let home = "";
    let env: Record<string, string>;
    let claude = "";
    let said = "";
    const out = { write: (text: string) => (said += text) };
    const reviews: string[] = [];
    const call: StructuredCall = async ({ prompt }) => {
        reviews.push(prompt);
        return { ok: true, output: NOTES, model: "m", costUsd: 0.01 };
    };
    beforeEach(async () => {
        home = await mkdtemp(join(tmpdir(), "dorothy-hook-"));
        env = {
            HOME: home,
            XDG_DATA_HOME: join(home, "data"),
            XDG_CACHE_HOME: join(home, "cache"),
            XDG_CONFIG_HOME: join(home, "config"),
            XDG_STATE_HOME: join(home, "state"),
            XDG_RUNTIME_DIR: join(home, "run"),
            DOROTHY_LAUNCH: LAUNCH,
        };
        claude = join(home, "claude", "projects", "-work", `${SESSION}.jsonl`);
        await mkdir(join(home, "claude", "projects", "-work"), { recursive: true });
        await mkdir(join(home, "work"));
        await writeFile(claude, `${userLine("u1", 1, "hello")}\n${assistantLine("a1", 2, [text("Hi.")])}\n`);
        await noteLaunch(env, {
            launch: LAUNCH,
            pid: 1,
            started: "2026-10-15T09:00:00.000Z",
            dir: join(home, "work"),
            session: SESSION,
            claude: join(home, "claude"),
        });
        said = "";
        reviews.length = 0;
    });
    afterEach(async () => {
        await rm(home, { recursive: true, force: true });
    });
    const input = (event: string) =>
        JSON.stringify({ hook_event_name: event, session_id: SESSION, transcript_path: claude, cwd: join(home, "work") });
    const deps = (stdin: string, spawned: string[][] = []) => ({
        env,
        stdin: async () => stdin,
        call,
        persona: "You are Dorothy.",
        self: ["/bin/bun", "/d/index.ts"],
        spawnDetached: (cmd: string[]) => spawned.push(cmd),
        out,
        err: out,
    });
    const conversations = async () =>
        (await readdir(transcriptDir(env)).catch(() => [])).filter((name) => name.endsWith(".jsonl"));

    it("records a Stop, and asks for its first review at once, saying nothing", async () => {
        expect(await runClaudeHook({ kind: "hook" }, deps(input("Stop")))).toBe(0);
        expect(await conversations()).toHaveLength(1);
        expect(reviews).toHaveLength(1);
        expect(said).toBe("");
    });

    it("hands a SessionEnd to a detached catch-up of its session", async () => {
        const spawned: string[][] = [];
        expect(await runClaudeHook({ kind: "hook" }, deps(input("SessionEnd"), spawned))).toBe(0);
        expect(spawned).toEqual([["/bin/bun", "/d/index.ts", "--claude-hook", "--catch-up", LAUNCH, "--session", SESSION]]);
        expect(await conversations()).toEqual([]);
    });

    it("logs what it cannot do, and still exits 0", async () => {
        expect(await runClaudeHook({ kind: "hook" }, deps("{"))).toBe(0);
        expect(await runClaudeHook({ kind: "hook" }, { ...deps(input("Stop")), env: { ...env, DOROTHY_LAUNCH: "" } })).toBe(0);
        const log = await readFile(hookLogPath(env), "utf8");
        expect(log).toContain("error");
        expect(said).toBe("");
    });

    it("catches up a launch: each session, then its notes go", async () => {
        await noteSession(env, LAUNCH, { session: SESSION, transcript: claude, cwd: join(home, "work"), seen: "2026-10-15T09:03:00.000Z" });
        expect(await runClaudeHook({ kind: "catch-up", launch: LAUNCH, session: null }, deps(""))).toBe(0);
        expect(await conversations()).toHaveLength(1);
        expect(reviews).toHaveLength(1);
        expect(await readLaunch(env, LAUNCH)).toBeNull();
        expect(await readdir(launchesDir(env))).toEqual([]);
    });

    it("catches up one session and keeps the launch's notes", async () => {
        await noteSession(env, LAUNCH, { session: SESSION, transcript: claude, cwd: join(home, "work"), seen: "2026-10-15T09:03:00.000Z" });
        await runClaudeHook({ kind: "catch-up", launch: LAUNCH, session: SESSION }, deps(""));
        expect(await conversations()).toHaveLength(1);
        expect(await readLaunch(env, LAUNCH)).not.toBeNull();
    });

    it("records a session no hook ran for, and tells the next start", async () => {
        await runClaudeHook({ kind: "catch-up", launch: LAUNCH, session: null }, deps(""));
        expect(await conversations()).toHaveLength(1);
        const [told] = await startNotices(env);
        expect(told).toContain("ran no hooks");
    });

    it("reads a halted session again once it can, and dismisses one", async () => {
        await writeFile(claude, `${userLine("u1", 1, "hello")}\n{bad\n`);
        await runClaudeHook({ kind: "hook" }, deps(input("Stop")));
        expect(await readRecord(env, SESSION)).not.toBeNull();
        expect(await runClaudeHook({ kind: "reread" }, deps(""))).toBe(1);
        expect(said).toContain(`${SESSION} still can't be read`);
        await writeFile(claude, `${userLine("u1", 1, "hello")}\n${userLine("u2", 3, "mended")}\n`);
        said = "";
        expect(await runClaudeHook({ kind: "reread" }, deps(""))).toBe(0);
        expect(said).toContain(`read ${SESSION} to its end`);
        expect(await readRecord(env, SESSION)).toBeNull();
        await keepHalt(env, { session: SESSION, conversation: null, transcript: claude, dir: "/w", since: null, line: 2, type: null, uuid: null, reason: "r", at: "t" }, ["{bad"]);
        expect(await runClaudeHook({ kind: "dismiss", session: SESSION }, deps(""))).toBe(0);
        expect(await startNotices(env)).toEqual([]);
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/memory/src/bodies/hook.test.ts`
Expected: FAIL (`hook.js` does not exist).

- [ ] **Step 3: Implement `hook.ts`**

`packages/memory/src/bodies/hook.ts` (header copied):

```ts
// dorothy --claude-hook: what Claude Code's hooks run in a launch of
// dorothy --claude. A Stop records the session, syncs the launch's
// project and reviews by chat's rule; a SessionEnd hands its session to
// a detached catch-up and returns at once; the catch-up does that for
// every session of a launch once claude has exited. Claude Code owns
// the terminal, so the hook and the catch-up write nothing to it and
// always exit 0: what went wrong is in the hook's log. --reread and
// --dismiss are the user's, and speak.

import { randomBytes } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
    type Env,
    isUuid,
    REAL_TIMERS,
    readConfig,
    type StructuredCall,
    sleep,
    type Timers,
} from "@dorothy/core";
import { dataRoot } from "../facts/store.js";
import { commandHistory } from "../history/commands.js";
import { indexCatalogue } from "../memory/catalogue.js";
import { REVIEW_TIMEOUT_MS } from "../memory/review.js";
import { Reviewer } from "../memory/reviewer.js";
import { type HistoryHandle, readSidecar } from "../memory/sidecar.js";
import { vocabularyPath } from "../memory/vocabulary.js";
import { identify } from "../projects/identify.js";
import { syncProject } from "../projects/sync.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { syncIndex } from "../recall/sync.js";
import { readTranscript, transcriptDir } from "../transcript.js";
import {
    type LaunchNote,
    launchSessions,
    noteSession,
    readLaunch,
    removeLaunch,
    type SessionNote,
} from "./launches.js";
import { type HookLog, hookLog } from "./log.js";
import { type Recorded, recordSession, type SessionReport } from "./record.js";
import { addNotice, copyPath, dismissHalt, halts, unreadDir } from "./unread.js";

export type HookMode =
    | { kind: "hook" }
    | { kind: "catch-up"; launch: string; session: string | null }
    | { kind: "reread" }
    | { kind: "dismiss"; session: string };

export type Output = { write(text: string): unknown };

export type HookDeps = {
    env?: Env;
    stdin?: () => Promise<string>;
    // Reviews, as chat's: the agent's call and the persona without recall.
    call: StructuredCall;
    persona: string;
    // This program as a command, for the detached catch-up.
    self: readonly string[];
    spawnDetached?: (cmd: string[]) => void;
    timers?: Timers;
    now?: () => Date;
    // For --reread and --dismiss alone.
    out?: Output;
    err?: Output;
};

export type HookInput = {
    event: string;
    session: string;
    transcript: string;
    cwd: string;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
// A claim outlives the longest review by this much, as chat's do.
const CLAIM_MARGIN_MS = 30_000;

// A hook's JSON on stdin, or null for one it cannot use.
export function parseHookInput(text: string): HookInput | null {
    try {
        const input = JSON.parse(text) as Record<string, unknown>;
        const { hook_event_name: event, session_id: session, transcript_path: transcript, cwd } = input;
        return typeof event === "string" &&
            typeof session === "string" &&
            isUuid(session) &&
            typeof transcript === "string" &&
            typeof cwd === "string"
            ? { event, session, transcript, cwd }
            : null;
    } catch {
        return null;
    }
}

// Whether a main-thread line of the conversation has come after size
// bytes: a reply, or a prompt the user has sent. Bookkeeping does not
// count.
export async function activitySince(path: string, size: number): Promise<boolean> {
    let text: string;
    try {
        const handle = await open(path, "r");
        try {
            const length = Math.max(0, (await handle.stat()).size - size);
            const bytes = Buffer.alloc(length);
            await handle.read(bytes, 0, length, size);
            text = bytes.toString("utf8");
        } finally {
            await handle.close();
        }
    } catch {
        return false;
    }
    return text.split("\n").some((line) => {
        try {
            const event = JSON.parse(line) as { type?: unknown; isSidechain?: unknown };
            return (
                (event.type === "user" || event.type === "assistant" || event.type === "attachment") &&
                event.isSidechain !== true
            );
        } catch {
            return false;
        }
    });
}

// A hook's work on one session, apart from files and processes.
export type Steps = {
    record(ended: boolean): Promise<Recorded>;
    sync(): Promise<void>;
    state(phrase: string): Promise<{ reviewedThrough: number; turns: number; hidden: boolean }>;
    review(phrase: string): Promise<void>;
    activity(size: number): Promise<boolean>;
    sleep(ms: number): Promise<void>;
};

// After a reply: record and sync. A conversation never reviewed is
// reviewed at once; otherwise, once it has been idle, unless a later
// hook has it, it is recorded again and reviewed if turns are uncovered.
export async function afterStop(steps: Steps, idleMs: number): Promise<void> {
    const first = await steps.record(false);
    if (first.kind !== "recorded") {
        return;
    }
    await steps.sync();
    const state = await steps.state(first.phrase);
    if (state.hidden) {
        return;
    }
    if (state.reviewedThrough === 0 && state.turns > 0) {
        await steps.review(first.phrase);
        return;
    }
    await steps.sleep(idleMs);
    if (await steps.activity(first.size)) {
        return;
    }
    const again = await steps.record(false);
    if (again.kind !== "recorded") {
        return;
    }
    const now = await steps.state(again.phrase);
    if (!now.hidden && now.turns > now.reviewedThrough) {
        await steps.review(again.phrase);
    }
}

// At a session's end, or catching one up: record to the end, a call
// never answered recorded failed; sync; review what is uncovered.
export async function afterEnd(steps: Steps): Promise<void> {
    const done = await steps.record(true);
    if (done.kind !== "recorded") {
        return;
    }
    await steps.sync();
    const state = await steps.state(done.phrase);
    if (!state.hidden && state.turns > state.reviewedThrough) {
        await steps.review(done.phrase);
    }
}

// What one process holds while it records: the index, history, and the
// launch's project.
type Held = {
    env: Env;
    log: HookLog;
    index: RecallIndex | null;
    versions: HistoryHandle | null;
    deps: HookDeps;
    now: () => Date;
};

// Opens the index (synced, so a rebuilt one knows its sessions) and
// history, which commits without the mirror, for work; null, told at
// the next start, when neither can lock the store.
async function holding(
    env: Env,
    log: HookLog,
    deps: HookDeps,
    work: (held: Held) => Promise<void>,
): Promise<boolean> {
    let index: RecallIndex | null = null;
    try {
        index = RecallIndex.open(indexPath(env));
        const warnings = await syncIndex(index, transcriptDir(env), Date.now(), vocabularyPath(env), dataRoot(env));
        for (const warning of warnings) {
            log.warn(warning);
        }
    } catch (error) {
        log.warn(`the index can't be opened (${describeError(error)})`);
        index?.close();
        index = null;
    }
    const versions = await commandHistory({
        env,
        remindMirror: false,
        err: { write: (text: string) => log.warn(text.trim()) },
    })(index);
    if (index === null && versions === null) {
        log.error("neither the index nor history can lock the store: nothing recorded");
        await addNotice(
            env,
            "memory: a Claude Code session was not recorded: neither the memory index nor history could be opened (see claude-hook.log)",
        ).catch(() => {});
        return false;
    }
    try {
        await work({ env, log, index, versions, deps, now: deps.now ?? (() => new Date()) });
    } finally {
        versions?.close();
        index?.close();
    }
    return true;
}

async function stepsFor(held: Held, report: Omit<SessionReport, "ended">): Promise<Steps> {
    const { env, log, index, versions, deps, now } = held;
    const dir = transcriptDir(env);
    const project = (await identify(report.dir).catch(() => null))?.id ?? null;
    const timers = deps.timers ?? REAL_TIMERS;
    const { config } = await readConfig(env);
    return {
        record: async (ended) => {
            const recorded = await recordSession({ ...report, ended }, { env, index, versions, log, project, now });
            if (recorded.kind === "missing") {
                log.warn(`session ${report.session}: its transcript can't be read (${recorded.reason})`);
            }
            return recorded;
        },
        sync: async () => {
            const lock = index?.lock ?? versions?.lock;
            if (lock === undefined) {
                return;
            }
            const result = await syncProject(report.dir, {
                root: dataRoot(env),
                lock,
                recorder: versions?.recorder ?? null,
            }).catch((error: unknown) => ({ kind: "failed" as const, reason: describeError(error) }));
            if (result.kind === "failed") {
                log.warn(`sync failed: ${result.reason}`);
            }
        },
        state: async (phrase) => {
            const read = await readSidecar(dir, phrase);
            const sidecar = read.kind === "ok" ? read.sidecar : null;
            const turns = (await readTranscript(join(dir, `${phrase}.jsonl`)).catch(() => ({ turns: [] }))).turns.length;
            return {
                reviewedThrough: sidecar?.reviewedThrough ?? 0,
                turns,
                // Notes that cannot be read are never written over.
                hidden: read.kind === "unparseable" || sidecar?.hidden === true,
            };
        },
        review: async (phrase) => {
            if (index === null) {
                log.info(`no review of ${phrase} without the index; chat's catch-up will`);
                return;
            }
            const loaded = await indexCatalogue(index, dir, vocabularyPath(env), dataRoot(env)).load();
            for (const warning of loaded.warnings) {
                log.warn(warning);
            }
            const owner = `${process.pid}-${randomBytes(4).toString("hex")}`;
            const claimed = await index.claim(phrase, owner, now().getTime(), REVIEW_TIMEOUT_MS + CLAIM_MARGIN_MS);
            if (!claimed) {
                log.info(`${phrase} is under review elsewhere`);
                return;
            }
            try {
                const reviewer = new Reviewer({
                    dir,
                    config: config.memory,
                    index,
                    vocabulary: vocabularyPath(env),
                    versions,
                    call: deps.call,
                    persona: deps.persona,
                    now,
                    entries: () => loaded.entries,
                    warn: (message) => log.warn(message),
                    cost: (usd) => log.info(`review of ${phrase} cost $${usd.toFixed(4)}`),
                });
                const reviewed = await reviewer.review(phrase, new AbortController().signal);
                log.info(`review of ${phrase}: ${reviewed.kind}`);
            } finally {
                await index.release(phrase, owner);
            }
        },
        activity: (size) => activitySince(report.transcript, size),
        sleep: (ms) => sleep(timers, ms),
    };
}

const reportOf = (note: Pick<SessionNote, "session" | "transcript">, launch: LaunchNote) => ({
    session: note.session,
    transcript: note.transcript,
    dir: launch.dir,
    since: Date.parse(launch.started),
});

// Claude Code's transcript of a session, under its config directory.
async function findTranscript(claude: string, session: string): Promise<string | null> {
    const projects = join(claude, "projects");
    for (const name of await readdir(projects).catch(() => [] as string[])) {
        const path = join(projects, name, `${session}.jsonl`);
        if (((await stat(path).catch(() => null))?.size ?? 0) > 0) {
            return path;
        }
    }
    return null;
}

async function onHook(env: Env, log: HookLog, deps: HookDeps): Promise<void> {
    const input = parseHookInput(await (deps.stdin ?? (() => Bun.stdin.text()))());
    if (input === null) {
        log.error("a hook's input could not be read");
        return;
    }
    const launchId = env.DOROTHY_LAUNCH ?? "";
    const launch = isUuid(launchId) ? await readLaunch(env, launchId) : null;
    if (launch === null) {
        log.error(`session ${input.session}: ${input.event} came with no launch Dorothy noted`);
        return;
    }
    const now = deps.now ?? (() => new Date());
    await noteSession(env, launchId, {
        session: input.session,
        transcript: input.transcript,
        cwd: input.cwd,
        seen: now().toISOString(),
    });
    if (input.event === "SessionEnd") {
        (deps.spawnDetached ?? spawnDetached)([
            ...deps.self,
            "--claude-hook",
            "--catch-up",
            launchId,
            "--session",
            input.session,
        ]);
        return;
    }
    if (input.event !== "Stop") {
        log.warn(`session ${input.session}: ${input.event} is not a hook Dorothy asked for`);
        return;
    }
    const { config } = await readConfig(env);
    await holding(env, log, deps, async (held) =>
        afterStop(await stepsFor(held, reportOf(input, launch)), config.memory.idleSeconds * 1000),
    );
}

async function catchUp(
    env: Env,
    log: HookLog,
    deps: HookDeps,
    launchId: string,
    only: string | null,
): Promise<void> {
    const launch = await readLaunch(env, launchId);
    if (launch === null) {
        log.warn(`launch ${launchId}: no notes to catch up`);
        if (only === null) {
            await removeLaunch(env, launchId);
        }
        return;
    }
    let notes = await launchSessions(env, launchId);
    if (only !== null) {
        notes = notes.filter((note) => note.session === only);
    } else if (launch.session !== null && !notes.some((note) => note.session === launch.session)) {
        const transcript = await findTranscript(launch.claude, launch.session);
        if (transcript !== null) {
            notes.push({ v: 1, session: launch.session, transcript, cwd: launch.dir, seen: launch.started });
            log.warn(`session ${launch.session}: Claude Code ran no hooks; recorded at the catch-up`);
            await addNotice(
                env,
                `memory: Claude Code ran no hooks in session ${launch.session} (disableAllHooks, an untrusted folder, --bare or --safe-mode turn them off); it was recorded and reviewed when claude exited`,
            );
        }
    }
    await holding(env, log, deps, async (held) => {
        for (const note of notes) {
            await afterEnd(await stepsFor(held, reportOf(note, launch)));
        }
    });
    if (only === null) {
        await removeLaunch(env, launchId);
    }
}

async function reread(env: Env, log: HookLog, deps: HookDeps, out: Output, err: Output): Promise<number> {
    const records = await halts(env);
    if (records.length === 0) {
        out.write("dorothy: no unreadable lines are kept\n");
        return 0;
    }
    let failed = 0;
    const held = await holding(env, log, deps, async (held) => {
        for (const record of records) {
            const there = ((await stat(record.transcript).catch(() => null))?.size ?? 0) > 0;
            const steps = await stepsFor(held, {
                session: record.session,
                transcript: there ? record.transcript : copyPath(env, record.session),
                dir: record.dir,
                since: record.since,
            });
            const recorded = await steps.record(false);
            if (recorded.kind === "recorded" && !recorded.halted) {
                out.write(`dorothy: read ${record.session} to its end\n`);
                await steps.sync();
            } else {
                failed += 1;
                const kept = await halts(env);
                const now = kept.find((one) => one.session === record.session);
                err.write(
                    `dorothy: ${record.session} still can't be read${now === undefined ? "" : ` past line ${now.line} (${now.reason})`}\n`,
                );
            }
        }
    });
    if (!held) {
        err.write("dorothy: neither the memory index nor history can lock the store\n");
        return 1;
    }
    return failed === 0 ? 0 : 1;
}

function spawnDetached(cmd: string[]): void {
    const [command, ...args] = cmd;
    if (command === undefined) {
        return;
    }
    // Its own session, so claude's teardown does not take it.
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    spawn(command, args, { detached: true, stdio: "ignore" })
        .on("error", () => {})
        .unref();
}

export async function runClaudeHook(mode: HookMode, deps: HookDeps): Promise<number> {
    const env = deps.env ?? process.env;
    const out = deps.out ?? process.stdout;
    const err = deps.err ?? process.stderr;
    const log = hookLog(env, deps.now === undefined ? {} : { now: deps.now });
    if (mode.kind === "dismiss") {
        if (await dismissHalt(env, mode.session)) {
            out.write(`dorothy: ${mode.session} will not be told again; its lines stay in ${unreadDir(env)}\n`);
            return 0;
        }
        err.write(`dorothy: no unreadable session ${mode.session}\n`);
        return 1;
    }
    if (mode.kind === "reread") {
        return reread(env, log, deps, out, err);
    }
    try {
        if (mode.kind === "hook") {
            await onHook(env, log, deps);
        } else {
            await catchUp(env, log, deps, mode.launch, mode.session);
        }
    } catch (error) {
        log.error(describeError(error));
    }
    return 0;
}
```

Replace the `require` in `spawnDetached` with a top-level
`import { spawn } from "node:child_process";` (written inline here to
keep the function whole); Biome wants imports at the top.

- [ ] **Step 4: The entry point and exports**

`packages/memory/src/claude-hook.ts` (header copied from
`recall-server.ts`):

```ts
// @dorothy/memory/claude-hook: dorothy --claude-hook, which Claude
// Code's hooks run after each reply, loading the reader, the store and
// reviews alone.

export { type HookMode, runClaudeHook } from "./bodies/hook.js";
```

`packages/memory/package.json`'s `exports` gains
`"./claude-hook": "./src/claude-hook.ts"`. `workspace.test.ts`'s
entry points for `memory` become
`[".", "./claude-hook", "./commands", "./recall-server"]`.

`packages/memory/src/index.ts` gains, beside `claudeBlock`:

```ts
export {
    type LaunchNote,
    noteLaunch,
    staleLaunches,
} from "./bodies/launches.js";
export { startNotices } from "./bodies/unread.js";
```

and its comment: "dorothy --claude notes its launch, catches up those
left behind and tells what the hooks left with noteLaunch,
staleLaunches and startNotices."

- [ ] **Step 5: Run the tests**

Run: `bun test packages/memory workspace.test.ts && bun run lint:header`
Expected: PASS. The end-to-end cases run `commandHistory` on the
temporary data directory, so history is on there unless
`config.toml` says otherwise: the commits land in the temporary
repository.

- [ ] **Step 6: Commit**

```bash
git add packages/memory workspace.test.ts
git commit -m "feat(memory): Run Claude Code's hooks"
```

---

### Task 9: `dorothy --claude-hook` in the CLI

Memory's hook process (Task 8), given what its reviews need. The CLI
parses the flags, keeps `claude`'s environment for memory, which finds
the launch in it, and takes `claude`'s variables out of `process.env`,
which the Agent SDK reads at each call, before Dorothy's own `.env` is
loaded by path from this checkout. The order matters: dotenvx keeps a
variable already set, so `claude`'s own `CLAUDE_CODE_OAUTH_TOKEN` must
be gone before hers is loaded.

**Files:**

- Create: `packages/cli/src/claude-hook.ts`, `claude-hook.test.ts`
- Modify: `packages/cli/src/index.ts`, `index.test.ts`,
  `packages/memory/src/claude-hook.ts`

**Interfaces:**

- Consumes: `runClaudeHook`, `HookMode`, `HookDeps` (Task 8; this task
  adds `HookDeps` to the entry point's exports); `isUuid` (Task 2);
  `structuredCall`, `systemPrompt`, `prepareCliHome` (`@dorothy/agent`).
- Produces:
  - `Mode` gains `{ kind: "claude-hook"; hook: HookMode }`.
  - From `claude-hook.ts`: `REVIEW_DROPPED`, `reviewEnv(env): Env`,
    `checkoutRoot: string`, `loadDotenv(path, keys, into)`,
    `HookCliDeps`, `runHook(mode, deps?): Promise<number>`.

- [ ] **Step 1: Write the failing tests**

In `index.test.ts`, beside `RECALL_USAGE`:

```ts
const HOOK_USAGE =
    "--claude-hook takes [--catch-up <launch> [--session <id>]], --reread or --dismiss <session>";
```

and in `describe("parseArgs")`:

```ts
    it("runs Claude Code's hooks, catches up, rereads and dismisses", () => {
        const L = "6c84fb90-12c4-11e1-840d-7b25c5ee775a";
        const S = "0f8fad5b-d9cb-469f-a165-70867728950e";
        const hook = (argv: string[]) => parseArgs(["--claude-hook", ...argv], false);
        expect(hook([])).toEqual({ kind: "claude-hook", hook: { kind: "hook" } });
        expect(hook(["--catch-up", L])).toEqual({
            kind: "claude-hook",
            hook: { kind: "catch-up", launch: L, session: null },
        });
        expect(hook(["--catch-up", L, "--session", S])).toEqual({
            kind: "claude-hook",
            hook: { kind: "catch-up", launch: L, session: S },
        });
        expect(hook(["--reread"])).toEqual({ kind: "claude-hook", hook: { kind: "reread" } });
        expect(hook(["--dismiss", S])).toEqual({
            kind: "claude-hook",
            hook: { kind: "dismiss", session: S },
        });
        for (const rest of [
            ["--catch-up"],
            ["--catch-up", "../x"],
            ["--catch-up", L, "--session"],
            ["--catch-up", L, "--session", "x"],
            ["--catch-up", L, "--other", S],
            ["--dismiss"],
            ["--dismiss", "x"],
            ["--reread", "x"],
            ["--other"],
        ]) {
            expect(hook(rest)).toEqual({ kind: "usage", message: HOOK_USAGE });
        }
    });
```

`packages/cli/src/claude-hook.test.ts` (header copied from
`claude.test.ts`):

```ts
import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env, StructuredCall } from "@dorothy/core";
import type { HookDeps, HookMode } from "@dorothy/memory/claude-hook";
import {
    checkoutRoot,
    type HookCliDeps,
    loadDotenv,
    reviewEnv,
    runHook,
} from "./claude-hook.js";

const LAUNCH = "6c84fb90-12c4-11e1-840d-7b25c5ee775a";
const SESSION = "0f8fad5b-d9cb-469f-a165-70867728950e";

// What claude gives its hooks: the gateway, the launch, its own
// variables and its sign-in, and the user's directories.
const fromClaude = (): Env => ({
    HOME: "/home/u",
    XDG_DATA_HOME: "/home/u/data",
    PATH: "/bin",
    ANTHROPIC_BASE_URL: "http://127.0.0.1:4321",
    ENABLE_TOOL_SEARCH: "1",
    DOROTHY_LAUNCH: LAUNCH,
    CLAUDECODE: "1",
    CLAUDE_CODE_ENTRYPOINT: "cli",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_OAUTH_TOKEN: "claude's",
});

const OURS = { HOME: "/home/u", XDG_DATA_HOME: "/home/u/data", PATH: "/bin" };

describe("reviewEnv", () => {
    it("drops the gateway, the launch and claude's own variables", () => {
        expect(reviewEnv(fromClaude())).toEqual(OURS);
    });
});

describe("runHook", () => {
    function harness() {
        const env = fromClaude();
        const seen = {
            loaded: [] as string[],
            agents: 0,
            mode: undefined as HookMode | undefined,
            deps: undefined as HookDeps | undefined,
        };
        const call: StructuredCall = async () => ({ ok: false, reason: "fake", costUsd: 0 });
        const deps: HookCliDeps = {
            env,
            root: "/d",
            self: ["/bin/bun", "/d/packages/cli/src/index.ts"],
            // As dotenvx does: a variable already set is kept.
            load: (path, keys, into) => {
                seen.loaded.push(path, keys);
                into.CLAUDE_CODE_OAUTH_TOKEN ??= "dorothy's";
            },
            agent: async () => {
                seen.agents += 1;
                return { call, persona: "You are Dorothy." };
            },
            run: async (mode, given) => {
                seen.mode = mode;
                seen.deps = given;
                return 0;
            },
        };
        return { env, seen, deps };
    }

    it("reviews on Dorothy's own .env, loaded by path once claude's variables are gone", async () => {
        const { env, seen, deps } = harness();
        expect(await runHook({ kind: "hook" }, deps)).toBe(0);
        expect(seen.loaded).toEqual(["/d/.env", "/d/.env.keys"]);
        expect(env).toEqual({ ...OURS, CLAUDE_CODE_OAUTH_TOKEN: "dorothy's" });
        expect(seen.agents).toBe(1);
        expect(seen.deps?.persona).toBe("You are Dorothy.");
        expect(seen.deps?.self).toEqual(["/bin/bun", "/d/packages/cli/src/index.ts"]);
    });

    it("leaves memory the launch and the directories claude gave", async () => {
        const { seen, deps } = harness();
        await runHook({ kind: "catch-up", launch: LAUNCH, session: null }, deps);
        expect(seen.deps?.env).toMatchObject({ DOROTHY_LAUNCH: LAUNCH, XDG_DATA_HOME: "/home/u/data" });
        expect(seen.agents).toBe(1);
    });

    it("loads no agent to reread or dismiss, and refuses a review there", async () => {
        const { seen, deps } = harness();
        await runHook({ kind: "reread" }, deps);
        await runHook({ kind: "dismiss", session: SESSION }, deps);
        expect(seen.agents).toBe(0);
        const outcome = await seen.deps?.call({ what: "a review", system: "", prompt: "", schema: {}, timeoutMs: 1 });
        expect(outcome?.ok).toBe(false);
    });

    it("still runs the hook when the agent cannot load, its reviews failing", async () => {
        const { seen, deps } = harness();
        deps.agent = async () => {
            throw new Error("no sdk");
        };
        expect(await runHook({ kind: "hook" }, deps)).toBe(0);
        const outcome = await seen.deps?.call({ what: "a review", system: "", prompt: "", schema: {}, timeoutMs: 1 });
        expect(outcome).toEqual({ ok: false, reason: "the agent could not load (no sdk)", costUsd: 0 });
    });
});

describe("loadDotenv", () => {
    it("reads a .env by its path into the environment given, keeping what is set", () => {
        const dir = mkdtempSync(join(tmpdir(), "dorothy-dotenv-"));
        try {
            writeFileSync(join(dir, ".env"), "DOROTHY_PROBE=from-checkout\nDOROTHY_KEPT=from-checkout\n");
            const into: Env = { DOROTHY_KEPT: "already" };
            loadDotenv(join(dir, ".env"), join(dir, ".env.keys"), into);
            expect(into).toMatchObject({ DOROTHY_PROBE: "from-checkout", DOROTHY_KEPT: "already" });
            expect(process.env.DOROTHY_PROBE).toBeUndefined();
            // A checkout without a .env loads nothing, and says nothing.
            loadDotenv(join(dir, "none.env"), join(dir, ".env.keys"), into);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("knows this checkout", () => {
        expect(existsSync(join(checkoutRoot, "packages", "cli", "src", "claude-hook.ts"))).toBe(true);
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/cli`
Expected: FAIL (`claude-hook.js` does not exist; `--claude-hook` is an
unknown option).

- [ ] **Step 3: The entry point's `HookDeps`**

In `packages/memory/src/claude-hook.ts`, the export becomes
`export { type HookDeps, type HookMode, runClaudeHook } from "./bodies/hook.js";`.

- [ ] **Step 4: `claude-hook.ts`**

`packages/cli/src/claude-hook.ts` (header copied from `claude.ts`):

```ts
// dorothy --claude-hook: memory's hook process, given what its reviews
// need. Claude Code runs it with claude's environment: the gateway's
// URL, the launch, and claude's own variables and sign-in. Memory keeps
// that environment, to find the launch in it. Reviews run in
// process.env, which the Agent SDK reads at each call: it loses those
// variables before Dorothy's own .env is loaded by path from this
// checkout, never the working directory's. A review is then billed to
// her credentials, as chat's are, and never reaches the stopped gateway
// or the live session.

import { join, resolve } from "node:path";
import type { Env, StructuredCall } from "@dorothy/core";
import type { HookDeps, HookMode } from "@dorothy/memory/claude-hook";
import { config } from "@dotenvx/dotenvx";

// What a review must not inherit from claude, beside every CLAUDE_CODE_
// variable.
export const REVIEW_DROPPED: readonly string[] = [
    "ANTHROPIC_BASE_URL",
    "ENABLE_TOOL_SEARCH",
    "DOROTHY_LAUNCH",
    "CLAUDECODE",
];

const dropped = (name: string) =>
    REVIEW_DROPPED.includes(name) || name.startsWith("CLAUDE_CODE_");

export function reviewEnv(env: Env): Env {
    return Object.fromEntries(
        Object.entries(env).filter(([name]) => !dropped(name)),
    );
}

// The checkout this program runs from: three up from packages/cli/src.
export const checkoutRoot = resolve(import.meta.dir, "..", "..", "..");

// A .env, by its path and its keys file's, into an environment. A
// variable already set is kept, as the entry guard's config() keeps it.
export function loadDotenv(path: string, keys: string, into: Env): void {
    config({
        path,
        envKeysFile: keys,
        processEnv: into as Record<string, string>,
        quiet: true,
        ignore: ["MISSING_ENV_FILE"],
    });
}

type Agent = { call: StructuredCall; persona: string };

export type HookCliDeps = {
    // process.env: claude's environment, which reviews read at each call.
    env?: Env;
    // The checkout whose .env is loaded.
    root?: string;
    // This program as a command, for the detached catch-up.
    self?: readonly string[];
    load?: (path: string, keys: string, into: Env) => void;
    agent?: () => Promise<Agent>;
    run?: (mode: HookMode, deps: HookDeps) => Promise<number>;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

async function loadAgent(): Promise<Agent> {
    const { prepareCliHome, structuredCall, systemPrompt } = await import(
        "@dorothy/agent"
    );
    prepareCliHome();
    return { call: structuredCall(), persona: systemPrompt };
}

// For the modes that never review, and for a hook whose agent cannot
// load: the call fails, and the reviewer logs why.
const refusing =
    (reason: string): StructuredCall =>
    async () => ({ ok: false, reason, costUsd: 0 });

export async function runHook(
    mode: HookMode,
    deps: HookCliDeps = {},
): Promise<number> {
    const env = deps.env ?? process.env;
    const given: Env = { ...env };
    for (const name of Object.keys(env)) {
        if (dropped(name)) {
            delete env[name];
        }
    }
    const root = deps.root ?? checkoutRoot;
    try {
        (deps.load ?? loadDotenv)(
            join(root, ".env"),
            join(root, ".env.keys"),
            env,
        );
    } catch {
        // Without her credentials a review fails, and says so in the log.
    }
    let agent: Agent = {
        call: refusing("reviews are not run here"),
        persona: "",
    };
    if (mode.kind === "hook" || mode.kind === "catch-up") {
        try {
            agent = await (deps.agent ?? loadAgent)();
        } catch (error) {
            agent = {
                call: refusing(
                    `the agent could not load (${describeError(error)})`,
                ),
                persona: "",
            };
        }
    }
    const run =
        deps.run ??
        (await import("@dorothy/memory/claude-hook")).runClaudeHook;
    return run(mode, {
        env: given,
        call: agent.call,
        persona: agent.persona,
        self: deps.self ?? [process.execPath, resolve(process.argv[1] ?? "")],
    });
}
```

`reviewEnv` is the rule `runHook` applies in place; it is exported for
the test that pins the rule and for the report.

- [ ] **Step 5: The flags and the mode**

In `packages/cli/src/index.ts`: import `isUuid` beside `isPhrase`, and
`import type { HookMode } from "@dorothy/memory/claude-hook";` beside
the `PersonaMode` import (a type, erased, so nothing loads). `Mode`
gains `| { kind: "claude-hook"; hook: HookMode }`. `USAGE` gains, after
the `--recall-server` line:

```ts
    "       dorothy --claude-hook      internal: what --claude's hooks run",
    "       dorothy --claude-hook --reread | --dismiss <session>",
    "                                  read again the Claude Code lines she",
    "                                  could not, or stop telling of them",
```

After `parseDump`:

```ts
const HOOK_USAGE =
    "--claude-hook takes [--catch-up <launch> [--session <id>]], --reread or --dismiss <session>";

function parseHook(rest: readonly string[]): Mode {
    const hook = (mode: HookMode): Mode => ({ kind: "claude-hook", hook: mode });
    const [flag, value, next, session] = rest;
    if (flag === undefined) {
        return hook({ kind: "hook" });
    }
    if (flag === "--reread" && rest.length === 1) {
        return hook({ kind: "reread" });
    }
    if (flag === "--dismiss" && rest.length === 2 && isUuid(value ?? "")) {
        return hook({ kind: "dismiss", session: value as string });
    }
    if (flag === "--catch-up" && isUuid(value ?? "")) {
        const launch = value as string;
        if (rest.length === 2) {
            return hook({ kind: "catch-up", launch, session: null });
        }
        if (rest.length === 4 && next === "--session" && isUuid(session ?? "")) {
            return hook({ kind: "catch-up", launch, session: session as string });
        }
    }
    return { kind: "usage", message: HOOK_USAGE };
}
```

and in `parseArgs`, before `--claude`:

```ts
    if (first === "--claude-hook") {
        return parseHook(rest);
    }
```

The entry guard, before the `claude` mode:

```ts
    } else if (mode.kind === "claude-hook") {
        // No config(): the hook loads Dorothy's .env by path, once
        // claude's variables are gone (claude-hook.ts).
        const { runHook } = await import("./claude-hook.js");
        const code = await runHook(mode.hook);
        // A hook and a catch-up end here, as chat does: nothing they
        // started may keep a process of Claude Code's hooks alive.
        if (mode.hook.kind === "hook" || mode.hook.kind === "catch-up") {
            process.exit(code);
        }
        process.exitCode = code;
```

- [ ] **Step 6: Run the tests**

Run: `bun test packages/cli && bun run check`
Expected: PASS. If `index.test.ts` pins `USAGE`'s width or its lines,
the new lines keep within it.

- [ ] **Step 7: Commit**

```bash
git add packages/cli packages/memory/src/claude-hook.ts
git commit -m "feat(cli): Run Claude Code's hooks with her keys"
```

---

### Task 10: `dorothy --claude` records her sessions

The launch: an id in `claude`'s environment, the launch noted before
`claude` starts, the hooks in `--settings`, `--session-id` for a new
session, a catch-up when `claude` exits and of launches left behind at
the next start, and what the hooks could not tell, said before `claude`
takes the terminal. The block leaves out the conversation of a session
resumed by id (a carry-over from delivery).

**Files:**

- Modify: `packages/cli/src/claude.ts`, `claude.test.ts`,
  `claude-dump.test.ts`
- Modify: `packages/memory/src/bodies/launch.ts`, `launch.test.ts`

**Interfaces:**

- Consumes: `noteLaunch`, `staleLaunches`, `startNotices`, `LaunchNote`
  (Task 8, from `@dorothy/memory`); `sessionPhrase` (Task 3); `isUuid`
  (Task 2); `dorothy --claude-hook` (Task 9).
- Produces:
  - `claudeBlock({ env, session })`: `session`, a Claude Code session
    id, whose conversation the block leaves out; `null` by default.
  - `ClaudeMemory` gains `block(env, session)`, `note(note, env)`,
    `stale(env)`, `notices(env)`.
  - `ClaudeDeps` gains `spawnDetached`, `newId`, `now`; `Launch` gains
    `launch: string | null`.
  - `ClaudeSession`, `claudeSession(args)`, `hookSettings(self)`,
    `claudeConfigDir(env)`, `END_TIMEOUT_S = 10`.

- [ ] **Step 1: Write the failing tests**

`packages/memory/src/bodies/launch.test.ts`, in `describe("claudeBlock")`
(`newPhrase`, `sidecarPath` and `EMPTY_SIDECAR` are imported already):

```ts
    it("leaves out the conversation of a session the arguments resume", async () => {
        const dir = join(home, "data", "dorothy", "transcripts");
        await mkdir(dir, { recursive: true });
        const S = "0f8fad5b-d9cb-469f-a165-70867728950e";
        const at = new Date().toISOString();
        const resumed = newPhrase();
        const other = newPhrase();
        const lines = (events: object[]) => events.map((event) => `${JSON.stringify(event)}\n`).join("");
        await writeFile(
            join(dir, `${resumed}.jsonl`),
            lines([
                { v: 1, kind: "session", at, phrase: resumed, sdkSessionId: "", model: "m", promptHash: "", resumed: false, source: "claude-code", sourceSession: S },
                { v: 1, kind: "user", at, text: "hello" },
            ]),
        );
        await writeFile(join(dir, `${other}.jsonl`), lines([{ v: 1, kind: "user", at, text: "hi" }]));
        for (const [phrase, title] of [
            [resumed, "Resumed"],
            [other, "Other"],
        ] as const) {
            await writeFile(sidecarPath(dir, phrase), JSON.stringify({ ...EMPTY_SIDECAR, title, description: "A chat." }));
        }
        expect((await claudeBlock({ env })).block).toContain("<title>Resumed</title>");
        const { block } = await claudeBlock({ env, session: S });
        expect(block).not.toContain("<title>Resumed</title>");
        expect(block).toContain("<title>Other</title>");
        expect((await claudeBlock({ env, session: "1a9fbe6c-eadc-4a7f-b276-81978839a61f" })).block).toContain(
            "<title>Resumed</title>",
        );
    });
```

In `packages/cli/src/claude.test.ts`, import `hookSettings` and
`type ClaudeMemory` from `./claude.js` and `type LaunchNote` from
`@dorothy/memory`, and add after the imports:

```ts
const LAUNCH = "6c84fb90-12c4-11e1-840d-7b25c5ee775a";
const SESSION = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER = "7d95fc01-23d5-42f2-951e-8c36d6ff886b";
const SELF = ["/bin/bun", "/d/index.ts"];
```

In `harness`: `calls` gains `spawned: [] as string[][]`; `memory`
becomes

```ts
    const memory = {
        synced: [] as string[],
        blocks: 0,
        blockFor: [] as (string | null)[],
        noted: [] as Omit<LaunchNote, "v">[],
        // What the fakes answer: launches left behind, notices left.
        stale: [] as string[],
        notices: [] as string[],
    };
```

and `deps` gains, its `memory` replaced:

```ts
        memory: {
            block: async (_env, session) => {
                memory.blocks += 1;
                memory.blockFor.push(session);
                return { block: "<memory>m</memory>", warnings: [] };
            },
            sync: async (dir) => {
                memory.synced.push(dir);
                return null;
            },
            note: async (note) => {
                memory.noted.push(note);
            },
            stale: async () => memory.stale,
            notices: async () => memory.notices,
        },
        spawnDetached: (cmd) => {
            calls.spawned.push(cmd);
        },
        newId: (() => {
            const ids = [LAUNCH, SESSION];
            return () => ids.shift() ?? "no more ids";
        })(),
        now: () => new Date("2026-10-15T09:00:00.000Z"),
```

(`self` is already `SELF`'s value; use `SELF` there.) The tests that
replace `deps.memory` with `{ block, sync }` spread the harness's first:
`deps.memory = { ...(deps.memory as ClaudeMemory), block: ..., sync: ... }`.

Existing expectations that change, since with memory on every launch
is noted and passes its hooks and a new session's id:

- `describe("dorothy --claude with memory")`'s `SETTINGS` becomes
  `--settings=${JSON.stringify({ permissions: { allow: [...] }, ...hookSettings(SELF) })}`
  (the `allow` list as it is), and the first test's `cmd` gains
  `` `--session-id=${SESSION}` `` after `MCP`.
- "serves no recall with recall off, but keeps the block" expects
  `cmd` to be `["/bin/claude", "--append-system-prompt", MARKER,
  `--settings=${JSON.stringify(hookSettings(SELF))}`,
  `--session-id=${SESSION}`]`.
- "runs claude as today with memory off" sets
  `deps.env = { ...deps.env, DOROTHY_LAUNCH: OTHER }` before running,
  expects `memory` `toMatchObject({ synced: [], blocks: 0, noted: [] })`,
  `calls.env.DOROTHY_LAUNCH` undefined (a launch it runs inside is not
  its own) and `calls.spawned` empty.
- "merges it into a private file" expects the file's JSON to hold
  `...hookSettings(SELF)` beside `env` and `permissions`.

Then a new block:

```ts
describe("dorothy --claude records her sessions", () => {
    const HOOK = "'/bin/bun' '/d/index.ts' '--claude-hook'";

    it("notes the launch, names a new session, and passes hooks that run this program", async () => {
        const { calls, deps, memory } = harness(0, true);
        deps.config = async () => ({
            config: { ...DEFAULT_CONFIG, memory: { ...DEFAULT_CONFIG.memory, recall: false } },
            warnings: [],
        });
        expect(await runClaude(["-p", "hi"], deps)).toBe(0);
        expect(memory.noted).toEqual([
            {
                launch: LAUNCH,
                pid: process.pid,
                started: "2026-10-15T09:00:00.000Z",
                dir: "/work",
                session: SESSION,
                claude: "/home/u/.claude",
            },
        ]);
        expect(calls.env.DOROTHY_LAUNCH).toBe(LAUNCH);
        expect(calls.cmd).toEqual([
            "/bin/claude",
            "--append-system-prompt",
            MARKER,
            `--settings=${JSON.stringify({
                hooks: {
                    Stop: [{ hooks: [{ type: "command", command: HOOK, async: true }] }],
                    SessionEnd: [{ hooks: [{ type: "command", command: HOOK, timeout: 10 }] }],
                },
            })}`,
            `--session-id=${SESSION}`,
            "-p",
            "hi",
        ]);
    });

    it("takes Claude Code's config directory from claude's environment", async () => {
        const { deps, memory } = harness(0, true);
        deps.env = { ...deps.env, CLAUDE_CONFIG_DIR: "/cfg" };
        await runClaude([], deps);
        expect(memory.noted[0]?.claude).toBe("/cfg");
    });

    it("catches up its launch once claude exits, in a process of its own", async () => {
        const { calls, deps } = harness(0, true);
        await runClaude([], deps);
        expect(calls.spawned).toEqual([[...SELF, "--claude-hook", "--catch-up", LAUNCH]]);
    });

    it("catches up launches left behind and tells what hooks left, with memory off too", async () => {
        const { calls, deps, memory } = harness(0, false);
        memory.stale = [OTHER];
        memory.notices = ["memory: Claude Code ran no hooks in session x"];
        await runClaude([], deps);
        expect(calls.spawned).toEqual([[...SELF, "--claude-hook", "--catch-up", OTHER]]);
        expect(calls.err).toBe("dorothy: memory: Claude Code ran no hooks in session x\n");
        expect(memory.noted).toEqual([]);
    });

    it("lets the arguments choose the session, leaving a resumed one's conversation out of the block", async () => {
        // The arguments, the session noted, the one the block leaves out.
        const cases: [string[], string | null, string | null][] = [
            [["--resume", OTHER], null, OTHER],
            [["-r", OTHER, "-p", "x"], null, OTHER],
            [[`--resume=${OTHER}`], null, OTHER],
            [["--resume", "my-title"], null, null],
            [["--resume"], null, null],
            [["-c"], null, null],
            [["--continue", "-p", "x"], null, null],
            [["--from-pr", "12"], null, null],
            [["--session-id", OTHER], OTHER, null],
            [[`--session-id=${OTHER}`], OTHER, null],
            [["-p", "--", "--resume", OTHER], SESSION, null],
        ];
        for (const [args, noted, left] of cases) {
            const { calls, deps, memory } = harness(0, true);
            await runClaude(args, deps);
            expect([args, memory.noted[0]?.session ?? null]).toEqual([args, noted]);
            expect([args, memory.blockFor]).toEqual([args, [left]]);
            expect([args, calls.cmd.includes(`--session-id=${SESSION}`)]).toEqual([args, noted === SESSION]);
        }
    });

    it("records nothing when the launch cannot be noted, saying so", async () => {
        const { calls, deps } = harness(0, true);
        deps.memory = {
            ...(deps.memory as ClaudeMemory),
            note: async () => {
                throw new Error("read-only");
            },
        };
        await runClaude([], deps);
        expect(calls.err).toBe(
            "dorothy: this launch could not be noted (read-only); its sessions will not be recorded\n",
        );
        expect(calls.env.DOROTHY_LAUNCH).toBeUndefined();
        expect(calls.cmd.some((arg) => arg.includes("--claude-hook") || arg.startsWith("--session-id"))).toBe(false);
        expect(calls.spawned).toEqual([]);
    });

    it("goes on when memory cannot say what was left behind", async () => {
        const { calls, deps } = harness(0, false);
        deps.memory = {
            ...(deps.memory as ClaudeMemory),
            stale: async () => {
                throw new Error("no runtime directory");
            },
            notices: async () => {
                throw new Error("no state directory");
            },
        };
        expect(await runClaude([], deps)).toBe(0);
        expect(calls.err).toBe("");
    });
});
```

`claude-dump.test.ts`: its fake `memory` gains `note`, `stale` and
`notices`, each throwing `new Error("not in a dump")`, and the test
that expects `memory.synced` to be empty also expects the command it
ran to hold neither `--claude-hook` nor `--session-id`
(`calls.cmd.join(" ")`, or what the harness records it as).

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/cli packages/memory/src/bodies/launch.test.ts`
Expected: FAIL (`hookSettings` is not exported; no launch is noted;
the block leaves nothing out).

- [ ] **Step 3: The block leaves a resumed session out**

In `packages/memory/src/bodies/launch.ts`, import `sessionPhrase` from
`../recall/sync.js`; `claudeBlock`'s comment and signature become:

```ts
// Chat's block, its preamble and budget from config.toml, leaving out
// the conversation of session, the Claude Code session the arguments
// resume by id, as chat leaves out the live one. Its warnings are its
// own; the caller reads and reports config.toml's.
export async function claudeBlock({
    env = process.env,
    session = null,
}: {
    env?: Env;
    session?: string | null;
} = {}): Promise<{ block: string; warnings: string[] }> {
```

and, once `loaded` is read (its load has synced the index):

```ts
        const built = buildMemory(loaded.entries, {
            now: Date.now(),
            config: config.memory,
            exclude: session === null ? null : sessionPhrase(index, session),
        });
```

- [ ] **Step 4: `claude.ts`**

Imports: `spawn as spawnChild` from `node:child_process`, `homedir`
from `node:os`, `isUuid` from `@dorothy/core`, and
`import type { LaunchNote } from "@dorothy/memory";` (a type, erased:
the CLI still loads memory lazily).

`ClaudeDeps` gains:

```ts
    // Starts a process that outlives dorothy and the terminal, for a
    // catch-up.
    spawnDetached?: (cmd: string[]) => void;
    // A new uuid, for a launch and a new session.
    newId?: () => string;
    now?: () => Date;
```

`ClaudeMemory` and `MEMORY` become:

```ts
// What --claude asks of memory, loaded only when it is asked.
export type ClaudeMemory = {
    // Chat's memory block, rendered by chat's code, leaving out the
    // conversation of the session the arguments resume by id; "" for
    // none.
    block(
        env: Env,
        session: string | null,
    ): Promise<{ block: string; warnings: string[] }>;
    // Syncs the project of a directory, if it is in one: null, or why
    // the sync failed.
    sync(dir: string, env: Env): Promise<string | null>;
    // Notes the launch, for its hooks, its recall server and its
    // catch-up.
    note(note: Omit<LaunchNote, "v">, env: Env): Promise<void>;
    // The launches whose dorothy is gone, left to catch up.
    stale(env: Env): Promise<string[]>;
    // What hooks could not tell, and the lines left unread.
    notices(env: Env): Promise<string[]>;
};

const MEMORY: ClaudeMemory = {
    block: async (env, session) =>
        (await import("@dorothy/memory")).claudeBlock({ env, session }),
    sync: async (dir, env) =>
        (await import("@dorothy/memory")).syncDirectory(dir, { env }),
    note: async (note, env) =>
        (await import("@dorothy/memory")).noteLaunch(env, note),
    stale: async (env) =>
        (await import("@dorothy/memory")).staleLaunches(env),
    notices: async (env) =>
        (await import("@dorothy/memory")).startNotices(env),
};
```

After `claudeArgs`:

```ts
// How claude's arguments start its session, from those before --.
export type ClaudeSession =
    // A new session, which Dorothy names with --session-id.
    | { kind: "new" }
    // The user named it with their own --session-id.
    | { kind: "named"; id: string }
    // Continued or resumed: by id where the arguments name one. A
    // malformed --session-id is here too; claude refuses it.
    | { kind: "resumed"; id: string | null };

const RESUMING: ReadonlySet<string> = new Set([
    "-c",
    "--continue",
    "-r",
    "--resume",
    "--from-pr",
]);

export function claudeSession(args: readonly string[]): ClaudeSession {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index] as string;
        if (arg === "--") {
            break;
        }
        const equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
        const flag = equals === -1 ? arg : arg.slice(0, equals);
        const value = equals === -1 ? args[index + 1] : arg.slice(equals + 1);
        const id = value !== undefined && isUuid(value) ? value : null;
        if (flag === "--session-id") {
            return id === null
                ? { kind: "resumed", id: null }
                : { kind: "named", id };
        }
        if (RESUMING.has(flag)) {
            return {
                kind: "resumed",
                id: flag === "-r" || flag === "--resume" ? id : null,
            };
        }
    }
    return { kind: "new" };
}

// SessionEnd's hook only hands its session to a detached catch-up.
export const END_TIMEOUT_S = 10;

// Claude Code runs a hook's command through a shell: each word quoted.
const shellWord = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;

// Dorothy's hooks, this program run again: after each reply, off its
// path (async), and at the session's end.
export function hookSettings(self: readonly string[]): Json {
    const command = [...self, "--claude-hook"].map(shellWord).join(" ");
    return {
        hooks: {
            Stop: [{ hooks: [{ type: "command", command, async: true }] }],
            SessionEnd: [
                {
                    hooks: [
                        { type: "command", command, timeout: END_TIMEOUT_S },
                    ],
                },
            ],
        },
    };
}

// Claude Code's config directory, under whose projects/ its transcripts
// are.
export const claudeConfigDir = (env: Env) =>
    env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude");

// This program as a command: the interpreter and the entry script it
// was started with, so bun run dev records too.
const selfCommand = () => [process.execPath, resolve(process.argv[1] ?? "")];

// A process of its own session, which outlives dorothy and a terminal
// that hangs up.
function spawnDetached(cmd: string[]): void {
    const [command, ...rest] = cmd;
    if (command === undefined) {
        return;
    }
    spawnChild(command, rest, { detached: true, stdio: "ignore" })
        .on("error", () => {})
        .unref();
}
```

`Launch` gains:

```ts
    // The launch noted for recording, caught up once claude exits; null
    // when nothing is recorded.
    launch: string | null;
```

In `launchClaude`, the destructured deps gain `newId = () =>
crypto.randomUUID()` and `now = () => new Date()`, and `self`'s
default becomes `selfCommand()`. The block's call becomes:

```ts
    const session = claudeSession(args);
    let section = "";
    if (on) {
        try {
            const built = await memory.block(
                env,
                session.kind === "resumed" ? session.id : null,
            );
```

with the rest of that `try` unchanged. After the gateway has started,
and before `const recall = ...`:

```ts
    // Her sessions are recorded by hooks, under a launch noted before
    // claude starts; a launch that cannot be noted records nothing.
    let noted: string | null = null;
    let named: string | null = null;
    if (on && run) {
        const id = newId();
        named =
            session.kind === "new"
                ? newId()
                : session.kind === "named"
                  ? session.id
                  : null;
        try {
            await memory.note(
                {
                    launch: id,
                    pid: process.pid,
                    started: now().toISOString(),
                    dir,
                    session: named,
                    claude: claudeConfigDir(shell.env),
                },
                env,
            );
            noted = id;
        } catch (error) {
            write(
                `dorothy: this launch could not be noted (${describeError(error)}); its sessions will not be recorded\n`,
            );
        }
    }
```

The flags become:

```ts
    const recall = on && run && config.memory.recall;
    const settings: Json = {
        ...(recall
            ? { permissions: { allow: [...CLAUDE_ALLOWED_TOOLS] } }
            : {}),
        ...(noted === null ? {} : hookSettings(self)),
    };
    const flagged = dorothyFlags(
        noted !== null && session.kind === "new"
            ? [`--session-id=${named}`, ...args]
            : args,
        {
            settings: Object.keys(settings).length > 0 ? settings : null,
            mcpConfig: recall
                ? // ... as it is
                : null,
        },
        { cwd: dir, read, writePrivate },
    );
```

and the launch:

```ts
    const launchEnv: Env = {
        ...shell.env,
        ANTHROPIC_BASE_URL: gateway.url,
        // Claude Code turns tool search off for a base URL not
        // Anthropic's; a user's own choice stands.
        ENABLE_TOOL_SEARCH: env.ENABLE_TOOL_SEARCH ?? "1",
        // remember is her one way to write a memory in her sessions.
        ...(on ? { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } : {}),
        // Her hooks and her recall server find the launch by it.
        ...(noted === null ? {} : { DOROTHY_LAUNCH: noted }),
    };
    if (noted === null) {
        // A launch this one runs inside is not this one's.
        delete launchEnv.DOROTHY_LAUNCH;
    }
    const launch: Launch = {
        cmd: [claude, ...claudeArgs(flagged.args)],
        env: launchEnv,
        gateway,
        launch: noted,
        cleanup: ...as it is,
    };
```

`runClaude` becomes:

```ts
export async function runClaude(
    args: readonly string[],
    deps: ClaudeDeps = {},
): Promise<number> {
    const {
        env = process.env,
        spawn = spawnInherited,
        write = (text) => {
            process.stderr.write(text);
        },
        signals = process,
        memory = MEMORY,
        self = selfCommand(),
        spawnDetached: detach = spawnDetached,
    } = deps;
    const catchUp = (launch: string) =>
        detach([...self, "--claude-hook", "--catch-up", launch]);
    // Launches whose dorothy was killed before its catch-up, with memory
    // off too: their notes were written with it on.
    for (const launch of await memory.stale(env).catch(() => [])) {
        catchUp(launch);
    }
    // What hooks could not tell, and lines left unread, before claude
    // takes the terminal.
    for (const notice of await memory.notices(env).catch(() => [])) {
        write(`dorothy: ${notice}\n`);
    }
    const launch = await launchClaude(args, upstreamFrom(env), {
        ...deps,
        write,
        self,
    });
```

with the rest as it is, and in its `finally`, after
`warnDrift(...)`:

```ts
        // Its sessions recorded, synced and reviewed as SessionEnd would,
        // by a process that outlives this one.
        if (launch.launch !== null) {
            catchUp(launch.launch);
        }
```

`claude-dump.ts` needs no change: its launch is a dump, which notes
nothing; `launch.launch` is `null` there.

If Task 1 found that a hook or an MCP server does not inherit
`DOROTHY_LAUNCH`, the hook's command or the recall server's `args` also
carries `--launch <id>` here, `parseHook` and the recall server's flags
take it, and Tasks 8 and 11 read it before the variable; the report
says so.

- [ ] **Step 5: Run the tests**

Run: `bun test packages/cli packages/memory && bun run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli packages/memory/src/bodies
git commit -m "feat(cli): Record her Claude Code sessions"
```

---

### Task 11: Recall in Claude Code, notices in chat, and `--check`

The recall server leaves the live session's conversation out of its
lookups and names it as `remember`'s `from` (a carry-over from
delivery); chat tells at its start what the hooks could not; `--check`
lists what is kept aside.

**Files:**

- Modify: `test-setup.ts`
- Modify: `packages/memory/src/recall/server.ts`, `server.test.ts`
- Modify: `packages/memory/src/memory/open.ts`, `open.test.ts`
- Modify: `packages/memory/src/history/commands.ts`, `commands.test.ts`

**Interfaces:**

- Consumes: `liveSession` (Task 5), `sessionPhrase` (Task 3),
  `startNotices`, `unreadReport`, `addNotice`, `keepHalt`, `stateDir`
  (Task 5), `isUuid` (Task 2).
- Produces: `RecallServerOptions.liveSession?: (() => Promise<string |
  null>) | null`; chat's `Memory.warnings` holds the start notices;
  `runCheck` lists `unreadReport`'s lines.

- [ ] **Step 1: No test touches the user's state or runtime directory**

`openMemory` reads the state directory from `process.env` once this
task's Step 6 is in, and `startNotices` moves what it reads. In
`test-setup.ts`, after the cache directory:

```ts
// Recording keeps unread lines and notices in the state directory and
// notes launches in the runtime directory; no test may touch the
// user's.
process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "dorothy-state-"));
process.env.XDG_RUNTIME_DIR = mkdtempSync(join(tmpdir(), "dorothy-run-"));
```

Run: `bun run test`
Expected: PASS.

```bash
git add test-setup.ts
git commit -m "test: Keep tests off the user's state"
```

- [ ] **Step 2: Write the failing server test**

In `packages/memory/src/recall/server.test.ts`, import `appendFile`
beside `writeFile`, and add:

```ts
describe("the recall server in Claude Code", () => {
    const S = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const begun = (phrase: string) =>
        `${JSON.stringify({ v: 1, kind: "session", at: "2026-10-04T12:00:00.000Z", phrase, sdkSessionId: "", model: "m", promptHash: "", resumed: false, source: "claude-code", sourceSession: S })}\n`;
    const found = async (client: Client) =>
        (
            JSON.parse(
                textOf(await client.callTool({ name: "search", arguments: { query: "render", kind: "conversations" } })),
            ) as SearchResult
        ).results
            .map((hit) => hit.identifier)
            .sort();

    it("leaves out the live session's conversation once a hook has recorded it, and remembers from it", async () => {
        let live: string | null = null;
        const client = await connect({ exclude: null, facts: dir, liveSession: async () => live });
        expect(await found(client)).toEqual([A, LIVE].sort());
        // A session no hook has recorded yet has no conversation to leave out.
        live = S;
        expect(await found(client)).toEqual([A, LIVE].sort());
        // A hook records it as a resumed session would be: appended.
        await appendFile(join(dir, `${LIVE}.jsonl`), begun(LIVE));
        expect(await found(client)).toEqual([A]);
        await client.callTool({
            name: "remember",
            arguments: { action: "write", name: "tea", scope: "personal", type: "user", title: "Tea", description: "Tea at four.", body: "Every day." },
        });
        const read = await readFactFile(factPath(dir, PERSONAL, "tea"), "tea");
        expect(read.kind === "ok" && read.fact.provenance.from).toBe(LIVE);
    });

    it("leaves out the conversation chat names, whatever the launch says", async () => {
        await writeFile(join(dir, `${A}.jsonl`), begun(A) + user("the render bug again"));
        const client = await connect({ liveSession: async () => S });
        expect(await found(client)).toEqual([A]);
    });
});
```

Run: `bun test packages/memory/src/recall/server.test.ts`
Expected: FAIL (`liveSession` is not an option; `LIVE` is found).

- [ ] **Step 3: The server finds the live conversation at each call**

In `packages/memory/src/recall/server.ts`, import `isUuid` beside
`readConfig`, `liveSession` from `../bodies/launches.js`, and
`sessionPhrase` beside `syncIndex`. `RecallServerOptions` gains, after
`exclude`:

```ts
    // In Claude Code: the session live in the launch, read at each call,
    // whose conversation is left out and named as remember's from. A
    // hook records it only after its first reply, and /clear replaces
    // it. exclude, chat's, comes first.
    liveSession?: (() => Promise<string | null>) | null;
```

In `createRecallServer`, before `answer`:

```ts
    const excluded = async (index: RecallIndex): Promise<string | null> => {
        if (options.exclude !== null || !options.liveSession) {
            return options.exclude;
        }
        const session = await options.liveSession();
        return session === null ? null : sessionPhrase(index, session);
    };
```

`answer`'s `work` becomes `(index: RecallIndex, exclude: string |
null) => unknown`, and after its `syncIndex`:

```ts
            const exclude = await excluded(ready);
            const result = await ready.exclusive(() => work(ready, exclude));
```

The `search`, `open` and `tags` handlers take `(index, exclude)` and
pass `exclude` where they passed `options.exclude`. `write`'s `work`
becomes `(store: FactStore, from: string | null) => Promise<unknown>`,
called as `work({ ...as it is }, await excluded(index))` once `index`
is open, and `remember`'s handler becomes
`write((store, from) => remember(store, input, { project, from }))`.
`recollect` keeps `options.exclude`: it is chat's alone.

`runRecallServer`, before `createRecallServer`:

```ts
    // Claude Code's server inherits its launch; chat's, which names its
    // conversation, may too when chat runs inside her Claude Code.
    const launch = env.DOROTHY_LAUNCH ?? "";
```

and `createRecallServer` gains
`liveSession: isUuid(launch) ? () => liveSession(env, launch) : null,`.

Run: `bun test packages/memory/src/recall`
Expected: PASS.

```bash
git add packages/memory/src/recall
git commit -m "feat(memory): Know the live Claude Code session"
```

- [ ] **Step 4: Write the failing tests for chat and `--check`**

`packages/memory/src/memory/open.test.ts`: `XDG` gains
`"XDG_STATE_HOME"`; import `addNotice` and `stateDir` from
`../bodies/unread.js`; "reads and writes only under the test's
directory" adds `stateDir(process.env)` to its paths; and in
`describe("openMemory")`:

```ts
    it("tells at its start what Claude Code's hooks could not", async () => {
        await addNotice(env, "memory: Claude Code ran no hooks in session x");
        const opened = await openMemory({
            resume: null,
            call: quiet,
            prompts,
            connect: () => new FakeSession(),
            recallLaunch: (phrase) => ({ command: "x", args: [phrase] }),
            env,
        });
        if (!opened.ok) {
            throw new Error(opened.message);
        }
        try {
            expect(opened.memory.warnings).toContain("memory: Claude Code ran no hooks in session x");
        } finally {
            await opened.memory.close();
        }
    });
```

`packages/memory/src/history/commands.test.ts`, import `keepHalt` from
`../bodies/unread.js`, and in `runCheck`'s block:

```ts
    it("lists the lines recording kept aside, leaving the exit code alone", async () => {
        const S = "0f8fad5b-d9cb-469f-a165-70867728950e";
        write("tags.json", vocabulary(1));
        await keepHalt(
            env,
            { session: S, conversation: null, transcript: "/t.jsonl", dir: "/w", since: null, line: 3, type: "user", uuid: "u3", reason: "a user line without its content", at: NOW.toISOString() },
            ["{bad"],
        );
        expect(await runCheck(options())).toBe(0);
        expect(out.text).toContain(`unread: ${S} (no conversation yet), line 3: a user line without its content`);
    });
```

(`env`'s `HOME` is the test's own, so the state directory falls back
under it.)

Run: `bun test packages/memory/src/memory/open.test.ts packages/memory/src/history/commands.test.ts`
Expected: FAIL (no notice among the warnings; no `unread:` line).

- [ ] **Step 5: Chat tells them**

In `packages/memory/src/memory/open.ts`, import `startNotices` from
`../bodies/unread.js`, and after
`warnings.push(...configWarnings);`:

```ts
    // What Claude Code's hooks could not tell, and lines left unread,
    // told at chat's start as at dorothy --claude's.
    warnings.push(...(await startNotices(env).catch(() => [])));
```

- [ ] **Step 6: `--check` lists them**

In `packages/memory/src/history/commands.ts`, import `unreadReport`
from `../bodies/unread.js`, and `runCheck`'s last branch becomes:

```ts
        const code = report(
            await checkTree(root, committed ? repo : null),
            out,
        );
        // What recording kept aside, and errors in its hook's log: not
        // memory's files, so the exit code is the lint's alone.
        for (const line of await unreadReport(env)) {
            out.write(`${line}\n`);
        }
        return code;
```

The staged check, the pre-commit hook's, is left alone.

- [ ] **Step 7: Run the tests**

Run: `bun test packages/memory && bun run check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/memory
git commit -m "feat(memory): Tell chat and --check what is unread"
```

---

### Task 12: Guides, spec, report and verification

**Files:**

- Modify: `packages/memory/src/bodies/AGENTS.md`,
  `packages/memory/AGENTS.md`, `packages/cli/AGENTS.md`,
  `packages/core/AGENTS.md`
- Modify: `docs/specs/2026-10-15-memory-bodies-design.md`
- Modify: `docs/reports/2026-10-15-memory-bodies.md`

- [ ] **Step 1: The bodies guide**

In `packages/memory/src/bodies/AGENTS.md`, keep the frontmatter and
breadcrumb, end the `description` with "and the hooks that record her
Claude Code sessions.", and replace everything from the title on with:

```markdown
# packages/memory/src/bodies/AGENTS.md

Dorothy's bodies other than chat. Chat opens memory with `openMemory`;
`dorothy --claude` asks memory, through the package's `"."` entry
point, for what its launch needs, and Claude Code's hooks run
`dorothy --claude-hook`, served from `"./claude-hook"`, which loads the
reader, the store and reviews alone. The CLI loads both lazily.

## Files

- `launch.ts`: `claudeBlock` renders chat's memory block with chat's
  code, preamble and budget, leaving out the conversation of a session
  resumed by id; `syncDirectory` syncs the project of the directory
  `claude` starts in, under the index's lock, history committing
  without the mirror.
- `claude-code.ts`: `readLines`, Claude Code's transcript lines as
  Dorothy's events, pure; `BOOKKEEPING` lists the types passed over in
  silence. `fixtures.ts` holds lines shaped as the recording probe
  found them, for its tests and the hook's.
- `launches.ts`: a launch's notes in the runtime directory's
  `launches/<launch>/`: `launch.json`, written once by
  `dorothy --claude`, and `sessions/<session>.json`, one a session,
  written by its hooks. `liveSession` is the one noted last, else the
  one `--session-id` named; `staleLaunches` are those whose `dorothy`
  is gone.
- `record.ts`: `recordSession` records a session into its conversation
  under the store's lock: found by the index's `conversation_sessions`,
  or by a scan without the index; read from the line after the last
  recorded `sourceUuid`; each event stamped with its line's time and
  uuid; the session's row written into the index itself, whose lock is
  not re-entrant; one history commit, `turn: <phrase> (claude-code)`.
- `unread.ts`: what could not be read, under
  `$XDG_STATE_HOME/dorothy/unread/`: a halt's record and the transcript
  from its line on, and one example line of each new type; the notices
  a hook leaves for the next start (`notices.jsonl`); `startNotices`
  for both bodies and `unreadReport` for `--check`.
- `log.ts`: the hook's log, `$XDG_CACHE_HOME/dorothy/claude-hook.log`,
  rotated past 1 MB to one `.1` file.
- `hook.ts`: `runClaudeHook`. A `Stop` records, syncs and reviews by
  chat's rule (`afterStop`); a `SessionEnd` notes its session and hands
  it to a detached catch-up; a catch-up does what `SessionEnd` would
  for each session of a launch (`afterEnd`), then removes its notes;
  `--reread` and `--dismiss` resolve or silence a halt. Reviews run
  through `memory/reviewer.ts`'s `Reviewer`, as chat's do, under the
  index's claims.

## Invariants

- A hook and a catch-up write nothing to the terminal, which Claude
  Code owns, and always exit 0. What went wrong is in the log, which
  names lines by type and uuid and never holds a transcript's text.
- A line of a mapped type in a shape the reader does not expect halts
  the reading there: the lines before it are recorded, the rest is kept
  aside, and the user is told at every start until it reads or is
  dismissed. A type the reader neither maps nor lists is passed over
  and kept once.
- What is kept aside stays outside the data directory, so history, the
  mirror and the index never see it: directories `0700`, files `0600`.
- A transcript has one writer at a time: recording takes the store's
  lock, the index's or history's; with neither, nothing is recorded and
  the next start says so.
- A session new to Dorothy is hers from the launch's start; one she
  recorded continues its conversation.
- The recall server reads the launch's notes (`DOROTHY_LAUNCH`) to leave
  the live session's conversation out and name it in `remember`.
- Nothing here talks to a model but through the `StructuredCall` it is
  given: the CLI's, on Dorothy's own credentials.
```

- [ ] **Step 2: The package guides**

`packages/memory/AGENTS.md` is at its 150 lines: make these changes
without adding a line net.

- The `"."` bullet becomes three lines and the `"./recall-server"`
  bullet one:

```markdown
- `"."` (`src/index.ts`): `openMemory`, `previewStart`, and what
  `--claude` asks of memory; `"./claude-hook"` (`src/claude-hook.ts`):
  `runClaudeHook`, for its hooks. Read [their guide](./src/bodies/AGENTS.md).
```

```markdown
- `"./recall-server"` (`src/recall-server.ts`): `runRecallServer` alone.
```

- In the `transcript.ts` bullet, "name its `source`." becomes "name its
  `source`, an event its `sourceUuid`.", rewrapped within its four
  lines.
- In the `memory/sidecar.ts` bullet, the lines from "session starts
  with" to "never block the chat." become:

```markdown
  session starts with, frozen for the session, and schedules reviews
  (`scheduler.ts`) that never block the chat; `reviewer.ts`'s `Reviewer`
  runs one (`review.ts`), for chat and for Claude Code's hooks alike.
```

Run `wc -l packages/memory/AGENTS.md`; expect at most 150.

`packages/cli/AGENTS.md`:

- Entry points and imports: after "`@dorothy/memory/recall-server`",
  add "`@dorothy/memory/claude-hook`".
- The `claude.ts` bullet gains, before "`runClaude` runs it":

```markdown
  With `[memory] enabled` it also notes the launch (`DOROTHY_LAUNCH`),
  passes `Stop` and `SessionEnd` hooks running `dorothy --claude-hook`
  (`hookSettings`) and, for a new session, `--session-id`
  (`claudeSession`); the block leaves out a session resumed by id.
```

  and after "exits with `claude`'s code.": "Before `claude` starts it
  starts a detached catch-up of each launch a killed `dorothy` left
  behind, memory off or on, and says what hooks left to tell; once
  `claude` exits, a catch-up of its own launch."
- A new bullet after `claude-dump.ts`:

```markdown
- `claude-hook.ts`: `runHook`, for `--claude-hook`, gives memory's
  `runClaudeHook` the environment `claude` gave the hook, in which it
  finds the launch, and reviews: `process.env` loses the gateway's URL,
  `DOROTHY_LAUNCH`, `CLAUDECODE` and every `CLAUDE_CODE_` variable, then
  Dorothy's `.env` is loaded by path from this checkout (`loadDotenv`),
  and the agent only for a hook or a catch-up.
```

- Invariants: "`--claude` loads no `.env`: `claude` signs in as the
  user's own Claude Code does, and memory is read without credentials."
  becomes:

```markdown
- `--claude` loads no `.env`: `claude` signs in as the user's own Claude
  Code does, and memory is read without credentials. `--claude-hook`
  loads the checkout's `.env` by path for reviews, once `claude`'s
  variables are gone, never the working directory's.
```

`packages/core/AGENTS.md`: `xdg.ts` becomes "the XDG directories
(`xdgDir`), the state directory among them."; `session-id.ts` becomes
"session phrases, and `isUuid` for the ids that name files; `timers.ts`:
injectable timers."; `contracts/recall.ts` gains "`toolOf` on either
server" after "chat's server and Claude Code's".

Run: `bun test agents.test.ts && bun run lint:md`
Expected: PASS, no warnings.

```bash
git add packages
git commit -m "docs: Guide the recording in each package"
```

- [ ] **Step 3: Amend the spec**

In `docs/specs/2026-10-15-memory-bodies-design.md`, bump `mtime`, and
carry each ruling and each of Task 1's decisions into the section it
belongs to:

- Delivery, Into Claude Code, item 2: "once the recording plan records
  sessions" goes; the block leaves out the conversation of a session
  resumed by id.
- Which sessions: the notes live in `launches/<launch>/` of the
  runtime directory, `launch.json` and `sessions/<session>.json`; the
  `--session-id` rule, the flags it looks for before `--`, and a user's
  own `--session-id` noted as the launch's session.
- Mapping: the rulings' list beyond the spec's (compact summaries,
  command markup, Claude Code's own output, `queued_command` only with
  `commandMode` `prompt`, the model from the first line not
  `<synthetic>`), and what Task 1 found of attachments, `system` lines
  and `--resume`.
- Unreadable lines: a record and a copy only for a halt; a new type
  kept once, in `unread/types/<type>.jsonl`, told once by
  `unread/types.json`.
- The hook process: `SessionEnd` hands its session to
  `--catch-up <launch> --session <id>`; the idle check's lines; the
  commit message; without the index, the scan and no review; what Task
  1 found of `async` and of which exits run `SessionEnd`.
- Catch-up and Recall in Claude Code: the live session is the one a
  hook noted last, else `--session-id`'s; one-shot notices in
  `$XDG_STATE_HOME/dorothy/notices.jsonl`, told at the next start of
  either body.
- State: the runtime row becomes
  `$XDG_RUNTIME_DIR/dorothy/launches/<launch>/`, and a row for the
  notices (`Kept aside (new)`, `notices a hook leaves`,
  `$XDG_STATE_HOME/dorothy/notices.jsonl`).
- Commands: `dorothy --claude-hook [--catch-up <launch> [--session
  <id>]]`.
- Modules, Recording: `memory/src/memory/reviewer.ts` in place of
  `service.ts` and `review.ts`; `bodies/launches.ts`, `unread.ts` and
  `log.ts`; `cli/src/claude-hook.ts`.
- Search: `tags` lists a concept a fact carries, its tag counting the
  facts.

Run: `bun run lint:md`
Expected: no warnings.

- [ ] **Step 4: Verify end to end, on temporary data**

The stand-in from Task 1 answers `claude`; if `$P` is gone, run Task 1's
Steps 1 to 3 again. The hook's review leaves through the real API, not
the stand-in, and spends one review on Dorothy's own token. `claude`
takes the stand-in's fake key from an `apiKeyHelper` in its temporary
config rather than from `ANTHROPIC_API_KEY`, which the hook would
inherit and dotenvx would keep over her `.env`, failing the review. If
`claude` will not sign in that way, export the key instead and expect
the review to fail for it: the rest of the step stands.

```sh
P=/tmp/claude-1000/dorothy-recording-probe
V=/tmp/claude-1000/dorothy-recording-verify
R=$PWD
rm -rf "$V" && mkdir -p "$V/out" "$V/xdg/run" && chmod 700 "$V/xdg/run"
bash "$P/setup.sh"
jq -n --arg key "$P/key" '{apiKeyHelper: "cat \($key)"}' >"$P/cfg/settings.json"
bun "$P/standin.ts" "$V/out" >"$V/port" & standin=$!
sleep 1
(
    unset CLAUDECODE $(env | grep -o '^CLAUDE_CODE_[A-Z_]*')
    export XDG_DATA_HOME="$V/xdg/data" XDG_CACHE_HOME="$V/xdg/cache" \
        XDG_CONFIG_HOME="$V/xdg/config" XDG_STATE_HOME="$V/xdg/state" \
        XDG_RUNTIME_DIR="$V/xdg/run" CLAUDE_CONFIG_DIR="$P/cfg" \
        ANTHROPIC_BASE_URL="http://127.0.0.1:$(cat "$V/port")"
    cd "$P/cwd" &&
        timeout 120 bun "$R/packages/cli/src/index.ts" --claude \
            --allowedTools=Bash,Agent -p "use tools"
    sleep 20
    bun "$R/packages/cli/src/index.ts" --claude-hook --reread
    bun "$R/packages/cli/src/index.ts" --check
)
kill "$standin"
T=$(ls "$V"/xdg/data/dorothy/transcripts/*.jsonl)
jq -c '{kind, source, sourceSession, uuid: (.sourceUuid != null), name, text}' "$T"
ls -A "$V/xdg/run/dorothy/launches"
grep -lF 'This time you are not chatting' "$V"/out/request-*.json || echo none
grep -c 'use tools' "$V/xdg/cache/dorothy/claude-hook.log" || true
cat "$V/xdg/cache/dorothy/claude-hook.log"
jq '{title, description, reviewedThrough}' "${T%.jsonl}.meta.json"
```

Expected: one transcript, its first event a `session` with `source`
`claude-code` and the session's id, then the user's `use tools`, the
assistant's `Calling.`, a `Bash` and an `Agent` tool event and the
assistant's `done`, every one but the session event with a uuid; the
launches directory empty once the catch-up is done; `none` for the
review's prompt among the stand-in's requests, so no review reached the
gateway; `0` lines of the log holding the prompt's words; the log's
lines naming sessions, counts and the review's outcome, `reviewed`;
the conversation's notes holding a title and description; `--reread`
saying no unreadable lines are kept; `--check` passing with no
`unread:` line. The `SessionEnd` hook's catch-up and the one at exit
may both run: a warning that a launch had no notes left to catch up is
the later of the two finding the earlier done. Record each command and
its output in the report.

- [ ] **Step 5: By hand, in the user's terminal**

Ask the user to run `dorothy --claude` in this repository and:

1. Say something particular, wait for the reply, then ask her to search
   her memory for it: the live conversation is not among the results.
2. Ask her to remember a small fact about the session; then
   `/clear`, and a second exchange; then exit.
3. Run `dorothy --list`: the Claude Code sessions are there as
   conversations with notes, `/clear`'s as one of its own.
4. In chat (`dorothy`), ask what was said in Claude Code: she finds it
   by search.
5. `dorothy --facts` shows the fact; `dorothy --check` passes, with no
   `unread:` line and no word of errors in the hook's log.

Record what they report.

- [ ] **Step 6: The report**

In `docs/reports/2026-10-15-memory-bodies.md`:

- `## Rulings` gains `### Delivery` above its present list and a
  `### Recording` after it: the plan's Rulings on the spec as carried
  out, and Task 1's decisions.
- `## Verification` gains `### Recording: the checks`, `### Recording:
  a session through the stand-in` (Step 4) and `### Recording: by hand`
  (Step 5).
- `## Known limitations`: the item "A resumed session's conversation is
  not left out of the block until Recording" goes, and these come in:
  a session whose `SessionEnd` never runs, as Task 1 found of a
  hung-up terminal if it did, is recorded at the catch-up when
  `dorothy` exits, or at the next launch; a halted session is absent
  from recall until `--reread` reads it; a process starts at each
  reply; subagents' own transcripts are not read; a branch the user
  rewinds from stays in the record; a review inherits the user's own
  `ANTHROPIC_API_KEY` from `claude`'s environment where one is set, as
  chat's does from the shell, and is billed to it.
- `## Summary` covers both plans: what delivery gave, what recording
  adds, the probes' decisions, and the checks, with the test count of
  the last commit.

Run: `bun run lint:md`
Expected: no warnings.

- [ ] **Step 7: Commit**

```bash
git add docs
git commit -m "docs: Report recording her Claude Code sessions"
```

---

## Verification

The branch is done when `bun run check` passes on the last commit,
Task 12's run through the stand-in records the session as expected on
temporary data with no review reaching the stand-in, and the user has
confirmed by hand that a `dorothy --claude` session becomes a reviewed
conversation that chat then finds, `/clear`'s session as one of its
own, and that recall in Claude Code leaves the live conversation out.
Then the `finishing-a-development-branch` skill, confirming with the
user before pushing or opening a pull request, and, once merged,
`docs/roadmap.md` revised as its Revising section says.
