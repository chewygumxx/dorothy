---
ctime: 2026-10-18
mtime: 2026-10-18
spdx: GPL-3.0-only
title: "Terminal and coding-agent harnesses as hosts or foundations for a provider-neutral Dorothy (as of 18 Oct 2026)"
description: >-
  Terminal and coding-agent harnesses as hosts or foundations for a
  provider-neutral Dorothy.
tags:
  - dorothy
  - providers
  - notes
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-10-18_open-source-replacements/harnesses.md
   -
   -->

# Terminal and coding-agent harnesses as hosts or foundations for a provider-neutral Dorothy (as of 18 Oct 2026)

A research agent's report, kept as it was written apart from its line
wrapping, its em dashes and this header, for the
[note on open-source replacements](../2026-10-18_open-source-replacements.md).

Stars, releases and licences come from the GitHub API on 2026-10-18. I checked
feature claims against each project's docs or source (shallow clones in
`/tmp/research_clones`). Nothing in the Dorothy repo was touched.

## Bottom line

- **Best foundation to build Dorothy on as a library: pi** (`earendil-works/pi`,
  formerly `badlogic/pi-mono`). It is MIT, written in TypeScript, and embeds in
  a Bun process. It has a provider layer, an agent loop, a TUI library, JSONL
  sessions, and extension hooks for the system prompt, compaction, tools, MCP
  and providers.
- **Best host needing the least rewrite: Qwen Code.** It copies Claude Code's
  features: `--system-prompt` and `--append-system-prompt`, Claude-style hooks,
  auto-memory, skills, MCP, chat channels, a daemon mode, and a TypeScript SDK
  whose `query()` has the same shape as the Agent SDK's.
- **Biggest ecosystem and widest reach: OpenCode.** It is MIT and runs on Bun.
  You get a TUI, a server, a web UI, a desktop app and ACP. Agent files can
  replace the system prompt outright, but its plugin API is in the middle of a
  V2 rewrite.
- **None of them reproduces Dorothy's memory.** That means notes from background
  reviews, the salience-ranked memory block, the tag vocabulary, topical-cluster
  compaction, facts synced with `.agents/memory`, and the git repo with its
  encrypted mirror. Letta Code comes closest in spirit. Whatever the host, keep
  `memory` as Dorothy's own component, exposed over MCP plus a small adapter per
  host.

## Anthropic subscription rules (these decide "can it use a Claude plan")

- **Current terms.** Subscription OAuth is "designed to support ordinary use of
  Claude Code and other native Anthropic applications". Developers, "including
  those using the Agent SDK, should use API key authentication". Third parties
  may not "route requests through Free, Pro, or Max plan credentials on behalf
  of their users". Signing in to the *unmodified* Claude Code binary with your
  own plan is allowed ([legal
  page](https://code.claude.com/docs/en/legal-and-compliance)). The same page
  says plan limits "assume ordinary, individual usage of Claude Code and the
  Agent SDK".
  - My interpretation: Dorothy's personal use of the Agent SDK on the owner's
    own plan is ambiguous, not clearly banned.
- **History.** Server-side blocking of spoofed harnesses began 9 Jan 2026
  ([HN](https://news.ycombinator.com/item?id=46549823),
  [paddo.dev](https://paddo.dev/blog/anthropic-walled-garden-crackdown/)).
  OpenCode removed its bundled Claude Pro/Max plugins in 1.3.0, and its docs say
  "Anthropic explicitly prohibits this" ([OpenCode providers
  doc](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/providers.mdx)).
- **Gateways.** If a gateway sets only `ANTHROPIC_BASE_URL`, the saved claude.ai
  login stays the active credential, and the gateway must forward the OAuth
  `anthropic-beta` header. This is how `dorothy --claude` works. Anthropic
  "doesn't support routing Claude Code to non-Claude models through any gateway"
  ([llm-gateway doc](https://code.claude.com/docs/en/llm-gateway)).
- **featherless.ai** appears to offer only OpenAI Chat Completions
  (`api.featherless.ai/v1`), with tool calling that depends on the model
  ([OpenClaw provider page](https://docs.openclaw.ai/providers/featherless),
  [API profile](https://github.com/api-evangelist/featherless)). I found no
  evidence of Responses-API or Anthropic Messages support (**unverified**). That
  matters for Codex and Claude Code below.

## Inventory

| Harness | Licence | Runtime | Latest stable | Stars / last push |
| --- | --- | --- | --- | --- |
| [OpenCode](https://github.com/anomalyco/opencode) | MIT | TS on Bun | v1.19.3, 2026-10-16 | 215k / 2026-10-17 |
| [Crush](https://github.com/charmbracelet/crush) | FSL-1.1-MIT (source-available, not OSI; [LICENSE.md](https://github.com/charmbracelet/crush/blob/main/LICENSE.md)) | Go | v0.98.1, 2026-10-09 | 28.7k / 2026-10-17 |
| [Goose](https://github.com/aaif-goose/goose) (moved from `block/` to the Agentic AI Foundation org) | Apache-2.0 | Rust | v1.55.0, 2026-10-16 | 55k / 2026-10-17 |
| [Codex CLI](https://github.com/openai/codex) | Apache-2.0 | Rust | rust-v0.163.0, 2026-10-15 | 130k / 2026-10-17 |
| [pi](https://github.com/earendil-works/pi) | MIT | TS on Node 22.19+ (SDK embeds in Bun) | v1.3.0, 2026-10-15 | 116k / 2026-10-17 |
| [Letta Code](https://github.com/letta-ai/letta-code) | Apache-2.0 | TS (Bun ≥1.3.2 or Node ≥22.19), Ink | v0.34.16, 2026-10-16 | 3.6k / 2026-10-17 |
| [Aider](https://github.com/Aider-AI/aider) | Apache-2.0 | Python | v0.86.0, **2025-08-09** | 50k / last commit 2026-05-22 (dormant) |
| [Qwen Code](https://github.com/QwenLM/qwen-code) | Apache-2.0 | TS on Node ≥22 (Gemini CLI fork) | v0.25.2, 2026-10-15 | 28.5k / 2026-10-17 |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Apache-2.0 | TS on Node | v0.64.0, 2026-10-13 | 107k / 2026-10-17 |
| [OpenHands CLI](https://github.com/OpenHands/OpenHands-CLI) | MIT | Python | 1.16.0, 2026-05-08 | 266; **marked "no longer actively maintained"** in Aug 2026 (commit #808), pointing to Agent Canvas |
| [Kilo Code CLI](https://github.com/Kilo-Org/kilocode) | MIT | TS (OpenCode fork) | v7.8.12, 2026-10-15 | 27.6k / 2026-10-17 |
| [Cline CLI](https://github.com/cline/cline) | Apache-2.0 (JetBrains plugin closed) | TS, OpenTUI | cli-v3.0.73, 2026-10-17 | 70k / 2026-10-17 |
| Amp | Proprietary | – | – | – |
| [Claude Code](https://github.com/anthropics/claude-code) | Proprietary ("All rights reserved") | – | v2.1.302, 2026-10-16 | 152k (issue repo) |
| Others that matter | [Hermes Agent](https://github.com/NousResearch/hermes-agent) MIT, Python, v0.22.2, 255k stars; [OpenClaw](https://github.com/openclaw/openclaw) MIT, TS/Node 24+, v2026.10.4, 392k stars | | | |

Dropped from consideration:

- [Kimi CLI](https://github.com/MoonshotAI/kimi-cli): archived Sep 2026.
- [Antigravity CLI](https://github.com/google-antigravity/antigravity-cli),
  which replaces Gemini CLI for consumers: no licence on the repo.
- [Toad](https://github.com/batrachianai/toad): AGPL-3.0, a generic ACP terminal
  front-end, last push May 2026.
- [Mistral Vibe](https://github.com/mistralai/mistral-vibe): Apache-2.0, Python,
  v2.26.1.

## Per harness

### OpenCode

- **Providers:** dozens via the AI SDK, including `@ai-sdk/openai-compatible`
  (so featherless works), OpenRouter, LM Studio and Ollama. ChatGPT Plus,
  Copilot and GitLab Duo plans work; Claude plans are prohibited
  ([providers](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/providers.mdx)).
- **Persona:** Markdown/JSON agents (primary or subagent) in
  `~/.config/opencode/agents` ([agents doc](https://opencode.ai/docs/agents/)).
  An agent's prompt **replaces** the default system prompt: `agent.system ?
  agent.system : SessionSystemPrompt.make(...)` in
  [model-request.ts](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/model-request.ts).
  AGENTS.md rules apply globally and per project.
- **Memory:** none built in.
- **Sessions:** SQLite (`bun:sqlite` with Drizzle) under
  `$XDG_DATA_HOME/opencode` (source: `packages/cli/src/database-path.ts`,
  `packages/util/src/global-roots.ts`).
- **Compaction:** automatic plus `/compact`. The plugin hook
  `experimental.session.compacting` can add context or replace the prompt
  ([plugins](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/plugins.mdx)).
- **Plugins:** JS/TS, with events for session.created, idle, compacted, error,
  message.*, tool.execute.before/after, tui.*, and others. The V2 Effect-based
  plugin API (`ctx.session.hook("context")` can edit `event.system`) is
  replacing it, so expect churn.
- **MCP / skills:** MCP client yes. SKILL.md is loaded from `.opencode`,
  `.claude` and `.agents` skills folders
  ([skills](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/skills.mdx)).
- **SDK:** `@opencode-ai/sdk` is a client; `createOpencode()` "starts both a
  server and a client". There is `opencode serve` (OpenAPI), a web UI, a desktop
  app and `opencode acp`
  ([sdk](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/sdk.mdx),
  [server](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/server.mdx)).
- **TUI:** OpenTUI (`@opentui/solid`); `/editor` and `/export` use `$EDITOR`
  ([tui](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/tui.mdx)).
- **Chat use:** usable for chat, but the TUI is coding-centred.

### Crush

- **Providers:** any OpenAI- or Anthropic-compatible endpoint, Ollama,
  OpenRouter, and Charm's paid "Hyper". OAuth exists for Copilot, Grok, Hyper
  and OpenAI only (source `internal/oauth`), so no Claude plan.
- **Persona:** only a per-provider `system_prompt_prefix`
  (`internal/config/config.go`), plus CRUSH.md/AGENTS.md context files. I found
  no full replacement.
- **Sessions / compaction:** SQLite in a per-project `.crush/`; automatic
  summarisation that can be disabled.
- **Hooks:** Claude-Code-compatible but **PreToolUse only**
  ([hooks](https://github.com/charmbracelet/crush/tree/main/docs/hooks)).
- **Skills / MCP:** Agent Skills, including from `.claude/skills` and
  `.agents/skills`. MCP over stdio, http and sse.
- **Reach / SDK:** `crush server` shares workspaces between clients; `crush run`
  runs headless ([README](https://github.com/charmbracelet/crush)). No ACP or
  SDK found. A polished Bubble Tea TUI.
- **Verdict:** weak host for a persona.

### Goose

- **Providers:** very broad, many OpenAI-compatible
  ([providers](https://github.com/aaif-goose/goose/blob/main/documentation/docs/getting-started/providers.md)).
- **Claude plan:** the `claude-acp` provider wraps
  [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp)
  "to use your existing Claude Code subscription"
  ([acp-providers](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/acp-providers.md)).
- **Persona:** custom agents in `.agents/agents/` (Goose also reads
  `.claude/agents/`), `.goosehints`, and "persistent instructions" re-injected
  every turn
  ([MOIM](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/context-engineering/using-persistent-instructions.md)).
  Full replacement exists only as a session-level `system_prompt_override` in
  source; I found no documented user-facing switch.
- **Memory / sessions / compaction:** a Memory extension and a Chat Recall
  extension that searches past sessions. Sessions in SQLite at
  `~/.local/share/goose/sessions/sessions.db`
  ([logs](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/logs.md)).
  Automatic compaction at 80% of the window or 225k tokens.
- **Hooks / plugins:** Open Plugins hooks covering SessionStart, SessionEnd,
  Stop, UserPromptSubmit, Pre/PostToolUse and file/shell events
  ([hooks](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/context-engineering/hooks.md)).
  Plugins bundle skills and hooks.
- **SDK / reach:** a Rust SDK with Python and Kotlin bindings, ACP over
  stdio/HTTP/WebSocket (`goose acp`), and a desktop app
  ([GDK](https://github.com/aaif-goose/goose/tree/main/documentation/docs/gdk)).
- **TUI:** the separate TUI is deprecated
  ([ui/text](https://github.com/aaif-goose/goose/tree/main/ui/text)); the CLI is
  basic.

### Codex CLI

- **Providers:** custom providers, but `wire_api` accepts **only `responses`**,
  so Chat-Completions-only services like featherless need a translating proxy.
  Local models via `--oss` with Ollama or LM Studio. Sign-in with ChatGPT.
- **Persona:** `model_instructions_file` replaces the built-in instructions;
  `developer_instructions` adds to them.
- **Compaction:** `compact_prompt` / `model_auto_compact_token_limit`.
- **Hooks:** behind a feature flag (all of the above from the [config
  reference](https://learn.chatgpt.com/docs/config-file/config-reference)).
  Events: SessionStart, SessionEnd, UserPromptSubmit, Pre/PostToolUse,
  PermissionRequest, Pre/PostCompact, Stop, Subagent*, Interrupt. Plugin hooks
  get `CLAUDE_PLUGIN_ROOT` for compatibility
  ([hooks](https://learn.chatgpt.com/docs/hooks)).
- **Memories:** off by default, under `~/.codex/memories`, using per-thread
  extraction plus consolidation; no search mentioned
  ([memories](https://learn.chatgpt.com/docs/customization/memories)).
- **Sessions:** JSONL rollouts in `~/.codex/sessions` ([rollout
  source](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/lib.rs)).
- **MCP / skills:** MCP client and SKILL.md. `codex mcp-server` was deprecated
  in v0.149.1 (Aug 2026) in favour of the `app-server` JSON-RPC protocol over
  stdio or WebSocket
  ([OpenAI](https://openai.com/index/unlocking-the-codex-harness/), [third-party
  guide](https://codex.danielvaughan.com/2026/08/25/codex-mcp-server-deprecated-app-server-migration-claude-code-plugin-v0149/)).
- **SDK / ACP:** the TS SDK spawns the CLI
  ([sdk](https://github.com/openai/codex/tree/main/sdk/typescript)). ACP via
  [codex-acp](https://github.com/agentclientprotocol/codex-acp).
- **TUI:** Ratatui, with an external-editor module
  (`codex-rs/tui/src/external_editor.rs`).

### pi

- **Packages:** `pi-ai` (multi-provider API), `pi-agent-core`, `pi-tui`,
  `pi-coding-agent` (CLI and SDK), plus `durable`, `mcp` and `chord`
  ([README](https://github.com/earendil-works/pi)).
- **Providers:**
  - Anthropic Messages, OpenAI Responses and Completions, OpenRouter,
    Ollama/vLLM/LM Studio and "any OpenAI-compatible API".
  - Strict JSON-schema tool calls across providers.
  - Pluggable credential store ([pi-ai
    README](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)).
  - pi-ai still offers **Anthropic Claude Pro/Max OAuth**, which the terms above
    forbid for third-party apps.
- **Persona:** `SYSTEM.md` replaces and `APPEND_SYSTEM.md` appends, both
  globally and per project; AGENTS.md and CLAUDE.md are also read
  ([configuration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/configuration.md)).
- **Extensions (TypeScript, in-process):**
  - `before_agent_start` can replace the whole system prompt per run, and
    `context` transforms messages.
  - `turn_end` and `agent_before_settle` can append entries and continue;
    `tool_call` and `tool_result` are interceptable; raw `provider_stream_event`
    is exposed.
  - Registration methods: `registerTool`, `registerProvider`,
    `registerMcpServer`, `registerVirtualModel` (per-request model routing) and
    custom UI
    ([extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)).
- **Sessions:** a JSONL tree with branches in `~/.pi/agent/sessions/`,
  relocatable with `sessionDir`
  ([session-format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md)).
- **Compaction:** automatic plus `/compact`; `session_before_compact` "can
  cancel or provide custom summary"
  ([compaction](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)).
- **Memory:** none.
- **MCP / skills:** MCP client over stdio and streamable HTTP with OAuth
  ([mcp](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md));
  SKILL.md supported.
- **Ways to run it:** print/JSON mode, RPC, and an SDK that "embeds Pi in a
  Node.js or Bun process"
  ([sdk](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)).
- **TUI:** `Markdown` and `Editor` components, Ctrl+G for the external editor,
  and a footer with context use and cost
  ([usage](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md),
  [tui](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md)).
- **Reach:** ACP via the community [pi-acp](https://github.com/svkozak/pi-acp)
  (MIT); Slack/chat via [pi-chat](https://github.com/earendil-works/pi-chat)
  (Apache-2.0).
- **Caveats:** PRs and issues from new contributors are auto-closed by default,
  and there is no permission system.
- **Proven as a foundation:** OpenClaw credits pi, and Letta Code's local
  backend depends on `@earendil-works/pi-ai`
  ([package.json](https://github.com/letta-ai/letta-code/blob/main/package.json)).

**Letta Code** ([README](https://github.com/letta-ai/letta-code)). This is the
closest match to Dorothy's ambition:

- **Memory and learning:** agents rewrite their own memory blocks, system prompt
  and skills. MemFS keeps all context in git and can sync to your own repo.
  There is `/search` across messages, "dreaming" via `/sleeptime`, and crons and
  heartbeats.
- **Reach:** Telegram, Slack and Discord channels, a desktop app and
  chat.letta.com.
- **Backend:** Letta Cloud is the default; a local backend stores agents and
  conversations under `~/.letta`.
- **Providers / persona:** bring-your-own-key providers include
  OpenAI-compatible Chat Completions, OpenRouter, LM Studio and the ChatGPT
  plan; I found no Claude plan. `--system` and `--personality` flags.
- **Also:** MCP client, skills from `.agents/skills`, hooks, and an Ink TUI.
- **ACP: unverified.**

### Qwen Code

- **Providers:** "OpenAI / Anthropic / Gemini / Qwen + any provider", including
  OpenRouter and Ollama/vLLM. The free Qwen OAuth tier was discontinued on
  2026-04-15
  ([auth](https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/auth.md)).
- **Persona:** `--system-prompt`, `--append-system-prompt`, `QWEN_SYSTEM_MD` and
  output styles
  ([headless](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/headless.md)).
- **Memory:** QWEN.md/AGENTS.md plus background auto-memory
  ([memory](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/memory.md)).
- **Hooks:** Claude-style SessionStart, SessionEnd, Stop, StopFailure and
  UserPromptSubmit, with `additionalContext`
  ([hooks](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md)).
- **Also:** skills, MCP, subagents, `qwen serve` daemon (HTTP+SSE, ACP), a web
  UI, Telegram/DingTalk/WeChat/Feishu channels, and Zed/VS Code integration
  ([README](https://github.com/QwenLM/qwen-code)).
- **SDK:** `@qwen-code/sdk` `query({prompt, options})` takes `systemPrompt`,
  `mcpServers`, `canUseTool`, `includePartialMessages`, `resume` and `authType`.
  That is nearly the shape of the Agent SDK. It is labelled "minimum
  experimental" ([sdk
  README](https://github.com/QwenLM/qwen-code/blob/main/packages/sdk-typescript/README.md)).
- **Unverified:** Bun compatibility, `$EDITOR` support, session path.

**Gemini CLI.** Gemini models only. Consumer access ended 2026-06-18 in favour
of Antigravity CLI (written in Go); API keys and enterprise licences still work
([Google
blog](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)).
It has skills, hooks, auto-memory, ACP and a `system-prompt.md` override doc
([docs](https://github.com/google-gemini/gemini-cli/tree/main/docs/cli)). Not
provider-neutral, so unsuitable.

**Kilo Code CLI.** A fork of OpenCode
([README](https://github.com/Kilo-Org/kilocode)). It adds
`@kilocode/kilo-memory` ("project memory storage, indexing, recall")
([package.json](https://github.com/Kilo-Org/kilocode/blob/main/packages/kilo-memory/package.json)),
a 500+ model gateway at provider prices, a marketplace, and a ChatGPT Plus/Pro
provider. I found no Claude plan. Otherwise it inherits OpenCode's traits.

**Cline CLI** ([CLI
README](https://github.com/cline/cline/blob/main/apps/cli/README.md)):

- **TUI and persona:** OpenTUI with streaming Markdown; `-s` sets a custom
  system prompt.
- **Providers:** Anthropic/OpenAI/OpenRouter/OpenAI-compatible keys and the
  ChatGPT plan.
- **Agent features:** MCP, rules, skills, hooks, `--acp`, and `--compaction
  agentic|basic|off`.
- **Reach:** cron schedules and **connectors for Telegram, Slack, Google Chat,
  WhatsApp and Linear**.
- **SDK:** `@cline/sdk` `new Agent({providerId, modelId, systemPrompt, tools})`
  ([sdk](https://github.com/cline/cline/blob/main/sdk/README.md)).
- **Memory:** none built in (**unverified**).

**Aider.** No release for 14 months. It is a pair-programmer built around edit
formats, without a general tool loop, MCP or skills (**MCP absence
unverified**). Not a candidate.

**Amp.** Closed source. Free with bring-your-own-key since 13 Sep 2026. Its
"Claude Code" mode, added 10 Oct 2026, uses your Claude Pro/Max plan and "uses
the Claude Agent SDK instead of Amp's own agent"
([news](https://ampcode.com/news),
[post](https://ampcode.com/news/use-your-claude-plan)). It has skills in
`.agents/skills` and a plugin API (**JS/TS detail from secondary sources,
unverified**). It cannot host Dorothy's code.

**Claude Code today** ([CLI
reference](https://code.claude.com/docs/en/cli-reference)) already provides
natively:

- `--system-prompt[-file]` / `--append-system-prompt[-file]`, in interactive
  mode too, with a cache split marker.
- `--agent` and the `agent` setting for a custom main-thread agent; output
  styles for "persistent personas".
- Auto-memory: a `MEMORY.md` index (first 200 lines or 25KB loaded) plus topic
  files, relocatable via `autoMemoryDirectory`
  ([memory](https://code.claude.com/docs/en/memory)).
- Hooks (Setup, SessionStart, Pre/PostCompact, Stop, SessionEnd, and more) and
  plugins.
- `--autocompact` and fallback model chains.
- `--channels`: MCP push into a session, a research preview.
- Remote Control from claude.ai or the app; background sessions and agent view.

It lacks recall over past transcripts, salience ranking, notes and tag
vocabularies, and is Anthropic-only.

## Mapping Dorothy's parts

| Dorothy part | Full replacement | Partial | What Dorothy loses |
| --- | --- | --- | --- |
| **agent** (Agent SDK `query()`, persona, streaming, zod one-shots) | pi-ai + pi-agent-core (strict JSON-schema tool calls, TypeBox not zod); `@qwen-code/sdk` (closest API shape); `@cline/sdk` | OpenCode SDK (client/server, not in-process); Codex SDK (spawns CLI, OpenAI-only) | Claude Code's built-in tools and permission engine if moving to pi-ai (pi has tools but no permissions); zod schemas need conversion |
| **tui** (Ink: streaming Markdown, editor, history, `$EDITOR`, status line, raw pane) | pi TUI (Markdown, Editor, Ctrl+G, usage/cost footer, `provider_stream_event` plus `debug-provider.ts` for raw events); OpenCode; Cline; Codex | Crush, Qwen (Ink), Letta (Ink) | The bespoke raw-message pane and status-line layout. pi lets an extension replace header, footer and editor, so little is truly lost |
| **cli launcher + hooks** (`dorothy --claude`: persona + memory block, recall MCP, Stop/SessionEnd recording) | Qwen Code (same flags and hook events); Codex (`model_instructions_file`, SessionStart/Stop/SessionEnd hooks); Goose (hooks + agents + MOIM) | OpenCode (agent prompt + `session.idle` plugin event); pi (extension does all of it in-process); Crush (PreToolUse only, cannot record) | A separate adapter per host, each with its own transcript format |
| **gateway** (system-prompt-rewriting proxy) | Unneeded in hosts that replace the prompt natively (pi, OpenCode, Codex, Qwen, Cline, Letta) | pi `registerVirtualModel` / `registerProvider` covers role routing and fallback | To make Dorothy "the model behind" other harnesses, she must serve Anthropic Messages (Claude Code, unsupported by Anthropic for non-Claude models), Responses (Codex) and Chat Completions (OpenCode and others) |
| **compaction** (old turns → topical clusters with abstracts) | none | pi `session_before_compact` (custom summary); OpenCode compacting hook; Codex `compact_prompt` + Pre/PostCompact; Letta local compaction + dreaming | Dorothy's compaction is memory-side, feeding recall. All hosts only shrink the context window. Keep Dorothy's and plug it into pi's hook |
| **transcripts** (JSONL) | pi (JSONL tree, relocatable directory); Codex (JSONL rollouts); Claude Code (JSONL) | OpenCode, Goose, Crush (SQLite); Letta (files under `~/.letta`) | FTS5 recall across transcripts, notes and facts. Only Goose Chat Recall, Letta `/search` and Hermes FTS5 offer any session search |
| **memory** (notes, salience block, tags, facts sync, git+encrypted mirror) | none | Letta Code (git MemFS, self-editing blocks, dreaming); Hermes (MEMORY.md/USER.md, skill learning, FTS5); Codex/Qwen/Claude Code auto-memory; Kilo kilo-memory | Everything that sets Dorothy apart. Keep it, expose it as MCP, and inject the block through each host's prompt mechanism |

## Ranked shortlist for a provider-neutral Dorothy

1. **pi (build on it as a library).** It covers the roadmap's provider contract
   today: Anthropic Messages plus OpenAI-compatible, with OpenRouter, local
   models and per-request virtual models for role routing and fallback. It is
   MIT, TypeScript, and embeds in Bun. Its extension API covers every seam
   Dorothy needs: prompt replacement, context transforms, compaction override,
   tools, MCP and UI. JSONL sessions match Dorothy's transcript model, and
   OpenClaw and Letta Code show it holds up as a base.
   - Dorothy would become a pi host or pi package with `memory` intact,
     discarding `agent`, `tui`, `gateway` and most of `cli`.
   - Risks: API churn (now v1.x), new-contributor PRs auto-closed, and no
     permission sandbox.
2. **Qwen Code (host her with the least rewrite).** It has feature parity with
   Claude Code, including the system-prompt flags and Claude-style hooks, so
   `dorothy --claude` ports almost 1:1 into a Qwen launcher. Its SDK mirrors the
   Agent SDK's `query()`. It is provider-neutral, Apache-2.0, and adds channels,
   daemon, web and ACP for free.
   - Risks: steered by Alibaba, SDK "experimental", Gemini CLI heritage, Bun
     support unverified.
3. **OpenCode (if reach and community matter most).** MIT, Bun-native, 215k
   stars. It has TUI, web, desktop, server and ACP, and agent files fully
   replace the prompt.
   - Dorothy would become an agent file, a plugin, and a recall MCP server.
   - Risks: plugin API mid-rewrite to V2, SDK only as client/server, sessions in
     SQLite.

**Adopt instead of build:** Letta Code (TypeScript) or Hermes Agent (Python)
already ship persona, learning memory, chat apps and schedules. Choosing either
replaces Dorothy rather than hosting her, and her memory would compete with
theirs.

## Which work with Claude Code

- **Can run Claude Code or a Claude plan as their back end, by driving the
  unmodified binary through the Agent SDK or ACP:**
  - Goose (`claude-acp`).
  - Amp ("Claude Code" mode).
  - OpenClaw (harness plugins, per its README).
  - Any ACP client such as Zed or Toad via
    [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp).
  - Dorothy's own `--claude` gateway.
  - Whether third-party ACP wrappers fall inside the terms is **unverified**:
    Anthropic has made no explicit statement.
- **Reuse Claude Code assets:**
  - Skills from `.claude/skills`: OpenCode, Crush.
  - Agents from `.claude/agents`: Goose.
  - CLAUDE.md: pi.
  - Claude-compatible hooks: Crush (PreToolUse), Qwen (full event set).
  - `CLAUDE_PLUGIN_ROOT` for plugin hooks: Codex.
- **Do not work with a Claude plan:**
  - OpenCode and Kilo: removed or prohibited.
  - Crush, Cline, Letta Code, Qwen: Anthropic API key only.
  - pi: offers plan OAuth, but in breach of the terms.
  - Codex and Gemini CLI: no Anthropic models at all.
  - Aider: API key only.
- **Through a protocol gap:** Claude Code itself cannot officially use
  non-Claude models. Codex cannot reach Chat-Completions-only services such as
  featherless without a proxy.
