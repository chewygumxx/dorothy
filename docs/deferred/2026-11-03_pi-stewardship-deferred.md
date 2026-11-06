---
ctime: 2026-11-03
mtime: 2026-11-06
spdx: GPL-3.0-only
title: Pi stewardship deferred findings
description: >-
  What the bounded Pi stewardship trial leaves for later: the accepted
  native run's limits, same-user bounds, live-only uncertainties and the
  small adapter edges kept out of Task 5.
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
offline runner and its tests are built. Attempts 4 to 9 stayed incomplete
at the cap, and attempt 10 passed all eleven acceptance checks at product
`b38393c`. Its limits, not new prerequisites, are below.

## Native acceptance

- Attempt 10 passed all eleven checks at product
  `b38393c3fa124e69c0edd8d0b41e8c93f2f6235f` in one configured Linux
  Pi/Codex/Claude cycle on open-weight APIs. The coordinator used 27 of
  30 requests, 0 refused and 0 unknown, at a declared-price usage of
  US$0.016791567 of a US$5 cap. Its 47 worker calls cost a conservative
  US$0.031589844, with 0 held unknown and no safety stop. Elapsed was
  329778 ms of 1798148, and 3 of 3 owned panes closed with none failed
  or left open. Usage is multiplied by declared or catalogue prices, not
  provider invoices, and total mission billing is not known.
- The run's declared deviations are recorded in the sanitized export:
  fresh synthetic API-backed profiles with no copied subscription auth;
  coordinator `deepseek-ai/DeepSeek-V4.1-Flash-1017` on Featherless and
  worker `deepseek/deepseek-v4.1-flash-1017` on OpenRouter; explicit
  human Claude trust and tool authorization with an isolated
  Bash/Read/Write/Edit allowlist and `acceptEdits`; owned-fixture
  `keepRecentTokens` 1024 after attempt 4's small session rejected Pi's
  default 20000; and declared 60 s interruption, 10 s release and 1 s
  compaction-busy timings. The first candidate was declared fault
  injection, so this is a fault-aware controlled cycle, not
  unexpected-failure competence.
- The accepted conditions also include the worker gateway caps (100 calls,
  US$10 and 8192 output tokens per call) and the controller's initial
  operator guidance: a 30-request cap including compaction and final
  reporting, six requests reserved for owner updates and the final
  report, long waits and grouped reads, and the disclosed 60 s
  interruption, 10 s release and checkpoint-until-compaction schedule. No
  implementation, revision, result, verdict or final state was supplied.
  The [report's accepted
  run](../reports/2026-11-03_pi-stewardship.md#attempt-10-the-accepted-run)
  gives the full scope and limits.
- The accepted run is not subscription-model evidence, a reliability
  estimate or general production readiness. Working Codex history reads
  sometimes fail closed, so full dialog-bridge coverage and hostile-code
  confinement remain unproven.
- The worker homes now exist, so no user home, login or spending
  approval is outstanding, and no new spend approval followed. The
  private research helper's audit held two unknown transport calls of
  US$1.376256 apart from US$0.697854 of known usage-price subtotal; it is
  outside the native cycle accounting and total mission billing is not
  known.
- The separate production `RUNNERS.pi` dump and native final-turn smoke
  completed under isolated HOME/XDG and a Featherless route. It used a
  direct provider, no tools and no proxy cap; provider billing is
  unknown. Normal user config has no Featherless chat route and was not
  changed. This is not stewardship acceptance.

## Evidence and limits

- A receipt is evidence against a worker's report, not against hostile
  code running as the runner's user. Workers have the user's privileges
  and no OS confinement. The owner's sealing and child process catch
  accident and in-band forgery only.
- The first candidate is declared runner fault injection: both partial
  briefs request the same limited `slugify`, whose public examples pass
  and whose full owner test fails. Owner checkpoints hold it active for
  interruption and compaction. It is not an unprompted model mistake.
  Both accepted reviews' owner agreement was measured TRUE, and the
  controller manually assessed the observed skill follow. That one
  bounded agreement supplies no general review-quality or reliability
  estimate.
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
  a Pi upgrade needs that fixture rerun. The accepted run confirmed
  compaction with work in flight and counted 18 requests after it; that
  count is not interpreted as a model resuming well.
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
  loading or pane creation. A catalogue outage therefore refuses a run
  before spend; stale prices are never used as a numeric cap.
- Pi's ordinary shell is same-user and outside this protocol's control.
  Frozen registry bytes, exact native launch identity, occupant pins and
  the propagated trial deadline prevent the covered in-band drift, stale
  mutations and late writes; they do not claim OS confinement or stop
  every raw bypass. The live control environment keeps the declared Herdr
  socket and a trial-owned lock runtime but no provider or age key. The
  native arrangement's live gate passed at `b38393c`; its same-user raw
  access is still not OS confinement.
- The live adapter duplicates the memory health route as `/v1/health`
  and starts its service with the fixture's recording config. A shared
  production memory-launch helper would remove the duplication.

## Runner edges

- Live creation requires an absent exact registry, including a custom
  basename, and an absent `--out`. Non-symlink ancestors are required.
  Existing output files and empty or nonempty directories, and registry
  or output symlink aliases, are refused before key loading, paid calls
  or pane creation. Registry and evidence files are exclusive creates.
  Rejected output gets no new evidence and keeps its bytes; fresh safe
  output still retains sanitized pending evidence. This is no same-uid
  security boundary.
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
