---
ctime: 2026-11-01
mtime: 2026-11-01
spdx: GPL-3.0-only
title: Model Providers
description: >-
  Design spec for model providers: Dorothy's own runtime on the Vercel AI
  SDK, the Messages API on an API key, OpenRouter, featherless.ai and
  local servers, routed per role with fallback, retiring the Agent SDK.
tags:
  - dorothy
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-11-01-model-providers-design.md
   -
   -->

# Model Providers

## Summary

Dorothy's own model calls, her chat, her reviews and her compactions,
run today through Anthropic's Agent SDK, which spawns the Claude Code
CLI and spends a subscription's OAuth token. That ties her to one
vendor, adds context of the CLI's own to every request
([context leak](../reports/2026-10-07-context-leak.md)), and sits
outside what Anthropic's terms permit: Claude Code's
[legal page](https://code.claude.com/docs/en/legal-and-compliance) says
developers using the Agent SDK "should use API key authentication", and
the Consumer Terms (section 3, item 7) bar automated access except by
an API key.

This spec gives her a runtime of her own on the Vercel AI SDK 7, behind
contracts in `core`. Anthropic is reached through the Messages API on an
API key; OpenRouter, featherless.ai and local servers stand beside it.
Each role (chat, review, compaction, maintenance) names an ordered list
of models in `config.toml`, and a call that fails on one moves to the
next, so a spent Anthropic budget no longer stops her. Only providers
that keep no prompts are allowed, and Dorothy enforces it. The Agent SDK
leaves the workspace.

## Understanding

What the user has said, in the roadmap, the objectives and this
brainstorm:

- A provider contract in `core`, with the Messages API and an
  OpenAI-compatible implementation, and per-role routing in
  `config.toml`, so chat, reviews, compaction and maintenance each take
  a model fit for them.
- Anthropic's models first; when Anthropic's usage runs out, requests
  fall back to another provider, such as featherless.ai or OpenRouter,
  and fallback also serves work another model suits better.
- Resilience to upstream hindrance is the first objective after memory.
- Anthropic is reached by the Messages API on an API key, the Max
  plan's monthly API credits first; the Agent SDK retires from her own
  calls.
- Only providers that keep no prompts may receive her requests.
- Existing packages are surveyed before anything bespoke; new
  subsystems speak standard protocols, with SDK types at a thin edge.

Assumed, and put to the user in the brainstorm's design sections:

- Maintenance is not built yet; its role is parsed now for the next
  phase.
- `dorothy --claude` is out of scope: it runs plain Claude Code on the
  user's own login, which the terms allow, and Anthropic does not
  support routing Claude Code to other models.
- The eval keeps its own LangChain clients.

Success: every role routable in `config.toml`; a refused call answered
by the next model in its list, with a warning saying so; no request to a
provider that may keep it; no package depending on the Agent SDK; and
every test on loopback fakes.

## Decisions

Ruled with the user or by the coordinating agent, each with its cost if
wrong:

| Question | Ruling | Cost if wrong |
| --- | --- | --- |
| Anthropic's route | Messages API on `ANTHROPIC_API_KEY`; no subscription token | API credits spent where the subscription was |
| Runtime | Vercel AI SDK 7 (`ai`), in `agent` | A probe failing under Bun stops the build |
| LangChain.js | Not used here | Its fallback middleware is ours to write |
| Retention | Four fixed provider kinds, each known to keep no prompts | A fifth provider needs a kind added |
| Fallback trigger | Every failure but cancellation | One wasted attempt on a request that fails everywhere |
| Chat mid-reply | No fallback once text has streamed or a tool has run | A turn the user asks again |
| Unknown prices | Cost shown as $0, with a notice | Understated costs until a price is set |
| Maintenance | Role parsed now, no caller | One unused key |
| Default models | Chat `claude-opus-5-5`, review and compaction `claude-sonnet-5-5`, maintenance `claude-haiku-5-5` | Quality or credits, one line of config each |
| Event names | `ready` carries `sessionId`, Dorothy's own, for `sdkSessionId` | A rename across `tui` and `memory` |
| Merge | Waits until the user has added `ANTHROPIC_API_KEY` and the live smoke passes | The branch waits |

The [gateways research](../notes/2026-10-18_open-source-replacements/gateways.md)
named the AI SDK 7 the best replacement for `packages/agent`: Apache-2.0,
provider-neutral, with zod schemas, middleware, an Anthropic provider
with a settable base URL, and OpenAI-compatible and OpenRouter
providers. The [LangChain report](../reports/2026-10-18-protocol-diversity/langchain-and-standards.md)
found LangChain.js runs on Bun and has `modelFallbackMiddleware`, but
brings its own message and graph state beside her JSONL; its middleware
list serves as a checklist instead. A bespoke client on `fetch` would
mean two wire protocols' streaming, tools and errors of our own. The AI
SDK's packages declare Node 22 and are not confirmed under Bun, so the
build opens with a probe.

## Configuration

Two tables join `config.toml`. `[providers.<name>]` declares a provider
of one of four kinds; `[models]` gives each role an ordered list of
`<provider>:<model>` entries.

```toml
[providers.anthropic]
kind = "anthropic"
key = "ANTHROPIC_API_KEY"

[providers.openrouter]
kind = "openrouter"
key = "OPENROUTER_API_KEY"

[providers.featherless]
kind = "featherless"
key = "FEATHERLESS_API_KEY"

[providers.ollama]
kind = "local"
base-url = "http://127.0.0.1:11434/v1"

[models]
chat = ["anthropic:claude-opus-5-5", "openrouter:moonshotai/kimi-k3"]
review = ["anthropic:claude-sonnet-5-5", "featherless:Qwen/Qwen3-32B"]
compaction = ["anthropic:claude-sonnet-5-5"]
maintenance = ["anthropic:claude-haiku-5-5"]
```

The kinds, and what each sends:

| Kind | Wire | Base URL | Retention |
| --- | --- | --- | --- |
| `anthropic` | Messages API | `https://api.anthropic.com/v1`, or `base-url` | Commercial terms; accepted by the user's ruling |
| `openrouter` | OpenRouter's API | `https://openrouter.ai/api/v1` | `provider: { data_collection: "deny", zdr: true }` on every request |
| `featherless` | Chat Completions | `https://api.featherless.ai/v1` | "Prompts stored: Never" |
| `local` | Chat Completions | `base-url`, required | Loopback only: `127.0.0.0/8`, `::1` or `localhost` |

The models after Anthropic's are examples, not defaults.

Rules:

- `key` names a `secrets.json` entry (`^[A-Z_][A-Z0-9_]*$`), never a
  value. `local` takes no key. `anthropic` alone also takes `base-url`,
  for the capture server and Anthropic-compatible test servers, and it
  must be loopback too unless it is Anthropic's own.
- A kind outside the four, a non-loopback `local` URL, an unknown
  setting, a route naming an undeclared provider, or an empty route is a
  config error naming the file, the table and the fault, as the other
  tables' errors do.
- An entry may carry a price, `price = [input, output]` in dollars per
  million tokens, as an inline table:
  `{ model = "featherless:Qwen/Qwen3-32B", price = [0.1, 0.1] }`.
- With no `[providers]` table, one provider is implied:
  `anthropic`, kind `anthropic`, key `ANTHROPIC_API_KEY`. With no
  `[models]` table, or a role left out, the role takes its default
  model on that provider (Decisions).
- A route whose secret is missing at call time skips that entry with a
  reason, as any failure does; a route with no usable entry fails its
  call naming every missing secret. Nothing falls back to a
  subscription token.

## Packages

- `core` gains `contracts/model.ts` (the routing types and the chat
  provider contract), the `providers` and `models` parts of `Config`,
  `models/fallback.ts` (the fallback rules over the contract) and
  `models/prices.ts` (Anthropic's price table). It takes no SDK.
- `agent` drops `@anthropic-ai/claude-agent-sdk` and takes `ai`,
  `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`,
  `@openrouter/ai-sdk-provider` and `@ai-sdk/mcp`. Its
  `providers.ts` turns a route entry into an AI SDK model, and it is the
  only file that imports a provider package. `Conversation` keeps
  implementing `ChatSession`; `structuredCall` keeps returning a
  `StructuredCall`, now taking the role's route.
- `memory` takes a review call and a compaction call apart, where it
  took one `call`.
- `cli` reads the routes from the config and hands each caller its own:
  chat to the TUI and the one-shot reply, review to the service, the
  backfill and the Claude hook, compaction to memory.
- Leaving with the Agent SDK: `prepareCliHome`, the CLI's home, the
  `DISABLE_COMPACT` handling and its two messages, and the stripping of
  Claude Code's variables before reviews, which kept the CLI off the
  wrong account. `chooseClaudeToken` stays in `core`, for the eval's
  `via = "claude"` clients.
- `workspace.test.ts` pins the new holder: no package declares
  `@anthropic-ai/claude-agent-sdk`, and only `agent` declares `ai` or
  an `@ai-sdk/` or `@openrouter/` package.

## Chat

`Conversation` holds the session's messages itself, as the CLI did. The
system prompt is built as today: persona, memory block, earlier
sessions and history, through `conversationOptions`, renamed
`conversationSetup` as it no longer returns SDK options.

Each user turn appends the user's message and runs `streamText` on the
route's current entry, with:

- the tools of her MCP server, reached over stdio through
  `@ai-sdk/mcp` from the same `recall` command and arguments, filtered
  to `ALLOWED_TOOLS` and, when offered, `RECOLLECT_TOOL`;
- a tool loop of at most ten steps;
- on `anthropic`, cache breakpoints on the system prompt and the latest
  user message, so the stable prefix is read from cache;
- the session's abort signal, which `interrupt()` fires.

The stream becomes the events the TUI draws today: `ready` once, with
the first entry's model and a session id of her own; `delta` per text
part; `lookup` and `remember` from tool calls and results, by the same
parsing; `sdk` for each stream part, reduced to `RawMessage`, for the
raw pane; and `turn-end` with `TurnStats` from the stream's usage. The
assistant's reply, tool calls and tool results join the session's
messages when the turn ends; an interrupted turn keeps the text it
streamed, as today.

The MCP client starts with the session and closes with it, within
`CLOSE_GRACE_MS`. If it fails to start, chat goes on without recall and
says so once, as it does now when recall fails.

`runOneShot` uses the same chat route with no tools, no memory and no
transcript, streaming to stdout.

## Structured calls

`structuredCall(route)` runs `generateText` with `Output.object` over
the request's JSON schema, under its `timeoutMs` and `signal`, and
returns the `StructuredOutcome` it returns today: the parsed output, the
model that answered and the cost, or the reason and the cost spent.
Each attempt in the route gets the full `timeoutMs`. Output that does
not parse against the schema is a failure of that attempt.

## Fallback

One rule for every role, in `core`, over a provider contract the tests
fake:

1. Try the route's entries in order, skipping any provider in cooldown.
2. A failure moves to the next entry: a rate limit, spent credits, an
   overload, a server error, a timeout, a network error, a rejected
   request, output that does not parse, or a missing secret. A model on
   another provider may take what this one refused.
3. A cancellation, the caller's signal or an interrupt, ends the call
   with no further attempt.
4. A refusal for usage, HTTP 429 or 402 or a provider's credit error,
   puts its provider in cooldown for this process: the `retry-after`
   header's time, or five minutes without one. Later calls of any role
   skip it until then. If every entry is in cooldown, the one whose
   cooldown ends first is tried.
5. In chat, once a turn has streamed any text or run any tool, a
   failure ends the turn with an `error` event, as today, carrying the
   partial reply; the next turn starts from the route's first entry not
   in cooldown. A reply is never spliced from two models, and no tool
   runs twice.
6. Each move to a later entry emits a `warning`, such as "anthropic
   refused (rate limited, retry in 41m); answering with
   openrouter:moonshotai/kimi-k3". The service writes the same to its
   log. When every entry fails, the outcome's reason lists each entry
   and its reason.

Cooldowns live in the process: the TUI and the service each learn a
refusal on their own.

## Cost

- `anthropic`: tokens from the response's usage, priced by `core`'s
  table for Anthropic's current models, with cache reads and writes at
  their own rates. The table's values come from Anthropic's pricing page
  when the plan is written, and the plan names its date.
- `openrouter`: the cost OpenRouter reports in the response's usage.
- `featherless` and `local`: the entry's `price`, if any. With none, the
  cost is $0 and a `warning`, once per model per process, says the cost
  is not known.

`TurnStats` and `StructuredOutcome.costUsd` carry these as before, so
the statusline, the reply stats and memory's cost need no change.

## Capture

`--dump-context` and `captureServer` keep their behaviour: the dump
points the route's first entry at the capture server through its base
URL, records the first request's body, never its headers, answers it
with an error, and prints it. It shows exactly what a chat would send,
which is now only what Dorothy builds.

## Errors

| Condition | Behaviour |
| --- | --- |
| Config fault in `[providers]` or `[models]` | Startup fails naming file, table and fault |
| Secret missing for an entry | That entry skipped with a reason; the call fails if none is left |
| Provider refuses for usage | Cooldown, warning, next entry |
| Any other failure | Warning, next entry |
| Every entry fails | Chat `error` event or `{ ok: false }`, listing each reason |
| Failure after a chat reply has started | Turn ends with `error` and its partial reply |
| MCP server fails to start | Chat without recall, one warning |
| No price for a model | Cost $0, one warning per model |

## Testing

All tests run on loopback fakes and temporary XDG roots; no test makes
a real model call or reads `secrets.json`.

- The probe (first task): under Bun, `streamText` with a tool and
  `generateText` with `Output.object` against a fake Messages server and
  a fake Chat Completions server, and `@ai-sdk/mcp` over stdio against
  her real recall server on a temporary memory. If any fails under Bun,
  the build stops and returns to the user; no other runtime is swapped
  in without them.
- `core`: config parsing (each kind, loopback, keys, prices, routes,
  defaults, every fault's message); fallback (each failure class,
  cancellation, cooldown with and without `retry-after` on fake timers,
  every entry in cooldown, every entry failing); prices.
- `agent`: each kind's request through the fakes, OpenRouter's
  retention fields on every request, Anthropic's cache breakpoints;
  `Conversation`'s events, interruption, close, a failing MCP server,
  and no fallback after a reply has started; structured outcomes and
  timeouts; the dump through the capture server.
- `memory` and `cli`: the review and compaction calls kept apart, and
  each caller handed its role's route.
- `workspace.test.ts`: the holders above.

## Verification

Before merging, after the user has added `ANTHROPIC_API_KEY` with
`sops edit secrets.json`, the coordinating agent runs on a temporary XDG
root: one chat turn that recalls, one review, and one call forced onto
OpenRouter by a route whose first entry is a loopback server that
answers 429. The report records each, with its output and cost. The
merge waits on it.

## Documentation

- `packages/agent/AGENTS.md` and `packages/core/AGENTS.md`: the runtime,
  the contract, fallback and the SDK's holder.
- `README.md`: Authentication says Dorothy's own calls need an API key
  and `CLAUDE_CODE_OAUTH_TOKEN` serves only Claude Code and the eval;
  a section on `[providers]` and `[models]`.
- `docs/reports/2026-11-01-model-providers.md`: the probe, the rulings
  made during the build and the verification.
- `docs/roadmap.md`: revised as its Revising section says.

## Later

- The eval's model clients moved onto `core`'s routes.
- A route chosen by remaining budget, not only by failure, as the
  usage-limits practice routes the agents.
- Cooldowns shared between the TUI and the service.
- The memory engine's recall measured again on the new review model.
- The gateway serving models other than Claude, for harnesses whose
  vendor supports it.
