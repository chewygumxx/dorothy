---
name: recording-plan-carry-overs
description: "What delivery left for the bodies spec's recording plan to handle"
metadata:
  node_type: memory
  ctime: 2026-10-15
  mtime: 2026-10-15
  spdx: GPL-3.0-only
  type: project
  originSessionId: ff990297-3157-4bac-a62b-babbba4639b4
  modified: 2026-10-15T08:45:52.488Z
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.agents/memory/recording-plan-carry-overs.md
   -
   -->

Delivery (branch `feat/memory-delivery`, 2026-10-15) left these for the
recording plan of `docs/specs/2026-10-15-memory-bodies-design.md`:

- `dorothy --claude` writes a merged user `--settings` file as
  `settings-<uuid>.json` in `$XDG_RUNTIME_DIR/dorothy/`, where recording
  puts its `<launch>.json` notes: the catch-up scan must skip them, or
  they move to a subdirectory.
- The block leaves no resumed session's conversation out yet; that needs
  `conversation_sessions`.
- `remember` in Claude Code has no `from` until the server reads the
  launch's notes.
- `listTags` ignores fact carriers, though search counts them.

**Why:** the delivery review deferred them as out of its scope.

**How to apply:** read this before writing the recording plan, and fold
each item into the task that owns it. See also
[Dorothy's ambition](./dorothy-ambition.md).
