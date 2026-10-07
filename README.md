---
ctime: 2026-09-29
mtime: 2026-10-05
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

Run directly from source, no build step required:

```sh
bun run dev -- "What is your name?"
```

Or build once and run the compiled output:

```sh
bun run build
bun start -- "What is your name?"
```

Either command streams one reply to stdout as it is generated, in character as
Dorothy per the system prompt in `src/persona.ts`. A prompt that starts with a
dash follows `--`, as in `bun run dev -- -- "-v means?"`; any other leading
option is refused rather than sent, and `--help` prints the usage.

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

The history is pushed to a mirror off this machine, encrypted: set one
with `--mirror`, which makes `DOROTHY_MIRROR_KEY` and stores it with
dotenvx only when none is set, and never replaces one that is. A mirror
path is taken from where you run the command, and the key goes in the
`.env` of the directory `--mirror` runs from, so run it from this
checkout. `--mirror` with no argument shows the mirror's status. Keep a
copy of that key elsewhere; without it the mirror cannot be read. Until a
mirror is set, each launch reminds you. A push is tried at each launch.
Under the built-in implementation only an `https://` mirror can be
pushed, with a token in `DOROTHY_MIRROR_TOKEN`.

```toml
[history]
enabled = true     # false: no history, no mirror
push-seconds = 60  # at most one push per this many seconds, 10 to 86400
```

### Development mode

For the people building her, `--dev` goes before a chat, a `--resume` or a
prompt. Dorothy then says she is in development mode, so her notes on the
chat record it, and describes her context and what she runs on when asked,
rather than keeping quiet about it.

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
