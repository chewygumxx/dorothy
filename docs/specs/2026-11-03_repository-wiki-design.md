---
ctime: 2026-11-03
mtime: 2026-11-03
spdx: GPL-3.0-only
title: Repository wiki
description: >-
  A maintained reference for Dorothy's topics, decisions, questions,
  recurring problems and dependencies, grounded in her code and records.
tags:
  - dorothy
  - docs
  - spec
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/specs/2026-11-03_repository-wiki-design.md
   -
   -->

# Repository wiki

## Intent

The user wants to find where a topic lives, why a decision was made,
frequent mistakes and questions, feature priorities, and profiles of
recurring packages, protocols, services and providers. They asked for
something closer to a repository wiki than an adventure log.

The collection currently has 115 Markdown files and 93 other artifacts.
Specs, plans, reports and notes describe successive phases. They preserve
evidence well, but a reader must reconstruct the present from that history.
The wiki supplies maintained explanations with links to those records.

The user chose the wiki direction; the file layout and editorial rules
below are the author's implementation of it, amended after a review on
2026-11-03.

## Approaches

1. **A Markdown wiki over the existing records.** Maintained subject pages
   answer questions directly; the dated records supply detail and evidence.
   GitHub renders it and every checkout carries it. Its cost is keeping the
   summaries current. This is the recommended implementation of the user's
   wiki direction.
2. **Move the records into subject directories.** Related files sit
   together, but the reader must still assemble an answer from successive
   designs and reports. The move also changes links and artifact paths.
3. **Publish a separate documentation site or hosted wiki.** Search and
   navigation could be richer, but a build or second repository adds another
   maintenance surface. That is unnecessary for the requested first pass.

## Reader experience

`docs/README.md` is the wiki's front door, linked from the root README.
Its links answer six questions:

- Where does this topic live?
- Why was this choice made?
- What do people need to understand or ask repeatedly?
- What tends to go wrong, and how is it diagnosed or avoided?
- What comes next, and why?
- What is this package, protocol, service, provider or harness to Dorothy?

The home page offers a short introduction, those routes, and a topic list.
Titles and descriptive links make GitHub browsing and repository search
useful without a generator. Each wiki page links home and to related pages.
Dates belong in metadata and evidence, rather than leading living filenames.

## Pages and responsibilities

All paths below are relative to `docs/`.

- `README.md`: navigation and the distinction between reference and records.
- `wiki/topics/memory.md`: conversations, knowledge, recall, compaction,
  vocabulary, history and the shared service; paths into their records.
- `wiki/topics/evaluation.md`: what is measured, review and comparison,
  what the results establish, and the limits of those results.
- `wiki/topics/identity-and-harnesses.md`: identity, context delivery,
  recording and the gateway as mechanisms; each host's state is left to
  the harnesses profile and linked.
- `wiki/topics/models-and-routing.md`: roles, providers, routes, fallback
  and accounting; links to configuration instructions and provider profiles.
- `wiki/topics/terminal.md`: chat, input, rendering, catalogue and layout.
- `wiki/topics/orchestration.md`: Dorothy's proposed orchestration and the
  separate tools coordinating her developers today.
- `wiki/topics/repository-workflow.md`: package boundaries, worktrees,
  checks, agent assets, secrets and documentation maintenance.
- `wiki/decisions.md`: decisions grouped by subject, each with context,
  alternatives, choice, reason, cost, current standing and source links.
- `wiki/questions.md`: concise answers to questions evidenced in the
  records, plus distinctions a reader needs to navigate this repository.
- `wiki/problems.md`: symptoms, cause, diagnosis, remedy or avoidance,
  resolution state and evidence for documented problems and mistakes.
- `wiki/priorities.md`: an index of the roadmap, one line a phase or
  candidate linking its roadmap heading, plus the checks blocked on the
  user. Order, dependencies and reasons stay in the roadmap alone.
- `wiki/profiles/packages.md`: all eight workspace packages, their purpose,
  boundary and authoritative package guide; important libraries where used.
- `wiki/profiles/protocols.md`: protocols appearing in the architecture and
  proposals, explaining where Dorothy uses each and its adoption state.
- `wiki/profiles/services-and-providers.md`: external systems, their role,
  integration points, limitations and whether used, proposed or compared.
- `wiki/profiles/harnesses.md`: Claude Code, Codex, OpenClaw and Hermes,
  separating persona delivery, recording, memory access and live checks;
  the one page recording each host's state.
- `wiki/records.md`: a subject catalogue of the existing dated records,
  retaining their distinction as research, specification, plan or evidence.

These are initial responsibilities, not a requirement to fill pages with
boilerplate. Split a substantial profile into its own stable page when it
improves retrieval; keep brief profiles together under named headings.

## Editorial contract

### Topics and profiles

A topic opens with what it is, what exists now, and where its code lives.
It explains the mechanism at the level needed to understand its decisions,
then links relevant decisions, questions, problems, priorities and records.
It does not repeat an implementation plan or enumerate every source file.

A profile answers what the thing is, why it appears here, how Dorothy uses
or might use it, its relevant constraints and where to read further.
Profiles cover alternatives that matter to recorded decisions, including
those considered and not adopted. They are not a general software directory.

Distinguish the current implementation, an intended design, work awaiting a
live check, a historical comparison and a superseded choice. These states
may differ for separate capabilities of the same system. A completed plan
or a newer date alone does not establish a capability as working.

### Evidence and conflicts

- Check claims about the implementation against the current code, tests and
  package guides. Cite the relevant source rather than a plan alone.
- Ground rationale in the recorded decision or report. Do not invent why a
  choice was made or infer approval from the existence of a spec.
- The roadmap remains the authority for priority. The wiki summarises and
  links it; this work does not silently reorder or schedule features.
- Surface unresolved disagreement explicitly. For example, orchestration's
  spec describes intended work, but the roadmap has no ordered phase for it
  (as of 2026-11-03; that work would add one). Its prototype is local and
  unmerged, never cited as built. The separate herdr registry is an
  unscheduled candidate.
- The roadmap and the package guides are maintained guides, not records:
  a statement the code or a later record clearly contradicts, such as the
  roadmap's evaluation "not yet run", gets a narrow correction.
- Give historical comparisons their date. A profile does not turn an old
  pricing, terms, model or availability claim into current advice. Verify
  any needed current external claim against official sources and date it.
- Link to specific source sections where useful. Contradictions resolved by
  clear code evidence may receive narrow corrections in maintained guides;
  historical records retain what they recorded at the time.

### Questions and problems

Use concrete questions and searchable symptoms as headings. Explain the
answer on the page; a list of links alone does not satisfy the wiki's purpose.
Do not label a question or fault frequent without evidence of recurrence.
That evidence is the `feedback` memories in `.agents/memory/`, the files
in `deferred/`, the repository code review and the reports' limitations.
Distinguish a resolved defect, a known limitation and a workflow pitfall.
Never describe an old workaround as necessary without checking its status.

Initial examples to investigate include limits mistaken for failed
evaluation answers, retrieval mistaken for delivery of evidence, and
provider fallback after a turn has already had effects. These are
candidates for synthesis, not findings accepted by this spec.

### Example: the memory engine decision

The memory topic states what retrieval and evidence delivery do now. Its
decision entry explains why Dorothy kept her engine: the evaluation found
an evidence-delivery failure, and the subsequent changes improved the
measured outcome. It records that the user overturned a first ruling on
preference answers, and that the judges were changed before the rerun
that kept the engine. It gives the alternative considered, the limits of
that comparison, and the condition for reconsidering a replacement.

The problems page explains how finding a conversation can still fail to
deliver the passage an answer needs. The evaluation topic explains the
metrics and corrections. Each links the relevant sections of the
[first evaluation](../reports/2026-10-31-first-evaluation.md) and
[engine report](../reports/2026-10-31-memory-engine.md), rather than
repeating their chronology or presenting an early score as the final one.

## Existing records and conventions

Keep the existing `specs/`, `plans/`, `reports/`, `notes/` and `deferred/`
paths, including supporting artifacts. The catalogue and topic links make
them discoverable. Bulk renaming and moving artifacts are outside this pass.

Update `docs/AGENTS.md` to distinguish living reference from dated records:
`README.md` and `wiki/` use stable descriptive filenames; new records retain
the existing `YYYY-MM-DD_<abbreviated-title>.md` convention. Every new page
still carries the house frontmatter, breadcrumb and 80-character lines.
Existing dated paths are retained even where their separator differs.

Add a documentation entry to the root README and correct its stale
five-package description, checking the eight-package graph against the
workspace. Keep user-facing command instructions there for this pass and
link them. Add a navigation link from the roadmap without rewriting its
priority order, and a sixth step to its Revising section: update the
wiki's priorities index and the pages the phase changed.

Root agent instructions should direct readers to the wiki and require its
affected pages to be updated when behaviour, decisions or priorities
change. Root `AGENTS.md` is at its 100-line budget (`agents.test.ts`):
fold the rule into the existing architecture rule and the pointer into
"Before you start", adding no line, rather than raising the budget.

## Maintenance

The same branch that changes a subsystem updates its affected wiki pages.
A phase's roadmap revision also updates the priorities summary. New records
join the subject catalogue; a changed decision updates the relevant entry
with its reason and source. Package guides remain the coding instructions;
the wiki explains and links them rather than duplicating their inventories.

Maintain one explanation of each subject at the appropriate depth. Elsewhere
give a short answer or summary and link it. Metadata tags use meaningful
subjects alongside `wiki`; creation time stays fixed and modification time
changes when the page does. Do not introduce a second priority queue.

## Completion checks

- Each of the user's six information needs has a visible route from home
  and substantive answers drawn from this repository.
- Every dated Markdown record at the top of the five existing record
  directories is linked from the catalogue. Nested records and artifacts
  remain reachable through their parent records; check and repair gaps.
- A test checks that every local link and heading fragment in
  `README.md` and `wiki/` resolves, and that the catalogue links every
  dated record. No existing check does: `agents.test.ts` resolves links in
  the two `AGENTS.md` files alone, remark validates none, and
  markdownlint's fragment rule stays within a file.
- Spot-check decisions, implementation claims and resolved problems against
  their sources; specifically check orchestration, host delivery, provider
  routing and corrected evaluation results.
- All eight packages are represented. Profile links lead to their relevant
  code or guides, not invented entry points or proposed packages as built.
- Run Markdown, header and em-dash checks, the existing header and workspace
  tests, and the repository's required final checks. No test or probe reads
  real user data or makes a paid model call.
- A fresh reviewer checks factual standing, navigation, source coverage and
  maintenance rules. The final report names any unresolved source conflict.

## Outside this change

No new application, generator, hosted wiki, provider integration or feature
implementation. No deletion of evidence, bulk rewriting of historical
proposals, invention of new priorities, or new research survey. The link
test above is the only new tooling.

## Builder discretion

The builder chooses section wording, source anchors, profile splits and
diagrams that clarify existing relationships. Resolve factual questions from
code and records where possible; expose uncertainty where they do not settle
it. These editorial choices do not require another design decision.
