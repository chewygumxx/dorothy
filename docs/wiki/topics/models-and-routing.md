---
ctime: 2026-11-03
mtime: 2026-11-03
spdx: GPL-3.0-only
title: Models and routing
description: >-
  How Dorothy's own model calls are made and routed: her runtime, the
  four roles, the five provider kinds, routes, fallback and cooldowns, what
  fallback does once a turn has had effects, and how cost is accounted.
tags:
  - wiki
  - models
  - routing
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/wiki/topics/models-and-routing.md
   -
   -->

# Models and routing

[Wiki home](../../README.md)

Dorothy's own model calls, her chat, her reviews and compactions and her
one-shot reply, run on a runtime of her own: the Vercel AI SDK, held by
`@dorothy/agent` alone, behind contracts in `@dorothy/core` that carry no
SDK type. Each call has a role, each role a route of one or more models, and
a call that fails on one model moves to the next. This page explains that
machinery as it is built. The providers behind it, with their prices and
terms, are on
[services and providers](../profiles/services-and-providers.md); setting up
routes is in the root README's
[Models and providers](../../../README.md#models-and-providers).

The scope is her own calls. `dorothy --claude`, `--codex` and the other
hosts run the host's own model, not a route of hers; the spec put them out of
scope because Anthropic does not support routing Claude Code to other models
([spec](../../specs/2026-11-01-model-providers-design.md#understanding)).
The evaluation keeps clients of its own
([evaluation](./evaluation.md)); moving them onto these routes is listed
under the spec's Later.

State: built and merged in two parts, on 2026-11-01, and exercised with real
keys on temporary roots
([report](../../reports/2026-11-01-model-providers.md)). What the live runs
did not reach is said where it arises below.

## Why her own runtime

Before this phase her calls went through Anthropic's Agent SDK, which spawns
the Claude Code CLI and spends a subscription's token. The spec of 2026-11-01
gave three reasons: it tied her to one vendor, it added the CLI's own
context to every request
([context leak](../../reports/2026-10-07-context-leak.md)), and it sat
outside what Anthropic's terms permit, as the spec read them that day. The
terms, as the records read them, are dated on
[services and providers](../profiles/services-and-providers.md#anthropic),
and not repeated here. The Agent SDK is gone from the workspace;
`workspace.test.ts` pins that no package declares it, and that only `agent`
declares `ai` or a provider package of the AI SDK.

The choice of the AI SDK is the spec's, after the research of 2026-10-18 named
it the best replacement for `agent`, with a probe under Bun first
([report](../../reports/2026-11-01-model-providers.md#the-probe)). LangChain.js
was ruled out for her runtime because it brings message and graph state
beside her JSONL.

## Roles

Four roles are parsed from `config.toml`: `chat`, `review`, `compaction` and
`maintenance`
([`model.ts`](../../../packages/core/src/contracts/model.ts)). Each runs on
Anthropic by default, one entry each
([`routes.ts`](../../../packages/core/src/models/routes.ts)):

- `chat` on `claude-opus-5-5`: the TUI, the one-shot reply and
  `--dump-context`.
- `review` on `claude-sonnet-5-5`: the notes written after a chat, by the
  service, `--review-backfill` and Claude Code's hooks.
- `compaction` on `claude-sonnet-5-5`: clusters and abstracts for a long
  conversation. Reviews and compaction are described on
  [memory](./memory.md).
- `maintenance` on `claude-haiku-5-5`: parsed so that a route can be set,
  with no caller yet. The spec says maintenance is not built, and a search of
  the packages' sources finds no code taking this route. The roadmap's
  [Cyclical Maintenance](../../roadmap.md#cyclical-maintenance-4a) is where it
  is to be used.

Which caller takes which route is wired in `cli`: chat to the TUI, the
one-shot reply and the dump; review to the service, the backfill and the
hook; compaction to memory
([`run-tui.ts`](../../../packages/cli/src/run-tui.ts),
[cli guide](../../../packages/cli/AGENTS.md#files)). The deferred findings
note that no test pins that each caller takes its own role's route, so a swap
of review and compaction would pass the tests, as the default routes give
both the same model
([deferred](../../deferred/2026-11-01_model-providers-deferred.md#tests)).

## Providers and routes

A provider is declared in `config.toml`'s `[providers.<name>]` and has a
kind, one of five. The kind fixes the wire, the base URL and the reason it
may receive her requests
([README](../../../README.md#models-and-providers)):

- `anthropic`: the Messages API, `https://api.anthropic.com` or a loopback
  `base-url`, written without the `/v1` that Dorothy appends. A base URL
  ending in `/v1` is a fault, as the final review of Part B found it reached
  `/v1/v1`
  ([report](../../reports/2026-11-01-model-providers.md#rulings-made-during-the-build)).
- `openrouter`: its API root, fixed. Every request carries
  `data_collection: "deny"` and `zdr: true`, and structured calls add
  `require_parameters`.
- `featherless`: Chat Completions at its fixed root.
- `huggingface`: Chat Completions at Hugging Face's router, fixed. This kind
  alone is not held to no retention, by the user's ruling of 2026-11-01 after
  the spec was approved: whichever provider the router chooses may answer.
- `local`: Chat Completions at a required loopback `base-url`.

A route is an ordered list of entries, each `provider:model`, split at the
first colon. An entry also carries its base URL, which is always explicit and
never an environment variable's, and a key, which names a `secrets.json`
entry and is never a value. The roots of the three hosted kinds are constants,
so no configuration can send her requests elsewhere
(`FIXED_ROOTS` in `routes.ts`). `local` and a proxied `anthropic` must be
loopback, decided on the parsed URL, which refuses hosts such as
`127.0.0.1.example.com`.

With no `[providers]` table, `anthropic` is implied. A role left out of
`[models]` takes its default model on the provider named `anthropic`, and
without one that omission is a fault. Parsing is in
[`routing.ts`](../../../packages/core/src/models/routing.ts).

Faults are errors, not warnings. Every other `config.toml` table warns and
falls back to defaults, but a default here could send her requests where the
user did not mean, so a fault stops routing. Chat, the one-shot reply and
`--dump-context` print it and exit 1; the memory service and Claude Code's
hooks log it and review nothing; `--review-backfill` prints it and exits 1.
A missing secret is not a fault: that entry alone fails at call time, with
class `secret`, and the next entry is tried.

At the edge, `agent`'s `providers.ts` builds the SDK's model for an entry. It
passes the base URL and key explicitly and a `fetch` that follows no
redirect, so no provider package reads `ANTHROPIC_BASE_URL`,
`ANTHROPIC_API_KEY` or any variable of its own. It turns the SDK's console
warnings off, as they would land on the TUI's screen, and puts the system
prompt behind a cache breakpoint on Anthropic only. Thinking is set only on
Anthropic entries: each model's lowest, summarised in the stream and never
shown, and the models that always think are listed in `providers.ts`, where
a new one must be added. The other kinds get no thinking setting, so they
use the provider's default (`providerOptions` returns nothing for them;
[deferred](../../deferred/2026-11-01_model-providers-deferred.md#behaviour)).

## The calls

- Chat. `Conversation` holds the session's messages and runs a turn per
  message on the chat route, with at most ten tool steps, and a recall
  server over MCP that offers only the memory tools. The environment given
  to that server drops every key a provider names and every `*_API_KEY`. A
  turn ends with warnings if it stopped after ten steps or at the model's
  output limit.
- Structured calls. `structuredCall` runs a schema-constrained request for
  reviews and compaction. All attempts share one `timeoutMs`; a stall ends an
  attempt sooner. Anthropic does not enforce limits such as `maxLength`, so
  the answer is validated against the whole schema and put back to the model
  up to twice before the attempt fails as `unparsed`. This was added after
  the first live run found a review of 167 characters and a compaction
  abstract of 1,160 over their limits
  ([finding](../../reports/2026-11-01-model-providers.md#structured-output-held-to-its-schema)).
- The one-shot reply and `--dump-context`. The first streams to standard
  output with no tools, memory or transcript. The second sends the chat's
  first request to a capture server and prints its body, so it shows exactly
  what a chat would send.

## Fallback

One rule serves every role, in `runRoute` in
[`fallback.ts`](../../../packages/core/src/models/fallback.ts). It decides on
failures and never reads HTTP: `agent`'s `failures.ts` turns each thrown
error, streamed error and abort into one of ten classes
(`usage`, `rate-limit`, `overload`, `server`, `timeout`, `network`,
`rejected`, `unparsed`, `secret`, `cancelled`), and only `agent` knows the
wire.

The rule, as the spec states it and the code does it:

1. Try the entries in order, skipping those in cooldown. If all are, try only
   the one whose cooldown ends first.
2. Every failure moves to the next entry except a cancellation, and an
   attempt that has already had effects (below). The spec's reason is that a
   model on another provider may take what this one refused.
3. A cancellation, the caller's signal or an interrupt, ends the call. Past a
   structured call's deadline no entry is tried. Chat has no deadline; a
   stall of 60 seconds with no stream part ends an attempt.
4. Each move makes a note, such as "X refused (overload: ...); answering with
   Y". Chat shows it as a warning, the service logs it, and structured
   callers receive it as `notes`. When every entry fails, the reason lists
   each entry and its failure.

The AI SDK's own retries are off: every call sets `maxRetries: 0`, so a blip
costs a fallback, not a retry.

### Cooldowns

`Cooldowns` remembers two refusals for the process. A `usage` failure (402,
or a 400 or 403 whose message names credit, billing or a limit) cools the
provider; a `rate-limit` cools that provider's model. The time is the
`retry-after` header, as seconds or an HTTP date, or five minutes without one.
No other class cools down. There is one instance per process, shared by every
call and every session, so it outlives a TUI reconnect. The TUI and the
service are different processes and each learns a refusal on its own; sharing
cooldowns is listed under the spec's Later.

### After a turn has had effects

A chat turn can be handed to a later entry only while nothing has happened
that the later entry would repeat. `TurnState.started` becomes true once
text has streamed or `remember` has run
([`turn.ts`](../../../packages/agent/src/turn.ts)), and the agent guide states
the invariant: no fallback once text has streamed or `remember` has run
([guide](../../../packages/agent/AGENTS.md#invariants)). From the spec:

- A turn that fails after lookups alone has not started. Lookups are reads,
  so the next entry replays the turn from the user's message, and both
  attempts' lookups are shown and recorded, as both were made.
- A turn that fails once text has streamed or `remember` has run ends with an
  `error` event carrying its partial reply. The TUI reconnects, and the next
  turn starts from the first entry not in cooldown.
- Reasoning is kept only for the model that made it. Another model is sent
  none of it, and an assistant message left empty without it is not sent.

Two tests pin the replay and the no-replay on mock models: one replays a
turn that failed after a lookup on the next entry, and one never replays a
turn whose text has streamed. The recording of both attempts' lookups, the
partial reply and the reconnect rest on the spec
([`conversation.test.ts`](../../../packages/agent/src/conversation.test.ts));
`fallback.test.ts` pins that `runRoute` stops after a started attempt fails.
The report's live runs did not make a started turn fail on a real provider,
so this behaviour rests on the spec, the code and those tests.

What the live runs did find bears on routes, and is recorded in the report's
[Part B findings](../../reports/2026-11-01-model-providers.md#findings-1):

- A route with one entry has nothing to fall to. On featherless a review and
  a chat on one model collided on a plan's concurrency limit, and the chat
  was refused with a route of a single entry. The README advises a second
  entry in the role's list.
- A reasoning model can spend a provider's default output limit thinking.
  The Chat Completions kinds get no thinking setting, so a reasoning model
  on them thinks at the provider's default, and they send no output limit,
  so the provider's applies (featherless's is 4,096 tokens). A reply that
  stops at the limit now warns, but sending a limit of Dorothy's own waits,
  as a provider may refuse one.
- After a tool call, Sonnet 5.5's reply text arrived whole rather than
  streaming, which a raw request without the SDK reproduced; Haiku 5.5
  streamed over 1.3 seconds after a tool result in the same check
  ([finding](../../reports/2026-11-01-model-providers.md#text-after-a-tool-call-arrives-at-once)).
  The report takes this to be Anthropic's behaviour for that model, which
  she cannot change.

The deferred findings list known gaps
([deferred](../../deferred/2026-11-01_model-providers-deferred.md#behaviour)):
a streamed error whose code is a word, such as `rate_limit_exceeded`, is
classed `network`, so it falls back but is not cooled; a message of
reasoning alone is dropped, which can leave two user messages in a row for a
server whose template insists on alternating roles, and the next entry
answers. A model later in a list needs a context window no smaller than
`compaction.hard`, 128,000 tokens by default, which nothing checks before an
attempt.

## Accounting

Every turn reports its tokens and cost, which the TUI shows
([terminal](./terminal.md)). A step's usage is split into uncached input,
cache reads, cache writes and output. Its cost comes from the entry's kind:

- Anthropic: a price table in
  [`prices.ts`](../../../packages/core/src/models/prices.ts), dated with its
  source, with cache reads and writes at their own rates. The figures are on
  the services page, with their date.
- OpenRouter: the cost its own response reports, summed over the steps. The
  live run found her costs agreeing with OpenRouter's own count for the day.
- featherless, Hugging Face and local: the entry's `price`, dollars per
  million tokens in and out, with cache reads and writes charged as input;
  `[0, 0]` means free.
- Any other model, an Anthropic model missing from the table, or a response
  with no usage: $0 with a notice, once per model per process
  ([`cost.ts`](../../../packages/agent/src/cost.ts)). A free entry is never
  warned of.

The cost of a call is every attempt's, so a failed first entry that billed
before it failed is counted. A session's cost is its turns summed, and the
chat total in the statusline carries across reconnects and resumes. Review
and compaction costs are shown as the memory cost. Cost is shown and
recorded; it does not yet choose a route.

## Not built

Left for later in the spec, and not built:

- Choosing a route by remaining budget, not only by failure.
- Cooldowns shared between the TUI and the service.
- A per-entry context window checked before the attempt.
- Thinking set per role beyond each Anthropic model's lowest, and any
  thinking setting for the other kinds.
- The eval's clients moved onto these routes.
- The gateway serving models other than Claude, for hosts whose vendor
  supports it. This is the roadmap's idea
  [Dorothy's Gateway](../../roadmap.md#dorothys-gateway); see
  [identity and harnesses](./identity-and-harnesses.md#the-gateway).
- Any caller of the `maintenance` route.
- A local server: the `local` kind has met only the live run's stand-in, as
  the user has no local model.

## Records

Every dated record of this subject is under
[models and routing](../records.md#models-and-routing). The design is the
[spec](../../specs/2026-11-01-model-providers-design.md), carried out by
[Part A](../../plans/2026-11-01-model-providers-runtime.md) and
[Part B](../../plans/2026-11-01-model-providers-routing.md), and recorded in
the [report](../../reports/2026-11-01-model-providers.md).

## Related

- [Services and providers](../profiles/services-and-providers.md)
- [Protocols](../profiles/protocols.md)
- [The terminal](./terminal.md)
- [Packages](../profiles/packages.md)
- [Decisions](../decisions.md)
- [Problems](../problems.md)
