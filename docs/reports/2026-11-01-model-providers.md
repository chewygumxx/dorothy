---
ctime: 2026-11-01
mtime: 2026-11-01
spdx: GPL-3.0-only
title: Model Providers, Part A
description: >-
  Dorothy on her own runtime, the Vercel AI SDK 7, against Anthropic's
  Messages API: the probe, the rulings, the live run on real keys and
  temporary roots, a schema regression it found and fixed, and what
  Part B carries.
tags:
  - dorothy
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-11-01-model-providers.md
   -
   -->

# Model Providers, Part A

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
