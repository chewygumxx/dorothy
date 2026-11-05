---
ctime: 2026-11-05
mtime: 2026-11-05
spdx: GPL-3.0-only
title: packages/cli/src/hosts/pi/steward/TRIAL.md
description: >-
  The native stewardship trial's declared fault injection, checkpoints,
  readiness and absolute-deadline rules.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/cli/src/hosts/pi/steward/TRIAL.md
   -
   -->

# Native trial lifecycle

`scripts/pi-stewardship-trial.ts` is the only runner. Its fake world is
plumbing evidence, never model competence or a passed native gate.

## Declared partial candidate and checkpoints

`fix-1` and `fix-1b` explicitly request the same deterministic partial
`slugify`: lower case and separator handling plus trimmed edge hyphens,
without Unicode normalization or diacritic folding. Its public examples
pass and the owner's fuller test fails. This is declared fault injection,
not an unprompted model mistake. `fix-2` addresses the review against the
full contract and has no checkpoint.

Each partial brief names an owner-controlled file under `run/checkpoints`.
After committing, the worker waits for that file without creating,
changing or deleting it and without reporting early. The runner never
releases `fix-1.ready`: it interrupts that exact running task once. After
operator release, Pi must dispatch `fix-1b`; only an active retry permits
`/compact`. The runner releases `fix-1b.ready` only after the compaction
acknowledgement and while that retry remains active. Missing checkpoint,
compaction or review behavior fails closed. Review 1 must agree with the
owner's rejection; review 2 must approve the exact verified final revision.

## Native readiness and identity

Herdr failure JSON may be on stderr; successful mutations may have empty
stdout. After interactive shell startup the runner exports the owned HOME,
XDG and harness roots, changes to the owned clone, and waits for the
sentinel as an entire output line. The echoed command is not readiness.
Codex starts with `--no-daemon`. The foreground process's expected home,
harness home and canonical cwd are checked from Linux `/proc` without
logging its environment. This check receives the remaining wall deadline.

Reservation persists validated session identity, or foreground group
leader PID plus boot:start. The locked sender/interrupter repeats the
check before writing. Process-pinned interruption confirms that exact
process is gone, even if Herdr retains the old agent name. A guard refusal
or unchanged occupant is not a successful interruption. Same-pane restart
may retain terminal id; a new process/start identity is required.

## Time and evidence

The absolute deadline starts before preflight. Setup, readiness, owner
commands and paid streams use its remainder; cleanup has only the recorded
grace and an overrun fails. Missing executables/assets or catalogue drift
refuse before key loading and pane creation. No native approval is
answered by the runner.

Every exported text channel uses the public scrubber. JSON scrubs string
values only. Private originals are not public sanitized evidence. The
native mixed-worker gate remains pending; API-backed homes would be an
explicit deviation from the original subscription evidence.
