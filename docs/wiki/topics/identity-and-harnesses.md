---
ctime: 2026-11-03
mtime: 2026-11-04
spdx: GPL-3.0-only
title: Identity, harnesses and delivery
description: >-
  How Dorothy's identity is defined once and carried into a host: the
  identity package, the gateway, the hook command, the launchers and the
  recording of a host's sessions, as mechanisms.
tags:
  - wiki
  - identity
  - harnesses
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/wiki/topics/identity-and-harnesses.md
   -
   -->

# Identity, harnesses and delivery

[Wiki home](../../README.md)

On 2026-10-18 the minutes of the protocol-diversity day ruled that no one
harness hosts Dorothy: her definition is generated into each host's own
slots, and one memory serves them all
([minutes](../../reports/2026-10-18-protocol-diversity.md#rulings)). This
page explains the mechanisms that follow from the ruling: how her identity
is written, how it reaches a model, how a host is given her block and
tools, and how a host's sessions come back as conversations.

It explains mechanisms only. Which host each is built for, what has been
run against the real host and what waits on the user is held in one place,
[harnesses](../profiles/harnesses.md), and is not restated here. Where this
page says a mechanism is built, it means code and tests exist.

## One definition of her

`@dorothy/identity` holds who Dorothy is as text. Built. It has three
components, joined in order by `identityPrompt()`: her identity (she is
Dorothy), her voice (warm, curious and accommodating) and her provenance,
a stance on what runs her. The provenance text tells her to introduce
herself simply as Dorothy, to treat an identity line from the software
hosting her as naming her host and not her, to volunteer no company, model
or software, and to answer plainly from what her context shows when asked
([`identity.ts`](../../../packages/identity/src/identity.ts)).

Three properties matter downstream
([package guide](../../../packages/identity/AGENTS.md)):

- It names no host, protocol or provider, and does no I/O. What a host
  lets her do, and how it runs her, belong to the host's own delivery.
- It is the same text on every call. A request carrying it keeps its
  prompt cache, so nothing in it may vary by time, host or environment.
- `identity.test.ts` pins it byte for byte. It changes only when Dorothy is
  meant to change, and the chat persona's pin moves with it.

Her own chat uses it too. `agent`'s persona takes the three components
from `identityComponents()` and adds its own (a mode, her capabilities,
plumbing and memory)
([agent guide](../../../packages/agent/AGENTS.md#files)). The
[design](../../specs/2026-10-15-identity-gateway-design.md#decisions)
records why the provenance stance replaced the chat persona's earlier,
more discreet one: so that one stance holds everywhere. The identity does
not replace a host's whole system prompt; the host's tool guidance and
conventions stay.

## Carrying her into a host

A host takes her text through whichever slot it has. Three routes exist in
the code or the designs, and they differ in what they write and where.

### The gateway

Built. `@dorothy/gateway` is a loopback server that stands between an
agentic client and the API. The client is pointed at it by its base-URL
setting. It forwards every request, and edits only one kind: a request
whose system prompt carries a marker, `<!-- dorothy:identity -->`, which
the launcher appended to the client's prompt
([guide](../../../packages/gateway/AGENTS.md)). In that request the gateway
removes the marker and the whitespace around it and inserts her identity as
a block of its own after the client's first block that is not a billing
header. If the removed marker left an empty block that carried a cache
breakpoint, the breakpoint moves to the block before it, so the number of
breakpoints holds.

The design chose a gateway over a client feature for two reasons recorded
in the [spec](../../specs/2026-10-15-identity-gateway-design.md#decisions):
a gateway at the HTTP boundary serves any client whose base URL can be set,
and the main thread is told apart by a marker rather than by the shape of a
prompt, which was rejected as fragile across client versions. Its rules are
that it is additive and that it fails safe:

- Only the marker is removed. The billing header, the client's identity
  line, the rest of its text, its messages and its headers stay as sent,
  authorisation included.
- A request without the marker passes byte for byte. A marker present in the
  system prompt that cannot be placed, or a body that cannot be decoded, is
  forwarded unchanged and counted as drift; the launcher says so on stderr
  when the client exits. A marker found only in the messages is a
  conversation quoting it, and is not drift.
- It never records or logs a header or a body, and writes nothing to the
  terminal, which the client owns.
- It learns nothing of memory. The launcher gives it a section, the memory
  block, as opaque text that it places after her identity as given, fixed
  for the launch so the prompt cache holds.
- Responses stream through unchanged. An upstream it cannot reach gets a 502
  in the API's own shape, naming the origin and never credentials.

Only the Anthropic protocol has an adapter,
[`anthropic.ts`](../../../packages/gateway/src/anthropic.ts). An adapter
for the OpenAI dialects was named in the spec's Later section and is not
built; the roadmap's
[Dorothy's Gateway](../../roadmap.md#dorothys-gateway), an idea, would also
route models and enforce budgets through the same package.

The spec and the probes record where the marker lands in Claude Code's
requests, with the version and date: at the end of the last system block,
after a blank line, under that block's one-hour breakpoint, and never in
the messages
([probes](../../reports/2026-10-15-identity-gateway.md#where-the-marker-lands),
Claude Code 2.1.296, 2026-10-15). The design kept three known risks: the
client's own identity line stays, so provenance has to say what it means; a
session begun without the launcher and resumed with it carries no marker; and
a session begun with it and resumed bare sends the marker to the API
([risks](../../specs/2026-10-15-identity-gateway-design.md#known-risks)).
The probes and their later repetition are weighed host by host on
[harnesses](../profiles/harnesses.md#claude-code).

### Session flags and a host's own persona slot

Where a client has no base URL to point, her text goes into the slot the
client reads. The code has two such mechanisms, and the designs name a third.
Which hosts each serves, and their state, is on
[harnesses](../profiles/harnesses.md).

- The Codex launcher: `dorothy --codex` gives her identity as
  `developer_instructions`, followed by the user's own, as session flags
  that write none of Codex's files
  ([hosts guide](../../../packages/cli/src/hosts/AGENTS.md#files)). The
  user's own value is read from Codex's configuration, read-only, because a
  session flag replaces a key rather than adding to it
  ([spec](../../specs/2026-11-01-delivery-design.md#codex)).
- The Hermes install: `dorothy --install hermes` makes a Hermes profile
  named `dorothy` and writes her identity as that profile's `SOUL.md`. The
  user's default profile is left alone. The `SOUL.md` is overwritten only
  where it is still the clone's or still hers by a recorded digest.
- The Pi launcher: `dorothy --pi` runs the published Pi under Node and
  passes her extension by path. The extension adds her identity and her
  capabilities as two sections of Pi's system prompt before each run,
  after Pi's own, because a command-line append would hide Pi's discovered
  `APPEND_SYSTEM.md`
  ([extension guide](../../../packages/cli/assets/pi/AGENTS.md#files)).
  The persona text is a per-launch file in the runtime directory, the
  same `identityPrompt()` text.
- Persona files in a host's own directory: the delivery design's route for
  OpenClaw is `SOUL.md` and `IDENTITY.md`
  ([spec](../../specs/2026-11-01-delivery-design.md#openclaw)). Persona
  files as a protocol are under
  [protocols](../profiles/protocols.md#persona-files).

These routes and the gateway carry the same text, because all read
`identityPrompt()`. The delivery design records that rule: one source for
her persona.

### What a host is given beside her identity

Persona is only one of the three things a host is given. The others are the
opening memory block and recall for each prompt, and her tools. They are
explained for what they carry on [memory](./memory.md); only the mechanism
is described here.

- One hook command serves every host that speaks Claude-shaped hooks:
  `dorothy --hook <host> <event>` reads the host's JSON payload on standard
  input and writes its JSON reply, with `session-start` returning the
  opening block and `prompt` returning recall for that prompt, both as
  `additionalContext`. A function per host maps its payload to a request on
  the memory contract, tested on recorded fixtures. The command fails open:
  no service, a timeout or a refused request gives an empty reply and exit
  0, so a fault in memory never blocks a host
  ([delivery spec](../../specs/2026-11-01-delivery-design.md#the-hook-command)).
- Hosts run it through `selfCommand`, this program as
  `bun --no-env-file <entry>`, so that a project's `.env` never reaches a
  hook, and an install writes the main checkout's entry, never a worktree's,
  which may be removed
  ([cli guide](../../../packages/cli/AGENTS.md#files)).
- Her tools are one MCP server, offered to a host by a flag or a profile
  key. See [MCP](../profiles/protocols.md#mcp) for the protocol.
- Claude Code has its own route for the block: the launcher gives the
  gateway the block as its section. The delivery design left that as it
  was and shares the block and recall rendering with it, so the two cannot
  drift. The spec and `claude-code.json` list `hook` among its delivery
  mechanisms while the block goes by the gateway; the code is the
  authority, as [harnesses](../profiles/harnesses.md#claude-code) says.
- A host's own memory is switched off in her sessions, so hers is the one
  that writes (Claude Code's auto memory, Codex's two memory keys, two
  Hermes profile keys).
- Pi has a hook of its own, not Claude-shaped: her extension runs
  `dorothy --pi-hook`, one JSON request on standard input and one reply
  on standard output, for the opening block, recall and records
  ([hooks guide](../../../packages/memory/src/hooks/AGENTS.md#files)).
  It fails open with stable warning codes. Her tools are the same MCP
  server, registered by the extension, and the provider's key is taken
  out of Pi's environment when the extension loads, before any command
  or server Pi spawns can inherit it.

Launchers and installs write nothing the user holds. The design ruled that
only `--install`, run by the user, writes a host's files, and that a
launcher uses session flags alone. Codex keeps a trust state for each hook;
the launcher says it will ask, and never passes the flag that would bypass
trust for every hook in every repository.

Each host has a host profile, data in
[`packages/memory/src/hosts/`](../../../packages/memory/src/hosts/): a block
budget, a recall budget and a list of delivery mechanisms. A profile is not
a delivery; the list of hosts that are delivered to is on harnesses.

## Recording: how a host's sessions come back

A session of hers in a host is only remembered when it reaches her archive.
Two mechanisms do it, and they are one conversation per host session
(for Pi, per branch) whichever records it.

- Hooks, for the launcher Claude Code has: with `[memory]` enabled, the
  launcher passes `Stop` and `SessionEnd` hooks that run
  `dorothy --claude-hook`, which records each reply and reviews the
  conversation.
- The sweep, for the rest, and for Claude Code sessions begun outside her
  launcher. The memory service reads each host's own session store on a
  schedule, and one command, `dorothy --sweep`, runs a pass in the
  foreground. A reader per host turns what is new into her events:
  Claude Code's transcripts, Codex's rollout files and each Hermes
  profile's `state.db`. Events carry the host's own ids, so a session read
  twice records each event once.
- Pi uses both. Its extension's hook records each settled turn and the
  end through the service, and the sweep reads Pi's saved JSONL below
  Dorothy's own session directory alone, never a global scan. A fork's
  entries stay with the segment that first held them, and a fork whose
  parent cannot be resolved is held, not guessed
  ([Pi source guide](../../../packages/memory/src/recording/AGENTS.pi.md)).

The design ruled the sweep over hooks because it needs no change to a
host's configuration, at the cost of a lag of up to one interval
([recording spec](../../specs/2026-10-20-recording-design.md#decisions)).
The delivery design then ruled against recording hooks for Codex and Hermes
([ruling 10](../../reports/2026-11-01-delivery.md#rulings)). Other rules of
the sweep:

- Hosts are opt-in. `[recording] hosts` is empty by default, so nothing is
  read until the user lists a host.
- The first sweep of a host records a watermark. Sessions that finished
  before it are left to the backfill, `dorothy --sweep --backfill`, which
  the user runs and which records them without a paid review each.
- A session its host marks private is not recorded. The rule is a seam:
  no host currently reports a session as private (`isPrivate` is
  `() => false` in
  [`recording.ts`](../../../packages/memory/src/service/recording.ts)), and
  the code leaves a place for OpenClaw's incognito marking.
- A session that cannot be read halts at its first bad record: what
  precedes it is recorded, the rest kept aside and the user told.

The recording design leaves OpenClaw's reader until it is installed and
its store probed. How recording is stored, reviewed and
searched is on [memory](./memory.md), and the readers' invariants are in
the [recording guide](../../../packages/memory/src/recording/AGENTS.md).
What each reader has met is on [harnesses](../profiles/harnesses.md).

## Mechanisms and what lies outside them

- The mechanisms above: the identity text and its pin; the gateway and its
  Anthropic adapter; the Claude Code launcher; the Codex launcher; the
  Hermes install and provider; the Pi launcher, extension and hook; the
  hook command; and the sweep with its readers.
- Not a mechanism yet: an OpenAI-protocol adapter for the gateway, named in
  the identity spec's Later section.
- Out of scope by the identity design: removing or rewriting anything a
  client sends beyond the marker, and subagents' prompts, which stay the
  client's own
  ([spec](../../specs/2026-10-15-identity-gateway-design.md#out-of-scope)).
- Which host each mechanism serves, what has been run against the real
  host and what waits on the user: see
  [harnesses](../profiles/harnesses.md).

## Records

Every dated record of this subject, by kind and oldest first, is under
[identity, harnesses and delivery](../records.md#identity-harnesses-and-delivery).
The design and its evidence:

- [Identity design](../../specs/2026-10-15-identity-gateway-design.md),
  its [probes](../../reports/2026-10-15-identity-gateway.md) and the
  [implementation report](../../reports/2026-10-15-identity-gateway-implementation.md).
- [Delivery design](../../specs/2026-11-01-delivery-design.md) and its
  [report](../../reports/2026-11-01-delivery.md).
- [Recording design](../../specs/2026-10-20-recording-design.md) and its
  [report](../../reports/2026-10-20-recording.md).

## Related

- [Harnesses](../profiles/harnesses.md)
- [Memory](./memory.md)
- [Protocols](../profiles/protocols.md)
- [Packages](../profiles/packages.md)
- [Decisions](../decisions.md)
- [Problems](../problems.md)
