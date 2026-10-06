---
ctime: 2026-10-06
mtime: 2026-10-06
spdx: GPL-3.0-only
title: Recall design
description: "Design spec for Dorothy's second memory: looking things up"
tags:
  - dorothy
  - memory
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-06-recall-design.md
   -
   -->

# Recall design

## Purpose

The conversation catalogue gives Dorothy the gist of earlier conversations: a
title, a description and an abstract each, fading with how much they matter.
When the gist is not enough, she can only say she does not remember. Recall
lets her look: she searches past conversations by the words they contain, and
opens the passage that matched. Each conversation in her memory block is an
object whose richness follows its salience; a search hit is the same object,
and opening it shows the conversation itself.

What she opens, she later appraises: whether it served the purpose she opened
it for. Appraised reads feed salience, so conversations that help her rise in
her memory and lookups that never help earn nothing.

Success:

- Asked about something her notes only name, Dorothy searches, opens the
  matching passage and answers from it, and the user sees each lookup as it
  happens.
- Search works offline, against local data only, through tools Dorothy
  calls herself; no other model is involved.
- The recall tooling depends on no Agent SDK API: it is a standalone MCP
  server over stdio, which the Messages API iteration can use unchanged.
- The index is derived: deleting it costs a rebuild, never data.
- A conversation's salience grows with the reads that served her, and an
  unhelpful or unappraised read adds nothing.

This spec targets main as of `7f6c2ff`, which includes the conversation
catalogue (`docs/specs/2026-10-05-conversation-catalogue-design.md`).

## Sub-projects

Recall was the catalogue spec's second sub-project. It is split in two:

1. **Recall** (this spec): the index, the external `search` and `open`
   tools, appraisal and salience, and the catalogue limitations the index
   makes cheap to fix.
2. **Compaction**: a long conversation decays from context into memory.
   Older messages are compacted in clusters, each weighted by salience and
   each available for lookup through an internal tool of its own; the newest
   stay verbatim within a budget; the current conversation outranks pinned
   and external ones. Re-tiering the memory block happens at each compaction.

Tags, cyclical maintenance, and relations and embeddings follow as the
catalogue spec lists them.

## Decisions

- **On demand, never pushed.** Dorothy decides when to look something up.
  Nothing is added to a user's message on her behalf, so lookups cost only
  when she needs one and the cached prompt prefix is untouched.
- **A standalone MCP server over stdio.** The core (`src/recall/`) knows
  neither the Agent SDK nor MCP; `server.ts` speaks MCP over stdin and stdout
  with `@modelcontextprotocol/sdk`. Today the Agent SDK launches it through
  `mcpServers`; after the move to the Messages API, Dorothy connects to the
  same server as an MCP client. In-process SDK tools (`createSdkMcpServer`)
  were rejected as SDK coupling. Any MCP client, such as the MCP Inspector,
  can launch the server and see what Dorothy sees.
- **Separate tools for separate scopes.** This spec ships the external tools,
  over other conversations only; the current conversation is never among
  their results. Compaction adds its own internal tool. Choosing the tool
  chooses the scope, so an external search cannot fill her context with
  internal hits.
- **Results are schema.org-shaped.** A result is a `Conversation` object
  using schema.org property names, with `@type` but no `@context`.
- **Reads are appraised with hindsight, in the idle review.** Whether a read
  served its purpose depends on what followed, so the review appraises it,
  not the moment of reading. Appraisals cost no extra request in the chat and
  none are forgotten.
- **Salience replaces frecency.** Accesses are weighted by what they gave her
  and decay with age; a read that served nothing weighs nothing, so a
  useless conversation cannot climb by being looked up repeatedly.
- **Transcripts record what happened; sidecars hold judgements.** A lookup
  is a transcript event; its appraisal sits in the reading conversation's
  sidecar with her notes. The index is derived from both.
- **The index is synced before every query.** No watcher and no
  invalidation: stat the files, read what was appended.

## State

| Class               | What                                           | Where                                   |
| ------------------- | ---------------------------------------------- | --------------------------------------- |
| Canonical           | transcripts, now with `recall` events          | `transcripts/<phrase>.jsonl`            |
| Generated, authored | notes, pins, hidden, appraisals, failures      | `transcripts/<phrase>.meta.json`        |
| Derived             | turns, visits, reads, FTS, salience, the block | `$XDG_CACHE_HOME/dorothy/recall.sqlite` |
| Ephemeral           | review claims, the write lock                  | the same file                           |

The index lives in the XDG cache directory (`~/.cache` when unset), mode
0600 in a 0700 directory, because everything in it can be rebuilt. Claims and
the lock are ephemeral by nature, so losing them with the file loses nothing.

## The index

### Schema

`PRAGMA user_version` holds the schema version. A different version, or a
file SQLite cannot read, is deleted and rebuilt. The file is opened in WAL
mode with a `busy_timeout` of 5 seconds.

```sql
CREATE TABLE conversations (
    phrase TEXT PRIMARY KEY,
    t_size INTEGER NOT NULL,   -- transcript bytes indexed so far
    t_mtime INTEGER NOT NULL,
    t_ino INTEGER NOT NULL,    -- a new inode means the file was replaced
    s_mtime INTEGER,           -- sidecar mtime last read; NULL: none
    sidecar TEXT,              -- the SidecarRead, as JSON
    title TEXT, description TEXT, abstract TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    first_at INTEGER, last_at INTEGER
);
CREATE TABLE turns (
    phrase TEXT NOT NULL, n INTEGER NOT NULL,  -- 1-based
    role TEXT NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL,
    PRIMARY KEY (phrase, n)
);
CREATE TABLE visits (
    phrase TEXT NOT NULL, n INTEGER NOT NULL,
    user_turns INTEGER NOT NULL, last_at INTEGER NOT NULL,
    PRIMARY KEY (phrase, n)
);
CREATE TABLE reads (
    id TEXT PRIMARY KEY,       -- the tool_use id
    reader TEXT NOT NULL, target TEXT NOT NULL, at INTEGER NOT NULL
);
CREATE TABLE appraisals (
    reader TEXT NOT NULL, id TEXT NOT NULL, served TEXT NOT NULL,
    PRIMARY KEY (reader, id)
);
CREATE TABLE claims (
    phrase TEXT PRIMARY KEY, owner TEXT NOT NULL, until INTEGER NOT NULL
);
CREATE VIRTUAL TABLE turns_fts USING fts5(
    text, content=turns, tokenize='porter unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE notes_fts USING fts5(
    title, description, abstract, content=conversations,
    tokenize='porter unicode61 remove_diacritics 2'
);
```

Both FTS tables use external content, so each text is stored once; triggers
keep them in step with their tables. Times are milliseconds since the epoch.

### Sync

Sync brings the index up to date with the transcript directory, in one
`BEGIN IMMEDIATE` transaction, before every query and at TUI launch:

- **A grown transcript** (same inode, size above `t_size`) is read from
  `t_size`. Only complete lines are indexed and `t_size` advances past them;
  a half-written last line waits for the next sync.
- **A shrunk or replaced transcript** (size below `t_size`, or a new inode)
  is dropped and indexed again in full.
- **A deleted transcript** takes its rows with it.
- **Turns** are numbered as `parseTranscript` numbers them, through a shared
  line parser, so the index, `throughTurn` and `reviewedThrough` agree.
  Malformed lines are skipped as `parseTranscript` skips them. `recall`
  events are not turns.
- **Visits** follow `visitsOf`: one per session event with any user turns.
  An append may extend the last visit, which is updated in place.
- **Reads** are the transcript's `recall` events with `tool: "open"` and
  `ok: true`.
- **A sidecar** is re-read through `readSidecar` when its mtime differs from
  `s_mtime`, so notes are normalised and checked as everywhere else. Its
  notes, `hidden` flag and appraisals are copied into the index.
- **Leftover temporary files** (`*.meta.json.*.tmp`) older than an hour are
  removed.

Stat-ing a few hundred files costs a millisecond or two, so syncing before
each query keeps results current even when a second TUI is writing.

## The tools

The server offers two tools. Their descriptions carry the guidance on when to
use them: the notes in her prompt give the gist, and when they or the user
point at detail she lacks, she searches, then opens what matched. The server
sends no MCP `instructions`.

### `search`

```text
search(query: string, after?: string, before?: string, limit?: number)
```

- **`query`** is normalised as a note is, then split on spaces into at most
  16 terms. Each term is quoted for FTS5, with any `"` doubled, so FTS5
  syntax in a query is just text. An empty query is a tool error.
- **All terms must match** (`"a" "b"`). If that finds nothing, **any term
  may match** (`"a" OR "b"`).
- **`after` and `before`** are ISO dates (`YYYY-MM-DD`), inclusive, in local
  time. A turn matches only if its `at` is within them; a notes match counts
  if the conversation's activity (`first_at` to `last_at`) overlaps them.
- **`limit`** defaults to 5 and is clamped to 1 to 10.
- **A hit is a conversation.** Its score is the best of its turn matches'
  BM25 and its notes match's BM25 doubled, so a match in the notes outranks
  an equal one in a turn. Ties go to the higher salience. Hidden
  conversations and the one passed as `--exclude` are left out.

```json
{
  "results": [
    {
      "@type": "Conversation",
      "identifier": "amber-otter-quietly-sings",
      "name": "Terminal rendering chaos",
      "description": "Celebrating render artefacts kept under 30% of the view.",
      "dateCreated": "2026-10-04",
      "dateModified": "2026-10-05",
      "matches": [
        {
          "turn": 7,
          "role": "user",
          "text": "…text artefacts from «render» malfunction don't…"
        }
      ]
    }
  ],
  "more": 3
}
```

- **`matches`** holds at most 3 snippets per conversation, best first, from
  FTS5's `snippet()` with `«` and `»` around matched words and `…` at cut
  ends, about 12 words each. A conversation found only through its notes has
  an empty `matches`.
- **`name` and `description`** are absent when the conversation has no such
  note. There is no abstract in a search result.
- **`dateCreated` and `dateModified`** are the local dates of `first_at` and
  `last_at`. **`more`** counts the hits beyond `limit`.

### `open`

```text
open(conversation: string, purpose: string, turn?: number)
```

- **`conversation`** is an `identifier` (phrase).
- **`purpose`** is required: what she hopes to find, normalised as a note
  is, at most 160 code points. The idle review appraises the read against it.
- **`turn`** centres the window; without it the window starts at turn 1. A
  turn past the end is the last turn.
- **The window** grows outward from that turn, alternately forward and back,
  while it stays within 4,000 tokens by the block's estimate
  (`ceil(codePoints / 4)`). It always holds at least one turn; a turn longer
  than the whole window is cut to it and ends with `… [cut]`.

```json
{
  "@type": "Conversation",
  "identifier": "amber-otter-quietly-sings",
  "name": "Terminal rendering chaos",
  "description": "Celebrating render artefacts kept under 30% of the view.",
  "abstract": "We celebrated keeping render artefacts under 30% of the view…",
  "dateCreated": "2026-10-04",
  "dateModified": "2026-10-05",
  "turns": 42,
  "window": [
    { "turn": 3, "role": "user", "at": "2026-10-04T21:03:11Z", "text": "…" }
  ]
}
```

- **An unknown, hidden or excluded conversation** returns the same tool
  error, "No conversation by that name.", so hiding cannot be detected.
- To read further she opens again at another turn; each open is its own read.

### The server

`dorothy --recall-server [--exclude <phrase>]` runs the server: a mode of the
entry point, parsed in `index.ts` like `--list`. It decrypts no credentials,
writes nothing to stdout but MCP, and exits when stdin closes. Tool failures
(an unreadable index, a bad argument) are MCP results with `isError: true`
and a sentence she can relay. Results are JSON text content.

## Lookups in the chat

### The adapter

When `[memory] recall` is on, `Conversation` adds to its options, and to no
other query's:

```ts
mcpServers: {
    memory: {
        type: "stdio",
        command: process.execPath,
        args: [entryScript, "--recall-server", "--exclude", phrase],
    },
},
allowedTools: ["mcp__memory__search", "mcp__memory__open"],
```

`entryScript` is the running entry point (`src/index.ts` or
`dist/index.js`). Without `allowedTools` the CLI refuses each call
(`permission_denied`). Reviews and one-shot mode stay tool-free.

`Conversation` pairs each `tool_use` block of an `assistant` message with the
`tool_result` block of a later `user` message by id, and emits:

```ts
| {
      type: "lookup";
      id: string;
      tool: "search" | "open";
      input: SearchInput | OpenInput; // types from src/recall
      ok: boolean;
      summary: LookupSummary; // hits, or name and window
      offset: number; // code units of the reply so far
  }
```

- The summary is parsed from the result through `src/recall`'s types, so a
  change to the result shape fails the typecheck, not the display.
- **A reply spans steps.** Text that follows a lookup in a new step is joined
  to the reply with a blank line.
- **Stats are unchanged.** The `result` message still ends the turn with the
  whole turn's usage and cost; `ttft` still times the first text.
- **Interrupted mid-lookup**, a `tool_use` without a result emits its lookup
  with `ok: false`.
- **A server that fails to start** shows as `failed` in the init message's
  `mcp_servers`; `Conversation` emits one warning and the chat goes on
  without tools.

The `lookup` event carries no SDK types, so `src/tui/boundary.test.ts` holds.

### The transcript

Each lookup is written as it is emitted:

```json
{
  "v": 1,
  "kind": "recall",
  "at": "…",
  "id": "toolu_…",
  "tool": "open",
  "conversation": "amber-otter-quietly-sings",
  "purpose": "the render bug we were chasing",
  "turns": [3, 11],
  "ok": true,
  "offset": 18
}
```

A search records `query`, `after`, `before` and `hits` instead of
`conversation`, `purpose` and `turns`. Results are never recorded: they are
re-derivable and would bloat the transcript. `parseTranscript` ignores
`recall` events when building turns, so history, turn counts and
`throughTurn` keep their meaning; the event joins the `TranscriptEvent`
union.

### The TUI

History gains a line role, `lookup`, rendered dim:

```text
⌕ searched "terminal rendering" · 2 conversations
⌕ opened Terminal rendering chaos
  for: the render bug we were chasing
⌕ couldn't open amber-otter-quietly-sings
```

- A search that found nothing reads `· nothing found`.
- Text after a lookup starts a new `dorothy` line, so each segment renders as
  Markdown on its own.
- A resumed chat splits the reply at each event's `offset`, placing the lines
  where they appeared live.
- Lines too wide for the window are cut with `…`.
- The raw pane (Ctrl+R) shows the results, as it shows every SDK message.

## Appraisal

The idle review (live or catch-up) of a conversation appraises its pending
reads: `open` events with `ok: true` and no appraisal in its sidecar.

- **The prompt marks each read** in the reply text at its offset, as
  `[read toolu_…]`, and lists the reads after the conversation, escaped like
  the rest:

  ```xml
  <reads>
  <read id="toolu_…" conversation="Terminal rendering chaos" turns="3-11">the render bug we were chasing</read>
  </reads>
  ```

- **The instructions gain a sentence**: for each read, judge how well what
  you found served its purpose, by what happened afterwards.
- **The schema gains `appraisals` only when reads are pending**, so other
  reviews are unchanged: an array of exactly as many `{ id, served }` objects
  as reads (`minItems` and `maxItems`), with `id` an `enum` of the pending
  ids and `served` one of `none`, `slight`, `useful` or `essential`.
  Validation also rejects a repeated id.
- **Appraisals merge into the sidecar** as
  `appraisals: { "<id>": { "served": "…", "at": "…", "model": "…" } }`. An
  appraisal is final. `--memory` does not show them; they are Dorothy's
  bookkeeping, not her notes.
- **A failed review leaves its reads pending** for the next one. With
  `[memory] enabled = false` there are no reviews, so reads gain no weight.

## Salience

`frecency()` becomes `salience()`, still pure, used by the block's ranking
and by search's tie-break:

```text
salience(c) = Σ visits of c            (1 + ln(1 + userTurns)) · ½^(age / h)
            + Σ reads of c by others  w(served)               · ½^(age / h)

h: half-life-days
w: none 0 · slight 0.5 · useful 1 · essential 2 · unappraised 0
```

A read's age runs from the read's `at`, not the appraisal's, so a late review
cannot make an old read look recent. `half-life-days` serves both terms.

`catalogue.ts` already hides the scan behind a `Catalogue` interface for this
moment: an `IndexCatalogue` replaces the file scan. At launch the TUI syncs
the index and loads every entry, with its sidecar, visits, turn count and
appraised reads, in one query. The scan is removed. If the index cannot be
opened, even after a rebuild, the chat starts without a memory block and
without tools, and warns once.

## Catalogue limitations addressed

The catalogue spec's Known limitations that the index makes cheap to fix:

- **Pointless reviews.** A conversation whose three notes the user owns, with
  no reads pending, is not reviewed: `reviewedThrough` advances to its turn
  count without a model call.
- **Reviews that always fail.** The sidecar gains
  `failures: { "count": n, "at": "…" }`. After `n` consecutive failures the
  conversation is not reviewed, live or at catch-up, until
  `at + min(2^(n-1) hours, 7 days)`. A success clears it. A timeout counts as
  a failure; a review cancelled by quitting does not.
- **Two TUIs at once.** A review first claims its conversation: in one
  transaction, expired claims are deleted and a row is inserted unless one
  exists. `owner` is the process id and a random suffix; `until` is the
  review timeout plus 30 seconds. A conversation another process has claimed
  is skipped. The claim is deleted when the review ends.
- **Cross-process writes.** `updateSidecar` takes an optional lock. Every
  writer (reviews, provisional titles, `--memory`) passes the index's, which
  runs the read, change and rename inside `BEGIN IMMEDIATE`; SQLite releases
  it if the process dies. Without an index, writes go unlocked as before.
- **Leftover temporary files** are removed by sync.

Unchanged, and still listed in the catalogue spec: review cost against chat
cost, hiding per conversation, the `commands.ts` layering, and the edit
view's paragraph quirks.

## Configuration

One key joins the `[memory]` table:

```toml
[memory]
recall = true   # false: no recall server, no tools
```

It is independent of `enabled`: recall works without reviews (reads then gain
no weight), and reviews work without recall. When it is off, the persona
keeps its current sentence. When it is on, "you have no tools" becomes "you
have no tools except your memory tools", and the instruction not to invent
detail the notes lack is kept.

## Units

| Unit                      | Responsibility                                                   |
| ------------------------- | ---------------------------------------------------------------- |
| `src/recall/store.ts`     | open, schema, rebuild, write lock, claims                        |
| `src/recall/sync.ts`      | bring the index up to date with transcripts and sidecars         |
| `src/recall/query.ts`     | `search` and `open` over the index, terms, windows               |
| `src/recall/types.ts`     | inputs, results and summaries shared with the adapter            |
| `src/recall/server.ts`    | the MCP server; the only importer of `@modelcontextprotocol/sdk` |
| `src/memory/catalogue.ts` | `IndexCatalogue` in place of the scan                            |
| `src/memory/rank.ts`      | `salience()` in place of `frecency()`                            |
| `src/memory/review.ts`    | reads in the prompt, appraisals in the schema and validation     |
| `src/memory/sidecar.ts`   | `appraisals`, `failures`, the optional lock                      |
| `src/memory/service.ts`   | skipping, back-off, claims                                       |
| `src/conversation.ts`     | recall options, `lookup` events, replies across steps            |
| `src/transcript.ts`       | the `recall` event                                               |
| `src/tui/state.ts`        | `lookup` lines, live and resumed                                 |
| `src/tui/History.tsx`     | the dim `⌕` line                                                 |
| `src/tui/run.tsx`         | wiring, recording lookups                                        |
| `src/persona.ts`          | the tools sentence                                               |
| `src/config.ts`           | `[memory] recall`                                                |
| `src/index.ts`            | `--recall-server`                                                |

`src/recall/` imports nothing from the Agent SDK; a boundary test like
`src/tui/boundary.test.ts` enforces it, and that only `server.ts` imports
MCP. It may import the catalogue's SDK-free modules (`sidecar.ts`,
`rank.ts`). `@modelcontextprotocol/sdk`, today the Agent SDK's dependency,
becomes a direct one.

## Errors

| Failure                           | Effect                                                     |
| --------------------------------- | ---------------------------------------------------------- |
| index unreadable or wrong version | deleted and rebuilt                                        |
| index cannot be opened at all     | no block, no tools, one warning                            |
| server fails to start             | no tools, one warning                                      |
| a tool fails                      | an `isError` result she can relay                          |
| unparseable sidecar               | the conversation is searchable by its turns, without notes |
| malformed transcript line         | skipped                                                    |
| review fails                      | reads stay pending; back-off as above                      |

## Testing

- **The core**, against real `bun:sqlite` in temporary directories:
  - sync: appended lines, a half-written last line, a shrunk file, a
    replaced file, a deleted file, a changed sidecar, temporary files;
  - turn numbering identical to `parseTranscript`, visits identical to
    `visitsOf`;
  - search: stemming, accents, quoting of FTS5 syntax, the any-term
    fallback, hidden and excluded conversations, date bounds, `limit` and
    `more`, the notes weighting, the salience tie-break;
  - open: the window's growth, a cut turn, a turn past the end, the uniform
    error;
  - the lock and claims across two `Database` handles on one file.
- **The server**, through the MCP SDK's in-memory transport: the tool list,
  calls, and error results.
- **The adapter**, with a fake `QueryFn` stream: lookup events, offsets,
  joined replies, interruption mid-lookup, a failed server.
- **The rest**: the `recall` event round trip; lookup lines in the reducer,
  live and resumed; the appraisal schema, validation and merge; the salience
  formula; skipping, back-off and claims in the service; the boundary test.
- **A live probe** in tmux with temporary XDG directories, touching no real
  data: Dorothy searches and opens, the lines show, and the next idle review
  appraises the read.

## Out of scope

- Compaction and the internal tool (the next spec).
- Tags, cyclical maintenance, relations and embeddings.
- The leak found while probing tools: the CLI gives Dorothy Claude Code's
  auto-memory for the working directory and the account's email address,
  despite `settingSources: []`. It is fixed separately.
- Making the memory block itself JSON-LD.
- Recall in one-shot mode.
