---
ctime: 2026-10-15
mtime: 2026-10-15
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
phase's second part. It records her Claude Code sessions into the store,
reviewed as chat's are, and delivers her memory to Claude Code as chat
already has it: a memory block in her system prompt and recall over MCP,
now with facts and a `remember` tool in both bodies.

What is always in context, under which budgets, and the reviews that
distil facts are the third part's, Layers and learning.

## Decisions

- **Only her sessions.** A session started with `dorothy --claude` is
  hers and becomes a conversation; a plain `claude` session is not, and
  is never read.
- **From Claude Code's transcript.** `dorothy --claude` passes hooks
  that read Claude Code's own transcript after each reply and at the
  session's end, with a catch-up when it exits. The gateway records
  nothing: its bodies stay unread.
- **The memory block through the gateway.** The CLI renders chat's
  memory block at launch and the gateway places it after her identity,
  in the system prompt, fixed for the launch so the prompt cache holds.
- **Claude Code's auto memory is off in her sessions.** `remember` is
  her one way to write a memory; plain sessions keep theirs.
- **Sync after every reply.** A session in a project syncs at its start,
  after each reply and at its end.
- **`remember` writes, corrects and retires.** She manages facts of her
  own origin; one whose origin is `user` or `repo` is refused, and she
  says so instead.
- **No facts in the block yet.** Facts reach her through recall until
  Layers decides what is always present.
- **One search.** `search` finds conversations and facts, and `open`
  opens either.
- **Reviews follow chat's rule.** A Claude Code conversation is reviewed
  after its first reply, then once idle, and at its end, with chat's
  catch-up behind it.
- **The CLI wires it.** `memory` reads Claude Code's transcript and
  serves the tools, `gateway` takes the block as opaque text, and `cli`
  joins them. The package graph is unchanged.

## Recording a Claude Code session

### One session, one conversation

A Claude Code session, by its `session_id`, is one conversation. Its
session event has `source: "claude-code"`, `sourceSession` its session
id, `model` from the first assistant line that names one, `promptHash`
and `sdkSessionId` empty, and the project of the directory `claude`
started in, as the store gives any session event.

### Reading by uuid

Every line of Claude Code's transcript has a `uuid`, and every event
recorded from one carries it as `sourceUuid`. A hook finds the session's
conversation by `sourceSession`, takes the last `sourceUuid` recorded,
and reads the transcript's lines after the line with that uuid; with
none recorded, it reads from the start. There is no offset to keep: a
hook that dies mid-way leaves the transcript flushed up to its last
whole event, and the next takes up from there. Claude Code warns that
the transcript may lag the current turn, so a line a hook misses
arrives with the next.

### Mapping

Lines are read in file order, main thread only (`isSidechain` false):

- A user line whose content is text is a **user** event, a turn,
  numbered as today.
- A line with `isMeta`, such as injected context or Claude Code's
  summary after compacting, is skipped.
- An assistant `text` block is an **assistant** event. Claude Code
  writes each block of a reply as its own line; consecutive assistant
  events are kept as they come, as the store allows.
- An assistant `tool_use` block and the `tool_result` that answers it,
  by id, are one **tool** event, built by the store's `toolEntry`:
  scrubbed of secrets, trimmed to 2,000 characters a side, and marked
  `memory: true` for her own recall tools. A call with no result yet
  waits for the next hook; one whose session ends unanswered is
  recorded with an empty output and `ok: false`.
- `thinking` blocks are not kept, as chat keeps none.
- A subagent is its `Agent` call's tool event, prompt and result; its
  own transcript, under the session's `subagents/`, is not read.
- Any other line type is skipped and counted in the hook's log, never
  an error.

Claude Code compacts its own context, so Dorothy's compaction does not
run on a Claude Code conversation. A branch the user rewinds from stays
in the record as it happened: nothing is forgotten.

How `--resume` writes its lines is the first probe's to find. If it
starts a new session id whose file repeats lines already recorded, the
uuids find the conversation they belong to and the new session
continues it, with a session event naming the new id.

## Delivering memory into Claude Code

When `[memory] enabled` is true, `launchClaude` adds four things to the
`claude` it runs; when it is false, `dorothy --claude` runs as it does
today.

1. **The block.** The CLI asks `memory` for chat's memory block,
   rendered by the same code, preamble and `budget`, from `config.toml`
   alone: `.env` is still not loaded, and `claude` signs in as the
   user's own does. It starts the gateway with
   `startGateway({ upstream, section })`, and the gateway puts the
   section in the marker's place after her identity, on the main thread
   only, unchanged for the launch. Arguments that resume a session
   already recorded leave its conversation out of the block, as chat
   leaves out the live one.
2. **Recall.** `--mcp-config` names `dorothy --recall-server --project
   <root>` under core's `SERVER_NAME`, `memory`. It does not pass
   `--strict-mcp-config`, so the user's own servers still load.
3. **Hooks.** `--settings` adds a `Stop` hook with `async: true`, so it
   never holds a reply back, and a `SessionEnd` hook, which hands its
   work to a detached process and exits inside the event's 1.5-second
   budget. Both run `dorothy --claude-hook` by absolute path, the
   interpreter and entry script `dorothy` itself was started with, so
   `bun run dev -- --claude` records too.
4. **Auto memory off.** `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in
   `claude`'s environment, which no settings file overrides.

The gateway learns nothing of memory: the section is text it places as
given, and its guide says so. `--claude --dump-context` prints the
request with the section in it, so delivery can be checked without a
reply.

If Claude Code keeps only the last `--settings` or `--mcp-config` it is
given, as it keeps only the last `--append-system-prompt`, a user's own
flag of either is merged into Dorothy's, as `claudeArgs` already merges
the system prompt; the third probe decides.

## Recall's tools

The recall server serves chat and Claude Code alike.

### Search

`search` takes an optional `kind`, `conversations` or `facts`, and
searches both without one. FTS5's scores from two tables do not compare,
so results come in two groups, each ranked and capped: facts first, as
they are few and short, then conversations. A fact's result gives its
id, scope, type, title, description, origin, a snippet, and
`retired: true` when it is retired. Live facts rank above retired ones,
and personal facts and those of the server's project above other
projects'; every scope is searched, as it is one memory.

### Open

`open` takes a fact's id, `personal/<name>` or `<project id>/<name>` as
the commands take them, and returns the whole fact: its fields, its
provenance and its body. A conversation opens as today.

### Remember

`remember` takes `action`, `write` or `retire`. Every call is a tool
event marked `memory: true`, so no review learns as new what she wrote
herself.

- **write** takes `name`, `type`, `title`, `description`, `body` and
  `scope`, `personal` or `project`, within the store's limits and name
  rule. `project` is the server's project, refused without one. The
  writer is `dorothy`, with `model`, and `from` names the conversation
  where the server can tell it: chat passes its phrase, as it does for
  `--exclude`; for Claude Code, the fifth probe decides. A name that
  exists is a correction of that fact.
- **retire** takes `name`, `scope` and `why`, as the store requires.

A write over, or a retirement of, a fact whose origin is `user` or
`repo` is refused, as is any write the store's origin rule refuses. The
refusal says why, so she can tell the user what she would change. Each
call takes the sidecar lock like every store write, so `remember` in
two bodies and a review never collide. A project fact reaches the
repository at the next sync.

`--project <root>` gives the server its project: `launchClaude` passes
the directory `claude` starts in, chat its own.

## The hook process

`dorothy --claude-hook` reads the hook's JSON on stdin: `hook_event_name`,
`session_id`, `transcript_path` and `cwd`. It writes nothing to the
terminal, which Claude Code owns, and always exits 0.

### Record, sync, review

1. **Record.** Under the sidecar lock, find the conversation, read its
   last `sourceUuid`, append what is new, and commit to history, as chat
   commits each turn. Hooks can now overlap, a `Stop` and the
   `SessionEnd` after it, so a transcript has one writer at a time
   rather than one writer.
2. **Sync** the project of `cwd`, if it is one. A sync that changes the
   store is one history commit, as the store says; one that changes
   nothing commits nothing.
3. **Review**, by chat's rule:
   - **The first `Stop`** of a conversation never reviewed asks for a
     review at once.
   - **A later `Stop`** waits `[memory] idle-seconds`, then asks only if
     the uuid it recorded is still the conversation's last and turns
     remain that no review has covered.
   - **`SessionEnd`** asks if any turn is uncovered.

   The recall index's review claims keep two processes from reviewing
   one conversation at once. A review is chat's own: the same prompt,
   schema and `StructuredCall`, on Dorothy's configuration, which the
   hook process loads with `config()` as chat does.

`SessionEnd` re-runs `dorothy --claude-hook` detached, handing it the
JSON, and exits; the detached process does the three steps.

### Catch-up at exit

`launchClaude` gives `claude` a launch id, `DOROTHY_LAUNCH`, in its
environment, which hooks inherit. Each hook notes its `session_id` and
`transcript_path` under that id in `$XDG_RUNTIME_DIR/dorothy/`, or the
cache directory without one. When `claude` exits, `dorothy --claude`
starts one detached `dorothy --claude-hook --catch-up <launch>` over the
noted sessions, which records, syncs and reviews as `SessionEnd` would,
and deletes the note. A session that never reached a `Stop` has no
reply to record.

### Its log

Warnings, skipped line types and errors go to
`$XDG_CACHE_HOME/dorothy/claude-hook.log`, rotated past 1 MB to one
`.1` file. Nothing in it is a transcript's text: lines are named by
type and uuid.

## Chat

Chat gains `remember` among its tools and `--project` for its recall
server. Started in a project, it syncs at its start and after each turn,
in the background, never holding a reply. Its block, its reviews and its
compaction are unchanged.

## State

New rows are marked.

| Class           | What                                  | Where                                        |
| --------------- | ------------------------------------- | -------------------------------------------- |
| Canonical       | transcripts; events gain `sourceUuid` | `transcripts/<phrase>.jsonl`                 |
| Derived         | the recall index, schema 5            | `$XDG_CACHE_HOME/dorothy/recall.sqlite`      |
| Ephemeral (new) | a launch's sessions, for catch-up     | `$XDG_RUNTIME_DIR/dorothy/<launch>.sessions` |
| Log (new)       | the hook's warnings                   | `$XDG_CACHE_HOME/dorothy/claude-hook.log`    |

The index gains `conversation_sessions`, each `sourceSession` any of a
conversation's session events names, so a hook finds its conversation
without reading every transcript, a resumed one included; the change of
schema rebuilds the index from the files, as any does. The lint accepts
`sourceUuid` on user, assistant and tool events; chat's events have
none.

## Commands

- `dorothy --claude [args...]` gains the block, recall, hooks and auto
  memory off, as above.
- `dorothy --claude-hook [--catch-up <launch>]`: the hooks' command,
  listed in usage as internal.
- `dorothy --check` also says when the hook's log holds errors newer
  than the last check.
- `dorothy --recall-server` gains `--project <root>`, and the server
  gains `remember`, facts in `search` and fact ids in `open`.

## Modules

- `memory/src/bodies/claude-code.ts`: Claude Code's transcript lines to
  events, pure.
- `memory/src/bodies/record.ts`: recording a session from its
  transcript under the lock.
- `memory/src/bodies/hook.ts`: `--claude-hook`, its cadence, catch-up and
  log.
- `memory/src/recall/query.ts`: facts in `search`, and `openFact`.
- `memory/src/recall/remember.ts`: `remember` over the fact store.
- `memory/src/recall/server.ts`: the tools and `--project`.
- `memory`'s entry point gains what the CLI needs to render the block
  and run the hook; it still depends on `core` alone.
- `gateway/src/anthropic.ts` and `server.ts`: the section after the
  identity.
- `cli/src/claude.ts`: the flags, environment, launch id and catch-up;
  `cli/src/index.ts`: the modes.
- `core/src/contracts/recall.ts`: `remember` among the allowed tools.

Each package's `AGENTS.md` changes with it, `memory`'s gaining a nested
`src/bodies/AGENTS.md` as it is at its budget.

## Failures

- A hook never blocks or fails Claude Code: it exits 0, and what went
  wrong is in its log.
- An unreadable transcript, a missing one or a line that does not parse
  is logged and left for the next hook or the catch-up.
- Without the recall index, the hook records under history's
  `FileLock`, as the store allows, and skips reviews, whose claims
  need the index.
- A memory block that cannot be built starts `claude` without it, and
  `dorothy --claude` says so on stderr before `claude` takes the
  terminal.
- The recall server failing to start leaves Claude Code without it, as
  any MCP server; Claude Code reports it.

## Security

- No secret is passed in `--settings`, `--mcp-config` or the hook's
  command line: they hold paths, a launch id and flags.
- Tool events are scrubbed by the store's `toolEntry` before they are
  trimmed or written, and recall does not index their text.
- The block is escaped as chat's is, so nothing in a note closes it.
- The hook's log holds types, uuids and errors, never a transcript's
  text.
- `remember` writes with `dorothy` as the writer and never raises an
  origin; text claiming to be the user's does not make it so.

## Testing

Every test passes its roots, environment and stdin; none touches
`$XDG_DATA_HOME/dorothy` or `$XDG_CACHE_HOME/dorothy`, runs `claude` or
reaches the API.

- The reader on fixture transcripts shaped by the first probe: every
  line type, meta lines, sidechains, a subagent, a tool call answered in
  the next hook's lines, unknown types, a resumed session.
- Recording resumed by uuid: a hook killed mid-way, two hooks
  overlapping, a lagging transcript.
- The cadence on a fake clock: first review, idle review superseded by a
  newer reply, end review, catch-up.
- `remember`: writing, correcting, retiring, each refusal, the project
  rule, and the lock against a concurrent write.
- `search` and `open` over facts, retired and live, personal and
  projects'.
- `launchClaude`'s flags, environment and merged user flags; the
  gateway's section on fixtures, the marker absent and present.

## Probes

Run first, recorded in the report, each with its command and output:

1. Claude Code's transcript lines: their types, `isMeta`, `isSidechain`,
   a subagent's call, large output kept under `tool-results/`, and the
   line compaction writes.
2. `--resume` and `--continue`: the same file, or a new id repeating
   uuids.
3. `--settings` and `--mcp-config` given twice, and hooks from
   `--settings` merging with the user's own.
4. `SessionEnd` on `/clear`, Ctrl-D, `/exit` and a killed terminal.
5. Whether an MCP server Claude Code starts can learn its session id.

## Known risks

- **An undocumented format.** Claude Code's transcript may change; the
  reader skips and counts what it does not know, and its log tells of
  drift.
- **A process per reply.** Each `Stop` starts `dorothy`; `async` keeps
  it off the reply's path, but it costs a start each time.
- **Origin is the session's, not the source's.** A fact she remembers
  from a page or a tool's output is `dorothy`'s; the store's origin
  cannot tell what she read. Facts are kept out of the block until
  Layers decides how `external` is told apart.
- **Rewound branches stay.** A conversation can hold a branch the user
  abandoned.
- **The section is fixed for the launch.** A fact written in another
  body during a long session reaches this one only through recall.

## Later

- **Layers and learning**: facts in the block, budgets and ranking in
  one place, and reviews that write, correct and retire facts.
- Codex, OpenCode and other clients behind the gateway, given the block
  and recall (Dorothy's Gateway).
- Subagents' transcripts as conversations of their own.
- Store gaps still open: snake-case memory files are skipped,
  regenerating `MEMORY.md` replaces hook lines, and history keeps the
  provenance an outside writer of canonical bytes claims.

## Out of scope

- Plain `claude` sessions.
- Dorothy's compaction on Claude Code conversations.
- Recording through the gateway.
