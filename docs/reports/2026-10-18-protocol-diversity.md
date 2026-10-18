---
ctime: 2026-10-18
mtime: 2026-10-18
spdx: GPL-3.0-only
title: Protocol-diverse Dorothy
description: >-
  Minutes of 2026-10-18: Dorothy hosted by no one harness, one definition
  of her generated into each, one memory they all share, memory designed
  first and existing packages researched before anything bespoke.
tags:
  - dorothy
  - memory
  - providers
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-18-protocol-diversity.md
   -
   -->

# Protocol-diverse Dorothy

## Summary

After the research on
[open-source replacements](../notes/2026-10-18_open-source-replacements.md),
the user and the coding agent discussed what Dorothy should run on. They
ruled that no one harness hosts her: she is protocol diverse, one
definition of her generated into each harness's own files, with one
memory that every harness shares. pi is not to be used. Memory that works
across harnesses is designed before the harnesses to target are chosen,
and existing packages, LangChain's among them, are researched before
anything bespoke is built.

## How it was reached

- The replacements note recommended a memory provider over Dorothy's
  archive and her body rebuilt on pi. Its research had weighed Hermes
  Agent against OpenClaw, as the
  [objectives](./2026-10-15-objectives.md) of 2026-10-15 had.
- The user asked why every road led back to Hermes against OpenClaw. The
  coding agent's answer: the framing was inherited. The objectives asked
  whether OpenClaw or Hermes should host Dorothy, the research prompts
  carried that question forward, and the recommendation assumed she needs
  one body.
- The user proposed instead agent middleware, from LangChain's components
  or similar, that makes Dorothy protocol diverse: her soul and persona
  files generated for OpenClaw, DeepSeek Harness, Claude Code and the
  rest, and not on pi.

## The design discussed

The repository already holds its seed. `packages/identity` is
host-neutral by design ("names no host, protocol or provider"), and
`persona.ts` composes it with the parts that belong to one host. The
design has four layers:

1. **One definition**: her identity, voice and provenance as host-neutral
   text; a part for each host saying what she can do there; her skills as
   `SKILL.md`, which most harnesses read; and her MCP servers.
2. **Generators per host**: the definition compiled into each harness's
   own files, where its persona slot is.

   | Host | Persona slot | Replaces the host's prompt |
   | --- | --- | --- |
   | Claude Code | `--system-prompt`, an agent with `--agent`, an output style | Yes |
   | Codex | `model_instructions_file` | Yes |
   | OpenCode, Kilo | An agent file | Yes |
   | OpenClaw | `SOUL.md`, `IDENTITY.md` | First in the prompt |
   | Hermes Agent | `SOUL.md` | First in the prompt |
   | Qwen Code | `--system-prompt`, `QWEN_SYSTEM_MD` | Yes |
   | DeepSeek Harness | Unchecked | Unchecked |

3. **One memory service**: one MCP server every harness connects to, her
   recall today or a provider later, and each harness's sessions recorded
   back into it: by hooks where it has them (Claude Code, Codex, Qwen
   Code, Goose), by reading its session files where it does not.
4. **A protocol proxy**, where a file is not enough: every harness
   surveyed accepts a custom base URL, so `gateway`, extended from the
   Anthropic Messages API to OpenAI's Chat Completions and Responses,
   could put her persona and memory into any harness's requests.

LangChain fits inside Dorothy's own runtime, not other harnesses: her
chat, background reviews and compaction. LangChain.js 1.5.18's
`createAgent` has middleware for a system prompt made per request, for
summarisation and for model fallback (`dynamicSystemPrompt.ts`,
`summarization.ts` and `modelFallback.ts` in
`libs/langchain/src/agents/middleware/`). No runtime library can make
another harness into Dorothy; only generated files, the shared memory and
the proxy reach them.

What it costs:

- **Persona strength varies**: where a harness's prompt is replaced she is
  wholly herself; in OpenClaw and Hermes her `SOUL.md` leads a prompt the
  harness still writes; Goose documents no replacement and Crush takes
  only a prefix.
- **Recording varies**: hooks in some harnesses, session files in others,
  neither in a few.
- **Formats drift** as harnesses update, and the generators and recorders
  need upkeep.

## Found along the way

- [rulesync](https://github.com/dyoshikawa/rulesync) (MIT, TypeScript,
  1,530 stars, pushed 2026-10-17) generates rules, MCP, commands,
  subagents, skills, hooks and permissions from one source. Among the
  harnesses it covers are Claude Code, Codex, OpenCode, Goose, Hermes
  Agent, Qwen Code, Cline, Kilo Code, Amp and Kiro; for DeepSeek Harness,
  rules, MCP and skills; for OpenClaw, rules alone. A rule adds context; it
  does not fill a harness's persona slot.
- [ruler](https://github.com/intellectronica/ruler) (MIT, 2,947 stars)
  applies the same rules to every coding agent.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
  (MIT, TypeScript, 252,223 stars, "Everything is a Plugin"); its persona
  slot is unchecked.

## Rulings

1. Dorothy is protocol diverse. No one harness hosts her, Hermes Agent and
   OpenClaw included: one definition of her is generated into each
   harness's own files, and one memory serves them all.
2. pi is not to be used. This supersedes the replacements note's
   recommendation to rebuild her body on it.
3. Memory that works across harnesses is designed before the harnesses to
   target first are chosen.
4. Before anything bespoke is built, existing packages are researched:
   langchain-ai's components and others that could serve, and tools as
   widely adopted as rulesync.
5. Memory is judged by compatibility, then access, then progressive
   disclosure, then persistence, as the user ranked them the same day.

## Open questions

- Which harnesses to target first, once the memory work is designed.
- For each harness, whether her persona arrives as generated files,
  through the proxy, or both.
- How each harness's sessions reach the one memory: hooks, session files,
  or the proxy's view of the traffic.
- Whether the memory service is her own recall, a provider over her
  archive, or both, and the evaluation that decides it.
- Whether Dorothy keeps a runtime of her own (chat, reviews, compaction),
  and on what: LangChain.js, the AI SDK or another.

## Research since

Two research agents' reports sit beside these minutes.

[LangChain and the standards](./2026-10-18-protocol-diversity/langchain-and-standards.md):

- LangChain's libraries are MIT and run on Bun, but its memory parts fail
  compatibility: the Store is vector-only with no SQLite backend in JS,
  only LangChain's own clients speak Agent Protocol's `/store`, and
  langmem is dormant.
- Worth adopting from LangChain: openevals (MIT, TypeScript and Python)
  for the memory evaluation, and `createAgent`'s middleware list as a
  checklist for a runtime of her own.
- Definition standards (Open Agent Spec, Letta's Agent File, Microsoft
  Agent Framework's declarative agents) compile to frameworks, not
  harnesses.
- What reaches harnesses is Agent Skills, AGENTS.md, MCP and ACP, each in
  or joining the Linux Foundation's Agentic AI Foundation, which declined
  a `SOUL.md` proposal.
- No memory or persona interchange standard has adoption. Google's Open
  Knowledge Format v0.2, Markdown with YAML frontmatter and provenance, is
  the nearest shape to her facts.

[Cross-harness tooling](./2026-10-18-protocol-diversity/cross-harness.md):

- **rulesync** is the generator to use, pinned and checked. One owner
  makes some 90% of its commits, it shipped 27 releases in the month to
  2026-10-17, it has no plugin point, and it leaves persona files alone by
  policy.
- **Persona slots** are filled by a subagent in two hosts only: Claude
  Code's `--agent`, whose prompt "replaces the default Claude Code system
  prompt entirely", and OpenCode's primary agent. Codex, Hermes, OpenClaw
  and Qwen Code need writers of her own.
- **Five mechanisms** reach all twelve harnesses surveyed:
  - one MCP server;
  - one budgeted block per host, injected by Claude-shaped session-start
    hooks or written as a static file;
  - in-process adapters for OpenCode, Hermes, OpenClaw and DeepSeek
    Harness;
  - transcript readers that hooks trigger;
  - an ACP client for the sessions Dorothy launches.
- **Existing parts:** Hindsight's MIT adapters cover the four in-process
  hosts, and Letta's `trajectory` parses most transcripts.
- **The risks are design choices:**
  - where injected memory sits, for the prompt cache;
  - recording a turn twice;
  - exclusive memory slots;
  - rulesync replacing whole settings keys.

## Next

1. ~~Research langchain-ai's components, and standards for portable agent
   definitions, personas and memory.~~ Done above.
2. ~~Research tooling as widely adopted as rulesync, for generating
   configuration and sharing memory across harnesses.~~ Done above.
3. Design memory that works across harnesses, starting with
   brainstorming.
