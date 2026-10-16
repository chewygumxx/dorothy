---
ctime: 2026-10-16
mtime: 2026-10-16
spdx: GPL-3.0-only
title: "Conversation with Claude: Dorothy's Token Usage"
description: >-
  Claude's measured audit of where Dorothy's Claude Code usage goes: her
  code, its comments and complexity, and the superpowers pipeline's plans.
tags:
  - dorothy
  - claude-code
  - superpowers
  - tokens
  - notes
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-10-16_claude-conversation-token-usage.md
   -
   -->

# Conversation with Claude: Dorothy's Token Usage

Exported on 2026-10-16 from a claude.ai session. Its figures were measured
on a clone at `3b15235`, and its account of the pipeline comes from the
superpowers v6.4.1 skills. Nothing in it has been acted on yet.

## chewygumxx Prompt 1

I've got an experimental project which is near entirely built by Claude
Code. It has grown to the degree that even after modularisation, some
monolithic modules consume entire 5 hour limits, consecutively, to
implement a feature.

It could probably be refactored again, agentic assets scoped per
directory, or I could simply purchase Claude Max. I'm wondering if it is
something more intuitive, or rather borderline superstitious, instead
such as Typescript being a difficult language for LLMs, garbage
cyclomatic code demanding excessive token consumption, or just a tonne
of comments difficult to justify.

<https://github.com/chewygumxx/dorothy>

---

## Claude Response 1

I'll clone the repo and measure where the token weight actually lives
(file sizes, comment density, complexity, agent docs) before answering.

> _Cloned the repository, sized its code, docs and plans, measured comment
> density, ran Biome's cognitive complexity rule, split each merged pull
> request's additions by kind, and read the superpowers
> `subagent-driven-development` and `writing-plans` skills_

Lines added per feature pull request:

| Pull request      | Markdown | Source | Tests |
| ----------------- | -------: | -----: | ----: |
| #2 catalogue      |    6,367 |  2,153 | 2,623 |
| #3 recall         |    6,475 |  2,382 | 2,799 |
| #6 compaction     |    6,531 |  2,807 | 4,454 |
| #7 tags           |    8,349 |  2,494 | 2,813 |
| #8 history        |    9,623 |  3,536 | 3,302 |
| #10 modularity    |    4,299 |  1,227 |   897 |
| #11 agent assets  |    3,825 |     99 |   524 |
| #17 identity      |    3,511 |    653 |   983 |
| #22 delivery      |    4,959 |  1,499 | 1,787 |

### Short answer

None of your three suspects is the main cause. The token sink is the
development process: each feature's code gets written twice, then read
over and over by agents that start with no context. In most feature PRs,
more than half of the added lines are Markdown, as the table above shows.

### What I measured

| Corpus                   | Size                                         |
| ------------------------ | -------------------------------------------- |
| Source (non-test TS/TSX) | 22,201 lines, 728 KB                         |
| Tests                    | 27,915 lines, 961 KB                         |
| `docs/plans/` (15 plans) | **2.1 MB**, 56% to 83% of it in code fences  |
| `docs/specs/`            | 297 KB                                       |
| `docs/reports/`          | 247 KB                                       |

The plans alone are larger than the entire codebase including tests. At
roughly 4 characters per token, that is over half a million tokens of
generated plan text.

### The suspects, one by one

#### TypeScript being hard for LLMs: superstition

TypeScript is one of the best-represented languages in training data,
and `tsc` feedback cuts down on wasted iterations rather than adding to
them. The one small real cost is that you are on very new versions
(TypeScript 7, Bun 1.4, zod 4), which are newer than much of what models
have seen. That causes the odd doc lookup, not five-hour sessions.

#### Comments: real, but small

Comments make up 16.6% of source characters, about 120 KB (roughly 30k
tokens) across the whole repo. The densest files are
`compaction/shared.ts` (36%) and `persona.ts` and
`compaction/session.ts` (28% each). Tests are only 3% comments. Even if
you deleted every comment, you would barely notice the difference
against the plans.

#### Cyclomatic complexity: real, but local

I ran Biome's `noExcessiveCognitiveComplexity` at its default threshold
of 15. **44 functions** exceed it. The worst ones are in files nearly
every feature touches:

- `parseArgs` in `cli/src/index.ts`: complexity **120**, about 215
  lines. Every new flag passes through it.
- `edit-view.ts:176`: 64
- `Conversation#handleMessage`: 55
- `open.ts:500`: 40

There is a convention for the `parseArgs` problem. `util.parseArgs` from
`node:util` (which Bun implements) gives you a declarative option table.
The POSIX Utility Syntax Guidelines, plus GNU long options, define the
expected behaviour. Your recent "Parse the bare flags from one table"
commits are already heading that way.

The giant test files matter more than the comments do.
`compaction/session.test.ts` is 2,045 lines (79 KB, roughly 20k tokens
per full read), and `memory/service.test.ts` is 43 KB.

### The actual sink: the superpowers pipeline

Every feature runs through this chain:

1. **`brainstorming`** produces a spec of about 30 KB.
2. **`writing-plans`** requires complete code in every step, so the plan
   contains essentially the whole implementation. The `memory-history`
   plan is 262 KB, with about 200 KB of fenced code, for a PR that added
   about 6,800 lines of source and tests. The code is written in the
   plan, then transcribed into the source.
3. **Plan review and mending** generate more output.
4. **`subagent-driven-development`** dispatches a fresh implementer and
   a fresh reviewer for each task. A task can reach 12 dispatches if fix
   loops run, and the run ends with a whole-branch review on the most
   capable model.
5. **A report** of 15 to 30 KB is written at the end.

The multiplier is what makes it hurt. Each fresh subagent re-reads the
`AGENTS.md` chain, its brief, the diff, and whichever 2,000-line test
file sits next to its task. Big files times cold agents is
multiplication. That is why modularising alone didn't fix it: the files
got smaller, but the number of cold readers stayed the same.

#### A side effect: stale code in search results

Because the plans hold copies of the code, symbol searches return mostly
plan text:

| Symbol          | Hits in `docs/` | Hits in `packages/`             |
| --------------- | --------------: | ------------------------------- |
| `MemoryService` |              55 | 13                              |
| `openMemory`    |              42 | 21                              |
| `Reviewer`      |              18 | 0 (only in the recording plan)  |

Every grep makes the agent sort out outdated drafts from the real code.
The conventional fix is a ripgrep `.ignore` file, which Claude Code's
Grep tool respects. The plans stay tracked in git but drop out of
searches:

```gitignore
docs/plans/
docs/reports/
```

#### Minor: an output-style plugin

`.claude/settings.json` enables `explanatory-output-style`, which adds
insight blocks to every reply. It is a small cost per turn, but worth
turning off for long implementation runs.

### Alternatives to the current process

For a solo, experimental project, the spec, full-code plan, per-task
subagents and report pipeline is heavy machinery. Three lighter options,
in the order I'd try them:

1. **Keep the pipeline, but make plans thin.** Your `AGENTS.md` already
   says its rules override the skills. Add a rule that plans name files,
   signatures, behaviours and the tests that must pass, with no
   implementation bodies, aiming for under about 20 KB. This removes the
   single largest block of output, and it is a one-paragraph change.
2. **Put cheaper models on the per-task work.** Have implementers and
   task reviewers run on Sonnet and keep Opus for the final branch
   review; the Agent tool takes a per-dispatch model override. Or run
   `executing-plans` inline in one session, with checkpoints instead of
   per-task dispatch.
3. **Drop the spec, plan and report set for small and medium features.**
   Use Claude Code's plan mode, implement directly, and record only real
   decisions as short ADRs (Michael Nygard's Architecture Decision Record
   format is the convention). The PR description can stand in for the
   report.

Whichever you pick, splitting the two giant test files and making
`parseArgs` table-driven will pay off. Enabling
`noExcessiveCognitiveComplexity` as a warning in
`@chewygumxx/biome-config` would stop the complexity from creeping back.

### On buying Max

Max gives you more headroom, but it runs the same multiplier. Your next
queued plan, `memory-bodies-recording` (232 KB, 12 tasks), will be
expensive on any plan as written.

Before deciding, measure one feature. A community tool such as
`ccusage` breaks down usage from the session transcripts under
`~/.claude/projects`. That will show how much goes to writing the plan
versus the implementers and reviewers, and confirm or correct my
estimate.

### Sources

- [superpowers v6.4.1: subagent-driven-development][sdd]
- [superpowers v6.4.1: writing-plans][wp]
- [chewygumxx/dorothy](https://github.com/chewygumxx/dorothy)

[sdd]:
  https://github.com/obra/superpowers/blob/v6.4.1/skills/subagent-driven-development/SKILL.md
[wp]:
  https://github.com/obra/superpowers/blob/v6.4.1/skills/writing-plans/SKILL.md
