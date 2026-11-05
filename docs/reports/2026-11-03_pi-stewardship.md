---
ctime: 2026-11-03
mtime: 2026-11-06
spdx: GPL-3.0-only
title: Pi stewardship trial
description: >-
  The bounded live stewardship trial's runner, its offline tests and
  evidence, the proxy lifecycle fix it exposed, and the bounded native
  acceptance at b38393c with its limits.
  Open-weight spending was authorized with a numeric cap per run.
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
live trial's runner and its offline tests are built. Three early native
attempts failed before any provider request. The first two exposed a
missing Herdr control binding; the third waited for an unanswered human
Claude folder-trust decision. Seven model-driven attempts then ran a
real coordinator and workers: attempts 4 to 9 stayed `incomplete`,
mostly at the 30-request cap, attempt 7 exposed a real done-state bug
that was fixed and reviewed, and attempt 10 passed all eleven acceptance
checks at product `b38393c` on a bounded Linux, synthetic API-backed
configuration. That is one controlled cycle's evidence, not
subscription-model evidence, a reliability estimate or general
production readiness. Offline or scripted results still cannot
substitute for native acceptance, and open-weight spending still needs
an explicit numeric cap for each run.

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
[`focused-tests.log`](./2026-11-03_pi-stewardship/focused-tests.log),
the sanitized
[native acceptance export](./2026-11-03_pi-stewardship/native-acceptance.json)
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

The native acceptance run's versions are in its own section below. No
live inference, herdr pane, worker login, secret decryption or merge was
performed by the implementation pass. The offline probe and tests use
temporary roots, a scripted provider and fake herdr replies only.

## What was added

- `scripts/pi-stewardship-trial.ts`: the runner. It checks the private
  trial directory, both worker homes and their own status commands, the
  caps and the budget before anything starts. It makes the fixture, one
  clone per worker, private immutable briefs and report slots, then one
  herdr workspace and only the panes it creates. A registry is written
  from creation replies with an explicit expiry. Pi's native interface
  runs through the delivery launcher; each request crosses the shared
  proxy, which reserves the worst cost and stops on the caps, budget or
  missing usage. The runner is the only receipt writer, declares an
  incomplete first candidate for review, interrupts one worker once,
  releases the stranded task explicitly and logs it, compacts Pi with
  work in flight, and resumes from the ledger.
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
  entry fails the run and is never touched. The exact resolved registry,
  even with a custom basename, must be absent and have no symlinked path
  component. It is created exclusively, never by truncating prior bytes.
- `--out` must be absent with existing non-symlink ancestors. An existing
  file, empty or nonempty directory, symlink or symlink alias is refused
  before key loading, paid calls or pane creation. A safe fresh output is
  created privately and non-recursively; its event stream and all other
  evidence files are exclusive creates. Rejected output gets no pending or
  error files, has `outputOwned: false` and keeps its original bytes. The
  CLI prints those preflight problems. Other preflight failures preserve
  sanitized pending evidence in the new safely owned output.
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
  and an overrun cannot pass. Version subprocesses are cancellable. The
  native plan's `stewardDeadlineAt` reaches the launch manifest, helper,
  engine and locked scripts; it is never a model argument. Scripts refuse
  pre-write expiry with exit 10 and preserve post-text uncertainty with
  exit 11. Ordinary `--pi` has no trial wall and keeps its usual bounds.
- Complete safe-integer usage and normalized outbound output limits are
  mandatory. With neither output field supplied, the proxy injects the
  reviewed maximum as `max_completion_tokens`, matching its reservation.
- Worker shells restore and verify the private HOME/XDG/harness roots
  after interactive startup. Codex uses `--no-daemon`. Native launch
  records the launcher and exact spawned Pi PIDs; both boot:start
  identities must stay alive and match the foreground group before
  kickoff. A banner with a live shell or foreign job is insufficient.
  The result remains `not-run` until a provider request is observed.
  Successful kickoff Enter with zero requests does not count as
  model-driven; a real request does.
- Live Herdr calls, home inspection, interruption and Pi's helper share
  one explicit control environment: the owner's declared
  `HERDR_SOCKET_PATH`, `HERDR_ENV`, PATH/HOME and locale, plus a
  trial-owned `XDG_RUNTIME_DIR` for one pane-lock namespace. Pi's
  config/data/state/cache stay isolated. Provider and age keys are not
  copied; an absent or relative socket is refused before startup.

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

The controller chose the numeric run cap without another spending
request. The declared preconditions for a run, kept as the checklist the
controller used:

1. Make the trial directory and both worker homes private. They were
   created fresh for this experiment and never copied a subscription
   home or auth; attempt 10 reused them at the same exact paths.
2. Establish the intended Codex and Claude homes without copying an
   existing home or subscription credential. The accepted run used those
   synthetic API-backed homes, the declared deviation from original
   subscription evidence.
3. Read each account's quota in its own interface.
4. Provide `flock`, herdr, both worker CLIs, Git, tar and the pinned
   Pi/Node runtime, plus an isolated config with a Featherless chat route.
   Normal route defaults were not changed and `mise` trust was not
   bypassed globally.
5. Stay near for first-run or trust dialogs; the runner records those as
   the user's interventions and answers none itself. The human
   explicitly delegated Claude trust and tool authorization for the run.
6. Run the probe with the controller's explicit numeric cap:

```text
bun scripts/probe-pi-stewardship.ts --live --registry <path> \
  --out <temporary-directory> --max-usd <number> \
  --max-turns 30 --timeout-ms 1800000
```

Earlier attempts left the gate pending while offline evidence remained
reviewable; the accepted run then proceeded under the deviations below.
The separate production `RUNNERS.pi` smoke completed earlier under
isolated configuration; its limits are below.

### Early attempts

The first three native attempts made zero provider requests. The first
stopped incomplete before any request with `agent get trial-codex: worker
home is not the trial home`, while all three panes it created were
closed. A read-only profile diagnostic showed the worker's actual HOME,
CODEX_HOME and cwd were the expected private roots. The missing context
was the owner's declared Herdr socket and the trial lock runtime in the
verifier's control environment. A second run also made zero requests.
The third reached an actual Claude folder-trust dialog but received no
human answer; it also made zero requests. None is a passed trial or
evidence of model competence. These attempts stay as failed history.

### Model-driven attempts before acceptance

Attempts 4 to 9 each started a real coordinator and workers, and each
stopped `incomplete` at the 30-request cap. Attempt 4 stopped on a small
session that Pi's default `keepRecentTokens` 20000 rejected; the owned
fixture then set `keepRecentTokens` 1024. Attempt 5 hit the cap. Attempt
6 ran under too narrow permissions. Attempt 7 exposed a real L2
done-state bug, fixed in `040c4d0` and `b38393c` and reviewed. Attempts 8
and 9 completed the core cycle but lacked a final state file at the cap.
They remain incomplete history and are not folded into the pass. Usage
is the coordinator's declared-price total; cost is the workers'
conservative accounted total.

| # | Stop | Requests | Usage US$ | Calls | Cost US$ | Panes |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | cap 30 | 30 | 0.011283912 | 22 | 0.011551932 | 3 closed |
| 5 | cap 30 | 30 | 0.017152782 | 26 | 0.015121884 | 3 closed |
| 6 | cap 30 | 30 | 0.016564287 | 29 | 0.014754492 | 3 closed |
| 7 | cap 30 | 30 | 0.015999858 | 29 | 0.022976700 | 3 closed |
| 8 | cap 30 | 30 | 0.013670799 | 48 | 0.039762934 | 3 closed |
| 9 | cap 30 | 30 | 0.017966937 | 46 | 0.045545952 | 3 closed |

### Attempt 10, the accepted run

Attempt 10 passed (`result` `pass`) at product
`b38393c3fa124e69c0edd8d0b41e8c93f2f6235f`. All eleven checks were true,
with no waiver: registry ownership, sealed kit, no duplicate assignment,
final revision, honest states, a real guarded worker exit and new
occupant, compaction with work in flight, the review loop, limits, no
key at rest and cleanup. The controller's manual assessment also agreed
that the final state file matched the ledger and that no coordinator
implemented anything itself.

The actual final revision was
`7ddcd973577fab48e3f0c07bc643da2b29bbd287`. Its owner receipt and examples
passed, the current HEAD matched it, and the final review approved the
same revision. The first review had requested changes on exactly
`61783a326057ebace52a04179e24bbbf4ff292ba`, whose owner test failed and
whose owner agreed with the rejection. `fix-1`/`fix-1b` kept the declared
partial candidate, `fix-2` passed, and `review-2` approved. No honest
state mismatched the ledger.

The run used Pi 1.5.0, Node v24.22.1, herdr 0.9.5 and Bun 1.4.2. Compaction
was confirmed while Pi was busy, with 9 calls before and 18 after its
2026-11-05T16:22:52Z entry.

| Measure | Accepted run | Cap |
| --- | --- | --- |
| Coordinator requests | 27, 0 refused, 0 unknown | 30 |
| Coordinator usage price | US$0.016791567 | US$5 |
| Worker calls | 47 | 100 |
| Worker conservative cost | US$0.031589844, 0 held unknown | US$10 |
| Worker output tokens per call | not totalled | 8192 |
| Safety stop | false | false |
| Elapsed | 329778 ms | 1798148 ms |
| Owned panes closed | 3 of 3, none failed or left open | 3 |

These are usage multiplied by declared or catalogue prices, not provider
invoices and not all-mission spending. The isolated gateway caps were 100
worker calls, US$10 and 8192 output tokens per call. The private research
helper held two unknown transport calls of US$1.376256 apart from
US$0.697854 of known usage-price subtotal; that audit is
controller-private, outside the native cycle accounting, and total
mission billing is not known.

The run's declared deviations, preserved in the export: private
API-backed profiles created fresh for this experiment and reused at the
same paths, with synthetic gateway keys and no copied subscription auth;
coordinator `deepseek-ai/DeepSeek-V4.1-Flash-1017` on
Featherless; worker `deepseek/deepseek-v4.1-flash-1017` on OpenRouter;
explicit human delegation of Claude trust and tool authorization, with an
isolated Bash/Read/Write/Edit allowlist, owned fixture access and
`acceptEdits`; and owned-fixture `keepRecentTokens` 1024. Interruption,
release and compaction-busy timings were declared at 60 s, 10 s and 1 s.
The first candidate was declared fault injection, so this is a
fault-aware controlled cycle, not evidence of competence at unexpected
failures. Workers ran as the same user, with no OS confinement or
hostile-code verification claim. Normal `--pi` has no Herdr or workers;
the normal user config still lacks a Featherless chat route and was not
changed.

The controller's initial operator guidance was part of the accepted
conditions: a 30-request cap including compaction and final reporting,
six requests reserved for owner updates and the final report, a
preference for long waits and grouped reads, and the disclosed
controlled schedule of a 60 s interruption, a 10 s release and the retry
checkpoint held until compaction. No implementation, revision, result,
verdict or final state was supplied by that guidance. It is recorded as
`deviations.initialOperatorGuidance` in the export.

The pass covers one configured Linux native Pi/Codex/Claude cycle on
open-weight APIs. It is not subscription-model evidence, not an estimate
of model reliability and not general production readiness. Working Codex
history reads sometimes fail closed, so full dialog-bridge coverage and
hostile-code confinement remain unproven.

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
daemon was untouched. None of this proves model competence or
subscription-account evidence; the later bounded acceptance and its
limits are above, and this research stays separate from that accounting.

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

## Final ownership and taxonomy checks

The final fix wave first reproduced WB-3 and WB-4 with eight focused fake
tests. All eight failed: the custom registry and five output-reuse cases
ran or threw, the registry symlink was not protected, and accepted
kickoff with no request was labeled `model-driven`. After implementation,
the same eight passed with 65 assertions. The final combined covering
suites passed 147 tests with 692 assertions, including a fresh output
full fake cycle and an actionable CLI rejection whose reused
`result.json` stayed unchanged.

The requested output and registry tests use fakes only. They count zero
upstream key loads, provider requests and created trial panes, and compare
all preserved bytes. They establish no native acceptance.

## Commands and results

The latest head's CI run `42060608635` passed: typecheck, format, lint,
markdown, YAML, secrets, em dash and header checks clean, then 4551 tests
with 5 skipped and 0 failed. The implementation pass's earlier local
`bun run check` reported 4545 pass, 5 skip and 0 fail. This evidence-only
revision ran the Markdown, header and JSON format checks alone; no
runtime test repeated the full suite for unchanged code.

## Deferred findings

New or carried findings are in
[the deferred record](../deferred/2026-11-03_pi-stewardship-deferred.md).
The native gate is now recorded passed at `b38393c` with its limits; the
record keeps the same-user limit of owner receipts, the live-only
uncertainties around interruption and compaction, and the small adapter
edges.

## Commits

- `c03ec54` `fix(cli): Settle Pi proxy streams at DONE`
- `9bff276` `feat(cli): Run the owner's examples for a fix`
- `8ed522e` `feat(cli): Run the bounded Pi trial`
- `1d3ce27` `feat(cli): Wire the live stewardship trial probe`
- `040c4d0` `fix(cli): Accept completed workers for dispatch`
- `b38393c` `docs(cli): Explain steward ready state`
- this report's commit, `docs(cli): Record native stewardship acceptance`
