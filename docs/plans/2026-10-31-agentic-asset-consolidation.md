---
ctime: 2026-10-31
mtime: 2026-10-31
spdx: GPL-3.0-only
title: Agentic asset consolidation, implementation plan
description: >-
  Task-by-task plan for the token chooser in core, eval's new options,
  backfill review's single pass, the stewardship scripts, and the two
  skills that hold the agents' procedures.
tags:
  - dorothy
  - agents
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-31-agentic-asset-consolidation.md
   -
   -->

# Agentic asset consolidation, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `subagent-driven-development` to carry out this plan task by task, one
> subagent at a time, never in parallel. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** as [the spec](../specs/2026-10-31-agentic-asset-consolidation-design.md)
says: the agents' procedures as two skills with references and scripts,
and the first evaluation's scratch scripts as tested scripts and
commands.

**Architecture:** TypeScript changes stay inside their packages (`core`,
`eval`, `memory`, `cli`). The scripts are POSIX shell in
`.agents/skills/agent-stewardship/scripts/`, tested from
`scripts/agent-stewardship.test.ts` against stub commands. The skills
are Markdown, linked from `.claude/skills/` as `worktrees` is.

**Tech stack:** Bun, TypeScript, `bun:test`, POSIX `sh`, GNU `date`,
`flock(1)`, `systemd-run --user`, herdr's CLI, `jq`, `sops`.

**Spec:** `docs/specs/2026-10-31-agentic-asset-consolidation-design.md`.
Every task's implementer reads its Decisions table.

## Global Constraints

- Every new file carries the house header, copied from a sibling of its
  kind (`scripts/prepare.sh` for shell, `scripts/statusline.test.ts` for
  TypeScript, `.agents/skills/worktrees/SKILL.md` for a skill's Markdown).
- Imports end in `.js`; a package imports only what its `package.json`
  declares, and only other packages' declared entry points.
- Tests never touch real user data, `secrets.json`, `~/eval` or
  `$XDG_*/dorothy`, never spawn `claude`, `codex`, real `systemd-run` or
  real `herdr`: roots are `mkdtemp` directories, commands are stubs on a
  temporary `PATH`.
- No secret, and no message text, in argv to `systemd-run`, in a unit
  property, a log or an error.
- Shell is POSIX `sh`, passing `shellcheck` and `shfmt` (four spaces) as
  `bun run check` runs them; scripts are executable (`chmod +x`).
- Markdown lines at most 80 characters, inline code included; no em
  dash anywhere; relative Markdown links, never `[[...]]`.
- Commits: Conventional Commits, capitalised subject, header at most 50
  characters, body lines at most 72, no agent trailers. Scopes: `core`,
  `eval`, `memory`, `cli`; skills, their scripts and memory take the
  `ai` type. Run `bunx biome check --write <paths>` on TypeScript first.
- Test-first; `bun run check` passes before each task's last commit.
- The primary account's defaults: `claude-2` and
  `CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2`, overridden by
  `DOROTHY_CLAUDE_PRIMARY` and `DOROTHY_CLAUDE_PRIMARY_TOKEN_VAR`.
- State lives under `${XDG_STATE_HOME:-$HOME/.local/state}/dorothy-agents/`;
  locks under `$XDG_RUNTIME_DIR/dorothy-agents/`.

## Review Focus

1. A message holding quotes, newlines, `$`, backticks or a leading `-`
   reaches the pane exactly as written (Task 5).
2. A script run through the `.claude/skills/` link finds the same
   checkout as through `.agents/skills/` (Task 7).
3. Outside herdr (`HERDR_PANE_ID` unset), `compact-self.sh` and an
   unscheduled `send-prompt.sh` without `--from` fail with a usage line
   and touch nothing (Task 5).
4. A usage file that is malformed JSON, or lacks `rate_limits`, counts
   as no reading: the primary is tried, nothing crashes (Task 7).
5. `eval run --resume latest` with no runs, and `review --render` with
   no drafts, say so plainly and write nothing (Tasks 2 and 3).

---

### Task 1: the token chooser in core, and eval stopping on it

**Files:**

- Modify: `packages/core/src/secrets.ts` (add the chooser),
  `packages/cli/src/claude-hook.ts:97-116` (import it instead),
  `packages/eval/src/secrets.ts` (call it, and stop),
  `packages/eval/src/run/command.ts:163`,
  `packages/eval/src/questions/generate-command.ts:139`.
- Test: `packages/core/src/secrets.test.ts`,
  `packages/cli/src/claude-hook.test.ts` (existing cases keep passing),
  `packages/eval/src/secrets.test.ts` (create if absent),
  `packages/eval/src/run/run.test.ts` or `cli.test.ts`, wherever a run
  is driven with a fake `Io`.

**Interfaces:**

- Produces, from `@dorothy/core`:
  `export const CLAUDE_TOKEN_VAR = "DOROTHY_CLAUDE_TOKEN_VAR";` and
  `export function chooseClaudeToken(env: Env): SecretsCode | null;`,
  exactly the body now in `claude-hook.ts`: no name, `null`; a name not
  matching `/^CLAUDE_CODE_OAUTH_TOKEN[A-Z0-9_]*$/` or naming an empty or
  missing value, `"SECRETS_INVALID"`; else it sets
  `env.CLAUDE_CODE_OAUTH_TOKEN` to the named value and returns `null`.
- Produces, in eval: `loadModelSecrets(io: Io): Promise<boolean>`,
  `false` only when a token was named and the chooser failed (it writes
  `eval: DOROTHY_CLAUDE_TOKEN_VAR names no token in secrets.json; no
  model was called\n` to `io.err`); a failed load of `secrets.json`
  alone still only warns, as today, and the chooser still runs after it.
  Callers return `1` before any model call when it is `false`.

- [ ] Write core's tests: each case above, including a named token
  overriding an existing `CLAUDE_CODE_OAUTH_TOKEN`.
- [ ] Move the function and constant to core and export them; cli
  re-exports nothing, importing from `@dorothy/core`; its tests pass
  unchanged in substance.
- [ ] Write eval's failing test: `io.env` holds
  `CLAUDE_CODE_OAUTH_TOKEN=other` and `DOROTHY_CLAUDE_TOKEN_VAR` naming
  `CLAUDE_CODE_OAUTH_TOKEN_MISSING`; `run` (with a fake runner that
  fails the test if called) returns 1, writes the line above, and calls
  no model. Same for `generate`. A second case: the named token present
  in the loaded secrets is what the runner receives.
- [ ] Implement; `bun run check`; commit (`core: Share the Claude token
  chooser`, then `eval: Stop when the named token is missing`).

### Task 2: eval's `--models` and `run --resume latest`

**Files:**

- Modify: `packages/eval/src/models/config.ts:52,131-145`,
  `packages/eval/src/run/command.ts`,
  `packages/eval/src/questions/generate-command.ts`,
  `packages/eval/src/run/record.ts` (a `latestRunId`),
  README's evaluation section, `packages/eval/AGENTS.md`.
- Test: `packages/eval/src/models/config.test.ts`,
  `packages/eval/src/run/run.test.ts` (or `command`'s test file),
  `packages/eval/src/questions/generate.test.ts`.

**Interfaces:**

- `readEvalConfig(work: string, path?: string): Promise<EvalConfig>`:
  `path` absent reads `configPath(work)`; present, it is read as given
  (the command has already resolved it); error messages name the file
  read, not always `eval.toml`.
- Every command reading `eval.toml` (today `run` and `generate`) takes
  `--models <file>`, described "the models' file, in place of the work
  directory's eval.toml", resolved with `resolve(file)` against the
  current directory.
- `latestRunId(work: string): Promise<string | null>` in `record.ts`:
  reads each `runs/<id>/run.json`, returns the id with the greatest
  `at` (ties by id, greater wins), `null` when there are none; a
  directory with no readable `run.json` is skipped.
- `run --resume latest` resolves to that id before anything else; with
  none, `UsageError("no run in <work>/runs to resume")`. A resume still
  reads the models (from `--models` or `eval.toml`) and checks them
  with `checkResumable`, as now.

- [ ] Failing tests: `--models` read in place of `eval.toml` for `run`
  and `generate`, with a relative path from a changed `cwd` argument or
  `process.chdir` inside a temp dir; an error naming the given file;
  `latestRunId` over three runs written out of order; `--resume latest`
  resuming the newest; `--resume latest` with no `runs/` failing with
  the message and writing nothing (Review Focus 5).
- [ ] Implement; document both in README's evaluation section and in
  eval's `AGENTS.md`, within its 150-line budget.
- [ ] `bun run check`; commit (`eval: Read models from --models`,
  `eval: Resume the latest run`).

### Task 3: review's `--render`, `--spot-check` and `--reopen`

**Files:**

- Create: `packages/eval/src/questions/render.ts` (rendering and the
  spot-check), `packages/eval/src/questions/render.test.ts`.
- Modify: `packages/eval/src/questions/review.ts` (options, `reopen`,
  the log's decision type), `packages/eval/src/questions/review.test.ts`,
  README's evaluation section, `packages/eval/AGENTS.md`.

**Interfaces:**

- Consumes: `describeEvidence(question, corpus, chars)` from
  `review.ts`, `readQuestionsToRewrite(work)` from `file.ts`,
  `openCorpus(workEnv(work))`, the `reviews.jsonl` line schema in
  `review.ts`, `EVIDENCE_CHARS`.
- Produces:
  - `renderDrafts(work: string, dir: string, opts: { batches: number;
    source: string | null; chars: number }): Promise<number[]>`: the
    drafts (status `draft`) in file order, filtered by `source` when
    given (a value without `:` taken as `generated:<value>`), split into
    `batches` contiguous parts whose sizes differ by at most one, the
    larger first (10 in 3: 4, 3, 3); writes `<dir>/drafts-<k>.md`, `k`
    from 1, mode 0600, `dir` made with mode 0700; returns the sizes.
    No drafts: returns `[]` and writes nothing. Each draft's block is
    the first evaluation's: `## Draft <i> of <n>: id <id>`, its type,
    `asOf`, project, `Q:`, `A:`, an `Older claim (note):` line when it
    has a note, and `Evidence:` from `describeEvidence`.
  - `spotCheck(work: string, file: string, opts: { per: number; random:
    () => number }): Promise<{ unsure: number; sampled: number }>`: the
    drafts first (each `Unsure <i>`), then for each reviewer in
    `reviews.jsonl` up to `per` questions it accepted or edited, the
    edit resolved by `newId`, kept only if that question is now
    `accepted`, each id once (the first reviewer to name it keeps it);
    each block says who decided it and how; mode 0600.
  - `review --render <dir> [--batches N] [--source <model>]` (N 1 to
    100, default 1; uses `--evidence`); `review --spot-check <file>
    [--per N]` (N 1 to 1000, default 15); `review --reopen <id>
    --reason <text>`. Each excludes `--apply`, `--reviewer`,
    `--dry-run` and the others, with a `UsageError` naming the clash.
  - `reopen`: the question must be `accepted` (else a `UsageError`
    saying its status); it becomes `draft`, written as review writes
    the file; `reviews.jsonl` gains `{ id, decision: "reopen", reviewer:
    "owner", reason, at }`. The log's decision type gains `"reopen"`.

- [ ] Failing tests in `render.test.ts` over a temp work directory made
  as review's tests make one: 10 drafts in 3 batches (4, 3, 3), file
  modes, `--source` with and without the prefix, no drafts (nothing
  written; Review Focus 5); spot-check with an accept, an edit whose
  `newId` is accepted, an edit whose question was since rejected
  (left out), an id named twice (once), `random` fixed so the sample is
  known.
- [ ] Failing tests in `review.test.ts`: `--reopen` of an accepted
  question, its log line, and of a draft (refused); option clashes.
- [ ] Implement; document in README and eval's `AGENTS.md`.
- [ ] `bun run check`; commit (`eval: Render drafts and spot-checks`,
  `eval: Reopen an accepted question`).

### Task 4: `dorothy --review-backfill -n all`

**Files:**

- Modify: `packages/memory/src/memory/review-backfill.ts`
  (`ReviewBackfillOptions`, candidate selection),
  `packages/cli/src/args.ts:443-460` (parse `all`),
  `packages/cli/src/review-backfill.ts` (the pass),
  `packages/cli/src/index.ts:269-272`, README's `--review-backfill`
  lines, `packages/cli/AGENTS.md` and `packages/memory/AGENTS.md` if
  they describe the batch.
- Test: `packages/memory/src/memory/review-backfill.test.ts`,
  `packages/cli/src/args.test.ts`,
  `packages/cli/src/review-backfill.test.ts`.

**Interfaces:**

- memory: `ReviewBackfillOptions` gains `skip?: ReadonlySet<string>`:
  phrases left out of the candidates before the `count` cap. Nothing
  else in memory changes.
- cli: the mode becomes `{ kind: "review-backfill"; count: number |
  "all" }`; `-n all` and `--count all` parse to `"all"`; usage gains
  `all`. `runBackfillReview(count, deps)` with `"all"`: a `seen` set;
  repeat `run({ count: 25, skip: seen, ... })`, adding every phrase
  `progress` reports to `seen`, until a batch reports no phrase or
  stops; totals summed and printed once as now. A stopped batch prints
  the existing stop line and returns **75**. A pass whose totals are
  all `held` (and at least one) prints `review-backfill: every marked
  conversation is held by another process\n` and returns 0. A numeric
  count behaves exactly as today.

- [ ] Failing memory test: `skip` leaves those phrases out, and the cap
  then fills from the rest.
- [ ] Failing cli tests: `-n all` parsed; a fake `run` whose first
  batch holds 25 held phrases and whose later batches offer two
  reviewable ones reaches them (held ahead of reviewable); a pass of
  held only returns 0 with the line; a stopped second batch returns 75
  with the first batch's totals kept.
- [ ] Implement; `bun run check`; commit (`memory: Let a review skip
  conversations`, `cli: Review every backfill in one pass`).

### Task 5: `send-prompt.sh` and `compact-self.sh`

**Files:**

- Create: `.agents/skills/agent-stewardship/scripts/pane-lock.sh`
  (sourced helpers), `.../scripts/send-prompt.sh`,
  `.../scripts/compact-self.sh`, `scripts/agent-stewardship.test.ts`.
- Modify: `.gitignore` (except `/.agents/skills/agent-stewardship/`
  and `/.claude/skills/agent-stewardship`, beside `worktrees`'), and
  create the link `.claude/skills/agent-stewardship ->
  ../../.agents/skills/agent-stewardship`.

**Interfaces:**

- `pane-lock.sh`, sourced with `. "$here/pane-lock.sh"`:
  `state_dir` (prints `${XDG_STATE_HOME:-$HOME/.local/state}/dorothy-agents`,
  creating it 0700), `lock_pane <pane>` (opens fd 9 on
  `$XDG_RUNTIME_DIR/dorothy-agents/<pane with non-alphanumerics as
  _>.lock` and `flock 9`; dies without `XDG_RUNTIME_DIR`),
  `agent_pane <agent>` and `agent_status <agent>` (from `herdr agent get
  <agent>`'s JSON, `.result.agent.pane_id` and
  `.result.agent.agent_status`, as `~/.local/bin/herdr-send` reads
  them).
- `send-prompt.sh [--from <name>] [--at <time> | --in <span>] <agent>`,
  the message on stdin, empty refused:
  - The sender: `--from`, else the agent on `$HERDR_PANE_ID` (check
    `herdr pane get` or `herdr agent list` read-only on the live machine
    for the field; record what was used in the report), else a usage
    error (Review Focus 3).
  - Now: label `[from <name>]` and a space, lock the agent's pane, then resolve
    its pane and status (after the lock), refuse `blocked` (exit 3) or absent
    (exit 4), `herdr pane send-text <pane> -- <text>` (confirm herdr takes `--`;
    if not, a text starting with `-` gets a leading space), then `herdr pane
    send-keys <pane> enter`. Exit 0.
  - Timed: label `[from <name>, scheduled]` and a space; `--at` must contain a
    date (`YYYY-MM-DD` or `@<epoch>`), resolved with `date -d` to `%Y-%m-%d
    %H:%M:%S %Z`, refused if not after now; `--in` is passed as
    `--on-active=<span>`. The labelled message goes to `sends/<id>.msg` (0600),
    `<id>` the agent and `date +%s%N`; the unit is `systemd-run --user --collect
    --unit=dorothy-send-<id> --timer-property=AccuracySec=1s --setenv=PATH
    --setenv=HERDR_SOCKET_PATH --setenv=XDG_RUNTIME_DIR --setenv=XDG_STATE_HOME
    (when set) --on-calendar=<resolved> | --on-active=<span> -- <this script's
    absolute path> --deliver <id>`. Prints the unit and the resolved time.
  - `--deliver <id>`: reads `sends/<id>.msg` and `sends/<id>.tries`;
    locks; blocked or absent before writing: tries below 12 re-arms
    with `--on-active=5min`, appending `<iso> refused <status>, re-armed`
    to `sends/<id>.log`; at 12, `<iso> gave up`. Text sent but Enter
    failed: `<iso> partial: text written, enter failed`, no re-arm.
    Delivered: `<iso> delivered`, the `.msg` removed.
- `compact-self.sh <instructions file>`: needs `$HERDR_PANE_ID` (else
  usage, Review Focus 3); waits with `herdr agent wait <target> --until
  idle` (find the target form for a pane read-only; an `--agent <name>`
  option where a name is needed), sleeps `${DOROTHY_COMPACT_PAUSE:-3}`,
  locks the pane, rechecks it is idle (else exit 5), `send-text`
  `/compact` and one trailing space, pause, `send-text` the file's
  contents, pause, `send-keys enter`.

- [ ] Write the test file's scaffolding as `statusline.test.ts` does:
  a temp root, `bin/` stubs for `herdr`, `systemd-run`, `date` only if
  needed, each stub appending its argv (one per line, NUL-safe enough
  for tests) to `calls.log` and answering `agent get` with JSON whose
  status a file controls.
- [ ] Failing tests, `send-prompt.sh`: label and text then Enter as two
  calls; a message with quotes, newlines, `$HOME`, a backtick and a
  leading `-` arrives verbatim (Review Focus 1); blocked refused, no
  send; the status read after the lock (a test holds the lock with
  `flock` in a child, flips the status to blocked, releases, and sees
  the refusal); `--at 02:31` refused as dateless; a past date refused;
  `--at '2099-01-01 00:00'` passes `--on-calendar=2099-01-01 00:00:00`
  plus a zone; `--in 2min` passes `--on-active=2min`; no argv to
  `systemd-run` contains the message; `--deliver` delivering, re-arming
  on refusal with the tries counted, giving up at 12, and recording a
  partial without re-arming; outside herdr without `--from`, usage.
- [ ] Failing tests, `compact-self.sh`: with `DOROTHY_COMPACT_PAUSE=0`,
  the calls in order (`wait`, `get`, `send-text` of `/compact` and a
  space, `send-text` of the file, `send-keys enter`), all to
  `$HERDR_PANE_ID`; a
  concurrent `send-prompt.sh` started while it holds the lock writes
  after its Enter; unset `HERDR_PANE_ID`, usage and no calls.
- [ ] Implement; `chmod +x`; `bun run check`; commit (`ai: Send
  prompts and compact through herdr`).

### Task 6: `job.sh` and its stop helper

**Files:**

- Create: `.agents/skills/agent-stewardship/scripts/job.sh`,
  `.../scripts/job-stopped.sh`.
- Modify: `scripts/agent-stewardship.test.ts`.

**Interfaces:**

- Consumes: `pane-lock.sh`'s `state_dir`; `send-prompt.sh --from <name>
  --in 1s <agent>`, so a notification takes the retrying path.
- `job.sh <name> [--notify <agent>] [--env NAME]... -- <command>
  [args]`: `<name>` letters, digits, `.`, `_`, `-`; the unit
  `dorothy-job-<name>-<date +%s%N>`; the log
  `jobs/<unit>.log`; runs `systemd-run --user --collect
  --unit=<unit> --working-directory=<$PWD> --expand-environment=no
  -p StandardOutput=append:<log> -p StandardError=append:<log>
  -p "ExecStopPost=<abs>/job-stopped.sh <unit> <agent or ->"
  --setenv=NAME`... for each allowlisted name that is set: `PATH`,
  `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`,
  `XDG_CACHE_HOME`, `XDG_RUNTIME_DIR`, `HERDR_SOCKET_PATH`,
  `SOPS_AGE_KEY_FILE`, `CLAUDE_CONFIG_DIR`, every `DOROTHY_CLAUDE_*`,
  and each `--env` name; `-- <command> [args]` literally. Prints the
  unit and the log path. Refuses a checkout path with spaces, as
  `ExecStopPost` would split it.
- `job-stopped.sh <unit> <agent|->`: writes `jobs/<unit>.result` first:
  `result=$SERVICE_RESULT`, `exit_code=$EXIT_CODE`,
  `exit_status=$EXIT_STATUS`, `at=<iso>`, one per line; then, unless
  `-`, sends `job <unit> stopped: <result> (<exit_code>
  <exit_status>); log <path>` with `--from job:<name>`; a failed send
  appends to `jobs/<unit>.notify.log` and exits 0, the result untouched.

- [ ] Failing tests: the `systemd-run` argv for a command with an
  argument holding spaces and one holding `$HOME` (both passed
  literally, after `--`); `--working-directory` is the caller's `cwd`;
  only set allowlisted names and `--env` names appear as `--setenv`;
  `--setenv` never carries `=value`; the stop helper's result for an
  exit (`exited 1`), a signal (`killed 9`) and a failed start
  (`SERVICE_RESULT=resources`, no exit vars), each kept when the stub
  `send-prompt.sh` fails.
- [ ] Implement; `bun run check`; commit (`ai: Run long jobs as user
  units`).

### Task 7: `with-claude.sh` and `at-limit.sh`

**Files:**

- Create: `.agents/skills/agent-stewardship/scripts/with-claude.sh`,
  `.../scripts/at-limit.sh`.
- Modify: `scripts/agent-stewardship.test.ts`.

**Interfaces:**

- `with-claude.sh <command> [args]`: the checkout is four directories
  above the script's own, resolved with `cd -P` so the `.claude/skills`
  link finds the same one (Review Focus 2); the primary
  `${DOROTHY_CLAUDE_PRIMARY:-claude-2}` and its token name
  `${DOROTHY_CLAUDE_PRIMARY_TOKEN_VAR:-CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2}`;
  the primary is chosen when `sops decrypt --extract '["<name>"]'
  <checkout>/secrets.json >/dev/null 2>&1` succeeds, unless
  `$XDG_RUNTIME_DIR/claude-usage-<primary>.json` parses, is under 600
  seconds old by its `at`, and shows `five_hour` at 90 or more or
  `seven_day` at 80 or more; a file that does not parse or lacks
  `rate_limits` is no reading (Review Focus 4). It exports
  `DOROTHY_CLAUDE_TOKEN_VAR` as the primary's name or as
  `CLAUDE_CODE_OAUTH_TOKEN` for the reserve, writes `<HH:MM> claude
  account: <primary|reserve>` to stderr, and `exec "$@"`.
- `at-limit.sh [--wait S] [--tries N] [--retry CMD] -- <command>
  [args]`: defaults 1200 and 40; runs the command; while it exits 75
  and tries remain, writes `<HH:MM> limited; retrying in <S>s (<k> of
  <N>)` to stderr, sleeps, and runs `sh -c "$CMD"` if `--retry` was
  given, else the command again; exits with the last exit code.

- [ ] Failing tests, `with-claude.sh` (stub `sops` exiting 0 or 1; the
  command `sh -c 'printf %s "$DOROTHY_CLAUDE_TOKEN_VAR"'`): fresh low
  reading, primary; fresh at 90% five-hour, reserve; fresh at 80% week,
  reserve; stale high reading, primary; missing file, primary;
  malformed file, primary; no primary token, reserve; the overrides;
  run through a symlinked copy of the skill directory, the same
  checkout (the stub `sops` records the path it was given).
- [ ] Failing tests, `at-limit.sh` (`--wait 0`): 75 then 0 runs twice
  and exits 0; 75 always stops after N tries with 75; 1 stops at once;
  `--retry` runs from the second try.
- [ ] Implement; `bun run check`; commit (`ai: Choose Claude's account
  and retry at limits`).

### Task 8: the skills, memory and links

**Files:**

- Create: `.agents/skills/agent-stewardship/SKILL.md`,
  `.../references/claude-code.md`, `codex.md`, `herdr.md`,
  `budgets.md`, `recovery.md`;
  `.agents/skills/agent-pre-screening/SKILL.md`,
  `.../references/brief.md`; the link
  `.claude/skills/agent-pre-screening ->
  ../../.agents/skills/agent-pre-screening`.
- Modify: `.gitignore` (except the second skill and its link),
  `agents.test.ts:73` (`OWN` gains both), `.agents/memory/usage-limits.md`,
  `codex-full-send.md`, `self-compaction.md`, `.agents/memory/MEMORY.md`.

**Interfaces:**

- Consumes: every script of Tasks 5 to 7 and the commands of Tasks 2 to
  4, by their exact names and options.
- Sources for the prose: the spec's Skills section (the outline of each
  file), the three memories (their procedures move, their preferences
  stay), `docs/reports/2026-10-30-eval-review-tools.md`,
  `docs/reports/2026-10-31-first-evaluation.md`, and
  `~/eval/agent-review/` for the pre-screening brief (copy its rules,
  never a quoted session: this repository is public).

- [ ] `SKILL.md` frontmatter as `worktrees`': `name`, a `description`
  opening "Use when" that names the triggers (dispatching to Codex or a
  subagent, a job that may outlast a usage window, context past 85%,
  arming a wake-up, routing by budget; for pre-screening: drafting or
  reviewing an evaluation's test set), `ctime`, `mtime`, `spdx`, `tags`.
  The body: the rules, then an index of references with when to read
  each. Each reference opens with the house header.
- [ ] `budgets.md` carries the example the spec asks for, given after
  this list.
- [ ] Memories: each keeps its frontmatter, the preference, its **Why**,
  and a **How to apply** that links the skill
  (`../skills/agent-stewardship/SKILL.md`); procedure text goes. Hooks
  in `MEMORY.md` updated to match. `trust-to-proceed.md` is untouched.
- [ ] `agents.test.ts`: `OWN = ["agent-pre-screening",
  "agent-stewardship", "worktrees"]`; its tests then require both
  tracked and linked.
- [ ] `bun run check` (`lint:md`, `lint:emdash`, `lint:header` and the
  agents tests included); commit (`ai: Add the stewardship skills`,
  `ai: Point memories at their skills`).

The example for `budgets.md`:

```sh
S=.agents/skills/agent-stewardship/scripts
W=~/eval M=~/eval/eval.baseline.toml
E="bun run eval -- run --work $W --models $M"
"$S/job.sh" rerun --notify dorothy-main -- "$S/at-limit.sh" \
    --retry "$S/with-claude.sh $E --resume latest" \
    -- "$S/with-claude.sh" sh -c "$E"
```

## After the tasks

The controller, not a subagent, runs the spec's Verification on the live
machine, removes the scratch scripts from `~/eval-bakeoff/tools`, writes
`docs/reports/2026-10-31-agentic-asset-consolidation.md`, and revises
the roadmap as its Revising section says.
