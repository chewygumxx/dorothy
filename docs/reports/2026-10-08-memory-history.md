---
ctime: 2026-10-08
mtime: 2026-10-08
spdx: GPL-3.0-only
title: Memory history probe
description: "Dorothy's data directory in git: healing, rollback, a mirror"
tags:
  - dorothy
  - memory
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-08-memory-history.md
   -
   -->

# Memory history probe

Dorothy ran for real in tmux, against the real model, on a copy of the tags
probe's data. The probe checks that she adopts the data directory as a git
repository and commits each turn and review. It also checks that she
restores a broken `tags.json`, that a rollback puts a rename back, and that
she pushes sealed bundles to a mirror that `--recover` rebuilds the same
files from. Last, it checks that the fallback engine reads the same history
and that the pre-commit hook refuses a broken file. Every step did what the
plan expected, with the small differences noted in each. One small defect
turned up: the restore warning dates the commit in UTC.

A [second run](#second-run-after-the-reviews-fixes) followed the
whole-branch review's fixes. It found every fix working, and one small
defect: a refused `--mirror` says `No mirror is set` while the old mirror
stays set.

- Spec: [`docs/specs/2026-10-08-memory-history-design.md`][spec]
- Plan: [`docs/plans/2026-10-08-memory-history.md`][plan], Task 11
- Branch: `feat/memory-history`, the first run at `24ff233` and the
  second at `ad5936d`
- Sample data: [`2026-10-08-memory-history/`](2026-10-08-memory-history/),
  described under [Sample data](#sample-data), and the second run's in
  [`second-run/`](2026-10-08-memory-history/second-run/)

[spec]: ../specs/2026-10-08-memory-history-design.md
[plan]: ../plans/2026-10-08-memory-history.md

## Setup

Dorothy ran as `bun src/index.ts` in a 120 by 40 tmux session, on
`claude-sonnet-5-5`. `XDG_DATA_HOME`, `XDG_CACHE_HOME` and
`XDG_CONFIG_HOME` were all under one `mktemp -d` directory, and were echoed
in the pane and checked before the first launch. So no real transcripts,
sidecars, `tags.json` or recall index were read or written. The data
directory started as a copy of the tags probe's `data/dorothy`: `tags.json`
and four chats, each a transcript and a sidecar.

`env.sh`, sourced before every launch, also set `DOROTHY_MIRROR_KEY` to 32
random bytes of the probe's own. So `--mirror` used that key and never
called dotenvx's `set`, which would have written one into this repository's
`.env`. `md5sum .env` read `d25ebc6afd489f34347bfd370638799f` before the
probe and after it: `.env` was unchanged. The mirror was a bare repository
in the same temporary directory. `config.toml` shortened both timers:

```toml
[memory]
idle-seconds = 10

[history]
push-seconds = 10
```

Messages were typed with `say.sh`, the tags probe's helper with its session
renamed. It targets the session's active window, so once it typed into the
second window's shell instead of the chat; the line was an unclosed quote,
nothing ran, and it was cancelled and sent again.

The probe cost about $0.09: $0.036 for the two chats and $0.058 for their
three reviews, from the transcripts' `stats` events and each sidecar's
`reviewCostUsd`.

## Adoption, and the reminder

**Run.** `$B src/index.ts`, quit with Ctrl+C, then `$B src/index.ts
--history` in a second window.

**Expected.** The warning `memory has no mirror · dorothy --mirror <url>` on
the first screen, and one commit, `adopt: 10 files`: `tags.json`, four
transcripts, four sidecars and `.gitignore`.

**Happened.** The first screen (trimmed to the bottom):

```text
! memory has no mirror · dorothy --mirror <url>
› ▏                               enter send · shift+enter newline · ...
chat $0.0000
dorothy · valuing-moonbeam-deigning-disporting · … · sdk … · starting
```

`--history` printed:

```text
dorothy: memory has no mirror · dorothy --mirror <url>
2026-10-08 10:44  turn     turn: valuing-moonbeam-deigning-disporting
2026-10-08 10:44  adopt    adopt: 10 files
```

The adoption commit held the ten files expected, authored by
`Dorothy <dorothy@localhost>`, and `.gitignore` held `*.tmp`. No warning
about a damaged transcript appeared. The second commit is the empty
transcript of the chat just quit, found by `--history`'s sweep (see
[Findings](#findings)). One Ctrl+C quit the TUI, as it does on an empty
draft; the second went to the shell.

## Turns and a review

**Run.** A new chat, two messages about a pothos with yellowing lower
leaves and soil that stays damp, then an idle past the 10-second review.

**Expected.** `title: <phrase> (prompt)`, then `turn: <phrase> #1`, `#2`,
and `review: <phrase> (dorothy, <model>)`.

**Happened.** `--history` (trimmed of the date and kind columns):

```text
10:51  review: bang-uncial-revolved-blackening (dorothy, claude-sonnet-5-5)
10:50  turn: bang-uncial-revolved-blackening #2
10:48  review: bang-uncial-revolved-blackening (dorothy, claude-sonnet-5-5)
10:48  turn: bang-uncial-revolved-blackening #1
10:48  title: bang-uncial-revolved-blackening (prompt)
10:48  turn: bang-uncial-revolved-blackening
```

With a 10-second idle she reviewed after each exchange, not only at the
end. The first review coined `houseplant care` (`kbfbafa44`) and wrote
`tags.json` at `rev` 5. The commit before the title, with no count, holds
the user's first line: the title's commit swept it first, as an outside
change to a transcript is committed (Ruling 5). `#1` then added the reply.

## A broken `tags.json` restored

**Run.** `head -c 40 tags.json > t && mv t tags.json`, then
`$B src/index.ts --check`, then the TUI.

**Expected.** `--check` exits 1, naming `tags.json`. The TUI warns
`Restored tags.json from <sha> (<date>); the broken copy is in broken/`,
`tags.json` is its last committed version, the cut bytes are in
`broken/tags.json.<stamp>`, and `--history` shows a `restore:` commit.

**Happened.** `--check` exited 1:

```text
tags.json: JSON Parse error: Expected '}'
1 of 13 files broken.
```

The TUI's first screen (trimmed):

```text
! Restored tags.json from 1567b95 (2026-10-07); the broken copy is in broken/
! memory has no mirror · dorothy --mirror <url>
```

`1567b95` is the first review's commit, the last to change `tags.json`.
The restored file was byte for byte that version, and the 40 cut bytes were
in `broken/tags.json.2026-10-07T23-54-22-301Z`. `--history` (trimmed):

```text
2026-10-08 10:54  restore  restore: tags.json from 1567b95 (broken kept)
```

The restore commit adds only the broken copy, since the restored
`tags.json` matched the one already committed. The warning's date,
`2026-10-07`, is the commit's UTC date; `--history` shows the same commit
at `2026-10-08 10:48`, local time (see [Findings](#findings)).

## An edit, then a rollback

**Run.** `--edit-tags` with `rename.sh` as `$VISUAL` and `$EDITOR`, which
changed `Tag: houseplant care` to `Tag: indoor plants`; then
`--rollback d381087`, the commit before the edit.

**Expected.** `edit-tags: 1 concepts (user)`; then
`Rolled back 1 file to <sha>`, the old label back, a
`rollback: to <sha> (user)` commit, and the transcripts untouched.

**Happened.** The edit exited 0 and `tags.json` went to `rev` 6 with
`prefLabel: "indoor plants"` and `edited` stamped. The rollback:

```text
Rolled back 1 file to d381087
2026-10-08 10:55  user     rollback: to d381087 (user)
2026-10-08 10:55  user     edit-tags: 1 concepts (user)
2026-10-08 10:54  turn     turn: blacken-chattanooga-cantabile-friskily
```

(The first line is `--rollback`'s output; the rest is `--history -n 3`,
trimmed of its reminder.) `tags.json` was again byte for byte the file at
`d381087`: `houseplant care`, no `edited` and `rev` 5. `git diff d381087
HEAD -- transcripts/` printed nothing, as no turn came between.

## The mirror

**Run.** `$B src/index.ts --mirror $P/mirror.git`; then the TUI, one
message (how often to fertilise the pothos), an idle past the review and
10 more seconds; then `--mirror` with no argument, and a search of the
bundles for words of the chats. Last, a fresh launch and quit, timed.

**Expected.** No `Made DOROTHY_MIRROR_KEY` line, `Pushed to <path>`,
`SEALED` and `bundles/000001.enc` on the mirror's `sealed` branch; after
the chat `bundles/000002.enc` and `Waiting: no`; no chat's words in a
bundle.

**Happened.** `--mirror` printed only:

```text
Pushed to /tmp/dorothy-history-probe.c0HYLK/mirror.git
```

The mirror's `sealed` branch held `SEALED` and `bundles/000001.enc`, and
nothing else was on the mirror. `SEALED` explains the branch and how to
recover. The bundle began with the header `dorothy-sealed 1` and a base64
nonce, then ciphertext.

The chat's turn was committed at 10:56:02 and its review at 10:56:08. Seal
2 followed at 10:56:10, pushed in the background while the chat was still
open:

```text
SEALED
bundles/000001.enc
bundles/000002.enc
```

```text
Mirror: /tmp/dorothy-history-probe.c0HYLK/mirror.git
Sealed through: a29e3da
Waiting: no
```

`grep -a -c -i` over both bundles found 0 matches for each of
`houseplant`, `pothos`, `fertilise`, `sourdough`, `levain`, `espresso`,
`turn`, `review`, and the phrases `bang-uncial`, `lib-drubbed` and
`vociferate`. `dorothy` matched once in each, in the header line. The
mirror's own commits are `seal 1` and `seal 2`, by `Dorothy`, and it has
one ref, `refs/heads/sealed`.

Quitting: a fresh launch with the mirror set, left 10 seconds for its
background push, quit with one Ctrl+C. From the key to `bun` leaving the
pane took 118 ms. Quitting the chat above, after its turn and review, had
also finished before a 0.5-second check.

## Recovery

**Run.** In a third window with the same `env.sh`, then
`XDG_DATA_HOME=$P/recovered` and `XDG_CACHE_HOME=$P/recovered-cache`:
`$B src/index.ts --recover $P/mirror.git`, then `diff -r --exclude=.git`
of the two data directories.

**Expected.** `Recovered 2 of 2 bundles; main is at <sha>`,
`All <n> files pass.`, and an empty diff, except for changes committed
after the last push.

**Happened.**

```text
Recovered 2 of 2 bundles; main is at a29e3da
All 17 files pass.
```

`a29e3da` is the review that seal 2 covered. The diff printed one line
(its path trimmed):

```text
Only in .../transcripts: goodnight-sapiency-documenting-geotropic.jsonl
```

That is the empty transcript of the timed launch, created after the last
push and not yet committed then. Everything else matched. The recovered
repository had `main`, `sealed` and the `mirror` remote. It had no
pre-commit hook until its first open (`--history`), which wrote one, as
every open does (Ruling 11).

## The fallback engine, and the hook

**Run.** `--history -n 5` with the git binary, then
`env PATH=/nonexistent $B src/index.ts --history -n 5`. Then, in the data
directory with the shell's git: `printf '{' > tags.json && git add
tags.json && git commit -m x`.

**Expected.** The same five commits from isomorphic-git; the commit refused
by the hook, naming `tags.json`.

**Happened.** The two outputs were identical (`diff` printed nothing).
Either, trimmed of the date and kind columns:

```text
11:00  turn: goodnight-sapiency-documenting-geotropic
10:56  review: lib-drubbed-overreact-steadied (dorothy, claude-sonnet-5-5)
10:56  turn: lib-drubbed-overreact-steadied #1
10:56  title: lib-drubbed-overreact-steadied (prompt)
10:56  turn: lib-drubbed-overreact-steadied
```

The first `git commit` stopped before the hook, with git's
`Author identity unknown` and exit 128. The probe's `XDG_CONFIG_HOME` hides
the user's `~/.config/git/config`, so git had no identity. With
`git -c user.name=probe -c user.email=probe@localhost commit -m x`, the
hook refused it, exit 1:

```text
tags.json: JSON Parse error: Expected '}'
1 of 1 files broken.
```

The brief's clean-up, `git checkout -- tags.json` and then `git reset -q`,
would copy the staged `{` back from the index before unstaging it. So the
probe ran `git reset -q && git checkout -- tags.json`, which left
`tags.json` as committed and the tree clean.

## Findings

- **The restore warning dates the commit in UTC.** A defect, small:
  `Restored tags.json from 1567b95 (2026-10-07)` names a commit that
  `--history` lists at `2026-10-08 10:48`, local time (AEDT). The warning
  takes the first ten characters of the commit's ISO time
  (`src/history/history.ts`, line 330), while `--history` formats local
  time. Near midnight UTC, the two disagree by a day.
- **Every launch leaves a transcript, and history keeps it.** Not a defect
  of history: a chat's transcript is opened at launch, as on `main`. A
  launch quit without a message leaves an empty file. The next sweep
  commits it as `turn: <phrase>`, and it is sealed and recovered with the
  rest. The probe's history holds three (`valuing-…`, `blacken-…` and
  `goodnight-…`).
- **A chat's first commit is a sweep.** Not a defect: the user's first line
  is in the transcript before the title is saved, so the title's commit
  sweeps it first as `turn: <phrase>`, and `#1` adds the reply.
- **A rollback restores `rev` too.** Not a defect: the rollback put
  `tags.json` back byte for byte, so `rev` went from 6 to 5. The recall
  index notices a changed vocabulary by its modification time, not by
  `rev`, and saw the change.
- **The brief's hook clean-up was in the wrong order.** Not a defect of
  the code; see the hook step.
- **Quitting is quick with a mirror set.** 118 ms from Ctrl+C to exit,
  after a launch's background push.

Known limitations, decided while planning and not exercised here:

- isomorphic-git's https push and fetch are untested: they need a network
  and a host. The probe's mirror was a local path, pushed by the git
  binary; only `--history` ran under the fallback.
- `--mirror` with no `DOROTHY_MIRROR_KEY` set makes a key and saves it with
  dotenvx `set` into the `.env` of the directory it runs from. The probe
  set the key, so this path did not run.
- isomorphic-git trusts file stats (Ruling 19): a rewrite of the same size
  within the second of the last commit goes unseen by the fallback's sweep
  until it changes again.

## Sample data

[`2026-10-08-memory-history/`](2026-10-08-memory-history/) holds what the
probe left behind. None of it is a `.git` directory.

- `history.txt`: the final `--history -n 50`, 17 commits.
- `tags-cut.txt` and `tags-restored.json`: `tags.json` cut short, and as
  restored, in the step that restores it. The cut bytes are stored as
  `.txt`, since they are not JSON and Biome would refuse to format them.
- `check-broken.txt`: that step's `--check` output.
- `edit-tags-view.txt`: the `--edit-tags` view the rename script saw.
- `sealed.txt`: the mirror's `sealed` tree after the mirror step.
- `recover.txt`: `--recover`'s output and the one-line `diff`.
- `hook.txt`: the refused commit.
- `probe/`: `env.sh`, `say.sh`, `config.toml` and `rename.sh`.

`tags-restored.json` was reformatted by Biome to the repository's
indentation, since the repository's format check covers JSON under
`docs/`; its content is as written. `env.sh`'s key line reads
`export DOROTHY_MIRROR_KEY='<32 random bytes, base64>'`: the placeholder is
quoted, as unquoted it would parse as redirections, and shellcheck and
shfmt, which CI runs on the scripts, would reject it.

## Second run, after the review's fixes

The second run ran the code at `ad5936d`, after the whole-branch review's
fixes (`6b71f98` to `e54ddef`). It exercises those fixes live and checks
again that adoption, turns, reviews, the mirror and recovery still hold.
Five messages went to the model, and the run cost about $0.14: $0.046 for
the three chats and $0.093 for their reviews, by the TUI's `chat` and
`memory` figures.

### Setup differences

The setup was the first run's, with the same seed data and `config.toml`,
in a new `mktemp -d` directory, `$P`. The XDG variables were echoed and
checked in both windows before the first launch. The differences:

- `env.sh` exports `$P` and builds the XDG paths from it.
- `say.sh` types into window 0 by name, not the active window, which the
  first run found typing into the second window's shell. It also skips
  blank lines before reading the status line: with fewer lines on screen
  than the pane's 40 rows, its last line was blank and the wait ran out.
- A second key of 32 random bytes, for step 4c, was kept in `$P`, never
  in a `.env`.
- `$P/keyless` held an empty dummy `.env` for step 4b, the one `--mirror`
  run with no key.

`md5sum .env` in the checkout read `d25ebc6afd489f34347bfd370638799f`
before the run and after it: `.env` was unchanged.

### 1. Adoption, privacy, short shas

**Run.** Launch, quit with Ctrl+C, then `stat -c '%a %n'` of the data
directory and its `.git`, and `--history`.

**Expected.** The no-mirror reminder, `adopt: 10 files`, `700` for both,
and each `--history` line led by a 7-character sha.

**Happened.** As expected. The first screen showed
`! memory has no mirror · dorothy --mirror <url>`. Then (paths trimmed):

```text
700 .../data/dorothy
700 .../data/dorothy/.git
dorothy: memory has no mirror · dorothy --mirror <url>
11c4150  2026-10-08 18:46  turn     turn: tinhorn-fluidal-thalamic-brickyard
cf3dcdd  2026-10-08 18:46  adopt    adopt: 10 files
```

The seed data had been copied with the default `755`; adoption made both
`700`.

### 2. A restore by sha under both engines

**Run.** One message, about basil bolting on a windowsill, and an idle
past the review; then quit. With the binary,
`--restore tags.json cf3dcdd`, the adoption's version. Then, with
`env PATH=/nonexistent`, `--history -n 3` and
`--restore transcripts/smoothed-chanting-purloiner-tricking.meta.json
536802e`, the sidecar as its title left it, before the review.

**Expected.** Both restores work, each with a `restore:` commit.

**Happened.** As expected. The review (`2a48ad7`) changed `tags.json` and
the sidecar. The binary's restore (trimmed of the reminder):

```text
Restored tags.json from cf3dcdd; what it replaced is in broken/tags.json.20
26-10-08T07-48-53-258Z
1ef74e6  2026-10-08 18:48  restore  restore: tags.json from cf3dcdd (broken
kept)
```

isomorphic-git's `--history -n 3` listed `1ef74e6`, `2a48ad7` and
`3b3a489`, short shas included. Its restore (trimmed):

```text
Restored transcripts/smoothed-chanting-purloiner-tricking.meta.json from 53
6802e; what it replaced is in broken/transcripts/smoothed-chanting-purloine
r-tricking.meta.json.2026-10-08T07-49-05-614Z
9519a8e  ...  restore: transcripts/smoothed-chanting-purloiner-tricking.met
a.json from 536802e (broken kept)
```

Each restore commit held the file as it was at the sha and the copy it
replaced; `git status` was clean after both. At the next launch, the
restored sidecar, lacking its review, was reviewed again (`51e1fe0`).

### 3. A live transcript put back, then followed

**Run.** A new chat, message A (a companion plant for tomatoes in a pot).
After `turn: gibber-irksomely-discounting-mayest #1` (`7d9b3b9`) showed in
`--history` in the second window, that window ran
`printf '{"broken\n' >> <transcript>`. Then message B (how deep a pot) and,
after its reply, message C (plastic or terracotta).

**Expected.** A restore warning naming the transcript, B's lines in the
broken copy under `broken/`, and C's lines in the transcript at its path,
committed as a turn.

**Happened.** As expected. After B's reply the TUI showed (trimmed at the
pane's edge):

```text
! Restored transcripts/gibber-irksomely-discounting-mayest.jsonl from 7d9b3b
9 (2026-10-08); the broken copy is in broke…
```

The restore, `1957115`, took the place of B's turn commit, so the chat's
turns went `#1`, then `#3`. The transcript's tail, from
[`transcript-tail.txt`][tail]
(trimmed to the kind and text):

```text
transcripts/...mayest.jsonl, 7 lines:
  user       Message A: what's a good companion plant for tomatoes ...
  session
  assistant  Basil is a classic pick: ...
  stats
  user       Message C: thanks, last one: plastic or terracotta ...
  assistant  Plastic (or glazed ceramic) is the better pick ...
  stats
broken/transcripts/...mayest.jsonl.2026-10-08T07-51-42-523Z, 8 lines:
  A's four lines, then {"broken, then
  user       Message B: and how deep should that pot be? One line.
  assistant  At least 30 cm (12 in) deep, ...
  stats
```

`589a8e8 turn: gibber-irksomely-discounting-mayest #3` added C's three
lines to the transcript at its path: the writer had reopened it. B's
exchange is only in the broken copy, as the plan has it.

### 4. The mirror's key guard

**a. Run.** From the checkout with the probe's key,
`git init --bare $P/mirror.git` and `--mirror $P/mirror.git`.
**Expected.** `Pushed to`, `bundles/000001.enc`. **Happened.** As
expected: `Pushed to /tmp/dorothy-history-probe2.dPHCX4/mirror.git`, and
the `sealed` branch held `SEALED` and `bundles/000001.enc`, sealed through
`9bce027`.

**b. Run.** In a subshell, `cd $P/keyless`, `unset DOROTHY_MIRROR_KEY`
(`env` then held none), and
`$B /home/chewygumxx/dev/dorothy/src/index.ts --mirror $P/mirror.git`.
**Expected.** Exit 1 and a refusal, no key made, mirror unchanged.
**Happened.** As expected, from
[`mirror-refusals.txt`][refusals]
(wrapped):

```text
dorothy: DOROTHY_MIRROR_KEY is not set, and the bundles already sealed
need the key they were sealed with; set that one with dotenvx set. No
mirror is set
exit 1
```

The dummy `.env` was still 0 bytes, and the mirror's `sealed` was still
`769105a`, holding `bundles/000001.enc` only. The data repository's
`mirror` remote was still set to the same path, so `No mirror is set` is
not so (see [Findings](#findings-of-the-second-run)).

**c. Run.** From the checkout, with `DOROTHY_MIRROR_KEY` set to the second
key: `--mirror`, then `--mirror $P/mirror.git`. Then the TUI with that
key, quit without a message.
**Expected.** A refusal and exit 1 from both commands, nothing sealed; the
TUI warns
`history: DOROTHY_MIRROR_KEY does not open the sealed bundles; set the key
they were sealed with`, and the mirror gets no bundle.
**Happened.** Partly as expected. `--mirror` with no argument printed the
status and exited 0; only the set refused (wrapped):

```text
Mirror: /tmp/dorothy-history-probe2.dPHCX4/mirror.git
Sealed through: 9bce027
Waiting: no
exit 0
dorothy: DOROTHY_MIRROR_KEY does not open the bundles already sealed; set
the key they were sealed with. No mirror is set
exit 1
```

The TUI showed no warning: nothing was waiting to seal, and the key is
checked only when there is. The launch's empty transcript was left
uncommitted. A `--history -n 2` with the right key swept it in as
`058fc54`; a second launch with the wrong key then showed the warning on
its first screen:

```text
! history: DOROTHY_MIRROR_KEY does not open the sealed bundles; set the key
they were sealed with
```

After both launches the mirror's `sealed` was still `769105a`, with
`main` at `058fc54` and the seal still through `9bce027`. Nothing was
sealed under the wrong key.

**d. Run.** The right key, a launch, one message (a fan for tomato
seedlings), an idle past the review and 30 seconds more, then quit.
**Expected.** `bundles/000002.enc` on the mirror. **Happened.** As
expected, and one more. The launch's push sealed `058fc54` and the
sweep before it as seal 2, and the review then made seal 3:

```text
9dcdddf 18:55:35 seal 3
e0220d0 18:55:18 seal 2
769105a 18:52:32 seal 1
```

### 5. A stale index.lock

**Run.** With everything quit, `touch -d '2 minutes ago' .git/index.lock`
in the data directory. A launch, no message, then `--history -n 3` from
the second window, whose sweep commits the launch's empty transcript.

**Expected.** A warning naming the removed lock, and the commit through.

**Happened.** As expected, from
[`stale-lock.txt`](2026-10-08-memory-history/second-run/stale-lock.txt)
(wrapped, the path trimmed):

```text
dorothy: history: removed .../data/dorothy/.git/index.lock, a stale lock
a stopped git left
ad35f2a  2026-10-08 18:56  turn     turn: bibelot-hiccoughed-equivoke-dogto
oth
```

`.git/index.lock` was gone afterwards.

### 6. Recovery

**Run.** In the second window, in a subshell with the right key,
`XDG_DATA_HOME=$P/recovered` and `XDG_CACHE_HOME=$P/recovered-cache`:
`--recover $P/mirror.git`, `stat -c '%a %n'` of the recovered directory
and its `.git`, then `diff -r --exclude=.git` of the two data directories.

**Expected.** `Recovered 2 of 2 bundles`, `All <n> files pass.`, `700`
for both, and a diff of only what changed after the last push.

**Happened.** As expected, with three bundles for the reason in step 4d.
From [`recover.txt`](2026-10-08-memory-history/second-run/recover.txt):

```text
Recovered 3 of 3 bundles; main is at 567a4f4
All 22 files pass.
exit 0
700 $P/recovered/dorothy
700 $P/recovered/dorothy/.git
Only in $P/data/dorothy/transcripts: bibelot-hiccoughed-equivoke-dogtooth
.jsonl
```

`567a4f4` is step 4d's review, the last sealed. The one file only in the
data directory is the stale-lock step's empty transcript: `ad35f2a` was
committed by `--history` while the TUI was open, and waits for the next
launch's push. The `broken/` copies from steps 2 and 3 were recovered too.

### 7. Quit time

**Run.** The stale-lock step's TUI, open about 40 seconds with the mirror
set, quit with one Ctrl+C, timed from the key to its `bun` process
leaving.

**Expected.** About the first run's 118 ms.

**Happened.** 132 ms.

### Findings of the second run

- **A refused `--mirror` says `No mirror is set` while one is.** A defect,
  small: each of the three refusals in `src/history/commands.ts` ends
  `No mirror is set`, but a refusal leaves any mirror already set in
  place. Here the data repository's `mirror` remote, set in step 4a, was
  still set after 4b and 4c. Something like `the mirror is left as it
  was` would be true either way.
- **`--mirror` with no argument does not check the key.** Not a defect:
  the status reads and seals nothing, so it exits 0 under a wrong key, as
  4c showed. It does not say the key is wrong, though, which the user
  would learn only from the TUI's warning or a refused set.
- **The TUI warns of a wrong key only when something waits to seal.** Not
  a defect: nothing is sealed under the wrong key either way, and in a
  chat the first turn's commit brings the warning. A launch quit without
  a message, with nothing waiting, never shows it.
- **A restore of a good file is still called broken.** Not a defect: a
  restore keeps what it replaced under `broken/` and commits as
  `(broken kept)`, though in step 2 the replaced files were sound. The
  wording is the plan's.
- **A sidecar restored to before its review is reviewed again.** Not a
  defect: step 2's restored sidecar had no review, so the next launch's
  scheduler reviewed it (`51e1fe0`), at the cost of a review.
- **A restore takes a turn's place in the count.** Not a defect: B's turn
  became the restore commit, so the chat's turns read `#1`, then `#3`.
- **A command's commit waits for the next launch to be sealed.** Not a
  defect: the TUI seals after its own commits and at launch, so
  `ad35f2a`, from `--history` while the TUI was open, was still waiting
  at quit and is the one file the recovery lacks.
- **Every fix the run touched worked:** the private directory and short
  shas (step 1), restores by sha under both engines (2), the reopened
  transcript (3), the key guard (4), the stale lock (5), a private
  recovery (6) and a quick quit (7). The restore warning's local date
  could not be told from UTC here, as the run fell after 11:00 local time
  (AEDT), when both dates agree; nor did the run restore a deleted file.

### Sample data of the second run

[`second-run/`](2026-10-08-memory-history/second-run/) holds:

- `history.txt`: the final `--history -n 50`, 24 commits.
- `transcript-tail.txt`: step 3's transcript and its broken copy, whole,
  with the restore and `#3` commits.
- `mirror-refusals.txt`: steps 4a to 4c.
- `stale-lock.txt`: step 5's `--history`.
- `recover.txt`: step 6's recovery, `stat` and `diff`.
- `probe/`: `env.sh` and `say.sh`, as changed; `config.toml` and
  `rename.sh` are the first run's. `env.sh`'s key line is the first run's
  placeholder.

[tail]: 2026-10-08-memory-history/second-run/transcript-tail.txt
[refusals]: 2026-10-08-memory-history/second-run/mirror-refusals.txt
