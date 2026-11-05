---
ctime: 2026-11-03
mtime: 2026-11-05
spdx: GPL-3.0-only
title: Pi stewardship trial
description: >-
  The bounded live stewardship trial's runner, its offline tests and
  evidence, the proxy lifecycle fix it exposed, and the pending live gate.
  Open-weight spending is authorized; each run still needs a numeric cap.
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
live trial's runner and its offline tests are built. The native mixed-
worker trial did not run: the confirmed temporary Codex and Claude homes
do not yet exist, and the runner must not copy a subscription credential.
Open-weight spending is explicitly unlimited, but the controller must set
an explicit numeric `--max-usd` for each run. The live gate is **pending**,
not passed. API-backed homes would be a disclosed deviation from the
original subscription-login evidence, not a substitute for it.

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
  missing usage. The runner is the only receipt writer, checks whether an
  incomplete first fix occurred for review, interrupts one worker once, releases
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
  `--out` carries placeholders and memory's public secret scrubbing.
  Pending evidence says `not-run`, never model-driven.
- A reservation pins a validated Herdr session, or a fresh worker's Linux
  foreground group leader and boot:start identity. Ledger schema 2 stores
  it; schema 1 rows migrate with no occupant and cannot mutate. The locked
  sender/interrupter checks it again before text, Escape or Ctrl+C.
- The native manifest carries the registry's exact SHA-256, fleet id and
  canonical fixture root. The helper refuses changed bytes before a send;
  the trial also treats every later byte change as a deviation. Raw shell
  access remains same-user and is not claimed to be confined.
- Review acceptance needs an owner-agreeing rejection of the incomplete
  revision and an owner-agreeing approval of the exact final revision.
  `fix-1`/`fix-1b` explicitly request the same deterministic partial
  candidate. This is declared fault injection, not a model mistake. The
  first attempt waits on an owner checkpoint and is interrupted; only an
  active `fix-1b` permits compaction, and confirmed compaction releases
  its checkpoint. `fix-2` fulfills the complete contract without one.
- Bootstrap accepts only a sentinel as a whole output line, not its echoed
  command. Process-pinned Ctrl+C confirms the original boot:start identity
  exited even if Herdr retains its name; home inspection uses the remaining
  wall deadline. The focused native contract is in the steward `TRIAL.md`.
- One deadline starts before preflight. Catalogue absence, invalid values
  or drift refuse before key loading. Startup, readiness, owner work and
  streams use the remaining time; cleanup has a recorded 10-second grace
  and an overrun cannot pass. Complete safe-integer usage and normalized
  outbound output limits are mandatory.
- Worker shells restore and verify the private HOME/XDG/harness roots
  after interactive startup. Codex uses `--no-daemon`; native Pi must show
  its version and a live foreground process before checked prompt writes.

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

The controller will choose the numeric run cap without asking again for
spending authorization. Before the native run:

1. Make the trial directory and two temporary worker homes private; the
   controller confirmed that these homes do not yet exist.
2. Establish the intended Codex and Claude homes without copying an
   existing home or subscription credential. API-backed homes require an
   explicit deviation from the original subscription evidence.
3. Read each account's quota in its own interface.
4. Provide `flock`, herdr, both worker CLIs, Git, tar and the pinned
   Pi/Node runtime, plus an isolated config with a Featherless chat route.
   Do not change normal route defaults or bypass `mise` trust globally.
5. Stay near for first-run or trust dialogs; the runner records those as
   the user's interventions and answers none itself.
6. Run the probe with the controller's explicit numeric cap:

```text
bun scripts/probe-pi-stewardship.ts --live --registry <path> \
  --out <temporary-directory> --max-usd <number> \
  --max-turns 30 --timeout-ms 1800000
```

Missing prerequisites leave the gate pending while offline evidence
remains reviewable. The separate production `RUNNERS.pi` smoke has now
completed under isolated configuration; its limits are below.

### Supplemental live research, not acceptance

The controller separately exercised open-weight inference and worker
harnesses through a private gateway, not this runner's live gate. It
found both installed Codex and Claude shells usable with temporary homes
and a synthetic proxy credential, and it reproduced the proxy defect
above with a real Pi turn. It also saw one held-out scripted-worker
scenario reach a reported task and state its gaps without calling it
verified. That is a separate supplemental record
([copy](./2026-11-03_pi-stewardship/supplemental-live-findings.txt)).
The later real-model/simulated-worker casts measured 17 calls and
US$0.006091503; one read hostile-report case measured seven calls and
US$0.002981397. The production dump and native final-turn smoke recorded
876 input and 8 output tokens, with Pi estimating US$0.0002043 but
provider billing unknown. That direct-provider, isolated-config smoke
had no proxy accounting and is not trial evidence.

Native no-inference observation also confirmed the identity fix's basis:
a same-pane Codex restart retained `terminal_id`, had null
`agent_session`, and changed its foreground PID/boot:start identity.
Post-shell CODEX_HOME restoration and `--no-daemon` were necessary. A
later native shell turn kept the same null session and process/start pin
through transient tool children; three provider calls measured
US$0.0020179872, including possible auxiliary work. Only owned panes and
two private dummy daemons were cleaned; the user's
daemon was untouched. None of this proves model competence, the native
mixed-worker gate or subscription-account evidence.

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
