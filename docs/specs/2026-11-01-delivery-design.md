---
ctime: 2026-11-01
mtime: 2026-11-01
spdx: GPL-3.0-only
title: Delivery
description: >-
  Design spec for delivery: Dorothy's persona and memory carried into
  Codex and Hermes Agent beside Claude Code, by a launcher, hooks and a
  memory provider that speak her service, with OpenClaw's to follow.
tags:
  - dorothy
  - memory
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-11-01-delivery-design.md
   -
   -->

# Delivery

## Summary

Delivery is the last piece of Dorothy's Memory: her contract wired into
each harness she is provided for. The
[contract](./2026-10-18-memory-contract-design.md) gave every harness
one service; recording reads Claude Code's, Codex's and Hermes's
sessions; the [engine](./2026-10-31-memory-engine-design.md) kept her
own search, which its
[rerun](../reports/2026-10-31-memory-engine.md#the-decision) found past
lexical search. Claude Code has her already, through `dorothy --claude`:
the gateway puts her identity into its requests, launch flags add her
hooks and her MCP server, and none of its files are written.

This spec brings the other three to the same point. Codex gets a
launcher like Claude Code's, `dorothy --codex`, whose session flags
carry her identity, her MCP server and two hooks, writing none of
Codex's files. Hermes Agent gets a memory provider of hers, installed by
the user's own `dorothy --install hermes` into a Hermes profile of its
own, with her identity as that profile's `SOUL.md`. OpenClaw, not yet
installed here, waits with its design noted. One hook command serves
every host that speaks Claude-shaped hooks.

## Understanding

What the user has said, in the roadmap and the agent's memory:

- She is provided for and tested against Claude Code, Codex, OpenClaw
  and Hermes Agent; others wait.
- No one harness hosts her: one definition of her is generated into each
  harness's own slots, and one memory serves them all. pi is not used.
- Existing tools are researched before anything bespoke; the
  [cross-harness research](../reports/2026-10-18-protocol-diversity/cross-harness.md)
  did so, naming rulesync, Hindsight's adapters and Letta's parser.
- New subsystems speak standard protocols, with any SDK at a thin edge.

Assumed, as the user was away when this was written and asked that
confirmations be taken as given; each is a ruling below:

- Delivery adds to a host only what a session of hers needs, and leaves
  the user's own setup of that host as it was.
- Success is a session in each host that opens with her block, recalls
  for the user's turn, offers her tools and is recorded, under her name.

## Decisions

Ruled by the coordinating agent, each with its cost if wrong:

| Question | Ruling | Cost if wrong |
| --- | --- | --- |
| Hosts now | Codex and Hermes; Claude Code as it is; OpenClaw when installed | OpenClaw waits a phase |
| Codex's route | A launcher, `dorothy --codex`, on session flags | Her Codex is a command, not plain `codex` |
| Hermes's route | A memory provider plugin and a `dorothy` profile | Plain `hermes` stays without her |
| Writing host files | Only `--install`, run by the user; launchers write none | Hermes needs one install step |
| rulesync | Not adopted now | Two hosts' writers are ours |
| Hook command | One, `dorothy --hook <host> <event>` | Claude Code keeps its own beside it |
| Recording | The sweep, as now; no recording hooks | Recall lags a sweep |
| Tools | Her MCP server in every host | A host without MCP gets none |
| Persona text | `@dorothy/identity`, which `cli` now imports | One more edge in the graph |

rulesync owns whole settings keys and leaves persona files to the user,
the research found; launch flags and a profile of her own write no key
the user holds, so it is not needed yet. Its MCP, hook and skill writers
stay the route for a host with neither flags nor profiles.

## Claude Code

Unchanged. `dorothy --claude` stays as built; its `--claude-hook` keeps
recording by `Stop` and its launch notes. The new hook command shares
the block and recall rendering with it, so the two cannot drift.

## Codex

`dorothy --codex [args...]` runs `codex` with these session flags before
the user's own, which win where both set a key:

- **Identity**: `identityPrompt()` in Codex's additive developer
  instructions, keeping Codex's own base instructions, which its agentic
  ability rests on. Only if Codex offers no additive slot, its
  `model_instructions_file`, a file in her cache, with that cost
  recorded.
- **Tools**: an MCP server `dorothy`, running `dorothy --mcp --host
  codex`, as built.
- **Hooks**: `SessionStart`, for every source, runs `dorothy --hook
  codex session-start`; `UserPromptSubmit` runs `dorothy --hook codex
  prompt`. Each returns `additionalContext`.

Codex keeps a trust state for each hook. Should a hook from session
flags need the user's approval, the launcher says so once, and the plan
probes whether a flag can grant it; if session flags cannot carry hooks
at all, `dorothy --install codex` writes a Codex plugin of hers, its
hooks and MCP server, which the user enables, and the launcher keeps the
identity flag alone.

Codex's sessions are recorded by the sweep, as now. The launcher notes
nothing; a plain `codex` session is recorded too but gets no block.

## Hermes Agent

Hermes takes one external memory provider, through `memory.provider` in
its configuration, and a persona in `SOUL.md`. Both are the user's in
their default profile, so hers go in a profile of her own:

- `dorothy --install hermes` makes a Hermes profile `dorothy` beside the
  user's: its `SOUL.md` holds `identityPrompt()`, its configuration
  selects her provider and adds her MCP server, and her provider's
  plugin is copied where Hermes loads plugins. It writes nothing in the
  user's other profiles, reports each file it wrote, and run again
  rewrites only her own files. `--uninstall` removes them.
- Her provider, `dorothy`, in Python with the standard library alone:
  - `system_prompt_block()`: the opening block for host `hermes`, fetched
    once at `initialize` and frozen for the session, as Hermes asks;
  - `queue_prefetch()` fetches recall for the turn in the background,
    and `prefetch()` returns what it holds, `""` when nothing has come;
  - `sync_turn()` does nothing, as the sweep records Hermes's sessions;
  - no tools of its own: her MCP server gives them.
- It reaches her service as her own client does: `DOROTHY_MEMORY_URL`,
  else the loopback address the install read from her `[service]` port
  and wrote into the profile, with the device token from her state
  directory beyond loopback. Timeouts are her client's (a second for the
  block, half one for recall), and it fails open: an unreachable service
  gives the block last cached for `hermes`, else none, and no recall,
  never an error in the user's session.

The plan probes where Hermes loads a profile's plugins, whether a
profile is chosen by flag or by environment, and that a provider plugin
outside Hermes's own tree is loaded. Hindsight's Hermes provider (MIT)
is the reference for its shape; its code is not copied.

## OpenClaw

Not installed on the user's machine, so nothing is built for it now. Its
route, from the research: a plugin in `plugins.slots.memory`, an
exclusive slot, its block through `promptBuilder` and recall through
`before_prompt_build`'s `prependContext`, never the system context, so
the prompt cache holds; its persona in its own `SOUL.md` and
`IDENTITY.md`. Recording waits for its reader.

## The hook command

`dorothy --hook <host> <event>` reads a hook's JSON payload on stdin and
writes the host's JSON reply on stdout:

- `session-start`: the opening block for the host's profile and the
  payload's working directory, as `additionalContext`;
- `prompt`: recall for the payload's prompt, within the host's
  `recallBudget`, as `additionalContext`, or nothing when recall finds
  nothing.

Hosts are those whose profiles list `hook`; an unknown host or event
fails with usage. Each payload is mapped to a contract request by a
fixture-tested function per host, as `bodies/fixtures.ts` does for
Claude Code. The command loads memory's client lazily, as every mode
does, and fails open: no service, a timeout or a refused request gives
an empty reply and exit 0, the problem logged where the service logs.

## Persona

`@dorothy/identity` is the one source of her persona. Claude Code takes
it through the gateway; Codex and Hermes as text, the same text, byte
for byte. `cli` gains `@dorothy/identity` as a dependency, the workspace
test's graph and the root `AGENTS.md` changing with it.

## Errors

- A host binary missing: the launcher or install says which, exit 1.
- A host version outside its profile's `checked`: a warning, then on.
- The service down: hooks and provider fail open; the launcher still
  starts the host.
- An install over files not hers: refused, naming them, unless
  `--force`.

## Testing

Unit tests, on temporary roots, never the user's data or hosts:

- the Codex launcher's arguments, through a dump like
  `--claude --dump-context`'s, with the user's own flags after hers;
- each host's payload mapping, from recorded payload fixtures;
- the hook command's replies, against a stub service, and failing open;
- the install's files in a temporary Hermes home: written, reported,
  rewritten only where hers, refused over others', removed;
- the provider, under `python3 -m unittest` against a stub HTTP
  service, run by `bun run check`: block frozen, prefetch cached,
  failing open.

## Verification

Live probes, each on a temporary home for the host, with the user's
credentials only where a host needs them:

- Codex: a `dorothy --codex exec` session whose first turn shows her
  block and whose prompt gets recall, its rollout swept; after Codex's
  week resets on 5 November.
- Hermes: a session in the `dorothy` profile whose system prompt holds
  her `SOUL.md` and block, whose turn gets recall, swept after.

Installing into the user's own Hermes and running her Codex day to day
are the user's acts, after the probes.

## Documentation

`packages/cli/AGENTS.md` gains the launcher, the hook command and the
install; the root `AGENTS.md` its graph line; the host profiles their
checked versions. A report records the probes, rulings and verification.

## Later

- OpenClaw's plugin, persona files and reader, once it is installed.
- Plain `codex` and `hermes` with her, should the user want her as
  their default rather than a command or a profile.
- rulesync for hosts beyond the four, pinned and checked in CI.
- Claude Code's `--claude-hook` folded into `--hook`.
