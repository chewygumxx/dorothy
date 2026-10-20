---
ctime: 2026-10-20
mtime: 2026-10-20
spdx: GPL-3.0-only
title: The roadmap sweep implementation
description: >-
  Tasks, rulings, fixes, live probes, retained limits and verification
  of the roadmap sweep on docs/roadmap-evaluation.
tags:
  - dorothy
  - memory
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-19-roadmap-sweep.md
   -
   -->

# The roadmap sweep implementation

## Summary

The [plan](../plans/2026-10-19-roadmap-sweep.md) carries out the
[sweep spec](../specs/2026-10-19-roadmap-sweep-design.md) on
`docs/roadmap-evaluation`, starting at `7602316`. Claude and Codex
implemented tasks sequentially in this checkout; Claude and Codex
reviewed their changes, with fix rounds before the next task. The
[repository code review](./2026-10-19-code-review.md), its recheck at
`c1aa151` and its saved probes joined the sweep in Tasks 4-10. Its report
and evidence were brought onto this branch in `36b1dcf`, `a47d1c2` and
`9c04adc`.

This record consolidates the local task reports, reviews and controller
ledger, which are ignored under `.superpowers/sdd/`. Earlier report
limitations remain historical findings; closure links point here.
Behaviour fixes used failing regressions first; test gaps were checked
against the existing behaviour, with mutations where needed. Tests used
throwaway roots, fake models and loopback servers. Task 11 alone used
the real API through the user's login, with its cost counted below.

Final verification for the tree committed with this report:
`bun run check` passes after the final fix wave, with 2763 tests
passing, one skipped and none failing, its XDG roots in a temporary
directory. The skip is the existing code-simplification skill-link
test. No test flaked in Task 12 or the final fix wave. The existing
informational Biome suggestion in `memory/reviewer.test.ts` remains.
Header verification also reports existing exempt memory entries and
historical probe artifacts as warnings; none is out of sync and the
required-header tests pass.

## Tasks

Ranges exclude their left endpoint and include their right endpoint.
Task 4's range also contains the three review-document imports above.
The final fix wave's two ranges end at their last code commit; the
commits that record them fall inside or just after.

| Task | Subject | Commits | Implementer |
| --- | --- | --- | --- |
| 1 | Knowledge fence | `7602316..b02f4dd` | Claude |
| 2 | Service | `b02f4dd..2c99e8b` | Claude |
| 3 | Recording | `2c99e8b..c1aa151` | Claude |
| 4 | Dates and edges | `57a0666..9a7dac5` | Claude |
| 5 | Store | `9a7dac5..e175971` | Both |
| 6 | History | `e175971..1f3b044` | Codex |
| 7 | Tags | `1f3b044..e75014b` | Codex |
| 8 | Recall, compaction | `e75014b..cc061f2` | Claude |
| 9 | Tooling | `cc061f2..f956e2c` | Claude |
| 10 | Code review | `f956e2c..dc09077` | Both |
| 11 | Probes | `dc09077..8883ac8` | Codex |
| 12 | Record | `8883ac8..5eb5448` | Codex |
| Final | Review fixes | `5eb5448..4fcf93d` | Claude |
| Follow-up | Re-review fixes | `87a1946..f616282` | Claude |

Claude Opus implemented Task 1, Claude Sonnet Tasks 2-4 and 8-9. Task 5
began with Claude and its fixes used Codex; Task 10 likewise began with
Claude and its two fix rounds used Codex. Task 12's final docs commits
complete the range after its two small fixes. Tasks 1-4, 6-9 and 11 had
one fix round each; Tasks 5 and 10 had two. Task 12 was reviewed and
approved. The whole-branch review then found a Critical, two Important
and six Minor findings, closed by the
[final fix wave](#the-final-fix-wave) on Claude Opus.

## Rulings

These preserve every ledger ruling, including the operational ones and
review rulings embedded in task entries. Where the ledger gives no cost,
the consequence below is this report's assessment, not a new ruling.

1. Findings are requirements as written at their sources, verified
   against current code. A change to spec-pinned behaviour is reported,
   not made, unless the sweep authorizes it. Cost if wrong: a few
   findings remain open.
2. Probe captures belong beside this report in its same-named directory,
   following the docs convention. Cost if wrong: files to move.
3. The unconfirmed warning applies however text is reached, including
   per-prompt recall passages. Cost if wrong: a few words in recall.
4. Block packing may continue past a section whose frame cannot fit,
   consistent with filling until the budget is spent. Cost if wrong:
   packing to revert. A mutation-backed test pins it (`b02f4dd`).
5. A forged verification written directly into the data directory is
   outside `remember`'s threat model; history treats it as an outside
   edit. Cost if wrong: a model with filesystem access can confirm its
   own text. The pending journal is bookkeeping, not authentication.
6. TOCTOU and hard links inside Claude's projects directory are moot:
   writing there already needs the user's account, and confinement is
   by real path. Cost if wrong: a local-attacker read path.
7. With reviews off, idle conversations may leave the service's map if
   chat catch-up still sees them as stale. Verified in `d675d72`; catch-up
   is capped and most recent first. Cost if wrong: an older conversation
   waits unreviewed until touched or a later launch.
8. The note and tag editors' `yours, <day>` comments use local days, as
   the sweep's date rule requires (`eeadaa7`). Cost if wrong: two small
   display changes.
9. Codex was authorized to implement Tasks 7 and 10 in the main checkout
   while no Claude implementer ran; Claude would review. Approval
   questions went to the user. Cost if wrong: coordination or review
   overhead. No concurrent implementation was intended.
10. The user then assigned Tasks 6-10 and fix rounds to Codex with Claude
    reviews; budget limits later returned Tasks 8-10 to Claude, with
    Codex taking fixes after reset. Cost if wrong: implementation
    quality differs; reviews are the net.
11. A stale index lock is kept whenever a running Git is known. With
    inspection unavailable, it may be cleared after ten minutes; an
    inspected absent Git permits clearing after one minute. The original
    indefinite-retention choice was superseded in `2701857`, `7c763fc`.
    Cost if wrong: an uninspectable long-running Git may lose its lock.
12. A chat hidden mid-run is fixed only if the review can see the new
    catalogue flag without reading the index. Its launch snapshot
    cannot; Task 7 calls the finding moot and retains the boundary.
    Cost if wrong: a review can reuse a now-hidden chat's sole concept
    until the next launch.
13. Strip all `# error:` lines wherever the user moved them in an editor
    retry, rather than just at the top (`cde6907`). Cost if wrong: a
    deliberately authored line with that prefix is stripped.
14. Deleting only `Abstract:` must not join its paragraph to the
    description: reopen with an error (`cde6907`). Cost if wrong: a
    deliberate identical concatenation needs a less ambiguous edit.
15. Compaction waiting behind another TUI's claim remains by design,
    bounded at 150 seconds per call. Cost if wrong: a delayed launch.
16. `.agents/memory/` stays exempt from required breadcrumbs: Dorothy's
    export and clients' memory write it in their own format (`d64e388`).
    Cost if wrong: four older memory files remain unheaded. JSONC files
    do require headers. `build(config)` remains an allowed commit form.
17. Dropping inline user settings on a private-file write failure is a
    real defect in scope for Task 10's fix round (`3ec893f`). Cost if
    wrong: extra fallback logic; original flags now survive intact.
18. Resume refuses legacy or incomplete question-definition maps instead
    of accepting unverifiable old answers (`5289bda`). Cost if wrong:
    those runs require a new run, with their existing records preserved.
19. The reported MCP-file argv exposure and duplicate fallback were to
    be fixed immediately if present. Both were moot: user MCP files
    pass by path since `049b8ca`, as delivery specifies. `dc09077` adds
    mutation-checked regressions. Cost if wrong: additional tests; no
    production MCP merge or private-file copy was introduced.
20. Local memory setup is declared in prepare, merging this checkout's
    absolute `autoMemoryDirectory` into local settings (`e5e52be`). Cost
    if wrong: a local setting is managed on install; other keys must
    survive. Task 12 refuses linked `.claude` directories (`fe53e0f`).
21. Codex ran with its approval policy set to never ask and full
    access, the user's choice, from Task 5's first fix round; a watcher
    approved its prompts, and it was restarted to take the setting.
    Cost if wrong: Codex's commands ran unprompted in this checkout,
    with reviews as the net.
22. Confirmed means the user wrote it or ran `dorothy --verify` on it,
    as the user ruled on 2026-10-20 after the final review. Origin
    `repo` confirms nothing, and a verification travels with its words
    through sync. Cost if wrong: a piece the user wrote but never
    verified is unconfirmed on another machine.
23. A verification a repository's file carries is trusted as the
    user's, as whoever can commit to the repository is trusted as the
    user; pull requests that touch `.agents/memory/` deserve review.
    Its digest is public, so it binds words, not a person. Cost if
    wrong: a pull request can confirm its own text.

## Task 1: unconfirmed knowledge

Fixed the distinction by origin and human verification (`fc2e9c3`), the
block fence and ranking (`70c43c4`), search/open marks (`64b9a2e`), and
`--verify` with user attribution (`66885c6`, `916690e`). A non-user rewrite
drops verification of the replaced words (`cfa9c55`). The first review
found per-prompt recall still unmarked; `90d3e47` closes that route.

The fix round also corrected budget wording (`873e297`), named other
human verifiers accurately (`62de052`), kept confirmation helpers beside
the fact rather than pointing upward at the engine (`708f02e`), and
proved packing can continue past an unfit frame (`b02f4dd`). No Task 1
finding remains open. History's outside-attribution gap went to Task 5.
A transient no-repository fixture failure was reported, rerun and later
identified as temporary-directory interference; it was not hidden.

## Task 2: service

The six final-review loose ends were fixed: host-clamped brief
(`741ab94`), hook project-id validation (`1650c22`), bounded idle state
and logged reviews-off reason (`5ae90b0`), binding before history work
(`607e122`), and unexpected tool failures logged (`636c2a8`).

The original contract's per-task minors were resolved as follows. The
numbers below are that contract's tasks, not sweep tasks.

- **Contract 1, config:** Listen validation and missing tests `207ae02`;
  service assertions and README already correct.
- **Contract 2, fact file:** Host id unified `8fe1bd9`; type loss, caps and
  read cases `80e28f4`; writer/origin consistency moot because a user can
  stamp any origin.
- **Contract 3, legacy layout:** Comment, old path and under tests `4b796a9`.
- **Contract 4, migration:** Injected read failure, exclusive move, unlisted
  files and link-safe pruning `7e0a3b1`; repeated leftover warnings retained
  by its ruling.
- **Contract 5, ids:** Dot segment and host length tests `f86965d`.
- **Contract 6, schemas:** Inverted ranges, bounded diagnostics and
  response/tool tests `9a2975b`; date validation belongs to query; body cap
  bounds events; private recording already ignores text.
- **Contract 7, profiles:** File/field diagnostics, empty directory and
  shipped-profile tests `a786f26`; Codex's 512 allowance already fits
  instructions.
- **Contract 8, engine:** Project lookup under lock, catalogue warnings and
  gap tests `771b510`; migration and injected clock already fixed; validated
  dates and existing reviewer warnings make the other concerns moot.
- **Contract 9, block:** Packing, budget and cache tests; whitespace and title
  fallback `094d763`; code-point counting remains the design.
- **Contract 10, recall:** Scope, edge budgets, host clamp and escaping tests
  `d68f058`.
- **Contract 11, record:** Ordering, private writes and removed-file
  invalidation `1496bdb`; reserved host `b1a00d7`; delta reads under lock
  `fd11183`.
- **Contract 12, remember:** Why limit and retire host handling `f722fe7`;
  revise without a known writer does not retain a misleading old host.
- **Contract 13, tools:** Failure logging `636c2a8`, limit/error tests
  `9a2975b`; through filtering already cuts to the lesser bound.
- **Contract 14, tokens:** Fsync, cleanup, shape validation and queued updates
  `7682e23`; cross-process work later closed by Task 10.
- **Contract 15, HTTP:** Body validation, bounded caches and quoted versions
  `98d3904`, `58b3689`; service split into guard/jobs/http; peer/token/Host
  tests added.
- **Contract 16, client:** One deadline, guarded config, queue ordering and
  host-safe fallback path `ef03867`; queue stopping rule retained as
  specified.
- **Contract 17, bridge:** Refusals, request timeouts, setup errors and last
  reply `76f28ab`; timer lifetime corrected `b53c2e8`.
- **Contract 18, CLI:** Repeated options and mode-conflict tests `f9bf88e`.
- **Contract 19, docs:** Queue and migration already documented; current
  behaviour recorded `cbd763b`.

Already fixed or moot: migration was already under the store lock, the
engine clock was injected, transcripts plus events were already refused,
the Host-by-name policy was already corrected by `573bfb4`, and local
projects-directory attack races were excluded by ruling. `readCommon`
serves exports as well as legacy files; it is not dead code.

Retained by contract: Bun may give its plain 413 above its own body
floor; a queue drops only the named statuses and keeps the rest;
revision without a known host must not preserve another writer's host;
code points are the block's character unit. The 8 MiB body cap and
10,000-event cap remain, rather than a new cap on legitimate event text.
A missing reviewer still cannot generate notes. Chat catch-up sees idle
conversations dropped with reviews off, with the existing five-entry cap.

The fix round released resources after a failed start (`aeb5c00`),
replaced a wall-clock client assertion with an injected deadline test
(`2c99e8b`), and pinned the catch-up path (`d675d72`). Delta-read cache
limits and remaining cleanup edges are listed under Deferred; early
reported-not-fixed table labels were superseded by these fixes.

## Task 3: recording

Launch notes moved to durable state, gained boot and filename checks,
stopped recreating removed launches, and reaped crashed temporaries
(`e86c8b2`, fix `f9d8c61`). New-type notices use atomic one-shot markers
and collision-resistant names (`3f0171f`); state temporary names became
unique (`d90fccc`); logs handle lone carriage returns and rotation races
(`b5c8c85`). Command markup is mapped correctly (`d914bff`), repeat type
warnings and state-write failure handling improved (`6c1a5c8`).

`dfd9536` keeps retry notes when neither store lock opens, loads the SDK
only for an actual review, passes the hook's environment to detached
children, logs spawn failures and rotates the fallback log. Launch
cleanup covers a synchronous spawn or teardown throw (`0747cd6`). Session
flag scanning handles attached resumes, precedence and flag-like values
(`9ae6740`). The CLI passes the user's review base URL (`04c42a1`);
hooks restore it (`dfd9536`), and both catch-ups keep it (`be71605`).

Reviewer lock/recording helpers were shared and names precomputed
(`4684e73`); the exact two catalogue reads are pinned (`c1aa151`). Guarded
unread reporting (`20a641f`), state typing (`ce2e3fd`) and real detached
spawn tests (`08a2dad`) close their gaps. The report's user-line count was
corrected from 14 to 17 strings (`2ad19b2`).

The two pure `buildMemory` calls retain different arguments; no shared
state is needed. Print-mode timings have no saved alternate figures,
and the three-second survival check remains a method caveat. The saved
clear/survived ordering does not disprove the report's nine surviving
hooks. These stay in the [bodies deferred file][link-1].
Mixed index/history locking moved to Task 6 and is fixed there. The
"ran no hooks" notice became one-shot after recording (`3fec857`);
remaining notice wording edges are under Deferred.

## Task 4: recording edges and dates

Local date bounds and dateCreated were already correct since `8d40f26`;
`1d23ad4` pins opposite sides of midnight in two extreme time zones.
The fix round made both editors use local days too (`eeadaa7`).

Armor's session directory now survives a changed XDG config root
(`46f1e4c`). Resumed chats redraw new remember events by recorded offset
(`5b1e090`); older or truncated events have the limits below. Recall
requests run in order (`51ea491`), and a rejection cannot poison the
queue (`db72956`). Torn contract tails are cut before append (`939ad30`);
read-only tails can still be read when cutting fails (`9a7dac5`). Known
malformed user text halts body recording (`4812b15`, F13).

Rewound branches, plain turns between Dorothy launches, subagents and
fork linkage stay for the recording design; they were outside the brief.
Armor path discovery mirrors dotenvx's current layout; Windows is not
handled, and a future upstream path change would need updating it.

## Task 5: store

Fixed snake-case import/export and stable filenames, preserved hooks when
descriptions are unchanged, last-index cleanup, store-retired tombstones
and sync reporting (`a886417`). Concurrent index edits and a legal fact
named constructor are safe; imports preserve foreign metadata and
sources while dropping verification of replaced words (`b2bcd32`). A
concurrent skipped snake export also keeps its index link (`56d0776`).

Fact links, display-column wrapping and real calendar dates were checked
(`9ac233c`); full duplicate-aware YAML validation supersedes the initial
partial scan (`b007640`, exported-file tests `cc2b221`). Store partial
writes, unreadable files, retirement matching and sync targets report
accurately (`a3798c0`, `8bdda5d`); rejecting retirement recorders retain
all completed names and both errors (`bf7945c`). Transient fact reads
keep cached rows, and content hashes replace mtime-only change detection
(`8bbe936`, derived schema 7).

History trusts pending hashes, not provenance claims (`cc9f95e`). Notes
are durable before fact replacement; failed noting refuses replacement
(`3b5854e`). Damaged journals salvage readable records, preserve affected
facts' attribution and confirmation, warn and allow other commits to
proceed (`e175971`). Task 6 closes torn-tail and repair-warning edges.
This is a local journal in `.git`, not a defence against a writer able
to alter it.

Scrubbing now recognizes scheme case and key words (`07a1648`), keeps
ambiguous lowercase prose (`b9d0456`, `b250479`) and avoids quadratic
header whitespace (`9d3a0a6`). The 100,000-space regression fell from
about six seconds to below a millisecond in the focused run.

Moot: `renderFact` is validated by its writers; existing transcript,
review, compaction and recall tests already cover consecutive assistant
turns. Retained: sync records are never pruned, preserving a returning
checkout's comparison baseline; `--facts` still performs history's
launch sweep. Repository-wins conflicts, retired facts, stale clones,
shape-based scrubbing and one-origin project identity remain design
limits. A snake filename whose frontmatter or fact links cannot meet
fact naming rules is still skipped and named, not silently imported.

## Task 6: history

The mixed writer locks now exclude one another: take the index first
when present, then the common history lock; canonical writers prefer
the combined lock (`bcf8927`). A pending note starts a new line after a
torn journal, and failed repairs warn (`bab678d`). Chat append and
restore share exclusion (`e8336b3`), including close-time draining.

All six old parked behaviours closed: active Git locks are protected
(`4fa1f4b`, final age fallback `2701857`, `7c763fc`); bundle diagnostics
carry the real typed failure, unreadable files are guarded and stopped
recovery explains non-fast-forward refusal (`55fdbf4`, `24075f1`);
append/restore is serialized; local HTTPS push/fetch and recovery run
through real TLS on 127.0.0.1 (`32adbd2`, cleanup `3c88109`). The tests
use git http-backend, OpenSSL and a fixture-only trust agent. A declared
isomorphic-git 1.43.1 patch handles a bare mirror without remote HEAD;
it must be revisited on an upgrade.

Seals build outside the lock from immutable tips, rechecking refs before
append (`e61bf1f`). Both engines fix sealed author and committer dates,
atomic remote replacement, prerequisite checks, paragraph subjects and
index-only comparisons (`798bebd`). URL-scoped helpers and empty resets
survive isolated Git config (`d449cf8`, `94b1379`). Timers joining a push
and failed positive-period pushes schedule follow-up work (`4d2ce59`).

The small code points and gaps closed by area:

- **Seal and lint:** Nonce length, shared format constants, same-nonce AAD
  test `809143c`; invalid key already returned failure; blank-line and
  missing-Bun diagnostics `9361cc1`.
- **Healing:** Missing-copy sentinel, hand-placed backups and recovery-depth
  tests `00c72ff`; obsolete text comment already gone.
- **Settlement:** Unreadable outside paths no longer stop others; warnings,
  no-op callbacks, repeated deep walks, ignore patterns, normalized exceptions
  and empty transcripts `a13f690`.
- **Commands:** Guarded failures and mirror inspection, zero bundles,
  normalized paths, no unused date lookup, shared opening, history-off check
  and encrypted/empty URL diagnostics `d17200a`.
- **Notes:** Record only written vocabulary/sidecar paths, recorder under lock
  and nothing-new tests `9c9bdca`.
- **Turns:** Count canonical user events including errors `be4d9c3`; remove
  redundant count API `1301cdb`; obsolete TUI comments moot.
- **Isolation:** Supplied-PATH Git probe `ff8669c`; real hooks, disabled
  history and busy launch lock tests `5e5ea3c`; TUI awaits settlement
  `0744a30`.
- **Crash and stop:** Stop during validation and append/ref crash tests
  `bfd3d59`; recovery refusal leaves no repository `6b0de4a`; diverged
  unbundle and bad URL were already covered.

The review's Critical retry loop and Important unconditional command
push were fixed: stop mirrors and disable one-shot retries (`bfd8576`,
`1952333`); only a MAIN advance pushes at command close (`6549123`,
following `20e0871`). Read-only commands do no network close work;
hooks, launch and recall keep network work off their close paths.
Status needs no key creation guard (`e865c92`); one validation per sealed
head and typed diagnostics (`24075f1`), cleanup-error precedence
(`7d8fdf5`) and listing grammar (`415b65f`) closed the other review items.

Consolidation and pruning remain reported-not-fixed because both specs
leave them to a design that rewrites history. A crash may leave a
harmless snapshot ref or cause a redundant encrypted bundle on retry;
recovery preserves the bytes. The ten-minute unavailable-process
fallback is an explicit tradeoff, not proof that a writer has exited.

## Task 7: tags

Untouched lapsed tag sets stay untouched, stale labels resolve only when
edited, aliases collapse before the limit (`67a2b5a`, `c692c76`). Labels
sort independently of locale; tombstones validate like live terms;
queue, failure and lock tests pin vocabulary updates (`715cea1`). Merge
boundaries validate tag ids (`efd29dc`). User-owned skipped reviews prune
unresolved ids without a model (`0f0f994`); vocabulary failure/race tests
protect both files (`d3e4aa4`).

Review prompts build the shown-id set once (`7212f9f`), recursive queries
exclude a cyclic root and treat empty under as absent (`9bfa224`), blank
TUI descriptions disappear (`b2ef6b8`, `a36f9af`), parent order alone
changes no ownership and diamond/merge edges are pinned (`e290234`).
Commands warn on index failures and cover missing vocabularies/editor
retry (`a3b3e94`); rollback/mtime races (`0819aca`), legacy events and
client tag-limit errors (`2cd7bdc`), tagging boundary cases (`ca4a2e4`)
and README guidance (`8e3b25d`) close the other test/document gaps.

Already fixed: unknown provenance authors were rejected; validation
always supplies tags; escaped quotes already round-tripped; hidden and
unlisted neighbours were already excluded. The pure live-only carrier
case received its own test. Moot by ruling: a mid-run hide is invisible
to the review's launch catalogue snapshot; this behaviour stays in the
[tags deferred file](../deferred/2026-10-08_tags-deferred.md).

The fix round strengthened malformed-merge fixtures (`feb6b28`), reused
`markReviewed` (`2242dc6`), replaced timing with deterministic scan counts
(`0d5e1e2`) and gated actual shared-lock contention (`e75014b`). Its
remaining same-path round-trip gap is recorded under Deferred.

## Task 8: compaction, recall and catalogue

Compaction test gaps closed across sidecar/schema/index growth
(`6e7f2c6`), recollect offering (`7be5be7`), reserved budget and compacted
reads (`f6b212c`), structured cancellation/error (`ea6ddbb`), plan and
cluster limits (`fa48b6e`), end-to-end numbering and real trackMemory
(`9f3be38`), and dump/fallback context (`15f67fc`). A synchronous query
throw was already tested. Task 11 closes the remaining live split.

Failed CLI compaction statuses now warn (`e943a26`). Hidden turn text
is removed from the cache (`8179904`), with whole-word transcript
recollection (`9e4efd3`). Scoped fallback ignores other projects' hits
(`765c59e`, F19). Concurrent chats validate outgoing canonical turns
before paying for compaction (`5cedfc4`, F22); claims alone cannot align
private turn numbers.

Corrupt-index recovery needs sole-holder proof (`99d5ae2`); the fix round
also protects open-time SQLITE_CORRUPT files and keeps a usable handle
when deletion fails (`949ca6e`). Open-time NOTADB remains replaceable.
Savepoint errors retain their original cause (`547f7e4`), lock-free
open tests avoid timing (`51f0ab9`), duplicate appraisal ids collapse
(`821b73b`) and scheduler stop is bounded (`12c1af5`).

Already fixed before this task: pointless reviews skip the model,
failures back off, claims exclude two TUIs, writes are locked, old temp
files are removed and Editor lives in core. The initially reported
editor limitations were not pinned: deleting just Abstract now reopens
with an error, and retry error lines are stripped anywhere (`cde6907`).

Retained: a busy migration may fail after five seconds; search ranks all
rows, with no pre-ranking row cap; `.000Z` and FTS implicit rowids remain;
user-before-session ordering matches visitsOf; persona tool wording is
fixed at session start. Compaction can wait behind a claim for 150
seconds, and its seed remains estimated. Hidden mentions in other notes
and review cost need separate designs. The recovery fallback edges are
under Deferred. A TUI plus its recall server cannot prove sole holding
while both keep the same index open.

## Task 9: tooling

Undeclared package imports are errors (`0bd0dde`), headed files need
breadcrumbs (`0eb0faa`, JSONC `d64e388`), herdr is pinned to the v0.9.5
commit (`bb4c62f`), and CLI history commands receive ambient dependencies
(`d0e2bbc`). TUI exposes a separate editor entry (`7603594`). Late kitty
replies are filtered from input (`a45d8d8`); the filter also drops literal
typed/pasted replies, now said explicitly (`f956e2c`). Ctrl+U/Home at
cursor zero no longer duplicates a leading newline (`1208176`, F14).

The memory-file header exemption follows the ruling above. Internal
memory callers still have defaults for environment, streams and entry
script; removing them would expand the interface work. The old workspace
HTML remains a dated diagram. The modularity report's other review
minors were outside the checklist and remain in that historical report.
A compiled binary, package split and own tool loop remain conditional.

## Task 10: other code-review findings

F01-F10 and both concerns have the individual resolutions below. The
important fix-round details are preserved here: legacy/incomplete runs
refuse resume before mutating either file (`5289bda`); normalized
excerpts map original offsets even across grapheme composition
(`eda9d6b`, `62cc665`); the token race test uses child attempt/readiness
barriers, not an elapsed-time release (`5ae470b`); failed private settings
writes keep every original argument and warn (`3ec893f`).

Token load/change/replace is one cross-process SQLite transaction, with
the process queue outside it and private modes retained. Mutation bodies
do not acquire index/history locks, so this path adds no lock-order
cycle. The wait is synchronous, at most the five-second busy timeout.

Contract open now treats both bounds as a range. A from beyond the last
turn returns an empty window plus the full count, consistent with the
contract; the legacy centred API still clamps. MCP-file exposure and
fallback duplication were moot in fix round 2: `MERGED` has only
settings, and user MCP flags pass unchanged. Three regressions in
`dc09077` fail when MCP merging is reintroduced. No Task 10 minor remains
open.

## Code review resolutions

The [original report](./2026-10-19-code-review.md#recheck-at-c1aa151-2026-10-20)
records which findings still reproduced at c1aa151. All 22 are now closed;
already-fixed parts were verified before being left unchanged.

- **F01:** Error results fail one-shot commands. Commits: `7417024`.
- **F02:** Repeated settings keep the last user value. Commits: `d8c2d03`.
- **F03:** Oversize turns get matching excerpts, including normalized Unicode.
  Commits: `27f0d9c`, `eda9d6b`, `62cc665`.
- **F04:** Missing, rejected or changed definitions refuse resume; gold
  included; incomplete legacy maps refuse too. Commits: `8e0c2ff`, `5289bda`.
- **F05:** Open obeys inclusive from/through and its cap. Commits: `cd5b9a4`.
- **F06:** In-process queue already fixed; cross-process transaction retains
  modes. Commits: `7682e23`, `15c927d`; test `5ae470b`.
- **F07:** Already fixed: one deadline for backlog and current record.
  Commits: `ef03867`.
- **F08:** Error events carry cost to TUI and transcript. Commits: `bece46b`.
- **F09:** Launch cleanup already fixed; dump cleanup now covers spawn
  failures. Commits: `0747cd6`, `e47bfd1`.
- **F10:** Integer allocations conserve the requested question count. Commits:
  `c47fb39`.
- **F11:** Torn tails cut under the write lock before acknowledged append.
  Commits: `939ad30`.
- **F12:** Already fixed: locked-out catch-up retains retry notes. Commits:
  `dfd9536`.
- **F13:** Malformed known user text halts recording for recovery. Commits:
  `4812b15`.
- **F14:** Cursor zero is the first line start. Commits: `1208176`.
- **F15:** Scheme case variants scrub, with bounded scans and prose guards.
  Commits: `07a1648`, `b9d0456`, `9d3a0a6`, `b250479`.
- **F16:** Own-property record lookup protects constructor. Commits:
  `b2bcd32`.
- **F17:** Index export rechecks its snapshot before replacement. Commits:
  `b2bcd32`.
- **F18:** Import preserves foreign fields and sources. Commits: `b2bcd32`.
- **F19:** Scoped hits decide scoped fallback. Commits: `765c59e`.
- **F20:** URL-scoped helpers and both reset forms survive isolation. Commits:
  `d449cf8`, `94b1379`.
- **F21:** A joined timer push schedules follow-up, once for both source
  reports. Commits: `4d2ce59`.
- **F22:** Outgoing turns must agree with the canonical transcript. Commits:
  `5cedfc4`.
- **Concern: brief scope:** Project-bound brief refuses another project, as
  open does. Commits: `d1afd9e`.
- **Concern: question ids:** Saved definition digests and comparison warnings
  cover gold and context beyond ids. Commits: `8e0c2ff`, `5289bda`.

## Task 11: live verification

Six probes passed. The proxy probe found an actual loopback-routing bug;
`1030eec` adds the gateway hostname to both bypass lists whenever a proxy
is configured, preserving exclusions and upstream proxy connectivity.
The corrected probe observes zero proxy connections to the gateway port.

The fix round declares local memory setup on install, preserves other
settings and malformed files, and tests real prepare in disposable
checkouts (`e5e52be`). A frozen install in this checkout confirmed its
already-correct settings kept every byte, inode, mtime, mode and other
key. Capture fixes removed home prefixes and plan tier (`7f40181`) and a
terminal remnant (`e5e1a55`); proxy-guide wording was made conditional
(`8883ac8`). No additional model calls were needed for those fixes.

## Probes

All captures live in [the evidence directory](./2026-10-19-roadmap-sweep/)
and include commands, versions, selected scrubbed output and costs.
Native Claude Code was 2.1.300, Agent SDK 0.3.302 bundled 2.1.302, Bun
1.4.2 and Herdr 0.9.5. All calls used Haiku 5.5 and throwaway Dorothy
roots, with the user's login retained only to authenticate. No full
request headers, account address, real token or key is in the captures.

- [Live split](./2026-10-19-roadmap-sweep/compaction.txt): Pass: one
  compaction made two topical clusters for turns 1-4; latest exchange stayed
  verbatim; local resumed dump confirmed both and recollect. Capture:
  `6603087`, metadata `ab70b26`.
- [Fork](./2026-10-19-roadmap-sweep/fork.txt): Pass: fork's actual request
  retained identity, marker removed; one injection, zero drift. Capture:
  `9bbcf71`.
- [Interactive](./2026-10-19-roadmap-sweep/interactive.txt): Pass: both main
  requests injected identity, with zero drift and Dorothy replies. Capture:
  `d150e40`.
- [HTTP proxy](./2026-10-19-roadmap-sweep/http-proxy.txt): Pass after fix:
  gateway POST bypassed proxy while external API CONNECTs still used it.
  Capture: `1030eec`, `9a87800`.
- [Package guidance](./2026-10-19-roadmap-sweep/package-guidance.txt): Pass:
  first request from packages/tui/src contained root and package guidance;
  tools-off answer named the package rule. Capture: `b80e9af`.
- [Startup memory](./2026-10-19-roadmap-sweep/memory-loading.txt): Pass with
  autoMemoryDirectory: first request contained index links and hook before any
  tool read. Capture: `3d9f443`.

Cost: eleven logical live user turns plus one structured compaction
invocation. This includes two setup mistakes: an accidentally repeated
interactive question and a malformed fork invocation that consumed
launcher text from stdin. The corrected fork uses `--` and empty stdin.
A later rejected startup and the first package mise lookup made no API
request. Counts by probe: split three turns plus one compaction; fork
two turns; interactive two; proxy two; package one; memory one. Captures
keep reported dollar costs where available. The created Herdr tab was
closed and disposable Dorothy roots removed; only normal Claude probe
session records remain in Claude's own location.

## Task 12: the record

The two carry-over fixes were made first, separately. `fe53e0f` refuses
any existing `.claude` entry that is not a real directory, warning before
reading or writing through a symlink. Real prepare regressions use two
temporary external directories, with missing and existing settings; both
failed before the guard and now preserve the targets. Missing genuine
checkout directories still get private settings. `a626151` restores
"sets" and "the user's own" in the CLI launch guide.

This report retains the rulings, final dispositions, fix rounds and
minors that the ignored handoff files cannot carry to another checkout.
The closed compaction deferred file is removed, the other three retain
only unclosed findings, specs describe the changed behaviour, historical
reports gain closure pointers, and the roadmap removes closed work.
Root and all eight package guides were checked against entry points,
imports and affected code, within the unchanged 100/60/150 budgets.
The agent guide now names failed compaction statuses; memory's hidden
concept invariant is qualified by catalogue load to match Task 7's
ruling. No probe was repeated and no new model cost was incurred.

## The final fix wave

The whole-branch review at `5eb5448` judged the branch ready to merge
with fixes. Its findings were fixed test-first, each failing before its
fix, in throwaway roots.

- **C1 and I1, confirmation:** an import set a fact's origin to `repo`,
  which confirmed it, so a model's fact came back confirmed when an
  older export returned or a fresh data directory adopted it, and
  Claude Code's auto memory in `.agents/memory/` counted as the
  repository's. The user ruled (Ruling 22): only the user's own writing
  or their verification confirms (`fa62ace`), with the recall index at
  schema 8 so no schema-7 row keeps the old answer. A verification
  travels in the exported file with a digest of the words and title it
  confirmed, and an import keeps it only for those words (`c7d9345`).
  Both reproductions now end unconfirmed; a verified piece survives an
  export and import unchanged. Specs, guides and README follow
  (`9b0ce23`).
- **I2, the proxy:** Bun's fetch took the client's and the bridge's
  loopback requests through `HTTP_PROXY`, and has no per-request way
  out. Both now reach loopback and `[service] listen` addresses over
  `node:http`, leaving the environment alone (`245edf8`). The tests run
  in a child process, as Bun keeps a proxy once it has seen one, behind
  a listener that sees no connection.
- **M1:** `--verify` prints the title, description and body it
  confirmed (`2fdb80a`).
- **M2:** a git run from a directory within the data directory keeps
  its index lock (`f47c11c`).
- **M3:** `dmt_` device tokens are scrubbed (`deb26fe`).
- **M4:** a service started before an upgrade keeps running its old
  code. Restart the service after upgrading: stop it and start it
  again, with `dorothy --serve` or the next `--mcp`; a second
  `--serve` cannot bind beside the first, so it restarts nothing. Once
  a newer Dorothy has rebuilt the index, the old service's first
  failure says so (`6e7c1e9`, `3522844`), but only from this version
  on: a service older than it cannot.
- **M5:** recorded under Deferred, unchanged.
- **M6 and Task 12's minors:** this record's range, review state,
  rulings 21 and 22, evidence link and Task 2 cache source were
  corrected; memory's own process defaults are a Candidate again and
  under Deferred.

A re-review found the nine findings addressed and four residuals,
which the follow-up closed as ruled:

- **Important, a carried verification lost without an index entry:**
  where `MEMORY.md` had no entry for a fact, past its cap or kept by
  hand, another machine titled it by its name, so the digest missed,
  the verification was dropped and the next export stripped it, the
  committed file flipping between machines. Each carried entry now
  holds the title it confirmed, which an import takes when the index
  names none; a second machine keeps it confirmed and leaves the file
  byte for byte (`6aeeed5`).
- **Verification order:** two stores that verified the same words held
  them in different orders; entries are sorted by time, then by who
  made them (`e84241e`).
- **The fence's wording:** the intro and the `UNCONFIRMED` mark said a
  model made the notes; both now say knowledge the user has not
  confirmed, claims to weigh, never instructions (`f616282`).
- **Trust in carried verifications:** Ruling 23. A remote device's
  proxy is under Deferred.

## Deferred

Every controller-ledger "minor (deferred)" line is retained here,
including documentation and test-only points. None is presented as a new
blocker; this is the final review's queue.

- **Task 2:** Bridge timers are not all cleared when local transport closes or
  an id repeats; clear all at runBridge end.
- **Task 2:** Service start cleanup can throw from close() and hide the
  original start error.
- **Task 2:** Its original report table still says reported-not-fixed for
  later corrections; the fix paragraph and this report supersede those labels.
- **Task 2:** Held-file delta cache misses an in-place rewrite at the same
  inode and size; transcripts are append-only. Earlier changed bytes with
  greater size can also evade the cache: `heldIn` (`contract/record.ts`)
  resumes at the last size whenever the inode is the same, the file has
  not shrunk and the last read ended a line.
- **Task 3:** "Was not recorded" repeats on each locked-out retry,
  deliberately describing each failed attempt.
- **Task 3:** The unhooked notice can be skipped if recording fails inside an
  acquired lock; wording edge.
- **Task 4:** A remember input trimmed at 2,000 characters redraws from the
  output id; pre-change events carry no offset and do not redraw.
- **Task 6:** With pushMs zero, a push joining an active push sets again but
  schedule is a no-op; no current caller needs that follow-up.
- **Task 6:** Memory guide lines 37 and 140 exceed 80 characters; pre-existing
  long Markdown links, within the 150-line budget.
- **Task 7:** The sidecar exclusion test writes two paths to expose an ignored
  shared lock; a same-path revision-merge round trip is narrower than the
  original gap. Retitle or add it.
- **Task 8:** After failed prepare, the recovery fallback can open a
  schemaless db, causing no-such-table rather than closed; next open repairs
  it.
- **Task 8:** The deleting-it-failed store test relies on chmod and is
  ineffective as root.
- **Task 8:** ERROR_LINES can leave a blank line for a CRLF error line.
- **Task 10:** None open.
- **Task 12:** Memory's own commands still default to the process's
  environment, streams and entry script when given none; the CLI now
  passes them, so this is a fallback, not a gap.
- **Final fix wave:** Sync exports model-written bodies as they are, and
  `lint:md` and `lint:emdash` cover `.agents/memory/`, so an export into
  this checkout of a fact with an em dash or a body line over 80
  characters fails `bun run check` until the file is edited.
- **Final fix wave:** a remote device reaches the service at
  `DOROTHY_MEMORY_URL`, which its own `[service] listen` does not
  normally name, so its requests, device token and conversation text
  go through that device's own `HTTP_PROXY` unless its `listen` names
  the server.

Other retained limits are collected here so partial closures are clear:

- Memory loading was probed with `autoMemoryDirectory` already set. Bun
  install now writes that setting, but malformed settings and linked
  `.claude` entries warn and stay untouched. Guidance still depends on
  Claude Code's upstream AGENTS.md feature and its loading behaviour;
  Codex guidance loading was not part of these live probes.
- History and sealed bundles accumulate. Consolidation, pruning,
  forgetting across history/mirrors and more mirrors need their own
  spec. Sync records and retired facts likewise remain retained by
  design, and read-only fact listing still sweeps history.
- The journal cannot authenticate against a writer with `.git` access.
  Failed noting blocks fact replacement; an unreadable damaged journal
  preserves attribution, while a persistent repair failure warns and
  leaves the obstruction intact. Nonempty directories are not removed.
- Catalogue snapshots do not learn an external mid-run hide; review
  cost, whole-vocabulary prompts, tombstones, case-insensitive labels,
  recap-topic tagging and reused old labels belong to maintenance or
  their own design. Hidden chats can remain named in other chats' notes.
- Sole-holder recovery cannot heal a live shared corrupt index. Busy
  migrations can fail; search still ranks all matching rows. The
  recovery-test and fallback limits above remain. FTS rowids need care
  before any future VACUUM, and persona tool wording is launch-fixed.
- Compaction may wait behind another TUI's claim, and estimates seed
  size. Manual compaction, abstract edits and regrouping are later work.
- Recording still keeps rewound branches and plain turns between her
  launches; subagent transcripts and fork-parent links await its spec.
  Halts need rereading; hooks cost a process per reply; launch blocks
  stay fixed. Armor path discovery has no Windows implementation.
- Store conflicts prefer the repository, old clones may supersede newer
  store content, scrub is heuristic, and an origin change changes the
  project identity. A fact editor remains a candidate.
- One-shot memory, TUI editing, provider/runtime changes, a binary,
  conditional package splits and the evaluation's first paid run were
  outside the sweep. The first run still needs the owner's question
  review, keys and spending decision; it is not one of these six probes.
- The modularity report's other minor review findings remain outside
  Task 9's checklist. Header exemptions and the literal kitty-input
  filter are deliberate tradeoffs. The isomorphic-git patch needs
  maintenance, the unavailable-process stale-lock fallback cannot prove
  liveness, and failed mirror pushes remain warnings with local data
  retained.

The remaining source files are
[history](../deferred/2026-10-08_memory-history-deferred.md),
[tags](../deferred/2026-10-08_tags-deferred.md) and
[recording](../deferred/2026-10-16_memory-bodies-deferred.md). The
[roadmap](../roadmap.md#candidates) keeps these limits alongside the
future design work, rather than listing closed defects again.

[link-1]: ../deferred/2026-10-16_memory-bodies-deferred.md
