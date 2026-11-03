---
ctime: 2026-11-03
mtime: 2026-11-03
spdx: GPL-3.0-only
title: Decisions
description: >-
  Why Dorothy's significant choices were made: for each subject, the
  context, the alternatives, who chose, the reason, the cost, whether the
  choice still stands, and the records that say so.
tags:
  - wiki
  - decisions
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/wiki/decisions.md
   -
   -->

# Decisions

[Wiki home](../README.md)

This page records why choices that shaped Dorothy, or that shape what is
planned, were made. The topic pages say what exists now; an entry here
links them and does not explain the mechanism again. Entries are grouped
by the seven subjects of the [records catalogue](./records.md), and each
rests on a ruling, a specification's decision, a roadmap revision or a
`feedback` memory in `.agents/memory/` where the user set a direction.
Minor implementation rulings stay in their reports.

Each entry is one list of bold lead-ins:

- **Context**: what prompted the choice.
- **Alternatives**: what else was weighed or rejected, where the record
  says. A choice that records no alternative says so.
- **Choice**: what was chosen, and who chose when the record says. A
  specification's decision table often does not name who ruled; the entry
  then says so, and no approval is inferred from a specification existing.
- **Reason**: the reason the record gives. `Reason: not recorded` marks a
  decision whose record gives none.
- **Cost**: the cost if wrong, or the cost the record names.
- **Standing**: current, superseded (by which later decision) or revisited,
  with its date, as of 2026-11-03.
- **Sources**: the records and, where useful, the page that shows the
  present.

The subjects: [Memory](#memory), [Evaluation](#evaluation),
[Identity, harnesses and delivery](#identity-harnesses-and-delivery),
[Models and routing](#models-and-routing), [Terminal](#terminal),
[Orchestration](#orchestration) and [Repository workflow](#repository-workflow).

## Memory

How the memory is built is on [memory](./topics/memory.md).

### Memory is judged by four priorities, in order

- **Context**: A research pass on open-source replacements judged each by
  whether it reproduced Dorothy's own design, and so found that nothing
  could replace her memory.
- **Alternatives**: Parity with the current code as the test, which that
  pass used.
- **Choice**: The user, on 2026-10-18, ranked what her memory must do:
  compatibility (any client, harness and model provider), access,
  progressive disclosure, then persistence. Every other constraint is
  negotiable, "nothing is forgotten" and readable files included.
- **Reason**: The user corrected the research pass, which had judged by
  parity with her current design.
- **Cost**: not recorded.
- **Standing**: current. The evaluation measures the second priority,
  access ([spec](../specs/2026-10-18-memory-evaluation-design.md#purpose)).
  The rule it loosened has its own entry below, "Nothing is forgotten".
- **Sources**:
  [memory priorities](../../.agents/memory/memory-priorities.md),
  [open-source replacements](../notes/2026-10-18_open-source-replacements.md),
  [protocol diversity, ruling 5](../reports/2026-10-18-protocol-diversity.md#rulings).

### Her memory is one service of her own, with the engine swappable

- **Context**: Recording, the engine and delivery all meet at one
  interface, so the contract was the first spec of the memory phase.
- **Alternatives**: Adopting a provider's API as the contract (Hindsight's)
  was rejected: it would tie every harness's wiring to one engine.
  Generated files alone were rejected: they go stale between
  regenerations and choose nothing per session.
- **Choice**: Agreed with the user on 2026-10-18: one memory service of her
  own, speaking MCP and a hook API, the engine swappable behind it;
  knowledge as editable files in Google's Open Knowledge Format, which
  engines index and enrich but never own; scopes personal and per project.
- **Reason**: The contract stays hers, which compatibility asks, and files
  are inspectable and portable whatever the engine.
- **Cost**: not recorded; the contract's decision table gives reasons only.
- **Standing**: current. The service and its four tools are built
  ([memory](./topics/memory.md#the-shared-service)). Her baseline engine is
  the only one behind it; no other has been run (see "Her engine stays
  hers" below).
- **Sources**:
  [contract spec](../specs/2026-10-18-memory-contract-design.md#decisions),
  [contract report](../reports/2026-10-18-memory-contract.md).

### Nothing is forgotten, as a preference

- **Context**: The memory store was reworked so that a fact that no longer
  serves is retired, and the user had said that nothing should be
  forgotten.
- **Alternatives**: not recorded as weighed; the spec says memories fade
  by ranking, never by deletion or expiry.
- **Choice**: The store spec's decision: a retired fact leaves the
  repository's copy and sinks below live facts, but stays in the store, in
  search and in history, and can be revived. The spec does not say who
  ruled. The user's ambition, stated on 2026-10-15, listed it as an aim.
- **Reason**: not recorded.
- **Cost**: The roadmap holds two candidates that follow from keeping
  everything: retired facts and sync records kept indefinitely, and,
  related, history growing without bound, which needs its own design to
  prune.
- **Standing**: revisited 2026-10-18. The user's ranking made it a
  preference rather than a rule, negotiable behind the four priorities.
  The code still deletes no fact
  ([memory](./topics/memory.md#what-is-stored)).
- **Sources**:
  [store spec](../specs/2026-10-15-memory-store-design.md#decisions),
  [Dorothy's ambition](../../.agents/memory/dorothy-ambition.md),
  [memory priorities](../../.agents/memory/memory-priorities.md),
  [roadmap candidates](../roadmap.md#candidates).

### Unconfirmed knowledge is fenced, not dropped

- **Context**: `remember` runs without a prompt, so text injected through a
  page or a tool can become knowledge, and the opening block took every
  piece of knowledge.
- **Alternatives**: Drop it, or leave it as it was.
- **Choice**: The user chose to fence it, of three options. On 2026-10-20,
  after the sweep's final review, the user fixed the rule: confirmed means
  they wrote it, or ran `dorothy --verify` on it.
- **Reason**: The roadmap sweep's spec records the choice and the threat,
  not a further reason.
- **Cost**: A warning on unconfirmed knowledge wherever it appears,
  including per-prompt recall passages, which cost a few words; the sweep
  report rules that it applies however text is reached.
- **Standing**: current. Confirmed and unconfirmed knowledge are told apart
  throughout recall ([memory](./topics/memory.md#what-is-stored)).
- **Sources**:
  [sweep spec](../specs/2026-10-19-roadmap-sweep-design.md#unconfirmed-knowledge),
  [sweep report, ruling 3](../reports/2026-10-19-roadmap-sweep.md#rulings).

### Compaction is Dorothy's, in clusters she summarises

- **Context**: Nothing stopped the CLI under the Agent SDK compacting the
  session with Claude Code's own summariser, in its voice, while the notes
  on other conversations stayed as large as at launch.
- **Alternatives**: The CLI's own compaction, which the design switched off
  with `DISABLE_COMPACT`.
- **Choice**: The compaction spec's decisions: Dorothy splits the older
  turns by topic into clusters, writes each abstract herself, compacts at
  the next idle moment past a soft threshold, and keeps every abstract in
  context. The model of clusters is the user's, in the user's words from
  the recall brief. The spec does not say who ruled each row.
- **Reason**: A conversation's older turns decay into memory in Dorothy's
  voice, and notes on other conversations fade as this one grows. A live
  probe found that without the switch the CLI compacted on every turn from
  the third, and with it never.
- **Cost**: not recorded.
- **Standing**: current for her compaction. Its mechanism for keeping the
  CLI's own off is superseded: `DISABLE_COMPACT` appears nowhere in
  `packages/` now, since model providers retired the Agent SDK on
  2026-11-01 (see "Her own runtime" below).
- **Sources**:
  [compaction spec](../specs/2026-10-07-compaction-design.md#decisions),
  [probes](../reports/2026-10-07-compaction.md),
  [memory](./topics/memory.md#compaction).

### Tags are coined in review and corrected by the user

- **Context**: Conversations needed a vocabulary of concepts, mostly for
  the user's own organisation.
- **Alternatives**: Dorothy editing existing concepts was left to cyclical
  maintenance; the memory block carrying tags was left out in favour of
  recall's tools.
- **Choice**: The tags spec's decisions: Dorothy coins a concept freely only
  when none fits, tags shallowly inside the idle review, and names concepts
  by label so an invented id is impossible; the user renames, merges and
  deletes, and a deleted concept leaves a tombstone. The spec does not say
  who ruled each row.
- **Reason**: The review is the closest thing to a conclusion in a TUI that
  may be quit at any time and costs no extra request; her notes are worth
  more than her tags, so a bad tag never fails a review.
- **Cost**: not recorded. The roadmap holds the vocabulary's limits for
  maintenance: labels compare without case, tombstones accumulate, a
  renamed concept's old label may be coined again.
- **Standing**: current. Revising and pruning the vocabulary awaits
  [cyclical maintenance](../roadmap.md#cyclical-maintenance-4a), whose
  design is agreed and awaits a spec.
- **Sources**:
  [tags spec](../specs/2026-10-07-tags-design.md#decisions),
  [maintenance design](../../.agents/memory/maintenance-design-agreed.md).

### The data directory is a git repository with a sealed mirror

- **Context**: A `tags.json` broken by a hand edit, a disk fault or a bug
  would stop tagging outright, and a valid but wrong file could be caught
  by no check.
- **Alternatives**: not recorded, apart from the two git engines the spec
  keeps behind one contract (the git binary, with isomorphic-git as
  fallback).
- **Choice**: The user's words set the direction: an unparseable
  `tags.json` "is a catastrophic failure that requires redundancy to
  ensure recovery", and her memory should be "a git repository with
  pre-commit lint checks". The spec's decisions followed: history moves only
  forward, a mirror is required and what leaves the machine is encrypted,
  and memory works whether or not history does.
- **Reason**: Recovery from any single bad write, hand edit or maintenance
  pass, and a lost disk costing at most what was not pushed.
- **Cost**: History grows without bound; the roadmap holds pruning as a
  candidate that needs its own design.
- **Standing**: current, built and probed live
  ([memory](./topics/memory.md#history)).
- **Sources**:
  [history spec](../specs/2026-10-08-memory-history-design.md#decisions),
  [probe](../reports/2026-10-08-memory-history.md),
  [deferred findings](../deferred/2026-10-08_memory-history-deferred.md).

### Her engine stays hers

- **Context**: The first evaluation found that reviewing the backfill lifted
  her recall at 10 from 9.6% to 46.4%, yet her strict accuracy stayed at
  7.3% beside lexical search's 25.0%. These first-evaluation figures were
  measured before the judges changed and are historical. The engine's
  research then found her search ranked a cited source among its ten hits
  for 102 of 125 questions, but knowledge hits crowded out the passages:
  of the 58 questions whose evidence reached the model, 49 had it only as a
  conversation's note. The failure was delivery, not finding.
- **Alternatives**: Replace the engine: an engine bake-off at once, adopting
  one outright, a chunk index with hybrid search, or an adopted engine's
  search behind the contract. The user chose to fix delivery in her own
  engine first, over a bake-off or an adoption, which the numbers did not
  support. The spec's rule fixed the test: if `dorothy` at its defaults
  reached lexical search's strict passes, without losing her preference
  passes or her correct abstentions, the engine stayed hers and Delivery
  came next; if not, the next spec was a chunk index with hybrid search or
  an adopted engine's search, chosen on the stage counts.
- **Choice**: In order, as the
  [engine report](../reports/2026-10-31-memory-engine.md) records it:
  - The first paid run (nine variants, 124 questions counted strictly): at
    her defaults 40 strict passes against lexical search's 31, 8 of 8
    abstentions, but preferences 2 of 9 strict. A first ruling kept her
    engine on her strict lead, taking the preference dip for placement. The
    report does not say who made that ruling.
  - The user overturned it: 2 of 9 is below adequate, so the rule was not
    met.
  - Two probes then looked for the cause, each on the ten accepted
    preference questions, each system run three times. Placement was not
    it: knowledge first scored 7 of 30 as her defaults did, and doubled,
    2 of 30. Nor was the unconfirmed mark: confirming the note ended her
    "I haven't confirmed that" but not her strict failures. Of 74 strict
    failures, 49 faulted an answer for a preference the judge could not
    see, and 47 for leaving out AEST's `+10:00`. The correctness prompt
    never saw her memory, so what she truthfully attributed to the user
    read as invented.
  - The user chose, among four options, that the strict and lenient judges
    be told the answer comes from a memory of the user (`MEMORY_NOTE` in
    [`judges.ts`](../../packages/eval/src/run/judges.ts), #102). openevals'
    prompt is unchanged, a contradicted or missing fact still fails, and
    every system was run again.
  - The rerun (134 accepted questions, 125 counted strictly): 43 strict
    passes against lexical search's 27; preferences 5 of 10, as many as
    today's options and against none for lexical search; every abstention
    kept, 8 of 8. All three parts of the rule were met, and the report's
    ruling is that the engine stays hers and Delivery is next.
- **Reason**: Delivery was what failed. Her search found evidence for 102
  of 125 questions before the change, and the matched passages reached the
  model for 9; with them delivered, and knowledge alternated with
  conversations, they reached it for 98, past lexical search's 69. The rerun
  then met the rule the user's direction had set.
- **Cost**: The report's cost if wrong: Delivery ships preference answers
  right half the time, as the old behaviour's were. Four of her five
  preference failures still leave out `+10:00`, as the `cited` ceiling
  does, and the roadmap holds the answering prompt's length as a candidate.
  The judges' change costs a judge more lenient towards remembered claims
  than the first, so the counts do not compare with the first run's.
- **Standing**: current; the engine is hers. The limits of the comparison:
  - It is lexical search, the diagnostic `cited` ceiling and her own
    variants only. `makeSystem` refuses any other name, so Hindsight,
    OpenViking, EverOS and Honcho are designed and not run, and the full
    context bound was not in the rerun.
  - One user's data, drafted by models from that same data, a test that
    leans towards lexical search because its questions echo transcript
    text; one answering model and one judge, at a default effort.
  - Noise: preference has 10 questions and updates 6, and strict passes on
    small types flip between systems whose contexts barely differ.
  - The judges changed in the middle, so the first run and the rerun do
    not compare.
  - The condition for reconsidering a replacement: the report leaves the
    five questions only lexical search passes, and the ten of its 27 passes
    she misses, as where a chunk index or hybrid search would be judged
    later, and the roadmap holds a chunk index as waiting on them. It also
    makes embeddings conditional on recall's falling short, for which it
    finds no evidence. No numeric threshold is recorded.
- **Sources**:
  [engine spec](../specs/2026-10-31-memory-engine-design.md#decisions),
  [the first decision](../reports/2026-10-31-memory-engine.md#the-first-decision),
  [the rerun](../reports/2026-10-31-memory-engine.md#the-rerun),
  [the decision](../reports/2026-10-31-memory-engine.md#the-decision),
  [left](../reports/2026-10-31-memory-engine.md#left),
  [first evaluation](../reports/2026-10-31-first-evaluation.md#what-it-shows),
  [roadmap](../roadmap.md#relations-and-embeddings-5), and the figures
  explained on [evaluation](./topics/evaluation.md#the-current-results).

## Evaluation

How the evaluation works, and what its results establish, is on
[evaluation](./topics/evaluation.md).

### She is measured on her own data, from a snapshot

- **Context**: The evaluation measures access, the second priority, on the
  user's own sessions, to choose what sits behind the memory contract.
- **Alternatives**: Rejected: a public benchmark alone, which says nothing
  of her data; an agentic run where each model drives the MCP tools, which
  mixes the model's skill with the system's (kept as a possible second
  mode); and LangSmith, which openevals does not need.
- **Choice**: Taken on 2026-10-18 by the coding agent, on the user's
  standing delegation to approve in their stead: a package of its own,
  `@dorothy/eval`; a snapshot of her data directory; questions mined where
  her data holds the answer and generated for the other types; one budget,
  one answering model and no tool loop for every system; a lexical bound
  and a full-context bound.
- **Reason**: A snapshot means nothing it does can touch the archive and
  runs repeat on one copy; one budget and one answering model hold all but
  the system constant.
- **Cost**: not recorded in the decision table. The results page lists the
  limits: one data set, one user.
- **Standing**: current. LongMemEval-S as a public anchor is a roadmap
  candidate, not built.
- **Sources**:
  [evaluation spec](../specs/2026-10-18-memory-evaluation-design.md#decisions),
  [evaluation report](../reports/2026-10-18-memory-evaluation.md#rulings).

### Answers are judged by openevals, from another model family

- **Context**: Answers need a verdict, strict and lenient, from a judge
  that is not the answering model.
- **Alternatives**: Bespoke judging, which "adopted, not bespoke" excludes.
  No other judge is named.
- **Choice**: Taken with the evaluation's decisions on 2026-10-18 by the
  coding agent on the user's delegation: openevals' LLM-as-judge, strict
  and lenient, a model family apart from the answering one.
- **Reason**: Adopted, not bespoke, as the protocol-diversity minutes rule.
- **Cost**: not recorded.
- **Standing**: revisited 2026-11-01. The strict and lenient judges were
  told the answer comes from a memory of the user, after probes showed the
  strict judge faulting truthful attributions; the abstention judge is not
  told. The change and its reason are in "Her engine stays hers".
- **Sources**:
  [evaluation spec](../specs/2026-10-18-memory-evaluation-design.md#decisions),
  [protocol diversity, ruling 4](../reports/2026-10-18-protocol-diversity.md#rulings),
  [engine report](../reports/2026-10-31-memory-engine.md#the-first-decision).

### The evaluation's models are called through the user's plans first

- **Context**: The first full `generate` on the backfilled snapshot used
  `deepseek/deepseek-v3.2` through OpenRouter and dropped two drafts in
  three. The user asked for other generators to be compared.
- **Alternatives**: Calling each role through an OpenAI-compatible endpoint
  paid per token, which stays the default (`via = "api"`).
- **Choice**: The user asked, on 2026-10-29, that their Claude and ChatGPT
  plans be used before either vendor's API. The spec's design spawns the
  vendor's CLI (`claude -p`, `codex exec`) in isolation and records the
  tokens each command spends.
- **Reason**: The user's request. The spec adds that both CLIs log in with
  the plan and that `eval` stays free of any SDK.
- **Cost**: A process a call and a few seconds; in the first run, hours of
  waiting at plan limits.
- **Standing**: current. The user's later rule on routing work by usage is
  under "Work is routed by usage budget".
- **Sources**:
  [subscriptions spec](../specs/2026-10-29-eval-subscriptions-design.md#decisions),
  [bake-off and faults](../reports/2026-10-29-eval-subscriptions.md#the-bake-off),
  [first evaluation, ruling 4](../reports/2026-10-31-first-evaluation.md#rulings).

### The test set: the strongest models draft, agents pre-screen crosswise

- **Context**: A bake-off of six question generators on the same samples
  found that most knowledge-update drafts carried no earlier claim, and
  that the cheapest model dropped most of what it drafted.
- **Alternatives**: The cheapest model that passed the checks; the owner
  reviewing all 270 drafts.
- **Choice**: The user chose the strongest models available on their plans,
  Claude Opus 5.5 and GPT-6.1 Sol. The first evaluation's rulings record
  that agents pre-screened the drafts crosswise, so no model family judged
  its own, with the owner's spot-check to follow. The report does not say
  who ruled the pre-screening.
- **Reason**: not recorded; the rulings give costs alone.
- **Cost**: More plan usage; and a test set nearer the agents' judgement
  than the owner's.
- **Standing**: current. The spot-check is not recorded as complete
  ([evaluation](./topics/evaluation.md#the-questions)).
- **Sources**:
  [first evaluation](../reports/2026-10-31-first-evaluation.md#the-test-set),
  [rulings](../reports/2026-10-31-first-evaluation.md#rulings),
  [bake-off](../reports/2026-10-29-eval-subscriptions.md#the-bake-off).

### A plan's usage limit stops a run; a failure is a miss

- **Context**: Runs through the plans meet usage limits, which say nothing
  about the systems being compared.
- **Alternatives**: Scoring a limited call as a miss, which is what a
  failure otherwise is: a question that should have been judged and was
  not counts as a miss, so a flaky system scores no higher for failing.
- **Choice**: The evaluation limits spec: a reply that says its plan's
  limit is reached stops the run, done work is kept and `--resume`
  finishes it. The spec does not say who ruled.
- **Reason**: A limit says nothing about the systems; a miss would.
- **Cost**: A reply misread as a limit stops a run that could go on.
- **Standing**: current.
- **Sources**:
  [limits and review tools spec](../specs/2026-10-30-eval-review-tools-design.md#decisions),
  [evaluation report, ruling 6](../reports/2026-10-18-memory-evaluation.md#rulings).

## Identity, harnesses and delivery

Which host receives what, and what has been run against it, is on
[harnesses](./profiles/harnesses.md); the mechanisms are on
[identity, harnesses and delivery](./topics/identity-and-harnesses.md).

### No one harness hosts Dorothy

- **Context**: On 2026-10-15 the user and the coding agent were asked
  whether OpenClaw or Hermes Agent should host her, and ruled that neither
  should. The replacements note then recommended a memory provider over her
  archive and her body rebuilt on pi.
- **Alternatives**: Hosting her in OpenClaw or in Hermes; rebuilding her on
  pi, which the minutes reject.
- **Choice**: The user and the coding agent, on 2026-10-18: she is protocol
  diverse. One definition of her is generated into each harness's own
  files, one memory serves them all, pi is not to be used, memory across
  harnesses is designed before the harnesses to target are chosen, and
  existing packages are researched before anything bespoke.
- **Reason**: The user rejected the inherited framing of Hermes against
  OpenClaw and a single body; the coding agent's answer was that the framing
  was inherited and the recommendation assumed she needs one body.
- **Cost**: The minutes name three: persona strength varies by harness,
  recording varies, and formats drift, so the generators and recorders need
  upkeep.
- **Standing**: current. Her identity is generated into slots, and one
  memory serves them
  ([identity and harnesses](./topics/identity-and-harnesses.md)).
- **Sources**:
  [protocol diversity minutes](../reports/2026-10-18-protocol-diversity.md#rulings),
  [objectives](../reports/2026-10-15-objectives.md#rulings),
  [protocol-diverse Dorothy](../../.agents/memory/protocol-diverse-dorothy.md).

### The four harnesses are Claude Code, Codex, OpenClaw and Hermes

- **Context**: The protocol-diversity ruling left open which harnesses come
  first, until her memory was designed.
- **Alternatives**: Others, such as OpenCode, wait: it is not a target, and
  `--opencode` waits.
- **Choice**: The user named them on 2026-10-19: Claude Code, Codex,
  OpenClaw and Hermes Agent, which she is provided for and tested against.
- **Reason**: The user had settled it before the memory work began and held
  it back until memory across harnesses was resolved.
- **Cost**: not recorded.
- **Standing**: current. The state of each host, and what waits on the user,
  is on [harnesses](./profiles/harnesses.md).
- **Sources**:
  [target harnesses](../../.agents/memory/target-harnesses.md),
  [roadmap revision 2026-10-19](../roadmap.md#revisions).

### A gateway and a marker carry her identity into Claude Code

- **Context**: The phase made Dorothy the agent in Claude Code, ahead of
  Model Providers, without a provider contract.
- **Alternatives**: Claude Code's output styles,
  `--append-system-prompt-file` and main-thread agents each place text in
  its prompt, but only Claude Code reads them. Recognising the main thread
  by the shape of its prompt was rejected as fragile across client
  versions.
- **Choice**: The identity spec's decisions: a gateway at the HTTP boundary
  that serves any client whose base URL can be set; a fixed marker that the
  launcher appends and the gateway replaces; the gateway additive, removing
  only its own marker, so a request without it passes byte for byte. The
  spec does not say who ruled.
- **Reason**: A gateway serves any such client and is where Dorothy's
  Gateway would later add memory and routing; the marker fails safe if the
  client changes.
- **Cost**: not recorded as a cost; the spec's known risks are that the
  client's own identity line stays, that a session begun without the
  launcher and resumed with it carries no marker, and that one begun with it
  and resumed bare sends the marker to the API.
- **Standing**: current and built, with an Anthropic adapter only. An
  OpenAI-protocol adapter is a roadmap candidate, not built.
- **Sources**:
  [identity spec](../specs/2026-10-15-identity-gateway-design.md#decisions),
  [probes](../reports/2026-10-15-identity-gateway.md),
  [identity and harnesses](./topics/identity-and-harnesses.md#the-gateway).

### One provenance stance everywhere

- **Context**: The chat persona's provenance was discreet and deflected
  questions about what ran her; the identity package was to hold one
  host-neutral stance.
- **Alternatives**: The chat persona's earlier, more discreet provenance,
  which the decision replaces.
- **Choice**: The identity spec's decision: she is Dorothy; an identity
  line from the software hosting her names her host, not her; she does not
  volunteer the model or vendor behind her, and answers plainly when asked.
  The chat prompt changes on purpose. The spec does not say who ruled.
- **Reason**: not recorded; the spec states the stance and does not give a
  reason for it.
- **Cost**: not recorded.
- **Standing**: current; `identity.test.ts` pins the text byte for byte
  ([identity and harnesses](./topics/identity-and-harnesses.md#one-definition-of-her)).
- **Sources**:
  [identity spec](../specs/2026-10-15-identity-gateway-design.md#decisions),
  [identity guide](../../packages/identity/AGENTS.md).

### Other hosts' sessions are recorded by a sweep, not hooks

- **Context**: A session in a host reaches her memory only when it is
  recorded, and each host records differently.
- **Alternatives**: A hook, which would record sooner. The delivery design
  also considered and ruled against recording hooks for Codex and Hermes.
- **Choice**: The recording spec's decision: the service sweeps each store
  on a schedule and at start, opt-in per host. The coordinating agent ruled
  against recording hooks in the delivery design.
- **Reason**: The sweep needs no change to any harness's configuration,
  which is delivery's.
- **Cost**: Recall lags a sweep, up to one interval.
- **Standing**: current. Claude Code's own launcher still records by hooks,
  and a session is one conversation whoever records it.
- **Sources**:
  [recording spec](../specs/2026-10-20-recording-design.md#decisions),
  [delivery report, ruling 10](../reports/2026-11-01-delivery.md#rulings),
  [identity and harnesses](./topics/identity-and-harnesses.md#recording-how-a-hosts-sessions-come-back).

### The backfill is the user's command, and its review runs in capped batches

- **Context**: A first retrieval run on 2026-10-20 found 10 conversations
  in her archive, too few to measure. On 2026-10-29 the user found 305 of
  314 sidecars empty.
- **Alternatives**: A paid review for every backfilled session, which the
  recording spec priced at some 970 calls; a dry run on 2026-10-21 found
  302 Claude Code sessions, not some 970, as the rest were subagents'
  transcripts.
- **Choice**: Recording a thousand sessions is the user's call, so
  `dorothy --sweep --backfill` is run by the user and runs no extraction.
  On 2026-10-29 the user chose to review the backfilled conversations on
  the Claude plan the reviews already use, after a baseline evaluation on
  the frozen snapshot. The review's shape is from the backfill review
  spec's decision table, which does not say who ruled it:
  `--review-backfill`, run by the user or the agent, 25 a batch by default,
  newest first.
- **Reason**: The recording spec: recording a thousand sessions is the
  user's call, and a review apiece would be costly. The review spec's
  table: spending a plan's usage is a choice, and a plan's limits are
  watched between batches.
- **Cost**: Backfilled sessions have no notes until reviewed, so recall
  finds little of them until then; a failed model call stops the batch.
- **Standing**: current. Recording moved ahead of the first run on
  2026-10-20 by a roadmap revision, and the first evaluation measured the
  archive before and after the reviews.
- **Sources**:
  [recording spec](../specs/2026-10-20-recording-design.md#decisions),
  [backfill review spec](../specs/2026-10-29-backfill-review-design.md#decisions),
  [backfill review report](../reports/2026-10-29-backfill-review.md#rulings),
  [roadmap revisions](../roadmap.md#revisions).

### Delivery to Codex and Hermes uses launch flags and a profile

- **Context**: Codex and Hermes needed her persona, memory and tools, with
  the user's own setup of each left as it was. The user was away and asked
  that confirmations be taken as given.
- **Alternatives**: rulesync, not adopted now; a Codex plugin route if
  hooks from session flags are refused, not built; recording hooks, ruled
  against.
- **Choice**: The coordinating agent ruled the spec's table: a launcher,
  `dorothy --codex`, on session flags; a Hermes memory provider and a
  `dorothy` profile; host files written only by `--install`, run by the
  user; one hook command that fails open; the hosts' own memories off in
  her sessions; Codex's hook trust approved once by the user, never
  bypassed.
- **Reason**: Launch flags and a profile of her own write no key the user
  holds, so rulesync is not needed yet.
- **Cost**: Her Codex is a command, not plain `codex`; Hermes needs one
  install step; two hosts' writers are ours; recall lags a sweep.
- **Standing**: current. Delivery is built for Codex and Hermes; the live
  probes wait on the user's sign-ins and, for Codex, a week's reset;
  OpenClaw's waits on its install
  ([harnesses](./profiles/harnesses.md)).
- **Sources**:
  [delivery spec](../specs/2026-11-01-delivery-design.md#decisions),
  [delivery report](../reports/2026-11-01-delivery.md#rulings),
  [roadmap](../roadmap.md#dorothys-memory).

## Models and routing

How the runtime, roles and fallback work is on
[models and routing](./topics/models-and-routing.md); the providers behind
them are on [services and providers](./profiles/services-and-providers.md).

### Resilience comes after memory, and fallback is a requirement

- **Context**: The user wants Dorothy resilient to upstream hindrance, such
  as vendor policy and quota. The objectives anticipate the case fallback is
  for: Anthropic's usage running out, when requests fall back to another
  provider.
- **Alternatives**: not recorded.
- **Choice**: The objectives' rulings (the user and the coding agent,
  2026-10-15): the other objectives follow the memory work, in order
  resilience, learning, extensibility, reach, with fallback a requirement
  of Model Providers. The same day the roadmap put Dorothy's Memory ahead
  of Model Providers.
- **Reason**: The user's stated aim of an adaptable Dorothy, Anthropic's
  models first, falling back to featherless.ai and perhaps OpenRouter when
  usage runs out or another model suits the task.
- **Cost**: not recorded.
- **Standing**: current. Fallback is built; choosing a route by remaining
  budget is not.
- **Sources**:
  [objectives](../reports/2026-10-15-objectives.md#rulings),
  [Dorothy's ambition](../../.agents/memory/dorothy-ambition.md),
  [roadmap revision 2026-10-15](../roadmap.md#revisions).

### She runs on her own runtime, the Vercel AI SDK, and the Agent SDK retires

- **Context**: Her calls ran through Anthropic's Agent SDK, which spawns
  the Claude Code CLI and spends a subscription's token. The spec of
  2026-11-01 gave three reasons it had to go.
- **Alternatives**: LangChain.js, ruled out for her runtime because it
  brings message and graph state beside her JSONL; its middleware list
  serves as a checklist instead. A bespoke client on `fetch`, which would
  mean two wire protocols' streaming, tools and errors of our own.
- **Choice**: Ruled with the user or by the coordinating agent, the spec
  says without attributing each row: the Messages API on an API key, no
  subscription token; the Vercel AI SDK 7 in `agent`; two parts, two plans,
  two merges.
- **Reason**: The Agent SDK tied her to one vendor, added the CLI's own
  context to every request, and sat outside what Anthropic's terms permit,
  as the spec read them that day. The research of 2026-10-18 named the AI
  SDK the best replacement for `agent`.
- **Cost**: API credits spent where the subscription was; the build was
  gated on a probe under Bun, which passed.
- **Standing**: current, built and merged on 2026-11-01. It supersedes the
  CLI-based calls, and with them the CLI-compaction switch under
  "Compaction is Dorothy's". No package declares the Agent SDK
  (`workspace.test.ts`).
- **Sources**:
  [model providers spec](../specs/2026-11-01-model-providers-design.md#decisions),
  [the probe](../reports/2026-11-01-model-providers.md#the-probe),
  [context leak](../reports/2026-10-07-context-leak.md).

### Only providers the user accepted may receive her requests

- **Context**: Her prompts hold the user's memory, so where a request may
  go is a rule.
- **Alternatives**: not recorded.
- **Choice**: The spec: fixed provider kinds, four at approval, Anthropic
  on its commercial terms, OpenRouter with data collection denied and zero
  retention, featherless and local servers; the config cannot name another.
  On 2026-11-01, after the spec was approved, the user ruled a fifth kind,
  Hugging Face's router, taking any provider the router chooses.
- **Reason**: The accepted providers are those kept as retaining no
  prompts; the Hugging Face kind is the user's ruling, whose reason the
  record does not give.
- **Cost**: Some Hugging Face providers keep prompts, so that kind alone is
  not held to no retention; a further provider needs a kind added.
- **Standing**: current
  ([models and routing](./topics/models-and-routing.md#providers-and-routes)).
- **Sources**:
  [model providers spec](../specs/2026-11-01-model-providers-design.md#decisions),
  [report](../reports/2026-11-01-model-providers.md#rulings).

### Failures fall back, except cancellations and turns with effects

- **Context**: A spent Anthropic budget should no longer stop her, but a
  second model must not repeat what a first already did.
- **Alternatives**: not recorded; the SDK's own retries were turned off so
  that fallback and cooldown decide.
- **Choice**: The spec: a failure moves to the next entry unless it is a
  cancellation or the attempt had started, which is once text has streamed
  or `remember` has run. Cooldowns follow usage refusals by provider and
  rate limits by provider and model.
- **Reason**: A model on another provider may take what this one refused.
  A turn that has streamed text or written a memory cannot be replayed.
- **Cost**: One wasted attempt on a request that fails everywhere; a turn
  the user asks again after a started one fails. A blip costs a fallback,
  not a retry.
- **Standing**: current. The live run did not make a started turn fail on
  a real provider, so that behaviour rests on the spec, the code and the
  tests
  ([models and routing](./topics/models-and-routing.md#after-a-turn-has-had-effects)).
- **Sources**:
  [model providers spec](../specs/2026-11-01-model-providers-design.md#fallback),
  [decisions](../specs/2026-11-01-model-providers-design.md#decisions),
  [report](../reports/2026-11-01-model-providers.md).

## Terminal

The chat as built is on [the terminal](./topics/terminal.md).

### The chat is a persona testbed first and knows no model SDK

- **Context**: The one-shot CLI became a terminal chat. Version 1 led with
  the testbed: holding a real multi-turn conversation while seeing what the
  SDK is doing, so the persona prompt can be iterated on. Polish followed
  later.
- **Alternatives**: OpenTUI and a Messages API backend were named out of
  scope for version 1. The spec gives no comparison.
- **Choice**: The TUI chat spec's constraints: the TUI on Ink 7 with React
  19 under Bun, and nothing in the UI depending on the SDK directly. The
  spec does not say who ruled.
- **Reason**: Testbed first is the spec's purpose. Independence of the SDK
  is because a later iteration moves to the Messages API. Why Ink:
  not recorded.
- **Cost**: not recorded.
- **Standing**: revisited 2026-10-05 and 2026-11-01. The early spec's
  SDK-bound parts were superseded by the model providers runtime, the
  input editor and the statusline spec; the TUI depends on `core` alone
  and knows a session only as `ChatSession`
  ([terminal](./topics/terminal.md#what-the-package-knows)).
- **Sources**:
  [TUI chat spec](../specs/2026-10-03-tui-chat-design.md#constraints),
  [model providers spec](../specs/2026-11-01-model-providers-design.md#decisions).

### The statusline is configured by priority, and the window has a minimum

- **Context**: The stats under each reply wrapped once the cache counts
  appeared, and the user wanted a persistent statusline. Below a set size
  the live region no longer fits.
- **Alternatives**: Modules overflow onto up to a configured number of
  lines, or the line is dropped from the right; configuring the header,
  colours, the separator or the input cap was ruled out.
- **Choice**: The statusline spec's decisions: two lines from one
  catalogue of modules; the header moves to the bottom and is not
  configurable; strict priority, so the first module that does not fit ends
  the line; TOML read once at startup with no live reload. The minimum is
  the worst case, so it never depends on what is on screen: 40 columns and
  `19 + statusline max-lines` lines, with the input cap a constant five
  rows, and below it the TUI draws only a line naming the minimum. The spec
  does not say who ruled each row.
- **Reason**: The spec records the requests from the review of the deferred
  minors; for the header's move and the strict priority it gives no reason
  beyond them. For the minimum: at or above it every part fits however many
  warnings there are, and nothing is squeezed.
- **Cost**: not recorded; live reload and a setting for the minimum are not
  built.
- **Standing**: current
  ([terminal](./topics/terminal.md#layout-and-the-minimum-window)).
- **Sources**:
  [statusline and minimum size spec](../specs/2026-10-05-statusline-and-minimum-size-design.md#decisions).

## Orchestration

Two things bear this name; see
[orchestration](./topics/orchestration.md) for which is which. The first
four entries concern Dorothy's own toolset, the rest the agents that
develop her.

### The workers' control layer is structured, not scraped

- **Context**: Screen-scraping approvals through herdr does not scale once
  agents run under stricter policies, so a structured channel is needed.
- **Alternatives**: The agents' own protocols, Claude Code's stream-json
  with a permission prompt tool and Codex's app-server, behind a supervisor
  of Dorothy's, at the cost of two protocols to keep up with, one
  experimental.
- **Choice**: The orchestration spec's decisions, ruled with the user or by
  the coordinating agent without attributing each: acpx's embedded runtime,
  with ACP for both workers, as an MCP stdio server,
  `@dorothy/orchestra`. For Claude's route, the user accepts that the
  terms are less clear-cut for the adapter on the Agent SDK than for the
  plain `claude` binary. That adapter is separate from "She runs on her own
  runtime", which retires the Agent SDK from Dorothy's own calls.
- **Reason**: not recorded in the spec's table. The 2026-11-01 note,
  written before the spike and the spec, offered acpx for one permission
  model across both agents.
- **Cost**: A pre-1.0 dependency and two adapters.
- **Standing**: designed and not built. The roadmap has no ordered phase for
  it as of 2026-11-03; whether the user has accepted the whole design is not
  stated in the spec.
- **Sources**:
  [an orchestration layer](../notes/2026-11-01_agent-orchestration.md#recommendation),
  [orchestration spec](../specs/2026-11-02-orchestration-design.md#decisions),
  [orchestration](./topics/orchestration.md#dorothys-own-orchestration).

### Dorothy's chat drives the workers first

- **Context**: The first note recommended that the orchestrating agent stay
  Claude Code. The later spec differs: Dorothy, on an open-weight model
  served by featherless, orchestrates the workers.
- **Alternatives**: An orchestrating agent staying Claude Code, as the note
  recommended.
- **Choice**: The spec's ruling: chat first, with an engine an unattended
  runner can reuse; a later record than the note, and the one followed
  here.
- **Reason**: not recorded in the decision table. The spec's Understanding
  lists, as what the user has said, that she is to orchestrate the workers
  and is driven through her chat first.
- **Cost**: Long jobs still go through herdr for now.
- **Standing**: designed, not built. The note and spec disagree and the
  later one governs.
- **Sources**:
  [orchestration spec](../specs/2026-11-02-orchestration-design.md#decisions),
  [an orchestration layer](../notes/2026-11-01_agent-orchestration.md#recommendation).

### Workers run in a box, not in the agents' own sandboxes

- **Context**: Two Codex reviews on 2026-11-02 found that the agents' own
  sandboxes, reached through acpx's adapters, cannot hold the hard limits:
  an approval can lift Codex's sandbox, and Claude's Bash sandbox covers
  shell commands only.
- **Alternatives**: Relying on each agent's sandbox, which the reviews
  rejected.
- **Choice**: A bubblewrap box around each worker and its agent, with a
  clone of its repository of its own, and a sealed broker that brings a
  branch into the main checkout and pushes it, so workers never push. The
  spec's table rules this with the user or the coordinating agent.
- **Reason**: A feasibility probe the same day showed acpx's embedded
  runtime failing closed under Bun, both adapters starting in a box with no
  home, no network and one writable path, and a proxy admitting an allowlist.
  The probe's code was throwaway and no agent was signed in.
- **Cost**: Linux and bubblewrap required; an agent that cannot run boxed
  blocks the build; one full copy of each repository at first use. A hostile
  worker can read a subscription login and send it out through an admitted
  host.
- **Standing**: designed, not built; the box with real agents is still to be
  checked.
- **Sources**:
  [review and probe](../specs/2026-11-02-orchestration-design.md#review-and-probe),
  [the box](../specs/2026-11-02-orchestration-design.md#the-box),
  [feasibility probe](../notes/2026-11-02_featherless-orchestrator.md#the-orchestration-spec-and-a-feasibility-probe).

### Permission requests pass rules, then a judge, then the user

- **Context**: A worker's permission requests need an answer, and the chat
  model must not be the one to give it.
- **Alternatives**: not recorded.
- **Choice**: The spec's gate: rules in code, then a structured call on a
  new `approval` role, then the user by MCP elicitation; every failure to
  decide is a denial; the answer is the agent's exact `allow_once` or
  `reject_once` option id, never `allow_always`. The spec leads with
  `featherless:deepseek-ai/DeepSeek-V4.1-Flash-1017` as an assumption, a
  route that is the user's to set.
- **Reason**: The box and broker hold whatever anyone answers; the policy
  steers the work's course. The model that held against every injection in
  the research's hostile probe is a dated 2026-11-02 finding, not current
  advice.
- **Cost**: A judge call per unsettled request; a worker blocked where it
  might have gone on; a worker that never asks meets only the box and the
  broker.
- **Standing**: designed, not built.
- **Sources**:
  [the gate](../specs/2026-11-02-orchestration-design.md#the-gate),
  [decisions](../specs/2026-11-02-orchestration-design.md#decisions).

### A registry of herdr agents is unscheduled but high priority

- **Context**: The agents that develop Dorothy run in herdr panes. Their
  names, roles and availability are written into the stewardship skill,
  agent memory and handover notes, and went stale when herdr's names
  changed on 2026-11-02.
- **Alternatives**: Hunting down the text at each rename, the present
  practice.
- **Choice**: A roadmap revision of 2026-11-02 added the registry to the
  candidates, unscheduled but high priority: it waits on no phase and is
  taken up when the user says. The roadmap states it is not Dorothy's own
  orchestration.
- **Reason**: The names went stale. The roadmap's ideal is a skill that
  hard-codes no herdr agent name, so a rename is one edit to a git-ignored
  `.agents/registry/herdr.json`.
- **Cost**: not recorded.
- **Standing**: candidate; `.agents/registry/herdr.json` does not exist.
- **Sources**:
  [roadmap candidates](../roadmap.md#candidates),
  [roadmap revision 2026-11-02](../roadmap.md#revisions),
  [orchestration](./topics/orchestration.md#the-registry-of-herdr-agents).

### Codex never asks: the coordinating agent approves its prompts

- **Context**: The user offloads work to Codex to save Claude usage, and a
  prompt waiting on them stalls the work.
- **Alternatives**: Relaying each Codex prompt to the user.
- **Choice**: The user, on 2026-10-20, asked that Codex never ask, "full
  send all risk", and that a coordinating agent approve every pending Codex
  prompt through herdr rather than relay it.
- **Reason**: Offloading to Codex saves Claude usage; a prompt waiting on
  the user stalls the work.
- **Cost**: not recorded. Claude Code's own permission prompts are not
  covered.
- **Standing**: current
  ([orchestration](./topics/orchestration.md#how-her-developers-are-coordinated-today)).
- **Sources**: [Codex full send](../../.agents/memory/codex-full-send.md).

### Work is routed by usage budget

- **Context**: On 2026-10-29 a 136-draft review sent to Codex at `xhigh`
  with 59% left ran out halfway.
- **Alternatives**: not recorded.
- **Choice**: The user set the order: estimate what a job will spend, then
  Codex if it fits, else a Claude subagent on the primary account that
  leaves room for the coordinating agent, else the reserve account, else
  wait for the first reset. The user lets the agent juggle both Claude
  accounts and said to spend Codex's limits freely while a promotion reset
  them.
- **Reason**: The user's plans hit their limits often.
- **Cost**: not recorded.
- **Standing**: current; the order is carried by the stewardship skill.
  The registry above would remove the names written into it.
- **Sources**: [usage limits](../../.agents/memory/usage-limits.md),
  [stewardship skill](../../.agents/skills/agent-stewardship/SKILL.md).

### Procedures are skills, and recovery is armed before a limit

- **Context**: The first evaluation ran on procedures the repository did not
  declare: memories loaded whole into every session, and scratch scripts
  that imported the evaluation's internals by absolute path.
- **Alternatives**: Leaving the procedures in memory and in scratch scripts.
  For message provenance, Agent Delegation Receipts and A2A were not used:
  the first is still an IETF proposal and the second does not carry over
  typed text.
- **Choice**: The user agreed the scope on 2026-10-30 and 31, shaped the
  skills and recovery, and trusted the agent with the remaining rulings: two
  skills of the repository's own, `agent-stewardship` and
  `agent-pre-screening`; an agent arms its own wake-up before a limit, keeps
  a resume note, and runs long jobs as units outside its client; every
  message is labelled with its sender. On 2026-10-31 the user also approved
  that the coordinating agent compact itself past 85% of its context, at a
  turn boundary, telling the user.
- **Reason**: A skill loads only when the work calls for it, and a limit
  ends the turn, so recovery must be armed before it.
- **Cost**: A label is a claim, not proof; message provenance remains a
  roadmap candidate. A Claude Code change to its input breaks the
  self-compaction method.
- **Standing**: current
  ([orchestration](./topics/orchestration.md#how-her-developers-are-coordinated-today)).
- **Sources**:
  [consolidation spec](../specs/2026-10-31-agentic-asset-consolidation-design.md#decisions),
  [report](../reports/2026-10-31-agentic-asset-consolidation.md#rulings),
  [self-compaction](../../.agents/memory/self-compaction.md).

## Repository workflow

The machinery behind these rules is on
[repository workflow](./topics/repository-workflow.md).

### Packages are few and broad, linked as source through named entry points

- **Context**: Everything lived in one `src/` tree, and nothing but
  discipline kept its parts apart; four text-scanning boundary tests checked
  only what someone thought to write down.
- **Alternatives**: Granularity: the spec chose breadth over it.
- **Choice**: The workspace modularity spec's decisions: five broad
  packages, dependencies pointing inward, `core` holding contracts, source
  packages with Bun's isolated linker, named entry points only, and the
  agent the only SDK user. The spec does not say who ruled each row.
- **Reason**: Undeclared imports fail to resolve under Bun and under `tsc`
  alike, so boundaries become structural; a probe confirmed both.
- **Cost**: not recorded as such. A finding worth keeping: Bun's isolated
  install keeps a stale link after a `@dorothy` dependency is removed, so
  reinstall from clean to see the boundary.
- **Standing**: revisited from 2026-10-15, when the identity and gateway
  packages were added, and 2026-10-19, when the evaluation was built. The
  graph is now eight packages and `workspace.test.ts` pins it; "the agent
  is the only SDK user" now holds for the AI SDK, the Agent SDK having gone
  ([packages](./profiles/packages.md)).
- **Sources**:
  [workspace modularity spec](../specs/2026-10-09-workspace-modularity-design.md#decisions),
  [report](../reports/2026-10-09-workspace-modularity.md).

### Guidance is AGENTS.md files, and every agentic asset is declared here

- **Context**: Every session loaded a 15 KB `.claude/CLAUDE.md` and
  fourteen enabled plugins, which only Claude Code reads, and several
  working rules existed only in an agent's memory.
- **Alternatives**: `.agents/AGENTS.md`, rejected because no client reads
  guidance there; plugins as the only guard for a rule, rejected for
  enforcement by husky, CI or a test.
- **Choice**: The asset refactor spec's decisions: a root `AGENTS.md`, one
  per package and one in `docs/`; no `CLAUDE.md` anywhere above the working
  directory, which would switch `AGENTS.md` off for Claude Code; third-party
  skills as dependencies; memory under `.agents/`; everything the
  repository relies on declared in it. The spec does not say who ruled each
  row.
- **Reason**: Claude Code and Codex both read `AGENTS.md`, and per-package
  guidance costs nothing until an agent works in that package.
- **Cost**: not recorded.
- **Standing**: current; `agents.test.ts` pins the layout and the budgets
  ([repository workflow](./topics/repository-workflow.md#agent-assets)).
- **Sources**:
  [asset refactor spec](../specs/2026-10-11-agentic-asset-refactor-design.md#decisions),
  [report](../reports/2026-10-13-agentic-asset-refactor-implementation.md).

### Secrets move from dotenvx to sops and age

- **Context**: Secrets were committed in `.env`, encrypted by dotenvx,
  whose private key Dotenvx Armor held: a paid service the user will not
  keep.
- **Alternatives**: not recorded.
- **Choice**: The user chose sops and age on 2026-10-21: `secrets.json`
  encrypted to an age key outside the checkout, with no variable of
  Dorothy's own for the key.
- **Reason**: The spec gives it as the user's choice: free, standard, no
  service.
- **Cost**: Two binaries on `PATH`, which mise and CI provide; the user backs
  up one key file.
- **Standing**: current
  ([repository workflow](./topics/repository-workflow.md#secrets)).
- **Sources**:
  [sops spec](../specs/2026-10-21-sops-secrets-design.md#decisions),
  [report](../reports/2026-10-21-sops-secrets.md#rulings).

### Fix the code a metric points at, never the metric

- **Context**: The token usage audit traced cost to hard-to-read code and
  heavy process. The user rejected a ripgrep `.ignore` for `docs/plans/` as
  lazily addressing the indicator, and a complexity lint rule as useless.
- **Alternatives**: Ignore files, suppressions or lint gates as fixes.
- **Choice**: The user wants the code readable: refactor the flagged code
  itself, one hotspot per branch, with a short design in chat, approval and
  tests unchanged, and use the metric only to check the result.
- **Reason**: Hiding the symptoms changes neither the cost nor the code.
- **Cost**: not recorded.
- **Standing**: current.
- **Sources**:
  [readability over indicators](../../.agents/memory/readability-over-indicators.md),
  [token usage note](../notes/2026-10-16_claude-conversation-token-usage.md).

### Agents carry on with agreed steps and merge their own pull requests

- **Context**: After the roadmap sweep merged on 2026-10-20, the user said
  they knew and trusted the agent to proceed.
- **Alternatives**: Stopping to ask, or listing steps for the user to take.
- **Choice**: The user: carry on with the next steps the roadmap and the
  conversation have agreed, ruling on choices, and report what was done.
  The user's memory records explicit permission to merge the agent's own
  pull requests once CI passes. Still ask before what only the user can
  decide, such as `dorothy --verify`, and before a spend or account action
  not approved.
- **Reason**: Pauses for confirmation cost the user more than an occasional
  wrong ruling, which they can see and undo.
- **Cost**: An occasional wrong ruling.
- **Standing**: current
  ([repository workflow](./topics/repository-workflow.md#the-checks)).
- **Sources**:
  [trust to proceed](../../.agents/memory/trust-to-proceed.md),
  [root AGENTS.md](../../AGENTS.md).

## Related

- [Questions](./questions.md)
- [Problems](./problems.md)
- [Priorities](./priorities.md)
- [Packages](./profiles/packages.md)
- [Protocols](./profiles/protocols.md)
- [Services and providers](./profiles/services-and-providers.md)
