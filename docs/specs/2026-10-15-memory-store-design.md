---
ctime: 2026-10-15
mtime: 2026-10-15
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
| Authored (new)      | forgotten facts' tombstones                     | `facts/forgotten.json`                       |
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

`input` and `output` are text, each trimmed to its first 2,000
characters; `cut` counts the characters dropped. Tool events are not
turns: turns stay the user and assistant events, numbered as today, and
tool events sit between them. The store accepts consecutive assistant
events, as an agent writes text between tool calls; the plan checks that
compaction, reviews and recall tolerate them. How a body's session maps
onto events is the Bodies spec's to settle.

The lint accepts tool events, and recall does not index their text:
tool output is noise to search and the likeliest place for a secret.

## Facts

### The file

```markdown
---
name: dorothy-ambition
title: Dorothy's ambition
description: One adaptable Dorothy, extensible and remembering
metadata:
  type: project
tags:
  - k1a2b3c4d
provenance:
  by: dorothy
  at: 2026-10-15T09:30:00.000Z
  created: 2026-10-15T09:30:00.000Z
  model: claude-opus-5-5
  from: bingo-overabundance-mazer-kasha#12
---

The fact itself, in Markdown.
```

- `name`: kebab-case, at most 64 characters, and the file's stem, so
  unique within its scope.
- `title`: at most 60 characters; `description`: one line of at most
  160, as a conversation's notes are limited.
- `metadata.type`: `user`, `feedback`, `project` or `reference`. Other
  `metadata` keys, such as those Claude Code's auto-memory adds, are
  kept as they are.
- `tags`: concept ids from `tags.json`, optional.
- `provenance`: who wrote this version (`dorothy`, `user`, `review` or
  `repo`), when, when the fact was first written, with which model, and
  the conversation and turn it came from, where known.
- The body is at most 2,000 characters. Dorothy writes lines of at
  most 80, but the lint does not require it, so a repository's own
  style imports.
- A link to another fact is relative, `[text](./<name>.md)`, and only
  within its scope, so an exported fact's links resolve and a project
  fact never points at a personal one.

The store's lint checks all of it. A file that fails is restored from
history, or kept aside in `broken/`, as transcripts and notes are.

### Writing

Facts are written through the module API (`writeFact`, `moveFact`,
`forgetFact`) under the sidecar lock, atomically, and committed by
history. A write names its scope; there is no default, so every writer
decides where a fact belongs. `moveFact` changes a fact's scope, and is
how a fact written to the wrong one is put right.

The user may edit or add a fact by hand in the data directory: history
sweeps up outside changes before its next commit, and the lint heals a
broken edit.

### Forgetting

`forgetFact` deletes the file and adds a tombstone to
`facts/forgotten.json`: the scope, name, title and description, when and
by whom. Reviews consult the tombstones so that what was forgotten is
not learnt again; the Layers and learning spec decides how. History
keeps the file's last version.

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
        "dorothy-ambition": "sha256 of the form both sides last held"
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

## Sync

`syncProject(root)` reconciles a project's facts with its repository's
memory directory, under the sidecar lock. For each name in the store's
facts, the repository's files and the registry's `synced` map:

| Store (exported form)  | Repository             | Then                                       |
| ---------------------- | ---------------------- | ------------------------------------------ |
| equal to the repo's    | equal to the store's   | record the hash; nothing else              |
| changed since sync     | unchanged since sync   | export: write, or delete if forgotten      |
| unchanged since sync   | changed since sync     | import: the repo's version, `by: repo`     |
| changed since sync     | changed since sync     | conflict: import the repo's, and notice it |
| absent, never synced   | present                | import: adopt the repository's fact        |
| present, never synced  | absent                 | export                                     |

"Changed since sync" compares a side's hash with the recorded one. A
hash is of the normalised form, the parsed fields and body, not the
bytes, so a repository that formats frontmatter its own way, or a client
that rewrites it, does not register as a change. The first sync of a
project with existing memory adopts it whole. A
fact deleted in the repository is forgotten in the store, `by: repo`.

The exported form keeps `name`, `description` and `metadata`, and the
body; title, tags and provenance stay in the store. Export also
regenerates the directory's `MEMORY.md`: one list item per fact,
`[title](./<name>.md)`, its description on the next line wrapped to 80
columns, in the order the facts were created. On import, a fact's title
comes from its `MEMORY.md` entry if there is one, else its name.

Export writes atomically, only inside `<root>/<memoryDir>`, and refuses
a memory directory that resolves outside the root or through a symlink.
It never commits: the files are committed with the work. Each sync that
changes the store is one history commit, `sync: <project>: <n> in, <m>
out`.

When sync runs is the Bodies spec's to settle; this spec gives it a
command.

## Writers in parallel

Chat, several Claude Code sessions and a background review may write at
once. Every write of a sidecar, a fact, `forgotten.json` or
`projects.json`, and every sync, takes the sidecar lock: the recall
index's `exclusiveLock`, or history's `FileLock` without an index, as
today. A transcript has one writer, the session that owns it. History
commits a change inside the lock it was written under, as today.

## The recall index

The index stays derived. `conversations` gains `source` and `project`,
from each transcript's first session event. A `facts` table holds each
fact's scope, name, title, description, type, body and creation time,
with `facts_fts` over title, description and body, and `fact_tags` its
concepts. Sync reads `facts/` as it reads `transcripts/`. A change of
schema rebuilds the index from the files.

Which tools search facts, and how, is the Bodies spec's.

## History and the mirror

The lint gains facts, `forgotten.json` and `projects.json`. Everything
under `facts/` and both JSON files are committed and sealed like the
rest; the mirror carries personal and project facts alike, encrypted.

## Migration

None is written. A transcript without `source` is chat's; a sidecar is
unchanged; `facts/` and `projects.json` start absent and are created by
their first write. The index rebuilds for its new schema. The first
`dorothy --sync` in this repository adopts `.agents/memory/` into the
store.

## Commands

- `dorothy --facts`: lists facts, by scope, with type, name, title and
  description, as `--list` lists conversations.
- `dorothy --forget <scope>/<name>`: forgets a fact, where scope is
  `personal` or a project id, so `personal/likes-tea` or
  `github.com/chewygumxx/dorothy/dorothy-ambition`.
- `dorothy --sync [<path>]`: syncs the project at the path, by default
  the working directory, and prints what moved and any conflict.
- `dorothy --projects`: lists the registered projects, their roots and
  memory directories.

Each takes no other arguments and runs with or without a terminal.

## Modules

All in `@dorothy/memory`, which still depends on `core` alone:

- `transcript.ts`: the session event's new fields and the tool event.
- `facts/`: `file.ts` parses and renders a fact; `store.ts` has
  `writeFact`, `moveFact`, `forgetFact` and `listFacts`; `lint.ts` checks
  a fact and `forgotten.json`.
- `projects/`: `identify.ts` finds a path's repository root and id;
  `registry.ts` reads and writes `projects.json`; `sync.ts` has
  `syncProject`; `export.ts` renders a fact and `MEMORY.md` in their
  exported forms.
- `recall/`: the new columns and tables, and syncing `facts/`.
- `history/lint.ts`: the new file kinds.
- `commands.ts`: the four commands; `cli` parses and dispatches them.

`packages/memory/AGENTS.md` and `packages/cli/AGENTS.md` change in the
same branch.

## Failures

- **Not a git repository**: `--sync` says so and exits 1; a session
  outside one records no project.
- **A repository file that fails the lint**: not imported; sync warns
  and leaves it, and its row in `synced` unchanged.
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
- An imported fact is a contributor's text that will reach a model. It
  is background, never instruction, as the memory block's preamble
  already says of notes; the Layers and learning spec renders it so.
- The lint's caps keep a repository from flooding the store.

## Testing

Every root, repository, key and environment is passed in, as the working
rules require; nothing touches the user's data.

- **Facts**: parse and render round-trip; the lint's cases, one by one;
  write, move and forget, with their commits and tombstones.
- **Projects**: remote normalisation across URL forms; the local id;
  the memory directory's choice.
- **Sync**: one test per row of the table, in fixture repositories,
  plus first sync adopting, `MEMORY.md` regenerated, a deletion on each
  side, path containment and symlinks refused, and a property test that
  no personal fact is ever written into a repository.
- **Transcripts**: tool events trimmed and counted, linted, and left out
  of the index; sessions without `source` read as chat's; consecutive
  assistant events through compaction, reviews and recall.
- **Parallel writers**: two processes writing facts and syncing at once,
  each change committed once.
- **Index**: rebuilt for the new schema; facts searchable by their
  text.
- **Commands**: parsing, output, and exit codes.

## Known risks

- **Repository wins.** A conflict reverts the store's change in the
  store, though history keeps it; a notice that goes unread loses it
  from view.
- **`MEMORY.md` is regenerated.** Hand edits to the index are lost at
  the next export; edits to the facts themselves are not.
- **Consecutive assistant events** may meet code that assumed turns
  alternate; the plan checks before the Bodies spec relies on it.
- **One remote, one project.** Forks with different remotes are
  different projects; a repository whose `origin` changes becomes a new
  one until the user edits `projects.json`.

## Later

- **Bodies**: recording Claude Code's sessions, from its hooks and
  transcripts or from the gateway; the recall server's search over facts
  and a `remember` tool; delivering memory into Claude Code; when sync
  runs; keeping Claude Code's auto-memory from writing beside the store.
- **Layers and learning**: the always-present section and its budget,
  progressive disclosure, reviews that write and correct facts, and the
  tombstones' use.
- A `--fact` editor like `--memory`, should hand edits in the data
  directory prove awkward.

## Out of scope

- Embeddings and links between entries (Relations and Embeddings).
- Model choice for reviews (Model Providers).
- Sharing personal memory across users or machines other than through
  the mirror.
