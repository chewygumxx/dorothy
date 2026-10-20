---
ctime: 2026-10-20
mtime: 2026-10-21
spdx: GPL-3.0-only
title: The recording implementation
description: >-
  Tasks, rulings, fix rounds, the probe on copied sessions and what was
  left of recording the sessions of Claude Code, Codex and Hermes.
tags:
  - dorothy
  - memory
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-20-recording.md
   -
   -->

# The recording implementation

## Summary

The [plan](../plans/2026-10-20-recording.md) carries out the
[recording spec](../specs/2026-10-20-recording-design.md) on
`docs/after-the-sweep`, starting at `9c90dc3`. Codex implemented Tasks 1
to 3; Claude implemented Tasks 4 to 7, because Codex's budget ran low
before Task 4, with Claude Opus on Task 4's last fix round. Claude and
Codex reviewed: Claude subagents each task, Opus the first review of
Task 4, and Codex that task's three re-reviews. Tasks 1, 2, 4 and 5 had
fix rounds before the next began; Task 4 had four.

This record consolidates the local task reports, reviews and controller
ledger, which are ignored under `.superpowers/sdd/`. Behaviour was built
test-first, each fix with a regression seen failing. Tests used
throwaway roots and synthetic fixtures in the shapes the stores showed.
No test read a harness's store or Dorothy's data. The one reading of the
user's real stores was the probe, which copied sessions and ran on the
copies, as its section says.

Verification before the final review and its fix wave:
`bun run check` passes with 3100 tests passing, one skipped and none
failing, its XDG roots in a temporary directory. The skip is the
existing code-simplification skill-link test. `lint:md`, `lint:emdash`
and `lint:header` pass; header verification reports only the existing
warnings for historical artifacts, none out of sync.

## Tasks

Ranges exclude their left endpoint and include their right endpoint.
Task 4's range holds its four fix rounds.

| Task | Subject | Commits | Implementer |
| --- | --- | --- | --- |
| 1 | Codex's reader | `9c90dc3..6b81817` | Codex |
| 2 | Hermes's reader | `6b81817..af6787e` | Codex |
| 3 | Sources and the sweep's state | `af6787e..800bf11` | Codex |
| 4 | The sweep | `800bf11..7e61b81` | Claude |
| 5 | Service, CLI, configuration | `7e61b81..99be6c0` | Claude |
| 6 | The probe | `99be6c0..8f357e9` | Claude |
| 7 | The record | `8f357e9..1ad7e1d` | Claude |

Claude Sonnet implemented Tasks 4 to 7 and the fix rounds of Tasks 4 and
5; a fresh Claude Opus took Task 4's fourth round. Tasks 1 and 2 had one
fix round each, Task 3 none, Task 4 four, Task 5 one. Task 6's work was
checked by the controller, not a reviewer. Claude Code's reader is not
among the tasks: the sweep reuses the recorder `dorothy --claude`'s hooks
already use.

## Rulings

These preserve every ledger ruling, including the operational ones and the
review rulings embedded in task entries. Where the ledger gives no cost,
the consequence below is this report's assessment, not a new ruling.

1. The user trusts the agent to proceed through the plan; running the
   backfill on the user's real data stays the user's call. Cost if wrong:
   a pause to ask, or a backlog recorded unasked, which the spec forbids.
2. Codex's tool outputs carry no success flag, so a paired output is
   `ok: true`, meaning only "answered"; Hermes's likewise. Cost if wrong:
   a failed call reads as a success until a structured mapping, such as
   Codex's `item_completed` status, is added.
3. A Hermes message's `sourceId` is the lowest row id among all physical
   rows of its session sharing its `message_uid`, rewound rows included,
   so a compaction's tail copies add nothing. Cost if wrong: a message
   recorded twice under new ids.
4. A Hermes compression child is recorded with its parent named, and a
   cloned row the parent holds is skipped. Cost if wrong: a child's tail
   duplicates its parent's turns.
5. Correctness never rests on a cursor: `sweep.json` may only skip a
   session unchanged since it was read (size, mtime, inode and device for
   a file; the highest physical row id and the row count for Hermes), and
   a changed one is read whole, with `sourceId` deduplication deciding
   what is new. This replaced the brief's append-from-offset reading.
   Cost if wrong: more I/O on a changed large transcript.
6. The watermark lives in the data directory beside the archive, not in
   `sweep.json`, so losing `sweep.json` only slows a sweep. Cost if wrong:
   one more small file in the data directory.
7. Carry-overs for the sweep: a vanished session skips, not its host; a
   read is remembered only after the archive accepted its events and any
   unread record was saved, never when halted; the Hermes fingerprint
   cannot see an in-place UPDATE, a known limit the guide states. Cost if
   wrong: a missed session or a skipped halt.
8. None of Claude Code, Codex or Hermes marks a session private in its
   store, so `isPrivate` is false for them, documented; the hook stays
   for OpenClaw's incognito. Cost if wrong: a private-marked session
   recorded.
9. `readHermes` gains `ended`: when a session is over, each unanswered
   call is recorded as a failed tool event and what follows is released,
   never past a halt. Cost if wrong: a call answered after the release
   stays recorded as failed.
10. Task 4 went to Claude when Codex's budget stood at 19 percent. Cost
    if wrong: implementation quality differs; the reviews are the net.
11. A backfill ignores remembered skip hints and records a waiting
    session whole; archive deduplication keeps a rerun harmless. Cost if
    wrong: repeated I/O on a second backfill (the probe's second run took
    0.66 s over 48 MB).
12. A session whose identity cannot be resolved has no privacy to decide,
    so it keeps no content: its halt becomes a pointer record with a
    one-line copy of its source key and line or row, and its new types are
    dropped. Cost if wrong: such a halt cannot be reread from a copy, only
    from the source, which stays authoritative.
13. A halted read is read again at every sweep and told once. Cost if
    wrong: cheap repeated I/O, deduplicated.
14. A missing `sweep.json` on a first run is silent; only a broken one
    warns. Cost if wrong: a file lost later goes unremarked, and the
    replay it causes is deduplicated.
15. A foreground `dorothy --sweep` leaves extraction to the next launch's
    catch-up for live records. The final fix wave persists backfill
    suppression in the sidecar; process maps are only hints. Cost if
    wrong: no immediate notes after a foreground live sweep.
16. A non-Claude halt is reread and dismissed under `--sweep`, as
    `--sweep --reread` and `--sweep --dismiss <host> <session>`, leaving
    `--claude-hook` to Claude; `--reread` visits only the sessions a halt
    was kept for, whatever `[recording] hosts` says. Cost if wrong: a
    flag shape to rename.
17. Counts are pluralised ("1 event", "2 sessions"), and `sweep-seconds`
    ranges from 10 to 86400, which the spec left open. Cost if wrong: a
    few words and one bound.
18. The probe's sample is 20 Claude Code transcripts, chosen at random
    among those idle an hour, over 4 KB and under 4 MB, and all 7 Codex
    rollouts, copied with `cp -p`. Cost if wrong: a rarer shape goes
    unprobed; none was met in the 27.

## Task 1: Codex's reader

`readCodex` is a pure reader of a rollout's lines into the contract's
events, with the session's id, working directory, model and start, the
first halt, the first of each unknown type and a pending call. Its shapes
were captured from the user's seven rollouts by a structural walk that
printed keys and value kinds, never text. Source ids are one-based line
ordinals; tool calls pair with outputs by `call_id`, an unanswered call
holding what follows until answered or ended.

The review found two Important and seven Minor points. User-role
messages carried Codex's own context (environment, instruction blocks)
and were recorded as speech; the fix drops each kind by its wrapper.
Any non-text block halted the session; images now read as `[image]` and
other known kinds are skipped, halting only an unrecognisable block.
Settled in fix round 1 (`1edfe06..6b81817`, eight addressed): the
success-flag policy is documented (Ruling 2), unobserved older spellings
dropped, the reader split into a decoder per record type, repeated call
ids paired in order, the guide's budget restored, and tests added for
the `session_id` fallback, a bad tool timestamp and a halt with a
pending call.

## Task 2: Hermes's reader

`readHermes` reads Hermes's `state.db` read-only and returns each
session's events, halt, unknown types and pending call. The schema came
from Hermes's installed Python source (schema version 31), as no session
data was opened; the user's database holds none. Known host prefixes and
memory fences are filtered from speech, and a malformed row halts only
its session.

The review found one Important and four Minor points. Compaction copies
the carried tail under fresh row ids with the same `message_uid` and
flags the originals as a rewind, so a message already swept would have
been recorded again; Ruling 3 fixes its id and the fix round
(`8b3a71a..af6787e`, five addressed) emits only the visible row. A
pre-uid copy cannot be linked, and is never merged on text; the guide
says such stores can yield duplicates. Children are recorded under their
parent (Ruling 4), and a merge's absorbed uids count as held. Applying
the cursor before decoding went to Task 3, which selects payloads in SQL
before decoding.

## Task 3: sources and the sweep's state

`sources.ts` lists each host's sessions and reads the changed ones:
Claude Code over its projects directory and every `[service] claude-dirs`
entry, Codex under `$CODEX_HOME` or `~/.codex`, Hermes under
`$HERMES_HOME` or `~/.hermes`, all from an injected environment. A read
carries its starting fingerprint and a stable flag, so a torn tail is
returned but not remembered. `state.ts` keeps `sweep.json`: version 1,
private, written whole and atomically; a missing or broken file starts
afresh with a static warning.

The user's ruling (Ruling 5) replaced the brief's offset cursor before
the task began, so the append test became whole-replay coverage, with
multibyte text and stable ordinals. The review approved it with no
Important finding and the ledger carries no Minor from it.

## Task 4: the sweep

`sweep.ts` visits each host, skips unchanged sessions by hint, reads the
rest whole and records through the contract's `record`, or for Claude
Code `recordSession`, so a session `dorothy --claude` began continues its
conversation. `watermark.ts` stores a host's first sweep; a session whose
events all precede it waits for the backfill, which records it and marks
it so `jobs.ts` never extracts it. A halt keeps the rest aside through
`unread.ts`, filed by host, and one host's failure does not stop another.

The first review found three Important points and six Minor. A Claude
read held behind an unanswered call was remembered, so the session was
lost; Hermes held reads were never remembered after an hour; the
backfilled set never shrank, so a session gone live was not extracted.
Round 1 (`f36e57d..4274140`, eight addressed) reported held lines, added
`ended` (Ruling 9), had a live record unmark the phrase through
`noteRecorded`, judged the watermark by event times and made a failed
`keepNewType` leave the read unremembered. The Hermes notice and
`--check` now say "row", a halted read with no events finds its
conversation, and the guide restored both cursor invariants.

Codex's re-review found two new Important points. A waiting session
returned early, acknowledging a held or halted read and bypassing
diagnostics; round 2 (`3aef15e..84c5dc9`) sends it through the same
`settle` tail as any read. Failed folded Hermes calls shared one
`sourceId`; each occurrence now gets its own. The next re-review found
privacy decided after diagnostics on waiting paths, and an occurrence
suffix that collided with a provider id holding a colon. Round 3
(`de6baaf..7327a3e`) decided privacy first on every path and
percent-encoded the id. A third re-review left one path: a read with no
session id skipped `isPrivate` and kept content. Round 4 (`7e61b81`, a
fresh Opus, controller-verified) closed it by ruling (Ruling 12), with
tests for Codex and Hermes and a pin for Claude, whose identity is the
file name. The re-review's exact probe asserts no unread record at all;
under the ruling a pointer record remains by design. One Minor is
deferred below.

## Task 5: service, CLI and configuration

`[recording] hosts` (default empty) and `sweep-seconds` (default 300)
join the configuration, validated as the rest. The service runs a sweep
at start and on the interval, never two at once, logging a line of
counts; a failure is warned and the next sweep still runs. A binding
(`service/recording.ts`) gives the sweep its `record`, `recordClaude`,
`conversation`, `isPrivate` and `onRecorded`; the store's lock is taken
only inside each record, never nested, which a depth-counting test pins.
`dorothy --sweep [--backfill]` prints a host and a count a line, and a
non-Claude halt's notice offers its reread and dismiss. The README gained
"Recording other harnesses" and a service guide was added.

The review approved with no Important finding. Fix round 1
(`9042294..99be6c0`, six addressed) settled Rulings 14 to 17, a reread
that visited only halted sessions, a README note that the service's first
sweep records whole, and queues for extraction, any session with events
after the watermark (so a large live backlog is reviewed while the
backfill takes the rest), a header comment rewrapped to 80 and memory's
Tests bullet restored. A Task 4 carry became a test: `--sweep --reread`
for a Hermes halt matches the listed session to the kept session id and
leaves a second session untouched; two mutations of the match each
failed it.

## Task 6: the probe

Its section, [below](#the-probe), holds the counts. The task also
carried the Hermes reread test above (`8f357e9`). It found no reader
defect: no halt and no unknown type came up in the 27 sessions, so no
reader fix was needed.

## Task 7: the record

This report; the spec's Verification gained the probe's finding; the
roadmap now shows Recording built, OpenClaw's reader under Candidates and
a Revisions line. Revising step 5 found the root and package guides
accurate to the merged code; the evaluation's guide gained one clause
saying `mine` yields no question from a backfilled session.

## The probe

All captures are in [the evidence directory](./2026-10-20-recording/).
Bun was 1.4.2 and the code under test `99be6c0`. A temporary root held a
throwaway home and XDG directories, with `env -i`; `cp -p` copied 20
Claude Code transcripts (15 MB) and 7 Codex rollouts (33 MB) into it, and
nothing was written to the user's stores. No session content, id, home
path or address is in the captures, which give counts and record kinds
by name.

- [Sweep](./2026-10-20-recording/1-sweep.txt): Pass: the first sweep
  noted the hosts' time and recorded nothing, 20 Claude Code and 7 Codex
  sessions waiting for the backfill; no conversation made; 0.45 s.
- [Backfill](./2026-10-20-recording/2-backfill.txt): Pass: 1,240 events
  in 20 Claude Code sessions and 1,293 in 7 Codex, 27 conversations and
  2,533 events (session 27, user 106, assistant 520, tool 1,907); no
  halt, no unknown type; 1.01 s for 48 MB. A second backfill recorded 0
  and 0 in 0.66 s, so a sweep is idempotent.
- [Evaluation](./2026-10-20-recording/3-evaluation.txt): Pass with a
  finding: the snapshot held 27 conversations and no knowledge files;
  `mine` made 0 questions, and a retrieval-only run stopped with "no
  accepted questions", exit 1, rather than reporting zero. `mine` reads
  her own `open` calls whose reads her review judged useful, and a
  backfilled session holds none. The final fix below makes its no-review
  mark durable; a later live append clears it.
  Questions over such sessions need `generate` and `review`, which name a
  model. Recall was not measured.

No model call was made. The spec's Verification names this finding.

## Deferred

Every controller-ledger "minor (deferred)" line is retained here, with
the open items the work leaves.

- **Task 1:** User speech beginning with an unclosed host-wrapper marker
  is dropped; deliberate and tested.
- **Task 2:** A merge of a swept and an unswept message is suppressed
  whole, never split on text; its unswept text is never recorded. The
  guide now states this cost (M6).
- **Task 2:** A child's held set includes uids its parent never emitted,
  when the parent is halted or pending; rare.
- **Task 2:** `decoded` is shadowed in `decodeSpeech`; rename.
- **Task 4:** Hermes cannot reach the unnamed-session path with the real
  source, which always names its row id; the path is guarded through an
  injected source.
- OpenClaw's reader waits until OpenClaw is installed and probed.
- Hermes holds no sessions yet, so its reader is tested against its
  source's schema only.
- The evaluation can mine no questions from backfilled sessions, so a
  first run on them needs `generate` and the owner's `review`.
- Running `dorothy --sweep --backfill` on the user's real data is the
  user's call.

Other limits stand as documented: the Hermes fingerprint cannot see an
in-place UPDATE; the Codex and Hermes `ok` means answered only; a pre-uid
Hermes store can yield duplicate events; the service's first sweep
records, and queues for review, a large live backlog in full; a capped
review of backfilled sessions, recording through each harness's hooks,
and subagents' transcripts linked to their parents remain the spec's
Later.

The follow-up's check left these: a resumed chat on an unparseable sidecar
warns on every turn, not once; a chat turn's cleared mark reaches
history with the next sidecar commit, not its own; resolving a halt
reads its record on each clean read. By reading only: a live sweep's
`waits` path, for a session whose mtime was refreshed, rewrites a
backfill-kept halt as live, so a later reread makes it reviewable;
and a hook that re-halts at the same line clears a backfill-kept
halt's flag, which live activity justifies.

## Final review

The whole-branch review found one Critical, three Important and six
Minor findings. The final fix wave addressed all ten under the user's
rulings, test-first for behavior, without reading real stores. The
original probe captures remain historical evidence, rather than a
verification of the corrected review-suppression mechanism.

| Finding | Settlement | Fix commits |
| --- | --- | --- |
| C1 | Durable backfill review suppression | `5fcf1c4`, `9a1ae06` |
| I1 | Sync before Claude's first swept record | `bada695` |
| I2 | Publish session identity under the creation lock | `ef93610` |
| I3 | Reread old halts with their backfill provenance | `3bed855` |
| M1 | Age alone ends a backfilled session | `be6219e` |
| M2 | Persistent atomic markers log diagnostics once | `44ae118` |
| M3 | Quiet sweeps leave no counts line | `91d4e86` |
| M4 | Progress every 100 backfilled sessions | `135f77f` |
| M5 | Correct Task 7's range and roadmap candidates | `7a41802` |
| M6 | State the unswept Hermes merge constituent's loss | `db072cc` |

C1 now persists a sidecar mark under the recording lock, in the same
history change as the transcript. Chat catch-up, the shared reviewer
used by the hooks, and service extraction all honour it. A live append
clears the mark; a replay does not. The process-local set is only a hint.
A foreground backfill followed by chat catch-up makes no review call;
a live turn then permits one, tested for Claude Code and Codex. The
sidecar helper writes under the already-held lock without joining the
ordinary sidecar queue: self-review found and tested the inverse queue
wait that the first implementation introduced (`9a1ae06`).

I1's test records as the hooks do, rebuilds the index and then sweeps:
one conversation and one copy of each source uuid remain. I2's test
uses independent index connections, both synced before either record,
then orders the lock-held writes: Codex and Hermes each create one
conversation. The first writer publishes its mapping before unlocking,
so the second writer's lookup sees it even after a stale sync.

I3 lets a reread visit every selected halt past both watermark gates.
The halt journal carries whether the read was a backfill, including
when it made no conversation; a repair preserves that suppression.
M1 keeps every recently modified session pending through a backfill,
then accepts a later answer, tested for all three hosts. Backfill no
longer implies that a session is over.

M2 uses atomic hashed markers alongside unread state for each halt and
unnamed source, so a dismissed or unchanged halt does not flood the log.
M3 retains counts for records, halts, failures and stopped hosts only.
M4's 201-session test checks the archive size when each progress line
is written, proving progress appears during the work. M5 gathers the
recording limits and capped review in Candidates, and includes Task 7's
last commit. M6 documents the cost of suppressing a whole mixed merge;
the underlying limitation remains as ruled.

The behavior regressions were each seen failing before their fixes.
Final verification: `bun run check` with all XDG roots in a temporary
directory, 3,116 passing, one existing skip, zero failures.
The final fix report retains the individual RED and GREEN commands and
outputs. No real backfill, model call, push or branch change was made.
The user's backfill remains their call, after these fixes are verified.

### Follow-up

- N1: unparseable sidecars leave the canonical transcript writable. Both
  recorders warn and skip the mark without changing the broken bytes;
  a sweep continues to later sessions. Existing review and extraction
  guards still pass over unreadable notes.
- N2: Claude halts retain backfill provenance too. The actual hook
  reread command passes it to the recorder, preserving suppression both
  when the backfill made a conversation and when it halted before any
  event. No paid review becomes due merely because the halt was repaired.
- N3: a backfill marks only conversations it creates, preserving marks
  already present. Existing live conversations stay reviewable when a
  backfill adds turns, even after extraction emptied the service's idle
  map. Sweep callbacks report the durable eligibility, not command mode;
  the README and recording guide state this narrowed ruling.
- N4: only newly logged halts contribute to a sweep's halted count.
  Standing halts remain unremembered and are reread, while the service's
  counts-line filter stays quiet. Claude's recorder reports a new halt
  separately from its persistent halted state, preserving acknowledgement
  and hook reread behavior.
- N5: resuming a swept Codex or Hermes conversation in chat clears its
  mark after a user or assistant event is written, under the transcript
  lock and flush queue. Opening a chat or recording only its ready event
  leaves the mark intact. Actual openMemory resumes restore catalogue
  review eligibility, including when history is off.
- N6: resolving or dismissing a halt removes its own hashed log marker,
  preserving unrelated markers. Replacing a halt at another position
  also removes the superseded marker. Dismissed standing halts remain
  quiet; once resolved, a recurrence logs and counts again in every host.

Follow-up fixes: `bf90a04` (N1), `5b54eaa` (N2), `58ce48d` (N3),
`807020b` (N4), `7e40983` (N5), and this change (N6). The follow-up
verification passed `bun run check` under temporary XDG roots: 3,143
passed, one existing skip, zero failures. Individual RED/GREEN commands
and outputs are in the ignored final fix report.
