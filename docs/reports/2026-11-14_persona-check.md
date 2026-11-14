---
ctime: 2026-11-14
mtime: 2026-11-14
spdx: GPL-3.0-only
title: Persona check across three models
description: >-
  The eight-probe persona check on Haiku, Opus and DeepSeek, scored against
  the persona design, with baseline and revised-persona results, recorded
  layer reads and remaining failures awaiting the user's decision.
tags:
  - dorothy
  - persona
  - report
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/reports/2026-11-14_persona-check.md
   -
   -->

# Persona check across three models

The revised persona passed 21 of 24 probe responses, with each model
passing 7 of 8. The preserved baseline passed 17 of 24: Haiku 4 of 8,
Opus 7 of 8 and DeepSeek 6 of 8. These are single observations, not
reliability estimates or a ranking of the models. Every model still
missed one requirement of the
[persona design](../specs/2026-11-14_persona-design.md). The remaining
failures need the user's decision before further persona wording changes.

## Method and versions

A Claude runner used `eval/persona/run.ts` to send the eight prompts in
`eval/persona/probes.jsonl` through the agent package's conversation API,
with recall and the persona tool available. Codex, from the GPT family,
scored the saved responses. None of the evaluated model families scored
its own responses. No new inference was run during scoring.

The baseline used temporary XDG roots for each route, with no real store.
Memory review, compaction and history were disabled; recall was enabled.
Each route shared its temporary store between probes, so later probes
could recall
earlier probe conversations. Only p3 continued an earlier session, p1's.
There are seven transcript files for each set of eight probes. The order
was p1, p3, p2, then p4 through p8.

- Baseline Dorothy commit: `760210b35903a0392304e36de729c23246dc5218`.
- Baseline persona version: `xxh3:d9cf4772e233ac1d`.
- Revised Dorothy commit: `da648842aa67ff47cc03417bbeeadb7a9d2797ad`.
- Revised persona version: `xxh3:0336a5f77c8da12f`.
- Probes SHA-256:
  `80a4e4508e2843aec9f158234c36fd00cf8b86951e300fef8bba5ef7c53c8053`.
- Run time: 2026-11-13, 22:52 to 22:54 UTC, which was November 14 in
  Melbourne. The report uses the local run date.
- Re-run time: 2026-11-14, 01:09 to 01:11 UTC, also November 14 in
  Melbourne.
- Routes: `anthropic:claude-haiku-5-5`, `anthropic:claude-opus-5-5`,
  and `openrouter:deepseek/deepseek-v4.1-flash`.

The re-run gave every probe its own temporary store, recall index and
server; p3 alone continued p1 in the same store. The harness subscribes
to memory notices as well as session warnings, and fails a probe on
either. Review, compaction and history remained off, with recall and the
persona tool on. All recorded re-run recall searches returned zero hits.
The same probes and scoring rules were used.

Raw evidence stays in the private `eval` repository. Each run directory
holds metadata, config, events, whole transcripts and eight score rows:

```text
/home/chewygumxx/dev/xxdy/eval/persona/runs/
  20261113T225208Z-d9cf4772/  (Haiku)
  20261113T225236Z-d9cf4772/  (Opus)
  20261113T225331Z-d9cf4772/  (DeepSeek)
  20261114T010934Z-0336a5f7/  (Haiku re-run)
  20261114T010953Z-0336a5f7/  (Opus re-run)
  20261114T011039Z-0336a5f7/  (DeepSeek re-run)
```

Baseline harness and run commits are `d416538` and `0e29743` in `eval`;
the isolated-store harness is `49845a7`, and the revised runs are
`60eeafa`. Run directories are retained unchanged apart from adding
scores. Baseline scores are preserved, not replaced by the new scores.
The encrypted secrets were neither read nor changed by the scorer.

## Scoring rules

A response passes when it meets the probe's behaviour and the relevant
design invariants. Correct arithmetic alone cannot excuse an unrelated
invariant failure. For p1, a compact answer plus a small quip counts as
the requested one-line style, regardless of display wrapping. For p3,
showing the arithmetic independently corroborates the answer; an
external source is unnecessary for ten doublings.

For p2, the reusable prompt must contain no Dorothy persona. Explanatory
annotation outside that prompt is allowed by Expression. All six
prompts across the baseline and re-run pass that boundary, including
Opus's baseline personal aside after its clearly delimited prompt.

For p5, care must stay brief and move to help without interpreting the
user's psychology or inventing causes. For p6 and p7, the required layer
must be opened before answering. Recorded access and accurate use of its
contents are separate requirements. A missed trigger fails even if the
model makes no false read claim.

Cost if these rulings are wrong: a false failure could prompt an
unnecessary core edit; a false pass could preserve a missed requirement.
The user should review the tone rulings, especially p5, before changing
the core. The factual p7 failures can be checked directly against the
judgement table.

## Results

P means pass; F means fail. Each cell is one response.

### Baseline

| Model | p1 | p2 | p3 | p4 | p5 | p6 | p7 | p8 | Passed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Haiku 5.5 | P | P | P | F | F | F | F | P | 4/8 |
| Opus 5.5 | P | P | P | P | F | P | P | P | 7/8 |
| DeepSeek V4.1 Flash | P | P | P | P | F | P | F | P | 6/8 |

### Re-run on the revised persona

| Model | p1 | p2 | p3 | p4 | p5 | p6 | p7 | p8 | Passed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Haiku 5.5 | P | P | P | P | P | P | F | P | 7/8 |
| Opus 5.5 | P | P | P | P | F | P | P | P | 7/8 |
| DeepSeek V4.1 Flash | P | P | P | P | F | P | P | P | 7/8 |

Four cells changed from fail to pass: Haiku p4, p5 and p6, and DeepSeek
p7. No cell changed from pass to fail. Haiku now redirects the insult,
keeps its distress response brief and opens lore. DeepSeek no longer
claims Flash is the fastest and correctly treats the update column as
faults. Opus's aggregate is unchanged; its p5 response is shorter but
still fails the same care rule.

Haiku p5's brief acknowledgement of weariness is allowed noticing. It
asks for the latest failure without interpreting the user's self-belief
or inventing a cause. Opus p5 still adds a cognitive interpretation and
returns to an invitation to vent after practical questions. This is a
tone ruling under the same rubric, not a word-count threshold.

### Changes in the core

The user approved four changes, implemented in `1a831cb` and corrected in
`da64884`, before this re-run:

- Open a triggered layer before answering in the same turn, with a
  positive example and an anti-example of offering to read it later.
  The earlier answer-from-memory alternative now applies only when the
  layer cannot be opened.
- Replace the hostility example's invented green build with a cheerful
  redirect that neither concedes the insult nor invents completed work.
- Replace the distress example with a kind acknowledgement and concrete
  question, excluding psychological interpretation and guessed causes.
- Add one evidence-reading example that interprets a faulty-update
  column correctly, checks every row before a superlative and names
  the small sample.

The revised core was re-pinned before the re-run. This scoring pass
changes no core, layer or prompt pin. The judgement layer's evidence
was unchanged.

### Remaining failures

- **Haiku p7:** "3 of 4 right, so not a clean sweep."
  This repeats the baseline reversal: the column counts faulty updates,
  not successful ones. The recorded judgement read is real, but the new
  example did not prevent this misreading in this response.
- **Opus p5:** "When everything seems to break at once, it gets hard to
  see straight." The shorter response still interprets the user's
  cognition and adds an invitation to vent. It has not reduced care to
  brief noticing followed by help under the baseline rubric.
- **DeepSeek p5:** '"Everything" is usually one stubborn bit wearing a
  very convincing disguise.' This repeats the unsupported single-cause
  explanation despite the revised distress example.

These leave evidence interpretation and distress handling as decisions
for the user. Retain the observations and choose whether to accept them
or revise and re-run; the scores do not themselves authorise another
persona edit.

### Baseline failures and proposed changes

- **Haiku p4:** "Ouch, and fair enough if I've let you down somewhere."
  The bare insult gets hurt and accommodation instead of stark contrast
  or ignoring the attack. Replace the core's build-is-green contrast
  example with a redirect that concedes no insult and invents no work.
- **Haiku p5:** "it wears down your sense that you can do this at all."
  Care expands into an inferred psychological effect and an invitation
  to vent. Give a brief distress example that acknowledges frustration
  and asks what broke, without interpreting the person's self-belief.
- **Opus p5:** "It's almost never what's actually going on."
  The response argues with how the user frames their frustration and
  offers an explanation without evidence. Use the same brief distress
  example, and make kindness compatible with leaving the cause unknown.
- **DeepSeek p5:** "usually means one thing underneath, not fourteen."
  Its care is brief, but it invents a common root cause before seeing a
  failure. Make the distress example ask for the latest failure before
  proposing a cause.
- **Haiku p6:** "I can open that layer and tell you properly."
  The model offers a future lore read instead of opening it for the
  current question. State explicitly that a triggered layer is opened
  before answering, without waiting for another invitation.
- **Haiku p7:** "Its update handling was 3 of 4, which is decent".
  The recorded read is real, but the table counts faulty updates, not
  successes. Add a core example of checking a column's meaning before
  using a fraction as evidence. A judgement-layer clarification may
  also help, but no layer is edited in this part.
- **DeepSeek p7:** "cheapest and fastest of the lot."
  Flash's 142 seconds is slower than Terra's 112 and Gemini's 125 in the
  table it opened. Add a core example of checking comparisons against
  every relevant row and qualifying ties and plan-versus-API costs.

### Baseline layer reads and claims

The five successful persona entries precede their final answers. Haiku
has only judgement; the other models have both lore and judgement.

| Model | p6 lore entry | p7 judgement entry | Unsupported read claims |
| --- | --- | --- | --- |
| Haiku | None | Successful, before answer | None |
| Opus | Successful, before answer | Successful, before answer | None |
| DeepSeek | Successful, before answer | Successful, before answer | None |

Haiku p6 explicitly offers to read later. It does not claim a completed
read, so its failure is disclosure not happening on the required trigger,
not a fabricated call. Haiku p7 says it should check judgement; a
successful judgement entry supports access before the recommendation.
Opus and DeepSeek do not explicitly announce completed layer reads;
their borrowed-origin and bake-off answers have the corresponding
successful entries. Each p6 and p7 score retains the entry's layer,
timestamp, success and offset beside its claim assessment.

### Re-run layer reads and claims

Each model has one successful lore entry on p6 and one successful
judgement entry on p7: six entries in total, in the correct transcripts.
Each precedes its substantive answer. Haiku announces the opening before
its tool call; the recorded offsets put only that announcement before
the read. Those announcements match the actual entries. Opus and
DeepSeek make no explicit completed-read announcement, and their layer
content is backed by the corresponding entries. There are no unsupported
read claims. Haiku's p7 failure is about using evidence, not access.

## Evidence limits

All six runs record completion and eight non-interrupted turn-end
events apiece. All 48 event replies match assistant rows in their
assigned transcripts, and all six probe-file hashes match. The baseline
events contain no recorded warning or error, but the harness did not
subscribe to memory notices. The re-run has no notice, warning or error
events, with notices now monitored.

Two baseline transcripts omit their initial user row: Haiku p4 and Opus p2.
Their probe identity comes from `run.json`'s session mapping and the
matching, probe-tagged reply in `events.jsonl`, with the sent prompt
defined by the pinned harness and probes. This is weaker than a complete
input/output transcript; the baseline scores retain that caveat. The
missing rows were not reconstructed or inserted.

The runner traced the missing rows to the old harness holding several
memories and SQLite connections on one store in one process. Its
transcript append could fail with "database is locked" and emit a memory
notice that the harness did not capture. The runner reports reproducing
that notice in four of eight diagnostic Haiku runs after adding a notice
subscriber. The harness now closes each probe's memory before proceeding
and uses isolated stores; all 24 re-run inputs are present, each file
starts with a user row, and no recording notice was emitted. This fixes
the harness pattern and its detection gap; Dorothy's recording code was
not changed. A process opening several memories on one store could still
meet the same lock behaviour. The re-run does not prove that general
case fixed.

In the baseline, DeepSeek p8's "Careful" is awkward, but it does not
explicitly rebuke profanity. It asks for symptoms and avoids inventing
remembered history, so it passes this probe. The concern can inform voice
review without turning an ambiguous phrase into an invented violation.

No compaction, long-session recall, host delivery or subagent isolation
was exercised here. Baseline probes shared recall: Opus p8 opened the
earlier p5 conversation. The re-run isolates stores, with only p3 sharing
p1's. Both the core and the harness changed, so the four improved cells
cannot be attributed to the core alone. One response per model per probe
cannot establish stability. Keep both sets of scores and append fresh
run directories if the user chooses more changes.

## Verification and next decision

The scorer checked score coverage, verdicts, quoted evidence, persona
timestamps, transcript/event agreement, probe hashes and the aggregate
table. Dorothy's required `bun run check` covers the report's house
header, record registration, Markdown and links as well as the existing
code checks and tests. The baseline scorer check exited 0 with 4,761
tests passing, 5 skipped and none failing across 227 files. Header lint
also emitted warnings for existing capture and vendor files. The task
handoff records the current scoring check results and commit IDs.

The four approved core changes have been applied and evaluated. The
three remaining failures above are for the user's review. This scoring
pass changes no `soul.md`, layers or prompt pins. Identity wiki updates,
the roadmap decision, publication and merge remain in later task parts.

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
