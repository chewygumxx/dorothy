---
ctime: 2026-11-03
mtime: 2026-11-05
spdx: GPL-3.0-only
title: Pi stewardship deferred findings
description: >-
  What the bounded Pi stewardship trial leaves for later: the pending
  live gate, its same-user limits, live-only uncertainties and the small
  adapter edges kept out of Task 5.
tags:
  - dorothy
  - pi
  - deferred
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/deferred/2026-11-03_pi-stewardship-deferred.md
   -
   -->

# Pi stewardship deferred findings

Left by [the bounded trial](../reports/2026-11-03_pi-stewardship.md)
and [the plan](../plans/2026-11-03_pi-stewardship.md), Task 5. The
offline runner and its tests are built; the live gate has not run.

## Waiting on the user

- The live Codex and Claude trial needs two temporary homes the user
  signs in, an approved Featherless budget, and quota room. No
  subscription credential may be copied. The gate is pending.
- The production `RUNNERS.pi` wiring still needs `dorothy --pi --dump`
  and one real launch, as
  [Pi delivery's deferred record](./2026-11-03_pi-delivery-deferred.md)
  says. That check is independent of the stewardship runner.

## Evidence and limits

- A receipt is evidence against a worker's report, not against hostile
  code running as the runner's user. Workers have the user's privileges
  and no OS confinement. The owner's sealing and child process catch
  accident and in-band forgery only.
- The live trial's first fix may be right first time, in which case the
  independent-review loop is not exercised. The runner reports that
  honestly; it cannot force a model to make a specific incomplete fix
  without scripting the model.
- Interruption is a ctrl+c under the pane lock, then a restart in the
  same pane. Whether herdr gives the new occupant a new `terminal_id` is
  recorded but not assumed. A worker that does not exit is reported as
  not interrupted, not as recovered.
- Compaction confirmation reads Pi's screen text ("Compacted from"), so
  a Pi upgrade needs that fixture rerun. The number of requests after
  compaction is counted, not interpreted as a model resuming well.
- Skill adherence, dialog ownership and review quality are judged by
  hand from the saved evidence. The offline probe's scripted decisions
  are plumbing, never model competence.
- `metadata()` currently records a catalogue failure as `null` and
  continues. It should stop before spending when the model is absent or
  its manifest drifted; the existing delivery probe already treats that
  as pending. The trial's budget and usage checks still bound spending.
- The live adapter duplicates the memory health route as `/v1/health`
  and starts its service with the fixture's recording config. A shared
  production memory-launch helper would remove the duplication.

## Runner edges

- `--release` reads the runner's private `trial.json` for the fleet id,
  owned task ids and private state roots. A missing, stale or tampered
  state file refuses the release; it does not fall back to the user's
  own state directory.
- The operator release refuses a task with a pending operation. That is
  deliberate: the helper may still be running, and the runner does not
  guess. The task stays visible until reconciliation or the user acts.
- Cleanup closes only panes whose ids came from this runner's creation
  replies, newest first, and its workspace only when no pane is left.
  Sealed briefs are kept in the evidence; a later manual cleanup must
  make their directories writable first.
- The trial's memory service, proxy and panes are stopped in `finally`,
  but a process killed before cleanup can leave its own workspace and
  panes for the user to close. It never closes a pane it did not create.
- The proxy's `[DONE]` settlement requires a finish marker and usage. A
  provider that sends a complete finish and usage but no `[DONE]` still
  settles at ordinary EOF; a provider that sends neither is a cut.
