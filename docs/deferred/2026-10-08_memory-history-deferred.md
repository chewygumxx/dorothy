---
ctime: 2026-10-08
mtime: 2026-10-08
spdx: GPL-3.0-only
title: Memory history deferred findings
description: >-
  Findings on the memory history branch that reviews judged safe to leave:
  parked behaviours, small code points and test gaps.
tags:
  - dorothy
  - memory
  - history
  - deferred
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/deferred/2026-10-08_memory-history-deferred.md
   -
   -->

# Memory history deferred findings

Branch `feat/memory-history` (as of `e54ddef`). These come from the
per-task reviews, the whole-branch review and the review of its fixes. The
whole-branch review triaged them, and none blocks merge. Entries that later
commits fixed are left out.

## Parked behaviours

Each of these is real, but rare or bounded. Each was left with a ruling.

1. **A stale-lock sweep can take a user's own commit.** Before each commit,
   history removes a `.git/index.lock` older than 60 seconds, which is what
   a crashed git leaves. A user's own `git commit` in the data directory,
   with its editor open for over a minute, also holds that lock. Dorothy
   then removes it, and whatever the user staged rides in her next commit
   under her message; the user's commit fails. Nothing is lost. Follow-up:
   check for a running git, or raise the threshold
   (`src/history/history.ts`, `#clearStaleLock`).
2. **Any unopenable newest bundle reads as the wrong key.** `opensSealed`
   drops `unseal`'s reason, so a bundle that is not a sealed bundle, or of
   another sealed version, refuses sealing with the wrong-key warning. Only
   tampering or a format change gets there. Follow-up: carry the reason
   into the warning (`src/history/mirror.ts`).
3. **An unreadable local bundle throws out of `--mirror`.** `runMirror`
   calls `opensSealed` without a guard, so a failed read is a stack trace
   rather than `dorothy: ...` and exit 1 (`src/history/commands.ts`).
4. **One appended line can miss a restored transcript.** The writer checks
   its file's inode before each append; a restore landing between the check
   and the write sends that line to the old file. The window is
   microseconds (`src/transcript.ts`, `#follow`).
5. **A new key after a stopped recovery.** The guard against making a key
   over sealed bundles reads only the local `sealed` branch. After a
   recovery that stopped part way (which deletes it), or a fresh adoption,
   `--mirror` makes a new key; the push of the new branch is then refused
   as non-fast-forward, with a generic push failure. Not silent; a clearer
   message is later work.
6. **The isomorphic-git https paths are untested.** Its push and fetch
   need a network or a local `git http-backend`; only their refusal of a
   non-https mirror is tested.

## Later work

- **Seal outside the lock.** A first seal of a large history builds and
  encrypts the bundle under the shared write lock, which can outlast the
  5-second busy timeout of other processes. Build it outside, then take
  the lock to append.
- **A fixed committer date on the sealed branch**, so its commit times do
  not show when the user was active.
- **Commands' commits wait for a chat to be pushed.** `--rollback`,
  `--restore` and `--edit-tags` commits reach the mirror at the next TUI
  launch.
- **Bundles accumulate** and history grows without bound; consolidating
  bundles is in the spec's Later section.

## Small code points

- `src/history/lint.ts`: a blank line in a transcript is reported as
  "line N is not JSON".
- `src/history/seal.ts`: `"dorothy-sealed "` and `not 1` are written out
  beside `MAGIC`; `unseal` rejects rather than returning `ok: false` for a
  key that is not 32 bytes; `seal` accepts a test nonce of any length.
- `src/history/binary.ts`: `setRemote` removes then adds, which is not
  atomic; `bundle` names `main` rather than `MAIN`, and a `since` that is
  not an ancestor errors; the environment filter is written three times;
  `credentialHelpers` drops git's empty reset value.
- `src/history/iso.ts`: `log` messages are the first line, where the
  binary's `%s` joins the first paragraph; `commit` runs `statusMatrix`
  over the whole tree, which is slower than an index comparison on a large
  directory.
- `src/history/heal.ts`: `Healed.broken` is `""` when no file was there;
  `keepCopy`'s prefix filter also matches a hand-placed
  `tags.json.bak` in `broken/`; its comment on `writeAtomic` says
  "the text lands".
- `src/history/history.ts`: one outside file that cannot be read stops
  `record`'s loop, so later outside files and Dorothy's own message wait
  for the catch-up commit; an identical second `Restored ...` warning is
  deduplicated for the run; `#afterCommit` fires when nothing was
  committed, and an unrecoverable file walks 200 commits at each record;
  the hook checks for the entry script but not for bun itself; an existing
  `.gitignore` without `*.tmp` is left as it is; `./tags.json` is not
  normalised before the `except` set.
- `src/memory/service.ts`, `src/memory/commands.ts`: `tags.json` is
  always named in a review's or `--memory`'s recording, so an outside edit
  of it in that window is folded into Dorothy's or the user's commit.
- `src/history/commands.ts`: the opener's `remote(MIRROR)` is unguarded;
  `runRecover` with a mirror holding no bundles removes `.git` and then
  crashes in its lint; most failures surface as stack traces; `named()`
  does not normalise `./` or `a/../`; `runRestore` looks up `version.at`,
  which nothing reads; `session()` repeats `commandHistory`'s opening;
  `--check` with history off over an existing `.git` still checks
  append-only; an undecryptable key is reported as "not 32 bytes of
  base64"; `isLocal("")` is true.
- `src/history/mirror.ts`: with no `sealed` ref at all, a push reports
  `pushed` without contacting the mirror; a timer push that joins a running
  push leaves newer commits for the next schedule.
- `src/tui/run.tsx`: live turn numbers fall behind a resume's count after
  a turn that ends in an error; `openChatIndex`'s comment still says
  "compactable"; one comment line runs past 80 characters.
- Each TUI launch leaves an empty transcript, which the next sweep commits
  as an uncounted `turn: <phrase>`. This predates the branch.

## Test gaps

Behaviours that hold but have no test of their own:

- the header-authentication test swaps the nonce, which changes the IV
  too; a same-nonce re-encoding would isolate the additional data;
- `unbundle` refusing a diverged bundle under the binary alone, and
  `hasGitBinary`;
- `core.hooksPath` isolation apart from `--no-verify`;
- the walk stopping at `RECOVERY_DEPTH`;
- a tracked file deleted outside committed as `outside:`, and a recovery
  that throws degrading to a warning;
- the recorder running inside the lock, the `(dorothy, nothing new)`
  message, and `[history] enabled = false` creating no repository;
- a retry after a failed push; the bare mirror holding no `main`; a crash
  between `appendSealed` and `setRef`; sealing and pushing under
  isomorphic-git; the stopped-recovery push pinned to non-fast-forward;
- `--recover`'s refusal leaving no `.git`; a bad URL exiting 1; restoring
  a broken version;
- `launchHistory` using the index's lock, and `runTui` settling turns
  before history closes.
