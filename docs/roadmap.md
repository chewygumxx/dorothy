---
ctime: 2026-10-09
mtime: 2026-10-09
spdx: GPL-3.0-only
title: Roadmap
description: >-
  Dorothy's work in phases, at the level of intent: what is done, what is
  ahead and in what order, and what has been found but not scheduled.
  Revised between phases.
tags:
  - dorothy
  - roadmap
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/roadmap.md
   -
   -->

# Roadmap

Dorothy's work in phases, at the level of intent. Each phase gets its own
spec, plan and report under `docs/`; this file only orders them and says
why. It is revised between phases, so work found along the way can go
ahead of what was planned.

## Revising

After a phase merges:

1. Move it to Done, with links to its spec, plan, reports and deferred
   findings.
2. Gather candidates: its report's limitations, its file in
   `docs/deferred/`, and anything the work showed would help.
3. Ask of each candidate whether the next phase would be easier, safer or
   smaller with it done first. If so, give it a place in Ahead; if not,
   leave it in Candidates.
4. Reorder Ahead if a phase's reasons have changed, and add a line to
   Revisions saying what moved and why.

Each phase in Ahead gives its **Status**, the phases it has as
**Required**, and its **Rationale** for where it sits. It carries no dates
or estimates.

## Ahead

In order; the first is next.

### Workspace Modularity

Split `src/` into Bun workspace packages, so each subsystem declares what
it depends on, where today a `boundary.test.ts` checks its imports.

- **Status**: Pending Specification
- **Required**: Requisites Fulfilled
- **Rationale**: Maintenance would otherwise be built in `src/` and moved, and
  the Messages API move becomes the replacement of one adapter package
  rather than of imports across the tree.

### Agentic Asset Refactor

Revise Claude assets for compartmentalisation into specialised modules and
components. Generalisation of assets from `.claude/CLAUDE.md` to
`.agents/AGENTS.md` for broader compatibility with alternative models.

- **Status**: Pending Specification
- **Required**: Workspace Modularity
- **Rationale**: Context window growth and token consumption rate are far too
  high with respect to the size of this repository and projected work
  immediately foreseeable.

### Cyclical Maintenance (4a)

Dorothy revises, merges and prunes the tag vocabulary and deep-tags
conversations from their notes, in background passes that can be undone.
Its undo and log are to be revisited against memory history.

- **Status**: Design Agreed, Pending Specification
- **Required**: Workspace Modularity
- **Rationale**: A vocabulary without upkeep drifts. Memory history, now
  done, recovers from a wrong pass, and modularity lets it be built as a
  package.

### Topic Overviews (4b)

Background agents write an overview of each well-populated concept from
the conversations that carry it. Split from 4a.

- **Status**: Pending Design
- **Required**: Cyclical Maintenance
- **Rationale**: Maintenance keeps the concepts worth an overview.

### The Messages API

Move from the Agent SDK to Anthropic's Messages API, the only way to fully
control the system prompt (the `api` commit scope). Findings:
[context leak](./reports/2026-10-07-context-leak.md).

- **Status**: Pending Design
- **Required**: Workspace Modularity
- **Rationale**: Modularity keeps the SDK inside one package, and coming
  after maintenance, its calls through `StructuredCall` move with the rest.

### Token Budgets and a Gateway

One module for the budgets that shape Dorothy's context, enforced by a
proxy that every request passes through. Notes:
[budgets and a gateway](./notes/2026-10-07_budgets-gateway.md).

- **Status**: Idea
- **Required**: Requisites Fulfilled
- **Rationale**: Simpler once requests are Dorothy's own, after the
  Messages API.

### Relations and Embeddings (5)

Links between conversations and semantic search beside FTS5.

- **Status**: Conditional
- **Required**: Requisites Fulfilled
- **Rationale**: Only worth building once recall shows FTS5 falling short;
  there is no such evidence yet.

## Candidates

Found but not scheduled, each with its source.

- Sweeps of deferred findings:
  [memory history](./deferred/2026-10-08_memory-history-deferred.md),
  [tags](./deferred/2026-10-08_tags-deferred.md) and
  [compaction test gaps](./deferred/2026-10-07_compaction-test-gaps.md).
- Forgetting a conversation, which must reach history and the mirror
  (memory history spec, Later).
- Consolidating sealed bundles, and more than one mirror (memory history
  spec, Later).
- A proposer and supervisor in maintenance: a cheaper model proposes and
  Dorothy approves (the maintenance design's approach C).
- A provisional title from a cheap model, editing memory from inside the
  TUI, and memory in one-shot mode (catalogue spec, Out of scope).

## Done

In order of completion.

- **TUI chat**: [spec](./specs/2026-10-03-tui-chat-design.md),
  [plan](./plans/2026-10-03-tui-chat.md).
- **Input editor**: [spec](./specs/2026-10-03-input-editor-design.md),
  [plan](./plans/2026-10-03-input-editor.md).
- **Markdown replies**: [spec](./specs/2026-10-03-markdown-replies-design.md),
  [plan](./plans/2026-10-03-markdown-replies.md).
- ****Status** line and minimum size**:
  [spec](./specs/2026-10-05-statusline-and-minimum-size-design.md),
  [plan](./plans/2026-10-05-statusline-and-minimum-size.md).
- **Conversation catalogue (1)**:
  [spec](./specs/2026-10-05-conversation-catalogue-design.md),
  [plan](./plans/2026-10-05-conversation-catalogue.md).
- **Recall (2)**: [spec](./specs/2026-10-06-recall-design.md),
  [plan](./plans/2026-10-06-recall.md),
  [report](./reports/2026-10-06-recall.md).
- **Compaction**: [spec](./specs/2026-10-07-compaction-design.md),
  [plan](./plans/2026-10-07-compaction.md),
  [probes](./reports/2026-10-07-compaction.md),
  [report](./reports/2026-10-07-compaction-implementation.md).
- **Tags (3)**: [spec](./specs/2026-10-07-tags-design.md),
  [plan](./plans/2026-10-08-tags.md),
  [probes](./reports/2026-10-08-tags.md),
  [report](./reports/2026-10-08-tags-implementation.md).
- **Memory history**: [spec](./specs/2026-10-08-memory-history-design.md),
  [plan](./plans/2026-10-08-memory-history.md),
  [probes](./reports/2026-10-08-memory-history.md),
  [report](./reports/2026-10-08-memory-history-implementation.md); merged in
  #8 and #9.

## Revisions

- 2026-10-09: Started, with memory history done. Workspace modularity
  goes ahead of cyclical maintenance, so maintenance is built as a package
  and the Messages API move stays within one.
- 2026-10-09: Agentic Asset Refactor goes after Workspace Modularity and
  ahead of Cyclical Maintenance, as the agent's context and token use have
  outgrown the repository's size and the work ahead. Ahead's phases take
  the Status, Required and Rationale fields.
