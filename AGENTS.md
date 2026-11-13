---
ctime: 2026-10-12
mtime: 2026-11-14
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
   - ~xxdorothy/dorothy.git
   - ::: :/AGENTS.md
   -
   -->

# AGENTS.md

Dorothy is a conversational LLM interface: a terminal chat over a model,
with a memory she can search, compact and tag, which her service shares
with other harnesses. Bun runs her from source; there is no build.

## Packages

Nine Bun workspace packages under `packages/`, each `@dorothy/<name>`.
`core` holds the contracts the others meet on, `identity` who Dorothy is,
`skills` the repository's own agent skills, depending on nothing;
`memory` and `tui` depend on `core` alone, `agent` and `gateway` on it
and `identity`, never on each other, `eval` on `core` and `memory`; `cli`
on all but `eval`, and wires them. A package exports only the entry points
its `package.json` names and imports only what it declares, as Bun's
isolated linker fails an undeclared or internal import.
`workspace.test.ts` pins the graph, the entry points and the SDKs' holders.

## Commands

- `bun run check`: everything CI runs, the tests included;
  `mise run test` runs the tests alone.
- `mise tasks ls` lists the development tasks; `lint`, `format` and
  `check` take `--staged`.
- `bun run dev`: the CLI from source.
- `bun install` links every skill, fetching the remote ones, and points
  Claude at `docs/memory`; `mise run skills` relinks without an install.
- After removing a `@dorothy` dependency, reinstall from clean to see the
  boundary: `rm -rf node_modules packages/*/node_modules && bun install`.

## Working rules

- Work on a branch, in the main checkout or in a worktree.
- Tests and probes never touch real user data (`$XDG_DATA_HOME/dorothy`,
  `$XDG_CACHE_HOME/dorothy`): every root, key and environment is passed in.
- Sops encrypts `secrets.json` with age (`~/.config/sops/age/keys.txt`).
  Back up the key off this machine. Edit only with `sops edit secrets.json`
  or core's `saveSecret`; never print values or put them in argv or URLs.
  `bunfig.toml` skips `.env`; pre-commit rejects plaintext values.
- Push your branches, open their pull requests and merge your own once CI
  passes, as the user approved. Confirm before changing repository settings,
  which change only through `.repo-metadata.jsonc`, never `gh repo edit`.
- New subsystems stay independent of any model provider's SDK, speaking
  standard protocols, with SDK types at a thin edge.
- Declare in this repository every agentic asset and utility it employs;
  never leave one to a user's own settings or a hand-made step. A
  harness's own settings, such as plugins or status line, are the user's.
- Every new file carries the house header, copied from a sibling;
  `format:header` syncs headers, `header.test.ts` fails a missing one.
- A change to a package's architecture updates its `AGENTS.md`, and one
  to behaviour, decisions or priorities the wiki's pages, in the same branch.

## Data by function

Keep each kind of data in its own file, beside what it concerns; the
[decisions](./docs/wiki/decisions.md) say why:

- Directives for tools stay inline: licence headers, modelines, schema
  lines and lint suppressions.
- A why tied to one line stays inline, in one line.
- What a unit is for and what it promises goes in a file beside it.
- Pair files by a shared basename, not by "see" pointers. An index, such as
  a task file or the wiki's records, stays whole in one known place.
- Every split pair has a check that fails when the two disagree.

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
skills are linked in `.agents/skills/`, declared in `package.json` and
`packages/skills/`; where one names another path, these rules win, and a
worktree goes wherever the user's tools put it.

`docs/roadmap.md` orders the phases. Once a phase merges, revise the
roadmap as its Revising section says before starting the next, and add
work found along the way where it serves best.

## Memory

Agent memory is in `docs/memory/`, indexed by its `MEMORY.md`, each
entry a list item linking `./<name>.md`, its hook on the next line. Link
memories by relative Markdown link, never `[[...]]`, and write no em dash
and no line over 80 characters, whatever a client's own memory
instructions say: `lint:md` and `lint:emdash` reject them.

## Before you start

Before working in a package, read `packages/<name>/AGENTS.md`; on
configuration, `.config/AGENTS.md`; before writing docs, `docs/AGENTS.md`;
to find a topic, `docs/README.md`.
