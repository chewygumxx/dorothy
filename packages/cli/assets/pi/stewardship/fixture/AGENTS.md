---
ctime: 2026-11-04
mtime: 2026-11-04
spdx: GPL-3.0-only
title: packages/cli/assets/pi/stewardship/fixture/AGENTS.md
description: >-
  The stewardship trial's fixture repository, the owner's acceptance test,
  the runner's verification and the simulated-worker scenarios that
  exercise Pi stewardship offline.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/cli/assets/pi/stewardship/fixture/AGENTS.md
   -
   -->

# packages/cli/assets/pi/stewardship/fixture/AGENTS.md

The trial's task and its offline exercise. The engine and its guide are
[steward/](../../../../src/hosts/pi/steward/AGENTS.md).

## The fixture

- `repo/`: what a worker clones: `slugify` in `src/slug.ts` with a
  deterministic bug, `CONTRACT.md` (the contract and the report format),
  `src/example.ts` (the contract's easy examples).
- `owner/acceptance.ts`: the owner's test, fuller than the examples
  (diacritics, symbol-only text). It never enters a clone. The first fix
  that trims hyphens passes the examples and fails this: the deliberately
  incomplete fix an independent reviewer must catch.

## The runner's side (`steward/owner.ts`)

`verifySubmission` is the only writer of a receipt. For a `reported` task
it: refuses a report whose digest is not the ledger's (`REPORT_CHANGED`)
or that names no revision (`NO_CLAIM`); reads the clone's `HEAD` itself and
refuses a claim that differs (`CLAIM_MISMATCH`) or history not from the
base (`NOT_FROM_BASE`); exports exactly that commit with `git archive` to
the owner's root, outside the fixture root and every clone; runs the
owner's copy of the test there with a minimal environment and Bun's config
pinned to the owner's empty one; then records the receipt (task, revision
it computed, digest, command, exit, log). A failing run is a receipt too:
`finish` turns exit nonzero into `failed`. Nothing recorded is a pending
task, not a verified one. It runs the worker's code as the runner's user:
no sandbox. A reviewer's task is closed by the same receipt on the
reviewed revision, so a review that rejects a failing revision ends
`failed`; no engine step closes a reported task without a receipt.

## The scenarios

`simulation.ts`: `Sim`, three workers (`impl`, `rev`, `spare`) in a private
root, each with a clone, the engine reached by `runSteward` over a fake
herdr, sender and interrupter, every scripted call a recorded `Decision`.
A `Cast` names workers, panes, terminals and task ids and orders the
registry, the reports and the suite: `DEFAULT_CAST`, and `HELD_OUT_CAST`,
which renames and reorders all of them. `scenarios.ts`: fourteen
scenarios (busy and limited workers, stale identity, conflicting reports,
injected authority, delayed output, coordinator crash, cancellation and
its race, failed worker, forged report, claimed revision, two workers,
the review loop, a plain fix) each ending in `ScenarioResult`:
`duplicateDispatches`, `falseVerifiedTasks` (against an oracle of
revisions the harness made complete) and `unresolvedTasks`. `pi-scenario.ts`:
one scripted-provider turn through the published Pi and the stand-in
helper. These are plumbing results: the model is scripted.

## The probe

`bun scripts/probe-pi-stewardship.ts --offline --out <dir>` runs both casts
and the Pi turn in a temporary HOME, XDG and TMPDIR, with synthetic keys,
and writes `result.json` and `report.md`. It imports the CLI's sources by
relative path, the documented exception for probes
(`scripts/probe-pi-delivery.ts` does too). Its own test runs it once
as a process, with sentinel roots that must stay empty.
