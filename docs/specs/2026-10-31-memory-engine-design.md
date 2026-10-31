---
ctime: 2026-10-31
mtime: 2026-10-31
spdx: GPL-3.0-only
title: The memory engine
description: >-
  Design spec for the memory engine's first step: delivering the passage
  that holds a fact, shared by Dorothy's service and her evaluation, and
  measuring retrieval stage by stage before any engine is replaced.
tags:
  - dorothy
  - memory
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-31-memory-engine-design.md
   -
   -->

# The memory engine

## Summary

The [first evaluation](../reports/2026-10-31-first-evaluation.md) found
Dorothy's evidence recall at ten 46.4% after the backfill review, but
her strict accuracy only 7.3%, against lexical search's 25%. Research
before this spec, replaying that run read-only on the evaluation's own
data, found where the evidence goes:

- Her search ranks a cited source among its ten hits for 102 of 125
  questions (81.6%).
- Knowledge hits rank first and open to their full text; after the
  opening block's 40% share of the 8,000 characters, they fill the rest.
  Of the 58 questions whose evidence reached the answering model, 49
  reached it only as a conversation's note in the opening block. No
  cited conversation reached it as a passage.
- Of lexical search's 31 strict passes, 25 have a cited source among
  her ten hits already. Delivered, they could take her to about 27%: an
  estimate, not a measurement.
- In production, `/v1/recall` sends a host each hit's one-line snippet,
  never a passage; the search behind it drops the turns it matched.

The failure is in delivery, not in finding, so the engine stays hers
for now and is fixed where it fails. Hits carry the turns they matched;
one delivery step, in `@dorothy/memory`, turns ranked hits into
passages and knowledge within a budget, and both her service's recall
and the evaluation's `dorothy` system use it. The evaluation reports
each stage apart, and measures each change on its own. Should she reach
lexical search's strict accuracy, Delivery is next; should she not, the
next spec is a chunk index with hybrid search, written from the errors
that remain. The user chose this direction over an engine bake-off now
or adopting one outright, which the numbers do not support.

## Corrections to the first evaluation's report

Its report says two things the code does not bear out; this phase
corrects both in it, with a note of the correction:

- Dorothy's evaluated system does select passages, with the same
  function as lexical search's; they never fit beside the block and the
  knowledge ahead of them.
- Lexical search reads knowledge too, scored with the conversations;
  preference questions lean towards Dorothy for another reason, which
  this phase's stage counts should show.

## Decisions

| Decision | Choice | Why, and the cost if wrong |
| --- | --- | --- |
| Direction | Fix delivery in her own engine first; a chunk index, hybrid search or an adopted engine only on the errors that remain | Search already finds most evidence; replacing it would not move what fails. The user chose this. Cost: a later spec if delivery alone falls short |
| The engine's interface | `MemoryEngine` keeps its six methods; no new engine, index or service | Nothing about delivery needs one. Cost: none |
| What a hit carries | `MemoryHit` gains `turns?: number[]`: an episode hit's matched turn numbers, best first, at most three | Search finds them and the baseline drops them; a passage and an agent's `open` both start there. Additive, so no host breaks. Cost: none |
| Where delivery lives | `deliver` in `packages/memory/src/contract/deliver.ts`, exported through the package's evaluation entry as well as used by recall | The evaluation must run what production runs. Cost: the passage code moves out of eval |
| Order | Knowledge and episode hits alternate by rank, the best episode first; `order: "knowledge-first"` keeps today's | Reciprocal rank fusion over two lists that never share an item is alternation; their BM25 scores are on different scales. Cost: a top knowledge hit placed second |
| Duplicates | A caller may pass the ids it has shown in full; `deliver` leaves those knowledge hits out. An episode whose note was shown still gets its passage | The block already gave that knowledge in full; the passage is what was missing. Cost: recall, which knows nothing of the brief, may repeat knowledge |
| Room per item | No item takes more than a quarter of the budget (`cap: 0.25`) | Questions across sessions need more than one source in. Cost: a long knowledge body cut |
| Passage seeds | The hit's matched turns, then one neighbour each side, growing within the item's room; word overlap only for a hit without turns (`seeds: "overlap"` forces it) | Search ranked those turns by BM25 already. Cost: a turn matching the wording, not the answer, as overlap does today |
| Answer coverage | A proxy: the share of the gold answer's content words in the delivered passages of cited sources; no extra model call | Questions cite conversations, not turns. Cost: a paraphrased answer reads as missed; strict accuracy stays the verdict |
| Variants | A system name takes options, `dorothy:block=0.2:order=knowledge-first`, validated, recorded under the full name | Each change measured on its own, in one run beside the others. Cost: none |
| A ceiling | A diagnostic system, `cited`, delivers the cited conversations' passages and knowledge | Shows how far selection alone can go. Cost: none; it is never a contender |
| Comparability | Variant runs use the reviewed questions, snapshot, budget, answering model and judge of the first run's reviewed rerun | A change in any of those would hide the change measured. Cost: runs wait on those models' budgets |

## Hits and their turns

`search` in `recall/query.ts` keeps up to three matched turns per
conversation, each with its number, and the baseline engine keeps only
the first's text as the snippet. The baseline now also returns their
numbers, best first, as `turns` on the episode hit. The contract's
`MemoryHit` in `@dorothy/core` gains the optional field, and the MCP
`search` tool returns it, so an agent can `open` a conversation at the
turn that matched rather than its start. A hit with no matched turn, as
one found by its note alone, has none.

## Delivery

```ts
deliver(
    hits: MemoryHit[],
    source: EvidenceSource,
    budget: number,
    policy?: Partial<DeliveryPolicy>,
): { text: string; items: DeliveredItem[] }
```

- `EvidenceSource` gives, by contract id, a conversation's turns (with
  number, role, time and text) and title, or a knowledge item's text, or
  nothing for an id it cannot open. Production builds it on the
  archive's index; the evaluation on its corpus.
- `DeliveryPolicy` holds `order` (`"alternate"` or `"knowledge-first"`),
  `cap` (a fraction of the budget, default 0.25), `seeds` (`"search"`
  or `"overlap"`) and `shown` (ids given in full already, default none).
  Production uses the defaults.
- It orders the hits by `order`, leaves out knowledge in `shown`, renders
  each episode as a passage and each knowledge item as its text, each
  within `min(cap × budget, what is left)`, and packs them as `<item>`
  elements until the budget is spent. An item cut to fit is marked so.
- `DeliveredItem` records each item's id, kind, the turn range of a
  passage, its length and whether it was cut: what the evaluation
  records, and what a host could show.
- A hit whose source cannot be opened, as a hidden conversation or one a
  question excludes, is delivered as its title and snippet, as today.

## Passages

A passage starts from the hit's matched turns, best first, each with
the turn before and after, and grows while the item's room allows, its
turns in order with their numbers, roles and times, under the
conversation's title, project and dates. A single turn too long for the
room is excerpted around its first matched term. A hit without matched
turns, or `seeds: "overlap"`, falls back to today's scoring by distinct
query words. The function moves from eval's `systems/corpus.ts` into
memory, beside `deliver`, and eval imports it.

## Recall in production

`recallFor` keeps its host profiles, budgets and `<recalled>` frame, and
renders its hits through `deliver` instead of a line per hit. The
unconfirmed warning on knowledge stays before its text. Its response's
`ids` are the delivered items' ids, as now.

## The evaluation

### Systems

- `dorothy` opens the block with its share of the budget, searches as
  now, and passes the hits to `deliver` with the block's full ids as
  `shown`. Its options: `block` (share, default 0.4), `order`, `cap`,
  `seeds` and `dedupe` (`on` or `off`).
- `cited` delivers each question's cited sources through the same
  passage function, knowledge whole, within the budget. It is a
  diagnostic, reported apart.
- `lexical` and `full` are unchanged, apart from sharing the moved
  passage function.

A system name is `<system>[:<key>=<value>]...`; an unknown system, key or
value is a usage error naming what is allowed. `--systems` takes them
comma-separated, and records and summaries carry the full name.

### Stages

Each record and the summary gain, for each question and system:

1. **Found**: a cited source among the engine's hits before packing
   (systems with an engine only).
2. **Delivered**: a cited source in the context as a passage or knowledge
   item, not only as a note in the block. Today's "any cited id in the
   ranked ids" stays, renamed **Delivered or noted**.
3. **Covered**: the share of the gold answer's content words, by the
   evaluation's existing terms, in the delivered items of cited sources;
   reported as a mean and as the share of questions at 1.
4. **Strict** and lenient accuracy, as now.

Records also gain the delivered items, as `DeliveredItem`s. The summary
reports each stage by question type and overall.

### Runs

On the reviewed questions, in order, each beside the last, with
`lexical` and `cited` alongside:

1. `dorothy:order=knowledge-first:dedupe=off:seeds=overlap`, today's
   behaviour through the new code, which must reproduce the first run's
   reviewed rerun within the judge's noise;
2. `dorothy:dedupe=off:seeds=overlap`, alternation alone;
3. `dorothy:seeds=overlap`, with duplicates removed;
4. `dorothy:block=0.2` and `dorothy:block=0.6` beside `dorothy`, the
   block's share;
5. `dorothy`, every default.

Each run spends subscription usage, about two model calls a question a
system; the coordinating agent confirms the spend with the user before
the first and routes them by the agents' budgets. If the owner's
spot-check changes questions first, every run uses the changed set, and
the first run's comparison is made on the questions both share.

### The decision

If `dorothy` at its defaults reaches lexical search's strict passes on
the same questions, without losing her preference passes or her correct
abstentions, the engine stays hers and the roadmap moves to Delivery.
If it does not, the stage counts say where it falls short, and the next
spec is a chunk index with hybrid search, or an adopted engine's search
behind the contract, chosen on those counts. The report records the
runs, the counts and which way the decision went.

## Errors

- `deliver` never throws for an item: an unopenable source falls back to
  its snippet, an empty passage to the conversation's head line.
- A budget too small for one item's frame delivers nothing, as recall's
  does today.
- A variant name that does not parse fails the run before any model is
  called.

## Testing

Unit tests, on temporary roots and fixtures, never real data:

- the order: alternation, episode first; `knowledge-first`; an empty
  list of either kind;
- `shown` leaves out knowledge given in full, and keeps an episode whose
  note was shown;
- the cap: no item past `cap × budget`; a long knowledge body cut and
  marked;
- passages seeded from matched turns, with neighbours, in order; the
  overlap fallback; a long single turn excerpted;
- the baseline's hits carrying `turns`, best first, at most three, and
  the MCP `search` tool returning them;
- `recallFor` rendering passages within its budget, the unconfirmed
  warning first;
- the variant parser: each key, defaults, and each error;
- the stage counts on a constructed run: found, delivered, delivered or
  noted, covered;
- the `cited` system delivering exactly the cited sources;
- `dorothy` with today's options producing the context the old code
  produced on a fixture corpus.

## Verification

- `bun run check` passes under temporary XDG roots.
- On a copy of the evaluation's data, read-only, a dry run of each system
  on a few questions with a fake model shows passages of cited sources
  in `dorothy`'s context.
- The runs above, once the user approves the spend, with the report
  giving each stage's counts and the decision.

## Documentation

- The first evaluation's report gains the two corrections.
- `packages/memory/AGENTS.md` and `packages/eval/AGENTS.md` describe
  `deliver`, the hit's turns and the variants; the core contract's
  comment the new field.
- The roadmap is revised once the phase merges.

## Later

- A chunk index with hybrid search and reranking (qmd or a small local
  vector layer), if delivery falls short.
- Adapters to the field's engines behind the contract, first Hindsight
  with its source chunks, with a factory to choose an engine and fall
  back to the baseline, which construction lacks today.
- A model judge of whether the context holds the answer, if the coverage
  proxy proves misleading.
- Questions citing turns, not only conversations, for exact coverage.
- An answering agent that may call `open` itself, as hosts' agents do.
- Recall told what a host's brief showed, to leave out its knowledge.
