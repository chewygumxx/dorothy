---
ctime: 2026-10-18
mtime: 2026-10-18
spdx: GPL-3.0-only
title: "Cross-harness tooling and how memory reaches each harness (2026-10-18)"
description: >-
  rulesync in depth, other cross-harness tools, and how memory reaches
  each harness today: the mechanisms, a matrix by harness, existing memory
  tools' adapters and recording routes.
tags:
  - dorothy
  - memory
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-18-protocol-diversity/cross-harness.md
   -
   -->

# Cross-harness tooling and how memory reaches each harness (2026-10-18)

A research agent's report, kept as it was written apart from its line
wrapping, its em dashes and this header, for the
[protocol diversity minutes](../2026-10-18-protocol-diversity.md).

Research of 2026-10-18. Builds on `8-langchain-and-standards.md`,
`7-memory-architectures.md` and `4-memory.md` without repeating them.
Nothing was installed or run; repositories were shallow-cloned to
`/tmp/claude-probe/clones/` and read. *Unverified* marks what was not
confirmed.

## Bottom line

- **rulesync is the right generator and a fragile dependency.** MIT,
  1.16M downloads a month, a programmatic API and the most detailed
  per-host knowledge found (a hook matrix of 50-odd events). But it has one
  owner
  (about 90% of commits), 21 major versions in 29 days, a closed target
  enum with no plugin point, and a stated policy that "persona files stay
  hand-authored". Use it pinned, behind a `--check`, and write the
  persona slots beside it.
- **A subagent can be the persona in two hosts only**: Claude Code's
  `--agent`, whose prompt "replaces the default Claude Code system prompt
  entirely", and an OpenCode primary agent. Codex, Hermes, OpenClaw and
  Qwen Code need bespoke writers.
- **No other generator, MCP manager or hook manager changes that.**
  add-mcp is the best MCP installer, skillshare and ai-rulez the nearest
  rivals; there is no cross-harness hook manager at all.
- **Memory reaches every harness through five mechanisms**: one MCP
  server, one per-host budgeted block (Claude-shaped hooks or a static
  file), four in-process adapters (OpenCode, Hermes, OpenClaw, DSH),
  transcript readers triggered by hooks, and an ACP client for what
  Dorothy launches.
- **Hindsight's MIT adapters are the best base** for the in-process
  four; Letta's `trajectory` for parsing transcripts; deja-vu for which
  store each host keeps.
- **The design risks are cache placement, duplicate recording, exclusive
  slots and rulesync owning whole settings keys**, more than any missing
  capability.

## 1. rulesync in depth

Read at commit `f38fece` (2026-10-18) of
[dyoshikawa/rulesync](https://github.com/dyoshikawa/rulesync), cloned to
`/tmp/claude-probe/clones/rulesync`. Paths below are relative to it.

### Source format

- **Layout.** `rulesync.jsonc` (targets, features, `global`, `delete`,
  `sources`, `inputRoots`) over a `.rulesync/` tree: `rules/*.md`,
  `commands/*.md`, `subagents/*.md`, `skills/<name>/SKILL.md`,
  `hooks.jsonc`, `mcp.jsonc`, `permissions.jsonc`, `checks/*.md`, and the
  deprecated `.aiignore` (`docs/reference/file-formats.md`). Several input
  roots overlay in order (`.rulesync`, `.rulesync.local`), later winning
  per relative path (`src/index.ts`, `inputRoots`). Symlinks are followed.
- **Rules.** Frontmatter `root` (one root file per tool), `localRoot`
  (`CLAUDE.local.md`, `.qwen/QWEN.local.md`), `targets`, `description`,
  `globs`, plus per-tool blocks (`agentsmd.subprojectPath`, `cursor`,
  `kiro.inclusion`, `factorydroid.channel`, `qoder.channel`). A rule's
  body is free Markdown.
- **Subagents, commands, skills.** Markdown with a canonical frontmatter
  and per-tool passthrough sections; skills follow Agent Skills, with root
  `license`, `compatibility`, `metadata`, `disable-model-invocation`,
  `user-invocable` mapped per tool.
- **Hooks.** `{"version":1,"hooks":{"sessionStart":[...]}}` in canonical
  camelCase events (`sessionStart`, `beforeSubmitPrompt`, `stop`,
  `preCompact`, `postCompact`, `sessionEnd` and some forty more), each a
  `command` with optional `matcher`, translated per tool: PascalCase into
  settings files for Claude Code, Codex, Qwen Code and Goose; a generated
  JavaScript plugin (`.opencode/plugins/rulesync-hooks.js`) for OpenCode
  and Kilo; native snake_case under `hermesagent.hooks` for Hermes. The
  generated event-by-tool matrix is copied to `raw9-rulesync-hook-matrix.md`.
- **MCP.** `mcpServers` with tool-scoped blocks (`codexcli.mcpServers`),
  `enabledTools`/`disabledTools`, transports, Codex `envVars`.
- **Permissions.** One `permissions.jsonc` with per-tool blocks.
- **Simulated modes.** `--simulate-commands|subagents|skills` folds those
  features into the rules file as prose ("`s/your-command`", "Call
  your-subagent") for hosts without the native feature; project scope only
  (`docs/guide/simulated-features.md`). Today only the `agentsmd` target
  is marked 🎮 (`docs/reference/supported-tools.md`).
- **Scope.** `--global` (or `"global": true`) writes user scope
  (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.agents/skills/`),
  honouring tool homes such as `HERMES_HOME` over `outputRoots`. In global
  mode `delete: true` sweeps *every* unknown skill in shared directories
  like `~/.claude/skills/`; the default `false` coexists with other
  installers (`docs/guide/global-mode.md`).

### Output for the named hosts

"Owns key" means the file is shared and merged: rulesync replaces only
the named top-level keys and leaves the rest
(`src/features/shared/shared-config-gateway.ts`, `SHARED_CONFIG_OWNERSHIP`).
Single-purpose files (rule files, agent, command and skill files) are
overwritten; with `delete` their orphans are swept.

| Host | Rules | MCP | Subagents | Hooks | Skills, commands | Persona |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | `CLAUDE.md`, `.claude/rules/*.md`, `CLAUDE.local.md`; global `~/.claude/CLAUDE.md` | `.mcp.json`; global `~/.claude.json` | `.claude/agents/*.md` (frontmatter incl. `memory`, `hooks`, `mcpServers`, `initialPrompt`) | `.claude/settings.json`, owns `hooks` whole | `.claude/skills/`, `.claude/commands/` | None; `outputStyle` is listed only as a dangerous override key (`claudecode-permissions.ts:840`) |
| Codex CLI | `AGENTS.md` root and nested (32 KiB budget); global `~/.codex/AGENTS.md` | `.codex/config.toml`, owns `mcp_servers` | `.codex/agents/*.toml` with `developer_instructions` | `.codex/hooks.json` | `.agents/skills/`; prompts global only | No `model_instructions_file` anywhere in `src/` |
| OpenCode | `AGENTS.md`; global `~/.config/opencode/` | `opencode.json(c)`, owns `mcp` | `.opencode/agents/<name>.md`, `mode` defaults to `subagent`, overridable | Generated `.opencode/plugins/rulesync-hooks.js` (V1 plugin API) | `.opencode/skills/`, `.opencode/commands/` | Via a subagent with `opencode.mode: primary` |
| Hermes Agent | `.hermes.md` (project only) | Global `~/.hermes/config.yaml`, owns `mcp_servers` | Generated Hermes plugins under `$HERMES_HOME/plugins`, `rulesync/` | `config.yaml`, owns `hooks` | `$HERMES_HOME/skills/` | `SOUL.md` "is an agent-identity slot, not user rules" (`hermesagent-rule.ts:28`), untouched |
| Qwen Code | `QWEN.md`, `.qwen/QWEN.local.md` | `.qwen/settings.json` or `.mcp.json` | `.qwen/agents/` | `.qwen/settings.json` | `.qwen/skills/`, `.qwen/commands/` | None |
| DeepSeek Harness | `AGENTS.md` root and nested; global `~/.dsh/AGENTS.md` | Global only, `~/.dsh/cordis.patch.yml` through `@deepseek-ai/dsh-mcp-client` | n/a | n/a | `.dsh/skills/` | None |
| OpenClaw | Root `AGENTS.md` (project, folded); global `~/.openclaw/workspace/AGENTS.md` | n/a | n/a | n/a | n/a | "Persona files stay hand-authored" ([#3052](https://github.com/dyoshikawa/rulesync/issues/3052)) |
| Goose | `.goosehints`; global `~/.config/goose/` | Global `config.yaml` `extensions`; project an open-plugin `.agents/plugins/rulesync/.mcp.json` | `.goose/agents/` | `.agents/plugins/rulesync/hooks/hooks.json` | `.goose/skills/`; commands as recipes | None |
| Letta Code | **None** (no rules target) | n/a | `.letta/agents/` | `.letta/settings.json` | `.agents/skills/`, global `~/.letta/skills` | None |

### Can a subagent be the host's persona?

- **Claude Code: yes.** A `.claude/agents/dorothy.md` run as
  `claude --agent dorothy`, or set by the `agent` setting, has its prompt
  "replace the default Claude Code system prompt entirely, the same way
  `--system-prompt` does"; `CLAUDE.md` still loads, and the agent's
  `memory` field adds "the first 200 lines or 25KB of `MEMORY.md`" to it
  ([sub-agents](https://code.claude.com/docs/en/sub-agents)). rulesync
  writes the agent file but not the `agent` key, which a launcher passes
  as `--agent`.
- **OpenCode: yes**, through `opencode.mode: primary` on a rulesync
  subagent; agent prompts replace the system prompt
  (`2-harnesses.md`, OpenCode).
- **Codex: no.** rulesync's Codex agents are `.codex/agents/*.toml` roles
  for delegation; the main persona slot `model_instructions_file` in
  `config.toml` is not written.
- **Hermes, OpenClaw: no.** Their persona slots (`SOUL.md`, `IDENTITY.md`,
  `USER.md`) are deliberately left alone.
- **Qwen Code, Goose:** an agent file is a subagent; the persona needs
  Qwen's `--system-prompt` flag or Goose's own mechanism (*unverified*
  whether a Goose agent can be the main one).

### API and extensibility

- **API.** `generate`, `importFromTool` and `convertFromTool` are the
  named exports, with `targets`, `features`, `inputRoots`, `outputRoots`,
  `global`, `delete`, `dryRun`, `check`; results carry
  `keyOperationsByFeature` and `deletedPathsByFeature`, and `generate()`
  reports unreadable sources on the result instead of throwing
  (`docs/api/programmatic-api.md`). The package is dual ESM and CJS
  (`package.json`). It also ships one-tool MCP server, `rulesyncTool`,
  for agents to edit the tree (`docs/reference/mcp-server.md`).
- **No plugin point.** `ToolTarget` is a closed `z.enum` derived from
  per-feature tuples (`src/types/tool-targets.ts`); a new target or
  feature means a new `src/features/<feature>/<tool>-<feature>.ts`,
  tests, a registration in the processor, docs tables and e2e coverage
  (`CONTRIBUTING.md`, "How to Add Support"). So: upstream, or fork.
  Writing persona files *beside* rulesync, from the same source tree,
  needs no change to it.
- **Persona requests.** No issue or discussion asks for persona,
  `SOUL.md`, `IDENTITY.md` or a system-prompt feature (searches for
  "persona", "system prompt", "SOUL", "IDENTITY.md", "output style",
  "model_instructions_file"; 9 discussions, none on it). The maintainer's
  own OpenClaw proposal rules persona files out, and Qoder and Factory
  Droid "output style" channels exist only as non-root rules
  ([#3421](https://github.com/dyoshikawa/rulesync/issues/3421)).

### Import

`rulesync import --targets <tool>` (and `importFromTool`) reads a host's
files back into `.rulesync/`, per feature, project or global; `convert`
goes host to host without the tree (`docs/reference/cli-commands.md`).
The README claims import for every tool; I did not test round-trips, and
Hermes's are the only ones the docs say are covered by tests
(`docs/reference/supported-tools.md`, "Hermes Agent compatibility").

### Health

| Measure | Value | Source |
| --- | --- | --- |
| Licence | MIT | `gh api repos/dyoshikawa/rulesync` |
| Adoption | 1,530 stars, 166 forks; npm 1,163,468 downloads last month | GitHub API; [npm API](https://api.npmjs.org/downloads/point/last-month/rulesync) |
| Contributors | 94; `dyoshikawa` 4,180 commits, `cm-dyoshikawa` 2,390 and `dyoshikawa-claw` 61 (apparently the same owner's accounts), next human 100 | `gh api .../contributors` |
| Releases | 37.1.0; **21 majors in 29 days** (v16.39.1 on 2026-09-19 to v37.1.0 on 2026-10-17) | `gh api .../releases` |
| Tests | 560 test files, about 282k lines of tests to 210k of source; vitest unit and e2e configs | `find src -name '*.test.ts'` |
| Governance | Owner with "full authority"; collaborators at the owner's discretion | `GOVERNANCE.md` |
| Bus factor | **One.** About 90% of commits are the owner's accounts; AI agents (`claude`, 174) are the next largest committers | contributors list |

Verdict: adopt as a generator behind a pinned version and Dorothy's own
`check` run, never as her only definition. Its daily breaking majors and
single owner are the main risk; its exhaustive per-host knowledge (the
hook matrix alone) is the main value.

## 2. Other cross-harness tools

Stars, licence, contributors and latest release from `gh api repos/<x>`
(script `/tmp/claude-probe/scripts/repostat.sh`); downloads for the last
month from `api.npmjs.org` and `pypistats.org`; host lists from each
README, saved under `raw9/readmes/`. Sorted by adoption within each group.

### Config generators and syncers

| Tool | Licence | Stars, contributors | Downloads/month | Latest | Hosts and features | Against rulesync |
| --- | --- | --- | --- | --- | --- | --- |
| [vercel-labs/skills](https://github.com/vercel-labs/skills) (`npx skills`) | MIT | 35,394; 157 | 23.8M | v1.7.2, 2026-10-09 | Skills only, most hosts | Covered in report 8; a subset, but the de facto skill installer |
| [Ruler](https://github.com/intellectronica/ruler) | MIT | 2,947; 29 | 308k | v0.3.44, 2026-06-30 | Rules, MCP, skills, subagents for ~33 agents, Goose, Qwen and OpenCode included; no Hermes, OpenClaw, DSH or Letta | Subset; no hooks or permissions |
| [skillshare](https://github.com/runkids/skillshare) | MIT | 2,802; 27 | n/a (Go binary) | v0.25.13, 2026-10-16 | Skills, agents, rules, MCP, hooks, "to all AI CLI tools"; an `mcp serve` mode | Closest rival in scope; younger, one maintainer; per-host depth *unverified* |
| [rulesync](https://github.com/dyoshikawa/rulesync) | MIT | 1,530; 94 | 1.16M | 37.1.0, 2026-10-17 | Section 1 | n/a |
| [vibe-rules](https://github.com/FutureExcited/vibe-rules) | MIT | 528; 3 | 42k | none; pushed 2025-08-21 | Rules from npm packages into editors | Dormant |
| [rulebook-ai](https://github.com/botingw/rulebook-ai) | MIT | 609; 6 | n/a | none; pushed 2025-10-03 | Rule packs incl. a Memory Bank layout | Dormant |
| [ai-rulez](https://github.com/Goldziher/ai-rulez) | MIT | 163; 7 | 26k | v5.5.1, 2026-10-18 | "52 built-in harnesses": rules, skills, agents, commands, hooks, permissions, MCP; drift checks, SBOM, an MCP server serving skills on demand | Same ambition, far smaller user base |
| [block/ai-rules](https://github.com/block/ai-rules) | Apache-2.0 | 139; 10 | n/a (Rust) | v1.7.0, 2026-05-11 | Rules, commands, skills, MCP for 11 agents incl. Goose | Subset; stalled since May |
| [agnostic-ai](https://github.com/Chemaclass/agnostic-ai) | MIT | 25; 8 | 4.4k | v0.85.0, 2026-10-15 | Agents, skills, rules, hooks, capabilities | Small |

AGENTS.md generators (`agents-md-generator` and the like, under 100
stars each) write repository documentation for coding agents and do
nothing for a persona.

### MCP configuration managers

| Tool | Licence | Stars, contributors | Downloads/month | Latest | What it does | For Dorothy |
| --- | --- | --- | --- | --- | --- | --- |
| [add-mcp](https://github.com/neon-solutions/add-mcp) | Apache-2.0 | 314; 10 | **759k** | v2.4.1, 2026-09-29 | Writes one server into 22 hosts' native files, project or global: Claude Code, Codex, Goose, OpenCode, Cline, Kilo, Gemini CLI, Antigravity, Pi, Zed and others | The best one-shot installer; lacks Hermes, Qwen Code, DSH, OpenClaw, Letta. rulesync's `mcp.jsonc` covers more |
| [ToolHive](https://github.com/stacklok/toolhive) | Apache-2.0 | 2,291; 135 | n/a (Go) | v0.54.0, 2026-10-14 | Runs MCP servers in containers and auto-connects clients (Claude Code, Cursor, Copilot, VS Code) | A runtime and registry, enterprise-shaped |
| [MetaMCP](https://github.com/metatool-ai/metamcp) | MIT | 2,711; 34 | n/a (Docker) | v2.4.22, 2025-12-19 | Aggregator, middleware, gateway | Quiet since 2025-12 |
| [Docker MCP gateway](https://github.com/docker/mcp-gateway) | MIT | 1,603; 38 | n/a | no release | `docker mcp` CLI and gateway with client connect | Docker-bound |
| [mcpm](https://github.com/pathintegral-institute/mcpm.sh) | MIT | 1,015; 40 | 8.7k (PyPI) | v2.15.0, 2026-05-22 | Global install with profiles; client integration for Claude Desktop, Cursor, Windsurf and more | Desktop-client oriented |
| [Smithery CLI](https://github.com/arcadeai-labs/smithery-cli) | **AGPL-3.0** | 843; 23 | 25k | v1.2.0, 2026-05-31 | Install from Smithery's registry; the repo now sits under Arcade | Registry-bound |
| [1MCP](https://github.com/1mcp-app/agent) | Apache-2.0 | 518; 18 | 5.6k | v0.39.3, 2026-10-15 | One aggregating server for all clients | Pattern: one endpoint instead of N configs |
| [mcp-hub](https://github.com/ravitemer/mcp-hub) | MIT | 521; 9 | 2k | v4.2.1, 2025-08-22 | Central manager, Neovim-first | Dormant |
| [MCP Router](https://github.com/mcp-router/mcp-router) | NOASSERTION | 2,135; 8 | n/a | v0.6.4 | **Archived 2026-09-18** | Dead |

None needs a manager for Dorothy: her memory is *one* server. Writing it
into each host is rulesync's `mcp` feature (or add-mcp as a fallback), and
reaching it from many devices is a matter of serving it over Streamable
HTTP, which every host above accepts.

### Hook managers

There is no widely adopted package whose purpose is hooks across
harnesses; a search found none above a handful of stars. Hooks travel
three ways instead:

- **Generators**: rulesync (the widest event matrix), ai-rulez,
  skillshare, agnostic-ai.
- **The Claude plugin format reused**: Codex's hook engine "injects
  `CLAUDE_PLUGIN_ROOT` into hook subprocesses", so agentmemory, claude-mem
  and episodic-memory ship one `hooks.json` to both
  (`clones/agentmemory/README.md`, "Codex CLI";
  `clones/episodic-memory/README.md`).
  Qwen Code and Letta Code accept the same Claude shape
  (`raw9/qwen-hooks.md`; rulesync `src/types/hooks.ts`, Letta).
- **Open Plugins hooks**: Goose reads `.agents/plugins/<name>/hooks/hooks.json`
  ([goose
  hooks](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/context-engineering/hooks.md));
  Agent Plugins 1.0 leaves hooks out (report 8).

### Cross-harness memory and context packages not in reports 4 and 7

- [context-mode](https://github.com/mksglu/context-mode): **30,545
  stars**, 112 contributors, 99k npm downloads, but **Elastic License
  2.0**, not open source. Sandboxes tool output and keeps a session event
  log in SQLite for continuity across compaction, wired into 17 hosts by
  native hooks or plugins (Claude Code, Gemini CLI, Copilot, Cursor,
  OpenCode, Kilo, OpenClaw, Codex, Kimi, Qwen Code, Kiro, Pi) and MCP-only
  where a host has no hooks (Antigravity IDE, Zed). Its README notes that
  "OpenCode lacks a real SessionStart hook" and uses
  `experimental.chat.system.transform` instead. Borrow its per-host
  wiring notes; avoid the code on licence.
- [deja-vu](https://github.com/vshulcz/deja-vu): MIT, Go, 1,237 stars,
  55 contributors, v0.22.2 (2026-10-17). Indexes the session files 42
  harnesses already write (Hermes, OpenClaw, opencode and Kilo through
  their SQLite stores, DeepSeek Harness through zstd), then serves MCP
  recall, "auto-recall" hooks, a skill and handoff. It claims 97.2% R@5
  on LongMemEval-S (vendor). The widest *reader* of native transcripts
  found, and the proof that recording by transcript needs no hooks at
  all.

### Conventions adopted across tools

- **Cline Memory Bank**: a `memory-bank/` folder of six Markdown files
  (`projectbrief.md`, `productContext.md`, `activeContext.md`,
  `systemPatterns.md`, `techContext.md`, `progress.md`) driven by a
  custom instruction, "I am Cline ... my memory resets completely between
  sessions" ([Cline docs](https://docs.cline.bot/best-practices/memory-bank),
  [cline/prompts](https://github.com/cline/prompts/blob/main/.clinerules/memory-bank.md)).
  Copied into Roo, Kilo and rulebook-ai. It is project state, written by
  the agent and read as rules: no retrieval, no user model, merge
  conflicts when committed
  ([fast.io](https://fast.io/resources/cline-claude-code-memory-comparison/)).
  For Dorothy it is a static-file target at most.
- **`.agents/`**: `.agents/skills/` (Codex, Letta Code, by rulesync's
  paths) and `.agents/plugins/` (Goose) are becoming the shared home.
- **`MEMORY.md` with a line budget**: Claude Code's subagent memory loads
  "the first 200 lines or 25KB"
  ([sub-agents](https://code.claude.com/docs/en/sub-agents)); OpenClaw
  loads `MEMORY.md` in private sessions; Hermes bounds `MEMORY.md` and
  `USER.md` (report 4). A small, curated index file in the prompt and the
  rest on demand is the one memory pattern every host already has.

### Verdict for section 2

rulesync stays the generator. Keep add-mcp in reserve for hosts rulesync
lacks, take the `npx skills` layout for skills, and read deja-vu and
context-mode for per-host wiring facts. Nothing here generates personas.

## 3. How memory reaches each harness

### 3.1 Mechanisms

Into the model, from the most static to the most dynamic:

1. **Generated static files** in the host's always-loaded slots
   (`AGENTS.md`, `CLAUDE.md`, `SOUL.md`, `USER.md`, `MEMORY.md`,
   `.goosehints`). Read once per session, so cache-stable; stale until
   regenerated; capped per host.
2. **MCP server `instructions`** in the initialize result: a short static
   pointer every MCP host may show. Claude Code puts it in a
   system-reminder in the first user turn, cut at 2,048 characters
   ([DEV](https://dev.to/rulestack/20-of-20-runs-sent-serverdiscover-to-our-stdio-mcp-server-off-by-default-per-the-docs-and-its-12m2));
   Codex uses it as the tool namespace's description; Kimi Code and Claude
   Desktop ignore it
   ([kimi-code#4142](https://github.com/MoonshotAI/kimi-code/issues/4142),
   [claude-code#43749](https://github.com/anthropics/claude-code/issues/43749)).
   Secondary sources; *partly unverified*.
3. **Session-start injection** by hook or plugin: fresh per session,
   stable for its length, and re-fired after compaction where the host
   passes a `compact` source.
4. **Per-turn injection** (`UserPromptSubmit`, `pre_llm_call`,
   `before_prompt_build`, Goose's Top Of Mind): relevant recall each turn.
   Cache-safe only if it lands in the user turn, not the system prompt.
5. **Compaction hooks**: before (flush, or block), after (re-inject), or
   owning compaction outright (OpenClaw's context engine, OpenCode's
   `output.prompt`).
6. **MCP tools** for on-demand recall and writes: universal, but used only
   when the model chooses to.
7. **A host memory-provider slot**: Hermes's `MemoryProvider` and
   OpenClaw's `plugins.slots.memory`; both exclusive.

Out of the host, for recording:

- **Stop, turn-end and session-end hooks**, usually as a trigger to read
  the transcript the hook names.
- **Transcript files and stores** read by a watcher or on demand.
- **OpenTelemetry** export.
- **An ACP client** that launches the harness and reads `session/update`.
- **The proxy's view** of model traffic, for hosts pointed at Dorothy's
  gateway by a base URL.

### 3.2 Matrix

Sources: Claude Code [hooks](https://code.claude.com/docs/en/hooks) and
[sub-agents](https://code.claude.com/docs/en/sub-agents); Codex
[hooks](https://learn.chatgpt.com/docs/hooks); OpenCode
`raw9-opencode-plugins.mdx`
and `raw9-opencode-migrate-v1.mdx` (from
[anomalyco/opencode](https://github.com/anomalyco/opencode)); Hermes
`raw9/hermes-*.md` (from
[hermes-agent
docs](https://github.com/NousResearch/hermes-agent/tree/main/website/docs));
OpenClaw `raw9/openclaw_*.md` (from
[openclaw/openclaw docs](https://github.com/openclaw/openclaw/tree/main/docs));
Qwen Code `raw9/qwen-hooks.md`; Gemini CLI
[hooks
reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md);
Goose
[hooks](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/context-engineering/hooks.md)
and [Top Of Mind](https://goose-docs.ai/docs/mcp/tom-mcp/); Cline,
Antigravity, Kilo and Letta Code from rulesync's `src/types/hooks.ts` and
`src/features/hooks/`; DeepSeek Harness from the claude-mem, memsearch
and OpenViking plugins (DSH's own source was not found; npm
`@deepseek-ai/dsh` 0.2.0-rc.2, MIT); ACP from
[agentclientprotocol.com](https://agentclientprotocol.com/overview/agents);
stores from deja-vu's table (`raw9/readmes/vshulcz_deja-vu.md`) and Letta
[trajectory](https://github.com/letta-ai/trajectory). "n/f" means not found.

#### Into the model

| Harness | Static slots and limits | Session start | Per turn | Compaction | Provider slot |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `CLAUDE.md` (or `AGENTS.md`); `--system-prompt`, `--append-system-prompt`; `--agent` prompt replaces the system prompt; agent `memory` loads `MEMORY.md` to 200 lines or 25KB | `SessionStart` `additionalContext`, sources `startup`, `resume`, `clear`, `compact`, `fork`; 10,000 characters per string, beyond that a file path and a 2,000-character preview | `UserPromptSubmit` `additionalContext` "alongside the submitted prompt"; same cap | `PreCompact` can block, injects nothing; `PostCompact` no decision; re-inject through `SessionStart` `compact` | None (plugins) |
| Codex CLI | `AGENTS.md` (32 KiB); `model_instructions_file` (report 2); agent roles' `developer_instructions` | `SessionStart` `additionalContext`, "added as extra developer context"; same five sources; about 2,500 tokens by default, `additionalContextLimit` per handler, `0` unlimited | `UserPromptSubmit` `additionalContext` as developer context | `PreCompact`, `PostCompact` inject nothing; `compact_prompt` config | None (plugins reuse Claude's `hooks.json`) |
| OpenCode | `AGENTS.md`; a primary agent's prompt replaces the system prompt | No true `SessionStart` (context-mode README); `session.created` is an observer | V1 `chat.message`, `experimental.chat.system.transform` (edits the system prompt per request); V2 `ctx.session.hook("prompt")`, `hook("context")` | V1 `experimental.session.compacting` adds context or replaces the prompt; V2 `hook("compaction")` | None. **"V1 plugin implementations do not run in V2"** |
| Hermes Agent | `SOUL.md` slot 1 (report 8); `.hermes.md`; `MEMORY.md` 2,200 and `USER.md` 1,375 characters, a frozen snapshot | Provider `system_prompt_block()`; plugin `register_system_prompt_section`, 4,000 characters each, 8,000 in all, frozen per session | `pre_llm_call` returns joined "into the user message"; provider `prefetch()` before each API call, safety ceiling 100,000 characters | Provider `on_pre_compress(messages)`, fail-closed checkpoints | **Yes, one external provider**, additive to built-in |
| OpenClaw | `SOUL.md`, `IDENTITY.md`, `AGENTS.md`, `USER.md` (4,000), `MEMORY.md` (private sessions only); 20,000 per file, 60,000 in all | Memory capability `promptBuilder` lines in the system prompt; `session_start` | `before_prompt_build` returns `prependContext` (user turn), `prependSystemContext` or `appendSystemContext`; needs `allowConversationAccess` and `allowPromptInjection` | Context-engine slot owns `compact()`; `after_compaction` | **Yes, `plugins.slots.memory`** and `plugins.slots.contextEngine`, each exclusive |
| Qwen Code | `QWEN.md`; `--system-prompt`, `--append-system-prompt` (report 2) | `SessionStart` (Claude shape), sources `startup`, `resume`, `clear`, `compact` | `UserPromptSubmit`; `additionalContext` documented on tool events, prompt events *unverified* | `PreCompact`, `PostCompact` | None |
| DeepSeek Harness | `AGENTS.md`, `~/.dsh/AGENTS.md`; persona slot n/f | Cordis plugin `agent/created`, then `agent.inject(userMessage)` (claude-mem `src/integrations/dsh-plugin/hooks.ts`) | `agent/pre-step`, appended "as a durable message" (OpenViking) | `compaction/start` | In-process Cordis plugins; no memory slot found |
| Goose | `.goosehints`; recipes | **None**: hooks have no context channel | Top Of Mind extension: `GOOSE_MOIM_MESSAGE_FILE` or `_TEXT` each turn, 64 KB per source, environment only ([#11972](https://github.com/aaif-goose/goose/issues/11972)) | No events | None (MCP extensions) |
| Gemini CLI | `GEMINI.md`; `GEMINI_SYSTEM_MD` override (report 2) | `SessionStart` `additionalContext`, "the first turn in history" | `BeforeAgent` `additionalContext`, "for this turn only" | `PreCompress`, advisory only | None |
| Antigravity CLI | Rules and skills (rulesync `antigravity-cli`) | No `SessionStart` | `PreInvocation`; context field *unverified* | n/f | None |
| Cline | `.clinerules/`; Memory Bank convention | `TaskStart`, `TaskResume` with `contextModification` | `UserPromptSubmit` with `contextModification` | `PreCompact` | None |
| Kilo CLI | `AGENTS.md` | As OpenCode (generated `.kilo/plugins/`, "one event surface" with OpenCode) | As OpenCode | As OpenCode | None |
| Letta Code | MemFS root files in every prompt; no rules target in rulesync | `SessionStart` (Claude shape); exit-0 JSON `additionalContext` accepted (`src/hooks/executor.ts:493`) | `UserPromptSubmit`, same | `PreCompact` | Its own MemFS |

#### Out of the model: recall and recording

| Harness | MCP | End-of-turn and session hooks | Transcript store | OpenTelemetry | ACP |
| --- | --- | --- | --- | --- | --- |
| Claude Code | Yes; `instructions` at 2,048 characters, not given to subagents (secondary) | `Stop`, `SubagentStop` with `last_assistant_message`; `SessionEnd` shares 1.5 s, up to 60 s; transcript "written asynchronously and may lag" | `~/.claude/projects/*/<session>.jsonl`, subagents in their own files (`agent_transcript_path`, LangSmith plugin) | Prompts, replies, tool content, raw API bodies (report 8) | Through Zed's adapter |
| Codex CLI | Yes; `instructions` as namespace text | `Stop` with nullable `last_assistant_message`; `SessionEnd` advisory, 1 s default, 3 s max | `~/.codex/sessions/**/rollout-*.jsonl` (claude-mem's watch schema) | Prompts and tool results; reply text missing by secondary sources | Through an adapter |
| OpenCode | Yes | `session.idle`, `message.updated`, `message.part.updated`, `tool.execute.after` | SQLite store | n/f | Yes |
| Hermes Agent | Yes | Provider `sync_turn` after each turn, `on_session_end(messages)`; hooks `post_llm_call` (response and history), `post_tool_call` | SQLite (`state.db`) | n/f | Yes |
| OpenClaw | Yes (deja-vu) | `agent_end` (empty `messages` in incognito), `llm_output`, `session_end` with a bounded `ctx.endedTranscript` | Session JSONL (pi format, trajectory); SQLite store since 2026.8 | n/f | Yes |
| Qwen Code | Yes | `Stop`, `SessionEnd`, `transcript_path` in input | Chat files (path *unverified*) | *Unverified* | Yes |
| DeepSeek Harness | Via `@deepseek-ai/dsh-mcp-client`, global only | `turn/end`, `agent/turn-stopping`, `tools/post-execute` | zstd-compressed sessions | n/f | No |
| Goose | Yes | `Stop` with `last_assistant_message`; `SessionEnd` carries only the session id | Local store (deja-vu needs a helper) | n/f | Yes |
| Gemini CLI | Yes | `AfterAgent` `prompt_response`; `SessionEnd`; `transcript_path` "session transcript JSON" | `~/.gemini/tmp/...` JSON | Yes (*detail unverified*) | Yes |
| Antigravity CLI | Yes | `Stop`, `PostInvocation` | n/f | n/f | No |
| Cline | Yes | `TaskComplete`, `TaskCancel`, `TaskError`, `SessionShutdown` | Task folders (*unverified*) | n/f | Yes |
| Kilo CLI | Yes | As OpenCode | SQLite store | n/f | No |
| Letta Code | rulesync writes none (*unverified*) | `Stop`, `SubagentStop`, `SessionEnd` | Client `transcript.jsonl` (trajectory) | n/f | No |

### 3.3 Existing memory tools' adapters

Read from the clones (`/tmp/claude-probe/clones/<repo>`) or, for mem0,
Honcho, EverOS and OpenViking, through `gh api` and OpenViking's own
[capability
reference](https://github.com/volcengine/OpenViking/blob/main/docs/en/agent-integrations/16-capability-reference.md).
"In" is injection and recall, "out" is recording.

| Tool (licence) | Claude Code | Codex | OpenCode | Hermes | OpenClaw | DSH and others |
| --- | --- | --- | --- | --- | --- | --- |
| [agentmemory](https://github.com/rohitg00/agentmemory) (Apache-2.0) | In: `SessionStart` only if `AGENTMEMORY_INJECT_CONTEXT=true` (default off), `PreCompact` writes context to stdout. Out: `PostToolUse` observations, `Stop`, `SessionEnd` to REST `:3111` (`plugin/scripts/`) | Same `plugin/` via `CLAUDE_PLUGIN_ROOT`, plus a stdio MCP bridge | V1 plugin: `experimental.chat.system.transform`, `experimental.session.compacting`, `chat.message` (`plugin/opencode/agentmemory-capture.ts`) | `MemoryProvider` (`integrations/hermes/__init__.py`) | Memory slot through `registerMemoryCapability`; `before_prompt_build` `prependContext` within `token_budget` (at most 32,000); `agent_end`, `session_end` (`integrations/openclaw/plugin.mjs`) | pi; a filesystem watcher for other sources |
| [claude-mem](https://github.com/thedotmack/claude-mem) (Apache-2.0) | In: `SessionStart`, `UserPromptSubmit`. Out: `Pre/PostToolUse`, `Stop`, `SessionEnd` (`plugin/hooks/hooks.json`) | Hooks incl. `PostCompact` (`codex-hooks.json`); **a declarative transcript watcher** for `~/.codex/sessions` (`transcript-watch.example.json`) | **Both V1 and V2** (`src/integrations/opencode-plugin/v1.ts`, `v2.ts`: `hook("context")`, `"prompt"`, `"compaction"`) | n/f | Memory kind: `before_prompt_build` `appendSystemContext`, `agent_end`, `after_compaction`, `message_received` | DSH Cordis plugin: `agent/created` then `agent.inject`, `agent/turn-stopping`, `tools/post-execute`; Cursor, Qoder, pi, omp |
| [Hindsight](https://github.com/vectorize-io/hindsight) (MIT) | In: `UserPromptSubmit` recall as `additionalContext` (`recallMaxTokens` 1,024). Out: `Stop` reads `transcript_path`, retains in chunks (`retainEveryNTurns`); `SessionEnd` | `SessionStart`, `UserPromptSubmit`, `Stop` | `experimental.chat.system.transform`, `session.compacting`, `session.idle` | Provider: `system_prompt_block`, `prefetch`, `queue_prefetch`, `sync_turn` | Memory kind; `before_prompt_build` defaulting to the user turn "so the provider can reuse its stable prompt prefix" (`openclaw/src/index.ts:2940`); `agent_end`, `session_end` | `coding-agents` package for about 20 more: Qwen Code, Kilo CLI, Cline CLI, Antigravity CLI, DSH, Copilot CLI |
| [OpenViking](https://github.com/volcengine/OpenViking) (AGPL-3.0 plus terms) | In: `UserPromptSubmit` search; `SessionStart` profile (10,000 tokens), and summaries after `compact`. Out: `Stop` commits at 20,000 pending tokens; `PreCompact`, `SubagentStop`, `SessionEnd` | `UserPromptSubmit`; `Stop`, `PreCompact`, `SessionEnd` | V1 `chat.message`, `session.idle`; V2 prompt hook | Before every model call, 4,000 characters, user message only | **Context engine** that owns compaction; recall into the system prompt, 4,000 characters | DSH `agent/pre-step`, `turn/end`, `compaction/start`; pi, Cursor, Trae, Kimi, ZCode |
| [memsearch](https://github.com/zilliztech/memsearch) (MIT) | In: `SessionStart` `additionalContext`, `UserPromptSubmit`. Out: `Stop` parses the transcript and summarises with `claude -p` into Markdown | Plugin | Plugin (`context.ts`) | n/f | Memory kind; `prependContext`; `agent_end` | DSH `agent/pre-step` |
| [mem0](https://github.com/mem0ai/mem0) plugins (Apache-2.0; **need a Platform API key**) | Nine hooks incl. `PreCompact`, local stdio MCP over the Platform | Plugin | Plugin | Provider | Plugin | DeepSeek, Kimi, Antigravity, pi |
| [Honcho](https://github.com/plastic-labs) plugins (server AGPL) | `claude-honcho`: `SessionStart`, `UserPromptSubmit`, `Pre/PostToolUse`, `PreCompact`, `Stop`, `SessionEnd`, MCP | `codex-honcho` | `opencode-honcho` | Provider | `openclaw-honcho` | n/f |
| [EverOS](https://github.com/EverMind-AI/EverOS) (Apache-2.0) | `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd` (`use-cases/claude-code-plugin`) | `everos-mcp` | n/f | Report 7 | Report 7 | n/f |
| [episodic-memory](https://github.com/obra/episodic-memory) (MIT) | Only `SessionStart` `sync --background`: copies and indexes transcripts; recall by MCP; nothing injected | Same plugin | Transcript reader | n/f | n/f | Cursor, OMP |
| LangSmith [Claude Code](https://github.com/langchain-ai/langsmith-claude-code-plugins), [Codex](https://github.com/langchain-ai/langsmith-codex-plugins) (MIT, closed sink) | Out only: nine hooks reading `transcript_path` and `agent_transcript_path`; a separate gateway plugin points Claude Code at a proxy | `Stop`, `UserPromptSubmit` reading the rollout, **a `.langsmith` sidecar of uploaded turn ids** | n/a | n/a | n/a | n/a |
| [deja-vu](https://github.com/vshulcz/deja-vu) (MIT) | Reads native stores of 42 harnesses; MCP recall and "auto-recall" hooks | Yes | SQLite store | SQLite store | SQLite store | DSH (zstd), Goose, Cline, Kilo |

Gaps none of them fills:

- **Persona.** Every tool adds memory beside the host's persona; none
  writes `SOUL.md`, `model_instructions_file` or a primary agent.
- **One store for many tools.** Each adapter set feeds its own backend;
  none exports to another or shares a format.
- **A lossless, inspectable archive.** Most extract and discard. Only
  episodic-memory (copies) and deja-vu (indexes in place) keep raw
  transcripts, neither with history or a mirror.
- **Subagents.** Only LangSmith reads Claude Code's subagent transcripts.
- **Goose, Antigravity CLI, Letta Code.** No tool injects into Goose
  except through MCP (none uses Top Of Mind); Antigravity CLI has no
  session start; no memory tool targets Letta Code.
- **Cache discipline.** Only Hindsight's OpenClaw default and Hermes's
  frozen sections address the prefix cache; OpenViking puts per-turn
  recall in OpenClaw's system prompt.
- **Deduplication.** Only LangSmith marks what it has already sent.
- **OpenCode V2.** Only claude-mem ships a V2 plugin.

### 3.4 Recording routes per harness

The rule that emerges: **the host's own transcript store is the most
complete and durable record; hooks are best used as the trigger that says
when to read it**, with in-process plugins where the host has no command
hooks. ACP is complete for what Dorothy launches and blind to the rest;
OpenTelemetry and the proxy are the only routes that see what the model
was actually sent.

| Harness | Most complete and durable route | What it loses |
| --- | --- | --- |
| Claude Code | `~/.claude/projects` JSONL, read on `Stop` (async) and swept by a detached catch-up after `SessionEnd`, as Dorothy does today (`packages/memory/src/bodies/hook.ts`, `packages/cli/src/claude.ts`) | Nothing of the dialogue; the file "may lag", so take the last reply from `last_assistant_message`; subagents need `agent_transcript_path`; injected context and the system prompt only through OTel raw bodies |
| Codex CLI | Rollout JSONL under `~/.codex/sessions`, on `Stop` or by a watcher (claude-mem's schema) | `SessionEnd` has 3 s at most, so never record inside it; OTel lacks reply text (secondary) |
| OpenCode | Plugin events (`message.part.updated`, `session.idle`) into Dorothy; the SQLite store as backstop | The plugin breaks at V2; the store's schema is internal |
| Hermes Agent | A `MemoryProvider`: `sync_turn` each turn, `on_pre_compress(messages)` and `on_session_end(messages)`, already secret-scrubbed by Hermes | Takes the single provider slot; `state.db` as backstop |
| OpenClaw | `agent_end` plus the session files | Incognito sessions give empty `messages`; needs `allowConversationAccess` |
| Qwen Code | Claude-shaped `Stop` with `transcript_path` | Transcript format *unverified* |
| DeepSeek Harness | Cordis plugin on `turn/end` and `tools/post-execute` | Stores are zstd; no ACP |
| Goose | ACP when launched by Dorothy; else the local store | `Stop` gives only the final text; `SessionEnd` only an id |
| Gemini CLI, Antigravity CLI | Gemini: `AfterAgent` plus the transcript JSON; Antigravity: `Stop` and its store | Antigravity's store n/f |
| Cline, Kilo CLI | Task files; Kilo's SQLite store or OpenCode-style plugin | Paths *unverified* |
| Letta Code | Client `transcript.jsonl` (trajectory parses it) | No ACP |

## 4. Findings for Dorothy's memory design

### The smallest set that reaches every target

Five mechanisms cover all twelve harnesses; nothing less does, because
Goose has no hook context, Hermes and OpenClaw prefer in-process slots,
and MCP alone depends on the model choosing to search.

1. **One MCP server** (Streamable HTTP for other devices, stdio for local
   hosts) for recall and writes, with a short `instructions` text
   (under 512 characters, for Codex's guidance; under 2,048 for Claude
   Code). Reaches all twelve.
2. **One budgeted memory block, rendered per host**, frozen per session:
   - through **Claude-shaped command hooks** (`SessionStart`, with
     `compact` re-injection; `UserPromptSubmit` for per-turn recall) in
     Claude Code, Codex, Qwen Code, Letta Code and Gemini CLI, and the
     Cline equivalents (`TaskStart`, `contextModification`);
   - as a **generated static file** where no hook can inject: Goose's Top
     Of Mind file, Antigravity's rules, an `AGENTS.md` section for plain
     MCP hosts.
3. **In-process adapters** for four hosts: an OpenCode plugin (V1 now, V2
   next), a Hermes `MemoryProvider`, an OpenClaw memory-slot plugin, and a
   DSH Cordis plugin. Kilo CLI takes the OpenCode one.
4. **Transcript readers** per host, triggered by `Stop` or `SessionEnd`
   where those exist and by a watcher elsewhere, normalising into
   Dorothy's JSONL archive.
5. **An ACP client** for sessions Dorothy launches herself, giving one
   recorder for Goose, Gemini CLI, Cline and the rest.

The proxy and OpenTelemetry stay optional: the only views of what the
model was really sent, useful for audit and evaluation, not needed for
memory.

### What implements each, with a verdict

| Mechanism | Existing package or adapter | Verdict |
| --- | --- | --- |
| MCP server | `@modelcontextprotocol/sdk` (report 8); Dorothy's `recall-server.ts` | Adopt the SDK; tools bespoke |
| Writing the MCP entry, hooks, skills and rules into each host | rulesync (`mcp.jsonc`, `hooks.jsonc`, skills); add-mcp as fallback | Adopt rulesync, pinned |
| Persona slots (`SOUL.md`, `model_instructions_file`, `--agent`, OpenCode primary agent) | None; rulesync writes the OpenCode and Claude agent files only | Bespoke writers beside rulesync |
| Hook scripts (block render, recall, record trigger) | Hindsight's Claude and Codex scripts, agentmemory's, memsearch's | Borrow the pattern; bespoke, small |
| OpenCode, Hermes, OpenClaw, DSH adapters | Hindsight (MIT) has all four shapes; claude-mem (Apache-2.0) the only V2 OpenCode plugin | Fork Hindsight's, or adopt them outright if Hindsight is the provider (report 7); take claude-mem's V2 as reference |
| Transcript parsing | Letta `trajectory` (Apache-2.0): Claude Code, Codex, Hermes, OpenClaw, OpenCode, Gemini, Letta Code; claude-mem's declarative watch schema; deja-vu (MIT, Go) for DSH, Goose, Cline, Kilo | Adopt trajectory; bespoke readers for Qwen Code, DSH, Goose, Cline, Kilo, using deja-vu as the map |
| ACP recording | `@agentclientprotocol/sdk` (report 8) | Adopt |
| Recording deduplication | LangSmith's sidecar of uploaded turn ids | Borrow the pattern |
| Whole-tool alternatives (agentmemory, claude-mem, mem0, Honcho, OpenViking, context-mode) | Each a full memory with its own store | Avoid as the memory; mem0's plugins need its Platform, context-mode is ELv2, OpenViking AGPL plus terms |

### Risks

- **Drift between versions.** rulesync shipped 21 major versions in 29
  days; OpenCode's V2 plugin API will not run V1 plugins; Codex hooks only
  recently became default-on; rulesync validated Hermes at v0.21.6 while
  Hermes is at v0.22.2 (report 4); OpenClaw hooks "silently fail" before
  2026.1.29 (context-mode README). Pin versions, run `rulesync generate
  --check` in CI, and keep a contract test per host that drives a real
  session and asserts the block arrived and the turn was recorded.
- **Context budgets differ by an order of magnitude**: Codex about 2,500
  tokens per hook output, Claude Code 10,000 characters, Hermes plugin
  sections 4,000 (8,000 in all) and frozen memory 2,200 plus 1,375,
  OpenClaw `USER.md` 4,000 and 20,000 per bootstrap file, Goose 64 KB,
  MCP `instructions` 512 to 2,048. One renderer with a per-host budget
  and tiered fallbacks, as Dorothy's `block.ts` already packs by tier.
- **Prompt-cache stability.** Session-start text is stable for the
  session; per-turn recall must go in the user turn (Claude and Codex
  `UserPromptSubmit`, Hermes `pre_llm_call`, OpenClaw `prependContext`),
  never into a per-request system edit (OpenCode
  `experimental.chat.system.transform`, OpenClaw `prependSystemContext`),
  or every turn rewrites the cached prefix. Hermes's frozen-section
  contract and Hindsight's "user" default are the models.
- **Duplicate recording.** A Claude Code turn can arrive by `Stop`, by
  the catch-up, by a watcher, by ACP and by the proxy; forks and resumes
  copy history into new sessions. Key every turn by host, session and
  message id, and record what has been ingested, as LangSmith's sidecar
  does.
- **Two writers.** Hosts keep their own memories (Claude auto memory,
  Hermes `MEMORY.md` and `USER.md`, OpenClaw `MEMORY.md`, Letta MemFS),
  and slots are exclusive (one Hermes provider, one OpenClaw memory and
  one context engine), so choosing Dorothy displaces Honcho or Hindsight
  there. rulesync owns whole keys: regenerating replaces `hooks` in
  `.claude/settings.json`, Qwen's settings and Hermes's `config.yaml`,
  erasing any other installer's hooks there. Either declare every hook in
  Dorothy's source or ship her hooks as a Claude plugin, whose
  `hooks.json` rulesync does not touch. Read the hosts' own memories as
  inputs; never write them.

## Not verified

- MCP `instructions` handling per host, from secondary sources and
  issues, not from tests.
- Qwen Code `additionalContext` on prompt and session events (documented
  for tool events), its transcript path and OpenTelemetry content.
- Letta Code: which hook events honour `additionalContext`; MCP support.
- Antigravity CLI context injection and transcript store; Cline and Kilo
  transcript paths; Goose's store and whether a Goose agent can be the
  main persona.
- DeepSeek Harness's own source, licence beyond npm's MIT, and persona
  slot: read only through third-party plugins.
- OpenTelemetry in OpenCode, Hermes, OpenClaw, Goose and Gemini CLI.
- Whether OpenCode's V2 plugin API has shipped in a release; release notes
  of v1.18.25 to v1.19.3 do not mention it.
- rulesync's import round-trips and output quality per host, read from
  source, not run; `skillshare`'s per-host depth.
- That `cm-dyoshikawa` and `dyoshikawa-claw` are the owner's accounts,
  inferred from names.
- deja-vu's and every memory tool's benchmark figures (vendor-reported).
