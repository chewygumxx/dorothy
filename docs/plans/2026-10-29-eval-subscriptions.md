---
ctime: 2026-10-29
mtime: 2026-10-29
spdx: GPL-3.0-only
title: The evaluation's models through subscriptions, implementation plan
description: >-
  Task-by-task plan for the evaluation's claude and codex routes and its
  token records.
tags:
  - dorothy
  - eval
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-29-eval-subscriptions.md
   -
   -->

# The evaluation's models through subscriptions, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `subagent-driven-development` to carry out this plan task by task, one
> subagent at a time, never in parallel. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** an evaluation role can call a model through the user's Claude
or ChatGPT plan, and each command records its tokens, as
[the spec](../specs/2026-10-29-eval-subscriptions-design.md) says.

**Architecture:** `packages/eval/src/models/config.ts` reads `via` and
`effort`; a new `packages/eval/src/models/cli.ts` builds and runs each
route's command through an injected runner; `Models` in `client.ts`
dispatches a role by its route and sums tokens by role.

## Global Constraints

- Every new file carries the house header, copied from a sibling.
- Imports end in `.js`; `eval` imports only what its `package.json`
  declares and no model provider's SDK; `workspace.test.ts` holds.
- Tests never spawn `claude` or `codex`, nor read `secrets.json`,
  `~/.codex` or `$XDG_*/dorothy`: runners, files and environments are
  injected or made in `mkdtemp` directories.
- No key, token or snapshot text reaches argv, a log or an error.
- Commits: Conventional Commits with a capitalised subject, header at
  most 50 characters, body lines at most 72, no agent trailers, no em
  dash; scope `eval`. Run `bunx biome check --write <paths>` first.
- Markdown lines at most 80 characters; AGENTS.md budgets hold.
- Test-first; `bun run check` passes before each task's last commit,
  with the XDG roots under a temporary directory.

## Review Focus

1. Isolation: neither child inherits the user's hooks, settings, MCP
   servers, tools or session, nor any variable beyond those the spec
   names. Task 1.
2. Nothing secret or from the snapshot reaches argv. Task 1.
3. `--max-calls`, retries and redaction hold for the new routes. Task 1.

### Task 1: the routes

- [ ] `config.ts`: `via` (`"api"` default, `"claude"`, `"codex"`) and
  `effort` (Codex only, default `"medium"`), with the spec's
  Configuration rules and messages naming the role.
- [ ] `cli.ts`: for a message list and an optional JSON Schema, build
  the command, arguments, environment, working directory and standard
  input of each route, as the spec's Decisions say, and parse the reply
  into text or the schema's object with tokens where given.
- [ ] `client.ts`: `complete` and `structured` dispatch by route; a CLI
  attempt runs inside `call`; failures as the spec's Calls say.
- [ ] Tests for each item, with a fake runner.

### Task 2: tokens and documents

- [ ] `Models` sums input and output tokens by role; `generate` adds
  them to its `generated.json` entry, and a run's report states them.
- [ ] README's evaluation section: the routes, the subscription-first
  rule, an example; `eval`'s `AGENTS.md`.
- [ ] Tests for the sums and both records.

### Task 3: verification and record

- [ ] By the controller, with the real CLIs: the spec's Verification.
- [ ] `docs/reports/2026-10-29-eval-subscriptions.md`.
