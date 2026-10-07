---
ctime: 2026-10-08
mtime: 2026-10-08
spdx: GPL-3.0-only
title: Memory history design
description: "Design spec for keeping Dorothy's data directory as a git repository, with recovery and a sealed mirror"
tags:
  - dorothy
  - memory
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-08-memory-history-design.md
   -
   -->

# Memory history design

## Purpose

Dorothy's memory is a directory of files: transcripts, their sidecars and
the tag vocabulary in `tags.json`. Every write is atomic and checked, but
nothing keeps what a file held before. A `tags.json` broken by a hand
edit, a disk fault, a future bug or a newer `dorothy` stops tagging
outright, and nothing restores it. A file that is valid but wrong, such as
a vocabulary that a confident maintenance pass has folded into one
concept, cannot be caught by any check at all.

This spec makes the data directory a git repository. Every change Dorothy
or the user makes through her is a commit, a lint guards every commit, a
broken file is restored from history automatically, and the history is
pushed, encrypted, to a mirror off the machine.

In the user's words: an unparseable `tags.json` "is a catastrophic failure
that requires redundancy to ensure recovery", and her memory should be "a
git repository with pre-commit lint checks".

Success:

- No single bad write, hand edit or maintenance pass loses memory beyond
  recovery.
- A broken file is restored at once, without the user acting, and the
  broken bytes are kept.
- The user can see every change, who made it and when, and restore one
  file or all of Dorothy's notes and tags to an earlier commit.
- A lost disk costs at most what was not yet pushed: the data directory is
  rebuilt from the mirror and its key.
- Memory works whether or not history does; history failing never stops a
  chat or a review.

This spec targets main as of `d7ae1fb`, which includes tags
(`docs/specs/2026-10-07-tags-design.md`).

## Sub-projects

Cyclical maintenance (the catalogue spec's fourth sub-project) was designed
first, then paused so that it can rely on this spec: its passes change
concepts and tag sets the user owns, and history is what makes that safe.
Maintenance resumes once this lands, as its own spec; its undo and log may
lean on history then. Topic overviews follow it.

## Decisions

- **The data directory is the repository.** `$XDG_DATA_HOME/dorothy/`
  holds `.git/` beside `tags.json` and `transcripts/`. Its working tree is
  the files Dorothy already reads and writes, so nothing else moves.
- **Everything is tracked, transcripts included.** Transcripts are the one
  canonical state, the only thing that cannot be regenerated, and git
  stores their appends compactly.
- **One commit is one logical change**, named for what changed and who
  changed it, so a rollback restores whole changes and never half of one.
- **Two engines, one repository.** The git binary is preferred;
  isomorphic-git, a pure JavaScript implementation, is the fallback when
  no binary is found. Both read and write the same on-disk format, so a
  commit made by either is readable by the other. The engine is chosen
  once per process and never switched.
- **The binary runs isolated** from the user's git configuration, so that
  signing, hooks and templates set for the user's own repositories never
  reach Dorothy's commits.
- **Lint at every commit, heal at every read.** The checks that already
  guard reading (`parseVocabulary`, the sidecar parse) are the lint, with
  an append-only check for transcripts. A file that fails is restored from
  its newest good version, and its broken bytes are committed aside.
- **History moves only forward.** Restores and rollbacks are new commits,
  never resets, so the history Dorothy writes is append-only and every
  push fast-forwards.
- **A mirror is required, and sealed.** The user must set one, and is
  reminded until they do, but nothing waits on it. What leaves the
  machine is encrypted: bundles of new commits, sealed with AES-256-GCM,
  on a branch of their own.
- **Memory outlives history.** Every history failure degrades to today's
  behaviour with a warning.

## State

| Class               | What                                            | Where                                        |
| ------------------- | ----------------------------------------------- | -------------------------------------------- |
| Canonical           | transcripts                                     | `transcripts/<phrase>.jsonl`                 |
| Generated, authored | concepts and tombstones                         | `tags.json`                                  |
| Generated, authored | notes, tags, pins, hidden, appraisals, clusters | `transcripts/<phrase>.meta.json`             |
| History             | every committed version of the files above      | `.git/` in the data directory, branch `main` |
| History, sealed     | encrypted bundles of `main`                     | branch `sealed`, and the mirror              |
| Kept aside          | broken bytes found by the lint                  | `broken/`                                    |
| Secret              | the mirror's key                                | `DOROTHY_MIRROR_KEY` in `.env` (dotenvx)     |
| Derived             | the recall index                                | `$XDG_CACHE_HOME/dorothy/recall.sqlite`      |

The repository and the data directory stay mode 0700. Recall syncs from
`transcripts/` only, so `.git/` and `broken/` never reach the index.

## The repository

### Adoption

The first launch with history enabled finds no `.git/` and adopts the
directory, before any memory work:

1. `init`, with `main` as the branch.
2. Write `.gitignore`, holding `*.tmp`: the leftovers of an interrupted
   `writeAtomic`.
3. Lint every file. One that fails is moved to `broken/` (there is no
   history yet to restore from) with a warning, and is committed there.
4. Commit everything as `adopt: <n> files`.

So the first restore point is the state the user already had. A data
directory that does not exist yet is created and adopted empty.

### The engines

`MemoryRepo` is the one interface the rest of the code sees:

```ts
type MemoryRepo = {
    engine: "git" | "isomorphic-git";
    commit(paths: string[], message: string): Promise<string | null>;
    log(path?: string, limit?: number): Promise<Commit[]>;
    show(path: string, rev: string): Promise<Uint8Array | null>;
    changed(): Promise<string[]>;
    bundle(since: string | null): Promise<Uint8Array | null>;
    unbundle(bundle: Uint8Array): Promise<string>;
    push(remote: string, branch: string): Promise<void>;
    maintain(): Promise<void>;
};
type Commit = { sha: string; at: string; message: string; paths: string[] };
```

`commit` returns `null` when nothing changed. `changed` lists tracked
files that differ from `HEAD`, and untracked files not ignored. `bundle`
returns the commits on `main` after `since` (all of them when `since` is
`null`), or `null` when there are none. `maintain` repacks; it is a no-op
under isomorphic-git.

**Choosing.** At launch, `git --version` is run once. If it succeeds the
binary is used for the whole process; otherwise isomorphic-git is. A
command run later in the same process never switches.

**The binary, isolated.** Every invocation runs with:

- `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`;
- `-c commit.gpgsign=false -c tag.gpgsign=false -c core.hooksPath=` and
  `-c init.defaultBranch=main`;
- the author and committer `Dorothy <dorothy@localhost>`;
- `GIT_TERMINAL_PROMPT=0`, so a push never waits on a prompt;
- the data directory as `-C`, and no inherited `GIT_DIR` or
  `GIT_WORK_TREE`.

One setting is carried over from the user's global configuration, for
pushing only: `credential.helper`, read once with
`git config --global --get-all credential.helper` and passed as `-c`.

**isomorphic-git**, pinned at 1.43.1 (MIT), reads no configuration. It
uses the same author, and Node's `fs` under Bun.

**One contract.** A single test suite runs against both engines, and
cross-engine tests commit with one and log, show, restore and bundle with
the other. The fallback runs in CI on every run, even where the binary
always wins.

### Commits

A commit is one logical change, made inside the same lock as the writes it
records, right after them:

| Change                     | Paths                                     | Message                                        |
| -------------------------- | ----------------------------------------- | ---------------------------------------------- |
| A review                   | the sidecar, and `tags.json` if she coined | `review: <phrase> (dorothy, <model>)`          |
| A `--memory` save          | the sidecar, and `tags.json` if changed    | `edit: <phrase> (user)`                        |
| An `--edit-tags` save      | `tags.json`                               | `edit-tags: <n> concepts (user)`               |
| A compaction               | the sidecar                               | `compaction: <phrase> (dorothy, <model>)`      |
| A turn                     | the transcript                            | `turn: <phrase> #<n>`                          |
| A file changed outside     | that file                                 | `outside: <path>`                              |
| A missed commit, caught up | those files                               | `catch-up: <paths>`                            |
| A restore                  | the file, and its broken copy             | `restore: <path> from <short sha> (broken kept)` |
| A rollback                 | every authored file that changed          | `rollback: to <short sha> (user)`              |

- **Writers record, they never run git.** `updateSidecar` and
  `updateVocabulary` take an injected `Recorder`, as they already take a
  `Lock`, and call `record(paths, message)` inside the lock after their
  atomic writes. `src/memory/` does not import `src/history/`.
- **A turn** is committed at turn end, under the lock: the transcript as
  it stands, with its turn count.
- **Outside changes first.** Before a logical commit, `changed()` is
  checked. Any changed file the commit does not name, other than this
  process's catch-up paths, is linted and either committed alone as
  `outside: <path>` or restored (see Recovery). So every commit has one
  author.
- **Transcripts are never outside.** A live TUI appends to its transcript
  outside the lock, between turn commits, so another process often finds
  one changed. A transcript change that passes the append-only lint is
  the conversation's own, and whoever finds it commits it as
  `turn: <phrase> #<n>`; only one that fails is recovered.
- **A failed commit** leaves its writes standing and is reported once per
  run. The paths are kept in memory, and the next `record` commits them
  first as `catch-up: <paths>`, attributed to Dorothy.
- **Housekeeping.** Under the binary, `maintain()` runs at most once a
  day, in the background after launch.

### The lock

Commits take the cross-process lock that guards sidecar writes: the recall
index's (`RecallIndex.exclusive`). Without the index, as when recall is
off, history takes an equivalent lock on `.git/dorothy.lock`, held the way
the index holds its own, so commits are never unlocked even where sidecar
writes are today. isomorphic-git does not reliably honour git's own lock
files; this lock is what keeps two processes, and two engines, from
writing at once.

## The lint

| File                           | Passes when                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `tags.json`                    | `parseVocabulary` accepts it                                                                                  |
| `transcripts/*.meta.json`      | the sidecar parse accepts it                                                                                  |
| `transcripts/*.jsonl`          | its last committed content is a prefix of it, and each line after that prefix is JSON with `v` and `kind`; a torn final line is allowed |
| `.gitignore`, anything else    | always                                                                                                        |

The append-only check catches what parsing cannot: a truncated transcript,
or an earlier turn rewritten, where the file still parses but the
canonical record has changed. A torn final line is what a crash during an
append leaves, and the transcript reader already skips it.

`lint(path, bytes, committed)` is pure: it takes the file's bytes and its
last committed bytes, if any, and returns `null` or a reason.

It runs:

1. **At every commit**, on each path the commit names. Dorothy writes only
   valid files, so a failure means something else changed the file
   between her write and her commit. That path is left out and recovered.
2. **At launch**, after adoption or opening, before the catalogue loads:
   every path in `changed()` is linted, then committed as `outside:` or
   recovered.
3. **At read time**, when `readVocabulary` or a sidecar read returns
   `unparseable` during a run: that file is recovered and read again.
4. **For the user's own commits.** Adoption installs
   `.git/hooks/pre-commit`, which runs `dorothy --check --staged`, so a
   commit the user makes by hand in the data directory is linted too.
   Dorothy's own commits skip hooks, having linted in process.

## Recovery

Recovering one file:

1. Commit its current bytes as `broken/<path>.<UTC stamp>`, so nothing is
   ever destroyed.
2. Walk the file's history, newest first, to the most recent version that
   passes the lint, and write it in place atomically.
3. Commit both, as `restore: <path> from <short sha> (broken kept)`.
4. Warn once: a TUI notice, or a line on stderr from a command:
   `Restored tags.json from 3f9a2c1 (2026-10-15); the broken copy is in
   broken/`.

- **A transcript** loses at most the turn since its last commit; those
  lines are still in the broken copy.
- **A file with no good version**, never committed or broken in every
  commit, behaves as today: unparseable, skipped with a warning. Its
  broken copy is still kept, and nothing is restored.
- **A missing file** that was tracked is not broken: deleting is a change
  like any other, committed as `outside:`. `--restore` brings it back.
- **A recovery that fails**, the repository unreadable, say, degrades to
  today's behaviour with a warning.

## The mirror

### Setting it

`dorothy --mirror <url-or-path>`:

1. records the remote as `mirror` in the repository's own `.git/config`,
   so it travels with the repository and both engines read it;
2. generates `DOROTHY_MIRROR_KEY`, 32 random bytes in base64, with
   `dotenvx set`, unless one is already set;
3. says once that the key must be kept somewhere else
   (`dotenvx get DOROTHY_MIRROR_KEY`), since without it the mirror cannot
   be read;
4. warns, for anything but a local path, that the user's conversations
   will be stored on that host, encrypted;
5. pushes once, at once, so a bad URL fails while the user is watching.

`dorothy --mirror` with no argument prints the mirror, the last push and
how many commits wait.

### Required

Until a mirror is set, every TUI launch shows a notice,
`⚠ memory has no mirror · dorothy --mirror <url>`, and every command prints
the same line once on stderr. Nothing else changes; memory and history
work fully without one.

### Sealing

The local repository stays plain text. What leaves the machine is sealed:

1. **A bundle.** At each push, `bundle(since)` packs the commits on `main`
   after the last sealed one. A bundle is git's own transport format, a
   header and a packfile, and keeps git's delta compression: a turn
   appended to a transcript costs a few hundred bytes, not the transcript.
   The binary makes it with `git bundle create`; isomorphic-git writes
   the same header around `packObjects`.
2. **Sealed.** The bundle is encrypted with AES-256-GCM through Web Crypto,
   built into Bun, with a fresh 12-byte nonce per bundle, behind a header:

   ```text
   dorothy-sealed 1\n<nonce, base64>\n<ciphertext>
   ```

   The header line is the additional authenticated data, so a changed
   version or nonce fails to open.
3. **Committed to `sealed`.** The ciphertext is committed as
   `bundles/<six-digit sequence>.enc` to `sealed`, an orphan branch in the
   same repository, with the message `seal <sequence>`. A file at the
   branch's root, `SEALED`, says what it is and how to recover it.
4. **Pushed.** Only `sealed` is pushed to the mirror.

Names are sequence numbers, so nothing about the content, not even a
commit hash, leaves the machine. The last sealed commit of `main` is kept
as the ref `refs/dorothy/sealed-through`, which `bundle(since)` reads.

Every mirror is sealed, local paths included.

### Pushing

- In the background, after commits, at most once every `push-seconds`,
  and at launch when commits wait.
- Fast-forward only. A rejected push means the mirror diverged; it is
  warned of and never forced.
- Quitting never waits on a push; what is left is pushed at the next
  launch.
- A failure is warned of once per run, with its reason, and retried at
  the next push.
- With no key while a mirror is set, sealing stops with a warning naming
  `dotenvx`; commits go on.

| Remote                         | git binary                                                             | isomorphic-git                                |
| ------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------- |
| A local path                   | yes                                                                    | no: "this mirror needs the git binary"        |
| `ssh://` or `git@host:path`    | yes, through the user's ssh agent and `~/.ssh/config`                  | no: the same warning                          |
| `https://`                     | yes, through the carried-over `credential.helper`                     | yes, with `DOROTHY_MIRROR_TOKEN` from `.env`  |

`DOROTHY_MIRROR_KEY` and `DOROTHY_MIRROR_TOKEN` live in the `.env` the
entry guard already decrypts, and are set only with `dotenvx set`; tests
pass a key and an environment in and never read it.

### Recovering

`dorothy --recover <url-or-path>` runs only into a data directory that is
empty or missing, and needs `DOROTHY_MIRROR_KEY`:

1. Fetch `sealed` from the mirror.
2. Open each bundle in sequence order and apply it to a fresh repository
   (`unbundle`: the binary fetches from it; isomorphic-git indexes its
   pack and updates `main`).
3. Check out `main`, record the mirror, and set
   `refs/dorothy/sealed-through`.
4. Lint everything and report.

A bundle that fails to open (a wrong key, tampering, truncation) or to
apply stops the recovery there; the report names the last good sequence,
and the directory holds what was recovered up to it.

## Commands

| Command                                     | Does                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `dorothy --history [<path>] [-n <count>]`   | Commits newest first, 20 by default: time, author kind, message; one file's when a path is given            |
| `dorothy --restore <path> [<rev>]`          | Restores one file from its newest good version, or from `<rev>`; works on a valid file too                  |
| `dorothy --rollback <rev>`                  | Restores `tags.json` and every sidecar to `<rev>`, as one commit                                             |
| `dorothy --check [--staged]`                | Lints every tracked file, or the staged ones, and reports; changes nothing; exits 1 on a failure            |
| `dorothy --mirror [<url-or-path>]`          | Sets the mirror, or shows it                                                                                 |
| `dorothy --recover <url-or-path>`           | Rebuilds an empty data directory from a mirror                                                               |

```text
2026-10-15 09:12  dorothy  review: anabolic-gat-sangh-autodidact (dorothy, claude-sonnet-5-5)
2026-10-15 09:11  turn     turn: anabolic-gat-sangh-autodidact #9
2026-10-15 08:40  user     edit-tags: 2 concepts (user)
2026-10-14 22:03  restore  restore: tags.json from 3f9a2c1 (broken kept)
```

- **Rollback** never touches transcripts: they are canonical, and rolling
  back means returning to an earlier judgement about the conversations,
  never an earlier record of what was said. A file that did not exist at
  `<rev>` is left as it is. It takes the lock, so a running TUI is
  safe beside it: every sidecar write reads afresh under the lock, so the
  next review builds on the rolled-back file.
- **Without history** (disabled, or failing), each command but `--check`
  exits 1 saying why; `--check` lints without the append-only check.

## Configuration

```toml
[history]
enabled = true
push-seconds = 60
```

`enabled = false` turns history off entirely: no adoption, no commits, no
heal, no mirror and no reminder. An existing repository is left as it is.

## Modules

| File                       | Change                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `src/history/repo.ts`      | new: `MemoryRepo`, `Commit`, choosing the engine                                             |
| `src/history/binary.ts`    | new: the git binary engine and its isolation                                                 |
| `src/history/iso.ts`       | new: the isomorphic-git engine, bundles included                                             |
| `src/history/lint.ts`      | new, pure: the lint by file kind                                                             |
| `src/history/heal.ts`      | new: recovering a file; the launch pass                                                      |
| `src/history/history.ts`   | new: `MemoryHistory`: adoption, `record`, outside and catch-up commits, the lock, scheduling pushes |
| `src/history/seal.ts`      | new: sealing and opening bundles; the sealed branch's layout                                 |
| `src/history/mirror.ts`    | new: pushing, `--mirror`, `--recover`                                                        |
| `src/history/commands.ts`  | new: the commands                                                                            |
| `src/memory/sidecar.ts`    | `Recorder`; `updateSidecar` records; a read that heals                                       |
| `src/memory/vocabulary.ts` | `updateVocabulary` records; a read that heals                                                |
| `src/memory/service.ts`    | passes the recorder and messages for reviews                                                 |
| `src/memory/commands.ts`   | passes the recorder for `--memory` and `--edit-tags`                                         |
| `src/compaction/run.ts`    | passes the recorder for a compaction                                                         |
| `src/config.ts`            | `[history]`                                                                                  |
| `src/tui/run.tsx`          | builds `MemoryHistory`, heals before loading, commits each turn, shows its notices           |
| `src/index.ts`             | the new modes                                                                                |

- `src/history/` imports neither the Agent SDK nor `src/tui/`, and
  `src/memory/` does not import `src/history/`; `boundary.test.ts` pins
  both.
- `isomorphic-git` is the one new dependency.
- No persona change; the chat prompt stays pinned.

## Failures

- **No git binary**: isomorphic-git is used; mirrors over a path or ssh
  warn that they need the binary.
- **The repository unreadable by either engine**: history is off for the
  run with a warning; memory works as today. `--check` reports it, and
  `--recover` rebuilds from the mirror.
- **A commit fails after its writes**: the writes stand; the next record
  catches up.
- **A push fails**: warned once per run, retried.
- **No mirror**: the reminder; everything else works.
- **No key while a mirror is set**: sealing stops with a warning; commits
  go on.
- **A bundle fails to open during `--recover`**: recovery stops at the
  last good sequence and says so.
- **A broken file with no good version**: today's behaviour, with its
  broken copy kept.

## Security

- The local repository holds what the data directory already holds, with
  the same modes.
- The mirror holds only ciphertext and sequence numbers. The key never
  enters the repository; it lives in `.env`, encrypted at rest by
  dotenvx.
- The binary's isolation keeps the user's hooks from running on Dorothy's
  commits, and keeps her commits unsigned by the user's key.
- The pre-commit hook only lints; it never runs anything the data
  directory holds.

## Testing

Colocated tests in temporary directories, never touching real user data:
every path, key and environment is passed in, and the binary engine's
tests shut out the user's git configuration as production does.

- `repo.ts` contract suite, run against both engines: commit and its
  `null` when unchanged, `log` for all and for one path, `show`,
  `changed`, `bundle` with and without `since`, `unbundle`. Cross-engine:
  commit with one, read, restore and bundle with the other, both ways.
- `binary.ts`: a global config with `commit.gpgsign=true` and a hooks path
  does not reach a commit; `credential.helper` is carried over for pushes
  only.
- `lint.ts`: every file kind; a truncated transcript; a rewritten earlier
  line; a torn final line allowed; a first commit with no committed bytes.
- `heal.ts`: a live transcript's appends committed as a turn, never as
  `outside:`; an outside valid edit committed as `outside:`; an outside
  broken edit restored with its copy kept; no good version; a broken
  transcript losing only its last turn; a deleted file committed.
- `seal.ts`: round trip; a flipped byte, a truncation, a wrong key and a
  changed header each fail to open.
- `history.ts`: a review's sidecar and coins in one commit; a failed
  commit caught up next time; two processes committing through the lock;
  adoption of a directory with a broken file.
- `mirror.ts`: push to a local bare repository and `--recover` into a
  fresh directory, with the result equal to the original; a diverged
  mirror refused; recovery stopping at a bad bundle.
- `commands.ts`: `--rollback` leaving transcripts alone; `--restore` with
  and without a revision; `--check --staged`.
- A live probe in tmux, with throwaway XDG directories, committed as a
  report with its sample data: adopt a data directory, chat and watch the
  commits, break `tags.json` by hand and relaunch, set a path mirror,
  `--recover` into fresh directories, and compare the two.

## Known limitations

- **A crash between a write and its commit** leaves the change uncommitted
  until the next launch, which commits it as `outside:` rather than as
  Dorothy's. So does another process's failed commit, since its catch-up
  paths live only in its memory.
- **isomorphic-git cannot push over ssh or to a path.** Without the binary,
  only an `https://` mirror is pushed.
- **Losing the key loses the mirror.** It is generated once and kept only
  in `.env`; the user is told to keep a copy.
- **Sealed bundles accumulate** one per push, and are never consolidated.
- **History grows without bound.** Nothing is ever pruned from it.

## Later

- Consolidating sealed bundles into one.
- Cyclical maintenance, whose undo may lean on history.
- In maintenance, a proposer and supervisor: a cheaper model proposes
  operations and Dorothy approves them, between proposing and applying
  (the maintenance design's approach C).
- Forgetting, which must reach history and the mirror: a forgotten
  conversation is in every commit and every bundle since.
- More than one mirror.

## Out of scope

- Merging or syncing between two machines' data directories.
- A history view in the TUI.
- Rewriting history, other than through a future forgetting spec.

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
