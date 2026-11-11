---
ctime: 2026-11-10
mtime: 2026-11-11
spdx: GPL-3.0-only
title: Build configuration restructuring
description: >-
  mise tasks as the development interface beside Bun's runtime layer,
  terse configuration that keeps directives, labels and one-line whys,
  and configuration moved into .config/ wherever mise can reach it.
tags:
  - config
  - agents
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-11-10_build-configuration.md
   -
   -->

# Build configuration restructuring

## Status and intent

Drafted with the user on 2026-11-10, revised on 2026-11-11 after their
answers, relayed by `agentic-librarian`, and after agent-library's PR #5
shipped the `configuring-mise-tasks` skill, which this spec follows.
Its open questions were answered the same day by `agentic-librarian`,
as counsel under the user's delegation; the user may overrule any.
Approved by the user on 2026-11-11. The work happens in a clone,
`~/dev/dorothy-build-config`, on `build/cleanup-config`, whose git
configuration no worktree shares.

The user rewrote `mise.toml` in a far terser form and wants that form
across the build assets, with mise as the development interface. The
why, in their words and by their choices:

- Configuration files read as configuration, not essays.
- mise's task definitions, with their descriptions, aliases and
  dependencies, document what the repository can do
  (<https://mise.jdx.dev/tasks/task-configuration.html>).
- `package.json`'s scripts are hard to read.
- "`mise` is the primary interface with respect to development. It
  cannot be relied upon to be available in execution environments that
  are beyond our purview. `bun` is the only utility expected everywhere
  during all dorothy execution."
- Data by function: docs, source, tests, build and CI each in their own
  files, as little in-file documentation as may reasonably be omitted,
  "for the sake of datatype segregation and agentic context
  conservation".

## Goals

- Every development action is a mise task, defined once, in
  `.config/mise/tasks.toml`.
- Every action that must run without mise stays in Bun's layer:
  `package.json` or `scripts/`.
- Configuration keeps only directives, labels and one-line whys;
  reasoning moves to the wiki.
- Configuration lives under `.config/` wherever its tool can be made to
  find it there, natively or by a flag or variable mise supplies.
- `mise run check` and the pre-commit hook run the five linters mise pins
  but only the shared CI runs today: shellcheck, shfmt, tombi,
  editorconfig-checker and actionlint.
- File-based checks skip themselves when nothing they read changed, and
  narrow to staged files under `--staged`.

## Non-goals

- Moving `secrets.json` or `.sops.yaml`: Dorothy's runtime
  configuration, a roadmap candidate of its own (added 2026-11-10). Only
  their check changes here.
- Changing the shared workflows in `chewygumxx/.github`.
- Changing what a check accepts, beyond adding the five linters and
  fixing what they flag.
- The `documenting-configuration` skill: it folds into the skill for
  keeping data by function, deferred until this trial is reported
  ([deferred](../deferred/2026-11-11_data-by-function-deferred.md));
  `.config/AGENTS.md` holds what it would have.
- A wiki skill, and a skill for the data-by-function doctrine: the first
  is a roadmap candidate, the second waits until Dorothy has tried the
  doctrine (agent-library's `AGENTS.md`).

## Anti-goals

- mise needed to run, install or start Dorothy.
- An action defined in both layers, or a loop between them: a task
  reaching a script that runs `mise run` back.
- A mention of a removed `bun run <name>` left behind.
- `mise trust` run on a user's behalf.
- A test that runs git in a scratch repository with the hook's `GIT_*`
  variables, writing the real repository's index, branch or config. It
  happened once in agent-library.
- Reasoning lost: every narrative removed from configuration lands on the
  wiki, unless it restated the setting or its upstream documentation.

## Current state

- `mise.toml` (uncommitted, the user's rewrite) pins the toolchain and
  adds tasks `install`, `start`, `lint`, `test`, `build`, `act` and
  `act-cached`.
- `package.json` holds nineteen scripts; `check` chains ten with `&&`.
  `bunfig.toml`'s `[run] bun = true` runs every npm CLI on Bun under
  `bun run`. The user's edit removed its `skills` field, which pinned
  herdr alone; `prepare` now fails on the test that reads it.
- `.husky/` holds four hooks; `scripts/prepare.sh` runs on every
  `bun install`.
- The shared CI installs mise through `jdx/mise-action`, runs
  `bun install --frozen-lockfile`, then `bun run check`.
- Tests pin today's paths: `agents.test.ts` runs `.husky/*` and
  `scripts/prepare.sh` and reads `scripts.skills`; `header.test.ts` lists
  `.commitlintrc.mts`; `workspace.test.ts` reads `.biome.json`.

### Comment audit

Every comment below the house header in the 23 configuration files,
hooks and `scripts/prepare.sh`, by kind. Each file's house header and
shebang, and `.tombi.toml`'s schema line, are directives besides.

- Labels, 21: banners, group names and reference URLs, 13 of them in
  the user's `mise.toml`.
- One-line whys, 9: `.editorconfig`'s tab rule, `.gitignore`'s two,
  `pre-commit`'s em dash bytes, the two `MD041` overrides, and three in
  `mise.toml`, its Node label among them, which is wrong.
- Contracts, 7: `.sops.yaml`'s recipients, `.commitlintrc.mts`'s shared
  types, `ci.yaml`'s jobs, `prepare.sh`'s production no-op, the two
  directory overrides of markdownlint, and `mise.toml`'s purpose line.
- Narratives, 28: `.moxide.toml` 16 (copied from the tool's template),
  `bunfig.toml` 4, `ci.yaml` 2, `post-checkout` and `post-merge` 1
  each, `.shellcheckrc`, `.yamllint.yaml`, `.worktreeinclude` and
  `prepare.sh` 1 each.

## Approaches

1. **Chosen.** Tasks call npm CLIs through `bunx --bun --no-install`, so
   they run on Bun as `bun run` runs them today, and skip themselves
   through mise's `sources` and `outputs = { auto = true }`. CI starts
   with no record and checks everything.
2. CLIs by name with `node_modules/.bin` on mise's `PATH`: shorter, but
   they silently move from Bun to Node 24.
3. Each task computes its own changed files against `main`: finest, but
   it duplicates the shared CI's scoping.

The user chose 1; `configuring-mise-tasks` since codified it.

## Decisions

### Two layers

`package.json` keeps, as the skill allows:

- `prepare`: `sh scripts/prepare.sh`, never through mise.
- `dev`, `start` and `eval`: Dorothy's entry points, run by Bun alone.
- `skills`: `prepare` runs it, so it must work without mise.
- `check`: `mise run check`, which the shared CI calls.

Every other script goes, and its mentions become `mise run <task>`:

- `test` to `test`; `typecheck` to `lint:types`; `commit` to `commit`.
- `lint` (Biome's linter) and `format:check` (Biome's format check) to
  `lint:code`, one `biome check`.
- `lint:md`, `lint:yaml`, `lint:secrets`, `lint:emdash` and `lint:header`
  keep their names.
- `format` keeps its name; Biome's writing becomes `format:code`;
  `format:yaml` and `format:header` keep theirs.

Comments that describe `bun run test`'s behaviour, not merely name it,
are rewritten: `packages/cli/src/hosts/pi/testing.ts` and
`runtime.test.ts` explain Bun's `node` alias, which `bun run` puts on
`PATH` and `mise run test`, running `bun test`, does not. The Pi tests
must pass under `mise run test` with mise's Node 24 on `PATH`.

### Tasks

- Implementation starts by installing the skill, so its
  `scripts/with-files.sh` and `assets/tasks.toml` arrive as it ships
  them, and `skills-lock.json` declares it:

  ```sh
  bunx skills add chewygumxx/agent-library --skill configuring-mise-tasks
  ```

- `.config/mise/config.toml` holds the tools and settings and includes
  `.config/mise/tasks.toml`, which holds every task as TOML. A task's
  `run` is a line or a short list of lines; anything longer is a script
  in `scripts/`. No `#MISE` file tasks.
- The standard set from the skill's `assets/tasks.toml`: `install`,
  `lint`, `format`, `test` and `check`, aliased `i`, `l`, `f`, `t` and
  `c`, and `lint:<kind>` and `format:<kind>` beneath them. `lint`,
  `test` and `check` never write.
- Kinds: `code` (Biome), `md`, `yaml`, `shell` (shellcheck and
  `shfmt -d`; `format:shell` writes), `toml` (tombi lint and format
  check; `format:toml` writes), `editorconfig`, `actions` (actionlint),
  `secrets`, `emdash`, `header`, `types` (tsc) and `commit`
  (commitlint, given the message file; `lint` does not depend on it).
- Outside the set: `dev`, `start` and `eval`, wrapping Bun's entry
  points; `commit`; `skills`; and the user's `act` and `act-cached`, the
  one remote file task, as the skill gives it.
- `--staged` narrows each file-based task through `scripts/with-files.sh`,
  copied from the skill; parents forward it by templated `depends`.
  `lint:secrets` passes it to `scripts/check-secrets.sh`, which already
  has `--staged` and `--tracked`.
- Each file-based task declares `sources`: its files, excluding
  `node_modules`, its tool's configuration, `bun.lock`,
  `.config/mise/config.toml`, and under `--staged` git's index by
  absolute path. `lint:types` and `test` declare none and always run, by
  the user's ruling. Tools receive paths beginning `./`.
- Settings the tasks need are in the repository's mise configuration,
  never a user's: `experimental = true` if the remote task needs it.

### The user's `mise.toml`, corrected

- `jq` is restored: `scripts/statusline.sh` and `scripts/check-secrets.sh`
  call it, and `README.md` lists it.
- `build` goes: there is no build.
- `start` wraps `bun run start`, which starts Dorothy's CLI, not a
  development server; `lint` and `test` become the standard set's.
- `node`'s label gives its reason: Pi runs under Node 22.19 or later,
  which `--pi` and its tests start. The package is private.

### Hooks

- Hooks stay in `.husky/`: `core.hooksPath` is shared by every worktree
  of a checkout, so moving it leaves the branches not yet rebased with
  no hooks. `configuring-mise-tasks` asks only that hooks call
  `mise run`; agent-library kept `.husky/` for the same reason.
- `pre-commit` is `mise run check --staged`, which now runs the full
  tests on every commit. `git commit --no-verify` makes a granular commit
  that cannot yet pass.
- `commit-msg` is `mise run lint:commit "$1"`.
- `post-checkout` and `post-merge` keep their logic, which decides when
  to run `bun install`: Bun's layer, so no mise (my call).
- Tests that run git in a scratch repository drop every `GIT_*`
  variable. Tests that replace `HOME` set `MISE_TRUSTED_CONFIG_PATHS` to
  the repository root.

### Where configuration lives

- `mise.toml` to `.config/mise/config.toml`: natively.
- `.tombi.toml` to `.config/tombi.toml`: natively; the shared CI's scope
  lists it.
- `.commitlintrc.mts` to `.config/commitlintrc.ts`: cosmiconfig searches
  `.config/`, but not for `.mts`.
- `.yamllint.yaml` deleted: mise's `[env]` sets `YAMLLINT_CONFIG_FILE`,
  provided the shared CI's fallback is the same house style.
- `.markdownlint-cli2.jsonc` to `.config/markdownlint-cli2.jsonc`, by
  `--config`, if the directory overrides in `.github/` and
  `.agents/memory/` still merge over it.
- `remarkConfig` in `package.json` to `.config/remarkrc.json`, by
  `--rc-path`.
- `.biome.json` to `.config/biome.json`, by `BIOME_CONFIG_PATH`, if
  `files.includes` still resolves from the repository root.

A move marked "if" or "provided" is verified first; one that fails stays,
its reason recorded on the wiki. These stay, as their tools or other
systems read them only where they are: `.editorconfig`, `.gitignore`,
`.gitattributes`, `bunfig.toml`, `tsconfig.json` (Bun reads it at run
time), `.shellcheckrc` (the shared CI looks for it at the root),
`.sops.yaml`, `secrets.json`, `.moxide.toml`, `.worktreeinclude`,
`.repo-metadata.jsonc`, `skills-lock.json`, `.github/`, `.husky/` (see
Hooks) and `package.json`'s `config.commitizen`. The wiki records each
and why.

`.config/AGENTS.md` lists each tool whose configuration is in
`.config/`, and the flag or variable mise supplies to reach it, as the
user asked.

### Comments

By the data-by-function rules:

- Directives stay: house headers, modelines, shebangs, schema lines,
  lint suppressions.
- Labels stay: banners, group names, the tool's reference URL.
- A why tied to one line stays, in one line.
- Contracts, what a unit is for and promises: the four that fit in a
  line stay as labels (`.commitlintrc.mts`'s shared types, the two
  markdownlint overrides, `mise.toml`'s purpose line). The other three
  move to a file beside theirs, sharing its basename, each with a test
  that fails when the pair disagree:
  - `.github/workflows/ci.md`: what the workflow runs and promises. Its
    test: the job ids it names are `ci.yaml`'s `jobs`.
  - `.sops.md`: whom `secrets.json` is encrypted to and where each
    holds the private half. Its test: the age recipients it names are
    `.sops.yaml`'s and those in `secrets.json`'s `sops` metadata.
  - `scripts/prepare.md`: when it runs, its production no-op, its steps.
    Its test: the commands it names are those `prepare.sh` runs.

  The tests go in a new `pairs.test.ts` at the root (my call).
- Narratives go to a new wiki page,
  `docs/wiki/topics/build-configuration.md`, a section per tool.
  `.moxide.toml`'s 16 template blocks are deleted, not moved: they copy
  the tool's documentation, which its reference URL replaces (my call).
- No "see" pointers and no wiki links in configuration.

The form, from the user's `mise.toml` and `.editorconfig`: banners as the
title between rules one dash longer; values aligned within a group, as
tombi enforces for TOML; a JSON file that cannot carry comments takes
none.

### Guidance and wiki

- The root `AGENTS.md`'s line budget is already lifted (`c5a2bc0`), and
  its Data by function section already states the comment rules
  (`1d09556`).
- The root `AGENTS.md`'s Commands section names mise tasks.
- `repository-workflow.md` describes the checks and hooks through mise;
  `decisions.md` records the two layers, `.config/`, the comment rules and
  approach 1; `records.md` lists this spec, its plan and report.

### herdr

The `herdr` entry leaves `skills-lock.json`, as the user's edit removed
it from `package.json`. `agents.test.ts`'s "pins every remote skill
source to a commit", which read that field, goes. `bun run skills` drops
herdr's links from a checkout still holding them. `agent-stewardship`
still names the herdr skill, which herdr's own installation now supplies
(my call: the user limited the removal to the two entries).

## Constraints

- `bun install`, `prepare` and Dorothy's entry points work without mise,
  in CI and in a fresh clone or worktree.
- `bun run check` stays what the shared CI runs.
- Every new file carries the house header; `lint:header` rewrites a moved
  one's breadcrumb.
- Tests and probes never touch real user data.
- Commits are granular Conventional Commits: scope `config` for
  configuration, `ai` for agent assets, headers within 50 characters.

## Answered questions

By counsel, 2026-11-11:

1. The seven contracts: the lighter way, under Comments.
2. `documenting-configuration` is not written here; see Non-goals.
3. Hooks stay in `.husky/`; see Hooks.

## Left to the builder

- Each task's exact `sources` globs and each wiki section's wording.
- The order of the moves, each commit leaving `bun run check` passing.
- Fixing whatever the five added linters flag.

## Done looks like

- `bun run check` and `mise run check` pass, locally and in CI; a second
  `mise run check` with nothing changed skips the file-based tasks.
- `mise run check --staged` from the pre-commit hook checks staged files
  alone, then the types and tests.
- `bun install`, `bun run dev` and `bun run eval` work with mise absent
  from `PATH`.
- `package.json`'s scripts are the six above; `git grep 'bun run'` names
  only those.
- No configuration holds a narrative, or a contract longer than a
  line; `pairs.test.ts` passes for the three pairs.
- A fresh clone installs, links skills and installs hooks unaided.
