---
ctime: 2026-11-03
mtime: 2026-11-03
spdx: GPL-3.0-only
title: Dorothy in Pi
description: >-
  Approved delivery of Dorothy through Pi's own interface, with her
  identity, shared memory, Featherless inference and a bounded trial
  coordinating Codex and Claude Code through herdr.
tags:
  - dorothy
  - pi
  - agents
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-11-03_pi-delivery.md
   -
   -->

# Dorothy in Pi

## Status and intent

Approved by the user on 2026-11-03. Earlier that day the user
made Pi the highest priority and chose **Pi's own interface** over
embedding its SDK behind Dorothy's interface. The earlier exclusion
of Pi is superseded; the historical minutes remain unchanged.

Dorothy runs in Pi's terminal. Pi owns the conversation loop, model
streaming, tools, session navigation and compaction. Dorothy adds her
identity, shared memory and stewardship through a launcher and an
extension declared in this repository. Featherless supplies the
coordinator's inference. Claude Code and Codex remain external workers.

The first useful result is a session that remembers and can complete
an implementation, independent review and revision cycle through herdr,
including recovery from a failed worker and coordinator compaction.
Launching agents alone is not success.

The [research][research] establishes source-level feasibility, not a
working integration. No paid Pi inference or live Pi stewardship trial
has yet run. The approved design has two increments: delivery, then a
bounded stewardship trial. Their details were proposed by the author
and accepted with the design. The user subsequently authorised execution
without another plan approval round.

An independent builder check on 2026-11-03 found no important unanswered
questions for planning. This checks the design's completeness, not the
runtime claims that the fixtures and live trial must establish.

## Approaches

- **Pi's native interface with Dorothy's extension, chosen by the user.**
  Uses Pi's existing loop and terminal and tests stewardship directly;
  requires delivery and recording adapters.
- **Embed Pi's SDK behind Dorothy's interface, not chosen.** Keeps her
  present interaction surface, but adds session, UI and lifecycle
  integration before the trial.

Identity and memory remain host-independent services. This design adds
a delivery target; it retires no package and does not replace the
existing chat runtime. Open WebUI, a Pi fork, Pi Durable and an
unattended coordinator are outside these increments.

## Approved implementation decisions

- Launch with `dorothy --pi`, using the published Pi CLI as a
  subprocess and its own terminal UI. Bun continues to run Dorothy.
- Pin `@earendil-works/pi-coding-agent` to **1.5.0**, the researched
  release, as a declared CLI-package dependency. Use its published
  executable, not an import from an unexported package path. Its
  declared Node requirement is `>=22.19.0`; check the runtime before
  starting. A later version needs the compatibility fixtures rerun.
- Keep Pi-specific code at the CLI edge. Core and memory receive
  ordinary contract data, never Pi SDK types or a model-provider SDK.
- Give Dorothy a dedicated Pi agent directory. Preserve normal Pi
  preferences and saved sessions there, separate from plain `pi`.
- Use one explicitly selected Featherless model per run at first.
  Do not claim Dorothy's existing route fallback automatically works
  inside Pi. Model changes are visible; external actions are never
  repeated simply because a model call failed.
- Make herdr stewardship opt-in and scoped to a declared fixture
  fleet. Normal `dorothy --pi` needs neither herdr nor worker logins.
- Keep complete orchestra integration separate. The
  [orchestration spec][orchestra] retains its worker confinement,
  approval and broker contracts; this trial does not implement them.

## Increment A: native delivery

### Launch and profile ownership

`dorothy --pi -- <Pi arguments>` starts Pi in the caller's project
directory, forwarding its terminal and exit status. Signals follow
the existing host-launcher convention. The launcher resolves its own
pinned executable; it does not silently select an arbitrary global Pi.

The dedicated agent directory is
`$XDG_CONFIG_HOME/dorothy/pi`, using Dorothy's existing XDG defaults.
Session files live below `$XDG_DATA_HOME/dorothy/pi/sessions`, separated
by the canonical working directory using Pi's convention. The launcher
sets both explicitly so project settings cannot redirect recording.
Tests inject every path and environment.

The user owns Pi's preferences, keybindings and trust decisions in this
profile. Dorothy owns only a manifest marking the profile and the
explicit resources she passes at launch. She writes no plaintext key
or copied login to the profile, and imports no global Pi configuration.
Existing unmarked files at an owned path are refused, never overwritten.
Concurrent launches must not overwrite one another's effective model,
project scope, persona or helper commands: launch-specific material
uses private per-launch files, with atomic writes and cleanup.

The launcher passes Dorothy's extension and persona explicitly. Her
identity augments Pi's default system prompt; it does not replace the
tool-use instructions. The generated text comes from
`@dorothy/identity`. Capabilities and stewardship instructions remain
separate from her identity.

Discovered extensions and skills are disabled initially; declared
resources are loaded explicitly, including Pi's built-in MCP extension.
Pi's project instructions remain available, and project configuration
retains its normal trust prompt. Do not pass blanket project approval.
The effective loadout must be checked after project settings merge;
unexpected MCP servers or executable extensions must not silently join
the managed profile. A project resource the user explicitly admits
must be shown as a deviation from the tested loadout.

Normal Pi resume, fork, tree navigation, compaction, editor and settings
remain native. Reject conflicting launcher arguments that remove the
required extension, redirect its profile/session roots or supply a
plaintext key. Report the conflicting argument by name, never its
value. Help and a redacted launch dump work without decrypting secrets.

### Featherless

Read Dorothy's existing provider definitions and chat route. Select
the first Featherless entry in that route unless the user names an
exact configured Featherless entry. If none exists, explain the
configuration needed and stop before inference. The selected provider
and exact model are printed at startup. Pi's model picker may select
among the configured models of that Featherless provider only.

Register that provider's models through the extension, using per-launch
metadata and the key variable named by Dorothy's configuration. Load
credentials through the existing secret loader, then pass only the
selected provider's required key to Pi. Keys never enter argv, URLs,
generated JSON, logs, prompts or Pi's saved authentication file. Helpers
and newly launched workers receive filtered environments.

This is ordinary local Pi execution: the coordinator and its tools run
with the user's account privileges. Supplying a key to Pi does not
conceal it from code running in that process or account. Worker
credential confinement belongs to the orchestra design.

Supply explicit context/output limits, reasoning capabilities, request
defaults and price metadata for each registered model. Keep these in
a repository-owned compatibility manifest, with the source and date
checked; do not silently invent limits for an unknown model. The plan
chooses a current candidate from the earlier probes and verifies its
availability before any live run. No particular model is chosen by
the user's interface decision.

First test streaming tool-call IDs, tool results, thinking settings and
reasoning replay against a fake OpenAI-compatible endpoint. Then run a
bounded Featherless smoke test. If adaptation is needed, put it at the
provider edge and retain a regression fixture. Rate limits and broken
streams must report their state without reissuing worker dispatches.

### Shared memory

Add the `pi` host profile with budgets and the checked Pi version.
At session start or replacement, request the opening block from the
existing service for that Pi session and project. Before a human turn,
request recall through the same host-hook/client path used by delivery.
Inject the resulting context as extension-authored material, separate
from the person's speech. Refresh after compaction without duplicating
earlier injected blocks. Project identity is computed by Dorothy's
existing project resolver, not guessed from a directory basename.

Use the existing `dorothy --mcp --host pi` bridge for memory tools,
with the current project bound by its contract. Its process environment
uses the existing credential-filtering boundary. Native MCP direct
exposure keeps the small memory toolset inspectable; codemode and
tool-search are not required for this increment. The fake endpoint
must see exactly the intended tools, including indirect access paths.

A memory outage leaves the conversation usable and gives a visible,
bounded warning. Opening context and recall fail open as existing host
delivery does. Recording failure retains work for catch-up; it must
not be reported as a successful archive write.

### Recording and session identity

Pi's saved JSONL is the recovery source. Add a pure reader in memory,
plus a sweep source confined to Dorothy's dedicated session directory.
No global Pi session scan occurs. Extension notifications request
catch-up after settled turns and session replacement; the ordinary
sweep recovers work after a crash. Both paths use the same decoder and
service record contract, with persisted deduplication.

Use Pi's session and entry IDs, not timestamps, text matching or line
numbers, for event identity. Pair tool results with their calls within
the originating branch and occurrence. System prompts, reasoning,
usage entries, compaction summaries and extension-authored context are
not new human speech. Observe `tool_execution_end` when needed for
finalized calls that skip `tool_result`; any supplemental record must
share a stable identity with the JSONL reader.

Tree navigation must not flatten alternate branches into a false
linear conversation. Represent each newly divergent segment as a
separate archive conversation, linked to its parent, with a stable ID
derived from the Pi session and first divergent entry. Persist the
fork anchor and original-entry ownership in recorder metadata. Shared
ancestral entries belong to their original segment and are not copied
as new speech. A file fork uses its own session ID and parent link;
resume and compaction preserve existing ownership.

The implementation plan must specify the deterministic segment mapping
and prove it against synthetic Pi trees before live recording. Missing
or ambiguous ancestry is reported and held for recovery rather than
guessed. Parent files are resolved only within the configured session
root. Partial trailing lines wait; malformed known records stop that
session at the last sound boundary, with a diagnostic free of content.

Recording stores speech and tool evidence under the service's existing
scrubbing, trimming and project rules. A raw Pi transcript is not
scrubbed by those archive rules. Private/no-session launches do not
record and cannot enable a stewardship run requiring recovery.

## Increment B: bounded herdr stewardship

### Scope and control

Enable through `dorothy --pi --steward <registry> -- <Pi arguments>`.
The registry is an explicit local file of dedicated trial workers,
not a discovery of every live development pane. It contains stable
worker IDs, current herdr names/panes, harness, role, working directory,
observed availability and expiry. Account identifiers may be labels
or configuration paths, never tokens. Validate the entry against herdr
before each action; stale, missing or mismatched entries refuse it.

Use the installed herdr CLI contract verified by the trial, not the
newer website's commands by assumption. The repository declares the
required integration and installs its Pi state extension into Dorothy's
loadout. Herdr state follows `agent_start`, blocked UI and
`agent_settled`; `agent_end` is not completion.

Expose a small typed toolset for listing workers, reading their state
and output, dispatching a brief, waiting for a bounded interval and
requesting cancellation. Resolve a worker ID through the registry;
do not accept arbitrary shell snippets or terminal targets in those
tools. Briefs and reports live in the fixture workspace. Messages send
a labelled pointer to a brief, using the repository's existing sender
where compatible. Worker output is evidence, never new user authority.

Keep durable task IDs, worker assignment, brief digest, dispatch state,
report path and evidence of completion outside Pi's model context.
Persist dispatch intent before sending. The same task ID and arguments
return the existing state; changing arguments under an existing ID is
refused. A crash after a possible send produces `unknown` until live
worker evidence resolves it. Herdr does not promise exactly-once
delivery, so an uncertain send is never automatically retried.

Worker idle and dispatch accepted are observations, not task success.
Dorothy checks the report, changed revision and verification evidence.
Cancellation records a request, then observes the worker; stopping a
wait or aborting Pi does not prove that the worker stopped. Unknown
outcomes remain visible and do not release an assignment for reuse.

Pi may compact or resume while workers run. Before further dispatch,
reload the ledger and reconcile assignments against herdr and their
reports. Ordinary shutdown records unfinished work; it does not kill
pre-existing worker panes or claim their subprocesses are gone. The
trial's runner owns cleanup of workers it started.

### Skills and permissions

Adapt the repository's stewardship procedures to Pi's tools, retaining
budget observations, labelled messages, handover notes and evidence
checks. Discoverable skills alone are insufficient: the coordinator's
capabilities explicitly identify the applicable procedure and the trial
checks whether it is followed. Ship the registry schema, fixtures and
required assets in this repository; no manual global skill install.

This is a trusted local development trial. Pi's ordinary tools remain
available, so the typed toolset is an ergonomic contract, not an OS
sandbox. The trial must report deviations through ordinary shell or
terminal tools instead of calling them impossible.

Use dedicated worker sessions with permissions configured for the
fixture. Human questions are answered in the worker's native UI for
this increment; the coordinator reports a blocked worker. It does not
translate the development skill's blanket Codex approval preference
into a new product approval engine. Automated rule/judge/human approval
and MCP elicitation remain governed by the separate orchestra spec.

## Acceptance and evidence

All automated fixtures use temporary host homes, XDG roots, synthetic
memory, fake provider responses and fake workers. They never decrypt
real secrets, run paid inference or touch active development sessions.

Increment A is accepted when:

- The pinned published CLI opens its native terminal with Dorothy's
  identity and the declared loadout, including after reload.
- A fake provider verifies streaming, tool pairing and reasoning replay;
  launch failures and dump output reveal no credential values.
- Opening context and recall use the correct project; another project's
  memory remains outside that connection's scope.
- Saved sessions survive resume, fork, navigation, compaction and a
  killed launcher; replay records each original event once, preserving
  branch ownership. Memory downtime catches up without duplicate speech.
- A bounded live Featherless run on synthetic data confirms the wire
  behaviour. Its report distinguishes fixture proof from live results.

Increment B is accepted when:

- Fake workers exercise busy, stale, blocked, failed and quota-limited
  states, delayed reports, forged authority and uncertain dispatch.
- Dedicated Codex and Claude workers complete a small fixture change
  with independent review, revision and verified tests, coordinated by
  Dorothy in Pi. At least one worker failure and one coordinator
  compaction occur during the exercise.
- No assignment is duplicated after compaction or an uncertain send;
  cancellation and incomplete work are described accurately.
- The report captures task outcomes, human interventions, observed
  tokens/cost, elapsed time and all deviations. Unknown cost is labelled
  unknown, not zero. Trials are bounded by turns and wall time, with
  the model, worker accounts and spending limit recorded before a run.

A failed live trial yields a report and a narrowed next change; passing
unit tests alone does not establish stewardship capability. Approval of
this design does not assert that worker logins or paid-run budgets are
available. Those are checked before the run, while offline work proceeds.

## Boundaries, documentation and follow-up

CLI owns the launcher, Pi extension, provider registration and herdr
adapter. Memory owns the host profile, pure reader and sweep source.
Core gains only neutral configuration/contracts where required. Use
existing public package entry points and declare every direct import.
Update the affected package guides with the implementation; no Pi SDK
dependency enters memory or core.

The plan settles file layout, ledger format, locking, hook deadlines,
model manifest schema and the exact segment mapping. These are builder
choices subject to the invariants above. A dependency or protocol change
that cannot meet them returns to the design with measured evidence.

The implementation report records exact versions, runtime prerequisites,
commands, fixtures, live results and remaining limits. The roadmap keeps
Pi first and links each increment's plan and verification. Existing
delivery remains available.

Later work includes broader providers and automatic fallback, the
general development-agent registry, full orchestra integration with a
cancellation-aware human-question bridge, unattended recovery and a web
interface. These are separate decisions, informed by the trial.

## Source baseline

The plan starts from Pi v1.5.0's [versioned documentation][pi-docs]:
`cli.md`, `configuration.md`, `extensions.md` and `session-format.md`,
alongside the source inspection in the research. Mutable website
documentation is explanatory; the pinned release and compatibility
fixtures decide what this integration uses.

[research]: ../notes/2026-11-03_pi-stewardship.md
[orchestra]: ./2026-11-02-orchestration-design.md
[pi-docs]:
  https://github.com/earendil-works/pi/tree/v1.5.0/packages/coding-agent/docs
