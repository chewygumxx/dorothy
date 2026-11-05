---
ctime: 2026-11-03
mtime: 2026-11-06
spdx: GPL-3.0-only
title: Problems
description: >-
  Symptoms a reader meets in Dorothy or in working on her repository, each
  with its cause, how to tell, the remedy, whether it is resolved, and the
  record that says so.
tags:
  - wiki
  - problems
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/wiki/problems.md
   -
   -->

# Problems

[Wiki home](../README.md)

Each heading is a symptom as a person would see or search for it. Under it
the entry gives the **Cause**, the **Diagnosis** (how to tell this from its
neighbours), the **Remedy**, the **State** and the **Evidence**. The state
is one of three, and the entry never blurs them:

- Resolved defect: it was a fault and a fix is recorded, with its report or
  commit.
- Known limitation: the behaviour is understood and left as it is, by design
  or for later; a record says so.
- Workflow pitfall: nothing in the code is wrong; working in or on the
  repository goes astray in a known way.

The entries rest on `docs/deferred/`, the
[repository code review](../reports/2026-10-19-code-review.md), the reports'
limitations and findings, and the `feedback` memories in `.agents/memory/`.
A report's workaround is not called necessary now unless the code or a later
record was checked, and the entry says when it was not. What a host has been
shown to do is on [harnesses](./profiles/harnesses.md), not here.
[Questions](./questions.md) answers what a reader asks before anything goes
wrong, and [decisions](./decisions.md) says why the rule behind an entry is
what it is.

## The evaluation stops and exits 75

- **Cause**: A call through the user's Claude or Codex plan met the plan's
  usage limit. Before the fix of 2026-10-30 such a call failed, and a failed
  call counted as a miss, so a run that outlived a limit would have scored
  every later question wrong. A reply that says the plan's limit is reached
  now stops the run as `--max-calls` does.
- **Diagnosis**: The exit status is 75 (`EXIT_TEMPFAIL`), where a call cap
  exits 0. Work done is kept and no miss is recorded. The reply is read
  before the exit code: Claude by a 429 status or wording such as a usage
  limit or out of credits, Codex by an error or `turn.failed` event, and
  only when the turn did not complete, since a retry notice that a
  completed turn outlived is no limit. A Codex notice that the plan switched
  the model under limits also stops the run
  ([eval guide](../../packages/eval/AGENTS.md)).
- **Remedy**: Wait for the reset. `run` finishes with `--resume`, and
  `--resume latest` takes the newest run; `generate` is run again and keeps
  the drafts made.
- **State**: Resolved defect. A limitation the spec names remains: a CLI
  that rewords its limit message fails calls as before, and a reply
  misread as a limit stops a run that could have gone on.
- **Evidence**:
  [the report](../reports/2026-10-30-eval-review-tools.md#summary), its
  [reviews](../reports/2026-10-30-eval-review-tools.md#reviews) (a retry
  notice read as a limit, fixed), the
  [spec's decision](../specs/2026-10-30-eval-review-tools-design.md#decisions)
  and [the decision entry](./decisions.md#a-plans-usage-limit-stops-a-run-a-failure-is-a-miss).
  The first evaluation ran through limits it stopped at and resumed from
  ([summary](../reports/2026-10-31-first-evaluation.md#summary)).

## An agent's job stops part way, or its plan runs out

- **Cause**: The Claude and Codex plans have usage windows, and a job that
  outlasts one stops. The user's memory records that both plans hit their
  limits often, and it names the occasion that set the rule: on 2026-10-29 a
  136-draft review sent to Codex at `xhigh` with 59% left ran out halfway
  ([usage limits](../../.agents/memory/usage-limits.md)).
- **Diagnosis**: Each client reports its own budget. Claude Code gives its
  plan's `rate_limits` to the status line alone, so the project's status line
  writes them to a file the agent reads before dispatching
  ([report](../reports/2026-10-30-eval-review-tools.md#reading-claudes-budget)).
- **Remedy**: Estimate what a job will spend, then route it to Codex if it
  fits, else a Claude subagent on the primary account that leaves room for
  the coordinator, else the reserve account, else wait for the first reset;
  arm a wake-up before a limit can stop an agent. The skill and the
  orchestration page hold the procedure, and the
  [decision](./decisions.md#work-is-routed-by-usage-budget) the reasons.
- **State**: Workflow pitfall. The limits are the plans', not a defect.
- **Evidence**: Three more records meet one. The backfill review's Task 1
  was built by Codex until its five-hour limit neared, and Claude subagents
  took the rest
  ([report](../reports/2026-10-29-backfill-review.md#summary)). The review
  tools were built by Claude subagents, Codex having spent its limit
  ([report](../reports/2026-10-30-eval-review-tools.md#summary)). Codex's
  usage was spent until 5 November (17:23, Melbourne), which holds its live
  delivery probe ([delivery report](../reports/2026-11-01-delivery.md#waiting-for-the-user)).
  [Orchestration](./topics/orchestration.md#how-her-developers-are-coordinated-today)
  describes how the agents are coordinated meanwhile.

## A question she should answer is declined though the conversation is in her memory

- **Cause**: Finding a conversation is not delivering its passage. In the
  first evaluation her search found evidence for a question, and the model
  was handed the conversation's note, not the passage that held the fact.
  Knowledge hits crowded the passages out of the budget.
- **Diagnosis**: The retrieval stages tell found, delivered and covered
  apart. In the engine's research her search found a cited source for
  102 of 125 questions, but evidence reached the model for only 9; of the 58
  questions whose evidence reached it before the fix, 49 had it only as a
  note. In the first evaluation 77% of her answers declined where
  the evidence existed. `--dump-context` prints exactly what a chat's first
  request holds ([models and routing](./topics/models-and-routing.md#the-calls)).
- **Remedy**: Fixed in the engine's first step: `deliver` renders the
  passages around matched turns and alternates knowledge with conversations,
  and evidence reached the model for 98 of 125 questions, past lexical
  search's 69
  ([what `deliver` hands over](./topics/memory.md#what-deliver-hands-over)).
- **State**: Resolved defect. A limitation remains and is measured: at her
  defaults she answers 43 of 125 strictly against 85 for the
  `cited` ceiling, which is given the right evidence, and across sessions she
  passes 2 of 38. A chunk index or hybrid search is held by the roadmap for
  the questions only lexical search passes
  ([what the results establish](./topics/evaluation.md#what-the-results-establish)).
- **Evidence**:
  [first evaluation, what it shows](../reports/2026-10-31-first-evaluation.md#what-it-shows),
  [engine report, the rerun](../reports/2026-10-31-memory-engine.md#the-rerun),
  [engine report, verification](../reports/2026-10-31-memory-engine.md#verification)
  and [the decision](./decisions.md#her-engine-stays-hers).

## A long matching turn arrives as a title and dates alone

- **Cause**: In the evaluation's corpus, a best-matching turn too long for
  its passage allocation was dropped whole. If it was the first candidate,
  the answering model got only the title and dates, while the retrieval count
  still counted the conversation as retrieved, so a figure could say
  retrieved where nothing was delivered.
- **Diagnosis**: Delivered text that is a bare header over a long conversation.
  The review's probe used a turn that began "My bicycle is crimson" and
  continued for 8,000 characters under the default 8,000 budget.
- **Remedy**: Oversize turns are now clipped to excerpts around the matching
  words, including with normalised Unicode.
- **State**: Resolved defect (finding F03), still reproducing at the review's
  recheck of 2026-10-20 and closed by the roadmap sweep.
- **Evidence**:
  [code review F03](../reports/2026-10-19-code-review.md#f03-p2-long-matching-turns-disappear-from-evaluation-context),
  [the sweep's resolutions](../reports/2026-10-19-roadmap-sweep.md#code-review-resolutions)
  (`27f0d9c`, `eda9d6b`, `62cc665`).

## Search finds little of a session recorded from another host

- **Cause**: A conversation backfilled from a host's earlier sessions has no
  notes (title, abstract, tags) until a review writes them, and recording
  keeps backfilled conversations from every review until a live append. On
  2026-10-29, 305 of the store's 314 sidecars were empty.
- **Diagnosis**: An empty sidecar for the session. The first evaluation
  measured the difference: with no notes she found the evidence for under a
  tenth of the questions, with them nearly half.
- **Remedy**: `dorothy --review-backfill [-n <count>]` reviews the newest
  backfilled conversations in batches, 25 by default. It spends the user's
  Claude plan, so it is the user's or the agent's command and not a
  background job. A failed model call restores that conversation's mark and
  stops the batch, and a rerun resumes.
- **State**: Known limitation. The 302 conversations backfilled by the first
  snapshot were all reviewed before the second snapshot, and the roadmap
  records the backfill as recorded and reviewed. A conversation backfilled
  since stays without notes until the user runs the command.
- **Evidence**:
  [the memory page](./topics/memory.md#what-is-stored),
  [backfill review report](../reports/2026-10-29-backfill-review.md#rulings),
  [first evaluation](../reports/2026-10-31-first-evaluation.md#summary),
  [roadmap](../roadmap.md#dorothys-memory)
  and [the decision](./decisions.md#the-backfill-is-the-users-command-and-its-review-runs-in-capped-batches).

## A reply stops part way with an error

- **Cause**: Fallback moves a failed call to the next entry of the role's
  route, but not once the turn has had effects: text has streamed or
  `remember` has run. Another model would repeat what was already shown or
  written. The turn then ends with an `error` event carrying its partial
  reply.
- **Diagnosis**: The chat shows the partial text and an error, and no note of
  the form "X refused; answering with Y". A turn that failed after lookups
  alone is not this: lookups are reads, so the next entry replays it from the
  user's message and the chat says so.
- **Remedy**: Ask again. The TUI reconnects, and the next turn starts from
  the first entry not in cooldown. A route with one entry has nothing to fall
  to, so give a role a second entry
  ([Fallback](./topics/models-and-routing.md#after-a-turn-has-had-effects)).
- **State**: Known limitation, by design. This behaviour rests on the spec,
  the code and tests: two tests pin the replay after lookups and the no-replay
  after streamed text, and `fallback.test.ts` pins that `runRoute` stops
  after a started attempt fails. The live runs did not make a started turn
  fail on a real provider, so it has not been seen on one.
- **Evidence**:
  [the decision](./decisions.md#failures-fall-back-except-cancellations-and-turns-with-effects),
  [the agent guide's invariants](../../packages/agent/AGENTS.md#invariants),
  [the spec](../specs/2026-11-01-model-providers-design.md#fallback) and
  [`turn.ts`](../../packages/agent/src/turn.ts).

## "Concurrency limit exceeded" from featherless

- **Cause**: featherless's plan used in the live run (`feather_pro_plus`)
  allows four concurrency units, and GLM-5.3-Flash costs four a request, so
  a review and a chat turn on that model collided. The chat was refused, and
  its route had a single entry.
- **Diagnosis**: The refusal names the concurrency limit and appears when
  two roles share one model on the plan.
- **Remedy**: Give the role a second entry in its list, as the README says.
- **State**: Known limitation of that plan, as of 2026-11-01. The provider's
  current terms were not checked for this page.
- **Evidence**:
  [model providers report, findings](../reports/2026-11-01-model-providers.md#findings-1),
  [deferred findings](../deferred/2026-11-01_model-providers-deferred.md#behaviour)
  and [services](./profiles/services-and-providers.md#featherlessai).

## A reply ends at the model's output limit, or shows no text

- **Cause**: The Chat Completions kinds send no output limit, so the
  provider's default applies (featherless's is 4,096 tokens), and they set no
  thinking, so a reasoning model thinks at the provider's default. One turn
  spent exactly the default and showed no text and no warning.
- **Diagnosis**: The chat shows the warning "the reply stopped at the model's
  output limit"; before the fix there was none.
- **Remedy**: The warning is the fix. Sending an output limit of Dorothy's
  own waits, as a provider may refuse one, and a second route entry on
  another model is the workaround.
- **State**: Known limitation, deferred: no output limit of Dorothy's own is
  sent. The missing warning was a defect, now fixed; the warning is shown by
  its test, and a rerun of the turn answered in full, so the warning itself
  was not seen live.
- **Evidence**:
  [report findings](../reports/2026-11-01-model-providers.md#findings-1),
  [deferred](../deferred/2026-11-01_model-providers-deferred.md#behaviour)
  and [`conversation.ts`](../../packages/agent/src/conversation.ts).

## A review or compaction fails with "over 160" or "over 1000" characters

- **Cause**: Anthropic's structured output does not enforce `maxLength` and
  similar limits, which the AI SDK moves into descriptions. A review's
  description came back at 167 characters and a compaction abstract at 1,160,
  over memory's limits of 160 and 1,000.
- **Diagnosis**: Memory's own check fails the output with those figures.
- **Remedy**: `structuredCall` now validates the answer against the whole
  schema and, on a mismatch, asks the model again at most twice with the
  issues named, then fails the attempt as `unparsed`.
- **State**: Resolved defect. The second chat of the live run passed.
- **Evidence**:
  [the finding](../reports/2026-11-01-model-providers.md#structured-output-held-to-its-schema)
  (`b2fe491`).

## A reply that follows a tool call appears all at once

- **Cause**: After a tool result, Sonnet 5.5's whole response arrived at once
  on the Messages API, from a raw request with no SDK in the way, where
  Haiku 5.5 streamed over 1.3 seconds. The report takes it to be Anthropic's
  behaviour for that model.
- **Diagnosis**: Time to first token equals the turn's duration within
  4 milliseconds, on a turn with a tool call; a turn without one streams.
- **Remedy**: None in Dorothy's code; the report says she can do nothing
  about it.
- **State**: Known limitation, as measured on 2026-11-01 for those two
  models. It has not been rechecked on later model versions.
- **Evidence**:
  [the finding](../reports/2026-11-01-model-providers.md#text-after-a-tool-call-arrives-at-once).

## A streamed rate limit is treated as a network failure

- **Cause**: A mid-stream error whose code is a word, such as
  `rate_limit_exceeded`, is classed `network`. The call still falls back,
  since every class but `cancelled` does, but the provider is not put in
  cooldown and the note names the wrong class.
- **Diagnosis**: The fallback note says network where the provider said
  rate limit.
- **Remedy**: None yet. `failures.ts` still classes an error with no status
  and no known type or name as `network` (read for this page on 2026-11-03).
- **State**: Known limitation, deferred.
- **Evidence**:
  [deferred findings](../deferred/2026-11-01_model-providers-deferred.md#behaviour)
  and [`failures.ts`](../../packages/agent/src/failures.ts).

## A resumed evaluation run skips questions

- **Cause**: Resume intersected the run's question ids with the currently
  accepted questions and checked only that the result was not empty, so a
  question removed or edited since the run began was skipped, and the run
  reported success with its original question count.
- **Diagnosis**: A fixture run with two questions, one removed before resume,
  exited zero with one record and no warning.
- **Remedy**: A missing, rejected or changed definition now refuses resume,
  gold answers included, and an incomplete legacy run refuses too. Saved
  definition digests make comparisons warn when definitions differ.
- **State**: Resolved defect (finding F04, with its concern about question
  ids).
- **Evidence**:
  [code review F04](../reports/2026-10-19-code-review.md#f04-p2-resume-silently-loses-questions-removed-since-a-run-began),
  [the sweep's resolutions](../reports/2026-10-19-roadmap-sweep.md#code-review-resolutions)
  (`8e0c2ff`, `5289bda`).

## An agent reviewer rejects drafted questions as unsupported

- **Cause**: `review` showed 1,500 characters of each cited conversation,
  where a draft was written from up to 16,000, so an agent rejected some forty
  drafts for evidence it was never shown.
- **Diagnosis**: Rejection reasons that cite evidence the draft's
  conversation holds beyond the first 1,500 characters.
- **Remedy**: `review --evidence <chars>` defaults to 6,000, and the first
  round of pre-screening was
  [redone](../reports/2026-10-31-first-evaluation.md#the-test-set) with more
  of each conversation.
- **State**: Resolved defect.
- **Evidence**:
  [the report](../reports/2026-10-30-eval-review-tools.md#summary) and
  [the evaluation page](./topics/evaluation.md#the-questions).

## The evaluation's figures disagree between reports

- **Cause**: The reports measured at different times. The first evaluation
  put her strict accuracy at 7.3% against lexical search's 25.0%; the rerun
  has 43 of 125 against 27. The judges were changed in between (`MEMORY_NOTE`,
  #102), so the figures do not compare, and the first evaluation
  carries two corrections of its own claims.
- **Diagnosis**: Check which run a figure comes from. Everything before the
  rerun of 2026-11-01 is historical.
- **Remedy**: Take current figures from the
  [rerun](../reports/2026-10-31-memory-engine.md#the-rerun), and read earlier
  ones only for what they taught.
- **State**: Workflow pitfall in reading the records.
- **Evidence**:
  [limits](./topics/evaluation.md#limits),
  [history](./topics/evaluation.md#history),
  [first evaluation corrections](../reports/2026-10-31-first-evaluation.md#what-it-shows).

## Compaction summarised the wrong turns of a chat

- **Cause**: Two TUIs resuming one conversation each kept a private turn
  history. B's compaction saved its local summary as a shared cluster
  numbered for turns that A's canonical turns held, without checking which
  transcript turns it described, so a resumed context omitted A's text.
- **Diagnosis**: A saved cluster whose summary covers other turns than the
  transcript's at those numbers; the transcript itself kept A's text.
- **Remedy**: Outgoing turns must now agree with the canonical transcript
  before compaction is paid for (`5cedfc4`).
- **State**: Resolved defect (finding F22).
- **Evidence**:
  [code review F22](../reports/2026-10-19-code-review.md#f22-p2-concurrent-chats-compact-the-wrong-shared-transcript-turns),
  [the sweep's resolutions](../reports/2026-10-19-roadmap-sweep.md#code-review-resolutions).

## A resumed Claude Code session has no persona, or shows the marker

- **Cause**: Claude Code records a conversation's system prompt on its first
  request. A session begun without the launcher and resumed with it carries
  no marker, so no identity; one begun with it and resumed in plain `claude`
  sends the marker, an HTML comment, to the API.
- **Diagnosis**: No persona in a resumed session, or the comment in a request.
- **Remedy**: Begin and resume with `dorothy --claude`.
- **State**: Known limitation, kept as a risk by the design; the marker
  fails safe, without the identity and with nothing broken. As recorded
  against Claude Code 2.1.296 on 2026-10-15; later versions are on
  [harnesses](./profiles/harnesses.md#claude-code).
- **Evidence**:
  [the identity page](./topics/identity-and-harnesses.md#the-gateway),
  [spec risks](../specs/2026-10-15-identity-gateway-design.md#known-risks)
  and [the implementation report's limits](../reports/2026-10-15-identity-gateway-implementation.md).

## Tests fail in a background session with colour codes

- **Cause**: Claude Code background sessions (`claude --bg`) export
  `FORCE_COLOR=3` to their tools, which the user's own shell does not. On
  2026-10-05 this made 12 Ink frame tests fail.
- **Diagnosis**: Output differing between a background session and the
  user's terminal: check the session's environment before the shell.
- **Remedy**: `test-setup.ts`, a `bun test` preload, now sets
  `FORCE_COLOR=0` before Ink is imported.
- **State**: Workflow pitfall. The tests, where it was met, no longer suffer
  from it, as the preload fixes their colour; other output a background
  session colours may still differ.
- **Evidence**:
  [the memory](../../.agents/memory/bg-session-force-color.md) and
  [`test-setup.ts`](../../test-setup.ts).

## `claude -c` or `claude purge` acts on the live session

- **Cause**: A Claude Code session's tools export `CLAUDE_CODE_PROJECT_DIR_NAME`
  and `CLAUDE_CODE_SESSION_ID`, which outrank the working directory. A
  `claude` run from the session's Bash tool files its sessions under that
  project. On 2026-10-15 an end-to-end `claude -c` continued the live session
  and appended a turn to it, and a dry run of `claude purge` listed the whole
  Dorothy project for deletion.
- **Diagnosis**: A test transcript that appears in the live project.
- **Remedy**: Before running a real `claude` from a session, unset its
  `CLAUDE_CODE_` variables and keep `CLAUDE_CONFIG_DIR`; use `--resume <id>`,
  not `-c`; never run `claude purge` without `--dry-run`; remove test
  transcripts by hand. This is the memory's instruction, not rechecked here.
- **State**: Workflow pitfall.
- **Evidence**:
  [the memory](../../.agents/memory/nested-claude-session-env.md).

## secrets not loaded (SOPS_FAILED) on a temporary root

- **Cause**: With `XDG_CONFIG_HOME` on a temporary root, mise did not find
  its trust records, so its `sops` shim failed. The code returns
  `SOPS_FAILED` for any failure of sops but a missing binary, which is
  `SOPS_MISSING` ([`secrets.ts`](../../packages/core/src/secrets.ts)).
- **Diagnosis**: The code alone, never sops's own message, so a log holds
  no fragment of a secret. Check whether `sops` runs under the temporary
  roots.
- **Remedy**: The report put sops's install directory first on `PATH`,
  which was enough then. Whether it is still needed was not checked.
- **State**: Workflow pitfall; Dorothy's code was not at fault.
- **Evidence**:
  [the finding](../reports/2026-11-01-model-providers.md#probing-on-temporary-roots)
  and [secrets](./topics/repository-workflow.md#secrets).

## commitlint rejects a commit header in a plan

- **Cause**: commitlint here rejects a header over 50 characters and a body
  line over 72. The limits come from the shared commitlint config and not
  from `.commitlintrc.mts`, so they are easy to miss when planning. The
  delivery plan's headers ran to 60 and more, and every task had to shorten
  them.
- **Diagnosis**: The commit-msg hook's error names the length.
- **Remedy**: Write each plan commit step with a header of at most 50
  characters, scope included, and bodies wrapped at 72.
- **State**: Workflow pitfall.
- **Evidence**:
  [the memory](../../.agents/memory/plan-commit-headers.md) and
  [the checks](./topics/repository-workflow.md#the-checks).

## `bun run check` fails on a memory file after a sync export

- **Cause**: Sync exports model-written bodies as they are, and `lint:md` and
  `lint:emdash` cover `.agents/memory/`, so an export into the checkout of a
  fact with an em dash or a body line over 80 characters fails the check
  until the file is edited.
- **Diagnosis**: The failure names a file under `.agents/memory/` and its
  line.
- **Remedy**: Edit the file. The root `AGENTS.md` still tells memory authors
  to write no em dash and no line over 80 characters. The sweep recorded the
  export's behaviour on 2026-10-20 and it was not retested for this page.
- **State**: Known limitation, recorded as retained by the sweep.
- **Evidence**:
  [the sweep's deferred findings](../reports/2026-10-19-roadmap-sweep.md#deferred)
  and [`package.json`](../../package.json).

## A killed `dorothy --pi` leaves a launch directory behind

- **Cause**: Each launch keeps private files in
  `$XDG_RUNTIME_DIR/dorothy/pi-<id>` and removes them when Pi exits. A
  launcher killed outright cannot. Nothing sweeps stale ones, unlike Claude
  Code's launches.
- **Diagnosis**: A `pi-<id>` directory there with no running `dorothy`. It
  holds a manifest and the persona, never a key.
- **Remedy**: Delete it; the runtime directory is also cleared at logout.
  The session itself is safe: the sweep records what the hooks had not.
- **State**: Known limitation, a roadmap candidate.
- **Evidence**:
  [the report's findings](../reports/2026-11-03_pi-delivery.md#findings),
  [deferred](../deferred/2026-11-03_pi-delivery-deferred.md#the-launcher).

## A Pi session halts with an `ownership` reason and `--reread` does not clear it

- **Cause**: Pi rewrote a file so that an entry Dorothy had already
  recorded moved to another segment. The sweep stops at that entry and
  records nothing, as a reread meets the same entry again.
- **Diagnosis**: The notice names a Pi session and the reason `ownership`,
  and says `--reread` cannot clear it. A halt of another reason is
  retried by `--reread`.
- **Remedy**: `dorothy --sweep --dismiss pi <session>` stops the notice, or
  delete the file's sidecar under `$XDG_STATE_HOME/dorothy/pi/recording` so
  it is read afresh.
- **State**: Known limitation: the halt is by design, its wording fixed.
- **Evidence**:
  [the Pi source's guide](../../packages/memory/src/recording/AGENTS.pi.md#invariants).

## Pi's tool flags can drop her memory tools

- **Cause**: `dorothy --pi` forwards `--tools`, `--no-tools` and
  `--exclude-tools` after `--` to Pi, which honours them. It refuses
  `--no-mcp`, the model and session-directory options by name, but not
  these.
- **Diagnosis**: The model has no `dorothy-memory` tools, though the
  launch said it would.
- **Remedy**: Do not pass them.
- **State**: Known limitation, deferred.
- **Evidence**:
  [deferred](../deferred/2026-11-03_pi-delivery-deferred.md#the-launcher).

## A Pi probe stops with `stream cut: client gone` after a complete turn

- **Cause**: Pi returns on the SSE `[DONE]` and may cancel before the
  upstream HTTP body closes. The shared proxy settled only at EOF, so the
  cancel stored an empty reply, lost usage, reserved the maximum and
  refused every later call.
- **Diagnosis**: A call with `[DONE]`, usage and a finish is still marked
  `stream cut: client gone`; all later calls are `400`.
- **Remedy**: Settle a validated `[DONE]`; keep a true cut, a timeout,
  missing usage or a missing finish marker as unknown and stopped.
- **State**: Fixed in the shared proxy with a regression. A provider that
  sends no `[DONE]` still settles at ordinary EOF if finish and usage are
  present.
- **Evidence**:
  [the trial
  report](../reports/2026-11-03_pi-stewardship.md#the-proxy-lifecycle-bug).

## A same-pane worker replacement keeps its terminal id

- **Cause**: Herdr's `terminal_id` names the stable terminal resource,
  not the agent process. Fresh Codex can also have null `agent_session`.
- **Diagnosis**: A new session or foreground PID appears with the old
  name, pane, cwd and terminal. A terminal-only guard would send or
  interrupt it. Interactive startup can also reset `CODEX_HOME`.
- **Remedy**: Pin a validated session or Linux foreground group leader
  and boot:start in ledger schema 2, then recheck under the pane lock.
  Restore and verify worker homes after shell startup; use Codex
  `--no-daemon`. Old rows without an occupant fail closed.
- **State**: Fixed with same-terminal regressions. Native no-inference
  observation confirmed identical terminal and different process/start.
  The accepted native run then observed a real guarded worker exit and a
  new occupant in the same terminal. Same-user raw shell access is still
  not OS-confined.
- **Evidence**:
  [the trial report](../reports/2026-11-03_pi-stewardship.md).

## A slash command with an argument needs a second Enter in Pi

- **Cause**: Pi's editor takes the first Enter of `/thinking off` as the
  completion of the command's name, so the argument is not yet sent.
- **Diagnosis**: The line stays in the editor after the first Enter. This is
  Pi's behaviour, not Dorothy's.
- **Remedy**: Press Enter again.
- **State**: Known limitation of Pi 1.5.0, seen in the live run.
- **Evidence**:
  [the report's findings](../reports/2026-11-03_pi-delivery.md#findings).

## Related

- [Questions](./questions.md)
- [Decisions](./decisions.md)
- [Evaluation](./topics/evaluation.md)
- [Models and routing](./topics/models-and-routing.md)
- [Repository workflow](./topics/repository-workflow.md)
- [Harnesses](./profiles/harnesses.md)
