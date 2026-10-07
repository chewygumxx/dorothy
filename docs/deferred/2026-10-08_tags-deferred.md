---
ctime: 2026-10-08
mtime: 2026-10-08
spdx: GPL-3.0-only
title: Tags deferred findings
description: >-
  Findings on the tags branch that reviews judged safe to leave: three
  parked behaviours, small code points and test gaps.
tags:
  - dorothy
  - memory
  - deferred
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/deferred/2026-10-08_tags-deferred.md
   -
   -->

# Tags deferred findings

Branch `feat/tags` (as of `e03210b`). These come from the per-task reviews,
the whole-branch review and the review of its fixes. The whole-branch
review triaged each one, and none blocks merge. Entries that later commits
fixed are left out.

## Parked behaviours

Each of these is real, but rare or bounded. Each was left with a ruling.

1. **A save of an untouched `--memory` view can hand tags back.** The case
   is a set the user fixed, after `--edit-tags` deleted every concept in
   it. Opening `--memory` and saving without a change hands the set back,
   resets `reviewedThrough` to 0 and schedules a review. Follow-up: hand
   the set back only when the parse is otherwise an edit
   (`src/memory/edit-view.ts`, `lapsed`).
2. **A concept deleted while `--memory` is open blocks an untouched line.**
   If `--edit-tags` in another terminal deletes or renames a concept while
   a chat's `--memory` view is open, saving reopens the editor with
   `No tag by that name`, even though the user never touched `Tags:`.
   Nothing is lost. Follow-up: treat a `Tags:` line identical to the
   rendered one as unchanged before resolving its labels.
3. **Hiding a chat mid-run is not seen by that run's reviews.** A review's
   vocabulary filters on the `hidden` flags loaded at launch
   (`src/memory/service.ts`, `#carriers`). A concept carried only by a chat
   hidden since then can still be shown to a review, and reused, until the
   next launch. This follows the plan's ruling that reviews read the
   catalogue, not the index.

## Code

- `src/memory/commands.ts`, `runTagsEdit`: a sync or count failure on an
  index that opened is swallowed, so every block shows 0 conversations with
  no warning.
- `src/memory/vocabulary.ts`: `byLabel` and `liveConcepts` sort with
  `localeCompare`, so label order can differ by locale. This matches the
  rest of the codebase.
- `src/memory/vocabulary.ts`, `readTerm`: a tombstone's labels are not
  checked for length or `;`. Tombstones are only ever written from
  labels already checked.
- `src/memory/sidecar.ts`: `mergeReview` and `mergeEdit` don't cap,
  deduplicate or check the shape of the tags they are given. Their callers
  (`applyTagging`, the `--memory` parse) do this, and `readTags` caps on
  read.
- `src/memory/sidecar.ts`: `readProvenance` accepts any `by` for
  `fields.tags`. Anything other than `user` behaves as Dorothy's.
- `src/memory/review.ts`, `conceptLine`: rebuilds the set of shown concepts
  for each line, which is quadratic but negligible at vocabulary sizes.
- `src/memory/service.ts`: if a tagging review returned no `tags`,
  `fields.tags` would never be set and the chat would stay untagged. This
  is unreachable, since `validateReview` always returns tags while tagging.
- `src/memory/service.ts`: the skip path for a chat whose fields are all
  the user's does not prune unresolved ids from the user's tags. Reads
  resolve them anyway.
- `src/recall/tags.ts`, `narrowerThan`: would include the root itself if a
  cycle reached the `broader` table. Parsing forbids cycles; a
  `WHERE id != ?` would make "strictly beneath" hold regardless.
- `src/recall/query.ts`: `under: ""` gives `No tag by that name: .`, and
  `taggedWith` keeps a redundant `before` binding.
- `src/tui/state.ts`: blank tags or an empty `under` render odd dim lines.
- `src/memory/tags-view.ts`: reordering `Under:` counts as an edit and
  marks the concept as the user's.
- `README.md`: doesn't say that `--tags` needs the recall index.

## Test gaps

Each behaviour holds today, by reading or by an indirect test, but has no
test of its own.

- **Task 1** (`vocabulary.test.ts`): `updateVocabulary`'s lock argument,
  its `failed` branch and two concurrent updates through its queue. Also
  `readTerm` with an empty label or note, a bad `by` and malformed
  tombstones.
- **Task 2** (`tagging.test.ts`): the `dropped` test checks only its
  length. Also untested: a self-parent `broader`, a duplicate `broader`
  label, a blocked or `;` alternative label, the cap of 5 alternatives, a
  tag that resolves through a coin's alternative label, and tags past 5,
  which are not added to `dropped`.
- **Task 3** (`sidecar.test.ts`): a write-then-read round trip of tags
  through `updateSidecar`, and mutual exclusion between two async changes.
- **Task 4** (`review.test.ts`): one test echoing an `&quot;`-escaped label
  through `clean()`.
- **Task 5** (`service.test.ts`): `tags.json` breaking between the start of
  a review and its write. Also a failed vocabulary write, after which
  neither file may change (a Failures rule of the spec).
- **Task 6** (`sync.test.ts`): the savepoint failure path, which keeps the
  old tables and warns, and that an unparseable file's mtime is recorded so
  that it is not re-read at every sync. A file vanishing between `stat` and
  read heals at the next sync.
- **Task 7** (`tags.test.ts`): unlisted neighbours dropped from
  `under`, and a concept carried only by the live chat.
- **Task 8** (`transcript.test.ts`): a pin that a search event written
  before tags reads back unchanged.
- **Task 9** (`server.test.ts`): that the tag-limit errors reach the
  client.
- **Task 10** (`edit-view.test.ts`, `commands.test.ts`): alternative labels
  collapsing to 5 or fewer, and `wrap` keeping `Tags:` off the start of a
  line. Also `runMemoryEdit`'s emptying, unknown-label and
  broken-vocabulary paths.
- **Task 11** (`tags-view.test.ts`, `commands.test.ts`): a diamond whose
  shared concept has children of its own. Also `runTags` with a missing or
  empty `tags.json`, and its sync warnings.
- **Task 12** (`tags-view.test.ts`, `commands.test.ts`): a merge dropping a
  survivor's edge to itself, and the editor reopening when `applyTagsEdit`
  refuses.
