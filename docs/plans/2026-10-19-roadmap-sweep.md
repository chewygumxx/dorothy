---
ctime: 2026-10-19
mtime: 2026-10-19
spdx: GPL-3.0-only
title: The roadmap sweep implementation plan
description: >-
  Task-by-task plan for the roadmap sweep: unconfirmed knowledge fenced,
  the service's loose ends, recording, the store, history, tags,
  compaction and recall, tooling, probes and the documents that record
  them.
tags:
  - dorothy
  - memory
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-19-roadmap-sweep.md
   -
   -->

# The roadmap sweep implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `subagent-driven-development` to carry out this plan task by task, one
> subagent at a time, never in parallel. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** address every roadmap item the
[spec](../specs/2026-10-19-roadmap-sweep-design.md) puts in scope.

**Architecture:** no new package or entry point but `tui`'s
`./editor`. Each task works through a list of findings already written
down where they were found; the task names the source, and the finding
there is the requirement.

**Branch:** `docs/roadmap-evaluation`, after the roadmap's revision.

## Global Constraints

- **Verify first.** The findings were written against older code, and
  many name paths from before the workspace split (`src/memory/...` is
  now `packages/memory/src/memory/...`). Before changing anything for a
  finding, find the code it names and check that it still holds. A
  finding already fixed, or made moot, is recorded as such in the
  task's report with the commit or reason, and left.
- **One finding, one commit**, or a few closely related findings
  together, each with a test that fails before the fix where the
  finding is a behaviour. A test-gap finding is closed by its test.
- **Behaviour the specs pin does not change** unless the sweep's spec
  says so. A finding whose fix would change pinned behaviour is
  reported, not fixed.
- Every new file carries the house header, copied from a sibling: for a
  `.ts` file the `vim:set` line, the SPDX line and the breadcrumb
  (`// ::: :/<path from the repository root>`); JSON files carry none.
- Imports end in `.js`; a package imports only what its `package.json`
  declares, and only declared entry points. The graph in
  `workspace.test.ts` holds.
- Tests never read a real data directory (`$XDG_DATA_HOME/dorothy`),
  state directory or cache: every root is made under
  `mkdtempSync(join(tmpdir(), ...))` and removed after. No test reaches
  the network but `127.0.0.1`.
- No key, token or the account's email address is written to a file,
  log, report or message; a key is named only by its variable.
- Commits: Conventional Commits, header at most 50 characters, body
  lines at most 72, no agent trailers, no em dash anywhere. Scopes are
  the package names, `config`, `claude` and `api`; agent assets take
  the `ai` type. Run `bunx biome check --write <paths>` before each
  commit.
- Markdown prose lines at most 80 characters; no em dash.
- `AGENTS.md` budgets hold: the root at 100 lines, `docs/AGENTS.md` at
  60, each package's at 150. A change to a package's architecture
  updates its `AGENTS.md` in the same task.
- Run the task's tests while working, and `bun run check` before the
  task's last commit; it must pass.

## Review Focus

1. A piece of knowledge `remember` wrote never renders in the block's
   confirmed section, and `--verify` moves it there. Test: Task 1.
2. A launch note from another boot is caught up, never left as live.
   Test: Task 3.
3. A filter's `after` and `before` name local dates. Test: Task 4.
4. History never takes a user's own running `git commit`. Test: Task 6.
5. No probe output holds a key, a token or the account's address.
   Check: Task 11.

## Files

Each task names its sources; the files are those the findings name, as
they stand now.

### Task 1: unconfirmed knowledge fenced

Spec: the sweep spec's "Unconfirmed knowledge". Code: the contract's
opening block (`packages/memory/src/contract/block.ts`), the engine's
knowledge items, the fact file's `verified` key
(`packages/memory/src/facts/file.ts`), `search` and `open`, and the
CLI's commands.

- [ ] Tell confirmed from unconfirmed knowledge in one function beside
  the knowledge item, from its origin and `verified` entries, with
  tests for each origin and for a verified model-written piece.
- [ ] Render the block's knowledge in two sections, confirmed first;
  unconfirmed in its own section, after every confirmed piece for the
  budget, introduced as the spec says. Test both sections, the order
  under a tight budget, and a block with none of either.
- [ ] Mark unconfirmed knowledge in `search` results and `open`'s text.
- [ ] Add `dorothy --verify <id>`: it adds the user's `verified` entry,
  commits it to history as the user's, and says so; on confirmed
  knowledge or an unknown id it says why and changes nothing. Test
  each, and that the next block shows the piece as confirmed.
- [ ] Document it: the README's memory section, `packages/memory`'s
  contract guide, and `--help`.

### Task 2: the memory service's loose ends

Sources: the contract report's Final review "Left for later" list and
each task's "Minor findings deferred" (Tasks 1 to 19), in
`docs/reports/2026-10-18-memory-contract.md`.

- [ ] `brief`'s budget clamped to the named host's profile.
- [ ] The hook API's `project` checked as a project's id, or refused.
- [ ] With reviews off, idle sessions bounded and their notes handled
  as the service does with reviews on, and the "reviews are off" line
  written to the service's log.
- [ ] The service binds its port before the history launch, so a
  second service that cannot bind does no history work.
- [ ] An unexpected tool failure logged by the service.
- [ ] Each task's deferred minor findings, verified and closed.
- [ ] Task 19's documentation findings: the queue's stopping rule as
  the code has it, and the spec's Migration and Failures sections as
  the migration and client behave.

### Task 3: recording's deferred findings

Sources: `docs/deferred/2026-10-16_memory-bodies-deferred.md` (every
section), and the sweep spec's "Launch notes" and "Reviews through a
user's proxy".

- [ ] Launch notes in the state directory, each with its boot id; a
  note from another boot is stale. Migrate nothing: a note left in the
  runtime directory is read once more and caught up.
- [ ] `DOROTHY_ANTHROPIC_BASE_URL` for the hook's reviews, set by the
  launch from `ANTHROPIC_BASE_URL`.
- [ ] The file's findings under "Launch notes and kept lines",
  "Recording and the hook", "The review", "The CLI" and "Tests and the
  probes", each verified and closed. The probe report's figures are
  corrected only where the probe's own output says otherwise.

### Task 4: recording's rough edges and local dates

Sources: the bodies report's Known limitations, and the sweep spec's
"Turn times and local dates".

- [ ] `after` and `before` filters and `dateCreated` compared as local
  dates, through the turns' UTC times.
- [ ] Reviews that find Dotenvx Armor's session when `claude` runs
  with another `XDG_CONFIG_HOME`, by the launch passing the directory
  it found.
- [ ] A resumed chat redrawing its `remember` lines.
- [ ] The recall server answering a client's requests in order.
- [ ] The code review's F11 (a record after a torn tail acknowledged
  but unreadable) and F13 (malformed user text skipped without a
  halt).

### Task 5: the store's open gaps

Sources: the store report's Known limitations and Known gaps, and the
memory bodies spec's Later (`docs/specs/2026-10-15-memory-bodies-design.md`).

- [ ] Snake-case memory files imported, under a name the fact rules
  accept, and named in the report.
- [ ] A regenerated `MEMORY.md` keeping an entry's hook line where a
  hand wrote one.
- [ ] History recording the provenance an outside writer of canonical
  bytes claims only as an outside change.
- [ ] A fact retired by a deletion in the repository updating the
  last `MEMORY.md`.
- [ ] Each Known gap (scrub, fact file, store, recall, export, sync,
  commands), verified and closed.
- [ ] The code review's F15 (Authorization schemes by case), F16 (a
  fact named `constructor`), F17 (`MEMORY.md` edited during sync) and
  F18 (an import dropping foreign metadata and sources).

### Task 6: history's deferred findings

Source: `docs/deferred/2026-10-08_memory-history-deferred.md`.

- [ ] The six parked behaviours: a running git checked before a stale
  lock is cleared; the unseal reason carried into the warning;
  `--mirror` guarding an unreadable bundle; the transcript writer's
  append window closed; a clearer message after a stopped recovery; and
  isomorphic-git's https paths tested against a local server.
- [ ] Later work: the first seal built outside the lock; a fixed
  committer date on the sealed branch; commands' commits pushed without
  waiting for a chat.
- [ ] Small code points and test gaps, each verified and closed.
- [ ] The code review's F20 (URL-scoped credential helpers) and F21 (a
  timer push during a push), and the memory bodies' Recording item 3:
  the index's lock and history's `dorothy.lock` excluding each other.

### Task 7: the tags' deferred findings

Source: `docs/deferred/2026-10-08_tags-deferred.md`.

- [ ] The three parked behaviours, with the follow-ups the file names;
  the third, a chat hidden mid-run, only if a review can see the
  catalogue's flag without reading the index.
- [ ] The Code findings, and the README saying `--tags` needs the
  recall index.
- [ ] The test gaps.

### Task 8: compaction, recall and the catalogue

Sources: `docs/deferred/2026-10-07_compaction-test-gaps.md`, the
compaction report's Known limitations, the recall report's Known
limitations and the catalogue spec's Known limitations.

- [ ] The test gaps file's "Highest value" first item and "By task"
  entries; its second item and Live checks go to Task 10.
- [ ] The CLI's failed compactions watched, by their `status` message.
- [ ] Hidden conversations' text left out of the cache index.
- [ ] A corrupted index rebuilt where no other process holds it, and
  the recall report's edge cases, each verified and closed.
- [ ] The code review's F19 (an out-of-scope hit suppressing the
  scoped fallback) and F22 (concurrent chats compacting the wrong
  shared turns).

### Task 9: tooling

Sources: the roadmap's Candidates, the workspace modularity report's
Known limitations, and the asset refactor report's.

- [ ] Undeclared dependencies checked: Biome's
  `noUndeclaredDependencies` or an equivalent test, so a package cannot
  import what only the root declares.
- [ ] `lint:header` failing on a headed type's file without a header,
  not only one out of sync.
- [ ] herdr pinned to a commit, as superpowers is, and upgraded on
  purpose.
- [ ] Memory's history commands taking their environment, streams and
  entry script from the CLI.
- [ ] A `./editor` entry point for `tui`, which `--memory` and
  `--edit-tags` load instead of all of `tui`; `workspace.test.ts` and
  the workspace spec say so.
- [ ] Ink's kitty keyboard query (`[?0u`) kept out of the input draft
  where the terminal does not answer it, as under herdr.
- [ ] The code review's F14 (Ctrl+U at the start of an empty first
  line).

### Task 10: the code review's other findings

Source: the 2026-10-19 code review (`docs/reports/2026-10-19-code-review.md`,
from the branch `codex-code-review`), its findings F01 to F10 and its
Concerns, with the sweep spec's "`brief` and another project". Its
locations name `7602316`; Tasks 2 and 3 have changed some since.

- [ ] F01: one-shot commands fail on an `is_error` result; F08: a
  failed chat reply's cost counted.
- [ ] F02: repeated Claude settings keep the last value; F09: a
  synchronous spawn failure cleaned up, in `claude-dump.ts` too.
- [ ] F03: a long matching turn excerpted, not dropped; F04 and the
  Concern on question ids: a resume refuses questions removed or
  changed since the run began; F10: question counts conserved.
- [ ] F05: `open`'s range from `from`; F06: token changes serialised
  across processes; F07: one deadline for a record and its backlog.
- [ ] `brief` refuses another project on a project-bound connection.

### Task 11: probes

Sources: the sweep spec's "Probes"; the compaction test gaps' live
split; the identity report's forks, interactive sessions and
`HTTP_PROXY`; the asset refactor report's two probes.

- [ ] A live chat compacted into several clusters, driven through
  herdr.
- [ ] A fork of a `dorothy --claude` session keeping the identity
  marker.
- [ ] An interactive `dorothy --claude` session behaving as `-p` did.
- [ ] A user's `HTTP_PROXY` leaving the loopback gateway alone.
- [ ] A session started inside a package, and a fresh session reading
  `.agents/memory/MEMORY.md`.
- [ ] Each probe's commands and scrubbed output in
  `docs/reports/2026-10-19-roadmap-sweep/`; a finding a probe turns up
  is fixed if small, or reported.

### Task 12: the record

- [ ] The code review's report and probes, from its branch, beside the
  sweep's.
- [ ] `docs/reports/2026-10-19-roadmap-sweep.md`: each item with its
  commits or why it was already done, the rulings, the probes and the
  verification.
- [ ] Each deferred file loses the entries the sweep closed; a file
  left empty is removed, and the links to it with it.
- [ ] The roadmap: Candidates lose what the sweep closed, the phase
  links the sweep's spec, plan and report, and Revisions says so.
