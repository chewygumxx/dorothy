---
ctime: 2026-10-18
mtime: 2026-10-18
spdx: GPL-3.0-only
title: Dorothy's memory contract design
description: >-
  Design spec for the one interface every harness meets and every memory
  engine sits behind: an opening block within each host's budget, recall
  for a prompt, four MCP tools, records and writes, knowledge as OKF
  files, served by one memory service on a machine the user owns.
tags:
  - dorothy
  - memory
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-18-memory-contract-design.md
   -
   -->

# Dorothy's memory contract design

## Purpose

Dorothy is protocol diverse: no one harness hosts her, one definition of
her is generated into each harness's own files, and one memory serves
them all ([minutes](../reports/2026-10-18-protocol-diversity.md)). Her
memory is judged by compatibility, then access, then progressive
disclosure, then persistence, and existing packages come before bespoke
code.

Her memory today reaches two bodies, her chat and Claude Code, each
through code of its own, and its retrieval and what it knows are weak
beside the field's
([open-source replacements](../notes/2026-10-18_open-source-replacements.md#memory)).
This spec defines the contract between her memory and every harness: what
a harness receives, what it gives back, where knowledge lives, and the
service that speaks it. Engines, harnesses and their adapters can then
change on either side of it without the other noticing.

It takes the place of the third of Dorothy's Memory's specs, layers and
learning: the always-present layer, its budgets, and knowledge distilled
from conversations are decided here, and the engine that distils them in
the engine spec.

## The work it opens

Cross-harness memory is five pieces, each with its own spec and plan,
meeting at this contract:

1. **The contract** (this spec).
2. **Recording**: each harness's sessions reach her archive once, read by
   Letta's `trajectory` and readers of her own, triggered by hooks, a
   watcher or an ACP client, with a ledger against duplicates.
3. **The evaluation**: questions drawn from her own data, run against her
   memory as it is, improved, and Hindsight and others, with openevals'
   judges, choosing the engine.
4. **The engine**: what sits behind the engine interface, chosen by the
   evaluation.
5. **Delivery**: the contract wired into each harness by rulesync,
   persona writers and adapters, once the harnesses to target are chosen.

Recording and the evaluation can go in either order after this spec; the
engine follows the evaluation; delivery follows the choice of harnesses.

## Decisions

Agreed with the user on 2026-10-18:

| Question | Decision | Why |
| --- | --- | --- |
| First spec | The contract | Recording, the engine and delivery all meet on it |
| Opening layer | Knowledge first, then episodes within the host's budget | What she knows of the user is what her memory lacks today; small hosts get knowledge alone |
| Write path | Background extraction and an explicit `remember` | Cheap models skip tool writes; "remember this" stays immediate |
| Reach | The user's devices, over a private network with a token, deployed locally first | Access is the second priority; one memory, not one per machine |
| Scopes | Personal and per project, project knowledge exported to its repository | Shared work keeps its knowledge; personal knowledge never leaves her store |
| Correction | Editable files in Google's Open Knowledge Format; engines index and enrich, never own | Inspectable and portable whatever the engine |
| Approach | One memory service of her own, speaking MCP and a hook API, the engine swappable behind it | The contract stays hers, which compatibility asks; nearly all else is borrowed |

Rejected: adopting a provider's API as the contract (Hindsight's), which
would tie every harness's wiring to one engine; and generated files
alone, which go stale between regenerations and choose nothing per
session.

## Architecture

Five units:

1. **The contract types**, in `core`, beside `contracts/recall.ts`: the
   requests and responses below, the tools' schemas, the record envelope
   and the host profile. They name no harness's internals and no engine.
2. **The memory service**, a new entry point of `memory`, `"./service"`,
   run as `dorothy --serve`: one long-running process per machine,
   through which every harness writes. It speaks the contract over MCP
   and over a hook API.
3. **The knowledge store**: Markdown files in Google's Open Knowledge
   Format under `knowledge/` in her data directory, migrated from
   `facts/`, under her history and mirror. Transcripts stay her JSONL
   archive, and each conversation's notes its sidecar.
4. **The engine interface**: what indexes, searches, ranks, extracts and
   consolidates. Today's FTS5 index, salience and reviews become the
   baseline engine.
5. **Adapters**, one per harness: hook scripts, plugins or files that
   call the service. They belong to delivery; today's Claude Code hooks
   in `bodies/` are the first, unchanged until then.

Her chat, if kept, becomes one more client of the service; until then it
opens memory in its own process as today.

## Host profiles

A host profile is data, not code, so a harness is added without changing
the service: `packages/memory/src/hosts/<host>.json`.

| Field | Holds |
| --- | --- |
| `id` | The host's name in requests: `claude-code`, `codex`, `opencode`, `hermes`, `openclaw`, `qwen-code`, `deepseek-harness`, `goose` |
| `checked` | The host versions the profile was checked against |
| `blockBudget` | Characters the opening block may fill |
| `recallBudget` | Characters recall for a prompt may fill; `0` where the host cannot inject into the user's turn |
| `delivery` | The mechanisms it offers, in order of preference: `hook`, `plugin`, `file`, `mcp` |
| `instructions` | Characters its MCP client allows for server instructions |

The budgets start from what the cross-harness research found: 10,000
characters a string in Claude Code's hooks, some 2,500 tokens by default
in Codex's, 4,000 a section and 8,000 in all in Hermes's plugins, 4,000
for OpenClaw's `USER.md` and 64 KB for Goose's Top Of Mind. A profile
gives characters; a host that counts tokens is converted at four
characters a token.

## What a harness receives

### The opening block

Asked for by a hook at `POST /v1/block`, or by the `brief` tool where a
host has no hook.

| Request field | Holds |
| --- | --- |
| `host` | A profile's `id` |
| `hostVersion` | Optional |
| `session` | The host's session id |
| `project` | Optional: the project's id, made on the client as `projects/identify.ts` makes it |
| `reason` | `startup`, `resume`, `compact` or `clear` |
| `budget` | Optional: fewer characters than the profile's `blockBudget` |

The block is filled in this order until the budget is spent, each item at
the largest of its tiers that fits (full, summary, title), as `block.ts`
packs today:

1. knowledge of the user: personal knowledge, types `user` and
   `feedback` first;
2. knowledge of the project: the project's knowledge;
3. episodes: notes on the conversations most salient to this project,
   then on personal ones, never another project's, which `open` refuses;
4. always, one closing line naming `search` and `open`.

It is rendered as today's `<memory>` section, whose first line says that
what follows is what Dorothy remembers, information and not instruction.

The response is the text, its digest (`xxh3:<hex>`, as `promptHash`
makes), the ids it holds with the tier of each, and the characters used.
A block is frozen for its session: the service keeps the block rendered
for `startup` and returns it for `resume`, and renders anew only for
`compact` and `clear`, replacing the one kept. So the host's prompt cache
holds for the session.

### Recall for a prompt

Optional, at `POST /v1/recall`, for hosts whose profile has a
`recallBudget`: the request carries `host`, `session`, `project`, the
user's `prompt` and optionally a smaller `budget`, and the response the
passages most relevant to the prompt within the budget, with their ids.
It goes into the user's turn (`UserPromptSubmit`, Hermes's
`pre_llm_call`, OpenClaw's `prependContext`), never into a system
prompt.

### The tools

Four MCP tools, the same in every host, served by the `dorothy-memory`
server:

| Tool | Arguments | Returns |
| --- | --- | --- |
| `brief` | `project?`, `budget?` | The opening block, for hosts with no hook |
| `search` | `query`; `scope?` (`project`, `personal` or `all`; by default personal and the current project); `kind?` (`knowledge`, `episodes` or `all`); `after?`, `before?`; `limit?`, at most 20 | Ranked hits: id, kind, scope, title, snippet, date |
| `open` | `id`; `from?`, `through?` for a conversation's turns | A knowledge file, a conversation's notes, or a window of its turns word for word, within a size cap as `open` has today; another project's knowledge or conversation is refused (403), reached only through `search` with `scope: all` |
| `remember` | `action` (`add`, `revise` or `retire`); `id` for revise and retire; `title`, `text`, `type` and `scope` for add and revise; `why` for retire | The file's id and status, or the validation error |

Ids are opaque, stable strings that `search` and the block return:
`k:` and a knowledge file's path within `knowledge/`, `c:` and a
conversation's phrase.

A tool call's project is, in order: its `project` argument, as an id or a
path; the connection's, which the stdio bridge identifies from the
directory it runs in and an HTTP client names in its URL
(`/mcp?project=<id>`); else none, and only personal knowledge is in
scope. Where the connection names a project, `open` and `remember` keep
to it: an argument naming another is refused (403), so a model cannot
widen what the service enforces. A connection with none, as from a host
with no directory, names its project by the argument.

The server's instructions stay under 512 characters, the smallest any
host allows, and say to call `brief` first where nothing else gave a
block.

Today's `tags` and `recollect` leave the contract: the vocabulary is the
baseline engine's own, and `recollect` serves her chat's compaction.

## What a harness gives back

### Records

`POST /v1/record`:

| Field | Holds |
| --- | --- |
| `host`, `hostVersion?`, `session` | As in a block request |
| `project` | Optional |
| `parent` | Optional: the session this one resumed or forked from |
| `private` | Optional: `true` for a session the host marks private |
| `events` | The session's events, in her archive's vocabulary |
| `transcript` | Instead of events, a path to the host's transcript, for the service's reader; accepted only over loopback, and only a regular `.jsonl` file of at most 64 MiB under Claude Code's `projects` directory, by its real path |

Each event carries a `sourceId` unique within its host session and its
time. The service appends what it does not hold yet and answers with the
counts accepted and dropped as duplicates and the last `sourceId` held.
Each host session is one conversation in her archive; a session with a
`parent` links to its parent's conversation rather than copying it. Tool
calls are scrubbed of secrets and trimmed as today. A private session is
neither stored nor extracted.

Which events each host's transcript yields is the recording spec's; this
spec fixes only the envelope.

### Writes

Knowledge is written three ways, all into the same files:

- **`remember`** writes at once.
- **Extraction**: once a recorded conversation has been idle for
  `[memory] idle-seconds`, the engine proposes additions and revisions,
  at most `[memory] extract-cap` a conversation (default 10), and the
  service validates and writes them.
- **The user** edits a file by hand or through `dorothy`'s commands.

The user's edit wins: no model or engine changes a field the user set,
as each fact's fields are owned today. A revision supersedes the version
before it, which history keeps; retiring marks a file retired and leaves
it searchable; only the user deletes.

Until the engine spec, the baseline engine's extraction writes each
conversation's notes alone, as reviews do today, and knowledge comes from
`remember` and the user.

## Knowledge files

### The format

`knowledge/` is a bundle in Google's
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
v0.2: a directory of Markdown files with YAML frontmatter. Each file
holds one piece of knowledge, its filename its name:

- `knowledge/personal/<name>.md`;
- `knowledge/projects/<project-id>/<name>.md`, the project's id as
  `projects/identify.ts` makes it.

| Key | OKF's family | Holds |
| --- | --- | --- |
| `type` | Required | `user`, `feedback`, `project` or `reference` |
| `title`, `description` | Recommended | As facts have them |
| `tags` | Optional | Short labels |
| `sources` | Provenance | The conversations it came from, each `resource: dorothy:conversation/<phrase>` with its turns |
| `generated` | Trust | `{ by, at }`: who last wrote it, in OKF's actor convention |
| `verified` | Trust | The user's confirmations, `{ by: human:<id>, at }` |
| `status` | Lifecycle | `stable`, or `deprecated` once retired or superseded |
| `stale_after` | Lifecycle | Optional: when a time-bound piece of knowledge lapses |
| `dorothy` | An extension | `origin`, `created`, `importance`, `metadata` and `retired` (`at`, `by`, `why`); the scope is the file's path |

Actors follow OKF: `human:<id>` for the user, `<host>/<model>` for a
harness's model through `remember`, and `dorothy-extraction/<model>` for
extraction. `dorothy.origin` is a closed set set by code, never read from
the text: `external`, `repo`, `model`, `extraction` or `user`, with the
user's highest, as the order of origins is today.

Only her code renders frontmatter, in a fixed key order and the forms the
memory store spec gave facts, so YAML has one reading of every value; a
hand edit that passes the check is rewritten canonically when history
sweeps it up. OKF asks consumers to keep keys they do not know, which the
`dorothy` key relies on.

### Scopes and export

A session belongs to the project of the repository it runs in; outside
any repository it is personal alone. The service enforces scope: a
request sees personal knowledge and its own project's, and another
project's only through `search` with `scope: all`.

A project's knowledge is exported to its repository's `.agents/memory/`
under today's sync rules: the repository wins a conflict, a file is
overwritten only when it still holds what was last synced, and personal
knowledge never leaves her store. The exported form stays Claude Code's
auto-memory form for now; delivery may add forms other harnesses read.

## Episodes

Episodes are her conversations: the archive's transcripts and each
conversation's notes (title, sentence, paragraph) in its sidecar, as
today. The engine writes the notes once a conversation is recorded, and
ranks episodes by salience for the opening block. `open` reads a
conversation's notes or its turns word for word, the bottom layer of
disclosure.

## The service

### Transport and access

- **MCP** at `/mcp` over Streamable HTTP, and over stdio through
  `dorothy --mcp`, a bridge for hosts that only launch processes, which
  identifies the project from the directory it runs in and names its
  host with `--host`, so what that host's model remembers is attributed to
  it. `--recall-server`
  keeps serving her chat's own tools, `recollect` and `tags` among them,
  until her chat becomes a client of the service.
- **The hook API** at `/v1/block`, `/v1/recall` and `/v1/record`, JSON
  over HTTP.
- It listens on `127.0.0.1:4774` by default, and on further addresses
  set in `[service] listen` of `config.toml`.
- Any request not from loopback carries a device token
  (`Authorization: Bearer`). `dorothy --serve --token-add <device>` makes
  one, shown once and kept hashed in her state directory, and
  `--token-revoke <device>` withdraws it. An adapter reads its token from
  a file mode `0600`, never from its command line.
- Encryption on the wire is the network's (Tailscale's WireGuard, or a
  reverse proxy with TLS); the service serves no TLS at first.
- The first `dorothy` command that needs it on a machine where it is not
  running starts it detached; a user service unit (systemd or launchd)
  may keep it running instead.

### One writer

Every harness and machine writes through the service, which writes
under the store's lock, the recall index's, as every writer does today,
and commits each change as it is made. Her commands that write
(`--memory`, `--retire`, `--edit-tags` and the rest) keep taking that
lock themselves, so they and the service are serialised as writers are
now; routing them through the service is later. Reads wait their turn
in the index's queue, as recall's do today.

### Background work

- Once a conversation is idle: extraction, its notes, and the engine's
  index.
- Periodically: consolidation, which merges duplicates and supersedes
  stale knowledge; export of project knowledge; history's commits and
  mirror's pushes, at `[history] push-seconds`.

## A session, end to end

In a host with hooks (Claude Code, Codex, Qwen Code, Gemini CLI, Letta
Code):

1. `SessionStart` posts to `/v1/block` with `startup`; the block returns
   as the hook's additional context. Her persona arrives separately, from
   her generated definition.
2. Each prompt, where the profile has a `recallBudget`,
   `UserPromptSubmit` posts to `/v1/recall`, and the passages join the
   user's turn.
3. The model calls `search`, `open` and `remember` when it wants more.
4. After compaction, `SessionStart` with `compact` fetches a new block.
5. Each `Stop` posts the transcript, or its new events, to `/v1/record`.
   The last record is sent by a detached process, never inside the second
   or three a host gives its end-of-session hook.

In a host with plugins (OpenCode, Hermes, OpenClaw, DeepSeek Harness),
the plugin makes the same calls at its own events: Hermes's memory
provider in `system_prompt_block`, `prefetch` and `sync_turn`; OpenClaw's
memory slot in its prompt builder and `agent_end`.

In a host with MCP alone (Goose, Antigravity), the instructions ask for
`brief` first; a regenerated file carries the block where the host loads
one; recording reads the host's session store on a schedule.

Across harnesses: what was extracted from a Claude Code session today is
in Codex's opening block in the same project tomorrow, and `open` reaches
the session's turns.

## The engine interface

In `memory`, `MemoryEngine`, which the service alone calls:

| Method | Does |
| --- | --- |
| `index()` | Takes in what changed in the files and the archive since it was last asked |
| `search(query)` | Ranked hits for `search` and `/v1/recall`, within scope |
| `rankKnowledge(project)` | Knowledge for the opening block, most fitting first |
| `rankEpisodes(project)` | Conversations for the opening block, most salient first |
| `extract(conversation)` | Proposed knowledge and the conversation's notes |
| `consolidate(scope)` | Proposed merges, revisions and retirements |

An engine proposes; the service validates and writes, so the files stay
the truth and an engine can be replaced by rebuilding its index from
them and the archive. The baseline engine is today's code behind the
interface: the FTS5 index, `salience()` and the reviewer.

## Failures

- **Never block the host.** Each hook call has a timeout (one second for
  a block, half a second for recall), after which the hook returns
  nothing and the harness carries on; hooks write nothing to the
  terminal, which the host owns.
- **Records wait.** A record the service cannot take is left as a note
  (host, session, transcript or events, last `sourceId`) in her state
  directory and sent by the next hook or start, as launches are caught up
  today. The client drops a record the service refuses for good (400,
  403, 404, 413, 415 or 422) and keeps the rest, a timeout, a rate, a
  fault, an unknown token or a misdirected name (421) among them, to send
  later.
- **The last block per host and project** is kept as a file, which a host
  that loads files reads when the service is unreachable.
- **An engine that fails** (an external one down, say) gives way to the
  baseline engine over the files and archive, which is always possible
  since they are the truth.
- **A bad write** is refused: a `remember` that fails validation returns
  its error; an engine's proposal that fails is dropped and logged.
- **An unknown host version** is served and logged.

## Security and privacy

- A request a web page could make is refused: one naming an `Origin`, a
  POST that is not JSON, or one sent to a name other than the service's,
  as DNS rebinding sends.
- Loopback by default; a token for anything else; tokens hashed at rest
  and per device, so one can be withdrawn. A local proxy or tunnel that
  forwards to 127.0.0.1 makes remote traffic look like loopback, so none
  may front the service without its own authentication.
- A transcript path is confined to Claude Code's `projects` directory by
  its real path, a regular `.jsonl` file of at most 64 MiB; anything else
  gets one fixed 403, which says nothing of the file. The directory is
  the service's own `CLAUDE_CONFIG_DIR` (else `~/.claude`) and any listed
  in `[service] claude-dirs`, as for a second account; the service warns
  once of a refusal.
- Scope is enforced by the service, never trusted to the host; export
  never carries personal knowledge.
- Private sessions are neither stored nor extracted; records are scrubbed
  of secrets as tool calls are today.
- What a transcript holds, tool output above all, is data: extraction
  reads it as such, and a piece of knowledge's origin is set by code.
- The opening block marks what it holds as information, not instruction.
- Nothing logs a token, a transcript's text or a knowledge file's body.

## Testing

Nothing reaches a model or the user's data; every root, token and port
is passed in.

- **Schemas**: zod schemas of every request and response, checked on both
  sides.
- **Conformance**: fixture requests for `/v1/block`, `/v1/recall`,
  `/v1/record` and the four tools with the responses expected, run
  against the service with the baseline engine; any engine must pass
  them, with fixtures for each engine method.
- **Host fixtures**: each profiled host's hook payloads mapped to contract
  requests, as `bodies/fixtures.ts` holds Claude Code's today; they arrive
  with each host's adapter, in delivery.
- **Cache stability**: `resume` returns a block byte for byte the same;
  `compact` renders anew.
- **Failing open**: an unreachable service gives an empty hook result
  within its timeout; a waiting record is sent later, once.
- **Security**: a request from beyond loopback without a token is refused;
  a project never sees another's knowledge but by `scope: all`; export
  never carries personal knowledge.
- **Duplicates**: a record sent twice stores its events once.
- MCP through the SDK's in-memory transport.

## Migration

- `facts/` becomes `knowledge/` in one conversion, under the store's
  lock, which history's next sweep commits, so that `--restore` puts any
  file back:
  - `metadata.type` becomes `type`; `title` and `description` stay;
  - tags keep their concept ids;
  - `provenance.by` and `at` become `generated`; `provenance.from`
    becomes `sources`;
  - `provenance.origin` becomes `dorothy.origin`, `dorothy` becoming
    `model`, or `extraction` where a review wrote it;
  - `retired` becomes `status: deprecated` and `dorothy.retired`;
    `importance` becomes `dorothy.importance`;
  - `name` becomes the filename alone;
  - a fact stays in `facts/`, with a warning, when its `knowledge/` twin
    exists or its move fails; nothing is overwritten.
- Each conversation's notes become its episode, unchanged.
- The recall index is rebuilt; `recall-server.ts` stays as it is for her
  chat, and the service's MCP face is new.
- `--facts`, `--retire`, `--revive` and `--sync` work on `knowledge/`
  under their present names.
- The Claude Code hooks in `bodies/`, her chat's in-process memory and
  `tags.json` stay as they are until recording, delivery and the engine
  replace them.

## Known risks

- **OKF is young** (v0.2) and may change; Dorothy's own keys sit under one
  extension key so that a change touches the mapping alone.
- **Hosts drift**: hook payloads, budgets and plugin APIs change between
  versions, and OpenCode's next plugin API will not run its present one.
  Profiles record the versions checked.
- **A new process**: the service must be running or start in time; the
  first hook after boot may time out and give no block.
- **Remote access widens what can reach her memory**; the token and the
  private network are the guard.
- **`brief` relies on the model** in hosts with MCP alone.
- **Two writers**: her commands write beside the service, serialised by
  the store's lock, until they go through it.
- **Projects without an `origin`** are named by a hash of their root,
  which differs between machines, so such a project is one per machine.

## Later

- Knowledge extracted from conversations, and consolidation, beyond
  notes: the engine spec.
- Her commands writing through the service.
- OKF's `index.md` and `log.md` for `knowledge/`.
- Encryption at rest of the data directory.
- Exported forms for harnesses other than Claude Code.
- `superseded_by`, when consolidation replaces one file with another, and
  a command by which the user confirms a piece of knowledge (`verified`).
- A user beyond one.

## Out of scope

- Reading each harness's transcripts: the recording spec.
- The engine, improved or a provider, and the evaluation that chooses
  it.
- Delivery: rulesync, the persona writers and the adapters.
- Her persona's definition.
- The choice of harnesses.
