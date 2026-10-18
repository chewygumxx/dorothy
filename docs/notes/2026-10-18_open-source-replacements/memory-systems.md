---
ctime: 2026-10-18
mtime: 2026-10-18
spdx: GPL-3.0-only
title: "Could existing software replace Dorothy's memory code? (2026-10-18)"
description: >-
  The first pass on memory: which systems could replace Dorothy's memory
  code, judged by parity with her design.
tags:
  - dorothy
  - memory
  - notes
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-10-18_open-source-replacements/memory-systems.md
   -
   -->

# Could existing software replace Dorothy's memory code? (2026-10-18)

A research agent's report, kept as it was written apart from its line
wrapping, its em dashes and this header, for the
[note on open-source replacements](../2026-10-18_open-source-replacements.md).

It judged candidates by whether they reproduce Dorothy's design rather
than by its quality, and on that question
[the second pass](./memory-architectures.md) supersedes it.

Read-only research. Nothing in the repo was changed. Repository facts (licence,
language, latest release, last push, archived) come from `gh api repos/<x>` and
`/releases/latest` run today, and npm versions from registry.npmjs.org.
Everything else is cited inline. "(unverified)" marks what I could not confirm.
Line counts are `wc -l` of non-test `.ts` files in
`/home/chewygumxx/dev/dorothy/packages/memory/src`.

## Bottom line

- **Nothing replaces Dorothy's memory as a drop-in.** Two rules rule most
  candidates out:
  - "Nothing is forgotten": Hermes removes entries, OpenClaw's `forget` deletes
    rows, supermemory forgets expired facts on its own, and Honcho rewrites its
    representations.
  - Readable files over an opaque database: mem0, Graphiti, Honcho, Hindsight,
    cognee and claude-mem all keep memory in a database.
- **Letta Code (local backend) is the only single package close to the whole
  design.** It has Markdown and frontmatter memory in git, always-present memory
  files, background "dreaming", skills, and learning from Claude Code and Codex
  sessions. It is provider-neutral, Apache-2.0 and TypeScript. But it is an
  agent harness: adopting it means Dorothy becomes a Letta agent, not that her
  memory gets a backend.
- **The realistic saving is in commodity parts:**
  - session parsing for many harnesses (Letta's `trajectory`);
  - the search engine, once FTS5 falls short (`sqlite-vec` or `qmd`);
  - the encrypted mirror (`git-remote-gcrypt` or `restic`).
- **That saves roughly 3 to 5k of the 19.9k lines (my estimate).** The rest is
  Dorothy-specific behaviour: user-correctable notes, salience fed by how useful
  past lookups were, the SKOS vocabulary, cluster compaction with verbatim
  recollect, facts that are retired rather than deleted, and two-way project
  sync. No open-source project does these under a never-delete rule.

## What changed since the 2026-10-15 note

- **Letta's Python server is retired.** Its README says current source "lives in
  `letta-ai/letta-code`" and the V1 server is on an `archive` branch
  ([letta](https://github.com/letta-ai/letta)).
- **mem0 dropped its local MCP server.**
  - OpenMemory was removed from the monorepo on 2026-07-29
    ([contextbolt](https://contextbolt.com/blog/mem0-mcp/); the `openmemory/`
    path now returns 404).
  - `mem0-mcp` was archived on 2026-03-24
    ([repo](https://github.com/mem0ai/mem0-mcp)).
  - MCP is now hosted only.
- **OpenClaw retired the QMD backend in 2026.8.1** ("builtin is the only memory
  engine",
  [memory-builtin.md](https://github.com/openclaw/openclaw/blob/main/docs/concepts/memory-builtin.md),
  [release
  notes](https://github.com/openclaw/openclaw/blob/main/docs/releases/2026.8.1/memory.md)).
- **supermemory's engine is closed.** Its server "is built from a separate,
  non-public codebase"
  ([self-hosting](https://supermemory.ai/docs/self-hosting/overview)). Only the
  SDKs, MCP server and clients are MIT.
- **cass is not open source in the OSI sense.** Its "MIT License (with
  OpenAI/Anthropic Rider)" grants no rights to OpenAI or Anthropic and forbids
  making the software available "to or for" them
  ([LICENSE](https://github.com/Dicklesworthstone/coding_agent_session_search/blob/main/LICENSE)).
  That is incompatible with GPL and risky while Dorothy runs inside Claude Code.
- **Kuzu is archived** (last release v0.11.3, 2025-10-10,
  [kuzudb/kuzu](https://github.com/kuzudb/kuzu)). Graphiti deprecates it, and
  cognee defaults to the Ladybug fork.
- **Dormant:** LangMem (last PyPI 0.0.30 on 2025-10-27, only dependency bumps
  since; [repo](https://github.com/langchain-ai/langmem),
  [PyPI](https://pypi.org/project/langmem/)) and Memobase (last commit
  2026-01-11, [repo](https://github.com/memodb-io/memobase)).
- **Archived:** byterover-cli, formerly Cipher
  ([repo](https://github.com/campfirein/byterover-cli)).
- **New and relevant:**
  - **Letta `trajectory`**: one TypeScript API that normalises session formats
    from 15 sources (Claude Code, Codex, OpenCode, pi, OpenClaw, Hermes, Gemini
    CLI, Cursor and others) ([repo](https://github.com/letta-ai/trajectory)).
  - **Hindsight 1.0**: MIT, 2026-10-13
    ([repo](https://github.com/vectorize-io/hindsight)).
  - **LongMemory**: CaviraOSS's "OpenMemory", renamed; a TypeScript engine with
    "immutable memory" ([repo](https://github.com/CaviraOSS/LongMemory)).

## Memory systems

"Embeds in Bun" means it can run in-process; "service" means a separate process.

| System | Licence | Runtime / embeds in Bun? | Latest | LLM / embedding providers | Model and retrieval | Deletes or overwrites? | Storage | MCP, clients, import |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [Letta Code](https://github.com/letta-ai/letta-code) | Apache-2.0 | TS harness, Node ≥22.19; local backend embedded, no account ([local mode](https://docs.letta.com/letta-agent/local-mode)); Bun unverified | v0.34.16, 2026-10-16; very active | Ollama, LM Studio, llama.cpp, OpenRouter, any OpenAI-compatible endpoint with tool calling ([providers](https://docs.letta.com/guides/server/providers/openai-proxy/)) | Memory files and blocks in MemFS; root files in the prompt every turn; dreaming subagents; skills. Local message search is "full-text matching only" ([MemFS](https://docs.letta.com/letta-code/memfs)) | Agent rewrites files; every edit is a git commit | Markdown, frontmatter, git; local backups are "your responsibility" | `/init` learns from Claude Code and Codex sessions ([blog](https://www.letta.com/blog/context-repositories/)); MemFS can push to your own git remote |
| [mem0](https://github.com/mem0ai/mem0) | Apache-2.0 | Python, or TS `mem0ai/oss` in-process: in-memory vectors, SQLite history ([quickstart](https://docs.mem0.ai/open-source/node-quickstart)). Uses `better-sqlite3`, so Bun unverified | Node SDK 3.3.1, 2026-09-25 | TS adapters include openai (base URL), lmstudio, vllm, litellm, ollama, anthropic, deepseek ([src](https://github.com/mem0ai/mem0/tree/main/mem0-ts/src/oss/src/llms)) | Extracted facts, vector search; graph memory is Platform-only in OSS ([config](https://docs.mem0.ai/open-source/configuration)) | Pipeline is "ADD-only"; explicit delete API; `expiration_date` ([add](https://docs.mem0.ai/core-concepts/memory-operations/add)) | Opaque DB | Local MCP gone; hosted only |
| [Graphiti](https://github.com/getzep/graphiti) | Apache-2.0 | Python ≥3.10 plus Neo4j, FalkorDB (embedded Lite needs Python 3.12+) or Neptune: a service | v0.31.1, 2026-10-15 | OpenAI by default; Anthropic, Gemini, Groq; OpenAI-compatible including OpenRouter, Ollama, vLLM, llama.cpp; "works best" with structured output | Episodes become a bi-temporal knowledge graph; vector, BM25 and graph retrieval | Facts are "invalidated, not deleted" | Graph DB | MCP server (Docker plus Neo4j) |
| [Basic Memory](https://github.com/basicmachines-co/basic-memory) | AGPL-3.0 | Python ≥3.12 via `uv`; MCP process | v0.23.2, 2026-08-25 | No LLM needed; FastEmbed local embeddings; optional LiteLLM reranker | Markdown entities with observations, `[[relations]]` and frontmatter; FTS plus vector hybrid on SQLite or Postgres | Only explicit edits or deletes | **Markdown is the truth**; "just files plus a local SQLite index" | MCP to any client; importers for Claude conversations and projects, ChatGPT, memory.json ([importers](https://github.com/basicmachines-co/basic-memory/tree/main/src/basic_memory/importers)) |
| [claude-mem](https://github.com/thedotmack/claude-mem) | Apache-2.0 (changed from AGPL) | Bun worker plus hooks; SQLite FTS5 and Chroma | v14.0.1, 2026-10-17 | Hosted "CMEM Pro" observer (default, trial), OpenRouter, Gemini, or your Anthropic plan | Observations per tool use plus session summaries; hybrid search | Unverified | Opaque SQLite | 4 MCP tools; Claude Code, Codex, OpenCode, Cursor, T3, OpenClaw |
| [obra/episodic-memory](https://github.com/obra/episodic-memory) | MIT | Node CLI plus MCP; SQLite and sqlite-vec | v1.6.0, 2026-09-08 | Local Transformers.js embeddings. Summaries only through Claude (Anthropic-compatible endpoint or Bedrock) or Codex; skippable with `EPISODIC_MEMORY_SKIP_SUMMARIES` | Archived transcripts; semantic search; summaries are display-only | Copies transcripts into its own archive | JSONL archive plus SQLite | Claude Code, Codex, Cursor, opencode, OMP |
| [cass](https://github.com/Dicklesworthstone/coding_agent_session_search) | MIT **plus anti-OpenAI/Anthropic rider** | Rust binary; `--robot` JSON mode; no own MCP server in README | v0.10.0, 2026-10-02 | None; MiniLM local, opt-in | Sessions from about 34 harnesses; Tantivy BM25 plus optional hybrid | SQLite is the truth; indexes are derived | SQLite | CLI for agents |
| [cognee](https://github.com/topoteretes/cognee) | Apache-2.0 | Python 3.10 to 3.14, embedded SQLite, LanceDB and Ladybug ([config](https://docs.cognee.ai/setup-configuration/overview)). The Rust core has a Node binding, `@cognee/cognee-ts` 0.2.0, early ([TS](https://docs.cognee.ai/typescript/getting-started)) | v1.6.5, 2026-10-16 | OpenAI by default; Anthropic, Gemini, Ollama, llama.cpp, Bedrock, custom OpenAI-compatible | Knowledge graph plus vectors; **OWL/RDF ontology grounding** ([ontologies](https://docs.cognee.ai/core-concepts/further-concepts/ontologies)) | `forget` deletes | Opaque | MCP via Docker; OpenClaw plugin |
| [memU](https://github.com/NevaMind-AI/memU) | Apache-2.0 | Python with an npm launcher; SQLite or Postgres | Tag v2.0.0-beta.0, 2026-07-23 | Embeddings: openai, jina, voyage, doubao, openrouter; the host agent writes the content | Session logs distilled into memory and **skill Markdown**; cosine search | Unverified | Markdown plus DB | Adapters for Claude Code, Codex, Cursor, OpenClaw, Hermes |
| [Honcho](https://github.com/plastic-labs/honcho) | AGPL-3.0 server, Apache-2.0 SDKs | FastAPI, Postgres with pgvector, Redis; `honcho start` uses Docker | v3.3.0, 2026-10-14 | OpenAI by default; OpenAI-compatible base URL per feature (OpenRouter, vLLM, Ollama, LiteLLM); "must support tool calling" | Peer representations, conclusions, summaries, dreaming; semantic search | Rewrites representations | Opaque | MCP; Claude Code, OpenCode, OpenClaw, Hermes |
| [MemOS](https://github.com/MemTensor/MemOS) | Apache-2.0; local plugin MIT | Server: Python, Neo4j, Qdrant. Local plugin: Node and SQLite | v2.0.34, 2026-09-23; plugin 2.0.20 | Configurable | Graph memory; plugin has FTS5 plus vector and "skill evolution" | Edit and delete API | Opaque | OpenClaw, Hermes, DeepSeek Harness plugins |
| [Mastra memory](https://mastra.ai/docs/memory/overview) | Apache-2.0 outside `ee/` ([LICENSE](https://github.com/mastra-ai/mastra/blob/main/LICENSE.md)) | TS in-process (`@mastra/memory` 1.38.0) plus a storage adapter (LibSQL, PG and others) | 2026-10-15 | 220 providers, OpenRouter, any OpenAI-compatible `url` ([models](https://mastra.ai/models)) | History, working memory, semantic recall, observational memory with Observer and Reflector; a recall tool pages raw messages ([OM](https://mastra.ai/docs/memory/observational-memory)) | Raw messages leave the context, not necessarily storage (unclear) | DB | Framework only; no cross-client sharing |
| [supermemory](https://github.com/supermemoryai/supermemory) | MIT clients; **engine proprietary** | Closed binary or Docker | server-v0.0.9, 2026-10-12 | OpenAI, Anthropic, Gemini, Groq, OpenAI-compatible, Ollama | Facts, profiles, graph | **Auto-forgets expired facts, supersedes contradictions** (README) | Opaque | MCP; Claude Code, Codex, OpenCode, Cursor |
| [Hindsight](https://github.com/vectorize-io/hindsight) | MIT | Python server with embedded Postgres (pg0) or Docker; TS client | v1.0.0, 2026-10-13 | 25+, including ollama, lmstudio, llamacpp, any OpenAI-compatible | World facts, experiences, observations, mental models; semantic, BM25, graph and temporal search with RRF and cross-encoder | Unverified | Opaque | MCP; coding-agent integrations |
| [LongMemory](https://github.com/CaviraOSS/LongMemory) | Apache-2.0 | TS engine in-process (`createMemory`) or HTTP; SQLite | npm 1.3.3, 2026-08-31 | Embeddings via OpenAI-compatible, Gemini, Bedrock, Ollama, local HTTP | Graph-like "Hydrograph"; deterministic decay and reinforcement | **"Immutable memory"**: never rewritten by recall or decay | Opaque SQLite | MCP over stdio or HTTP |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md) | MIT | Python; part of the harness | v0.22.2, 2026-10-15 | Any | Bounded MEMORY.md and USER.md, `session_search` over FTS5, one external provider plugin | `remove` deletes entries | Markdown plus SQLite | 8 provider plugins ([providers](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory-providers.md)) |
| [OpenClaw memory-core](https://github.com/openclaw/openclaw/blob/main/docs/concepts/memory.md) | MIT | TS; part of OpenClaw | v2026.10.4, 2026-10-16 | Embeddings: OpenAI by default; local GGUF, Ollama, LM Studio, generic OpenAI-compatible; or FTS only | Markdown files plus provenance in SQLite; FTS5 and sqlite-vec hybrid; dreaming | `forget` deletes derived rows, not the original conversation | Markdown truth plus SQLite | Imports Codex and Claude Code memory |
| [qmd](https://github.com/tobi/qmd) | MIT | TS for Node **or Bun**; library (`createStore`), CLI, MCP over stdio or HTTP | v2.8.3, 2026-08-16 | **No remote model**: local GGUF via node-llama-cpp | BM25 (FTS5), vectors, query expansion, LLM rerank, frontmatter metadata filters | Read-only index | Your Markdown files | Any MCP client |
| [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) | Apache-2.0 | Python service | v12.1.1, 2026-10-16 | Local ONNX embeddings | Memories, knowledge graph, consolidation | Deletes possible | Opaque | REST and MCP; Claude Code and Codex hooks |
| [memsearch](https://github.com/zilliztech/memsearch) | MIT | Python plus Milvus | v0.4.21, 2026-09-24 | Local ONNX embeddings | **Markdown truth, Milvus "shadow index"**; dense plus BM25 with RRF; 3-layer recall down to the transcript | Unverified | Markdown | Claude Code, Codex, OpenClaw, OpenCode plugins |

Smaller or older entries:

- **Khoj**: AGPL-3.0, Python and Postgres; release 2.0.0-beta.28 (2026-03), last
  commit 2026-08-02; a document assistant rather than a conversational memory
  ([repo](https://github.com/khoj-ai/khoj)).
- **txtai**: Apache-2.0, Python; v9.14.0 (2026-10-06); an embeddings database
  with an MCP API, and its JS binding is only an API client
  ([repo](https://github.com/neuml/txtai)).
- **A-MEM**: MIT research code, last push 2025-12; its "memory evolution"
  rewrites notes ([repo](https://github.com/agiresearch/A-mem)).
- **MemoryOS**: Apache-2.0 research code, release V1.2 (2025-07)
  ([repo](https://github.com/BAI-LAB/MemoryOS)).
- **Memori**: Apache-2.0; its quickstart now needs a Memori Cloud key; v3.3.6
  (2026-05-28) ([repo](https://github.com/MemoriLabs/Memori)).
- **MCP reference memory server**: a knowledge graph in a JSONL file, with
  delete tools
  ([src](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)).

### Provider neutrality

- **Only one candidate hard-requires a particular vendor:** episodic-memory's
  summaries need Claude or Codex, and they can be switched off.
- **Default-hosted but avoidable:** claude-mem (hosted observer by default;
  OpenRouter works) and Memori (Memori Cloud in its quickstart).
- **Fully local is possible with** Letta, Hindsight, Honcho, Graphiti, cognee,
  mem0, Mastra, qmd, Basic Memory, cass and OpenClaw.
- **featherless.ai** is named by no candidate. Anything that takes an
  OpenAI-compatible base URL should work (unverified).
- **Weak or cheap models fail at memory writes:** Hermes' docs warn that models
  "roughly under 30B parameters" often claim a save without calling the tool
  ([memory.md](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md)).
  Honcho and Letta require tool calling, and Graphiti wants structured output.

## Search and storage infrastructure

| Engine | Licence | In Bun? | Latest | Notes |
| --- | --- | --- | --- | --- |
| SQLite FTS5 via [`bun:sqlite`](https://bun.sh/docs/api/sqlite) | Public domain ([sqlite.org](https://sqlite.org/copyright.html)) | Built in | n/a | What Dorothy uses now |
| [sqlite-vec](https://github.com/asg017/sqlite-vec) | MIT or Apache-2.0 | Yes, documented for Bun ([js.md](https://github.com/asg017/sqlite-vec/blob/main/site/using/js.md)) | v0.1.9, 2026-03-31; 0.1.10-alpha.4, 2026-05-18 | One maintainer, slow cadence; used by OpenClaw and episodic-memory |
| [Turso](https://github.com/tursodatabase/turso) | MIT | In-process; JS binding | v0.8.3, 2026-10-12 | SQLite-compatible, with **Tantivy full-text search and a vector index** in one engine; claims production use |
| [LanceDB](https://github.com/lancedb/lancedb) | Apache-2.0 | napi-rs Node SDK; Bun unverified | v0.40.0, 2026-10-07 | Vector, full-text, SQL, versioning. OpenClaw users report native-binary resolution trouble ([issue](https://github.com/openclaw/openclaw/issues/67857)) |
| [Orama](https://github.com/oramasearch/orama) | Apache-2.0 | Pure TS, in-memory | 3.1.18, 2025-12-19 | Full-text, vector, hybrid; slowing |
| [Tantivy](https://github.com/quickwit-oss/tantivy) | MIT | Rust only, no official JS binding | 0.26.1, 2026-05-10 | Reach it through Turso or cass |
| [Meilisearch](https://github.com/meilisearch/meilisearch) | MIT, plus BUSL-1.1 for the enterprise parts | Service | v1.55.0, 2026-10-12 | Hybrid search; too heavy for Dorothy |

## Mapping Dorothy's parts

| Part (lines) | Replaces fully | Replaces partly | Dorothy would lose | Effort |
| --- | --- | --- | --- | --- |
| Transcripts (`transcript.ts` and `scrub.ts`, 600) | Nothing needed; JSONL is already the field's format | `trajectory` as an interchange format | n/a | Keep; maybe emit or accept trajectory |
| Notes and reviews (`sidecar`, `review`, `reviewer`, `scheduler`, `record`, `edit-view`; about 2.3k) | None | Session summaries in claude-mem (Claude Code-centred) and episodic-memory (Claude or Codex only); Mastra observations; Letta dreaming; Honcho summaries | Notes per conversation that the user can correct, pin and hide; review timing; verdicts on lookup usefulness | High, for little gain |
| Salience-ranked block (`rank`, `block`, `service`, `track`; about 760) | None outside a harness | OpenClaw's ranking (30-day half-life, importance, recall frequency), but only inside OpenClaw; Hermes' frozen snapshot; Letta's root files; Mastra working memory | Ranking fed by whether lookups proved useful | Keep (small) |
| SKOS tags (`vocabulary`, `tagging`, `tags-view`; about 1.3k) | None | cognee's OWL grounding (static, Python); Basic Memory's free-form tags; Graphiti's entity types | A vocabulary the model grows, with prefLabel, altLabel, broader and tombstones | Keep, or drop if unused |
| Recall index and MCP (2.7k) | For Markdown facts: qmd (embeds in Bun, hybrid search, MCP). For transcripts: episodic-memory, or cass (licence) | Basic Memory search; Letta message search (FTS only locally) | The `open`, `tags`, `recollect` and `remember` semantics; JSONL as the indexed truth. qmd indexes Markdown, so transcripts would need rendering | Medium: swap the engine, keep the tool layer |
| Compaction (1.8k) | Mastra observational memory in retrieval mode, but only by adopting Mastra's agent and storage | Letta's dreaming triggered by compaction | Topical clusters; verbatim recollect by cluster; Dorothy's own transcripts as truth | High |
| Facts (1.3k) | Basic Memory; Letta MemFS (same Markdown and frontmatter shape, git) | LongMemory, Hindsight, mem0, Graphiti (all opaque) | Closed-set provenance, retire-not-delete, personal or project scope (Basic Memory keeping custom frontmatter is unverified) | Medium; Basic Memory is a Python service and AGPL |
| Project sync (1.3k) | None | Codex's `/import` brings project memories over one way from Claude Code ([post](https://codex.danielvaughan.com/2026/07/24/codex-cli-v0145-import-command-cursor-claude-code-migration-mcp-servers-memories-settings/)); claude-mem imports native memory one way; Letta pushes all of MemFS to a git remote | Two-way sync in Claude Code's format | Keep; worth less if Claude Code is abandoned |
| History and encrypted mirror (3.1k) | git plus [git-remote-gcrypt](https://github.com/spwhitton/git-remote-gcrypt) (GPL-3.0, GPG, needs native git), or [restic](https://github.com/restic/restic) (BSD-2, v0.19.1) or [kopia](https://github.com/kopia/kopia) (Apache-2.0) for encrypted snapshots | Letta MemFS git, unencrypted | Dorothy's own AES-GCM bundle format; lint and heal tied to commits | Medium; could remove about half (estimate) |
| Bodies, i.e. Claude Code recording (2.3k) | `trajectory` for parsing (TS, Apache-2.0, 0.4.3); Dorothy keeps the hooks | episodic-memory, cass, claude-mem, memsearch and memU all ingest several harnesses | Claude Code-specific handling; `sourceUuid` deduplication (whether trajectory keeps ids is unverified) | Low to medium, and the most valuable swap if Claude Code is abandoned |

About 1.6k lines (commands, list and preview views, tags and edit views) are
interface code that no backend replaces.

## Recommendation

1. **Keep Dorothy's memory core and buy only the commodity parts:**
   - **`@letta-ai/trajectory`** for Bodies. It frees Dorothy from Claude Code's
     transcript format and gives her OpenCode, Codex, pi, Gemini CLI and others
     at once, which is what the move away from Anthropic needs.
   - **`sqlite-vec`** (stays inside one `bun:sqlite` index) or **`qmd`**
     (in-process in Bun, local GGUF models, no provider dependence, MCP
     included) when FTS5 falls short. Watch Turso as a single engine combining
     SQLite, Tantivy and vectors.
   - **`git-remote-gcrypt` or `restic`** in place of the hand-built sealed
     mirror, if exact AES-GCM bundles are not a requirement.

   Expected saving: roughly 3 to 5k lines (estimate), with no loss of principle.
2. **For the unbuilt learning loop and layers, copy patterns rather than adopt a
   service.**
   - Letta's dreaming and memory files (Apache-2.0, TS, readable).
   - Hermes' bounded layer with a usage header.
   - memU, which distils session logs into skill Markdown.

   If a service is wanted, choose by the never-delete rule:
   - **Graphiti** invalidates facts instead of deleting them, but needs Neo4j or
     FalkorDB.
   - **LongMemory** is immutable with decay, and runs as TypeScript and SQLite.
   - **Hindsight** has the richest learning model, but deletion behaviour is
     unverified and it needs a Python server with Postgres.

   All three keep opaque databases, against the readable-files goal.
3. **Adopt Letta Code wholesale only if Dorothy's identity as her own program no
   longer matters.** It covers memory files, always-present memory, dreaming,
   skills, cross-harness learning and local models. It loses the
   per-conversation notes, salience, SKOS tags, cluster compaction, the
   encrypted mirror and the repository sync, and "never delete" becomes "git
   keeps it".
4. **Worth keeping as Dorothy's own, since nothing open-source does them:**
   - the notes per conversation that the user can correct, pin and hide;
   - salience fed by lookup usefulness;
   - the model-grown SKOS vocabulary;
   - cluster compaction with verbatim `recollect` (Mastra is the only peer, and
     only inside Mastra);
   - facts with origin provenance that are retired, never deleted;
   - two-way `.agents/memory` sync.
5. **Avoid on licence grounds:**
   - cass (the rider is incompatible with GPL);
   - supermemory's engine (proprietary, and it forgets on its own);
   - Meilisearch's BUSL parts.

   AGPL Basic Memory and Honcho are fine as separate MCP or HTTP processes, and
   AGPL can be combined with GPL-3.0.

## Not verified

- Bun compatibility of Letta Code, LanceDB, `mem0ai/oss` (`better-sqlite3`) and
  `hindsight-all`.
- Deletion behaviour in Hindsight, claude-mem and memU.
- Whether Basic Memory keeps custom frontmatter.
- Whether `trajectory` keeps source ids.
- Whether Letta can import external transcripts as conversations.
- featherless.ai with any candidate.
- memsearch's exact Milvus mode.
- My line-saving estimates.
