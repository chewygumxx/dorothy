---
ctime: 2026-10-15
mtime: 2026-10-15
spdx: GPL-3.0-only
title: Memory systems compared with Dorothy's store
description: >-
  Hermes Agent, OpenClaw, Letta, claude-mem, Mastra, mem0, Graphiti,
  basic-memory and Claude's own memory, set against the memory store
  spec, with what Dorothy could take from each.
tags:
  - dorothy
  - memory
  - notes
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-10-15_memory-systems-comparison.md
   -
   -->

# Memory systems compared with Dorothy's store

Research for the [memory store spec](../specs/2026-10-15-memory-store-design.md),
done on 2026-10-15. Hermes Agent and claude-mem were read from their
source (shallow clones of `main` as of 2026-10-13 and 2026-10-14) and
their docs; OpenClaw from its docs in its repository; Letta, Mastra,
mem0, Graphiti, basic-memory, Anthropic's memory tool and Claude Code
from their published docs. Nothing was run. Claims are the projects'
own, not measured here.

## In brief

The spec's shape is the field's: Markdown files with frontmatter as the
truth, a derived full-text index, a small always-present layer and the
rest on demand. Letta's MemFS is nearly the same design, git and all.
Where Dorothy is alone is in syncing a project's memory both ways with
its repository, in sealing history to a mirror, and in a SKOS
vocabulary. Where she is behind is in trust: OpenClaw and Hermes both
treat what enters memory as an attack surface, and the spec says too
little of it. The other gaps belong to the two specs still to come.

## The systems

### Hermes Agent

- **Shape**: two bounded files, `MEMORY.md` (agent notes, 2,200
  characters) and `USER.md` (the user, 1,375), injected as a frozen
  snapshot at session start for the prompt cache, with a usage header
  ("67%, 1,474/2,200 chars"). Past sessions in SQLite with FTS5,
  searched by a `session_search` tool that can scroll within a session.
- **Writes**: a `memory` tool with `add`, `patch` and `remove` by unique
  substring, in batches. A full store refuses a write and the agent
  consolidates in the same turn; nothing is dropped silently. `replace`
  was removed because models used it as find-and-swap and wiped
  multi-fact entries. A background review after each turn, replaying
  the cached conversation, saves memories and writes skills.
- **Control**: `write_approval` stages every write, the background
  review's included, for `/memory approve`; a staged patch pins the
  entry it targets. `/journey` shows what was learnt over time, to edit
  or delete.
- **Safety**: entries are scanned for injection, exfiltration and
  invisible Unicode before they are accepted; everything handed to an
  external provider passes a secret scrub first.
- **Against the spec**: no scopes beyond profiles, no history, no
  projects. Its user profile is the spec's `user` facts; its limits and
  usage header are what the Layers spec needs.

### OpenClaw (Memory Core)

- **Shape**: tiers by trust. Instructions (`AGENTS.md`, human only);
  a curated core (`MEMORY.md`, `USER.md`), budgeted and injected; an
  episodic tier (daily notes, transcripts) reached only by search;
  standing intents for prospective memory; `DREAMS.md` for the human.
- **Writes**: one primary writer, "dreaming", a scheduled background
  pass that promotes episodic candidates into the core through
  rule-based gates (recall frequency, recency, recurrence) and then a
  consolidation turn. A rewrite is accepted only if it validates, fits
  its budget and loses few entries; it checks the file's hash before
  replacing it, and falls back to appending.
- **Provenance**: every entry has an origin class, `owner`, `agent`,
  `untrusted` or `system`, held in index columns the model cannot write
  through prose, and never defaulted to `owner`. Network-sourced tool
  results taint the rest of a turn. Untrusted content can be searched
  but never promoted or auto-injected. Cron, heartbeat and sub-agent
  sessions produce no durable memory. What memory injected is marked
  and never re-extracted, so a fact recalled a hundred times stays one.
  `memory forget` removes what a session contributed and keeps it out of
  later ingestion.
- **Recall**: a free lane (bootstrap files, ranked search with a 30-day
  recency half-life and a 1 to 10 importance set at write time, and
  trigger phrases matched per message) and an escalation lane, a recall
  sub-agent run only when a message shows recall intent and the free
  lane found nothing.
- **Projects**: keyed by the normalised `origin` remote, as the spec
  keys them, but as a ranking and eligibility signal on entries, not a
  partition of files.
- **The user model**: imperative directives ("Always", "Never",
  "Prefer"), dated, superseded in place rather than appended, because
  models answer from a stale preference left beside a new one.
- **Against the spec**: the most deliberate design surveyed, and the
  one the spec has most to learn from on trust and on writing.

### Letta (MemFS)

- **Shape**: each agent's memory is a git repository of Markdown files
  with `name` and `description` frontmatter, edited with ordinary file
  tools, every edit a commit. Files at the root are in the system prompt
  every turn; a directory with its own `MEMORY.md` index is read on
  demand. Agent-owned skills live in it too. Cloud agents' repositories
  are hosted and projected onto each machine.
- **Writes**: the agent, `/remember`, and "dreaming" sub-agents that
  review recent conversations, working in git worktrees so they never
  block the main agent. `/init` builds memory for a project from its
  repository and past sessions; `/doctor` audits placement, duplication
  and token use.
- **Against the spec**: the closest design. Its disclosure is by
  directory, where the spec's is by kind; its sharing is a hosted
  repository, where Dorothy's is a sealed mirror and per-project export.

### claude-mem

- **Shape**: a Claude Code plugin. Hooks capture every tool use
  (`PostToolUse`); a worker compresses them with the Agent SDK into typed
  observations and a summary per session (request, learned, completed),
  in SQLite with Chroma for vectors. `SessionStart` injects an index of
  recent observations; MCP tools search, show a timeline, then fetch
  observations in full.
- **Natives**: it watches Claude Code's and Codex's memory folders and
  imports changed notes as snapshots, never rewriting a source file.
  Retrieved records are framed as evidence that must not supply
  instructions.
- **Robustness**: the host is never blocked: transport errors exit 0.
  Observations are deduplicated by content hash.
- **Against the spec**: it records Claude Code by hooks, which is one of
  the Bodies spec's two options; it imports native memory one way where
  the spec syncs both.

### Mastra

- **Shape**: message history per thread, working memory (a structured
  template of the user, shared across threads), semantic recall, and
  observational memory: an Observer that compresses messages past 30,000
  tokens into dated, prioritised observations, and a Reflector that
  condenses observations past 40,000.
- **Lessons**: work is buffered ahead of the threshold in the
  background; activation is timed to the provider's cache lifetime
  (five minutes for Anthropic). Observations shared across threads were
  deprecated: they broke other threads' prompt caches.
- **Against the spec**: closest to Dorothy's compaction, which the spec
  keeps; the cache lesson is for the Layers spec.

### mem0

- **Shape**: an extraction call turns new messages into memories,
  scoped by `user_id`, `agent_id` and `run_id`, with metadata to filter
  and an optional `expiration_date`. It is now add-only: memories
  accumulate rather than being rewritten.
- **Against the spec**: a service, not files. Its expiry is worth
  taking; add-only is the opposite of OpenClaw's supersession, and
  OpenClaw's evidence favours superseding.

### Graphiti (Zep)

- **Shape**: a temporal knowledge graph built from episodes, each fact
  an edge with a validity interval. A contradicted fact is invalidated
  from a time, not deleted, so past states can be queried. Retrieval
  combines vectors, BM25 and graph traversal without a model.
- **Against the spec**: a heavier model than Dorothy needs, but its
  validity interval is the principled form of expiry and supersession.

### basic-memory

- **Shape**: a Markdown knowledge base on disk, with a derived index,
  served over MCP to many clients, organised into projects. Described
  here from its landing page; its syntax for observations and relations
  was not checked.
- **Against the spec**: the same files-first stance, without history or
  scopes.

### Anthropic's memory tool and Claude Code

- **The memory tool** (`memory_20250818`) is client-side: the model asks
  to `view`, `create`, `str_replace`, `insert`, `delete` or `rename`
  under `/memories`, and the application stores it. The API adds an
  instruction to view memory first. The docs ask the implementer to
  block path traversal, cap file sizes and expire unused files.
- **Claude Code's auto-memory** is the format the spec exports: a
  `MEMORY.md` index and one file per memory, typed `user`, `feedback`,
  `project` or `reference`. Only the index's first 200 lines or 25 KB
  load at startup; topic files are read on demand. It is per repository
  and machine-local, and kept out of Claude Code's transcript cleanup.

## Against the spec

| Concern | Spec | Field |
| --- | --- | --- |
| Truth | Markdown facts, JSONL transcripts | the same: Letta, Hermes, OpenClaw, Claude |
| History | git, sealed to a mirror | git in Letta only |
| Scope | a path: personal or a project | profiles (Hermes), annotations (OpenClaw), ids (mem0) |
| Project id | normalised `origin` remote | the same in OpenClaw |
| Repository | two-way sync, the store's truth | one-way import (claude-mem); none elsewhere |
| Trust | `by` on provenance; framing later | origin classes and quarantine (OpenClaw), scanning (Hermes) |
| Supersession | overwrite, history keeps the old | in place (OpenClaw), validity intervals (Graphiti), add-only (mem0) |
| Expiry | none | `expiration_date` (mem0), interval (Graphiti) |
| Importance | none | 1 to 10 at write time (OpenClaw) |
| Search | FTS5 | FTS5 (Hermes); hybrid with vectors (most others) |
| Tool output | trimmed, not indexed | compressed to observations (claude-mem); scrubbed (Hermes) |
| Forgetting | tombstones | by source session, kept from re-ingestion (OpenClaw) |
| Prospective | none | standing intents and cron (OpenClaw) |

## What Dorothy could take

### Into this spec

1. **Origin as a closed set.** Provenance gains `origin`: `user` (the
   user said it), `dorothy` (she derived it from the user's words or her
   own work), `external` (derived from tool output, the web or another
   person's text) or `repo` (imported). It is set by the code that
   writes, never parsed from a fact's text, and never defaulted to
   `user`. The Layers spec then keeps `external` facts out of the
   always-present layer (OpenClaw).
2. **Recall loops marked.** Tool events from Dorothy's own memory tools
   carry `memory: true`, so no review re-learns what memory supplied
   (OpenClaw).
3. **Secrets scrubbed** from tool events before they are written, by
   known shapes (`key=value`, `Bearer`, private keys), as well as
   trimmed (Hermes).
4. **Invisible characters refused.** The lint rejects control and
   invisible Unicode in facts, which costs nothing and blocks a known
   way of hiding instructions (Hermes).
5. **`MEMORY.md` within Claude Code's read limit.** Export keeps the
   index under 200 lines and 25 KB, and warns when the project's facts
   would not fit, since Claude Code drops the rest silently.
6. **Optional `importance` and `expires`** in a fact's frontmatter,
   written by whoever has a model in the loop; the Layers spec ranks and
   prunes by them (OpenClaw, mem0).
7. **Forgetting a conversation's contributions.** `forgetFact` by
   source: every fact whose `from` names a conversation can be forgotten
   together (OpenClaw).

### Into the Bodies spec

- Never block the host: memory failures degrade, they never stop a turn
  (claude-mem, OpenClaw).
- Sessions that are not the user's, such as background reviews and
  sub-agents, produce no facts (OpenClaw).
- `remember` edits by unique substring, with no whole-fact `replace`
  (Hermes).

### Into the Layers and learning spec

- A bounded always-present layer with its usage shown, and
  consolidation when it is full rather than silent dropping (Hermes).
- `user` facts as dated imperative directives, superseded in place
  (OpenClaw, on PrefEval).
- Ranking by relevance, recency and importance with no model call, and
  a costlier recall pass only when a message shows recall intent
  (OpenClaw).
- Promotion by use: a fact earns its place in the layer by being
  recalled, not by being written confidently (OpenClaw).
- Reviews timed to the prompt cache, replaying a warm conversation
  (Hermes, Mastra).
- An optional approval gate for background writes (Hermes).
- Lessons that are procedures become skills (Hermes, Letta).
- An audit of placement, duplication and token use (Letta's `/doctor`).

### For the roadmap

- **Prospective memory**: reminders compiled into scheduled jobs and
  triggers rather than left as prose (OpenClaw's standing intents).
- **Bootstrapping a project's memory** from its repository and past
  sessions (Letta's `/init`).

## What was taken

All of the above, but for expiry and forgetting. The user ruled that a
memory may fade but must always remain possible to query: the spec drops
`expires` and replaces forgetting with retiring, which takes a fact out
of the always-present layer and the repository's copy and ranks it below
live facts, while it stays in the store, in search and in history.
`importance` stays, for ranking. Forgetting a conversation's
contributions became retiring them.

## Where the spec differs on purpose

- **Partitioned by path.** OpenClaw scopes by annotation and ranks; the
  spec stores a project's facts apart so that export cannot carry a
  personal one. The Layers spec can still rank across scopes.
- **Two-way sync.** No other system writes memory back into a
  repository as the source of truth's copy; claude-mem deliberately
  never rewrites a source file. The spec's conflict rule, that the
  repository wins and history keeps the store's, exists because of it.
- **No vectors.** Most systems use hybrid search; Dorothy keeps FTS5
  until recall shows it falling short, as Relations and Embeddings
  says.

## Sources

- Hermes Agent: `website/docs/user-guide/features/memory.md` and
  `memory-providers.md` in
  [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent).
- OpenClaw: `docs/concepts/memory-architecture.md` and
  `memory-provenance.md` in
  [openclaw/openclaw](https://github.com/openclaw/openclaw).
- claude-mem: `docs/architecture-overview.md` and
  `docs/native-memory-bridge.md` in
  [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem).
- Letta: [Memory & dreaming](https://docs.letta.com/letta-code/memory)
  and [MemFS](https://docs.letta.com/letta-code/memfs).
- Mastra: [memory overview](https://mastra.ai/docs/memory/overview) and
  [observational memory](https://mastra.ai/docs/memory/observational-memory).
- mem0: [adding memories](https://docs.mem0.ai/core-concepts/memory-operations/add).
- Graphiti: [overview](https://help.getzep.com/graphiti/getting-started/overview).
- basic-memory: [docs](https://docs.basicmemory.com/).
- Anthropic: [memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
  and [Claude Code memory](https://code.claude.com/docs/en/memory).
