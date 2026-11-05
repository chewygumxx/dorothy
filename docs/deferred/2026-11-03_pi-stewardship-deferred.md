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

- The native mixed Codex/Claude trial needs two temporary homes and quota
  room; the controller confirmed those homes do not yet exist. Open-weight
  spending is explicitly unlimited, and the controller will choose the
  mandatory numeric `--max-usd` without another spending request. No
  subscription credential may be copied. API-backed homes are a disclosed
  deviation, not original subscription evidence. The gate is pending.
- The separate production `RUNNERS.pi` dump and native final-turn smoke
  completed under isolated HOME/XDG and a Featherless route. It used a
  direct provider, no tools and no proxy cap; provider billing is unknown.
  Normal user config has no Featherless chat route and was not changed.
  This does not run or pass the stewardship gate.

## Evidence and limits

- A receipt is evidence against a worker's report, not against hostile
  code running as the runner's user. Workers have the user's privileges
  and no OS confinement. The owner's sealing and child process catch
  accident and in-band forgery only.
- The live trial's first fix may be right first time, in which case the
  independent-review loop is not exercised. The runner reports that
  honestly; it cannot force a model to make a specific incomplete fix
  without scripting the model.
- Interruption is a guarded Ctrl+C under the pane lock, then a restart
  in the same pane. Native no-inference observation confirmed identical
  `terminal_id`, null `agent_session` and a different foreground
  PID/boot:start identity. Session or process/start identity, never
  terminal stability alone, authorizes send and interruption. Codex uses
  `--no-daemon`; a frontend exit alone is not worker lifetime proof.
- Interactive shell startup can reset `CODEX_HOME`. The runner restores
  HOME/XDG/harness roots after startup, from the owned fixture cwd, and
  verifies the foreground process's expected home and cwd without logging
  its environment. No global shell or `mise` trust change is allowed.
- Compaction confirmation reads Pi's screen text ("Compacted from"), so
  a Pi upgrade needs that fixture rerun. The number of requests after
  compaction is counted, not interpreted as a model resuming well.
- Skill adherence, dialog ownership and review quality are judged by
  hand from the saved evidence. The offline probe's scripted decisions
  are plumbing, never model competence.
- Exported text passes memory's public scrubber; JSON is scrubbed only
  in string values so numeric fields stay valid. Original captures under
  the private trial root are not labeled sanitized or public. A secret
  with no recognized shape can still require manual quarantine.
- Herdr failure JSON can be on stderr and successful mutations can have
  empty stdout. Native observation required no prompt or inference; two
  private dummy daemons were stopped by owned home, never the user's
  daemon. Transient foreground tools are not mistaken for the group
  leader.
- Catalogue absence, malformed values and drift now refuse before key
  loading or pane creation. A current catalogue outage therefore leaves
  the native gate pending; stale prices are never used as a numeric cap.
- Pi's ordinary shell is same-user and outside this protocol's control.
  Frozen registry bytes and occupant pins prevent in-band drift and stale
  mutations; they do not claim OS confinement or stop every raw bypass.
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
