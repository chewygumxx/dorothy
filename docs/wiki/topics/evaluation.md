---
ctime: 2026-11-03
mtime: 2026-11-14
spdx: GPL-3.0-only
title: Evaluation
description: >-
  How Dorothy's memory is measured on the user's own sessions: the
  questions, the systems compared, what the results establish and where
  they stop, plus the separate persona check across models.
tags:
  - wiki
  - evaluation
  - memory
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/wiki/topics/evaluation.md
   -
   -->

# Evaluation

[Wiki home](../../README.md)

The evaluation measures how well Dorothy's [memory](./memory.md) gives a
model what it needs to answer, on questions drawn from the user's own
conversations. It exists to choose what sits behind the memory contract:
her engine as it is, improved, or another provider's. This page says how
it works and what its results establish. It is built, and it has been run
in full on the user's data; the figures given as current are the
[engine report's rerun](../../reports/2026-10-31-memory-engine.md#the-rerun).

## Where it lives

`@dorothy/eval`, a tool for her builders run as `bun run eval -- <command>`
and imported by nothing. It depends on `core` and on memory's
`"./evaluation"` entry point alone, which opens an archive
([guide](../../../packages/eval/AGENTS.md),
[packages](../profiles/packages.md#eval),
[spec](../../specs/2026-10-18-memory-evaluation-design.md)). Its commands,
in the order a user meets them, are `snapshot`, `mine`, `generate`,
`review`, `run` and `compare`.

Every command but `snapshot` runs in a work directory with every root
passed in, so nothing touches the user's data. `snapshot` copies a data
directory into it, and refuses a work directory inside the checkout. The
test set, its reviews and the run records quote the user's sessions, so
they are private, kept in `xxdorothy/eval`; the records in this
repository hold aggregates alone
([first evaluation](../../reports/2026-10-31-first-evaluation.md#summary)).
No test in the repository reads real data or calls a model.

## What is measured

The memory's priorities are compatibility, access, progressive disclosure
and persistence; the evaluation measures access, on her own data
([spec](../../specs/2026-10-18-memory-evaluation-design.md#purpose)). Each
question is asked of each system with one budget of characters (8,000 by
default), then answered by one model and judged. Two kinds of figure
result.

Retrieval figures need no model. Since the engine's first step they are
counted in stages, because the first evaluation showed that finding
evidence and handing it over fail separately
([engine spec](../../specs/2026-10-31-memory-engine-design.md)):

- Found: the engine's hits held a source the question cites.
- Delivered: evidence went into the context the answering model read,
  opened as a passage or whole knowledge, not as a note or snippet.
- Covered: the share of the gold answer's content words found in the
  delivered passages of the cited sources. This is a proxy, since
  questions cite conversations, not turns; a paraphrased answer reads as
  missed.

Answer figures need a model to answer and another to judge. The judges are
openevals' correctness judge, unchanged, and a lenient one of ours:

- Strict: the answer gives every fact of the reference and contradicts
  none.
- Lenient: the answer gives the reference's main point.
- Abstention: for a question whose answer is not in her memory, whether
  the answer declines. Any other question is counted as declined wrongly
  when its answer says it does not know.
- A judge sees the question, the answer and the reference. Since
  2026-11-01 the strict and lenient judges also see a note that the answer
  comes from a memory of the user, so a claim it attributes to the user is
  not invented where the reference agrees (`MEMORY_NOTE` in
  [`judges.ts`](../../../packages/eval/src/run/judges.ts), #102). The
  abstention judge does not get it. A contradicted or missing fact still
  fails.

A failed retrieval, answer or judgement counts as a miss, never as nothing,
so a flaky system does not score higher for failing. A run that stops at a
plan's usage limit has not failed its questions: it keeps its records,
exits with a code for a wrapper to wait on, and resumes after the reset.

## The questions

Questions are mined where her data already holds the answer, and generated
by a model for types mining cannot reach. The current set has 134 accepted
questions, of which the answer figures count 125 strictly:

| Type | Questions | Drawn from |
| --- | --- | --- |
| single-session | 48 | one conversation's turns |
| multi-session | 38 | two or three conversations sharing a tag or project |
| temporal | 23 | a conversation's dated turns |
| preference | 10 | her `user` and `feedback` knowledge, asked indirectly |
| knowledge-update | 6 | a retired file beside its replacement |
| abstention | 8 | nothing in the snapshot, checked by lexical search |
| lookup | 1 | mined from her own `open` calls; no answer, retrieval alone |

The abstentions and the lookup are not in the 125. The types follow
LongMemEval's, scaled to the data
([spec](../../specs/2026-10-18-memory-evaluation-design.md#generated-questions)).

How a draft becomes a question matters to how far its result can be
trusted, as
[the test set](../../reports/2026-10-31-first-evaluation.md#the-test-set)
records:

- Two of the strongest models the user's plans offered, Claude Opus 5.5
  and GPT-6.1 Sol, drafted 136 and 134 questions, after a comparison of
  generators ([record](../../reports/2026-10-29-eval-subscriptions.md)).
- Agents pre-screened the 270 drafts crosswise, so no model family judged
  its own, against one brief: the evidence supports the answer, there is
  one clear answer, the type fits, and the session is real work. A first
  round gave reviewers too little of each conversation (1,500 characters)
  to judge, so it was redone with more, and the tool now shows 6,000
  ([review tools](../../reports/2026-10-30-eval-review-tools.md)). Of the
  270, 132 were accepted, 50 of them edited; with the mined question that
  made 133.
- The owner spot-checks a sample of the agents' accepts and may reopen any,
  logging why. The first evaluation recorded the spot-check as pending,
  and the rerun's 134 questions, one more preference question than the
  first run's 133, are described as including it. The records do not say
  whether the spot-check is complete.

## The systems compared

All are asked through one interface and given the same budget, so that
only the system varies
([systems guide](../../../packages/eval/src/systems/AGENTS.md)).

- `dorothy`: her opening block, taking a share of the budget (0.4 by
  default), then her search's hits through `deliver`, the same step
  production recall uses. A name takes options, such as
  `dorothy:block=0.2`, so each change to her delivery is measured on its
  own in one run.
- `lexical`: the bound from below. Every turn and knowledge file scored by
  how many of the question's terms it holds, the best twenty packed: what
  plain `grep` would find.
- `full`: the bound from above, where it fits. Everything, newest first,
  until 400,000 characters. It is no ceiling at this archive's size, and
  the rerun did not include it.
- `cited`: a diagnostic ceiling, never a contender. It delivers the
  question's own cited evidence as `dorothy` would, to show how far
  selection alone could go.

No other provider has been run. `makeSystem` refuses any name but these,
so Hindsight, OpenViking, EverOS and Honcho, compared as engines, have
evaluation adapters that are designed in the evaluation spec and listed
among the roadmap's candidates, not built
([services](../profiles/services-and-providers.md#memory-systems)).

## The current results

The rerun, of 2026-11-01, ran nine variants of these systems on the 134
accepted questions under the changed judges: 3,573 model calls in 56
minutes, without a failure. Claude Haiku 5.5 answered, on the reserve
Claude account, and `openai/gpt-6.1-sol` judged through OpenRouter at its
default effort. The table gives the four systems that matter here; the
report's has all nine
([the rerun](../../reports/2026-10-31-memory-engine.md#the-rerun)).

| System | Strict | Lenient | Preference strict | Abstained |
| --- | --- | --- | --- | --- |
| `dorothy`, her defaults | 43/125 | 60/125 | 5/10 | 8/8 |
| `lexical` | 27/125 | 34/125 | 0/10 | 8/8 |
| `cited`, the ceiling | 85/125 | 104/125 | 6/10 | 8/8 |
| today's options, before the engine's step | 7/125 | 13/125 | 5/10 | 8/8 |

By type, at her defaults against lexical search's strict passes: 21 of 48
single-session questions against 20, 14 of 23 temporal against 6, 2 of 38
across sessions against 0, 1 of 6 updates each, and 5 of 10 preferences
against none. She shares 17 of lexical search's 27 passes; five questions
only lexical search passes, and ten of its passes she misses.

The retrieval stages come from a run that called no model, on the 125
questions, and do not depend on the judges
([verification](../../reports/2026-10-31-memory-engine.md#verification)):

| System | Found | Delivered | Covered |
| --- | --- | --- | --- |
| `dorothy`, her defaults | 109/125 | 98/125 | 43.7% |
| `lexical` | none | 69/125 | 35.8% |
| `cited`, the ceiling | none | 125/125 | 74.8% |
| today's options | 102/125 | 9/125 | 4.2% |

## What the results establish

- Delivery was the failure, and delivery is fixed. Her search found
  evidence for 102 of 125 questions even before the engine's first step,
  but only 9 reached the model as evidence; delivering the matched
  passages and alternating knowledge with conversations raised that to
  98, past lexical search's 69.
- Under these judges and this data, her strict accuracy passes lexical
  search's, her correct abstentions are kept in every system, and her
  preference answers are as many as the old behaviour's, 5 of 10.
- The outcome the engine report drew is that her engine stays hers; the
  decision, with the overturned first ruling and the alternatives, is
  recorded in the report's
  [The decision](../../reports/2026-10-31-memory-engine.md#the-decision)
  and, in full, on the decisions page.
- Much remains unestablished. The gap to `cited` (43 against 85) is in
  what she delivers and how the model answers from it; across sessions
  she passes 2 of 38; and four of her five preference failures still leave
  out a `+10:00` offset that `cited` also leaves out, which the roadmap
  holds as a candidate about the answering prompt's length.

## Limits

These bound what any figure above says.

- The judges changed, so figures from before the change are not comparable
  with those after. The probes behind the change put most of the preference
  failures on the strict judge, which never saw her memory and faulted
  truthful attributions to the user
  ([the first decision](../../reports/2026-10-31-memory-engine.md#the-first-decision)).
  The report's own cost if wrong is a judge more lenient towards remembered
  claims than the first.
- Noise. Strict passes on small types flip between systems whose contexts
  barely differ; today's options reproduced an earlier count within the
  judge's noise. Preference has 10 questions, updates 6, and a count of one
  or two is not a ranking.
- One data set, one user's sessions, drafted by models from that same data.
  The test leans towards lexical search because its questions echo
  transcript text. The first evaluation also thought preference questions
  leaned towards her, a claim its correction withdrew in part, since
  lexical search reads knowledge too
  ([what it shows](../../reports/2026-10-31-first-evaluation.md#what-it-shows)).
  It is not LongMemEval, which the spec lists as a later public anchor.
- One answering model and one judge, of different vendors as the protocol
  asks, at a default effort. A different model might rank the systems
  differently.
- Coverage is a word-share proxy, not a verdict; strict accuracy is the
  verdict.
- The test set is private, so no one else can rerun it, and the spot-check
  is not recorded as complete.
- A small difference between systems is under the resolution of its type's
  count; the report marks differences under two questions' worth.

## History

Earlier figures are kept for what they taught. Each was measured before the
judges changed in between (`MEMORY_NOTE`, #102), so none is current and
none compares with the rerun's.

- The first evaluation, earlier than the rerun and judged before the
  judges changed, ran 133 questions with Claude Haiku 5.5 answering and
  GPT-6.1 Sol judging through Codex. It reported Dorothy's strict accuracy
  at 7.3% after the backfill reviews, 4.0% before; lexical search's 25.0%
  after; `full`'s 5.6%. Her recall at 10 rose from 9.6% to 46.4% with the
  reviews, below lexical search's 56.8% overall but past it on questions
  across sessions
  ([the runs](../../reports/2026-10-31-first-evaluation.md#the-runs)).
- That run led to the engine's first step. Its findings, that she
  retrieved notes while the fact was in the transcript, and the two
  corrections it needed, are in
  [what it shows](../../reports/2026-10-31-first-evaluation.md#what-it-shows).
- The engine's paid run before the judges changed, earlier than the rerun,
  put her at 40/124 strict at her defaults against lexical search's 31, and
  her preferences at 2 of 9. In that earlier run today's options scored
  7/124, reproducing the first evaluation's 9/124 (its 7.3%) within the
  judge's noise. The user judged the preference result inadequate, which
  overturned the first ruling, and the judges were then changed
  ([the first decision](../../reports/2026-10-31-memory-engine.md#the-first-decision)).

## Persona check

The separate [persona check](../../reports/2026-11-14_persona-check.md)
exercises her core and on-demand layers through chat with recall enabled,
on Claude Haiku 5.5, Claude Opus 5.5 and DeepSeek V4.1 Flash. It uses
`persona/run.ts` and `persona/probes.jsonl` in the private `xxdorothy/eval`
repository, rather than the memory evaluation commands above. Temporary
XDG roots keep it away from the real store.

Eight probes cover short answers, personality-free output for another
agent, correction, hostility, distress, origins, model recommendations
and profanity. For origins and recommendations, scoring compares claimed
reads with the actual `persona` transcript entries before the answer.
The entries establish access; they do not establish that she interpreted
what she opened correctly.

The final round on 2026-11-14 passed all eight probes on each model,
24 of 24 responses. The preserved baseline passed 17 of 24, and the
first re-run 21 of 24. Raw metadata, whole transcripts, events and scores
stay in `~/dev/xxdy/eval/persona/runs/`; the report lists every directory,
version, change and evidence limit. A re-run creates a fresh directory
with a UTC timestamp and persona-version suffix, preserving earlier runs.

These are single responses per model and probe, not reliability estimates
or model rankings. The baseline shared recall between probes and missed
two initial user rows; later rounds used isolated stores, except p3
continuing p1, and captured every input. No host delivery, subagent
isolation, compaction or long-session recall was exercised. Distress
detection by a pre-prompt classifier is
[decided, not yet built](../decisions.md#situational-behaviour-by-pre-prompt-classifier);
the prompt-only rounds inform that later work.

## Records

Every dated record of the evaluation is under
[evaluation in the catalogue](../records.md#evaluation); the record that
holds its figures is the
[engine report](../../reports/2026-10-31-memory-engine.md). What the memory
being measured does is under [memory](./memory.md).

## Related

- [Memory](./memory.md)
- [Models and routing](./models-and-routing.md)
- [Packages](../profiles/packages.md)
- [Decisions](../decisions.md)
- [Problems](../problems.md)
- [Priorities](../priorities.md)
