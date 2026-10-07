---
ctime: 2026-10-07
mtime: 2026-10-07
spdx: GPL-3.0-only
title: Compaction design
description: "Design spec for compacting a long conversation into clusters"
tags:
  - dorothy
  - memory
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-07-compaction-design.md
   -
   -->

# Compaction design

## Purpose

A conversation grows until its turns no longer fit Dorothy's context. Today
nothing stops that: the CLI the Agent SDK spawns would eventually compact
the session with Claude Code's own summariser, in Claude Code's voice, and
the notes on other conversations stay as large as they were at launch.

Compaction lets a long conversation decay from context into memory. Its
older turns are compacted in clusters, split where the topic changes, each
summarised by Dorothy in an abstract that stays in her context for the rest
of the conversation. The newest turns stay verbatim within a budget. Any
cluster can be opened word for word through an internal tool of its own.
At each compaction the memory block is re-tiered, the abstracts charged to
its budget first, so notes on other conversations fade as this one grows.

The model, in the user's words from the recall brief:

```text
1st  Message \
2nd  Message | <------ These are compacted collectively such that Dorothy may
3rd  Message |         retain vague context for potential lookup.
4th  Message /
...
xth    Message \ <---- Separately collectively compacted, also to
x+1th  Message /       provide Dorothy with reference.
...
(n-3)th  Message \
(n-2)th  Message | <-- Remain in constant context, depending on message size
(n-1)th  Message |     and token budget constraint.
nth Message      /
```

Success:

- A conversation of any length keeps working. Its context stays between
  the configured thresholds, and the CLI's own compaction never runs.
- After compaction Dorothy still knows what the whole conversation covered,
  from her abstracts, and quotes an early passage exactly after opening it
  with `recollect`.
- No reply is delayed by compaction unless the context passes the hard
  threshold.
- `--resume`, reconnecting and reviews all see the compacted conversation,
  never the whole transcript at once.

This spec targets main as of `09b6b76`, which includes recall
(`docs/specs/2026-10-06-recall-design.md`) and development mode.

## Sub-projects

This is the second half of the recall spec's second sub-project. Tags,
cyclical maintenance, and relations and embeddings follow as the catalogue
spec lists them.

## Decisions

- **A cluster has only an abstract, and it never fades.** Clusters are not
  tiered, ranked or weighted. Every abstract stays in context until the
  conversation ends, so the current conversation outranks pinned and other
  conversations simply by never being crowded out.
- **Dorothy splits by topic.** At each compaction she divides the outgoing
  turns into one or more consecutive clusters where the topic changes, and
  writes each abstract herself, in one background call. She gives only each
  cluster's last turn, so gaps and overlaps cannot happen.
- **At the next idle, past a soft threshold.** Compaction runs when the user
  is idle, as reviews do, and never delays a reply. Past a hard threshold
  the next message waits for it.
- **Compaction swaps sessions.** The CLI owns the live session's messages,
  so compaction ends it and starts a new one seeded with the abstracts and
  the newest turns, the way reconnecting already does. The mechanism carries
  over unchanged to the Messages API.
- **One way to seed.** Every session, whether first, resumed, reconnected or
  compacted, is seeded with the conversation's clusters and only the turns
  after the last one.
- **One budget, charged in the user's order.** The `[memory] budget` covers
  the abstracts, then pins, then the ranked rest. Abstracts and pins always
  appear even past the budget.
- **Transcripts record what happened; sidecars hold judgements.** The
  abstracts are Dorothy's judgements and live in the sidecar; the moment of
  compaction is a transcript event. An abstract is written once and never
  revised.
- **One internal tool.** `recollect` opens a cluster, optionally at the
  first turn matching some words. It is scoped to the live conversation, as
  `search` and `open` are scoped away from it, and it is not appraised:
  clusters are not weighted, so there is nothing for an appraisal to feed.
- **A wrapper, not a change to `App`.** `compacting(session)` wraps the
  `ChatSession` as `trackMemory` does, so `App`, the reducer and the TUI
  boundary are unchanged apart from notices and a lookup line.
- **Compaction is Dorothy's alone, and independent of the SDK.** Nothing in
  `src/compaction/` imports the Agent SDK. Her call goes through a
  structured-call function the module defines and the entry point injects,
  so after the move to the Messages API only that adapter changes. The
  CLI's own compaction, automatic and manual, is switched off on every call
  with `DISABLE_COMPACT=1`.

## State

| Class               | What                                  | Where                                   |
| ------------------- | ------------------------------------- | --------------------------------------- |
| Canonical           | transcripts, now with `compaction`    | `transcripts/<phrase>.jsonl`            |
| Generated, authored | notes, appraisals, now `clusters`     | `transcripts/<phrase>.meta.json`        |
| Derived             | the `clusters` table                  | `$XDG_CACHE_HOME/dorothy/recall.sqlite` |
| Ephemeral           | compaction back-off, the context size | the running TUI                         |

### Sidecar

Version 1 gains `clusters`, oldest first, defaulting to an empty list, so
existing sidecars need no migration:

```json
"clusters": [
  {
    "from": 1,
    "through": 14,
    "abstract": "…",
    "at": "2026-10-07T08:30:00.000Z",
    "model": "claude-sonnet-5-5"
  }
]
```

- Turns count from 1, as `reviewedThrough` and `throughTurn` do. `from` and
  `through` are inclusive.
- The first cluster starts at turn 1 and each later one on the turn after
  its predecessor's `through`.
- An abstract is normalised to one line, as notes are, and holds at most
  1000 code points, the limit of a conversation's abstract.
- Reading keeps the valid leading clusters and stops at the first invalid
  one, with a warning. Turns no valid cluster covers count as verbatim, so
  the next compaction covers them.
- Writes go through the existing locked update, so they never lose a
  concurrent review's notes.

Version 1 also gains `compactionCostUsd`, beside `reviewCostUsd`, defaulting
to 0: what the conversation's compactions have cost. It is read as
`reviewCostUsd` is, a missing or malformed value counting as 0, and written
by the same locked update that appends the clusters, so only a compaction
that saved its own clusters adds its cost. A run that took up another TUI's
clusters, a failed one, and a conversation with no transcript to describe add
nothing. Resuming does not show it: the screen's cost comes from the
transcript.

### Transcript

A new event, written just before the new session's `session` event:

```json
{ "v": 1, "kind": "compaction", "at": "…", "through": 31, "clusters": 2 }
```

`through` is the last turn compacted and `clusters` how many clusters this
compaction added. Turn counting skips it, as it skips `stats`; it never
becomes a turn on screen or in history.

## The seed

`withClusters(prompt, clusters, recall)` in `src/persona.ts` goes between
the memory block and the history:

```text
withHistory(withClusters(withMemory(persona, block), clusters), tail)
```

With no clusters it adds nothing. Otherwise:

```text
Earlier in this conversation, in your own summaries; recollect opens a
cluster's turns word for word:

<earlier>
<cluster n="1" turns="1-14">abstract</cluster>
<cluster n="2" turns="15-31">abstract</cluster>
</earlier>
```

With recall off, the preamble ends at "summaries". Abstracts are escaped
as the block's notes are. The tail follows under `withHistory`'s usual
heading, so the seed reads oldest first and the newest turns stay last.

`createSession(turns)` in `run.tsx` seeds every session this way, from the
clusters known for the conversation: the first start, `--resume`,
reconnecting after an error and the compaction handover. `App` keeps every
turn on screen and passes them all; the clusters decide which reach the
seed.

## Compaction

### The trigger

After each `turn-end`, the wrapper records the context size: the latest
request's input tokens, uncached plus cache read plus cache write, plus its
output tokens.

- Past `soft`, compaction is due and runs at the next idle, after the same
  idle time as reviews (`[memory] idle-seconds`).
- Past `hard`, the next message is held behind a dim `compacting…` notice
  until compaction ends, and then sent to the new session.
- Esc while a message is held marks it interrupted. It is still sent when
  compaction ends, and interrupted as soon as its reply starts streaming,
  so it ends as any interrupted turn does, in `App`'s history and the
  model's context alike.
- A message still held when the session closes is not sent. On quit nothing
  follows. On a reconnect, which `App` makes only to send a new message, the
  new session's history holds the held one once, unanswered, before the new
  one, so Dorothy answers the new message with it in view, as after any
  error mid-turn.
- Before a session connects, its seed is estimated at `ceil(codePoints / 4)`
  tokens, as the budget estimates notes. An estimate past `hard` compacts
  before connecting, behind the same notice. This covers resuming a long
  conversation recorded before this feature, or one quit mid-compaction.
- While a message is held, or before the first session connects, a call
  that leaves the new seed's estimate still past `hard` is followed at once
  by another, with no session between. The chain ends when the estimate
  falls to `hard`, or when a run ends without saving: a failed call, nothing
  to compact, or notes no longer readable. The held message then goes to a
  session seeded from the clusters saved so far, with the warning that the
  context is nearly full. A claim held elsewhere does not end the chain: a
  run holding a message, or before the first session, asks again every 2
  seconds until it is granted or the TUI quits.

### The outgoing turns

Walking back from the newest turn, turns are kept while their estimated
total fits `tail`. The latest exchange, the user's last message and
Dorothy's reply to it, is always kept, even past `tail`. The outgoing turns
are those after the last cluster and before the kept ones. If there are
none, compaction is skipped with a warning and is not tried again until
another exchange has been added.

One call takes at most `soft - tail` tokens of them, what a live compaction
sends at `soft`: the oldest outgoing turns, up to the last whole turn that
fits, and always at least one, even a turn larger than that. The rest go at
the next idle, or at once while a message is held. `callCap` in
`src/compaction/plan.ts` is the one place this is computed.

### Dorothy's call

`src/compaction/compact.ts` builds the request and validates the answer;
the call itself goes through a function the module defines and is given:

```ts
export type StructuredCall = (request: {
    system: string;
    prompt: string;
    schema: Record<string, unknown>;
    signal: AbortSignal;
}) => Promise<{ output: unknown; costUsd: number; model: string }>;
```

Its only implementation for now, `src/structured.ts`, is a one-shot
`query()` built as reviews are: `baseOptions`, `cliOptions()`, no tools,
the request's `system` as `systemPrompt` and its schema as `outputFormat`.
`system` is Dorothy's persona in the session's mode. The prompt holds:

1. Her existing abstracts, numbered, as context she must not repeat.
2. The outgoing turns, each numbered, escaped as reviews escape them.
3. The instructions: divide these turns into consecutive clusters where the
   topic changes; for each, give the number of its last turn and write an
   abstract of at most 1000 characters in her own words, from her point of
   view, noting what she would want to look up later. One cluster is fine
   when the turns hold one topic.

```json
{ "clusters": [{ "through": 22, "abstract": "…" }] }
```

Validation, in `src/compaction/clusters.ts`:

- At least one cluster.
- Each `through` is an integer within the outgoing range and greater than
  the one before.
- The last `through` is the last outgoing turn.
- Each abstract is non-empty after normalising and within its limit.

Anything else is a failure. The call has the review's timeout and its cost
counts towards `memory-cost`.

### The handover

When the call succeeds, the wrapper:

1. Waits for any reply still streaming to end.
2. Appends the new clusters to the sidecar, under the index's write lock.
3. Writes the `compaction` event.
4. Rebuilds the memory block with current salience and the reviews that
   finished since launch, the abstracts charged first.
5. Builds the new `Conversation` from the new seed, offering `recollect`.
6. Closes the old session and sends any held message to the new one.
7. Shows a dim `compacted turns 1-31 into 2 clusters` line.

If the sidecar's clusters already reach the turns, another TUI compacted
them first. When they cover at least the first outgoing turn and stop
before the latest message, the wrapper takes them up in place of its own
and hands over to a session seeded from them, counting no failure and
writing and recording nothing; the line tells of the turns they cover, and
the next compaction starts after them. Otherwise the save fails.

A message sent while the call runs goes to the old session. Its turns come
after the compacted range, so they are part of the new session's tail.
Everything already on screen stays.

The work holds the conversation's review claim in the index, so two TUIs
never compact or review one conversation at once. When a review and a
compaction are both due, compaction runs first and the review follows; one
background call runs at a time per conversation. A review of the live
conversation refused the claim asks again every 2 seconds until it is
granted, a message is sent or the TUI quits; a review of another
conversation is still left to whoever holds its claim.

### The CLI's own compaction

Compaction belongs to this module only. `cliOptions()` sets
`DISABLE_COMPACT=1` on every call, whatever the configuration. The CLI
documents it as switching compaction off entirely, `/compact` included,
where `DISABLE_AUTO_COMPACT` stops only the automatic kind; a probe
confirms it before anything relies on it. The SDK's `compact_boundary`
messages are then never expected; if one arrives, `Conversation` reports
it as a warning, so a broken switch is seen rather than silently
summarised over. Not an error event: that would end the turn on screen and
reconnect, while the CLI's turn carries on.

## The memory block

The block is no longer frozen for the whole session but for each session:
it is built when a session starts and rebuilt at each compaction. The tier
walk gains a first step:

1. Abstracts are charged first. They always appear, and are rendered by
   `withClusters`, not in the block.
2. Pins, then the ranked rest, as now, from the budget left. If the
   abstracts alone exceed the budget, pins still appear and nothing else
   does; the existing overrun warning names the abstracts.

The default `[memory] budget` is raised from 2000 to 4000 tokens, since the
abstracts now share it.

## Reviews

A review of a conversation with clusters is given the abstracts, then the
turns after the last cluster, instead of the whole transcript. Its notes
cover the conversation through both. Reads made by `recollect` are not
offered for appraisal.

## The tool

### `recollect`

```text
recollect({ cluster: number, words?: string, turn?: number })
```

Served by `--recall-server` beside `search` and `open`, for the phrase it
was given with `--exclude`, so only the live conversation, never another.
Without a phrase it is not registered. It is offered, through
`allowedTools` as `mcp__memory__recollect`, only to sessions seeded with
clusters.

- `turn` sets where reading starts, the cluster's `from` by default.
- With `words`, the window centres on the first turn from `turn` on, within
  the cluster, whose text matches, parsed and matched as `search` does over
  `turns_fts`. Without a match the result says so and the window starts at
  `turn`.
- The window is built by `windowOf` with `WINDOW_TOKENS`, as `open`'s is,
  and never reaches outside the cluster. Reading further is another call
  with a later `turn`.

The result is the cluster's number, its range, the conversation's turn
count, whether `words` matched, and the `window` of turns. It holds no
abstract, which Dorothy already has. An unknown cluster, a `turn` outside
it, or `words` empty after normalising is a tool error, as `open`'s are.

Description, for the server:

```text
Open one cluster of this conversation, from your summaries of its earlier
turns, to read what was said word for word. Give words to start at the
first turn in the cluster that contains them, or a turn number; call again
with a later turn to read further.
```

### The index

A new `clusters` table, `(phrase, n, from, through)`, synced from each
sidecar alongside its notes. The schema version is raised, so the first
launch rebuilds the index from transcripts and sidecars. Abstracts are not
added to `notes_fts`: `search` covers other conversations, and these are
notes Dorothy already has.

The TUI opens the index whenever memory, recall or compaction is on. With
memory and recall off it serves compaction alone, for the conversation's
claim and the sidecar's write lock. If it can't be opened, compaction runs
without them, and the warning that names what starts without the index
names compaction's lock.

### Lookups

A `recollect` call is a `recall` transcript event like the others, with a
new lookup shape:

```json
{ "tool": "recollect", "cluster": 2, "words": "…", "turns": [18, 24] }
```

`turns` is null after an error. The TUI shows it as a dim line,
`⌕ recollected cluster 2, turns 18-24`.

## Configuration

A new `[compaction]` table in `config.toml`, parsed in the existing style:

```toml
[compaction]
enabled = true  # false: no compaction at all
soft = 64000    # context tokens before compacting at idle, 2000 to 900000
hard = 128000   # context tokens before compacting at once, 4000 to 950000
tail = 16000    # newest turns kept verbatim, in tokens, 500 to 200000
```

Each value is checked against its range, then the three together: unless
`tail < soft < hard`, all three take their defaults and the warning names
the rule. `[memory] enabled = false` does not turn compaction off, since it
protects the live chat; there is then no block. With `enabled = false`
here the CLI's compaction stays off too, so a long enough chat ends in the
API refusing a request as too long, shown as the usual error.

## Units

| File                              | Role                                                                                                                              | Pure |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `src/compaction/plan.ts`          | context size, outgoing turns, seed estimate, the seed's turns                                                                     | yes  |
| `src/compaction/clusters.ts`      | the prompt, the schema, validating Dorothy's clusters                                                                             | yes  |
| `src/compaction/compact.ts`       | one compaction: request, `StructuredCall`, validation                                                                             | no   |
| `src/structured.ts`               | `StructuredCall` over a one-shot `query()`                                                                                        | no   |
| `src/persona.ts` (`cliOptions`)   | `DISABLE_COMPACT=1`                                                                                                               | yes  |
| `src/compaction/session.ts`       | `compacting(session)`: trigger, holding, handover, back-off, taking up another TUI's clusters                                     | no   |
| `src/persona.ts`                  | `withClusters`                                                                                                                    | yes  |
| `src/memory/sidecar.ts`           | `clusters`: parse, validate, append                                                                                               | no   |
| `src/memory/rank.ts`              | the tier walk charging abstracts first                                                                                            | yes  |
| `src/memory/service.ts`           | rebuilding the block on demand; the live review waits for the claim                                                               | no   |
| `src/memory/review.ts`            | the review prompt over abstracts and tail                                                                                         | yes  |
| `src/transcript.ts`               | the `compaction` event                                                                                                            | no   |
| `src/recall/store.ts`, `sync.ts`  | the `clusters` table                                                                                                              | no   |
| `src/recall/query.ts`             | `recollect`                                                                                                                       | no   |
| `src/recall/server.ts`            | registering `recollect`                                                                                                           | no   |
| `src/conversation.ts`             | the seed in `conversationOptions`, the tool list                                                                                  | no   |
| `src/dump.ts`                     | `--dump-context --resume` shows the compacted seed                                                                                | no   |
| `src/tui/run.tsx`                 | `createSession` seeding from clusters, wiring the wrapper, the save handing back another TUI's clusters, the index for compaction | no   |
| `src/timers.ts`                   | the injected timers and `sleep`, shared by compaction, memory and `src/structured.ts`                                             | no   |
| `src/tui/state.ts`, `History.tsx` | the notices and the `⌕` line                                                                                                      | yes  |
| `src/config.ts`                   | `[compaction]`                                                                                                                    | yes  |

Neither `src/compaction/` nor `src/tui/` imports the Agent SDK; boundary
tests enforce both. `src/structured.ts` and `src/tui/run.tsx`'s factory
are where the SDK meets compaction.

## Errors

| Case                                           | Behaviour                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Dorothy's call fails or returns invalid output | nothing written; warning; retried at later idles, each wait doubled; after three failures, not until next launch                     |
| It fails while a message is held               | the message goes to the old session, or to one seeded from the clusters saved so far, with a warning that the context is nearly full |
| The API rejects a request as too long          | the usual error and reconnect, which seeds from clusters                                                                             |
| The user quits mid-compaction                  | the call is aborted and nothing is written                                                                                           |
| The session closes while a message is held     | not sent; on reconnect, the new session's history holds it once, unanswered                                                          |
| The sidecar is unparseable                     | compaction is off until the next launch, with a warning; at launch, off for that chat; the file is not touched                       |
| Recording the compaction fails                 | the handover goes ahead, with a warning                                                                                              |
| Another TUI holds the claim                    | at an idle run: skipped, tried again at the next idle; while a message is held: asked again every 2 seconds                          |
| Another TUI compacted those turns first        | its clusters are taken up if they stop before the latest message, else a failure; nothing is written                                 |
| The latest exchange alone is past `hard`       | warning; the chat continues as it is                                                                                                 |
| `[memory] recall = false`                      | no `recollect`; the abstracts are still seeded                                                                                       |
| The CLI compacts despite `DISABLE_COMPACT`     | its `compact_boundary` becomes a warning; the turn carries on                                                                        |

## Testing

- **Pure units**: the context size from usage; the outgoing range and the
  latest-exchange rule; validating clusters (gaps cannot occur, but order,
  range, the last `through`, empty and long abstracts); the seed and its
  estimate; the tier walk with abstracts charged first, past the budget
  too; the config ranges and the `tail < soft < hard` rule.
- **The wrapper**, with fake sessions and timers: compaction at idle past
  `soft`; a held message past `hard`; a reply streaming during the handover;
  a message sent during the call landing in the tail; failure, back-off and
  giving up; the claim held elsewhere; compacting before connecting.
- **Dorothy's call**, with a fake `StructuredCall`: the prompt, the schema,
  valid and invalid output, the timeout. `src/structured.ts` with a fake
  `QueryFn`: the options it builds, the structured output, an error result.
- **The CLI's switch**: `cliOptions()` sets `DISABLE_COMPACT=1`; a
  `compact_boundary` message becomes a warning, and the turn carries on.
- **Recall**: syncing `clusters`; `recollect` through the MCP SDK's
  in-memory transport, with and without words, a match at the cluster's
  edges, a turn outside it, an unknown cluster; registration only with a
  phrase.
- **Round trips**: sidecar `clusters`, including invalid trailing ones; the
  `compaction` event; the `recollect` lookup.
- **Probes**, with temporary XDG directories and hand-written transcripts,
  touching no real data: that the CLI honours `DISABLE_COMPACT`, by
  shrinking its compaction window with `CLAUDE_CODE_AUTO_COMPACT_WINDOW`
  and seeing no compaction through the capture server, where without the
  switch one is sent; then live in tmux with tiny thresholds, where
  compaction runs, the line shows, `recollect` opens a cluster, and
  `--dump-context --resume` shows abstracts and tail.

## Out of scope

- Editing abstracts through `--memory`.
- A `/compact` command.
- Compaction in one-shot mode.
- Regrouping or rewriting old clusters.
- Tags, cyclical maintenance, relations and embeddings.
