---
ctime: 2026-11-03
mtime: 2026-11-03
spdx: GPL-3.0-only
title: Services and providers
description: >-
  The external systems Dorothy's records weigh, model providers, routers,
  libraries, memory systems, platforms and tools, each marked used,
  proposed or compared, with every price and term dated.
tags:
  - wiki
  - profiles
  - providers
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/wiki/profiles/services-and-providers.md
   -
   -->

# Services and providers

[Wiki home](../../README.md)

This page profiles the external systems that Dorothy's code uses or her
records weighed. It is not a directory of everything in the field. Each
profile is marked:

- Used: named in code or configuration under `packages/*/src` or in the
  repository's own configuration.
- Proposed: a spec or the roadmap chooses it, and it is not in code.
- Compared: research weighed it and nothing chose it.

Every price, term, model or availability claim keeps the date of the record
it comes from and is a historical statement, never advice for today. The
page was written from the records alone; nothing was looked up on the web
for it, so a fact needed now must be checked at the provider. Routing
itself, the five provider kinds and the fallback, is explained under
[models and routing](../records.md#models-and-routing); the code is in the
[`agent`](./packages.md#agent) and [`core`](./packages.md#core) packages.
The wire formats are on [protocols](./protocols.md), and the four hosts on
[harnesses](./harnesses.md).

## Anthropic

Used. Dorothy's first provider and the default of every role.

- The runtime reaches the Messages API with `ANTHROPIC_API_KEY`: chat
  `claude-opus-5-5`, review and compaction `claude-sonnet-5-5`,
  maintenance `claude-haiku-5-5`, as constants in
  [`routes.ts`](../../../packages/core/src/models/routes.ts).
- Prices are in a table in
  [`prices.ts`](../../../packages/core/src/models/prices.ts), copied from
  Anthropic's pricing page on 2026-11-01: Opus 5.5 at $4 in and $20 out
  per million tokens that day, Sonnet 5.5 at $2 and $10. Cache reads on
  those two are 0.05 of input; the live run of 2026-11-01 corrected a
  bundled reference that had Sonnet's at twice that
  ([report](../../reports/2026-11-01-model-providers.md#prices)).
- The Agent SDK, which spawned the Claude Code CLI on a subscription's
  token, was her runtime until the model providers phase, and is
  superseded: no package declares it, which `workspace.test.ts` pins. The
  reason, as the spec of 2026-11-01 gave it, is that the CLI added its own
  context, and that Claude Code's legal page, as read that day, asks
  developers using the Agent SDK to use API key authentication
  ([spec](../../specs/2026-11-01-model-providers-design.md#summary)).
  The research of 2026-10-18 had read the same page as neither clearly
  forbidding nor permitting one person's own use
  ([terms](../../notes/2026-10-18_open-source-replacements.md#anthropics-terms)).
- The same research reported that from 2026-10-07 Max plans include API
  credits worth $100 or $200 a month that cover the Agent SDK with an API
  key; the spec took them as the first spend. It is that note's claim, as of
  2026-10-18.
- A subscription is used where the terms are read to allow it:
  `dorothy --claude` runs the user's own `claude` login behind her gateway,
  and the evaluation's `via = "claude"` route drives the `claude` CLI
  ([README](../../../README.md#measuring-her-memory)).

The user's reason for wanting more than Anthropic is recorded: the
conversation of 2026-11-01 begins from Anthropic's content limits and a
wish for open weights, and asks where work beyond its policy could go
([note](../../notes/2026-11-01_claude-conversation-anthropic-vs-openai.md)).

## OpenRouter

Used. A hosted router, the first fallback the specs name.

Provider kind `openrouter`, fixed at its API root, sends
`data_collection: "deny"` and `zdr: true` on every request, so that only
endpoints that keep no prompts answer, and `require_parameters` on
structured calls
([`providers.ts`](../../../packages/agent/src/providers.ts)). Its cost for
each call comes from its own response. The live run of 2026-11-01 routed
the chat, reviews and compactions through it behind a rate-limited
stand-in and found her costs agreeing with OpenRouter's own count (chat $0.0006
and memory $0.0019 shown, $0.0025 for the day; the model that day was
`deepseek/deepseek-v4.1-flash-1017`, which had 31 endpoints on its
zero-retention list)
([report](../../reports/2026-11-01-model-providers.md#the-live-run)).

The research of 2026-10-18 described it as no markup on provider prices,
5.5% on card purchases, with a `models` array for fallback and no prompt
logging by default
([gateways](../../notes/2026-10-18_open-source-replacements.md#gateways)).
Dorothy does the fallback herself, so the array is not used.

## featherless.ai

Used. A host of open-weight models behind Chat Completions, the lane for
work beyond Anthropic's policy. The terms are the part most likely to
have moved; read them dated.

- Code: provider kind `featherless`, root fixed at
  `https://api.featherless.ai/v1`, priced by the entry's own `price`.
- Prompts: "Prompts stored: Never" is how the spec of 2026-11-01 states why
  it may receive her requests, on its paid API plan.
- The plans, from featherless's own pricing page as read on 2026-11-02: Chat
  at $25 a month, flat, 32K context, 4 units of concurrency, "not for
  production API or coding agents"; Developer at $50 of credits a month,
  per token, up to 256K, 100 units; Business by contract. The user
  confirmed the new key was on Developer that day
  ([log](../../notes/2026-11-02_featherless-orchestrator.md#the-account)).
- The earlier key reported `feather_pro_plus` with 4 units, which the log
  matches to Chat. In the live run of 2026-11-01 a review and a chat turn
  collided on it: GLM-5.3-Flash cost 4 units a request, and the chat was
  refused with "Concurrency limit exceeded"
  ([report](../../reports/2026-11-01-model-providers.md#findings)).
  The README advises a second entry in a role's list.
- Billing, from the pricing conversation of 2026-11-01: the Developer plan
  is a credit balance rather than a fee on top of usage, credits do not
  expire, and a Pay-As-You-Go tier appears in the plans documentation but
  not in the account portal. Whether it exists was left unconfirmed, and a
  support email was drafted
  ([note](../../notes/2026-11-01_claude-conversation-featherless-pricing.md)).
- Models, from `GET /v1/models` on 2026-11-02: ten with 262,144 or 131,072
  tokens of context, GLM-5.3-Flash at $0.15 in and $0.50 out per million
  among them. Native tool calling was documented for the Qwen 3 family
  only, yet all ten made the right native call in 10 of 10 probes there.

The records disagree about the plan. The conversation of 2026-11-01 on
Anthropic against OpenAI, citing third-party sites, describes Basic at $10
and Pro at $25 a month with unlimited tokens
([note](../../notes/2026-11-01_claude-conversation-anthropic-vs-openai.md#featherless-yes-for-this-lane)).
The pricing conversation of the same day, the replacements research of
2026-10-18 and the log of 2026-11-02, which read featherless's own page,
say instead that the $25 plan excludes API use. This page follows the
latter three. It does not know which description was right on either date.

## Hugging Face's router

Used. Hugging Face's Inference Providers, one API in front of many hosts.

Provider kind `huggingface`, root fixed at `https://router.huggingface.co/v1`.
The user ruled on 2026-11-01, after the spec was approved, that it take
any provider the router chooses, so this kind alone is not held to no
retention: some providers behind it may keep prompts, and a suffix such as
`org/model:featherless-ai` chooses one
([spec](../../specs/2026-11-01-model-providers-design.md#decisions)).
Per the two conversations of that day, Hugging Face stated it stores no
request or response bodies when routing and keeps debugging logs for up to 30
days; it adds no markup to partner rates; PRO was $9 a month with $2 of
inference credit. The conversation weighed it as the route with the least
friction for a user with credits, at the cost of a catalogue synced hourly
and a second party in the path
([note](../../notes/2026-11-01_claude-conversation-featherless-pricing.md)).
The live run priced `zai-org/GLM-5.3-Flash:deepinfra` at $0.15 and $0.50
on 2026-11-01.

## Local servers

Used as a kind; untested against a real server. Provider kind `local` takes
a required loopback `base-url`, an optional key and Chat Completions, so
that nothing leaves the machine. The README's example is Ollama; the code
names no server, only the port its validation example uses. The report of
2026-11-01 says the `local` kind "was reached only as the stand-in: the user
has no local model"
([report](../../reports/2026-11-01-model-providers.md#the-live-run)).

Other local servers, llama.cpp, vLLM and LM Studio, were noted by the
research of 2026-10-18 as serving the Messages API or Chat Completions; she
has not been run on them.

## OpenAI and ChatGPT

Used for the evaluation only, through a subscription; compared as an API.
No provider kind reaches OpenAI.

- Used: the evaluation's `via = "codex"` route drives the `codex` CLI on the
  user's ChatGPT plan, so that "Claude and ChatGPT plans come first". The
  first evaluation judged with GPT-6.1 Sol through Codex and drafted
  questions with both vendors' models (2026-10-31)
  ([report](../../reports/2026-10-31-first-evaluation.md#the-runs)). The
  hosts are on [harnesses](./harnesses.md#codex).
- Compared as a provider: the conversation of 2026-11-01 asked whether
  OpenAI would serve better than Anthropic for work Anthropic declines, and
  concluded not much: OpenAI's hosted stance was closer than its reputation,
  its open-weight gpt-oss models were Apache-2.0 (released August 2025), and
  the closed models were as closed as Claude
  ([note](../../notes/2026-11-01_claude-conversation-anthropic-vs-openai.md#short-answer)).
  Its sources were third-party; the conversation marks its own read of
  OpenAI's adult-content policy as not a stated rule.

## Other model sources

Compared; none is a provider kind. The research of 2026-10-18 listed cheaper
models that serve the Messages API or Chat Completions: DeepSeek, Moonshot
(Kimi), MiniMax, Alibaba's Qwen and Z.ai's GLM, most of whose coding plans
forbid the use a persona assistant would make of them
([table](../../notes/2026-10-18_open-source-replacements.md#cheaper-models)).
Its prices, such as DeepSeek's flash model at $0.15 in and $0.60 out off-peak,
are of that day. Their models do appear in the records as models behind
featherless and OpenRouter, where they were probed, not as providers.

The conversation of 2026-11-01 also named RunPod, renting a GPU by the
second behind an OpenAI-compatible vLLM API, as an escape hatch for a
checkpoint no host serves, and, for content policy and open weights, xAI and
Mistral. None was built or chosen.

## Model libraries and frameworks

- Vercel AI SDK 7: used. `agent` is the one package that declares `ai`, the
  Anthropic, OpenAI-compatible and OpenRouter provider packages and the MCP
  client, which `workspace.test.ts` pins. The research of 2026-10-18 named it
  the best replacement for `agent`, and the spec chose it, probing it under
  Bun first; the probe passed
  ([gateways](../../notes/2026-10-18_open-source-replacements.md#libraries-for-the-model-side),
  [report](../../reports/2026-11-01-model-providers.md#the-probe)).
- LangChain: used in the evaluation only. `eval` declares `openevals`,
  `@langchain/core` and `@langchain/openai`; the judges are openevals'
  LLM-as-judge, and tracing is switched off so that her data never goes to
  LangSmith
  ([`client.ts`](../../../packages/eval/src/models/client.ts)). For her own
  runtime the spec ruled LangChain.js out, because it brings message and
  graph state beside her JSONL; its middleware list serves as a checklist
  ([spec](../../specs/2026-11-01-model-providers-design.md#decisions)).
- pi: compared and ruled out. The replacements research recommended
  rebuilding her body on it, and the minutes of 2026-10-18 superseded that:
  pi is not to be used
  ([minutes](../../reports/2026-10-18-protocol-diversity.md#rulings)).
- The OpenAI Agents SDK, Mastra, and the two vendors' own SDKs were also
  tabulated and not chosen.

## Gateways and routers

Compared. The replacements research of 2026-10-18 found nothing open-source
that does what `@dorothy/gateway` does, replacing one marker in Claude Code's
system prompt and forwarding the rest byte for byte, because routers that
inject a prompt parse and re-serialise the request
([gateways](../../notes/2026-10-18_open-source-replacements.md#gateways)). It
tabulated LiteLLM, claude-code-router, Bifrost, agentgateway, Agent Router
and Portkey for routing, fallback and budgets, and Dorothy builds her fallback
in `core` instead of adopting any of them. The roadmap's Dorothy's Gateway, an
Idea, would extend her own gateway to the OpenAI dialects
([budgets note](../../notes/2026-10-07_budgets-gateway.md)).

## Memory systems

Compared. The question was whether a memory provider should sit over her
archive, and which. The memory engine report of 2026-10-31 ruled that the
engine stays hers, and the evaluation's systems are `dorothy`, `lexical`,
`full` and `cited`: `makeSystem` refuses any other name, so none of the
following has been run
([report](../../reports/2026-10-31-memory-engine.md#the-decision),
[`systems.test.ts`](../../../packages/eval/src/systems/systems.test.ts)).

The research of 2026-10-18 scored the field on the user's four priorities
and named the candidates; its scores are the research agent's judgement, and
its published results nearly all vendors' own
([scored](../../notes/2026-10-18_open-source-replacements.md#the-systems-scored),
[candidates](../../notes/2026-10-18_open-source-replacements.md#the-candidates)):

- Hindsight, OpenViking, EverOS and Honcho, the four candidates; Hindsight
  was the one to beat and the roadmap's later work names adapters for all
  four plus an improved Dorothy
  ([roadmap](../../roadmap.md#candidates)).
- Graphiti, held in reserve for facts that change; agentmemory, noted for
  breadth of native harness plugins.
- Letta's MemFS, Mastra's observational memory, lossless-claw and
  hermes-lcm, mem0, MemPalace, qmd, Basic Memory, memsearch and
  supermemory, each bound to a framework, narrow or failing a priority.

The earlier comparison of 2026-10-15 set Hermes Agent, OpenClaw, Letta,
claude-mem, Mastra, mem0, Graphiti, basic-memory and Anthropic's memory tool
against her store's spec, to see what to take
([comparison](../../notes/2026-10-15_memory-systems-comparison.md)). The
engine's later work, a chunk index or an adapter to the field's engines
behind the contract, starting with Hindsight, is a roadmap candidate, not a
decision ([engine spec](../../specs/2026-10-31-memory-engine-design.md#later)).

## Assistant platforms

Compared. Hermes Agent and OpenClaw are hosts she is delivered to, and are
profiled on [harnesses](./harnesses.md); the objectives of 2026-10-15 had
asked which of them should host her. The minutes of 2026-10-18 ruled that
no one harness does. The replacements research tabulated, as platforms that
might replace or host her, Letta Code, nanobot, SillyTavern, LibreChat, Open
WebUI, AnythingLLM and LobeHub, and weighed Hermes to replace her, OpenClaw
to host her code and Letta Code for files in git
([platforms](../../notes/2026-10-18_open-source-replacements.md#the-platforms)).
None was chosen. The other terminal harnesses it surveyed, OpenCode, Qwen
Code, Goose and the rest, are in the same research; four of them have host
profiles in `packages/memory/src/hosts/` as data, without delivery.

## Cross-harness generators and parsers

Compared. rulesync, MIT, writes rules, MCP, hooks and skills from one tree to
about 45 hosts, and by policy leaves persona files alone; the research of
2026-10-18 judged it the right generator and a fragile dependency, with one
owner and, by the minutes, 27 releases in the month to 2026-10-17 (the
research report counts 21 major versions in 29 days)
([cross-harness](../../reports/2026-10-18-protocol-diversity/cross-harness.md#bottom-line)).
The delivery spec ruled "not adopted now": launch flags and a profile of her
own write no key the user holds. That ruling was the coordinating agent's,
with the user away, and rulesync stays listed for hosts beyond the four
([delivery spec](../../specs/2026-11-01-delivery-design.md#decisions)).
Letta's `trajectory` transcript parser, Hindsight's adapters and the
`ruler` configuration tool were named in the same research and not adopted.

## Secrets and repository tools

- sops with age: used. `secrets.json` is encrypted to an age key, which
  `core` shells out to `sops` to read
  ([`secrets.ts`](../../../packages/core/src/secrets.ts); the
  [spec](../../specs/2026-10-21-sops-secrets-design.md#decisions)). It
  replaced dotenvx, whose private key a paid service held; dotenvx is
  superseded and nothing reads `.env`.
- herdr: used, not as a runtime dependency. The repository declares its
  skill in `package.json`, and the stewardship skill coordinates agents
  through it, typing into their terminals. Orchestration was designed to
  replace that coordination with ACP, and the roadmap holds a registry of
  herdr agents as a candidate
  ([note](../../notes/2026-11-01_agent-orchestration.md#today),
  [candidates](../../roadmap.md#candidates)).
