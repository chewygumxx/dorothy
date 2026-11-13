---
ctime: 2026-11-03
mtime: 2026-11-14
spdx: GPL-3.0-only
title: Memory
description: >-
  What Dorothy's memory stores, how recall finds and delivers it, how it is
  compacted, tagged, kept in history and shared, and what awaits.
tags:
  - wiki
  - memory
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/wiki/topics/memory.md
   -
   -->

# Memory

[Wiki home](../../README.md)

Dorothy's memory is a directory of files she owns, a search index derived
from them, and the code that reads, writes, compacts, tags and versions
them. One service on the same machine serves the store to Dorothy's chat
and to the harnesses she is built for (Claude Code, Codex, OpenClaw,
Hermes and Pi). That the service and the store work is one claim; that each host
reaches them, and has been checked doing so, is another, and
[harnesses](../profiles/harnesses.md) records it host by host. This page
says what the memory is and does; how it is measured is under
[evaluation](./evaluation.md).

## What exists now

Each capability below is built: code and tests exist. How far each has
been checked beyond tests differs:

- Retrieval and delivery were measured on the user's own sessions by the
  [evaluation](./evaluation.md).
- Compaction, tags and history were each probed live
  ([compaction](../../reports/2026-10-07-compaction.md),
  [tags](../../reports/2026-10-08-tags.md),
  [history](../../reports/2026-10-08-memory-history.md)).
- Recording from other hosts was probed on copies of their sessions, and
  Hermes's reader has met no real session
  ([recording](../../reports/2026-10-20-recording.md)). Pi's was run in a
  pseudo-terminal against the published Pi, through a killed launcher
  ([Pi delivery](../../reports/2026-11-03_pi-delivery.md#the-native-fixture)).
- The rest, including the service's routes, rests on tests; the hosts'
  live checks are on the harnesses page.

Those capabilities are these eight:

- Conversations: every chat, and every session another host records, is
  one transcript with notes Dorothy writes about it.
- Knowledge: facts about the user, their work and what has worked, as
  Markdown files, personal or a project's.
- Recall: search over both, and opening a passage, by tools she calls and
  by a step that hands a host the passages for its prompt.
- Delivery: `deliver`, the one step that turns ranked hits into text
  within a budget, for production recall and the evaluation alike.
- Compaction: a long conversation decays into clusters with abstracts.
- Tags: a vocabulary of concepts and shallow tagging at each review.
- History: the data directory as a git repository, with healing and an
  encrypted mirror.
- The shared service: one HTTP and MCP service, and a sweep of the other
  hosts' session stores.

What does not exist yet is under [what awaits](#what-awaits).

## Where the code lives

All of it is `@dorothy/memory`, whose guide
[packages/memory/AGENTS.md](../../../packages/memory/AGENTS.md) is the
authority for its files and invariants. The packages page has its
[boundary](../profiles/packages.md#memory): it imports `core` alone, and
neither the agent nor the AI SDK. Subdirectories keep their
own guides, linked below where they matter. The evaluation reads it only
through the `"./evaluation"` entry point.

## What is stored

Everything is a file under `$XDG_DATA_HOME/dorothy/`, except the index.

- A transcript, one private JSONL file a conversation. Tool text is
  scrubbed and trimmed to 2,000 characters a side. A session from another
  host is one conversation too, each event recorded once by its source id
  ([`transcript.ts`](../../../packages/memory/src/transcript.ts),
  [contract guide](../../../packages/memory/src/contract/AGENTS.md#files)).
- A sidecar, `<phrase>.meta.json` beside the transcript, holding the notes:
  a title, a description and an abstract that Dorothy writes herself in a
  background review once the user has gone idle, never delaying a reply.
  It also holds her appraisals of what she opened, the conversation's tags,
  its compaction clusters and any pin or hiding by the user. A correction
  by the user is never overwritten
  ([catalogue spec](../../specs/2026-10-05-conversation-catalogue-design.md#decisions)).
- A fact, an OKF Markdown file under `knowledge/`. Nothing deletes one: a
  retired fact stays indexed, searchable and in history. A fact is
  confirmed when the user wrote or verified it; the rest is fenced as
  unconfirmed wherever it appears
  ([store spec](../../specs/2026-10-15-memory-store-design.md)).
- A project, with its own facts, synced to its repository's `docs/memory/`,
  `.agents/memory/` or `.claude/memory/`, whichever it holds, so that
  agents without Dorothy still read them
  ([projects guide](../../../packages/memory/src/projects/AGENTS.md)).
- The recall index, a derived SQLite FTS5 database in the cache directory,
  synced from the transcripts and sidecars before every query. Deleting it
  costs a rebuild, never data
  ([recall spec](../../specs/2026-10-06-recall-design.md#decisions)).

A conversation backfilled from a host's earlier sessions has no notes until
`--review-backfill` reviews it, in capped batches; before that, recall can
find little of it. The [first evaluation](./evaluation.md#history) measured
the difference.

## How recall finds

Search is full-text, offline and local. It takes a query and returns hits
of two kinds, conversations (episodes) and knowledge, each carrying up to
three of the turns that matched, best first. Two MCP servers reach it, with
different tools:

- The contract's service, shared with other harnesses, has four:
  `search` finds, `open` reads a conversation or fact in full or at a
  turn, `remember` writes a fact, and `brief` gives a host its opening
  block ([`tools.ts`](../../../packages/memory/src/contract/tools.ts)).
  Scope is the service's to enforce: a request sees personal knowledge and
  its own project's, and `open` refuses another's with a 403.
- Dorothy's own recall server, `dorothy --recall-server`, which her chat
  starts, has `search`, `open`, `tags` (the vocabulary, below) and
  `remember` where a knowledge root is given. It adds `recollect` only
  with `--recollect`, for a chat with clusters (compaction, below). It has
  no `brief`, as chat takes its block directly
  ([`server.ts`](../../../packages/memory/src/recall/server.ts)).

Both servers also accept injected persona layers. With nonempty layers,
`persona` opens one exact layer name as plain text; an unknown name returns
a tool error naming the available layers. Without layers the tool is
absent. These layers are who Dorothy is, not what she remembers, and are
for her alone, not an agent she dispatches. Memory declares their shape
structurally and never imports identity
([`tool.ts`](../../../packages/memory/src/persona/tool.ts)). The CLI passes
identity's layers to both servers at start. Chat keeps the persona tool
alongside its memory tools, and Claude Code's launch allows it. A persona
change reaches Codex, Pi and Hermes after the service restarts; Hermes's
`SOUL.md` changes only on reinstall. The
[persona plan](../../plans/2026-11-14_persona.md) records the work.

Dorothy opens past conversations on demand, never pushed, and afterwards
appraises each read as none, slight, useful or essential. The appraisals
feed salience, a score of reads decaying with a half-life
([`rank.ts`](../../../packages/memory/src/memory/rank.ts)), which orders
the opening block. The baseline engine merges knowledge and episode hits by
alternating them by rank, the best episode first, because their scores come
from different tables and share only rank
([`merge.ts`](../../../packages/memory/src/engine/merge.ts)).

## What `deliver` hands over

Finding a conversation is not the same as handing its evidence to the
model. The first evaluation found that Dorothy found the right
conversation and still answered from its note; the
[engine report](../../reports/2026-10-31-memory-engine.md#summary) records
the fix. `deliver`
([`deliver.ts`](../../../packages/memory/src/contract/deliver.ts)) is it:

- It takes the ranked hits, the query and a budget in characters.
- It renders each episode as a passage around the turns search matched,
  with a neighbour either side, growing while its room allows, under the
  conversation's title and dates. A hit with no matched turn falls back to
  the turns sharing most of the query's words.
- It renders knowledge as its text, and leaves out any knowledge the
  caller says it has shown already. A hit whose source cannot be opened,
  such as a hidden conversation, arrives as its title and snippet.
- No item takes more than a quarter of the budget, and an item cut to fit
  is marked so.
- When the text goes to a host it is escaped, so nothing a conversation
  held can close the frame it sits in.

Production recall calls it with the host's recall budget, asking for eight
hits for the user's prompt, and frames the result as `<recalled>`
information, not instruction
([`recall.ts`](../../../packages/memory/src/contract/recall.ts)). The
evaluation's `dorothy` system calls the same function, so the evaluation
measures what hosts receive. The opening block is the other half of what a
model sees: confirmed knowledge of the user, then of the project, then
unconfirmed knowledge fenced as claims, then the conversations' notes at
the richness their salience earns (full, described or titled), packed into
the host's block budget and frozen for the session, so that a resume gives
it byte for byte
([`block.ts`](../../../packages/memory/src/contract/block.ts)).

## Compaction

A conversation grows until it no longer fits. Past a soft threshold of
tokens (`[compaction] soft`) Dorothy compacts at the next idle moment, and
past the hard one before the next message. `compact()` splits the turns
before a verbatim tail into topical clusters, each with an abstract that
stays in context, and each can be read word for word with `recollect`, a
tool of the recall server alone, served for a chat that has clusters.
Dorothy's compaction replaces the CLI's own, which stays off. At each
compaction the block's budget charges the earlier turns' abstracts first,
so notes on other conversations fade as this one grows. The
[compaction guide](../../../packages/memory/src/compaction/AGENTS.md) holds
the files, and the [probes](../../reports/2026-10-07-compaction.md) the
live check that it works and the CLI's does not.

## Tags and vocabulary

Tags are a SKOS-style vocabulary in `tags.json`: concepts with a preferred
label, alternative labels, broader concepts and a scope note, with
tombstones for those deleted or merged. Each sidecar holds the ids of its
conversation's concepts. At each review Dorothy tags the conversation
shallowly, coining a concept only when none fits, inside the sidecar's
lock so two runs never coin one label twice; a bad tag never fails the
notes. The user browses with `--tags`, corrects with `--edit-tags`, and a
deleted concept stays deleted. Tags are looked up through the recall
server's `tags` tool and `search`'s tag filter, and do
not enter the opening block; hidden conversations carry none
([tags spec](../../specs/2026-10-07-tags-design.md#decisions),
[tags probe](../../reports/2026-10-08-tags.md)).

## History

The data directory is a git repository. Each logical change Dorothy or the
user makes through her is a commit; changes made outside her are swept up
first and attributed to the user. A lint guards every commit, and a file
that fails it is restored from history at once, its broken bytes kept under
`broken/`. The user can see, restore and roll back
(`--history`, `--restore`, `--rollback`). A mirror seals new commits as
AES-256-GCM bundles on an orphan branch and pushes them to a remote under
`DOROTHY_MIRROR_KEY`; `--recover` rebuilds a lost disk from it. Memory
works whether or not history does. Two engines, the git binary run
isolated and isomorphic-git, share one contract test
([history spec](../../specs/2026-10-08-memory-history-design.md),
[probe](../../reports/2026-10-08-memory-history.md)). Its growth is a known
limit, retained in the
[deferred findings](../../deferred/2026-10-08_memory-history-deferred.md).

## The shared service

One service speaks the memory contract to every harness, so the same
memory follows her wherever she goes. It serves the four MCP tools over
Streamable HTTP and a stdio bridge, takes records from hooks, and fails
open: a client that cannot reach it keeps its records and retries, and
never blocks the host. Host profiles, one JSON file a harness, set each
host's block and recall budgets
([contract guide](../../../packages/memory/src/contract/AGENTS.md),
[contract spec](../../specs/2026-10-18-memory-contract-design.md)).

- An engine proposes; the service validates and writes, so the files stay
  the truth, and harnesses write through it under the store's lock.
- A transcript path is taken only over loopback, from a regular file under
  a known directory; a request from beyond loopback carries a device token.
- In the background it reviews idle conversations, extracts facts from them
  (never from a backfilled one), consolidates and exports projects, and
  sweeps the session stores of Claude Code, Codex, Hermes and Pi.
  `[recording] hosts` is empty by default, so nothing is swept until the
  user sets it; Pi's own hook records its sessions beside the sweep
  ([service guide](../../../packages/memory/src/service/AGENTS.md),
  [recording guide](../../../packages/memory/src/recording/AGENTS.md)).

Which host receives her memory by which route, and which of those routes
have been checked live, belongs to
[harnesses](../profiles/harnesses.md); the protocols are under
[MCP](../profiles/protocols.md#mcp).

## What awaits

- A chunk index or hybrid search awaits the questions only lexical search
  passes: five questions, and ten of its 27 passes that Dorothy misses.
  The [engine report](../../reports/2026-10-31-memory-engine.md#left) says
  that is where it would be judged, and the roadmap holds it as waiting.
  Adopting another provider's engine is likewise a roadmap candidate, not
  a decision.
- Cyclical maintenance, which revises and prunes the vocabulary and
  deep-tags conversations, has its design agreed and awaits a spec
  ([roadmap](../../roadmap.md#cyclical-maintenance-4a)).
- Relations and embeddings are conditional on recall's falling short; the
  roadmap names the same questions as where a hybrid would be judged
  ([roadmap](../../roadmap.md#relations-and-embeddings-5)).
- What awaits for each host is on
  [harnesses](../profiles/harnesses.md).

## Records

Every dated record of memory, by kind and oldest first, is under
[memory in the catalogue](../records.md#memory). The measured outcome of
the engine's first step is in the
[engine report](../../reports/2026-10-31-memory-engine.md), and
[evaluation](./evaluation.md) explains its figures.

## Related

- [Evaluation](./evaluation.md)
- [Identity, harnesses and delivery](./identity-and-harnesses.md)
- [Models and routing](./models-and-routing.md)
- [Packages](../profiles/packages.md)
- [Decisions](../decisions.md)
- [Problems](../problems.md)
