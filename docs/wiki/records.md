---
ctime: 2026-11-03
mtime: 2026-11-03
spdx: GPL-3.0-only
title: Records
description: >-
  Every dated record of Dorothy's development, by subject and oldest first,
  with what kind of record each is.
tags:
  - wiki
  - records
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/wiki/records.md
   -
   -->

# Records

[Wiki home](../README.md)

The records are the evidence behind the wiki. Research kept for reference
is in `notes/`, the design a change was to follow in `specs/`, the strategy
for carrying it out in `plans/`, the probes, rulings and verification of
having done so in `reports/`, and findings left for later in `deferred/`.
Each is dated and never rewritten, so a record may describe what has since
changed.

Every record is listed once, under the subject it mainly serves and oldest
first.

## Memory

- [Conversation with Dorothy on memory
  metadata](../notes/2026-10-04_dorothy-conversation-memory-metadata.md):
  Research. A chat that prompted per-conversation metadata, its triggers and
  tiered decay.
- [ChatGPT on memory
  metadata](../notes/2026-10-05_chatgpt-conversation-memory-metadata.md):
  Research. A survey of TypeScript modules close to the conversation memory
  design.
- [Claude on memory
  metadata](../notes/2026-10-05_claude-conversation-memory-metadata.md):
  Research. The same survey from Claude, and what was left to build.
- [Conversation catalogue
  design](../specs/2026-10-05-conversation-catalogue-design.md): Specification.
  Dorothy's first memory: a note for each conversation.
- [Conversation catalogue plan](../plans/2026-10-05-conversation-catalogue.md):
  Plan. How the per-conversation notes were to be built.
- [Recall design](../specs/2026-10-06-recall-design.md): Specification.
  Dorothy's second memory: looking up and opening past conversations.
- [Recall plan](../plans/2026-10-06-recall.md): Plan. Task by task, searching
  and opening past conversations.
- [Recall report](../reports/2026-10-06-recall.md): Report. How recall was
  built, its deviations from the spec and review findings.
- [Token budgets and a gateway](../notes/2026-10-07_budgets-gateway.md):
  Research. An idea from the compaction work: one budget module, enforced by a
  proxy.
- [Compaction design](../specs/2026-10-07-compaction-design.md): Specification.
  Compacting a long conversation into clusters.
- [Tags design](../specs/2026-10-07-tags-design.md): Specification. A tag
  vocabulary and shallow tagging of conversations.
- [Compaction plan](../plans/2026-10-07-compaction.md): Plan. Task by task,
  compacting a long conversation into clusters.
- [Compaction probes](../reports/2026-10-07-compaction.md): Report. Live checks
  that the CLI's own compaction stays off and Dorothy's works.
- [Compaction implementation
  report](../reports/2026-10-07-compaction-implementation.md): Report. How
  compaction was built, what review changed and what was left.
- [Memory history design](../specs/2026-10-08-memory-history-design.md):
  Specification. Keeping the data directory as a git repository, with recovery
  and a sealed mirror.
- [Memory history plan](../plans/2026-10-08-memory-history.md): Plan. Task by
  task, the data directory in git with recovery and a mirror.
- [Tags plan](../plans/2026-10-08-tags.md): Plan. Task by task, the tag
  vocabulary and shallow tagging.
- [Memory history probe](../reports/2026-10-08-memory-history.md): Report. The
  data directory in git: healing, rollback and a mirror.
- [Memory history implementation
  report](../reports/2026-10-08-memory-history-implementation.md): Report. How
  memory history was built, what review changed and what was left.
- [Tags probe](../reports/2026-10-08-tags.md): Report. Dorothy tagging live
  chats and keeping the user's corrections.
- [Tags implementation report](../reports/2026-10-08-tags-implementation.md):
  Report. How tags were built, what review changed and what was left.
- [Memory history deferred
  findings](../deferred/2026-10-08_memory-history-deferred.md): Deferred.
  History growth and bundle accumulation, retained by the sweep.
- [Tags deferred findings](../deferred/2026-10-08_tags-deferred.md): Deferred.
  Catalogue snapshot visibility, retained by the sweep.
- [Memory systems compared](../notes/2026-10-15_memory-systems-comparison.md):
  Research. Nine memory systems against Dorothy's store, and what she could
  take.
- [Memory in her bodies design](../specs/2026-10-15-memory-bodies-design.md):
  Specification. Claude Code sessions recorded as chat's are, and memory
  delivered by gateway and MCP.
- [Memory store design](../specs/2026-10-15-memory-store-design.md):
  Specification. One store of conversations and facts from every body, scoped
  personal or to a project.
- [Memory in her bodies, delivery
  plan](../plans/2026-10-15-memory-bodies-delivery.md): Plan. The memory block
  through the gateway, and remember in chat and Claude Code.
- [Memory in her bodies, recording
  plan](../plans/2026-10-15-memory-bodies-recording.md): Plan. Claude Code
  sessions recorded by hooks, synced and reviewed.
- [Memory store plan](../plans/2026-10-15-memory-store.md): Plan. Task by task,
  tool events, facts, projects and their sync.
- [Memory in her bodies report](../reports/2026-10-15-memory-bodies.md): Report.
  How memory reached Claude Code and chat: probes, rulings, verification.
- [Memory store implementation
  report](../reports/2026-10-15-memory-store-implementation.md): Report. How the
  store was built, what the probe and reviews changed.
- [Memory bodies deferred
  findings](../deferred/2026-10-16_memory-bodies-deferred.md): Deferred. Review
  factoring and probe caveats, retained by the sweep.
- [Memory contract design](../specs/2026-10-18-memory-contract-design.md):
  Specification. The one interface every harness meets and every engine sits
  behind.
- [Memory contract plan](../plans/2026-10-18-memory-contract.md): Plan. Task by
  task, knowledge as OKF files, host profiles and the memory service.
- [Memory contract report](../reports/2026-10-18-memory-contract.md): Report.
  Progress, rulings and verification, carried out by subagents.
- [Recording sessions design](../specs/2026-10-20-recording-design.md):
  Specification. A reader per harness and a sweep of each session store into her
  archive.
- [Recording sessions plan](../plans/2026-10-20-recording.md): Plan. Task by
  task, Codex's and Hermes's readers, the sweep and the backfill.
- [Recording sessions report](../reports/2026-10-20-recording.md): Report.
  Tasks, rulings, fix rounds and the probe on copied sessions.
- [Backfill review design](../specs/2026-10-29-backfill-review-design.md):
  Specification. Reviewing backfilled conversations in capped batches on the
  user's plan.
- [Backfill review plan](../plans/2026-10-29-backfill-review.md): Plan. Task by
  task, a capped review through the service's reviewer.
- [Backfill review report](../reports/2026-10-29-backfill-review.md): Report.
  Tasks, rulings and the first batch on the real store.
- [Memory engine design](../specs/2026-10-31-memory-engine-design.md):
  Specification. Delivering the passage that holds a fact, measured stage by
  stage.
- [Memory engine plan](../plans/2026-10-31-memory-engine.md): Plan. Task by
  task, one delivery step shared by recall and the evaluation.
- [Memory engine report](../reports/2026-10-31-memory-engine.md): Report. The
  first step built, with its tasks, rulings, paid runs and rerun.

## Evaluation

- [Memory evaluation design](../specs/2026-10-18-memory-evaluation-design.md):
  Specification. Questions drawn from her own data, systems behind one
  interface, answers judged.
- [Memory evaluation plan](../plans/2026-10-18-memory-evaluation.md): Plan. Task
  by task, the eval package, its snapshot, questions, systems and runner.
- [Memory evaluation report](../reports/2026-10-18-memory-evaluation.md):
  Report. Progress, rulings and verification, carried out by subagents.
- [Evaluation through subscriptions
  design](../specs/2026-10-29-eval-subscriptions-design.md): Specification.
  Calling a model through the user's plan before any API, recording tokens.
- [Evaluation through subscriptions
  plan](../plans/2026-10-29-eval-subscriptions.md): Plan. Task by task, the
  claude and codex routes and token records.
- [Evaluation through subscriptions
  report](../reports/2026-10-29-eval-subscriptions.md): Report. The routes, the
  question-generator bake-off and the faults live runs found.
- [Evaluation limits and review tools
  design](../specs/2026-10-30-eval-review-tools-design.md): Specification.
  Stopping at a plan's limit and applying an agent's review decisions.
- [Evaluation limits and review tools
  plan](../plans/2026-10-30-eval-review-tools.md): Plan. Task by task, stopping
  at a limit, evidence length and review apply.
- [Evaluation limits and review tools
  report](../reports/2026-10-30-eval-review-tools.md): Report. Usage limits,
  review evidence and the status line agents read.
- [The first evaluation run](../reports/2026-10-31-first-evaluation.md): Report.
  The first full run on the user's data, before and after backfill review.

## Identity, harnesses and delivery

- [Claude on a Claude Code
  gateway](../notes/2026-10-07_claude-conversation-claude-code-gateway.md):
  Research. A proxy between Claude Code's API requests, to edit persistent
  context.
- [Context leak findings](../reports/2026-10-07-context-leak.md): Report. What
  the Agent SDK's CLI adds to her context, and what was fixed.
- [Claude on OpenClaw and Hermes
  Agent](../notes/2026-10-15_claude-conversation-openclaw-hermes-agent.md):
  Research. A comparison of the two as hosts for a personal agent.
- [Identity design](../specs/2026-10-15-identity-gateway-design.md):
  Specification. A client-independent identity, a local gateway and a launcher
  for Claude Code.
- [Identity plan](../plans/2026-10-15-identity-gateway.md): Plan. Task by task,
  the identity package, gateway and dorothy --claude launcher.
- [Identity probes](../reports/2026-10-15-identity-gateway.md): Report. Where
  Claude Code puts appended system prompt text, and the user's own.
- [Identity implementation
  report](../reports/2026-10-15-identity-gateway-implementation.md): Report. How
  identity was built, and what the probes and review changed.
- [Dorothy's objectives](../reports/2026-10-15-objectives.md): Report. What she
  is to become: one adaptable Dorothy, her own core, memory first.
- [Protocol-diverse Dorothy](../reports/2026-10-18-protocol-diversity.md):
  Report. Minutes of the day she was ruled hosted by no one harness.
- [Delivery design](../specs/2026-11-01-delivery-design.md): Specification.
  Persona and memory carried into Codex and Hermes by launcher, hooks and
  provider.
- [Delivery plan](../plans/2026-11-01-delivery.md): Plan. Task by task, the host
  hook command, Codex launcher and Hermes provider.
- [Delivery report](../reports/2026-11-01-delivery.md): Report. Reviews,
  rulings, the no-model verification and the live probes that wait.

## Models and routing

- [Open-source replacements](../notes/2026-10-18_open-source-replacements.md):
  Research. Each part of Dorothy against the open software that could replace
  it.
- [Claude on Anthropic vs
  OpenAI](../notes/2026-11-01_claude-conversation-anthropic-vs-openai.md):
  Research. Policy differences between the two providers' inference APIs.
- [Claude on featherless
  pricing](../notes/2026-11-01_claude-conversation-featherless-pricing.md):
  Research. Subscription and pay-as-you-go options at featherless.ai.
- [Model providers design](../specs/2026-11-01-model-providers-design.md):
  Specification. Her own runtime on the Vercel AI SDK, routed per role with
  fallback.
- [Model providers plan, part
  B](../plans/2026-11-01-model-providers-routing.md): Plan. Config routes for
  each role over five provider kinds, with fallback.
- [Model providers plan, part
  A](../plans/2026-11-01-model-providers-runtime.md): Plan. The runtime on the
  Messages API with an API key; the Agent SDK retired.
- [Model providers report](../reports/2026-11-01-model-providers.md): Report.
  Both parts, their probes, rulings and live runs on real keys.
- [Model providers deferred
  findings](../deferred/2026-11-01_model-providers-deferred.md): Deferred.
  Review findings and live-run limits left after both parts merged.

## Terminal

- [Input editor design](../specs/2026-10-03-input-editor-design.md):
  Specification. The chat's multi-line input editor.
- [Markdown replies design](../specs/2026-10-03-markdown-replies-design.md):
  Specification. Rendering her Markdown replies in the terminal.
- [TUI chat design](../specs/2026-10-03-tui-chat-design.md): Specification. Her
  terminal chat interface.
- [Input editor plan](../plans/2026-10-03-input-editor.md): Plan. How the
  multi-line input editor was to be built.
- [Markdown replies plan](../plans/2026-10-03-markdown-replies.md): Plan. How
  Markdown replies were to be rendered.
- [TUI chat plan](../plans/2026-10-03-tui-chat.md): Plan. Task by task, the
  terminal chat interface.
- [Statusline and minimum size
  design](../specs/2026-10-05-statusline-and-minimum-size-design.md):
  Specification. A configurable statusline and a minimum window.
- [Statusline and minimum size
  plan](../plans/2026-10-05-statusline-and-minimum-size.md): Plan. How the
  statusline and minimum window were to be built.

## Orchestration

- [An orchestration layer](../notes/2026-11-01_agent-orchestration.md):
  Research. Which client should orchestrate Claude Code and Codex under stricter
  permissions.
- [A featherless orchestrator](../notes/2026-11-02_featherless-orchestrator.md):
  Research. A research log on which harness and model should orchestrate
  workers.
- [Orchestration design](../specs/2026-11-02-orchestration-design.md):
  Specification. An MCP server running boxed Claude Code and Codex workers
  through acpx.

## Repository workflow

- [Workspace modularity
  design](../specs/2026-10-09-workspace-modularity-design.md): Specification.
  Splitting src into Bun workspace packages with one public surface each.
- [Workspace modularity plan](../plans/2026-10-09-workspace-modularity.md):
  Plan. The contracts, seams, facades, moves and their checks.
- [Workspace modularity report](../reports/2026-10-09-workspace-modularity.md):
  Report. Launch probes, rulings and commits that made five packages.
- [Agentic asset refactor
  design](../specs/2026-10-11-agentic-asset-refactor-design.md): Specification.
  Agent guidance, skills and memory in conventions every coding agent reads.
- [Agentic asset refactor plan](../plans/2026-10-12-agentic-asset-refactor.md):
  Plan. AGENTS.md files, declared skills, memory under .agents and the checks.
- [Agentic asset refactor
  probes](../reports/2026-10-12-agentic-asset-refactor.md): Report. How Claude
  Code loads the guidance, and the prompt measured before and after.
- [Agentic asset refactor
  report](../reports/2026-10-13-agentic-asset-refactor-implementation.md):
  Report. The amendments, rulings and what two rounds of review changed.
- [Claude on Dorothy's token
  usage](../notes/2026-10-16_claude-conversation-token-usage.md): Research. A
  measured audit of where her Claude Code usage goes.
- [Roadmap sweep design](../specs/2026-10-19-roadmap-sweep-design.md):
  Specification. Addressing every feasible roadmap candidate and deferred
  finding at once.
- [Roadmap sweep plan](../plans/2026-10-19-roadmap-sweep.md): Plan. Task by
  task, the loose ends, tooling gaps and probes of the sweep.
- [Repository code review](../reports/2026-10-19-code-review.md): Report. A
  resumable review of the packages, with verified defects.
- [Roadmap sweep report](../reports/2026-10-19-roadmap-sweep.md): Report. Tasks,
  rulings, live probes and the limits retained.
- [Secrets with sops design](../specs/2026-10-21-sops-secrets-design.md):
  Specification. Replacing dotenvx with a sops-encrypted secrets.json opened by
  an age key.
- [Secrets with sops plan](../plans/2026-10-21-sops-secrets.md): Plan. Task by
  task, moving the secrets and removing dotenvx.
- [Secrets with sops report](../reports/2026-10-21-sops-secrets.md): Report. The
  migration, its rulings, reviews and verification.
- [Agentic asset consolidation
  design](../specs/2026-10-31-agentic-asset-consolidation-design.md):
  Specification. Stewardship and pre-screening made two declared skills.
- [Agentic asset consolidation
  plan](../plans/2026-10-31-agentic-asset-consolidation.md): Plan. Task by task,
  the token chooser, scripts and the two skills.
- [Agentic asset consolidation
  report](../reports/2026-10-31-agentic-asset-consolidation.md): Report. The two
  skills, new options, trimmed memories and live verification.
- [Repository wiki design](../specs/2026-11-03_repository-wiki-design.md):
  Specification. A maintained reference grounded in her code and records.
- [Repository wiki plan](../plans/2026-11-03_repository-wiki.md): Plan. Task by
  task, the link test, catalogue, pages and navigation.
