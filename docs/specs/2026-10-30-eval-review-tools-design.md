---
ctime: 2026-10-30
mtime: 2026-10-30
spdx: GPL-3.0-only
title: The evaluation's plan limits and review tools
description: >-
  Design spec for stopping a run at a plan's usage limit rather than
  scoring misses, for review showing enough evidence to judge, and for
  applying an agent's review decisions with review's own checks.
tags:
  - dorothy
  - eval
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-30-eval-review-tools-design.md
   -
   -->

# The evaluation's plan limits and review tools

## Summary

Three faults surfaced while preparing the
[evaluation's](./2026-10-18-memory-evaluation-design.md) first full run,
on 2026-10-29 and 30. A call through the user's
[plans](./2026-10-29-eval-subscriptions-design.md) that meets a usage
limit fails, and a failed call counts as a miss, so a run that outlives
a limit would score every later question wrong. `review` shows 1,500
characters of each cited conversation, where a draft was written from
up to 16,000; an agent pre-screening drafts rejected some forty for
evidence it could not see. And agents' review decisions were applied by
a script outside the repository. This spec fixes all three.

## Decisions

| Decision | Choice | Why, and the cost if wrong |
| --- | --- | --- |
| A plan's limit | A CLI reply that says its plan's usage limit is reached stops the run as `--max-calls` does: done work kept, `--resume` finishes it | A limit says nothing about the systems; a miss would. Cost: a reply misread as a limit stops a run that could go on |
| Recognising it | Codex: a `turn.failed` or error event, or the exit, naming a usage limit; Claude: an error reply with status 429 or naming a usage limit or credits | The phrases each CLI prints today, read from the reply, never printed. Cost: a CLI that rewords them fails calls as before |
| Generate | The same stop, with the drafts made so far kept | As `--max-calls` stops it. Cost: none |
| Evidence shown | `review --evidence <chars>`, default 6,000 per cited conversation | Enough for most drafts; the terminal scrolls. Cost: longer pages |
| Agents' decisions | `review --apply <file> --reviewer <name>` | One line per draft, `accept`, `edit`, `reject` or `unsure`, applied with review's own checks; `--dry-run` reports without writing |
| Who reviewed | `reviews.jsonl` in the work directory: each decision's question, new id, reviewer, decision, reason and time | The question's `note` holds a knowledge update's older claim. Cost: none |

## Applying decisions

Each line is `{"id", "decision", "reason"}`, an `edit` adding any of
`question`, `answer` and `evidence`. An `accept` or `reject` acts as the
keys do; an `edit` is checked as an edit in the editor is (the schema,
evidence in the snapshot, a new id, no collision) and then accepted; an
`unsure` leaves the draft for the owner and is logged. A line naming no
draft, or a draft already decided, is reported and skipped. Interactive
decisions are logged too, with the reviewer `owner`.

## Testing

A fake runner returns each CLI's limit reply: the run stops, keeps what
it finished, and `--resume` completes it with no miss recorded; other
failures still count as misses. `review --evidence` shows the longer
passage. `--apply` over a temporary work directory: each decision, an
edit's checks, a missing or decided draft, `--dry-run`, and the log.

## Verification

The controller applies the remaining agent decisions with `--apply`.
