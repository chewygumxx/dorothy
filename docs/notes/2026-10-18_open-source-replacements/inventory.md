---
ctime: 2026-10-18
mtime: 2026-10-18
spdx: GPL-3.0-only
title: "Dorothy: internal inventory for replacement analysis"
description: >-
  Dorothy's code, part by part: lines, dependencies, coupling to
  Anthropic, commodity code and data formats.
tags:
  - dorothy
  - notes
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-10-18_open-source-replacements/inventory.md
   -
   -->

# Dorothy: internal inventory for replacement analysis

A research agent's report, kept as it was written apart from its line
wrapping, its em dashes and this header, for the
[note on open-source replacements](../2026-10-18_open-source-replacements.md).

This is a read-only survey of `/home/chewygumxx/dev/dorothy` at `main`
(aeaa30b); nothing was modified. Line counts are raw `wc -l`, so they include
each file's 9-line house header, comments and blank lines. "Test" counts
`*.test.ts(x)` plus test support files (`*testing.ts`, `bodies/fixtures.ts`,
`memory/record.fixture.ts`, `memory/fake-session.ts`, `memory/open-testing.ts`,
`memory/service-testing.ts`). The user's real `$XDG_*` data was not opened; the
formats below come from the code, plus sample data committed in
`docs/reports/2026-10-08-tags/data/dorothy/`.

## 1. Functional components

Paths are relative to `packages/`.

| ID | Component | Files | Src | Test | Third-party / runtime deps | What it does |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | memory: history core | `memory/src/history/{repo,open,binary,iso,history,heal,lint,lock}.ts` | 1,940 | 2,037 | isomorphic-git 1.43.1; `git` binary via `Bun.spawn`; `bun:sqlite` (lock) | Treats `$XDG_DATA_HOME/dorothy` as a git repository. It commits each logical change, first sweeping up edits made outside Dorothy. It lints transcripts, sidecars, facts, `tags.json` and `projects.json`, and restores a broken file from history, keeping a copy in `broken/`. Two interchangeable engines (git CLI isolated from the user's config, or isomorphic-git), chosen once per process. |
| M2 | memory: history mirror + seal | `history/mirror.ts`, `seal.ts` | 381 | 491 | Web Crypto (`crypto.subtle`) | Seals each run of new commits as an AES-256-GCM-encrypted git bundle (`bundles/NNNNNN.enc`) on an orphan `sealed` branch. Pushes that branch to the `mirror` remote at most every `push-seconds`. `recover()` replays the chain. |
| M3 | memory: history commands | `history/commands.ts` | 755 | 640 | @dotenvx/dotenvx | `--history`, `--restore`, `--rollback`, `--check`, `--mirror`, `--recover`. Saves `DOROTHY_MIRROR_KEY` into `.env` with dotenvx `set`. |
| M4 | memory: recall (store, sync, query, server) | `recall/{store,sync,query,facts,tags,remember,server}.ts`, `recall-server.ts`, `sqlite-lock.ts` | 2,781 | 2,929 | `bun:sqlite` (FTS5); @modelcontextprotocol/sdk; zod | Derived SQLite FTS5 index in the cache directory, synced incrementally from transcripts, sidecars, `tags.json` and facts before every query. Offers BM25 `search`, `open`, `tags` and `recollect` over conversations and facts, plus `remember` (writes facts). Served as a stdio MCP server (`dorothy --recall-server`). The index also serves as the cross-process write lock and holds review/compaction claims. |
| M5 | memory: compaction | `compaction/{clusters,plan,compact,run,shared,session}.ts` | 1,533 | 2,680 | none | Past `soft` tokens (at idle) or `hard` (blocking), asks the model to split the turns before a verbatim tail into topical clusters, each with an abstract. Saves them in the sidecar, writes a `compaction` event and swaps in a fresh session seeded with the abstracts and the tail. Handles claims, chains, interrupts and quitting. |
| M6 | memory: facts | `facts/{file,store,commands}.ts` | 1,276 | 1,208 | `Bun.YAML` | One Markdown file per fact with canonical YAML frontmatter, personal or per project. Records provenance and origin; facts are retired and revived, never deleted. CLI `--facts`, `--retire`, `--revive`, `--sync`, `--projects`. |
| M7 | memory: projects sync | `projects/{identify,registry,export,sync}.ts` | 1,253 | 1,777 | `node:crypto` sha256 | Identifies a repository by its normalised `origin` URL. Keeps `projects.json` with per-root, per-directory last-synced hashes. Two-way-syncs project facts with the repository's `.agents/memory/` in Claude Code auto-memory format and regenerates `MEMORY.md`. |
| M8 | memory: notes sidecar | `memory/sidecar.ts` | 703 | 744 | none | `<phrase>.meta.json`: title, description and abstract; pin/hidden; tags; per-field provenance; read appraisals; clusters; review failure back-off. Ownership-aware merge rules and atomic writes. |
| M9 | memory: service, scheduler, track | `memory/{service,scheduler,track}.ts` | 595 | 1,620 | none | `MemoryService` builds the frozen memory block for a session and schedules idle-time reviews (the live conversation first, then a catch-up of stale ones) without blocking chat. `trackMemory` decorates `ChatSession` to surface notices. |
| M10 | memory: reviewer, review | `memory/{reviewer,review}.ts` | 969 | 813 | none | One review: renders the transcript (XML-escaped) with the memory block, then calls `StructuredCall` with a JSON Schema for notes, tags and read appraisals. Merges the result under the lock and commits. |
| M11 | memory: rank, block | `memory/{rank,block}.ts` | 294 | 491 | none | `salience()` (visits weighted by `1+log(1+userTurns)`, plus appraised reads weighted 0/0.5/1/2, each with half-life decay). Tiered packing (full, described, titled) into the token budget. Renders `<memory>` and `<earlier>` blocks. |
| M12 | memory: open, catalogue, preview, record | `memory/{open,catalogue,preview,record}.ts` | 1,379 | 1,699 | none | Orchestration: `openMemory` wires index, history, mirror, compaction, service, project sync and transcript recorder around a chat session. Also the `--dump-context` preview and the catalogue loader. |
| M13 | memory: commands, list, edit-view | `memory/{commands,list,edit-view}.ts` | 945 | 1,102 | none | `--list`, `--memory` (edit one conversation's notes in `$EDITOR` through a text view and its parser), `--tags`, `--edit-tags`. |
| M14 | memory: tags / vocabulary | `memory/{vocabulary,tagging,tags-view}.ts` | 1,341 | 1,108 | none | SKOS-style vocabulary in `tags.json` (`prefLabel`, `altLabel`, `broader`, `scopeNote`, plus deleted/merged tombstones). Reviews coin up to 3 concepts each and tag up to 5 per conversation; checking is lenient. The user edits the tree in `$EDITOR` (rename, merge, reparent, delete). |
| M15 | memory: bodies (Claude Code recording) | `memory/src/bodies/{claude-code,hook,launch,launches,record,unread,log}.ts`, `claude-hook.ts` | 2,271 | 2,008 | none | Records Claude Code sessions into Dorothy's transcripts. Hook entry for `Stop`, `SessionEnd` and detached catch-up; a reader for Claude Code's JSONL; launch notes in the runtime directory; quarantine for unreadable lines; the hook log; the memory block for `dorothy --claude`. |
| M16 | memory: transcript + scrub | `memory/src/{transcript,scrub}.ts` | 600 | 932 | none | Append-only JSONL event log per conversation, with a reader that tolerates torn lines. Regex secret redaction and a 2,000-code-point trim of each side of a tool call. |
| M17 | memory: entry points | `memory/src/{index,commands}.ts` | 69 | 0 | none | Package exports. |
| T1 | tui: markdown | `tui/src/markdown/{render,spans,highlight}.ts`, `Markdown.tsx` | 676 | 443 | marked (lexer only), lowlight, string-width, ink | Renders replies' Markdown to styled terminal rows: lists, quotes, code with a gutter and highlighting, tables with column fitting, grapheme-aware word wrap. |
| T2 | tui: input editor | `editor.ts`, `recall.ts`, `Input.tsx`, `external-editor.ts` | 720 | 623 | ink, react, string-width | Multi-line emacs-style editor (word moves, kill/yank, goal column across wrapped rows), input history, Ctrl+G to `$EDITOR`. |
| T3 | tui: state, layout, statusline, screen | `state.ts`, `layout.ts`, `statusline.ts`, `App`, `Header`, `History`, `LiveReply`, `RawPane`, `run-app`, `index` | 1,346 | 2,282 | ink, react, string-width | Pure reducer over `ConversationEvent`s, minimum-size layout, configurable status line (tokens, cache, TTFT, cost), streaming reply, raw-message pane. |
| G1 | gateway | `gateway/src/{anthropic,server,index}.ts` | 419 | 642 | none (`Bun.serve`, `fetch`, `Bun.gunzipSync`) | Loopback proxy in front of the Anthropic API for `dorothy --claude`. On `/v1/messages` and `/count_tokens` it replaces a marker in `system` with Dorothy's identity and memory block, preserving `cache_control`. Everything else passes byte for byte. |
| A1 | agent: conversation, one-shot | `agent/src/{conversation,one-shot,index}.ts` | 616 | 833 | @anthropic-ai/claude-agent-sdk ^0.3.302 | `ChatSession` over one long-lived SDK `query()` in streaming-input mode. Maps `text_delta`, MCP `tool_use`/`tool_result` and result usage/cost into events. Also one-shot printing. |
| A2 | agent: structured | `structured.ts` | 141 | 211 | claude-agent-sdk | `StructuredCall`: a one-shot `query()` with `outputFormat: {type:"json_schema"}`, timeout, abort and cost. |
| A3 | agent: persona | `persona.ts` | 216 | 286 | claude-agent-sdk (types); `Bun.hash` | Composes the system prompt (identity, capabilities, plumbing, memory; chat or `--dev`). Builds SDK base options and the CLI environment; `promptHash` (xxh3). |
| A4 | agent: capture | `capture.ts` | 100 | 103 | claude-agent-sdk; `Bun.serve` | A fake Messages endpoint that records the first request body, for `--dump-context`. |
| I1 | identity | `identity/src/*.ts` | 67 | 54 | none | Fixed text: identity, voice, provenance. |
| C1 | cli: args, index | `cli/src/{args,index}.ts` | 585 | 602 | @dotenvx/dotenvx; `node:util` `parseArgs` | Maps flags to modes and runs them lazily. Decrypts `.env` for credentials. |
| C2 | cli: Claude launcher | `cli/src/{claude,claude-dump,recall-launch}.ts` | 966 | 1,092 | spawns external `claude` | `dorothy --claude`: starts the gateway and launches Claude Code with base URL, marker, MCP config, merged settings (permissions, hooks) and session id. Handles signals, catch-ups and dump mode. |
| C3 | cli: claude-hook | `cli/src/claude-hook.ts` | 245 | 328 | @dotenvx/dotenvx | `--claude-hook` entry: strips Claude Code's environment, loads Dorothy's `.env` by path, runs memory's hook with the agent's `structuredCall`. |
| C4 | cli: run-tui, dump | `cli/src/{run-tui,dump}.ts` | 147 | 175 | none | Wires `openMemory`, `Conversation` and `runApp`; `--dump-context`. |
| K1 | core: config | `core/src/config.ts` | 389 | 360 | `Bun.TOML` | Reads `config.toml` with per-key validation and warnings. |
| K2 | core: xdg, session-id, timers | `xdg.ts`, `session-id.ts`, `timers.ts`, `types/niceware.d.ts` | 138 | 154 | niceware | XDG base directories, 4-word niceware conversation "phrases", UUID guard, injectable timers. |
| K3 | core: contracts | `core/src/contracts/*.ts`, `index.ts` | 597 | 369 | none | `ChatSession`/`ConversationEvent`, `SessionStart`, `StructuredCall`, `Notice`, `Editor`, recall tool names, shapes and lookups. |

## 2. Coupling to Anthropic and Claude Code

| Component | Level | Mechanism |
| --- | --- | --- |
| A1–A4 agent | **SDK-level and Claude-Code-specific** | `query()` from `@anthropic-ai/claude-agent-sdk` (`conversation.ts:16`, `structured.ts:15`, `one-shot.ts:11`, `capture.ts:11`), which spawns the SDK's bundled `claude` binary. Options include `tools: []`, `settingSources: []`, `persistSession: false` and `includePartialMessages` (`persona.ts:147-161`). Environment sets `CLAUDE_CONFIG_DIR=$XDG_CACHE_HOME/dorothy/claude`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and `DISABLE_COMPACT=1` (`persona.ts:176-190`). Recall is wired through `mcpServers`/`allowedTools` (`conversation.ts:155-170`). It parses `stream_event`/`text_delta`, Anthropic `tool_use`/`tool_result` blocks, `compact_boundary`, `result.total_cost_usd` and Anthropic `usage` fields (`conversation.ts:282-530`). The persona's "plumbing" component tells the model to ignore the identity line and per-turn system message the CLI injects. Structured output uses `outputFormat: json_schema` (`structured.ts:67`). Capture emulates Anthropic's error JSON and sets `ANTHROPIC_BASE_URL` (`capture.ts`). |
| G1 gateway | **Protocol-level (Anthropic Messages API) plus Claude-Code-specific** | Matches `POST …/v1/messages(/count_tokens)` (`server.ts:41`); default upstream `https://api.anthropic.com` (`server.ts:14`); `upstreamFrom` reads `ANTHROPIC_BASE_URL`. Rewrites `system` as a string or block array, moves `cache_control`, places her identity after the `x-anthropic-billing-header:` block Claude Code sends (`anthropic.ts:17`, `:124-131`), handles gzip bodies and sends an SSE `error` event when the upstream cuts off (`server.ts:111`). The marker `<!-- dorothy:identity -->` arrives through Claude Code's `--append-system-prompt`. |
| C2 Claude launcher | **Claude-Code-specific** | Claude Code CLI flags `--append-system-prompt`, `--mcp-config`, `--settings`, `--session-id`, `-r/--resume`, `--continue`, `--from-pr` (`claude.ts:132-215`). `Stop` and `SessionEnd` hooks running `dorothy --claude-hook` (`hookSettings`, `claude.ts:227`). `permissions.allow` for `mcp__dorothy-memory__*` (`claude.ts:717`). Environment sets `ANTHROPIC_BASE_URL`, `ENABLE_TOOL_SEARCH=1`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and `DOROTHY_LAUNCH` (`claude.ts:735-742`); `CLAUDE_CONFIG_DIR` defaults to `~/.claude` (`claude.ts:246`). |
| C3 claude-hook | **Claude-Code-specific** | Strips `ANTHROPIC_BASE_URL`, `ENABLE_TOOL_SEARCH`, `DOROTHY_LAUNCH`, `CLAUDECODE` and every `CLAUDE_CODE_*` variable (`claude-hook.ts:27-40`). |
| C1, C4 | Protocol (auth) / SDK, transitively | Credentials are `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` in the dotenvx-encrypted `.env`. C4 instantiates `Conversation` and `dumpRequest`. |
| M15 bodies | **Claude-Code-specific** | Reads Claude Code's undocumented JSONL transcripts at `$CLAUDE_CONFIG_DIR/projects/*/<session>.jsonl` (`hook.ts:437-439`). Maps line types `user`, `assistant`, `attachment` and `system`; passes over a 20-type `BOOKKEEPING` list (`claude-code.ts:25-46`); interprets Claude Code markup such as `<command-name>`, `<bash-input>` and `<local-command-stdout>`. Hook stdin JSON is `{hook_event_name, session_id, transcript_path, cwd}` (`hook.ts:123-135`). Unknown shapes halt reading and are quarantined. |
| M7 projects | **Claude Code file format** | `export.ts` writes Claude Code's auto-memory form (`name`, `description`, `metadata.type`) and a `MEMORY.md` index capped at `INDEX_LIMITS {lines: 200, bytes: 25_000}` (`export.ts:98`), matching what Claude Code loads. The memory directory is `.agents/memory`, else `.claude/memory` (`registry.ts:194`). It accepts Claude Code's one-line index entries (`export.ts:181`). The sync algorithm itself is provider-free. |
| M6 facts | Format only | Fact types `user`, `feedback`, `project`, `reference` are Claude Code auto-memory's (`file.ts:17`; `docs/specs/2026-10-15-memory-store-design.md:79`). |
| M4 recall | Protocol-level (MCP, an open standard) | `McpServer` and `StdioServerTransport` (`server.ts:12-13`, `:365`). Tool names follow the `mcp__<server>__<tool>` convention (`core/src/contracts/recall.ts:23`), with a second server name, `dorothy-memory`, for Claude Code. `DOROTHY_LAUNCH` excludes the live Claude Code session (`server.ts:345`). |
| K3 contracts | Weak, protocol-level | `RawMessage` mirrors the SDK message shape (`type`, `subtype`, `event.delta`). `TurnStats` carries Anthropic-style cache read/write tokens and `costUsd`; `ready` carries `sdkSessionId`. |
| M16, M12 | Weak | `source: "claude-code"`, `sourceSession` and `sourceUuid` fields (`transcript.ts:24-38`, `:440`). Scrub has an `sk-ant-` pattern. `open.ts:691-709` refuses to resume a Claude Code conversation. |
| M1–M3, M5, M8–M11, M13, M14 | **None** | The model is reached only through core's `StructuredCall` (system, prompt and JSON Schema in; JSON, model and `costUsd` out). Implicit assumptions: USD cost is reported by the provider, and tokens are estimated as characters/4 (`rank.ts:96`). Compaction exists because the CLI's own compaction is switched off. |
| T1–T3 tui | None (weak) | Structural `ChatSession` only. The raw pane labels messages by SDK type/subtype; the status line's `cache-read`/`cache-write` modules follow Anthropic usage fields. |
| K1, K2, I1 | None | `identity` deliberately names no host or provider. |
| Agent tooling | Claude-Code-specific | `.claude/settings.json` (Claude Code plugins and marketplace). `scripts/agent-memory.ts` writes `autoMemoryDirectory` into `.claude/settings.local.json`. `.agents/memory/` is in auto-memory format. Skills are installed for `--agent claude-code codex`. |

## 3. Commodity vs Dorothy-specific

| Component | Commodity (hand-rolled where named) | Dorothy-specific |
| --- | --- | --- |
| M1 history core | Auto-commit of a data directory (`history.ts`), git wrapper (`binary.ts`), second engine (`iso.ts`), lock (`lock.ts`), file validation and restore (`lint.ts`, `heal.ts`), pre-commit hook installation | A lint that knows each file kind; adopting outside edits as user-authored and rewriting them canonically; a fact's provenance decides authorship on sweep |
| M2 mirror | Encrypted off-site backup: `seal.ts` and `mirror.ts` | None of substance |
| M3 commands | git log, checkout and revert front-ends; key storage | `--check` reporting unread Claude Code lines and hook errors |
| M4 recall | FTS5 schema and triggers (`store.ts`), incremental indexing of append-only files by size and inode (`sync.ts`), BM25 queries with snippets (`query.ts`), MCP serving | Tag-filtered search through SKOS `broader` closure (`recall/tags.ts`); visibility rules (hidden conversations, the live one excluded); read events recorded for later appraisal; facts ranked live before retired and own project before others; `recollect` over clusters |
| M5 compaction | Token thresholds, a JSON-Schema-validated LLM call | Topical clusters chosen by the model, each with an abstract, stored permanently and reopenable; seeding a fresh session from abstracts plus a verbatim tail; claims shared with reviews |
| M6 facts | Frontmatter writer and reader (`file.ts`), file store, per-key type checks | Origin trust order (external < repo < dorothy < user, `nextOrigin`); retire, never delete; review-written facts |
| M7 projects | Three-way sync against a recorded base hash (`sync.ts`, `registry.ts`), git config parsing (`identify.ts`), path-escape guards | Scope isolation (a personal fact never exported); repository wins a conflict; per-root and per-directory base records; `MEMORY.md` ownership detection |
| M8–M11, M13 memory | Atomic JSON writes, validation, job queue (`scheduler.ts`), `$EDITOR` round-trip formats (`edit-view.ts`), token estimate | Self-authored notes with per-field ownership; appraisal of each read (none, slight, useful, essential); salience with half-life decay; tiered budget packing; idle-time reviews and catch-up |
| M14 tags | Text-view editor and parser (`tags-view.ts`) | SKOS vocabulary grown by the model during reviews, with coined-concept limits, tombstones that block re-coining, merges, and cycle checks |
| M15 bodies | Log rotation (`log.ts`), runtime notes, process liveness | Mapping Claude Code sessions into one memory with chat; halt-and-quarantine of unread lines |
| M16 transcript | JSONL append log, secret redaction (`scrub.ts`) | Event vocabulary (recall offsets inside a reply, compaction events) |
| T1 / T2 / T3 | Markdown-to-ANSI, line editing, status bar, layout | None; ordinary chat UI |
| G1 gateway | Reverse proxy with request-body rewrite | Identity and memory injection that keeps the prompt cache |
| A1–A4 | LLM client streaming, structured output, request capture | The persona text |
| C1–C4, K1–K3 | Argument parsing, TOML config, XDG, ids, deep JSON merge (`mergeJson`, `claude.ts:286`), private temp files (`privateWriter`, `claude.ts:74`) | Contracts (`ChatSession`, `StructuredCall`) |

## 4. Notable hand-rolled implementations

| Path | Lines | What is hand-built | Well-known equivalents |
| --- | --- | --- | --- |
| `memory/src/history/seal.ts` + `mirror.ts` | 123 + 258 | AES-256-GCM sealing of git bundles. Header `dorothy-sealed 1\n<b64 nonce>\n` used as AAD; sealed bundles on an orphan branch pushed to a remote; chain replay on recovery | git-remote-gcrypt, git-crypt, restic/borg/kopia, age |
| `memory/src/history/iso.ts` | 435 | Second git engine; writes and reads the **git v2 bundle format by hand** over isomorphic-git `packObjects` (`iso.ts:257-330`) | git CLI only; dugite |
| `memory/src/history/binary.ts` | 472 | git CLI wrapper isolated from user config (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM`, a scrub list of `GIT_*` variables, its own credential helper, ssh BatchMode) | simple-git, dugite |
| `memory/src/history/history.ts` + `heal.ts` + `lint.ts` | 593 + 123 + 138 | Auto-commit per change, sweep, pre-commit hook in the data directory, lint-and-restore with `broken/` copies | etckeeper, gitwatch, git-auto-commit |
| `memory/src/sqlite-lock.ts` + `history/lock.ts` | 41 + 40 | Cross-process locks via SQLite `BEGIN IMMEDIATE` (a SQLite file at `.git/dorothy.lock`); claims are leases in the `claims` table | proper-lockfile, flock |
| `memory/src/recall/{store,sync,query}.ts` | 350 + 550 + 966 | FTS5 index, incremental syncer, query language (`termsOf` quoting, `query.ts:88`), token-budgeted context windows | SQLite FTS5 is the engine. Alternatives: Orama, MiniSearch, Tantivy, Meilisearch; memory layers such as mem0, Letta, Zep/Graphiti |
| `core/src/config.ts` | 389 | Hand-written TOML schema validator (`parseTable`/`FieldSpec`, `readModules`, `readMaxLines`) over `Bun.TOML`; finds the error line by re-parsing prefixes (`config.ts:315`) | zod or valibot (zod is already a dependency of agent and memory), ajv |
| JSON validators | about 190 in `sidecar.ts:199-390`; about 140 in `vocabulary.ts:295-436`; `registry.ts:142` (`parseRegistry`); `launches.ts` (`isLaunchNote`, `isSessionNote`); `facts/file.ts:185-470` | Manual `isRecord` and type guards for every on-disk format. memory declares zod but uses it only in `recall/server.ts` | zod, valibot |
| `memory/src/facts/file.ts` | 515 | YAML frontmatter emitter written by hand (`renderFact`, `file.ts:142`; folded `>-` blocks via `wrap`) and splitter (`splitFrontmatter`, `file.ts:93`); parsed with `Bun.YAML`; hidden-character checks | gray-matter, `yaml` stringify |
| `tui/src/markdown/` | 367 + 168 + 99 (+ 42 `Markdown.tsx`) | Terminal Markdown renderer over marked's lexer: lists, quotes, code gutter, tables with water-fill `fitColumns` (`render.ts:176`), entity decoding, grapheme word-wrap, hast-to-ANSI walk of lowlight output | marked-terminal, cli-highlight, glow/glamour, ink-markdown |
| `tui/src/editor.ts` + `recall.ts` + `Input.tsx` + `external-editor.ts` | 228 + 58 + 378 + 56 | Multi-line readline/emacs editor in Ink: word moves, kill ring, goal column across wrapped rows, input history, `$EDITOR` | readline, ink-text-input / @inkjs/ui (single-line), prompt_toolkit-style editors |
| `memory/src/scrub.ts` | 84 | Secret redaction regexes (PEM blocks, bearer tokens, provider key prefixes, `key=value` pairs) | secretlint, gitleaks rules, detect-secrets |
| `memory/src/bodies/log.ts` | 74 | Append log with single-file rotation at 1 MB | pino + pino-roll, rotating-file-stream |
| `memory/src/projects/identify.ts` | 161 | Parses `.git/config` `[remote "origin"]` by hand, following `gitdir`/`commondir` | isomorphic-git `getConfig` (already a dependency), ini, git-url-parse |
| `memory/src/projects/sync.ts` + `registry.ts` | 607 + 263 | Three-way file sync against base hashes, with re-read-before-overwrite | unison, csync-style reconcilers |
| `memory/src/memory/edit-view.ts`, `tags-view.ts` | 341, 596 | Custom text formats for `$EDITOR` round-trips, with parsers | YAML/TOML edit buffers (kubectl edit style) |
| `memory/src/memory/sidecar.ts:409` `writeAtomic`; `scheduler.ts` | ~15; 129 | Temp file plus rename; single-concurrency priority queue | write-file-atomic; p-queue |
| `memory/src/memory/rank.ts:96` (also `agent/src/conversation.ts`) | 1 | Token estimate as characters/4 | provider tokenizers, `count_tokens` |
| `gateway/src/server.ts` | 214 | Reverse proxy: hop-by-hop header stripping, abort propagation, 502 in the API's shape, SSE cut handling | LiteLLM proxy, claude-code-router, http-proxy-middleware |
| `agent/src/capture.ts` | 100 | Fake API endpoint that captures a request | mitmproxy, SDK debug logging |
| `cli/src/args.ts` | 398 | `COMMANDS` table over `node:util` `parseArgs` | commander, citty, yargs |

## 5. Data formats on disk

### `$XDG_CONFIG_HOME/dorothy/config.toml`

- Tables `[statusline]` and `[reply-stats]`: `modules`, `max-lines`.
- `[memory]`: `enabled`, `recall`, `budget`, `idle-seconds`, `half-life-days`,
  `catch-up`.
- `[compaction]`: `enabled`, `soft`, `hard`, `tail`.
- `[history]`: `enabled`, `push-seconds`.

**`$XDG_DATA_HOME/dorothy/`** (the history root: a git repository, mode 0700)

- **`transcripts/<phrase>.jsonl`**, mode 0600, append-only. A phrase is 4
  niceware words joined by `-`. One JSON object per line, each with `v:1`,
  `kind` and `at` (ISO time):
  - `session`: `{phrase, sdkSessionId, model, promptHash:"xxh3:<16hex>",
    resumed, source?:"chat"|"claude-code", sourceSession?, project?}`
  - `user`: `{text}`
  - `assistant`: `{text, interrupted}`
  - `stats`: `{inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens,
    ttftMs, durationMs, costUsd, sessionCostUsd}`
  - `tool`: `{name, input, output, ok, cut:{input,output}, memory?}`
  - `recall`: `{id, ok, offset, tool:"search"|"open"|"recollect"|"tags", …lookup
    fields}`
  - `compaction`: `{through, clusters}`
  - Lines recorded from Claude Code also carry `sourceUuid`.
- **`transcripts/<phrase>.meta.json`** (the sidecar), pretty-printed and written
  atomically via `<path>.<hex>.tmp` and rename:
  - `{v:1, rev, title, description, abstract, pinned, hidden, tags, titles,
    fields, reviewedThrough, reviewCostUsd, compactionCostUsd, appraisals,
    failures, clusters}`
  - `title`, `description`, `abstract` are capped at 60, 160 and 1000 code
    points.
  - `tags`: concept ids matching `k[0-9a-f]{8}`, at most 5.
  - `titles`: `[{title, at, by}]`.
  - `fields`: per field (`title`, `description`, `abstract`, `tags`),
    `{by:"prompt"|"dorothy"|"user", at, model?, throughTurn?}`.
  - `appraisals`: `{<tool call id>:
    {served:"none"|"slight"|"useful"|"essential", at, model}}`.
  - `failures`: `{count, at}` or null.
  - `clusters`: `[{from, through, abstract, at, model}]`.
- **`tags.json`**: `{v:1, rev, concepts:{<kid>: …}}`, where each value is one
  of:
  - a concept: `{prefLabel, altLabel[], broader[], scopeNote,
    by:"dorothy"|"user", at, model?, edited}`
  - a deletion: `{deleted, labels[]}`
  - a merge: `{mergedInto, at}`
- **`facts/personal/<name>.md`** and
  **`facts/projects/<host>/<path…>/<name>.md`** (or `local-<12hex>`). Canonical
  frontmatter:
  - `name`, `title` and `description` (folded `>-`)
  - `metadata: {type: user|feedback|project|reference, …extra}`
  - `tags: [kid]`, `importance?`
  - `provenance: {origin: external|repo|dorothy|user, by:
    dorothy|user|review|repo, at, created, model?, from?}`
  - `retired?: {at, by, why}`
  - then a Markdown body of at most 8,000 characters.
- **`projects.json`**: `{v:1, projects:{<id>:{name, roots[], memoryDir,
  synced:{<root>:{last:<dir>, dirs:{<dir>:{<fact name>:<sha256>}}}}}}}`.
- **`.gitignore`** (`*.tmp`) and **`broken/<path>/<UTC stamp>`** (copies of
  files that failed lint).
- **`.git/`**:
  - branch `main`;
  - orphan branch `sealed`, holding a README and `bundles/000001.enc`, … Each
    `.enc` file is `"dorothy-sealed 1\n" + base64(12-byte nonce) + "\n"`
    followed by the AES-256-GCM ciphertext of a git v2 bundle (header
    authenticated as AAD);
  - ref `refs/dorothy/sealed-through`; remote `mirror`;
  - `hooks/pre-commit` marked `# dorothy pre-commit`;
  - `dorothy.lock` (SQLite).
- The key, `DOROTHY_MIRROR_KEY` (base64 of 32 bytes), lives in the
  dotenvx-encrypted `.env`.

### `$XDG_CACHE_HOME/dorothy/`

- **`recall.sqlite`**: derived and rebuildable (WAL, `user_version = 5`).
  Tables:
  - `conversations`: `phrase`, `t_size`, `t_ino`, `sessions`, `turns`,
    `s_mtime`, `sidecar` status JSON, `title`, `description`, `abstract`,
    `hidden`, `source`, `project`, `first_at`, `last_at`
  - `turns(phrase, n, role, at, text)`, `visits(phrase, n, user_turns, last_at)`
  - `reads(id, reader, target, at)`, `appraisals(reader, id, served)`
  - `claims(phrase, owner, until)`: live leases, the only state not derived from
    files
  - `conversation_sessions(session, phrase)`, `clusters(phrase, n, first_turn,
    last_turn)`
  - `vocabulary(singleton: mtime, broken)`, `concepts(id, label, alt JSON,
    scope_note)`, `labels(norm, id)`, `broader(id, parent)`, `merged(id,
    into_id)`, `tagged(phrase, n, id)`
  - `facts(path, scope, name, title, description, type, body, origin,
    importance, created, retired, mtime)`, `fact_tags(path, n, id)`
  - External-content FTS5 tables `turns_fts`, `notes_fts` and `facts_fts`,
    tokenizer `porter unicode61 remove_diacritics 2`, kept in step by triggers.
- **`claude/`** (0700): the private `CLAUDE_CONFIG_DIR` and working directory of
  the SDK's bundled Claude Code. It holds Claude Code's own state.
- **`claude-hook.log`** (+ `.1`), rotated at 1 MB.

**`$XDG_STATE_HOME/dorothy/`** (directories 0700, files 0600)

- `unread/<session>.json`: the halt record.
- `unread/<session>.jsonl`: the Claude Code transcript from the halting line on.
- `unread/types/<type>.jsonl`: one example line per unknown line type.
- `unread/types.json`: the types already reported.
- `notices.jsonl`: messages hooks leave for the next start.

**`$XDG_RUNTIME_DIR/dorothy/`** (falls back to the cache directory for launches,
and to `/tmp/dorothy-<uid>` for settings files)

- `launches/<launch uuid>/launch.json`: `{v:1, launch, pid, started, dir,
  session|null, claude}`.
- `launches/<launch>/sessions/<session uuid>.json`: `{v:1, session, transcript,
  cwd, seen, ended?}`.
- `settings-<uuid>.json` (0600): the merged Claude Code `--settings`, removed
  when `claude` exits.

### Repository side

- `<repo>/.agents/memory/<name>.md`: exported form with frontmatter `name`,
  `description`, `metadata` only.
- `MEMORY.md`: entries of the form `- [Title](./name.md)` followed by a
  description indented two spaces.

## 6. Scale

| Package | Src lines | Test lines | .ts/.tsx files | AGENTS.md lines |
| --- | --- | --- | --- | --- |
| memory | 19,085 | 22,279 | 137 | 344 (4 guides) |
| tui | 2,742 | 3,348 | 32 | 67 |
| cli | 1,943 | 2,197 | 15 | 128 |
| core | 1,124 | 883 | 17 | 67 |
| agent | 1,073 | 1,433 | 10 | 92 |
| gateway | 419 | 642 | 5 | 75 |
| identity | 67 | 54 | 3 | 53 |
| **Total** | **26,453** | **30,836** | 219 | 826 |

- Root test files add 722 lines: `agents.test.ts` 565 (which tests the agent
  assets), `workspace.test.ts` 129, `test-setup.ts` 28.
- memory is 72% of the source. Only `agent` (1,073 src lines) imports the Claude
  Agent SDK.
- **docs/**: 123 tracked files, 81,422 lines.
  - `plans/`: 15 files, 62,008 lines.
  - `reports/`: 79 files, 8,084 lines (includes probe data).
  - `specs/`: 15 files, 6,515 lines.
  - `notes/`: 8 files, 3,953 lines.
  - `deferred/`: 4 files, 473 lines.
  - `roadmap.md`: 335 lines; `docs/AGENTS.md`: 54.
  - `README.md` is 346 lines. All 12 tracked AGENTS.md files total 980 lines.
- **Agent tooling** (tracked):
  - `.agents/memory/`: 8 files, 235 lines. The only tracked skill is
    `.agents/skills/worktrees/SKILL.md` (92 lines).
  - Other skills are not tracked:
    - Ten superpowers v6.4.1 skills are symlinked from `node_modules`.
    - `compact-summary`, `find-skills`, `herdr` and `i-have-adhd` are fetched
      per `skills-lock.json`.
  - `.claude/`: `settings.json` (27 lines) and a `skills/worktrees` symlink.
  - `scripts/`: 2 files, 123 lines (`agent-memory.ts` 95, `prepare.sh` 28).
  - `skills-lock.json`: 112 lines.
  - `.husky/`: 4 hooks, 100 lines. `.github/`: 4 files, 106 lines.
  - Untracked local tool directories: `.superpowers/` (47 files, 25,103 lines)
    and `.remember/` (2,131 files).
