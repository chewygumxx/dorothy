---
ctime: 2026-11-03
mtime: 2026-11-03
spdx: GPL-3.0-only
title: Protocols
description: >-
  The protocols and formats in Dorothy's architecture and proposals, MCP,
  the model APIs, the host hook payloads, ACP and the standards the
  research weighed: where she uses each and its adoption state.
tags:
  - wiki
  - profiles
  - protocols
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/wiki/profiles/protocols.md
   -
   -->

# Protocols

[Wiki home](../../README.md)

Dorothy is built to speak standard protocols, with any SDK's types at a
thin edge (the rule is in the root
[AGENTS.md](../../../AGENTS.md#working-rules)). This page profiles each
protocol or format the architecture uses or a proposal names: what it is,
where she meets it, and its state. The states are built (code and tests
exist), designed (a spec chooses it, nothing is in code), and compared
(research weighed it and nothing chose it). Which host is delivered what
is not repeated here; [harnesses](./harnesses.md) holds each host's state.
The external services behind these protocols are on
[services and providers](./services-and-providers.md).

Counts, versions and adoption figures below are the research's, dated on
each paragraph; none is a claim about today.

## MCP

Model Context Protocol, the one protocol every Dorothy surface shares.
State: built.

Her memory is offered to every harness as an MCP server, because MCP
reaches all twelve harnesses the
[cross-harness research](../../reports/2026-10-18-protocol-diversity/cross-harness.md#the-smallest-set-that-reaches-every-target)
surveyed (2026-10-18). She uses it in three places:

- Her own chat starts `dorothy --recall-server`, an MCP server on stdio,
  for each session; `agent` connects to it as an MCP client through the AI
  SDK's `@ai-sdk/mcp`
  ([`recall-tools.ts`](../../../packages/agent/src/recall-tools.ts)).
- The memory service speaks MCP over Streamable HTTP, on loopback and on
  any address in `[service] listen`, with device tokens beyond loopback.
  Its contract tools are `brief`, `search`, `open` and `remember`
  ([the contract guide](../../../packages/memory/src/contract/AGENTS.md#files)).
- `dorothy --mcp` is a stdio bridge to that service, for hosts that only
  launch processes, so every harness's writes pass through one process
  ([`bridge.ts`](../../../packages/memory/src/service/bridge.ts)). Codex
  and Hermes are given it as a server in their configuration.

Only `memory` imports `@modelcontextprotocol/sdk`; `agent` imports the AI
SDK's client. Each host profile caps the server's `instructions` text (512
characters for Codex, 2,048 for the others) because the hosts weigh it
differently
([profiles](../../../packages/memory/src/hosts/)). Where the memory is
served, and what a recall may return, is explained under
[memory](../topics/memory.md).

What MCP does not give her is a memory model: the research found no memory
capability in the specification, with the memory proposals to the protocol
closed or stale (2026-10-18), so memory over MCP stays tools that each
server names itself
([protocols table](../../reports/2026-10-18-protocol-diversity/langchain-and-standards.md#protocols)).
The orchestration design also relies on MCP elicitation to put a worker's
permission request in front of the user; that is designed, not built (see
[ACP](#acp-and-the-agents-own-protocols)).

## The Anthropic Messages API

The wire protocol of Claude and of a long list of clones. State: built, on
both sides of Dorothy.

- As a client: provider kind `anthropic` reaches the Messages API through
  `@ai-sdk/anthropic` with an API key, sending a cache breakpoint on the
  system prompt
  ([`providers.ts`](../../../packages/agent/src/providers.ts)). The design
  is the
  [model providers spec](../../specs/2026-11-01-model-providers-design.md).
- As a proxy: `@dorothy/gateway` forwards Claude Code's Messages requests
  and puts her identity in the place of a marker in the system prompt,
  everything else byte for byte
  ([the gateway guide](../../../packages/gateway/AGENTS.md)). The gateway
  names an OpenAI adapter as a place it could grow, not as existing.
- As a base URL: an `anthropic` entry may name a loopback `base-url`, so
  that a loopback proxy, her gateway among them, can stand between her and
  the API; it replaces the hook's `DOROTHY_ANTHROPIC_BASE_URL`
  ([spec](../../specs/2026-11-01-model-providers-design.md#decisions)).
  The AI SDK's Messages client was exercised against a stand-in Messages
  server in the plan's first probe
  ([report](../../reports/2026-11-01-model-providers.md#the-probe)).

Clones matter for a later choice only. The conversation of 2026-11-01
counted 12 of 20 surveyed providers documenting an Anthropic-compatible
endpoint, OpenRouter, Ollama, LM Studio and vLLM among them, and warned
that prompt caching and extended thinking usually do not carry over
([the note](../../notes/2026-11-01_claude-conversation-anthropic-vs-openai.md#you-dont-have-to-give-up-the-messages-api)).
Dorothy did not use clones: her other kinds speak Chat Completions.

## OpenAI Chat Completions

The common denominator of the other provider kinds. State: built.

`openrouter`, `featherless`, `huggingface` and `local` entries all go over
Chat Completions: `featherless`, `huggingface` and `local` through
`@ai-sdk/openai-compatible`, and `openrouter` through its own provider
package, with strict compatibility so that a stream reports its usage
([`providers.ts`](../../../packages/agent/src/providers.ts)). The evaluation
also reaches any OpenAI-compatible endpoint for an `api` route, through
LangChain's `ChatOpenAI`
([`client.ts`](../../../packages/eval/src/models/client.ts)).

The conversation of 2026-11-01 called Chat Completions the de facto
standard that virtually every provider and local server implements, which
is why one adapter covers featherless, Hugging Face's router and a rented
GPU alike. Its limits show in the records: Chat Completions kinds are sent
no output limit, so a provider's default applies, and a reasoning model
spent featherless's whole 4,096 on thinking in the live run of 2026-11-01
([model providers report](../../reports/2026-11-01-model-providers.md#findings-1)).

## The OpenAI Responses API and Open Responses

The newer OpenAI interface, and the vendor-neutral specification built on
it. State: not used; compared, with a roadmap idea that would need it.

Dorothy speaks neither today. The research of 2026-10-18 found that Codex
accepted only `wire_api = "responses"` since February 2026, so serving
Codex from a proxy of hers would need this dialect; the roadmap's
[Dorothy's Gateway](../../roadmap.md#dorothys-gateway), status Idea, names
"the Anthropic and OpenAI protocols" without choosing a dialect
([gateways research](../../notes/2026-10-18_open-source-replacements.md#verdict)).
The log of 2026-11-02 added that featherless answered `POST /v1/responses`
with 404 that day, and that Codex could therefore not use it directly
([the log](../../notes/2026-11-02_featherless-orchestrator.md#the-account)).

Open Responses, an Apache-2.0 specification with conformance tests,
launched 2026-01 and was TC-approved into the Agentic AI Foundation with
paperwork pending (2026-10-18). The research called it one of three
dialects a persona proxy must speak, beside Messages and Chat Completions
([the table](../../reports/2026-10-18-protocol-diversity/langchain-and-standards.md#protocols)).

## Host hook payloads

The JSON a host sends a command when something happens in a session. Each
host's differs; Dorothy reads three, and states are per host.

- Claude Code: `dorothy --claude` passes `Stop` and `SessionEnd` hooks
  running `dorothy --claude-hook`. The payload's `hook_event_name`,
  `session_id`, `transcript_path` and `cwd` are all it reads, and an
  unreadable one is skipped
  ([`hook.ts`](../../../packages/memory/src/bodies/hook.ts)). Built, and
  checked on a real Claude Code (see [harnesses](./harnesses.md#claude-code)).
- Codex: `dorothy --hook codex <event>` is run by Codex's `SessionStart`
  and `UserPromptSubmit` hooks, reading `session_id`, `cwd`, `source` and
  `prompt`, and answering in Codex's `additionalContext` shape
  ([`payload.ts`](../../../packages/memory/src/hooks/payload.ts)). Built and
  tested; the payload shape came from the strings of Codex 0.165.0's
  binary, so it awaits a live check
  ([harnesses](./harnesses.md#codex), the
  [fixtures](../../reports/2026-11-01-delivery/probes.md#fixtures)).
- Hermes: her Python provider sends the same shape to the same command.
  The payloads are her own, not Hermes's
  ([probes](../../reports/2026-11-01-delivery/probes.md#fixtures)).

Hook payloads are not a standard. The research (2026-10-18) found
Claude-shaped command hooks in Claude Code, Codex, Qwen Code, Letta Code
and Gemini CLI, and no cross-harness hook manager at all
([cross-harness](../../reports/2026-10-18-protocol-diversity/cross-harness.md#bottom-line)),
which is why each host's reader is her own code. Whether Claude Code's
`--claude-hook` folds into `--hook` is listed as later work in the
[delivery spec](../../specs/2026-11-01-delivery-design.md#later).

## Agent Skills and AGENTS.md

The two conventions that reach harnesses without any protocol. State:
built, for the repository's own use.

- `SKILL.md`, Agent Skills: the repository's skills sit in
  `.agents/skills/`, declared in `package.json` and `skills-lock.json` and
  linked by `bun run skills`, as the root
  [AGENTS.md](../../../AGENTS.md#commands) says. The research of
  2026-10-18 advised adopting it for her skills: stable, with progressive
  disclosure built in, and in the client showcase of Hermes and OpenClaw.
- `AGENTS.md`: the project instructions every package carries. The same
  research reported that Claude Code reads it since 2.1.277 when no
  `CLAUDE.md` exists, by secondary sources.

Both carry instructions and capabilities; neither fills a host's persona
slot, so neither gives a host her identity
([the standards](../../reports/2026-10-18-protocol-diversity/langchain-and-standards.md#instructions-skills-and-plugins)).
The asset conventions are decided in the
[agentic asset refactor spec](../../specs/2026-10-11-agentic-asset-refactor-design.md).

## Persona files

The host-specific files that carry her identity. State: per host.

`SOUL.md` is a convention, not a standard: OpenClaw and Hermes each read a
file of that name, with different meanings, and a proposal to make it a
specification was declined by the Agentic AI Foundation on 2026-05-15
(research of 2026-10-18)
([the persona formats](../../reports/2026-10-18-protocol-diversity/langchain-and-standards.md#persona-formats)).
Dorothy writes Hermes's, as the `SOUL.md` of her own profile: built, awaiting
a live check. OpenClaw's, with `IDENTITY.md`, is designed and not built. For
Claude Code she uses a marker in the system prompt, and for Codex a
`developer_instructions` flag. All of these are on
[harnesses](./harnesses.md); the ruling that one definition is generated
into each host's own files is in the
[protocol-diverse minutes](../../reports/2026-10-18-protocol-diversity.md#rulings).

Character Card V2 and V3 are the only widely shared persona interchange
the research found (2026-10-18), frozen since 2023 and 2024. They were
weighed as one more export target and not chosen.

## ACP and the agents' own protocols

The Agent Client Protocol, which Zed originated, and the protocols
Claude Code and Codex offer a program. State: designed for orchestration;
compared for recording.

For orchestration, the note of 2026-11-01 found that neither agent speaks
ACP natively, that community adapters give both a `session/request_permission`
whose options are answered by id, and that `acpx` (OpenClaw's headless
ACP client, pre-1.0 on that date) lets an embedding host decide each
request live. The agents' own routes were the alternative: Claude Code's
`stream-json` with `--permission-prompt-tool`, and Codex's `app-server`,
JSON-RPC over stdio, which the note found labelled experimental
([the note](../../notes/2026-11-01_agent-orchestration.md#the-shared-protocol-acp)).
The [orchestration spec](../../specs/2026-11-02-orchestration-design.md#decisions)
designs acpx's embedded runtime with ACP for both workers, served to a
client over MCP stdio, with MCP elicitation reaching the user.

That is a design only. The roadmap has no ordered phase for it as of
2026-11-03, there is no `@dorothy/orchestra` package in `packages/`, and
any prototype is local and unmerged and is not cited here, so nothing on
this page treats orchestration as built. The orchestration subject is under
[records](../records.md#orchestration).

For recording, the cross-harness research (2026-10-18) proposed an ACP
client as the one recorder for sessions Dorothy launches herself, and the
standards report counted 43 agents on ACP's list that day. That is research,
and no ACP code exists in `packages/`.

## A2A and message provenance

Agent-to-agent tasks, and how one agent knows who sent a message. State:
compared; named in the roadmap as the way a candidate may be settled.

A2A is an Apache-2.0 protocol whose proposal to the Agentic AI Foundation
closed approved on 2026-08-04, which the research found carries no memory
or persona model and judged useful, later, for exposing her as a peer
(2026-10-18). The
[2026-10-15 note on OpenClaw and Hermes](../../notes/2026-10-15_claude-conversation-openclaw-hermes-agent.md)
reported that Hermes ships a plugin for it; this page has not checked
that.

Her own need is smaller. Text one agent sends another through herdr
arrives as if typed by the user, and the roadmap's
[candidates](../../roadmap.md#candidates) leave message provenance to be
settled later "by A2A, Agent Delegation Receipts or both" (the user,
2026-10-31). The consolidation spec calls Agent Delegation Receipts an IETF
proposal and A2A unable to carry typed text over
([the spec](../../specs/2026-10-31-agentic-asset-consolidation-design.md)).
Nothing is chosen.

## Interchange standards for definitions, memory and sessions

The formats that might have let one agent definition, one memory or one
session move between systems. State: compared, none adopted.

The research of 2026-10-18 reached the same conclusion each way
([standards](../../reports/2026-10-18-protocol-diversity/langchain-and-standards.md#b-standards-for-portable-agents-personas-and-interoperability)):

- Definition formats (Open Agent Spec, Letta's Agent File, Microsoft Agent
  Framework's declarative agents) compile one agent to frameworks, not to
  the harnesses Dorothy must reach, and were to be avoided as her
  definition.
- Memory and session interchange has no standard with adoption. Google's
  Open Knowledge Format v0.2, Markdown with YAML frontmatter and
  provenance, was the closest shape to her facts, young and of
  unverified adoption. The W3C community group and the arXiv proposal for
  portable memory were noted, and a memory working group had only been
  proposed to the foundation on 2026-10-15.
- Session recording has no format either. The nearest were ACP's update
  stream, OpenTelemetry (Claude Code can export prompts and replies, by its
  documentation as read then), and Letta's `trajectory` transcript parser.
  Dorothy reads each host's own files with her own readers.
- The contract spec lists OKF's `index.md` and `log.md` as later work for
  her knowledge directory; the roadmap carries it among its
  [candidates](../../roadmap.md#candidates).

Plugin and registry formats (Agent Plugins, the MCP registry, AGNTCY and
OASF) were also weighed and marked minor or off target for a personal
assistant. The generators that write one configuration into many hosts,
such as rulesync, are tools and not protocols; they are on
[services and providers](./services-and-providers.md#cross-harness-generators-and-parsers).

## Related

- [Harnesses](./harnesses.md)
- [Identity, harnesses and delivery](../topics/identity-and-harnesses.md)
- [Models and routing](../topics/models-and-routing.md)
- [Services and providers](./services-and-providers.md)
- [Orchestration](../topics/orchestration.md)
- [Memory](../topics/memory.md)
