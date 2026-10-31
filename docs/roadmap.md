---
ctime: 2026-10-09
mtime: 2026-11-01
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

One memory wherever Dorothy goes: in her chat, in Claude Code and in
every harness she is generated into, as she is protocol diverse
([minutes](./reports/2026-10-18-protocol-diversity.md)). Recall over MCP,
persistent context and progressive disclosure let her remember and
recollect efficiently and well, and a memory of knowledge joins the
conversations she remembers. It is judged by compatibility, then access,
then progressive disclosure, then persistence, and may be reworked
rather than extended. Findings:
[objectives](./reports/2026-10-15-objectives.md),
[open-source replacements](./notes/2026-10-18_open-source-replacements.md).
The store: [spec](./specs/2026-10-15-memory-store-design.md),
[plan](./plans/2026-10-15-memory-store.md),
[report](./reports/2026-10-15-memory-store-implementation.md). Bodies:
[spec](./specs/2026-10-15-memory-bodies-design.md),
[delivery plan](./plans/2026-10-15-memory-bodies-delivery.md),
[recording plan](./plans/2026-10-15-memory-bodies-recording.md),
[report](./reports/2026-10-15-memory-bodies.md),
[deferred](./deferred/2026-10-16_memory-bodies-deferred.md); merged in #22
and #24. The contract:
[spec](./specs/2026-10-18-memory-contract-design.md),
[plan](./plans/2026-10-18-memory-contract.md),
[report](./reports/2026-10-18-memory-contract.md), with its deferred
findings; merged in #69. The evaluation:
[spec](./specs/2026-10-18-memory-evaluation-design.md),
[plan](./plans/2026-10-18-memory-evaluation.md),
[report](./reports/2026-10-18-memory-evaluation.md), whose deferred
findings were all addressed; merged in #71 and #72. The roadmap sweep:
[spec](./specs/2026-10-19-roadmap-sweep-design.md),
[plan](./plans/2026-10-19-roadmap-sweep.md),
[report](./reports/2026-10-19-roadmap-sweep.md), including the
[repository code review](./reports/2026-10-19-code-review.md). Recording:
[spec](./specs/2026-10-20-recording-design.md),
[plan](./plans/2026-10-20-recording.md),
[report](./reports/2026-10-20-recording.md). The engine's first step:
[spec](./specs/2026-10-31-memory-engine-design.md),
[plan](./plans/2026-10-31-memory-engine.md),
[report](./reports/2026-10-31-memory-engine.md).

The contract opened four more pieces, each with its own spec: the
evaluation, which measures her memory against the field and chooses the
engine; recording each harness's sessions; the engine; and delivery into
the harnesses chosen. The evaluation is built as `@dorothy/eval` but not
yet run: the owner generates and reviews its questions, then runs her
memory beside the lexical baseline and full context, with models named
in `eval.toml`. Recording is built too: her service sweeps the sessions
of Claude Code, Codex and Hermes, and `dorothy --sweep --backfill`
records what they already hold, with a durable mark preventing a review
apiece until a live append.

The harnesses she is provided for and tested against are Claude Code,
Codex, OpenClaw and Hermes Agent, as the user chose. Claude Code is
recorded already; Codex offers hooks and its rollout files, and
OpenClaw and Hermes a memory plugin each, in a slot that takes one
provider, as the contract's host profiles record. Recording reads the
sessions of Claude Code, Codex and Hermes; OpenClaw's waits for its
install. The delivery spec settles how her persona reaches each
(generated files, the proxy or both).
Existing tools, such as rulesync, are researched before anything
bespoke is built: research on
[cross-harness](./reports/2026-10-18-protocol-diversity/cross-harness.md)
tooling names rulesync, Hindsight's adapters and Letta's transcript
parser.

The sweep closed the two safety pieces before delivery: unconfirmed
knowledge is fenced and marked throughout recall, with `--verify` for
the user, and the service clamps its block to each host's budget. It
also closed the actionable deferred findings and code-review defects,
then ran the six live probes. The report carries the remaining limits.
Recording's final fixes close the backfill cost and reread defects; a
full-scale dry run on copies of the user's sessions (2026-10-21)
verified them before the user's backfill, then the owner's first run.

- **Status**: Store, Bodies, Contract, Evaluation and Recording Built;
  the Backfill Recorded and Reviewed; the First Run Done
  ([record](./reports/2026-10-31-first-evaluation.md)); the Engine's
  First Step Built and its Paid Runs Done, keeping her engine;
  Delivery Next, Pending Design
- **Required**: Requisites Fulfilled
- **Rationale**: Wherever she goes, her memory follows with her. The
  contract gives every harness one service and every engine one
  interface, and the evaluation now measures her memory on the user's
  own sessions: 315 conversations, 133 questions drafted by the plans'
  strongest models and pre-screened crosswise by agents. Reviewing the
  backfill raised her recall at 10 from 9.6% to 46.4%, past lexical
  search on questions across sessions, but her strict accuracy only
  from 4.0% to 7.3%: she finds the conversation and answers from its
  notes, not the passage that holds the fact, while lexical search,
  returning passages, scores 25%. The engine's first step found her
  knowledge crowding out the passages she found, and delivers them now:
  evidence for 98 of 125 questions, from 9. Its paid runs, judged
  again once the judges were told her answers are remembered, took her
  strict accuracy from 7 to 43 of 125, past lexical search's 27, with
  half her preference answers right and every abstention kept, so her
  engine stays and Delivery, the last piece, is next; a chunk index
  waits on the questions only lexical search passes.

### Model Providers

A provider contract in `core`, with the Messages API and an
OpenAI-compatible implementation, and per-role routing in `config.toml`,
so chat, reviews, compaction and maintenance each take a model fit for
them. When Anthropic's usage runs out, requests fall back to another
provider, such as featherless.ai or OpenRouter. Replaces the move to the
Messages API alone (the `api` commit scope). Its design settles what
the protocol diversity minutes left open: whether Dorothy keeps a
runtime of her own for chat, reviews and compaction, and on what, such
as LangChain.js, whose middleware covers fallback. The evaluation
already reaches any OpenAI-compatible model through LangChain's
`ChatOpenAI`, a client per role. Findings:
[context leak](./reports/2026-10-07-context-leak.md),
[objectives](./reports/2026-10-15-objectives.md),
[LangChain](./reports/2026-10-18-protocol-diversity/langchain-and-standards.md).

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
maintains against Dorothy's Memory, whose engine is to consolidate
knowledge. The design agreed so far is in
[agent memory](../.agents/memory/maintenance-design-agreed.md).

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
  there is no such evidence yet, and the evaluation's first run is where
  it would show. Dorothy's Memory may take it up, as an engine with
  embeddings would.

## Candidates

Found but not scheduled, each with its source.

- The sweep's remaining deferred minors and limits
  ([record](./reports/2026-10-19-roadmap-sweep.md#deferred)), including
  bridge timer cleanup, failure diagnostics, transcript-cache
  assumptions, catalogue snapshot visibility and recovery edge cases.
- Recording's deferred minors and limits
  ([record](./reports/2026-10-20-recording.md#deferred)): mixed swept and
  unswept Hermes merges, parent holdings, wrapper markers, fingerprint
  UPDATE blindness and legacy UID ambiguity; a capped review of
  backfilled sessions remains later work.
- The evaluation's later systems and checks: adapters for Hindsight,
  OpenViking, EverOS, Honcho and an improved Dorothy; an agentic mode
  driving the MCP tools; LongMemEval-S as a public anchor; a corrected
  memory surviving a re-ingest, and two clients writing while a second
  machine reads; and a second ingest model (memory evaluation spec,
  Later).
- The contract's later work: her commands writing through the service;
  OKF's `index.md` and `log.md` for `knowledge/`; encryption at rest;
  `superseded_by`; a project without an `origin` being one across machines;
  and a user beyond one (memory contract spec, Later and Known risks).
- Subagents' transcripts as conversations of their own, and a forked
  session linked to the conversation it forked from (memory bodies
  spec, Later; report).
- OpenClaw's reader, once it is installed and probed (recording spec,
  Later; report). Hermes's reader has met no real session yet, only its
  source's schema.
- The recording's remaining rough edges: a branch the user rewinds from
  stays, and a session's plain `claude` turns are recorded as hers once
  it is resumed in her launch (memory bodies report).
- The store's remaining gaps: a `--fact` editor like `--memory`, retired
  facts and sync records kept indefinitely, repository-wins conflicts,
  stale checkouts and the scrubber's shape-based limits (the store's
  report and the sweep's retained-behaviour record).
- Forgetting a conversation, which must reach history and the mirror
  (memory history spec, Later).
- Consolidating sealed bundles, and more than one mirror (memory history
  spec, Later).
- History grows without bound; pruning needs its own design (memory
  history spec, Known limitations).
- Compaction's remaining limits: the seed's size estimated rather than
  measured, a launch waiting behind another TUI's claim, a `/compact`
  command, edited abstracts and regrouped clusters (compaction report
  and spec).
- The catalogue's and recall's remaining limits: a review can cost more
  than the turn it follows, a hidden conversation may still be named in
  others' notes, and corrupt-index recovery cannot proceed without
  sole-holder proof, including a TUI with its recall server open
  (catalogue spec and sweep report).
- The vocabulary's limits, for maintenance to weigh: labels compare
  without case, deleted concepts' tombstones accumulate, a recap chat is
  tagged with the topics it recalls, and a renamed concept's old label
  may be coined again (tags spec and report).
- A proposer and supervisor in maintenance: a cheaper model proposes and
  Dorothy approves (the maintenance design's approach C).
- A provisional title from a cheap model, editing memory from inside the
  TUI, and memory in one-shot mode (catalogue spec, Out of scope).
- Memory's commands keeping no process defaults of their own: the CLI
  now passes the history commands' environment, streams and entry
  script, but memory still falls back to the process's (workspace
  modularity; the sweep's record, Deferred).
- A single binary with `bun build --compile` from `cli` (workspace
  modularity spec, Later).
- Splitting `memory` along its subdirectories, should it outgrow one
  package (workspace modularity spec, Later).
- The TUI's deferred features: undo, rendering while streaming, OSC 8
  links, a theme, and configuration reloaded live (TUI chat, input
  editor, Markdown replies and status line specs, Out of scope).
- Dorothy's own tool loop, should serving behind clients fall short
  (agentic asset refactor).
- `repo-memory` preferring `.agents/memory/` upstream, so other
  repositories can move their memory too (agentic asset refactor).
- An OpenAI-protocol adapter for the gateway, and a `--codex` launcher
  beside `--claude`, which delivery to Codex may call for; `--opencode`
  waits, as OpenCode is not a target (identity spec, Later).
- Probing how open models from featherless.ai or OpenRouter do behind
  Claude Code's prompt and tool schemas, before fallback leans on them
  (objectives).
- Testing whether the identity's place in Claude Code's prompt costs her
  any of its agentic ability, against plain `claude` (Dorothy's
  identity).
- The engine's deferred minors
  ([record](./reports/2026-10-31-memory-engine.md#deferred)): early
  variant errors untested, an undefined policy field, untraced source
  errors, and the first evaluation's Summary beside its corrections.
- The evaluation's answering prompt asks for one or two sentences,
  which may cost answers a fact the reference holds, such as AEST's
  `+10:00` beside AEDT's `+11:00` on preference questions
  ([record](./reports/2026-10-31-memory-engine.md#the-decision)).
- The consolidation's deferred minors
  ([record](./reports/2026-10-31-agentic-asset-consolidation.md#deferred)):
  brittle test fakes and waits, stale rendered drafts, unvalidated
  script inputs, and references restating their skill's rules.
- Message provenance between agents: text one agent sends another
  through herdr arrives as if typed by the user, so a recipient cannot
  tell a peer's request, or the user's own scheduled message, from the
  user. To be settled later, by A2A, Agent Delegation Receipts or both
  (the user, 2026-10-31).

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
- **Agentic asset consolidation**:
  [spec](./specs/2026-10-31-agentic-asset-consolidation-design.md),
  [plan](./plans/2026-10-31-agentic-asset-consolidation.md),
  [report](./reports/2026-10-31-agentic-asset-consolidation.md).

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
- 2026-10-18: Dorothy is ruled protocol diverse, with no one harness
  hosting her and pi not used, and her memory is designed before the
  harnesses to target are chosen. Dorothy's Memory has built its
  contract, which takes the place of layers and learning: one service,
  four MCP tools, a hook API and knowledge as OKF files. The evaluation
  is next within the phase, ahead of recording, the engine and delivery.
  Candidates gain the contract's deferred findings and the service's
  loose ends.
- 2026-10-19: Dorothy's Memory has built its evaluation, `@dorothy/eval`,
  with every finding it deferred addressed. Its first run, by the owner,
  is next within the phase, and the engine follows on its numbers.
  Candidates gain the evaluation's later systems and checks, and the
  unlogged tool failure the contract's final review left.
- 2026-10-19: The choice of harnesses, which the protocol diversity
  minutes deferred until memory was designed, joins the first run as
  next, with its open questions; recording and delivery both follow it,
  as recording is of the harnesses chosen.
- 2026-10-19: A sweep of every spec's and report's later work, known
  limits and open questions against Candidates. Model Providers gains
  the question of her own runtime, maintenance a link to its agreed
  design, and Relations and Embeddings the evaluation as its evidence.
  Candidates gain knowledge told apart by its source before it reaches
  the block, the contract's later work, and the limits of recording,
  the store, history, compaction, recall, the vocabulary, the TUI, the
  asset refactor and the identity.
- 2026-10-19: The user chose the harnesses: Claude Code, Codex, OpenClaw
  and Hermes Agent. Recording for them goes beside the first run, and
  delivery follows the engine. Each candidate was asked whether it
  makes the next pieces safer done first: knowledge told apart by its
  source and the service's loose ends move out of Candidates to go
  before delivery. Turn times in UTC stay, as the evaluation reads every
  date in UTC alike, and `--opencode` waits.
- 2026-10-20: The roadmap sweep closed the knowledge fence and service
  safety work before delivery, the actionable deferred findings and all
  22 code-review findings, and completed the six live probes. Candidates
  lose the closed work and keep the sweep's deferred minors and design
  limits. The owner's evaluation run and recording for Codex, OpenClaw
  and Hermes remain next; the engine and delivery still follow them.
- 2026-10-20: A first retrieval run found her archive too small to
  measure: 10 conversations, against some 970 Claude Code sessions she
  never recorded. Recording, with a backfill of existing sessions, moves
  ahead of the first run.
- 2026-10-20: Recording is built: readers for Codex and Hermes, a sweep
  of their stores and Claude Code's, `dorothy --sweep --backfill`, and a
  probe on 27 copied sessions. Dorothy's Memory goes on with the user's
  backfill of the real sessions, then the first run on questions
  generated and reviewed, as mining finds none in backfilled sessions;
  the engine and delivery follow. Candidates gain OpenClaw's reader.
- 2026-10-21: A dry run of the user's backfill and first run's steps on
  copies of all their sessions passed: 302 Claude Code sessions, not
  some 970, as the rest are subagents' transcripts, and 7 Codex. A plain
  sweep after a backfill no longer counts its sessions as waiting.
- 2026-10-21: Dorothy's secrets move from dotenvx, whose key the paid
  Dotenvx Armor held, to `secrets.json`, encrypted by sops to an age
  key outside the checkout; dotenvx is removed.
- 2026-10-29: The evaluation's roles may call models through the user's
  Claude and ChatGPT plans, before any API, and record their tokens. A
  bake-off of six generators found most knowledge-update drafts carried
  no earlier claim; the checks are to drop such drafts.
- 2026-10-29: `dorothy --review-backfill` reviews backfilled
  conversations in batches on the reviewer's model; the first batch of
  three on the real store gave each a title, abstract and tags.
- 2026-10-30: A plan's usage limit stops an evaluation run for
  `--resume` rather than scoring misses; review shows fuller evidence
  and applies agents' decisions; the status line keeps Claude's budget
  where an agent can read it.
- 2026-10-31: The evaluation's first run is done, before and after the
  backfill's review: reviews raise Dorothy's retrieval fivefold, but she
  answers from notes, not passages. The engine's spec is next.
- 2026-10-31: Agentic Asset Consolidation goes ahead of the engine's
  spec, taking three candidates: context stewardship, procedures as
  skills and the evaluation's scripts, as the engine's work leans on
  the same dispatch and budgets. Message provenance stays a candidate.
- 2026-10-31: Agentic Asset Consolidation is done: two skills of the
  repository's own hold the agents' procedures, with scripts for
  messages, wake-ups, long jobs, accounts and retries, and `eval` and
  `dorothy` gained the options the first run's scratch scripts stood in
  for. The engine's spec is next again. Candidates gain its deferred
  minors.
- 2026-10-31: The engine's first step is built: one delivery step,
  shared by recall and the evaluation, gives passages; hits carry their
  turns and alternate with knowledge. Retrieval alone delivers evidence
  for 98 of 125 questions, from 9, past lexical search's 69. Its paid
  runs, which decide between her engine and a chunk index, are next,
  then Delivery. Candidates gain its deferred minors.
- 2026-10-31: The engine's paid runs are done: at her defaults Dorothy
  passes 40 of 124 questions strictly, past lexical search's 31, so her
  engine stays and Delivery is next. Candidates gain knowledge placement
  for preferences.
- 2026-11-01: The user found the paid runs' 2 of 9 preference answers
  inadequate, which overturned the ruling above. Probes put most of the
  failures on the strict judge, which never sees her memory; told her
  answers are remembered, the judges' rerun has her at 43 of 125 against
  lexical search's 27, and 5 of 10 preferences. Her engine stays and
  Delivery is next. Knowledge placement, which the probes ruled out,
  leaves Candidates; the answering prompt's length joins them.
