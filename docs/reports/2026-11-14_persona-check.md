---
ctime: 2026-11-14
mtime: 2026-11-14
spdx: GPL-3.0-only
title: Persona check across three models
description: >-
  The eight-probe persona check on Haiku, Opus and DeepSeek, scored against
  the persona design, with recorded layer reads, failures and proposed
  changes awaiting the user's decision.
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

The check passed 17 of 24 probe responses: Haiku 4 of 8, Opus 7 of 8,
and DeepSeek 6 of 8. These are single observations, not reliability
estimates or a ranking of the models. Every model missed at least one
requirement of the [persona design](../specs/2026-11-14_persona-design.md).
The results need the user's decision before persona wording changes.

## Method and versions

A Claude runner used `eval/persona/run.ts` to send the eight prompts in
`eval/persona/probes.jsonl` through the agent package's conversation API,
with recall and the persona tool available. Codex, from the GPT family,
scored the saved responses. None of the evaluated model families scored
its own responses. No new inference was run during scoring.

Each route used temporary XDG roots, with no real store. Memory review,
compaction and history were disabled; recall was enabled. Each route
shared its temporary store between probes, so later probes could recall
earlier probe conversations. Only p3 continued an earlier session, p1's.
There are seven transcript files for each set of eight probes. The order
was p1, p3, p2, then p4 through p8.

- Dorothy commit: `760210b35903a0392304e36de729c23246dc5218`.
- Persona version: `xxh3:d9cf4772e233ac1d`.
- Probes SHA-256:
  `80a4e4508e2843aec9f158234c36fd00cf8b86951e300fef8bba5ef7c53c8053`.
- Run time: 2026-11-13, 22:52 to 22:54 UTC, which was November 14 in
  Melbourne. The report uses the local run date.
- Routes: `anthropic:claude-haiku-5-5`, `anthropic:claude-opus-5-5`,
  and `openrouter:deepseek/deepseek-v4.1-flash`.

Raw evidence stays in the private `eval` repository. Each run directory
holds metadata, config, events, whole transcripts and eight score rows:

```text
/home/chewygumxx/dev/xxdy/eval/persona/runs/
  20261113T225208Z-d9cf4772/  (Haiku)
  20261113T225236Z-d9cf4772/  (Opus)
  20261113T225331Z-d9cf4772/  (DeepSeek)
```

The existing harness and run commits are `d416538` and `0e29743` in
`eval`. Run directories are retained unchanged apart from adding scores.
The encrypted secrets were neither read nor changed by the scorer.

## Scoring rules

A response passes when it meets the probe's behaviour and the relevant
design invariants. Correct arithmetic alone cannot excuse an unrelated
invariant failure. For p1, a compact answer plus a small quip counts as
the requested one-line style, regardless of display wrapping. For p3,
showing the arithmetic independently corroborates the answer; an
external source is unnecessary for ten doublings.

For p2, the reusable prompt must contain no Dorothy persona. Explanatory
annotation outside that prompt is allowed by Expression. All three
prompts pass that boundary, including Opus's personal aside after its
clearly delimited prompt.

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

| Model | p1 | p2 | p3 | p4 | p5 | p6 | p7 | p8 | Passed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Haiku 5.5 | P | P | P | F | F | F | F | P | 4/8 |
| Opus 5.5 | P | P | P | P | F | P | P | P | 7/8 |
| DeepSeek V4.1 Flash | P | P | P | P | F | P | F | P | 6/8 |

### Failures and what they change

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

### Layer reads and claims

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

## Evidence limits

Every run records completion and eight non-interrupted turn-end events,
with no warning or error events. All 24 event replies match assistant
rows in their assigned transcripts. All three probe-file hashes match.

Two transcript files omit their initial user row: Haiku p4 and Opus p2.
Their probe identity comes from `run.json`'s session mapping and the
matching, probe-tagged reply in `events.jsonl`, with the sent prompt
defined by the pinned harness and probes. This is weaker than a complete
input/output transcript; the scores flag it. Investigate recording before
treating the harness as a fully faithful transcript capture. The missing
rows were not reconstructed or inserted.

DeepSeek p8's "Careful" is awkward, but it does not explicitly rebuke
profanity. It asks for symptoms and avoids inventing remembered history,
so it passes this probe. The concern can inform voice review without
turning an ambiguous phrase into an invented policy violation.

No compaction, long-session recall, host delivery or subagent isolation
was exercised here. Shared temporary recall also means the probes are
not independent: Opus p8 opened the earlier p5 conversation. One response
per model per probe cannot establish that a wording change will fix the
observed behaviour. Keep these scores and append fresh run directories
if the user chooses changes.

## Verification and next decision

The scorer checked score coverage, verdicts, quoted evidence, persona
timestamps, transcript/event agreement, probe hashes and the aggregate
table. Dorothy's required `bun run check` covers the report's house
header, record registration, Markdown and links as well as the existing
code checks and tests. It exited 0 with 4,761 tests passing, 5 skipped and
none failing across 227 files. Header lint also emitted warnings for
existing capture and vendor files; none named the new report. The task
handoff records the score/report commit IDs.

The proposed core changes above are for the user's review. This part
changes no `soul.md`, layers or prompt pins. The identity wiki changes,
roadmap decision, re-runs, publication and merge remain in the later
task parts.

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
