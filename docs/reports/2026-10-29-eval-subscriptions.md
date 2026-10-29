---
ctime: 2026-10-29
mtime: 2026-10-29
spdx: GPL-3.0-only
title: The evaluation's models through subscriptions
description: >-
  The claude and codex routes for the evaluation's roles, the token
  records, the bake-off of six question generators that prompted them,
  and the faults the live runs found.
tags:
  - dorothy
  - eval
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-29-eval-subscriptions.md
   -
   -->

# The evaluation's models through subscriptions

## Summary

The first full `generate` on the backfilled snapshot (2026-10-29, 315
conversations) drafted 244 questions with `deepseek/deepseek-v3.2` for
$0.1226, dropping two drafts in three. The user asked for other
generators to be compared, and that their Claude and ChatGPT plans be
used before either vendor's API. Following
[the spec](../specs/2026-10-29-eval-subscriptions-design.md) and
[the plan](../plans/2026-10-29-eval-subscriptions.md), a role may now
name `via = "claude"` or `via = "codex"`, and each command records its
tokens by role. Codex implemented both tasks through herdr; Claude
subagents reviewed them and the branch; the controller ran the live
checks.

## The bake-off

Each model drafted 30 questions from the same snapshot with seed 4242,
so from the same samples, in its own work directory. OpenRouter's
costs are the change in the key's usage across each run, run one after
another; the plans' runs cost no API money.

| Model | Route | Made | Dropped | Updates with no older claim | Time | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| `deepseek/deepseek-v3.2` | OpenRouter | 15 | 62 | 2 of 2 | 413 s | $0.013 |
| `deepseek/deepseek-v4.1-flash` | OpenRouter | 30 | 5 | 3 of 4 | 142 s | $0.013 |
| `z-ai/glm-5.3` | OpenRouter | 29 | 20 | 2 of 4 | 356 s | $0.230 |
| `google/gemini-4-argon` | OpenRouter | 26 | 8 | 0 of 0 | 125 s | $0.123 |
| `claude-haiku-5-5` | Claude plan | 26 | 5 | 0 of 0 | 152 s | plan |
| `gpt-6.1-terra` | ChatGPT plan | 26 | 5 | 0 of 0 | 112 s | plan |

The four models that made 26 declined the four knowledge-update samples,
in which nothing replaced the retired fact, as their guidance asks.
Those that filled them mostly wrote questions with no earlier claim,
single-session questions under the wrong type. The same fault holds 41
of the 43 knowledge-update drafts in the first full set: the checks
accept a knowledge-update draft whose `older` is empty, which a later
change closes. GLM 5.3 cost some seventeen times a projection from its
token prices, its reasoning billed as output.

## Faults the live runs found

The unit tests inject the CLI runner, so two faults showed only live:

- `claude --json-schema` refuses a schema whose `$schema` names draft
  2020-12, as `z.toJSONSchema` writes it: every Claude call exited 1.
  The key is dropped for both CLIs (`2b63ef5`).
- Claude reports cache creation and cache reads apart from
  `input_tokens`, so a draft recorded 10 input tokens; they are now
  summed, giving 28,107 for the same draft (`1c1805c`). Codex's
  `input_tokens` already include its cached share.

The task reviews found, and Codex fixed, a Codex attempt a timeout
could not stop (the npm wrapper left the native binary running; the
child now runs in its own process group), and Claude's default agent
prompt applying where a call carried no system message.

## Verification

With the real CLIs, by the controller: the bake-off's two plan runs
above, and a five-question draft through each route afterwards, whose
`generated.json` entries record tokens by role. A capped `run` on a copy
of the work directory, with `gpt-6.1-terra` answering through Codex and
`claude-haiku-5-5` judging through Claude, made its 18 calls in 35 s,
recorded each role's tokens, and left no process or temporary directory
behind. Its answers declined where retrieval missed the evidence, and the
judge's reasons were coherent; on two questions every system missed,
`full` included, as 400,000 characters hold only the archive's newest
conversations of some 74 MB.

The final review found two Important points, fixed by Codex: a signal
left every in-flight CLI process group running, and a Codex stream
error line, which may announce a reconnect, failed a reply that went on
to complete.
