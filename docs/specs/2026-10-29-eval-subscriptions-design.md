---
ctime: 2026-10-29
mtime: 2026-10-29
spdx: GPL-3.0-only
title: The evaluation's models through subscriptions
description: >-
  Design spec for letting an evaluation role call a model through the
  user's Claude or ChatGPT plan, by the claude and codex CLIs, before any
  API, and for recording each command's tokens.
tags:
  - dorothy
  - eval
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-29-eval-subscriptions-design.md
   -
   -->

# The evaluation's models through subscriptions

## Summary

The [evaluation](./2026-10-18-memory-evaluation-design.md) calls each
role's model through an OpenAI-compatible endpoint, paid per token. The
user holds Claude and ChatGPT plans and asked, on 2026-10-29, that they
be used before either vendor's API. A role may now name `via = "claude"`
or `via = "codex"`: its calls go through that CLI, on the plan, with
structured output by JSON Schema. A probe that day returned a schema's
object from `claude-haiku-5-5` in 5 s and from `gpt-6.1-terra` in 6 s.
Each command also records the tokens it spent, which a generator
comparison needs and the evaluation lacked.

## Decisions

| Decision | Choice | Why, and the cost if wrong |
| --- | --- | --- |
| Route | Spawn the vendor's CLI: `claude -p`, `codex exec` | Both log in with the plan; `eval` stays free of any SDK. Cost: a process per call, a few seconds |
| Claude's isolation | A throwaway `CLAUDE_CONFIG_DIR`, `--setting-sources ""`, `--strict-mcp-config`, `--tools ""`, `--no-session-persistence`, a temporary working directory | `--bare` refuses OAuth; this keeps the user's hooks, plugins, memory and `CLAUDE.md` out. Cost: none found |
| Claude's login | `CLAUDE_CODE_OAUTH_TOKEN` from `secrets.json`, in the child's environment alone | The token Dorothy already holds. Cost: none |
| Codex's isolation | `--ephemeral`, `--skip-git-repo-check`, `-s read-only`, a temporary `-C` | Codex keeps no session and can write nothing. Cost: none |
| Codex's login | The user's own `CODEX_HOME`, as Codex finds it | The plan's login lives there. Cost: none |
| Prompt | On standard input; Claude's system prompt from a private temporary file, Codex's folded ahead of the prompt | Snapshot text never reaches argv. Cost: none |
| Schema | `zod`'s JSON Schema for the role's schema; Claude's `structured_output`, Codex's `-o` file, parsed and checked by the same schema | One schema for every route. Cost: none |
| Effort | `effort` for a Codex role, default `"medium"` | The user's Codex default is `xhigh`, slow for drafting. Cost: none |
| Tokens | Each command sums input and output tokens by role and records them | `generated.json` and a run's report say what a run spent. Cost: none |

## Configuration

```toml
[models.generate]
via = "claude"
model = "claude-haiku-5-5"

[models.answer]
via = "codex"
model = "gpt-6.1-terra"
effort = "medium"

[models.judge]
base-url = "https://openrouter.ai/api/v1"
model = "google/gemini-4-argon"
key = "OPENROUTER_API_KEY"
```

`via` is `"api"` by default, which keeps today's settings. A `claude` or
`codex` role takes `model` and, for Codex, `effort`; `base-url` or `key`
beside it is an error, as is `effort` on any other route.

## Calls

A CLI call is one attempt of `Models.call`, so `--max-calls`, retries
and redaction hold. A non-zero exit, a timeout or an unreadable reply is
retryable; a reply that parses but breaks the schema is not, as today.
A failure names the route and exit code, never the CLI's output, which
may hold snapshot text. The child's environment is built for it:
`PATH`, `HOME` and the route's own variables, nothing else inherited.

## Tokens

`complete` and `structured` already return each call's tokens; `Models`
sums them by role. `generate` adds `tokens` to its `generated.json`
entry, and a run's report states each role's input and output tokens.
Claude's tokens come from its reply's `usage`; Codex's from `--json`'s
token count events, or none where it gives none.

## Testing

Tests never spawn `claude` or `codex`: the runner is injected. They
cover each route's arguments and environment, the prompt on standard
input, the schema's object parsed and checked, a broken reply retried, a
schema mismatch not, a failure naming no output, the configuration's
rules, and the token sums in `generated.json` and the report.

## Verification

With the real CLIs, a `generate --count 30 --seed 4242` through each
route, by the controller, in a throwaway work directory beside the
bake-off's.

## Out of scope

- Dorothy's own chat and reviews, which reach Claude through the SDK.
- Another vendor's CLI.
