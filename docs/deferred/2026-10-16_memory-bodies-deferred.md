---
ctime: 2026-10-16
mtime: 2026-10-18
spdx: GPL-3.0-only
title: Memory bodies deferred findings
description: >-
  Findings on the recording branch that reviews judged safe to leave:
  small code points, hardening and test gaps in the hooks, the reader,
  the launch notes and the CLI.
tags:
  - dorothy
  - memory
  - deferred
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/deferred/2026-10-16_memory-bodies-deferred.md
   -
   -->

# Memory bodies deferred findings

Branch `feat/memory-recording`, merged in #24. These come from the
per-task reviews, the whole-branch review and the review of its fixes,
which triaged each one: none blocks merge. Entries that later commits
fixed are left out, and the behaviours a user meets are in the
[report's known limitations](../reports/2026-10-15-memory-bodies.md).

## Launch notes and kept lines

`packages/memory/src/bodies/launches.ts`, `unread.ts` and `log.ts`.

1. `noteSession` makes the launch's directory recursively, so a hook
   that fires after the catch-up removed the launch makes it again,
   without `launch.json`; the next start takes it as stale and catches
   it up again. Making only `sessions/` would avoid it.
2. A crash between `mkdir` and `rename` in `noteLaunch` leaves
   `launches/.<id>.tmp`, which nothing reaps.
3. Notes are not checked against their names: a note's `launch` or
   `session` need not match its path or be a uuid.
4. A recorded pid of 0 or below reads as alive for ever.
5. Two types whose names sanitise alike share one example file, so the
   second is never kept or told.
6. `types.json` is read, changed and written without a lock; two
   starts at once may both tell a type, or one lose the other's entry.
7. Temporary names carry only the pid.
8. The log collapses only `\n`, so a lone `\r` could fake a line for
   `logHasErrors`; two hooks rotating at once may lose `.1`.
9. A session in a stale launch counts as held for `--reread` until the
   catch-up clears it.

## Recording and the hook

`packages/memory/src/bodies/record.ts`, `hook.ts` and
`claude-code.ts`.

1. A lone `<command-message>` with no `<command-name>` is kept as the
   user's text, markup included.
2. A line of a new type after the last one recorded is warned of again
   at every `Stop` until a later line is recorded; each recheck logs
   `0 events`.
3. The index's lock and history's `dorothy.lock` do not exclude each
   other, so a hook with the index and one without are not serialised;
   it needs the index to fail for one process only.
4. `catchUp` of a whole launch removes its notes even when neither the
   index nor history could be locked, so those sessions are not tried
   again.
5. With the state directory unwritable, the catch-up records the
   session and then fails in `resolveHalt`; the launch stays and is
   retried.
6. A failed detached spawn is not logged; `held` is shadowed in
   `reread`.

## The review

1. `Reviewer` repeats the service's `#lock` and `#recording` (stateless
   over shared objects) and `#build`'s `buildMemory` call, and finds a
   name by a linear scan of the catalogue.

## The CLI

`packages/cli/src/claude.ts` and `claude-hook.ts`.

1. `spawn` runs outside the `try`, so a synchronous failure skips the
   launch's own catch-up, which the next start's makes good; the
   catch-up also runs after `gateway.stop`, `cleanup` and `warnDrift`,
   so a throw in one skips it.
2. The argument scan misses an attached `-r<uuid>` (adding
   `--session-id` beside a resume), counts only the first session flag,
   and misreads a value that is itself `-c`.
3. The hook loads the Agent SDK for `SessionEnd`, which only spawns.
4. The detached catch-up inherits Dorothy's decrypted credentials in
   its environment, never its command line.
5. The fallback logger, used when memory cannot be imported, does not
   rotate.
6. `--check` does not guard `unreadReport`, so a throw there would set
   its exit code.

## Tests and the probes

1. The state directory's `xdgDir` test cannot fail at run time; only
   `tsc` guards the union.
2. Untested: command markup arriving through a whole `user` line, a
   `queued_command` without `commandMode`, a `tool_result` without its
   id; the real `spawnDetached` (always injected).
3. The probe report cites print-mode timings for `async`, where the
   interactive `/exit` shows it better; survival rests on a 3 s sleep;
   it counts 14 user lines where `lines.json` has 17; and in
   `hooks.json` the `clear` marker precedes the compact run's
   `survived`.
