---
ctime: 2026-10-15
mtime: 2026-10-20
spdx: GPL-3.0-only
title: Dorothy's memory in her bodies design
description: >-
  Design spec for the second of Dorothy's Memory's three parts: her
  Claude Code sessions recorded and reviewed as chat's are, and her memory
  delivered to Claude Code and chat through the gateway and MCP, with a
  remember tool.
tags:
  - dorothy
  - memory
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-15-memory-bodies-design.md
   -
   -->

# Dorothy's memory in her bodies design

## Purpose

Wherever Dorothy goes, her memory follows with her. The
[store](./2026-10-15-memory-store-design.md) holds her conversations and
facts, but only chat records into it and reads from it: in Claude Code,
`dorothy --claude` gives her identity and nothing else. This spec is the
phase's second part. It delivers her memory to Claude Code as chat
already has it, a memory block in her system prompt and recall over
MCP, now with facts and a `remember` tool in both bodies; and it records
her Claude Code sessions into the store, reviewed as chat's are.

What is always in context, under which budgets, and the reviews that
distil facts are the third part's, Layers and learning.

## Decisions

- **Only her sessions.** A session in a `dorothy --claude` launch is
  hers and becomes a conversation; a plain `claude` session is not, and
  is never read. A plain session resumed inside her launch is hers from
  the launch on: what came before it is not recorded.
- **From Claude Code's transcript.** `dorothy --claude` passes hooks
  that read Claude Code's own transcript after each reply and at the
  session's end, with a catch-up when it exits and at the next launch.
  The gateway records nothing: its bodies stay unread.
- **The memory block through the gateway.** The CLI renders chat's
  memory block at launch and the gateway places it after her identity,
  in the system prompt, fixed for the launch so the prompt cache holds.
- **Claude Code's auto memory is off in her sessions.** `remember` is
  her one way to write a memory; plain sessions keep theirs.
- **Sync at the start and after every reply.** A session in a project
  syncs before `claude` starts, after each reply and at its end.
- **`remember` writes, corrects and retires.** She manages facts of her
  own origin; one whose origin is `user` or `repo` is refused, and she
  says so instead.
- **Her memory tools never ask.** Claude Code runs them without a
  permission prompt, as chat does.
- **No facts in the block yet.** Facts reach her through recall until
  Layers decides what is always present.
- **One search.** `search` finds conversations and facts, and `open`
  opens either.
- **Reviews follow chat's rule.** A Claude Code conversation is reviewed
  after its first reply, then once idle, and at its end, with chat's
  catch-up behind it, on Dorothy's own credentials.
- **An unreadable line is loud.** A malformed line halts the reading
  rather than be skipped, its transcript is kept as it was, and the user
  is told at every start until it reads or they dismiss it.
- **The CLI wires it.** `memory` reads Claude Code's transcript and
  serves the tools, `gateway` takes the block as opaque text, and `cli`
  joins them. The package graph is unchanged.

## Two plans

The work is two plans under this one spec, each its own branch:

1. **Delivery**: the block through the gateway, facts in `search` and
   `open`, `remember` in both bodies, the recall server and its
   permissions in Claude Code, auto memory off, sync at the start of a
   launch and in chat. It stands alone: Dorothy in Claude Code
   remembers, recalls and writes facts, though her sessions are not yet
   recorded.
2. **Recording**: the reader, the hooks, sync and reviews after each
   reply, the catch-up, and unreadable lines. It builds on the first.

The probes each plan needs run at its start.

## Delivery

### Into Claude Code

When `[memory] enabled` is true, `launchClaude` adds the following to
the `claude` it runs; when it is false, `dorothy --claude` runs as it
does today.

1. **Sync.** Before `claude` starts, the store syncs the project of the
   directory `claude` will start in, if it is one. A sync that fails is
   reported on stderr and the launch goes on.
2. **The block.** The CLI asks `memory` for chat's memory block,
   rendered by the same code, preamble and `budget`, from `config.toml`:
   `claude` itself still loads no `.env` and signs in as the user's own
   does. It starts the gateway with `startGateway({ upstream, section
   })`, and the gateway puts the section in the marker's place after
   her identity, on the main thread only, unchanged for the launch.
   Where the arguments resume a session by id that is already recorded
   (`--resume <id>`, `-r <id>` or `--resume=<id>`), the block leaves its
   conversation out, as chat leaves out the live one; `--continue`,
   `--resume` without an id, and a resume by name name no id, and leave
   nothing out.
3. **Recall**, when `[memory] recall` is also true. `--mcp-config=` (the
   `=` form, as the flag takes several values and would otherwise take
   the user's prompt) names `dorothy --recall-server --project <root>`
   as `dorothy-memory`. Chat's server is `memory`; Claude Code's has its
   own name, core's `CLAUDE_SERVER_NAME`, so a user's own server called
   `memory`, as the reference MCP memory server is, does not collide.
   `--strict-mcp-config` is not passed, so the user's servers still
   load.
4. **Permissions.** `--settings` allows `search`, `open`, `tags` and
   `remember` on `dorothy-memory`, so none prompts.
5. **Auto memory off.** `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in
   `claude`'s environment; the delivery plan's first probe checks that
   no settings file turns it back on.

The gateway learns nothing of memory: the section is text it places as
given, and its guide says so. `--claude --dump-context` shares
`launchClaude` but takes the block alone: it prints the request with the
section in it, and passes no recall, permissions, hooks or sync, so it
records nothing and starts no server.

The delivery probe found that Claude Code keeps only the last
`--settings` it is given, as it keeps only the last
`--append-system-prompt`, and accumulates repeated `--mcp-config`. A
user's own `--settings` is therefore merged into Dorothy's, as
`claudeArgs` already merges the system prompt, and passed as a private
file by path when the user's was a file, so no secret it holds reaches
`claude`'s command line; inline JSON and Dorothy's own settings stay
inline. A user's own `--mcp-config` is passed as given, beside
Dorothy's.

### Search

`search` keeps its inputs and searches facts too. It gains an optional
`kind`, `conversations` or `facts`, and searches both without one.
FTS5's scores from two tables do not compare, so results come in two
groups, each ranked and each capped at `limit`: facts first, as they
are few and short, then conversations. `tags` filters facts by their
concepts as it filters conversations, and `after` and `before` by a
fact's creation time. A fact's result gives its id, scope, type,
title, description, origin, a snippet, and `retired: true` when it is
retired. Live facts rank above retired ones, and personal facts and
those of the server's project above other projects'; every scope is
searched, as it is one memory. The result's count of hits counts each
group apart.

The `tags` tool lists a concept a live fact carries, as it lists one a
conversation carries, and its tag gains `facts`, the count of live
facts carrying it; a retired fact's tags count for nothing.

### Open

`open` takes `fact`, an id as the commands take them,
`personal/<name>` or `<project id>/<name>`, in place of
`conversation`, exactly one of the two, with `purpose` as before. It
returns the whole fact: its fields, its provenance and its body.
Opening a fact is a read, recorded and appraised as opening a
conversation is.

### Remember

`remember` takes `action`, `write` or `retire`.

- **write** takes `name`, `type`, `title`, `description`, `body` and
  `scope`, `personal` or `project`, within the store's limits and name
  rule. `project` is the server's project, refused without one. The
  writer is `dorothy` and the origin `dorothy`, never higher; `from`
  names the conversation where the server knows it, and `model` is left
  out, as the server cannot know it. A name that exists is a correction
  of that fact. A correction of a retired fact is refused: she revives
  nothing by writing, and says it is retired.
- **retire** takes `name`, `scope` and `why`, as the store requires.

A write over, or a retirement of, a fact whose origin is `user` or
`repo` is refused, and the refusal says why, so she can tell the user
what she would change. Each call takes the sidecar lock like every
store write and is committed to history, so `remember` in two bodies
and a review never collide. A project fact reaches the repository at
the next sync.

`--project <root>` gives the server its project: `launchClaude` passes
the directory `claude` starts in, chat its own.

### History in short-lived processes

The recall server, and in the recording plan the hook process, open
history to sweep and commit, never to push the mirror, repack or warn
of a missing mirror: those stay with chat's launch. Run once a reply,
they would otherwise push each time.

### Chat

Chat gains `remember` among its tools, recorded as a tool event marked
`memory: true`, so no review learns as new what she wrote herself; its
`search` and `open` stay `recall` lookups, as today. Its recall server
takes `--project`, the directory chat started in, found as
`userShell` finds `claude`'s under `bun run dev`. Started in a project,
chat records it on its session event, syncs at its start and after each
turn, in the background, never holding a reply. Its block, reviews and
compaction are unchanged.

## Recording

### Which sessions

`launchClaude` gives `claude` a launch id, `DOROTHY_LAUNCH`, which hooks
and MCP servers inherit, as the recording probe found, so no `--launch`
flag is needed. It notes the launch, its start time and its directory
under `$XDG_STATE_HOME/dorothy/launches/<launch>/`: `launch.json`,
written once by `dorothy --claude`, and `sessions/<session>.json`, one a
session, written by its hooks. Each launch records its boot id where
available; a note from another boot is stale regardless of its pid.
A legacy runtime-directory note is read and caught up without migration.
Merged settings remain private runtime files and are never scanned.

Where the arguments start a new session, it passes `--session-id
<uuid>` and notes that id too. They start one unless, before any `--`,
they hold `-c`, `--continue`, `-r`, `--resume`, `--session-id` or
`--from-pr`; a user's own `--session-id <uuid>` is noted as the
launch's session, as Dorothy's would be.

A session a hook reports under a launch is recorded from the later of
its first line and the launch's start, unless it already belongs to a
conversation, which it continues. A new session, `/clear`'s included,
is thereby recorded whole; a plain session resumed inside the launch
only from the launch on. A mapped line timestamped before the launch is
passed over before its shape is checked, so an old line in a shape the
reader no longer knows never halts a resumed session; one that is not
JSON still does.

### One session, one conversation

A Claude Code session, by its `session_id`, is one conversation. Its
session event has `source: "claude-code"`, `sourceSession` its id,
`model` from the first assistant line that names one, `promptHash` and
`sdkSessionId` empty, and the project of the launch's directory.

### Reading by uuid

Claude Code's conversation lines carry a `uuid`; its bookkeeping lines
often do not. Every event recorded from a line carries that line's
uuid as `sourceUuid`, and its time from the line's `timestamp`, not the
time it was written. A hook finds the session's conversation, then
reads the transcript from its **resume point**: the line after the last
recorded `sourceUuid`, or, while a tool call recorded nothing yet
because its result had not come, that call's line. Nothing else is
kept: a hook that dies mid-way leaves the transcript whole up to its
last flushed event, and the next takes up from there. A torn last line,
left by a writer killed mid-append, is cut off before anything is
appended; it was never a whole event, and its line is read again.
Claude Code warns that the transcript may lag the current turn, so a
line a hook misses arrives with the next.

### Mapping

Lines are read in file order, main thread only (`isSidechain` false).
A line may hold several content blocks; each is mapped in order.

- A user line whose content is text is a **user** event, a turn,
  numbered as today. Text in Claude Code's command markup becomes the
  command as typed (`/compact focus`, `! ls`); the command's output
  (`<local-command-stdout>`, `<bash-stdout>` and the like),
  `<task-notification>` and `[Request interrupted by user]` are
  skipped, as Claude Code's own words and not the user's.
- An `attachment` line of a subtype that carries the user's words is a
  **user** event too: `queued_command`, typed while she was working,
  unless its `commandMode` is other than `prompt`, as task
  notifications use it too.
  The recording probe found no other subtype carrying the user's words;
  the rest are bookkeeping.
- A line with `isMeta`, such as injected context, or with
  `isCompactSummary`, Claude Code's summary after compacting, is
  skipped.
- An assistant `text` block is an **assistant** event; consecutive
  assistant events are kept as they come, as the store allows.
- An assistant `tool_use` block and the `tool_result` that answers it,
  by id, are one event, carrying the `tool_use` line's uuid. A call to
  `search`, `open` or `tags` on `dorothy-memory` is a `recall` lookup,
  described as chat's are, so reviews appraise her reads; a call to
  `remember` is a **tool** event marked `memory: true`; any other is a
  **tool** event built by the store's `toolEntry`, scrubbed of secrets
  and trimmed to 2,000 characters a side. A call whose session ends
  unanswered is recorded with an empty output and `ok: false`.
- `thinking` blocks are not kept, as chat keeps none.
- A subagent is its `Agent` call's tool event, prompt and result; its
  own transcript, under the session's `subagents/`, is not read.
- A `system` line is bookkeeping: the recording probe found none that
  carries the conversation (`compact_boundary`, `informational`,
  `local_command`, `stop_hook_summary`, `turn_duration`).
- A line of a bookkeeping type the probe and the planning survey list,
  such as `mode`, `file-history-snapshot` or `last-prompt`, is skipped.
- An assistant line names its model; the session event takes the first
  that is not `<synthetic>`, which Claude Code writes on a resume, else
  `unknown`.

Claude Code compacts its own context, so Dorothy's compaction does not
run on a Claude Code conversation. A branch the user rewinds from stays
in the record as it happened: nothing is forgotten.

The recording probe found that `--resume <id>` and `--continue` append
to the session's own file under its own id, so the resumed session
continues its conversation. `--fork-session` writes a new file under a
new id, copying the old lines with their uuids and times but naming only
the new id, and no field names the session forked from: a fork is new
to Dorothy, recorded from the launch on as a conversation of its own.
`/clear` ends the session and goes on under a new id in a new file,
recorded as a conversation of its own.

### Unreadable lines

A format that changes under the reader must not lose a word or pass
unnoticed.

- **A malformed line halts the reading.** A line that is not JSON, or
  is of a type the reader maps but not in the shape it expects, stops
  the reading there: the lines before it are recorded, the resume point
  stays before it, so the order is never broken, and a reader that knows
  the new shape takes up at that line. The transcript from that line on
  is copied, as below, and every later hook of the session copies it
  again.
- **A new type is passed over.** A line with a `type` the reader neither
  maps nor lists, with or without a `uuid`, does not halt the reading,
  as Claude Code adds bookkeeping often and halting on each would stop
  all recording until Dorothy is updated. One example line of each new
  type is kept, once and not per session, in
  `unread/types/<type>.jsonl`.
- **Where copies go.** A halt's copy is
  `$XDG_STATE_HOME/dorothy/unread/<session id>.jsonl`, outside the data
  directory, so history's sweep, the mirror and the index never see it,
  and readable by the user alone (`0600`, its directories `0700`), as
  its tool output was never scrubbed. It outlives Claude Code's own
  clean-up of old transcripts, after 30 days by default.
- **The user is told at the next start.** A record exists only for a
  halt, beside its copy, `<session id>.json`: the session, its
  conversation, the line's number, type and uuid where it has one, and
  why it could not be read. A halt is told at every start of
  `dorothy --claude`, on stderr before `claude` takes the terminal, and
  of chat, as a notice, naming the copy and how to retry, until it is
  resolved or dismissed. A new type is told once, at the first start
  of either body after it is seen; the types already told are kept in
  `unread/types.json`.
- **Resolved by reading again.** `dorothy --claude-hook --reread` reads
  each halted session from its resume point, from Claude Code's
  transcript where it still exists and the copy where it does not. Once
  it reads to the end, the copy and record go and the notice stops; one
  that still fails keeps both, its record updated.
  `dorothy --claude-hook --dismiss <session id>` stops the notice and
  keeps the copy.

### The hook process

`launchClaude`'s `--settings` adds a `Stop` hook with `async: true`, so
it never holds a reply back, and a `SessionEnd` hook with an explicit
`timeout`, which hands its session to a detached
`dorothy --claude-hook --catch-up <launch> --session <id>` and exits.
That catch-up does for one session what the launch's does for all, and
keeps the launch's notes. Both hooks run `dorothy --claude-hook` by
absolute path, the interpreter and entry script `dorothy` itself was
started with, as `bun --no-env-file`, so `bun run dev -- --claude`
records too.

The recording probe found that hooks from `--settings` add to the
user's own, and that `async` keeps the `Stop` hook off the reply's path.
An interactive async `Stop` outlives `/exit`, but under `claude -p`
Claude Code terminates it about 30 milliseconds after starting it, as
it exits; the `SessionEnd` catch-up records that last turn.
`SessionEnd` ran on every exit tried: print mode, `/clear`, Ctrl-D,
`/exit` and a hung-up terminal. A plain detached spawn outlived each
teardown, with no `setsid`.

`dorothy --claude-hook` reads the hook's JSON on stdin:
`hook_event_name`, `session_id`, `transcript_path` and `cwd`. It notes
the session under its launch, writes nothing to the terminal, which
Claude Code owns, and always exits 0. Then:

1. **Record.** Under the sidecar lock, find the conversation, read from
   its resume point, append what is new, write its rows of
   `conversation_sessions` into the index itself, as the index's lock
   is not re-entrant, and commit to history, as chat commits each turn,
   as `turn: <phrase> (claude-code)`. Hooks can overlap, a `Stop` and
   the `SessionEnd` after it, so a transcript has one writer at a time
   rather than one writer. Without the index, a hook under history's
   lock finds the session's conversation by scanning the transcripts for
   its session event. With neither the index nor history there is no
   lock: nothing is recorded, and the next start says so.
2. **Sync** the launch's project, if it is one. A sync that changes the
   store is one history commit, as the store says; one that changes
   nothing commits nothing.
3. **Review**, by chat's rule:
   - **The first `Stop`** of a conversation never reviewed asks for a
     review at once.
   - **A later `Stop`** waits `[memory] idle-seconds`, then looks at the
     tail of Claude Code's transcript: if a main-thread `user`,
     `assistant` or `attachment` line has come since it recorded, a
     reply or a prompt the user has sent, it does nothing, as a later
     hook has the conversation; the bookkeeping Claude Code appends
     after a reply does not count. Otherwise it records again and asks,
     if turns remain that no review has covered.
   - **`SessionEnd`** records and asks if any turn is uncovered.

   The recall index's review claims keep two processes from reviewing
   one conversation at once; without the index, a hook asks for no
   review, and there are none until chat's catch-up. A review is chat's
   own prompt, schema and `StructuredCall`, through a `Reviewer`
   (`memory/reviewer.ts`) taken out of the TUI's `MemoryService`, which
   keeps its scheduler; claims stay with each caller.

**Credentials.** Reviews are billed to Dorothy's credentials, as chat's
are. The hook loads the `.env` of the checkout `dorothy` runs from, by
explicit path, never the working directory's, and calls the model with
`ANTHROPIC_BASE_URL`, `ENABLE_TOOL_SEARCH`, `DOROTHY_LAUNCH` and every
`CLAUDE_CODE_` and `CLAUDECODE` variable removed from the environment it
inherited from `claude`, so a review never reaches the stopped gateway
or the live session. The launch passes the user's original
`ANTHROPIC_BASE_URL` as `DOROTHY_ANTHROPIC_BASE_URL`; hooks and both
catch-ups restore it for reviews after removing the gateway URL. It also
passes Dotenvx Armor's session directory as `DOROTHY_DOTENVX_CONFIG`, so
reviews still decrypt the checkout's `.env` under another
`XDG_CONFIG_HOME`. The hook runs as `bun --no-env-file`, so the
project's `.env`, which Bun loads from the working directory and whose
keys dotenvx would keep over Dorothy's, never reaches it; the recall
server runs so too. dotenvx prints through the console even when quiet,
some of it with a key's first characters, so the console is silenced
around the load and a failure is logged by its code alone. `claude`
itself still loads no `.env`; the CLI's guide narrows its rule to say
so.

### Catch-up

When `claude` exits, `dorothy --claude` starts one detached
`dorothy --claude-hook --catch-up <launch>`, which records, syncs and
reviews each session noted under the launch as `SessionEnd` would, and
deletes the launch's notes only when recording could acquire the store
lock. A locked-out catch-up retains them for the next start. A `dorothy`
killed before it can leaves them; the next `dorothy --claude` catches up
every launch whose
`claude` is no longer running. This covers a `Stop` that never ran,
after an interrupt or an API error. A session noted by `--session-id`
whose transcript has lines but for which no hook ran is recorded by the
catch-up, and the next start warns that Claude Code ran no hooks, as
`disableAllHooks`, an untrusted folder, `--bare` or `--safe-mode` would
cause.

What a hook or a catch-up cannot tell itself, that Claude Code ran no
hooks or that nothing was recorded for want of a lock, it leaves as a
one-shot notice in `$XDG_STATE_HOME/dorothy/notices.jsonl`, told at the
next start of either body, `dorothy --claude` on stderr and chat as a
notice, and then cleared.

### Recall in Claude Code

The recall server inherits `DOROTHY_LAUNCH`, and reads the launch's
notes to find the live session's conversation, the live session being
the one a hook noted last, unless that session has ended; else the one
`--session-id` named: it leaves that out of `search`, as chat's
`--exclude` does, and names it as `from` in `remember`'s writes. Before
the first `Stop` there is no conversation yet, and after a
`SessionEnd` (as at `/clear`) no live session until the next one's
hook, so nothing is left out and `from` is omitted.

### Its log

Warnings, new types and errors go to
`$XDG_CACHE_HOME/dorothy/claude-hook.log`, rotated past 1 MB to one
`.1` file. Nothing in it is a transcript's text: lines are named by
type and uuid.

## State

New rows are marked.

| Class            | What                                  | Where                                          |
| ---------------- | ------------------------------------- | ---------------------------------------------- |
| Canonical        | transcripts; events gain `sourceUuid` | `transcripts/<phrase>.jsonl`                   |
| Derived          | the recall index, schema 7            | `$XDG_CACHE_HOME/dorothy/recall.sqlite`        |
| Durable state    | launches and their sessions           | `$XDG_STATE_HOME/dorothy/launches/<launch>/`   |
| Log (new)        | the hook's warnings                   | `$XDG_CACHE_HOME/dorothy/claude-hook.log`      |
| Kept aside (new) | unreadable lines, as they were        | `$XDG_STATE_HOME/dorothy/unread/`              |
| Kept aside (new) | notices a hook leaves                 | `$XDG_STATE_HOME/dorothy/notices.jsonl`        |

The index gains `conversation_sessions`, each `sourceSession` any of a
conversation's session events names, so a hook finds its conversation
without reading every transcript, a resumed one included; the change of
schema rebuilds the index from the files, as any does. The lint checks
an event's `v` and `kind` alone, so it needs no change for
`sourceUuid`. `TranscriptWriter` takes an event's time where it is
given one.

## Commands

- `dorothy --claude [args...]` gains sync, the block, recall,
  permissions and auto memory off (delivery), and hooks, the launch's
  notes and catch-up (recording).
- `dorothy --claude-hook [--catch-up <launch> [--session <id>]]`: the
  hooks' command, listed in usage as internal.
- `dorothy --claude-hook --reread` and `--dismiss <session id>`: the
  unreadable lines, read again or silenced.
- `dorothy --check` also lists the unreadable lines kept aside, and says
  when the hook's log holds errors.
- `dorothy --recall-server` gains `--project <root>`, and the server
  gains `remember`, facts in `search` and `fact` in `open`.

## Modules

Delivery:

- `core/src/contracts/recall.ts`: `remember`, `kind`, `fact`, the fact
  result and `CLAUDE_SERVER_NAME`.
- `memory/src/recall/query.ts`: facts in `search`, and `openFact`.
- `memory/src/recall/remember.ts`: `remember` over the fact store.
- `memory/src/recall/server.ts`: the tools, `--project`, and history
  without the mirror.
- `memory`'s entry point: rendering the block for `--claude`, and
  syncing a directory's project; it still depends on `core` alone.
- `gateway/src/anthropic.ts` and `server.ts`: the section after the
  identity.
- `agent`: `remember` among chat's tools, its tool event, and the
  persona's line on it, which `persona.test.ts` pins.
- `tui`: how a `remember` call shows in the chat (`state.ts`).
- `cli/src/claude.ts`, `claude-dump.ts` and `index.ts`: the flags,
  environment and sync; chat's `--project`.

Recording:

- `memory/src/bodies/claude-code.ts`: Claude Code's lines to events,
  pure.
- `memory/src/bodies/record.ts`: recording a session under the lock.
- `memory/src/bodies/hook.ts`: `--claude-hook`, its cadence, catch-up,
  `--reread` and `--dismiss`.
- `memory/src/bodies/launches.ts`: the launch's notes; `unread.ts`: the
  lines kept aside and the notices; `log.ts`: the hook's log.
- `memory/src/memory/reviewer.ts`: the `Reviewer`, out of
  `MemoryService`, which chat's service and the hook share.
- `memory/src/transcript.ts`: `sourceUuid`, and an event's given time.
- `cli/src/claude.ts`: the launch id, notes, hooks and catch-up.
- `cli/src/claude-hook.ts`: `--claude-hook`, its environment and
  Dorothy's `.env` loaded by path.

Each package's `AGENTS.md` changes with it, `memory`'s gaining a nested
`src/bodies/AGENTS.md` as it is at its budget.

## Failures

- A hook never blocks or fails Claude Code: it exits 0, and what went
  wrong is in its log.
- A transcript that is missing or cannot be opened is logged and left
  for the next hook or the catch-up; one with an unreadable line is as
  Unreadable lines says.
- A memory block that cannot be built starts `claude` without it, and
  `dorothy --claude` says so on stderr before `claude` takes the
  terminal.
- The recall server failing to start leaves Claude Code without it, as
  any MCP server; Claude Code reports it.
- `[memory] enabled` turned off between launches stops delivery and
  recording at the next; notes left by a launch are still caught up.

## Security

- No secret is passed in `--settings`, `--mcp-config` or the hook's
  command line: they hold paths, a launch id, tool names and flags.
- A review's environment drops `claude`'s variables and the gateway's
  URL, and loads only Dorothy's own `.env`.
- Tool events are scrubbed by the store's `toolEntry` before they are
  trimmed or written, and recall does not index their text.
- The block is escaped as chat's is, so nothing in a note closes it.
- Unreadable lines are kept outside the data directory, so never in
  history, the mirror or the index, readable by the user alone; the log
  and the records hold types, uuids and errors, never a transcript's
  text.
- `remember` writes with `dorothy` as writer and origin and never raises
  an origin; text claiming to be the user's does not make it so.

## Testing

Every test passes its roots, environment and stdin; none touches
`$XDG_DATA_HOME/dorothy`, `$XDG_CACHE_HOME/dorothy` or
`$XDG_STATE_HOME/dorothy`, runs `claude` or reaches the API.

Delivery:

- `search` and `open` over facts: both groups, `kind`, `tags`, `after`
  and `before` on facts, retired and live, personal and projects', and
  `open` with `fact` appraised as a read.
- `remember`: writing, correcting, retiring, refusing `user` and `repo`
  facts and a retired one, the project rule, the origin, and the lock
  against a concurrent write.
- `launchClaude`'s flags in `=` form, permissions, environment and
  merged user flags; `--dump-context` with the block alone; sync before
  launch and its failure.
- The gateway's section on fixtures, the marker absent and present.
- Chat's `remember` event, its project and its sync.

Recording:

- The reader on fixture transcripts shaped by the first probe: every
  line type, several blocks in a line, attachments, meta lines,
  sidechains, a subagent, her recall calls as lookups, a tool call
  answered in the next hook's lines, lines without a uuid, a resumed
  session, a plain session resumed in a launch.
- The resume point: a hook killed mid-way, a torn tail, two hooks
  overlapping, a lagging transcript, event times from the lines.
- Unreadable lines: not JSON, a malformed user line, a new type with
  and without a uuid; the halt, the copy outside the data directory and
  its mode, the record, the notice once and every start, `--reread`
  succeeding and still failing, `--dismiss`.
- The cadence on a fake clock: first review, an idle review superseded
  by a newer line or a sent prompt, the end review, catch-up at exit
  and at the next launch, and a session no hook ran for.
- A review's environment: the gateway's URL and `claude`'s variables
  gone, Dorothy's `.env` by path.

## Probes

Each plan runs its own first and records them in the report, each with
its command and output.

Delivery:

1. `CLAUDE_CODE_DISABLE_AUTO_MEMORY` against a settings file that turns
   auto memory on.
2. `--settings` and `--mcp-config` given twice, the user's own merged
   with Dorothy's, and permissions from `--settings` letting her tools
   run without a prompt.

Recording:

1. Claude Code's transcript lines: their types and which carry a
   `uuid`, `isMeta`, `isSidechain`, attachment and system subtypes,
   several blocks in a line, a subagent's call, large output kept under
   `tool-results/`, and the line compaction writes.
2. `--resume` and `--continue`: the same file, or a new id repeating
   uuids; `/clear` within a launch.
3. Hooks from `--settings` merging with the user's own, and `SessionEnd`
   on `/clear`, Ctrl-D, `/exit` and a killed terminal, with a detached
   process outliving the teardown.
4. That an MCP server and a hook inherit `DOROTHY_LAUNCH`.

## Known risks

- **An undocumented format.** Claude Code's transcript may change. A
  malformed line halts the recording of that session until Dorothy's
  reader is updated; the transcript is kept aside meanwhile and the
  user told at every start, so nothing is lost, but the conversation is
  absent from recall until it is read again.
- **A process per reply.** Each `Stop` starts `dorothy`; `async` keeps
  it off the reply's path, but it costs a start each time.
- **Origin is the session's, not the source's.** A fact she remembers
  from a page or a tool's output is `dorothy`'s, and her memory tools
  run without a prompt, so text injected through a page or a tool can
  reach a project's facts and, at the next sync, its repository,
  uncommitted for the user to see in `git status`. The contract puts
  unconfirmed facts after confirmed knowledge in a fenced section,
  marked as claims to weigh, never instructions, and marks them through
  search, open and recall too. `--verify` confirms the user's choices.
- **Rewound branches stay.** A conversation can hold a branch the user
  abandoned.
- **The section is fixed for the launch.** A fact written in another
  body during a long session reaches this one only through recall.

## Later

- **The memory engine**: extraction, consolidation and learning beyond
  the contract's opening block and shared budgets.
- Codex, OpenCode and other clients behind the gateway, given the block
  and recall (Dorothy's Gateway).
- Subagents' transcripts as conversations of their own.

## Out of scope

- Plain `claude` sessions, but for one resumed in her launch.
- Dorothy's compaction on Claude Code conversations.
- Recording through the gateway.
