---
name: agent-pre-screening
description: >-
  Use when drafting or reviewing an evaluation's test set with agents:
  rendering the drafts for reviewers, briefing and dispatching them,
  applying their decisions, and the owner's spot-check and reopening of
  what they accepted.
ctime: 2026-10-31
mtime: 2026-10-31
spdx: GPL-3.0-only
tags:
  - agents
  - eval
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.agents/skills/agent-pre-screening/SKILL.md
   -
   -->

# Agent pre-screening

The evaluation's drafted questions are pre-screened by agents before the
owner checks a sample, rather than the owner reviewing every draft. The
commands are `eval review`'s, as the
[README](../../../README.md) describes them; `W` is the evaluation's
work directory, `~/eval` on the owner's machine.

## The rules

1. **Crosswise.** Each draft is judged by an agent of a vendor other
   than its generator's: Codex's GPT models review Claude's drafts, and
   Claude subagents review GPT's. No model family judges its own.
2. **One brief.** Every reviewer works to
   [the brief](./references/brief.md), copied beside its drafts, with
   its instructions naming three files: its drafts, its decisions and
   its summary.
3. **Evidence long enough to judge.** The first run rendered 1,500
   characters of each cited conversation, too few: some forty drafts
   were rejected for evidence never shown, and the round was redone at
   8,000. Review's default is now 6,000; set `--evidence` higher when
   conversations run long, and tell the reviewers how much they see.
4. **Private stays private.** Drafts, decisions and summaries quote the
   owner's sessions: they live under the work directory, never in this
   public repository, whose reports hold aggregates alone.
5. **Agents decide drafts; the owner overturns.** An agent's decisions
   go in through `--apply` under its own name. Only the owner reopens,
   as a reopen is logged as theirs.

## Render

```sh
bun run eval -- review --work "$W" --render "$W/agent-review" \
    --batches 4 --source <model> --evidence 8000
```

The drafts are written in file order to `drafts-1.md` and on, in N
contiguous batches as even as can be, the larger first, mode 0600.
`--source` takes the drafts of one generator, a bare model read as
`generated:<model>`; with none to render, it says so and writes nothing.
Render once per generator, so each batch goes to the other vendor.

## Dispatch

One batch per reviewer, dispatched and waited on as `agent-stewardship`
says: a Codex reviewer by a brief file, a Claude subagent by its prompt,
each on the budget the routing allows. A reviewer's instructions name
its drafts file, the decisions file it writes, one JSON line per draft,
and the summary beside it: the counts and the patterns it saw.

## Apply

```sh
bun run eval -- review --work "$W" --apply decisions-1.jsonl \
    --reviewer <name> --dry-run   # then again without --dry-run
```

Name the reviewer by agent and model, so `reviews.jsonl` says who
decided each. Review's own checks apply each line; one that fails, such
as an unknown key or an edit that changes nothing, is reported and
skipped, and the command exits 1. An `edit` is accepted under a new id;
an `unsure` leaves the draft for the owner. Fix and apply the lines it
skipped.

## The owner's spot-check

```sh
bun run eval -- review --work "$W" --spot-check spot-check.md --per 15
```

It writes every draft still left, then up to `--per` (15) questions of
each agent reviewer, drawn at random from those it accepted or edited,
each by its current id, still accepted, and named once. The owner's own
decisions are never sampled. The owner reads it; an accept they
overturn goes back to the drafts with

```sh
bun run eval -- review --work "$W" --reopen <id> --reason <text>
```

logged as the owner's, which voids the agent's earlier decision on it.
The draft is then decided again, by the owner in `review` or by another
agent's `--apply`. A rerun of the evaluation follows whatever the
spot-check changes.
