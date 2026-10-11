---
ctime: 2026-10-11
mtime: 2026-10-11
spdx: GPL-3.0-only
title: Agentic asset refactor design
description: >-
  Design spec for moving the repository's agent guidance, skills and memory
  into conventions every coding agent reads, and declaring third-party
  skills as dependencies, so that no session pays for what it does not use.
tags:
  - dorothy
  - agents
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-11-agentic-asset-refactor-design.md
   -
   -->

# Agentic asset refactor design

## Purpose

Every coding agent session in this repository starts by loading a 15 KB
`.claude/CLAUDE.md`, whatever part of the code it works on, and fourteen
plugins enabled in `.claude/settings.json`, several of which inject text
or run a command at every session start. Only Claude Code reads any of it.
The process the repository is built by (brainstorm, spec, plan,
subagent-driven execution, review) comes from a plugin installed outside
the repository, and several working rules exist only in an agent's memory.

This phase moves the guidance into `AGENTS.md` files, read at the root
and per package on demand, declares third-party skills as dependencies
that `bun install` links for every agent, moves agent memory beside them
under `.agents/`, and cuts Claude's settings down to what has no
client-neutral form. The repository then carries everything its
conventions depend on, in formats Claude Code, Codex, OpenCode, Cursor and
others read alike.

It is the first of three phases toward running Dorothy, and the agents
that work on her, on models chosen per purpose rather than on one
provider's. **Model Providers** gives Dorothy a provider contract with
per-role routing; **Dorothy's Gateway** serves her as the model behind
existing agentic clients, adding her persona and memory to their
requests. Both read the assets this phase lays out, through whichever
client runs them, so this phase writes them for any client and any model.

## Decisions

- **`AGENTS.md`, natively.** Claude Code reads `AGENTS.md` itself since
  v2.1.277: the root's at launch, and a subdirectory's when it opens a
  file there, provided no `CLAUDE.md` is found. Codex reads `AGENTS.md`
  from the repository root down to its working directory. So the guidance
  is a root `AGENTS.md` plus one per package and one in `docs/`, and
  `.claude/CLAUDE.md` is deleted. A `CLAUDE.md` anywhere above the working
  directory would switch `AGENTS.md` off for Claude Code, so none may
  exist.
- **Not `.agents/AGENTS.md`.** No client reads guidance there. `.agents/`
  holds what clients look up there or are pointed to: skills and memory.
- **Guidance by package.** Each package's architecture moves out of the
  root into `packages/<name>/AGENTS.md`, which costs nothing until an
  agent works in that package.
- **Third-party skills are dependencies.** Superpowers and herdr are
  declared in `package.json`, pinned by `bun.lock` and `skills-lock.json`,
  and linked into `.agents/skills/` and `.claude/skills/` by the `skills`
  CLI on every install. Nothing upstream is committed.
- **Memory under `.agents/`.** Agent memory moves from `.claude/memory/`
  to `.agents/memory/`; the remember plugin's buffers move to
  `.agents/remember/`.
- **Plugins only where nothing neutral exists.** A rule a plugin enforces
  is enforced where commits happen, by husky, CI or a test; a plugin may
  remain as a courtesy on top, never as the only guard.
- **One check.** `agents.test.ts`, beside `workspace.test.ts`, pins the
  layout, the budgets, the skill links and the plugin list.

## Layout

```text
AGENTS.md                      root, every session, at most 100 lines
docs/AGENTS.md                 conventions for docs, at most 60 lines
packages/core/AGENTS.md        ┐
packages/memory/AGENTS.md      │ each package's architecture, read on
packages/agent/AGENTS.md       │ demand, at most 150 lines each
packages/tui/AGENTS.md         │
packages/cli/AGENTS.md         ┘
.agents/skills/<name>          linked by the skills CLI, gitignored
.agents/memory/                agent memory, committed
.agents/remember/              remember buffers, gitignored
.claude/settings.json          Claude-only settings, reduced
.claude/skills/<name>          linked by the skills CLI, gitignored
skills-lock.json               the skills CLI's lock, committed
```

`.claude/CLAUDE.md`, `.claude/memory/` and the root `/.remember/` go.

## Guidance

### Rules every `AGENTS.md` follows

1. **Neutral about client and model.** No client or tool names ("use
   Read", "Bash"), and no plugin or personal skill. A file says what and
   where, never which tool. The one exception is naming `.claude/` where
   a rule is about it.
2. **Directive and current.** The code as it is, in the present tense:
   what to do and what never to do. How it came to be stays in the
   reports, which each file links.
3. **Never restate what tooling enforces.** commitlint, `lint:emdash`,
   remark, `lint:env`, `lint:header`, `workspace.test.ts` and
   `agents.test.ts` each get a line naming the check, not a paragraph.
   Prose is kept for what no check catches.
4. **One shape for a package's file:** its purpose in a sentence or two;
   its entry points and what it may import; a short map of its files; its
   invariants; its test rules; links to its specs and reports.
5. **Budgets**, pinned by `agents.test.ts`: the root at most 100 lines,
   each package at most 150, `docs/AGENTS.md` at most 60. A package that
   outgrows its budget gains a nested `src/<subdir>/AGENTS.md`, read on
   demand the same way; the budget does not grow.

### The root

In this order:

1. What Dorothy is, in a paragraph.
2. The packages: the five, the dependency rule (`memory`, `agent` and
   `tui` depend on `core` alone; `cli` wires them), entry points named in
   `package.json` only, the isolated linker, and `workspace.test.ts`.
3. Commands: `bun run check`, `bun run dev`, `bun run test`, the clean
   reinstall (`rm -rf node_modules packages/*/node_modules && bun
   install`), and that there is no build.
4. Working rules, which no check enforces:
   - plain branches in the main checkout, never worktrees;
   - tests and probes never touch real user data (`$XDG_DATA_HOME/dorothy`
     and `$XDG_CACHE_HOME/dorothy`); every root, key and environment is
     passed in;
   - set `.env` values only with `dotenvx set`; never print a secret, and
     never put one in a command line or URL;
   - pushing, opening pull requests and changing repository settings are
     confirmed with the user first; repository settings change only
     through `.repo-metadata.jsonc`, never `gh repo edit`;
   - new subsystems stay independent of any provider's SDK, speaking
     standard protocols, with SDK types at a thin edge;
   - every new file carries the house header, copied from a sibling;
     `lint:header` verifies it.
5. Commits: granular Conventional Commits, single-line where that
   suffices, headers of at most 50 characters, no em dashes, no agent
   trailers; the scopes are the package names with `config`, `claude` and
   `api`, and agent assets take the `ai` type. commitlint enforces the
   form.
6. Process: design work starts with `brainstorming`; specs go in
   `docs/specs/`, plans in `docs/plans/`, written with `writing-plans` and
   carried out with `subagent-driven-development`; bugs start with
   `systematic-debugging`; nothing is claimed done without
   `verification-before-completion`. The skills are in `.agents/skills/`,
   and where one names a different path or a worktree, these rules win.
7. The roadmap: `docs/roadmap.md` orders the phases and is revised as its
   Revising section says once a phase merges.
8. Agent memory is in `.agents/memory/`, indexed by its `MEMORY.md`.
9. Before working in a package, read `packages/<name>/AGENTS.md`; before
   writing docs, `docs/AGENTS.md`.

### The packages

Each paragraph of today's `.claude/CLAUDE.md` goes to the package it
describes, rewritten to the shape above:

| Today's paragraph                                          | Goes to  |
| ---------------------------------------------------------- | -------- |
| `core`, `withSection`                                      | `core`   |
| Memory, notes, recall, compaction, tags, history           | `memory` |
| The agent, the persona, `baseOptions` and `cliOptions`     | `agent`  |
| The TUI                                                    | `tui`    |
| The CLI, auth and the entry guard                          | `cli`    |
| The architecture overview, commands, no build, scopes      | root     |

Auth's rules (`dotenvx set`, `[env] file = false`, the pre-commit check)
are stated once in the root, and `cli`'s file covers the entry guard that
decrypts. `memory` is the one file likely to press its budget; its
subdirectories are the natural places for nested files.

### `docs/AGENTS.md`

Where specs, plans, reports, notes and deferred findings go and how they
are named (`YYYY-MM-DD-<topic>.md`, specs ending `-design.md`); the file
header, frontmatter (`ctime`, `mtime`, `spdx`, `title`, `description`,
`tags`) and breadcrumb; lines of at most 80 characters (remark enforces
it); no wiki links; a report records probes, rulings and verification.

### Upkeep

A branch that changes a package's architecture updates its `AGENTS.md` in
the same branch. The roadmap's Revising section gains a step: check the
guidance files against what merged.

## Skills

### Declaration

The root `package.json` declares the `skills` CLI and superpowers as
development dependencies, pinned, and herdr as a remote source in its
`"skills"` field:

```json
"devDependencies": {
    "skills": "1.7.2",
    "superpowers": "github:obra/superpowers#v6.4.1"
},
"skills": [{ "source": "herdrdev/herdr", "skills": ["herdr"] }]
```

`bun.lock` pins superpowers to its commit. A probe confirmed that bun's
isolated linker installs it from GitHub and that the CLI discovers the
`skills/` directory of every installed dependency.

### Sync

A script links them:

```json
"skills": "skills experimental_sync -y --agent claude-code codex --exclude 'superpowers#using-git-worktrees' --exclude 'superpowers#using-superpowers' --exclude 'superpowers#diagnosing-superpowers' --exclude 'superpowers#writing-skills'"
```

The sync links each skill to `.agents/skills/<name>`, pointing into
`node_modules`, links `.claude/skills/<name>` to that, records each
skill's version and hash in `skills-lock.json`, and removes the links of
skills no longer provided. `prepare` runs it after husky, so `bun install`
sets up every agent's skills. The probe confirmed the links, the lock and
the pruning of excluded skills.

The four excluded skills:

- `using-git-worktrees`: this repository works on plain branches.
- `using-superpowers`: its description has an agent invoke it in every
  conversation, some 20 KB each time; the root's Process section names
  when each skill applies instead.
- `diagnosing-superpowers`: for reporting the plugin's own failures.
- `writing-skills`: for authoring skills; the repository has none of its
  own yet.

Eleven remain: `brainstorming`, `writing-plans`, `executing-plans`,
`subagent-driven-development`, `dispatching-parallel-agents`,
`finishing-a-development-branch`, `requesting-code-review`,
`receiving-code-review`, `systematic-debugging`,
`test-driven-development` and `verification-before-completion`.

### What is committed

`package.json`, `bun.lock` and `skills-lock.json`. The links are
gitignored (`/.agents/skills/` and `/.claude/skills/`), so upstream's text
never meets this repository's lints, and since upstream's package is
installed with its own `LICENSE` rather than copied, no notice is needed.
A skill the repository writes itself later is committed and linted, with
a negation in `.gitignore`.

The superpowers plugin stays enabled in the user's settings for other
projects; this project's `.claude/settings.json` disables it, so no skill
is listed twice.

## Agent memory

- `.claude/memory/` moves to `.agents/memory/`, with its `MEMORY.md`
  index.
- Three memories become rules in the root and are deleted:
  `docs-location`, `no-worktrees` and `sdk-independent-modules` (widened
  to any provider).
- `bg-session-force-color` and `maintenance-design-agreed` move; the
  second stays until the cyclical maintenance spec replaces it.
- `autoMemoryDirectory` must be absolute, so it stays in the gitignored
  `.claude/settings.local.json`, set once to `.agents/memory/`'s absolute
  path. The repo-memory plugin, which rewrote it to `.claude/memory` at
  every session start, is disabled here.
- The remember plugin resolves its directory from `data_dir`, which only
  `~/.remember/config.json` can set for a project, as the per-project
  config lives inside the directory it names. The user sets `"data_dir":
  ".agents/remember"` there, for every project, and moves the buffers;
  `.gitignore` gains `/.agents/remember/`, and `/.remember/` goes once
  the buffers have moved.

## Claude's settings

`.claude/settings.json` keeps `attribution`, the `chewygumxx` marketplace,
and four plugin entries:

| Plugin                                   | Enabled | Why it stays                     |
| ---------------------------------------- | ------- | -------------------------------- |
| `superpowers@claude-plugins-official`    | false   | the skills are declared instead  |
| `typescript-lsp@claude-plugins-official` | true    | a capability, not a rule         |
| `agent-sdk-dev@claude-plugins-official`  | true    | until Model Providers            |
| `repo-metadata@chewygumxx`               | true    | blocks `gh repo edit` before it  |

The other plugins come out:

- `claude-code-setup`, `claude-md-management`, `code-simplifier`,
  `explanatory-output-style` and `remember` are enabled in the user's
  settings already; listing them here changes nothing, and they are the
  user's workflow rather than the repository's.
- `github-mcp` defines the same server as the tracked `.mcp.json`.
- `prohibit-em-dash`: `.husky/pre-commit` already rejects staged em
  dashes, and `lint:emdash` checks in CI.
- `bun-install` ran `bun install` at every session start, with a
  120-second timeout. `.husky/post-checkout` and `.husky/post-merge` run
  it instead, only when `package.json` or `bun.lock` differs between the
  old and new heads, for every agent and for the user.
- `header-metadata` wrote the header into new files. The root's rule
  covers new files, and the user's `sync-header-metadata` package checks
  every header: declared pinned in the root's development dependencies,
  as `"lint:header": "sync-header-metadata"`, in `check`, and as
  `"format:header": "sync-header-metadata --update"`. Its verify mode
  passes on the repository today, warning only of files without a header.
- `repo-memory`: see Agent memory; its ban on wiki links in memory moves
  to `agents.test.ts`.

## `agents.test.ts`

It pins, failing with what to fix:

- an `AGENTS.md` at the root, in `docs/` and in every directory under
  `packages/`, found by listing, so a new package fails until it has one;
- no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` anywhere in
  the working tree outside `node_modules`;
- the line budgets;
- every relative link in an `AGENTS.md` resolves, which remark does not
  check;
- every skill in `skills-lock.json` linked at `.agents/skills/<name>` and
  `.claude/skills/<name>`, resolving to a `SKILL.md` whose `name` is the
  directory's, and no excluded skill linked;
- no `[[...]]` wiki link in `.agents/memory/`;
- `.claude/settings.json`'s `enabledPlugins`, exactly, so a plugin added
  later is a decision a review sees.

The tests read only the repository; none touches user data or the
network.

## Measurement

The phase exists to cut what a session costs, so its report measures it.
Before any change, and again at the end, a one-word prompt runs through
`claude -p --output-format json` from the root and from
`packages/tui/src/`, with the user's settings as they are, and the report
records the input and cache tokens of the first request, beside the
session start's wall time. The same is noted for Codex if it is
installed.

## Migration

One branch, in this order, each step a commit or a few:

1. Measure the baseline.
2. `agents.test.ts`, failing.
3. Skills: the dependencies, the `"skills"` field, the script, `prepare`,
   the ignores, `skills-lock.json`; the untracked herdr install is
   replaced by the declared one.
4. Guidance: the five package files, `docs/AGENTS.md`, the root; delete
   `.claude/CLAUDE.md`.
5. Memory: move to `.agents/memory/`, retire the three, update the index;
   repoint `autoMemoryDirectory`; ignore `/.agents/remember/`.
6. Settings: reduce `.claude/settings.json`; add the husky hooks; add
   `sync-header-metadata` and its scripts.
7. The roadmap's Revising step, and the phase moved to Done.
8. Measure again, and write the report.

`agents.test.ts` passes from step 6 on.

## Roadmap

Revised with this spec:

- This phase's wording names the root `AGENTS.md`, and it is in progress.
- **Model Providers** replaces The Messages API: a provider contract in
  `core`, the Messages API and an OpenAI-compatible implementation, and
  per-role routing in `config.toml`, so chat, reviews, compaction and
  maintenance each take a model fit for them. It goes ahead of Cyclical
  Maintenance, whose background passes are where a cheaper model pays
  most.
- **Dorothy's Gateway** absorbs Token Budgets and a Gateway: an endpoint
  speaking the Anthropic and OpenAI protocols, adding Dorothy's persona
  and memory to each request and routing it through Model Providers, so
  she can be the model behind Claude Code, Codex, OpenCode and the like;
  recall is offered to those clients over MCP.
- Candidates gain Dorothy's own tool loop, presence checks for the house
  header, and `repo-memory` preferring `.agents/memory/` upstream.

## Known risks

- **The sync is experimental.** The `skills` CLI names it
  `experimental_sync`. It is pinned exactly and upgraded on purpose, and
  `agents.test.ts` fails if its links ever stop matching the lock.
- **Remote sources on every install.** Whether the sync fetches herdr
  from GitHub on each run is unverified; the plan probes it first, and if
  so `prepare` passes `--no-remote` and `bun run skills` fetches.
- **Losing `using-superpowers`.** The plugin's hook made skill use the
  first thing in every session. The root's Process section is shorter and
  softer; if agents skip the process without it, the skill comes back.
- **Upstream defaults.** Superpowers' text still says `docs/superpowers/`
  and worktrees in places. The root's rules say they win, as the skills
  themselves defer to user instructions.
- **Older Claude Code.** Before v2.1.277, and in some sessions it lists,
  Claude Code reads no `AGENTS.md`. The user runs 2.1.292.

## Later

- Model Providers and Dorothy's Gateway, as above.
- A skill of the repository's own, such as the report or the probe
  procedure, once one recurs.
- Checking that every file of a headed type has the header, not only that
  existing headers are in sync.

## Out of scope

- Dorothy's own guidance in development mode: she reads these files once
  the gateway puts her behind a client.
- The user's own settings and plugins, beyond the two settings this
  phase needs (`data_dir`, `autoMemoryDirectory`).
- Upgrading superpowers to v7.
