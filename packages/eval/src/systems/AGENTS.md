---
ctime: 2026-10-31
mtime: 2026-10-31
spdx: GPL-3.0-only
title: packages/eval/src/systems/AGENTS.md
description: >-
  The evaluation's systems: what each is asked and gives back, how a
  variant is named, and the four systems.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/eval/src/systems/AGENTS.md
   -
   -->

# packages/eval/src/systems/AGENTS.md

The systems a run asks each question of. The passage, term and packing
code is memory's, from `@dorothy/memory/evaluation`; a system here only
chooses what to hand it.

## What a system meets

- `system.ts`: a `System` is asked an `Asked` (the question, its date,
  project, the phrase of the conversation to leave out, and its
  `evidence` ids, which only `cited` reads) and a budget of characters.
- It returns `Retrieved`: `ranked` ids best first and the `context`
  the answering model reads. Every ranked id is in the context: an item
  the budget cut off is not ranked.
- `found` is the engine's hits before packing and `items` what went
  into the context, as delivered (range, cut, opened, and the text);
  `dorothy` also lists the block's full knowledge, marked `block`. A
  system with no engine gives no `found`. The run records them as
  stages: found, delivered, covered.

## Names

A system is named `<system>[:<key>=<value>]...`. `checkSystem` parses
and checks a name before anything opens, so a bad option is a
`UsageError` at the start; `makeSystem` builds it, keeping the name
whole. `OPTIONS` and `MAKERS` are keyed alike, and `noOptions` refuses
options for a system with none. `dorothy` takes `block` (0.4 of the
budget), `order` (`alternate`), `cap` (0.25), `seeds` (`search`),
`dedupe` (`on`) and `knowledge` (`capped`); `DOROTHY_DEFAULTS` holds
them. The default systems are `dorothy`, `lexical` and `full`.

## The systems

- `dorothy.ts`: her opening block with its share, then her search's
  hits, knowledge and episodes merged, through memory's `deliver`.
- `lexical.ts`: the bound from below: every turn and knowledge file
  scored by the question's terms, the best twenty packed by
  `packDelivery`.
- `full.ts`: the bound from above, where it fits: everything, newest
  first, packed by `packDelivery` with each conversation's whole range.
- `cited.ts`: a ceiling, never a contender: the question's own
  evidence, delivered as `dorothy` does. It is not among the default
  systems and is never "alone right" or "alone wrong" in a report.
- `corpus.ts`: the snapshot's archive opened once, and the
  `EvidenceSource` over it.
