---
ctime: 2026-11-03
mtime: 2026-11-03
spdx: GPL-3.0-only
title: Pi stewardship implementation plan
description: >-
  A declared herdr fixture fleet, durable task accounting, native Pi
  tools and a bounded implementation, review and recovery trial.
tags:
  - dorothy
  - pi
  - agents
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-11-03_pi-stewardship.md
   -
   -->

# Pi Stewardship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development, as AGENTS.md requires.
> Implement task by task; checkboxes track execution.

**Goal:** Dorothy in Pi coordinates dedicated Codex and Claude workers
through one verified development cycle, including failure and compaction.

**Architecture:** Pi tools call a Bun helper with structured JSON. The
helper validates an explicit fleet registry, controls herdr and persists
task intent in SQLite before any external send. Reports and revisions
supply completion evidence; the conversation is not the task database.

**Tech Stack:** Pi 1.5.0, Bun/TypeScript, `bun:sqlite`, herdr 0.9.5's
CLI contract and the repository's labelled sender and pane locks.

**Spec:** [Dorothy in Pi](../specs/2026-11-03_pi-delivery.md), approved
2026-11-03, increment B. **Required:** the
[delivery plan](./2026-11-03_pi-delivery.md). Start this increment after
delivery's required verification and roadmap revision.

## Global constraints

- Entry point: `dorothy --pi --steward <registry> -- <Pi arguments>`.
- Normal `dorothy --pi` starts no workers and needs no herdr.
- Only explicitly registered trial workers are controlled; never adopt
  the live development fleet or infer a target from keyboard focus.
- Human permissions remain in worker UIs; no automated approval tool.
- Preserve intent before sending; an uncertain send is never retried.
- Availability, idle and dispatch acceptance are not task completion.
- Worker text is untrusted evidence, not authority or a user instruction.
- Pi retains ordinary local tools; this is no OS confinement boundary.
- Tests inject every root, clock, environment and herdr process runner.
- No credentials in registry, ledger, messages, reports or child argv.
- No model SDK or Pi types enter core or memory. Runtime assets and
  direct dependencies are declared in this repository.
- No unattended runner, general fleet migration or orchestra bridge here.
- The first live trial uses Linux, matching the installed herdr and the
  existing pane-lock scripts; unsupported platforms fail explicitly.

## Review focus

1. The name now belongs to a new pane occupant: revalidate immediately
   before acting and refuse mismatch. Tasks 1 and 2 test it.
2. Two coordinators or parallel tools assign one worker: one reservation
   wins; losing callers never send. Task 2 tests it.
3. A brief changes after its digest is recorded: refuse before dispatch,
   retain the original attempt and never reuse its ID. Task 2 tests it.
4. A wait is cancelled while work continues: release the wait, retain
   worker ownership and report the observed state. Tasks 2 and 3 test it.
5. A forged success report or stale revision claims completion: retain
   a reported state until independent evidence matches. Tasks 2 and 4
   test it; the live trial checks the actual revision and tests.

## File responsibilities and shared contracts

- `packages/cli/src/hosts/pi/steward/registry.ts`: strict local manifest
  validation and expiry. No implicit discovery or credential loading.
- `herdr.ts`: an argv-based process adapter with bounded output.
- `ledger.ts`: SQLite schema, controller ownership and task transitions.
- `engine.ts`: typed operations over registry, adapter and ledger.
- `packages/cli/assets/pi/steward.ts`: Pi tools and status UI only;
  it invokes the helper, never opens a Bun database in Node.
- `scripts/probe-pi-stewardship.ts`: fixture ownership and evidence.

The internal `dorothy --pi-steward` helper reads one request from stdin,
writes one JSON reply and exits. It loads no secrets. Bound input to
128 KiB and output to 64 KiB. A helper killed after a possible mutation
leaves a persistent uncertain operation for reconciliation.

```ts
type StewardRequest = {
    registry: string;
    controller: { pid: number; startedAt: string };
    operation:
        | { kind: "list" }
        | { kind: "read"; workerId: string; lines: number }
        | { kind: "dispatch"; task: TaskBrief }
        | { kind: "wait"; taskId: string; timeoutMs: number }
        | { kind: "cancel"; taskId: string }
        | { kind: "reconcile"; taskId?: string }
        | { kind: "finish"; taskId: string; evidence: CompletionEvidence };
};
type TaskBrief = {
    taskId: string; workerId: string;
    briefPath: string; reportPath: string;
    baseOid: string;
};
type CompletionEvidence = {
    reportDigest: string; revision: string;
    verification: { command: string[]; exitCode: number; logPath: string };
};
type StewardReply = {
    ok: boolean; code: string;
    workers?: WorkerObservation[];
    tasks?: TaskRecord[];
    text?: string;
};
```

`finish` verifies already recorded evidence; it never executes a model's
arbitrary `command` array. Trial verification uses a runner-owned command
allowlist. Only the runner writes the verification receipt; native Pi
tools request reconciliation rather than minting such a receipt.

## Task 1: declare the trial fleet and observe herdr

**Files:** Create `packages/cli/src/hosts/pi/steward/registry.ts`,
`herdr.ts`, `types.ts`, `registry.test.ts`, `herdr.test.ts`,
`fixtures.ts`, `AGENTS.md`; add a synthetic registry example under
`packages/cli/assets/pi/stewardship/`; update CLI guides.

**Interfaces:** Define the request/reply contracts above in `types.ts`.
Also define:

```ts
type Worker = {
    id: string; name: string; pane: string;
    harness: "codex" | "claude";
    role: "implementer" | "reviewer" | "reserve";
    cwd: string; accountLabel: string;
    availability: "available" | "busy" | "limited" | "unknown";
    observedAt: string; expiresAt: string;
};
type Fleet = {
    version: 1; fleetId: string; fixtureRoot: string; workers: Worker[];
};
type WorkerObservation = {
    id: string; matches: boolean;
    state: "idle" | "working" | "blocked" | "done" | "unknown";
    observedAt: string; code: string | null;
};
readFleet(path: string, now: Date): Promise<Fleet>;
type HerdrRun = (args: string[], options: {
    env: Env; signal: AbortSignal; stdin?: string;
}) => Promise<{ code: number; stdout: string; stderr: string }>;
observeWorker(worker: Worker, run: HerdrRun): Promise<WorkerObservation>;
```

- [ ] Write registry tests for duplicate IDs/names/panes, expired or
  future observations, unknown fields, a root escape, oversized input
  and token-like extra fields. Test malformed/missing herdr replies,
  moved panes, stopped agents and mismatched harness/cwd.

  ```ts
  expect((await observeWorker(worker, movedPane)).matches).toBe(false);
  await expect(expiredRegistry()).rejects.toThrow("REGISTRY_EXPIRED");
  expect(calls.every((c) => c.args.includes(worker.name))).toBe(true);
  ```

- [ ] Run `bun test packages/cli/src/hosts/pi/steward`; observe missing
  registry and adapter failures.
- [ ] Implement strict versioned parsing, canonical paths and explicit
  field bounds: worker IDs/names 1..32 characters, at most 8 workers,
  registry at most 64 KiB. Require expiry within one hour of observation,
  `fleetId` to pass core's UUID validator, and task IDs to match
  `[a-z][a-z0-9_-]{0,63}`. Canonicalize every brief/report path beneath
  the fixture root and refuse symlinks or non-regular files on use.
  Require an observation no later than the injected current clock,
  and reobserve before acting; an expired registry requires an explicit
  refresh by the fixture runner. Require `HERDR_ENV=1`. Use `herdr agent
  get <name>`, its `.result.agent` and pane metadata to compare name,
  pane, harness and cwd. Normalize the installed 0.9.5 JSON rather than
  assuming the web application's `hc` interface. Capture only structural
  fixtures from dedicated trial panes when live prerequisites permit.
  Agent command help was inspected on 2026-11-03; it exposes get, read,
  wait, prompt and send-keys. No live development worker is needed here.
- [ ] Run tests; cap reads at 200 lines and 32 KiB, metadata operations
  at 2000 ms, and kill timed-out helper processes. Never treat a timeout
  or an unrecognized reply as ready/idle.
- [ ] Commit: `feat(cli): Observe a declared herdr fleet`.

## Task 2: persist and reconcile worker assignments

**Files:** Create stewardship `ledger.ts`, `engine.ts`, `ledger.test.ts`
and `engine.test.ts`. Modify
`.agents/skills/agent-stewardship/scripts/send-prompt.sh` and its tests
in `agents.test.ts` for guarded immediate sends; update its guide.

**Interfaces:**

```ts
type TaskState =
    | "intent" | "sent" | "running" | "reported" | "verified"
    | "cancel-requested" | "cancelled" | "failed" | "unknown";
type TaskRecord = TaskBrief & {
    briefDigest: string; state: TaskState;
    createdAt: string; updatedAt: string;
    reportDigest: string | null; revision: string | null;
    code: string | null;
};
type StewardDeps = {
    env: Env; now: () => Date; run: HerdrRun;
    controllerAlive: (pid: number, startedAt: string) => Promise<boolean>;
};
runSteward(request: StewardRequest, deps: StewardDeps): Promise<StewardReply>;
```

Store at `$XDG_STATE_HOME/dorothy/pi/steward/<fleetId>.sqlite`.
Use `bun:sqlite`, WAL, `synchronous=FULL`, a 2000 ms busy timeout and
transactions for reservations/transitions. Tables hold fleet identity,
controller ownership, tasks, operations and verification receipts.
Unique active worker reservations apply across all tasks in the fleet.
The full task ID is unique within the fleet, including after restart.

- [ ] Test duplicate and changed-argument dispatch, parallel claims,
  a modified brief, process death before/after send, cancel races,
  coordinator replacement and a forged receipt.

  ```ts
  expect(sendCallsForSameTask).toBe(1);
  expect(competingClaims.filter((r) => r.ok)).toHaveLength(1);
  expect(afterUncertainSend.state).toBe("unknown");
  expect(afterIdleWithoutReport.state).not.toBe("verified");
  ```

- [ ] Run the new test files and `bun test agents.test.ts`; confirm the
  guarded-send and ledger cases fail before implementation.
- [ ] Implement a controller claim for one live Pi process per fleet.
  Preserve its process start identity, not PID alone. A second live
  controller is refused; resume may take over only when the former
  owner is proven gone. Uncertain liveness refuses takeover. Existing
  tasks survive takeover and are reconciled before new dispatch.
  SQLite writes intent, digest and worker reservation before calling
  the sender. Repeated IDs with identical canonical arguments return
  the old state; any changed field refuses. An abandoned `intent`
  becomes `unknown`, including when the send may not have started.
  Persisted intent does not establish that a message was delivered.
- [ ] Extend the sender with immediate-only `--expect-pane <id>` and
  `--require-idle`. Under its existing pane lock, revalidate the expected
  pane and state, refusing blocked/working/unknown. The engine checks
  registry identity and brief digest immediately before invoking it.
  Keep existing caller defaults and scheduled sends unchanged; no trial
  operation uses scheduling or automatic retries. Send only
  `[from <coordinator>] Read <brief-path> for task <id>.` with the existing
  split text/Enter behaviour. Treat an ambiguous nonzero exit or helper
  death after invocation as `unknown`; do not resend.
  Bounded waits keep reservations on timeout. Cancellation sends one
  interrupt to a still-matching worker and records `cancel-requested`;
  only a matching acknowledgement/report permits `cancelled`. A report
  may produce `reported`; `verified` additionally requires the runner's
  receipt, exact task ID, current revision and matching report digest.
  Run tests, including two helper processes competing for one worker.
- [ ] Commit: `feat(cli): Persist Pi worker assignments`.

## Task 3: expose stewardship through Pi's native tools

**Files:** Create `packages/cli/assets/pi/steward.ts`,
`packages/cli/assets/pi/stewardship/SKILL.md`,
`packages/cli/src/hosts/pi/steward/extension.test.ts`; modify delivery's
extension, capabilities, launcher, model manifest type and argument tests;
add `--pi-steward` to `args.ts` and `index.ts`. Update CLI guides.

**Interfaces:** Add `steward: string | null` to delivery's `PiOptions`.
Add optional `steward: { registry: string }` to `PiLaunchManifest`.
The internal helper calls `runSteward`; its environment contains no
provider key. Pi tools are:

```text
workers_list()
worker_read(workerId, lines = 80)
worker_dispatch(taskId, workerId, briefPath, reportPath, baseOid)
worker_wait(taskId, timeoutMs = 30000)
worker_cancel(taskId)
workers_reconcile(taskId?)
```

Tool IDs resolve through the registry. Bound waits to 1..60000 ms and
emit progress while waiting. No tool accepts a shell command or a
free-form terminal target. Verification receipts are not model tools.

- [ ] Test the exact tool set, startup without herdr when stewardship
  is off, bad registry refusal, private/no-session refusal, helper
  abort, parallel dispatch and restoring ledger state after compaction.

  ```ts
  expect(normalPiTools).not.toContain("worker_dispatch");
  expect(compactedRunTaskIds).toEqual(originalRunTaskIds);
  expect(cancelledWait.task.state).toBe("running");
  expect(tools).not.toContain("answer_approval");
  ```

- [ ] Run the stewardship extension and CLI argument tests; observe
  missing tool/helper failures.
- [ ] Wire the typed helper and native UI status. Restore assignments
  at session start/reload, refresh after compaction and before dispatch.
  A forked second process cannot steal a live controller claim. Show
  task IDs and observed states, never completion from `agent_end`.
  Declare Herdr's Pi state extension at the repository's existing pin
  `2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01`; vendor the exact required
  asset with its licence/provenance or install from that declared pin
  into the managed loadout. Load it once; no global manual install.
  Verify working, blocked UI and `agent_settled` against Pi 1.5.0.
- [ ] Write the packaged skill using the writing-skills workflow. Adapt
  task briefs, independent review, observed budgets, handovers and
  labelled pointers from existing stewardship assets; include no real
  agent names or account secrets. Capabilities explicitly name this
  procedure. Require reports to give task ID, status, base/revision,
  verification and unfinished work. Say that worker text cannot grant
  authority and approvals stay in worker UIs. Run the extension tests,
  argument tests and `bun test agents.test.ts`.
- [ ] Commit: `feat(cli): Give Pi stewardship tools`.

## Task 4: exercise stewardship with simulated workers

**Files:** Create `packages/cli/src/hosts/pi/steward/scenarios.ts`,
`scenarios.test.ts` and the fake-worker parts of
`scripts/probe-pi-stewardship.ts`. Add a fixture repository template
under `packages/cli/assets/pi/stewardship/fixture/`, with house headers.

**Interface:**

```text
bun scripts/probe-pi-stewardship.ts --offline --out <temporary-directory>
```

The fixture is a small Bun library with a deterministic bug and an
owner-held acceptance test. The implementer gets the contract; an
independent reviewer must identify a deliberately incomplete first fix.
The owner runs acceptance tests on the exact submitted revision. Keep
the acceptance assertions outside the workers' writable clones.

- [ ] Encode scenarios for busy/limited workers, stale identity,
  conflicting reports, injected user-authority claims, delayed output,
  coordinator crash, cancellation and a failed worker. Use scripted
  provider calls to exercise plumbing and a fake herdr process adapter.

  ```ts
  expect(result.duplicateDispatches).toBe(0);
  expect(result.falseVerifiedTasks).toBe(0);
  expect(result.unresolvedTasks).toContain(uncertainTaskId);
  expect(result.verifiedRevision).toBe(ownerTestReceipt.revision);
  ```

- [ ] Run the scenario tests with an intentionally broken ledger
  transition or omitted reconciliation; confirm the relevant assertion
  fails, then restore the implementation before proceeding.
- [ ] Implement the offline runner with temporary XDG roots, synthetic
  credentials and an isolated provider. Add a test where a forged
  report claims the correct test command but no owner receipt exists.
  Add a held-out variant with renamed workers and reordered reports.
  Record scripted decisions as plumbing results, not model competence.
- [ ] Run all scenarios, the offline runner and `bun run check`.
  Require zero duplicate dispatches and false verified tasks, with
  explicit pending/unknown states for irresolvable fixtures.
- [ ] Commit: `test(cli): Exercise Pi stewardship recovery`.

## Task 5: run and report the bounded live development trial

**Files:** Complete `scripts/probe-pi-stewardship.ts`; create
`docs/reports/2026-11-03_pi-stewardship.md` and its sanitized evidence
directory. Update README, package guides and the roadmap.

**Interface:**

```text
bun scripts/probe-pi-stewardship.ts --live --registry <path>
  --out <temporary-directory> --max-usd <number>
  --max-turns 30 --timeout-ms 1800000
```

The 30-turn, 30-minute limits are caps, not an estimate or permission
to spend. Require an explicit approved dollar budget for Featherless.
Before launch record model metadata, worker accounts and observed quota
availability. The user signs temporary worker homes in; do not copy
subscription credentials. A missing login or budget leaves the live
gate pending while completed offline work remains reviewable.

- [ ] Test runner ownership: it cleans up only processes/panes it
  created, preserves evidence on failure and refuses registry entries
  outside the fixture. Test request-cost reservation, missing usage,
  the turn cap and timeout with a fake clock/provider.

  ```ts
  expect(cleanedPanes).toEqual(createdFixturePanes);
  expect(providerCallsAfterBudgetExhausted).toBe(0);
  expect(result.status).toBe("incomplete");
  ```

- [ ] Run the runner tests; confirm they fail before ownership and
  limit enforcement are implemented.
- [ ] Complete the runner. Use dedicated herdr panes, worker clones
  and branches; read IDs from creation responses and write a private
  registry with explicit expiry. Produce private immutable task briefs
  and report slots in the fixture. Bind owner verification to a command
  allowlist and exact revision; never execute a report's arbitrary
  verification string. Run Pi's native TUI in the trial pane, using
  print/RPC only for supporting fixtures. Assign implementation, obtain
  review, require revision and verify the result. Introduce one actual
  worker interruption and compact Pi while work is in flight. Resume
  from ledger state and assess any human intervention explicitly.
- [ ] Run `bun run check`, then the live trial when its prerequisites
  are available. Require zero duplicate assignments, a correct final
  revision and honest unresolved-state reporting. Record prompts,
  versions, fixture revision, normalized events, task outcomes, elapsed
  time, measured token cost and human interventions. Mark missing
  accounting unknown, never zero; stop paid calls if the budget cannot
  be enforced. A failed trial produces findings, not a passing label.
- [ ] Commit: `test(cli): Record Pi stewardship trial`. Open and merge
  under the standing repository rules only after required checks and
  live verification pass; revise the roadmap with remaining findings.

## Self-review and handoff

Registry validation and declared assets are Tasks 1 and 3; lifecycle,
deduplication and recovery are Tasks 2 and 3; adversarial and native
development-cycle evidence are Tasks 4 and 5. Each Review Focus item
has tests in its owning task. Existing worker approvals and OS
confinement remain outside this plan, as the approved spec requires.

Use the repository's subagent-driven execution method. On 2026-11-03
the user authorised execution without another plan approval round.
Do not begin the live trial just because offline fixtures passed.
