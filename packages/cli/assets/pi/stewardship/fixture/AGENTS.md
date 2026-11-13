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
   - ~xxdorothy/dorothy.git
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
  (diacritics, symbol-only text), and `owner/child.ts`. The submitted
  code runs in the child, not in the test's process: the child gets the
  inputs and a nonce on stdin and answers with outputs, and the parent
  holds the expected ones and compares. That stops in-band forgery: an
  exit 0 at import, no reply, a reply printed before the child's own (it
  lacks the nonce, which the code could still learn by wrapping
  `process.stdout.write`, so the nonce guards against a reply printed
  ahead of the child's, not against code that watches it). Neither file
  enters a clone. The first fix that trims hyphens passes the examples
  and fails this: the incomplete fix an independent reviewer must catch.

## The runner's side (`steward/owner.ts`)

`verifySubmission` is the only writer of a receipt. For a `reported` task
it: refuses a report whose digest is not the ledger's (`REPORT_CHANGED`)
or that names no revision (`NO_CLAIM`); reads the clone's `HEAD` itself and
refuses a claim that differs (`CLAIM_MISMATCH`) or history not from the
base (`NOT_FROM_BASE`); exports exactly that commit with `git archive` to
the owner's root, outside the fixture root and every clone; runs the
owner's copy of the test there with a minimal environment and Bun's config
pinned to the owner's empty one; reads the sealed test files (test, child,
config) again before and after the run, and refuses on any change
(`ACCEPTANCE_CHANGED`: no receipt, and no later run on that kit); then
records the receipt (task, revision it computed, digest, command, exit,
log). A failing run is a receipt too:
`finish` turns exit nonzero into `failed`. Nothing recorded is a pending
task, not a verified one. What a receipt is: independent evidence
against a worker's report (a claimed revision, command or pass), computed
by the runner from the clone. It is not evidence against hostile code,
which runs as the runner's user and no sandbox: it can read the expected
cases from the test's files, change the owner's files between the two
reads (and put them back), or write into the test's output through
`/proc/<ppid>/fd/1`. The sealing and the child catch accident and in-band
forgery, not that. `owner.test.ts` records the first as a known limit.
A reviewer's task is closed by the same receipt on the
reviewed revision, so a review that rejects a failing revision ends
`failed`; no engine step closes a reported task without a receipt. The
ledger therefore cannot tell a right rejection from a wrong approval:
`measureReview` holds a reviewer's verdict (its report's `Status:`) beside
the receipt on the reviewed revision (`ScenarioResult.reviews`, the
probe's `result.json` and `report.md`).

## The scenarios

`simulation.ts`: `Sim`, three workers (`impl`, `rev`, `spare`) in a private
root, each with a clone, the engine reached by `runSteward` over a fake
herdr, sender and interrupter, every scripted call a recorded `Decision`.
A `Cast` names workers, panes, terminals and task ids and orders the
registry, the reports and the suite: `DEFAULT_CAST`, and `HELD_OUT_CAST`,
which renames and reorders all of them. `scenarios.ts`: fifteen
scenarios (busy and limited workers, stale identity, conflicting reports,
injected authority, delayed output, coordinator crash, cancellation and
its race, failed worker, forged report, claimed revision, two workers,
hostile submissions, the review loop, a plain fix), each ending in a
`ScenarioResult`: `duplicateDispatches`, `falseVerifiedTasks` (against an
oracle of revisions the harness made complete), `unresolvedTasks` and
`reviews`. `pi-scenario.ts`: one scripted-provider turn through the
published Pi and the stand-in
helper. These are plumbing results: the model is scripted.

## The probe

`bun scripts/probe-pi-stewardship.ts --offline --out <dir>` runs both casts
and the Pi turn in a temporary HOME, XDG and TMPDIR, with synthetic keys,
and writes `result.json` and `report.md`. It imports the CLI's sources by
relative path, the documented exception for probes
(`scripts/probe-pi-delivery.ts` does too). Its own test runs it once
as a process, with sentinel roots that must stay empty.
