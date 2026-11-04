---
ctime: 2026-11-03
mtime: 2026-11-03
spdx: GPL-3.0-only
title: Repository wiki
description: >-
  Implementation plan for the repository wiki: a link test, the records
  catalogue, topic and profile pages, decisions, questions, problems,
  the priorities index and the navigation that ties them in.
tags:
  - dorothy
  - docs
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-11-03_repository-wiki.md
   -
   -->

# Repository Wiki Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A maintained Markdown wiki under `docs/` that answers where a
topic lives, why a choice was made, what is asked and what goes wrong,
what comes next, and what each recurring system is to Dorothy.

**Architecture:** `docs/README.md` is the front door; `docs/wiki/` holds
topic, profile and cross-cutting pages with stable names, each linking
the dated records as evidence. A shared link parser in
`scripts/markdown-links.ts` serves the existing guidance test and a new
`docs.test.ts`, which fails on a broken link or heading fragment in the
wiki and on a dated record the catalogue misses.

**Tech Stack:** Markdown (remark, markdownlint-cli2 with the house
presets); Bun and TypeScript for the test; `bun:test`.

**Spec:**
[`docs/specs/2026-11-03_repository-wiki-design.md`](../specs/2026-11-03_repository-wiki-design.md)

## Global Constraints

- Every new page opens with this frontmatter and breadcrumb, its path in
  the breadcrumb, then one `#` heading; `ctime` stays fixed, `mtime`
  changes with the page:

  ```markdown
  ---
  ctime: 2026-11-03
  mtime: 2026-11-03
  spdx: GPL-3.0-only
  title: <Title>
  description: >-
    <One or two lines on what the page answers.>
  tags:
    - wiki
    - <subject>
  ---

  <!--
     -
     - ~chewygumxx/dorothy.git
     - ::: :/docs/wiki/<path>.md
     -
     -->
  ```

- Lines at most 80 characters, inline code included; Markdown links,
  never `[[...]]`; no em dash anywhere (`lint:emdash`).
- Living pages (`docs/README.md`, `docs/wiki/`) take stable descriptive
  filenames; dated records keep `YYYY-MM-DD_<abbreviated-title>.md`.
- Never move, rename or rewrite a record in `specs/`, `plans/`,
  `reports/`, `notes/` or `deferred/`; they retain what they recorded.
- Implementation claims are checked against code, tests and package
  guides and cite them; rationale is cited from the record that made the
  decision; never infer approval from a spec's existence.
- Mark each capability's state: built, designed, awaiting a live check,
  historical comparison (dated), or superseded. A finished plan alone
  does not make a capability built.
- The roadmap alone orders work; the wiki never reorders or schedules.
- "Frequent" needs evidence of recurrence: a `feedback` memory in
  `.agents/memory/`, a file in `docs/deferred/`, the code review
  (`docs/reports/2026-10-19-code-review.md`) or a report's limitations.
- One explanation of each subject; elsewhere a short answer and a link.
- Root `AGENTS.md` stays at 100 lines and `docs/AGENTS.md` within 60
  (`agents.test.ts`).
- No test reads real user data or calls a model.
- Commit headers at most 50 characters, body lines at most 72;
  Conventional Commits, `docs` type, no agent trailers.

## Review Focus

1. A heading renamed in a later task breaks a fragment another page
   links: the link test checks fragments, so run it after every task,
   not only the last.
2. A page states a designed or prototyped capability as built, most
   likely orchestration, OpenClaw delivery or Codex's live probe: each
   owning task greps its claims against the roadmap Status and reports.
3. The evaluation's early figures cited as final: Task 5 pins the
   rerun's figures, and its claim check greps for the early ones.
4. Duplicate headings on one page (two `### Status`) take GitHub's `-1`
   suffix: the slug test in Task 1 covers the suffix.
5. A nested record or artifact (`reports/2026-10-18-protocol-diversity/`)
   mistaken for a dated record the catalogue must list: Task 2's test
   counts only the five directories' top level, and a case pins it.

---

### Task 1: Shared Markdown link parser

**Files:**

- Create: `scripts/markdown-links.ts`
- Create: `scripts/markdown-links.test.ts`
- Modify: `agents.test.ts:114-131` (remove `linkTargets`, import it)

**Interfaces:**

- Produces, from `scripts/markdown-links.ts`:
  - `type Link = { path: string; fragment: string | undefined }`
  - `links(markdown: string): Link[]`: every relative inline link and
    reference definition outside code fences and code spans; `path` is
    `""` for a same-page `#fragment`; links with a scheme are dropped.
  - `linkTargets(markdown: string): string[]`: the non-empty `path`s of
    `links`, exactly today's behaviour in `agents.test.ts`.
  - `headingSlugs(markdown: string): Set<string>`: GitHub's anchor for
    each ATX heading outside fences.

- [ ] **Step 1: Write the failing tests** in
      `scripts/markdown-links.test.ts`, house header copied from
      `scripts/statusline.test.ts`:

```ts
it("splits a path from its fragment", () => {
    expect(links("[a](./x.md#Some-Part) [b](#here)")).toEqual([
        { path: "./x.md", fragment: "Some-Part" },
        { path: "", fragment: "here" },
    ]);
});
it("skips code and schemes", () => {
    const md = "`[c](./no.md)`\n```\n[d](./no.md)\n```\n[e](https://x)\n";
    expect(links(md)).toEqual([]);
});
it("keeps linkTargets as it was", () => {
    expect(linkTargets("[a](<./a b.md>) [b](#x)\n[r]: ./r.md\n")).toEqual([
        "./a b.md",
        "./r.md",
    ]);
});
it("slugs headings as GitHub does", () => {
    const md = "# The `deliver` step\n## Why? Because.\n## Why? Because.\n";
    expect([...headingSlugs(md)]).toEqual([
        "the-deliver-step",
        "why-because",
        "why-because-1",
    ]);
});
it("ignores a heading inside a fence", () => {
    expect([...headingSlugs("```\n# not\n```\n# yes\n")]).toEqual(["yes"]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test scripts/markdown-links.test.ts`
Expected: FAIL, cannot resolve `./markdown-links.js`.

- [ ] **Step 3: Implement the three functions.** Move the fence and span
      stripping and both regexes from `agents.test.ts` unchanged. A
      slug: strip inline links to their text, backticks, `*` and `_`
      emphasis markers; lowercase; delete every character outside
      `[\p{L}\p{M}\p{N}\p{Pc} -]` (Unicode flag); spaces to `-`; a
      repeat takes `-1`, `-2` in order of appearance.

- [ ] **Step 4: Import `linkTargets` in `agents.test.ts`** from
      `./scripts/markdown-links.js` and delete its local copy and
      comment.

- [ ] **Step 5: Run the tests**

Run: `bun test scripts/markdown-links.test.ts agents.test.ts`
Expected: PASS, the agents suite's counts unchanged.

- [ ] **Step 6: Commit**

```bash
git add scripts/markdown-links.ts scripts/markdown-links.test.ts \
    agents.test.ts
git commit -m "test: share the Markdown link parser"
```

### Task 2: The wiki test, the home stub and the records catalogue

**Files:**

- Create: `docs.test.ts`
- Create: `docs/README.md`
- Create: `docs/wiki/records.md`

**Interfaces:**

- Consumes: `links`, `headingSlugs` from Task 1.
- Produces: `docs/README.md` with a `## Pages` list, each later task
  adding one line per page it writes; `docs/wiki/records.md` with one
  `##` heading per subject, named as in Step 3, which later pages link
  by fragment.

- [ ] **Step 1: Write the failing test** `docs.test.ts`, header copied
      from `agents.test.ts`, with the four cases below.

1. `resolves every link and fragment in the wiki`: pages are
   `docs/README.md`, every `docs/wiki/**/*.md`, `docs/roadmap.md` and
   the root `README.md`. For each link, resolve `path` against the
   page's directory (a leading `/` means the repository root; `""`
   means the page itself); it must exist, and where it is a `.md` file
   and has a fragment, `headingSlugs` of that file must hold it. Expect
   the list of `<page>: <path>#<fragment>` failures to be `[]`.
2. `catalogues every dated record`: records are the `.md` files
   directly in `docs/specs`, `docs/plans`, `docs/reports`, `docs/notes`
   and `docs/deferred` whose names start with a date; expect those
   `records.md` does not link to be `[]`.
3. `links every wiki page from home`: expect the `docs/wiki/**/*.md`
   files `docs/README.md` does not link to be `[]`.
4. `counts only top-level records`: given the names
   `2026-10-18-protocol-diversity.md`, `AGENTS.md` and the directory
   `2026-10-18-protocol-diversity`, only the first is a record.

- [ ] **Step 2: Run it to see it fail**

Run: `bun test docs.test.ts`
Expected: FAIL on the catalogue (104 records missing) and on the
missing home page. If the roadmap or root `README.md` already has broken
links, fix each narrowly in this task and name them in the commit body.

- [ ] **Step 3: Write `docs/wiki/records.md`:** a short opening on the
      records' kinds (research in `notes/`, specification in `specs/`,
      implementation strategy in `plans/`, evidence in `reports/`,
      findings left for later in `deferred/`), then these `##` subjects,
      each listing its records oldest first as
      `- [<title>](../<dir>/<file>.md): <kind>. <description>`, title
      and description from the record's frontmatter, shortened to fit:
      `Memory`, `Evaluation`, `Identity, harnesses and delivery`,
      `Models and routing`, `Terminal`, `Orchestration`,
      `Repository workflow`. A record on two subjects is listed under
      the one it mainly serves.

- [ ] **Step 4: Write the `docs/README.md` stub:** title `Dorothy's
      wiki`, a two-sentence introduction (the wiki explains the present
      and links the records as evidence), then `## Pages` holding
      `- [Records](./wiki/records.md): every dated record by subject.`

- [ ] **Step 5: Run the test and the lints**

```sh
bun test docs.test.ts
bunx remark --frail --quiet --no-stdout docs/README.md docs/wiki
bunx markdownlint-cli2 docs/README.md 'docs/wiki/**/*.md'
bun run lint:emdash && bun run lint:header
```

Expected: all pass; `lint:header` reports `Out-of-Sync: 0`.

- [ ] **Step 6: Commit**

```bash
git add docs.test.ts docs/README.md docs/wiki/records.md
git commit -m "docs: catalogue the records for the wiki"
```

### Content tasks 3 to 10: the shared steps

Each content task below writes its pages, then runs these steps; they
are not repeated per task.

- [ ] Read the sources the task names before writing; quote no more
      than a sentence of any.
- [ ] Each page links home under its title, `[Wiki home](../README.md)`
      from `wiki/` and `../../README.md` from its subdirectories, and
      only to pages that already exist; Task 11 adds the rest.
- [ ] Add one line per new page to `docs/README.md`'s `## Pages`.
- [ ] Run the commands of Task 2's Step 5, plus the task's own claim
      checks; expected all pass.
- [ ] Commit with the header the task gives.

### Task 3: Package and harness profiles

**Files:** Create `docs/wiki/profiles/packages.md`,
`docs/wiki/profiles/harnesses.md`.

- Sources: `AGENTS.md` (Packages), `workspace.test.ts` (`GRAPH`), each
  `packages/<name>/AGENTS.md` (Entry points, Invariants);
  `docs/reports/2026-11-01-delivery.md` (Summary, Waiting for the user),
  `docs/reports/2026-10-20-recording.md`, the contract spec's host
  profiles (`docs/specs/2026-10-18-memory-contract-design.md`), the
  roadmap's Dorothy's Memory Status.
- `packages.md`: one `##` per package, all eight, in `GRAPH` order:
  purpose, what it may import, its entry points, a link to its guide.
  A diagram of the graph is allowed (Mermaid `graph`), drawn from
  `GRAPH`, not from prose.
- `harnesses.md`: one `##` per host (Claude Code, Codex, OpenClaw,
  Hermes Agent), each with the same four sub-headings `Persona`,
  `Recording`, `Memory access`, `Live checks`, each giving its state and
  the record that shows it. This is the one page holding host state.
- Claim checks: `grep -n "Status" docs/roadmap.md` agrees with each
  host's state; OpenClaw's delivery is not called built; Codex's and
  Hermes's live probes are called waiting on the user unless a later
  report says otherwise.
- Commit: `docs: profile the packages and harnesses`

### Task 4: Protocol and service profiles

**Files:** Create `docs/wiki/profiles/protocols.md`,
`docs/wiki/profiles/services-and-providers.md`.

- Sources: `docs/reports/2026-10-18-protocol-diversity.md` and its two
  nested reports, `docs/notes/2026-10-18_open-source-replacements.md`
  and its directory, `docs/specs/2026-11-01-model-providers-design.md`,
  `docs/reports/2026-11-01-model-providers.md`, the notes on
  Featherless, budgets and the Anthropic and OpenAI comparison, the
  memory systems comparison.
- `protocols.md`: one `##` per protocol the architecture or a proposal
  uses (MCP, the hook payloads, A2A and the others the records name):
  what it is, where Dorothy uses it, adoption state.
- `services-and-providers.md`: one `##` per external system the records
  weigh (providers, routers, memory systems, platforms), each marked
  used, proposed or compared; every price, term or model claim keeps its
  record's date and is never stated as current.
- Claim checks: every provider called used appears in code
  (`grep -rn "<name>" packages/*/src`); every price carries a date.
- Commit: `docs: profile protocols, services and providers`

### Task 5: Memory and evaluation topics

**Files:** Create `docs/wiki/topics/memory.md`,
`docs/wiki/topics/evaluation.md`.

- Sources: `packages/memory/AGENTS.md`, the store, bodies, contract,
  recall, compaction, tags, history, recording and engine specs and
  reports, `docs/reports/2026-10-31-first-evaluation.md`,
  `docs/reports/2026-10-31-memory-engine.md`, `packages/eval/AGENTS.md`.
- `memory.md`: what it is and what exists now (conversations,
  knowledge, recall and the `deliver` step, compaction, vocabulary,
  history, the shared service), where its code lives, then the links to
  its records' catalogue section (`../records.md#memory`).
- `evaluation.md`: what is measured, how questions are drafted and
  reviewed, the systems compared, what the results establish, their
  limits. The figures it gives as current are the rerun's under the
  changed judges: strict 43 of 125 for `dorothy`, 27 for `lexical`, 85
  for `cited`; preferences 5 of 10; abstentions 8 of 8. Earlier figures
  appear only as history, saying the judges changed between them.
- Claim checks:
  `grep -n "40/124\|9/124\|7.3%" docs/wiki/topics/evaluation.md` shows
  each only in a sentence that names it earlier; the `deliver` step is
  found by `grep -rn "deliver" packages/memory/src | head`.
- Commit: `docs: explain memory and its evaluation`

### Task 6: Identity, models and terminal topics

**Files:** Create `docs/wiki/topics/identity-and-harnesses.md`,
`docs/wiki/topics/models-and-routing.md`, `docs/wiki/topics/terminal.md`.

- Sources: `packages/identity/AGENTS.md`, `packages/gateway/AGENTS.md`,
  the identity gateway, recording and delivery specs and reports;
  `packages/agent/AGENTS.md`, the model providers spec, both its plans
  and its report; `packages/tui/AGENTS.md`, the TUI chat, input editor,
  Markdown replies, statusline and catalogue specs.
- `identity-and-harnesses.md`: how her identity is defined and reaches a
  host, recording and the gateway as mechanisms; links
  `../profiles/harnesses.md` for each host's state instead of
  restating it.
- `models-and-routing.md`: roles, providers, routes, fallback and
  accounting as built; what fallback does after a turn has had effects,
  from the report's findings; links to configuration in the root
  `README.md` and to `../profiles/services-and-providers.md`.
- `terminal.md`: chat, input, rendering, the catalogue and layout.
- Claim checks: each route or role named is found in
  `packages/agent/src` or `packages/core/src`; nothing on the identity
  page says which hosts are live.
- Commit: `docs: explain identity, models and the terminal`

### Task 7: Orchestration and repository workflow topics

**Files:** Create `docs/wiki/topics/orchestration.md`,
`docs/wiki/topics/repository-workflow.md`.

- Sources: `docs/specs/2026-11-02-orchestration-design.md`,
  `docs/notes/2026-11-01_agent-orchestration.md`,
  `docs/notes/2026-11-02_featherless-orchestrator.md`, the roadmap's
  Candidates (the herdr registry), `.agents/skills/agent-stewardship/`;
  `AGENTS.md`, `docs/AGENTS.md`, the workspace modularity, agentic asset
  and sops specs and reports, `.agents/skills/worktrees/SKILL.md`.
- `orchestration.md`: two clearly separate parts. Dorothy's own
  orchestration: designed, no ordered roadmap phase as of 2026-11-03,
  its prototype local and unmerged. The tools coordinating her
  developers today: herdr panes, the stewardship skill, the registry
  candidate, unscheduled.
- `repository-workflow.md`: package boundaries (a summary linking
  `../profiles/packages.md`), worktrees, checks, agent assets,
  secrets, and keeping documentation current, including the wiki's own
  maintenance rule from the spec.
- Claim checks: `grep -n "Orchestration" docs/roadmap.md` shows no phase
  in Ahead; the page never names a prototype file as built.
- Commit: `docs: explain orchestration and the workflow`

### Task 8: Decisions

**Files:** Create `docs/wiki/decisions.md`.

- Sources: every report's Rulings section, the roadmap's Revisions, the
  specs' Approaches sections, `feedback` memories in `.agents/memory/`.
- One `##` per subject (the catalogue's seven), one `###` per decision,
  each with `Context`, `Alternatives`, `Choice`, `Reason`, `Cost`,
  `Standing` and `Sources` as bold lead-ins in one list, never as
  headings (so slugs stay unique).
- The engine decision follows the spec's example: the first ruling on
  her strict lead, the user's overturning of it on preferences, the
  judges' change (`MEMORY_NOTE`, #102), the rerun that kept the engine,
  and the condition for reconsidering a replacement.
- Claim checks: every `Reason` cites a record; no reason is written for
  a decision without one (mark `Reason: not recorded` instead).
- Commit: `docs: record the decisions and their reasons`

### Task 9: Questions and problems

**Files:** Create `docs/wiki/questions.md`, `docs/wiki/problems.md`.

- Sources: as Task 8, plus `docs/deferred/`, the code review, each
  report's limitations and findings, the topic pages.
- `questions.md`: each `##` a concrete question, answered on the page in
  a few sentences, then its links. Include the distinctions a reader
  needs: record against reference, spec against built, the two kinds of
  orchestration.
- `problems.md`: each `##` a searchable symptom, then `Cause`,
  `Diagnosis`, `Remedy`, `State` (resolved defect, known limitation or
  workflow pitfall) and `Evidence` as bold lead-ins. Investigate the
  spec's three candidates: a plan's limit read as a failed answer,
  finding a conversation without delivering its passage, provider
  fallback after a turn had effects; write each only if its records
  support it.
- Claim checks: every resolved state cites the fix's record or PR, and
  every "frequent" or "often" this finds cites a recurrence:

  ```sh
  grep -n -i "frequent\|often\|repeated" \
      docs/wiki/questions.md docs/wiki/problems.md
  ```

- Commit: `docs: answer questions and diagnose problems`

### Task 10: The priorities index

**Files:** Create `docs/wiki/priorities.md`.

- Source: `docs/roadmap.md` alone, and the reports' "waiting for the
  user" sections for blocked checks.
- One line per Ahead phase, in the roadmap's order, as
  `- [<Phase>](../roadmap.md#<slug>): <Status>.`, then one line per
  Candidate, then `## Blocked on the user`, a list of live checks
  awaiting sign-ins or approvals with their reports. No reasons, no
  dependencies: the opening line says the roadmap holds them.
- Claim check: the phase order matches
  `grep -n "^### " docs/roadmap.md`.
- Commit: `docs: index the roadmap's priorities`

### Task 11: Navigation and the maintained guides

**Files:**

- Modify: `docs/README.md` (complete it)
- Modify: every `docs/wiki/**/*.md` (a closing `## Related` list)
- Modify: `README.md:750-754` (Development) and its documentation entry
- Modify: `docs/roadmap.md:29-43` (Revising), `:96-99` (evaluation)
  and its opening paragraph (a link to the wiki)
- Modify: `docs/AGENTS.md` (the table and filename convention)
- Modify: `AGENTS.md:65-66`, `:99-100`

- [ ] **Step 1: Complete `docs/README.md`:** the introduction, then
      `## Routes`, the spec's six questions each as a link to the page
      that answers it, then `## Pages` grouped as Topics, Profiles and
      Across the subjects, then a paragraph on reference against
      records. Bump nothing: `ctime` and `mtime` are today.
- [ ] **Step 2: Add `## Related`** to each wiki page, three to six links
      to the other pages that share its subject.
- [ ] **Step 3: Root `README.md`:** replace the five-package sentence
      with the eight, named in `GRAPH` order, and add after it:
      `The [wiki](./docs/README.md) explains each subsystem, the
      decisions behind it and what comes next.` Command instructions
      stay where they are.
- [ ] **Step 4: Roadmap:** after its first paragraph add `The
      [wiki's priorities](./wiki/priorities.md) index this file;
      [the wiki](./README.md) explains each subject.`; add Revising step
      6, `Update [the wiki](./README.md): its priorities index, and the
      pages the phase changed.`; correct "The evaluation is built as
      `@dorothy/eval` but not yet run" to say it is built and has run,
      linking the first evaluation's report. Bump `mtime`.
- [ ] **Step 5: `docs/AGENTS.md`:** add `wiki/` and `README.md` rows to
      the table (maintained reference; the front door), and to the
      filename convention: `README.md` and `wiki/` take stable
      descriptive names; existing dated paths stay as they are. Keep it
      within 60 lines. Bump `mtime`.
- [ ] **Step 6: Root `AGENTS.md`**, no line added:

```markdown
- A change to a package's architecture updates its `AGENTS.md`, and one
  to behaviour, decisions or priorities the wiki's pages, in the same branch.
```

```markdown
Before working in a package, read `packages/<name>/AGENTS.md`; before
writing docs, `docs/AGENTS.md`; to find a topic, `docs/README.md`.
```

  Bump its `mtime`.

- [ ] **Step 7: Verify**

```sh
bun test docs.test.ts agents.test.ts header.test.ts workspace.test.ts
bun run lint:md && bun run lint:emdash && bun run lint:header
```

Expected: all pass; `AGENTS.md` at 100 lines or fewer.

- [ ] **Step 8: Commit**

```bash
git add docs README.md AGENTS.md
git commit -m "docs: route the guides through the wiki"
```

### Task 12: Verification, review and report

**Files:** Create `docs/reports/2026-11-03_repository-wiki.md`; modify
`docs/wiki/records.md` (list the report and this plan).

- [ ] **Step 1: Run the whole check**

Run: `bun run check`
Expected: exit 0, ending in the test summary with `0 fail`.

- [ ] **Step 2: Spot-check** orchestration, host delivery, provider
      routing and the evaluation's figures against their sources, as
      the spec's completion checks name; fix what disagrees.
- [ ] **Step 3: Dispatch a fresh reviewer** (`requesting-code-review`)
      with the spec, this plan and `git diff main...HEAD -- docs`: factual
      standing, navigation, source coverage, maintenance rules. Fix
      Critical and Important findings.
- [ ] **Step 4: Write the report:** the checks run with their output,
      the rulings made while writing (profile splits, subject
      placements, any correction to a maintained guide), the reviewer's
      findings and their resolution, and every unresolved source
      conflict by name. Catalogue it and this plan in `records.md`.
- [ ] **Step 5: Rerun `bun run check`**, expected exit 0, and commit:

```bash
git add docs
git commit -m "docs: report the repository wiki"
```

- [ ] **Step 6: Push and open the pull request**, merging once CI passes,
      as root `AGENTS.md` permits.
