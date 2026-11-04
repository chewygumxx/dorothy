---
ctime: 2026-11-04
mtime: 2026-11-04
spdx: GPL-3.0-only
title: packages/cli/src/hosts/pi/steward/AGENTS.md
description: >-
  Pi stewardship: the declared trial fleet of Codex and Claude workers in
  herdr panes, and the read-only observation of it.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/cli/src/hosts/pi/steward/AGENTS.md
   -
   -->

# packages/cli/src/hosts/pi/steward/AGENTS.md

Dorothy in Pi coordinates workers she is told of, none she finds: a
registry names each, and nothing here adopts the live development fleet
or infers a target from focus. Bun code, never loaded by Pi's extension.

## Files

- `types.ts`: the contracts the parts meet on (`Worker`, `Fleet`,
  `WorkerObservation`, the helper's `StewardRequest` and `StewardReply`,
  `TaskBrief`, `CompletionEvidence`), and `StewardError`, whose `code`
  begins its message. `TaskRecord` is a placeholder for the ledger's row.
- `registry.ts`: `readFleet(path, now)`, the strict manifest: a regular
  file of at most 64 KiB, version 1, every key named (an unknown one is
  refused, a token-like one as `REGISTRY_CREDENTIAL`, as is a
  token-shaped value, one starting at a word edge: `task-stewardship` is
  a path), `fleetId` through core's `isUuid`, one to eight
  workers whose ids, names and panes are argv-safe words of 1 to 32
  characters (no leading dash). `fixtureRoot` and each `cwd` are made
  canonical; a `cwd` outside the root, links followed, is
  `REGISTRY_ROOT_ESCAPE`. Observation times are exact UTC; an
  observation after the injected clock, or an expiry not within an hour
  after it, refuses the fleet, as does any worker expired
  (`REGISTRY_EXPIRED`): refresh is the fixture runner's act. Also
  `isTaskId` (`[a-z][a-z0-9_-]{0,63}`) and `fixturePath`, which a
  brief's or report's path passes at each use: absolute, beneath the
  root, no link in any part, a regular file (a report's directory, if it
  is not yet written).
- `herdr.ts`: `createHerdrRun`, a `HerdrRun` over `herdr` with the env it
  is given alone, no shell, output at most 32 KiB and the process killed
  on abort or overflow. `observeWorker(worker, run, {env, now,
  timeoutMs})` is read-only: it needs `HERDR_ENV=1`, asks
  `herdr agent get <name>` for 2000 ms, and matches only if
  `.result.agent` has the declared name, `pane_id`, `agent` and `cwd`.
  Anything else, a moved pane, a stopped agent, a malformed or oversized
  reply, a timeout, is `matches: false`, `unknown` and a `HERDR_*` code;
  an unrecognized status is `unknown`, never idle. Callers observe again
  immediately before acting. A match also gives `terminalId`, herdr's
  `terminal_id` (a bounded word, else null; null when unmatched): it
  never makes a match, the caller pins it and refuses a change.
- `fixtures.ts`: `writeRegistry` (private roots) and `fakeHerdr`, whose
  replies have herdr 0.9.5's structure with every value invented. It
  serves `agent get` alone and refuses any other command. Capture new
  fixtures from dedicated trial panes only, sanitized the same way.

The registry example is `../../../../assets/pi/stewardship/`
`registry.example.json`, synthetic, and expired by design.

## Tests

Every root, clock, environment and runner is injected. A test starts no
real herdr: `createHerdrRun` runs a script in a private root.
