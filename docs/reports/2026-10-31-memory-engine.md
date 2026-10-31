---
ctime: 2026-10-31
mtime: 2026-10-31
spdx: GPL-3.0-only
title: The memory engine
description: >-
  The engine's first step built: passages delivered by one step shared
  by recall and the evaluation, hits carrying their turns, system
  variants and stage counts; the tasks, reviews, rulings, a
  retrieval-only verification and the paid runs that kept her engine.
tags:
  - dorothy
  - memory
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-31-memory-engine.md
   -
   -->

# The memory engine

## Summary

[The spec](../specs/2026-10-31-memory-engine-design.md) and
[the plan](../plans/2026-10-31-memory-engine.md) fixed delivery in
Dorothy's own engine before any engine is replaced. Eval's passage code
moved into `@dorothy/memory`, beside one `deliver` step that production
recall and the evaluation's `dorothy` system both use. The baseline's
hits carry their matched turns and alternate knowledge with
conversations, so ten knowledge hits no longer crowd out every
conversation. The evaluation gained system variants, a `cited` ceiling
and four stage counts. The first evaluation's report gained two
corrections. The paid runs took her strict accuracy from 7 to 40 of
124, past lexical search's 31, so her engine stays and Delivery is next.

Before execution, a Claude review (15 findings) and a Codex review (10)
of the plan were folded into it. Seven tasks were built by Claude
subagents and reviewed one by one, then the whole branch on Opus,
whose two Important findings and four minors were fixed in one wave
and re-reviewed.

## Reviews

- Task 2's implementer found the plan's excerpt narrowing subtracting
  escaped cost from a count of characters; it shrinks in proportion
  now. Its review found packing could cut an escaped item inside an
  entity; `pack` takes a trim for a cut item.
- The whole-branch review found a passage stopped growing at the first
  turn too long to fit, dropping the reply after it, which in recall's
  quarter of 4,000 characters is common. A passage seeded by search now
  skips such a turn; the overlap path, today's, is unchanged. It also
  found the delivered stage's filter pinned by no test; `stagesOf` is
  tested now, with a stand-in, a head-only passage and knowledge.
- The other reviews were clean, their minors logged for the final
  review, which triaged them as not blocking.

## Rulings

The plan's "Departures from the spec", ruled before execution:

1. Order is `mergeHits`'s argument, not a policy field, as the baseline
   cuts to its limit before delivery. Cost: none.
2. The policy's cap is in characters; the share is `ITEM_SHARE` and
   `dorothy`'s `cap`. Cost: none.
3. `deliver` also takes the query and an `escape` flag; items keep
   their delivered text, for coverage. Cost: none.
4. Unconfirmed knowledge carries its warning in the evaluation too.
   Cost: a context unlike the old one for unconfirmed knowledge.
5. `knowledge=whole` reproduces today's uncapped knowledge, so the
   knowledge cap is measured alone; the runs became six. Cost: one run.
6. Escaping comes before the cap. Cost: none (its accepted stray
   entity at a packing cut was later fixed).
7. Delivered and covered count opened items, a passage only while it
   holds a turn, and the block's full knowledge. Cost: none.
8. A stand-in's snippet is capped even under today's options. Cost: a
   long description cut where it was not.
9. A passage takes search's seeds alone where any remain. Cost: none.

During execution:

1. Packing's cut of an escaped item trims a partial entity, overriding
   Departure 6. Cost if wrong: a cut raw text loses a few characters.
2. The final wave took both Important findings and four minors.
   Cost if wrong: a seeded passage's range may span a skipped turn.
3. A cut item is marked in `DeliveredItem.cut`, not in the text the
   model reads. Cost if wrong: a model may take a cut item as whole.
4. `cited` gives unconfirmed knowledge without its warning. Cost if
   wrong: the ceiling differs from `dorothy` for such items.
5. Records' `retrieval.items` are not validated on read. Cost if
   wrong: a damaged record's items pass unchecked until read.

## Verification

`bun run check` passes under temporary XDG roots: 3,702 tests, one
existing skip. A retrieval-only run, on a copy of the evaluation's data
so the owner's stayed untouched, called no model and took four minutes:

```sh
bun run eval -- run --work "$copy" --retrieval-only --systems \
"dorothy:order=knowledge-first:dedupe=off:seeds=overlap:knowledge=whole,\
dorothy:dedupe=off:seeds=overlap:knowledge=whole,\
dorothy:seeds=overlap:knowledge=whole,dorothy:seeds=overlap,\
dorothy:block=0.2,dorothy:block=0.6,dorothy,lexical,cited"
```

| System | Found | Delivered | Delivered or noted | Covered |
| --- | --- | --- | --- | --- |
| today's options | 102/125 | 9/125 | 58/125 | 4.2% |
| alternation alone | 109/125 | 96/125 | 107/125 | 43.7% |
| duplicates removed | 109/125 | 99/125 | 110/125 | 45.3% |
| knowledge capped | 109/125 | 99/125 | 110/125 | 45.3% |
| block 0.2 | 109/125 | 103/125 | 111/125 | 45.8% |
| block 0.6 | 109/125 | 96/125 | 113/125 | 41.7% |
| `dorothy` | 109/125 | 98/125 | 109/125 | 43.7% |
| `lexical` | - | 69/125 | 71/125 | 35.8% |
| `cited` | - | 125/125 | 125/125 | 74.8% |

Today's options reproduce the reviewed rerun: 58 of 125 questions with
evidence in context, 9 of them delivered, all preferences. Alternation
alone delivers evidence for 96, past lexical search's 69, and her
coverage of gold answers' words rises from 4.2% to 43.7%, past
lexical's 35.8%. By type, at her defaults, she delivers evidence for
34 of 48 single-session questions (lexical 30), 31 of 38 across
sessions (25), 21 of 23 temporal (13) and 2 of 6 updates (1).
Search's seeds cover slightly less than overlap at her defaults
(43.7% against 45.3%); the paid runs will say whether answers follow.
Strict accuracy needs those runs, about two model calls a question a
system, which wait on the user's approval of the spend.

## The paid runs

The user approved the spend: Claude Haiku 5.5 answered on the reserve
Claude account, and `openai/gpt-6.1-sol` judged through OpenRouter at
its default effort. One job ran the nine systems above on the 133
reviewed questions, about 3,546 model calls in 53 minutes, without a
failure:

```sh
bun run eval -- run --work ~/eval --models ~/eval/eval.engine.toml \
  --systems "<the nine systems above>"
```

| System | Strict | Lenient | Preference strict | Abstained |
| --- | --- | --- | --- | --- |
| today's options | 7/124 | 10/124 | 4/9 | 8/8 |
| alternation alone | 35/124 | 45/124 | 2/9 | 8/8 |
| duplicates removed | 34/124 | 54/124 | 2/9 | 8/8 |
| knowledge capped | 37/124 | 55/124 | 1/9 | 8/8 |
| block 0.2 | 44/124 | 57/124 | 3/9 | 8/8 |
| block 0.6 | 40/124 | 58/124 | 1/9 | 8/8 |
| `dorothy` | 40/124 | 56/124 | 2/9 | 8/8 |
| `lexical` | 31/124 | 35/124 | 0/9 | 8/8 |
| `cited` | 90/124 | 102/124 | 7/9 | 8/8 |

Today's options reproduce the reviewed rerun's strict 9/124 at 7/124,
within the judge's noise. Alternation alone takes her from 7 to 35; at
her defaults she passes 40, past lexical search's 31, matching it on
single-session questions (22 of 48 each) and leading on temporal ones
(14 of 23 against 8) and those across sessions (2 of 38 against 1).
Search's seeds, which covered slightly less than overlap, answer
slightly more: 40 against 37. Of lexical search's 31 passes she shares
19, and seven questions only lexical search passes. Given the evidence,
`cited` passes 90: the gap from her 40 is in what she delivers and how
the model answers from it, as her coverage of the gold answers' words,
43.7% against the ceiling's 74.8%, shows.

### The decision

The spec's rule: if `dorothy` at its defaults reaches lexical search's
strict passes without losing her preference passes or her correct
abstentions, the engine stays hers and Delivery is next.

- Strict passes: 40 against 31. Met.
- Abstentions: 8 of 8 in every system. Met.
- Preference passes: strict 2 of 9, against 4 of 9 under today's
  options; lenient 9 of 9, against 7 of 9. Met on lenient, not strict.

Today's options, duplicates removed and `dorothy` all deliver the
preference questions' knowledge whole, in all nine. Today's options
place it first and twice, in the block and as an item; her defaults
place it once, third to fifth. The strict judge faults her answers for
leaving out AEST's `+10:00` and for citing a preference it cannot see.
Strict passes on these nine also flip between systems whose contexts
barely differ: duplicates removed and `dorothy` pass two each, not the
same two.

Ruling: the engine stays hers, and Delivery is next. Her strict passes
lead by nine, and on preferences she loses no lenient pass and gains
two; the strict dip is in where knowledge sits, not in search, so a
chunk index would not mend it. Cost if wrong: Delivery ships answers to
preference questions a little worse than today's until knowledge
placement is tuned, which the roadmap holds as a candidate.

### Left

- The owner's spot-check accepted its unsure draft, after edits, once
  the runs had begun, and has reopened no sampled accept. The runs used
  the 133 questions before it; the 134th is measured in the next run.
  Cost: one preference question unmeasured.
- The seven questions only lexical search passes, and the 12 of its 31
  passes she misses, are where a chunk index or hybrid search would be
  judged, later.

## Deferred

The reviews' minors the whole-branch review left, none blocking:

- Tests: no `runCli` test of a bad variant failing early; a tools test
  swapping its shared client; a stage test's inert `block` flag; no
  run-level errored lookup; a duplicated pack assertion; a cosmetic
  coverage example.
- Edges: an explicit `undefined` policy field overriding a default;
  `Number()` accepting `0x1` in variants; `makeSystem`'s spread losing
  a class's methods; a source's errors dropped without trace; a seeded
  passage holding a skipped seed's neighbour; excerpts splitting a
  surrogate pair; a system without search scored 0 on found when every
  record failed.
- Text: the first evaluation's Summary and "Left" lines, and its
  "only Dorothy indexes" clause, beside their corrections; the
  contract guide's door sentence; long lines in the fixture.
