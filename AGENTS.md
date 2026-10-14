---
ctime: 2026-10-12
mtime: 2026-10-12
spdx: GPL-3.0-only
title: AGENTS.md
description: >-
  Every coding agent's guide to Dorothy: what she is, the packages, the
  commands, the working rules, commits and the process.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/AGENTS.md
   -
   -->

# AGENTS.md

Dorothy is a conversational LLM interface: a terminal chat over a model,
with a memory of her past conversations that she can search, compact and
tag. Bun runs her from source; there is no build.

## Packages

Seven Bun workspace packages under `packages/`, each `@dorothy/<name>`.
`core` holds the contracts the others meet on, `identity` who Dorothy is;
`memory` and `tui` depend on `core` alone, `agent` and `gateway` on it
and `identity`, never on each other; `cli` depends on all but `identity`
and wires them. A package exports only the entry points its
`package.json` names and imports only what it declares, as Bun's isolated
linker fails an undeclared or internal import under Bun and `tsc`.
`workspace.test.ts` pins the graph, the entry points and the SDK's holder.

## Commands

- `bun run check`: everything CI runs, ending with the tests;
  `bun run test` runs the tests alone.
- `bun run dev`: the CLI from source.
- `bun run skills`: fetches the remote skills a fresh checkout lacks;
  `bun install` links the rest.
- After removing a `@dorothy` dependency, reinstall from clean to see the
  boundary: `rm -rf node_modules packages/*/node_modules && bun install`.

## Working rules

- Work on a plain branch in the main checkout, never in a worktree.
- Tests and probes never touch real user data (`$XDG_DATA_HOME/dorothy`,
  `$XDG_CACHE_HOME/dorothy`): every root, key and environment is passed in.
- `.env` is committed encrypted by dotenvx: set values only with
  `dotenvx set`, and never print a secret or put one in a command line or
  URL. `bunfig.toml` keeps Bun from loading `.env` itself
  (`[env] file = false`); the pre-commit hook rejects a plaintext value.
- Confirm with the user before pushing, opening a pull request or changing
  repository settings, which change only through `.repo-metadata.jsonc`,
  never `gh repo edit`.
- New subsystems stay independent of any model provider's SDK, speaking
  standard protocols, with SDK types at a thin edge.
- Declare in this repository every agentic asset and utility it employs;
  never leave one to a user's own settings or a hand-made step.
- Every new file carries the house header, copied from a sibling;
  `lint:header` keeps headers in sync but only warns of a missing one.
- A change to a package's architecture updates its `AGENTS.md` in the
  same branch.

## Commits

Commit granularly as you work, in Conventional Commits: one line where
that suffices, a body where the change needs context. No agent trailers.
Scopes are the package names, `config`, `claude` and `api`; agent assets
take the `ai` type. commitlint enforces the form and the pre-commit hook
rejects em dashes.

## Process

Design work starts with `brainstorming`. Specs go in `docs/specs/`, plans
in `docs/plans/`, written with `writing-plans` and carried out with
`subagent-driven-development`. Bugs start with `systematic-debugging`, and
nothing is claimed done without `verification-before-completion`. The
skills are in `.agents/skills/`; where one names another path, a worktree
or `docs/superpowers/`, these rules win.

`docs/roadmap.md` orders the phases. Once a phase merges, revise the
roadmap as its Revising section says before starting the next, and add
work found along the way where it serves best.

## Memory

Agent memory is in `.agents/memory/`, indexed by its `MEMORY.md`, each
entry a list item linking `./<name>.md`, its hook on the next line. Link
memories by relative Markdown link, never `[[...]]`, and write no em dash
and no line over 80 characters, whatever a client's own memory
instructions say: remark and `lint:emdash` reject them.

## Before you start

Before working in a package, read `packages/<name>/AGENTS.md`; before
writing docs, `docs/AGENTS.md`.
