---
ctime: 2026-10-18
mtime: 2026-10-18
spdx: GPL-3.0-only
title: Open-source replacements for Dorothy
description: >-
  What Dorothy is meant to be and what she is, part by part, set against
  the open-source software that could replace each part, with or without
  Claude Code, should Anthropic be left for cheaper, more permissive
  models.
tags:
  - dorothy
  - providers
  - notes
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-10-18_open-source-replacements.md
   -
   -->

# Open-source replacements for Dorothy

Research done on 2026-10-18, on the owner's question: what Dorothy is
meant to be, what she is, and which of her parts existing open-source
software could replace, including software that does not work with Claude
Code, as the owner weighs leaving Anthropic for cheaper and more
permissive models. Dorothy's own licence was set aside, as it can change.

Research agents did the work: one inventoried the code, and others
searched the web for agent harnesses, assistant platforms, memory systems,
gateways and SDKs, and smaller libraries. A second pass on memory
followed the owner's correction of the first (see [Memory](#memory)).
Licences, versions, stars and activity come from the GitHub API and the
npm registry on that day, and a sample was checked again by hand.
Features are each project's own claims, from its docs or source; nothing
was installed or run. *Unverified* marks what could not be confirmed.

## In brief

- Dorothy is meant to be one adaptable assistant whose memory follows her
  to every client and every model. Today she is a Claude-only terminal
  chat and a wrapper around Claude Code: 26,453 lines of source and 30,836
  of tests, 72% of the source in `memory`.
- Her model side is small and fenced: only `agent` (1,073 lines) imports
  the Claude Agent SDK, and memory reaches a model only through core's
  `StructuredCall`. Leaving Anthropic is cheap in code.
- About 5,000 lines exist only for Anthropic: the SDK wrapper, the
  gateway, the `--claude` launcher and hook, and the recording of Claude
  Code's sessions. They go, or shrink to an adapter, once Claude Code does.
- Her agent loop, provider layer and TUI are commodity. pi (MIT,
  TypeScript, embeds in Bun) supplies all three, with per-request model
  routing, MCP, skills, JSONL sessions and hooks on the system prompt and
  compaction; the Vercel AI SDK supplies the provider layer alone. Either
  covers the roadmap's Model Providers phase.
- Her memory is weak where it matters most. Its search is lexical only;
  the block she starts with is notes about past conversations, not
  knowledge of the user; a fact is kept only when the chat model calls
  `remember`; nothing notices a fact that has changed; and nothing has
  ever measured its quality. Some 58% of its 19,085 lines store, guard
  and lock, and some 17% decide what to remember or retrieve.
- What it does well is the archive under it: lossless JSONL transcripts
  with a derived index, a commit per change, and an encrypted off-site
  mirror, which no system surveyed matches.
- The field has moved to hybrid retrieval with extraction and
  consolidation in the background, served to every client over MCP.
  Hindsight (MIT, local models, plugins for most harnesses) has the best
  evidence; OpenViking the clearest layers; EverOS Markdown as its truth.
  The published scores are nearly all the vendors' own.
- Cheap models arrive by protocol rather than software: DeepSeek, Kimi,
  MiniMax, Qwen and OpenRouter serve the Anthropic Messages API, as do
  llama.cpp, vLLM, LM Studio and Ollama locally. Coding plans, and
  featherless.ai's flat-rate plan, forbid the use Dorothy would make of
  them; their pay-as-you-go APIs do not.
- Recommended: keep the archive, put a memory provider over it that every
  client shares, chosen by an evaluation on her own data, and rebuild her
  body on pi. Her agent, TUI, gateway and Claude Code glue retire, and
  some 26,500 lines become perhaps 10,000. The
  [recommendation](#recommendation) gives the order and the
  alternatives.

## What Dorothy is meant to be

From the [objectives](../reports/2026-10-15-objectives.md), the
[roadmap](../roadmap.md) and the owner's own words:

- One Dorothy, adaptable above all: resilient to upstream hindrance
  (vendor policy, quota), remembering and learning, efficient and nimble,
  and extendable so that she can grow.
- Memory first, on the principle "wherever you go, your memory follows
  with you": one memory across her own chat, Claude Code and any later
  client. Nothing is forgotten: a memory fades in rank but stays
  queryable. On 2026-10-18 the owner made this a preference, ranking
  memory's compatibility, access, progressive disclosure and persistence
  above every other constraint ([Memory](#memory)).
- Memory like Hermes Agent's, extensibility like OpenClaw's (its catalogue
  of skills and tools), and reach through chat apps and scheduled runs
  after that.
- Anthropic's models first, falling back to featherless.ai and OpenRouter.
  The owner now weighs dropping Anthropic altogether.
- Her own core, borrowing open formats (`SKILL.md`, MCP) rather than being
  hosted by another project: the ruling of 2026-10-15, which
  [is revisited below](#adopting-a-platform).

The roadmap's work still ahead: memory's layers and learning, Model
Providers (a provider contract, per-role routing, fallback), Dorothy's
Gateway (her persona and memory behind Claude Code, Codex and OpenCode),
upkeep of her vocabulary, topic overviews, learning, a catalogue of
extensions, reach, and embeddings should FTS5 fall short.

## What Dorothy is

A terminal chat over Claude and a wrapper around Claude Code, in seven Bun
workspace packages. Every model call goes through the Claude Agent SDK,
which spawns the Claude Code binary with its tools off, or through Claude
Code itself under `dorothy --claude`.

| Package | Source | Tests | What it does | Tied to Anthropic by |
| --- | ---: | ---: | --- | --- |
| `agent` | 1,073 | 1,433 | The SDK's `query()` with her persona; structured calls; request capture | the Agent SDK and Claude Code binary |
| `gateway` | 419 | 642 | A loopback proxy that puts her identity and memory block in Claude Code's system prompt | the Messages API; Claude Code's prompt |
| `cli` | 1,943 | 2,197 | Modes; the `--claude` launcher, its hooks and settings; credentials | Claude Code's flags and hooks (1,231 lines) |
| `tui` | 2,742 | 3,348 | The Ink chat: Markdown, a multi-line editor, the status line, the raw pane | nothing |
| `core` | 1,124 | 883 | Contracts, `config.toml`, XDG, phrases | nothing (Anthropic-shaped usage fields) |
| `identity` | 67 | 54 | Who she is | nothing |
| `memory` | 19,085 | 22,279 | Everything below | Claude Code's transcripts and memory format |

| Memory part | Source | What it does |
| --- | ---: | --- |
| Notes and reviews | 3,646 | Notes on each conversation (title, sentence, paragraph) written by background reviews; the service, scheduler and wiring around a chat |
| Rank and block | 294 | Salience from visits, recency and appraised reads; the memory block packed into its budget |
| Commands and views | 945 | `--list`, `--memory`, `--tags`, `--edit-tags`, edited in `$EDITOR` |
| Tags | 1,341 | A SKOS-style vocabulary she grows, with merges and tombstones |
| Recall | 2,781 | A derived SQLite FTS5 index of conversations, notes and facts, served over MCP; the cross-process lock and review claims |
| Compaction | 1,533 | Old turns split into topical clusters with abstracts; a verbatim tail; `recollect` |
| Facts | 1,276 | Markdown facts, personal or a project's, with provenance; retired, never deleted |
| Projects | 1,253 | Two-way sync of a project's facts with its repository's `.agents/memory/` |
| History | 3,076 | The data directory as a git repository: a commit per change, lint and heal, two git engines, a mirror of AES-256-GCM sealed bundles |
| Bodies | 2,271 | Claude Code's sessions recorded as her conversations, from its hooks and transcripts |
| Transcripts | 600 | Append-only JSONL, scrubbed of secrets |

For scale: the work took three weeks and 769 commits. `docs/` holds 123
files and 81,422 lines, 62,008 of them plans, and the twelve `AGENTS.md`
files 980 lines: the repository is three times as much prose as code.

What she holds is readable, so any move can take it along:

- transcripts, JSONL with `session`, `user`, `assistant`, `stats`,
  `tool`, `recall` and `compaction` events;
- notes, `<phrase>.meta.json` beside each transcript;
- `tags.json`;
- facts, Markdown with YAML frontmatter;
- `projects.json`;
- the git history and its sealed branch;
- `recall.sqlite`, derived and rebuilt at will.

## Sorting the parts

Each part is one of four kinds:

- **Anthropic glue**: there only because Dorothy runs on the Agent SDK or
  inside Claude Code. It goes with them, or a host's own features replace
  it.
- **Commodity**: what libraries and tools already do, written by hand.
- **Memory's intelligence**: what decides what she remembers and what she
  retrieves. It is Dorothy's own design, which the field does differently
  and, by its published results, better; a provider could replace it.
- **The archive**: what keeps her raw history: transcripts, their
  recording, the git history and its mirror. Nothing surveyed does it
  better, and every option below keeps it.

| Part | Lines | Kind | Replacement | Verdict |
| --- | ---: | --- | --- | --- |
| `agent` | 1,073 | Glue | pi-ai and pi-agent-core, or the AI SDK | Replace |
| `gateway` | 419 | Glue | A host's own prompt control; kept only if Claude Code stays | Retire, or keep for Claude Code |
| `cli`'s Claude Code launcher and hook | 1,231 | Glue | A host's extension API | Retire |
| Bodies' Claude Code reader | ~1,500 | Glue | In-process events under a host; `trajectory` for other harnesses | Retire |
| `tui` | 2,742 | Commodity | pi's TUI, or OpenCode's, Codex's or Cline's | Replace if hosted, else keep |
| `cli`'s modes and arguments | 712 | Commodity | Optique at most | Keep while she has her own CLI |
| History's mirror and seal | ~900 | Commodity | restic or kopia; age for the format | Replace |
| History's isomorphic-git engine | 435 | Commodity | The git binary alone | Remove |
| Hand-written validators | ~750 | Commodity | zod, already in `memory` | Replace |
| Config validation | ~150 | Commodity | zod; smol-toml for line numbers | Replace, optionally |
| Secret scrubbing, locks | 165 | Commodity | Already small; gitleaks' rules as data | Keep, widen the rules |
| Notes, reviews, rank, block | ~3,940 | Intelligence | A provider's observations and standing summaries, or Dorothy improved | Replace if the evaluation agrees |
| Recall's search, tools and rules | ~1,900 | Intelligence | A provider's hybrid search over MCP; `open` stays | Replace if the evaluation agrees |
| Tags | 1,341 | Intelligence | A provider's entities and tags | Retire with the notes |
| Facts | 1,276 | Intelligence | A provider's facts, or EverOS's Markdown | Replace if the evaluation agrees |
| Compaction | 1,533 | Intelligence | A host's compaction hook, a summary tree like lossless-claw's | Keep until a host carries it |
| Projects | 1,253 | Glue to Claude Code's memory format | An export from the provider, or nothing | Keep while Claude Code users matter |
| Transcripts, recording, history's commits, lint and heal | ~3,000 | Archive | None | Keep |
| Recall's index of the archive | ~900 | Archive | None needed | Keep for `open` |

Glue comes to some 5,000 lines, libraries would remove some 2,000 more of
commodity code, and a provider could take some 8,000 of memory's
intelligence. The archive, some 4,000 lines, stays whatever is chosen.

## The options

Three ways to replace what can be replaced, from least change to most.

### A. Keep the design, swap commodity code

Dorothy stays as she is, on the Agent SDK and Claude Code, and her
commodity code goes to libraries: restic, kopia or age for the mirror, the
git binary alone, zod for validators and config, and the MCP SDK's v2. It
removes some 2,000 to 2,500 lines and changes nothing about Anthropic.

A variant leaves Anthropic's models but keeps Claude Code: point the
gateway's upstream (`ANTHROPIC_BASE_URL`, which `upstreamFrom` already
reads) at DeepSeek, Kimi, MiniMax, Qwen, OpenRouter or a local server,
all of which speak the Messages API. The Agent SDK takes the same
variable, so her chat could follow. It is hours of configuration, but
Anthropic "doesn't support routing Claude Code to non-Claude models
through any gateway", Claude Code stays proprietary, and its next release
can break it, as Claude Code 2.1.154 broke validation on vLLM 0.20.1.

### B. A provider-neutral Dorothy on a foundation

Dorothy keeps her archive, identity and contracts and takes the rest from
an open-source foundation. Her memory's intelligence can move to a
provider independently of the body chosen; see [Memory](#memory).

1. **B1, on pi** (recommended): Dorothy becomes a pi package, her identity
   and archive plus an extension. pi brings the provider layer, the agent
   loop, the TUI, JSONL sessions, MCP, skills and ACP; her extension puts
   the persona and memory block in each run's prompt
   (`before_agent_start`), offers her memory, whether her own recall or a
   provider's (`registerMcpServer`), routes each role to its model
   (`registerVirtualModel`), supplies her clusters as the compaction
   (`session_before_compact`), and records and reviews from pi's events.
   `agent`, `tui`, `gateway`, bodies' Claude Code reader and most of `cli`
   go, some 7,000 lines, for an extension of perhaps 1,000; more goes if
   `memory` simplifies once it has one writer.
2. **B2, on the AI SDK, keeping her own chat**: `agent` is rewritten on AI SDK
   7 behind a provider contract in `core`, and the Ink TUI stays. The
   provider layer, structured calls with zod and the tool loop come from
   the SDK, and routing and fallback are a small loop of her own. Glue
   goes, the TUI does not: some 4,000 lines go, and 400 or so come in.
3. **B3, a launcher per host**: `dorothy --claude` is ported to hosts that are
   not Anthropic's. Qwen Code has Claude Code's prompt flags and hook
   events, so the port is nearly line for line; OpenCode takes her as an
   agent file, a plugin and the recall server; Codex as
   `model_instructions_file`, hooks and the recall server. Each host keeps
   its own transcripts, which `trajectory` reads.

### C. Adopt a platform

Dorothy becomes a persona and data imported into a platform that already
has memory, learning, skills and channels: Letta Code, Hermes Agent or
OpenClaw. It replaces the most and loses the most; see
[adopting a platform](#adopting-a-platform).

## Model access

`agent` and `gateway`, and the roadmap's Model Providers and Dorothy's
Gateway.

### Libraries for the model side

| Library | Licence | Version | Fits Dorothy by | Against it |
| --- | --- | --- | --- | --- |
| [Vercel AI SDK](https://github.com/vercel/ai) | Apache-2.0 | 7.0.143 | zod structured output (`Output.object`), middleware, a provider registry, Anthropic at any base URL, OpenAI-compatible and OpenRouter providers, a tool loop | No fallback built in; Node 22 and ESM, Bun unverified; `Output.object` parses free text, less reliable on open models |
| [pi-ai, pi-agent-core](https://github.com/earendil-works/pi) | MIT | 1.3.0 | Anthropic, OpenAI, OpenRouter, Z.ai, Moonshot, MiniMax, Qwen and any OpenAI-compatible server; cost per message; handoff between providers; strict JSON-schema tool calls | TypeBox, not zod; owned by Earendil; offers Claude plan OAuth, which Anthropic's terms forbid |
| [OpenAI Agents SDK](https://github.com/openai/openai-agents-js) | MIT | 0.20.0 | zod, handoffs, sessions | OpenAI first; others through the AI SDK |
| [Mastra](https://github.com/mastra-ai/mastra) | Apache-2.0 and `ee/` | 1.78.0 | A loop with memory, observational memory | 76.7 MB; brings a memory of its own |
| LangChain.js, LangGraph.js | MIT | 1.5 | Broad; summarisation middleware | Heavy |
| `openai`, `@anthropic-ai/sdk` | Apache-2.0, MIT | 7.36.0, 0.135.0 | Each protocol at any base URL | One protocol each |

For comparison, `@anthropic-ai/claude-agent-sdk` is licensed "SEE LICENSE
IN README" and spawns the proprietary Claude Code binary on every call.

### Gateways

Nothing open-source does what `gateway` does: replace one marker in
Claude Code's system prompt and forward everything else byte for byte.
Every router that injects a prompt parses and re-serialises the request,
and the declarative ones only prepend or append. Claude Code's own gateway
guide warns that rewriting `system` defeats its attribution strip and that
allowlisting fields breaks features.

| Gateway | Licence | Language | Speaks | Can inject a prompt | Routing, fallback, budgets |
| --- | --- | --- | --- | --- | --- |
| [LiteLLM](https://github.com/BerriAI/litellm) | MIT and `enterprise/` | Python | Messages, Chat, Responses | `async_pre_call_hook`, reported not to fire on `/v1/messages` | Yes; budgets need Postgres; a credential stealer shipped in PyPI 1.82.7 and 1.82.8 in March 2026 |
| [claude-code-router](https://github.com/musistudio/claude-code-router) v3 | MIT | TypeScript | Messages, Chat, Responses, Gemini | Request rewrites; a system section unverified | Conditions, retries, fallbacks, key limits |
| [Bifrost](https://github.com/maximhq/bifrost) | Apache-2.0 | Go | `/anthropic`, `/openai` | A Go plugin's `PreLLMHook` | Failover; budgets in the open-source build |
| [agentgateway](https://github.com/agentgateway/agentgateway) | Apache-2.0 | Rust | Messages, OpenAI | Declarative prepend or append | Routing, aliases, budgets |
| Agent Router (was Envoy AI Gateway) | Apache-2.0 | Go | Messages to many | At the Envoy level | Failover, quotas |
| Portkey Gateway | MIT | TypeScript | OpenAI | Guardrails only | Fallbacks; sold to Palo Alto Networks, idle since May 2026 |

Archived or idle: TensorZero (archived 2026-06-12), Helicone's gateway
(maintenance mode), y-router (archived, as OpenRouter now serves Claude
Code itself).

OpenRouter is the hosted alternative to running any of them: no markup on
provider prices (5.5% on card purchases), a `models` array for fallback,
`data_collection: "deny"`, and no prompt logging by default.

### Verdict

Under Claude Code, keep `gateway`: it is already provider-neutral on the
Messages API, and no replacement keeps the prompt cache and byte fidelity
it does. Off Claude Code, a host with its own prompt control makes it
unnecessary. Serving Codex would need the Responses API (Codex accepts
only `wire_api = "responses"` since February 2026), and serving OpenCode
needs nothing, as an agent file replaces its prompt.

Replace `agent` with pi-ai (option B1) or the AI SDK (option B2).
Structured calls keep core's `StructuredCall` contract, JSON Schema in and
JSON out. Fallback when a quota runs out is pi's virtual models,
OpenRouter's `models` array, or a try-next loop of a few dozen lines.

## The agent loop, TUI and CLI

`tui`, the rest of `cli`, and the loop inside `agent`.

| Harness | Licence | Runtime | Latest | Stars | For Dorothy |
| --- | --- | --- | --- | ---: | --- |
| [pi](https://github.com/earendil-works/pi) | MIT | TypeScript; its SDK embeds in Node or Bun | 1.3.0 | 116k | A library and a harness: provider layer, loop, TUI, JSONL sessions, extension hooks on the prompt, compaction, tools, MCP, providers and per-request models; OpenClaw and Letta Code are built on it |
| [OpenCode](https://github.com/anomalyco/opencode) | MIT | TypeScript on Bun | 1.19.3 | 215k | An agent file replaces the system prompt; plugins on session events; TUI, server, web, desktop, ACP; sessions in SQLite; its plugin API is being rewritten |
| [Qwen Code](https://github.com/QwenLM/qwen-code) | Apache-2.0 | TypeScript on Node | 0.25.2 | 28.5k | Claude Code's features: `--system-prompt`, Claude-style hooks, auto-memory, skills, MCP, a daemon, channels; an SDK shaped like the Agent SDK's `query()` |
| [Codex CLI](https://github.com/openai/codex) | Apache-2.0 | Rust | 0.163.0 | 130k | `model_instructions_file` replaces the prompt; hooks; JSONL rollouts; Responses API only, so no featherless without a proxy |
| [Goose](https://github.com/aaif-goose/goose) | Apache-2.0 | Rust | 1.55.0 | 55k | Hooks, agents, a chat-recall extension; no documented full prompt replacement |
| [Cline CLI](https://github.com/cline/cline) | Apache-2.0 | TypeScript | 3.0.73 | 70k | `-s` system prompt, cron, connectors for Telegram, Slack, WhatsApp; `@cline/sdk` |
| [Kilo Code CLI](https://github.com/Kilo-Org/kilocode) | MIT | TypeScript | 7.8.12 | 27.6k | OpenCode's fork, with a memory package |
| [Crush](https://github.com/charmbracelet/crush) | FSL-1.1-MIT, not OSI | Go | 0.98.1 | 28.7k | Only a prompt prefix, and `PreToolUse` hooks alone: a weak host |
| [Letta Code](https://github.com/letta-ai/letta-code) | Apache-2.0 | TypeScript, Ink | 0.34.16 | 3.6k | Memory, learning and channels built in; see [adopting a platform](#adopting-a-platform) |

Not candidates: Aider (no release since 2025-08), OpenHands CLI (no
longer maintained), Gemini CLI (Gemini only), Kimi CLI (archived), Amp
(closed source).

For the TUI alone, the libraries leave Ink's chat where it is. Ink 8 still
has no text input; `@inkjs/ui` and `ink-text-input` are single-line;
`marked-terminal` needs an older marked and emits ANSI strings rather than
rows. pi-tui (an editor with kill ring, undo and history; a Markdown
component; differential rendering) is the best match should the TUI be
rewritten, and OpenTUI the next. On Ink, keep it.

For arguments, every parser but one is built on subcommand words, where
Dorothy selects a mode by a leading flag; Optique (`or()` alternatives,
`passThrough()` for `--claude`) is the closest and would save perhaps 100
lines. Keep `args.ts`.

### Verdict

Hosted on pi, `tui` and most of `cli` go, and Dorothy gains coding tools,
skills, MCP and ACP she does not have today. Kept as her own chat, the TUI
and CLI stay; no library replaces the editor or the renderer without a
rewrite.

## Memory

`memory`, 19,085 lines. A first pass of this research asked which
systems could reproduce Dorothy's memory, and found none; but it judged
them by her own design (notes on each conversation, salience from
appraised lookups, the SKOS vocabulary, never deleting, Markdown as the
truth), which tests parity, not quality. The owner then ranked what
memory must do: compatibility (any client, harness and provider), then
access (the right memory reachable when it is needed, from anywhere, and
by the user), then progressive disclosure, then persistence. Every other
constraint is negotiable, "nothing is forgotten" and readable files
included. This section judges by those four.

### Her memory, judged

| Claim | Verdict | Evidence |
| --- | --- | --- |
| Retrieval is lexical only | True | `recall/query.ts` ranks by `bm25()` over three FTS5 tables; nothing embeds, fuses or reranks. The roadmap waits for evidence that FTS5 falls short, which nothing in the repository could produce |
| The block is about conversations, not the user | True | `memory/block.ts` renders only `<conversation>` entries; facts reach her only through recall |
| Facts wait on the chat model | True | `writeFact`'s one caller is the `remember` tool; reviews write notes, tags and appraisals, never facts |
| Nothing handles change | Mostly true | `search` filters by date, and `remember` can retire a fact by hand; nothing detects a contradiction or records when a fact held |
| No learning loop | Mostly true | Appraised reads feed `salience()`; nothing distils lessons or skills |
| Nothing measures it | True | No evaluation or benchmark of memory quality exists in the repository |
| Most of it is machinery | True | Some 11,000 lines (58%) store, guard, lock and ingest; some 3,300 (17%) decide what to remember or retrieve; some 4,800 (25%) are interface and wiring |

What it does well, which the field mostly lacks:

- **A lossless, open archive**: append-only JSONL, with every index
  derived and rebuilt at will, so any layer can be derived again. Most
  systems extract and discard.
- **Persistence**: a commit per change, lint and heal, and an encrypted
  off-site mirror. No system surveyed matches it.
- **A frozen block** that keeps the prompt cache and is never pushed into
  the user's turn.
- **Layers, if narrow**: notes titled, described or in full within a
  budget, then `search`, `open` and `recollect`.
- **Correction**: notes, tags and facts are editable files, and a fact's
  origin is set by code, never read from its text.
- **A label on every lookup**: reviews judge whether each read served her,
  outcome data an evaluation could reuse.

Where it falls behind:

- **Retrieval**: every leading system is hybrid (lexical and semantic,
  often with graph and time) and reranks. On LongMemEval-S one system's
  BM25-only fallback finds the evidence in its top five for 86.2% of
  questions, against 95.2% with hybrid search: lexical search alone
  misses about one question in seven before the model reads anything
  (agentmemory's own figures).
- **What she knows**: a list of past conversations, not a model of the
  user; a preference is found only if she searches with the right words.
- **Writes**: facts wait on `remember`, which models under some 30B
  parameters skip, and nothing updates a fact that has changed, which
  LongMemEval tests directly.
- **Reach**: a stdio process per client over one machine's files, with no
  server for a second device.

### What changed since 2026-10-15

- Letta's Python server is retired: its source "lives in
  `letta-ai/letta-code`".
- mem0 removed OpenMemory and archived `mem0-mcp`: its MCP is hosted only.
- OpenClaw dropped its QMD backend; its built-in engine is the only one.
- supermemory's engine is closed; only its clients are MIT.
- cass is not open source in the OSI sense: its "MIT License (with
  OpenAI/Anthropic Rider)" bars those companies and work "for" them.
- Kuzu is archived, LangMem and Memobase dormant.
- New or newly grown: Hindsight 1.0 (MIT, 2026-10-13), OpenViking 0.5,
  EverOS (EverMemOS renamed), agentmemory, and Letta's
  [`trajectory`](https://github.com/letta-ai/trajectory) (Apache-2.0),
  which turns twelve harnesses' sessions (Claude Code, Codex, OpenCode,
  pi, OpenClaw, Hermes, Gemini CLI, Cursor and others) into one format.

### The architectures

| Family | What it keeps | Examples |
| --- | --- | --- |
| Extracted facts | Atomic facts, deduplicated as they arrive | mem0, supermemory |
| Temporal knowledge graph | Entities and facts, with the window in which each held | Graphiti, cognee, MemOS |
| Layered beliefs | Facts, then consolidated observations, then standing mental models | Hindsight, Honcho |
| Observational log | A dated, prioritised log in place of old messages | Mastra |
| Lossless summary tree | Every message, with a tree of summaries over them | lossless-claw, hermes-lcm; Dorothy's clusters are one level of it |
| Memory files | Markdown the agent edits, versioned in git | Letta, Hermes, OpenClaw, Basic Memory, EverOS |
| Tiered context | An abstract, an overview and the detail of every item | OpenViking |
| Verbatim and an index | Raw text, chunked and searched | MemPalace, memsearch, qmd, Dorothy |

### The systems, scored

Scores run from 1 to 5 on the four priorities. They are the research
agent's judgement from each project's docs: compatibility counts
clients, providers and open formats; access counts retrieval evidence, a
server many clients share, and inspection; disclosure counts layers with
drill-down; persistence counts history, backup and loss.

| System | Licence | Runs as | Compat. | Access | Discl. | Persist. | Note |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| [Hindsight](https://github.com/vectorize-io/hindsight) | MIT | Python server, embedded Postgres; MCP per bank | 4 | 5 | 4 | 3 | Best-evidenced retrieval; 29 providers, local embeddings |
| [OpenViking](https://github.com/volcengine/OpenViking) | AGPL-3.0, with terms in its README | Python server, Rust CLI | 4 | 4 | 5 | 3 | The clearest layers; needs a vision model |
| [EverOS](https://github.com/EverMind-AI/EverOS) | Apache-2.0 | Python; Markdown, SQLite, LanceDB | 4 | 4 | 4 | 4 | Markdown as the truth, reflection; no scores of its own |
| [Graphiti](https://github.com/getzep/graphiti) | Apache-2.0 | Python and a graph database | 3 | 4 | 3 | 4 | The one temporal design; fragile with small models |
| [Honcho](https://github.com/plastic-labs/honcho) | AGPL-3.0 | Python, Postgres, Redis | 4 | 4 | 3 | 3 | Consistent results on cheap models; heavy |
| [agentmemory](https://github.com/rohitg00/agentmemory) | Apache-2.0 | Node server, SQLite | 5 | 4 | 3 | 3 | Native plugins for Claude Code, Codex, OpenCode, OpenClaw, Hermes and pi; young, self-reported |
| Letta's MemFS | Apache-2.0 | Inside Letta Code | 2 | 3 | 4 | 4 | Fine files in git, one harness only |
| Mastra's observational memory | Apache-2.0 | Inside Mastra | 2 | 4 | 3 | 3 | Top LongMemEval score; bound to its framework |
| lossless-claw, hermes-lcm | MIT | Inside OpenClaw, Hermes | 1 | 3 | 5 | 5 | Lossless drill-down, one harness each |
| mem0 | Apache-2.0 | Library or server | 3 | 3 | 1 | 2 | Flat facts; local MCP gone |
| MemPalace | MIT | Python, local | 4 | 3 | 2 | 4 | Verbatim; its claims discredited |
| [qmd](https://github.com/tobi/qmd) | MIT | TypeScript in Bun | 4 | 3 | 1 | 4 | A search engine only, on local models |
| Basic Memory, memsearch | AGPL-3.0, MIT | Python | 4 | 3 | 2 | 4 | Markdown and a hybrid index |
| supermemory | Closed engine | Service | 3 | 4 | 3 | 1 | Fails compatibility |
| Dorothy today | GPL-3.0 | Bun, stdio MCP | 3 | 2 | 3 | 5 | Open files and MCP; one machine, lexical, no model of the user |

### Published results

Nearly all are vendor-reported, with different answering models, judges,
prompts and budgets, so the rows do not compare with one another.

| System | LongMemEval-S | Models | Who reports |
| --- | --- | --- | --- |
| Mastra | 94.87%; 84.23% on gpt-4o | gpt-5-mini answers, gemini-2.5-flash observes | Vendor |
| mem0 | 94.4% (LongMemEval) | Not stated | Vendor |
| Hindsight | 91.4%; 89.0%; 83.6% | gemini-3-pro; GPT-OSS-120B; GPT-OSS-20B | Vendor paper; reproductions claimed, not checked |
| Honcho | 90.4% | gemini-2.5-flash-lite extracts, Haiku 4.5 | Vendor |
| Supermemory | 85.2% | gemini-3-pro | Vendor |
| Zep | 71.2% | gpt-4o | Zep and an academic comparison |
| Full context | 60.2% | gpt-4o | The baseline |

- **LoCoMo decides nothing.** 6.4% of its answers are wrong, a judge
  accepted 62.81% of deliberately wrong answers, and full context once
  beat the systems. Zep's 84% on it was corrected to 75.14% and rerun by
  mem0 at 58.44%; EverMemOS's 92.3% met a user's reproduction at 38.38%.
- **BEAM**, at 1 to 10 million tokens and beyond any context window, is
  the test of years of history. But harnesses have put its metadata into
  the answering prompt, and strict scores fall 20 to 27 points (by
  SurrealDB's count, a competitor's).
- **LongMemEval-S** now fits a frontier context window, so it tests
  selection more than scale. Its multi-session, temporal and
  knowledge-update categories, and MemoryAgentBench's conflict
  resolution, speak to access; nothing scores compatibility, layers or
  persistence.

### The shape to take

Whatever wins, keep Dorothy's archive and put a provider over it:

- Her transcripts, their recording (or `trajectory`, for other harnesses)
  and their history and mirror stay the truth.
- A provider extracts, consolidates and retrieves from them, a derived
  layer as the recall index is today, and every client reaches it over
  MCP. A better model or another provider is then a replay rather than a
  migration, and nothing is lost at the archive even where the provider
  consolidates or forgets.
- Raw episodes stay the bottom layer of disclosure: her `open` by phrase
  and turn is the last step down, which no provider offers.
- Extraction runs in the memory system, so a cheap chat model that never
  calls `remember` no longer starves it.

### The candidates

1. **Hindsight** (MIT, 1.0.0, 50.9k stars).
   - It runs as a user service on one machine, with embedded Postgres, or
     on a home server for several.
   - Every client reaches one bank over MCP or Hindsight's installers for
     Claude Code, Codex, OpenCode and pi, and Hermes takes it as its
     memory provider.
   - A feeder in `memory` retains each conversation as it is recorded:
     the phrase as `document_id`, turns appended with their times.
   - Mental models, read without a model call, become her frozen block;
     observations and facts come on recall; then the stored document;
     then her own `open`.
   - It replaces some 8,000 lines: recall's queries, the notes, reviews,
     block and service, tags, facts and half the commands.
   - Lost: facts as Markdown (export unverified), the vocabulary,
     salience from appraisals, notes the user edits, and the order of
     origins. Re-sending a document deletes what was derived from it
     before reprocessing, so nothing-lost holds only in the archive.
2. **OpenViking** (AGPL-3.0, 0.5.0, 40.2k stars).
   - The clearest layers of any system: an abstract, an overview and the
     detail of every item.
   - Plugins for Claude Code, Codex, OpenCode, pi, OpenClaw and Hermes,
     and memories as editable Markdown.
   - Against it: its README adds to the AGPL that "any wholesale
     rewriting and subsequent re-open-sourcing of this project is
     prohibited", and that translating it needs Volcano Engine's written
     authorisation. It also needs a vision model beside the embedder,
     defaults to Doubao, and its only results are its own LoCoMo runs.
3. **EverOS** (Apache-2.0, 1.4.2, 13.5k stars).
   - Markdown is the truth, with SQLite and LanceDB beside it and a
     watcher that re-indexes hand edits.
   - An offline reflection pass, the learning loop Dorothy lacks, and MCP
     for Claude Code and Codex.
   - Her history could version its directory as it does `facts/`.
   - Against it: no published scores, and its predecessor's disputed one.
4. **Honcho** (AGPL-3.0, 3.3.0).
   - The strongest model of the user, and the most consistent results
     across benchmarks on cheap models.
   - Against it: the heaviest stack (Postgres, Redis), tool calling
     required, and representations rewritten rather than edited.

Graphiti waits in reserve, should the evaluation show that facts which
change are the gap: it alone records when each fact held, but it needs a
graph database and a strong model. agentmemory has the widest native
coverage of harnesses and is worth a look if compatibility decides, but
it is young and its results are its own.

The alternative to beat is **Dorothy improved**: hybrid retrieval
(sqlite-vec in the same `bun:sqlite` index, or qmd with local models),
reviews that extract facts, and the top facts in her block. That is
perhaps 1,000 to 2,000 new lines. It keeps every guarantee, but still
lacks a server for other devices, a model of the user and consolidation.

To move her data into a provider:

- transcripts replay in time order, one document per conversation;
- facts become one document each, tagged with type, scope and project;
- notes, tags and appraisals are not migrated: the provider derives its
  own, and appraised reads become evaluation data;
- `.agents/memory/` is exported from the provider, or dropped.

Extraction and consolidation come to about $0.45 a million transcript
tokens on gemini-2.5-flash-lite, $0.70 on gpt-oss-120b, $1.10 on
deepseek-v3.2 and $4.80 on Haiku 4.5, at OpenRouter's prices that day and
on the agent's assumptions. Embeddings cost almost nothing, or run
locally. Hindsight scores 83.6% with a 20-billion-parameter open model,
though whether that model also extracted is unverified; nothing found
shows 7B or 8B local models writing memory reliably.

### An evaluation before choosing

Proposed, not run, on a copy of her data with every root passed in:

- **Questions**: 250 to 300, in LongMemEval's types:
  - single-session, from her chats and Claude Code sessions;
  - preferences, from her `feedback` and `user` facts, asked indirectly;
  - multi-session, from shared tags or projects;
  - knowledge updates, where her retired facts and fact revisions are the
    ground truth already;
  - temporal, from turn times;
  - abstention, on topics never discussed;
  - and her own past lookups appraised useful or essential: real queries
    with known answers, which no public benchmark has.

  The owner reviews each question, some three to five hours.
- **Systems**: Dorothy as she is, Dorothy improved, Hindsight, OpenViking,
  EverOS and Honcho, each fed by replaying the copy; a grep-only agent and
  full context as bounds.
- **Held constant**: a cheap open and a frontier answering model; two
  ingest models, one of 20 to 30B; one budget of retrieved context and of
  tool calls; no question type disclosed to any prompt.
- **Measured**:
  - accuracy by type, strict and lenient, judged by a third model family
    and checked by hand;
  - evidence recall at 5 and 10;
  - abstention, and how often a superseded fact is stated;
  - tokens, latency, ingest cost and failed writes;
  - two checks: a corrected memory survives re-ingest, and two clients
    write while a second machine reads.
- **Cost**: some $150 to $600 in model calls and two days' work. Dorothy's
  search alone on LongMemEval-S gives a public anchor beside the 86.2% and
  95.2% above.
- **Rule**: adopt a provider only if it beats Dorothy improved by 10
  points of strict accuracy on her own questions, passes both checks, and
  holds with the smaller ingest model.

### The archive's commodity parts

- [restic](https://github.com/restic/restic) (BSD-2, 0.19.1) or
  [kopia](https://github.com/kopia/kopia) (Apache-2.0, 0.23.1) snapshot
  the data directory, `.git` included: encrypted and deduplicated, to many
  backends. Sealing, pushing, scheduling and `--recover` go, but so does a
  git host as the mirror.
- [age](https://github.com/FiloSottile/age) (BSD-3; `age-encryption` on
  npm, pure TypeScript) would keep the git host and give the bundles a
  standard format, opened with `age -d` without Dorothy.
- [git-remote-gcrypt](https://github.com/spwhitton/git-remote-gcrypt)
  (GPL-3.0) re-uploads the whole history on each push to a git host:
  poor for transcripts that only grow. git-crypt leaves names and commit
  messages in clear, and Syncthing's untrusted encryption is in beta.
- Requiring the git binary removes `iso.ts` (435 lines) and the contract
  tests across engines; isomorphic-git already defers to the binary for
  ssh.
- `trajectory` reads other harnesses' sessions, for the day Dorothy
  records more than one body.

### Verdict

The owner is right. Her memory is weak where it matters most, in what it
finds and what it knows, and strong only in the machinery under it. Keep
that machinery as the archive, and replace the intelligence above it by
measurement: Hindsight is the provider to beat, Dorothy improved is the
baseline it must beat, and either way every client reaches her memory
over MCP.

## Smaller libraries

| Area | Dorothy | Best replacement | Saves | Verdict |
| --- | ---: | --- | ---: | --- |
| Config | 389 | zod 4 with `.catch` per field; smol-toml for error lines | ~150 | Optional |
| XDG paths | 29 | None: `xdg-basedir` reads the environment at import, `env-paths` adds `-nodejs` | 0 | Keep |
| On-disk validators | ~750 | zod, which `memory` declares but uses only in its MCP server | ~400 | Replace |
| Fact frontmatter | 515 | `yaml` stringify for the emitter | some | Optional; the canonical form needs control |
| Secret scrubbing | 84 | gitleaks' 222 rules or secretlint's preset, as patterns | 0 | Widen |
| Locks | 81 | Already SQLite's locking; proper-lockfile is weaker | 0 | Keep |
| MCP server | 369 | The SDK's v2 (`@modelcontextprotocol/server` 2.3.1) is the stable line; v1 has fixes until early 2027 | <50 | Migrate |
| Log rotation | 74 | pino-roll | ~50 | Optional |
| `.git/config` parsing | 161 | `git config` once the binary is required | ~100 | Replace with the binary |

## Dev tooling

The tooling is already off the shelf: husky, commitlint, commitizen,
remark, markdownlint, Biome, prettier, yamllint, dotenvx, mise, the
`skills` CLI and the superpowers skills (v6.4.1; v7.0.0 came out on
2026-10-10). The custom parts are small: two scripts, four hooks, two
lint wrappers and the tests that pin the agent assets and the workspace.

Some of it is done twice:

- Markdown is linted by both remark-lint and markdownlint.
- YAML is checked by both prettier and yamllint; prettier stays while
  Biome's YAML support is unfinished.
- The em dash ban is enforced three times: the `lint:emdash` script, the
  pre-commit hook and a Claude Code hook.
- Biome runs twice, `format:check` and `lint`, where `biome ci` would do.
- `.tombi.toml` and `.moxide.toml` configure tools neither `mise.toml`
  nor `package.json` declares.

## Claude Code compatibility

Which candidates work with Claude Code, which use a Claude subscription,
and which need nothing of Anthropic.

| Candidate | With Claude Code | On a Claude plan | Without Anthropic |
| --- | --- | --- | --- |
| Dorothy's `gateway` | Yes, its purpose | Yes, as Claude Code signs in | Yes, any Messages API upstream |
| pi | Reads `CLAUDE.md` | Offers OAuth against Anthropic's terms | Yes |
| OpenCode, Kilo | Read `.claude` skills | No: removed, as prohibited | Yes |
| Qwen Code | Claude-style hooks and flags | No | Yes |
| Codex CLI | `CLAUDE_PLUGIN_ROOT` for plugin hooks | No | Yes, OpenAI or local |
| Goose | Reads `.claude/agents` | Through `claude-acp`, driving Claude Code | Yes |
| Cline, Crush, Letta Code | Crush reads `.claude/skills` | No: API key only | Yes |
| Hermes Agent, OpenClaw | OpenClaw drives Claude Code by plugin | Through Claude Code, metered as programmatic use | Yes |
| AI SDK, pi-ai, LiteLLM, Bifrost | Can sit behind Claude Code | Not for their own calls | Yes |
| trajectory | Reads its sessions | n/a | Yes |
| Hindsight, OpenViking, EverOS, agentmemory, Honcho | Plugins or MCP for it | n/a | Yes, local models included |
| Claude Code itself | n/a | Yes | Officially no; works with Messages API providers |

## Models and policy

### Anthropic's terms

What constrains Dorothy today, as of 2026-10-18:

- Claude Code's
  [legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance)
  says subscription OAuth "is designed to support ordinary use of Claude
  Code and other native Anthropic applications", and that developers
  "building products or services that interact with Claude's
  capabilities, including those using the Agent SDK, should use API key
  authentication".
- Dorothy's chat runs the Agent SDK on `CLAUDE_CODE_OAUTH_TOKEN`. For one
  person's own unshared use that is not clearly forbidden and not
  permitted either; a February 2026 sentence calling it "a violation" is
  gone from the page.
- Since 2026-04-04 subscriptions no longer cover third-party harnesses.
- `dorothy --claude` is on firmer ground: a gateway that sets only
  `ANTHROPIC_BASE_URL` leaves the user's own login in charge, as Claude
  Code's [gateway docs](https://code.claude.com/docs/en/llm-gateway)
  describe.
- Since 2026-10-07 Max plans include $100 or $200 a month of API credits
  that cover the Agent SDK with an API key: a clean footing without
  leaving Anthropic.

### Cheaper models

| Source | Protocol | Note |
| --- | --- | --- |
| [DeepSeek](https://api-docs.deepseek.com/guides/anthropic_api/) | Messages at `api.deepseek.com/anthropic` | `deepseek-flash` $0.15 in, $0.60 out per million off-peak; data held in China (unverified against the policy itself) |
| Moonshot Kimi | Messages at `api.moonshot.ai/anthropic` | Kimi Code plan for coding agents only |
| MiniMax | Messages at `api.minimax.io/anthropic` | M Plan for individual, interactive use |
| Qwen (Model Studio) | Messages | Coding Plan forbids application backends and scripts |
| Z.ai GLM | Messages | Coding Plan only within supported tools |
| [OpenRouter](https://openrouter.ai/docs/faq) | Messages, Chat, Responses | No inference markup; fallback lists; free models at 50 requests a day |
| [featherless.ai](https://featherless.ai/pricing) | Chat Completions only | $25 Chat plan: interactive only, no API traffic or automation; API use is per-token credits from $50; prompts never stored; native tools on few models |
| llama.cpp, vLLM, LM Studio, Ollama | Messages and Chat | Local; no policy or retention but your own |

A persona assistant fits none of the coding plans, and the roadmap's
"fallback to featherless" now means featherless's credits.

### Caveats for open models

- Hermes Agent's docs warn that models under some 30B parameters often
  claim to save a memory without calling the tool; Honcho and Letta
  require tool calling, Graphiti structured output.
- Dorothy's reviews and compaction depend on structured JSON. The AI SDK's
  `Output.object` parses free text, and one report measured 17 successes
  in 20 against 20 for provider-enforced JSON: reviews on a weak model
  need a schema the provider enforces, or retries.
- Prompt caching carries over: her fixed per-launch section is what the
  automatic prefix caches at DeepSeek, Kimi, OpenAI and llama.cpp reward.
  Explicit `cache_control` survives only where the Messages API is
  honoured and forwarded unchanged.

## Adopting a platform

Option C: platforms with a persona, memory, learning, skills and channels
built in, which could replace Dorothy or host her code.

### The objections of 2026-10-15, again

The [objectives](../reports/2026-10-15-objectives.md) ruled out Hermes
Agent and OpenClaw as hosts for three reasons. Without Anthropic:

- **Metering is gone.** Both speak OpenAI-compatible APIs and OpenRouter,
  and both already do what Model Providers plans:
  - Hermes has credential pools, an ordered `fallback_providers` list that
    benches a rate-limited provider, and a cheaper model for each
    background task;
  - OpenClaw rotates auth profiles, walks fallback chains, and takes a
    model per agent and per scheduled job.

  A smaller form of the problem returns. featherless.ai's $25 plan is for
  "interactive, human-driven use by the purchaser" at 32K of context,
  while Hermes needs 64K for tool use. Background reviews, dreaming and
  scheduled runs need a per-token plan.
- **A second memory is gone if Dorothy is replaced, and partly solved if
  she is hosted.**
  - Hermes can switch off its own stores and take one external memory
    provider instead.
  - OpenClaw has an exclusive memory slot, though an open bug lets its
    built-in tools shadow the plugin's
    ([#141806](https://github.com/openclaw/openclaw/issues/141806)).
  - Each still keeps its own session database.
- **Skills outside the repository are partly solved.**
  - Hermes writes new skills to `skills.create_dir`; whether that takes an
    absolute path into a repository is unverified.
  - OpenClaw's own skills still land in its state directory.
  - Letta Code keeps them in its git-backed memory.

Three new objections weigh more once Anthropic is gone:

- **Churn.** OpenClaw ships several releases a day, and Hermes went from
  0.22.0 to 0.22.2 in two days.
- **Supply chain.** ClawHub carried 341 malicious skills among 2,857
  audited early in 2026. It is scanned now, but Unit 42 still found skills
  that slipped past the scans.
- **Open models.** Hermes warns that models under some 30B parameters
  claim to save memories they never save, and Letta that most open-weight
  models do poorly.

### The platforms

| Platform | Licence | Runtime | Latest | Stars | Memory | Reach |
| --- | --- | --- | --- | ---: | --- | --- |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | MIT | Python; an Ink TUI | 0.22.2 | 255k | `MEMORY.md` (2,200 characters) and `USER.md` (1,375), a frozen snapshot; FTS5 search returning raw messages; one external provider (Honcho, Mem0, Hindsight, OpenViking and others); a background review every 10 turns; a skill curator | About 35 chat adapters, cron, an OpenAI-compatible API server |
| [OpenClaw](https://github.com/openclaw/openclaw) | MIT | TypeScript, Node 24+ | 2026.10.4 | 392k | Markdown in a private git workspace; hybrid search; dreaming; a memory flush before compaction; exclusive slots for memory and the context engine | 20+ channels, automations, MCP both ways |
| [Letta Code](https://github.com/letta-ai/letta-code) | Apache-2.0 | TypeScript, Ink | 0.34.16 | 3.6k | Markdown in git, root files in the prompt, dreaming; the agent edits its own persona | Telegram, Slack, Discord, crons |
| [nanobot](https://github.com/HKUDS/nanobot) | MIT | Python | 0.3.5 | 49k | "Dream" consolidation into `USER.md` and `MEMORY.md` | Seven or more channels, cron |
| [SillyTavern](https://github.com/SillyTavern/SillyTavern) | AGPL-3.0 | JavaScript, Node | 1.19.0 | 34.6k | Character cards, lorebooks, a Data Bank, vector storage, a rolling summary; chats in JSONL | None; no MCP |
| [LibreChat](https://github.com/LibreChat-AI/LibreChat) | MIT | TypeScript | 0.8.8 | 45.9k | A key/value notepad within a token limit; summarisation; skills | Web, multi-user |
| [Open WebUI](https://github.com/open-webui/open-webui) | BSD-3 with a branding clause, not OSI | Python | 0.12.3 | 156k | Memory tools the model calls; needs function calling | Web; MCP over HTTP |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | MIT | JavaScript | 1.18.0 | 67k | Up to 20 memories a workspace and 5 global | Telegram, scheduled jobs |
| [LobeHub](https://github.com/lobehub/lobehub) | Derivatives need a commercial licence | TypeScript, Postgres | 2.2.19 | 83k | Structured, editable, not exportable | An IM gateway |

Not candidates:

- nanoclaw runs on the Claude Agent SDK.
- Khoj has had no release since March, and its team promotes Pipali.
- Agent Zero's FAISS memory is opaque.
- Leon 2.0 is a developer preview.
- Msty is closed.
- Jan, big-AGI and oterm have no memory.
- Simon Willison's `llm` is a fine log store but no assistant.
- aichat and Elia are stale.
- AIRI's memory is unfinished.

### What they cover

| Part | Done in full by | In part by |
| --- | --- | --- |
| Persona | Hermes (`SOUL.md`, first in the prompt); OpenClaw (`SOUL.md`, `IDENTITY.md`); SillyTavern | Letta, where it drifts as the agent edits it |
| Memory block | None | Hermes's snapshot; OpenClaw's budgets and dreaming; Letta's root files |
| Notes and reviews | None | Hermes's background review; OpenClaw's daily notes and `DREAMS.md`; Letta's dreaming |
| Tags | None | OpenClaw's Memory Wiki |
| Recall | Hermes; OpenClaw | Letta's `/search` |
| Compaction | OpenClaw with lossless-claw; Hermes with hermes-lcm (a tree of summaries, raw messages kept, expandable) | Their built-in summaries |
| Facts | None | Letta's memory; OpenClaw's files; Hermes's capped files |
| History | None | Letta's git; OpenClaw's workspace in git |
| TUI | Hermes; Letta, both on Ink | OpenClaw |
| Reach | Hermes; OpenClaw; nanobot; LobeHub | Letta; AnythingLLM |
| Learning | Hermes; OpenClaw; Letta | LibreChat |
| Extensions | Hermes's hub (several sources, a scanner, trust tiers); OpenClaw's ClawHub | LobeHub |

### Verdict

1. **Hermes Agent, to replace Dorothy.**
   - It covers the most in full: persona, recall, reach, learning,
     extensions and the TUI.
   - It is built most like her: an Ink TUI, FTS5 recall returning raw
     messages, a forked background review, a frozen snapshot that keeps
     the cache.
   - Its fallback already is the roadmap's Model Providers.
   - Its own memory files are too small for her facts, and it deletes
     entries to fit. Her memory would be an external provider, which it
     takes one of.
   - It is Python, needs 64K of context, and moves fast.
2. **OpenClaw, to host Dorothy's own code.**
   - Its memory and context-engine slots match her packages: her memory
     and compaction become plugins once four `bun:sqlite` imports move to
     Node.
   - Its Markdown workspace in git is the nearest thing to her data
     directory, and it supports featherless.ai natively.
   - Against it: its size and churn, ClawHub, skills written outside the
     workspace, session upkeep that deletes some sessions unless
     configured, and the slot bug.
3. **Letta Code, if files in git matter more than her design.**
   - It gives git-backed Markdown memory, dreaming, skills in git, an Ink
     TUI and channels.
   - Against it: the persona drifts, the cloud is the default, local state
     is not backed up, and its own makers warn about open models.

SillyTavern has the best persona tooling and supports featherless.ai
natively, but serves only as a front end over another back end.

## Recommendation

The owner's priorities put memory's compatibility first, and that sets
the order. Once her memory is a provider every client reaches over MCP,
her body can be pi, Hermes, OpenCode or Claude Code without her memory
moving.

1. **Put her own calls on clean terms.** While Anthropic stays, move
   `agent` from `CLAUDE_CODE_OAUTH_TOKEN` to an API key on the Max plan's
   monthly credits; once it goes, point reviews and compaction at a
   pay-as-you-go open model through OpenRouter. Either is small, and it
   ends the grey zone under Anthropic's terms.
2. **Measure memory before rebuilding it.** Build the
   [evaluation](#an-evaluation-before-choosing): Dorothy as she is,
   Dorothy improved and Hindsight first, then OpenViking, EverOS or Honcho
   as time allows. Two days and a few hundred dollars settle what this
   note can only rank.
3. **Adopt the provider, or improve her own, by its rule.** Either way:
   - the archive stays (transcripts, history, mirror);
   - the mirror moves to restic, kopia or age;
   - the second git engine goes;
   - her validators move to zod.
4. **Rebuild her body on pi.** Dorothy becomes a pi package: her
   identity, the archive's recorder, and an extension that sets her
   persona and block, offers her memory, routes each role to its model
   and supplies her compaction. `agent`, `tui`, `gateway` and the Claude
   Code glue retire, and pi does the roadmap's Model Providers and most of
   Dorothy's Gateway.
5. **Take reach and learning from what was chosen.**
   - Reach: pi-chat and ACP.
   - Learning: the provider's consolidation (Hindsight's observations and
     mental models, EverOS's reflection).
   - Or both from Hermes Agent, as a second body on the same provider.

The end state is perhaps 10,000 lines against 26,500 now, nearly all of
them the archive, the provider's feeder and her pi extension.

The alternatives:

- **If pi is too risky.** It belongs to one company (Earendil), closes
  pull requests from new contributors by default, and has no permission
  sandbox. Rebuild `agent` on the AI SDK instead and keep the Ink chat
  (option B2); the memory steps are the same.
- **If reach and learning outweigh her being her own program.** Use Hermes
  Agent, with Hindsight, Honcho or OpenViking as its memory provider and
  her persona as `SOUL.md`. Her memory stays portable, as the provider
  holds it, not Hermes.
- **If Claude Code is to stay her body.** Keep `gateway` and point it at an
  Anthropic-compatible open model (option A's variant), knowing that
  Anthropic does not support it and a Claude Code release can break it.

What to avoid:

- a third-party gateway as her persona's injector, since none keeps the
  prompt byte for byte;
- coding plans, and featherless.ai's flat-rate plan, for her background
  work;
- cass, whose licence bars Anthropic, OpenAI and work for them;
- supermemory, whose engine is closed;
- OpenViking, until the terms in its README are understood.

This note revises nothing on the roadmap. Should its course be taken:

- Model Providers becomes the adoption of pi or the AI SDK.
- Dorothy's Gateway shrinks to Claude Code alone.
- Dorothy's Memory gains the evaluation and a provider.
- Relations and Embeddings is no longer conditional.

## Not verified

- Bun under AI SDK 7, Mastra, VoltAgent, Letta Code, LanceDB, mem0's
  TypeScript build, Qwen Code's SDK and Hindsight's Node client.
- Whether claude-code-router can inject a system section, and whether
  LiteLLM's pre-call hooks now fire on `/v1/messages`.
- Hindsight:
  - its export and delete APIs;
  - how its mental models stay current;
  - the independent reproductions it claims;
  - whether its 20B result used the 20B model to extract.
- OpenViking's storage, its use of generic OpenAI-compatible endpoints,
  and the legal effect of the terms in its README.
- EverOS's scores, and how its predecessor's disputed result was
  resolved.
- Deletion in claude-mem and memU, custom frontmatter in Basic Memory, and
  whether `trajectory` keeps each line's source id.
- Whether Hermes's `skills.create_dir` takes a path into a repository, and
  whether OpenClaw's skill directory can be moved.
- DeepSeek's privacy policy itself, Kimi K3's prices, and reports of
  changed weekly limits.
- featherless.ai with any candidate.
- Vendors' benchmark scores generally, and every line count, share and
  cost given here, which are estimates.
