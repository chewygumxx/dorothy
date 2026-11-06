---
ctime: 2026-11-04
mtime: 2026-11-04
spdx: GPL-3.0-only
title: Pi delivery deferred findings
description: >-
  Review findings and limits left after Pi's delivery (increment A)
  merged, each with why it waited.
tags:
  - dorothy
  - pi
  - deferred
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/deferred/2026-11-03_pi-delivery-deferred.md
   -
   -->

# Pi delivery deferred findings

Left by the task and final reviews of `dorothy --pi` (#129); see the
[report](../reports/2026-11-03_pi-delivery.md#pending-gates-and-limits)
and the [plan](../plans/2026-11-03_pi-delivery.md). The final review's
pre-merge fixes are not here, nor the carried items it found resolved.
None sends a request down a wrong route, leaks a key or records an event
twice. Line numbers are those of the merge commit `7ee12e7`; the reviews
cited earlier ones, so a symbol is named where a line moved.

## Waiting on the user

- The production wiring of `RUNNERS.pi` in `packages/cli/src/index.ts`,
  with `loadCheckoutSecrets` and the `config.toml` route, has never run
  in a test or a probe. A test would decrypt the checkout's
  `secrets.json`, so the fixtures and both probe runs drive `runPi` and
  `native-launch.ts` with injected deps instead. Run `dorothy --pi
  --dump`, then one real `dorothy --pi` launch, before stewardship builds
  on it.

## Recording

- An unpaired `toolResult` is dropped without a diagnostic
  (`recording/pi.ts:380`, `if (!call) return`).
- An ended-failed call sorts before an earlier sibling's real result
  (`recording/pi.ts`, `settle`, line 476): the order of a parallel
  batch's events can differ from Pi's own.
- A torn tail keeps a session pending even once it has ended
  (`recording/pi.ts:569-572`), so the sweep's hour decides.
- A compaction's `firstKeptEntryId` rewritten by Pi's
  `createBranchedSession` could false-conflict with a kept entry. No
  fixture covers it, nor a fork whose copied path is verbatim
  (`forkFrom`); the native run produced one that passed.
- A deleted or moved parent orphans its forks for good, though a fork's
  own sidecar has owners (`recording/pi-source.ts:189`, `orphan`).
- `torn()` in `recording/pi-source.ts:122` repeats `readPi`'s own torn
  check (`recording/pi.ts:530-538`); the two should be one function.
- Held orphan calls run `projectOf` on every sweep (`recording/sweep.ts`,
  `projectOf` at 286), and the sidecars of deleted session files are
  never removed.
- The sweep's `waiting` counts segments, not sessions, and a halt is
  named by the last segment (`recording/sweep.ts:385, 499, 738`).
- Not tested: the 4 MiB split of a hook's record parts
  (`hooks/pi.ts:63`), and a fork of a parent with an open call.
- `recording/sweep.ts:548`, a comment of 93 columns, and
  `packages/memory/AGENTS.md:31`, a link line of 103. The guide is at its
  150-line cap, so reflowing it needs a line found elsewhere first.
- `recording/sweep.ts` is 786 lines. Its Pi `view()` branch (line 175)
  could move beside `pi-source.ts`.

## The launcher

- `launch.ts` is 396 lines; Pi's argument policy (`readPiArgs`, the
  refused options) could move to `hosts/pi/args.ts`.
- The byte caps of the hook exist twice: `PI_REQUEST_BYTES` and
  `PI_REPLY_BYTES` in `index.ts:112`, `REQUEST_BYTES` and `REPLY_BYTES`
  in `assets/pi/helper.ts:47`. `piHook` and `readBounded` could live in
  `hosts/pi/`. `describe` in `launch.ts:207` repeats the Claude hook's
  `describeError`.
- `--dump` claims the agent directory and writes, then removes, a
  manifest (its proxy login in `helperEnv`), so it is not read-only,
  though it decrypts nothing (`launch.ts:362`).
- A launch's text check against a root that is not canonical can refuse a
  valid relative `--session` when `XDG_DATA_HOME` is reached through a
  symlink.
- The environment allowlist (`hosts/pi/env.ts`) carries a few extras
  beyond the minimum: `EDITOR`, `VISUAL`, `SHELL`, `USER`, the SSH
  session variables and the CA certificate variables;
  `NODE_EXTRA_CA_CERTS` passes through.
- `--tools`, `--no-tools` and `--exclude-tools` (`launch.ts:91-93`) pass
  through to Pi, so a user can drop her memory tools from the loadout.
- `SKILLS` in `launch.ts:74` is empty: which skills Pi's launch packages
  is undecided.
- No real-Pi test of `/new` or `/resume` keeping her persona inside one
  process; `-c` and the fake API cover it.
- A stale launch directory, `$XDG_RUNTIME_DIR/dorothy/pi-<id>`, left by a
  killed launcher is never swept in the real runtime directory, unlike
  Claude Code's launches. It holds a manifest and the persona but no key,
  and the runtime directory is cleared at logout.

## The extension

- The prompt helper is still spawned after the provider guard has aborted
  a run on a foreign model (`assets/pi/index.ts`, `context.ts`).
- Restoring a foreign model at `session_start` is untested.
- The slow-helper test has a window of 2.4 to 4.5 s and may flake.
- `testing.ts` embeds a program of some 110 lines of JavaScript in a
  string; a sibling `.mjs` fixture would read better.
- The key is kept in a `globalThis` map under `Symbol.for("dorothy.pi.keys")`
  (`assets/pi/index.ts:148`), so a replaced runtime can reload it. Code
  running inside Pi can read it, as the spec's ordinary local execution
  allows and the guide discloses.

## The probe and the native fixture

- `scripts/probe-pi-delivery.ts` is 954 lines; its proxy should be its
  own file.
- It is the first root script to import `packages/cli/src` by relative
  path (`delivery-testing.ts`, `models.ts`, `claude-hook.ts`); the
  exception is undocumented.
- Pending messages carry the screen's raw text, unsanitized, into
  `result.json` and `report.md`.
- Its loadout check requires five tools, not the exact eight.
- `roots.close()` (line 829) runs outside a `finally`, so a throw leaks
  the roots and the fake upstream; the `/tmp/dorothy-pi-ext-*`
  directories came from this, and wait for the user to remove them.
- `kill()` in `delivery-testing.ts:221` signals the process group with
  SIGKILL after the process may have exited, so a reused PID could be
  hit; `freePort` (line 31) can race.
- `textOf` and the prompt lookup are written twice, in the probe and in
  `wire.test.ts`; they belong in `testing.ts`.
- The native fixture waits for `provider.requests.length === asked + 2`
  (`wire.test.ts:541`); `>=` is safer.
- The probe's abort listener after `[DONE]` may mark a finished call cut,
  which over-counts the reservation and is conservative; and a call's
  reply is not kept after an abort settles it.

## Live limits

These are limits the report names, not review findings.

- Live reasoning replay rests on the first run alone, whose result was
  not kept; the field Featherless streams reasoning in is unrecorded
  live.
- Live coverage is two turns. Compaction, resume, fork, reload and
  recovery ran against the scripted provider alone.
- `dorothy.tool-final` has no real-Pi case; it is unit-tested only.
- The native fixture reads Pi's screen text (`v1.5.0`, "Resume Session",
  "Fork from Message", "Compacted from"), which a Pi upgrade may change.
- An earlier form of the fixture failed once in about 25 runs; its cause
  is unproven. The present one passed 50 in a row.
- The report's tables have rows of 82 to 95 columns (lines 233, 243,
  244).
