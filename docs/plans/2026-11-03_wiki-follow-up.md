---
ctime: 2026-11-03
mtime: 2026-11-03
spdx: GPL-3.0-only
title: Wiki follow-up implementation plan
description: >-
  Two tasks to strengthen documentation integrity checks and close out
  the merged repository wiki with an accurate remaining backlog.
tags:
  - wiki
  - verification
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/plans/2026-11-03_wiki-follow-up.md
   -
   -->

# Wiki follow-up implementation plan

> For agentic workers: use `subagent-driven-development` task by task.
> Steps use checkboxes; reviews follow each task and the whole branch.

**Goal:** Close out the wiki and strengthen its integrity checks.

**Architecture:** Keep the shared Markdown parser. Extract reusable
filesystem validation from the repository test and exercise it with
temporary repositories. Record completed and remaining work in the
existing wiki and roadmap.

**Tech stack:** Bun, TypeScript, Node filesystem and path APIs.

**Spec:** [Wiki follow-up design](../specs/2026-11-03_wiki-follow-up-design.md).

## Global constraints

- Use Bun and TypeScript with no new dependencies.
- Every new file has the house header; Markdown lines are at most 80
  characters, with Markdown links and no em dash.
- New records join `docs/wiki/records.md`.
- Root `AGENTS.md` stays at 100 lines and `docs/AGENTS.md` within 60.
- Commit headers are at most 50 characters, body lines at most 72,
  with Conventional Commits and no agent trailers.
- No parser rewrite, application feature, live host probe or paid model
  call belongs to this pass.
- The roadmap remains the sole priority queue.
- Unresolved source conflicts stay qualified until new evidence settles
  them. Historical records are retained unchanged.

## Review focus

1. A broken same-page fragment must be rejected, while a valid fragment
   and an escaped Unicode fragment pass.
2. Root-relative paths resolve under the injected repository root, not
   the machine root; a percent-escaped filename resolves to its file.
3. Two aliases or fragments of one record must count as a duplicate,
   while repeated navigation links do not.
4. New parser fixtures pin tilde fences and reference fragments without
   weakening the existing underscore and repeated-heading regressions.
5. The follow-up must not schedule remaining work or restate an old
   report's already-covered `-2` case as missing.

### Task 1: Exercise the documentation checks with fixtures

**Files:**

- Create `scripts/docs-links.ts` and `scripts/docs-links.test.ts`.
- Modify `docs.test.ts` and `scripts/markdown-links.test.ts`.

**Interfaces:**

- Consume `links`, `headingSlugs` and `linkTargets` from the existing
  parser; leave their exports unchanged.
- Produce `resolveLink(root: string, page: string, path: string): string`.
- Produce `linkFailures(root: string, pages: string[]): string[]`,
  returning the existing `page: path#fragment` diagnostic strings.
- Produce `catalogueFailures(root: string, page: string,
  records: string[]): { missing: string[]; duplicates: string[] }`.
  Record paths and returned paths are relative to `root`; each duplicate
  path appears once, sorted, after resolving aliases and fragments.

- [ ] Write failing tests for the three new exports using a temporary
      root removed after each case. Use literal expected values:

  ```ts
  // Fixture pages: docs/page.md and docs/a b.md with "# Café".
  // resolveLink(root, page, "/docs/a%20b.md") is join(root, "docs/a b.md").
  // [yes](./a%20b.md#caf%C3%A9) produces no failure.
  // [no](#absent) produces ["docs/page.md: #absent"].
  // [no](./missing.md) produces ["docs/page.md: ./missing.md"].
  // Repeated links to ../README.md do not duplicate a record.
  // ./a%20b.md and /docs/a%20b.md#caf%C3%A9 duplicate "docs/a b.md".
  // An expected "docs/missing.md" is reported as missing.
  ```

- [ ] Run `bun test scripts/docs-links.test.ts`; retain RED output from
      the missing module. Test actual exported functions, never mocks.
- [ ] Extract resolution and link validation from `docs.test.ts` into
      the new helper. Keep malformed-percent fallback behaviour. Add
      catalogue missing/duplicate detection using resolved paths.
- [ ] Wire `docs.test.ts` to the helpers. Check the two guidance files
      in its fragment test. Its catalogue assertion expects
      `{ missing: [], duplicates: [] }`. Keep page reachability and
      top-level record checks.
- [ ] Add parser cases with these independent expectations:

  ```ts
  links("~~~ts\n[x](./no.md)\n~~~\n[r]: ./yes.md#Part\n")
  // [{ path: "./yes.md", fragment: "Part" }]
  headingSlugs("~~~\n# no\n~~~\n# Café [世界](./x.md) ###\n")
  // Set containing only "café-世界".
  ```

- [ ] Run the parser, docs helper, docs and agents tests. Record GREEN
      commands and output; self-review and commit:
      `test: Strengthen wiki integrity checks`.

### Task 2: Close out the roadmap and retain the findings

**Files:**

- Modify `docs/roadmap.md`, `docs/wiki/priorities.md`,
  `docs/wiki/topics/repository-workflow.md` and `docs/wiki/records.md`.
- Create `docs/reports/2026-11-03_wiki-follow-up.md`.

**Interfaces:** Consume the helpers and tests from Task 1 and the merged
wiki's report. No new TypeScript interface is produced.

- [ ] Read the original report's Known limits and Source conflicts,
      the roadmap's Revising, Candidates and Done, and Task 1's report.
- [ ] Add a Done entry for the repository wiki, linking its spec, plan
      and report and PR #128. Link this follow-up's records there too.
- [ ] Add a sourced candidate covering the remaining parser gaps,
      editorial work and evidence conflicts, with no new Ahead phase.
      Add its matching line in the priorities candidate list.
- [ ] Add a Revisions entry explaining completion and triage, preserving
      the existing Ahead order. Update the workflow's check description
      for guidance fragments and duplicate catalogue entries.
- [ ] Write the follow-up report: baseline, changes, RED/GREEN evidence
      from Task 1, source conflicts left qualified, deferred work and
      verification. Note that `-2` coverage predates this follow-up.
      Keep all previous records unchanged. Catalogue the new report.
- [ ] Run the targeted suites and `bun run check`. Record their actual
      outputs in the report, and commit:
      `docs: Close out the repository wiki`.
- [ ] After task review, obtain whole-branch review. Fix findings, record
      the review outcome, run checks appropriate to any changes, and
      push, open the pull request and merge after CI passes.
