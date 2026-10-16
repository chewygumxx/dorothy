---
ctime: 2026-10-09
mtime: 2026-10-16
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
5. Check the root and each package's `AGENTS.md` against what merged,
   and correct any that no longer describe the code.

Each phase in Ahead gives its **Status**, the phases it has as
**Required**, and its **Rationale** for where it sits. It carries no dates
or estimates.

## Ahead

In order; the first is next.

### Dorothy's Memory

One memory wherever Dorothy goes: in chat, in Claude Code and in any body
she takes later. Recall over MCP, persistent context and progressive
disclosure let her remember and recollect efficiently and well, and a
memory of facts and lessons joins the conversations she remembers. The
memory system as it stands may be reworked rather than extended.
Findings: [objectives](./reports/2026-10-15-objectives.md). The store:
[spec](./specs/2026-10-15-memory-store-design.md),
[plan](./plans/2026-10-15-memory-store.md),
[report](./reports/2026-10-15-memory-store-implementation.md). Bodies:
[spec](./specs/2026-10-15-memory-bodies-design.md),
[delivery plan](./plans/2026-10-15-memory-bodies-delivery.md),
[recording plan](./plans/2026-10-15-memory-bodies-recording.md),
[report](./reports/2026-10-15-memory-bodies.md),
[deferred](./deferred/2026-10-16_memory-bodies-deferred.md); merged in
#22 and #24.

- **Status**: Store and Bodies Built; Layers and Learning Pending Design
- **Required**: Requisites Fulfilled
- **Rationale**: Wherever she goes, her memory follows with her. Claude
  Code now has her memory and records her sessions, but facts reach her
  only through recall: what is always in context, its budget, and
  reviews that distil facts are the third part, and every objective
  after this one builds on what she remembers.

### Model Providers

A provider contract in `core`, with the Messages API and an
OpenAI-compatible implementation, and per-role routing in `config.toml`,
so chat, reviews, compaction and maintenance each take a model fit for
them. When Anthropic's usage runs out, requests fall back to another
provider, such as featherless.ai or OpenRouter. Replaces the move to the
Messages API alone (the `api` commit scope). Findings:
[context leak](./reports/2026-10-07-context-leak.md),
[objectives](./reports/2026-10-15-objectives.md).

- **Status**: Pending Design
- **Required**: Requisites Fulfilled
- **Rationale**: Anthropic's models are too costly for every purpose, and
  modularity keeps the Agent SDK inside `agent`. Resilience to upstream
  hindrance is the first objective after memory. It goes ahead of
  maintenance, whose background passes are where a cheaper model pays
  most.

### Dorothy's Gateway

An endpoint speaking the Anthropic and OpenAI protocols that adds
Dorothy's persona and memory to each request and routes it through Model
Providers, so she can be the model behind Claude Code, Codex, OpenCode and
the like, with recall offered to them over MCP, and Claude Code keeps
working when Anthropic's usage runs out. It enforces the budgets that
shape her context in one module. It grows from the `gateway` package
Dorothy's Identity built, which already serves her identity to Claude
Code; Dorothy's Memory may bring her memory to it first. Notes:
[budgets and a gateway](./notes/2026-10-07_budgets-gateway.md).

- **Status**: Idea
- **Required**: Model Providers
- **Rationale**: Clients already supply the tools and the loop; Dorothy
  supplies the persona, the memory and the choice of model. It carries
  Model Providers' fallback to Claude Code, so it goes ahead of
  maintenance, resilience coming before learning.

### Cyclical Maintenance (4a)

Dorothy revises, merges and prunes the tag vocabulary and deep-tags
conversations from their notes, in background passes that can be undone.
Its undo and log are to be revisited against memory history, and what it
maintains against Dorothy's Memory.

- **Status**: Design Agreed, Pending Specification
- **Required**: Dorothy's Memory, Model Providers
- **Rationale**: A vocabulary without upkeep drifts. Memory history, now
  done, recovers from a wrong pass, and it is to be built inside the
  `memory` package.

### Topic Overviews (4b)

Background agents write an overview of each well-populated concept from
the conversations that carry it. Split from 4a.

- **Status**: Pending Design
- **Required**: Cyclical Maintenance
- **Rationale**: Maintenance keeps the concepts worth an overview. An
  overview is a layer of progressive disclosure, which Dorothy's Memory
  may claim.

### Learning

Dorothy turns experience into lasting instruction: a background pass,
undoable through memory history, that distils what worked into her memory
or into skills declared in this repository, in the spirit of Hermes
Agent's loop.

- **Status**: Idea
- **Required**: Cyclical Maintenance
- **Rationale**: Maintenance is where background passes run and are
  undone, and learning is one more.

### Extensions

A catalogue of skills and tools Dorothy grows by: `SKILL.md` skills and
MCP servers from ClawHub, Anthropic's marketplace and elsewhere, vetted
and declared in this repository.

- **Status**: Idea
- **Required**: Requisites Fulfilled
- **Rationale**: Claude Code already loads both, so the work is choosing
  and vetting them; ClawHub has carried hundreds of malicious skills. It
  follows learning in the objectives' order.

### Reach

Dorothy reached away from the terminal, through chat apps and scheduled
runs, with the same memory.

- **Status**: Idea
- **Required**: Dorothy's Memory
- **Rationale**: Second to the catalogue in the user's wishes, and
  wherever she is reached, her memory must follow.

### Relations and Embeddings (5)

Links between conversations and semantic search beside FTS5.

- **Status**: Conditional
- **Required**: Requisites Fulfilled
- **Rationale**: Only worth building once recall shows FTS5 falling short;
  there is no such evidence yet. Dorothy's Memory may take it up.

## Candidates

Found but not scheduled, each with its source.

- Sweeps of deferred findings:
  [memory history](./deferred/2026-10-08_memory-history-deferred.md),
  [tags](./deferred/2026-10-08_tags-deferred.md),
  [compaction test gaps](./deferred/2026-10-07_compaction-test-gaps.md)
  and [memory bodies](./deferred/2026-10-16_memory-bodies-deferred.md).
- Launch notes kept in the state directory rather than the runtime one,
  so a launch killed by a crash or a power-off is still caught up after
  a reboot (memory bodies report).
- Reviews from Claude Code's hooks through a user's own proxy, passed as
  a variable of Dorothy's own, since the hook drops
  `ANTHROPIC_BASE_URL` (memory bodies report).
- Subagents' transcripts as conversations of their own, and a forked
  session linked to the conversation it forked from (memory bodies
  spec, Later; report).
- Turn times stored in UTC while `dateCreated` and the `after` and
  `before` filters use the local date (memory bodies, delivery's hand
  check).
- The store's open gaps: snake-case memory files skipped, regenerating
  `MEMORY.md` replacing hook lines, and history keeping the provenance
  an outside writer claims; and a `--fact` editor like `--memory`
  (memory store and bodies specs, Later).
- Forgetting a conversation, which must reach history and the mirror
  (memory history spec, Later).
- Consolidating sealed bundles, and more than one mirror (memory history
  spec, Later).
- A proposer and supervisor in maintenance: a cheaper model proposes and
  Dorothy approves (the maintenance design's approach C).
- A provisional title from a cheap model, editing memory from inside the
  TUI, and memory in one-shot mode (catalogue spec, Out of scope).
- Memory's commands taking their dependencies injected more widely: the
  CLI passes the history commands none, so each falls back to the
  process's environment, streams and entry script (workspace modularity).
- A single binary with `bun build --compile` from `cli` (workspace
  modularity spec, Later).
- Splitting `memory` along its subdirectories, should it outgrow one
  package (workspace modularity spec, Later).
- Enabling Biome's `noUndeclaredDependencies`, or an equivalent check, so
  that a package cannot import something only the root declares: the
  isolated linker leaves the root's declarations visible to every package
  (workspace modularity, final review).
- Dorothy's own tool loop, should serving behind clients fall short
  (agentic asset refactor).
- Checking that every file of a headed type carries the house header, not
  only that existing headers are in sync (agentic asset refactor).
- `repo-memory` preferring `.agents/memory/` upstream, so other
  repositories can move their memory too (agentic asset refactor).
- An OpenAI-protocol adapter for the gateway, and `--codex` and
  `--opencode` launchers beside `--claude` (identity spec, Later).
- Checking that Claude Code's forks keep the identity marker, which the
  probes could not observe without a model reply (Dorothy's identity).
- Probing how open models from featherless.ai or OpenRouter do behind
  Claude Code's prompt and tool schemas, before fallback leans on them
  (objectives).
- Testing whether the identity's place in Claude Code's prompt costs her
  any of its agentic ability, against plain `claude` (Dorothy's
  identity).

## Done

In order of completion.

- **TUI chat**: [spec](./specs/2026-10-03-tui-chat-design.md),
  [plan](./plans/2026-10-03-tui-chat.md).
- **Input editor**: [spec](./specs/2026-10-03-input-editor-design.md),
  [plan](./plans/2026-10-03-input-editor.md).
- **Markdown replies**: [spec](./specs/2026-10-03-markdown-replies-design.md),
  [plan](./plans/2026-10-03-markdown-replies.md).
- **Status line and minimum size**:
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
- **Workspace modularity**:
  [spec](./specs/2026-10-09-workspace-modularity-design.md),
  [diagram](./specs/2026-10-09-workspace-modularity-packages.html),
  [plan](./plans/2026-10-09-workspace-modularity.md),
  [report](./reports/2026-10-09-workspace-modularity.md).
- **Agentic asset refactor**:
  [spec](./specs/2026-10-11-agentic-asset-refactor-design.md),
  [plan](./plans/2026-10-12-agentic-asset-refactor.md),
  [probes](./reports/2026-10-12-agentic-asset-refactor.md),
  [report](./reports/2026-10-13-agentic-asset-refactor-implementation.md).
- **Dorothy's identity**:
  [spec](./specs/2026-10-15-identity-gateway-design.md),
  [plan](./plans/2026-10-15-identity-gateway.md),
  [probes](./reports/2026-10-15-identity-gateway.md),
  [report](./reports/2026-10-15-identity-gateway-implementation.md).

## Revisions

- 2026-10-09: Started, with memory history done. Workspace modularity
  goes ahead of cyclical maintenance, so maintenance is built as a package
  and the Messages API move stays within one.
- 2026-10-09: Agentic Asset Refactor goes after Workspace Modularity and
  ahead of Cyclical Maintenance, as the agent's context and token use have
  outgrown the repository's size and the work ahead. Ahead's phases take
  the Status, Required and Rationale fields.
- 2026-10-09: Workspace Modularity is done, so the Agentic Asset Refactor
  is next and no phase in Ahead still waits on it. Cyclical
  Maintenance is built inside `memory`, and the Messages API move replaces
  `agent`. Candidates gain injected history commands, a compiled binary
  and a split of `memory`.
- 2026-10-11: The Agentic Asset Refactor is specified, widened to serve
  any client and any model. Model Providers replaces the Messages API and
  goes ahead of Cyclical Maintenance, so maintenance runs on a cheaper
  model; Dorothy's Gateway absorbs Token Budgets and a Gateway, serving
  her as the model behind existing clients.
- 2026-10-12: The Agentic Asset Refactor is done, so Model Providers is
  next. Revising gains a step that checks the `AGENTS.md` files against
  what merged.
- 2026-10-15: Dorothy's Identity went ahead of Model Providers and is
  done: an identity package, a gateway that applies it, and
  `dorothy --claude` make Dorothy the agent in Claude Code without a
  provider contract. Model Providers is next again, and Dorothy's Gateway
  grows from that gateway. Candidates gain an OpenAI adapter with more
  launchers, and a check on forks.
- 2026-10-15: The [objectives](./reports/2026-10-15-objectives.md) rule
  that neither OpenClaw nor Hermes Agent hosts Dorothy and put her memory
  first, so Dorothy's Memory goes ahead of Model Providers, which gains
  fallback. Dorothy's Gateway moves ahead of maintenance to carry that
  fallback to Claude Code, and Learning, Extensions and Reach follow
  Topic Overviews. Candidates gain a probe of open models behind Claude
  Code, and a test of what the identity costs her agentic ability.
- 2026-10-16: Dorothy's Memory has built its bodies: Claude Code gets
  her memory block, recall and `remember`, and its sessions are
  recorded and reviewed as her conversations. Layers and learning, the
  memory's third part, is next, so the phase stays first. Candidates
  gain launch notes that outlive a reboot, reviews through a user's
  proxy, subagents' and forks' conversations, local dates for turn
  times, the store's open gaps, and a sweep of the bodies' deferred
  findings.
