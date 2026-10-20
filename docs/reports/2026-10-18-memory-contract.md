---
ctime: 2026-10-18
mtime: 2026-10-20
spdx: GPL-3.0-only
title: Dorothy's memory contract implementation
description: >-
  Progress, rulings and verification of the memory contract plan, carried
  out task by task by subagents on the branch feat/memory-contract, and
  its final review; merged in #69.
tags:
  - dorothy
  - memory
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-18-memory-contract.md
   -
   -->

# Dorothy's memory contract implementation

## Summary

The [plan](../plans/2026-10-18-memory-contract.md) for the
[memory contract](../specs/2026-10-18-memory-contract-design.md) is
carried out on the branch `feat/memory-contract`, from `main` at
`3141323`, one subagent at a time: an implementer per task, then a
reviewer of its diff. Each task's outcome is recorded here as it
completes, so a later session resumes at the first task not marked
complete.

## Rulings

1. The preflight scan for conflicts between tasks was cut short, as
   usage was scarce; the plan had already passed two review rounds
   (`42f628b`, `d29a7a1`). If wrong, a conflict costs a fix round when
   it surfaces.
2. Implementers and reviewers run on a mid-tier model, as the plan
   carries its code in full. If wrong, a weaker pass costs a fix round.

## Tasks

Each entry gives the task, its commits and its review.

### Task 1: the service table and the extraction cap

Complete in `7c55313`; review clean, and `config.test.ts` passes 32 of
32. Minor findings deferred to the final review:

- "reads both tables" asserts nothing of `service` under `toEqual`, as
  the plan wrote it.
- The `listen` address pattern admits values such as `-` or `:`, as the
  plan wrote it; a failed bind must surface as a clear error.
- No test covers `listen`'s de-duplication, a `listen` not a list, a
  port out of range or an `extract-cap` over 100.
- `README.md` names neither `extract-cap` nor `[service]`; Task 19
  documents them.

### Task 2: facts in the Open Knowledge Format

Complete in `076fe1d`; review clean, and the whole suite passes 1750 of
1750. Minor findings deferred to the final review:

- `actorOf` renders any `host`, but `writingOf` refuses one outside
  `HOST`: whatever first sets `host` must check it the same way.
- `dorothy.origin` and `generated.by` are not checked against each
  other, so `extraction` written by a user re-renders as `model`.
- A hand-edited `dorothy.metadata.type` is dropped without an error.
- Tests do not cover `retired` without `deprecated`, bad foreign keys,
  `otherSources`, `handEdited` keeping foreign keys, or `generated`
  without `dorothy.origin`.
- Foreign keys and other sources have no size cap; `readCommon` serves
  only `legacy.ts`.

`packages/memory/AGENTS.md` still calls `file.ts` the one canonical
form until Task 19, and old fact files do not parse until Task 4
migrates them.

### Task 3: the knowledge directory

Complete in `f21020e`; review clean, and the memory package passes 1145
of 1145. A search found no hard-coded `facts/` data path left. Minor
findings deferred to the final review:

- A comment in `store.ts` says "today's `scopeDir`", as the plan wrote
  it, and will go stale.
- No test pins the old `facts/personal/` layout as `other` in the lint,
  nor passes `under` a directory other than the default.

### Task 4: moving facts/ to knowledge/

Complete in `336c9c0` and `3a29dbb`, after one fix round. The review
found two faults in the plan's code, and both rulings below keep user
data safe where the spec's Migration section says nothing:

- `migrateFacts` wrote a legacy fact over an existing `knowledge/` file
  and deleted the legacy copy. Ruling: it now leaves the legacy file in
  `facts/` and warns, as a knowledge file may be newer and not yet
  committed by history. If wrong, a duplicate waits in `facts/` for the
  user.
- One file failing to read or write stopped the migration, and with it
  recall's sync and history. Ruling: it now warns of that file, leaves
  it in place and moves the rest. If wrong, a failure is quieter than an
  abort.

The re-review found both addressed. Minor findings deferred to the
final review:

- The unreadable-file test relies on `chmod 000`, which root ignores.
- The unwritable-target test fails at the existence check, not the
  write; a file made between check and write would still be
  overwritten, though the store's lock is held.
- Files in `facts/` the store does not list are left unmentioned, a
  leftover warns on every launch, and pruning follows a linked
  directory.

### Task 5: the contract's types

Complete in `f087d1b`; review clean, and `core` passes 75 of 75. The
implementer added the `contracts/memory.ts` bullet to
`packages/core/AGENTS.md` that Task 19 was to add. Ruling: the bullet
stays, and Task 19 moves it after the `contracts/recall.ts` bullet
rather than adding a second. If wrong, one bullet sits a line off.
Minor finding deferred: the tests check neither a `.` segment in a
memory id nor the length cap of a host id.

### Task 6: the contract's schemas

Complete in `80f5b1b`; review approved, and the contract's tests pass
5 of 5. The review found, as the plan wrote it, that the `open` and
`remember` tool ids are checked for length alone. Ruling: the schemas
stay so, as `remember` (Task 12) and the `open` tool (Task 13) run
`parseMemoryId` on them. If wrong, a malformed id reaches a handler
that forgets to parse it; the final review checks both. Minor findings
deferred to the final review:

- `search`'s `after` and `before` are unchecked strings, and event
  texts and response arrays have no cap but the body's 8 MiB.
- `from` is not checked against `through`, and a private record may
  still carry a transcript.
- A strict schema's message names the unknown key the client sent.
- The tests cover the plan's cases alone, not the responses, the tool
  shapes or the caps.

### Task 7: host profiles

Complete in `8cfd322`; review clean, and the profiles' tests pass 3 of
3. Minor findings deferred to the final review:

- A profile that is not JSON throws without naming its file, and a
  schema failure reports its first issue alone, without the field.
- An empty profile directory loads without complaint.
- The test of the shipped profiles checks two of their values.
- Codex's profile allows 512 characters of instructions, where the
  constraints say under 512; Task 13's instructions settle it.

### Task 8: the engine interface and the baseline engine

Complete in `556cfbb` and `f6ac009`, after one fix round; the memory
package passes 1169 of 1169. The review found two faults:

- The baseline narrowed a search to its scope only after recall cut it
  to ten, so a scoped search could come back empty while matches
  existed. Ruling: narrow before the cut, without changing recall for
  its present callers. `recall/query.ts` gained an optional `within`.
  If wrong, a costlier query.
- Search gave retired facts as live, which the block's ranking leaves
  out. Ruling: the baseline drops them. If wrong, a retired fact is
  found by `--facts` alone.

The re-review found both addressed. Minor findings deferred to the
final review:

- The baseline's `extract` lets the reviewer write notes and tags
  itself, as the plan has it, and its index sync may run the facts
  migration without the store's lock.
- A project lookup runs once a hit, outside the index's exclusive
  section; `rankEpisodes` uses the clock, not the `now` passed in, and
  drops the catalogue's warnings; its comparator breaks on a bad date;
  `extract` drops the review's outcome.
- Tests do not cover the `all` and `episodes` kinds, `exclude` or a
  missing reviewer; `knowledgePath` would sit better beside the
  interface.

### Task 9: the opening block

Complete in `04af0c3`; review clean, and the memory package passes 1179
of 1179. The review checked the budget's arithmetic by hand: a block
never passes its budget but for the closing line alone, and no item is
cut midway. A `startup` for a session with a kept block returns that
block. Ruling: this stands, as the spec renders anew only for `compact`
and `clear`. If wrong, a host reusing a session id across projects sees
a stale block. Minor findings deferred to the final review:

- Tests do not cover `resume` with nothing kept, one session under two
  hosts, `clear`, a repeated `startup`, or a sweep of budgets; one
  check of a second item's tier passes if the item is missing.
- Sizes count code points, not UTF-16 units; a section's wrapper that
  does not fit ends every later section; an empty body renders a
  trailing space; an episode with an abstract but no description shows
  its title alone.

### Task 10: recall for a prompt

Complete in `020ea33`; review clean, and the memory package passes
1184 of 1184. The review found the budget never passed, passages whole
or skipped, and recall asking for personal knowledge and its own
project's alone. Minor findings deferred to the final review: the tests
do not check the scope recall asks for, the budget's exact edge, a
request's budget clamped to the host's, a budget below the frame, or
escaping.

### Task 11: records into the archive

Complete in `5567c44`; review clean, and the memory package passes 1192
of 1192. The review found the check for events already held and the
append within one section under the lock, a private session touching
nothing, and a `transcript` path passed unread to its reader, whose
handling of the path the final review checks once it is wired. Minor
findings deferred to the final review:

- The concurrent test does not check the order stored, and the private
  test does not check that nothing was written.
- A record with both a transcript and events drops the events without
  a word; each record reads the session's whole file under the lock;
  the session cache trusts a file that history may remove.
- A host named `chat` would read as her own chat's conversations.

### Task 12: remember through the contract

Complete in `83a927b`; review clean, and the memory package passes 1202
of 1202. As Task 6's ruling has it, `remember` parses every id with
`parseMemoryId`, and a test refuses eight malformed or traversing ids
without a write. As Task 2's finding asks, a host it writes is checked
against core's `HOST_ID`, the pattern a fact file is parsed with. The
review found no write to another project's scope and none outside the
lock. Minor findings deferred to the final review:

- A `why` over 160 characters fails as a 500, not a 400, as her own
  `remember` does today.
- The host check refuses a retire too; a revise without a host drops
  the host the fact had; no test revises another project's id.

### Task 13: the four MCP tools

Complete in `9362215` and `1132f8f`, after one fix round; the memory
package passes 1216 of 1216, and the server's instructions run to 205
characters. The review found two faults in the plan's code:

- `open` read another project's knowledge or conversation by its id.
  Ruling: it refuses them with a 403, as the spec gives another
  project's knowledge only through `search` with `scope: all`. If
  wrong, a model sees such a hit's snippet but cannot open it, which a
  small change relaxes.
- A failure other than the contract's own reached the client word for
  word, paths and SQL with it. Ruling: it now reads `Memory failed.`
  If wrong, a client has less to report.

The re-review found both addressed, and no crafted id that passes the
scope check while naming a file elsewhere. Minor findings deferred to
the final review:

- The generic failure leaves no trace on the service's side.
- `through` filters a window already cut to its budget, as the plan
  wrote it.
- No test pins `search`'s limit or a `remember` error reaching the
  client.

### Task 14: device tokens

Complete in `c2a4ac6` and `1e9a43f`, after one fix round; the memory
package passes 1224 of 1224. The review found the tokens' making,
hashing, comparison and file mode sound, and one fault in the plan's
code: a token file that could not be read counted as empty, so adding
or revoking a device over it erased every other device. Ruling: adding
and revoking take only a missing file as empty, and refuse any other
failure without touching the file, while verifying still trusts no
device. If wrong, a corrupt token file must be removed by hand. The
re-review found it addressed. Minor findings deferred to the final
review:

- The file is not synced before its rename, so a power loss could
  leave it empty, as the plan wrote it; a failed write leaves its
  temporary file.
- Adding and revoking are not serialised against each other, and the
  shape check is looser than the file's type.
- Tests do not cover several devices or a store reopened.

### Task 15: the memory service

Complete in `d67cdb4` and `479b713`, after one fix round; the memory
package passes 1242 of 1242. Beyond the plan, the service refuses a
body over 8 MiB sent in chunks, and `runTokenRevoke` returns 1 on a
token file it cannot read. The review found the defences against a web
page sound (any `Origin`, a foreign `Host` and a body not JSON are
refused), loopback judged by the socket's peer alone, and tokens
compared in constant time. It found one fault in the plan's code: the
Claude Code transcript reader followed any path a loopback caller
named, through `..` and links, into pipes and files of any size, and
echoed the system's error. Ruling: the service confines the path to
Claude Code's `projects` directory, by its real path, to a regular
`.jsonl` file of at most 64 MiB, and refuses anything else with one
fixed 403. If wrong, a transcript kept elsewhere cannot be recorded by
its path. The re-review found it addressed. Minor findings deferred to
the final review:

- Bun holds up to 16 MiB of a body before the 8 MiB check, a larger one
  gets a 413 without the contract's shape, and the MCP route reads its
  body unchecked.
- The `Host` check refuses a device reaching the service by name; a
  proxy or tunnel to loopback passes as loopback, which the docs should
  say.
- Session, version and block caches grow without bound; a host's
  version is logged unsanitised; a record's project is not checked
  before consolidation.
- The confinement leaves a window between check and read, and a hard
  link inside `projects` passes it; the Claude config directory is
  found by a copy of the CLI's code, which Task 18 can pass in.
- `startService` runs to some 400 lines, as the plan wrote it; tests
  lack a wrong token, a real socket's peer and a foreign `Host` on a
  POST.

### Task 16: the client

Complete in `5502917` and `6c5c19a`, after one fix round; the memory
package passes 1260 of 1260. The review found the timeouts real and the
waiting records written whole, but the plan's client neither always
failed open nor kept to its timeouts:

- A record refused for good, now including a missing transcript after
  Task 15's ruling, or a reply that did not match the schema, stopped
  every waiting record behind it forever. Ruling: a 2xx counts as
  delivered whatever its reply, a 403 is refused for good, and the
  flush stops only on a network failure, a timeout, 401, 408, 429 or a
  5xx. If wrong, a record refused by a passing 403 is dropped.
- `ensureService` threw on a bad URL, a missing program crashed the
  hook, and `[::1]` was not loopback; `flushPending` threw on a failed
  delete. Ruling: neither throws. If wrong, a fault goes unseen.
- A backlog made one hook wait two seconds a record, and starting the
  service waited four. Ruling: both run to a deadline, the record's
  budget and one second. If wrong, a backlog drains over more calls.
  The client gained an optional `timeouts` for its tests.

The re-review found all four addressed. Minor findings deferred to the
final review:

- An unlisted 4xx still stops the queue, and three calls read the
  configuration outside their guard; a record's send may spend twice
  its budget.
- Waiting records made in one millisecond may reorder; a kept block's
  path does not encode its host, and the fallback ignores the session.

### Task 17: the stdio bridge

Complete in `ab9846e` and `dea89ea`, after one fix round; the memory
package passes 1263 of 1263. The review found stdout kept to the
protocol, the token sent as a bearer alone, the service's defences
passed, and a service that is down answered with a clear MCP error. It
also found, by running the bridge, that it never exited when its stdin
closed, as the SDK's stdio transport ignores the end of its input.
Ruling: the bridge closes when its stdin ends. If wrong, a host that
closes its input but still reads loses the bridge. The re-review found
it addressed. Minor findings deferred to the final review:

- A request sent just before the input ends is forwarded, but its
  answer is cut off.
- A refusal reads as "unreachable"; a request has no timeout of its
  own; a failure before any output rejects instead of answering.
- Tests do not cover the project and host passed on, a 4xx, or the
  bearer header.

### Task 18: --serve and --mcp

Complete in `b9b1a7e`; review clean, and `cli` passes 112 of 112. The
implementer added the new modes' bullet to `packages/cli/AGENTS.md`,
which Task 19 was to add. The CLI does not pass its Claude config
directory to the service, whose runner takes none. Ruling: this stands,
as memory finds the directory the same way. If wrong, the two copies
drift and the service confines transcripts to the wrong directory. The
review found stdout untouched under `--mcp`, conflicting options
refused, and no secret printed. Run with its input closed, against
temporary directories and an address beyond loopback, `--mcp` exited
0 in 625 ms with nothing on stdout. Minor findings deferred to the
final review: the tests do not cover `--mcp` with `--serve`, `--host`
alone or `--token-revoke` without a device, and a repeated option keeps
its last value.

### Task 19: the documentation

Complete in `1d41cb2`; review clean. The README, the package guides, a
new guide to `contract/` and the spec now describe the code as the
rulings above left it; the bullets added early to `core` and `cli` were
moved or kept, not repeated. The review checked each fact the new
documents state against the code. Minor findings deferred to the final
review: the contract's guide says the queue stops "only" on the listed
failures, where any unlisted refusal stops it too, and the spec's
Migration and Failures sections do not yet say what the migration and
the client now do.

## Final review

Closed items from the final review and per-task deferred lists are
recorded by the roadmap sweep: see
[the sweep report](./2026-10-19-roadmap-sweep.md#task-2-service).
The sweep's Deferred section records its remaining limits.

A review of the whole branch, `3141323..47fe8a6`, found it ready with
fixes. Its four important findings, and how each was settled:

1. The opening block listed other projects' conversations, which `open`
   refuses. Ruling: the block keeps to personal conversations and the
   session's project's (`4fb901d`, `f101136`). If wrong, the block shows
   fewer conversations.
2. A request to a `Host` the service does not listen on got 403, which
   the client drops for good, so a device reaching it by another name
   lost every record. Ruling: it gets 421, so records wait, and the
   service warns once per name (`573bfb4`, `c054391`). If wrong, a
   record waits for a configuration the user must fix.
3. A tool's `project` argument overrode the connection's, so the model
   could open or write another project's memory. Ruling, taken by the
   coding agent on the user's delegation: on a connection with a
   project, `open` and `remember` refuse another (403); a connection
   with none still names its project by the argument (`1584cc6`). If
   wrong, a model in one repository cannot open another's by name.
4. Transcripts were confined to the Claude Code directory of the
   service's own environment, so a second account's were refused.
   Ruling, likewise delegated: `[service] claude-dirs` lists further
   directories, and the service warns once of a refusal (`71d8665`).
   If wrong, one more setting to keep.

`remember`'s store failure also passed its reason, which may name a
path, to the caller; it now reads `Memory failed.`, and the reason goes
to the service's log (`1c91417`). A re-review of the first three fixes
found them addressed; the coding agent re-reviewed them after the
user's other session reached its usage limit mid-review.

Left for later, from the final review:

- `brief`'s budget is not clamped to the host profile's (Goose 16000,
  Hermes 4000) when the bridge names a host.
- The hook API's `project` is any string of up to 512 characters,
  neither checked as a project's id nor resolved from a path, so a
  record may land under a project that is not one.
- With reviews off, the service's map of idle sessions grows without
  bound and no notes are written, and its "reviews are off" line goes to
  the detached service's ignored stderr.
- The history launch runs before the service binds its port, so a
  second service started by racing bridges does that work, then fails
  to bind.
- An unexpected tool failure leaves no trace in the service's log.

## Verification

Recorded at the end of each part, with `bun run check`.

Part 1, at `3a29dbb`:

```text
$ bun run check
 1758 pass
 1 skip
 0 fail
 136103 expect() calls
Ran 1759 tests across 104 files. [19.52s]
```

Part 2, at `1d41cb2`, run by Task 19's implementer: `bun run check`
exited 0, with 1876 tests passing, 1 skipped and none failing, across
117 files.

After the final review's fixes, at `71d8665`:

```text
$ bun run check
 1886 pass
 1 skip
 0 fail
 136440 expect() calls
Ran 1887 tests across 117 files. [21.35s]
```

Merged in #69.
