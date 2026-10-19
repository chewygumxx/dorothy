---
ctime: 2026-10-19
mtime: 2026-10-19
spdx: GPL-3.0-only
title: Repository code review
description: >-
  Resumable review of Dorothy's packages, with coverage, verified defects
  and isolated verification evidence.
tags:
  - review
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-19-code-review.md
   -
   -->

# Repository code review

## Scope and checkpoint

Review target: `7602316f9dd3e1d8a46f0b1b885162a759d4ea58`.
Branch: `codex/code-review`. The starting checkout was clean.

This reviews the existing code, rather than a change between commits.
Production code stays unchanged. Findings require a concrete trigger and
an observable consequence; speculative concerns are kept separately.
Tests and probes use temporary roots, fake models and local fixtures.
No real user data, secrets or paid model calls are needed.

## Work queue

Each row is a bounded review item. Update it as evidence arrives, so a
new session can resume with pending items without repeating completed
ones. Review includes relevant tests and callers across boundaries.

| Item | Area | State |
| --- | --- | --- |
| R01 | Core contracts, identity and agent | Reviewed |
| R02 | CLI and gateway | Reviewed |
| R03 | Evaluation | Reviewed |
| R04 | Memory contract, service, engines and host profiles | Reviewed |
| R05 | Memory history and locks | In progress |
| R06 | Facts, projects, recall and transcripts | In progress |
| R07 | Chat memory, reviews and compaction | In progress |
| R08 | External body recording and hooks | Reviewed |
| R09 | TUI, editor and Markdown rendering | Reviewed |
| R10 | Root scripts, workspace wiring and final validation | In progress |

## Usage and resumption

No account quota or reset timestamp is exposed by the tools available to
this review. Do not invent a remaining allowance or a waiting duration.
If the environment supplies a retry time, honor it without busy retries.
A hard limit may prevent the agent from issuing a wait or resuming by
itself. This report is the durable handover in that case.

Before resuming, inspect `git status` and compare HEAD to the target above.
Keep previously verified findings tied to that target. Recheck affected
areas if source changes. Continue the next pending work item, preserve
probe evidence, and update this report after every completed batch.

## Findings

Priorities: P1 needs urgent attention, P2 is a normal correctness fix,
and P3 is lower impact. Locations refer to the target revision above.

### F01 (P2): One-shot commands silently succeed on model errors

Location: `packages/agent/src/one-shot.ts:34-40`.

The SDK can yield a result with `is_error: true` instead of throwing.
`runOneShot` handles text deltas only, so bad credentials, overload and
execution errors yield a blank line, empty stderr and exit status zero.
The CLI relies on this function to mark failure. An isolated SDK mock
reproduced both an API error and an execution error with those outputs.
Handle error results explicitly as the interactive conversation does.

### F02 (P2): Repeated Claude settings keep the first value

Location: `packages/cli/src/claude.ts:393`.

With memory enabled, passing Haiku settings followed by Sonnet settings
emits a merged settings argument selecting Haiku. Each iteration merges
previous user values above newer values. Claude's documented last-setting
precedence is reversed, silently retaining an earlier model or permission
setting. The isolated launch probe printed `model: "haiku"` for this
case. Resolve effective user settings before adding Dorothy's overrides.

### F03 (P2): Long matching turns disappear from evaluation context

Location: `packages/eval/src/systems/corpus.ts:113-116`.

When the best matching turn exceeds its passage allocation, `passage`
removes that entire turn and returns immediately. If it was the first
candidate, the answerer receives only the title and dates, while recall
still counts the conversation as retrieved. At the default 8000-character
budget, the lexical system returned only a header for a turn beginning
"My bicycle is crimson" followed by 8000 characters. The answer near the
start fits the budget but is absent. Clip or excerpt the relevant turn.

### F04 (P2): Resume silently loses questions removed since a run began

Location: `packages/eval/src/run/run.ts:378-381`.

Resume intersects the run's question ids with currently accepted questions
and checks only whether the intersection is empty. Removing or editing an
outstanding question can therefore skip it while reporting success and
retaining the original declared question count. A fixture run with two
question ids, one removed before resume, exited zero with no warning and
one record. Comparisons still regard its original question set as intact.
Preserve immutable run questions or reject missing or changed definitions.

### F05 (P2): The contract's open range includes turns before from

Location: `packages/memory/src/contract/tools.ts:140-154`.

The new `from` argument is passed to the old recall API as a window's
center. Only the upper `through` bound is filtered. On ten short turns,
`open` with `from: 5, through: 7` returned turns 1 through 7. The tool
promises to read from the lower bound, so paged reads repeat earlier
context and spend the size cap on unrequested turns. Apply both bounds
when adapting the centered legacy window to the contract's range.

### F06 (P2): Concurrent token changes overwrite each other

Location: `packages/memory/src/service/tokens.ts:136-165`.

Token additions and revocations read and replace the entire token file
without a shared lock. Atomic rename prevents torn JSON but cannot
serialize these changes. Five concurrent additions all resolved, yet the
store retained only one new device and the preexisting one. Overlapping
revocation and addition can likewise restore a revoked hash from a stale
copy. Serialize the complete read, modify and write operation across CLI
processes, and retain the existing private-file modes.

### F07 (P2): Sending a record can spend its timeout twice

Location: `packages/memory/src/service/client.ts:269-278`.

`sendRecord` gives the backlog a full record timeout, then grants the
current record another full timeout if that backlog drains. A fake fetch
taking 80 ms for the queued record and hanging on the new one took 183 ms
with a 100 ms timeout. With defaults this can approach four seconds in a
hook promised a two-second deadline. Share one deadline across flushing
and sending the new record.

### F08 (P3): Failed chat replies lose their incurred cost

Location: `packages/agent/src/conversation.ts:401-406`.

An error result carries cumulative cost, but `#failTurn` emits no public
cost-bearing event. The TUI accounts cost on `turn-end` and reconnects
after this error, losing the failed session's spend from displayed and
recorded totals. A mock result carrying USD 0.25 emitted only a partial
delta and error. Preserve and account for that cost on failed turns.

### F09 (P3): A synchronous Claude spawn failure bypasses cleanup

Location: `packages/cli/src/claude.ts:810`.

`spawn` runs before the cleanup `try/finally`. A found executable with a
missing shebang interpreter makes real `Bun.spawn` throw `ENOENT`, leaving
the gateway unstopped and private merged settings on disk. The fixture
probe observed `stopped: false` and one settings file remaining. Include
spawning in cleanup coverage. The gateway cleanup gap also exists in
`packages/cli/src/claude-dump.ts:67`.

### F10 (P3): Generating one question allocates zero questions

Location: `packages/eval/src/questions/generate.ts:57-61`.

Independent rounding of each type's share turns supported `--count 1`
into six zero targets, so no model is called and no shortfall is reported.
Other totals drift too: 10 allocates 11, 100 allocates 101, and 300
allocates 299. A direct allocation probe reproduced these totals.
Distribute the integer remainder so the requested total is conserved.

### F11 (P2): Recording after a torn tail acknowledges unreadable events

Location: `packages/memory/src/contract/record.ts:138-139`.

After a writer dies midway through JSONL append, the next generic record
opens the existing transcript without repairing its incomplete tail.
The new event joins that tail on the same line and becomes invalid JSON,
yet the response acknowledges it as accepted. A fixture first recorded
one message, appended an incomplete JSON fragment, then sent a second:
the response accepted the second, but `readTranscript` returned only the
first. The client drops acknowledged events, so incremental senders can
lose them. Repair incomplete tails under the write lock, as Claude's
`recordSession` already does.

### F12 (P2): Failed catch-up deletes the only automatic retry notes

Location: `packages/memory/src/bodies/hook.ts:541-547`.

`holding` returns false when neither the index nor history can lock the
store, but catch-up ignores this and removes the launch's notes anyway.
After a transient cache failure with history disabled, a fixture catch-up
exited zero, recorded nothing, left no unread record, and deleted its
launch note. A notice survives, but the next stale-launch scan cannot
discover the session to retry. Keep the notes until recording succeeds.

### F13 (P2): Malformed user text is skipped without a recovery halt

Location: `packages/memory/src/bodies/claude-code.ts:439-441`.

A mapped user text block whose text is missing or non-string returns
null, whereas the same malformed assistant block throws `Unreadable`.
A fixture malformed user followed by a valid assistant returned only the
assistant and `halt: null`. Recording can advance its last source UUID
past the skipped user, so no recovery copy is made and subsequent reads
skip it. Halt on malformed known text blocks instead of silently treating
them as bookkeeping.

### F14 (P3): Killing at the start of an empty first line inserts a newline

Location: `packages/tui/src/editor.ts:104-106`.

For a draft beginning with a newline and cursor zero, `lastIndexOf` clamps
the negative search position to zero and finds that first newline.
Home or Ctrl+A moves forward to offset one; Ctrl+U calls `cut` with
reversed bounds and duplicates the leading newline. The pure editor probe
turned `"\nhello"` into `"\n\nhello"` with no killed text. Return offset
zero directly when the cursor is already at the start.

## Concerns needing a further ruling

- `brief` accepts another project argument on a project-bound connection
  and returns its full knowledge body; an in-memory MCP probe confirmed
  it. The general scope policy says other projects are reached only via
  `search` with `scope: all`, but the tool-project precedence paragraph
  expressly restricts only `open` and `remember`. Resolve that policy
  inconsistency before treating this behavior as a security defect.
- Evaluation question ids omit gold answers and several context fields.
  Editing them can mix old verdicts and new definitions in one resume.
  This was traced through the callers, not separately executed; F04's
  immutable-question approach would address it as well.

## Verification

Baseline with all four XDG roots under a fresh temporary directory:

```text
2154 pass
5 skip
0 fail
137454 expect() calls
Ran 2159 tests across 131 files. [22.90s]
```

The command was `bun run test` with the installed Bun 1.4.2 directory first
on PATH. The mise shim refused the untrusted worktree config; the direct
binary required no trust changes. The sandboxed suite failed on loopback
binding and synthetic filesystem behavior; the approved rerun outside the
sandbox passed. Those environmental failures are not code findings.

Additional focused runs: 154 tests for core, identity and agent; 259 for
evaluation; 114 selected CLI and gateway tests. All passed. Passing tests
are baseline evidence, not evidence that the findings above are harmless.

All fourteen findings were reproduced with mocks or temporary fixtures. The
service probe used in-memory MCP transports and fake fetch, without any
network traffic. No live provider integration was exercised.
