---
name: maintenance-design-agreed
description: "Agreed design for cyclical maintenance (sub-project 4a), paused 2026-10-08 until memory history lands"
metadata:
  node_type: memory
  ctime: 2026-10-08
  mtime: 2026-10-08
  spdx: GPL-3.0-only
  type: project
  originSessionId: 6d4ead19-0e3d-4f19-a216-a3e1114b5bea
  modified: 2026-10-07T19:02:39.682Z
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.claude/memory/maintenance-design-agreed.md
   -
   -->

Cyclical maintenance (vocabulary maintenance + deep tagging; topic overviews
split into their own later spec) was designed with the user on 2026-10-08 and
approved section by section, then paused: memory history (a git-backed data
directory) is specced and built first, and maintenance builds on it.

Agreed decisions:
- Approach A: two phases of structured calls via injected `StructuredCall`, in
  a new `src/maintenance/` free of the Agent SDK. Approach C (cheap proposer
  model + Dorothy supervising, between "proposed" and "applied") goes in the
  spec's Later section; the user asked for it to be noted.
- Trigger: background pass at TUI launch when due (every-days, default 7, and
  something changed), plus `dorothy --maintain`, `--dry-run`, `--undo`,
  `--maintenance-log [n]`.
- State: `maintenance.jsonl` in the data dir, one line per pass (from/to rev,
  applied with prior values, dropped with reasons, retagged before/after ids,
  cost, outcome done|partial|aborted|undo). One pass at a time via index claim
  `@maintenance`. Re-validate under lock at apply; never hold the lock
  across a call.
- Full authority: she may change ANY concept and ANY conversation's tags,
  including the user's and user-fixed sets, with provenance (`revised` stamp,
  prior values logged; `mine`/`yours` shown to her as a signal only).
- Phase 1 ops by label: merge, delete, rename (old label kept as alt), describe,
  reparent; configurable cap per pass (default 20); lenient, per-op drops.
- Phase 2 deep tagging: from notes (title, description, abstract, compaction
  abstracts), batched (`batch` 20, `max` 100), batch-local handles c1..cN, one
  tag set (<=5) revised in place, <=3 coins per batch, sidecar
  `deepTaggedThrough` watermark; skip if a review moved it on; fields.tags
  `{by: dorothy, via: maintenance}`.
- Undo included: reverts last pass where unchanged since; writes an `undo` line
  so undo is a stack.

**Why:** paused, not abandoned; the user wants recovery from a broken or wrong
`tags.json` before granting full authority.
**How to apply:** when memory history is merged, resume by writing
`docs/specs/<date>-maintenance-design.md` from these decisions, revisiting undo
and the log in light of git history (spec
`docs/specs/2026-10-08-memory-history-design.md`).

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
