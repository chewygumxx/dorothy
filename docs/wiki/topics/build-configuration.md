---
ctime: 2026-11-11
mtime: 2026-11-11
spdx: GPL-3.0-only
title: Build configuration
description: >-
  How the repository's tools are configured: mise's tasks beside Bun's
  layer, where each configuration lives, and the reasons kept out of it.
tags:
  - wiki
  - workflow
  - config
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/wiki/topics/build-configuration.md
   -
   -->

# Build configuration

[Wiki home](../../README.md)

This page holds the reasoning the repository's configuration no longer
carries. By the root [`AGENTS.md`](../../../AGENTS.md#data-by-function),
a configuration keeps its directives, labels, reference URL and any
one-line why; anything longer is here, a section per tool.
[`.config/AGENTS.md`](../../../.config/AGENTS.md) lists the tools
configured in `.config/` and what mise supplies each to find it. What the
checks run is on [repository workflow](./repository-workflow.md#the-checks),
and the design is the
[build configuration spec](../../specs/2026-11-10_build-configuration.md).

## Two layers

mise is the development interface, but Bun is the only utility expected
wherever Dorothy runs. So every development action is a mise task, defined
once in `.config/mise/tasks.toml`, and every action that must run without
mise stays in Bun's layer: `package.json`'s `prepare`, `dev`, `start`,
`eval` and `skills`, and `scripts/`. `bun install`, `prepare` and
Dorothy's entry points never call mise, and no task runs a `bun run`
script that calls `mise run` back. `bun run check` is `mise run check`,
kept because the shared CI calls it.

## Where configuration lives

Configuration goes under `.config/` wherever its tool finds it there,
natively or by a flag or variable mise supplies: mise's own, Tombi's,
remark's and markdownlint's. yamllint needs no file at all. Each move to
`.config/` was probed first, as the tool sections record; Biome's and
commitlint's failed, and `.husky/` stays for the reason under
[Git hooks](#git-hooks).

The rest stay because their tools or the shared CI read them where they
are. That is the repository's reading of each tool's documentation or of
the shared CI, not a probe, and an inference where marked:

- `.biome.json` and `.commitlintrc.mts`: probed; see [Biome](#biome) and
  [commitlint](#commitlint).
- `.husky/`: see [Git hooks](#git-hooks).
- `.editorconfig`: editors and editorconfig-checker look for it from each
  file upward, and `root = true` ends the search here
  ([EditorConfig](https://editorconfig.org/)).
- `.gitignore` and `.gitattributes`: git reads them in the tree they
  govern ([gitignore](https://git-scm.com/docs/gitignore),
  [gitattributes](https://git-scm.com/docs/gitattributes)).
- `bunfig.toml`: Bun reads it from the project root
  ([bunfig](https://bun.com/docs/runtime/bunfig)), and Bun's layer cannot
  rely on mise to point it elsewhere.
- `tsconfig.json`: Bun reads it at run time, as the spec records, and
  `tsc` run without `--project` looks for it from the working directory
  upward
  ([tsconfig](https://www.typescriptlang.org/docs/handbook/tsconfig-json.html)).
- `.shellcheckrc`: the shared CI's scope looks for it at the root.
- `.sops.yaml` and `secrets.json`: Dorothy's runtime configuration, whose
  move is a roadmap candidate of its own; see [sops](#sops).
- `.moxide.toml` and `.worktreeinclude`: see [Markdown Oxide](#markdown-oxide)
  and [Worktrees](#worktrees).
- `.repo-metadata.jsonc`: the default path of the shared standard
  workflow's `metadata-path` input, in `chewygumxx/.github`'s
  `standard.yaml`.
- `skills-lock.json`: an inference, unprobed: the skills CLI writes it
  beside `package.json`, where it is, and no option to move it is known.
- `.github/`: GitHub reads workflows and Dependabot's configuration only
  there. What the workflow runs and promises is in
  [`ci.md`](../../../.github/workflows/ci.md), beside it.
- `package.json`'s `config.commitizen`: commitizen's README names
  `package.json` and a `.czrc` as where its adapter is configured, and
  does not mention `.config/`
  ([cz-cli](https://github.com/commitizen/cz-cli#readme)); unprobed.

## mise

`.config/mise/config.toml` pins the tools, settings and `[env]`; mise
reads it natively there, and it includes `.config/mise/tasks.toml` through
`[task_config]`. CI installs the same tools from it with `jdx/mise-action`.
Everything the repository runs that Bun does not install is pinned there,
so a checkout never depends on what a contributor has on `PATH`; npm
packages are pinned in `package.json` and installed by Bun, and the two
files are the whole dependency surface. Backends are named explicitly
(`aqua:`, `pypi:`, `conda:`), so the resolution is visible and cannot
change underneath a pin. `experimental = true` is there because the
`git::` remote task needs it; `act` runs `act-cached` with `--no-cache`, so
the remote task is fetched afresh on every run and follows `v1` as it
moves.

The tasks call npm CLIs through `bunx --bun --no-install`, so they run on
Bun as `bun run` ran them, never on mise's Node 24, and never fetch a
package missing from the lockfile. Each file-based task declares its
`sources` (its files, its tool's configuration, `bun.lock`,
`.config/mise/config.toml`, `scripts/with-files.sh`) and
`outputs = { auto = true }`, so it skips itself when nothing it reads
changed. `lint:types`, `lint:header`, `lint:commit` and `test` declare
none and always run. CI starts with no record, so it checks everything.

`scripts/with-files.sh`, copied from `configuring-mise-tasks`, hands each
tool its files. A full run passes the tracked files, so an untracked file
is not checked, as it was under the old scripts; a new file is checked
once it is staged, by the pre-commit hook's `--staged`, and in CI. Under
`--staged` it passes the staged files alone, and the task's `sources`
include git's index by absolute path, so staging a change runs the task
again.

On mise 2026.11.4, a `lint` whose every task skips still took about 12
seconds: for each `**/*` source set mise walked the root `node_modules`,
some fifty thousand files, despite `!node_modules/**`. mise 2026.11.6,
released on 2026-11-10, prunes the directories a trailing
`!**/node_modules/**` excludes
([jdx/mise#15499](https://github.com/jdx/mise/pull/15499), merged on
2026-11-09). Listing the top-level directories instead would be fast, but
a new directory would then go unwatched and a task could skip wrongly, so
the repository keeps the source form of `configuring-mise-tasks` and adds
no top-level inventory. The skill will move the exclusion last once it is
benchmarked on 2026.11.6.

## Bun

`bunfig.toml` sets four things:

- `[run] bun = true`: every package script runs on Bun, the CLIs whose
  shebang names `node` included. `bun run` puts a `node` that is Bun first
  on `PATH`, for nested scripts too, so a Node installed elsewhere, such as
  a CI runner's, never runs them.
- `[install] linker = "isolated"`: each package sees only what its
  `package.json` declares, so an undeclared import fails to resolve under
  Bun and `tsc` alike.
- `[env] file = false`: core loads the sops-encrypted `secrets.json`, and
  Bun must not preload a `.env` from the working directory into Dorothy's
  environment.
- `[test] preload`: `test-setup.ts` runs before any test file. It sets
  `FORCE_COLOR=0`, so the frames the tests compare are plain text whatever
  the shell says, gives the cache, state and runtime directories temporary
  roots, so no test touches the user's, and drops git's `GIT_*` variables,
  which the pre-commit hook sets and which would let a test running git in
  a scratch repository write the real one.

## Biome

`.biome.json` stays at the root. Biome treats a configuration in a
subdirectory as a second, nested root and refuses to run, whether it is
found by path or given by `BIOME_CONFIG_PATH` or `--config-path` (probed
2026-11-11).

## commitlint

`.commitlintrc.mts` stays at the root. commitlint replaces cosmiconfig's
search places with a list that omits `.config/`, and the shared CI runs
commitlint with no `--config` (probed 2026-11-11). Its types, limits and
prompt come from `@chewygumxx/commitlint-config`; only the scopes are the
repository's.

## Git hooks

Hooks stay in `.husky/`. `core.hooksPath` is shared by every worktree of a
checkout, so moving it would leave the branches not yet rebased with no
hooks; agent-library kept `.husky/` for the same reason. `pre-commit` runs
`mise run check --staged` and `commit-msg` runs `mise run lint:commit`.

`post-checkout` and `post-merge` decide when to run `bun install`, which is
Bun's layer, so they call no mise. `bun install` reinstalls the
dependencies and its `prepare` relinks the skills.

- `post-checkout` acts on a branch checkout alone (its third argument is
  `1`). A new worktree's first checkout, from the null commit, always
  installs, as its `node_modules`, hooks and links are not shared. Any
  other branch checkout installs only when it changes `package.json` or
  `bun.lock`; a file checkout does nothing.
- `post-merge` installs when a merge or pull changes `package.json` or
  `bun.lock`. It compares `ORIG_HEAD`, the head before the merge, with the
  working tree, not with `HEAD`, as a squash merge changes only the files
  and leaves `HEAD` where `ORIG_HEAD` is.

## ShellCheck

`.shellcheckrc` sets `external-sources=true`, which follows sourced files
as `shellcheck -x` does, so a script checks on its own when it alone
changes and `--staged` passes it alone. `lint:actions` lists the file in
its sources too, as actionlint runs ShellCheck on workflow steps. shfmt
reads its style from `.editorconfig`.

## Markdown

remark's configuration is `.config/remarkrc.json`, given by `--rc-path`,
and markdownlint-cli2's is `.config/markdownlint-cli2.jsonc`, given by
`--config`; both extend the house presets. The overrides in `.github/` and
`.agents/memory/` still merge over it for their own files (probed
2026-11-11): the pull request template's sections are its headings, and a
memory opens with its fact, so neither starts with a top-level heading.

## yamllint

yamllint has no file in the repository. mise's `[env]` sets
`YAMLLINT_CONFIG_FILE` to the house style in
`@chewygumxx/yamllint-config`, and the shared CI falls back to the same
style (probed 2026-11-11). The old `.yamllint.yaml` named that path
relative to the working directory, so yamllint had to run from the root;
the variable is absolute. An editor's yamllint run outside mise's
environment no longer finds the house style in the repository.

## Tombi

`.config/tombi.toml` is found natively, and the shared CI's scope lists
it. Its rules align the values within a group, the form the TOML
configuration follows.

## Worktrees

`.worktreeinclude` names the ignored files that a new worktree copies from
the main checkout, through Claude Code's own worktrees or worktrunk's
`copy-ignored --require-include`. `bun install` links the skills from
`node_modules`, but those installed with `skills add` exist only in the
main checkout, so the skills directories are copied whole, and a copy
skips whatever the install already made. Claude Code reads the file at
the project root
([Claude Code worktrees](https://code.claude.com/docs/en/worktrees));
where worktrunk reads it is unchecked, so the file stays at the root.

## Markdown Oxide

`.moxide.toml` configures Markdown Oxide, the Markdown language server.
Its [configuration page](https://oxide.md/Configuration) names
`.moxide.toml` or `~/.config/moxide/settings.toml` but not where
`.moxide.toml` must be; that it is read at the root of the folder the
server serves, so it stays there, is unprobed. The comments copied
from the tool's template were deleted, as they restated its
documentation, which the file's reference URL now gives.

## sops

`.sops.yaml` and `secrets.json` are Dorothy's runtime configuration, and
moving them is a roadmap candidate of its own. core's `saveSecret` reads
`.sops.yaml` beside the file it writes. Whom the file is encrypted to is
in [`.sops.md`](../../../.sops.md), and how the secrets are kept is on
[repository workflow](./repository-workflow.md#secrets).

## Related

- [Repository workflow](./repository-workflow.md)
- [Decisions](../decisions.md#repository-workflow)
- [Records](../records.md#repository-workflow)
- [Implementation report](../../reports/2026-11-11_build-configuration.md)
