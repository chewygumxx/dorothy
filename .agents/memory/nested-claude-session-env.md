---
name: nested-claude-session-env
description: "claude run from a session's Bash inherits its project and session; -c and purge then hit the live session"
metadata:
  type: feedback
---

A Claude Code session's tools export `CLAUDE_CODE_PROJECT_DIR_NAME`
(here `chewygumxx_dorothy`) and `CLAUDE_CODE_SESSION_ID`. A `claude` run
from its Bash tool, even in a temporary directory, files its sessions
under that project. On 2026-10-15 an end-to-end `claude -c` continued
the live session and appended a turn to its transcript, and the dry run
of `claude purge <tmpdir>` listed the whole Dorothy project for
deletion.

**Why:** the variables outrank the working directory.

**How to apply:** before running a real `claude` from a session, unset
the session's `CLAUDE_CODE_` variables (keep `CLAUDE_CONFIG_DIR`), use
`--resume <id>` rather than `-c`, never run `claude purge` without
`--dry-run` first, and remove test transcripts by hand.
