---
ctime: 2026-10-15
mtime: 2026-10-20
spdx: GPL-3.0-only
title: Memory store implementation report
description: >-
  How Dorothy's memory store was built: the plan's tasks, the rulings made,
  what the probe and the reviews changed, every commit and what is left.
tags:
  - dorothy
  - memory
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-15-memory-store-implementation.md
   -
   -->

# Memory store implementation report

## Summary

Dorothy now keeps facts as well as conversations, and shares a project's
with its repository:

- **Tool events.** A body's tool call is a transcript event, scrubbed of
  the shapes of secrets (`scrub.ts`, linear in time) and trimmed to 2,000
  characters a side; recall does not index them. A session event may name
  its `source`.
- **Facts.** One Markdown file each under `facts/`, personal or a
  project's, in one canonical form whose YAML cannot be coerced into
  another type (`facts/file.ts`). They are written, moved, retired and
  revived under the sidecar lock (`facts/store.ts`); nothing deletes one.
  Every fact has an origin, set by the code that writes it and raised
  only by the user.
- **Projects.** A project is a git repository named by its `origin`,
  read from `.git/config` (`projects/identify.ts`), kept in
  `projects.json` with the memory directory each checkout last synced and
  the hash of each fact as it last held it there. Sync reconciles a
  project's facts with the repository's `.agents/memory/`, the form
  Claude Code's auto-memory reads, and regenerates its `MEMORY.md`. It
  never commits and never writes outside the memory directory.
- **History and recall.** The sweep adopts hand-written facts, the lint
  knows facts and the registry, and the recall index carries facts,
  synced from the data directory by every caller, and where each chat
  began.
- **Commands.** `--facts`, `--retire`, `--revive`, `--sync` and
  `--projects`, parsed by the CLI.

- Spec: [`docs/specs/2026-10-15-memory-store-design.md`](../specs/2026-10-15-memory-store-design.md)
- Plan: [`docs/plans/2026-10-15-memory-store.md`](../plans/2026-10-15-memory-store.md)
- Probe output: [`2026-10-15-memory-store-implementation/probe.txt`](2026-10-15-memory-store-implementation/probe.txt)
- Roadmap: [`docs/roadmap.md`](../roadmap.md)
- Branch: `docs/memory-spec`, from `main` at `7e2e31a`

Each of the plan's tasks was reviewed by a fresh reviewer; the reviews
found a dozen faults the plan had mandated, all fixed in rounds of
their own. The probe adopted this repository's own
`.agents/memory/` into a scratch store and went through every row of the
sync it was written to check, and every step read as expected. At the
head of the branch `bun run check` passes with 1,542 tests across 80
files, up from 1,234. A final whole-branch review found fourteen more
faults, all fixed in one wave (see Final review), and five follow-ups
closed the gaps it left (see Follow-up).

## The probe

The probe ran on 2026-10-15 in a scratch directory made with `mktemp -d`
under the job's temporary directory, never in the user's data or cache
directories: `HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`,
`XDG_CONFIG_HOME` and `XDG_STATE_HOME` all pointed into it, and it ran
from there, so no `.env` was found or decrypted. The clone of this
checkout had its `origin` set to the repository's GitHub address, so that
its project is `github.com/chewygumxx/dorothy` and not a `local-` one
(ruling 3 below). The scratch directory was deleted afterwards. In the
output below, `$P` is the scratch directory and `$REPO` this checkout;
the commands are those of the plan with `$D` spelled out and each exit
code added.

```text
$ bun $REPO/packages/cli/src/index.ts --sync $P/dorothy
dorothy: memory has no mirror · dorothy --mirror <url>
github.com/chewygumxx/dorothy: 4 in, 0 out (.agents/memory)
[exit 0]
$ bun $REPO/packages/cli/src/index.ts --facts
dorothy: memory has no mirror · dorothy --mirror <url>
github.com/chewygumxx/dorothy
  reference  bg-session-force-color  Background sessions force colour
             Claude Code background sessions export FORCE_COLOR=3; the user's own shell does not
  project    dorothy-ambition  Dorothy's ambition
             One adaptable Dorothy: extensible, remembering, Anthropic first
  project    maintenance-design-agreed  Maintenance design agreed
             Agreed design for cyclical maintenance (sub-project 4a), queued after workspace modularity on docs/roadmap.md
  feedback   nested-claude-session-env  Nested claude inherits the session
             claude run from a session's Bash inherits its project and session; -c and purge then hit the live session
[exit 0]
$ bun $REPO/packages/cli/src/index.ts --projects
github.com/chewygumxx/dorothy  .agents/memory  $P/dorothy
[exit 0]
$ git -C $P/dorothy diff --stat
 .agents/memory/MEMORY.md | 11 +++++++----
 1 file changed, 7 insertions(+), 4 deletions(-)
[exit 0]
$ bun $REPO/packages/cli/src/index.ts --sync $P/dorothy
dorothy: memory has no mirror · dorothy --mirror <url>
github.com/chewygumxx/dorothy: 0 in, 0 out (.agents/memory)
[exit 0]
$ bun $REPO/packages/cli/src/index.ts --retire github.com/chewygumxx/dorothy/bg-session-force-color
dorothy: memory has no mirror · dorothy --mirror <url>
Retired github.com/chewygumxx/dorothy/bg-session-force-color.
[exit 0]
$ bun $REPO/packages/cli/src/index.ts --sync $P/dorothy
dorothy: memory has no mirror · dorothy --mirror <url>
github.com/chewygumxx/dorothy: 0 in, 1 out (.agents/memory)
[exit 0]
$ ls $P/dorothy/.agents/memory
dorothy-ambition.md
maintenance-design-agreed.md
MEMORY.md
nested-claude-session-env.md
[exit 0]
$ bun $REPO/packages/cli/src/index.ts --revive github.com/chewygumxx/dorothy/bg-session-force-color
dorothy: memory has no mirror · dorothy --mirror <url>
Revived github.com/chewygumxx/dorothy/bg-session-force-color.
[exit 0]
$ bun $REPO/packages/cli/src/index.ts --sync $P/dorothy
dorothy: memory has no mirror · dorothy --mirror <url>
github.com/chewygumxx/dorothy: 0 in, 1 out (.agents/memory)
[exit 0]
$ ls $P/dorothy/.agents/memory
bg-session-force-color.md
dorothy-ambition.md
maintenance-design-agreed.md
MEMORY.md
nested-claude-session-env.md
[exit 0]
$ sed -i 's/FORCE_COLOR=3/FORCE_COLOR=3 (probed)/' <clone>/.agents/memory/bg-session-force-color.md
$ bun $REPO/packages/cli/src/index.ts --sync $P/dorothy
dorothy: memory has no mirror · dorothy --mirror <url>
github.com/chewygumxx/dorothy: 1 in, 0 out (.agents/memory)
[exit 0]
$ bun $REPO/packages/cli/src/index.ts --history -n 12
dorothy: memory has no mirror · dorothy --mirror <url>
000c972  2026-10-15 11:42  other    sync: github.com/chewygumxx/dorothy: 1 in, 0 out
8555364  2026-10-15 11:42  other    sync: github.com/chewygumxx/dorothy: 0 in, 1 out
1d2ae2d  2026-10-15 11:42  other    revive: github.com/chewygumxx/dorothy/bg-session-force-color
7ca41a5  2026-10-15 11:42  other    sync: github.com/chewygumxx/dorothy: 0 in, 1 out
63fb225  2026-10-15 11:42  other    retire: github.com/chewygumxx/dorothy/bg-session-force-color
1f255b4  2026-10-15 11:42  other    sync: github.com/chewygumxx/dorothy: 4 in, 0 out
8c67b56  2026-10-15 11:42  adopt    adopt: 1 files
[exit 0]
```

Every expectation held:

- The first sync read `4 in, 0 out (.agents/memory)`; `--facts` listed
  the four under the project with their `MEMORY.md` titles; the diff
  touched `MEMORY.md` alone, its hooks replaced by the facts'
  descriptions. The second sync read `0 in, 0 out`.
- Retiring removed `bg-session-force-color.md` at the next sync
  (`0 in, 1 out`); reviving brought it back (`0 in, 1 out`).
- The edit in the clone imported (`1 in, 0 out`).
- `--history` showed `adopt`, then the `sync:`, `retire:`, `revive:` and
  `sync:` commits in order, each as it happened. Every commit is by
  `other`: the commands ran outside a chat.

The "no mirror" notice on each line is the launch reminder, which the
scratch store rightly shows. The probe predates the final review: since
then `--sync` also prints a line for each way something moved, such as
`imported: bg-session-force-color`.

## Rulings

### Settled in the plan

1. **The body cap is 8,000 characters, not 2,000.** This repository's own
   `maintenance-design-agreed.md` has a body of 2,638, which a cap of
   2,000 would have refused at the first sync.
2. **A project's origin is read from `.git/config` directly,** not from
   `git`: Dorothy runs without git installed, and a user's `insteadOf`
   rewrites must not change an id. A worktree's or submodule's `.git`
   file is followed.
3. **An origin that is a local path or `file://` URL is no origin:** the
   project is `local-` and its root's hash. A clone from a local path
   has such an origin, which is why the probe set the clone's `origin`
   first.
4. **`MEMORY.md` is left alone** when any repository file was skipped, or
   the project has no live fact, so that a hand-kept index never loses
   entries sync could not read. The review refined it (below).
5. **Repository files are written mode 0644** in ordinary directories;
   the store's own stay 0600 in 0700.
6. **Repository files over 64 KiB are skipped unread,** and symlinks are
   never followed.
7. **A fact added or edited by hand in the store may omit `provenance`;**
   the sweep fills it in as the user's.
8. **Facts adopted from a `MEMORY.md` take creation times in its order,**
   a millisecond apart, so the regenerated index keeps it.
9. **CRLF line ends read as LF.**

### Made in review

Each is a ruling of the controller's, made on a reviewer's finding, with
the reason and what it costs if wrong.

**Task 1: scrubbing.**

- The scrub's pattern for `key=value` pairs bounds the runs of word
  characters around the key to 64 each, and a timed test pins it. The
  spec scrubs before it trims, so the scrub sees text of any length and
  must run in linear time; a quadratic pattern took 7.7 seconds over
  100 KB. If wrong, a name longer than 64 characters around the keyword
  goes partly unredacted.
- `Authorization: token <credential>`, which GitHub's API takes, is
  scrubbed like a bearer token. It was a minor until it was seen to
  leave a credential in a stored transcript, which the spec forbids; the
  cost if wrong was a small extra fix.
- The transcript bullet of this package's guide keeps its sentences on
  tool events and `source` from Task 1, as the working rules ask that an
  architecture change update the guide in the same branch; Task 10
  merged them with its own.

**Task 2: what a fact may say.**

- A fact's name starts with a letter and is not `null`, `true` or
  `false`. Written plain, as the spec has patterns be, `123`, `1e3` and
  `null` read back as other types and the fact was unreadable. If wrong,
  a name like `2024-notes` is skipped by sync, named and not lost.
- The same round trip is guaranteed for every plain value with a pattern
  (tags and the rest), and tests pin it. Extra `metadata` keys are
  refused when they are `null`, `true` or `false` in any case, as YAML
  reads those as other types, and when they are `__proto__`, which a
  plain object would lose.
- Times are ISO 8601 UTC as `Date#toISOString` writes them, with
  milliseconds; `"1"` and `"May 5"` were accepted before.
- Hidden characters are checked in every decoded string value too, not
  only the file's text, so an escape such as `\u200b` in a quoted scalar
  is caught. The set is the control characters but tab and newline, the
  format characters (Unicode category Cf), the default ignorable code
  points, and U+2028 and U+2029, with no allow-list: emoji joined by
  U+200D, the Persian ZWNJ and the soft hyphen are refused, because
  smuggling through joiners and variation selectors is the threat the
  spec names. If wrong, such a fact must be reworded.

**Task 5: the sweep.**

- When history sweeps up an uncommitted fact, it keeps it as Dorothy's
  own write, with its provenance, when it parses, is byte-for-byte
  canonical and its provenance differs from the committed version's (or
  there is none). Otherwise it is a hand edit and becomes the user's.
  Every write of hers sets a new `provenance.at`, a hand edit leaves it
  as it was, and the origin ladder forbids raising `repo` or `external`
  without the user: the plan's rule made every changed fact the user's,
  which laundered a crashed sync's imports into `origin: user`. If
  wrong, a user who also edits `provenance.at` by hand keeps the
  provenance they claim, which is their own choice.
- A file kept in `broken/` keeps the user's bytes. The plan would have
  kept the rewritten text; the sweep now rewrites a hand edit only when
  the canonical text passes the lint (the project id check included) and
  otherwise leaves the original for the lint to heal. The spec says
  broken files keep their bytes.
- Tests were added that a record of Dorothy's own fact is not
  canonicalised and that a hand edit is, during a record; a comment was
  rewrapped to 80.

**Task 8: sync.**

- `MEMORY.md` is rewritten only when it is absent or every non-blank
  line is one sync writes: an entry `- [title](./name.md)` or its
  indented description. Anything else means a hand kept it, and it is
  left and named. The spec's known risk accepts losing an index sync
  wrote; the pinned review focus forbids overwriting uncommitted work,
  and a sync-shaped file loses nothing. If wrong, a hand-kept index with
  headings stays stale until the prose is removed.
- Ruling 4 is refined: a skipped file blocks `MEMORY.md` only if the
  existing index links it. An unlinked skipped file, a `README.md` for
  one, had no entry to lose. No cost if wrong.
- On import (adopt, change, conflict and revive) a fact's title is its
  `MEMORY.md` entry's when there is one, else the store's, else its
  name, as the spec says.
- `synced` is keyed by root within a project, `{ root: { name: hash } }`,
  since become `{ root: { last, dirs } }` (see Follow-up).
  One map per project let two checkouts of one remote ping-pong and a
  stale clone silently roll the store back. The spec's example and text
  changed to match; `projects.json` is unreleased, so there is no
  migration. A stale clone's first sync still finds a conflict and the
  repository wins, reported as one.
- A directory, FIFO or other non-regular entry named like a fact is
  skipped and named, never taken for a deletion: before, its fact was
  retired silently, which the review focus forbids.
- A failed import is listed once, as skipped, not also as a conflict;
  the projects guide takes its header from a sibling with its own date.

## Review

Every task's reviewer checked the code against the brief and the spec.
Tasks 3, 4, 6, 7 and 9 were approved as built. Tasks 1, 2, 5 and 8 each
had important findings, every one of which the plan had mandated, and
each was fixed in a round of its own:

- Task 1: the quadratic scrub, and the leaked `Authorization: token`.
- Task 2: names and text YAML would turn into other types, hidden
  characters spelled as escapes and not caught, default ignorables
  missed, loose times, and a `__proto__` key.
- Task 5: the sweep making every changed fact the user's, and broken
  files losing the user's bytes.
- Task 8: a hand-kept `MEMORY.md` overwritten, titles taken from the
  store before the index, one `synced` map for every checkout, and
  non-files named like facts retired.

The probe also ran in Task 8, on a copy of this repository's
`.agents/memory/`: it first-synced four facts in and wrote the index.

## Final review

A review of the whole branch, `6acc261..525f69d`, found eight important
faults and six minor ones. The controller ruled on each, and one wave
fixed them all, each with a regression test:

1. **Private key blocks.** The pattern was quadratic over repeated
   `BEGIN` headers with no `END` (1.4 MB took over 6 seconds) and missed
   a truncated block. It now redacts to the end of the text, linearly.
2. **Quoted values.** `password: "correct horse battery"` leaked after
   its first word; a quoted value is now redacted to its closing quote,
   at most 512 characters (a cap since lifted, see Follow-up).
3. **Provenance on every write.** A retirement, revival, move or sync's
   retirement kept the old provenance, so when left uncommitted the
   sweep made the fact the user's. Every write now sets `provenance.at`,
   and `by` where the write names a writer.
4. **An edited memory directory.** Changing `memoryDir` retired every
   fact. Each root's record now names the directory it synced, and a
   record of another directory counts as none: a first sync, retiring
   nothing. Records are now kept per directory (see Follow-up).
5. **Claude Code's index entries.** `indexTitles` reads the one-line
   `- [T](name.md)` form with a hook after it, under `-` or `*`.
6. **A hand's lines in the index.** `isGeneratedIndex` ends an entry at a
   blank line and takes only a two-space line that is no list item as a
   description. A description wrapping onto a list marker escapes it.
7. **Secrets in registry reasons.** A bad project is named by its place,
   never its key, and a memory directory with a control character or NUL
   is refused without repeating it; since, any hidden character too.
8. **Facts never indexed.** No caller passed the data directory; the
   catalogue, `--tags`, `--edit-tags` and the recall server now do.
9. **`--sync`'s report** says "1 fact" in the singular,
10. says a missing path does not exist,
11. and lists the names that moved.
12. A test pins a first sync whose two sides differ: a conflict, the
    repository's version kept and reported.
13. The spec's known risks name snake-case files and lost hooks.
14. This report, made true of the scrub and the index.

## Follow-up

The last review's gaps, approved by the user and fixed each in its own
commit with a regression test written to fail first:

1. **Escaped quotes.** `password: "abc\"def ghi"` leaked `def ghi`. A
   quoted value now steps over a backslash and what it escapes, a
   carriage return or Unicode line separator too: only a line feed or
   the text's end stops it.
2. **Long quoted values.** The 512-character cap leaked a longer
   secret's tail, and a second scrub of an unclosed quote redacted more.
   A quoted value now runs to its closing quote or its line's end. A
   repeated group in the pattern turned out to cost the engine a frame a
   character: past some hundred thousand it stopped matching and kept the
   secret, after some 250 ms. So the pattern matches only the value's
   first character and `quotedEnd` scans the rest in a loop. Timing tests
   on about 3 MB of adversarial input (openings with no closing quote,
   keys inside one unclosed value, runs of quotes and backslashes,
   escaped quotes) each check the exact output; at 4 MB the slowest
   takes about 50 ms, growing linearly.
3. **PGP private keys.** `-----BEGIN PGP PRIVATE KEY BLOCK-----` is
   redacted, whole or cut short; a public key block is left alone.
4. **Hidden characters in `memoryDir`.** A bidirectional override, a
   zero width or a line separator is refused, by the rule facts use,
   naming the code point and never the path.
5. **Switching `memoryDir` back.** A root's record named only its last
   directory, so going from A to B and back made A's out-of-date files
   win a first sync. `synced` is now
   `{ root: { last, dirs: { dir: { name: hash } } } }`; a sync uses and
   replaces only its root and current directory's record and keeps the
   rest, never pruned. A directory absent from disk keeps its record
   only if it is `last`, the one the root synced last: else pointing
   `memoryDir` back at a directory since moved away retired every fact,
   and the switch back removed the files. There is no migration from
   `{ dir, facts }`, which only this branch wrote. The spec's example
   and text and the projects guide say so.

## Verification

- `bun run check` at the head: typecheck, format, lint, Markdown, YAML,
  env, em dash and header checks, and the tests.

```text
[NOTICE] Verification Passed:
    Files parsed: 310
    Repo line - Out-of-Sync: 0, Correct: 270, Not found: 40
    Path line - Out-of-Sync: 0, Correct: 270, Not found: 40
    Files unreadable: 0, Skipped: 0
$ bun test
bun test v1.4.2 (744846f84)

 1542 pass
 0 fail
 135492 expect() calls
Ran 1542 tests across 80 files. [20.54s]
```

- The tests numbered 1,234 before this branch and 1,542 now.
- The probe above, against this repository's own memory, in scratch
  directories only.

## Commits

`git log --oneline main..HEAD`, oldest first, with this report's own
commit last:

```text
7afb821 docs: Specify Dorothy's memory store
e3b8435 docs: Compare memory systems with the store
f6ae325 docs: Take the field's lessons into the store
f230bed docs: Note what the store took from the field
3e9ea0a ai: Remember that nothing is forgotten
0728f82 docs: Write facts' frontmatter without YAML traps
6acc261 docs: Plan Dorothy's memory store
802fb64 feat(memory): Record tool calls, scrubbed
91ee7d1 fix(memory): Scrub in linear time
912c48c feat(memory): Read and write facts without traps
ec68c74 fix(memory): Refuse names and text YAML would turn
c960f18 docs: Name the hidden characters and name pattern
2a17bc4 fix(memory): Refuse extra keys YAML lowercases
e322eeb feat(memory): Keep facts, personal or a project's
de506cd feat(memory): Know projects by their origin
3a5012a feat(memory): Lint facts and the projects registry
1aee4f5 fix(memory): Keep Dorothy's facts hers in a sweep
3da37b7 feat(memory): Index facts and where chats began
b96549d feat(memory): Write facts in a repository's form
a6f70df feat(memory): Sync a project's facts with its repo
300f748 fix(memory): Keep hand edits to MEMORY.md
8c37f3b fix(memory): Remember sync per checkout
5e50687 docs(memory): Sync per root, and the index's rules
2fbb174 feat(memory): List, retire and sync facts
abba2df feat(cli): Parse the fact commands
bdf0d83 docs: Report the memory store
525f69d docs: Describe the sweep as it is
2241880 fix(memory): Scrub cut keys and quoted values
63c615f fix(memory): Stamp provenance on every fact write
b29a049 fix(memory): Tie each root's sync record to a dir
1610e8d fix(memory): Keep registry keys out of reasons
888bd87 fix(memory): Read and guard MEMORY.md entries
d1f44b9 fix(memory): Index the store's facts on every sync
7f947c6 fix(memory): Say what --sync moved, and plainly
752939c test(memory): Pin first-sync conflicts, snake case
d3abdd5 docs: Name snake case and lost hooks as risks
2607717 docs: Report the final review's fixes
c04e8c7 fix(memory): Step over escaped quotes in secrets
e55585a fix(memory): Redact a quoted secret to its end
08d4be8 fix(memory): Redact PGP private key blocks
19a6914 fix(memory): Refuse hidden characters in memoryDir
3d4391a fix(memory): Keep a sync record per directory
a7c1e68 docs: Report the follow-up fixes
6078ca8 fix(memory): Retire only for the dir synced last
(this commit) fix(memory): Escape any line end but a line feed
```

## Known limitations

The actionable store gaps, including preserved hooks and last-index cleanup.
Closed by the roadmap sweep: see
[the sweep report](./2026-10-19-roadmap-sweep.md). Remaining limits
are recorded there.

From the spec's known risks, those that remain:

- **Repository wins.** A conflict reverts the store's change in the
  store, though history keeps it; a notice that goes unread loses it
  from view.
- **`MEMORY.md` is regenerated.** An index sync wrote is rewritten at
  every export; one with a hand's lines in it is left alone.
- **A stale checkout.** The first sync from an old clone of a remote
  takes the repository's facts as a conflict; the store's newer version
  survives only in history.
- **Consecutive assistant events** may meet code that assumed turns
  alternate; the plan checks before the Bodies spec relies on it.
- **Retired facts accumulate,** costing search a little noise.
- **The scrub is by shape.** It misses a password with no telling key
  beside it, and a `token <8 or more characters>` in prose is redacted.
- **One remote, one project.** A repository whose `origin` changes
  becomes a new project until `projects.json` is edited.

And one more: a fact retired by a deletion in the repository leaves the
last `MEMORY.md` as it was until a live fact is synced, because sync
leaves the index alone when no fact is live.

### Known gaps

Minors set aside by the reviews, for the final review to triage; none
changes behaviour the specs pin:

- **Scrub.** A key name matches loosely (`author`, `monkey`).
- **Fact file.** The link check can be bypassed through titles, `<..>`,
  `.MD` and reference links; duplicate YAML keys resolve last-wins
  silently; wrapping counts code points and not columns; times check
  their shape and accept `2026-02-31`; `renderFact` validates nothing,
  as the writers parse back what they render.
- **Store.** A partial failure of `retireFacts` or `moveFact` reports a
  plain failure without the paths written; a read error such as
  `EACCES` is reported as unparseable.
- **Recall.** A transient read error drops a fact's indexed row until
  the next readable sync, and change detection is by mtime.
- **Export.** Claude Code's auto-memory often names files in snake
  case, `feedback_testing.md`, which a fact's name refuses: such a file
  is skipped and named, not lost, and a `MEMORY.md` linking it is left.
  A regenerated `MEMORY.md` replaces each entry's hook line with the
  fact's description.
- **Sync.** A store-retired fact's `synced` row is deleted, so the file
  reappearing on a branch switch revives it; a recorder that throws
  after writes reports a failure and loses the report; the `synced`
  records of deleted checkouts and of directories no longer used are
  never pruned.
- **Commands.** `--retire --from` with no match
  exits 0 silently; `--sync -x` takes `-x` as a path; `--sync` on a
  regular file errors as "sync failed"; `--facts` sweeps history for a
  read-only listing.
