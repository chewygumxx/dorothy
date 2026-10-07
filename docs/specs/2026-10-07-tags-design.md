---
ctime: 2026-10-07
mtime: 2026-10-07
spdx: GPL-3.0-only
title: Tags design
description: "Design spec for Dorothy's tag vocabulary and shallow tagging"
tags:
  - dorothy
  - memory
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-07-tags-design.md
   -
   -->

# Tags design

## Purpose

Dorothy's notes say what each conversation was about, and recall finds a
conversation by its words. Neither says what her conversations have in
common. Tags give her a vocabulary of topics: concepts with a preferred
label, alternative labels, broader and narrower concepts and a scope note,
after SKOS. She tags each conversation in her idle review, coining a concept
only when none fits, and she browses and searches by tag through recall.

The model, in the user's words from the memory note
(`docs/notes/2026-10-04_dorothy-conversation-memory-metadata.md`):

- Dates are never in context. Tags are in context per frecency and are
  hierarchically organised, mostly for the user's own organisation, but they
  can also serve progressive disclosure.
- A tag has metadata of its own besides its parents and children and the
  dates and conversations associated with it. Its name should be within 12
  characters, 50 at most, and descriptive on its own, and it has a
  description.
- Shallow tagging happens when a conversation concludes. Deep tagging and
  topic documents are cyclical maintenance, by background agents.

Success:

- Dorothy tags her conversations herself, reusing concepts rather than
  coining near-duplicates.
- Asked what topics she knows, she lists them from the vocabulary, most
  salient first, and finds a topic's conversations by tag.
- The user sees the hierarchy (`dorothy --tags`) and corrects any concept
  (`dorothy --edit-tags`) or any conversation's tags (`dorothy --memory`);
  a correction is never overwritten by her, and a deleted concept stays
  deleted.
- No tag reaches the memory block, and hiding a conversation stays
  undetectable.

This spec targets main as of `60e1688`, which includes compaction
(`docs/specs/2026-10-07-compaction-design.md`).

## Sub-projects

This is the catalogue spec's third sub-project
(`docs/specs/2026-10-05-conversation-catalogue-design.md`). Cyclical
maintenance follows: deep tagging, Dorothy revising and pruning concepts,
and topic overviews. Relations and embeddings come last, and only if recall
shows FTS falling short.

## Decisions

- **On demand, never pushed.** Tags reach Dorothy through recall's tools
  only: in search and open results, as a search filter, and through a new
  `tags` tool that lists the vocabulary by frecency. The memory block is
  unchanged and still holds no tags.
- **Dorothy coins freely.** In her review she sees the vocabulary, reuses a
  concept where one fits, and coins one only when none does. She never
  edits an existing concept; that is cyclical maintenance.
- **Corrections are the user's.** The user renames, describes, re-parents,
  merges and deletes concepts, and sets a conversation's tags. An edited
  concept is the user's; a deleted one leaves a tombstone holding its
  labels, so she cannot coin them again.
- **The vocabulary is its own document; assignments are judgements.**
  `tags.json` holds the concepts and nothing about conversations. A
  conversation's tags sit in its sidecar with her notes. The index derives
  the rest: which conversations carry a concept, their dates, and the
  concept's frecency.
- **A polyhierarchy.** A concept may have several broader concepts, as long
  as they form no cycle. `narrower` is derived from `broader` and never
  stored, so the two cannot disagree.
- **Shallow tagging is part of the idle review.** The note's "conclusion"
  has no event in a TUI that may be quit at any time; the idle review is the
  closest thing to one, and it costs no extra request. Her tags follow the
  conversation as it moves on.
- **A bad tag never fails a review.** Her notes are worth more than her
  tags; whatever does not check out is dropped and the notes are written.
- **Labels, never ids, reach the model.** She names concepts by label and
  the code resolves them, so an invented id is impossible: a label either
  resolves or is dropped.

## State

| Class               | What                                                | Where                                   |
| ------------------- | --------------------------------------------------- | --------------------------------------- |
| Canonical           | transcripts                                         | `transcripts/<phrase>.jsonl`            |
| Generated, authored | concepts and tombstones                             | `tags.json`                             |
| Generated, authored | notes, tags, pins, hidden, appraisals, clusters     | `transcripts/<phrase>.meta.json`        |
| Derived             | carriers, concept dates, frecency, `narrower`, FTS  | `$XDG_CACHE_HOME/dorothy/recall.sqlite` |

`tags.json` sits in the data directory (`$XDG_DATA_HOME/dorothy/`, beside
`transcripts/`), mode 0600. Like the notes it is generated and authored,
never derived: regenerating it would be costly and nondeterministic, and the
user's edits could not be regenerated at all.

## The vocabulary

### The document

```json
{
  "v": 1,
  "rev": 4,
  "concepts": {
    "k3f9a2c1": {
      "prefLabel": "memory",
      "altLabel": ["recall", "remembering"],
      "broader": ["k0b7e512"],
      "scopeNote": "How Dorothy keeps and finds what was said before.",
      "by": "dorothy",
      "at": "2026-10-07T12:00:00.000Z",
      "model": "claude-opus-5-5",
      "edited": null
    },
    "k77d0e4a": {
      "deleted": "2026-10-08T09:30:00.000Z",
      "labels": ["misc", "other"]
    },
    "k1c2d3e4": {
      "mergedInto": "k3f9a2c1",
      "at": "2026-10-08T09:30:00.000Z"
    }
  }
}
```

- **An id** is `k` and 8 lowercase hexadecimal digits from 4 random bytes,
  drawn again on a collision. It never changes, so a rename touches only
  this file.
- **`rev`** counts writes, as a sidecar's does. Writes are atomic (a
  temporary file renamed into place) and made under the index's write lock,
  the one sidecars use.
- **`by`** is `dorothy` or `user`; `model` is present when she coined it.
  **`edited`** is when the user last changed it, or `null`.

### Concepts

- **`prefLabel`** is required, at most 50 code points; her instructions ask
  for 12 or fewer.
- **`altLabel`** holds at most 5 labels of at most 50 code points each.
- **`scopeNote`** is required, at most 160 code points, like a description.
- **`broader`** holds the ids of live concepts. Following `broader` from any
  concept never returns to it.
- **Labels** are normalised as notes are (control characters to spaces,
  runs of whitespace to one, trimmed) and may not contain `;`, which
  separates lists in the views. Two labels are the same when their
  lower-cased normal forms are equal.
- **Labels are unique.** No label, preferred or alternative, belongs to two
  live concepts, or to a live concept and a deleted one. A label therefore
  resolves to at most one live concept.

### Tombstones

- **Deleted.** `{ "deleted": at, "labels": [...] }` keeps the concept's
  labels, preferred and alternative, so neither she nor a review can coin
  them again. When the user gives one of them to a live concept, it is
  removed from the tombstone; a tombstone left with no labels is removed.
  Deleting a concept removes the merge tombstones pointing at it, and the
  `broader` entries naming it.
- **Merged.** `{ "mergedInto": id, "at": at }` names the live concept it was
  folded into. Merging into a concept that others were merged into is
  allowed; merging a concept rewrites every tombstone pointing at it to its
  survivor, so `mergedInto` always names a live concept and is followed
  once.
- Tombstones are never shown to Dorothy and are listed nowhere.

### Reading

`readVocabulary` returns the vocabulary, `none` for a missing file (an
empty vocabulary), or `unparseable` with a reason, as `readSidecar` does.
A file is unparseable when it is not JSON, its `v` is not 1, or it breaks a
rule above: a missing or over-long field, a duplicate label, a `broader`
naming no live concept, a cycle, or a `mergedInto` naming no live concept.
Normalising a label or note is not an error; it is applied as the file is
read.

## A conversation's tags

The sidecar gains, with `v` still 1:

```json
{
  "tags": ["k3f9a2c1", "k5a6b7c8"],
  "fields": {
    "tags": {
      "by": "dorothy",
      "at": "2026-10-07T12:00:00.000Z",
      "model": "claude-opus-5-5",
      "throughTurn": 12
    }
  }
}
```

- **`tags`** holds at most 5 ids, most important first, without
  duplicates. A sidecar without `tags` reads as `[]`; one without
  `fields.tags` has never been tagged.
- **`fields.tags`** is a provenance entry, as for a note. `by: "user"` makes
  the set fixed: reviews keep it as it is. Emptying it in `--memory` hands it
  back.
- **Resolving.** An id resolves to its live concept, or through a merge
  tombstone to the survivor. An id that resolves to nothing (deleted or
  unknown) is ignored on read and dropped at the next write of the sidecar,
  but only when the vocabulary was read successfully: while `tags.json` is
  unparseable, sidecar writes keep `tags` exactly as they are, or one broken
  file would strip every conversation of its tags.

## Tagging in the review

The review that writes Dorothy's notes and appraises her reads also tags
the conversation.

### What she sees

The review message gains the vocabulary after the notes, and the notes gain
the conversation's tags:

```xml
<notes>
<title>Memory and metadata</title>
...
<tags fixed="true">memory; tui</tags>
</notes>

The concepts you tag with:
<vocabulary>
<concept label="dorothy">The assistant herself: her persona and how she works.</concept>
<concept label="memory" alt="recall; remembering" broader="dorothy">How Dorothy keeps and finds what was said before.</concept>
</vocabulary>
```

- `<tags/>` stands for none; `fixed="true"` marks the user's set.
- The vocabulary is every live concept in label order, except those carried
  only by hidden conversations (see Hidden conversations). It is read from
  the index, synced first. `alt` and `broader` are absent when empty;
  `broader` gives preferred labels. Everything is escaped as the rest of the
  message is.
- An empty vocabulary is `<vocabulary/>`.

### The instruction

`TAGS_INSTRUCTION` joins the review instructions:

> Give up to 5 tags for the conversation's main subjects, most important
> first, using a concept's label, or one of its alternatives, wherever one
> fits. Only when none fits, coin a concept: a label of ideally 12
> characters and at most 50, descriptive on its own, with a sentence of at
> most 160 characters saying what it covers, and the labels of any broader
> concepts. Coin at most 3. Tags marked fixed were set by the user: return
> them exactly as they are and coin nothing.

### What she returns

The schema gains two required properties:

```json
{
  "tags": {
    "type": "array",
    "maxItems": 5,
    "items": { "type": "string", "minLength": 1, "maxLength": 50 }
  },
  "coined": {
    "type": "array",
    "maxItems": 3,
    "items": {
      "type": "object",
      "properties": {
        "prefLabel": { "type": "string", "minLength": 1, "maxLength": 50 },
        "altLabel": {
          "type": "array",
          "maxItems": 5,
          "items": { "type": "string", "minLength": 1, "maxLength": 50 }
        },
        "broader": {
          "type": "array",
          "items": { "type": "string", "minLength": 1, "maxLength": 50 }
        },
        "scopeNote": { "type": "string", "minLength": 1, "maxLength": 160 }
      },
      "required": ["prefLabel", "scopeNote"],
      "additionalProperties": false
    }
  }
}
```

While `tags.json` is unparseable the review uses the schema, message and
instructions without tags, and leaves the sidecar's tags alone.

### Checking her output

Each label is unescaped and normalised. Then, in order:

1. **Fixed tags.** If `fields.tags.by` is `user`, `tags` and `coined` are
   ignored and nothing below applies.
2. **Coined concepts.** One whose preferred label already belongs to a live
   concept, as its preferred or an alternative label, becomes that concept:
   a reuse, not a coin. One whose preferred label belongs to a tombstone,
   or contains `;`, or breaks a limit, is dropped. An alternative label
   that does so, or names another concept, is dropped from the coin, which
   is kept. Two coined concepts with the same label become one, the first.
3. **Broader.** A `broader` label that resolves neither to a live concept
   nor to one she coined is dropped. Edges among her coined concepts are
   added in order, and one that would close a cycle is dropped.
4. **Tags.** Each label resolves by preferred or alternative label to a
   live concept or one she coined, or is dropped. Duplicates collapse to
   the first; a coined concept no tag names is still coined.

Whatever is dropped is logged at debug level, never shown, and never counts
towards the review's `failures`.

### Writing

Under one acquisition of the index's write lock:

1. Read `tags.json` again and repeat steps 2 to 4 against it, since another
   TUI may have coined the same label since the review began; a concept
   coined there in the meantime becomes a reuse here.
2. Write `tags.json`, if anything is still coined: `by: "dorothy"`, `at`,
   `model`, `edited: null`.
3. Update the sidecar with the notes, appraisals and tags, `fields.tags`
   recording `by`, `at`, `model` and `throughTurn` as a note's does.

A crash between the two writes leaves at worst an unused concept.

### Which conversations are stale

Catch-up also counts as stale a conversation with notes but no
`fields.tags`, so conversations reviewed before tags existed are tagged one
review each, once. While `tags.json` is unparseable this rule is off, so a
broken file cannot cause a review at every launch.

## The index

The schema version goes up, so an existing index is deleted and rebuilt.

```sql
CREATE TABLE vocabulary (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mtime INTEGER,             -- tags.json mtime last read; NULL: none
    broken TEXT                -- the reason it is unparseable; NULL: fine
);
CREATE TABLE concepts (
    id TEXT PRIMARY KEY, label TEXT NOT NULL,
    alt TEXT NOT NULL,         -- JSON array
    scope_note TEXT NOT NULL
);
CREATE TABLE labels (norm TEXT PRIMARY KEY, id TEXT NOT NULL);
CREATE TABLE broader (
    id TEXT NOT NULL, parent TEXT NOT NULL, PRIMARY KEY (id, parent)
);
CREATE TABLE merged (id TEXT PRIMARY KEY, into_id TEXT NOT NULL);
CREATE TABLE tagged (
    phrase TEXT NOT NULL, n INTEGER NOT NULL,  -- n: 0 is most important
    id TEXT NOT NULL, PRIMARY KEY (phrase, id)
);
```

- **Sync** re-reads `tags.json` when its mtime differs from the one
  recorded, replacing `concepts`, `labels`, `broader` and `merged`
  wholesale. An unparseable file empties them and records why; a missing
  one empties them with no reason.
- **`tagged`** holds a sidecar's ids as written, replaced when the sidecar
  is re-read. Queries resolve them through `merged` and join `concepts`, so
  a vocabulary change needs no sidecar re-read.
- **A concept's carriers** are the conversations carrying it or anything
  narrower, found with a recursive CTE over `broader`. `UNION` keeps the
  walk finite through diamonds.
- **A concept's frecency** is the summed `salience()` of its visible
  carriers: neither hidden nor the conversation passed as `--exclude`.

## The tools

### `search`

```text
search(query?: string, tags?: string[], after?: string, before?: string,
       limit?: number)
```

- **At least one of `query` and `tags`** is required; neither is a tool
  error.
- **`tags`** holds at most 5 labels, each resolved by preferred or
  alternative label. A result carries every one of them, or something
  narrower. An unknown label is a tool error, "No tag by that name: x." With
  `query` too, the terms match as before within those conversations.
- **With tags and no query,** hits are ordered by salience, their `matches`
  are empty, and `after` and `before` bound the conversation's activity as
  for a notes match.
- **Every result gains `keywords`**, the preferred labels of the concepts
  the conversation carries itself, in its order. It is absent when there are
  none.
- While the vocabulary is unparseable, `tags` is a tool error, "Tags are
  unavailable at the moment.", and results have no `keywords`.

### `open`

Its result gains `keywords`, as `search`'s results do.

### `tags`

```text
tags(under?: string, limit?: number)
```

```json
{
  "results": [
    {
      "@type": "DefinedTerm",
      "name": "memory",
      "alternateName": ["recall", "remembering"],
      "description": "How Dorothy keeps and finds what was said before.",
      "broader": ["dorothy"],
      "narrower": ["compaction", "tagging"],
      "conversations": 7,
      "dateCreated": "2026-10-04",
      "dateModified": "2026-10-07"
    }
  ],
  "more": 12
}
```

- **Concepts by frecency,** highest first, ties by label. `limit` defaults
  to 20 and is clamped to 1 to 50; `more` counts the rest.
- **`under`** limits the list to the concepts strictly beneath one concept,
  named by preferred or alternative label. An unknown label is the same tool
  error as `search`'s.
- **`conversations`** counts the visible carriers. **`dateCreated` and
  `dateModified`** are the local dates of their earliest `first_at` and
  latest `last_at`, absent when there are none.
- **`broader` and `narrower`** are direct neighbours, by preferred label,
  only those that are listed. `alternateName`, `broader` and `narrower` are
  absent when empty.
- While the vocabulary is unparseable, the tool error is the one `search`
  gives.
- The server registers `tags` always. Its description carries the guidance:
  to see what topics her conversations cover, when her notes and the user
  point somewhere search terms do not reach, then to search by tag.

### Hidden conversations

A concept is **listed** unless it has carriers and every one of them is
hidden or excluded. An unlisted concept is left out of `tags`, out of
`broader` and `narrower`, and out of the review's vocabulary, where only
hidden carriers count, since the conversation under review is the one
tagging. A label of an unlisted concept is an unknown label to `search` and
`tags`. If she coins it again, the reuse rule makes it the same concept, so
nothing is duplicated and nothing reveals the hidden conversation. A concept
no conversation carries yet is listed, with 0 conversations.

## Seeing and correcting

### `dorothy --tags`

Prints the hierarchy and works without a terminal, as `--list` does:

```text
dorothy (12)
  memory (7)
    compaction (3)
    tagging (2)
  persona (4)
misc (0)
tui (5)
  rendering (3)
  tagging (2, see above)
```

- Roots are the concepts with no `broader`; children are indented two
  spaces, and siblings are in label order, case-insensitively.
- The count is a concept's carriers, hidden ones included, since the view
  is the user's.
- A concept with several parents appears under each. Its subtree is printed
  the first time only; later it reads `(n, see above)`.
- An empty vocabulary prints nothing. An unparseable one exits 1 with the
  path and reason.

### `dorothy --edit-tags`

Needs a terminal. Renders the vocabulary as blocks, one per live concept
in label order, and opens it with `editInEditor`:

```text
# Dorothy's vocabulary. Lines starting with # are ignored.
# Change a concept to make it yours. Delete a block to delete its concept;
# Dorothy won't coin its labels again. Merge: folds a concept into another.
# Add a block without Concept: to create one. Lists are separated by ;.

Concept: k3f9a2c1
Tag: memory
Also: recall; remembering
Under: dorothy
Note:
How Dorothy keeps and finds what was said before.
# (Dorothy, claude-opus-5-5, 2026-10-07; 7 conversations)

Concept: k1c2d3e4
Tag: recollection
Merge: memory
Note:
Remembering a particular passage.
# (yours, 2026-10-08; 1 conversation)
```

Parsing, in `tags-view.ts`, follows `edit-view.ts`:

- **Blocks.** A block starts at a `Concept:` line, or at a `Tag:` line not
  already in a block that has one. `Concept:` names an id that was
  rendered; an unrendered or repeated id is an error.
- **Fields.** `Concept:`, `Tag:`, `Also:`, `Under:` and `Merge:` take the
  rest of their line; `Note:` takes the lines after it up to the next field,
  joined with single spaces. `Also:` and `Under:` are lists separated by
  `;`. A field line deleted outright keeps its value; an emptied `Also:` or
  `Under:` empties the list. `Tag:` and `Note:` may not be empty.
- **Names.** `Under:` and `Merge:` name concepts by preferred or
  alternative label, as the labels stand after the edit.
- **Changes.** A block is changed when any field's normalised text differs
  from what was rendered. A changed block's concept gets `edited`; a
  created one gets `by: "user"`. A deleted block becomes a deleted
  tombstone.
- **Merging.** A block with `Merge:` becomes a merge tombstone pointing at
  the named concept. Its labels become alternative labels of the survivor,
  as many as fit; the rest are freed. Concepts under it are put under the
  survivor instead, dropping any edge from the survivor to itself.
- **Errors** reopen the editor with `# error: <reason>` at the top and the
  text as saved, as `--memory` does: an unknown or repeated field, a field
  outside a block, a limit broken, `;` in a label, a duplicate label, an
  `Under:` or `Merge:` naming no concept, merging into a concept that is
  itself merged or deleted in the same edit, or a cycle.
- **Saving** applies what changed against a fresh read of `tags.json` under
  the lock, then checks the result as a read would. Concepts coined while
  the editor was open are kept; a label of the user's that now clashes with
  one of hers, or a changed concept that has since gone, reopens the editor
  with the error. Saving unchanged, or emptying the file, exits without
  writing. An unparseable `tags.json` exits 1 with the path and reason
  before opening the editor.

### `dorothy --memory <phrase>`

The view gains a `Tags:` line after `Hidden:`:

```text
Title: Memory and metadata
Pinned: no
Hidden: no

# Tags (Dorothy, claude-opus-5-5, 2026-10-07)
Tags: memory; tui
```

- It takes the rest of the line: labels separated by `;`, each resolved by
  preferred or alternative label to a live concept, at most 5, duplicates
  collapsed. A label naming nothing is an error, "No tag by that name: x",
  which reopens the editor.
- Changing it makes the set the user's (`by: "user"`). Emptying it hands it
  back: `tags` becomes `[]`, `fields.tags` is removed and `reviewedThrough`
  resets to 0, as for an emptied note.
- While `tags.json` is unparseable the line is rendered as a comment saying
  so, and a `Tags:` line is an error.

## Modules

| File                         | Change                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `src/memory/vocabulary.ts`   | new: types, `readVocabulary`, the checks, atomic write, resolution, merges   |
| `src/memory/tags-view.ts`    | new, pure: the `--tags` tree; `--edit-tags` render, parse and diff           |
| `src/memory/sidecar.ts`      | `tags`, `fields.tags`, `EditChanges.tags`; dropping unresolved ids           |
| `src/memory/review.ts`       | `<tags>`, `<vocabulary>`, `TAGS_INSTRUCTION`, the schema, the output check   |
| `src/memory/service.ts`      | the vocabulary for reviews; coining and the sidecar under one lock; staleness |
| `src/memory/edit-view.ts`    | the `Tags:` line                                                             |
| `src/memory/commands.ts`     | `--tags`, `--edit-tags`                                                      |
| `src/recall/store.ts`        | the schema version and the new tables                                        |
| `src/recall/sync.ts`         | syncing `tags.json` and `tagged`                                             |
| `src/recall/query.ts`        | `search`'s `tags` and `keywords`, `open`'s `keywords`, `tags()`              |
| `src/recall/server.ts`       | registers `tags`                                                             |
| `src/index.ts`               | the `--tags` and `--edit-tags` modes                                         |

- `vocabulary.ts` is in `src/memory/`, beside `sidecar.ts`: recall already
  reads sidecars through memory's reader and reads the vocabulary the same
  way.
- No configuration, no persona change (the chat prompt stays pinned), and
  nothing here imports the Agent SDK.

## Failures

- **An unparseable `tags.json`**: tagging pauses (reviews write notes
  only), sidecar tags are kept as they are, `tags` and `search`'s `tags`
  are tool errors, and the TUI shows a warning notice once per run with the
  path and reason. `--tags` and `--edit-tags` exit 1.
- **A missing `tags.json`** is an empty vocabulary, written at the first
  concept coined or created.
- **A failed write** of `tags.json` fails the review as a failed sidecar
  write does, and neither file changes.
- **Tool failures** are MCP results with `isError: true` and a sentence she
  can relay, as before.

## Testing

Colocated tests in temporary directories, never touching real user data.

- `vocabulary.ts`: limits; label normalisation and case-insensitive
  uniqueness; `;` in a label; cycles through a diamond; deleted tombstones
  blocking labels and freeing them; merge chains rewritten to the survivor;
  every unparseable case.
- `review.ts`: the message with and without tags and vocabulary, fixed and
  provisional marks, escaping; the output check: reuse by alternative
  label, a coin colliding with a live label, a coin colliding with a
  tombstone, a cycle among coined concepts, more than 5 tags, fixed tags
  ignoring her output.
- `service.ts`: two writers coining one label get one concept; a review
  with an unparseable vocabulary keeps the sidecar's tags; untagged
  conversations stale only while the vocabulary reads.
- `sidecar.ts`: unresolved ids dropped at a write after a good read, kept
  after a bad one.
- `tags-view.ts`: the tree with a repeated node; render, parse and diff
  round trips; a rename recognised by id; a merge moving labels and
  children; each error; a clash with a concept coined meanwhile.
- `edit-view.ts`: the `Tags:` line, its errors, emptying it.
- `sync.ts` and `query.ts`: re-reading the vocabulary by mtime; merges
  resolved at query time; transitive carriers; frecency; unlisted concepts
  hidden everywhere; `keywords`; search by tag alone ordered by salience;
  the unavailable errors.
- A live probe: two chats on different subjects, then check that concepts
  were coined; a third on the first subject, then check that one was
  reused; ask her what topics she knows and check that she calls `tags`;
  rename a concept with `--edit-tags` and check that a later review keeps
  it.

## Known limitations

- **The whole vocabulary goes into every review.** As it grows, so does a
  review's cost. Cutting it would breed near-duplicates; pruning belongs to
  cyclical maintenance.
- **Case-insensitive labels.** "Go" the language and "go" the game cannot
  both be labels; one needs a qualifier.
- **Tombstones accumulate.** Deleted concepts keep their labels forever,
  unless the user reuses them.
- **`--tags` counts hidden conversations,** which is right for the user and
  why it is never shown to Dorothy.
- **Shallow means shallow.** A review sees the conversation and the
  vocabulary, nothing else, so two conversations on one subject may get
  different concepts until the user merges them or maintenance does.

## Out of scope

- Deep tagging, and Dorothy revising, merging or pruning concepts.
- Topic overviews and cyclical maintenance.
- Forgetting and its propagation.
- Tags in the memory block.
- Tagging compaction clusters.
- SKOS `related`, mappings and export.

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
