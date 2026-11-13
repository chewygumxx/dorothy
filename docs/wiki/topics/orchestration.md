---
ctime: 2026-11-03
mtime: 2026-11-14
spdx: GPL-3.0-only
title: Orchestration
description: >-
  Two separate subjects: the orchestration toolset designed for Dorothy,
  not built, and the herdr tools that coordinate the agents developing her
  today.
tags:
  - wiki
  - orchestration
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/wiki/topics/orchestration.md
   -
   -->

# Orchestration

[Wiki home](../../README.md)

"Orchestration" names two different subjects in this repository. The
first is a feature of Dorothy's own: a toolset by which she would run
Claude Code and Codex workers. It is designed and not built. The second is
how the agents that develop Dorothy are coordinated now, with herdr, a
skill and some scripts. They are not the same work, but the spec places the
first as an alternative to the second in time: it describes today's
coordination through herdr, keeps long jobs going through herdr for now,
and lists herdr's panes for workers the server starts as later work
([summary](../../specs/2026-11-02-orchestration-design.md#summary),
[decisions](../../specs/2026-11-02-orchestration-design.md#decisions),
[later](../../specs/2026-11-02-orchestration-design.md#later)). [The first
note](../../notes/2026-11-01_agent-orchestration.md) found that
screen-scraping approvals through herdr does not scale, and it came before
the spec. The dated records of both are listed under
[records](../records.md#orchestration).

## Dorothy's own orchestration

State: designed. Nothing of it is built.

- The roadmap has no ordered phase for it as of 2026-11-03: no
  "Orchestration" heading stands in [Ahead](../../roadmap.md#ahead). The
  spec's own Documentation section says its work would add one ahead of
  Dorothy's Gateway
  ([spec](../../specs/2026-11-02-orchestration-design.md#documentation));
  the roadmap does not yet say so, and only the roadmap orders work.
- There is no `orchestra` package in `packages/`; the nine packages are
  listed in [packages](../profiles/packages.md). No plan or report for it
  exists in the records. Any prototype is local and unmerged, and is not
  cited here.
- The spec is the only design record, with two research notes before it.
  Its decisions table records rulings made "with the user or by the
  coordinating agent", each with its cost if wrong
  ([decisions](../../specs/2026-11-02-orchestration-design.md#decisions)).
  Whether the user has accepted the whole design is not stated in the
  spec, and this page does not infer it.

### What the spec designs

In two parts, each meant to have its own plan and merge
([summary](../../specs/2026-11-02-orchestration-design.md#summary)).

Part A is a new package, `@dorothy/orchestra`, served over MCP stdio as
`dorothy --orchestra-server`. It runs Claude Code and Codex workers
through acpx's embedded runtime, so both speak the Agent Client Protocol
(ACP) ([protocols](../profiles/protocols.md) places ACP among the
standards the research weighed). It gives a client a handful of tools: it
starts, prompts, reads, waits on, lists, pushes, stops and removes
workers, and opens a pull request for one's branch. No tool answers a
permission request or merges
([tools](../../specs/2026-11-02-orchestration-design.md#tools)).

Two layers are kept apart. The constraints hold whatever anyone answers:

- each worker, adapter and agent together, runs in a bubblewrap box with
  a clone of its repository of its own, no credential of the user's but
  its agent's own login, and no network but an allowlist
  ([the box](../../specs/2026-11-02-orchestration-design.md#the-box));
- workers never push: a sealed broker brings a worker's branch into the
  main checkout and pushes it.

The policy then answers the permission requests the agents send, in this
order: rules, then a judging model on a new `approval` role, then the user
by MCP elicitation. Every failure to decide is a denial
([the gate](../../specs/2026-11-02-orchestration-design.md#the-gate)). The
spec's own caution applies: a worker can act inside the box without
asking, so the policy is enforced only where the broker applies it too.

Part B makes Dorothy's chat the first client: its launch would own the
server, and elicitations would become prompts in the TUI, switched on by
`[orchestra]` in `config.toml`
([Part B](../../specs/2026-11-02-orchestration-design.md#dorothys-chat-part-b)).
The routes and roles that would carry the judge are those of
[models and routing](./models-and-routing.md); the terminal that would show
the prompts is [the terminal](./terminal.md).

### Why it is designed this way

The reasons are in the research, not invented here.

- [An orchestration layer for less permissive agents][layer]
  (2026-11-01) found that screen-scraping approvals through herdr does not
  scale once agents run under stricter policies, and that a structured
  channel is needed. It weighed the orchestrators in
  [a table](../../notes/2026-11-01_agent-orchestration.md#the-orchestrators)
  and judged acpx the best fit, with a pre-1.0 dependency as its cost.
- [A harness for a featherless orchestrator][harness]
  (2026-11-02) asked what the orchestrating agent should run in and on,
  and records the feasibility probe and the two Codex reviews that led the
  spec to rest its hard limits on a box around the whole worker, since the
  agents' own sandboxes could not hold them
  ([the probe][probe]).
  The probe's code was throwaway and no agent was signed in, so the box
  with real agents is still to be checked.

The first note and the spec differ on who orchestrates. The note
recommended that the orchestrating agent stay Claude Code; the spec made
Dorothy's chat on an open-weight model the first client. The later record
is the spec, and it is the one this page follows.

### What is still open

The spec makes each merge wait on a live run with real agents, once their
usage limits allow, recorded in a report
([verification](../../specs/2026-11-02-orchestration-design.md#verification)).
No report of one exists in the records. The spec also lists what it
leaves for later, among them an unattended runner and platforms without
bubblewrap
([later](../../specs/2026-11-02-orchestration-design.md#later)).
It names a leading model for the judge as an assumption, and says the route
is the user's to set. The probe's favourable result for it is a dated
2026-11-02 finding, not current advice.

## How her developers are coordinated today

State: in use, as a skill, its scripts and herdr, which is third-party;
none of it is part of Dorothy's application.

The agents that develop Dorothy run in herdr panes, coordinated by a
Claude Code session that types into the others' terminals and reads their
panes. Codex runs with full access, so that it never asks
([spec](../../specs/2026-11-02-orchestration-design.md#summary);
[Codex full send](../../memory/codex-full-send.md)).

The practice is written as a skill in this repository, as the rule that
every agentic asset be declared here requires (see
[repository workflow](./repository-workflow.md#agent-assets)). The
[agent stewardship skill](../../../packages/skills/skills/agent-stewardship/SKILL.md)
holds the rules and points to a reference for each client and topic:

- compaction past 85% of the context, at a turn boundary;
- routing a job by usage budget, first to Codex, then to a Claude
  subagent that leaves room for the coordinator, then to the reserve
  account, otherwise waiting for the first reset;
- arming a wake-up before a usage limit can stop an agent, and keeping a
  resume note to wake from;
- running a job that may outlast a window as a unit, not in the client's
  background shell;
- sending messages through one script, `send-prompt.sh`, which labels
  every message with its sender and takes a lock on the pane. The label
  is a claim and not proof, and nothing secret goes in a message;
- approving every Codex prompt rather than relaying it to the user.

The skill names the roles that fill the panes: a coordinating agent, a
reserve that resumes the work when the coordinator is limited by usage or
billing, and Codex. Which herdr names and accounts fill them changes, so
this page names none; the skill holds the current list. The user's
preferences behind the rules are agent memory: [usage limits](../../memory/usage-limits.md),
[Codex full send](../../memory/codex-full-send.md) and
[self-compaction](../../memory/self-compaction.md). The
[herdr reference](../../../packages/skills/skills/agent-stewardship/references/herdr.md)
covers the panes and how a message is sent.

### The registry of herdr agents

State: a candidate. The roadmap lists it under
[Candidates](../../roadmap.md#candidates) as unscheduled but high
priority: it waits on no phase and is taken up when the user says. The
roadmap states that it is not Dorothy's own orchestration.

The reason is recorded there: agents' names, roles and availability are
written into the skill, memory and handover notes, and went stale when
herdr's names changed on 2026-11-02. The candidate would hold them in a
git-ignored registry that the skill's scripts and references read, so that a
rename is one edit. Its file, `.agents/registry/herdr.json`, does not
exist yet. Until it does, the skill's list is where the roles are named.

## Related

- [Repository workflow](./repository-workflow.md)
- [Services and providers](../profiles/services-and-providers.md)
- [Models and routing](./models-and-routing.md)
- [Decisions](../decisions.md)
- [Priorities](../priorities.md)

[layer]: ../../notes/2026-11-01_agent-orchestration.md
[harness]: ../../notes/2026-11-02_featherless-orchestrator.md
[probe]: ../../notes/2026-11-02_featherless-orchestrator.md#the-orchestration-spec-and-a-feasibility-probe
