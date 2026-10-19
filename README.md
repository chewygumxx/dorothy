---
ctime: 2026-09-29
mtime: 2026-10-19
spdx: GPL-3.0-only
title: "dorothy"
description: "Conversational LLM interface"
tags:
  - llm
  - chatbot
  - dorothy
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/README.md
   -
   -->

# dorothy

Conversational LLM interface

Dorothy is a conversational assistant in the spirit of <https://claude.ai>,
built for now on the Claude Agent SDK with a custom system prompt. A later
iteration moves to Anthropic's Messages API.

## Prerequisites

- Bun >=1.4
- Either an Anthropic API key or a Claude Pro/Max subscription

[mise](https://mise.jdx.dev) supplies a matching Bun version from `mise.toml`:

```sh
mise trust
mise install
```

## Installation

```sh
bun install
```

## Authentication

`.env` is committed, encrypted with [dotenvx](https://dotenvx.com), and
decrypted at startup with the private key from Dotenvx Armor (or a gitignored
`.env.keys`). Set one of the two variables `.env.example` documents, never as
plaintext:

- `ANTHROPIC_API_KEY`: pay-per-token API credits.
- `CLAUDE_CODE_OAUTH_TOKEN`: a Claude Pro/Max subscription token, minted by
  running `claude setup-token`.

```sh
bunx dotenvx set CLAUDE_CODE_OAUTH_TOKEN <token>
```

## Usage

Bun runs the source directly; there is no build step:

```sh
bun run dev -- "What is your name?"
```

`bun start` runs the same source. Either streams one reply to stdout as it is
generated, in character as Dorothy per the system prompt in
`packages/agent/src/persona.ts`. A prompt that starts with a dash follows `--`,
as in `bun run dev -- -- "-v means?"`; any other leading option is refused
rather than sent, and `--help` prints the usage.

Run with no argument for a chat in the terminal:

```sh
bun run dev
```

Enter sends and Shift+Enter starts a new line (in terminals with the kitty
keyboard protocol). Arrows, Home, End and the usual readline keys move and
edit; Up and Down past the first or last line recall earlier messages, and
Ctrl+G opens the draft in `$VISUAL` or `$EDITOR`. You can keep writing while
a reply streams; Esc or Ctrl+C stops it. Ctrl+R shows the raw SDK messages.
Ctrl+C clears the draft, then quits; Ctrl+D or `/exit` quits too.
Each reply ends with its tokens, timings, cost and what the chat has cost so
far, and the statusline under the input shows the latest of them. Each chat
is named by a four-word phrase shown in the header and saved as it happens,
readable only by you, to `~/.local/share/dorothy/transcripts/<phrase>.jsonl`
(`$XDG_DATA_HOME` if set).
Continue one with:

```sh
bun run dev -- --resume <phrase>
```

Replies stream as plain text, then render as Markdown once complete:
emphasis, lists, quotes, tables and code blocks, highlighted when labelled
with a language.

The chat needs a window of at least 40 columns and 20 lines, one more line
for each extra statusline line; a smaller one shows only how large it needs
to be. Both stats lines are set in `~/.config/dorothy/config.toml`
(`$XDG_CONFIG_HOME` if set), read at startup:

```toml
[statusline]
modules = ["chat-cost", "memory-cost", "cost", "in", "out", "ttft", "duration"]
max-lines = 1

[reply-stats]
modules = [
  "in", "cache-read", "cache-write", "out", "ttft", "duration", "cost",
  "chat-cost",
]
max-lines = 1
```

Modules show left to right as far as the width allows, then on up to
`max-lines` lines (at most 5); those that still do not fit are left out from
the right. An empty `modules` hides the line; for the statusline it also
frees its rows, so the window then needs only 19 lines. A mistake in the
file shows as a warning, naming its line, and the defaults apply.

### Memory

Dorothy keeps short notes on each chat: a title, a sentence and a paragraph,
which she writes herself in the background, after her first reply and again
whenever the chat has been idle for a minute. Each new chat starts with her
notes on earlier ones, the most salient (often and recently visited, and
useful to her) in the most detail, within a budget. The notes sit beside each
transcript as `<phrase>.meta.json`.

```sh
bun run dev -- --list              # what she remembers, ranked
bun run dev -- --memory <phrase>   # correct, pin or hide a chat's notes
bun run dev -- --tags              # her tags, as a tree
bun run dev -- --edit-tags         # correct, merge or delete her tags
```

A note you change with `--memory` is yours and she never overwrites it;
empty it to hand it back. Reviews cost tokens, which the `memory-cost`
statusline module shows.

She also tags each chat with up to five topics from a vocabulary she grows
herself, reusing a tag where one fits. Tags never sit in her context: she
lists them, and searches by them, when she looks something up. The
vocabulary is `~/.local/share/dorothy/tags.json` (`$XDG_DATA_HOME` if set).
With `--edit-tags` you rename, describe, re-parent, merge or delete any tag,
and a tag you delete stays deleted; a `Tags:` line in `--memory` sets a
chat's tags, which she then keeps.

When her notes are not enough, Dorothy looks: she searches her past chats
by the words in them and opens the passage that matched, and each lookup
shows as a dim `⌕` line. Her next review judges whether what she read
served her, and chats that served her rank higher in her memory. The
search index is derived from the transcripts and notes, kept at
`~/.cache/dorothy/recall.sqlite` (`$XDG_CACHE_HOME` if set), and can be
deleted at any time. The same search is an MCP server that any MCP client
can start:

```sh
bun run dev -- --recall-server
```

A long chat does not outgrow Dorothy's context. Once it passes a threshold,
she compacts it while you are idle: the oldest turns leave her context in
clusters, split where the topic changes, each summarised by her in an
abstract that stays with her for the rest of the chat. The newest turns stay
word for word. She can open any cluster to read it exactly again, shown as a
dim `⌕ recollected` line, and her notes on other chats shrink to make room
as the chat grows. The abstracts sit in the chat's notes; `--resume` starts
from them.

```toml
[compaction]
enabled = true  # false: no compaction at all
soft = 64000    # context tokens before compacting at idle
hard = 128000   # context tokens before the next message waits for it
tail = 16000    # newest turns kept word for word, in tokens
```

The `[memory]` table of `config.toml` sets it up:

```toml
[memory]
enabled = true       # false: no notes in chats and no reviews
budget = 4000        # estimated tokens of notes per chat, 200 to 20000
idle-seconds = 60    # idle time before a review, 10 to 3600
half-life-days = 30  # how fast a chat fades, 1 to 3650
catch-up = 5         # unreviewed chats reviewed per launch, 0 to 50
recall = true        # false: Dorothy cannot search past chats
extract-cap = 10     # knowledge a review may propose from a chat, 1 to 100
```

Her memory keeps its own history. The data directory is a git repository:
each review, edit, compaction and turn is a commit, checked before it is
made, and a file found broken is put back as it last was, with the broken
copy kept under `broken/` and a warning. Git is used when it is installed,
and a built-in implementation when it is not.

```sh
bun run dev -- --history [<path>] [-n 20]  # what changed, newest first
bun run dev -- --restore <path> [<rev>]    # put a file back as it was
bun run dev -- --rollback <rev>            # notes and tags as they were
bun run dev -- --check                     # lint every file
bun run dev -- --mirror <url-or-path>      # set the sealed mirror
bun run dev -- --recover <url-or-path>     # rebuild an empty data dir
```

Each `--history` line starts with the commit's short sha, which is what
`--restore` and `--rollback` take as `<rev>`.

Beside her notes on each chat, Dorothy keeps facts: what she knows of
you, your work and what has worked, one Markdown file each under
`knowledge/` in the data directory. A fact is personal or a project's, and a
project is the git repository you are in, named by its `origin`. A
project's facts are synced with its repository's `.agents/memory/`, the
format Claude Code's auto-memory reads, so its other contributors' agents
read them too; personal facts never leave her store. Nothing is
forgotten: a fact you retire leaves the repository and her context but
stays searchable, and can be revived.

```sh
bun run dev -- --facts                        # what she knows, by scope
bun run dev -- --retire personal/<name>       # retire a fact
bun run dev -- --retire --from <phrase>       # retire what a chat gave
bun run dev -- --revive personal/<name>       # bring it back
bun run dev -- --sync [<path>]                # sync a project with its repo
bun run dev -- --projects                     # the projects she knows
```

Sync never commits: the files it writes are committed with your work.
When a fact changed both in her store and in the repository, the
repository's version is kept, and hers stays in her history.

The history is pushed to a mirror off this machine, encrypted. The
mirror must exist first: a private repository on a host, or for a local
one `git init --bare /path/to/memory.git`. Then set it with `--mirror`,
run from this checkout: a mirror path is taken from where you run the
command, and `--mirror` makes `DOROTHY_MIRROR_KEY` and saves it with
dotenvx in the `.env` there, only when none is set (it never replaces
one that is, and never makes one once bundles have been sealed). Commit
`.env` afterwards (the key in it is encrypted), and keep a copy of the
key elsewhere (`dotenvx get DOROTHY_MIRROR_KEY`): without it the mirror
cannot be read. `--mirror` with no argument shows the mirror's status.
Until a mirror is set, each launch reminds you. A push is tried at each
launch. An `https://` mirror is pushed with the token in
`DOROTHY_MIRROR_TOKEN`, under git and the built-in implementation alike;
for GitHub, a fine-grained token for the mirror's repository alone, with
read and write access to its contents. Set it with
`bunx dotenvx set DOROTHY_MIRROR_TOKEN <token>`. Without a token, git
uses your own credential helpers, and the built-in implementation, which
pushes only over `https://`, cannot push.

```toml
[history]
enabled = true     # false: no history, no mirror
push-seconds = 60  # at most one push per this many seconds, 10 to 86400
```

### Claude Code as Dorothy

`--claude` runs your own Claude Code with Dorothy as its main agent: her
identity, voice and manner, with Claude Code's tools. Everything after it
goes to `claude`, which starts in the directory you ran it from:

```sh
bun run dev -- --claude                    # Claude Code on this checkout
bun run dev -- --claude -p "Who are you?"
```

Bun runs `dev` only from a directory within this checkout, so for another
project, call the entry point itself:

```sh
alias dorothy="bun $PWD/packages/cli/src/index.ts"  # from this checkout
cd ~/some/project && dorothy --claude
```

It starts a gateway on a local port and points Claude Code at it with
`ANTHROPIC_BASE_URL`, passing your own as the gateway's upstream. The
gateway adds Dorothy's identity to the main thread's requests and forwards
everything else untouched; subagents stay Claude Code's own. Claude Code
signs in as it always does: `--claude` reads none of Dorothy's `.env`.

To see what it sends, `--claude --dump-context` prints, as JSON, the first
request Claude Code makes, with the gateway's rewrite applied. Arguments
before `--` go to `claude`, the message after it (`hi` if none):

```sh
bun run dev -- --claude --dump-context
bun run dev -- --claude --dump-context --model sonnet -- "Who are you?"
```

`claude` runs in print mode without saving its session, and the gateway's
upstream is a stand-in on a local port, so nothing reaches the API. Print
mode's request can differ a little from an interactive session's. A
warning on stderr says if the gateway found no marker to replace.

### Her memory as a service

`--serve` runs her memory as a service, which every harness's adapter
and her own tools reach: an opening block for each session, recall for
a message, four MCP tools (`brief`, `search`, `open`, `remember`) and
records of each session. It listens on `127.0.0.1:4774`; the first
`--mcp` starts it if it is not running.

```sh
bun run dev -- --serve
bun run dev -- --mcp     # MCP over stdio, for a harness that launches it
```

To reach it from your other devices, list their addresses in
`config.toml` and give each device a token, which it keeps in
`~/.local/state/dorothy/device-token` (`$XDG_STATE_HOME` if set), mode
0600, with `DOROTHY_MEMORY_URL` naming the service:

```toml
[service]
port = 4774
listen = ["100.64.0.1"]  # a private network's address, such as Tailscale's
```

`DOROTHY_MEMORY_URL` must use an address listed in `listen` (or
`127.0.0.1`): a request to any other name gets 421 and its records wait.

```sh
bun run dev -- --serve --token-add laptop     # shown once
bun run dev -- --serve --token-revoke laptop
```

The service serves no TLS: keep it on a private network, which encrypts
the traffic, or behind a proxy that does. A request from loopback needs
no token, so a local proxy or tunnel that forwards to `127.0.0.1` makes
remote traffic look local: do not run one in front of it.

A harness's hook may name a Claude Code transcript, which the service
reads only under the `projects` directory of `CLAUDE_CONFIG_DIR` (else
`~/.claude`) as the service found it. With another account's directory,
list it too:

```toml
[service]
claude-dirs = ["/home/me/.config/claude-2"]
```

Her knowledge lives in `knowledge/` in the data directory, one Markdown
file each in the [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md),
which you may read and edit; `facts/` is moved there once.

### Measuring her memory

`bun run eval` measures her memory on questions drawn from her own
data, as [the evaluation's
spec](./docs/specs/2026-10-18-memory-evaluation-design.md) describes.
It works on a copy: take a snapshot into a work directory of your
choosing, kept as private as the data directory, since the copy, the
questions and the reports hold her data in clear.

```sh
bun run eval -- snapshot --from ~/.local/share/dorothy --work ~/eval
bun run eval -- mine --work ~/eval     # questions her own reads answer
bun run eval -- run --work ~/eval --retrieval-only
```

`mine` and a retrieval-only run need no model. To draft questions of
LongMemEval's types and to answer and judge them, name a model for each
role in `~/eval/eval.toml`, any OpenAI-compatible Chat Completions
endpoint, with the variable that holds its key:

```toml
[models.generate]
base-url = "https://openrouter.ai/api/v1"
model = "deepseek/deepseek-v3.2"
key = "OPENROUTER_API_KEY"

[models.answer]
base-url = "https://openrouter.ai/api/v1"
model = "openai/gpt-oss-120b"
key = "OPENROUTER_API_KEY"

[models.judge]
base-url = "https://openrouter.ai/api/v1"
model = "google/gemini-2.5-flash"
key = "OPENROUTER_API_KEY"
```

Set the key with `bunx dotenvx set OPENROUTER_API_KEY`, and run under
`bunx dotenvx run --`, so it is read from the encrypted `.env`:

```sh
bunx dotenvx run -- bun run eval -- generate --work ~/eval --count 300
bun run eval -- review --work ~/eval   # accept, edit or reject each
bun run eval -- run --work ~/eval --dry-run
bunx dotenvx run -- bun run eval -- run --work ~/eval
bun run eval -- compare --work ~/eval <run> <run>
```

These send passages of her data to the providers you name; a local
server (llama.cpp, Ollama) keeps them home. The judge and the generator
must support structured output. `--max-calls` caps the calls of
`generate` or `run`, and a run stopped by it resumes with
`--resume <run>`, the id the run printed; `--dry-run` beside it counts
only what the run has left. A failed call counts as a miss. A system's
ranked items are the ones that fit its budget, so recall at 5 and 10
falls with a smaller `--budget`, and runs made before that (2026-10-19)
are not comparable on them. Each run's report is
`~/eval/runs/<run>/report.md`, and `bun run eval -- <command> --help`
lists a command's options.

### Development mode

For the people building her, `--dev` goes before a chat, a `--resume` or a
prompt. Dorothy then says she is in development mode, so her notes on the
chat record it, and describes her context in full when asked.

```sh
bun run dev -- --dev "What is in your context?"
bun run dev -- --dump-context [--resume <phrase>] [message...]
```

`--dump-context` prints, as JSON, the exact request a chat would send first:
the same notes, history and memory tools, and whatever the SDK adds. It goes
to a stand-in on a local port, so nothing reaches the API and no tokens are
spent. `--dev --dump-context` dumps development mode.

## CI

`.github/workflows/ci.yaml` calls the shared
[standard workflow](https://github.com/chewygumxx/.github#standard-workflow):
commitlint, the header sync, generic lint and format checks for workflows,
shell and zsh scripts, TOML, YAML and `.editorconfig`, and the metadata sync.
This repository's own `bun run check` follows, against the commit the header
sync pushed.

## Development

The code is five Bun workspace packages under `packages/` (`core`, `memory`,
`agent`, `tui` and `cli`), linked by Bun's isolated linker;
[`AGENTS.md`](./AGENTS.md) and each package's own describe them.

- `bun run dev` and `bun run start` run the CLI from source
  (`packages/cli/src/index.ts`).
- `bun run commit` composes a commit interactively.
- `bun run check` runs the typecheck, format check, lint, Markdown lint, YAML
  checks (prettier, then yamllint with `@chewygumxx/yamllint-config`) and tests
  that CI runs.
- `bun run test` runs the `bun test` suite alone.
- `bun run format` applies Biome formatting, and prettier's to YAML, which Biome
  does not read.

The pre-commit hook runs the same checks on staged files, and rejects em dashes
and plaintext values in any env file.
The commit-msg hook runs commitlint.

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
