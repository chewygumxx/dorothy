---
ctime: 2026-11-04
mtime: 2026-11-04
spdx: GPL-3.0-only
title: Dorothy in Pi, delivery rulings
description: >-
  Every decision the controlling agent took on the user's behalf while
  building Pi delivery, with its reason and what it costs if wrong.
tags:
  - dorothy
  - pi
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-11-04_pi-delivery-rulings.md
   -
   -->

# Dorothy in Pi, delivery rulings

The [delivery plan](../plans/2026-11-03_pi-delivery.md) ran under
subagent-driven development: Codex controlled it until its weekly usage
ran low, then Claude Code did. Its progress ledger was scratch space
and is gone, so its rulings are kept here, in the order they were made.
The [delivery report](./2026-11-03_pi-delivery.md) holds the evidence.

The user set one value: the Featherless live budget is unlimited, and
they expected under US$10. The two live runs cost about US$0.0028.

## Rulings

1. **Serial implementers share the existing worktree.** Separate
   branches per task would defeat the shared plan. If wrong: rework at
   integration, with no exposure of `main`.
2. **Red means a failing behaviour.** A missing import alone is not
   red evidence; a minimal compilable stub comes first. If wrong: a
   slightly longer first test cycle.
3. **The plan's startup and profile types are design interfaces.**
   They do not require test-only dependency injection; fixture
   executables and existing boundaries serve. If wrong: harder tests.
4. **Codex's unreachable Task 1 work is committed as it stood.** Its
   implementer could not be resumed; the full check passed on the work
   and a fresh task review approved it. If wrong: a gap the implementer
   would have reported.
5. **Claude subagents implement and review once Codex is at 10% of its
   weekly limit.** If wrong: Claude usage spent instead of Codex.
6. **A guide at its 150-line cap is split, not squeezed.** The cap is a
   readability gate; the recording guide gained `AGENTS.pi.md`. If
   wrong: one more guide file.
7. **Task 5 adds `dorothy.tool-final` to memory's reader.** Task 3 had
   not, and the extension writes it. Its event reuses the call
   occurrence's identity, so an ordinary result, a final and a failure
   never double-emit. If wrong: a cross-package task diff.
8. **`--pi-hook` belongs to the launcher task.** The extension's task
   tests its helper through a fixture executable. If wrong: none seen.
9. **The Featherless key is taken into memory and deleted from Pi's
   environment at load,** superseding the plan's `$<key-name>`
   reference. Pi hands its whole environment to bash and to every
   other stdio MCP server, so a model running `env` would have put the
   key in session files and the memory archive. The spec's binding
   requirement is no key in argv, files or logs; the reference was the
   plan's means. If wrong: Pi re-reads the variable later and
   authentication fails, which the wire tests would catch.
10. **Her persona is an extension prompt section,** superseding the
    launcher's `--append-system-prompt`. Pi skips a discovered
    `APPEND_SYSTEM.md` whenever that flag is given, so the persona was
    displacing a project's own prompt additions, against the spec's
    additive identity. If wrong: none seen; a test pins both.
11. **The live probe runs with `--max-usd 5 --max-turns 6
    --timeout-ms 120000`,** within the user's budget, and the
    controller, not an implementer, integrates. If wrong: at most
    US$5 spent.
12. **The live probe runs once more after its proxy fix,** so the
    committed evidence attests the committed probe. If wrong: about
    US$0.002 more spent.
13. **Delivery merged under `AGENTS.md`'s standing approval,** though
    the controller had told the user the merge would wait for them;
    stewardship requires the merge and a roadmap revision first. If
    wrong: the user reviews after merge and asks for a revert or
    fixes.
