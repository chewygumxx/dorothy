---
ctime: 2026-10-15
mtime: 2026-10-15
spdx: GPL-3.0-only
title: Dorothy's identity design
description: >-
  Design spec for a client-independent identity package, a local gateway
  that applies it to an agentic client's main thread, and a launcher that
  runs Claude Code as Dorothy.
tags:
  - dorothy
  - gateway
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-15-identity-gateway-design.md
   -
   -->

# Dorothy's identity design

## Purpose

Dorothy is a conversational assistant: her persona lives in
`packages/agent/src/persona.ts` and reaches the model only through her
own chat. This phase lets her be the agent inside an agentic client as
well, starting with the shipped Claude Code, so that the agent the user
works with identifies and acts as Dorothy whichever client hosts it.

Three pieces do it. An identity package states who Dorothy is, how she
speaks and how she treats questions about what runs her, in text that
knows nothing of any host. A gateway between the client and the API adds
that text to the main thread's requests. A launcher, `dorothy --claude`,
starts the gateway and runs Claude Code through it.

The identity does not define a client's whole system prompt: Claude
Code's tool guidance, safety instructions and coding conventions stay.
It reaches the main thread and its forks, not subagents, which keep the
prompts their definitions give them.

The phase goes ahead of Model Providers. Its gateway passes requests
through to Anthropic unchanged but for the identity; the later Dorothy's
Gateway phase grows it with memory, budgets and model routing.

## Decisions

- **A gateway, not a client feature.** Claude Code's output styles,
  `--append-system-prompt-file` and main-thread agents each place text in
  its system prompt, but only Claude Code reads them. A gateway at the
  HTTP boundary serves any client that lets the base URL be set, and is
  where Dorothy's Gateway will add memory and routing.
- **A marker says where.** The gateway sees every request a client
  makes: the main thread, forks, subagents, compaction and side calls
  such as titles. The launcher passes `--append-system-prompt` with a
  fixed marker, which only the main thread and its forks carry; the
  gateway replaces the marker with the identity. A request without the
  marker passes through byte for byte, so a change in the client fails
  safe. Recognising the main thread by the shape of its prompt was
  rejected as fragile across client versions.
- **Additive.** The gateway removes only its own marker. The billing
  header, the client's identity line and everything else in the request
  are left as sent. The 2026-10-07
  [gateway note](../notes/2026-10-07_claude-conversation-claude-code-gateway.md)
  reads editing one's own outbound request through the documented base
  URL as the defensible route, and removing a client's own text as the
  riskiest edit.
- **Identity, voice and provenance.** The package covers who Dorothy
  is, how she speaks, and one host-neutral stance on provenance. What a
  host lets her do (tools, capabilities) and how it runs her (plumbing)
  stay with each host.
- **One provenance stance everywhere.** She is Dorothy; an identity line
  from the software hosting her names her host, not her. She does not
  volunteer the model or vendor behind her, but answers plainly when
  asked. This replaces the chat persona's discreet provenance, which
  deflected such questions, so the chat prompt changes on purpose.
- **`--claude`, not `claude`.** Bare words are a one-shot prompt, so the
  launcher is a flag like the CLI's other modes.
- **The user's own Claude Code.** The launcher runs `claude` from
  `PATH` with the user's own settings and login. It does not load
  Dorothy's `.env`, and it is unrelated to the Agent SDK's bundled
  binary, which `agent` keeps using for chat.

## The packages

The graph after this phase, as `workspace.test.ts` pins it:

| Package    | `@dorothy` dependencies                       | Entry points |
| ---------- | --------------------------------------------- | ------------ |
| `core`     | none                                          | `.`          |
| `identity` | none                                          | `.`          |
| `gateway`  | `core`, `identity`                            | `.`          |
| `memory`   | `core`                                        | unchanged    |
| `agent`    | `core`, `identity`                            | `.`          |
| `tui`      | `core`                                        | `.`          |
| `cli`      | `agent`, `core`, `gateway`, `memory`, `tui`   | none         |

Neither `identity` nor `gateway` declares the Agent SDK; `agent` remains
its single holder.

### `@dorothy/identity`

No dependencies, no I/O, and the same output on every call, so a
request carrying it keeps its prompt cache.

- `identityComponents()` returns the components in the order they are
  joined, each `{ name, text }` with `name` one of `identity`, `voice`
  and `provenance`, the shape `personaComponents` uses.
- `identityPrompt()` joins their texts with a space.

`identity` and `voice` move from `persona.ts`, where they are today
"You are Dorothy," and "a warm, curious and conversational assistant, in
the spirit of the chat experience at <https://claude.ai>.". The voice is
reworded, as Dorothy is no longer only a chat assistant. `provenance` is
new text written to the stance in [Decisions](#decisions).

### `@dorothy/gateway`

- `startGateway({ upstream?, log? })` serves on `127.0.0.1`, port `0`,
  and returns `{ url, stats, stop }`. `stats` counts requests injected
  and requests that carried the marker but could not be rewritten.
- The upstream defaults to `https://api.anthropic.com`. The launcher
  passes the user's own `ANTHROPIC_BASE_URL` when one is set, so the
  gateway chains onto an existing proxy.
- It imports `identityPrompt()` itself.
- The Anthropic protocol lives in `src/anthropic.ts`: the pure
  `rewrite(body)` and the marker. The server in `src/server.ts` knows
  only which paths to hand it. An OpenAI-protocol adapter for Codex can
  later sit beside `anthropic.ts`.

### `@dorothy/agent`

The persona takes `identity`, `voice` and `provenance` from
`identityComponents()` and keeps its own `mode`, `capabilities`,
`plumbing` and `memory`. Development mode, which today drops
provenance, keeps the shared stance, which does not conflict with its
plumbing's instruction to describe its context faithfully.
`persona.test.ts` is re-pinned to the new chat prompt.

### `@dorothy/cli`

A new mode, `dorothy --claude [args...]`. Everything after `--claude`
goes to `claude` untouched; `--dev` does not apply to it.

1. Start the gateway, with the user's `ANTHROPIC_BASE_URL` as upstream
   when set.
2. Spawn `claude` from `PATH` with the inherited environment plus
   `ANTHROPIC_BASE_URL` set to the gateway's URL and
   `ENABLE_TOOL_SEARCH=1`, which Claude Code otherwise turns off for a
   base URL that is not Anthropic's. Its arguments are
   `--append-system-prompt <marker>` followed by the user's.
3. Inherit stdin, stdout and stderr, and forward `SIGINT`, `SIGTERM` and
   `SIGHUP` to the child.
4. When `claude` exits, stop the gateway, print the warning described
   under [Failures](#failures) if it applies, and exit with `claude`'s
   code, or `128 + n` for a signal.

The spawner is injected, so tests run no real `claude`.

## Request handling

**Candidates.** `POST` to a path ending `/v1/messages` or
`/v1/messages/count_tokens`. Every other request, method or path is
forwarded byte for byte.

**The marker.** A fixed string, `<!-- dorothy:identity -->`, that no
prompt carries by accident. Only `system` is searched for it, never
`messages`.

**Rewrite,** for a candidate whose `system` carries the marker:

1. Decompress a `gzip` body, then parse it. If either fails, forward the
   original bytes and count the request as drift.
2. Remove the marker and the whitespace around it from the block, or
   string, holding it. A block left empty is dropped, and its
   `cache_control`, if any, moves to the block before it, so the number
   of cache breakpoints stays the same.
3. Insert `{ "type": "text", "text": identityPrompt() }` immediately
   after the first block that is not the billing header (a text block
   opening `x-anthropic-billing-header:`). In Claude Code's requests that
   is its identity line. A string `system` becomes
   `[{ type: "text", text: <the string> }, <identity block>]`.
4. Serialise the body uncompressed, and forward it with every header as
   received except `content-encoding`, `content-length` and the
   hop-by-hop headers (`host`, `connection`, `keep-alive`,
   `transfer-encoding`). Authorisation and `anthropic-beta` pass
   untouched.

**Responses.** Status and headers, less the hop-by-hop ones, are
returned as received, and the body is streamed through unchanged, so
server-sent events arrive as the upstream sends them.

**The probe fixes the details.** Where Claude Code puts appended text in
`system`, whether that block carries `cache_control`, and whether forks
keep it have not been observed. The first task of the plan captures them
(see [Testing](#testing)), and steps 2 and 3 are adjusted to what it
shows before any code depends on them.

## Failures

- **The gateway cannot bind.** `dorothy --claude` reports the error and
  exits 1 without starting `claude`.
- **`claude` is not on `PATH`.** A message naming the missing command,
  and exit code 127.
- **The upstream cannot be reached.** The gateway answers 502 with an
  Anthropic-shaped error body (`{"type":"error","error":{...}}`), which
  Claude Code shows as it shows any API error.
- **Quiet while `claude` runs.** Claude Code owns the terminal, so the
  gateway writes nothing to it. It never records headers or bodies.
- **Drift.** After `claude` exits, if `stats` counted any request that
  carried the marker but could not be rewritten, one line on stderr says
  how many, so a change in Claude Code's requests is noticed.

## Testing

No test reaches the API or runs a real `claude`; probes use temporary
directories and never the user's data.

- **`identity`.** `identityPrompt()` pinned byte for byte, and equal
  across calls.
- **`rewrite`.** Fixtures for a string `system` and a list of blocks;
  the marker inside a block and alone in a block carrying
  `cache_control`; no marker, which returns the input bytes unchanged; a
  gzip body; malformed JSON; and a marker only in `messages`, which is
  ignored.
- **The server.** `startGateway` in front of a stand-in upstream on
  loopback: the forwarded body and headers; server-sent events arriving
  in more than one chunk; `count_tokens`; a `GET` passed through; 502
  with the upstream stopped; the counts in `stats`.
- **The launcher.** With the spawner injected: the environment, the
  marker ahead of the user's arguments, the exit code and signal codes,
  the gateway stopped after exit, the drift warning, 127 for a missing
  `claude`, and `--claude` in parsing and usage.
- **`agent`.** `persona.test.ts` re-pinned.
- **The graph.** `workspace.test.ts` pins the table in
  [The packages](#the-packages), and that `identity` and `gateway`
  cannot resolve the Agent SDK.
- **The probe, first.** `claude -p --no-session-persistence
  --append-system-prompt <marker>` against `captureServer`'s stand-in,
  recording bodies only, then the same through the gateway with a
  stand-in upstream behind it. Captures go to
  `docs/reports/<date>-identity-gateway/`.
- **End to end,** run only with the user's go-ahead, as it spends
  tokens: `dorothy --claude -p "Who are you?"` answers as Dorothy; a
  second turn with `--continue` reports `cache_read_input_tokens` above
  zero; a prompt that starts a subagent leaves `stats` counting the main
  thread's requests only.

## Documentation

- The root `AGENTS.md`: the packages section names the new packages,
  and `agent` depends on `core` and `identity`.
- New `packages/identity/AGENTS.md` and `packages/gateway/AGENTS.md`;
  `agent`'s and `cli`'s updated.
- `.commitlintrc.mts` gains the scopes `identity` and `gateway`.
- A report records the probe, the rulings and the verification.

## Roadmap

A new phase, **Dorothy's Identity**, goes ahead of Model Providers, with
a Revisions line saying why: Dorothy can serve as the agent in Claude
Code now, and nothing in it waits on a provider contract. Dorothy's
Gateway notes that it grows from the `gateway` package.

## Known risks

- **Claude Code's requests change.** Appended text may move, or join
  another block. The marker fails safe (no identity, nothing broken),
  and the drift warning reports it.
- **The client's identity line stays.** "You are Claude Code" still
  opens the prompt. Provenance tells her what it means; the end-to-end
  check shows whether it holds.
- **Resumed sessions.** Claude Code records a conversation's system
  prompt on its first request. A session started without
  `dorothy --claude` and resumed with it has no marker, so no identity
  until it compacts; one started with it and resumed in plain `claude`
  sends the marker, an HTML comment, through to the API.
- **Terms.** A subscription login falls under Anthropic's consumer
  terms. The gateway changes only the user's own outbound requests,
  through a documented setting, and adds rather than removes; the note
  above is a reading of the published text, not legal advice.

## Later

- An OpenAI-protocol adapter, and launchers for Codex and OpenCode.
- Memory, recall over MCP, budgets and model routing, in Dorothy's
  Gateway.

## Out of scope

- Subagents' prompts.
- Removing or rewriting anything the client sends besides the marker.
- Model Providers, and any change to which model a client uses.
