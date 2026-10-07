---
ctime: 2026-10-08
mtime: 2026-10-08
spdx: GPL-3.0-only
title: Tags implementation report
description: "How tags were built: deviations from the spec, what review changed, every commit and what is left"
tags:
  - dorothy
  - memory
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-08-tags-implementation.md
   -
   -->

# Tags implementation report

## Summary

Dorothy now tags each conversation in her idle review. The tags come from a
SKOS-style vocabulary that she grows herself, in `tags.json` in the data
directory: concepts with a preferred label, alternative labels, broader
concepts and a scope note. Each sidecar holds its conversation's concept
ids. The recall index mirrors both.

She meets tags only through recall:

- the `tags` tool lists concepts, ranked by how salient their
  conversations are;
- `search` filters by tags;
- results carry `keywords`.

Tags never enter her memory block. The user sees and corrects them with
`dorothy --tags`, `dorothy --edit-tags` and a `Tags:` line in
`dorothy --memory`.

- Spec: [`docs/specs/2026-10-07-tags-design.md`](../specs/2026-10-07-tags-design.md)
- Plan: [`docs/plans/2026-10-08-tags.md`](../plans/2026-10-08-tags.md)
- Probe: [`docs/reports/2026-10-08-tags.md`](2026-10-08-tags.md), with its
  sample data in [`2026-10-08-tags/`](2026-10-08-tags/)
- Deferred findings: [`docs/deferred/2026-10-08_tags-deferred.md`](../deferred/2026-10-08_tags-deferred.md)
- Branch: `feat/tags`, from `main` at `60e1688`

At the head of the branch `bun run check` passes with 927 tests across 50
files, up from 787 on `main`. A live probe in tmux showed four things
working as the plan expected:

- Dorothy coined concepts for two subjects and reused them for a third
  chat.
- She listed the concepts and searched by them.
- A rename made with `--edit-tags` held through a later review.
- A `--memory` save made while a review ran kept the tags that review
  added.

## How it was built

The plan's 13 code tasks were built in order. For each task one agent
implemented it from the plan's text, and a fresh reviewer then checked the
diff against the plan and the spec. A task moved on only when its review
found nothing Critical or Important. Two tasks needed one fix round each:

- **Task 2.** Labels in the review's vocabulary are escaped as XML
  attributes, so `"` becomes `&quot;`, but reading her output back decoded
  only `&lt;`, `&gt;` and `&amp;`. A label holding `"` that she echoed
  back would not have resolved (`66ea6b0`).
- **Task 12.** In `--edit-tags`, a chain of merges, or a merge into a
  concept deleted in the same edit, was refused or silently resolved
  depending on block order. Both are now refused in either order, as the
  spec says (`9a1906f`).

Both defects came from the plan's own code, not from how it was carried
out.

A whole-branch review followed the last task. It found one Important
defect and suggested four small changes, all made in one round
(`01c6aec` to `6a9b15b`), and a review of that round found them all
addressed:

- **The defect.** `--memory` pruned a chat's tags against the vocabulary
  as it was read before the editor opened. A review that coined a concept
  and tagged the chat meanwhile lost that tag on save, even when the user
  had changed only `Pinned:`. `--memory` now reads `tags.json` again at
  save time, under the sidecar's lock (`01c6aec`). The probe exercised this
  live.
- **The four changes.**
  - An emptied fixed tag set can be handed back (`85f732f`).
  - The review checks the vocabulary before writing it (`236d6af`).
  - A test pins hidden conversations out of the `tags` tool's counts and
    dates (`9897024`).
  - The spec amendment listed below (`6a9b15b`).

Findings judged safe to leave are in the
[deferred doc](../deferred/2026-10-08_tags-deferred.md). These include
three parked behaviours, each with the ruling that left it.

## Deviations from the spec

### Settled in the plan

These were decided while writing the plan and are listed in its Rulings
section.

| Spec said (or left open)                                | Implementation                                                                                                      | Why                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| The vocabulary lives at `$XDG_DATA_HOME/dorothy/`       | Its path is always passed in; `null` means tags are off. Only `run.tsx`, the recall server and the commands pass it | Tests that use a bare temporary directory would otherwise read `/tmp/tags.json`. |
| One lock acquisition for the review's write             | `updateSidecar`'s change may be async; the vocabulary is read, coined into and written inside the sidecar's lock    | `RecallIndex.exclusive` is not re-entrant.                                       |
| The review's vocabulary comes from the index            | From `tags.json` and the catalogue the service holds                                                                | Reviews need no extra sync and work without recall.                              |
| (silent) Conversations whose notes are all the user's   | Still tagged: `ownsAll` and the review's early return account for tags                                              | Otherwise they would never be tagged.                                            |
| (silent) The `tags` tool on screen                      | A `tags` lookup kind, recorded in the transcript and shown as a dim line                                            | Like the other recall tools.                                                     |
| (silent) A new block in `--edit-tags` carrying `Merge:` | An error                                                                                                            | There is nothing yet to fold.                                                    |
| (silent) `--edit-tags` and `--tags` without the index   | `--edit-tags` opens with no counts and saves unlocked; `--tags` needs the index                                     | As `--memory` and `--list` do.                                                   |

### Made during the implementation

The spec was amended for the first two.

| Spec said                                                                          | Implementation                                                                                | Why                                                                                                       | Cost if wrong                               |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| A coin whose alternative label is tombstoned, has `;` or breaks a limit is dropped | Only that alternative label is dropped; the coin is kept (`6a9b15b`)                          | One bad alternative should not cost a sound concept and her tags on it. The label itself still stays out. | A few lines in `tagging.ts`.                |
| The `--tags` example listed `misc (0)` last                                        | Roots in label order, as the spec's prose says (`cb2f5fe`)                                    | The example contradicted the rule beneath it.                                                             | Uncarried roots sorted last instead.        |
| A merge chain in one edit is an error                                              | Refused in either block order, with a message naming the merged or deleted target (`9a1906f`) | The plan's code caught it in one order only.                                                              | A chain takes two saves.                    |
| Emptying `Tags:` hands the set back                                                | Also when the fixed set was emptied by deletions (`85f732f`)                                  | Otherwise an emptied fixed set stayed the user's for good, and the chat was never tagged again.           | See parked behaviour 1 in the deferred doc. |

## Commits

26 commits, oldest first. Scopes follow `.commitlintrc.mts`: `sdk` for
`src/` outside `src/tui/`, `tui` for `src/tui/`, none for docs. Two of the
plan's commit headers were 52 characters long, so they were shortened to
fit the 50-character limit.

### Design

- `9e9174e` docs: Specify tags
- `58274f6` docs: Plan tags

### Tasks 1 to 13

- `b08743d` feat(sdk): Add the tag vocabulary document
- `f9ea6df` feat(sdk): Check and apply Dorothy's tags
- `66ea6b0` fix(sdk): Read escaped quotes in her tags
- `838ed84` feat(sdk): Keep a chat's tags in its sidecar
- `85436f9` feat(sdk): Ask for tags in the review
- `79ad768` feat(sdk): Tag conversations in the idle review
- `c664497` feat(sdk): Index the vocabulary and chats' tags
- `ff90553` feat(sdk): Search and list conversations by tag
- `577d099` feat(sdk): Record and show tag lookups
- `aa54e89` feat(sdk): Serve the tags tool
- `1ee29b2` feat(sdk): Edit a chat's tags with --memory
- `0bb67da` feat(sdk): Print the tags with --tags
- `0ffd585` feat(sdk): Correct the vocabulary with --edit-tags
- `9a1906f` fix(sdk): Refuse merge chains in either order
- `5608084` feat(tui): Tag chats from the TUI
- `cb2f5fe` docs: Describe tags

### Review fixes

- `01c6aec` fix(sdk): Keep tags coined while --memory is open
- `85f732f` fix(sdk): Hand back an emptied fixed tag set
- `236d6af` fix(sdk): Check the vocabulary before writing it
- `9897024` test(sdk): Pin hidden carriers out of tag lists
- `6a9b15b` docs: Drop only a coin's bad alternative labels

### Probe and reports

- `eb9e8a5` tweak(claude): Switch Claude accounts
- `3684863` docs: Keep the tags probe's sample data
- `e03210b` docs: Report the tags probe

This report and the deferred doc follow.

## Verification

- `bun run check` passes, with 927 tests across 50 files. It runs the
  typecheck, Biome, remark, yamllint, dotenvx, the em dash lint and
  `bun test`.
- Boundary tests keep the Agent SDK out of `src/recall/` and `src/tui/`.
  `src/recall/` may import only `sidecar.js`, `rank.js` and `vocabulary.js`
  from `src/memory/`.
- Every test passes an explicit environment or temporary path, so no test
  can read or write a real `tags.json`.
- **The live probe**, in tmux with temporary XDG directories, is described
  in full in the [probe report](2026-10-08-tags.md). It covered:
  - coining and reuse across three chats;
  - `⌕ listed tags · 6 tags` and
    `⌕ searched tagged sourdough starter · 2 conversations`, each with a
    correct answer;
  - a rename through `--edit-tags` holding through a later review;
  - a `--memory` save that kept a concept coined while its editor was
    open.

## Known limitations

None blocks merge.

- **The whole vocabulary goes into every review**, and labels compare
  without case. Both are in the spec's known limitations.
- **A recap chat carries the topics it recalls.** In the probe, a chat that
  only asked about the others was tagged with their subjects, which raised
  their counts.
- **A rename frees the old label.** After a rename, Dorothy may coin the
  old label again as a new concept. The probe saw no such coin, because
  the renamed concept's scope note still matched. Deleting a concept,
  unlike renaming it, keeps its labels from being coined again.
- **Three parked behaviours.** Each is rare or bounded, and each is
  described with its ruling in the
  [deferred doc](../deferred/2026-10-08_tags-deferred.md):
  - a save of an unchanged `--memory` view handing back an emptied fixed
    set;
  - a concept deleted while `--memory` is open blocking the save of an
    untouched `Tags:` line;
  - a chat hidden mid-run still shown to that run's reviews.
- **Test gaps.** Behaviours that hold but have no test of their own are
  listed in the same doc.
