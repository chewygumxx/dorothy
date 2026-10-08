---
ctime: 2026-10-08
mtime: 2026-10-08
spdx: GPL-3.0-only
title: Memory history implementation report
description: "How memory history was built: deviations from the spec, what review changed, every commit and what is left"
tags:
  - dorothy
  - memory
  - history
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-08-memory-history-implementation.md
   -
   -->

# Memory history implementation report

## Summary

Dorothy's data directory is now a git repository. Every change to her
memory is a commit named for what changed and who made it:

- a review, an edit, a compaction or a turn;
- an outside edit, committed first and on its own.

Each commit is checked by a lint that knows each file's kind:

- `tags.json` and the sidecars must parse;
- transcripts may only grow.

A file found broken is put back as it last was, and its broken bytes are
kept under `broken/`. The history is pushed, encrypted with AES-256-GCM, to
a mirror off the machine, and `--recover` rebuilds an empty data directory
from that mirror.

- Spec: [`docs/specs/2026-10-08-memory-history-design.md`](../specs/2026-10-08-memory-history-design.md)
- Plan: [`docs/plans/2026-10-08-memory-history.md`](../plans/2026-10-08-memory-history.md)
- Probe: [`docs/reports/2026-10-08-memory-history.md`](2026-10-08-memory-history.md),
  with its sample data in
  [`2026-10-08-memory-history/`](2026-10-08-memory-history/)
- Deferred findings: [`docs/deferred/2026-10-08_memory-history-deferred.md`](../deferred/2026-10-08_memory-history-deferred.md)
- Branch: `feat/memory-history`, from `main` at `d7ae1fb`

At the head of the branch `bun run check` passes with 1105 tests across 62
files, up from 927 on `main`.

Two live probes in tmux, before and after the review's fixes, ran every
step as expected:

- adoption;
- turns and a review committed;
- a cut `tags.json` restored;
- an edit rolled back;
- two sealed bundles pushed, with none of the chats' words in them;
- a recovery that matched the data directory;
- the fallback engine reading the same history;
- the hook refusing a broken commit.

## How it was built

The plan's 10 code tasks were built in order, with the live probe as an
11th:

1. For each task, one agent implemented it from the plan's text.
2. A fresh reviewer then checked the diff against the plan and the spec,
   on the most capable model where locks or the mirror were at stake.
3. A task moved on only when its review found nothing Critical or
   Important.

Every task's code had been run in a scratch copy before the plan was
committed. Even so, seven tasks needed fix rounds, all for defects in the
plan's own code:

- **Task 3: git climbed out of the data directory.** With no `.git` of its
  own, the binary engine committed into an enclosing repository, such as
  a dotfiles repository whose work tree is `$HOME`. A relative root also
  broke sealing. Git now stops at the data directory
  (`GIT_CEILING_DIRECTORIES`) and the root is made absolute (`1b4b97f`). A
  test now shows the user's credential helper reaching pushes and fetches
  and nothing else.
- **Task 4: the two engines disagreed.** isomorphic-git differed from the
  binary in three ways (`7866c4d`):
  - it took any 40-hex string for a commit;
  - it moved `main` backwards on a bundle that did not descend from it;
  - it skipped a commit whose named paths were unchanged.

  Each disagreement is now a contract case that both engines pass.
- **Task 6: two problems in `MemoryHistory`.**
  - A lock that could not be taken escaped `sweep`, `turn` and `heal` as a
    rejection; it is now a warning.
  - History's file lock was a copy of the recall index's lock, so the two
    now share `src/sqlite-lock.ts` (`47a761d`, `0cc1939`).
- **Task 8: a stopped recovery left the mirror set.** Later pushes would
  have extended a chain no recovery could get through. A stopped recovery
  now leaves no remote and no `sealed` branch (`c506b8e`, `5e8723c`).
- **Task 9: relative mirror paths.** They were read from the data
  directory rather than the current directory, so `--mirror .` pushed into
  the data repository itself. Every path that is not a URL or `host:path`
  is now resolved from the current directory, and a value starting with
  `-` is refused (`4c17e51`, `d712aa0`).
- **Task 10: quitting waited on git.** A running push or `git gc` held the
  process open after the chat closed, and over ssh that wait was
  unbounded. The TUI path now ends the process once it has closed in
  order, and ssh runs with `BatchMode=yes` (`18f66fe`, `f5e6c85`).

A whole-branch review followed the probe. It found one Critical defect and
five Important ones, all reproduced. All were fixed in one round
(`6b71f98` to `e54ddef`), and a review of that round found every one
addressed:

- **Critical: a second key broke the mirror silently.** If
  `DOROTHY_MIRROR_KEY` was lost, for example when the tracked `.env` was
  reset, a new key sealed the next bundles. Recovery then stopped at the
  first of them. Now nothing is sealed under a key that cannot open the
  newest bundle, and `--mirror` never makes a key over sealed bundles
  (`6b71f98`, `1e62f7a`).
- **Restoring a live transcript lost the rest of the chat.** The writer
  kept appending to the replaced file. It now reopens its path when the
  file was replaced (`fd0a7b5`).
- **`--history` showed no revision.** `--restore` and `--rollback` need
  one, and isomorphic-git cannot resolve `HEAD~n`. Each line now starts
  with a short sha (`c8ec719`).
- **isomorphic-git lost a deleted file's history**, so `--restore` could
  not bring the file back (`7286f4e`).
- **The data directory was no longer private.** `git init` left `.git/`
  readable by other users. The root and `.git/` are now 0700 (`dfcdd75`).
- **`--mirror` made keys anywhere.** Run outside the checkout, it wrote a
  key into a `.env` the entry guard never reads. It now makes one only
  beside an existing `.env` (`c45963c`).

Five smaller points rode along in the same round:

- the restore warning's date is now local time;
- paths are staged in one git, as literal names;
- git's template and date variables are shut out;
- a stale `.git/index.lock` from a crash is cleared;
- the mirror's stop waits for a seal in progress, and `git gc` waits for
  the launch push.

Findings judged safe to leave are in the
[deferred doc](../deferred/2026-10-08_memory-history-deferred.md),
including six parked behaviours, each with the ruling that left it.

## Deviations from the spec

### Settled in the plan

The plan's Rulings section lists 21 decisions made while it was written.
The ones a reader of the spec would notice:

- **Compaction is recorded in `run.tsx`**, through `clusterSaver`, not in
  `src/compaction/`.
- **A commit takes the whole index.** A change the user staged by hand in
  the data directory rides along with Dorothy's next commit.
- **Four more commit messages:**
  - `title: <phrase> (prompt)`;
  - `review: <phrase> (dorothy, nothing new)` and
    `review: <phrase> (dorothy, failed)`;
  - an uncounted `turn: <phrase>` from a sweep;
  - `broken: <path> kept, no good version`.
- **Recovery walks at most 200 commits.**
- **Healing happens only outside the lock**, since the recall index's lock
  is not re-entrant. Inside a review's write, a broken vocabulary still
  skips tags.
- **`--mirror` says whether commits wait, not how many.**

### Made during the implementation

| Spec or plan said | Implementation | Why | Cost if wrong |
| --- | --- | --- | --- |
| Adoption moves a broken file aside | A transcript with a damaged line is adopted in place, with a warning (`0cc1939`) | The reader skips the line today, and no other copy of the conversation exists | Junk lines in an adopted transcript are committed |
| The no-key warning names `dorothy --mirror` (plan) | It names `dotenvx set` and the key's form (`5e8723c`) | The spec says so, and `--mirror` never replaces a set key | One string |
| (silent) A failed `--recover` | The `.git` it made is removed when nothing was applied (`81152f5`) | Otherwise a mistyped URL blocks every retry as "not empty" | None: the directory was empty before |
| (silent) Where a mirror path is read from | The current directory (`4c17e51`, `d712aa0`) | That is where the user typed it | A few lines |
| Pushed "at the next launch" when commits wait | Pushed at every launch with a mirror set (`f5e6c85`) | A failed push leaves nothing waiting, yet unpushed | One no-op push per launch |
| Quitting never waits on a push | The TUI path ends the process once it has closed in order (`f5e6c85`) | A child git kept the process alive | An orphaned push finishes after exit |
| Plan Ruling 15: a restored live transcript is appended to the old file | The writer reopens its path (`fd0a7b5`) | Otherwise the rest of the chat was lost | A `stat` per append |
| (silent) Which `.env` holds a new key | The current directory's, and only when one exists (`c45963c`) | The entry guard reads that one | A user must run `--mirror` from the checkout |
| (silent) A key that does not match the bundles | Sealing stops with a warning, and `--mirror` refuses (`6b71f98`, `1e62f7a`) | A second key breaks recovery silently | A check per seal |

## Commits

52 commits, oldest first. Scopes follow `.commitlintrc.mts`: `sdk` for
`src/` outside `src/tui/`, `tui` for `src/tui/`, none for docs, and
`build` as the type for the dependency.

### Design

- `66e502f` docs: Specify memory history
- `e74a5ff` docs: Plan memory history
- `d53c7a8` tweak(claude): Remember the maintenance design

### Tasks 1 to 10

- `28eb7e4` feat(sdk): Lint memory's files by their kind
- `a59d903` feat(sdk): Seal bundles for the mirror
- `f5fc3ce` feat(sdk): Keep memory's history with git
- `1b4b97f` fix(sdk): Keep git inside memory's directory
- `08fe8fa` build: Add isomorphic-git
- `80e297d` feat(sdk): Fall back to isomorphic-git
- `7866c4d` fix(sdk): Keep both engines in step
- `552126c` feat(sdk): Restore a broken file from history
- `cb7927d` feat(sdk): Configure memory history
- `1fa4e8f` feat(sdk): Record each change to memory
- `47a761d` refactor(sdk): Share the SQLite write lock
- `0cc1939` fix(sdk): Keep history's failures to warnings
- `45b4891` feat(sdk): Record reviews and titles in history
- `c8bcd90` feat(sdk): Sweep history before memory commands
- `bb70e8c` feat(sdk): Push memory, sealed, to a mirror
- `c506b8e` feat(sdk): Delete a ref in MemoryRepo
- `5e8723c` fix(sdk): Leave no mirror after a failed recovery
- `81152f5` feat(sdk): Show, restore and mirror memory history
- `4c17e51` fix(sdk): Resolve a local mirror from the cwd
- `d712aa0` fix(sdk): Treat bare names as local mirrors
- `c1bc2a3` feat(sdk): Repack memory's history daily
- `2c4fe89` feat(tui): Keep memory's history from the chat
- `fcf18db` docs: Describe memory history
- `18f66fe` fix(sdk): Keep ssh from prompting in pushes
- `f5e6c85` fix(tui): Never wait on git at quit
- `24ff233` docs: Correct what --mirror does

### Probe

- `9826303` docs: Keep the history probe's sample data
- `d30734d` docs: Report the history probe

### Review fixes

- `6b71f98` fix(sdk): Seal nothing under a key that can't open
- `1e62f7a` fix(sdk): Keep --mirror to the bundles' own key
- `c45963c` fix(sdk): Make a mirror key only beside a .env
- `fd0a7b5` fix(sdk): Reopen a transcript put back in place
- `c8ec719` fix(sdk): Lead --history lines with a short sha
- `7286f4e` fix(sdk): Log a deleted file under isomorphic-git
- `dfcdd75` fix(sdk): Keep the data directory private
- `e72b6fd` fix(sdk): Date a restore warning in local time
- `4dccd9b` fix(sdk): Stage paths in one git, as literal names
- `aa3f563` fix(sdk): Shut git templates and dates out
- `7b5b7f5` fix(sdk): Clear a stale index.lock to commit
- `8d0db37` fix(sdk): Let Mirror.stop wait for a seal
- `23e5add` fix(tui): Await the seal at close; gc after push
- `ffdb2d9` docs: Explain mirror setup and --history shas
- `e54ddef` docs: Note the shared lock and the TUI's exit

### Reports, and the second probe

- `11f5b15` docs: Defer memory history's minor findings
- `ad5936d` docs: Report how memory history was built
- `818b24f` docs: Keep the second probe's sample data
- `eb07d6d` docs: Report the second history probe
- `13bc9ea` fix(sdk): Say a refused --mirror changed nothing

This report's update follows.

## Verification

- `bun run check` passes, with 1105 tests across 62 files. It runs:
  - the typecheck;
  - Biome, remark and yamllint;
  - dotenvx's check and the em dash lint;
  - `bun test`.
- **Boundary tests** keep three rules:
  - the Agent SDK and `src/tui/` stay out of `src/history/`;
  - `src/memory/` never imports `src/history/`;
  - in `src/tui/`, only `run.tsx` imports history.
- **One contract test runs against both engines**, and cross-engine tests
  have each engine read what the other wrote, thin bundles included.
- **Nothing in a test touches real data.** Every test passes its root,
  key and environment in. The binary's tests shut out the user's git
  configuration. The test helper's default for saving a secret throws, so
  no test can write this repository's `.env`; its checksum was the same
  before and after every task and the probe.
- **Two live probes**, in tmux with temporary XDG directories, are
  described in full in the [probe report](2026-10-08-memory-history.md).
  - The first ran at `24ff233`, before the whole-branch review's fixes.
  - The second ran at `ad5936d`, after them, and exercised them live:
    - the data directory and `.git` at 0700;
    - short shas in `--history`, and a restore by sha under both engines;
    - a live transcript put back mid-chat, with the next message landing
      at its path;
    - `--mirror` refusing to make or take a key the sealed bundles do not
      open, and the chat sealing nothing under a wrong key;
    - a stale `.git/index.lock` cleared;
    - a recovery of three bundles into a 0700 directory.
  - It found one defect: a refused `--mirror` said `No mirror is set`
    while a mirror was set. Fixed in `13bc9ea`.

## Known limitations

None blocks merge.

- **isomorphic-git pushes only to `https://`**, with a token in
  `DOROTHY_MIRROR_TOKEN`, and that path is untested here; a local mirror
  needs the git binary.
- **isomorphic-git trusts file stats.** A same-size rewrite within the
  second of the last commit is not swept until it changes again. Dorothy's
  own commits and the lint at read time are unaffected.
- **The key lives in the checkout's `.env`.** `.env` is tracked in this
  repository, so after `--mirror` makes a key the user should commit it.
  It is encrypted, but a copy kept elsewhere is what makes the mirror
  recoverable.
- **Six parked behaviours**, each with its ruling, are in the
  [deferred doc](../deferred/2026-10-08_memory-history-deferred.md). The
  one most likely to be met: a `git commit` of the user's own in the data
  directory, with its editor open for over a minute, can lose its lock to
  Dorothy's stale-lock sweep.
