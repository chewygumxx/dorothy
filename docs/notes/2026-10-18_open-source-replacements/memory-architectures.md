---
ctime: 2026-10-18
mtime: 2026-10-18
spdx: GPL-3.0-only
title: "Dorothy's memory against the field: architectures, benchmarks, choice (2026-10-18)"
description: >-
  The second pass on memory: architectures, benchmarks and a proposed
  evaluation, judged by the owner's four priorities.
tags:
  - dorothy
  - memory
  - notes
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-10-18_open-source-replacements/memory-architectures.md
   -
   -->

# Dorothy's memory against the field: architectures, benchmarks, choice (2026-10-18)

A research agent's report, kept as it was written apart from its line
wrapping, its em dashes and this header, for the
[note on open-source replacements](../2026-10-18_open-source-replacements.md).

Read-only research. Nothing in the repo was changed. Builds on
`4-memory.md` (candidate survey, not repeated) and `1-inventory.md` (line
counts). "(unverified)" marks what could not be checked quickly.

## Bottom line

- **The owner is right on retrieval and on what is remembered.**
  - Search is BM25 only.
  - The always-present block lists past conversations, not what Dorothy
    knows about the user.
  - Facts are written only when the chat model calls `remember`.
  - Nothing handles a fact that changes over time.
  - Nothing measures any of it.
- **About 58% of the 19.1k memory lines are storage, integrity, concurrency
  and ingestion; about 17% decide what to remember and retrieve.**
- **What Dorothy does well is worth keeping:**
  - a lossless, open archive with git history and an encrypted mirror;
  - a frozen, cache-friendly block;
  - layered drill-down from a title to the raw turn;
  - editable files with provenance set by code;
  - a usefulness signal on every lookup.
- **The field has moved to hybrid retrieval with background extraction and
  consolidation.** The leaders' published LongMemEval-S scores run from
  84% to 95% (Zep 71%), against 60% for GPT-4o with the full context.
  Almost all are vendor-reported. LoCoMo is too flawed to decide anything, and
  BEAM
  harnesses have leaked metadata into the answering prompt.
- **Recommendation: keep Dorothy's transcripts as the archive and put a
  provider over them as a derived, replaceable layer**, shared by every
  client over MCP. In order:
  1. **Hindsight** (MIT; best-evidenced retrieval; most clients; local
     models);
  2. **OpenViking** (the cleanest L0/L1/L2 layering, but AGPL with extra
     terms and a VLM dependency);
  3. **EverOS** (Markdown truth with hybrid search and reflection, but thin
     evidence);
  4. **Honcho** (a strong user model, on a heavy AGPL stack).

  Any of these replaces about 8k lines.
- **Decide by measurement, not by this ranking.** Section 5 builds about
  300 questions from Dorothy's own data. Retired facts and appraised
  lookups are ready-made ground truth. It runs the current recall, an
  improved Dorothy and the four providers, for roughly $150 to $600 and two
  days' work (estimate).

## 1. Dorothy's memory, judged honestly

Paths are under `/home/chewygumxx/dev/dorothy/packages/memory/src/`.

### The hypotheses

| | Hypothesis | Verdict | Evidence |
| --- | --- | --- | --- |
| a | Lexical only | **True** | `recall/query.ts:177-304` ranks with `bm25(turns_fts)`, `bm25(notes_fts)` and `bm25(facts_fts)`. A grep for embed, vector, cosine or rerank finds nothing outside tests. The roadmap parks embeddings as "Conditional ... only worth building once recall shows FTS5 falling short; there is no such evidence yet" (`docs/roadmap.md:175-182`). But nothing in the repo could produce that evidence (see e). Query rewriting is left to the calling model, and an all-terms match falls back to any-term. |
| b | Block is about conversations, not the user | **True** | `memory/block.ts:76-104` renders only `<conversation>` entries (title, description, abstract by tier). No fact enters it; the roadmap says facts "reach her only through recall" (`docs/roadmap.md:75`). `writeFact` has one caller, `recall/remember.ts:157`, the model's `remember` tool; project sync imports with `putFact` (`projects/sync.ts:35`). The reviewer writes notes, tags and appraisals, never facts (`memory/review.ts`, `reviewer.ts`). The design names "reviews that distil facts" as the unbuilt third spec (`docs/specs/2026-10-15-memory-store-design.md:52-55`). |
| c | No temporal reasoning or superseding | **Mostly true** | `search` takes `after`/`before` dates against turn times (`docs/specs/2026-10-06-recall-design.md:201-220`), and `remember` has a `retire` action with a `why` (`recall/server.ts:304-322`), so the model can retire a fact by hand. Nothing detects a contradiction, records when a fact became true as against when it was learnt, or ranks a newer fact over an older one on the same subject. |
| d | No learning loop | **Mostly true** | The one feedback loop is retrieval-side: reviews appraise each `open` (none, slight, useful, essential) and `salience()` weighs them (`memory/rank.ts`; recall spec, "Salience"). Nothing distils lessons or skills; "Learning" is an "Idea" on the roadmap (`docs/roadmap.md:141-151`). |
| e | No memory-quality evaluation | **True** | No file in the repo matches eval, bench, LongMemEval or LoCoMo except one note mentioning an informal OpenClaw comparison (`docs/notes/2026-10-15_claude-conversation-openclaw-hermes-agent.md:118`). The reports verify behaviour (tests, tmux probes), not retrieval quality. |
| f | Mostly integrity and concurrency | **True** | See the breakdown below. |

### Where the 19,085 source lines go

My classification, from `1-inventory.md` and `wc -l` per file:

| Share | Lines | What |
| --- | --- | --- |
| Storage, integrity, concurrency, ingestion | about 11,000 (58%) | history, mirror, seal and their commands (3,076); bodies, Claude Code recording and quarantine (2,271); project sync (1,253); facts file and store (972); recall store and sync (900); sidecar merge rules and validators (703); compaction's session handover, claims, chains and interrupts (`session.ts`, `shared.ts`, `run.ts`: 1,181); transcript and scrub (600); locks (41) |
| Memory intelligence | about 3,300 (17%) | review prompt and validation (`review.ts` 513, about half of `reviewer.ts`); BM25 query, snippets and windows (`query.ts` 966); salience and tiered packing (`rank.ts`, `block.ts`: 294); cluster prompt and plan (`clusters.ts`, `plan.ts`, `compact.ts`: 352); tagging and tag closure (409); `remember` (178); scheduler (129) |
| Interface and orchestration | about 4,800 (25%) | `open.ts` 948, catalogue, preview, record; `--list`, `--memory`, `--tags`, `--facts` commands and their `$EDITOR` views |

So roughly one line in six decides what to remember or what to retrieve. The
rest makes it durable, concurrent, recoverable and editable.

### What the design does well

- **A lossless, open archive.** Append-only JSONL per conversation, with the
  index derived and rebuildable (recall spec, "State"). Most of the field
  extracts and discards; Dorothy can re-derive any layer later, which is what
  makes a switch cheap.
- **Real progressive disclosure, if narrow.** Tiered notes (titled, described,
  full) under a token budget, then `search` with snippets, then `open` of a
  turn window, then `recollect` of compacted clusters. That is the L0/L1/L2
  shape OpenViking markets (section 2), applied to conversations.
- **A frozen, cache-friendly block.** Nothing is pushed into the user's
  message, so the prompt prefix stays cached ("On demand, never pushed").
- **Inspection and correction.** Notes, tags and facts are editable files with
  per-field ownership, and fact origin is set by code, never by text, a
  prompt-injection defence few systems have.
- **Persistence.** Git history of every change, lint-and-heal, and an
  encrypted off-site mirror. No surveyed system matches it.
- **A usefulness signal.** Each read is appraised in a later review, a rare
  outcome label, which an evaluation or a learning loop could reuse.
- **Provider neutrality at the core.** Reviews and compaction see only
  core's `StructuredCall`; recall is a stdio MCP server any client can launch.

### Where it is weak against the field

- **Retrieval**: BM25 over the model's own query words, where every leading
  system is hybrid, often with graph, time and a reranker.
- **What it knows**: a list of past conversations, not a model of the user;
  preferences and decisions are reached only if the model searches with the
  right words.
- **Write path and change**: facts wait on `remember`, which small models
  skip; nothing handles knowledge updates, which LongMemEval tests directly.
- **Reach**: a stdio process per client over local files, with no server
  mode for a second device.
- **No measurement**, so no design choice so far, "FTS5 is enough" included,
  rests on evidence.

## 2. Architectures, scored on the four priorities

Repository facts (licence, stars, last push, latest release) are from
`gh api repos/<x>` and `/releases/latest` run today; details already in
`4-memory.md` are cited there and not repeated.

### The architecture families

| Family | What is stored | Write path | Exemplars |
| --- | --- | --- | --- |
| Extracted facts | Atomic facts, deduplicated | LLM extraction per turn or session | mem0, supermemory, Memori |
| Temporal knowledge graph | Entities, edges with validity windows, episodes | LLM extraction plus entity resolution | Graphiti/Zep, cognee, MemOS, Hindsight (partly) |
| Layered belief network | Raw facts, then consolidated observations, then standing "mental models" | Extraction plus background consolidation | Hindsight, Honcho (peer representations and conclusions) |
| Observational log | A dated, prioritised log replacing raw messages in context | Observer and Reflector agents at token thresholds | Mastra OM |
| Lossless summary DAG | Every message, plus a tree of summaries linking to sources | Summarise at compaction; expand on demand | lossless-claw, hermes-lcm; Dorothy's clusters are a one-level version |
| Memory files | Markdown with frontmatter, agent-edited, git-versioned | The agent writes; "dreaming" subagents revise | Letta MemFS, Hermes MEMORY.md, OpenClaw memory-core, Basic Memory, EverOS |
| Tiered context filesystem | Every node has an L0 abstract, an L1 overview, L2 detail | Extraction on session commit | OpenViking |
| Verbatim plus index | Raw text, chunked and embedded, no extraction | None needed | MemPalace, memsearch, qmd, episodic-memory, Dorothy today |

### Systems

| System | Model | Retrieval | Layers | Integrations | Neutrality | Footprint | Licence, release, activity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [Hindsight](https://github.com/vectorize-io/hindsight) | Banks of world facts, experiences, observations (refined, with supporting quotes and proof counts) and mental models | Semantic, BM25, graph and temporal in parallel, RRF, cross-encoder rerank, token-trimmed | Mental models (a DB read, no LLM) > observations > facts > stored documents ([config](https://hindsight.vectorize.io/developer/configuration)) | MCP per bank; installers for Claude Code, Codex, opencode, pi and others; Hermes provider ([Hermes](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory-providers.md)); OpenClaw unverified | 29 LLM providers including ollama, lmstudio, llamacpp, litellm, `none`; local `bge-small-en-v1.5` embeddings by default; warns weak models emit invalid JSON | Python server, embedded Postgres (pg0) or Docker; Node client `@vectorize-io/hindsight-client` 1.0.0 | MIT; v1.0.0, 2026-10-13; 50.9k stars, pushed 2026-10-17 |
| [Graphiti](https://github.com/getzep/graphiti) | Bi-temporal knowledge graph: facts with "a validity window: when it became true, and when (if ever) it was superseded"; episodes kept | Semantic, BM25, graph traversal; graph-distance and LLM rerankers | Episodes > entities and facts; communities | MCP server in `mcp_server/` | Any OpenAI-compatible, but "very small models frequently emit JSON that doesn't match the requested schema" | Python plus Neo4j, FalkorDB, FalkorDB Lite (Python 3.12+) or Neptune | Apache-2.0; v0.31.1, 2026-10-15; 31.9k stars. Zep CE is deprecated, Zep's engine proprietary ([Zep](https://blog.getzep.com/announcing-a-new-direction-for-zeps-open-source-strategy/)) |
| [mem0 OSS](https://github.com/mem0ai/mem0) | Single-pass ADD-only facts, entity linking, recency decay ([research](https://mem0.ai/research)) | Semantic, keyword and entity signals fused | Flat facts | MCP hosted only (`4-memory.md`); Hermes provider | Many adapters, TS and Python | Library in-process, or server | Apache-2.0; ts-v3.3.1, 2026-09-25; 67.4k stars. Whether the scored algorithm is fully in OSS is unverified |
| [Letta Code MemFS](https://docs.letta.com/letta-code/memfs) | Markdown memory files in git; dreaming and memory-doctor subagents edit through worktrees | File tools; QMD for semantic; local message search "full-text matching only" | Root files always in prompt; indexed directories by `MEMORY.md` signposts | Its own harness; learns from Claude Code and Codex sessions | Any OpenAI-compatible with tools | TS harness, Node | Apache-2.0; v0.34.16, 2026-10-16; 3.6k stars |
| [Mastra OM](https://mastra.ai/research/observational-memory) | Dated, prioritised observation log; three-date model; Reflector removes superseded entries | None per turn: the log is always in context, cache-stable | Observations > recent messages; retrieval mode pages raw messages | Mastra agents only | 220 providers | TS library `@mastra/memory` 1.38.0 plus a storage adapter | Apache-2.0 outside `ee/`; 28.9k stars |
| [Honcho](https://honcho.dev/evals/) | Peer representations, conclusions, summaries, dreaming; deriver, dreamer and dialectic agents | Semantic plus a dialectic (LLM) query endpoint | Representation > conclusions > messages | MCP; Claude Code, OpenCode, OpenClaw, Hermes | OpenAI-compatible per feature; tool calling required | FastAPI, Postgres with pgvector, Redis | AGPL-3.0; v3.3.0, 2026-10-14; 7.7k stars |
| [OpenViking](https://github.com/volcengine/OpenViking) | `viking://` filesystem of resources, memories, skills, peers; memories extracted to editable Markdown on session commit | Directory-scoped (TrieHI) then vector; `find` and planned `search` | **L0 abstract, L1 overview, L2 detail** per node | Claude Code, Codex, OpenCode, pi, OpenClaw, Hermes, MCP, HTTP | Volcengine, OpenAI, Kimi, GLM, Ollama; needs an embedder **and a VLM** | Python server plus Rust CLI; SDKs in Python, Go, TS | **AGPL-3.0 with added terms** forbidding "wholesale rewriting" and translation without permission; v0.5.0, 2026-10-09; 40.2k stars |
| [EverOS](https://github.com/EverMind-AI/EverOS) (was EverMemOS) | User track (episodes, profiles) and agent track (cases, skills); offline Reflection; Knowledge Wiki; **Markdown is the truth**, Git-versionable | Keyword; hybrid with an embedder; agentic with a reranker | Profiles and wiki > episodes > raw | `everos-mcp` for Claude Code, Codex; Hermes, OpenClaw; Claude Code plugin | OpenRouter by default, `base_url` configurable | Python 3.12, Markdown plus SQLite plus LanceDB, a watcher re-indexes hand edits | Apache-2.0; v1.4.2, 2026-10-14; 13.5k stars |
| OpenClaw memory-core plus [lossless-claw](https://github.com/Martian-Engineering/lossless-claw) | Markdown memory with dreaming; LCM keeps every message and a summary DAG | FTS5 plus sqlite-vec; `lcm_grep`, `lcm_describe`, `lcm_expand_query` | Summaries by depth > fresh tail of 64 raw messages > expand to source | OpenClaw only | OpenClaw's providers | TS, SQLite | MIT; OpenClaw v2026.10.4; lossless-claw v1.1.1, 2026-09-28 |
| Hermes built-in, providers, [hermes-lcm](https://github.com/stephenschoettler/hermes-lcm) | Bounded MEMORY.md and USER.md, FTS5 session search; one external provider of nine (Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, Supermemory, Memori); hermes-lcm ports LCM | Provider-dependent | Built-in block always active, provider "additive" | Hermes only | Any | Python | MIT; Hermes v0.22.2; hermes-lcm v0.20.0, 2026-07-24, 1.3k stars |
| [MemPalace](https://github.com/MemPalace/mempalace) | Verbatim text in wings, rooms and drawers; temporal KG with validity windows in SQLite | Vectors (ChromaDB default, pluggable) | `wake-up` context | MCP (47 tools); hooks for Claude Code, Codex, Cursor | No LLM required | Python, local | MIT; v3.11.0, 2026-10-14; 59.6k stars |
| [agentmemory](https://github.com/rohitg00/agentmemory) | Working, episodic, semantic, procedural tiers; supersession, decay, provenance | BM25 always, vectors optional, graph; RRF | Session-start injection within 2,000 tokens | Native plugins for Claude Code, Codex, OpenCode, OpenClaw, Hermes, pi; MCP and REST | Keyless by default, local MiniLM | Node 20 on the "iii engine", SQLite; a server on port 3111 | Apache-2.0; 29.6k stars, pushed 2026-10-16 |

Covered in `4-memory.md` and unchanged on these priorities:

- **cognee**: graph plus vectors, ontology grounding, MCP, Python;
  Apache-2.0, v1.6.5.
- **MemOS**: a graph server on Neo4j and Qdrant, or a Node and SQLite plugin
  for OpenClaw and Hermes; Apache-2.0, v2.0.34.
- **memU**: distils skill Markdown; the licence file is Apache-2.0 though
  GitHub shows NOASSERTION; v1.5.1, 2026-03-23.
- **LongMemory**: TS in-process, immutable entries; GitHub release v1.2.3 is
  from 2025-12.
- **Basic Memory**: Markdown truth, FTS plus vector, MCP; AGPL-3.0.
- **memsearch**: Markdown truth with a Milvus shadow index; MIT.
- **qmd**: hybrid search with local GGUF models, a library in Bun, MCP; MIT,
  v2.8.3.
- **supermemory**: its engine is closed, so it fails priority 1.

Others seen but not assessed: Memorix (Apache-2.0, TS, 844 stars), Open
Second Brain (MIT, Obsidian vault, deterministic dream pass), MemMachine
(Apache-2.0, v0.4.0), and closed or new services whose benchmark claims
circulate (Exabase, ByteRover, past.dev, SurrealDB Agent Memory, Engram,
Mnemon) ([Honcho docs PR](https://github.com/plastic-labs/honcho/pull/1311)).

### Scores (1 to 5, my judgement)

Compatibility is clients, providers and open formats; Access is retrieval
quality, multi-client server mode and inspectability; Disclosure is layering
with drill-down; Persistence is history, backup and loss.

| System | Compat | Access | Disclosure | Persist | Notes |
| --- | --- | --- | --- | --- | --- |
| Hindsight | 4 | **5** | 4 | 3 | Best-evidenced retrieval; Postgres is opaque, but documents are kept and the bank can be re-derived |
| OpenViking | 4 | 4 | **5** | 3 | The cleanest L0/L1/L2 model; AGPL plus odd terms, and a VLM dependency |
| EverOS | 4 | 4 | 4 | **4** | Markdown truth with hybrid search and reflection; no published scores of its own on the README, and a disputed LoCoMo history |
| Graphiti | 3 | 4 | 3 | 4 | Only true temporal invalidation; graph DB to run; structured-output fragile |
| Honcho | 4 | 4 | 3 | 3 | Strong published numbers across all three benchmarks; heavy stack; AGPL |
| agentmemory | **5** | 4 | 3 | 3 | Widest native harness coverage, TS; young, self-reported, on a niche engine |
| Letta MemFS | 2 | 3 | 4 | 4 | Excellent files and git, but only inside Letta's harness |
| Mastra OM | 2 | 4 | 3 | 3 | Top LongMemEval; framework-bound; drops raw messages from context |
| lossless-claw / hermes-lcm | 1 | 3 | **5** | **5** | Lossless DAG with drill-down, but each is one harness's context engine |
| mem0 OSS | 3 | 3 | 1 | 2 | Flat facts; local MCP gone |
| MemPalace | 4 | 3 | 2 | 4 | Verbatim and local; benchmark claims discredited (section 3) |
| qmd | 4 | 3 | 1 | 4 | Retrieval engine only, but runs in Bun with no remote model |
| Basic Memory, memsearch | 4 | 3 | 2 | 4 | Markdown truth plus hybrid index; no extraction or layers |
| cognee, MemOS, memU, LongMemory | 3 | 3 | 2 | 2 | Credible but no edge on these priorities |
| supermemory | 3 | 4 | 3 | 1 | Engine closed; ruled out on priority 1 |
| **Dorothy today** | 3 | 2 | 3 | **5** | MCP and open files, but one machine, lexical only, no user model |

## 3. Published benchmark results

Nearly every number below is vendor-reported, and the answering model,
judge, prompt and budget differ between rows, so rows are not comparable
with each other.

### Results

| System | Benchmark | Score | Models | Source, date | Who |
| --- | --- | --- | --- | --- | --- |
| Mastra OM | LongMemEval-S | 94.87% | actor gpt-5-mini; observer gemini-2.5-flash; judge gpt-4o | [Mastra](https://mastra.ai/research/observational-memory), 2026-02-09 | Vendor |
| Mastra OM | LongMemEval-S | 84.23% (KU 85.9, MS 79.7, TR 85.7) | actor gpt-4o | same | Vendor |
| Hindsight | LongMemEval-S | 91.4%; 89.0%; 83.6% | gemini-3-pro-preview; GPT-OSS-120B; GPT-OSS-20B (full context with 20B: 39.0%) | [arXiv 2512.12818](https://arxiv.org/pdf/2512.12818), Dec 2025; via [Mastra table](https://mastra.ai/research/observational-memory) | Vendor; README says Virginia Tech and The Washington Post reproduced it (not checked) |
| Honcho | LongMemEval-S | 90.4% (92.6% with gemini-3-pro); Haiku 4.5 alone 62.6% | deriver gemini-2.5-flash-lite; dreamer and dialectic claude-haiku-4.5 | [honcho.dev/evals](https://honcho.dev/evals/), 2026 | Vendor |
| mem0 (new algorithm) | LongMemEval | 94.4%, about 7k tokens a query | not stated | [mem0 research](https://mem0.ai/research), Apr to Oct 2026 | Vendor |
| Supermemory | LongMemEval-S | 85.2%; 81.6% | gemini-3-pro-preview; gpt-4o | via [Mastra table](https://mastra.ai/research/observational-memory) | Vendor |
| Zep | LongMemEval-S | 71.2% | gpt-4o | via [mem0 benchmarks page](https://mem0.ai/library/agent-memory/ai-memory-benchmarks-in-2026) | Zep and one academic comparison agree |
| Full context | LongMemEval-S | 60.2% | gpt-4o | via Mastra table | Baseline |
| agentmemory | LongMemEval-S retrieval | R@5 95.2%; **BM25 only 86.2%** | retrieval, no reader | [README](https://github.com/rohitg00/agentmemory) | Vendor |
| MemPalace | LongMemEval-S retrieval | R@5 96.6% raw | no LLM | [README](https://github.com/MemPalace/mempalace) | Vendor; earlier "500/500" and "100% LoCoMo" claims were teaching to the test ([essay](https://essays.bloo-mind.ai/posts/2026-05-20-mem-eval/)) |
| Honcho | LoCoMo | 89.9% | as above | [honcho.dev/evals](https://honcho.dev/evals/) | Vendor |
| mem0 | LoCoMo | 92.5% (old algorithm 71.4) | not stated | [mem0 research](https://mem0.ai/research) | Vendor |
| Zep | LoCoMo | claimed 84%, corrected to 75.14% ± 0.17; mem0's rerun 58.44% ± 0.20 | gpt-4o-mini era | [Zep post](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/), May 2025 | **Disputed** |
| Letta (files plus grep) | LoCoMo | 74.0% | gpt-4o-mini | Aug 2025, via [essay](https://essays.bloo-mind.ai/posts/2026-05-20-mem-eval/) | Vendor |
| EverMemOS | LoCoMo | 92.3% official; a user's run 38.38% | user: gpt-4.1-mini, Qwen3 embed and rerank | [issue #73](https://github.com/EverMind-AI/EverOS/issues/73), 2026-02-05, closed | **Disputed** |
| OpenViking | LoCoMo | Claude Code 57.21% to 80.32%; OpenClaw 24.20% to 82.08%; Hermes 33.38% to 82.86% | Doubao 2.0 Pro, Doubao embedding | [README](https://github.com/volcengine/OpenViking), v0.3.22 | Vendor |
| Hindsight | BEAM | 10M 64.1%; 1M 73.9% (strict 48.4%); 500K 71.1% | not checked | [blog](https://hindsight.vectorize.io/blog/2026/04/02/beam-sota), 2026-04-02; strict from [SurrealDB](https://surrealdb.com/blog/agent-memory-benchmarks-are-baked) | Vendor; **harness put BEAM metadata in the answer prompt** (SurrealDB) |
| Honcho | BEAM | 100K 0.630; 500K 0.646; 1M 0.618; 10M 0.409 | as above | [honcho.dev/evals](https://honcho.dev/evals/) | Vendor |
| mem0 | BEAM | 1M 64.1 (60.4 at 50 memories, strict 40.1); 10M 48.6 | not stated | [mem0 page](https://mem0.ai/library/agent-memory/ai-memory-benchmarks-in-2026); SurrealDB | Vendor |

### Known disputes and weaknesses

- **LoCoMo is weak evidence.** Conversations average about 9k tokens; a
  Penfield Labs audit found 99 wrong answers in 1,540 questions (6.4%), so the
  ceiling is about 93.6%; GPT-4o-mini as judge accepted 62.81% of deliberately
  wrong but on-topic answers; category 5 is usually dropped; full context
  (about 73%) beat mem0's then best (about 68%)
  ([essay](https://essays.bloo-mind.ai/posts/2026-05-20-mem-eval/)). Scores
  above about 93% are suspect.
- **Zep against mem0**: Zep's 84% counted category 5 in the numerator only;
  corrected to 75.14%; mem0 measured 58.44% on Zep's own pipeline. Unsettled
  ([Zep](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)).
- **BEAM harnesses leak**: Hindsight's April 2026 harness and Exabase's prompt
  put BEAM metadata into the answering prompt; Hindsight, Exabase and cognee
  pick prompts by question category; strict scores fall 20 to 27 points below
  headline means
  ([SurrealDB](https://surrealdb.com/blog/agent-memory-benchmarks-are-baked),
  2026-10-14, a competitor).
- **LongMemEval-S now fits in a frontier context** (about 115k tokens), so it
  measures selection more than scale; only BEAM 1M and 10M exceed any window.
- **Retrieval recall is not QA accuracy** (MemPalace, agentmemory).

### Which benchmarks speak to the four priorities

| Priority | Best proxy | Gap |
| --- | --- | --- |
| Compatibility | None | Must be judged from integrations and formats |
| Access: retrieval | LongMemEval's multi-session, temporal and knowledge-update categories; BEAM 1M and 10M for years of history; evidence recall@k | None of them uses coding-agent sessions or tool output |
| Access: change | [MemoryAgentBench](https://github.com/HUST-AI-HYZ/MemoryAgentBench) (ICLR 2026) conflict resolution, where "resolving contradictory information over long sequences remains largely unsolved" ([paper](https://arxiv.org/abs/2507.05257v1)) | Few memory products report it |
| Disclosure | Tokens per answer (mem0 reports about 7k; Mastra's cache-stable prefix) | No benchmark scores layering or drill-down |
| Persistence | None | Must be judged from design |

The one generalisable data point for Dorothy: on LongMemEval-S, one system's
BM25-only fallback retrieves the evidence session in the top 5 for 86.2% of
questions against 95.2% hybrid (agentmemory, vendor). Lexical search is not
hopeless, but it leaves about one question in seven without its evidence,
before the reader model even tries.

## 4. Ranking for Dorothy

### The shape every option should take

Whatever wins, keep Dorothy's transcripts (M16), their recording (M15, or
Letta's `trajectory`) and their history and mirror (M1 to M3) as **the
archive**, and treat the provider as a derived, replaceable layer, as the
recall index is today. Two reasons:

- A provider's database is a lossy projection made with today's model. With
  the raw episodes kept, a better model or a different provider is a replay,
  not a migration, and "nothing lost" holds at the archive even if the
  provider consolidates or forgets.
- Raw episodes are the bottom layer of progressive disclosure that every
  provider lacks or keeps opaquely. Dorothy's `open` by phrase and turn stays
  the last drill-down step.

A pipeline that extracts on every turn also removes the worst failure of the
present design for cheap models: Dorothy relies on the chat model choosing
to call `remember`, which Hermes documents models under about 30B parameters
failing to do (`4-memory.md`). Extraction run by the memory system does not
depend on the chat model's judgement.

### 1. Hindsight as a shared service, Dorothy as the archive

- **Use**: `hindsight-api` as a user service on one machine (embedded pg0)
  or a small home server for several devices. One bank, tagged by project and
  source. Every client reaches the same bank through its MCP endpoint
  (`/mcp/{bank_id}/`) or Hindsight's installers for Claude Code, Codex,
  opencode and pi; Hermes through its Hindsight provider. Dorothy's chat
  becomes one more MCP client, or uses the Node client from Bun (Bun
  unverified; it is an HTTP client). A small feeder in `memory` retains each
  conversation as it is recorded, with `document_id` the phrase,
  `update_mode: "append"` and each turn's `at` as `timestamp`
  ([retain API](https://hindsight.vectorize.io/developer/api/retain)).
- **Layers**: mental models (standing answers, read without retrieval) as the
  always-present core, rendered into her frozen block; observations, then
  facts, on recall; the stored document; then Dorothy's `open` on the raw
  transcript.
- **Replaces**: about 8k of 19.1k lines. Recall's query, facts and tags
  (about 2.0k of M4), notes and appraisals (M8, 0.7k), review (M10, 1.0k),
  block and service (M9 and M11, 0.9k), tags (M14, 1.3k), facts (M6, 1.3k)
  and half the commands (0.5k). M1 to M3, M5, M15 and M16 stay; M7 stays
  only if repositories still want `.agents/memory`.
- **Loses**: facts as Markdown truth (they live in Postgres; export not
  verified); the SKOS vocabulary (entities and tags instead); salience from
  appraisals; editable per-conversation notes; the origin trust order
  (Hindsight's Memory Defense redacts secrets but does not rank sources).
  Upsert by `document_id` deletes a document's memories before reprocessing,
  so never-delete holds only at the archive.
- **Why first**: the strongest retrieval evidence across LongMemEval (91.4%,
  and 83.6% with a 20B open model) and BEAM 10M (64.1%, harness disputed);
  MIT; 29 LLM providers including local ones, local embeddings by default;
  the most clients.

### 2. OpenViking as a shared context filesystem

- **Use**: `openviking-server` with MCP or HTTP, and its plugins for Claude
  Code, Codex, OpenCode, pi, OpenClaw and Hermes. Transcripts become L2
  resources, sessions are committed for extraction into Markdown memories,
  and her block is the L0 abstracts of her memories within budget.
- **Layers**: the best defined of any system: L0 abstract, L1 overview, L2
  detail on every node, and directory-scoped retrieval.
- **Replaces**: as Hindsight, about 8k lines; its memories are Markdown,
  so inspection survives better.
- **Loses**: as Hindsight, plus licence friction. It is AGPL-3.0 with added
  terms against "wholesale rewriting" and translation without permission.
  AGPL section 7 lets a recipient drop further restrictions, but that is my
  reading and not legal advice. A VLM is required beside the embedder, the
  defaults favour Doubao, and its only published evidence is LoCoMo on
  Doubao.

### 3. EverOS, if open formats outrank evidence

- **Use**: the `everos` runtime (Python 3.12, Markdown truth with SQLite and
  LanceDB, a watcher re-indexing hand edits) and `everos-mcp` for Claude
  Code and Codex, with Hermes and OpenClaw integrations. Dorothy's history
  could version its Markdown directory just as it versions `facts/`.
- **Layers**: profiles and the Knowledge Wiki, then episodes, then raw. Its
  offline Reflection is the learning loop Dorothy lacks.
- **Replaces**: about 8 to 9k lines; facts and projects map to its Markdown
  more directly than to any database.
- **Loses**: notes, salience and SKOS; and evidence. Its README publishes no
  scores, and its predecessor's LoCoMo 92.3% met a 38.38% user
  reproduction.

### 4. Honcho, if a model of the user matters most

- **Use**: the Honcho server (FastAPI, Postgres with pgvector, Redis) with
  MCP and its Claude Code, OpenCode, OpenClaw and Hermes integrations. Her
  core block is the peer representation; the dialectic endpoint answers
  questions about the user.
- **Why fourth**: the most consistent published results across all three
  benchmarks with cheap models (deriver gemini-2.5-flash-lite), but AGPL, the
  heaviest stack, tool calling required, and representations that are
  rewritten rather than edited by hand.

Graphiti is the only true bi-temporal design (validity windows, automatic
invalidation) and would add temporal reasoning, but it needs a graph
database and is fragile with small models. Hold it in reserve until the
evaluation shows knowledge updates are the gap.

### The cheaper alternative to beat: Dorothy improved

Before adopting a service, test whether the gap is retrieval or extraction:
add hybrid retrieval (`sqlite-vec` inside the existing `bun:sqlite` index, or
`qmd`, which runs in Bun with local GGUF models), let reviews extract facts,
and put the top facts in the block. That is perhaps 1 to 2k new lines (an
estimate), keeps every Dorothy guarantee, and still lacks server mode, a
user model and consolidation.

### Migration of existing data

| Data | Into a provider |
| --- | --- |
| Transcripts (JSONL) | Replayed in time order: one document per conversation (phrase as id), turns appended with their `at`; Claude Code sessions already sit in the same transcripts. Tool events retained as context or skipped. |
| Facts (Markdown) | One retained document each (`fact:<path>`), tagged with type, scope and project; retired facts tagged or skipped. For EverOS or OpenViking, converted to their Markdown. |
| Notes, tags, appraisals | Not migrated: the provider re-derives its own; kept in the archive. Appraised reads become evaluation data (section 5). |
| `.agents/memory` | Keep M7, exporting from the provider, or drop it. |

### Cost of extraction and embedding

Prices from [OpenRouter's model API](https://openrouter.ai/api/v1/models),
fetched today, per million tokens in and out: gpt-oss-20b $0.018/$0.09;
gemini-2.5-flash-lite $0.10/$0.40; gpt-oss-120b $0.15/$0.60; deepseek-v3.2
$0.28/$0.42; gemini-2.5-flash $0.30/$2.50; claude-haiku-4.5 $1/$5.
Embeddings: qwen3-embedding-8b $0.01, text-embedding-3-small $0.02, or local
for free (Hindsight's default `bge-small-en-v1.5`).

My assumption: extraction reads each transcript token about twice (prompt and
context) and writes 15%, and consolidation adds 75%. Per million transcript
tokens that gives about $0.45 on flash-lite, $0.70 on gpt-oss-120b, $1.10 on
deepseek-v3.2, $1.70 on gemini-2.5-flash and $4.80 on Haiku 4.5. Embedding
is below $0.05. Dorothy's corpus size was not measured, since the real data
directory is off limits. At 30M tokens of transcripts, a backfill costs about
$15 to $50 on cheap models, and a heavy daily use of 100k tokens a few
dollars a month.

Model warnings:

- Graphiti: "very small models frequently emit JSON that doesn't match the
  requested schema" ([README](https://github.com/getzep/graphiti)).
- Hindsight: weaker self-hosted models break retain and consolidation with
  preambles or invalid JSON; it offers a strict-schema mode
  ([config](https://hindsight.vectorize.io/developer/configuration)).
- Honcho requires tool calling.
- Hindsight's paper reaches 83.6% with GPT-OSS-20B, so 20B-class open models
  look viable for a well-structured pipeline (whether the 20B model also did
  the extraction is unverified). Running 7 to 8B local models for
  writes is not evidenced anywhere I found.

## 5. Proposed evaluation on Dorothy's own data

Not run. Everything works on a **copy** of the data directory, with roots
passed in, as the working rules require.

### The question set

Aim for 250 to 300 questions, 30 to 50 a type, in LongMemEval's types
([paper](https://arxiv.org/abs/2410.10813)), each tied to
evidence (phrase plus turn range, or fact path):

| Type | How to build it from Dorothy's data |
| --- | --- |
| Single-session user and assistant | Sample conversations by source (chat, Claude Code), age and length. A strong model from a family that none of the systems under test uses writes questions with evidence pointers. |
| Preference | From `feedback` and `user` facts, asked indirectly ("suggest how to ..."), so the system must apply the preference, not quote it. |
| Multi-session | Topics spanning several conversations: shared tags in `tags.json`, or shared project ids. |
| Knowledge update | **Ground truth already exists**: retired facts with `retired.why`, and fact revisions in history (`--history`). Ask for the current value. |
| Temporal | From turn `at` times: "what was I working on the week of ...", "which came first". |
| Abstention | Plausible questions on topics never discussed, confirmed absent by a grep over the copy. |
| **Real lookups** | Past `recall` events whose appraisal was `useful` or `essential` give real queries with known targets. That is Dorothy's own retrieval ground truth, and unique to her. |

The owner reviews every question and answer. That is the costly part, about
3 to 5 hours at roughly a minute a question.

### Systems, head to head

1. Dorothy as she is: frozen block, then `search` and `open` over MCP. This
   is the baseline.
2. Dorothy improved: the same, plus hybrid retrieval (`sqlite-vec` or `qmd`)
   and top facts in the block. This is the ablation that says whether
   retrieval alone closes the gap.
3. Hindsight, OpenViking, EverOS and Honcho, each fed by replaying the copy
   in time order.
4. Bounds: an agent with only grep over rendered transcripts (Letta's 74%
   lesson), and full context where the evidence fits.
5. Optionally Graphiti, if knowledge updates turn out weak.

Hold these constant:

- one answering model for every system, run twice: once open and cheap
  (gpt-oss-120b or deepseek-v3.2) and once frontier;
- one ingest model, plus a second, smaller one (gpt-oss-20b or a local
  Qwen3-30B-A3B) to measure how writes degrade;
- the same budget for retrieved context (4k and 16k tokens);
- the same agentic allowance (MCP tools, at most 5 calls);
- no question type disclosed to any prompt, which avoids the BEAM leak.

### Metrics

- **Accuracy by type**, with LongMemEval's type-specific judge prompts. The
  judge comes from a third model family. Report strict and lenient scores,
  and the owner hand-checks 20%, because judges are lenient (62.81% of wrong
  on-topic answers were accepted on LoCoMo).
- **Evidence recall@5 and @10**, mapping each system's returned items to a
  phrase and turn. This separates retrieval from reading.
- Abstention precision, and the rate at which a superseded fact is stated.
- Context tokens per answer, p50 and p95 latency, and ingest cost and time.
- The write failure rate (schema errors, empty extractions) for each ingest
  model.
- Two checks marked pass or fail by the owner:
  - **Correction**: find a wrong memory and fix it, and the fix survives
    re-ingest.
  - **Reach**: two clients write concurrently, and a second machine reads
    what they wrote.
- Run each configuration three times and report the spread.

### Rough cost

- **Ingest**: corpus tokens times $0.45 to $1.70 a million (section 4). For
  each system, that is two ingest models; for 30M tokens and four systems,
  about $100 to $400. A 5M-token sample cuts this to $20 to $70.
- **Answers**: 300 questions, 7 systems, 2 answering models and 3 runs come
  to about 12,600 answers. At about 10k tokens each, that is about 126M
  input tokens: about $20 to $35 on the cheap models, and more on a frontier
  one (about $125 at Haiku 4.5's $1 a million).
- **Judging**: about 12,600 judgements at about 1.5k tokens each, so $5 to
  $20.
- **People**: about 2 days to write adapters and the harness, and 3 to 5
  hours of the owner's review.
- All of these are estimates.

As a public anchor, run Dorothy's search alone (no reviews, so no notes) on
LongMemEval-S and report evidence recall@5, to place the baseline beside
the published 86.2% BM25 and 95.2% hybrid figures. This costs only answer
and judge calls.

Decision rule (my proposal): adopt a provider only if it beats the improved
Dorothy by at least 10 points on strict accuracy over Dorothy's own questions
(the essay's threshold), passes both checks, and holds up on the smaller
ingest model.

## Not verified

- Hindsight: Bun compatibility of its Node client; its export and delete
  APIs; how mental models stay current; an OpenClaw integration; whether the
  20B result used the 20B model for extraction; the claimed independent
  reproductions.
- Whether mem0's scored algorithm is fully in the open-source library.
- OpenViking: its storage backend; generic OpenAI-compatible endpoints; the
  legal effect of its added licence terms.
- EverOS: published benchmark scores; how issue #73 was resolved.
- MemOS's layers; LongMemory's layers.
- Graphiti's MCP server with FalkorDB Lite.
- Mastra OM outside Mastra agents.
- My line counts by share (section 1) and the lines replaced (section 4).
- Every cost figure, which assumes token ratios and does not know the size
  of Dorothy's corpus.
- Vendor scores generally; only the Zep, mem0, EverMemOS and MemPalace
  disputes were checked, and only through secondary sources.
