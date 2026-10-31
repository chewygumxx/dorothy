---
ctime: 2026-10-31
mtime: 2026-10-31
spdx: GPL-3.0-only
title: The pre-screening brief
description: >-
  The brief every agent pre-screening the evaluation's drafted questions
  works to: what to read, the checks in order, the decisions and the
  output.
tags:
  - agents
  - eval
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.agents/skills/agent-pre-screening/references/brief.md
   -
   -->

# Pre-screening the evaluation's test questions

You are pre-screening draft test questions for an evaluation of Dorothy's
memory: an archive of the owner's past sessions with coding agents. Each
draft you accept becomes an exam question; the memory systems retrieve
from the archive, a model answers from what they retrieved, and a judge
scores that answer against the draft's reference answer. Your decisions
decide what "good memory" means in every number that follows, so be
strict. The owner will spot-check your work, starting with every draft
you mark `unsure`.

## What to read

Your drafts file, named in your instructions, holds one block per draft:
its id, type, the date it is asked as of, its project, the question
(`Q:`), the reference answer (`A:`), for a knowledge update the older
claim it replaces, and its evidence: the cited conversations' turns, or
knowledge files, as the review tool shows them. Read every draft. Open
no other file of the evaluation's work directory or of Dorothy's data,
and run no command that writes there.

## The checks, in order

1. **Supported.** The evidence shown says what the reference answer
   says. Nothing in the answer may come from outside the evidence. A
   wrong or partly wrong answer: edit it if the evidence gives the right
   one, else reject.
2. **One clear answer.** A competent reader of the evidence would give
   the same answer. Vague, multi-part with unclear scope, or dependent
   on context the question omits: edit to sharpen, else reject.
3. **Its type.**
   - `single-session`: answerable from one conversation's turns.
   - `multi-session`: needs two or more of the cited conversations, each
     necessary; if one alone suffices, reject.
   - `temporal`: turns on when something happened, the order of events,
     or how long passed, readable from the dated turns.
   - `knowledge-update`: the answer is the newer fact, and the older
     claim shown was really replaced by it.
   - `preference`: asks for advice whose best answer depends on one of
     the owner's preferences, without naming it; the answer says what a
     good reply takes into account.
   - `abstention`: plausible, but nothing in the archive answers it; the
     answer says the memory does not know.
4. **Real work, worth remembering.** The owner would plausibly ask this
   later, in their own voice. Reject questions about:
   - probe, test, demo or fixture sessions: scripted prompts, dummy
     files, throwaway temporary projects, harness checks;
   - bookkeeping nobody recalls: session ids, tool-call counts, exact
     command flags of routine steps, transient status lines;
   - trivia whose answer would not matter to the owner.

   Prefer decisions and their reasons, facts about projects and the
   owner, plans, problems solved, conventions and preferences.

## Decisions

- `accept`: passes every check as written.
- `edit`: passes once you fix wording (natural, first person, as the
  owner would ask), a slightly wrong or incomplete answer, or evidence
  ids (only ids already shown in that draft). An edit is accepted.
- `reject`: fails a check that an edit cannot fix.
- `unsure`: depends on the owner's taste, or the evidence shown is cut
  off where it matters. Use it sparingly, and say why.

Never invent a fact. Keep each reason to 20 words or fewer, and never
copy a secret, token or personal detail into a reason.

## Output

Write one JSON object per line, one line per draft, every draft covered,
to the decisions file your instructions name:

```json
{"id": "q-…", "decision": "accept", "reason": "…"}
{"id": "q-…", "decision": "edit", "reason": "…", "answer": "…"}
{"id": "q-…", "decision": "reject", "reason": "probe session"}
{"id": "q-…", "decision": "unsure", "reason": "…"}
```

An `edit` carries only the fields it changes, among `question`, `answer`
and `evidence`. Do not edit the test set or run the review command: the
controller applies your file with the review tool's own checks. Then
write a summary beside it: the counts of each decision, and the patterns
you saw, such as what was commonly wrong and which kinds of session the
drafts leaned on.

## About the evidence shown

Each cited conversation is shown as an excerpt, as long as your
instructions say: the turns that best match the question and answer,
with their neighbours. The drafting model may have seen more. If the
fact an answer needs is not shown, reject it as unverifiable, unless the
turns shown make it clearly true. A test question must be checkable.
