---
ctime: 2026-10-18
mtime: 2026-10-18
spdx: GPL-3.0-only
title: "LangChain and agent standards, for a protocol-diverse Dorothy (2026-10-18)"
description: >-
  langchain-ai's components, and standards for portable agent definitions,
  personas, skills, protocols and memory, against a protocol-diverse
  Dorothy.
tags:
  - dorothy
  - memory
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-18-protocol-diversity/langchain-and-standards.md
   -
   -->

# LangChain and agent standards, for a protocol-diverse Dorothy (2026-10-18)

A research agent's report, kept as it was written apart from its line
wrapping, its em dashes and this header, for the
[protocol diversity minutes](../2026-10-18-protocol-diversity.md).

Research of 2026-10-18 on the owner's rulings: Dorothy protocol diverse,
her one definition generated into each harness, one memory service for
all, pi excluded, existing packages first. It adds to the
open-source replacements note
(`docs/notes/2026-10-18_open-source-replacements.md`) and the memory
architectures report (`7-memory-architectures.md`) without repeating
them. Stars, licences and dates come from the GitHub API, versions from npm and
PyPI,
downloads from the npm and pypistats APIs, all on that day; features are
each project's own claims from its README, source or docs. Nothing was
installed or run. *Unverified* marks what was not confirmed.

## Bottom line

- LangChain's libraries are MIT, run on Bun and cover OpenAI-compatible
  servers, OpenRouter, DeepSeek, Anthropic and Ollama; nothing in them
  requires LangSmith. Their agent server is Elastic-2.0 with a licence
  key for production self-hosting, and LangSmith is closed.
- For memory, LangChain is a poor fit: the Store is vector-only, has no
  SQLite backend in JS, and its HTTP form (Agent Protocol `/store`) is
  spoken only by LangChain clients; langmem is dormant; the Python MCP
  adapters were archived into `langchain[mcp]`.
- Adopt **openevals** for the memory evaluation; borrow the
  **`createAgent` middleware set** and the deepagents patterns
  (memory files, consolidation on a cron) for her own runtime.
- The definition standards that "compile to many runtimes" (Agent Spec,
  `.af`, MAF YAML, Docker Agent) target frameworks, not harnesses.
- What does reach harnesses: **Agent Skills**, **AGENTS.md**, **MCP**,
  **ACP** and **Agent Plugins** (successor to Open Plugins), each in or
  applying to the Linux Foundation's AAIF, which declined a SOUL.md
  proposal.
- **rulesync** is the generator the owner's design needs: one tree to
  some 45 hosts, all the named ones included, but it leaves persona files
  alone, so the persona writers are Dorothy's to build.
- No memory, persona or session interchange standard has adoption. OKF
  v0.2 is the best shape for her facts; a memory working group was only
  proposed to AAIF on 2026-10-15.

## A. The langchain-ai organisation

The organisation has 266 public repositories
([`gh api
orgs/langchain-ai/repos`](https://api.github.com/orgs/langchain-ai/repos)),
a raw list kept in `raw8-lc-repos.tsv` beside this report. Sorted by stars
the leaders are langchain (148k), langgraph (43k), deepagents (30k),
langchainjs (18k), openwiki (17k), open_deep_research (13k, archived) and
open-swe (11k). Pushed in the last two days: langchain, langchainjs,
langgraph, langgraphjs, deepagents, deepagentsjs, openwiki, open-swe, and a
burst of LangSmith plugins and SDKs. Every OSS library is MIT; the
exceptions that matter are the Python agent server (Elastic-2.0) and
LangSmith (closed). Figures below: stars from the GitHub API, versions and
licences from npm and PyPI, downloads for the last month from
[api.npmjs.org](https://api.npmjs.org/downloads/point/last-month/langchain)
and [pypistats.org](https://pypistats.org/api/packages/langchain/recent),
all taken on 2026-10-18.

### Adoption and activity

| Component | Licence | Lang | Latest | Stars | Downloads/month | State |
| --- | --- | --- | --- | ---: | ---: | --- |
| [langchainjs](https://github.com/langchain-ai/langchainjs) (`langchain`, `@langchain/core`) | MIT | TS | 1.5.18, core 1.2.18 | 18,275 | 12.8M, core 25.4M | Active daily |
| [langchain](https://github.com/langchain-ai/langchain) (Python) | MIT | Py | 1.4.6 (2026-10-14) | 148,006 | 170M | Active daily |
| [langgraphjs](https://github.com/langchain-ai/langgraphjs) (`@langchain/langgraph`) | MIT | TS | 1.5.1 | 3,360 | 15.3M | Active |
| [langgraph](https://github.com/langchain-ai/langgraph) (Python) | MIT | Py | 1.2.16 (2026-10-16) | 43,425 | 44.8M | Active |
| Checkpointers, JS: `-checkpoint-sqlite`, `-postgres`, `-redis`, `-mongodb` | MIT | TS | 1.1.0 | (monorepo) | sqlite 343k, postgres 2.4M | Active |
| [deepagents](https://github.com/langchain-ai/deepagents) (Python) | MIT | Py | 0.7.28 (2026-10-16) | 30,376 | 5.7M | Active, several releases a week |
| [deepagentsjs](https://github.com/langchain-ai/deepagentsjs) (`deepagents`) | MIT | TS | 1.15.1 | 1,609 | 1.5M | Active |
| Deep Agents Code (`deepagents-code`, the former Deep Agents CLI) | MIT | Py | 0.1.86 (2026-10-16) | (in deepagents) | 36k | Active; `deepagents-cli` 0.3.0 left at 2026-08-24 |
| `@langchain/mcp-adapters` | MIT | TS | 2.0.1 | (langchainjs) | 1.2M | Active |
| [langchain-mcp-adapters](https://github.com/langchain-ai/langchain-mcp-adapters) (Python) | MIT | Py | 0.3.2 | 3,651 | 6.2M | **Archived** 2026-09-16, moved into `langchain.mcp` |
| [agent-protocol](https://github.com/langchain-ai/agent-protocol) | MIT | OpenAPI | spec 0.1.6 | 687 | n/a | Maintenance (dependency bumps) |
| [open-agent-platform](https://github.com/langchain-ai/open-agent-platform) | MIT | TS | none | 1,897 | n/a | **Archived**, "deprecated" for LangSmith Agent Builder |
| [langmem](https://github.com/langchain-ai/langmem) | MIT | Py | 0.0.30 (2025-10-27) | 1,708 | 774k | **Dormant**: a year without a release; commits since are dependency bumps |
| [memory-agent](https://github.com/langchain-ai/memory-agent), [-js](https://github.com/langchain-ai/memory-agent-js) | MIT | Py, TS | template | 482, 53 | n/a | Template; [memory-template](https://github.com/langchain-ai/memory-template) archived |
| [openevals](https://github.com/langchain-ai/openevals) | MIT | Py, TS | Py 0.2.0 (2026-04-07), JS 0.2.2 | 1,225 | Py 1.0M, JS 567k | Active |
| [agentevals](https://github.com/langchain-ai/agentevals) | MIT | Py, TS | Py 0.0.9 (2025-07), JS 0.0.7 (2026-03) | 752 | Py 428k, JS 283k | Slowing; its trajectory evaluators now also sit in openevals |
| [langgraph-supervisor-py](https://github.com/langchain-ai/langgraph-supervisor-py) | MIT | Py | 0.0.31 (2025-11) | 1,655 | 568k | **Archived**; JS 1.1.3 (125k) lives on in langgraphjs |
| [langgraph-swarm-py](https://github.com/langchain-ai/langgraph-swarm-py) | MIT | Py | 0.1.0 (2025-12) | 1,580 | 104k | Quiet; JS 1.0.4 (13k) |
| Agent server, Python [`langgraph-api`](https://pypi.org/project/langgraph-api/) | **Elastic-2.0** | Py | 0.16.1 | n/a | 2.1M | Active |
| Agent server, JS [`@langchain/langgraph-api`](https://github.com/langchain-ai/langgraphjs/tree/main/libs/langgraph-api) | MIT | TS | 1.5.4 | n/a | 698k | Active; "In-memory implementation" only |
| LangSmith platform | **Closed** | n/a | n/a | n/a | SDK `langsmith` 29.4M | SDK [repo](https://github.com/langchain-ai/langsmith-sdk) archived 2026-10-16, split into langsmith-python and langsmith-javascript |
| [openwiki](https://github.com/langchain-ai/openwiki) | MIT | TS | 0.7.2 | 17,238 | n/a | New (2026-06), active |

### langchain and langgraph (JS first, as Dorothy is TypeScript)

- **`createAgent`.** LangChain v1's agent is a LangGraph graph with a model
  node, a tool node and middleware hooks (`beforeAgent`, `beforeModel`,
  `wrapModelCall`, `wrapToolCall`, `afterModel`, `afterAgent`). Bun is an
  officially supported runtime, "Requires Bun v1.0.0+"
  ([install](https://docs.langchain.com/oss/javascript/langchain/install)).
- **Middleware, JS, complete list** from
  [`libs/langchain/src/agents/middleware/index.ts`](https://github.com/langchain-ai/langchainjs/tree/main/libs/langchain/src/agents/middleware):
  `summarizationMiddleware`, `contextEditingMiddleware` (clears old tool
  results), `dynamicSystemPromptMiddleware`, `humanInTheLoopMiddleware`
  (`hitl.ts`), `todoListMiddleware`, `llmToolSelectorMiddleware`,
  `providerToolSearchMiddleware`, `modelCallLimitMiddleware`,
  `toolCallLimitMiddleware`, `modelFallbackMiddleware`,
  `modelRetryMiddleware`, `toolRetryMiddleware`, `toolErrorMiddleware`,
  `toolEmulatorMiddleware`, `piiMiddleware`, `piiRedactionMiddleware`,
  and provider-specific `anthropicPromptCachingMiddleware`,
  `bedrockPromptCachingMiddleware` and `openAIModerationMiddleware`.
  Python adds `ShellToolMiddleware` and `FilesystemFileSearchMiddleware`
  and lacks the caching ones in core
  ([`agents/middleware`](https://github.com/langchain-ai/langchain/tree/master/libs/langchain_v1/langchain/agents/middleware)).
  There is no memory middleware: long-term memory is the Store plus tools.
- **Checkpointers** (thread state, time travel, resume): JS ships
  in-memory, SQLite (on `better-sqlite3`, so Bun's native-addon support
  matters; *unverified* under Bun), Postgres, Redis and MongoDB
  ([`langgraphjs/libs`](https://github.com/langchain-ai/langgraphjs/tree/main/libs)).
  The format is LangGraph's own serialised channel state, not a transcript
  any other harness reads.
- **Store** (long-term memory): namespaced JSON items with `put`, `get`,
  `search` and `listNamespaces`. Semantic search is configured by
  `index: { embeddings, dims }` on `InMemoryStore`; `PostgresStore`
  (pgvector), `MongoDBStore` and `RedisStore` persist it
  ([add-memory](https://docs.langchain.com/oss/javascript/langgraph/add-memory)).
  JS has **no SQLite Store**; Python's `SqliteStore` does vector search
  through sqlite-vec
  ([source](https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint-sqlite/langgraph/store/sqlite/base.py)).
  Retrieval is vector only: no lexical or hybrid ranking, no extraction,
  no consolidation, no temporal facts.
- **Providers**, JS packages: `@langchain/openai` 1.6.2 (16.4M; takes a
  `baseURL`, so any OpenAI-compatible server), `@langchain/anthropic`
  1.5.12 (6.3M), `@langchain/openrouter` 0.4.17 (424k),
  `@langchain/deepseek` 1.1.17 (349k), `@langchain/ollama` 1.3.0 (870k),
  plus Groq, xAI, Mistral, Fireworks, Together, Google, AWS and others
  ([`libs/providers`](https://github.com/langchain-ai/langchainjs/tree/main/libs/providers)).
  Python's partners cover the same five
  ([`libs/partners`](https://github.com/langchain-ai/langchain/tree/master/libs/partners)).
- **Vendor tie.** None in the libraries; LangSmith tracing is opt-in by
  environment variable. The tie is to LangChain's own message and state
  types, which spread into whatever uses them.

### deepagents and Deep Agents Code

- `createDeepAgent` is `createAgent` plus planning, a virtual filesystem,
  subagents, summarisation and tool-output offload, `SKILL.md` skills and
  MCP. Memory is files: `memory: ["/memories/AGENTS.md"]` is loaded into
  the prompt, and a `CompositeBackend` routes `/memories/` and `/skills/`
  to a `StoreBackend` namespaced per assistant, user or organisation. The
  docs recommend a separate consolidation agent on a cron for background
  reviews, and thread search for episodic recall
  ([memory](https://docs.langchain.com/oss/javascript/deepagents/memory)).
- The CLI is now **Deep Agents Code** (`dcode`), a Python Claude Code
  analogue for any model
  ([libs/code](https://github.com/langchain-ai/deepagents/tree/main/libs/code)).
- `libs/acp` serves any deep agent over the Agent Client Protocol (npm
  `deepagents-acp` 0.1.36 for JS).
- `libs/talon`, **experimental**: a local host for long-running deep
  agents with WhatsApp, Telegram, Discord and Slack adapters, a cron
  scheduler and MCP from `~/.deepagents/.mcp.json`
  ([talon](https://github.com/langchain-ai/deepagents/tree/main/libs/talon)).
  Python only.
- Tie: none required; the docs steer deployment to LangSmith.

### MCP adapters

`@langchain/mcp-adapters` turns MCP servers' tools, resources and prompts
into LangChain tools. Python's package was archived on 2026-09-16 and
folded into `langchain[mcp]`
([readme](https://github.com/langchain-ai/langchain-mcp-adapters)). It is
a client only: it would let a LangChain-built Dorothy *consume* a memory
server, not serve one.

### Agent Protocol and the agent servers

- [Agent Protocol](https://github.com/langchain-ai/agent-protocol) is an
  OpenAPI spec (0.1.6) for `/threads`, `/runs` (stateless, background,
  streamed), `/agents` introspection and `/store/items`,
  `/store/items/search`, `/store/namespaces`
  ([openapi.json](https://langchain-ai.github.io/agent-protocol/openapi.json)).
  LangSmith Deployment implements "a superset". Other implementations:
  the MIT, in-memory LangGraph.js API, and
  [Aegra](https://github.com/aegra/aegra) (Apache-2.0, 1,264 stars,
  FastAPI and Postgres, "open source alternative to LangGraph Platform").
  Outside LangChain's ecosystem nobody serves it that I found: no
  harness speaks it.
- **What needs a licence.** The Python server `langgraph-api` is
  Elastic-2.0 ([PyPI](https://pypi.org/project/langgraph-api/)); a
  standalone self-hosted server needs `LANGGRAPH_CLOUD_LICENSE_KEY` and
  egress to `beacon.langchain.com` for "license verification and usage
  reporting"
  ([self-host](https://docs.langchain.com/langsmith/deploy-standalone-server)),
  and self-hosted LangSmith is Enterprise only
  ([support](https://support.langchain.com/articles/7011309930-how-do-i-obtain-a-self-hosted-langsmith-license-key)).
  `langgraph dev` and the JS in-memory server are free for development.
- [open-agent-platform](https://github.com/langchain-ai/open-agent-platform)
  is deprecated in favour of LangSmith's hosted Agent Builder;
  [agent-chat-ui](https://github.com/langchain-ai/agent-chat-ui) (3,227
  stars, MIT) remains as a web client for any Agent Protocol server.

### langmem and the memory templates

- [langmem](https://github.com/langchain-ai/langmem): background memory
  managers, prompt optimisation and memory tools over the Store. Python
  only, no release since 2025-10-27, commits since are dependabot
  ([commits](https://github.com/langchain-ai/langmem/commits)). Dormant;
  its downloads are dependents'.
- [memory-agent-js](https://github.com/langchain-ai/memory-agent-js): a
  ReAct agent with one "save memory" tool writing to the Store per user,
  deployed on LangGraph Cloud. A teaching template, weaker than Dorothy's
  `remember` and recall today.

### agentevals and openevals

[openevals](https://github.com/langchain-ai/openevals) gives LLM-as-judge
evaluators with prebuilt prompts for correctness, helpfulness,
**groundedness** and **retrieval relevance**, exact and structured-output
matching, trajectory match (strict, unordered, subset, superset) and
judge, conversation prompts and a **multi-turn simulated user**. Python and
TypeScript; any LangChain chat model as judge. LangSmith is optional: its
pytest and Vitest runners log feedback there, but evaluators are plain
functions
([readme](https://github.com/langchain-ai/openevals#langsmith-integration)).
agentevals is the older trajectory-only companion. Neither ships a memory
benchmark (LoCoMo, LongMemEval) or recall metrics such as recall@k.

### langgraph-supervisor and langgraph-swarm

Hand-off libraries for multi-agent graphs. The Python supervisor is
archived with the advice to build "the supervisor pattern directly via
tools" ([readme](https://github.com/langchain-ai/langgraph-supervisor-py)).
Dorothy has one persona and subagents at most; nothing here she needs.

### LangSmith and its harness plugins

LangSmith (tracing, datasets, evaluation, deployment, Agent Builder) is
closed SaaS with an Enterprise self-host. Its new
[Claude Code](https://github.com/langchain-ai/langsmith-claude-code-plugins)
and [Codex](https://github.com/langchain-ai/langsmith-codex-plugins)
plugins record those harnesses' sessions through their hooks and send them
to `LANGSMITH_ENDPOINT`, with replicas to further endpoints: the pattern
Dorothy's Bodies follow, generalised per harness, but feeding a closed
store.

### openwiki and langchain-skills

- [openwiki](https://github.com/langchain-ai/openwiki) keeps a linked
  Markdown wiki of a codebase or personal knowledge, serves it over MCP,
  installs itself into Codex, Claude Code, OpenCode, Copilot, Cursor,
  Kiro and others, and emits **Google's Open Knowledge Format (OKF)
  v0.2**: Markdown concepts with YAML front matter, provenance and
  verification stamps
  ([readme](https://github.com/langchain-ai/openwiki#open-knowledge-format-okf-v02)).
  Closest thing in the organisation to a portable memory, and an example
  of one tool generated into many hosts.
- [langchain-skills](https://github.com/langchain-ai/langchain-skills):
  `SKILL.md` skills installed by `npx skills`, early development.

### What each would do for Dorothy's layers

| Layer | Best LangChain fit | Verdict |
| --- | --- | --- |
| Her own runtime: chat | `createAgent` with `dynamicSystemPromptMiddleware`, providers, MCP adapters; or `createDeepAgent` | Possible, on Bun; heavy types and a second message model beside her JSONL |
| Background reviews | A separate graph on a schedule, as deepagents' docs recommend | Pattern only; her scheduler already does it |
| Compaction | `summarizationMiddleware` and `contextEditingMiddleware` | Weaker than her topical clusters and `recollect`; borrow the token triggers |
| Memory service | Store with vector index; Agent Protocol `/store` | Avoid: vector-only, no SQLite in JS, only LangChain clients speak `/store` |
| Persona generation | Nothing; deepagents reads `AGENTS.md` memory files | n/a |
| Recording other harnesses | LangSmith plugins | Borrow the hook pattern; avoid the closed sink |
| Evaluation | openevals judges, groundedness and retrieval relevance, multi-turn simulator | Adopt as a library, without LangSmith |

## B. Standards for portable agents, personas and interoperability

The governance picture changed in 2026: the Linux Foundation's Agentic AI
Foundation (AAIF), founded on 2025-12-09 with MCP, goose and AGENTS.md
([LF](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)),
is absorbing the rest. Its
[project proposals](https://github.com/aaif/project-proposals/issues)
show A2A approved (#37, closed 2026-08-04) and agentgateway approved
(#11); Agent Skills (#47), ACP (#1) and Open Responses (#41) TC-approved
with paperwork pending; Agent Plugins (#56) and AGNTCY (#57) under
review; and a SOUL.md proposal **declined** (#15, 2026-05-15). An "Agent
Context and Memory" working group was proposed by Neo4j on 2026-10-15
([#5](https://github.com/aaif/working-group-proposals/issues/5)), with no
comments yet.

### Definition formats that compile one agent to several runtimes

| Standard | Licence, governance | Adoption | Maturity | For Dorothy |
| --- | --- | --- | --- | --- |
| [Letta Agent File](https://github.com/letta-ai/agent-file) (`.af`) | Apache-2.0, Letta | 1,209 stars; read by Letta only; last commit 2026-03-24 | Stalled; roadmap still lacks MCP and archival passages; schema lives in the retired Letta server | Avoid. Borrow the idea of persona and human blocks in one export |
| [Open Agent Spec](https://github.com/oracle/agent-spec) | Apache-2.0 or UPL-1.0, Oracle | 443 stars; `pyagentspec` 14k/month; adapters for LangGraph, AutoGen, CrewAI, OpenAI Agents, Microsoft Agent Framework and Oracle's WayFlow ([adapters](https://github.com/oracle/agent-spec/tree/main/pyagentspec/src/pyagentspec/adapters)) | Release 26.3.1 (2026-09-11); TS SDK `tsagentspec` 0.1.0 in-repo, not on npm (the npm `agentspec` is unrelated) | Compiles to *frameworks*, not to harnesses: no Claude Code, Codex, OpenCode or Hermes target. Avoid as her definition; Python only in practice |
| [Docker Agent](https://github.com/docker/docker-agent) (was cagent) | Apache-2.0, Docker | 4,557 stars; v1.150.0 (2026-10-09); a `docker agent` CLI plugin; ACP agent | Active, weekly releases | Its own runtime with YAML agents, MCP, BM25 and hybrid RAG, OCI distribution. A host, not a format others read |
| [Microsoft Agent Framework](https://github.com/microsoft/agent-framework) declarative agents | MIT, Microsoft | 14,182 stars; python-1.22.0 (2026-10-15); .NET, Python, Go | Active | YAML `kind: Prompt` with `instructions`, `model`, `outputSchema` ([sample](https://github.com/microsoft/agent-framework/tree/main/declarative-agents/agent-samples)). Read by MAF only; no TS |

None of these targets the harnesses Dorothy must reach. They describe
agents for frameworks that execute them; Dorothy needs her persona
written into hosts that already run.

### Persona formats

| Standard | Licence, governance | Adoption | Maturity | For Dorothy |
| --- | --- | --- | --- | --- |
| [elizaOS](https://github.com/elizaOS/eliza) character | MIT, elizaOS | 19,617 stars; read by elizaOS only; the old `characterfile` repo is gone (404) | A TypeScript `Character` type in `@elizaos/core`: `name`, `bio`, `system`, `adjectives`, `topics`, `knowledge`, `messageExamples`, `postExamples`, `style`, `plugins`, no JSON Schema ([docs](https://docs.elizaos.ai/agents/character-interface)) | Borrow field names for voice (`style`, `messageExamples`) |
| Character Card [V2](https://github.com/malfoyslastname/character-card-spec-v2) and [V3](https://github.com/kwaroran/character-card-spec-v3) | V2 unlicensed, V3 MIT; community | 198 and 114 stars; read by [SillyTavern](https://github.com/SillyTavern/SillyTavern) (34,604 stars, AGPL-3.0) and roleplay front ends | Frozen: V2 last pushed 2023-06, V3 2024-07 | The only widely shared persona interchange: `description`, `personality`, `system_prompt`, `post_history_instructions`, `mes_example`, a lorebook. One more export target, not her source |
| `SOUL.md`, OpenClaw | MIT (OpenClaw); a convention | OpenClaw workspace `SOUL.md`, `IDENTITY.md`, `USER.md`, `AGENTS.md`, `MEMORY.md` ([workspace](https://docs.openclaw.ai/concepts/agent-workspace)) | Plain Markdown, no schema | Generator target |
| `SOUL.md`, Hermes | MIT (Hermes); a convention | `SOUL.md` in `HERMES_HOME`, "slot #1 in the system prompt", replacing the default identity ([personality](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/personality.md)) | Plain Markdown | Generator target |
| `SOUL.md` as a spec | Agenturo's YAML-frontmatter variant with a JSON Schema, **declined by AAIF** ([#15](https://github.com/aaif/project-proposals/issues/15)); [aeonfun/soul.md](https://github.com/aeonfun/soul.md) (695 stars, MIT) builds souls from a user's data | Fragmented | Three incompatible meanings of one file name | Do not treat as a standard; write each host's own |

### Instructions, skills and plugins

| Standard | Licence, governance | Adoption | Maturity | For Dorothy |
| --- | --- | --- | --- | --- |
| [AGENTS.md](https://github.com/agentsmd/agents.md) | MIT; AAIF founding project | 24,976 stars; Codex, OpenCode, Cursor, Copilot, goose, Qwen Code and most others; Claude Code reads it since 2.1.277 (2026-09-18) when no `CLAUDE.md` exists ([The Register](https://www.theregister.com/ai-and-ml/2026/09/18/anthropic-decides-to-support-openais-markdown-instructions-spec/5297588), [InfoWorld](https://www.infoworld.com/article/4224410/claude-code-now-also-accepts-instructions-in-openais-agents-md-format.html)) | Stable, free-form | Project instructions, additive. Not a persona slot: hosts append it to their own system prompt |
| [Agent Skills](https://github.com/agentskills/agentskills) (`SKILL.md`) | Apache-2.0; Anthropic-originated, joining AAIF (TC approved, [#47](https://github.com/aaif/project-proposals/issues/47)) | 26,248 stars; client showcase includes Hermes and OpenClaw (commits of 2026-08-09); `npx skills` 23.8M downloads/month ([vercel-labs/skills](https://github.com/vercel-labs/skills)) | Stable; progressive disclosure built in | Adopt: her skills as `SKILL.md`, installed into each host |
| Open Plugins, now [Agent Plugins](https://github.com/agentplugins/agent-plugins-spec) | Spec licence unstated (repo NOASSERTION); a TSC from Amazon, Cursor, Microsoft, OpenAI, Vercel, joined by Google; AAIF review ([#56](https://github.com/aaif/project-proposals/issues/56)) | 1,390 stars; open-plugins.com 308-redirects to [agent-plugins.org](https://agent-plugins.org/); launch clients per secondary sources: ChatGPT, Codex, Cursor, Copilot, Kiro, VS Code ([digitalapplied](https://www.digitalapplied.com/blog/agent-plugins-1-0-open-standard-portable-ai-skills)) | 1.0.0 published, 1.1.0 draft | One package of skills plus `mcp.json`. It explicitly leaves agents, hooks, rules and commands out, so it carries her skills and memory server but not her persona. Claude Code still uses `.claude-plugin/` (*unverified* whether it reads the portable layout) |

### Protocols

| Standard | Licence, governance | Adoption | Maturity | For Dorothy |
| --- | --- | --- | --- | --- |
| [A2A](https://github.com/a2aproject/A2A) | Apache-2.0; LF, approved into AAIF | 26,189 stars; v1.0.1 (2026-05-28); AGNTCY's AgentBridge exposes Claude Code, Copilot, Codex and Cursor over A2A ([#57](https://github.com/aaif/project-proposals/issues/57)) | 1.0 | Agent-to-agent tasks. No memory or persona model. Later, for exposing her as a peer |
| [ACP](https://github.com/agentclientprotocol/agent-client-protocol) (Agent Client Protocol) | Apache-2.0; Zed-originated, joining AAIF ([#1](https://github.com/aaif/project-proposals/issues/1)) | 4,461 stars; v1.12.0 (2026-10-16); 43 agents listed, among them Hermes Agent, OpenClaw, OpenCode, Qwen Code, Gemini CLI, goose, Kimi CLI, Docker's cagent, and Claude and Codex through adapters ([agents](https://agentclientprotocol.com/overview/agents)) | Protocol version 1, stable | Two uses: Dorothy as an ACP agent in any ACP client; and Dorothy as an ACP *client* driving a harness, seeing every message and tool call in `session/update`, a uniform way to record sessions |
| [MCP registry](https://github.com/modelcontextprotocol/registry) | MCP under AAIF; licence NOASSERTION | 7,372 stars; v1.8.1 (2026-08-06) | Live | Publishes her memory server's `server.json` so hosts can find it. Minor |
| MCP and memory | n/a | [SEP Memory Interchange Format](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2342) closed unmerged, told to "get adoption and then bring it back" (its [repo](https://github.com/varun29ankuS/mif-spec) has 5 stars); [SEP-2072 Memory Portals](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2072) went stale; a [memory capability discussion](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/2681) closed | Nothing in the spec | Memory over MCP stays a set of tools each server names itself |
| [Open Responses](https://github.com/openresponses/openresponses) | Apache-2.0; joining AAIF ([#41](https://github.com/aaif/project-proposals/issues/41)) | 1,131 stars | Launched 2026-01, with conformance tests | A vendor-neutral Responses API. One of the three dialects (with Anthropic Messages and Chat Completions) a persona proxy must speak |
| [AGNTCY](https://github.com/agntcy) and [OASF](https://github.com/agntcy/oasf) | Apache-2.0; LF since 2025-07-29, proposed to AAIF | OASF 339 stars, v1.1.0 (2026-07-10); Directory 197 stars | Alive, enterprise-shaped | Records describing MCP servers, A2A agents and skills for discovery. Nothing for a personal assistant |

### Memory and knowledge interchange

- **Google's [Open Knowledge
  Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
  (OKF) v0.2**, Apache-2.0: "a directory of markdown files with YAML
  frontmatter", with optional provenance (`sources`, `verified`), trust
  and lifecycle (`status`, `stale_after`) fields, `index.md` and `log.md`.
  LangChain's openwiki emits it. It is the closest published format to
  Dorothy's facts (Markdown with frontmatter, provenance, retired never
  deleted), and it needs no SDK. Worth adopting as the shape of her facts
  export, while it is young (v0.2) and its adoption beyond Google's
  catalogue and openwiki is *unverified*.
- **[W3C AI Agent Memory Interoperability Community
  Group](https://www.w3.org/community/ai-agent-memory-interop/)**:
  a charter of 2026-06-19 for a memory-cell format, agent identity,
  scoped sharing and cryptographic erasure. A community group, not
  standards track, and by search results largely one author's work
  (*unverified*).
- **[Portable Agent Memory](https://arxiv.org/pdf/2605.11032)** (arXiv,
  2026-05): a research protocol for signed memory export and rehydration.
  No implementation found.
- **AAIF**: memory-engine proposals (Neo4j Agent Memory, Spector) and the
  new working-group proposal; no specification.

No memory or session interchange standard has adoption. Session recording
has no format either. The nearest are ACP's session stream; OpenTelemetry,
where Claude Code can export prompts, replies, tool content and even raw
API bodies (`OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES`,
`OTEL_LOG_RAW_API_BODIES`;
[monitoring](https://code.claude.com/docs/en/monitoring-usage))
while Codex logs prompts and tool results but, by secondary sources, not
reply text ([config](https://developers.openai.com/codex/config-advanced),
[coralogix](https://coralogix.com/docs/integrations/ai-observability/codex-cli/));
and Letta's `trajectory`, noted in the earlier survey.

### Generators: packages that write one definition into many hosts

Not a standard, but the component the owner's first ruling needs:

- [rulesync](https://github.com/dyoshikawa/rulesync) (MIT, 1,530 stars,
  37.1.0, 1.16M npm downloads/month, pushed 2026-10-17) generates rules,
  ignore and permissions, MCP, commands, subagents, skills and hooks from
  one `.rulesync/` tree for some 45 targets, among them Claude Code,
  Codex CLI, OpenCode, Hermes Agent, Qwen Code, Letta Code, goose,
  deepagents-cli, OpenClaw (rules only) and DeepSeek Harness (rules, MCP,
  skills)
  ([readme](https://github.com/dyoshikawa/rulesync#supported-tools-and-features)).
  By design it leaves persona files alone: its OpenClaw writer says
  `SOUL.md`, `IDENTITY.md`, `USER.md` and `MEMORY.md` "are left alone"
  ([source](https://github.com/dyoshikawa/rulesync/blob/main/src/features/rules/openclaw-rule.ts)).
- [Ruler](https://github.com/intellectronica/ruler) (MIT, 2,947 stars,
  308k downloads/month): rules and MCP to many agents; narrower.
- [`npx skills`](https://github.com/vercel-labs/skills) (MIT, 35,393
  stars): skills only, to most hosts.

## C. Findings for Dorothy

### Components worth adopting, by layer

| Layer | Component | Fit | Why |
| --- | --- | --- | --- |
| Definition | Agent Skills (`SKILL.md`) | Adopt | The one cross-host format every target reads, joining AAIF, with progressive disclosure built in |
| Definition | AGENTS.md | Adopt, as output | Every host reads it, Claude Code now too; but it is project instructions appended to a host's prompt, not a persona |
| Definition | OKF v0.2 | Adopt for facts and knowledge export | Markdown with YAML frontmatter, provenance and freshness: her facts already have this shape; Apache-2.0, no SDK |
| Definition | Character Card V3, elizaOS `Character` | Borrow fields | Voice fields (`style`, `messageExamples`, `post_history_instructions`) for her identity source; a card export is optional |
| Definition | Open Agent Spec, Letta `.af`, MAF declarative, Docker Agent YAML | Avoid | They compile to frameworks or one runtime, none to Claude Code, Codex, OpenCode, Hermes or OpenClaw; `.af` is stalled |
| Generators per host | rulesync | Adopt (library or CLI) | MIT, 1.16M downloads a month, programmatic API, targets every host the owner named including Hermes, Qwen Code and DeepSeek Harness, for rules, MCP, skills, subagents, hooks and permissions |
| Generators per host | Agent Plugins 1.0 | Adopt for packaging | One plugin of her skills plus her memory server's `mcp.json` for Codex, Cursor, Copilot and VS Code; Claude Code's own plugin via rulesync's `claudecode-plugin` target |
| Generators per host | `npx skills`, Ruler | Avoid | Subsets of rulesync |
| Generators per host | openwiki | Borrow the pattern | One tool installed into ten hosts, served over MCP, with OKF output |
| Memory service | MCP, served by her memory, listed in the MCP registry | Adopt | The only access protocol every host speaks; the registry is cheap reach |
| Memory service | LangGraph Store, Agent Protocol `/store`, langmem, memory-agent | Avoid | Vector-only, no SQLite Store in JS, only LangChain clients speak `/store`, langmem dormant, the template weaker than her `remember` |
| Memory service | MIF, W3C memory group, Portable Agent Memory | Avoid, watch | No adoption; MCP refused MIF until it has some |
| Recording | Host hooks, as LangSmith's Claude Code and Codex plugins do | Borrow the pattern | Proven per host; rulesync can install the hooks; LangSmith itself is a closed sink |
| Recording | ACP client ([`@agentclientprotocol/sdk`](https://www.npmjs.com/package/@agentclientprotocol/sdk) 1.9.0, Apache-2.0, 30M downloads a month) | Adopt where Dorothy launches the harness | One stream of messages, plans and tool calls from 40-odd agents |
| Recording | OpenTelemetry receiver | Borrow | Full content from Claude Code; partial from Codex |
| Protocol proxy | Her own gateway, generalised; agentgateway or LiteLLM hooks from the gateways report | Borrow | No LangChain part fits; Open Responses names the third dialect beside Messages and Chat Completions |
| Own runtime: chat | Vercel AI SDK (gateways report) or LangChain.js `createAgent` | Borrow the middleware set; prefer the lighter SDK | LangChain.js runs on Bun and covers the five providers, but brings its message and graph state beside her JSONL; its middleware list is a checklist: fallback, retry, call limits, summarisation trigger, context editing, PII redaction, approval |
| Own runtime: harness | deepagentsjs | Borrow; trial only if subagents and a virtual filesystem are wanted | MIT, active, `SKILL.md` and memory files built in; no TUI in JS, LangGraph types throughout |
| Own runtime: reviews, compaction | deepagents' consolidation-agent pattern; `summarizationMiddleware` | Borrow | Her clusters and `recollect` already do more |
| Own runtime: reach | Deep Agents Talon | Borrow the pattern | Channels and cron in one host, but Python and experimental |
| Evaluation | openevals | Adopt | MIT, TypeScript and Python, any judge model, groundedness and retrieval-relevance prompts, trajectory match for memory tool calls, a multi-turn simulated user; LangSmith optional |
| Evaluation | agentevals, LangSmith experiments | Avoid | The first is superseded by openevals; the second is closed |
| Anything | LangGraph Platform, LangSmith Deployment, Open Agent Platform | Avoid | Elastic-2.0 server, licence key and beacon for self-hosting; OAP deprecated |

LangChain's strongest offers to Dorothy are therefore openevals, the
middleware list as a design checklist, and openwiki's example; none of its
memory or server components meets the compatibility priority, because
each serves LangChain clients rather than any client.

### What still has to be bespoke

1. **Her one definition.** No standard holds a persona, voice, skills and
   MCP servers together for harnesses. A small source tree (identity and
   voice in Markdown with frontmatter, `skills/`, an MCP list) laid out
   so rulesync can read most of it.
2. **Persona writers.** rulesync deliberately skips `SOUL.md`,
   `IDENTITY.md` and `USER.md`, and AGENTS.md is the wrong slot. Writers
   for OpenClaw's and Hermes's `SOUL.md`, Codex's
   `model_instructions_file`, an OpenCode agent file and Qwen Code's and
   Claude Code's system-prompt flags are hers to write, ideally as a
   rulesync contribution.
3. **The memory contract.** Tool names, the budgeted memory block per
   host (progressive disclosure), and the export format: MCP gives the
   wire, OKF the file shape, nothing the semantics.
4. **Recorders per harness.** Normalising hooks, transcripts, ACP streams
   or OpenTelemetry into her JSONL archive: one adapter per host; Letta's
   `trajectory` covers part.
5. **The persona proxy.** Additive, marker-based injection that keeps
   cache prefixes stable across three API dialects, as the gateways
   report found nothing does.
6. **The memory evaluation.** Questions from her own archive, recall@k
   and staleness metrics; openevals supplies the judges and the simulated
   user, not the benchmark.

## Not verified

- Whether `@langchain/langgraph-checkpoint-sqlite` (on `better-sqlite3`)
  runs under Bun.
- That `deepagents-cli` is superseded by `deepagents-code`: inferred from
  release dates and the deepagents README, not from a notice.
- Agent Plugins' launch clients (from secondary sources), its licence,
  and whether Claude Code reads the portable layout.
- OKF's adoption beyond Google's catalogue and openwiki.
- The W3C memory group's membership, and the authorship of its charter.
- Codex's OpenTelemetry omitting reply text (secondary sources only).
- Character Card adoption beyond SillyTavern.
- Agent Spec's TypeScript SDK being unpublished: `tsagentspec` declares
  the npm name `agentspec`, which belongs to another project.
- rulesync's output quality per host: its README's table was taken at its
  word; only its OpenClaw and Hermes writers were read.
- LangChain's JS middleware behaviour: names from the index file, not
  from running them.
