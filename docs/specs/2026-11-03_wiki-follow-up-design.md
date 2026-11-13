---
ctime: 2026-11-03
mtime: 2026-11-03
spdx: GPL-3.0-only
title: Wiki follow-up design
description: >-
  Closing out the merged repository wiki and strengthening its integrity
  tests while retaining the remaining findings with their evidence.
tags:
  - wiki
  - verification
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/specs/2026-11-03_wiki-follow-up-design.md
   -
   -->

# Wiki follow-up

## Intent

The [repository wiki](../reports/2026-11-03_repository-wiki.md) merged in
PR #128. Its report retains parser, coverage and editorial limits. The
user asked to commence the proposed follow-up, starting with roadmap
close-out and test coverage. A reader should be able to see what finished,
what remains and which checks protect future edits.

## Approach

Extend the existing Bun tests and shared Markdown parser. Extract the
filesystem checks from `docs.test.ts` into a small TypeScript helper so
temporary repositories can exercise broken fragments, URL resolution and
duplicate catalogue records through the same code the real checks use.
This is the implementation choice for the authorized follow-up.

Keeping all checks inside the test file would make filesystem fixtures
depend on the current checkout. Replacing the parser with a Markdown
framework would expand the change and add a dependency. Neither is
needed for the agreed coverage work.

## Requirements

- Keep the exported parser interfaces and current link behaviour.
- Check fragments in root `AGENTS.md` and `docs/AGENTS.md` as well as
  the pages already checked by `docs.test.ts`.
- Catalogue validation reports missing records and repeated entries for
  a record. Repeated links to non-record pages are allowed. Resolve
  aliases to the same record before counting it.
- Test valid and broken links and fragments using temporary files. Pin
  a root-relative path, a percent-escaped path and a percent-escaped
  fragment, with no reads of real user data or model calls.
- Add parser cases for tilde fences, reference definitions with
  fragments, Unicode headings, heading links and closing hashes.
  Preserve the existing test of the third repeated heading's `-2`.
- Record the wiki in roadmap Done and Revisions, without reordering
  Ahead. Add the remaining wiki findings to Candidates and the wiki's
  priorities index with links to their evidence.
- Describe the expanded checks on the repository workflow page.
- Add a follow-up report separating addressed findings from remaining
  parser gaps, editorial work and source conflicts. Do not rewrite the
  original report, spec or plan.

## Constraints

Use Bun and TypeScript with no new dependencies. Every new file has the
house header; Markdown lines are at most 80 characters, with Markdown
links and no em dash. New records join `docs/wiki/records.md`. Root
`AGENTS.md` stays at 100 lines and `docs/AGENTS.md` within 60. Commit
headers are at most 50 characters, body lines at most 72, with
Conventional Commits and no agent trailers.

No parser rewrite, application feature, live host probe or paid model
call belongs to this pass. The roadmap remains the sole priority queue.
Unresolved source conflicts stay qualified until new evidence settles
them. Historical records are retained unchanged.

## Verification

Tests must demonstrate rejected invalid fixtures before implementation
and passing fixtures afterwards. Run the targeted suites, then the full
`bun run check`, and obtain an independent review before merge. The
report records the commands, outcomes, review findings and remaining
limits. Push, open a pull request and merge once CI passes, as the
repository's standing authorization provides.
