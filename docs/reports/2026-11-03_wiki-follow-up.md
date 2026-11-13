---
ctime: 2026-11-03
mtime: 2026-11-06
spdx: GPL-3.0-only
title: Wiki follow-up
description: >-
  Integrity fixtures and roadmap close-out for the repository wiki, with
  verification and the parser, editorial and evidence findings left.
tags:
  - wiki
  - verification
  - report
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/reports/2026-11-03_wiki-follow-up.md
   -
   -->

# Wiki follow-up

## Baseline and scope

The [repository wiki](./2026-11-03_repository-wiki.md) merged in
[#128](https://github.com/chewygumxx/dorothy/pull/128), at `3e9875a`.
Its dated spec, plan and report remain unchanged. This follow-up follows
its own [design](../specs/2026-11-03_wiki-follow-up-design.md) and
[plan](../plans/2026-11-03_wiki-follow-up.md).

Task 1 is commit `ef2b17d`, `test: Strengthen wiki integrity checks`.
It extracts filesystem checks into `scripts/docs-links.ts`, tests them
through temporary roots, and adds parser fixtures without changing the
parser implementation or its exports. Task 2 changes only Markdown:
roadmap close-out, its priorities index, the workflow check description,
this report and its catalogue entry. No live host probe, model call or
application feature belongs to this pass.

## Changes and rulings

- `docs.test.ts` now checks fragments in root `AGENTS.md` and
  `docs/AGENTS.md` alongside the existing pages. Home reachability and
  top-level dated-record coverage remain checked.
- Catalogue checks report missing and duplicate records. Aliases resolve
  to the same record before counting; repeated non-record links remain
  valid. Duplicate results are unique and sorted.
- Nine helper fixtures exercise valid and missing files and fragments,
  leading `/`, percent-escaped paths and Unicode fragments, malformed
  percent fallback, record aliases, missing entries and duplicates.
- Parser fixtures cover tilde fences, reference definitions with a
  fragment, Unicode headings with links and closing hashes. They
  characterize existing behavior; no parser rewrite was needed.
- The original report's missing `-2` suffix coverage claim was stale.
  The `Three`/`three-2` assertion already existed before this follow-up
  and is preserved. The old report is retained as historical evidence.
- The roadmap adds the merged wiki to Done with its records and #128,
  and links this follow-up's records. Its remaining findings join
  Candidates and the matching priorities entry. No Ahead phase moves
  or is added: the remaining work need not precede the memory work.
- The workflow page describes guidance fragments, alias-aware duplicate
  detection and the shared helper fixtures. No prose-mirroring tests
  were added.

## Task 1 RED and GREEN

The Task 1 implementation report records tests written before the helper
module, using literal expected results against its three exports.
These are that task's recorded commands and results, not new RED runs
by the documentation writer.

```sh
bun test scripts/docs-links.test.ts
```

```text
error: Cannot find module './docs-links.js'
 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [7.00ms]
```

Exit status: 1. This was a missing-module RED. The parser cases passed
against the existing parser; they do not establish a new parser fix.
After implementing the helpers and wiring the production checks:

```sh
bun test scripts/markdown-links.test.ts scripts/docs-links.test.ts \
  docs.test.ts agents.test.ts
```

```text
 105 pass
 5 skip
 0 fail
 230 expect() calls
Ran 110 tests across 4 files. [395.00ms]
```

Exit status: 0. The first scoped Biome check found three formatting
errors. Task 1 formatted its four files, repeated the targeted run
(105 pass, 5 skip, 0 fail, 230 assertions, 389ms), and passed the scoped
Biome check and `git diff --check`. The commit hook also passed.

## Source conflicts retained

The original report's
[nine conflicts](./2026-11-03_repository-wiki.md#source-conflicts) remain
qualified. This pass gathers no new evidence to settle them:

1. Claude's session block follows code's gateway section, while
   `claude-code.json` and the contract name a SessionStart hook.
2. Codex's live payload confirmation differs between delivery probes and
   the delivery report; the wiki follows the report's waiting state.
3. Recording requires configured hosts, and Hermes's reader has met no
   real session, despite the roadmap's broad recording description.
4. OpenClaw's profile has an unexplained `checked: 2026.10.4` basis.
5. Featherless's $25 plan terms differ across dated records; the profile
   presents both claims and follows the three excluding API use.
6. The first evaluation leaves a spot-check pending, while the engine
   rerun refers to the spot-check's questions.
7. Statusline's spec names eight modules against nine in code; code
   decides. The maintenance role lacks a caller and fallback after
   effects has only mock evidence, not a real-provider run.
8. Orchestration's spec asks for a roadmap phase that is absent, and an
   earlier note names another first client; the wiki follows the later
   spec and qualifies the roadmap state.
9. Backfill's roughly 970 calls and 302 sessions count different things;
   their meanings stay distinct on the decisions page.

## Deferred work

The [original known limits](./2026-11-03_repository-wiki.md#known-limits)
are the source inventory. Task 1 addresses guidance fragments, duplicate
catalogue detection, the named parser fixtures, root-relative resolution
and percent-escape fixture gaps. The existing `-2` fixture required no
new coverage. The remaining work stays in
[Candidates](../roadmap.md#candidates), with no second priority queue.

- Parser behavior: multiline code spans, fences nested in list items,
  frontmatter and HTML comments, headings in blockquotes or lists,
  reference links and HTML tags in headings, an empty `<>` destination,
  code spans inside emphasis, and stripping `?query` from local paths.
  Reference-definition coverage does not cover reference-link headings.
- Catalogue editing: same-day model-provider routing/runtime ordering
  and the Report/Deferred labels where the original spec says evidence.
- Wording and evidence: missing state terms, adapter status wording,
  A2A's date, the rulesync ruling's user instruction, memory's `cut` and
  earlier-judge qualifications, compaction wording and orchestration's
  long-job claim. The nine conflicts above still need source evidence.
- Reference scope: the subagent `--no-cd` worktree pointer, repeated
  renderer/statusline/delivery mechanism details, question answers that
  can shrink to topic links, exit-75 and declined-entry states, Memory
  Status's record link and OpenClaw under Blocked. The original report
  also lists an omitted `eval` boundary, but the workflow page already
  includes `eval` before this follow-up; that item is stale too.

These are retained findings, not claims of newly verified defects or
corrections in this pass. Historical records remain untouched.

## Verification

The report was catalogued before running checks from the repository root.
Fresh Task 2 targeted verification:

```sh
bun test scripts/markdown-links.test.ts scripts/docs-links.test.ts \
  docs.test.ts agents.test.ts
```

```text
bun test v1.4.2 (744846f84)

 105 pass
 5 skip
 0 fail
 230 expect() calls
Ran 110 tests across 4 files. [406.00ms]
```

Exit status: 0. Full repository verification:

```sh
bun run check
```

```text
Checked 489 files in 108ms. No fixes applied.
Checked 490 files in 398ms. No fixes applied.
Found 1 info.
[NOTICE] Verification Passed:
    Files parsed: 716
    Repo line - Out-of-Sync: 0, Correct: 676, Not found: 40
    Path line - Out-of-Sync: 0, Correct: 676, Not found: 40
    Files unreadable: 0, Skipped: 4
$ bun test
bun test v1.4.2 (744846f84)

 3999 pass
 5 skip
 0 fail
 143947 expect() calls
Ran 4004 tests across 196 files. [46.46s]
```

Exit status: 0. Typechecking, formatting, Markdown, YAML, secrets,
em-dash and header checks completed before tests. The non-blocking
Biome informational finding is `lint/style/useTemplate` at
`packages/memory/src/memory/reviewer.test.ts:39:9`. Header validation
prints 80 missing-header warnings: repo and path lines absent in the same
40 existing files, comprising memory notes and historical artifacts.
It reports no out-of-sync or unreadable file and skips four files.
The five test skips are the agents suite's existing conditional cases.

Captured command output is retained beside the scratch task report as
`task-2-targeted.log` and `task-2-check.log`. Result recording and link
wrapping are followed by the same targeted suite, `bun run lint:md`
and `git diff --check`; their output is retained in `task-2-final.log`.
Independent review and integration are owned by the controller; this
report does not claim their outcome.

## Final review fix wave on 2026-11-06

The whole-branch review of `3e9875a..fc2d590` found one Important
defect: two rendered reference entries sharing one definition escaped
catalogue duplicate detection. There were no other new findings.
The controller ruled that the design's duplicate-entry invariant takes
precedence over the plan's direction to reuse `linkTargets`.

The interrupted implementation was recovered as five unstaged files.
This continuation inspected those changes and completed their report
and verification; Tasks 1 and 2 were not repeated. The additive
`linkOccurrences(markdown: string): Link[]` counts inline and ordinary
full, collapsed and shortcut reference uses. Labels match without regard
to case and with normalized whitespace. Unused definitions do not count
as entries; ordinary link validation still checks their destinations.
Shared fence/span stripping, target matching and destination splitting
preserve the existing `links`, `linkTargets` and `headingSlugs` contracts.
The workflow page records the behavior and its lightweight syntax limits.

### Recorded RED

The original implementer wrote catalogue fixtures before changing the
implementation and captured this command in `final-fix-red.log`:

```sh
bun test scripts/docs-links.test.ts
```

The saved output contains real expectation failures for repeated full,
collapsed and shortcut references, normalized labels, unused definitions,
inline text counted again and code-only entries. Its result was:

```text
 9 pass
 7 fail
 17 expect() calls
Ran 16 tests across 1 file. [14.00ms]
```

Exit status: 1, as recorded for the interrupted fix. This is attributed
historical RED evidence; this continuation did not rerun a RED state.
The saved initial GREEN in `final-fix-targeted.log` records 120 pass,
5 skip, 0 fail and 247 assertions across four files (327ms).

### Fresh verification

After inspecting the implementation and updating documentation mtimes,
this continuation ran the required covering command from the root:

```sh
bun test scripts/markdown-links.test.ts scripts/docs-links.test.ts \
  docs.test.ts agents.test.ts
```

```text
bun test v1.4.2 (744846f84)

 120 pass
 5 skip
 0 fail
 247 expect() calls
Ran 125 tests across 4 files. [664.00ms]
```

Exit status: 0. The fixtures cover the exact review case, all three
reference forms, case and whitespace normalization, unused definitions,
definition destination validation, inline text counted once, code
examples, wrapped inline labels and the first duplicate definition.
The unchanged parser fixtures still pass.

The single full check on the finished implementation was:

```sh
bun run check
```

```text
Checked 489 files in 125ms. No fixes applied.
Checked 490 files in 414ms. No fixes applied.
Found 1 info.
[NOTICE] Verification Passed:
    Files parsed: 716
    Repo line - Out-of-Sync: 0, Correct: 676, Not found: 40
    Path line - Out-of-Sync: 0, Correct: 676, Not found: 40
    Files unreadable: 0, Skipped: 4
$ bun test
bun test v1.4.2 (744846f84)

 4014 pass
 5 skip
 0 fail
 143964 expect() calls
Ran 4019 tests across 196 files. [55.06s]
```

Exit status: 0. Typechecking, formatting, Markdown, YAML, secrets,
em-dash and header checks all completed before tests. The existing
Biome `lint/style/useTemplate` information remains at
`packages/memory/src/memory/reviewer.test.ts:39:9`. Header validation
again prints 80 missing repo/path warnings for the same 40 existing
memory notes and historical artifacts, with no out-of-sync or unreadable
files and four skips. The five test skips are the same conditional
agents cases listed in the earlier verification.

While recording results, documentation lint found repeated blank lines
(`MD012`) and `git diff --check` found a blank line at EOF. Removed
those append-formatting errors and ran the final documentation checks:

```sh
bun test docs.test.ts
bun run lint:md
git diff --check
```

```text
 4 pass
 0 fail
 4 expect() calls
Ran 4 tests across 1 file. [50.00ms]
```

All three commands exited 0; Markdown lint and the whitespace check
emitted no diagnostic. Temporary captures are
`final-fix-recovery-docs.log` for the first lint attempt,
`final-fix-recovery-doc-tests.log` and
`final-fix-recovery-docs-final.log` for the passing checks.

Raw captures are temporary scratch evidence under
`.superpowers/sdd/2026-11-03_wiki-follow-up/`: the saved
`final-fix-red.log` and `final-fix-targeted.log`, and this continuation's
`final-fix-recovery-targeted.log` and `final-fix-recovery-check.log`.
All scratch captures named in this report are temporary, untracked
evidence removed when the plan workspace is cleaned. The commands and
result excerpts above preserve the evidence in this report.

### Self-review and remaining limits

Read all changed parser/helper code and fixtures against the dispatch.
The occurrence helper reuses the existing code-example stripping and
matching expressions without a dependency. The old parser APIs retain
their destination inventory and slug behavior. The filesystem fixtures
use isolated temporary roots and remove them after each case.
Only the four TypeScript files, workflow prose and this tracked report
belong to the fix commit; historical specs, plans and the original wiki
report remain unchanged.

The helper covers ordinary reference syntax within the existing
lightweight parser's limits; it does not claim full Markdown rendering.
The previously deferred parser, editorial and source-conflict work stays
deferred, with no new host or model evidence. The controller owns the
single scoped re-review from `fc2d590`, push, CI and integration; none of
those outcomes is claimed here.

## Residual wrapped-title correction

Scoped review of `fc2d590..a58939b` confirmed the original reference-use
finding addressed, but found one new Important regression: an inline
link with its title on the following line was omitted from occurrences.
The old destination inventory counted that ordinary form. The controller
allowed the smallest correction and a focused continuation of the same
review gate, without reopening broader parser work.

Added the review's exact two-entry example to the real catalogue helper
fixtures and a parser fixture whose inline label also has a reference
definition. Both fixtures were written before the correction. Fresh RED:

```sh
bun test scripts/docs-links.test.ts scripts/markdown-links.test.ts
```

```text
 32 pass
 2 fail
 37 expect() calls
Ran 34 tests across 2 files. [23.00ms]
```

Exit status: 1. The helper returned `duplicates: []` instead of
`["docs/record.md"]`. The parser returned `./reference.md` instead of
`./inline.md`, demonstrating the same fallback to a shortcut reference.
Raw expectation failures are in temporary `residual-red.log` under the
plan workspace; this is a fresh RED from this continuation.

The correction removes only the newline exclusion after an inline
link's destination. The closing parenthesis still bounds consumption,
and the existing parser APIs remain unchanged. Fresh GREEN:

```sh
bun test scripts/markdown-links.test.ts scripts/docs-links.test.ts \
  docs.test.ts agents.test.ts
```

```text
 122 pass
 5 skip
 0 fail
 249 expect() calls
Ran 127 tests across 4 files. [484.00ms]
```

Exit status: 0. Raw output is temporary `residual-targeted.log`.
The full check is reserved for the final tree after merging current main.
The scoped review gate remains open pending verification of this small
correction by the controller's existing reviewer. No PR outcome is claimed.

## Scoped review and current-main integration

The existing reviewer confirmed the original reference-use finding
addressed at `a58939b`. Its focused continuation reviewed only
`a58939b..84b0577` and confirmed the wrapped-title correction addressed,
with no new Critical or Important breakage and no out-of-scope findings.
The same scoped gate is clear through `84b0577`; no broad review was
repeated. The scratch review artifact is `final-fix-rereview.md`.

Merged `origin/main` at `350eee8` into the branch after the residual fix,
preserving both parents in merge commit `e370077`:

```sh
git merge --no-ff origin/main \
  -m 'chore: Merge main into wiki follow-up'
```

The merge exited 1 with conflicts only in `docs/roadmap.md` and
`docs/wiki/topics/repository-workflow.md`. Resolution retains the wiki
completion before the newer Pi completion in Done, and retains both
revision histories. The merged Ahead section is byte-equal to current
main's Ahead section. Main's newer Pi records, priorities and acceptance
qualifications remain intact. The workflow page retains main's Node and
probe guidance alongside the follow-up integrity-check prose. Roadmap,
priorities and catalogue keep main's November 6 mtimes; the edited
workflow page also uses November 6.

Reread the merged root and docs instructions and current check command.
Node is `v24.22.1`, satisfying the documented 22.19-or-later requirement.
Installed the changed locked dependencies before completing the merge:

```sh
bun install
git add docs/roadmap.md docs/wiki/topics/repository-workflow.md
GIT_EDITOR=true git merge --continue
```

```text
 17 pass
 5 skip
 0 fail
 72 expect() calls
Ran 22 tests across 1 file. [28.00ms]

112 packages installed [672.00ms]
Checked 98 files in 354ms. No fixes applied.
[docs/wiki-follow-up e370077] chore: Merge main into wiki follow-up
```

Both commands exited 0. Installation ran the declared prepare workflow
and its skill checks. The merge's normal commit hook passed, with no
additional tracked dependency changes. The tree was clean after merge.
The combined targeted check then ran:

```sh
bun test scripts/markdown-links.test.ts scripts/docs-links.test.ts \
  docs.test.ts agents.test.ts
```

```text
 128 pass
 5 skip
 0 fail
 255 expect() calls
Ran 133 tests across 4 files. [621.00ms]
```

Exit status: 0. These totals include the current-main guidance tests.

The single full check on this final combined implementation ran at
`e370077` with Node `v24.22.1`:

```sh
bun run check
```

```text
Checked 559 files in 137ms. No fixes applied.
Checked 560 files in 454ms. No fixes applied.
Found 1 info.
[NOTICE] Verification Passed:
    Files parsed: 803
    Repo line - Out-of-Sync: 0, Correct: 759, Not found: 44
    Path line - Out-of-Sync: 0, Correct: 759, Not found: 44
    Files unreadable: 0, Skipped: 4
$ bun test
bun test v1.4.2 (744846f84)

 4579 pass
 5 skip
 0 fail
 149428 expect() calls
Ran 4584 tests across 217 files. [166.56s]
```

Exit status: 0. All check stages completed. The same existing Biome
`lint/style/useTemplate` information remains at
`packages/memory/src/memory/reviewer.test.ts:39:9`. Header validation
prints 88 repo/path warnings for 44 existing files, now including the
three Pi stewardship text/log artifacts and vendored herdr extension
brought in from main. It reports no out-of-sync or unreadable file,
and four skipped files. The five conditional agents skips remain.
The full check runs offline tests; no live Pi delivery or stewardship
probe, real-data operation or paid model run was performed here.

Temporary raw evidence under the plan workspace is
`integration-merge.log`, `integration-install.log`,
`integration-merge-continue.log`, `integration-targeted.log` and
`integration-check.log`. These scratch captures include complete command
output and are removed when the plan workspace is cleaned. This report
retains the commands and exact result excerpts.

Self-review confirmed that merge commit `e370077` has parents
`84b0577` and `350eee8`, preserves the reviewed fix commits, and changes
no parser code during conflict resolution. The residual reviewer range
is only `a58939b..84b0577`; the two documentation conflict resolutions
can be inspected from the merge diff. The remaining historical parser,
editorial and source-conflict limitations stay qualified. Local main
integration and verification are complete; push, PR and CI/merge outcomes
remain with the controller and are not claimed by this report.

After recording the integration result, ran:

```sh
bun test docs.test.ts
bun run lint:md
git diff --check
```

```text
 4 pass
 0 fail
 4 expect() calls
Ran 4 tests across 1 file. [36.00ms]
```

All commands exited 0; Markdown lint and the whitespace check emitted
no diagnostic. Temporary captures are `integration-doc-tests.log` and
`integration-docs.log`. No implementation changed after the full check.
