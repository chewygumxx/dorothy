---
ctime: 2026-11-03
mtime: 2026-11-03
spdx: GPL-3.0-only
title: Pi as Dorothy's stewardship host
description: >-
  Why Pi was excluded, what its current interfaces offer Dorothy, the
  approval and recovery gaps, and a proposed trial coordinating Claude
  Code and Codex through herdr with Featherless inference.
tags:
  - dorothy
  - agents
  - pi
  - featherless
  - notes
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-11-03_pi-stewardship.md
   -
   -->

# Pi as Dorothy's stewardship host

Researched on 2026-11-03. After asking about
[Open WebUI][webui-note], the user clarified that the chief interest is
agent stewardship: Dorothy coordinating Claude Code and Codex as the
repository's development agents coordinate one another through herdr.
They asked why Pi had been given lower priority and whether its
capabilities could be tested for that role.

Pi warrants a bounded trial as another host for Dorothy. This is a
research recommendation, not an approved replacement architecture or
an implementation plan. The historical record excludes Pi explicitly,
but records no failed capability test and no separate Pi-specific user
rationale. The current interfaces fit much of the job; human approval
elicitation is a concrete integration gap.

## What the earlier decision actually says

The repository records two decisions, not a benchmark ranking:

1. On 18 October, the replacement research recommended rebuilding
   Dorothy's body on Pi. Dorothy would become a package containing her
   identity, archive recorder and extension; her agent, TUI, gateway
   and Claude Code glue would retire. That was the research agent's
   recommendation, not the user's chosen direction
   ([recommendation][replacements], commit `c48406f`).
2. Later that day, the user challenged the inherited assumption that
   Dorothy needed one host. The [minutes][minutes] record a preference
   for protocol diversity, with one identity and memory delivered into
   multiple harnesses. Their ruling says: "pi is not to be used. This
   supersedes the replacements note's recommendation to rebuild her
   body on it." Commits `a688d72` and `b0df052` preserve the decision.
3. [Agent memory][protocol-memory] compressed that into "do not propose
   a single host or pi." Its explanation discusses the single-body
   framing but supplies no separate reason against Pi. This explains
   why later agents would avoid proposing it; it does not recover the
   user's underlying Pi-specific objection.
4. On 19 October, the [target-harness memory][targets] named Claude
   Code, Codex, OpenClaw and Hermes for delivery and testing. That
   scoped persona generation, memory delivery and recording. The
   separate [memory priorities][priorities] put compatibility first;
   they did not rank clients by coding or orchestration quality.

These are repository minutes and memories, not a recovered verbatim
user transcript. The earlier research raised Earendil ownership,
contributor policy, API churn and the absence of a permission sandbox.
None is identified as the decisive reason for the user's exclusion.
Those historical concerns must not be presented as current verified
facts or as the user's rationale.

The [2 November survey][featherless-note] considered Pi again as a
Featherless orchestrator using extensions. That survey did not explicitly
repeal the October ruling. The present request reopens research into Pi;
it does not require rewriting the historical record.

Testing Dorothy in Pi as an additional host preserves the principle
that her identity and memory belong to no one harness. It is a narrower
proposal than replacing Dorothy's existing packages with Pi.

## Research basis and local inspection

The latest [release][pi-release] checked was **v1.5.0**, published
2026-11-02, at commit:

```text
f9a26365568127461c47a07a37dcb42c140a3ac5
```

Upstream main was also read at:

```text
9c9ce8547e5a88cbe834a53e9a6d83a789d08e47
```

The relevant MCP, RPC, SDK, tool-selection and provider sources were
compared with the release. The former `badlogic/pi-mono` repository
redirects to `earendil-works/pi`; package names are now
`@earendil-works/*`. The [versioned source][pi-source] is the reference
for implementation details below; the website's latest pages can drift.

Read-only local inspection established:

- `herdr --version` reported `herdr 0.9.5`.
- `herdr agent` listed `pi` among supported kinds.
- `herdr integration` listed Pi installation and removal commands.
- `herdr integration status` reported the Pi extension uninstalled.
- `command -v pi` found no executable on the research shell's `PATH`.
- Dorothy has no Pi launcher, host profile or session recorder, and
  `@dorothy/orchestra` is specified but not implemented in this checkout.

Herdr's [source][herdr-source] was read at the revision already pinned by
Dorothy's `package.json`:

```text
2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01
src/integration/assets/pi/herdr-agent-state.ts
```

It reports state through Pi's `session_start`, `agent_start` and
`agent_settled` events, with a `herdr:blocked` event for blocked state.
This is stronger evidence of a supported integration than recognition
of terminal text alone. It has not been exercised with Pi here.

No packages were installed, upstream code executed, paid inference
called, live worker prompted, secret read or real Dorothy store used.
The findings below are source inspection and feasibility analysis.

## Fit for stewardship

| Requirement | Assessment |
| --- | --- |
| Identity and skills | Supported; Dorothy delivery still needed |
| Featherless inference | Protocol fits; live compatibility untested |
| Shared memory | Native MCP fits; recording adapter still needed |
| herdr coordination | Supported agent kind and lifecycle extension |
| Headless control | RPC, JSON events and a TypeScript SDK |
| Account and budget routing | Repository policy and adapters needed |
| Human approval questions | Native MCP elicitation absent |
| Restart-safe external actions | Requires reconciliation and deduplication |

### Identity, skills and memory

Pi supports `SYSTEM.md` and `APPEND_SYSTEM.md`, Agent Skills, and
TypeScript [extensions][pi-extensions]. Dorothy can supply her shared
identity and a host-specific capabilities section. Skills are available
through progressive disclosure; loading a skill does not prove that a
particular model follows it reliably.

Extensions can inject memory before a turn and observe session and
tool events. Dorothy's existing Streamable HTTP MCP service therefore
provides a plausible recall connection. Full delivery also needs
session identifiers, project scope, opening context and recording into
her archive. No Pi adapter currently implements these.

Pi sessions are trees. Recording must preserve stable event identities
across resume, forks and compaction, without recording replayed events
twice or treating a summary as new user speech. In the versioned
extensions documentation, `tool_execution_end` covers finalized calls
that may skip `tool_result`, including blocked, invalid or aborted
calls. This deserves an explicit recording fixture.

### Tools and process control

Pi's [RPC interface][pi-rpc] is a long-lived JSONL subprocess protocol;
the [SDK][pi-sdk] embeds in Node or Bun. A successful prompt response
means acceptance, not completion. `agent_end` can be followed by
retries, compaction or queued work; `agent_settled` is the event for a
run that will not continue automatically.

The shipped subagent example starts other Pi processes. It does not
establish built-in supervision of Claude Code and Codex. For the first
trial, herdr can supply that external-agent control through the
existing stewardship scripts or a small set of typed tools. The
proposed orchestra service would provide a separate structured route
through ACP later.

Account selection, remaining budgets, reset times and handover notes
remain the responsibility of the [stewardship assets][stewardship]. Pi
does not acquire the other agents' quotas merely by running their
commands. The [roadmap][roadmap] already distinguishes the registry of
development agents from Dorothy's product orchestration.

Current steering semantics also need care. The v1.5.0 agent README
says the current assistant turn's tools finish before steering is
injected; tools run in parallel by default. The homepage's description
of interrupting remaining tools after the current tool is inconsistent
with that source. Use abort for cancellation, and test what external
work actually stops.

### MCP and the approval gap

Pi now has [native MCP][pi-mcp], supporting stdio and Streamable HTTP.
Advice that every Pi MCP connection needs a third-party extension is
outdated. For a small orchestration toolset, `direct` exposure is easier
to evaluate than the default codemode discovery.

Tool selection needs a probe: `--tools` alone retains MCP tools unless
an entry starts with `mcp__`; tools exposed through codemode can remain
available even when absent from direct declarations. SDK sessions also
need explicit MCP factories and extension binding, unlike the CLI.

The v1.5.0 conformance README explicitly says Pi does not support
elicitation. In the [versioned source][pi-source], see:

```text
packages/coding-agent/test/mcp-conformance/README.md
packages/coding-agent/src/extensions/mcp/runtime.ts
packages/mcp/src/client.ts
```

This is material to Dorothy's [orchestration spec][orchestra]. Its
service decides permissions through rules, a dedicated judge, then the
user. A client with no elicitation capability has every request that
needs the user denied. Native Pi MCP cannot provide that complete
workflow unchanged.

A custom bridge appears feasible: Pi exposes generic MCP request
handlers and [human dialogs][pi-dialogs], including in RPC mode. It
would need to carry `elicitation/create` to the human UI and preserve
question IDs, deadlines, cancellation and late-answer rejection. The
chat model must not answer for the user. Generic request cancellation
is not evidence that elicitation cancellation already works.

The model can coordinate workers without being the approval judge.
Orchestra deliberately provides no tool for the chat model to answer
permissions. A Pi integration should preserve that boundary.

### Featherless compatibility

Pi supports a custom `openai-completions` provider with an explicit
base URL, model metadata, environment-resolved credentials and request
defaults ([configuration][pi-models]). Featherless documents the
compatible endpoint `https://api.featherless.ai/v1` and
[native tool calling][fl-tools]. This establishes a protocol pairing,
not tested compatibility for every hosted model.

The consequential wire check is reasoning across tool calls.
Featherless documents model-specific thinking settings and replay of
`reasoning_content` ([requirements][fl-thinking]). Pi accepts several
reasoning field names and generally replays the one received. If a
model endpoint emits a different name from the one its input template
expects, adaptation may be needed. That is a testable risk, not a
confirmed failure. Relevant source and configuration:

```text
packages/ai/src/api/openai-completions.ts
packages/coding-agent/docs/models-configuration.md
```

Credentials should follow Dorothy's existing secret-loading boundary;
no key belongs in a committed Pi profile, command argument or transcript.
The trial should record effective context, output limits and prices
for the selected model when it runs, rather than assume old values.

### Confinement and durable work

Pi has project-trust controls and extension permission gates, but
executes with its launching account's permissions. A tool allowlist is
not an OS sandbox. The proposed orchestra worker boxes and broker are
therefore relevant whichever host coordinates them
([Pi security][pi-security], [orchestration spec][orchestra]).

Saved CLI sessions do not guarantee safe recovery of an external
dispatch that succeeded just before its response was lost. Worker and
operation IDs need authoritative state outside the model's transcript,
with reconciliation before a retry.

[Pi Durable][pi-durable] is a separate experimental package offering
checkpointed tasks and restart recovery. Its API is marked unstable;
one process owns a store. Replay-safe tools still require external
idempotency, and interrupted tools not marked replay-safe fail instead
of automatically repeating. This is a possible later foundation for
unattended work, not a switch that makes the CLI durable.

## A bounded trial

Two questions should be evaluated separately:

- Can Dorothy in Pi supervise a mixed fleet through herdr?
- Can Pi be a complete client of the proposed orchestra service?

The first can be explored before the service is built. The second
requires its tool contract and the human-question bridge. Neither
requires replacing Dorothy's existing runtime.

### 1. Connection and lifecycle without a provider key

Use a temporary Pi profile, temporary XDG roots, synthetic memory,
a fake OpenAI-compatible streaming endpoint and fake workers. Declare
the fixtures and required assets in the repository if the trial is
implemented. Check:

- streaming tool-call IDs, results and reasoning in the next request;
- the exact tool set, including indirect codemode access;
- accepted, working, blocked and settled states;
- cancellation during a running call, including actual stopped effects;
- native elicitation rejection, then bridge behaviour if one is built;
- memory scope and recording once across resume, fork and compaction.

These checks establish plumbing, not model competence. They must not
touch the user's actual Dorothy data or existing worker sessions.

### 2. Coordinator judgement with simulated workers

Run the same tasks and Featherless model through Pi and Dorothy's
existing loop. Hold prompts, available operations and worker fixtures
constant as far as each host permits; record any differences.

Include busy and failed workers, quota exhaustion, stale names,
conflicting reviews, delayed replies, compaction and forged authority
in worker output. Score task routing, useful waiting, recovery,
duplicate actions, unsupported completion claims, cost, latency and
human intervention. Repeat cases and reserve variants the prompts were
not tuned against.

The [2 November probes][featherless-note] provide a baseline, not Pi
results. Several models passed routine decisions but failed hostile
worker-output cases. DeepSeek-V4.1-Flash-1017, Kimi-K3 and MiniMax-M3
passed 36 of 36 hostile cases each in that recorded sample. Recheck
availability and prices before a new run; those results neither prove
general reliability nor justify delegating hard constraints to a model.

### 3. One real development cycle through herdr

Use a small fixture repository and dedicated Codex and Claude sessions.
Dorothy in Pi briefs an implementation, obtains an independent review,
requests a revision, and checks evidence of completion. Introduce a
worker failure and compact the coordinator during the exercise.

Success means correct ownership and task routing, useful briefs,
evidence-based review, recovery without duplicate work, and a faithful
account of what remains unfinished. Merely launching two agents does
not pass. Worker processes and repository changes remain observable
through herdr and the fixture's recorded results.

### 4. Approval and interruption

Against the proposed service contract, test allow, deny, no answer,
deadline expiry, worker stop and a late answer to a cancelled question.
Human answers must never be inferred from a worker's text.

Interrupt dispatch between the external acknowledgement and the local
record. Restart the coordinator and reconcile by operation ID. Require
no duplicate dispatch, no stale approval, and an explicit unknown
outcome where evidence is insufficient. Verify confinement by effects,
even when a model makes the wrong decision.

## Recommendation and unresolved work

Start with Pi as a coordinator in a bounded herdr trial. A successful
implementation-and-review cycle, including failure recovery and
compaction, would justify further investment in delivery and recording.
Compatibility with orchestra should then be tested independently.

Still unproven are live Featherless behaviour through Pi, adherence to
the stewardship skills, reliable mixed-agent coordination, complete
memory recording and cancellation-aware human elicitation. No time or
cost estimate for those integrations was measured in this study.

[webui-note]: ./2026-11-03_open-webui-feasibility.md
[replacements]: ./2026-10-18_open-source-replacements.md
[minutes]: ../reports/2026-10-18-protocol-diversity.md
[protocol-memory]: ../../.agents/memory/protocol-diverse-dorothy.md
[targets]: ../../.agents/memory/target-harnesses.md
[priorities]: ../../.agents/memory/memory-priorities.md
[featherless-note]: ./2026-11-02_featherless-orchestrator.md
[stewardship]: ../../.agents/skills/agent-stewardship/SKILL.md
[roadmap]: ../roadmap.md
[orchestra]: ../specs/2026-11-02-orchestration-design.md
[pi-release]: https://github.com/earendil-works/pi/releases/tag/v1.5.0
[herdr-source]: https://github.com/herdrdev/herdr/tree/2ecf19a
[pi-source]: https://github.com/earendil-works/pi/tree/v1.5.0
[pi-extensions]: https://pi.dev/docs/latest/extensions
[pi-rpc]: https://pi.dev/docs/latest/rpc
[pi-sdk]: https://pi.dev/docs/latest/sdk
[pi-mcp]: https://pi.dev/docs/latest/mcp
[pi-dialogs]: https://pi.dev/docs/latest/rpc-extension-ui
[pi-models]: https://pi.dev/docs/latest/models
[pi-security]: https://pi.dev/docs/latest/security
[pi-durable]:
  https://github.com/earendil-works/pi/tree/v1.5.0/packages/durable
[fl-tools]: https://featherless.ai/docs/tool-calling
[fl-thinking]: https://featherless.ai/docs/chat-template-kwargs
