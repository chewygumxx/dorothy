---
ctime: 2026-10-15
mtime: 2026-10-15
spdx: GPL-3.0-only
title: Dorothy's objectives
description: >-
  What Dorothy is to become, set after weighing OpenClaw and Hermes Agent
  as hosts: one adaptable Dorothy, Dorothy's own core, and her memory
  first.
tags:
  - dorothy
  - memory
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-15-objectives.md
   -
   -->

# Dorothy's objectives

## Summary

Asked whether OpenClaw or Hermes Agent should host Dorothy, to give her
their tooling and memory, the user and the coding agent ruled that neither
should. Dorothy stays her own core and borrows their ideas and open
formats instead. The objectives that ruling serves are set out below, with
what exists against each, the gaps, and the order agreed: Dorothy's
memory comes first, reworked if it needs to be, and the rest follows.

## How it was reached

The user compared the two projects in a claude.ai conversation driven by
web search, then pasted it into a Claude Code session running as
`dorothy --claude`. Its claims were not verified here: they postdate what
the coding agent knows, and several (release numbers, issue and pull
request numbers, a metering ratio) came from the search alone. They are
leads, not findings. What follows takes from them only what bears on
Dorothy.

### What the comparison said

- **OpenClaw**: a broad platform of many agents across more than 50 chat
  channels, with a large catalogue of human-written skills (ClawHub, in
  the open Agent Skills `SKILL.md` format) and per-person roles and
  secrets. Heavy, and ClawHub was found carrying hundreds of malicious
  skills. It reaches a Claude subscription by driving the official Claude
  Code binary in print mode, one live process per session.
- **Hermes Agent**: one long-lived agent, in Python, whose memory is the
  user's chosen state of the art: a curated store of preferences,
  projects, environment and lessons, with tiered retrieval and visible
  context usage. It writes its own skills from work that succeeded. It
  reaches a Claude subscription through an experimental plugin that
  starts Claude Code per request with its tools off, as a bare model.
- **Shared**: both read `SKILL.md` skills and speak MCP, so skills and
  tools written for one mostly work in the other, and in Claude Code.

### Why neither hosts Dorothy

- **Metering**: both reach Claude through print mode or the Agent SDK,
  which the comparison reports is metered as programmatic use, at about
  60% of the throughput interactive Claude Code gets on the same plan.
  `dorothy --claude` runs Claude Code interactively.
- **Tools**: Hermes's plugin turns Claude Code's tools off for its own;
  OpenClaw layers its own over them. Either trades the strongest toolset
  Dorothy has for a less proven one.
- **Two memories**: each host keeps a memory of its own, which Hermes
  writes autonomously by default. It would grow beside Dorothy's, outside
  her history, mirror and tags.
- **Assets**: skills Hermes writes for itself land in `~/.hermes`, against
  the rule that every agentic asset is declared in this repository.
- **Direction**: the roadmap's Dorothy's Gateway makes Dorothy the model
  behind Claude Code, Codex and OpenCode, with recall over MCP. Being
  hosted inverts it.

## The objectives

In the user's words, Dorothy is to be one Dorothy, adaptable above all:
resilient to upstream hindrance, remembering and learning, efficient and
nimble, and extendable in a manner that lets her grow.

| Objective | Taken from | What it asks |
| --- | --- | --- |
| Memory | Hermes | to remember and recollect, efficiently and well |
| Learning | Hermes | to turn experience into lasting instruction |
| Extensibility | OpenClaw | a catalogue of skills and tools to grow by |
| Reach | OpenClaw | to be reached away from the terminal |
| Models | Anthropic | Anthropic's models first, the best for her |
| Resilience | the user | fallback to featherless.ai and OpenRouter |

Extensibility means chiefly the catalogue of skills and tools, whose
scope the user has yet to explore; reach, through chat apps, is welcome
but second. Fallback is for when Anthropic usage runs out, and for work
another model suits better.

The user doubts that Hermes's self-improvement loop does more than a
scheduled run of Anthropic's `claude-md-management` or `claude-code-setup`
plugins would. The coding agent agreed in substance: both look back at
work and distil it into lasting instruction, Hermes at once with the
context fresh, a schedule later from transcripts. Those two plugins tend a
repository's `CLAUDE.md` and Claude Code's automations, though, not
Dorothy's memory. Her own pass would sit in Cyclical Maintenance, in the
background and undoable through memory history.

## Where Dorothy stands

### Memory

In chat, Dorothy's memory is episodic, built on her conversations:

- transcripts, and notes on each conversation that background reviews
  write, with tags from a SKOS-style vocabulary;
- a memory block each session starts with, built from the notes within
  `[memory] budget` and frozen for the session;
- recall over MCP, `dorothy --recall-server`, whose tools are `search`,
  `open` and `tags`, and `recollect` once a chat has compacted;
- compaction into topical clusters, each with an abstract;
- history: the data directory as a git repository, sealed to a mirror.

The memory block and recall already form two layers of progressive
disclosure: a summary always in context, the detail fetched on demand.
Topic Overviews (4b) would add a third.

### The gaps

- **Claude Code Dorothy remembers nothing.** `dorothy --claude` carries
  her identity alone: the gateway places it, and `launchClaude` passes no
  MCP server, so she has neither her memory block nor recall. There are
  two Dorothys, one in chat who remembers and one in Claude Code who does
  not. This report was written by the second.
- **No memory of facts and lessons.** Nothing holds what Dorothy knows of
  the user, their environment and what has worked, apart from the
  conversations it came from. This is what sets Hermes apart.
- **No learning.** Nothing turns experience into instruction, beyond the
  reviews' notes on each conversation.
- **Budgets are scattered** across the memory block and compaction, as
  the [budgets note](../notes/2026-10-07_budgets-gateway.md) found.

### The rest

- **Extensibility**: Claude Code, as Dorothy's body, already loads
  `SKILL.md` skills and MCP servers. Nothing vets or catalogues them for
  her.
- **Reach**: none; she lives in the terminal.
- **Models and resilience**: Model Providers, next on the roadmap, brings
  a provider contract with Messages API and OpenAI-compatible
  implementations, both of which featherless.ai and OpenRouter speak.
  Automatic fallback when usage runs out is not yet among its
  requirements. Dorothy's Gateway would then route Claude Code's own
  requests through it. Whether open models do well behind Claude Code's
  prompt and tool schemas is untested.

## Rulings

1. Dorothy is hosted by neither OpenClaw nor Hermes Agent; she stays her
   own core and borrows open formats, `SKILL.md` and MCP, and ideas.
2. Her memory comes first: one memory across every body she runs in,
   through recall over MCP, persistent context, progressive disclosure
   and whatever else serves her to remember and recollect efficiently
   and well, now and later.
3. The memory system as it stands may be reworked rather than extended,
   if its design calls for it.
4. The other objectives follow the memory work, roughly in this order:
   resilience (Model Providers, with fallback a requirement), learning,
   extensibility, reach.

## Questions for the memory work

For its design to settle, not this report:

- How Claude Code Dorothy gets her memory: recall as an MCP server
  `launchClaude` passes, the memory block through the gateway, Claude
  Code's hooks, or a mix, and how chat and Claude Code share one memory
  without two writers colliding.
- What memory of facts and lessons looks like beside the episodic one:
  where it lives, who writes it and when, how a wrong fact is found and
  removed, and how it reaches history and the mirror.
- What layers progressive disclosure should have, and the budget of
  each, held in one place.
- Whether a Claude Code session, not only a chat, should become a
  conversation Dorothy remembers, with notes, tags and recall.
- What of the current design to keep: transcripts and notes, the FTS5
  index, compaction's clusters, the vocabulary, history.

## Next

Revise the roadmap to put the memory work first, then begin its design
with `brainstorming`.
