---
ctime: 2026-11-03
mtime: 2026-11-06
spdx: GPL-3.0-only
title: Harnesses
description: >-
  The hosts Dorothy is delivered to, Claude Code, Codex, OpenClaw, Hermes
  Agent and Pi: how each receives her persona and memory, how her sessions
  there are recorded, and what is built, checked or waiting.
tags:
  - wiki
  - profiles
  - harnesses
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/wiki/profiles/harnesses.md
   -
   -->

# Harnesses

[Wiki home](../../README.md)

On 2026-10-19 the user chose the harnesses Dorothy is provided for and
tested against: Claude Code, Codex, OpenClaw and Hermes Agent (the
[roadmap's Dorothy's Memory](../../roadmap.md#dorothys-memory) records it).
No one harness hosts her. One definition of her, from `@dorothy/identity`,
is given to each, and one memory service serves them all; the mechanisms
are explained under
[identity, harnesses and delivery](../topics/identity-and-harnesses.md).
On 2026-11-03 the user made Pi the highest priority, which supersedes its
earlier exclusion, so Pi is a fifth host, [below](#pi)
([roadmap](../../roadmap.md#dorothy-in-pi)).

This is the one page that holds each host's state. For every host it
separates four things, because they differ in state even within one host:

- Persona: how her identity reaches the model.
- Recording: how the host's sessions become her conversations.
- Memory access: how her opening block, recall for a prompt and her tools
  reach the host.
- Live checks: probes run against the real host with the user's sign-in,
  and any that wait on the user.

The states are built, designed, awaiting a live check and waiting on the
user. "Built" means code and tests exist. Where the roadmap, a report and
the code disagree, this page follows the most recent record that verifies
the point and says so. The roadmap's Status for Dorothy's Memory, which
this page agrees with, reads: Delivery Built for Codex and Hermes, its
live probes waiting on the user, and OpenClaw's waiting on its install;
Claude Code was delivered earlier.

In the host profiles, which are data in
[`packages/memory/src/hosts/`](../../../packages/memory/src/hosts/),
each host has a block budget, a recall budget and a list of delivery
mechanisms. The
[memory contract spec](../../specs/2026-10-18-memory-contract-design.md#host-profiles)
explains them. A profile is not a delivery: `openclaw.json` exists, but
nothing delivers her to OpenClaw. Its `"checked": ["2026.10.4"]` names a
version, though OpenClaw was never installed or probed here and no record
says what was checked.

## Claude Code

Built and checked live. Claude Code was the first host, and it is the only
one whose persona, recording and memory access have all run against the
real host.

### Persona

Built, and checked live. `dorothy --claude` starts the
[gateway](./packages.md#gateway) and launches `claude` with its base URL
there and a marker appended to its system prompt. The gateway puts her
identity in the marker's place, as a block after Claude Code's own
identity line, leaving its prompt-cache breakpoints in place. The
[identity probes](../../reports/2026-10-15-identity-gateway.md#end-to-end)
(Claude Code 2.1.296, 2026-10-15) show that she answers as Dorothy, keeps
her prompt cache across turns and leaves subagents to Claude Code. The
[roadmap sweep's probes](../../reports/2026-10-19-roadmap-sweep.md#probes)
(2026-10-19) repeated it in an interactive session and in a fork: the
interactive probe injected each main request once, the fork once, with no
drift. The design is the
[identity spec](../../specs/2026-10-15-identity-gateway-design.md).

### Recording

Built, and checked on the user's own data. With `[memory]` enabled,
`dorothy --claude` passes `Stop` and `SessionEnd` hooks that run
`dorothy --claude-hook`, which records each reply and reviews the
conversation
([the CLI guide](../../../packages/cli/AGENTS.md#files)). The memory
bodies report's
[hand check](../../reports/2026-10-15-memory-bodies.md#recording-by-hand)
(2026-10-16) ran this against the real Claude Code, including `/clear`
and exit. The sweep reads Claude Code's transcripts too when
`claude-code` is listed in `[recording] hosts`, so sessions begun outside
`dorothy --claude` are recorded; the
[recording report's probe](../../reports/2026-10-20-recording.md#the-probe)
ran it on copies of 20 transcripts and recorded them idempotently.

### Memory access

Built, and checked live. The opening block is not delivered by a hook: the
launcher gives the gateway the memory block as its section, fixed for the
launch so the prompt cache holds. Her tools come as an MCP server,
`dorothy-memory`, offered with `--mcp-config` and allowed by `--settings`
when `recall` is on. The
[delivery probes](../../reports/2026-10-15-memory-bodies.md#delivery-probes)
(Claude Code 2.1.300) ran the real `claude` against the flag behaviour
this rests on, and the same report's hand check searched and used `remember`.

The memory contract spec and `claude-code.json` list Claude Code's
delivery as `hook` and `mcp`, and the spec's walk through a session has
`SessionStart` post for the block. The code does otherwise for the block,
as above, and the delivery report's ruling 9 says Claude Code keeps its
own hooks beside the new hook command. This page follows the code.

### Live checks

None waiting. The probes above passed on real Claude Code, the latest on
2026-10-19; they are dated, and say nothing of later Claude Code versions.

## Codex

Delivery built, with no live check yet: the persona, hooks and tools are
built and tested, and the live probes against Codex wait on the user.

### Persona

Built, awaiting a live check. `dorothy --codex` launches Codex with her
identity as `developer_instructions`, the user's own instructions
following hers, all as session flags that write none of Codex's files
([the hosts guide](../../../packages/cli/src/hosts/AGENTS.md#files)). Whether
Codex accepts that key without an unknown-key warning, and treats it as
additive, is an open probe that waits on the user
([probes](../../reports/2026-11-01-delivery/probes.md#codexs-additive-instructions-key)).

### Recording

Built for reading; no recording hooks, by ruling 10 of the
[delivery report](../../reports/2026-11-01-delivery.md#rulings). Codex's
rollout files are read by the sweep, which needs `codex` in
`[recording] hosts` (empty by default). The
[recording report's probe](../../reports/2026-10-20-recording.md#the-probe)
(2026-10-20) backfilled copies of the user's 7 rollouts, 1,293 events,
with no halt and no unknown type, and a second run recorded nothing new.
That is a check on copies, not on a Codex session running with her
hooks. The design is the
[recording spec](../../specs/2026-10-20-recording-design.md).

### Memory access

Built, verified without Codex. The opening block comes from a
`SessionStart` hook and recall from a `UserPromptSubmit` hook, both
`dorothy --hook codex <event>`, and her tools from an MCP server, all
given as session flags. Codex asks the user once to trust the hooks and
the launcher never bypasses it. Its own memories are off in her sessions.
On 2026-11-01 a probe Dorothy on temporary roots answered the real hook
command for Codex with the seeded fact in both block and recall, a large
reply through a pipe whole, and an empty reply when no service could
start ([verification](../../reports/2026-11-01-delivery.md#verification)).
The payload shape was taken from the strings of Codex 0.165.0's binary,
not captured from a running Codex, so it too is awaiting the live check.

### Live checks

Waiting on the user. As the delivery report recorded on 2026-11-01,
Codex's usage was spent until 5 November (17:23, Melbourne), and the probe
needs the user to sign a temporary home in and trust the hooks. The
[delivery report's Waiting section](../../reports/2026-11-01-delivery.md#waiting-for-the-user)
lists what the run will show: the trust screen, whether hooks given as
session flags are offered for trust at all (otherwise a plugin route
would be built instead), whether the instructions key is accepted,
whether the payloads match the fixtures, and that the sweep records the
rollout. No later report says it has run.

## OpenClaw

Designed only. Nothing is built for OpenClaw's delivery, and it is not
called built anywhere here.

### Persona

Designed. Its persona would go in OpenClaw's own `SOUL.md` and
`IDENTITY.md`. This is the route of the
[delivery spec](../../specs/2026-11-01-delivery-design.md#openclaw), and
is not built.

### Recording

Not built. OpenClaw's reader waits until OpenClaw is installed and probed;
the roadmap lists it among the
[candidates](../../roadmap.md#candidates). The recording code leaves a
place for OpenClaw's incognito marking, which the other hosts lack, and
nothing more.

### Memory access

Designed. The route in the delivery spec is a plugin in OpenClaw's
exclusive memory slot, with the block through its prompt builder and
recall through `prependContext`, never the system context, so the prompt
cache holds. The roadmap lists "OpenClaw's delivery, a memory-slot plugin
and its persona files, once it is installed" among the
[candidates](../../roadmap.md#candidates). The profile data in
`openclaw.json` (a 4,000 character block, recall of 4,000, delivery by
plugin and MCP) is the only code touching it.

### Live checks

Waiting on its install. OpenClaw is not installed on the user's machine,
so no probe of it has run. The roadmap's Status for Dorothy's Memory says
OpenClaw's is waiting on its install.

## Hermes Agent

Delivery built, with no live check yet: the provider and profile are built
and tested, and the live probe waits on the user's sign-in.

### Persona

Built, awaiting a live check. `dorothy --install hermes` makes a Hermes
profile named `dorothy` with Hermes's own `profile create --no-alias
--clone`, and writes her identity as that profile's `SOUL.md`, replacing
the clone's only when the file is still the clone's or still hers. Plain
`hermes` stays without her; she is reached with `hermes -p dorothy`.
Whether her `SOUL.md` and block reach the system prompt in a real Hermes
session has not been run
([waiting](../../reports/2026-11-01-delivery.md#waiting-for-the-user)).

### Recording

Built for reading, never met a real session. The sweep reads each Hermes
profile's `state.db` when `hermes` is listed in `[recording] hosts`. The
reader was written from Hermes's installed source (schema
version 31) and tested against that schema, as the user's database held
no session
([recording report](../../reports/2026-10-20-recording.md#task-2-hermess-reader));
the roadmap's candidates repeat that Hermes's reader "has met no real
session yet". The live probe's last step would show a swept Hermes
session.

### Memory access

Built, verified without Hermes. A memory provider in Python, using the
standard library alone, sits in the profile's `plugins/dorothy/` and calls
the same hook command for the block (`system_prompt_block`) and for
recall (`prefetch`). The install also sets four configuration keys in the
profile, among them `mcp_servers.dorothy` for her tools. The probe of
2026-11-01 ran the real provider, with Hermes's base class stubbed,
against the real hook command and got the seeded fact in both
([verification](../../reports/2026-11-01-delivery.md#her-hermes-provider-against-her-real-hook-command)).
Hermes itself was probed on a temporary home for how it makes a profile
and finds a plugin, with Hermes Agent v0.22.2
([probes](../../reports/2026-11-01-delivery/probes.md#hermes-profiles-and-plugins)).
Open: Hermes passes no working directory to the provider, which falls back
to the process's own; that suits Hermes's CLI and may not suit its gateway
([deferred](../../reports/2026-11-01-delivery.md#deferred)).

### Live checks

Waiting on the user. The step needs the user to sign a temporary Hermes
home in, and spends a short turn on the user's Hermes model. The
[delivery report's Waiting section](../../reports/2026-11-01-delivery.md#waiting-for-the-user)
lists it: whether the cloned profile signs in, whether her `SOUL.md` and
block reach the system prompt, whether the answer says teal, whether
Hermes passes a working directory, and whether the sweep records the
session. No later report says it has run.

## Pi

Delivery built and merged (#129), checked live on a bounded Featherless
run; stewardship's runner and offline tests are built, and its bounded
native mixed-worker run passed at `b38393c`. The production wiring also
ran under isolated configuration. Pi is the user's highest priority.
Unlike the others
she runs in Pi's own terminal interface, the published
`@earendil-works/pi-coding-agent` 1.5.0 the CLI pins, under Node 22.19 or
later, through `dorothy --pi`
([the hosts guide](../../../packages/cli/src/hosts/AGENTS.md#files)). Her
model there is the first Featherless entry of the chat route, or the one
`--model <provider:id>` names; no provider fallback runs inside Pi. Its
profile is its own, `$XDG_CONFIG_HOME/dorothy/pi`, apart from plain `pi`.

### Persona

Built, and checked live. Her extension, which the launcher passes Pi by
path, adds two sections to Pi's system prompt before each run, her
identity and her capabilities. Sections are additive, after Pi's own, so
the launcher passes no `--append-system-prompt` (it would make Pi skip a
discovered `APPEND_SYSTEM.md`) and Pi's tool guidance and project
instructions stay
([the extension's guide](../../../packages/cli/assets/pi/AGENTS.md#files)).
Every request of the offline run and the live run carried both sections,
after `/reload` too
([report](../../reports/2026-11-03_pi-delivery.md#the-native-fixture)).

### Recording

Built, and checked in a pseudo-terminal against a scripted provider. Pi
saves each session as JSONL below `$XDG_DATA_HOME/dorothy/pi/sessions`,
and that file is the source. Her extension has `dorothy --pi-hook` record
after each settled turn and at the end, and the sweep recovers what a
killed launcher left, when `pi` is in `[recording] hosts`. Each branch of
a session is its own conversation, linked to the one it forked from, so
a fork records only what is new. The report's run recorded every event
once through `/reload`, `--resume`, `/compact`, `/fork` and a launcher
killed mid-turn ([the Pi source's guide](../../../packages/memory/src/recording/AGENTS.pi.md)).
A session started with Pi's no-session flag records nothing.

### Memory access

Built, and checked live. At a session's start and after a compaction the
hook gives the opening block, and before a human prompt recall; the
extension shows them to the model as one message, never saved as speech.
Her tools are the MCP server `dorothy-memory`, registered by the
extension with the model's key withheld from it. A memory fault never
blocks a prompt: no layer, and a warning with a stable code. The live
run saw the eight declared tools, the synthetic key and an accepted
request on every turn.

### Live checks

Two live runs on Featherless passed, at about US$0.0028 in all; the
second is the one recorded. Still open, per the
[report](../../reports/2026-11-03_pi-delivery.md#pending-gates-and-limits)
and the
[deferred findings](../../deferred/2026-11-03_pi-delivery-deferred.md):

- The controller completed `RUNNERS.pi`'s dump and native final-turn
  smoke under isolated HOME/XDG and Featherless configuration. It used a
  direct provider without proxy accounting; provider billing is unknown
  and normal user defaults were unchanged.
- Reasoning replay after a tool call was seen in the first live run only,
  and compaction, resume, fork and recovery ran against the scripted
  provider alone; the live run was two turns.
- Pi's Node and version is pinned; the native fixture reads Pi's screen
  text, so an upgrade needs the fixtures rerun.
- The production wiring of `RUNNERS.pi` is the separate smoke above, not
  stewardship acceptance.

Stewardship's native mixed-worker run separately passed all eleven checks
at product `b38393c` in one bounded Linux API-backed cycle. It used 27 of
30 requests at a US$0.016791567 declared-price usage, 47 worker calls
at a conservative US$0.031589844 with no held unknown or safety stop,
and closed 3 of 3 owned panes in 329778 ms. Synthetic API profiles,
declared fault injection and owned-fixture `keepRecentTokens` 1024 were
declared deviations; workers ran as the same user with no OS
confinement. Attempts 4 to 9 remain incomplete history. These are not
subscription-model evidence or a reliability estimate
([the stewardship
report](../../reports/2026-11-03_pi-stewardship.md#the-live-gate)).

## Related

- [Identity, harnesses and delivery](../topics/identity-and-harnesses.md)
- [Protocols](./protocols.md)
- [Services and providers](./services-and-providers.md)
- [Memory](../topics/memory.md)
- [Decisions](../decisions.md)
- [Problems](../problems.md)
