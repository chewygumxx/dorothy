---
ctime: 2026-10-07
mtime: 2026-10-07
spdx: GPL-3.0-only
title: Compaction implementation report
description: "How compaction was built: deviations from the spec, what review changed, every commit and what is left"
tags:
  - dorothy
  - memory
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-07-compaction-implementation.md
   -
   -->

# Compaction implementation report

## Summary

Compaction keeps a long chat within Dorothy's context. Past `[compaction]
soft` tokens, at the next idle, she splits the turns leaving the verbatim
tail into topical clusters and writes an abstract of each. A new session
takes over, seeded with the abstracts and the turns after them, and
`recollect` opens any cluster word for word. Past `hard`, the next message
waits for it. The CLI's own compaction is switched off.

- Spec: [`docs/specs/2026-10-07-compaction-design.md`](../specs/2026-10-07-compaction-design.md)
- Plan: [`docs/plans/2026-10-07-compaction.md`](../plans/2026-10-07-compaction.md)
- Probes: [`docs/reports/2026-10-07-compaction.md`](2026-10-07-compaction.md)
- Deferred test gaps: [`docs/deferred/2026-10-07_compaction-test-gaps.md`](../deferred/2026-10-07_compaction-test-gaps.md)
- Branch: `feat/compaction`, from `main` at `19a861e`

At the head of the branch `bun run check` passes with 787 tests across 46
files, up from 597 on `main`. Two live probes confirmed that the CLI honours
`DISABLE_COMPACT` and that a chat compacts, recollects and resumes (see
[Verification](#verification)).

The spec is the binding authority. Where implementation or review changed
what it says, the spec was amended to match the code in the same branch, so
it describes what is merged. The changes are listed under
[Deviations from the spec](#deviations-from-the-spec), measured against the
spec as approved (`6c57f49`).

## How it was built

The plan's 15 tasks were built in order, each committed on its own, with a
review of each task's diff. Whole-branch reviews followed the last task,
then follow-up reviews of each round of fixes. Most of the branch's
commits come from those rounds: the session wrapper's concurrency (a
message held during a save, a chain of calls, Esc, quitting, reconnecting)
had far more edge cases than the plan's code covered.

Two refactors came out of review. `src/compaction/session.ts` had grown
past 900 lines, so the run-wide state moved to `shared.ts` and one run's
pipeline to `run.ts`, and the session's flags became a single `Phase`
(`8c3cbc1`). Reviews were rebuilt on the new `structuredCall()` rather than
duplicating it (`fdba3dd`).

Gaps in test coverage that reviewers judged safe to leave are in the
deferred doc; entries later tests covered were removed from it.

Before this report, a final review read the non-test source against the
spec: `src/compaction/`, `run.tsx`, the memory service, `recollect`, the
sidecar, `Conversation` and `structured.ts`. It found no defect in the
code. It found one place where the spec still disagreed with it, the
measure of the context, and amended the spec (`35d3fe2`).

## Deviations from the spec

### Settled in the plan

These were decided while writing the plan. They are listed in its Rulings
section and were carried out as written.

| Spec said                                                        | Implementation                                                                                                                          | Why                                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The context is the latest request's input plus its output tokens | Input of the last main-thread assistant message, plus the reply's estimated tokens; the result's usage only when no message carried any | The result sums every request of a turn, so a turn with lookups overstated it. The reply's text is what the next request reads back.  |
| `recollect` is offered through `allowedTools`                    | The server registers `recollect` only when launched with `--recollect`, which `conversationOptions` adds with the allowed tool          | `allowedTools` grants permission but does not hide a tool from the model.                                                             |
| Reading a sidecar's clusters warns at the first invalid one      | They are dropped silently from the first invalid one on                                                                                 | Sidecar readers have no warning channel, and every other malformed field reads as absent. The next compaction covers the turns again. |
| `StructuredCall` returns `{ output, costUsd, model }`            | A request with `what` and `timeoutMs`, and an outcome union in which a failure still carries its cost                                   | A failed call costs money too; reviews and compaction share one adapter.                                                              |
| Without a transcript (silent)                                    | The clusters are kept for that launch only                                                                                              | There is no conversation for a sidecar to describe.                                                                                   |

### Made during the implementation

The spec was amended for each of these.

| Spec said                                                | Implementation                                                                                                                                                   | Why                                                                                                                                                               | Cost if wrong                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `compacting(session)` wraps the session                  | `Compaction.session(turns, connect)`, one `Compaction` per launch                                                                                                | Clusters, failures and saves under way outlive each session, so reconnecting starts from them too.                                                                | None.                                                           |
| A `compact_boundary` becomes an error event (`a2a3a3e`)  | It becomes a warning, and the turn carries on                                                                                                                    | An error ends the turn on screen and reconnects, while the CLI's turn goes on: the reply was lost.                                                                | A broken switch shows only as a warning line.                   |
| Esc on a held message (silent)                           | It is still sent when compaction ends, and interrupted as soon as its reply starts (`302f8af`)                                                                   | It then ends as any interrupted turn does, in `App`'s history and the model's context alike.                                                                      | One short, interrupted reply is paid for.                       |
| One call per compaction (silent)                         | A call takes at most `soft - tail` tokens of turns; while a message is held, or before the first session, calls chain until the seed falls to `hard` (`23cbc03`) | A long chat recorded before compaction existed would otherwise go in one call nearly as large as the window.                                                      | A chain of calls before the first reply of a long resumed chat. |
| Another TUI holds the claim: skipped until the next idle | Past `hard`, or before the first session, it asks again every 2 seconds; one claim spans a chain, renewed at each call (`225f3e4`, `fb6a312`, `fd6b86f`)         | A held message would otherwise go on to a session past `hard`. One claim per chain lets a review waiting for it run after the whole chain, not between its calls. | A launch waits up to a review's length behind another TUI.      |
| (silent)                                                 | A live review refused the claim asks again every 2 seconds until granted or a message is sent (`5266aad`)                                                        | At a shared idle compaction takes the claim first, and the review was otherwise skipped.                                                                          | None.                                                           |
| Another TUI compacted first: a failure                   | Its clusters are taken up when they cover the run's first turn and stop before the latest message (`74920af`, `ecebf09`)                                         | The turns are compacted either way; counting it a failure would back off, and in the end give up, for nothing.                                                    | None: nothing is written.                                       |
| The index opens for memory or recall                     | Also for compaction alone, for its claim and the sidecar's lock (`fda3961`)                                                                                      | With memory and recall off, compaction would otherwise run unlocked.                                                                                              | None.                                                           |
| Quitting aborts the call (silent on a save)              | A save under way and its record are waited for up to 2 seconds, then left to go on (`9369fa7`, `5e9f4ec`)                                                        | What a save writes to must not close under it; a save that never settles must not hang the quit.                                                                  | A quit can take 2 seconds longer.                               |
| An unparseable sidecar skips compaction                  | Compaction is off until the next launch, and at launch off for that chat (`b77baf1`, `f65a956`)                                                                  | Retrying paid for clusters that could never be saved.                                                                                                             | None.                                                           |
| (silent)                                                 | `compactionCostUsd` in the sidecar beside `reviewCostUsd` (`3a6839d`)                                                                                            | What compaction costs is kept with the conversation, as what reviews cost is.                                                                                     | None.                                                           |
| (silent)                                                 | A seed that can't be estimated is taken as under `hard`, with a warning (`9cfe7df`)                                                                              | A sizing error kept the session from starting at all.                                                                                                             | A seed past `hard` may start once.                              |

## Commits

103 commits, oldest first, grouped by purpose. The scopes follow
`.commitlintrc.mts`: `sdk` for `src/` outside `src/tui/` and
`src/compaction/`, `tui` for `src/tui/`, none for `src/compaction/` and
docs.

### Design

- `4eacfa3` docs: Specify compaction
- `6c57f49` docs: Keep compaction off the SDK and the CLI
- `3d738a4` docs: Plan compaction

### Tasks 1 to 15

- `b603ad0` Task 1: `DISABLE_COMPACT=1` in `cliOptions()`, and
  `contextTokens` on `turn-end`.
- `37f3643` Task 2: `[compaction]`, with ranges and `tail < soft < hard`,
  one table parser shared with `[memory]`, and the budget raised to 4000.
- `7d7dfb1` Task 3: sidecar `clusters` and `appendClusters`; the
  `compaction` transcript event.
- `c4044d3` Task 4: `RECOLLECT_TOOL` and the `recollect` lookup.
- `619635d` Task 5: the index's `clusters` table, schema version 2.
- `11fe7c9` Task 6: `recollect`, served with `--recollect`.
- `406392d` Task 7: `withClusters`, and the seed in `conversationOptions`.
- `ec5506d` Task 8: abstracts charged to the memory budget first; reviews
  over the abstracts and the tail.
- `fdba3dd` Task 9: `structuredCall()`, with `runReview` rebuilt on it.
- `bf7ac8e` Task 10: `outgoing`, the context pressure and the seed's turns.
- `7fde1a0` Task 11: the cluster prompt, schema and validation.
- `cb31b95`, `4391f32` Task 12: the compacting session, and its first fix.
- `d2d39ae` Task 13: compaction in the chat (`run.tsx`).
- `780e38f` Task 14: `--dump-context --resume` shows the compacted seed.
- `031a5bf`, `fbea23b` Task 15: README, `.claude/CLAUDE.md` and the probes.

### Review fixes: recall, the sidecar and the measure

- `9416d94` fix(sdk): Read back every recollect lookup
- `affa0fb` fix(sdk): Refuse fractional clusters
- `d348944` fix(sdk): Measure the context from the main thread
- `a2a3a3e` fix(sdk): Keep the reply when the CLI compacts
- `c340980` fix(sdk): Freeze the empty sidecar
- `4cf19bc` fix: Promise recollect only when it is offered
- `3a6839d` fix(sdk): Keep compaction costs in the sidecar

### Review fixes: the session wrapper

- `c5844c6` refactor: Hide compaction's run state
- `3eb7a52` fix: Count or contain every compaction throw
- `29013b5` fix: Re-time the idle wait after a failure
- `225f3e4` fix: Retry the claim for a message held mid-run
- `f391ea7` fix: Await sessions a handover replaced
- `5b1b61b` fix: Arm compaction before a review hears a turn
- `d12121f` fix(tui): Tell memory of a held message at once
- `b9dca45` fix: Seed a reconnect after the save under way
- `b77baf1` fix: Check the notes before asking Dorothy
- `f65a956` fix(tui): Refuse compaction on unreadable notes
- `eeaa9cf` refactor: Describe compaction's shared state
- `12d60c1` fix(tui): Clear compaction warnings on success
- `9418db3` fix: Fail as a session when connecting throws
- `651b6cb` fix: Count no failure after a handover
- `2e0f125` fix(tui): Give each compaction run its own claim
- `8d7f9d9` fix: Warn an unrecorded compaction despite a throw
- `0bcd4a8` fix: Catch a listener's throw as a session dies
- `f9d3e00` fix(tui): Keep warnings that compaction is off

### Spec extensions from review

- `23cbc03` feat: Cap the turns one compaction call sends
- `302f8af` feat: Interrupt a held message once it is sent
- `74920af` feat: Take up clusters another TUI saved first
- `fda3961` feat(tui): Open the index for compaction alone
- `5266aad` feat(sdk): Wait for the claim before a review
- `fd6b86f` feat(sdk): Let a claim's owner renew it

### Review fixes: chains, Esc, claims and quitting

- `ecebf09` fix: Take up clusters that cover part of a run
- `26d4bc8` fix: Word and wire the compaction edge cases
- `a9ec4b4` fix: Keep a compaction run's throws and warnings
- `cd30eaa` fix(tui): Word the index warning, close every step
- `31e818c` fix: End a compaction chain when Esc is pressed
- `1925559` fix: Record a compaction before reconnecting
- `71cafd7` fix: Send each held message on its own
- `fb6a312` fix: Hold one claim across a compaction chain
- `9cfe7df` fix: Start a session whose seed can't be sized
- `da13aa8` fix: Keep the first throw when a landing warns
- `0dfacfc` fix: Let Esc during a save end no later chain
- `03fac5c` fix: Send each message held for a save alone
- `5e9f4ec` fix: Let quitting end the waits on a save
- `9369fa7` fix: Let a quit wait briefly for a save
- `488c096` fix: Connect no session after a quit's run
- `7f63422` fix: Reset the stream flags when a send throws

### Refactors

- `1d8e77f` refactor(sdk): Tidy config tables and recall
- `3ddd140` refactor(sdk): Give the injected timers a module
- `dca101d` refactor: Tidy compaction checks and closings
- `910ea5c` refactor(tui): Say why compaction idles first
- `d1d22c2` refactor: Move run-wide compaction state out
- `f248213` refactor: Extract one compaction run's pipeline
- `8c3cbc1` refactor: Hold a compacting session's phase

### Tests

- `3c2fdcf` test(tui): Capture a failed resume's stderr
- `eb87168` test(tui): Keep the resume test off real config
- `c075f88` test: Pin a real gap before a compaction run
- `d361808` test(sdk): Name each refused cluster number
- `87491fa` test: Say the boundary scan is textual
- `0e303cc` test(tui): Pin the index opened for compaction
- `87c3cdc` test: Pin Esc at a chain's second call
- `71a1dbc` test: Pin Esc held for a save past hard
- `82aa057` test: Pin late Esc on a chain with a session
- `07419db` test(sdk): Pin the quit grace to the close grace
- `43c5f4e` test: Pin the quit guard in a compaction run

### Documentation

- `39eccf5`, `f16eb6d`, `680266d`, `1df0762`: the deferred test gaps, added
  to and pruned as tests covered them.
- `7a60882` docs: Note token budgets and a gateway
- `80895fb`, `4787878`, `4a32881`, `963beab`, `32b2066`, `8a060ae`,
  `75afe6f`, `3b30c4d`, `35d3fe2`: the spec amended to match the code.
- `a15b512`, `7508665`, `42f89cb`: `.claude/CLAUDE.md` and the TUI's
  wording.
- This report.

## Verification

- `bun run check` (typecheck, Biome, remark, Prettier, yamllint, dotenvx,
  the em dash lint and `bun test`) passes, with 787 tests across 46 files.
- Boundary tests keep the Agent SDK out of `src/compaction/`, `src/tui/`
  and `src/recall/`, and `src/compaction/` out of `src/tui/` but for
  `run.tsx`.
- **The CLI's switch**, against the live API with a shrunken compaction
  window: without `DISABLE_COMPACT` the CLI compacted on every turn from
  the third; with it, never.
- **A compacting chat** in tmux, with tiny thresholds and temporary XDG
  directories: four compactions of one exchange each, `recollect` quoting
  the first reply exactly, the sidecar's four clusters and the
  transcript's four `compaction` events, each before the next session.
  `--dump-context --resume` then showed the four abstracts and only the
  latest exchange, with `recollect` offered.

Both probes are described in full in the
[probe report](2026-10-07-compaction.md).

## Known limitations

None blocks merge.

- **A split into several clusters was never exercised live.** At the
  probe's thresholds each compaction covered one exchange; the unit tests
  cover the split.
- **The seed's estimate is not the measure.** The trigger compares the
  API's measured context, which includes the CLI's own system text, with
  `soft` and `hard`; the seed is estimated from the persona prompt alone at
  four code points to a token. A seed just under `hard` by estimate can
  measure over it after the handover, and compacts again at the next idle.
- **A launch can wait behind another TUI.** Past `hard`, or before the
  first session, compaction asks for a claim another TUI holds every 2
  seconds, for as long as that TUI's review or chain runs, up to 150
  seconds per call.
- **The CLI's failed compactions are not watched.** With `DISABLE_COMPACT`
  set none start, but a failed one would report only a `status` message,
  and Dorothy watches for `compact_boundary` alone.
- **Abstracts are written once.** Regrouping or rewriting old clusters, and
  editing abstracts through `--memory`, are out of scope.
- **Test gaps.** Behaviours that hold but have no test of their own are
  listed in the
  [deferred doc](../deferred/2026-10-07_compaction-test-gaps.md), led by an
  end-to-end test of turn numbering across App, the transcript, the sidecar,
  the index and `recollect`.
- **Not fixed here.** The CLI still adds its `# Environment` message to
  every request; a gateway between the SDK and the API is the likely remedy
  (see [`docs/notes/2026-10-07_budgets-gateway.md`](../notes/2026-10-07_budgets-gateway.md)).
