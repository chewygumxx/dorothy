---
name: docs-location
description: >-
  Specs and plans go in docs/specs/ and docs/plans/, not superpowers'
  default docs/superpowers/
metadata:
  node_type: memory
  type: feedback
  originSessionId: 68039c80-54e5-4186-9111-789401f65f4f
  modified: 2026-10-02T14:11:16.231Z
---

Write design specs to `docs/specs/` and implementation plans to `docs/plans/`
(dated `YYYY-MM-DD-<topic>.md`), overriding the superpowers skills' default
`docs/superpowers/{specs,plans}/`.

**Why:** On 2026-10-03 the user moved the first TUI spec out of
`docs/superpowers/specs/` into `docs/specs/` themselves, fixing its header
breadcrumb, without being asked.

**How to apply:** Whenever brainstorming or writing-plans says to save under
`docs/superpowers/`, use `docs/specs/` or `docs/plans/` instead, with the repo's
file header (breadcrumb `::: :/docs/...`).
