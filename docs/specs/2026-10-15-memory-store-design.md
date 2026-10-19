---
ctime: 2026-10-15
mtime: 2026-10-20
spdx: GPL-3.0-only
title: Dorothy's memory store design
description: >-
  Design spec for the first of Dorothy's Memory's three parts: one store
  of conversations and facts from every body, scoped personal or to a
  project, with each project's share synced to its repository.
tags:
  - dorothy
  - memory
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-15-memory-store-design.md
   -
   -->

# Dorothy's memory store design

## Purpose

Wherever Dorothy goes, her memory follows with her. Today it does not:
her memory is of her chat conversations alone, and `dorothy --claude`
carries her identity but none of it. The
[objectives](../reports/2026-10-15-objectives.md) put her memory first
and allow it to be reworked rather than extended.

This spec reworks the store. Every memory becomes an entry of a kind, a
scope and a source: conversations from any body, and facts, which hold
what she knows of the user, their work and what has worked, beside the
conversations it came from. A project's facts are synced to its
repository, so the store absorbs each project's memory and remains its
source of truth, while agents without Dorothy still read it.

The machinery that works carries over: transcripts and notes, the recall
index, the tag vocabulary, compaction, history and the mirror, and the
locks.

## The phase

Dorothy's Memory is three specs, each with its own plan, in this order:

1. **The store** (this spec): entries, kinds, scopes and sources; facts;
   projects and their sync; writers in parallel; migration.
2. **Bodies**: Claude Code's sessions recorded into the store and
   reviewed as chat's are; memory delivered to a body through the
   gateway and MCP, with a `remember` tool; Claude Code's own
   auto-memory kept from writing beside the store.
3. **Layers and learning**: what is always in context and what is on
   demand, with every budget in one place; reviews that distil facts and
   lessons from conversations and correct stale ones.

They meet at three interfaces. The store's module API is how bodies
record and how reviews write. MCP is how a body looks things up and
remembers. A rendered context section, which memory writes and a host
places in its prompt, is what a body always has. This spec builds the
first, and leaves the store usable by hand and from the CLI before the
other two land.

## Decisions

- **Rework the model, keep the machinery.** Scope, source and kind are
  dimensions of every entry, not three subsystems beside chat's; the
  files, locks, history and index that hold them stay.
- **One memory, absorbing projects.** A project's memory lives in the
  store, synced to its repository's memory directory, by default
  `.agents/memory/`, in the format Claude Code's auto-memory already
  reads. The store is the source of truth; the repository holds a copy
  for its contributors.
- **Facts are Markdown files.** One fact a file, with frontmatter, as
  `.agents/memory/` holds them: editable by hand, diffable, versioned by
  history, and exported by copying.
- **A lesson is a fact.** Facts take the four types the repository's
  memory already uses: `user`, `feedback` (a lesson on how to work),
  `project` and `reference`. Export loses nothing.
- **Scope is a path.** A fact is personal or a project's by where it is
  stored. Export reads only a project's directory, so a personal fact
  cannot reach a repository by any rule's mistake.
- **Conversations never leave the store** except through the sealed
  mirror. Only facts are exported.
- **Project facts export freely.** Sync writes them into the working
  tree and they are committed with the work, trusting the scope they
  were written with. Sync never commits or pushes itself.
- **On a conflict the repository wins.** A fact changed in both places
  takes the repository's version; the store's is kept in history, and a
  notice names it. Nothing uncommitted in a working tree is ever
  overwritten.
- **Conversations take a source.** Chat's sessions and Claude Code's
  are one kind, told apart by a source on the session event; a body's
  tool calls are kept, their large output trimmed.
- **Nothing is forgotten.** A fact that no longer serves is retired: it
  leaves the repository's copy and sinks below live facts, but stays in
  the store, in search and in history, and can be revived. Memories fade
  by ranking, never by deletion or expiry.
- **Where a fact came from is the code's to say.** Each fact records its
  origin, `user`, `dorothy`, `external` or `repo`, set by the writer
  from the session it came from and never read from its text, so text
  claiming to be the user's does not make it so.
- **Migration is lazy.** Today's files are valid as they stand: a
  session event without a source is chat's, and nothing is rewritten.

## State

The data directory is `$XDG_DATA_HOME/dorothy/`, as today; new rows are
marked.

| Class               | What                                            | Where                                        |
| ------------------- | ----------------------------------------------- | -------------------------------------------- |
| Canonical           | transcripts, of every source                    | `transcripts/<phrase>.jsonl`                 |
| Generated, authored | notes, tags, pins, hidden, appraisals, clusters | `transcripts/<phrase>.meta.json`             |
| Generated, authored | concepts and tombstones                         | `tags.json`                                  |
| Authored (new)      | personal facts                                  | `facts/personal/<name>.md`                   |
| Authored (new)      | a project's facts                               | `facts/projects/<project id>/<name>.md`      |
| Generated (new)     | projects, their roots and their sync state      | `projects.json`                              |
| History             | every committed version of the files above      | `.git/` in the data directory, branch `main` |
| History, sealed     | encrypted bundles of `main`                     | branch `sealed`, and the mirror              |
| Kept aside          | broken bytes found by the lint                  | `broken/`                                    |
| Derived             | the recall index                                | `$XDG_CACHE_HOME/dorothy/recall.sqlite`      |

## Conversations

A conversation is a transcript and its notes, as today, from any body.

### The session event

`SessionEvent` gains three optional fields:

- `source`: `"chat"` or `"claude-code"`, and later other bodies. Absent
  means `"chat"`.
- `sourceSession`: the body's own session id, such as Claude Code's,
  so a resumed session continues its conversation.
- `project`: the project id the session ran in, or absent for none.
  Chat sessions have none.

`sdkSessionId`, `model` and `promptHash` stay; a body that has no value
for one writes an empty string.

### Tool events

A new event records a body's tool call:

```json
{
  "v": 1,
  "kind": "tool",
  "at": "2026-10-15T09:12:44.501Z",
  "name": "Bash",
  "input": "{\"command\":\"git status --short\"}",
  "output": " M docs/roadmap.md\n",
  "ok": true,
  "cut": { "input": 0, "output": 0 }
}
```

`input` and `output` are text. Before they are trimmed, known shapes of
secret are replaced with `[secret]`: a `key=value` or `key: value` whose
key names one (`token`, `key`, `secret`, `password`, `auth`), `Bearer`,
`Basic` and `token` credentials, private key blocks, and the prefixes of
common provider keys. Each is then trimmed to its first 2,000
characters, and `cut` counts the characters dropped. A call to one of
Dorothy's own memory tools carries `"memory": true`, so that no review
learns as new what memory itself supplied. Tool events are not turns:
turns stay the user and assistant events, numbered as today, and tool
events sit between them. The store accepts consecutive assistant events,
as an agent writes text between tool calls; the plan checks that
compaction, reviews and recall tolerate them. How a body's session maps
onto events is the Bodies spec's to settle.

The lint accepts tool events, and recall does not index their text:
tool output is noise to search and the likeliest place for a secret.

## Facts

### The file

```markdown
---
name: dorothy-ambition
title: >-
  Dorothy's ambition
description: >-
  One adaptable Dorothy, extensible and remembering
metadata:
  type: project
tags:
  - k1a2b3c4d
importance: 7
provenance:
  origin: user
  by: dorothy
  at: "2026-10-15T09:30:00.000Z"
  created: "2026-10-15T09:30:00.000Z"
  model: "claude-opus-5-5"
  from: "bingo-overabundance-mazer-kasha#12"
---

The fact itself, in Markdown.
```

- `name`: kebab-case, at most 64 characters, beginning with a letter and
  not `null`, `true` or `false` (written plain, it must read back as
  text), and the file's stem, so unique within its scope.
- `title`: at most 60 characters; `description`: one line of at most
  160, as a conversation's notes are limited.
- `metadata.type`: `user`, `feedback`, `project` or `reference`. Other
  `metadata` keys, such as those Claude Code's auto-memory adds, are
  kept as they are.
- `tags`: concept ids from `tags.json`, optional.
- `importance`: 1 to 10, optional, set by a writer with a model in the
  loop; the Layers and learning spec ranks by it. A fact without it
  ranks neutrally.
- `provenance.origin`: where the fact's content came from. `user`: the
  user said or wrote it. `dorothy`: she derived it from the user's words
  or her own work. `external`: it came from tool output, the web or
  another person's text. `repo`: it was imported from a repository.
  Every write names it, and the store has no default. A later version
  may lower a fact's origin; only a version the user writes raises it,
  to `user`.
- `provenance`, besides: who wrote this version (`dorothy`, `user`,
  `review` or `repo`), when, when the fact was first written, with which
  model, and the conversation and turn it came from, where known.
- `retired`: present on a retired fact, with when (`at`), by whom
  (`by`) and why (`why`, one line of at most 160 characters).
- `metadata` keys beyond `type` hold a string, a number or a boolean.
- The body is at most 8,000 characters: this repository's own memory
  has a fact of 2,638. Dorothy writes lines of at most 80, but the lint
  does not require it, so a repository's own style imports.
- A link to another fact is relative, `[text](./<name>.md)`, and only
  within its scope, so an exported fact's links resolve and a project
  fact never points at a personal one.
- No control character but newline and tab, no format character
  (Unicode category Cf: zero widths, joiners, the soft hyphen,
  bidirectional controls, tags), no default ignorable code point
  (variation selectors, the Hangul filler) and neither U+2028 nor
  U+2029 appears anywhere in the file, nor in any value its YAML
  decodes, an escape included: a known way of hiding instructions in
  text a model will read. There is no allow-list, so emoji joined by
  U+200D are refused too.
- A time, `at` or `created`, is an ISO 8601 UTC timestamp as
  `Date#toISOString` writes it, `2026-10-15T09:30:00.000Z`.

The store's lint checks all of it. A file that fails is restored from
history, or kept aside in `broken/`, as transcripts and notes are.

### Frontmatter

<!-- markdownlint-disable MD038 -->

Frontmatter is YAML, and YAML coerces. Bun's parser, `Bun.YAML.parse`,
reads YAML 1.2's core schema, so `no` and timestamps stay strings, but
an unquoted `~` or `null` is null and `1e3` or `0o17` a number; a `: `
or ` #` inside a plain value ends it early; and a leading `*`, `&`, `!`,
`[`, `{`, `|` or `>` changes what follows. Every value is therefore
written in a form with one reading, and checked for its type once read.

<!-- markdownlint-enable MD038 -->

Only Dorothy's code renders frontmatter, from a fact's fields, with its
keys in a fixed order: `name`, `title`, `description`, `metadata`,
`tags`, `importance`, `provenance`, `retired`.

- **Free text** (`title`, `description` and `retired.why`) is a chomped
  folded block scalar, `>-`, its words wrapped at 80 columns and indented
  two spaces. A block scalar is always a string and needs no escaping.
  Free text is normalised before it is written: no newline, no leading
  or trailing space, and no run of spaces, since a wrapped line that
  began with a space would be read as more indented and keep its line
  break. So normalised, folding gives back exactly the text written.
- **Closed sets and patterns** (`metadata.type`, `provenance.origin`,
  `provenance.by`, `retired.by`, `name` and the tags' concept ids) are
  plain: every value the lint allows reads as the same string.
- **`importance`** is a plain integer.
- **Everything else** (times, the model, `from`, and the values of
  `metadata`'s other keys) is written with `JSON.stringify`: a string as
  a double-quoted scalar, which YAML 1.2 reads as the same string, a
  number or boolean as itself.

Read, a fact is parsed and then checked against the schema: no key
outside it but in `metadata`, and every value of the type and pattern
its key expects. A value that parsed as something else, such as a title
written `null` or `1e3` by hand or in a repository, fails rather than
being coerced back; in the store the file is restored or kept aside, and
from a repository it is not imported. So does a key a block mapping holds
twice, which YAML would settle silently by keeping the last, and a time
the calendar lacks, such as 2026-02-31.

A fact in the store that passes the check but is not in this canonical
form, after a hand edit, is rewritten in it in the commit that sweeps
the edit up. Export writes the canonical form too. Sync compares parsed
forms, so a repository file written another way registers no change,
and is rewritten only when its content changes.

### Writing

Facts are written through the module API (`writeFact`, `moveFact`,
`retireFact`, `reviveFact`) under the sidecar lock, atomically, and committed by
history. A write names its scope; there is no default, so every writer
decides where a fact belongs. `moveFact` changes a fact's scope, and is
how a fact written to the wrong one is put right.

A fact rewritten in place keeps its earlier versions in history, where
`--history` and `--restore` reach them.

The user may edit or add a fact by hand in the data directory: history
sweeps up outside changes before its next commit, and the lint heals a
broken edit. A fact the user adds or edits by hand is `origin: user`: the
sweep keeps a changed fact as Dorothy's own write only when its bytes
are ones the store noted writing (`facts/pending.ts`, in `.git/`, until
history commits them), so one left uncommitted by a crash is still hers.
The store notes the hash before replacing a fact and refuses replacement
if noting fails. A note starts a fresh line after a torn final record.
Earlier pending hashes stay until commit, in case a replacement fails.
An unreadable or malformed journal warns for facts
without matching readable records, and commits their bytes and attribution
unchanged, without making them the user's or confirmed. Other history
recording proceeds. After the entire sweep succeeds, cleanup repairs the
journal from its readable records, keeping hashes for uncommitted paths.
An interrupted sweep leaves the damaged journal for the next sweep, so
missing attribution never becomes evidence of an outside edit. Failed
cleanup warns and leaves conservative records for another attempt.
What a file says of its writer is a claim, and the sweep never trusts it:
an outside writer's canonical bytes, whatever provenance or verification
they claim, are an outside change and the user's. A broken file kept in
`broken/` keeps the user's bytes.

### Retiring

Nothing in the store deletes a fact. `retireFact` adds `retired` to its
frontmatter and leaves the file where it is, so it stays indexed,
searchable and versioned. A retired fact is never exported, so the next
sync removes it from the repository, and it ranks below every live fact;
the Layers and learning spec keeps it out of the always-present layer.
`reviveFact` removes `retired`.

`retireFacts({ from })` retires every fact whose provenance names a
conversation, for when a conversation turns out to have been wrong.

Reviews see retired facts, so that what was retired is not learnt again
as new: learning it again revives it rather than writing a second fact.
The Layers and learning spec decides how.

Erasing a fact for good, as a leaked secret needs, must reach history
and the mirror; it stays with the roadmap's candidate for forgetting a
conversation.

## Projects

### Identity

A project is a git repository. Its id is its `origin` remote, normalised:
scheme, user, port and `.git` dropped and the host lowercased, so
`git@github.com:chewygumxx/dorothy.git` is
`github.com/chewygumxx/dorothy`. A repository without `origin` is
`local-` and the first 12 hex digits of the SHA-256 of its root's real
path. Every checkout of one remote is one project; its facts live under
`facts/projects/<id>/`.

### The registry

`projects.json` holds each known project:

```json
{
  "v": 1,
  "projects": {
    "github.com/chewygumxx/dorothy": {
      "name": "dorothy",
      "roots": ["/home/chewygumxx/dev/dorothy"],
      "memoryDir": ".agents/memory",
      "synced": {
        "/home/chewygumxx/dev/dorothy": {
          "last": ".agents/memory",
          "dirs": {
            ".agents/memory": {
              "dorothy-ambition": "sha256 of the form both sides last held"
            }
          }
        }
      }
    }
  }
}
```

A project is registered the first time it is synced, with the root it
was synced from; later roots are added as they are seen. `memoryDir` is
the repository's memory directory: `.agents/memory` if it exists, else
`.claude/memory` if that does, else `.agents/memory`. The user may edit
it.
`synced` is kept by root, so two checkouts of one remote each compare
against what they last synced and never undo one another, and within a
root by memory directory, in `dirs`, with `last` the directory the root
synced last. A sync reads and writes only the record of its root and
the current `memoryDir`. With none, after the user edits `memoryDir`,
its next sync is its first with that directory, adopting and exporting,
and retires nothing. The records of other directories are kept as they
are, so a root switched to another directory and back compares against
what it last held there: the store's changes made meanwhile are
exported, and a file edited there meanwhile is a conflict. Like the
records of roots no longer used, they are never pruned. A memory
directory absent from disk keeps its record only if it is `last`: so
the directory last synced, deleted whole, retires every fact as any
deletion does, while one moved away since, its record older, is a
first sync again.

## Sync

`syncProject(root)` reconciles a project's facts with its repository's
memory directory, under the sidecar lock. For each name in the store's
live facts, the repository's files and this root's `synced` map, a
retired fact counting as absent from the store:

| Store (exported form)  | Repository             | Then                                       |
| ---------------------- | ---------------------- | ------------------------------------------ |
| equal to the repo's    | equal to the store's   | record the hash; nothing else              |
| changed since sync     | unchanged since sync   | export: write, or remove if retired        |
| unchanged since sync   | changed since sync     | import: the repo's version, `by: repo`     |
| changed since sync     | changed since sync     | conflict: import the repo's, and notice it |
| absent, never synced   | present                | import: adopt the repository's fact        |
| present, never synced  | absent                 | export                                     |

"Changed since sync" compares a side's hash with the recorded one. A
hash is of the normalised form, the parsed fields and body, not the
bytes, so a repository that formats frontmatter its own way, or a client
that rewrites it, does not register as a change. The first sync of a
project with existing memory adopts it whole. A fact deleted in the
repository is retired in the store, `by: repo`; a retired fact the
repository changes is imported and revived. An imported fact is
`origin: repo`.

The exported form keeps `name`, `description` and `metadata`, and the
body; title, tags, importance and provenance stay in the store. Export
also regenerates the directory's `MEMORY.md`: one list item per live
fact, `[title](./<name>.md)`, its description on the next line wrapped
to 80 columns, in the order the facts were created. Claude Code loads
only the first 200 lines or 25 KB of `MEMORY.md` and drops the rest
silently, so the index stays within both: if the facts would not fit,
it lists them by importance, then recency, up to the limit, and sync
warns of how many it left out. Their files are exported all the same.
On import, a fact's title comes from its `MEMORY.md` entry if there is
one, else the store's title for it, else its name. An entry is read in
sync's form or Claude Code's, `- [title](name.md)` with or without `./`
and with its hook after the link on the same line, under `-` or `*`.

Sync rewrites `MEMORY.md` only when it is absent or every line is one
sync writes, an entry or its description beneath it, indented two
spaces and no list item, with no blank line between; a heading, prose,
a nested list or a paragraph after a blank line means a hand kept it,
and it is left, the report saying why. A description that would wrap
onto a list marker has the marker escaped, `\-` or `1\.`, so that it
reads as text. It is left too when a skipped file is one it links, or when
no fact is live and the index lists anything the store holds no fact for;
else the last fact's retirement empties it. An entry whose fact's
description is the same on both sides and in the store as before the sync
keeps its hook lines, where a hand may have written them; one whose
description changed is written afresh. It is written only once it is
found as it was first read, as a fact's file is.

A file's stem names its fact: `feedback_testing.md` is `feedback-testing`
(underscores are hyphens), for Claude Code's auto-memory writes snake
case. Its frontmatter `name` may be either. The file keeps its name: an
export or removal goes to it, `MEMORY.md` links it, and the report names
the fact it became. A file named as the fact beats a snake-case twin of
it, which is skipped and named. Any other stem a fact's name refuses is
skipped and named, as before.

A fact retired in the store has the form removed from the repository
recorded in its `synced` row, `removed:<hash>`: the file reappearing as
it was is removed again, rather than reviving the fact, but one the
repository changed is its version. An import keeps what only the store
holds, tags, importance, creation, foreign keys and other sources; a
verification goes with the words it confirmed, as with any write but the
user's.

Export writes atomically, only inside `<root>/<memoryDir>`, and refuses
a memory directory that resolves outside the root or through a symlink.
It never commits: the files are committed with the work. Each sync that
changes the store is one history commit, `sync: <project>: <n> in, <m>
out`.

When sync runs is the Bodies spec's to settle; this spec gives it a
command.

## Writers in parallel

Chat, several Claude Code sessions and a background review may write at
once. Every write of a sidecar, a fact or `projects.json`, and every
sync, takes the sidecar lock: the recall
index's `exclusiveLock`, or history's `FileLock` without an index, as
today. A transcript has one writer, the session that owns it. History
commits a change inside the lock it was written under, as today.

## The recall index

The index stays derived. `conversations` gains `source` and `project`,
from each transcript's first session event. A `facts` table holds each
fact's scope, name, title, description, type, body, origin,
importance, creation time and whether it is retired, with `facts_fts`
over title, description and body, and `fact_tags` its concepts. Retired
facts are indexed like the rest. Sync reads `facts/` as it reads
`transcripts/`. A change of schema rebuilds the index from the files.

Which tools search facts, and how, is the Bodies spec's.

## History and the mirror

The lint gains facts and `projects.json`. Everything under `facts/` and
`projects.json` are committed and sealed like the
rest; the mirror carries personal and project facts alike, encrypted.

## Migration

None is written. A transcript without `source` is chat's; a sidecar is
unchanged; `facts/` and `projects.json` start absent and are created by
their first write. The index rebuilds for its new schema. The first
`dorothy --sync` in this repository adopts `.agents/memory/` into the
store.

## Commands

- `dorothy --facts`: lists facts, by scope, with type, name, title and
  description, as `--list` lists conversations; a retired fact's row
  says so.
- `dorothy --retire <scope>/<name>` and `dorothy --revive
  <scope>/<name>`: retire or revive a fact, where scope is `personal` or
  a project id, so `personal/likes-tea` or
  `github.com/chewygumxx/dorothy/dorothy-ambition`.
- `dorothy --retire --from <phrase>`: retires every fact that came from
  a conversation.
- `dorothy --sync [<path>]`: syncs the project at the path, by default
  the working directory, and prints what moved and any conflict.
- `dorothy --projects`: lists the registered projects, their roots and
  memory directories.

Each takes no other arguments and runs with or without a terminal.
`--restore` is history's, so reviving is `--revive`.

## Modules

All in `@dorothy/memory`, which still depends on `core` alone:

- `transcript.ts`: the session event's new fields and the tool event;
  `scrub.ts` replaces the shapes of secrets in a tool call's text.
- `facts/`: `file.ts` parses and renders a fact; `store.ts` has
  `writeFact`, `moveFact`, `retireFact`, `retireFacts`, `reviveFact` and
  `listFacts`; `history/lint.ts` checks a fact.
- `projects/`: `identify.ts` finds a path's repository root and id;
  `registry.ts` reads and writes `projects.json`; `sync.ts` has
  `syncProject`; `export.ts` renders a fact and `MEMORY.md` in their
  exported forms.
- `recall/`: the new columns and tables, and syncing `facts/`.
- `history/lint.ts`: the new file kinds.
- `commands.ts`: the commands; `cli` parses and dispatches them.

`packages/memory/AGENTS.md` and `packages/cli/AGENTS.md` change in the
same branch.

## Failures

- **Not a git repository**: `--sync` says so and exits 1; a session
  outside one records no project.
- **A repository file that fails the lint**: not imported; sync warns
  and leaves it, and its row in `synced` unchanged. So does a directory
  or other non-file called like a fact.
- **A memory directory it cannot write**: sync warns, exports nothing
  for that project, and imports what it can read.
- **A `name` that is not its file's stem**, after a hand edit or in a
  repository: the lint fails it; in the store it is restored or kept
  aside, in a repository it is not imported.
- **A repository fact over the caps**: not imported, with a warning.
- **The lock held**: writes wait for it, as sidecar writes do today.

## Security

- Personal facts and every transcript stay in the data directory, mode
  0700, and the sealed mirror; export reads only `facts/projects/<id>/`.
- Export stays inside the repository's memory directory, never follows
  a symlink out, and never commits or pushes.
- Origin is structural. It is set by the code that writes a fact, from
  where the content came from, and no fact's text can change it. The
  Layers and learning spec keeps `external` facts out of the
  always-present layer, reachable only by search, and renders every
  fact, an imported one above all, as background, never instruction, as
  the memory block's preamble already says of notes.
- The lint refuses invisible and control characters, and its caps keep
  a repository from flooding the store.
- Tool events are scrubbed of the shapes of secrets before they are
  written. A secret with no recognisable shape is not caught; tool
  events are still never indexed or exported, and the mirror is
  sealed.

## Testing

Every root, repository, key and environment is passed in, as the working
rules require; nothing touches the user's data.

- **Frontmatter**: render then parse gives back every field, in a
  property test over text with quotes, colons, `#`, leading YAML
  indicators, the words `null`, `~`, `no`, `1e3` and `0o17`, runs of
  spaces, and non-ASCII; each trap written by hand fails the check; a
  hand edit that passes is rewritten canonically.
- **Facts**: parse and render round-trip; the lint's cases, one by one,
  invisible characters and a missing origin among them; write, move,
  retire, retire by conversation and revive, with their commits; origin
  lowered by a later writer and raised only by the user; retired facts
  still searchable.
- **Projects**: remote normalisation across URL forms; the local id;
  the memory directory's choice.
- **Sync**: one test per row of the table, in fixture repositories,
  plus first sync adopting, `MEMORY.md` regenerated and held within 200
  lines and 25 KB, a retirement in the store and a deletion in the
  repository, path containment and symlinks refused, and a property test
  that no personal fact is ever written into a repository.
- **Transcripts**: tool events scrubbed, trimmed and counted, marked
  when they are memory's own, linted, and left out of the index;
  sessions without `source` read as chat's; consecutive assistant events
  through compaction, reviews and recall.
- **Parallel writers**: two processes writing facts and syncing at once,
  each change committed once.
- **Index**: rebuilt for the new schema; facts searchable by their
  text.
- **Commands**: parsing, output, and exit codes.

## Known risks

- **Repository wins.** A conflict reverts the store's change in the
  store, though history keeps it; a notice that goes unread loses it
  from view.
- **`MEMORY.md` is regenerated.** An index sync wrote is rewritten at
  every export; one with a hand's lines in it is left alone.
- **A stale checkout.** The first sync from an old clone of a remote
  finds the repository's facts changed since the store's record and takes
  them as a conflict; the store's newer version survives only in history.
- **Consecutive assistant events** may meet code that assumed turns
  alternate; the plan checks before the Bodies spec relies on it.
- **Retired facts accumulate.** They cost search a little noise and
  nothing else; ranking keeps them below live facts.
- **The scrub is by shape.** It misses a password with no telling key
  beside it.
- **One remote, one project.** Forks with different remotes are
  different projects; a repository whose `origin` changes becomes a new
  one until the user edits `projects.json`.

## Later

- **Bodies**: recording Claude Code's sessions, from its hooks and
  transcripts or from the gateway; the recall server's search over facts
  and a `remember` tool; delivering memory into Claude Code; when sync
  runs; keeping Claude Code's auto-memory from writing beside the store.
- **Layers and learning**: the always-present section and its budget,
  progressive disclosure, ranking by relevance, recency, use and
  importance, keeping `external` facts out of the layer, reviews that
  write, correct and retire facts, and how a retired fact is revived
  rather than learnt again.
- A `--fact` editor like `--memory`, should hand edits in the data
  directory prove awkward.

## Out of scope

- Embeddings and links between entries (Relations and Embeddings).
- Model choice for reviews (Model Providers).
- Expiry: no fact lapses on a date. A fact fades by ranking and leaves
  the always-present layer by retiring.
- Erasing a fact or a conversation for good, through history and the
  mirror (the roadmap's candidate).
- Sharing personal memory across users or machines other than through
  the mirror.
