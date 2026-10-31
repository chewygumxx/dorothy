---
ctime: 2026-10-31
mtime: 2026-10-31
spdx: GPL-3.0-only
title: The memory evaluation's first run
description: >-
  The first full run of the memory evaluation on the user's own data,
  before and after the backfill was reviewed: how the test set was made,
  the rulings, and the aggregate results. The questions and records are
  private, in the dorothy-eval repository.
tags:
  - dorothy
  - eval
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-31-first-evaluation.md
   -
   -->

# The memory evaluation's first run

## Summary

[The evaluation](../specs/2026-10-18-memory-evaluation-design.md) ran in
full for the first time, on a snapshot of the user's store after the
[backfill](./2026-10-20-recording.md): 315 conversations and 8 knowledge
files, 302 of the conversations backfilled and so without notes. It ran
again on a second snapshot after
[`--review-backfill`](./2026-10-29-backfill-review.md) had reviewed all
302, with the same 133 questions and models. Reviews raised Dorothy's
retrieval fivefold, from 9.6% to 46.4% recall at 10, and on questions
spanning several sessions past plain lexical search; her strict accuracy
rose only from 4.0% to 7.3%, as she finds the right conversation but
answers from its notes, not the passage that holds the fact. The test
set, reviews and records are private, in `chewygumxx/dorothy-eval`, as
they quote the user's sessions; this record holds aggregates alone.

## The test set

Mining the user's own lookups gave one question. Generation was compared
first: six models each drafted 30 questions from the same samples
([the subscription routes' record](./2026-10-29-eval-subscriptions.md)
has the table). The user then chose the strongest models available on
their plans: Claude Opus 5.5 and GPT-6.1 Sol drafted 136 and 134
questions. A first set by DeepSeek V3.2 was set aside unreviewed.

The drafts were pre-screened by agents, crosswise so no model family
judged its own: GPT-6 Astra, through Codex, reviewed Opus's, and Claude
Opus 5.5 subagents reviewed Sol's, against one brief: the evidence
supports the answer, one clear answer, the type fits, and the session is
real work, not a probe. A first round showed the review tool gave 1,500
characters of each cited conversation, too few to judge; the drafts were
rendered again with 8,000 and the round redone, and the tool now shows
6,000 ([record](./2026-10-30-eval-review-tools.md)). Of 270 drafts, 132
were accepted, 50 of them edited, and one was left for the owner; with
the mined question, 133. Every decision is logged with its reviewer.
The owner's spot-check of a sample is pending.

| Type | Questions |
| --- | --- |
| single-session | 48 |
| multi-session | 38 |
| temporal | 23 |
| preference | 9 |
| abstention | 8 |
| knowledge-update | 6 |
| lookup | 1 |

## The runs

Claude Haiku 5.5 answered for every system, on the user's Claude plan;
GPT-6.1 Sol judged, through Codex at medium effort. Each run made 1,182
model calls, through plan limits it stopped at and resumed from, with no
call scored a miss: the baseline resumed 29 times, the rerun after a
memory reap and a limit. The answers' input was some 20 million tokens a
run, nearly all of it `full`'s 400,000 characters a question; judging,
some 10 million.

| System | Strict before | Strict after | Recall@10 before | Recall@10 after |
| --- | --- | --- | --- | --- |
| dorothy | 4.0% | 7.3% | 9.6% | 46.4% |
| lexical | 23.4% | 25.0% | 56.8% | 56.8% |
| full | 5.6% | 5.6% | 6.4% | 6.4% |

After the reviews, by type:

| Type | dorothy recall@10 | lexical recall@10 | dorothy strict | lexical strict |
| --- | --- | --- | --- | --- |
| multi-session | 86.8% | 68.4% | 2.6% | 2.6% |
| single-session | 14.6% | 62.5% | 2.1% | 47.9% |
| temporal | 8.7% | 60.9% | 0.0% | 30.4% |
| preference | 100.0% | 0.0% | 77.8% | 0.0% |

## What it shows

- Dorothy's retrieval rests on her notes: with none, she found the
  evidence for under a tenth of the questions; with them, nearly half,
  and most questions spanning sessions. Backfilled conversations need
  reviews before she can find them.
- She does not answer from what she finds: 77% of her answers declined
  where the evidence existed. Her retrieval returns notes, and a fact a
  question asks for is in the transcript. A second stage, the passage
  from each conversation found, is the plainest gap for the engine.

  *Correction, 2026-10-31:* her evaluated system does select passages,
  with the same function as lexical search's; they never fit beside the
  opening block and the knowledge ranked ahead of them. Of the 58
  questions whose evidence reached the answering model, 49 reached it
  only as a note in the block.
- Questions about one conversation, or its times, still favour lexical
  search, whose recall barely changed with the reviews: notes summarise
  a conversation, and such questions ask for its details.
- `full` is no ceiling at this size: 400,000 characters hold the newest
  slice of an archive of some 74 MB.
- The test leans towards lexical search, as its questions were drafted
  from transcript text and echo its words; and preference questions,
  drawn from knowledge files that only Dorothy indexes, lean towards
  her. Several types are too small to read alone: 9, 8, 6 and 1.

  *Correction, 2026-10-31:* lexical search reads knowledge too, scored
  with the conversations, so knowledge files were not only hers to find.

The corrections came from
[the engine's spec](../specs/2026-10-31-memory-engine-design.md).

## Rulings

1. The test set was drafted by the plans' strongest models, not the
   cheapest that passed the checks. Cost if wrong: more plan usage.
2. Agents pre-screened the drafts crosswise, with the owner's spot-check
   to follow, rather than the owner reviewing all 270. Cost if wrong: a
   test set nearer the agents' judgement than the owner's.
3. The judge ran at medium effort with a 600-second timeout, after high
   effort timed out on a third of the first judgements. Cost if wrong:
   slightly coarser verdicts.
4. Both runs used the plans, never an API: by the user's rule, Claude and
   ChatGPT plans come first. Cost: hours of waits at limits.

## Left

- The owner's spot-check, and a rerun of whatever it changes.
- The engine's spec, on these numbers: chiefly passage retrieval within
  what Dorothy finds.
