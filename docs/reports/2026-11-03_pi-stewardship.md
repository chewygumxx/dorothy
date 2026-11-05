---
ctime: 2026-11-03
mtime: 2026-11-05
spdx: GPL-3.0-only
title: Pi stewardship trial
description: >-
  The bounded live stewardship trial's runner, its offline tests and
  evidence, the proxy lifecycle fix it exposed, and the pending live gate
  that still needs user-signed worker homes and a budget.
tags:
  - dorothy
  - pi
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-11-03_pi-stewardship.md
   -
   -->

# Pi stewardship trial

## Summary

[The spec](../specs/2026-11-03_pi-delivery.md), increment B, and
[the plan](../plans/2026-11-03_pi-stewardship.md), Task 5. The bounded
live trial's runner and its offline tests are built. The live trial did
not run: its Codex and Claude homes were not signed in, no approved
Featherless budget was named, and the runner must not copy a
subscription credential. The live gate is **pending**, not passed.

The offline work proves plumbing, not model competence. It covers the
fixture and owner, registry ownership, dedicated panes read from herdr's
replies, budget reservation before paid calls, missing usage as unknown,
the turn and time caps, one actual interruption, one operator release,
one compaction with work in flight, sanitized evidence and cleanup of
only resources the runner created.

A live probe of the shared forwarding proxy exposed a lifecycle race:
the proxy settled a reply only at HTTP EOF, while Pi returns at SSE
`[DONE]` and may cancel before EOF. That cancel stored the initial empty
reply, lost usage, reserved the maximum cost and stopped every later
call. The proxy now settles a validated `[DONE]`; a true cut, a missing
finish marker or missing usage still stops with unknown accounting. This
was a proxy defect, not evidence about a model.

Captured output is in the directory beside this report:
[`offline.json`](./2026-11-03_pi-stewardship/offline.json),
[`offline-report.txt`](./2026-11-03_pi-stewardship/offline-report.txt),
[`focused-tests.log`](./2026-11-03_pi-stewardship/focused-tests.log)
and the controller's separate
[supplemental live
findings](./2026-11-03_pi-stewardship/supplemental-live-findings.txt).

## Versions and baseline

| Component | Version |
| --- | --- |
| Bun | 1.4.2 |
| Pi | 1.5.0, the CLI's pinned dependency |
| Model | `deepseek-ai/DeepSeek-V4.1-Flash-1017` |
| Branch | `feat/pi-stewardship` |
| Task base | `7c5639a` |
| Proxy extraction | `d825ce2` |

No live inference, herdr pane, worker login, secret decryption or merge
was performed by this implementation pass. The offline probe and tests
use temporary roots, a scripted provider and fake herdr replies only.

## What was added

- `scripts/pi-stewardship-trial.ts`: the runner. It checks the private
  trial directory, both worker homes and their own status commands, the
  caps and the budget before anything starts. It makes the fixture, one
  clone per worker, private immutable briefs and report slots, then one
  herdr workspace and only the panes it creates. A registry is written
  from creation replies with an explicit expiry. Pi's native interface
  runs through the delivery launcher; each request crosses the shared
  proxy, which reserves the worst cost and stops on the caps, budget or
  missing usage. The runner is the only receipt writer, forces an
  incomplete first fix for review, interrupts one worker once, releases
  the stranded task explicitly and logs it, compacts Pi with work in
  flight, and resumes from the ledger.
- `scripts/pi-stewardship-trial.test.ts`: the offline cycle with fake
  herdr, clock, proxy and workers, including ownership, fixture refusal,
  budget, usage, turns, time, interruption and release.
- `scripts/probe-pi-stewardship.ts`: argument parsing and production
  wiring for `--live`, `--release`, the registry, output directory,
  budget, turn and time caps, herdr, worker login checks, the memory
  service, Featherless's key, metadata, versions and `processAlive`.
- `packages/cli/src/hosts/pi/steward/owner.ts`: `runExamples`, run by
  the runner on an export of the revision it computed. Its exit code
  distinguishes the contract's examples passing from the owner's test
  failing; it writes no receipt. A failed export removes its directory.
- `scripts/pi-proxy.ts`: settle at SSE `[DONE]` once the reply has a
  finish marker and usage.
- `scripts/probe-pi-delivery.test.ts`: the regression for the proxy
  lifecycle.

## The proxy lifecycle bug

### What happened

A live supplemental run reached many successful tool-call turns on the
real model. A later turn completed normally and streamed usage and
`[DONE]`, but the proxy recorded
`400 probe: stream cut: client gone`, kept the maximum reservation and
refused all later calls. The model had selected tools normally; no
fixture code had been written yet.

### Root cause

`tap` parsed SSE lines but ignored `[DONE]`, calling its `end` callback
only when the upstream HTTP body closed or failed. Pi returns on
`[DONE]` and cancels its response reader without waiting for EOF. The
request abort handler then called `settle(call.reply, ...)` while
`call.reply` was still the initial empty object, because `onEnd` had not
run. The settled reply therefore had no usage or finish, so the
reservation was charged as spent and the proxy stopped permanently.

### Red and green

A new upstream sends `said`, `finish("stop")`, `usage` and `[DONE]`, then
holds the HTTP body open. The client reads through `[DONE]` and cancels.
Before the fix:

```text
(fail) settles a complete reply at DONE when Pi cancels before EOF
Received: "stream cut: client gone"
```

A second regression sends usage and `[DONE]` without a finish marker and
requires a cut, so a DONE cannot label an incomplete reply complete. It
also failed before the fix (`stream cut: client gone` instead of
`stream cut: no finish`). After the fix both pass, and the existing
missing-usage, true-cut, timeout, cost and turn tests still pass:

```text
10 pass
0 fail
53 expect() calls
```

The fix validates `finish` and `usage` before an ordinary settlement.
A true mid-stream cancellation, an upstream failure, a timeout, a DONE
without a finish marker and missing usage keep the reservation and stop
later calls with unknown cost. It does not weaken accounting or call an
incomplete reply complete.

## The runner's contract

- The registry is written by the runner from herdr's creation replies.
  Every entry must be a pane, name and clone this trial made; any other
  entry fails the run and is never touched.
- `verifySubmission` reads the clone's HEAD itself and runs the owner's
  sealed acceptance test on an export outside every clone. Only its
  receipt closes a task. A report's arbitrary verification string is
  never executed.
- An interrupted worker leaves its task reserved. The runner releases
  only its own stranded task as operator, logs who and why, and never
  exposes release as a model tool. `--release <task-id>` is the user's
  path and reads the runner's private state.
- Budget reservation happens before forwarding; a refusal costs no
  provider call. A reply without usage keeps its reservation and its
  cost is reported as unknown, never zero.
- Evidence is sanitized from before the first event. The pending
  checklist returned to the user keeps its paths; the copy written under
  `--out` carries placeholders only.

A receipt is evidence against a worker's report, not against hostile
code running as the runner's user. The workers run as the user with no
OS confinement, as the approved spec says.

## Offline evidence

The focused tests ran on the committed code:

```text
$ bun test packages/cli/src/hosts/pi/steward/owner.test.ts \
    scripts/pi-stewardship-trial.test.ts \
    scripts/probe-pi-delivery.test.ts \
    scripts/probe-pi-stewardship.test.ts
44 pass
0 fail
262 expect() calls
Ran 44 tests across 4 files.
```

The offline probe ran both casts and the scripted Pi turn:

```text
$ bun scripts/probe-pi-stewardship.ts --offline --out <tmp>
probe offline (plumbing): pass, 31 scenario runs, 232 checks,
0 failed, 0 duplicate dispatches, 0 false verified,
28 pending or unknown, 4/6 reviews agree with the owner.
```

The 28 pending or unknown tasks are deliberate: a vanished worker, a
claimed revision with no receipt, a failed report and similar
irresolvable fixtures stay visible. The 4/6 review agreement is a
measurement of scripted verdicts beside the owner's receipt, not model
competence.

## The live gate

The gate is pending on the user:

1. Make the trial directory and two temporary worker homes private.
2. Sign the trial's Codex and Claude accounts in, in those homes. Do not
   copy an existing home or subscription credential.
3. Read each account's quota in its own interface.
4. Stay near for first-run or trust dialogs; the runner records those as
   the user's interventions.
5. Run the probe with an explicit approved Featherless budget:

```text
bun scripts/probe-pi-stewardship.ts --live --registry <path> \
  --out <temporary-directory> --max-usd <number> \
  --max-turns 30 --timeout-ms 1800000
```

A missing login or budget leaves the gate pending while the offline
evidence remains reviewable. The production `RUNNERS.pi` wiring also
still waits on the user's `dorothy --pi --dump` and one real launch, as
the delivery report records.

### Supplemental live research, not acceptance

The controller separately exercised open-weight inference and worker
harnesses through a private gateway, not this runner's live gate. It
found both installed Codex and Claude shells usable with temporary homes
and a synthetic proxy credential, and it reproduced the proxy defect
above with a real Pi turn. It also saw one held-out scripted-worker
scenario reach a reported task and state its gaps without calling it
verified. That is a separate supplemental record
([copy](./2026-11-03_pi-stewardship/supplemental-live-findings.txt)).
It does not prove model competence, the runner's live gate, a completed
implementation, or subscription-account evidence.

## Cleanup and evidence findings

Two existing RED findings were diagnosed before the fixes:

- The successful trial left the private trial path in `events.jsonl`.
  The sanitizer was installed after the first `preflight` event, and the
  pending result was written unsanitized. The runner now installs the
  path sanitizer before its first event and sanitizes pending evidence;
  the in-memory checklist keeps real paths. A new pending-gate test
  checks that the written evidence contains placeholders.
- The test teardown failed with `EACCES` removing the sealed briefs
  directory (mode 0500). Teardown now makes the directories it created
  writable before removing its own temporary root. The successful cycle
  test creates the sealed briefs, so the file's `afterAll` is the
  regression.

A third pre-existing assertion expected the report to say "not against
hostile code"; the note says "not evidence against hostile code". The
expectation was corrected to the sentence the runner actually writes.

## Commands and results

```text
$ bun run check
typecheck, format, lint, markdown, YAML, secrets, em dash and header
checks clean; 4488 pass, 5 skip, 0 fail; 149048 expect() calls across
4493 tests in 216 files
```

## Deferred findings

New or carried findings are in
[the deferred record](../deferred/2026-11-03_pi-stewardship-deferred.md).
They include the pending live gate, the same-user limit of owner
receipts, live-only uncertainties about interruption and compaction, the
unexercised first-fix guarantee, and the production Pi wiring check.

## Commits

- `c03ec54` `fix(cli): Settle Pi proxy streams at DONE`
- `9bff276` `feat(cli): Run the owner's examples for a fix`
- `8ed522e` `feat(cli): Run the bounded Pi trial`
- `1d3ce27` `feat(cli): Wire the live stewardship trial probe`
- this report's commit, `docs(cli): Record the Pi stewardship trial`
