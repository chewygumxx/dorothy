---
ctime: 2026-11-01
mtime: 2026-11-01
spdx: GPL-3.0-only
title: Model Providers
description: >-
  Dorothy on her own runtime, the Vercel AI SDK 7: Part A on Anthropic's
  Messages API, and Part B, routing each role over five provider kinds
  with fallback; the probes, the rulings, both live runs on real keys
  and temporary roots, and what they found.
tags:
  - dorothy
  - report
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/reports/2026-11-01-model-providers.md
   -
   -->

# Model Providers

Part A, the runtime, runs from Summary to "Left for Part B"; Part B,
routing, follows from "Part B: routing".

## Summary

[The spec](../specs/2026-11-01-model-providers-design.md) and
[Part A's plan](../plans/2026-11-01-model-providers-runtime.md) move
Dorothy's own calls, her chat, reviews, compactions and one-shot
replies, off the Agent SDK and the subscription's OAuth token onto the
Vercel AI SDK 7 and Anthropic's Messages API with `ANTHROPIC_API_KEY`.
No package depends on the Agent SDK. Part B, routing from
`config.toml` with fallback across providers, has its own plan.

The build ran subagent-driven, Tasks 1 to 12 by the reserve account's
second session, each task reviewed for the spec and for quality, the
branch reviewed whole on Opus. The live run below, Task 13, found one
regression, fixed in the branch before merge: structured output was
no longer held to its whole schema.

## The probe

Task 1 gated the plan: the AI SDK under Bun, against a stand-in
Messages API and a stand-in MCP server. All five passed: a tool loop
with usage per step and the system prompt's cache breakpoint, schema
output, an HTTP refusal as an error part with its headers, an abort as
an abort part, and an MCP server over stdio in the environment it was
given. Her real recall server, through the same client on a temporary
root, is pinned in Task 11's test.

## Rulings

The plan's twelve departures from the spec stand as written there. The
build's own rulings, each with its cost if wrong, are in PR #111's
description; the ones that changed behaviour:

- A streamed `billing_error` is classed `usage`, so a route out of
  credit cools down.
- `--dump-context` says its warnings and, when nothing was sent, why.
- A chat listener that throws becomes one `error` event; the session
  goes on.
- Structured output is held to its whole schema (below).

## The live run

On temporary `XDG_*` roots, with the real `secrets.json`, the one
sanctioned read, on 2026-11-01.

| Check | Result |
| --- | --- |
| `dorothy "Say hello in five words."` | "Hello, I'm Dorothy. Welcome here!", exit 0 |
| `--dump-context -- "Hello"` | `claude-opus-5-5`; system and latest message each one `cache_control`; four `mcp__memory__` tools; thinking adaptive, summarised |
| Chat, `remember` | "✎ remembered personal/kiln-brunhilde"; 374 in, 1959 cache read, 1959 cache write, 494 out; $0.0216 |
| Chat, a search | "⌕ searched "kiln" · 1 fact", the fact found; $0.0091 |
| Compaction | Two in the first chat, one in the second, each to one cluster, recording `anthropic:claude-sonnet-5-5` |
| Review | First chat: failed its check (below); second chat, after the fix: note "Crazing celadon on cone 6 mugs", recording `anthropic:claude-sonnet-5-5` |
| Quitting | Clean; no recall server left running |

Each caller took its role's route: chat
`anthropic:claude-opus-5-5`, reviews and compactions
`anthropic:claude-sonnet-5-5`. The two chats cost $0.156 and $0.077
for chat, and $0.048 and $0.038 for memory.

## Findings

### Structured output, held to its schema

The first chat's review failed memory's own check, "description is
167 characters, over 160", and a compaction "abstract is 1160
characters, over 1000". Anthropic's structured output does not enforce
`maxLength`, `minimum` and the like, which `@ai-sdk/anthropic` moves
into descriptions; the Agent SDK had validated against the whole
schema and retried. `structuredCall` now does too (`b2fe491`): zod's
`fromJSONSchema` checks an answer, and on a mismatch the model is asked
again, at most twice, with the issues named; then the attempt fails as
`unparsed`. Both of memory's schemas are read by zod, their limits
enforced. The second chat's review and compaction passed.

### Text after a tool call arrives at once

After a tool call, a reply's text arrives in one burst: time to first
token equals the turn's duration to within 4 ms (446 characters in the
first chat). A turn with no tool call streams (first token at 1.8 s of
7.6 s). A raw request to the Messages API, with no AI SDK, shows it is
Anthropic's: after a `tool_result`, Sonnet 5.5's whole response,
`message_start` included, arrived at 4.05 s at once, where Haiku 5.5
streamed over 1.3 s. Dorothy can do nothing about it; a turn that looks
something up shows its reply whole.

### Prices

Sonnet 5.5's cache reads are $0.10 per million, as the pricing page's
footnote gives cache hits on Opus 5.5 and Sonnet 5.5 at 0.05 of input;
a bundled reference's $0.20 is out of date.

### Left on disk

The Agent SDK's private CLI home, `~/.cache/dorothy/claude`, is no
longer used and was left alone; it is the user's to remove.

### Probing on temporary roots

With `XDG_CONFIG_HOME` on a temporary root, mise does not find its
trust records, so its `sops` shim fails and Dorothy says "secrets not
loaded (SOPS_FAILED)". Putting sops's install directory first on
`PATH` was enough; Dorothy's code was not at fault.

## Left for Part B

PR #111's description lists the constraints the reviews left for Part
B's plan. Beside them: carry reasoning across Anthropic models rather
than drop it, as the API takes thinking blocks back unchanged; forward
structured calls' fallback notes through memory; and revise the
roadmap once the phase merges.

## Part B: routing

[Part B's plan](../plans/2026-11-01-model-providers-routing.md) routes
each role from `config.toml`'s `[providers]` and `[models]` over five
provider kinds, `anthropic`, `openrouter`, `featherless`, `huggingface`
and `local`, falling back from one model to the next. The spec was
amended for the user's ruling of 2026-11-01 adding `huggingface`, which
takes any provider Hugging Face's router chooses.

### The build

The plan carried its code as diffs, prototyped and checked before the
plan's review. The build ran subagent-driven on the reserve account:
seven tasks, each implemented on Haiku and reviewed on Sonnet against
the spec, then the branch reviewed whole on Opus. `bun run check` on
temporary roots passes at the branch's head: 3982 pass, 1 skip, 0 fail.

### Rulings made during the build

Each with its cost if wrong; the plan's own 17 rulings stand as written
there.

- A broken `config.toml` faults whenever a line opens or sets
  `[providers]` or `[models]` in any of TOML's spellings, single quotes
  and arrays of tables included (Task 1's review): a missed spelling
  would have sent her requests to the default routes. Cost: a line
  inside a multi-line string that looks like one stops chat on an
  already broken file.
- Task 3 gained tests that chat's and structured calls' cost notices
  arrive once, beside the plan's code. Cost: none.
- After the final review: an `anthropic` `base-url` ending in `/v1` is
  a fault, as Dorothy appends `/v1` and the request reached `/v1/v1`
  as a bare 404; the README and the cli guide were corrected. Cost: a
  proxy whose root truly ends in `/v1` must be written without it.
- Left for later, each a test or a cooldown and none a wrong route or a
  leak: a mid-stream error whose code is a word, not a status, is
  classed `network`, so a streamed rate limit of that shape is not
  cooled; no test pins that each caller takes its own role's route, or
  that the TUI's sessions take `chatDeps`.
- From the live run: a reply that stops at the model's output limit now
  warns "the reply stopped at the model's output limit" (below). Cost:
  none; sending an output limit instead is left for later, as a
  provider may refuse one.

### The live run

On temporary `XDG_*` roots, with the real `secrets.json`, on
2026-11-01. A Bun script on `127.0.0.1:4791` answered every request 429
with `retry-after: 30`, declared as `[providers.proxy]`, kind `local`,
first in each route. The models, each from its provider's own list that
day:

- OpenRouter `deepseek/deepseek-v4.1-flash-1017`: 31 endpoints in
  `GET /api/v1/endpoints/zdr` support structured outputs and tools, at
  99% uptime or better over a day, with a 1M-token context.
- featherless `zai-org/GLM-5.3-Flash`, priced `[0.15, 0.5]` from
  `GET https://api.featherless.ai/v1/models`, with a 262,144-token
  context.
- Hugging Face `zai-org/GLM-5.3-Flash:deepinfra`, live with structured
  output in `GET https://router.huggingface.co/v1/models`, priced
  `[0.15, 0.5]`.

| Check | Result |
| --- | --- |
| One-shot, chat on `[proxy, openrouter]` | "Hello there, lovely to meet you!", exit 0; stderr: "proxy:none refused (rate-limit: stand-in: rate limited, retry in 30s); answering with openrouter:deepseek/deepseek-v4.1-flash-1017" |
| TUI, three turns on that route | Each turn's note shown, then "proxy:none in cooldown until 18:54"; the header named the OpenRouter model; $0.0002 a turn by OpenRouter's own figure |
| Review and compaction on that route | "memory: review: …" and "memory: compaction: …" notes shown; the sidecar holds the review's notes and two clusters recording the OpenRouter model, so `validateReview` and `validateClusters` both passed |
| Cost | Dorothy showed chat $0.0006 and memory $0.0019; OpenRouter's own count for the day was $0.0025 |
| Quitting | Clean; no recall server left running |
| One-shot on featherless | "Hello! Dorothy here, waving warmly.", exit 0 |
| TUI on featherless | Turn one answered (998 out, $0.0007) and the review saved its notes ($0.0018); turn two refused (below); turn three ended with 4096 output tokens and no text (below) |
| One-shot on Hugging Face | "Hello there, friend! 👋", exit 0 |

The `local` kind was reached only as the stand-in: the user has no
local model.

### Findings

**featherless allows one request at a time on this model.** The plan
is `feather_pro_plus`, four concurrency units, and GLM-5.3-Flash costs
four a request: while the review ran, the chat turn was refused,
"Concurrency limit exceeded", and its route had no second entry. The
README now says so: give a role on such a plan a second entry.

**A reasoning model can spend the whole output limit thinking.**
Dorothy sends the Chat Completions kinds no output limit, so the
provider's default applies, featherless's 4,096 tokens. One turn spent
exactly that and showed no text and no warning. A probe of the same
question without her prompt and history thought for 3,323 characters
and answered in 1,722, ending `stop`. The fix in the branch warns
whenever a reply ends at the limit; a rerun of the turn on it answered
in 1,179 tokens, so the warning itself is shown by its test, not live.

**The rest held.** OpenRouter answered every request, each sent with
its retention fields (as the wire tests pin), the notes reached the TUI
from chat, reviews and compactions alike, and costs agreed with
OpenRouter's own count.
