---
ctime: 2026-11-03
mtime: 2026-11-11
spdx: GPL-3.0-only
title: Dorothy's wiki
description: >-
  The home of Dorothy's repository wiki: what she is now, and where the
  dated records behind it are kept.
tags:
  - wiki
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/README.md
   -
   -->

# Dorothy's wiki

Dorothy is a conversational LLM interface: a terminal chat over a model,
with a memory she can search, compact and tag, which her service shares
with other harnesses. This wiki explains her as she is now, subject by
subject. It links the dated records in `specs/`, `plans/`, `reports/`,
`notes/` and `deferred/` as the evidence for what it says.

## Routes

- Where does a topic live? Take the [topic list](#topics) below, or find
  every dated record under its subject in the
  [records](./wiki/records.md) catalogue.
- Why was a choice made? The [decisions](./wiki/decisions.md) give each
  choice's context, alternatives, reason, cost and whether it stands.
- What do readers need to understand or ask repeatedly? The
  [questions](./wiki/questions.md) answer them briefly and link the page
  that explains.
- What tends to go wrong, and how is it diagnosed or avoided? The
  [problems](./wiki/problems.md) list symptoms with cause, remedy and
  state.
- What comes next, and why? The [priorities](./wiki/priorities.md) index
  the [roadmap](./roadmap.md), which alone orders the work.
- What is a package, protocol, service, provider or harness to Dorothy?
  The [profiles](#profiles) say, beginning with the
  [packages](./wiki/profiles/packages.md).

## Pages

### Topics

- [Memory](./wiki/topics/memory.md): what she stores, how recall finds and
  delivers it, and how it is compacted, tagged, versioned and shared.
- [Evaluation](./wiki/topics/evaluation.md): how her memory is measured, the
  systems compared, what the results establish and their limits.
- [Identity, harnesses and delivery](./wiki/topics/identity-and-harnesses.md):
  how her identity is defined once, carried into a host (the gateway, session
  flags, Pi's extension) and recorded back.
- [Models and routing](./wiki/topics/models-and-routing.md): her runtime,
  roles, providers, fallback and cost accounting.
- [The terminal](./wiki/topics/terminal.md): the chat, input, Markdown
  replies, stats and layout of her TUI.
- [Orchestration](./wiki/topics/orchestration.md): the toolset designed for
  Dorothy, not built, and the herdr tools coordinating her developers today.
- [Development evidence](./wiki/topics/development-evidence.md): preserving
  private captures, encrypted storage, authentication and verified recovery.
- [Repository workflow](./wiki/topics/repository-workflow.md): package
  boundaries, worktrees, checks, agent assets, secrets and keeping the
  documentation current.
- [Build configuration](./wiki/topics/build-configuration.md): mise's tasks
  beside Bun's layer, where each tool's configuration lives, and why.

### Profiles

- [Packages](./wiki/profiles/packages.md): the eight workspace packages and
  what each may import.
- [Harnesses](./wiki/profiles/harnesses.md): Claude Code, Codex, OpenClaw,
  Hermes and Pi, and the state of her delivery to each.
- [Protocols](./wiki/profiles/protocols.md): MCP, the model APIs, hook
  payloads, ACP and the standards the research weighed.
- [Services and providers](./wiki/profiles/services-and-providers.md): the
  model providers, libraries, memory systems and tools her records weigh.

### Across the subjects

- [Records](./wiki/records.md): every dated record by subject.
- [Decisions](./wiki/decisions.md): why her significant choices were made,
  by subject, with who chose, the cost and whether each still stands.
- [Questions](./wiki/questions.md): short answers to what a reader of the
  repository asks, each linking the page that explains it.
- [Problems](./wiki/problems.md): symptoms a reader meets, with cause,
  diagnosis, remedy, state and evidence.
- [Priorities](./wiki/priorities.md): the roadmap's phases ahead in order, its
  candidates and the checks waiting on the user.

## Reference and records

The pages here are reference: they have stable names, say what is true now
and are updated in the branch that changes the subject. The dated files in
`specs/`, `plans/`, `reports/`, `notes/` and `deferred/` are records: each
says what was true or intended on its day and is not rewritten, so it may
describe what has since changed. Where the two differ, trust the reference
page and follow its link to the record. The [roadmap](./roadmap.md) alone
orders the work, and [`AGENTS.md`](./AGENTS.md) holds the conventions for
both.
