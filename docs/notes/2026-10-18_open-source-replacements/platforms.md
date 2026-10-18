---
ctime: 2026-10-18
mtime: 2026-10-18
spdx: GPL-3.0-only
title: "Personal-assistant platforms and chat front ends: replace or host Dorothy?"
description: >-
  Personal-assistant platforms and chat front ends that could replace or
  host Dorothy, and the 2026-10-15 objections revisited.
tags:
  - dorothy
  - notes
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-10-18_open-source-replacements/platforms.md
   -
   -->

# Personal-assistant platforms and chat front ends: replace or host Dorothy?

A research agent's report, kept as it was written apart from its line
wrapping, its em dashes and this header, for the
[note on open-source replacements](../2026-10-18_open-source-replacements.md).

Research date: 2026-10-18. Stars, licences, push dates and releases come from
the GitHub API on that date unless another source is cited. "(unverified)"
marks anything I could not check.

## Bottom line

- **Dropping Anthropic removes the billing objection. The other two objections
  are only partly solved.** Hermes Agent can switch off its built-in memory and
  can write skills to a directory you choose. OpenClaw can swap its memory out
  through an exclusive plugin slot. Neither stops keeping its own transcript
  database.
- **A new hindrance takes the place of Anthropic's metering.** Featherless's
  flat $25 Chat plan is "for interactive, human-driven use by the purchaser"
  and has a 32K context. Hermes needs at least 64K of context for tool use. So
  background reviews and agent work need Featherless's per-token Developer
  plan, or OpenRouter.
- **Shortlist:**
  1. Hermes Agent, to replace Dorothy wholesale.
  2. OpenClaw, to host Dorothy's own TypeScript memory as plugins.
  3. Letta Code, if git-backed Markdown memory matters more than Dorothy's own
     design.
- **Nothing found has Dorothy's** SKOS tags, salience ranking fed by how useful
  past lookups were, facts retired rather than deleted, two-way sync with
  `.agents/memory/`, or an encrypted mirror.

## 1. Platform survey

### Vital statistics

| Platform | Licence | Runtime | Latest release | Stars / last push |
| --- | --- | --- | --- | --- |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | MIT | Python 3.11 to 3.14 ([pyproject](https://github.com/NousResearch/hermes-agent/blob/main/pyproject.toml)), with a TS/Ink TUI | v0.22.2, 2026-10-15 | 255k / 2026-10-17 |
| [OpenClaw](https://github.com/openclaw/openclaw) | MIT | TS, Node 24.16+ or 26.1+ | v2026.10.4, 2026-10-16; betas run daily | 392k / 2026-10-17 |
| [ClawHub](https://github.com/openclaw/clawhub) | MIT | TS | v0.23.3, 2026-08-04 | 9.5k / 2026-10-17 |
| [Letta Code](https://github.com/letta-ai/letta-code) (the [Letta server](https://github.com/letta-ai/letta) is retired) | Apache-2.0 | TS, Node 22.19+ | v0.34.16, 2026-10-16 | 3.6k / 2026-10-17 |
| [nanobot](https://github.com/HKUDS/nanobot) | MIT | Python, TS web UI | v0.3.5, 2026-09-15 | 49k / 2026-10-17 |
| [nanoclaw](https://github.com/nanocoai/nanoclaw) | MIT | TS on Claude Agent SDK | v2026.10.0, 2026-10-09 | 31k / 2026-10-17 |
| [Khoj](https://github.com/khoj-ai/khoj) | AGPL-3.0 | Python | 2.0.0-beta.28, 2026-03-26 | 38k / 2026-08-02 |
| [Agent Zero](https://github.com/agent0ai/agent-zero) | MIT per LICENSE (GitHub shows NOASSERTION) | Python, Docker | v2.14, 2026-10-13 | 19.5k / 2026-10-14 |
| [Leon](https://github.com/leon-ai/leon) | MIT | TS | none; 2.0 Developer Preview | 17.6k / 2026-10-12 |
| [SillyTavern](https://github.com/SillyTavern/SillyTavern) | AGPL-3.0 | JS, Node | 1.19.0, 2026-09-14 | 34.6k / 2026-10-02 |
| [LibreChat](https://github.com/LibreChat-AI/LibreChat) | MIT | TS, Node | v0.8.8, 2026-10-01 | 45.9k / 2026-10-17 |
| [Open WebUI](https://github.com/open-webui/open-webui) | Open WebUI License: BSD-3 plus a branding clause, not OSI ([licence](https://docs.openwebui.com/license/)) | Python, Svelte | v0.12.3, 2026-10-16 | 156k / 2026-10-16 |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | MIT | JS, Node | v1.18.0, 2026-10-13 | 67k / 2026-10-17 |
| [LobeHub](https://github.com/lobehub/lobehub) (was LobeChat) | LobeHub Community License: Apache-2.0, but a derivative work needs a commercial licence ([LICENSE](https://github.com/lobehub/lobehub/blob/main/LICENSE)) | TS | v2.2.19, 2026-10-07 | 83k / 2026-10-17 |
| [Jan](https://github.com/janhq/jan) | Apache-2.0 per LICENSE | Rust (Tauri) | v0.8.6, 2026-10-09 | 45k / 2026-10-16 |
| [Msty Studio](https://msty.ai/resources/changelog/studio/) | **Closed source**, freemium ([review](https://agentsai.fyi/agents/msty)) | Desktop app | 3.0.0 Beta 15, 2026-10-07 | n/a |
| [big-AGI](https://github.com/enricoros/big-AGI) | MIT | TS (Next.js) | v2.1.0, 2026-08-21 | 7.1k / 2026-10-16 |
| [aichat](https://github.com/sigoden/aichat) | Apache-2.0 | Rust | v0.30.0, 2025-07-06; since then only `models.yaml` commits (last 2026-02-23) | 10.5k |
| [llm](https://github.com/simonw/llm) | Apache-2.0 | Python | 0.36, 2026-09-22 | 12.6k / 2026-10-15 |
| [Elia](https://github.com/darrenburns/elia) | Apache-2.0 | Python (Textual) | 1.10.0, 2024-09-14; **dormant** | 2.5k / 2024-10-10 |
| [oterm](https://github.com/ggozad/oterm) | MIT | Python (Textual) | 0.26.0, 2026-10-12 | 2.4k |
| [AIRI](https://github.com/moeru-ai/airi) | MIT | TS | v0.12.0-beta.5, 2026-08-29 | 50k / 2026-10-17 |

Other OpenClaw relatives, metadata only, features unverified:
[zeroclaw](https://github.com/zeroclaw-labs/zeroclaw) (Rust, Apache-2.0, 33k),
[picoclaw](https://github.com/sipeed/picoclaw) (Go, MIT, 30k),
[ironclaw](https://github.com/nearai/ironclaw) (Rust, Apache-2.0, 12.7k) and
[moltis](https://github.com/moltis-org/moltis) (Rust, MIT, 2.9k; a single
binary with memory, Telegram, Discord and MCP).

### Hermes Agent (Nous Research)

- **Providers.**
  - Works with "any OpenAI-compatible API endpoint" (`provider: custom` plus
    `base_url`), OpenRouter (with `provider_routing` by price, throughput or
    latency), Ollama, llama.cpp, vLLM, SGLang and LM Studio
    ([providers](https://hermes-agent.nousresearch.com/docs/integrations/providers)).
  - Anthropic works three ways: an API key; OAuth, which needs Max plus
    purchased extra usage; or Claude Code credentials it detects.
  - There is no native Featherless provider: a code search finds no
    "featherless" in the repo. Featherless runs a managed Hermes instead
    ([featherless](https://featherless.ai/docs/hermes-agent)).
  - Local models need at least 64K of context for tool use.
  - Resilience comes in three layers: credential pools, an ordered
    `fallback_providers` list with rate-limit benching, and a separate fallback
    for auxiliary tasks
    ([fallback](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/fallback-providers.md)).
  - Compression, titles, vision and the background review can each go to a
    cheaper model (`auxiliary.*`).
- **Persona.** `SOUL.md` in `HERMES_HOME` is "slot #1 in the system prompt",
  replacing the default identity verbatim. `/personality` adds overlays for a
  session
  ([personality](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/personality.md)).
- **Memory.**
  - Two files: `MEMORY.md` (2,200 characters) and `USER.md` (1,375
    characters), entries separated by `§`. Writes over the cap fail, and the
    agent must remove or shorten entries
    ([memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)).
  - They are injected once as a frozen snapshot, which keeps the prompt cache
    intact. Users can edit them and gate writes with `write_approval`.
  - Recall: every session sits in `~/.hermes/state.db` (SQLite, FTS5).
    `session_search` returns the stored messages themselves, not summaries.
  - One external provider can run alongside: Honcho, Mem0, Hindsight,
    OpenViking, Supermemory and others. If both built-in stores are disabled,
    the provider becomes the only memory
    ([providers](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers)).
- **Learning.**
  - Every 10 user turns (`memory.nudge_interval`) a forked agent reviews the
    conversation in the background and saves to memory or skills. Every 10
    tool iterations it is nudged to create a skill.
  - A curator marks skills stale and later archives them. It never deletes
    them, but sources disagree on the day counts
    ([memory.md](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md),
    [guide](https://felipefontoura.com/articles/hermes-agent-skills/)).
- **Storage and portability.**
  - `hermes sessions export` writes JSONL, Markdown, HTML or trace.
  - `hermes sessions import --from claude|codex` reads Claude Code and Codex
    logs, and `hermes import-agent claude-code` turns `CLAUDE.md` into
    `MEMORY.md` entries
    ([sessions](https://hermes-agent.nousresearch.com/docs/user-guide/sessions),
    [import](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/import-from-other-agents.md)).
  - Dorothy's JSONL would need a converter. Her facts (up to 8,000 characters
    each) cannot fit in a 2,200-character `MEMORY.md`.
  - Pruning is off by default, and `prune` touches only ended sessions.
- **Compaction.** The built-in compressor summarises the middle of the
  conversation and continues in a linked session ("my project #2"). A
  context-engine plugin slot accepts
  [hermes-lcm](https://github.com/stephenschoettler/hermes-lcm) (MIT): a DAG of
  summaries in SQLite, raw messages kept, `lcm_grep` and `lcm_expand`
  ([context
  engine](https://hermes-agent.nousresearch.com/docs/developer-guide/context-engine-plugin)).
- **MCP and skills.**
  - MCP client, stdio and HTTP, with a curated catalogue that "Nous staff has
    reviewed"
    ([mcp](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/mcp.md)).
  - SKILL.md follows agentskills.io. New skills go to `~/.hermes/skills/` or
    `skills.create_dir`.
  - Project `.agents/skills/` load only after `hermes skills trust`, and the
    curator never edits them.
  - The hub draws on official, skills.sh, GitHub, ClawHub and LobeHub, with a
    built-in scanner and trust tiers. A "dangerous" verdict cannot be forced
    ([skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)).
- **Reach.**
  - About 35 messaging adapters, among them Telegram, Discord, Signal,
    WhatsApp, Matrix, SMS, email and Open WebUI
    ([messaging](https://github.com/NousResearch/hermes-agent/tree/main/website/docs/user-guide/messaging)).
  - A cron scheduler delivers to any platform.
  - An OpenAI-compatible API server lets LibreChat, Open WebUI or LobeChat act
    as its front end
    ([api-server](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/api-server.md)).
- **Interface.** A React/Ink TUI (`hermes --tui`, a forked Ink) talks to
  Python over JSON-RPC on stdio. It has multi-line editing, slash commands and
  a status bar
  ([ui-tui](https://github.com/NousResearch/hermes-agent/tree/main/ui-tui)).
  There are also a web dashboard and a desktop app. All self-hosted, single
  user.

### OpenClaw, ClawHub and derivatives

- **Providers.**
  - Ollama, vLLM, LM Studio, llama.cpp, OpenRouter, LiteLLM, Anthropic,
    DeepSeek and more
    ([providers](https://docs.openclaw.ai/providers)).
  - Featherless has a bundled extension
    ([extensions/featherless](https://github.com/openclaw/openclaw/tree/main/extensions/featherless)).
    It defaults to Qwen3-32B with a 32,768-token window
    ([search summary](https://clawdhub.mintlify.app/providers/featherless)).
  - Failover first rotates auth profiles with cooldowns, then walks an
    `agents.defaults.model.fallbacks` chain. Fallback lasts one turn. Agents
    and cron jobs can override models
    ([failover](https://docs.openclaw.ai/concepts/model-failover),
    [cron](https://docs.openclaw.ai/automation/cron-jobs)).
- **Persona.** Workspace files `SOUL.md` (persona, tone), `IDENTITY.md`,
  `AGENTS.md`, `USER.md` (4,000-character budget) and `MEMORY.md`
  ([workspace](https://docs.openclaw.ai/concepts/agent-workspace)).
- **Memory.**
  - Plain Markdown in the workspace: `MEMORY.md`, `USER.md` with
    active/superseded entries, and daily `memory/YYYY-MM-DD.md` that are
    indexed but not injected.
  - `memory_search` is hybrid (vector plus keyword) over SQLite. Embeddings can
    be local (Ollama, GGUF).
  - Before compaction, a "memory flush" turn saves context.
  - Dreaming, on by default, consolidates by score, recall frequency and query
    diversity, and writes `DREAMS.md` for review.
  - Codex, Claude Code and Hermes memory import into `memory/imports/`
    ([memory](https://docs.openclaw.ai/concepts/memory)).
  - Forgetting deletes indexed rows.
  - The workspace is meant to be a private git repo, the closest match to
    Dorothy's data directory.
- **Hosting hooks.**
  - `plugins.slots.memory` is exclusive and can replace `memory-core`. 2026.9
    adds non-exclusive "corpus supplements" that `memory_search` merges by
    score.
  - Known bugs: memory-core's tools still shadow a chosen plugin's
    ([#141806](https://github.com/openclaw/openclaw/issues/141806)), and
    taking the slot used to turn dreaming off
    ([#63067](https://github.com/openclaw/openclaw/issues/63067)).
  - `plugins.slots.contextEngine` exposes ingest, assemble, compact and
    afterTurn
    ([context engine](https://docs.openclaw.ai/concepts/context-engine)).
    [lossless-claw](https://github.com/Martian-Engineering/lossless-claw) (MIT,
    4.9k stars) fills it with a DAG of summaries, raw messages kept, and
    `lcm_expand`.
- **Storage.**
  - Transcripts are in SQLite (`openclaw-agent.sqlite`). Legacy JSONL imports
    through `doctor --fix`.
  - `session.maintenance` defaults to `enforce`: it archives after 30 days and
    at 5,000 entries. It can delete the oldest archives once `maxDiskBytes` is
    exceeded, and it deletes synthetic (cron, hook) sessions
    ([session](https://docs.openclaw.ai/concepts/session)).
  - Compaction keeps "the full conversation history on disk". New configs
    default to "safeguard" summaries with quality audits
    ([compaction](https://github.com/openclaw/openclaw/blob/main/docs/concepts/compaction.md)).
- **Skills and MCP.**
  - Skills follow AgentSkills. The Skill Workshop saves the agent's own skills
    with undo, but in `<state-dir>/agents/<id>/agent/workshop-skills`, outside
    the workspace
    ([skills](https://docs.openclaw.ai/tools/skills)).
  - MCP client (`mcp.servers`: stdio, SSE, streamable HTTP, OAuth) and
    `openclaw mcp serve`
    ([config](https://docs.openclaw.ai/gateway/config-extensions),
    [cli](https://docs.openclaw.ai/cli/mcp)).
- **ClawHub vetting.**
  - The 2026 "ClawHavoc" campaign planted 341 malicious skills among 2,857
    audited
    ([THN](https://thehackernews.com/2026/02/openclaw-integrates-virustotal-scanning.html)).
  - Defences now: VirusTotal hash checks and daily rescans, plus "ClawScan"
    (static analysis, VirusTotal and NVIDIA SkillSpector).
  - Unit 42 still found five evasive skills that were not blocked
    ([Unit
    42](https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/)).
  - A scan of 81,535 skills on 2026-09-22 found none malicious and 69 risky by
    design ([Signals
    Corps](https://www.signalscorps.com/blog/clawhub-agent-skills-security-scan/)).
- **Reach and interface.** Discord, iMessage, Slack, Teams, Telegram, WhatsApp,
  Signal and "20+ more". Automations deliver to a channel or a webhook. Control
  UI, CLI, TUI and companion apps
  ([repo](https://github.com/openclaw/openclaw)).
- **Scale.** About 425 MB of TypeScript and several releases a day, so expect
  constant churn.
- **Derivatives.**
  - **nanobot:** a small core, OpenAI-compatible and local providers with
    fallback, "Dream" consolidation into `USER.md` and `memory/MEMORY.md`, MCP,
    seven or more channels, cron, and a web UI
    ([nanobot](https://github.com/HKUDS/nanobot)).
  - **nanoclaw:** runs "directly on Anthropic's Agents SDK". Other providers
    come only through add-on skills (`/add-opencode`, `/add-ollama-provider`).
    Each agent group gets a container and a `CLAUDE.md`
    ([nanoclaw](https://github.com/nanocoai/nanoclaw)). Dropping Anthropic
    leaves it on its weakest path.

### Letta (platform)

- **Status.**
  - The Python server and its V1 API are retired to an `archive` branch.
    Everything now lives in Letta Code: harness, Ink TUI, App Server
    (`letta server`), channels and desktop
    ([letta](https://github.com/letta-ai/letta)).
  - The original ADE is "deprecated", replaced by one inside chat.letta.com
    ([ADE](https://docs.letta.com/agent-development-environment/)).
  - Server-side MCP, sleep-time agents, templates and identities were
    retired in favour of client-side equivalents
    ([next phase](https://www.letta.com/blog/our-next-phase/)).
- **Local mode.** `--backend local` keeps agents, messages and memory in
  `~/.letta/lc-local-backend`, with no account
  ([local mode](https://docs.letta.com/letta-agent/local-mode)). It is "not
  automatically backed up", and chat.letta.com cannot reach it.
- **Providers.** OpenRouter (key or OAuth), Ollama, LM Studio, llama.cpp,
  Anthropic and others. The docs warn that most open-weight models perform
  poorly, except the best, such as GLM-4.7 and MiniMax M2.1
  ([search summary of models
  page](https://docs.letta.com/configuration/models)).
- **Memory.**
  - MemFS is a git repository of Markdown. Root files go in the system prompt,
    and the rest is browsed on demand.
  - Dreaming subagents in git worktrees consolidate memory.
  - It can sync to your own GitHub repo
    ([memfs](https://docs.letta.com/concepts/memfs)).
  - The agent edits its own persona file, so identity can drift.
- **Skills, MCP, reach.** SKILL.md from global, project (`.agents/skills`) and
  agent scopes. Installs from GitHub, ClawHub or the Hermes hub. Client-side
  MCP ([changelog](https://docs.letta.com/reference/changelog)). Telegram,
  Slack, Discord, heartbeats and crons
  ([letta-code](https://github.com/letta-ai/letta-code)).
- **More.** Covered further by the harness and memory reports.

### Khoj, Agent Zero, Leon

- **Khoj.**
  - Custom agents with persona, model and tools; automations; clients for the
    web, Obsidian, Emacs, desktop and WhatsApp
    ([khoj](https://github.com/khoj-ai/khoj)).
  - A long-term memories feature exists and can be disabled
    ([releases](https://github.com/khoj-ai/khoj/releases)). Its format and
    export are unverified. No MCP found.
  - Activity is fading: the last release was in March, the last commit on
    2026-08-02, and the team now promotes
    [Pipali](https://github.com/khoj-ai/pipali) (Apache-2.0, Tauri and Bun),
    which offers no bring-your-own model keys.
- **Agent Zero.**
  - FAISS memory in areas (main, fragments, solutions). Fragments and solutions
    are extracted automatically, and similar memories are consolidated
    ([architecture](https://www.agent-zero.ai/p/architecture/),
    [DeepWiki](https://deepwiki.com/agent0ai/agent-zero/5.3-memory-operations)).
  - Editable `prompts/`, projects, skills, MCP, a scheduler, a plugin hub, a
    web UI and a Docker runtime. No chat channels
    ([repo](https://github.com/agent0ai/agent-zero)).
  - Vector memory is opaque: not files, not exported.
- **Leon.**
  - 2.0 is a "Developer Preview" and the README says not to use it daily.
  - Layered memory, SKILL.md agent skills and local or remote providers
    ([leon](https://github.com/leon-ai/leon)).

### Chat front ends

- **SillyTavern.** The richest persona tooling, and the weakest agent tooling.
  - Character cards are PNGs with embedded JSON.
  - World Info (lorebooks) are keyword-triggered entries. By default the scan
    window is the last 2 messages and the budget 25%
    ([DeepWiki](https://deepwiki.com/SillyTavern/SillyTavern/6.1-world-info-system)).
  - Data Bank documents are global, per character or per chat. Vector Storage
    keeps Vectra JSON indexes in `/vectors`
    ([data bank](https://docs.sillytavern.app/usage/core-concepts/data-bank/)).
  - Summarize keeps one rolling summary in message metadata
    ([summarize](https://docs.sillytavern.app/extensions/summarize/)).
  - Chats are **JSONL** in `data/<user>/chats/<character>/`: a
    `chat_metadata` header line, then one message per line
    ([DeepWiki](https://deepwiki.com/SillyTavern/SillyTavern/5-data-management)).
    Dorothy's transcripts would convert line for line, though the field
    mapping is unverified.
  - Featherless is built in as a Text Completion source (`src/constants.js`).
    OpenRouter and custom OpenAI-compatible endpoints are supported too
    ([featherless guide](https://featherless.ai/docs/guides-sillytavern)).
  - No native MCP: the request is still open
    ([#3335](https://github.com/SillyTavern/SillyTavern/issues/3335)), and only
    the TauriTavern fork has it.
  - No channels, no scheduling. Extensions install from git URLs with no
    vetting (unverified).
- **LibreChat.**
  - Memory is a key/value "notepad" capped by `tokenLimit`. An optional
    memory agent extracts entries from the last N messages, and users can edit
    them ([memory](https://www.librechat.ai/docs/features/memory)).
  - Automatic summarisation since v0.8.5. v0.8.8 adds manual compaction,
    interrupt and steer, and experimental "Agent Plugins" bundling skills and
    MCP ([v0.8.8](https://www.librechat.ai/changelog/v0.8.8)).
  - SKILL.md bundles, which agents can write mid-chat. No shipped library
    ([skills](https://www.librechat.ai/docs/features/skills)).
  - Native MCP and OpenRouter. No chat-app channels: a code search finds no
    Telegram. Multi-user, built for teams.
- **Open WebUI.**
  - Memory is a set of model-managed tools (`add_memory`, `search_memories` and
    others) and needs native function calling. Users review and delete
    memories in settings. Small local models are inconsistent
    ([memory](https://docs.openwebui.com/features/chat-conversations/memory/)).
  - Native MCP over Streamable HTTP only; admins add servers, and stdio needs
    MCPO ([mcp](https://docs.openwebui.com/features/extensibility/mcp/)).
  - Markdown "Skills" with version history
    ([features](https://docs.openwebui.com/features/)), and an automations
    module
    ([code](https://github.com/open-webui/open-webui/blob/main/backend/open_webui/routers/automations.py)).
  - The licence change matters little to a single user: branding may be
    removed only at 50 users or fewer, and contributors sign a CLA.
- **AnythingLLM.**
  - Memories (v1.13.0): up to 20 per workspace and 5 global, appended as
    "Things I Remember About You". Editable, with optional automatic extraction
    ([memories](https://docs.anythingllm.com/features/memories)).
  - MCP tools, but no resources, prompts or sampling
    ([mcp](https://docs.anythingllm.com/mcp-compatibility/desktop)).
  - A Telegram bot (v1.12.0) and scheduled jobs in single-user mode only
    ([jobs](https://docs.anythingllm.com/scheduled-jobs/overview)).
  - The desktop app moves from Ollama to an embedded "Lemond" engine
    ([v1.18.0](https://github.com/Mintplex-Labs/anything-llm/releases/tag/v1.18.0)).
- **LobeHub.**
  - "White-box", structured, editable memory, schedules, agent groups and
    "10,000+" tools and MCP plugins
    ([repo](https://github.com/lobehub/lobehub)).
  - An IM gateway (2.2, May 2026) covers Slack, Discord, Telegram, WeChat,
    LINE, QQ and iMessage. It also connects OpenClaw, Hermes and Claude Code as
    agents and migrates OpenClaw memory in one click
    ([2.2](https://github.com/lobehub/lobehub/discussions/14935),
    [changelog](https://lobehub.com/changelog/page/2)).
  - Exports agents as Markdown, but no memory export was found.
  - A Postgres stack; the licence blocks distributing derivatives.
- **Jan.** Local-first desktop app: assistants with system prompts, MCP, an
  OpenAI-compatible server on `localhost:1337`, no memory. MCP has been
  unreliable since 0.8.4
  ([releases](https://github.com/janhq/jan/releases),
  [#8519](https://github.com/janhq/jan/issues/8519)).
- **Msty Studio.** Closed source. Persona Studio, "Crew" multi-persona chats,
  MCP and Skill Studio. No memory, channels or scheduling in the changelog
  ([changelog](https://msty.ai/resources/changelog/studio/)).
- **big-AGI.** Personas, OpenRouter, Ollama and any OpenAI-compatible endpoint,
  with chats stored locally and exported to Markdown. No memory or MCP found
  ([repo](https://github.com/enricoros/big-AGI)).

### Terminal clients

- **llm (Simon Willison).**
  - Every prompt and response is logged to SQLite. 0.32 moved to a
    content-addressed schema (threads, turns, messages, parts)
    ([changelog](https://llm.datasette.io/en/stable/changelog.html)).
  - Fragments are stored once and deduplicated by SHA-256
    ([blog](https://simonwillison.net/2025/Apr/7/long-context-llm/)).
  - Templates hold system prompts. Plugins provide OpenRouter, Ollama and
    Anthropic, plus fragment and template loaders
    ([plugins](https://llm.datasette.io/en/stable/plugins/directory.html)).
  - MCP only through third-party or alpha plugins
    ([llm-tools-mcp](https://github.com/VirtusLab/llm-tools-mcp),
    [llm-mcp-client](https://simonwillison.net/tags/model-context-protocol/)).
  - No memory, no compaction. A good log store, not an assistant.
- **aichat.** Roles, sessions and `compress_threshold: 4000` with a
  summarisation prompt
  ([config](https://github.com/sigoden/aichat/blob/main/config.example.yaml)).
  No release in 15 months.
- **oterm.** Ollama, OpenAI, Anthropic and anything pydantic-ai supports, plus
  MCP ([docs](https://ggozad.github.io/oterm/)). No memory found.
- **Elia.** Dormant since 2024.

### Companions

- **AIRI.** Live2D/VRM companion with voice, Discord and Telegram, and xsai
  providers including OpenRouter and Ollama. "Memory Alaya" is still WIP
  ([airi](https://github.com/moeru-ai/airi)).
- **Others.** Open-LLM-VTuber (no push since 2026-05) and Amica (no releases)
  are stale. None has memory comparable to Dorothy's.

## 2. The 2026-10-15 objections, re-examined without Anthropic

**Objection 1: Claude only through print mode or the Agent SDK, metered as
programmatic use. Disappears.**

- Both platforms speak OpenAI-compatible APIs and OpenRouter natively, and
  OpenClaw also has a Featherless plugin.
- Both beat Dorothy's roadmap on resilience. Hermes has credential pools, an
  ordered `fallback_providers` list with reset-aware benching, and a routable
  model for each auxiliary task. OpenClaw has auth-profile rotation, fallback
  chains, and a model override for each agent and each cron job.
- The OpenClaw page confirms the old problem. Anthropic "treats Agent SDK and
  non-interactive CLI invocations as programmatic usage", and the planned
  Agent SDK credit is paused
  ([anthropic](https://docs.openclaw.ai/providers/anthropic)).
- **A smaller version of the same problem comes back.**
  - Featherless's $25 Chat plan is flat-rate but "for interactive,
    human-driven use by the purchaser", with a 32K context
    ([pricing](https://featherless.ai/pricing)).
  - Background reviews, dreaming, curators and cron are not human-driven.
    Hermes needs 64K of context, and OpenClaw's Featherless default is 32K.
  - Native tool calling is documented only for Kimi K2 and Qwen 3
    ([tool calling](https://featherless.ai/docs/tool-calling)); the list may
    be dated.
  - So an agent platform on Featherless means the per-token Developer plan
    (up to 256K), or OpenRouter. Whether OpenRouter's terms say anything
    similar is unverified.
- **Model quality becomes the binding limit.** Hermes warns that models
  "roughly under 30B parameters" claim saves they never make (see the memory
  report). Letta says most open-weight models perform poorly.

**Objection 2: each kept a second memory. Gone if Dorothy is replaced, partly
solved if she is hosted.**

- If Dorothy is replaced wholesale, their memory becomes the only one.
- If she is hosted:
  - Hermes allows a single external provider, and disabling both built-in
    stores makes it the only memory.
  - OpenClaw's exclusive memory slot replaces `memory-core`, though
    [#141806](https://github.com/openclaw/openclaw/issues/141806) shows core
    tools still shadowing a chosen plugin.
- **What remains:** each platform keeps its own session database (Hermes
  `state.db`, OpenClaw `openclaw-agent.sqlite`). Dorothy's JSONL would be a
  second transcript store unless she adopts theirs.
- Hermes's memory interface is Python, so Dorothy's TypeScript memory would
  need an MCP or subprocess bridge. OpenClaw's plugins are TypeScript, and
  Dorothy has only four `bun:sqlite` imports to port to Node.

**Objection 3: self-written skills stored outside the repo. Unaffected by the
provider; partly solved.**

- Hermes: `skills.create_dir` redirects new skills. Whether it takes an
  absolute path into a repo is unverified, since the docs only say relative
  paths resolve against Hermes home. Project `.agents/skills/` count as
  repo-owned and need `hermes skills trust`. The curator never edits them.
- OpenClaw: Workshop skills still land in the state directory, outside the git
  workspace. Workspace `skills/` and `.agents/skills` have the highest
  precedence, but the agent does not write there by default (unverified
  whether that can be configured).
- Letta Code keeps agent-scoped skills inside MemFS, which is git.

### New objections that matter more once Anthropic is gone

- **"Nothing is forgotten".**
  - Hermes caps `MEMORY.md` and makes the agent delete entries to fit. Its
    sessions are kept, since auto-prune is off by default.
  - OpenClaw's `forget` deletes rows, and session maintenance can delete
    archives under a disk budget and deletes synthetic sessions.
  - Both need configuration, and on Hermes an external provider, to meet the
    rule.
- **Churn and size.** OpenClaw ships several tags a day, and Hermes went from
  0.22.0 to 0.22.2 in two days. Either one becomes a moving dependency.
- **Supply chain.** ClawHub's history argues for curated sources only.
  Hermes's hub pulls from ClawHub too, but scans and tiers what it installs.

## 3. Dorothy's parts mapped to platforms

Sources are the sections above.

| Dorothy part | Full | Partial | None | What Dorothy would lose |
| --- | --- | --- | --- | --- |
| **Persona** (fixed identity and voice) | Hermes (`SOUL.md` slot 1, verbatim); OpenClaw (`SOUL.md`, `IDENTITY.md`); SillyTavern (cards); Msty | Letta (persona block the agent edits, so it can drift); LibreChat, Open WebUI, AnythingLLM, LobeHub, Jan, big-AGI (system-prompt presets); llm templates; aichat roles | | Little on Hermes or OpenClaw |
| **Memory block** (salience-ranked within a token budget) | | Hermes (frozen snapshot, fixed character caps); OpenClaw (`MEMORY.md` and `USER.md` truncated to budget; dreaming promotes by recall frequency); Letta (root files); AnythingLLM (global plus top-5 workspace); LibreChat (`tokenLimit`) | Others | Ranking by visits, recency half-life and usefulness appraisals |
| **Notes / reviews** (title, sentence, paragraph per conversation) | | Hermes (auto title, background review saves memory and skills); OpenClaw (daily notes, memory flush, `DREAMS.md`); Letta (dreaming); LibreChat and Open WebUI (titles) | ST, llm | Per-conversation description and abstract; user-correctable fields with provenance |
| **Tags** (SKOS vocabulary the model grows) | | OpenClaw Memory Wiki (claims, contradictions) is the nearest | All | The whole vocabulary |
| **Recall** (FTS5 over transcripts, notes, facts; MCP) | Hermes (FTS5 `session_search` returns raw messages); OpenClaw (hybrid `memory_search`, `sessions_search`, `openclaw mcp serve`) | Letta `/search`; hermes-lcm and lossless-claw `lcm_grep`; llm (SQLite logs, no search tool); SillyTavern vectors | Jan, Msty, big-AGI | One index over notes, facts and transcripts, with appraisals |
| **Compaction** (topical clusters, verbatim recollect) | OpenClaw with lossless-claw, Hermes with hermes-lcm (DAG of summaries, raw kept, expand) | Built-in: Hermes continuation sessions, OpenClaw safeguard summary, LibreChat, SillyTavern, aichat (one rolling summary) | Jan, big-AGI | Topical rather than chronological clusters |
| **Facts** (Markdown, personal or per project, never deleted, two-way `.agents/memory` sync) | | Letta MemFS (Markdown in git); OpenClaw (Markdown memory files, imports into `memory/imports/` one way); Hermes (capped `MEMORY.md`, one-way `import-agent`) | Front ends | Retire-not-delete, provenance, two-way repository sync |
| **History / mirror** (data directory as git, encrypted off-site) | | Letta (MemFS git, push to your own repo); OpenClaw (workspace as private git; sessions outside it); Hermes (JSONL export) | Others | The encrypted mirror; transcripts under git |
| **TUI** (Ink, streaming Markdown, editor, status line) | Hermes (React/Ink, same stack); Letta (Ink) | OpenClaw TUI (details unverified); oterm; llm and aichat REPLs | Web-only front ends | The Dorothy-specific status line |
| **Reach** (chat apps, schedules) | Hermes (~35 adapters, cron); OpenClaw (20+ channels, automations); nanobot; LobeHub (IM gateway, schedules) | Letta (Telegram, Slack, Discord, crons); AnythingLLM (Telegram, jobs); Khoj (WhatsApp, automations); Agent Zero (scheduler); Open WebUI (automations) | ST, LibreChat, Jan, terminal clients | Nothing; this is all gain |
| **Learning** (experience into memory or SKILL.md) | Hermes (nudged reviews, curator, write approval); OpenClaw (Skill Workshop, dreaming); Letta (dreaming, skill-creator) | LibreChat (agent-written skills); Agent Zero (solutions memory); nanobot (Dream) | Front ends | Gain, though skills land outside the repo (section 2) |
| **Extensions** (vetted skills and MCP catalogue) | Hermes (multi-source hub, scanner, trust tiers, Nous-reviewed MCP catalogue); OpenClaw (ClawHub with ClawScan, plugins with slots, MCP both ways) | LobeHub (large, vetting unverified); LibreChat (MCP, no library); Open WebUI (admin MCP over HTTP only); llm plugin directory | SillyTavern (no MCP) | Gain; the risk is supply chain |

## 4. Shortlist

### 1. Hermes Agent: best to replace Dorothy wholesale

- **Why it fits.**
  - It covers the most parts at full fit: persona, recall, reach, learning,
    extensions and the TUI.
  - Its parts are the most like Dorothy's. The TUI is React/Ink, recall is
    FTS5 returning raw messages, a background review is forked after turns,
    and memory is a frozen snapshot that keeps the cache warm.
  - Its resilience (fallback chain, credential pools, a routable model for
    each auxiliary task) already does what Dorothy's routing roadmap item
    plans.
  - MIT licence, the largest community, and an OpenAI-compatible API server,
    so any front end can sit on top.
- **What Dorothy loses.**
  - Tags, salience ranking and per-conversation notes.
  - "Nothing is forgotten", unless the built-in stores are disabled in favour
    of an external provider.
  - Her facts would have to become skills, context files or provider entries.
- **Costs.** Python, 64K of context, and fast churn.
- **Path.** Port the persona to `SOUL.md`. Write a Hermes memory provider that
  bridges to Dorothy's recall over MCP. Point `skills.create_dir` at the
  memory repository.

### 2. OpenClaw: best to host Dorothy's own code

- **Why it fits.**
  - It is TypeScript, and it has the plugin seams that match Dorothy's
    packages: an exclusive memory slot, corpus supplements and a
    context-engine slot. Dorothy's memory and cluster compaction could
    become plugins with little porting: `bun:sqlite` to Node, and Node 24+.
  - Its Markdown workspace in private git is closest to Dorothy's data
    directory.
  - Native Featherless, failover, 20+ channels, automations and MCP both ways.
- **Against.**
  - The size and daily release churn.
  - ClawHub's malware history. Use curated installs only.
  - Workshop skills land outside the workspace.
  - Session maintenance deletes some sessions unless configured.
  - Open slot bugs (#141806).

**3. Letta Code (local backend): best if Dorothy's memory philosophy matters
more than her code.**

- **Why it fits.** Git-backed Markdown memory comes closest to Dorothy's facts.
  It adds dreaming, skills in git, an Ink TUI, Telegram, Slack and Discord, and
  crons. Apache-2.0 and TypeScript.
- **Against.**
  - The persona is self-edited.
  - Its cloud is the default.
  - Local state is not backed up.
  - Its own warning about open-weight models.
  - The other reports cover it in depth.

### Not shortlisted

- **SillyTavern:** the best persona and companion front end, with Featherless
  built in and JSONL chats, but no MCP, channels or learning loop. Worth it
  only as a UI over a Dorothy or Hermes back end.
- **LobeHub:** the licence and Postgres stack weigh against it, and its memory
  cannot be exported.
- **LibreChat and Open WebUI:** multi-user web apps with thin memory.
- **nanobot:** a credible lightweight Hermes alternative, but younger (v0.3).
- **nanoclaw:** tied to the Claude Agent SDK.

## Not verified

- Whether Hermes's `skills.create_dir` accepts an absolute repo path.
- Whether OpenClaw's Workshop directory can be configured.
- How OpenClaw's TUI works.
- Khoj's memory format and export.
- The field mapping from SillyTavern messages to Dorothy's JSONL.
- How SillyTavern vets extensions.
- The terms of OpenRouter's flat-rate or free tiers.
- LobeHub's memory export.
- Agent Zero's providers.
- Hermes curator defaults (sources disagree).
