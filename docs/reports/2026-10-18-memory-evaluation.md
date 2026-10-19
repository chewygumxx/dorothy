---
ctime: 2026-10-19
mtime: 2026-10-19
spdx: GPL-3.0-only
title: Dorothy's memory evaluation implementation
description: >-
  Progress, rulings and verification of the memory evaluation plan,
  carried out task by task by subagents on the branch
  feat/memory-evaluation.
tags:
  - dorothy
  - memory
  - eval
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-18-memory-evaluation.md
   -
   -->

# Dorothy's memory evaluation implementation

## Summary

The [plan](../plans/2026-10-18-memory-evaluation.md) for the
[memory evaluation](../specs/2026-10-18-memory-evaluation-design.md) is
carried out on the branch `feat/memory-evaluation`, from `main` at
`8458420`, one subagent at a time: an implementer per task, then a
reviewer of its diff, then a whole-branch review and one fix wave. Two
sessions shared the work: one ran Tasks 1 to 10's review, and the
other, after a usage limit, Task 10's fix round onwards.

`bun run check` passes at `ab18278`: 2013 tests pass, 1 is skipped and
none fail.

## Tasks

| Task | Subject | Commits |
| --- | --- | --- |
| 1 | the archive, through `@dorothy/memory/evaluation` | `4826883` |
| 2 | the eval package and its snapshot | `b0dd11e` |
| 3 | the question file | `b823190`, `1c9520c` |
| 4 | mining her appraised reads | `4e1b76b` |
| 5 | the models | `7649be5`, `a356455` |
| 6 | the systems | `489f5f7` |
| 7 | generating questions | `fe3bb3b`, `f75bda3` |
| 8 | the owner's review | `5ddd4e8` |
| 9 | records, the report and compare | `98782cb`, `2f1f0a3` |
| 10 | the run | `96e8721` to `3efc2ab` |
| 11 | documentation | `97a9025`, `e866e6c` |

Every task's review ended clean. Minor findings each review deferred
are kept in the plan's ledger; the whole-branch review weighed them and
raised none above Minor.

## Rulings

Each ruling overrides or settles plan text in favour of the spec, with
its cost if wrong.

1. No preflight conflicts beyond the plan review's, which had executed
   the plan in a scratch copy. If wrong, a fix round.
2. The question file reads as empty only when missing; any other read
   error is raised, so a rewrite never overwrites an unreadable file of
   the owner's decisions. If wrong, an unreadable file is a fault.
3. `eval.toml`'s parse error never quotes the parser, which may quote
   a key, and only a missing file reads as none. If wrong, a vaguer
   message.
4. Generation names each failed call's redacted reason, and stops after
   a 401, a 403 or three failures in a row. If wrong, a transient run of
   failures stops early, and rerunning resumes it.
5. Generation re-reads the question file and merges its drafts in at
   the end, and replaces `generated.json` only when missing. If wrong, a
   little more I/O.
6. In a run with models, a question that should have been judged but
   was not counts as a miss, so a flaky system scores no higher for its
   failures. If wrong, a failed call lowers a score, not a count.
7. A resume refuses a snapshot taken at another time, or other answer
   or judge models: one run holds one corpus and one pair of models. If
   wrong, a changed `eval.toml` needs a new run.
8. A resume asks a failed record again, the last record per question
   and system wins, and a failed retrieval spends no model call. If
   wrong, a persistently failing question is retried on each resume.
9. Tracing is turned off under all four LangSmith and LangChain
   variables. If wrong, two more variables overwritten in-process.
10. The README runs dotenvx through `bunx`, as elsewhere. If wrong, a
    longer command.
11. The final review's four Important findings are fixed, with seven of
    its Minor ones; three are deferred (below). If wrong, a few lines of
    extra code.
12. A resume asks a record the cap stopped mid-judging again from the
    start, paying its answer twice. If wrong, at most `--concurrency`
    answers are repaid per cap.

## Final review

The whole-branch review found no Critical issue and four Important ones,
fixed in `d8ed969` to `ab18278` and confirmed by a scoped re-review:

- a review now writes each decision afresh, so drafts that `generate`
  or `mine` add meanwhile survive;
- each judgement keeps its reasoning in the record;
- the report's "In context" column says whether `full`'s evidence
  fitted, which its Recall@10 cannot;
- `snapshot` refuses a work directory inside the repository.

Deferred, for a later branch:

- per-command `--help` listing each command's options;
- a run's base URLs in `run.json`, so a resume also refuses a role
  moved to another provider serving the same model;
- knowledge-update questions drawn from conversations that revise an
  earlier one, not only retired files: a spec decision for the owner.
