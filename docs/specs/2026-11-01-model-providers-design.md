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
contracts in `core`, in two parts, each with its own plan and merge:

- **Part A, the runtime.** Chat, reviews, compaction and the one-shot
  reply move onto the AI SDK, reaching Anthropic's Messages API on
  `ANTHROPIC_API_KEY`, one model per role. The Agent SDK leaves the
  workspace.
- **Part B, routing.** `config.toml` declares providers of four kinds,
  Anthropic, OpenRouter, featherless.ai and local servers, and gives
  each role an ordered list of models; a call that fails on one moves
  to the next, so a spent Anthropic budget no longer stops her. Only
  the providers the user accepted may receive her requests, and the
  config cannot name another.

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
- Only providers that keep no prompts may receive her requests:
  Anthropic's API, OpenRouter with data collection denied and zero
  retention, featherless, and local servers.
- Existing packages are surveyed before anything bespoke; new
  subsystems speak standard protocols, with SDK types at a thin edge.

Assumed, and put to the user in the brainstorm's design sections:

- Maintenance is not built yet; its role is parsed in Part B for the
  next phase.
- `dorothy --claude` is out of scope: it runs plain Claude Code on the
  user's own login, which the terms allow, and Anthropic does not
  support routing Claude Code to other models.
- The eval keeps its own LangChain clients.

Success: Dorothy's own calls on an API key, with no package depending on
the Agent SDK (Part A); every role routable, a refused call answered by
the next model in its list with a warning saying so, and no provider
reachable outside the accepted four (Part B); no test reaching a real
provider.

## Decisions

Ruled with the user or by the coordinating agent, each with its cost if
wrong:

| Question | Ruling | Cost if wrong |
| --- | --- | --- |
| Anthropic's route | Messages API on `ANTHROPIC_API_KEY`; no subscription token | API credits spent where the subscription was |
| Runtime | Vercel AI SDK 7 (`ai`), in `agent` | A probe failing under Bun stops the build |
| LangChain.js | Not used here | Its fallback middleware is ours to write |
| Delivery | Two parts, two plans, two merges | Fallback arrives a merge later |
| Retention | Four fixed provider kinds | A fifth provider needs a kind added |
| Config faults | `[providers]` and `[models]` faults are errors, unlike other tables | A typo stops chat until fixed |
| Fallback trigger | Every failure but cancellation | One wasted attempt on a request that fails everywhere |
| Chat mid-reply | Fallback until text has streamed or `remember` has run | A turn the user asks again |
| Time budget | One `timeoutMs` per call, shared by its attempts | A slow first attempt leaves later ones little time |
| SDK retries | Off; fallback and cooldown decide | A blip costs a fallback, not a retry |
| Cooldown scope | Usage refusals: the provider; rate limits: the provider and model | A provider-wide rate limit is learnt model by model |
| Schema conformity | Only output that is not JSON falls back; callers validate the rest | A model returning wrong JSON is not replaced |
| Extended thinking | Off in this phase | Her replies keep today's depth |
| Unknown prices | Cost shown as $0, with a notice | Understated costs until a price is set |
| Default models | Chat `claude-opus-5-5`, review and compaction `claude-sonnet-5-5`, maintenance `claude-haiku-5-5` | Quality or credits, one line of config each |
| The hook's proxy | `DOROTHY_ANTHROPIC_BASE_URL` retires; Part B's `base-url` replaces it | A user's proxy is lost for a merge |
| Event names | `ready` carries `sessionId`; the transcript field keeps its name | A rename across `tui` and `memory` |
| Merges | A waits for `ANTHROPIC_API_KEY` and its live smoke; B for its own | The branches wait |

The [gateways research](../notes/2026-10-18_open-source-replacements/gateways.md)
named the AI SDK 7 the best replacement for `packages/agent`: Apache-2.0,
provider-neutral, with zod schemas, middleware, an Anthropic provider
with a settable base URL, and OpenAI-compatible and OpenRouter
providers. The [LangChain report](../reports/2026-10-18-protocol-diversity/langchain-and-standards.md)
found LangChain.js runs on Bun and has `modelFallbackMiddleware`, but
brings its own message and graph state beside her JSONL; its middleware
list serves as a checklist instead. A bespoke client on `fetch` would
mean two wire protocols' streaming, tools and errors of our own. The AI
SDK's packages declare Node 22 and are not confirmed under Bun, so Part A
opens with a probe. The SDK's types run through `agent`'s chat and
structured modules, not one file: `agent` is the thin edge, and nothing
else imports them.

## Contracts

In `core/src/contracts/model.ts`, no SDK:

```ts
export const ROLES = ["chat", "review", "compaction", "maintenance"] as const;
export type Role = (typeof ROLES)[number];
export const KINDS = ["anthropic", "openrouter", "featherless", "local"] as const;
export type Kind = (typeof KINDS)[number];

// One model a role may use, with what reaching it needs.
export type RouteEntry = {
    provider: string;          // the [providers.<name>] it came from
    kind: Kind;
    model: string;
    baseUrl: string;           // always explicit, never the environment's
    key: string | null;        // a secrets.json name; null for keyless local
    price: [number, number] | null; // dollars per million, in and out
};
export type Route = RouteEntry[];
export type Routes = Record<Role, Route>;

export type FailureClass =
    | "usage" | "rate-limit" | "overload" | "server" | "timeout"
    | "network" | "rejected" | "unparsed" | "secret" | "cancelled";
export type Failure = {
    class: FailureClass;
    message: string;
    retryAfterMs: number | null;
};

// One attempt on one entry. started: text has streamed or remember has
// run, so no other entry may take the turn over.
export type AttemptResult<T> =
    | { ok: true; value: T; costUsd: number }
    | { ok: false; failure: Failure; started: boolean; costUsd: number };
export type Attempt<T> = (
    entry: RouteEntry,
    signal: AbortSignal,
) => Promise<AttemptResult<T>>;
```

In `core/src/models/`:

- `fallback.ts`: `runRoute(route, attempt, { cooldowns, signal,
  deadlineMs })`, returning the value with the entry that gave it, every
  attempt's cost summed, and a note per move to a later entry; or every
  entry's failure. It decides; it never reads HTTP.
- `cooldowns.ts`: `class Cooldowns`, built with a `Clock`
  (`{ now(): number }`, added to `timers.ts` beside `Timers`), holding
  until-times by provider and by provider and model. One instance per
  process, made by `cli` and handed to every call and every
  `Conversation`, so it outlives a session the TUI reconnects.
- `prices.ts`: Anthropic's price table.

`agent/src/failures.ts` turns an SDK error or a stream's error part into
a `Failure`; only `agent` knows the wire. `StructuredOutcome` gains
`notes: string[]`, the fallback notes, and its `model` becomes
`<provider>:<model>`; its `costUsd` is every attempt's, summed.

Part A builds all of this, `runRoute` and `Cooldowns` included, with the
`anthropic` kind alone and one-entry routes that `cli` makes without
config. Part B adds the config, the other three kinds and the tests of
multi-entry routes.

## Configuration (Part B)

Two tables join `config.toml`. `[providers.<name>]` declares a provider
of one of four kinds; `[models]` gives each role an ordered list.

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
chat = ["anthropic:claude-opus-5-5", "openrouter:<a ZDR model>"]
review = [
    "anthropic:claude-sonnet-5-5",
    { model = "featherless:<model>", price = [0.1, 0.1] },
]
compaction = ["anthropic:claude-sonnet-5-5"]
maintenance = ["anthropic:claude-haiku-5-5"]
```

| Kind | Wire | Base URL | Why it may receive her requests |
| --- | --- | --- | --- |
| `anthropic` | Messages API | `https://api.anthropic.com`, or a loopback `base-url` | Anthropic's commercial terms, accepted by the user |
| `openrouter` | OpenRouter's API | `https://openrouter.ai/api/v1`, fixed | `provider: { data_collection: "deny", zdr: true }` on every request |
| `featherless` | Chat Completions | `https://api.featherless.ai/v1`, fixed | "Prompts stored: Never"; its paid API plan, as the flat chat plan excludes API use |
| `local` | Chat Completions | `base-url`, required, loopback | Never leaves the machine |

Rules:

- `key` names a `secrets.json` entry (`^[A-Z_][A-Z0-9_]*$`), never a
  value; it is required except on `local`, where it is optional. Keys
  resolve as `loadSecrets` resolves them: a nonempty exported value
  wins over `secrets.json`, as the README says.
- An `anthropic` `base-url` is written as `ANTHROPIC_BASE_URL` is, with
  no `/v1`; Dorothy appends it. A `local` `base-url` is the full API
  root, as servers document it.
- Loopback is decided on the parsed URL: hostname exactly `localhost`,
  an IPv4 address in `127.0.0.0/8`, or `[::1]`; no user or password;
  `http` or `https`. `127.0.0.1.example.com`, `localhost.example.com`
  and `http://127.0.0.1@example.com` are refused.
- `price` is allowed only on `featherless` and `local` entries;
  `[0, 0]` means free. Cache reads and writes on a priced entry cost
  its input price.
- With no `[providers]` table, one provider is implied: `anthropic`,
  kind `anthropic`, key `ANTHROPIC_API_KEY`. A role left out of
  `[models]` takes its default model (Decisions) on the provider named
  `anthropic`; if there is none of that kind and name, leaving the role
  out is a fault. A role given an empty list is a fault.
- Faults: a kind outside the four, a setting a kind does not take, a
  non-loopback URL where loopback is required, a malformed key name or
  route entry, a route naming an undeclared provider, an empty route, a
  misplaced price. Unlike the other tables, whose faults are warnings
  that fall back to defaults, a fault here is an error, as a default
  could send her requests where the user did not mean. `parseConfig`
  returns it beside the warnings, naming the file, the table and the
  fault, and each entry point acts on it:

| Entry point | On a routing fault |
| --- | --- |
| TUI and one-shot reply | Print it and exit 1 |
| Service | Log it; serve memory with reviews off |
| Claude hook | Log it; skip the review; exit 0 |
| `--review-backfill` | Print it and exit 1 |

  `openMemory` takes the routes from `cli` and does not report the
  fault again.

A route's missing secret is not a fault: it is found at call time, and
that entry fails with class `secret`.

## Packages

- `core` gains the contracts and modules above, the `providers` and
  `models` parts of `Config` (Part B), and `Clock`. It takes no SDK.
- `agent` drops `@anthropic-ai/claude-agent-sdk` and takes `ai`,
  `@ai-sdk/anthropic` and `@ai-sdk/mcp` (Part A), then
  `@ai-sdk/openai-compatible` and `@openrouter/ai-sdk-provider`
  (Part B); `zod` stays, as the AI SDK peers on it. `providers.ts`
  builds an AI SDK model from a `RouteEntry`, always passing the base
  URL, the key and a `fetch` that follows no redirect, so no provider
  package reads `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` or any other
  variable of its own. Every call sets `maxRetries: 0`.
- `memory` takes a review call and a compaction call apart, where it
  took one `call`, and its compaction session detects a started reply
  from `delta`, `lookup` and `remember` events, no longer from `sdk`
  events.
- `cli` builds the routes (Part A: one entry per role on Anthropic;
  Part B: from the config), one `Cooldowns`, and hands each caller its
  role: chat to the TUI and the one-shot reply, review to the service,
  the backfill and the Claude hook, compaction to memory.
- `tui`'s header names the model of the latest turn and labels the
  session id `session`, not `sdk`.
- Leaving with the Agent SDK: `prepareCliHome` and the CLI's home; the
  `DISABLE_COMPACT` handling with `COMPACTED_BY_CLI` and
  `cliCompactFailed`; `failureText`; the `QueryFn`, `StructuredQueryFn`,
  `OneShotQuery` and `CaptureQueryFn` seams; `stripClaude`,
  `reviewEnv`, `REVIEW_DROPPED` and `REVIEW_BASE_URL`, as no provider
  reads the environment; and `chooseClaudeToken` in the hook's secrets,
  as no review spends an OAuth token. `chooseClaudeToken` stays in
  `core` for the eval's `via = "claude"` clients.
- `workspace.test.ts` pins the holder: no package declares
  `@anthropic-ai/claude-agent-sdk`, and only `agent` declares `ai` or
  an `@ai-sdk/` or `@openrouter/` package.

## Chat

`Conversation` holds the session's messages itself, as the CLI did.
`conversationSetup`, which replaces `conversationOptions`, returns
`{ system: string; recall: RecallLaunch | null; recollect: boolean }`,
the system prompt built as today from persona, memory block, earlier
sessions and history; memory's compaction estimate reads its `system`.

**Recall.** The session starts an MCP client over stdio from
`@ai-sdk/mcp/mcp-stdio`, on the same `recall` command and arguments,
with:

- the environment passed explicitly: the process's own, less every
  provider key named by a route and every `CLAUDE_CODE_OAUTH_TOKEN*`, so
  the server sees the caller's XDG roots;
- stderr ignored, so nothing reaches the TUI's screen;
- its tools re-keyed `mcp__memory__<name>`, as the Agent SDK named them,
  so `ALLOWED_TOOLS`, `RECOLLECT_TOOL`, `toolOf`, the persona and the
  transcripts are unchanged, and filtered to `ALLOWED_TOOLS` and, when
  offered, `RECOLLECT_TOOL`. A tool result's `isError` marks a lookup
  or a `remember` as failed.

`ready` is emitted once the client has started or failed, never inside
`start()`, with the first entry's model and a session id of Dorothy's
own; the transcript's `sdkSessionId` field keeps its name and takes that
id. If the client fails to start, chat goes on without recall and warns
once; if the server dies later, its tools fail as failed lookups.
`close()` waits up to `CLOSE_GRACE_MS` for a tool call in flight before
closing the client.

**A turn** appends the user's message and runs `streamText` on the
route through `runRoute`, with the tools, `stopWhen` at ten steps,
`timeout: { firstChunkMs: 60_000, chunkMs: 60_000 }`, the session's
abort signal and `maxRetries: 0`. On `anthropic`, the system prompt is
sent as a system message carrying a cache breakpoint, with a second on
the latest user message, so the stable prefix is read from cache.

The stream becomes the events the TUI draws:

- `delta` per text part; `lookup` and `remember` from tool calls and
  results, by today's parsing;
- `sdk` per stream part as `RawMessage`: `type` the part's type and,
  for text, `event.delta` its text; never the prompt, a header or a key;
- `turn-end` with `TurnStats` (below), `contextTokens`, and `model`,
  the `<provider>:<model>` that answered;
- `warning` for each fallback note, and when ten steps end in a tool
  call: "the reply stopped after ten tool steps", the turn ending on
  the text it has.

When the turn ends, the response's messages join the session's. An
interrupted turn keeps its complete steps and the text it streamed.

| `TurnStats` field | Source |
| --- | --- |
| `inputTokens` | Summed `inputTokenDetails.noCacheTokens` of the turn's steps |
| `cacheReadTokens`, `cacheWriteTokens` | Summed `inputTokenDetails` of the steps; 0 where a provider gives none |
| `outputTokens` | Summed `outputTokens` |
| `ttftMs` | Timed by `Conversation`, from send to the first text part; null without one |
| `durationMs` | Timed by `Conversation`, from send to the turn's end |
| `costUsd` | Cost, below, of every attempt the turn made |
| `sessionCostUsd` | Kept by `Conversation`, its turns summed |

`contextTokens` is the last step's total input, cache included, plus an
estimate of the reply, four characters to a token. An interrupted
turn's unfinished step has no usage; it counts as 0.

`runOneShot` runs the chat route with no tools, no memory and no
transcript, streaming to stdout, fallback notes and failures to stderr,
and exits 1 on failure.

## Structured calls

`structuredCall(route, deps)` runs `generateText` with `Output.object`
over the request's JSON schema (`jsonSchema()`, with no validator of its
own) through `runRoute`, all attempts sharing the request's `timeoutMs`
as one deadline, so the claim leases of reviews and compactions, one
timeout plus a margin, still hold. On `anthropic` it uses the provider's
native structured output; on the Chat Completions kinds it asks for
`response_format` `json_schema` (`supportsStructuredOutputs: true`), and
a provider that refuses that fails the attempt as `rejected`.

Output that is not a JSON value of the schema's top-level type fails
the attempt as `unparsed`. Output that parses is the caller's to judge,
as today (`validateReview`, `validateClusters`); a judgement against it
does not fall back. The outcome is the `StructuredOutcome` of
[Contracts](#contracts).

## Fallback

One rule for every role, in `runRoute`, built in Part A and given
more than one entry in Part B:

1. Try the route's entries in order, skipping any in cooldown, by its
   provider or by its provider and model. If all are, try only the one
   whose cooldown ends first, and list the others as "in cooldown until
   `HH:MM`".
2. A failure moves to the next entry, unless it is `cancelled` or the
   attempt had `started`. A model on another provider may take what
   this one refused.
3. A cancellation, the caller's signal or an interrupt, ends the call
   with no further attempt.
4. Past the deadline, no entry is tried; the call fails as `timeout`.
5. `usage` puts the provider in cooldown and `rate-limit` the provider
   and model, until `retry-after` (seconds or an HTTP date) or for five
   minutes without one; a failure on a forced attempt sets its cooldown
   afresh. No other class cools down.
6. Each move to a later entry makes a note, such as "anthropic refused
   (usage: credit balance too low, retry in 41m); answering with
   openrouter:…". Chat shows it as a `warning`, the service logs it,
   structured callers find it in `notes`. When every entry fails, the
   reason lists each entry and its failure.

`started` is set once a text part has streamed or `remember` has run.
Lookups are reads: a turn that failed after lookups alone is replayed
on the next entry from the user's message, and its lookups stay
recorded as made. A started turn that fails ends with an `error` event
carrying its partial reply, as today; the TUI reconnects, and the next
turn starts from the first entry not in cooldown, as `Cooldowns`
outlives the session.

Classification, in `agent/src/failures.ts`, for errors thrown and for
error parts in a stream (a provider's mid-stream error after a 200
included):

| Wire | Class |
| --- | --- |
| The caller's abort | `cancelled` |
| 402; or 400 or 403 whose message names credit, billing or a spending limit | `usage` |
| 429 | `rate-limit` |
| 529, 503, or an `overloaded_error` | `overload` |
| Any other 5xx | `server` |
| The deadline, or `firstChunkMs` or `chunkMs` passing | `timeout` |
| No connection, a reset, or a redirect | `network` |
| Any other 4xx | `rejected` |
| Structured output not JSON | `unparsed` |
| A route's secret not set | `secret`, before any request |

Cooldowns live in the process: the TUI and the service each learn a
refusal on their own. A fallback entry should have a context window no
smaller than `compaction.hard` (128,000 tokens by default); a smaller
one rejects a long session, and the README says so.

## Cost

- `anthropic`: tokens priced by `core`'s table for Anthropic's current
  models, cache reads and five-minute cache writes at their own rates.
  The table's values come from Anthropic's pricing page when Part A's
  plan is written, and the plan names its date.
- `openrouter`: `providerMetadata.openrouter.usage.cost`, with the
  provider's `usage: { include: true }` set.
- `featherless` and `local`: the entry's `price`, with `includeUsage`
  set so streams report usage.
- A model with no price, an Anthropic model missing from the table or a
  response with no usage costs $0, with a `warning` once per
  `<provider>:<model>` per process; `[0, 0]` warns of nothing.

`TurnStats` and `StructuredOutcome.costUsd` carry these, so the
statusline, the reply stats and memory's cost need no change.

## Capture

`--dump-context` builds the chat's first request for the chat route's
first entry and sends it to `captureServer` instead: a one-entry route
with fallback off, `maxRetries: 0`, a dummy key and the capture server
as base URL, whatever the kind. It starts and closes the MCP client as
a session does, so the dump carries the tool schemas. `captureServer`
records the body, never the headers, of a POST to `/messages` or
`/chat/completions`, answers it with a 400 in that wire's shape, and
the dump prints it. It shows exactly what a chat would send, now only
what Dorothy builds. `dumpRequest` takes the entry and the server as its
seam where it took a `queryFn`.

## Persona

The CLI's identity line and per-turn environment message are gone, so
the persona's plumbing component and `persona.ts`'s comments stop
describing them; the chat prompt's pin in `persona.test.ts` changes on
purpose, in the same commit. Development mode, which tells her to
describe her context faithfully, gains a closing line naming the chat
route's entries, at the end of the system prompt so chat mode's cached
prefix is untouched. `identity`'s provenance text stays, for the
gateway.

## Errors

| Condition | Behaviour |
| --- | --- |
| Routing fault in `config.toml` | Per entry point, as in Configuration |
| Secret missing for an entry | That entry fails as `secret`; the next is tried |
| `usage` or `rate-limit` | Cooldown, note, next entry |
| Any other failure, not started | Note, next entry |
| Every entry fails | Chat `error` event or `{ ok: false }`, listing each failure |
| Failure after a chat reply has started | Turn ends with `error` and its partial reply |
| Ten tool steps | Warning; the turn ends on its text |
| MCP server fails to start | Chat without recall, one warning |
| No price or no usage | Cost $0, one warning per model |

In Part A, routes have one entry, so every failure is the call's.

## Testing

No test reaches a real provider or reads `secrets.json`; every root and
key is passed in. Two layers:

- **Wire tests** on loopback `Bun.serve` fakes speaking Messages and
  Chat Completions SSE: each kind's request (headers, base URL, key,
  OpenRouter's retention fields on every request, Anthropic's cache
  breakpoints, `include_usage`, `response_format`), usage and cost
  parsing, each classification row, a mid-stream error after a 200, a
  redirect refused, and a test that sets `ANTHROPIC_BASE_URL` and
  `ANTHROPIC_API_KEY` in the environment to a recording server and
  proves nothing reaches it.
- **Behaviour tests** on the AI SDK's mock models (`ai/test`):
  `Conversation`'s events, stats, `contextTokens`, interruption, close
  with a tool call in flight, the ten-step stop, `started` and replay
  after lookups; structured outcomes, notes, cost summing and the
  shared deadline.

And:

- **The probe**, Part A's first task: under Bun, `streamText` with a
  tool and `generateText` with `Output.object` against a fake Messages
  server, and `@ai-sdk/mcp/mcp-stdio` against her real recall server on
  a temporary XDG root, asserting the server opened that root's memory.
  If any fails under Bun, the build stops and returns to the user; no
  other runtime is swapped in without them.
- **`core`**: config parsing (each kind, each loopback case above, keys,
  prices, defaults, every fault and its message); `runRoute` (each
  class, cancellation, deadline, cooldown with seconds, an HTTP date and
  none on a fake clock, every entry in cooldown, every entry failing);
  prices.
- **`memory` and `cli`**: review and compaction calls kept apart;
  compaction's started-reply detection on the new events; each caller
  handed its role's route; each entry point's behaviour on a fault.
- **`workspace.test.ts`**: the holders above.

## Verification

Each merge waits on a live smoke the coordinating agent runs on a
temporary XDG root, the one sanctioned read of the real `secrets.json`,
recorded in the report with output and cost:

- **Part A**, after the user has added `ANTHROPIC_API_KEY` with
  `sops edit secrets.json`: one chat turn that recalls, one review, one
  compaction, and `--dump-context`.
- **Part B**, with `OPENROUTER_API_KEY`, already present: one call
  forced onto OpenRouter by a route whose first entry is a loopback
  server answering 429, on a model chosen that day for having a
  zero-retention endpoint, and one chat turn on it.

## Documentation

- `README.md`: the opening line on the Agent SDK; Authentication, that
  Dorothy's own calls need an API key and `CLAUDE_CODE_OAUTH_TOKEN`
  serves only Claude Code and the eval; a section on `[providers]` and
  `[models]` (Part B), with the context-window caution.
- `packages/agent/AGENTS.md`: the runtime, the thin edge, the seams.
- `packages/core/AGENTS.md`: the contracts, `runRoute`, `Cooldowns`,
  `Clock`, `RawMessage` and `chooseClaudeToken`'s remaining use.
- `packages/cli/AGENTS.md`: routes and the recall launch's environment.
- `packages/tui/AGENTS.md`: the `sdk` event's new meaning.
- Root `AGENTS.md`: the SDK's holder, kept at 100 lines by rewording.
- `docs/reports/2026-11-01-model-providers.md`: the probe, the rulings
  made during the build and both verifications.
- `docs/roadmap.md`: revised as its Revising section says.

## Later

- The eval's model clients moved onto `core`'s routes.
- A route chosen by remaining budget, not only by failure, as the
  usage-limits practice routes the agents; token budgets from usage.
- Cooldowns shared between the TUI and the service.
- A per-entry context window, checked before the attempt.
- Extended thinking, with reasoning kept to the provider that made it.
- The memory engine's recall measured again on the new review model.
- The gateway serving models other than Claude, for harnesses whose
  vendor supports it.
