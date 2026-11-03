---
ctime: 2026-11-03
mtime: 2026-11-03
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
   - ~chewygumxx/dorothy.git
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
