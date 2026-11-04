---
ctime: 2026-11-04
mtime: 2026-11-04
spdx: GPL-3.0-only
title: packages/cli/src/hosts/pi/steward/AGENTS.md
description: >-
  Pi stewardship: the declared trial fleet of Codex and Claude workers in
  herdr panes, its observation, ledger and engine, the `--pi-steward`
  helper and how `dorothy --pi --steward` loads them.
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
  `TaskBrief`, `CompletionEvidence`, `TaskState`, `TaskRecord`), and
  `StewardError`, whose `code` begins its message.
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
- `ledger.ts`: `openLedger`, one SQLite file per fleet at
  `ledgerPath(env, fleetId)`, `$XDG_STATE_HOME/dorothy/pi/steward/`
  `<fleetId>.sqlite` (HOME's `.local/state` if unset, else refused),
  0600 in a 0700 directory, WAL, `synchronous=FULL`, a 2000 ms busy
  timeout, every write a `BEGIN IMMEDIATE` transaction. Tables: `fleet`
  (a file of another fleet is refused), `controller`, `tasks`,
  `operations`, `receipts`. A partial unique index holds each worker for
  one task in an active state (all but `verified`, `cancelled`,
  `failed`); a task id is the primary key, so never reused. `move` is a
  compare-and-swap from named states; `begin` and `conclude` pair a task's
  move with its operation. `claim`: the first controller claims, the same
  `{pid, startedAt}` holds, another takes over only when liveness proves
  the owner gone (a swap, so one of two wins); live is
  `CONTROLLER_LIVE`, a rejected check `CONTROLLER_UNCERTAIN`.
  `recordReceipt` is the runner's, never a Pi tool's.
- `engine.ts`: `runSteward(request, deps)`, one request, one reply, never
  a throw. It reads the registry, opens the ledger, claims, and after a
  takeover reconciles every task first. `dispatch` checks the brief
  (`isTaskId`, a declared and available worker, a 40 or 64 hex
  `baseOid`, paths with no control character through `fixturePath`,
  no report yet), then: a repeated id with identical arguments and brief
  gives the old state (`TASK_EXISTS`), a changed one `TASK_CONFLICT` or
  `BRIEF_CHANGED`. A new task needs the worker matching, idle and with a
  terminal id, pinned when `reserve` records intent, digest and
  reservation. Immediately before the send it observes again (refused
  unless matching, idle and the pinned terminal, else
  `WORKER_REPLACED`), then rereads the brief's digest; such a refusal
  fails the task, its id spent. The sender is `send-prompt.sh --from
  dorothy --expect-pane <pane> --require-idle <name>`, stdin `Read
  <brief> for task <id>.`, for 15 s: exit 0 is `sent`, 2 to 6 a refusal
  (`failed`), anything else, a throw or a timeout `unknown`, never
  resent. A pending operation whose helper is proven gone makes its
  intent `unknown` (`SEND_ABANDONED`). `wait` (0 to 60000 ms) reconciles:
  a report naming the task (`Task: <id>` line; `Status:`, `Revision:`
  are claims) is `reported`, work seen after a send `running`; idle is
  never done, and a timeout keeps the reservation. `cancel` records
  `cancel-requested`, then sends one Escape through `send-interrupt.sh
  --expect-pane --expect-terminal <pinned> --lock-wait 5` (15 s), under
  the pane lock: its refusals before sending (2, 3, 4, 5, 7, 8) withdraw
  the request (`CANCEL_NOT_SENT`), any other failure keeps it
  (`CANCEL_UNCERTAIN`); only a report saying `cancelled` cancels.
  `finish` runs nothing: a `reported` task is `verified` only on a
  receipt for its id, current revision and unchanged report digest, with
  the same command, exit and log (exit nonzero: `failed`). A receipt
  checks a report's claims, not hostile code run as the runner's user.
  `read` takes 1 to 200 lines, refusing over 32 KiB. `list` adds each
  observation's registry `availability`. `processStart`, `processAlive`:
  Linux's `<boot id>:<start ticks>` identity, and production liveness.
- `fixtures.ts`: `writeRegistry` (private roots), `fakeHerdr`, whose
  replies have herdr 0.9.5's structure with every value invented, and
  `fakeSender`, which records each call to a sender or the interrupter
  and scripts its exit. The fake herdr serves `agent get` alone and
  refuses any other command; with `{steward: true}` it also serves
  `agent read`, recorded. Capture new ones from trial panes, sanitized.
- `helper.ts`: `stewardHelper`, `dorothy --pi-steward` (`index.ts`):
  one request of at most 128 KiB (else `REQUEST_TOO_LARGE`, nothing
  run), `runSteward` with `createHerdrRun()` and `processAlive` over the
  environment it is given, one reply of at most 64 KiB (else
  `REPLY_TOO_LARGE` and the code). It loads no secrets.
- `stand-in.ts`: the shell stubs and the `dorothy` stand-in that tests and
  the probe spawn. `owner.ts`, `simulation.ts`, `scenarios.ts`,
  `pi-scenario.ts`: the owner's verification and the simulated workers
  ([fixture guide](../../../../assets/pi/stewardship/fixture/AGENTS.md)).

## The launch

`dorothy --pi --steward <registry>` (`../launch.ts`), Linux alone
(`steward_platform`), refuses `--no-session` (exit 2) and checks the
registry, resolved from the user's directory and not through a link,
with `readFleet` before any secret (`steward_registry: <code>`). The
manifest then names it (`steward.registry`), and Pi gets herdr's
vendored Pi state extension and the stewardship skill, each once; a
plain `--pi` has neither. Her extension's tools and status are
`../../../../assets/pi/steward.ts`
([its guide](../../../../assets/pi/AGENTS.md)). The registry example is
`../../../../assets/pi/stewardship/registry.example.json`, synthetic and
expired by design.

## Tests

Every root, clock, environment and runner is injected. A test starts no
real herdr: `createHerdrRun` runs a script in a private root. The
engine's tests give `sender`, `self` and liveness too; killed and
competing helpers are real Bun processes on one temporary ledger.
`extension.test.ts` drives her Pi tools through a fake ExtensionAPI,
each call a real helper process (`stand-in.ts`; none reaches a pane),
plus the real `--pi-steward`, the published Pi offering the tools, and
herdr's vendored extension in Pi's terminal reporting to a fake socket.
`scenarios.test.ts` and `owner.test.ts` run the scenarios, also under a
held-out cast, and the runner's verification.
