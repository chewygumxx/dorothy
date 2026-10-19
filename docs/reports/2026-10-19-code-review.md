---
ctime: 2026-10-19
mtime: 2026-10-20
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

Result: 22 reproduced findings, comprising 18 P2 and four P3 issues.
This was a first pass across all eight packages, with isolated probes for
suspected defects and selective reading of relevant tests. It is not an
exhaustive security or live-provider integration audit.

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
| R05 | Memory history and locks | Reviewed |
| R06 | Facts, projects, recall and transcripts | Reviewed |
| R07 | Chat memory, reviews and compaction | Reviewed |
| R08 | External body recording and hooks | Reviewed |
| R09 | TUI, editor and Markdown rendering | Reviewed |
| R10 | Root scripts, workspace wiring and final validation | Reviewed |

## Usage and resumption

No account quota or reset timestamp is exposed by the tools available to
this review. Do not invent a remaining allowance or a waiting duration.
If the environment supplies a retry time, honor it without busy retries.
A hard limit may prevent the agent from issuing a wait or resuming by
itself. This report is the durable handover in that case.

[Official OpenAI documentation](https://learn.chatgpt.com/docs/pricing)
directs users to the usage dashboard or CLI `/status` for their current
limits. No usage-limit response was received during this review.

Before resuming, inspect `git status` and compare HEAD to the target above.
Keep previously verified findings tied to that target. Recheck affected
areas if source changes. Continue a pending work item if one exists,
preserve probe evidence, and update this report after every batch. All
planned first-pass items are reviewed; a later pass can start with the
concerns below and the detailed notes' stated limitations.

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

### F15 (P2): Case variants of Authorization schemes evade scrubbing

Location: `packages/memory/src/scrub.ts:24`.

The scheme matcher is case-sensitive, but the named-secret pass excludes
schemes case-insensitively. Valid headers using `bearer`, `BEARER`, `basic`
or `TOKEN` with otherwise opaque credentials therefore evade both passes.
The real `toolEntry` probe preserved those fixture values while canonical
`Bearer` and `Basic` became `[secret]`. The resulting tool events persist
in transcripts and can reach reviews. Match schemes case-insensitively
in the redactor as well as the exclusion.

### F16 (P2): Sync retires a newly created fact named constructor

Location: `packages/memory/src/projects/sync.ts:441-447`.

`constructor` is a legal fact name. Looking up its nonexistent prior sync
record on a normal object retrieves `Object.prototype.constructor`, so
the first sync treats both sides as changed and the missing repository
file as an intentional deletion. The real sync probe retired the new live
fact with reason "deleted in the repository", reported a conflict, and
exported nothing. Test ownership before looking up prior records, or use
a null-prototype map.

### F17 (P2): Sync overwrites concurrent edits to MEMORY.md

Location: `packages/memory/src/projects/sync.ts:581-583`.

The index's hand-written check uses the initial repository snapshot.
After asynchronous fact reconciliation, sync replaces `MEMORY.md` without
checking whether its contents changed meanwhile. A deterministic fixture
inserted a hand-written heading immediately after that first read; sync
reported `index: written` and erased the new text. Fact exports already
recheck their snapshots. Apply equivalent protection to the index; its
lost repository-only notes are not recoverable from Dorothy's history.

### F18 (P2): Importing a repository edit drops foreign metadata and sources

Location: `packages/memory/src/projects/sync.ts:528-532`.

Project exports omit store-only OKF fields. Import constructs a fresh fact
without preserving `held.foreign` and `held.otherSources`, so an ordinary
description edit deletes both from the canonical store. A real export,
edit and import cycle lost a synthetic license field and external source
reference while retaining importance. Preserve the existing store-only
fields alongside the other metadata retained on import.

### F19 (P2): An out-of-scope hit suppresses scoped search fallback

Location: `packages/memory/src/recall/query.ts:454-465`.

Conversation search decides whether to fall back from all query terms to
any term before applying the allowed scopes. A full match in another
project can therefore suppress partial matches in the requested scope.
The SQLite fixture searched personal memory for "alpha beta": it returned
nothing while another project's full match existed, then returned the
personal "alpha" hit after only that unrelated row was removed. Restrict
scope before choosing the fallback, as the fact-search branch does.

### F20 (P2): URL-scoped Git credential helpers disappear for the mirror

Location: `packages/memory/src/history/binary.ts:94-95`.

Mirror push and fetch disable global Git configuration, restoring only
the values of the exact `credential.helper` key. A helper configured under
a URL-specific credential section is omitted. In the isolated fixture,
ordinary Git credential lookup invoked that helper and succeeded, while
Dorothy returned an empty helper list. With no explicit mirror token,
otherwise working HTTPS authentication fails. Resolve helpers for the
actual remote URL while retaining their scope and reset semantics.

### F21 (P2): A mirror timer firing during a push loses the later update

Location: `packages/memory/src/history/mirror.ts:130-134`.

If a new commit's scheduled timer fires while a prior snapshot is being
pushed, `push` returns the existing running promise. The timer is already
cleared, and completion schedules no follow-up. A real temporary Git repo
with a gated fake network push finished with one push, no timer and one
unsealed later commit still waiting. That commit stays out of the mirror
until another commit or launch. Retain a dirty flag or reschedule work
when the active push completes.

### F22 (P2): Concurrent chats compact the wrong shared transcript turns

Location: `packages/memory/src/memory/open.ts:329-333`.

Two TUIs resuming one conversation each retain a private turn history.
After A appends canonical turns 5-6, B appends its own next exchange as
canonical turns 7-8 but regards it as local turns 5-6. Compaction saves B's
local summary as shared cluster 5-6, validating numeric continuity without
checking which transcript turns it describes. Resume drops A's actual
turns and substitutes B's summary, leaving B's real turns duplicated in
the verbatim tail. The transcript retains A's text, but resumed contexts
omit it.

The integration probe used two real `openMemory` instances, real temporary
transcripts, sidecars and index, fake sessions and a fake model. It waited
for A's writes before B proceeded. Canonical turn 5 held A's fixture fact,
the saved cluster 5-6 summarized B, and A was absent from resumed context.
Claims serialize compaction calls, but do not reconcile private histories.
Validate authoritative transcript identities/ranges before saving, or
enforce exclusive live ownership of a conversation.

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
evaluation; 114 selected CLI and gateway tests; 55 history tests; and 448
memory and compaction tests. All passed. Passing tests are baseline
evidence, not evidence that the findings above are harmless.

Typecheck, format checking, Markdown lint, code lint and header validation
also passed. Code lint emitted one existing informational style notice in
`memory/reviewer.test.ts`; header validation warned of existing artifacts
without headers. Neither check modified files. The local checkpoint
commit ran the normal type, staged-file and commit-message hooks.

All findings were reproduced with mocks or temporary fixtures. The
service probe used in-memory MCP transports and fake fetch, without any
network traffic. No live provider integration was exercised.

The coordinating reviewer independently reran every saved finding probe,
including the two-chat compaction integration. Its initial fixture allowed
append ordering to vary, so the final version explicitly waits for A's
pair to appear in the canonical transcript before B sends.

## Coverage and evidence

The source inventory contains 176 non-test TypeScript files and 37,020
lines, including fixture helpers and declarations. Runtime code in all
eight packages received a manual first pass. Test inspection was selective;
the baseline suite executed every test file. The 10 bounded items above
separate the memory package's independent areas for resumption.

Root review covered manifests, workspace boundaries, toolchain scripts,
agent-memory setup, Git hooks and local CI wiring. It did not audit the
remote reusable CI implementation, dependencies' source, old report probe
scripts, or every agent skill and prose document.

Detailed per-area notes preserve the exact inspected files, test coverage,
discarded candidates and remaining gaps:

- [Contracts](./2026-10-19-code-review/contracts-notes.txt)
- [CLI and gateway](./2026-10-19-code-review/cli-notes.txt)
- [Evaluation](./2026-10-19-code-review/eval-notes.txt)
- [History](./2026-10-19-code-review/history-notes.txt)
- [Storage](./2026-10-19-code-review/storage-notes.txt)
- [Chat memory](./2026-10-19-code-review/chat-memory-notes.txt)
- [Source inventory](./2026-10-19-code-review/source-inventory.txt)

Saved probes, named by findings:

| Findings | Probe filename in the sibling evidence directory |
| --- | --- |
| F01 | `one-shot.probe.txt` |
| F02, F09 | `cli.probe.txt` |
| F03, F04, F10 | `eval.probe.txt` |
| F05, F06, F07 | `service.probe.txt` |
| F08 | `error-cost.probe.txt` |
| F11, F14 | `tail-editor.probe.txt` |
| F12, F13 | `bodies.probe.txt` |
| F15, F16, F18, F19 | `storage.probe.txt` |
| F17 | `index-race.probe.txt` |
| F20, F21 | `history.probe.txt` |
| F22 | `compaction.probe.txt` |

These are inert text artifacts, not test files or runtime utilities. Their
first six lines are the artifact header; the rest is the exact standalone
TypeScript probe. They contain synthetic credentials and fixture data
only. Their absolute imports name this checkout; adjust those paths if
replaying elsewhere. Several leave synthetic directories under `/tmp` for
inspection; others remove their own fixtures on exit.

For example, from this checkout, with Bun available:

```sh
tail -n +7 \
  docs/reports/2026-10-19-code-review/service.probe.txt \
  > /tmp/dorothy-review-replay.ts
bun --no-env-file /tmp/dorothy-review-replay.ts
```

## Recheck at c1aa151 (2026-10-20)

Target: `c1aa15161336bc7ccdab4e9e00ecf81aae2fbea0`, inspected in the
separate detached worktree `/tmp/dorothy-recheck`, removed afterward.
All 11 saved probes were rerun with temporary roots and their imports
redirected there. Adaptations supplied the new host profiles dependency,
resolved the SDK mock by its installed path, and used `HookDeps.agent`.
No target source was edited. Supplementary probes checked the remaining
cross-process token and dump-cleanup cases, and changed gold definitions.

Result: 18 findings reproduce unchanged, two reproduce in part, and two
are fixed. Partial means a remaining part of the original finding still
reproduces; no finding is left awaiting a recheck.

| Finding | Status | Observed at this target |
| --- | --- | --- |
| F01 | Reproduces | SDK result errors still exit zero. |
| F02 | Reproduces | Repeated settings still select the first model. |
| F03 | Reproduces | A long matching turn yields header-only context. |
| F04 | Reproduces | Resume silently omits a removed question. |
| F05 | Reproduces | `from: 5, through: 7` still returns turns 1-7. |
| F06 | Partial | In-process fixed; concurrent processes lose an update. |
| F07 | Fixed | `ef03867`: flush and send share one deadline. |
| F08 | Reproduces | Error results still emit no public cost event. |
| F09 | Partial | `0747cd6` fixes launch cleanup; dump still leaks gateway. |
| F10 | Reproduces | `--count 1` still allocates zero drafts. |
| F11 | Reproduces | Appending after a torn tail acknowledges lost text. |
| F12 | Fixed | `dfd9536`: a failed catch-up keeps its launch notes. |
| F13 | Reproduces | Malformed user text still gives no halt. |
| F14 | Reproduces | Ctrl+U still duplicates the first newline. |
| F15 | Reproduces | Case-variant Authorization credentials survive. |
| F16 | Reproduces | A new `constructor` fact is still retired. |
| F17 | Reproduces | A concurrent `MEMORY.md` edit is still overwritten. |
| F18 | Reproduces | Repository import still drops foreign/source fields. |
| F19 | Reproduces | An outside full match still suppresses fallback. |
| F20 | Reproduces | URL-scoped Git helpers are still omitted. |
| F21 | Reproduces | A push still consumes a later update's timer. |
| F22 | Reproduces | B's summary still displaces A's canonical turns. |

F06's saved same-process probe now retains all six devices, fixed by
`7682e23`. Its queue is process-local: two separate processes, gated after
both read the old file, both exited zero but retained only two of three
expected devices. F09's saved launch probe now stops its gateway and leaves
zero private settings files; the sibling dump probe still leaves its
gateway unstopped on the same real spawn failure. F07 took 101 ms for a
100 ms budget, including overhead, versus the former doubled budget.

Both concerns remain: `brief` still returns another project's full body
when its argument overrides the connection's project, requiring the same
scope-policy ruling. A valid non-lookup question's gold answer can change
without changing its id; a retrieval-only resume accepted that change
with status zero and no warning. No paid judgement was exercised.

Focused tests at the target: 103 passed, zero failed, 368 expectations
across the client, tokens, Claude launch and hook test files. The SDK and
MCP probe compatibility failures on the first replay were corrected
before assigning statuses. The review and sweep branches were not moved
by these runs; only this review branch receives the report update.
[Recheck evidence](./2026-10-19-code-review/c1aa151-recheck.txt) retains the
outputs, adaptations and supplementary probe sources.
