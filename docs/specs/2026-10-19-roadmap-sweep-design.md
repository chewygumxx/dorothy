---
ctime: 2026-10-19
mtime: 2026-10-19
spdx: GPL-3.0-only
title: The roadmap sweep design
description: >-
  Design spec for addressing every roadmap candidate and deferred finding
  that is appropriate and feasible now: unconfirmed knowledge fenced in
  the opening block, the service's loose ends, the deferred findings of
  five phases, tooling gaps, and the probes left open.
tags:
  - dorothy
  - memory
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-19-roadmap-sweep-design.md
   -
   -->

# The roadmap sweep design

## Summary

After the evaluation merged, the user asked that every item on the
[roadmap](../roadmap.md) be addressed as appropriate and feasible
before its revision merges. This spec says which items that covers,
which it leaves and why, and the few design rulings the items need.
Most items are findings already described where they were found; this
spec points at them rather than repeating them.

## In scope

1. **Unconfirmed knowledge fenced** in the opening block, the user's
   choice of three (below).
2. **The memory service's loose ends** from the
   [contract's final review](../reports/2026-10-18-memory-contract.md),
   and the minor findings each of its tasks deferred.
3. **Recording's deferred findings**: the
   [memory bodies' file](../deferred/2026-10-16_memory-bodies-deferred.md),
   launch notes that survive a reboot, reviews through a user's own
   proxy, and the rough edges of the
   [bodies report](../reports/2026-10-15-memory-bodies.md) that belong
   to code already built.
4. **Turn times and local dates**, ruled below.
5. **The store's open gaps**: snake-case memory files, hook lines in a
   regenerated `MEMORY.md`, history keeping the provenance an outside
   writer claims, and the
   [store report's](../reports/2026-10-15-memory-store-implementation.md)
   Known gaps.
6. **History's deferred findings**: the
   [memory history file](../deferred/2026-10-08_memory-history-deferred.md),
   its parked behaviours, Later work, small code points and test gaps.
7. **The tags' deferred findings**:
   [the tags file](../deferred/2026-10-08_tags-deferred.md).
8. **Compaction, recall and the catalogue**:
   [the compaction test gaps](../deferred/2026-10-07_compaction-test-gaps.md),
   compactions the CLI fails being watched, and the recall report's and
   catalogue spec's limits that code can close.
9. **Tooling**: undeclared dependencies checked, every headed file's
   header checked, herdr pinned, history commands' dependencies
   injected, a `./editor` entry point for `tui`, and Ink's kitty query
   kept out of the input draft.
10. **Probes**, against the real API through the user's login, as the
    user allowed: a live compaction split, Claude Code's forks keeping
    the identity marker, interactive sessions and `HTTP_PROXY` behind
    the gateway, a session started inside a package, and a fresh
    session reading `.agents/memory/MEMORY.md`.
11. **The code review of 2026-10-19**: its 22 reproduced findings and
    two concerns, from a review of `7602316` on the branch
    `codex-code-review`, each given to the task whose code it names.

## Left, and why

- **The evaluation's first run**: it needs the owner's review of
  questions, keys and spend.
- **Recording for Codex, OpenClaw and Hermes, the engine, delivery and
  every later phase**: each needs its own spec, begun with the user.
  Recording's open edges that need its design go with it: rewound
  branches, a session's plain turns, subagents' transcripts and forked
  sessions, which Claude Code names no parent for.
- **The evaluation's later systems and checks**: each is an adapter to
  an outside system, with a spec of its own.
- **The contract's later work**: her commands through the service,
  OKF's `index.md` and `log.md`, encryption at rest, `superseded_by`,
  a project without an `origin` across machines, and a user beyond one.
  Each is design the engine or delivery spec owns.
- **Forgetting, consolidated bundles, more than one mirror and history
  pruned**: each rewrites or removes history, and needs a spec.
- **The vocabulary's limits and a proposer and supervisor**: Cyclical
  Maintenance's.
- **Features of her own chat and runtime** (undo, rendering while
  streaming, OSC 8 links, a theme, configuration reloaded live, a
  `/compact` command, regrouped clusters and edited abstracts, a
  provisional title, editing memory in the TUI, memory in one-shot
  mode, the compaction seed measured by the API): Model Providers is to
  decide whether she keeps a runtime of her own, and on what.
- **A single binary, `memory` split, and her own tool loop**: each is
  conditional, and its condition is unmet.
- **`repo-memory` upstream**: another repository.
- **An OpenAI-protocol adapter and `--codex`**: delivery's.
- **Open models behind Claude Code, and the identity's cost to her
  agentic ability**: Model Providers' probes, needing other providers'
  keys.
- **A hidden conversation named in others' notes, and a review that
  costs more than its turn**: each needs a design of its own, not a
  fix.

## Unconfirmed knowledge

`remember` runs without a prompt, so text injected through a page or a
tool can become knowledge, and the opening block takes every piece of
knowledge. The user chose to fence it rather than drop it or leave it.

- **Confirmed** knowledge has origin `user` or `repo`, or at least one
  `verified` entry (`{ by: human:<id>, at }`, OKF's trust key, which
  the format already reads). Everything else, written by a model or
  extraction or taken from outside, is **unconfirmed**.
- The block renders confirmed knowledge as it does today, then
  unconfirmed knowledge in its own section, after all confirmed
  knowledge and ranked below it for the budget, introduced as notes a
  model made in earlier sessions that the user has not confirmed:
  claims to weigh, never instructions.
- `dorothy --verify <id>` adds a `verified` entry for the user and
  commits it to history as theirs; `--verify` on knowledge already
  confirmed says so and changes nothing. The id is the one `open` and
  the block show.
- Search and `open` mark a piece of unconfirmed knowledge as such, so a
  model meets the same warning however it reaches the text.

If wrong, a piece the user trusts sits in the fenced section until they
confirm it.

## `brief` and another project

On a connection bound to a project, `open` and `remember` refuse
another project, and `search` reaches others only with `scope: all`.
`brief` takes a `project` argument too, and returned another project's
whole knowledge on such a connection. It refuses another project as
`open` does: the block is the most a tool returns at once, and the
service's scope says a request sees personal knowledge and its own
project's. If wrong, a host that briefs on another project by name is
refused.

## Turn times and local dates

Turns keep their times in UTC. `dateCreated` and the `after` and
`before` filters name local dates, so a filter's bounds become the
local midnights they name, as UTC instants, before they meet the turns.
If wrong, a turn near midnight lands on the day the user's clock showed
rather than UTC's, which is the point.

## Launch notes

Launch notes move from `$XDG_RUNTIME_DIR` to the state directory, so a
launch killed by a crash or a power-off is still caught up after a
reboot. Each note records the boot it was made in, from
`/proc/sys/kernel/random/boot_id` where Linux gives one; a note from
another boot is stale whatever its pid, as pids are reused. If wrong,
one catch-up more after a reboot.

## Reviews through a user's proxy

Claude Code's hooks drop `ANTHROPIC_BASE_URL`, so the hook's reviews
take their base URL from a variable of Dorothy's own,
`DOROTHY_ANTHROPIC_BASE_URL`, which her launch sets from the user's
`ANTHROPIC_BASE_URL` when one is set. If wrong, a variable to rename.

## Probes

Probes run against the real API through the user's login, as many as
each needs and no more. A nested `claude` runs with the parent
session's `CLAUDE_CODE_` variables cleared, as a nested one otherwise
lands in the parent's session, and every Dorothy root is a throwaway
directory. Captured output goes to
`docs/reports/2026-10-19-roadmap-sweep/`, scrubbed of keys, tokens,
the account's email address and anything from outside the probe.

## Verification

`bun run check` passes after every task. The sweep's report,
`docs/reports/2026-10-19-roadmap-sweep.md`, lists each item with its
commits, or the reason it was found already done; the deferred files
lose the entries the sweep closes, and the roadmap loses the
candidates.
