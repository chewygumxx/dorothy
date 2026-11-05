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
Native trial fault injection and readiness are in [TRIAL](./TRIAL.md).

## Files

- `types.ts`: the contracts the parts meet on (`Worker`, `Fleet`,
  `WorkerObservation`, helper request/reply, task brief/evidence/state and
  record), and `StewardError`, whose `code` begins its message.
- `registry.ts`: `readFleet(path, now, expected?)`, a strict regular file
  of at most 64 KiB, version 1, every key named. Frozen source path,
  SHA-256, fleet id and fixture root drift is `REGISTRY_CHANGED`. An
  unknown key is refused, a token-like one as `REGISTRY_CREDENTIAL`, as is a
  token-shaped value, one starting at a word edge: `task-stewardship` is
  a path), `fleetId` through core's `isUuid`, one to eight
  workers whose ids, names and panes are argv-safe words of 1 to 32
  characters (no leading dash). `fixtureRoot` and each `cwd` are made
  canonical; one outside the root, links followed, is
  `REGISTRY_ROOT_ESCAPE`. Observation times are exact UTC; a future
  observation, an expiry over an hour later or an expired worker refuses
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
  A moved pane, stopped agent, malformed/oversized reply or timeout is
  `matches: false`, `unknown` and a `HERDR_*` code; unrecognized status
  is unknown, never idle. Callers reobserve before acting. A match gives
  `terminalId`, herdr's
  `terminal_id` (a bounded word, else null; null when unmatched): it
  never makes a match, the caller pins it and refuses a change.
  `pane process-info` supplies session-first/process-second identity: a
  fresh Codex uses foreground group leader plus Linux boot:start.
- `ledger.ts`: `openLedger`, one SQLite file per fleet at
  `ledgerPath(env, fleetId)`, `$XDG_STATE_HOME/dorothy/pi/steward/`
  `<fleetId>.sqlite` (HOME's `.local/state` if unset, else refused),
  0600 in a 0700 directory, WAL, `synchronous=FULL`, a 2000 ms busy
  timeout, every write a `BEGIN IMMEDIATE` transaction. Ledger schema 2
  persists occupants; schema 1 loads null and fails closed on mutation.
  Tables: `fleet` (another fleet is refused), `controller`, `tasks`,
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
  terminal id and occupant, pinned with the intent, digest and reservation.
  Immediately before sending it reobserves and rechecks registry identity
  and the brief digest (`WORKER_UNIDENTIFIED` or `WORKER_REPLACED`); such
  a refusal fails the task, its id spent. The sender is `send-prompt.sh --from
  dorothy --expect-pane <pane> --expect-terminal <id> --expect-session
  or --expect-process <pin> --require-idle <name>`, stdin `Read
  <brief> for task <id>.`, for 15 s: exit 0 is `sent`, 2 to 6 a refusal
  (`failed`), anything else, a throw or a timeout `unknown`, never
  resent. A pending operation whose helper is proven gone makes its
  intent `unknown` (`SEND_ABANDONED`). `wait` (0 to 60000 ms) reconciles:
  a report naming the task (`Task: <id>` line; `Status:`, `Revision:`
  are claims) is `reported`, work seen after a send `running`; idle is
  never done, and a timeout keeps the reservation. `cancel` records
  `cancel-requested`, then sends one Escape through `send-interrupt.sh
  --expect-pane --expect-terminal <pinned> plus the occupant and
  --lock-wait 5` (15 s), under the pane lock: refusals before sending
  (2, 3, 4, 5, 7, 8, 9, 10) withdraw the request (`CANCEL_NOT_SENT`), others
  keep it (`CANCEL_UNCERTAIN`); only a report saying `cancelled` cancels.
  A trial's owner `deadlineAt` caps helper, engine, lock and pause waits.
  Exit 10 is pre-write, prompt 11 uncertain after text; ordinary requests
  omit it and retain per-operation limits.
  `finish` runs nothing: a `reported` task is `verified` only on a
  receipt for its id, current revision and unchanged report digest, with
  the same command, exit and log (exit nonzero: `failed`). A receipt
  checks a report's claims, not hostile code run as the runner's user.
  `read` takes 1 to 200 lines/32 KiB; `list` adds availability.
  `processStart`/`processAlive` are Linux boot:start identity/liveness.
- `fixtures.ts`: `writeRegistry` (private roots), `fakeHerdr`, whose
  replies have herdr 0.9.5's structure with every value invented, and
  `fakeSender`, which records each call to a sender or the interrupter
  and scripts its exit. Fake herdr serves `agent get`; `{steward: true}`
  adds recorded reads. Capture new trial replies sanitized.
- `helper.ts`: `stewardHelper`, `dorothy --pi-steward` (`index.ts`):
  one request of at most 128 KiB (`REQUEST_TOO_LARGE`), `runSteward` over
  its env, one reply of at most 64 KiB (`REPLY_TOO_LARGE`), and no secrets.
- `stand-in.ts`: the shell stubs and the `dorothy` stand-in that tests and
  the probe spawn. `owner.ts`, `simulation.ts`, `scenarios.ts`,
  `pi-scenario.ts`: the owner's verification and the simulated workers
  ([fixture guide](../../../../assets/pi/stewardship/fixture/AGENTS.md)).

## The launch

`dorothy --pi --steward <registry>` (`../launch.ts`), Linux alone
(`steward_platform`), refuses `--no-session` (exit 2) and checks the
registry, resolved from the user's directory and not through a link,
with `readFleet` before any secret (`steward_registry: <code>`). The
manifest names its path, digest, fleet id and fixture root; Pi gets herdr's
vendored Pi state extension and the stewardship skill, each once; a
plain `--pi` has neither. `TRIAL.md` defines the owner-only native
`stewardDeadlineAt` and `launchRecord` plan fields, readiness and deadline
enforcement; neither is a model tool field. The live control environment
keeps the declared socket and a trial-owned runtime shared with Pi's
helper, without provider or age keys. Her extension's tools and status are
`../../../../assets/pi/steward.ts`
([its guide](../../../../assets/pi/AGENTS.md)). The registry example
`../../../../assets/pi/stewardship/registry.example.json` is synthetic.

## Tests

Every root, clock, environment and runner is injected; `createHerdrRun`
never starts real herdr. Engine tests inject identity and liveness;
competing helpers share one ledger. `extension.test.ts` uses a fake
ExtensionAPI and real helpers, then published Pi and vendored herdr
against a fake socket; `scenarios.test.ts`/`owner.test.ts` run both casts.
