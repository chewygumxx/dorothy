---
ctime: 2026-10-05
mtime: 2026-10-05
spdx: GPL-3.0-only
title: "Conversation with Claude: Memory and Metadata"
description: >-
  Claude's survey of TypeScript modules close to Dorothy's conversation memory
  design, such as @mastra/memory, claude-mem and Letta, and what is left to
  build.
tags:
  - dorothy
  - memory
  - notes
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-10-05_claude-conversation-memory-metadata.md
   -
   -->

# Conversation with Claude: Memory and Metadata

## chewygumxx Prompt 1

Please help me find a typescript module or similar that somewhat provides this
memory-metadata function.

[Attached File](./2026-10-04_dorothy-conversation-memory-metadata.md)

---

## Claude Response 1

I'll survey the current TypeScript agent-memory landscape against your design
(per-conversation title/description/abstract, frecency tiers, hierarchical
tags, rebuildable FTS index, cyclical consolidation) and report which ones fit
closest.

### Short answer

No package ships your design as a whole, but three TypeScript-reachable
projects together cover most of it. **`@mastra/memory`** is the closest drop-in
for your _Conversation Event_ trigger and for your open compaction question.
**claude-mem** is the closest blueprint for the tiered cross-conversation
index, almost field for field. **Letta** is the closest match for the _Cyclical
Period_ trigger. Hierarchical tags with descriptions and frecency-tiered
context are things you'll build yourself, and they're the small part.

### Closest fits

#### `@mastra/memory`: conversation-event metadata and compaction

This is the strongest candidate to actually `import`.

- **Provisional title.** Mastra can generate descriptive thread titles from the
  conversation transcript when `generateTitle` is enabled. It also accepts
  `minMessages` and an optional `model`, so title generation can run on a
  smaller, cheaper model than the conversation itself. That is your "fast,
  ephemeral and inexpensive agent".
- **Evolving title.** With `observation.threadTitle` enabled, the Observer can
  suggest a short thread title when the conversation topic meaningfully
  changes. A recent fix added pinning: a `titlePinned` metadata flag stops
  Observational Memory from overwriting a manual rename.
- **Description and abstract.** Extractors persist specific values alongside
  observations. Adding a `schema` makes an extractor run as a structured-output
  follow-up, and by default the extractor sees its previous value on later runs.
  Two custom extractors give you description and abstract, and a third can do
  your shallow tagging.
- **Compaction that stays searchable** (your unresolved question). An Observer
  compresses message history into observations once it passes a token
  threshold, and a Reflector condenses the observation log when that log grows
  too large. Retrieval mode links each observation group to the raw messages
  behind it, so the agent can call a `recall` tool to recover exact wording,
  list threads, and browse other threads.
- **Per-turn review.** The defaults are tuned for long agent runs, not chat.
  `observation.bufferOnIdle` runs background observation when a turn ends, and
  extractor metadata from buffered work is persisted immediately. That gets you
  close to "reviewed for update on successive responses".

Two caveats. First, the metadata is written by a background model, not by
Dorothy, so set the Observer's model to hers if authorship matters. Second,
nothing keeps your array of previous titles, so you'd append those yourself.

#### `claude-mem`: blueprint for the tiered index

This one is better to study than to import. Its observations schema lines up
with yours almost exactly: each row has `title`, `subtitle` and `narrative`
fields, a `concepts` JSON array for tags, and an FTS5 virtual table kept in
sync by triggers. Its retrieval is your progressive disclosure: first a compact
index of IDs, titles, types and timestamps at roughly 50–100 tokens per result,
then a timeline around chosen observations, then full details only for the
relevant IDs at roughly 500–1,000 tokens each.

It's tightly coupled to Claude Code hooks and a worker service. Installing it
from npm gives you only the SDK/library, without the hooks or worker. So lift
the schema and the three-layer search pattern rather than the runtime.

On licensing, since Dorothy is GPL-3.0-only: the current README says claude-mem
is under Apache-2.0, but older releases and forks carry AGPL-3.0. Check which
version you copy from.

#### Letta: the cyclical period

Letta splits agent memory into in-context and out-of-context tiers. In-context
memory is made of persistent, editable blocks, and sleep-time agents run in the
background sharing memory with the primary agent. Blocks carry a description,
and Letta's suggested pattern is that agents read blocks while sleep-time
memory curates them. A labelled block with a description is very close to your
"documents dedicated to major tags".

The catch is that `@letta-ai/letta-client` is a client for a Letta server,
either self-hosted or Letta Cloud. It isn't an embeddable library, so adopting
it means running that server alongside your TUI.

#### Worth a glance

- **Hermes Agent** (Python, but you already cite it). It combines bounded
  MEMORY.md and USER.md files with a `session_search` tool backed by SQLite
  FTS5 over all past sessions. It also keeps session lineage through context
  compression and runs a curator that consolidates and archives stale entries.
  It's a good reference for the "summary plus lookup" shape.
- **Mem0** (`mem0ai/oss`). It's vector-first, with categories that act like
  flat tags. The TypeScript OSS SDK lacks the Python version's reranker and
  graph memory. It's a weak fit for your hierarchy.
- **Basic Memory** (Python). This is the reference for your rebuildable index:
  Markdown files are the source of truth, and the SQLite database is a derived
  index that `bm sync` rebuilds from them.

### Coverage map

| Your component                          | Mastra              | claude-mem                 | Letta                | Hermes     |
| --------------------------------------- | ------------------- | -------------------------- | -------------------- | ---------- |
| Provisional title from cheap model      | ✅                  | ❌                         | ❌                   | ❌         |
| Evolving title / description / abstract | ✅ extractors       | ◐ title·subtitle·narrative | ◐ blocks             | ❌         |
| Previous-titles array                   | ❌                  | ❌                         | ❌                   | ❌         |
| Tiered progressive disclosure           | ◐ 3-tier compaction | ✅ index→timeline→full     | ◐ core vs archival   | ◐          |
| FTS index                               | ❌ (vector recall)  | ✅ FTS5                    | ◐                    | ✅ FTS5    |
| Compaction with raw lookup              | ✅ retrieval mode   | ◐                          | ◐                    | ✅ lineage |
| Cyclical consolidation                  | ◐ within thread     | ◐ session-end summary      | ✅ sleep-time        | ◐ curator  |
| Hierarchical tags with descriptions     | ❌                  | ◐ flat concepts            | ◐ block descriptions | ❌         |
| Frecency tiers + pin override           | ◐ title pin only    | ❌                         | ❌                   | ❌         |

### Sketch: your event triggers in Mastra

```typescript
import { LibSQLStore } from "@mastra/libsql";
import { Extractor, Memory } from "@mastra/memory";
import { z } from "zod";

export const memory = new Memory({
  storage: new LibSQLStore({
    id: "dorothy-memory",
    url: "file:./dorothy.db",
  }),
  options: {
    // "First Prompt": provisional title from an inexpensive model
    generateTitle: {
      model: "anthropic/claude-haiku-4-5",
      minMessages: 1,
    },
    observationalMemory: {
      model: "anthropic/claude-haiku-4-5", // or Dorothy's own model
      retrieval: true, // compacted history stays browsable via `recall`
      observation: {
        threadTitle: true, // "Successive Responses": retitle on topic shift
        bufferOnIdle: true, // observe every turn, not only past 30k tokens
        extract: [
          new Extractor({
            name: "Description",
            instructions:
              "One terse sentence describing this conversation so far.",
            schema: z.string().max(160),
          }),
          new Extractor({
            name: "Abstract",
            instructions:
              "A single-paragraph abstract of this conversation so far.",
            schema: z.string(),
          }),
          new Extractor({
            name: "Shallow tags",
            instructions: "Up to five short topical tags.",
            schema: z.array(z.string().max(50)).max(5),
          }),
        ],
      },
    },
  },
});
```

Treat this as a starting shape, not tested code. Option names track current
docs, and Mastra moves quickly.

### What you'll still build yourself

- **The tag table.** None of these projects has parent/child tags with their
  own descriptions, dates and conversation references. This is a few SQLite
  tables.
- **Frecency tiering.** Score conversations and tags, then choose title-only,
  title plus description, or the full triad per item within a token budget.
  Pins override the score.
- **The rebuildable FTS layer.** Mastra's recall is vector-based. An FTS5
  external-content table with sync triggers, as claude-mem does, is short to
  write with `bun:sqlite` or `better-sqlite3`.

### Conventions worth borrowing

- **Agent Skills spec.** Its progressive disclosure is your tag tiers by
  another name. `name` is capped at 64 characters and `description` at 1,024,
  and only the name and description, about 100 tokens, stay loaded until the
  skill is triggered. Your 12/50-character tag names already fit inside that, so
  you could also adopt its 1,024-character description cap for tags.
- **Firefox frecency**, which fits your browser choice. It scores each visit by
  a weighted bucket with exponential decay, and gives bookmarked or typed pages
  the highest weight. In your terms, those are pinned conversations and ones
  Dorothy explicitly recalled. The algorithm changed in Firefox 147, so read the
  current ranking doc rather than the legacy bucket version.
- **Anthropic's memory tool (`memory_20250818`).** It's a client-side,
  file-based memory directory under `/memories`, and the tool is generally
  available with no beta header. It could serve as the interface to your per-tag
  documents. LangChain.js already has a TypeScript handler for it that you can
  crib from.
- **MCP** remains the natural way to expose `search_memory` and `recall` if you
  later want other clients to reach Dorothy's memory.

### Lighter alternatives

With two conversations so far, a dedicated discriminative model plus a
supervising agent may be more machinery than the corpus needs. Some simpler
options:

1. **One structured-output pass on a schedule.** Run the same LLM with a
   tag-taxonomy prompt as a nightly script for deep tagging and tag-document
   updates. Add a classifier only once the tag set stabilises and volume
   justifies it.
2. **Path-style tag names**, such as `dorothy/tui/render`. Each segment stays
   at 12 characters or fewer, you get the hierarchy without parent/children
   tables, and FTS prefix queries work on it directly.
3. **The Hermes shape first.** Start with curated per-topic Markdown plus FTS
   session search. Add frecency tiers only once the title-only list starts to
   strain the context budget.

### Sources

- [Mastra: Observational Memory](https://mastra.ai/docs/memory/observational-memory)
- [Mastra: Message history (title generation)](https://mastra.ai/docs/memory/message-history)
- [Mastra releases](https://github.com/mastra-ai/mastra/releases)
- [Mastra PR #23791: pinned thread titles](https://github.com/mastra-ai/mastra/pull/23791)
- [Mastra repository and licensing](https://github.com/mastra-ai/mastra)
- [claude-mem: Architecture Evolution](https://docs.claude-mem.ai/architecture-evolution)
- [claude-mem: Architecture Overview](https://docs.claude-mem.ai/architecture/overview)
- [claude-mem repository](https://github.com/thedotmack/claude-mem)
- [Termdock: claude-mem progressive disclosure](https://www.termdock.com/blog/claude-mem-persistent-memory-claude-code)
- [Letta TypeScript SDK](https://docs.letta.com/api/typescript)
- [Letta: Shared memory](https://docs.letta.com/v1-sdk/memory/shared-memory)
- [Hermes Agent: Persistent Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)
- [Hermes Agent docs mirror](https://github.com/mudrii/hermes-agent-docs)
- [Mem0: Configure the OSS stack](https://docs.mem0.ai/open-source/configuration.md)
- [Basic Memory research report](https://github.com/akitaonrails/ai-memory/blob/main/docs/research-basic-memory.md)
- [SKILL.md structure (Agent Skills spec)](https://atlan.com/know/ai-agent/ai-agent-skills/skill-md-file-explained/)
- [Firefox ranking: frecency](https://firefox-source-docs.mozilla.org/browser/urlbar/ranking.html)
- [Firefox ranking (legacy)](https://firefox-source-docs.mozilla.org/browser/urlbar/ranking-legacy.html)
- [Claude memory tool](https://platform.claude.com/en/docs/agents-and-tools/tool-use/memory-tool)
- [LangChain.js Anthropic memory tool](https://docs.langchain.com/oss/javascript/integrations/tools/anthropic)

---

## chewygumxx Prompt 2

I conferred with ChatGPT with respect to the matter and would appreciate your
perspective.

[Attached File](./2026-10-05_claude-conversation-memory-metadata.md)

---

## Claude Response 2

I'll check the projects and claims ChatGPT raised that I didn't cover, then
give you my take.

### Short version

ChatGPT's framing is sound. It treats Dorothy's memory as an indexing and
retrieval problem rather than an "AI memory package", and its terminology
answers are mostly right.

Where I'd push back is the package shortlist. Several entries are weaker than
presented, and one is double-counted. I'd also add three things it missed:

- **GraphRAG**, a near-exact precedent for your lost relation design.
- **SKOS**, the established standard for your hierarchical tags.
- **The two dot products** you're probably remembering. ChatGPT's formulas also
  didn't survive the copy into your notes.

### Corrections to the package list

- **pi-mem is not a separate discovery.** It's a fork of claude-mem adapted for
  pi-agents. The progressive-disclosure document ChatGPT quoted is claude-mem's
  own doc carried over, so the "eerily aligned" second project is the first one
  counted twice.
- **agent-memory (ivanzwb) as "the best TypeScript starting point" is
  generous.** It's MIT-licensed with 3 stars, no forks and 21 commits: a
  single-maintainer project, risky to put under a core subsystem. One pattern in
  it is worth borrowing, though. Knowledge-base hits are injected as title,
  excerpt and reference ID only, and the model calls `knowledge_read(id)` to
  load the full content.
- **sqlite-memory isn't a TypeScript module.** It's an MIT-licensed SQLite
  extension with hybrid vector-plus-FTS5 search and content-hash change
  detection, and it requires the sqlite-vector extension. That dependency
  matters for a GPL-3.0-only project. sqlite-vector is free only when used in a
  project under an OSI-approved licence; everything else falls under the Elastic
  License 2.0. Dorothy qualifies, but it would put a source-available component
  in a GPL stack. sqlite-vec is the Apache/MIT-licensed alternative.
  sqlite-memory also has no concept of conversation metadata; it chunks and
  searches.
- **The frecency package is the wrong shape.** It ranks search results per
  query string from recent selections, stored through the Web Storage API.
  Dorothy needs query-independent frecency to decide what stays in context,
  which is a few lines of SQL following Firefox's formula. ChatGPT said it
  "doesn't need reinventing"; I'd say it's too small to bother importing.

### What ChatGPT found that I missed

**OpenAI Agents SDK memory** is a genuinely good find, and it exists in the JS
SDK too. It injects `memory_summary.md` at the start of a run, searches
`MEMORY.md` when prior work looks relevant, and opens per-session summaries
only when it needs more detail. When the session closes, it extracts
conversation summaries and raw memories, then consolidates them into
`MEMORY.md` and `memory_summary.md`. That's your _Conversation Event_ versus
_Cyclical Period_ split.

The catch is that it's tied to sandbox agents: the memory capability requires
the Shell capability. Borrow the lifecycle, not the runtime.

While checking ChatGPT's agent-memory pick, I also turned up an unrelated
project with the same name, **axiomhq/agent-memory**. It's a TypeScript/Bun
project whose disclosure step inlines hot memory, lists warm memory, and omits
cold memory. That is your tiered-decay scheme almost verbatim, with abstract,
then title, then absent.

### Your lost relation metadata already exists: GraphRAG

Microsoft's GraphRAG matches the design you shelved, and it also covers your
tags and Topic Overviews:

| Dorothy concept                        | GraphRAG equivalent                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Relation with description and strength | Each relationship carries an LM-derived description, and its weight is summed from an LM-derived strength measure for each instance |
| Hierarchical tags                      | Communities are strictly hierarchical, with parent, children, level and a friendly title                                            |
| Topic Overview                         | Each community's contents are summarised into a generated report for human reading and downstream search                            |
| Progressive disclosure                 | A reader can scan community summaries at one level, then read linked lower-level reports for subtopic detail                        |

It's Python, expensive to index, and built for entity-level graphs over large
corpora, so don't adopt it. The useful takeaway is that a tag hierarchy can
eventually _emerge_ from clustering rather than being assigned by hand. That's
a later option, not something to build now.

Two practical lessons from it:

- **Derive strength from evidence, not from a model's guess.** An LLM asked for
  "0.87" is poorly calibrated. GraphRAG accumulates strength across repeated
  instances. For Dorothy, count how many conversations support a relation and
  weight that by recency.
- **Generate relation candidates sparsely.** Pairwise relations grow as n². Let
  FTS or embedding top-k propose candidates, and only ask the LLM to describe
  those.

ChatGPT is right that SQLite is enough, and recursive CTEs cover traversal:

```sql
CREATE TABLE tag (
    id          INTEGER PRIMARY KEY,
    pref_label  TEXT NOT NULL UNIQUE,         -- skos:prefLabel, ≤ 50 chars
    scope_note  TEXT,                         -- skos:scopeNote (your tag description)
    broader_id  INTEGER REFERENCES tag(id)    -- skos:broader; children are just a query
);

CREATE TABLE tag_alt_label (                  -- skos:altLabel, absorbs synonyms
    tag_id  INTEGER NOT NULL REFERENCES tag(id),
    label   TEXT NOT NULL UNIQUE
);

CREATE TABLE relation (
    source_id    TEXT NOT NULL,
    target_id    TEXT NOT NULL,
    description  TEXT,
    evidence     INTEGER NOT NULL DEFAULT 1,  -- strength derives from this
    PRIMARY KEY (source_id, target_id)
);

-- all ancestors of a tag, no graph database required
WITH RECURSIVE ancestors(id, depth) AS (
    SELECT broader_id, 1 FROM tag WHERE id = :tag AND broader_id IS NOT NULL
    UNION ALL
    SELECT t.broader_id, a.depth + 1
    FROM tag t JOIN ancestors a ON t.id = a.id
    WHERE t.broader_id IS NOT NULL
)
SELECT id, depth FROM ancestors;
```

Since you suspect the relation-object design may be over-engineered for now,
here are lighter paths:

1. **Don't store relations; compute them.** Use embedding similarity plus
   shared tags at query time, and persist an edge only when Dorothy or you
   explicitly assert one.
2. **Let Topic Overviews carry the "why".** An overview's prose already
   describes how its member conversations relate, so per-edge descriptions
   largely duplicate it. Store edges as typed pairs with an evidence count.
3. **Defer until there are roughly 50 conversations.** Before then, title-level
   FTS will surface everything relevant anyway.

### The dot product you remember

You're probably remembering one of two real things, and both involve dot
products.

The first is **embedding retrieval**. Cosine similarity is `cos θ = (a·b) /
(‖a‖‖b‖)`. OpenAI's embeddings are L2-normalised to length 1, so cosine
similarity reduces to a plain dot product and ranks identically to Euclidean
distance. This is what ChatGPT described, and it's what Dorothy's semantic
search would use.

The second is **attention**, which is the one that actually concerns
_inference_. The transformer architecture behind GPT and Claude alike computes
`Attention(Q, K, V) = softmax(QKᵀ / √dₖ) V`. Each token's query vector is
dot-producted with every other token's key vector, giving a numerically scaled
strength of relation between every pair of tokens in context. This is
recomputed on every forward pass and never stored.

That makes your shelved design a persistent, explicit, human-readable cousin of
what attention does transiently. ChatGPT gestured at "attention/representation
spaces" but didn't make that connection.

### Terminology

#### The nexus page you were describing

"Topic Overview" is a good name, and I'd keep it. The established terms for
exactly what you described, a page whose prose weaves dozens of links into
context, are:

- **Summary style** is Wikipedia's own name for it. A parent article summarises
  each subtopic in prose and points to a detailed "Main article". This is
  probably the image you had in mind.
- **Bibliographic essay** comes from library science. It's a narrative essay
  discussing sources on a subject, as distinct from an _annotated
  bibliography_, which is a list with notes.
- **Pathfinder** or **subject guide** is the librarian's curated guide to
  resources on a topic.
- **Hub**, in Kleinberg's HITS sense, which ChatGPT correctly cited.

So: a Topic Overview, written in summary style.

#### MOC, evergreen notes and tables of contents

Your scepticism is about two-thirds right.

- **Map of Content** is mostly a rebrand. It was popularised through Nick
  Milo's _Linking Your Thinking_, which is indeed a paid course. Functionally
  it's a structure note: Luhmann's Zettelkasten had those decades earlier,
  alongside a keyword register, and libraries had subject guides before that.
- **Evergreen notes** (Andy Matuschak) are a genuinely different idea. The
  concept concerns the _unit_ of a note: atomic, concept-oriented, densely
  linked, and revised over time. It isn't a navigation structure at all. In
  Dorothy's terms it maps to individual memories or facts, not hubs, so it
  doesn't belong in the same comparison as MOCs and TOCs.
- **A table of contents** is ordered navigation of a single work.

#### The conventional specification for your tags

Hierarchical tags with descriptions are a **controlled vocabulary**. The
standards are ISO 25964 and ANSI/NISO Z39.19, and W3C **SKOS** (a W3C
Recommendation since 2009) is the machine-readable form:

- `prefLabel` is the tag name.
- `altLabel` holds synonyms, which your cyclical re-tagging will need for
  merging near-duplicates.
- `broader`, `narrower` and `related` give the hierarchy and cross-links.
- `scopeNote` or `definition` is your tag description.

Adopting those names costs nothing and makes the tag table exportable. I used
them in the schema above.

### Combined verdict

My earlier recommendation stands: **Mastra** to import, and **claude-mem** as
the schema blueprint. From ChatGPT's list I'd add the **OpenAI Agents SDK's
summary → extract → consolidate lifecycle** as a design reference. I'd add
**GraphRAG** and **axiomhq/agent-memory** as references for relations and
tiering, and **SKOS** naming for tags. I'd drop pi-mem (duplicate), the
frecency package (wrong shape), and sqlite-memory as a dependency (C extension
with a source-available dependency).

### Sources

- [claude-mem fork notice (pi-mem)](https://github.com/ArtemisAI/pi-mem)
- [ivanzwb/agent-memory](https://github.com/ivanzwb/agent-memory)
- [axiomhq/agent-memory](https://github.com/axiomhq/agent-memory)
- [sqliteai/sqlite-memory](https://github.com/sqliteai/sqlite-memory)
- [sqliteai/sqlite-vector licence](https://github.com/sqliteai/sqlite-vector/blob/main/README.md)
- [Hacker News: sqlite-vector licensing discussion](https://news.ycombinator.com/item?id=45347619)
- [mixmaxhq/frecency](https://github.com/mixmaxhq/frecency)
- [OpenAI: Sandbox Agents (memory)](https://developers.openai.com/api/docs/guides/agents/sandboxes)
- [OpenAI Agents SDK: Agent memory](https://openai.github.io/openai-agents-python/sandbox/memory/)
- [GraphRAG: Outputs](https://microsoft.github.io/graphrag/index/outputs/)
- [GraphRAG: Indexing dataflow](https://microsoft.github.io/graphrag/index/default_dataflow/)
- [From Local to Global: A Graph RAG Approach (arXiv)](https://arxiv.org/pdf/2404.16130)
- [OpenAI Embeddings FAQ](https://help.openai.com/en/articles/6824809-embeddings-frequently-asked-questions)

---

## chewygumxx Prompt 3

Were you to compose a plan in preparation for composition of specification for
implementation of Dorothy's memory metadata and management, what would that
plan outline?

---

## Claude Response 3

### Approach

I'd treat the specification as the _output_ of a decision process, not the
place where decisions get made. Most hard questions in your notes are
trade-offs: when a conversation "concludes", who writes the metadata, how decay
interacts with compaction. Each is cheaper to settle as a short decision record
than inside a monolithic spec.

So the plan runs: inventory → principles → decisions → measurements → spec
outline → milestones.

### 1. Inventory what exists

Write down the current state first, because the spec has to build on it:

- **Transcripts**: their format and location, whether each conversation has a
  stable ID, whether they're append-only, and whether they're git-tracked.
- **Runtime**: Bun or Node, which SQLite binding, and whether FTS5 is compiled
  in.
- **Models**: which providers and models Dorothy runs on, their context window
  sizes, structured-output support, and prompt caching.
- **TUI seams**: where a turn is appended, where the system prompt is
  assembled, and whether background work can run without blocking input.
- **Constraints**: dependencies must be compatible with GPL-3.0-only. That
  rules out source-available components such as sqlite-vector.

### 2. Fix scope and principles

**Goals:** single user, local-first. **Non-goals for v1:** multi-user sync,
graph database, embeddings, relations.

These are the principles every later decision gets checked against:

1. **Four classes of state.** Your "rebuildable database" principle needs one
   refinement, because only some state is truly derivable:
   - _Canonical_: transcripts.
   - _Authored_: your edits, pins, manual tags and forget requests. None of this
     can be regenerated from transcripts, so it must be stored canonically
     too.
   - _Generated_: model-written titles, abstracts, tags and overviews.
     Regenerating these is nondeterministic and costly, and a model upgrade
     would silently rewrite Dorothy's memory. Persist them with provenance
     rather than regenerating them on rebuild.
   - _Derived_: the FTS index, frecency scores, tier assignments and tag
     closure. These are deterministic and safe to delete and rebuild.
2. **Provenance on every generated value**: author, model, timestamp and source
   turn range.
3. **Memory is data, never instructions.**
4. **Visible, editable, forgettable.** You can see, correct or remove anything
   Dorothy remembers.
5. **Bounded and stable context cost.**
6. **Never block the TUI.**

### 3. Decisions to record before drafting

Each of these becomes a short ADR (architecture decision record):

| Decision                                 | Main options                                                                              | Hinges on                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Build or adopt                           | Mastra Observational Memory; own implementation; hybrid                                   | How much prompt assembly you want to own                   |
| Where generated and authored state lives | Sidecar metadata file per conversation; SQLite as canonical                               | Git-diffable memory vs. query convenience                  |
| Identifiers                              | UUIDv7; date-slug like your notes                                                         | Sortability vs. readability                                |
| How Dorothy authors metadata             | Structured block appended to her response; separate call sharing the cached prompt prefix | Stream-parsing complexity vs. an extra call                |
| Successive-response cadence              | Every turn; every N turns; on topic shift; on idle                                        | Cost vs. freshness (measured in §4)                        |
| What "conclusion" means                  | Idle timeout; explicit command; next conversation starts; TUI exit                        | Conversations can resume, so conclusion must be re-entrant |
| History retention                        | Title array (as noted); old descriptions and abstracts discarded or kept in VCS           | Whether runtime ever needs old abstracts                   |
| Context budget                           | Fixed tokens; share of window; shrinking as the conversation grows                        | Interaction with compaction (below)                        |
| Frecency inputs                          | Which events count as an access: recall, opening, mention, pin                            | Firefox-style weighted buckets                             |
| Tag hierarchy                            | Single parent; poly-hierarchy (SKOS allows both)                                          | Closure-query and overview complexity                      |
| Cyclical roles                           | Discriminative classifier plus supervisor; single LLM pass                                | Corpus size                                                |
| Compaction                               | Trigger threshold, summary shape, raw-range recall                                        | Mastra's retrieval mode as reference                       |
| Retrieval surface                        | Native tools; MCP server; both                                                            | Whether other clients need Dorothy's memory                |

One decision resolves two of your open questions at once: **re-tier the memory
block only at compaction boundaries.**

Re-tiering and compaction both rewrite the context, and both invalidate the
prompt cache. Aligning them means the cache breaks once instead of twice. It
also gives you "extra-conversational memory decays as the conversation grows"
for free: each compaction recomputes the memory budget from whatever is left of
the window.

### 4. Measure before committing numbers

Two conversations can't tune anything. The first artefact is a **fixture
corpus**: your real transcripts plus synthetic ones covering short chats, long
technical sessions and topic drift. Then measure:

- **Token sizes** of titles, descriptions and abstracts. This tells you how
  many conversations fit at each tier for a given budget.
- **Title stability**: how often a per-turn review changes the title. This
  decides the update cadence.
- **FTS5 tokeniser choice** (unicode61, porter, trigram), tested against
  realistic queries.
- **Frecency behaviour** on synthetic access logs. Use this to set
  _hysteresis_: an item enters a tier at a higher score than it leaves, so
  items near a boundary don't flip every session.
- **Extractor quality** with Dorothy's actual model, for example in a Mastra
  spike run on the fixtures.
- **Memory-block placement** in the prompt, and its effect on cache hit rates.

### 5. Outline of the specification

1. **Introduction**: purpose, scope and conformance language.
2. **Terminology**: conversation, transcript, turn, metadata tier, tag, topic
   overview, pin, access event, compaction, recall.
3. **State and storage**: the four state classes, the file layout and the
   rebuild procedure.
4. **Data model**:
   - Entities: Conversation, TitleRevision, Tag, TagAssignment (shallow or deep,
     with provenance), TopicOverview, AccessEvent and Pin, with Relation
     reserved for later.
   - Field constraints, such as tag names of at most 50 characters (12
     preferred).
5. **Lifecycle and triggers**:
   - A state machine and event table covering first prompt, first response,
     successive responses and conclusion.
   - Fallbacks for when the model is unavailable, including the provisional
     title and queued resubmission.
6. **Authorship and provenance**: who may write each field, and the precedence
   order. Your edits and pins beat Dorothy's; Dorothy's beat the background
   agents'.
7. **Context assembly**: tiers, the ranking formula, which tags appear in
   constant context, the budget, hysteresis, pin override, placement, and the
   exact injected format.
8. **In-conversation compaction and recall.**
9. **Retrieval tools**: signatures, result shapes and limits. Dates and deep
   tags live here rather than in constant context.
10. **Cyclical maintenance**: jobs, schedule, supervision, idempotency and cost
    caps.
11. **Tag governance**: naming rules, synonyms, and how tags are merged, split
    or retired.
12. **Topic overviews**:
    - Format, mandatory citations to conversation IDs, epistemic status, and
      regeneration rules.
13. **User control**: review, edit, pin and forget. Forgetting must propagate
    through transcript, generated metadata, index and frecency. Overviews that
    cite the forgotten conversation must be rewritten, because their prose still
    carries its content.
14. **Security**: memory is injected as quoted data. Instruction-like text in a
    transcript must not gain system-prompt authority by being carried into a
    summary.
15. **Non-functional requirements**:
    - Latency, cost and licensing.
    - Offline behaviour: FTS must keep working without a model.
16. **Evaluation and testing.**
17. **Versioning and migration.**
18. **Deferred work**: relations, embeddings, graph.

**Appendices:** JSON Schema for the metadata, SQL DDL, prompt templates, and a
worked example built from your two existing conversations.

### 6. Slice into milestones

| Milestone | Delivers                                                              | Activates sections              |
| --------- | --------------------------------------------------------------------- | ------------------------------- |
| M0        | Conversations table, IDs, FTS over transcripts (no model involvement) | 3, 4 (partial), 9 (search only) |
| M1        | Conversation-event metadata with title history and provenance         | 5, 6                            |
| M2        | Context assembly with tiers, pins and budget                          | 7                               |
| M3        | Retrieval tools and in-conversation compaction                        | 8, 9                            |
| M4        | Shallow tagging at conclusion, plus a review UI                       | 11, 13                          |
| M5        | Cyclical maintenance and topic overviews                              | 10, 12                          |
| M6        | Relations and embeddings, only if evaluation shows FTS falling short  | 18                              |

Each milestone's acceptance criteria are written as tests against the fixture
corpus.

### 7. Process and artefacts

```text
docs/
    spec/
        memory.md                  # normative
    adr/
        0001-state-classes.md
        0002-metadata-authorship.md
    notes/                         # exploratory, as now
fixtures/
    memory/
```

- Track each spec section's status: draft, accepted, implemented.
- Have Dorothy review the injected-context format and the tool descriptions.
  She is their only consumer, and whether she reads them correctly is something
  you can test.
- The spec is done when every MUST maps to a test, and every open question is
  either an accepted ADR or listed under Deferred.

### Conventions worth adopting

- **BCP 14** (RFC 2119 plus RFC 8174) for MUST, SHOULD and MAY.
- **ADRs** in Michael Nygard's format: context, decision, consequences.
- **RFC 9562 UUIDv7** for time-ordered IDs, and **RFC 3339** for timestamps.
- **SKOS** vocabulary for tags.
- **JSON Schema** to validate metadata, with **SemVer** for the schema version.
- **ISO/IEC/IEEE 29148** if you ever want a formal requirements structure. It's
  probably more than Dorothy needs.

### If this is heavier than Dorothy needs yet

1. **Specify only what's next.** Write sections 1–7 normatively and leave the
   rest as ADR stubs. Later sections will be better informed by real usage.
2. **Prototype first, specify second.** Spike M1–M3 on the fixture corpus
   (Mastra makes this quick), then write the spec from whatever survived.
3. **Make the spec executable.** Keep a single `SPEC.md` where each MUST
   carries an ID that a test references, so the spec and test suite grow
   together and can't drift.

I can write this up as a note in your `docs/notes` format, or draft the first
batch of ADR stubs from the decisions table.

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
