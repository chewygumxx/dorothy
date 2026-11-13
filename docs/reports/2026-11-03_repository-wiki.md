---
ctime: 2026-11-03
mtime: 2026-11-03
spdx: GPL-3.0-only
title: Repository wiki
description: >-
  The repository wiki built: sixteen pages and a link test, the guide edits,
  the routing of the work, every ruling, each review's findings and fixes,
  the nine source conflicts, the verification and the limits left.
tags:
  - dorothy
  - docs
  - report
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/reports/2026-11-03_repository-wiki.md
   -
   -->

# Repository wiki

## Summary

[The spec](../specs/2026-11-03_repository-wiki-design.md) and
[the plan](../plans/2026-11-03_repository-wiki.md) give Dorothy a
maintained reference beside her dated records. Sixteen pages sit under
`docs/wiki/`: seven topics (memory, evaluation, identity and harnesses,
models and routing, the terminal, orchestration, repository workflow),
four profiles (packages, harnesses, protocols, services and providers),
and five pages across the subjects (records, decisions, questions,
problems, priorities). [The wiki's home](../README.md) routes each of the
user's six information needs to them. The catalogue lists every dated
record once, under its subject.

The one new tool is a test. `scripts/markdown-links.ts` parses links and
heading slugs, and `docs.test.ts` uses it to check that every local link
and heading fragment in `README.md`, `docs/README.md`, `docs/roadmap.md`
and `docs/wiki/` resolves, that the catalogue links every dated record
and that home links every page. `agents.test.ts` shares the parser.

The guides were edited to route through the wiki. The root `README.md`
now names eight packages, not five, and points to the wiki. Root
`AGENTS.md` makes a change to behaviour, decisions or priorities update
the wiki's pages in the same branch, and sends a reader to
`docs/README.md` to find a topic. `docs/AGENTS.md` names the stable,
undated filenames of the living reference and adds `wiki/` and
`README.md` to its table. The roadmap's embeddings rationale was
corrected against the first evaluation.

Reviews found and corrected errors before merge: two or three Important
findings in most tasks, host and package state stated as fact where the
records say otherwise, and five more in the whole-branch review. None
reached the branch's end uncorrected.

## Routing

The work ran as subagent-driven development, one writer on the branch at a
time. Task 1 (the link parser and its tests) and its fix ran on Codex.
Codex's shared budget then ran low, so Tasks 2 to 12 moved to Claude
subagents. Each task was reviewed by a fresh reviewer; the whole branch was
then reviewed by a more capable model and one fix wave followed, itself
re-reviewed. One Claude usage limit paused a re-review (Task 11) until its
reset; the review then resumed and came back clean.

## Rulings

Every ruling is in the order made, with its cost if wrong.

1. The merge in Task 12 Step 6 happens without asking. Root `AGENTS.md` and
   the user's standing approval allow merging one's own pull requests once
   CI passes. If wrong, a merge the user would have held; it is
   revertible.
2. Task 2 goes to a Claude subagent, not Codex. Codex's shared budget had
   fallen during Task 1, and a limit mid-catalogue would strand partial
   work. If wrong, Claude spend on a mechanical task.
3. `headingSlugs` strips `_` only as an emphasis marker flanking a word and
   keeps it in identifiers. The spec wants fragment checks that agree with
   GitHub; the plan's wording, which stripped every `_`, was the defect.
   If wrong, a rare false fragment failure.
4. Tasks 2 to 12 go to Claude subagents, Codex's shared window being nearly
   spent. If wrong, Claude spend that Codex might have covered.
5. In the decisions page the minor entries a reviewer named are cut (the
   routing-table fault, Shift+Enter, retrieval stages, host launches
   keeping their model, the own renderer) and statusline is folded with
   the minimum window. "A plan's usage limit stops a run" stays, which
   the problems page builds on. The spec keeps minor rulings in their
   reports. If wrong, a reader finds a small ruling only in its report.
6. "What comes next?" in the questions becomes a pointer to the roadmap's
   Ahead and Candidates, so the wiki holds no second queue. The host entry
   ("A host does not seem to know her") is dropped as a link-only
   duplicate of the harnesses page. Dropped from problems: the one-shot
   blank line, the reused hidden chat (moot), the growing data directory
   (a duplicate of a question) and email quoting (resolved with the Agent
   SDK gone). The streamed rate limit stays, because `failures.ts` still
   classes it as a network fault and the cooldown suffers. If wrong, a
   reader finds those only in their reports.
7. The final fix wave takes the five Important findings, Minors 1 to 6 and
   8, and the cheap Task 3 minors (the persona probe wording, memory's and
   eval's libraries). Minor 7, the parser's latent gaps, goes in this
   report as known limits with no code change. If wrong, a latent parser
   gap bites a future page and makes the test fail or pass wrongly.

## Reviews

Each task had a fresh reviewer after its implementer; a finding was fixed
by the implementer and re-reviewed in a scoped pass.

- Task 1 (link parser): `headingSlugs` stripped every `_`, but GitHub keeps
  `_` outside emphasis. Fixed under ruling 3 in one round.
- Task 2 (catalogue): no Important finding.
- Task 3 (packages, harnesses): no Important finding.
- Task 4 (protocols, services and providers): the loopback base-URL was
  attributed to a live run's stand-in when it was the Task 1 probe and the
  spec's reason is the gateway proxy; Hermes and OpenClaw were labelled
  "compared" though used as hosts. Both corrected in one round.
- Task 5 (memory, evaluation): three Important, all about host state on the
  memory page: Codex and Hermes shown as working, a blanket "probed or
  measured on real data", and the live-probe state restated. Each was
  scoped to what the delivery and evaluation reports show.
- Task 6 (identity, models, terminal): the lowest reasoning level was
  claimed for every provider kind (it is Anthropic's); one model's
  tool-call burst was generalised; and per-host build state was restated
  on the identity page. Each narrowed to its source.
- Task 7 (orchestration, workflow): "unrelated" overstated the relation
  between herdr coordination and the designed toolset, which the spec
  positions as an alternative. Reworded.
- Task 8 (decisions): the provenance entry's Reason restated its decision
  and its Context was unsourced; the backfill Choice attributed command
  and batch to the user; the resilience Context told an anticipated case
  as past. Each rewritten from its record, and minor entries cut per
  ruling 5 (39 entries remain).
- Task 9 (questions, problems): the backfill entry said the unreviewed
  count was unrecorded while the first evaluation says all 302 were
  reviewed; "What comes next?" reordered the roadmap; one entry had no
  allowed state. Resolved under ruling 6 (19 questions, 21 problems).
- Task 10 (priorities): no Important finding.
- Task 11 (guide edits): the roadmap's embeddings rationale narrowed the
  report's "Left" to the five lexical-only questions, dropping the ten of
  27 she misses, and added an unsourced conclusion. Restated from the
  report.

The whole-branch review (range from the plan's start to Task 11's end) gave
"With fixes": no Critical and five Important findings, all fixed in one
wave and re-reviewed clean (14 fixes, none open).

1. `decisions.md` said the roadmap "finds no evidence" for recall falling
   short, which the roadmap no longer says. It now says the roadmap names
   the same questions as where a hybrid would be judged.
2. Four "explained under" links landed on the records catalogue, not the
   page that explains. They point to the topic pages.
3. The repository workflow page omitted `eval` from the package graph. It
   now follows root `AGENTS.md`.
4. `protocols.md` mentioned orchestration "prototype branches", local and
   unmerged. It now says any prototype is unmerged and is not cited.
5. The four candidate memory systems (Hindsight, OpenViking, EverOS,
   Honcho) had different states on different pages. Services and
   providers and evaluation now agree: compared as engines, their
   evaluation adapters designed and not built.

The wave also fixed the eight minors: dated the Codex usage note, linked
the first orchestration note, corrected which protocol was weighed for
what, matched orchestration on herdr, noted OpenClaw's unexplained
`checked` version, split memory's lists, gave memory's and eval's
libraries and added the records rule to `docs/AGENTS.md`.

## Source conflicts

Nine places where the sources disagree, none settled by editing a record.

1. Hook for the session's block: `claude-code.json` and the contract spec
   say a SessionStart hook; the code gives the block to the gateway as a
   section. Stated in the [harnesses
   profile](../wiki/profiles/harnesses.md#claude-code), which follows the
   code.
2. Codex's payload: the delivery `probes.md` says a later task confirms
   it live; the delivery report says it waits for the user. The [harnesses
   profile](../wiki/profiles/harnesses.md#live-checks-1) follows the report.
3. Recording hosts: the roadmap says recording reads Claude Code, Codex
   and Hermes; the code needs `[recording] hosts` set, and the Hermes
   reader has never met a real session. Stated in the [memory
   page](../wiki/topics/memory.md), the identity and harnesses page and the
   harnesses profile; the code decides.
4. OpenClaw: only a profile exists, and its `checked: 2026.10.4` basis is
   not found. The [harnesses profile](../wiki/profiles/harnesses.md#openclaw)
   says so.
5. Featherless plan terms: the 2026-11-01 Anthropic-versus-OpenAI note
   says the $25 Pro plan has unlimited tokens (a third-party claim);
   three other records say $25 excludes API use. The [services and
   providers profile](../wiki/profiles/services-and-providers.md) states
   both and follows the three.
6. Spot-check completion: the first evaluation says it is pending; the
   engine rerun's 134 include "the spot-check's". The [evaluation
   page](../wiki/topics/evaluation.md) says so.
7. Statusline modules: the spec lists 8, core's `MODULE_NAMES` has 9
   (`memory-cost`). The [terminal page](../wiki/topics/terminal.md) follows
   the code. On the [models and routing
   page](../wiki/topics/models-and-routing.md) the `maintenance` role is
   parsed with no caller, and fallback after effects has never run on a
   real provider; the page rests on the spec, the invariants and two mock
   tests.
8. Orchestration: the spec says the roadmap gains an Orchestration phase,
   but it has none; a 2026-11-01 note recommended Claude Code as
   orchestrator while the spec makes Dorothy's chat the first client. The
   [orchestration page](../wiki/topics/orchestration.md) states the roadmap
   has no phase for it as of 2026-11-03 and follows the spec, the later
   record.
9. Backfill size: the recording spec's "some 970" calls against the
   roadmap's 302 sessions (revision 2026-10-21). Both are on the
   [decisions page](../wiki/decisions.md), each with its meaning.

## Verification

The completion checks of the spec, one by one.

**Information needs.** Each of the six has a route in [home](../README.md)
under Routes: topics and records, decisions, questions, problems,
priorities, profiles. Home links every one of the sixteen pages, which
`docs.test.ts` pins ("links every wiki page from home"). The answers draw
on code and records, and each task's reviewer checked them against their
sources.

**Dated records catalogued.**

```sh
ls docs/{specs,plans,reports,notes,deferred}/[0-9]*.md | wc -l
grep -oE '\]\(\.\./(specs|plans|reports|notes|deferred)/[0-9][^)#]*\.md' \
    docs/wiki/records.md | sort -u | wc -l
```

```text
106
106
```

Both counts are 106, the report included (105 before it). Nested records
and artifacts stay reachable through their parent records.

**Link test.** It covers every link and fragment in the wiki, the catalogue
and home.

```sh
bun test docs.test.ts
```

```text
bun test v1.4.2 (744846f84)
 4 pass
 0 fail
 4 expect() calls
Ran 4 tests across 1 file. [43.00ms]
```

**Spot-checks** of orchestration, host delivery, provider routing and the
evaluation's figures were made by each task's reviewer against the code and
records. They found the errors in Reviews above, and the nine source
conflicts record what the sources leave open. The final reviewer
re-checked factual standing, navigation, source coverage and maintenance
rules.

**Eight packages.** The [packages profile](../wiki/profiles/packages.md)
has a section for each of `agent`, `cli`, `core`, `eval`, `gateway`,
`identity`, `memory` and `tui`, and no proposed package is shown as built.

**Markdown, header, em dash, tests.** All run in the repository's check.
The last lines of its output:

```sh
bun run check
```

```text
    Files unreadable: 0, Skipped: 4
$ bun test
bun test v1.4.2 (744846f84)

 3988 pass
 5 skip
 0 fail
 143935 expect() calls
Ran 3993 tests across 195 files. [46.01s]
```

Exit code: 0. The check reads no user data and calls no paid model.

**Guide budgets.**

```sh
wc -l AGENTS.md docs/AGENTS.md
```

```text
 100 AGENTS.md
  57 docs/AGENTS.md
 157 total
```

Root `AGENTS.md` is at its 100-line budget, which `agents.test.ts` pins.

## Known limits

The link parser (`scripts/markdown-links.ts`) has latent gaps that no
current page hits. A future page that does could pass or fail wrongly.

- Parsing: code spans wrapped across lines, fences indented inside list
  items, and links inside HTML comments are not handled. Frontmatter and
  HTML comments are not skipped by `headingSlugs` or `links`, headings
  inside blockquotes or lists, reference links and HTML tags in headings
  are not handled, an empty `<>` destination gives an empty path, and a
  code span inside emphasis keeps its `_`.
- Coverage: no fragment check runs on the two `AGENTS.md` files, a
  duplicate catalogue entry goes unnoticed, and the parser's tests lack a
  `~~~` fence, a reference definition with a fragment, a `-2` suffix, a
  heading with a link, Unicode and closing `#`s. `resolveLink` has no
  unit case for a leading `/` or a percent escape, and does not strip a
  `?query`.

Minors left unfixed, by kind:

- Catalogue: model-providers routing sits before runtime in the same-day
  order; entry kinds read Report and Deferred where the spec says
  evidence.
- Sources and wording: the legend of states lacks superseded, ruled out
  and untested; four memory systems the roadmap names as adapters are
  arguably proposed; the A2A "approved on" date is the proposal's closing
  date; the rulesync ruling omits the user's take-confirmations-as-given;
  on the memory page the `cut` mark is for the evaluation and is not shown
  to the model, the noise bullet lacks "under the earlier judges", and
  "changed in between" and the `DISABLE_COMPACT` wording are awkward; on
  the orchestration page "keeps long jobs" overstates a cost-if-wrong cell
  as a ruling.
- Scope: the workflow page's boundaries omit eval and the `--no-cd`
  subagent worktree pointer; mechanism detail repeats in the renderer,
  statusline and delivery entries where topic pages are the home; several
  question answers re-explain topic pages and could shrink to a sentence
  and a link; the exit-75 and declined entries read as resolved plus a
  remaining limitation; Memory Status dropped its "record" link and the
  OpenClaw install is not listed under Blocked.
