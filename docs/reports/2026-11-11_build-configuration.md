---
ctime: 2026-11-11
mtime: 2026-11-11
spdx: GPL-3.0-only
title: Build configuration restructuring implementation
description: >-
  Probes, rulings, the comment audit and verification of the mise tasks,
  Bun's two layers, configuration moved into .config/ and terse comments.
tags:
  - config
  - verification
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-11-11_build-configuration.md
   -
   -->

# Build configuration restructuring implementation

The [design](../specs/2026-11-10_build-configuration.md) and
[plan](../plans/2026-11-11_build-configuration.md) made mise the
development interface beside Bun's runtime layer, moved each tool's
configuration into `.config/` where the tool can be made to find it, and
cut the configuration's comments to directives, labels and one-line whys.
This report records what was probed and how, the rulings made on the spec,
the comment audit before and after, and the verification. The reasoning the
configuration no longer carries is on the wiki's
[build configuration](../wiki/topics/build-configuration.md) page. The work
ran on `build/cleanup-config` in a clone, `~/dev/dorothy-build-config`,
tasks implemented and reviewed one by one.

## What was built

- Herdr's pins left `skills-lock.json` and `agents.test.ts`; the vendored
  extension's provenance keeps its own pin.
- `test-setup.ts` drops git's `GIT_*` variables, so a test running git in a
  scratch repository cannot write the repository a hook commits to.
- `.config/mise/config.toml` pins the tools and `.config/mise/tasks.toml`
  defines every development task, in `configuring-mise-tasks`' standard set,
  with `sources` and `outputs = { auto = true }` so a task skips itself when
  nothing it reads changed, and `--staged` narrowing through
  `scripts/with-files.sh`. The pre-commit hook now runs the five linters mise
  pinned but only the shared CI ran: shellcheck, shfmt, tombi,
  editorconfig-checker and actionlint.
- `package.json` keeps six scripts: `check`, `dev`, `eval`, `prepare`,
  `skills` and `start`. The hooks are one line each.
- Tombi's, markdownlint's and remark's configuration moved into `.config/`;
  `.yamllint.yaml` was deleted for an environment variable. Biome's and
  commitlint's stayed.
- Three contracts moved to files beside theirs, `.github/workflows/ci.md`,
  `.sops.md` and `scripts/prepare.md`, each checked by `pairs.test.ts`.
- Every narrative left the configuration for the wiki page.

## Probes

Run on 2026-11-11 by the controller in a throwaway worktree, before the
plan, except where a task is named. Each was run on the tool as pinned.

### Biome

Biome's configuration was placed at `.config/biome.json` and Biome run
three ways: finding it natively, with `BIOME_CONFIG_PATH`, and with
`--config-path`. All three refused to run with "Found a nested root
configuration": Biome takes a configuration in a subdirectory for a second
root. **Result:** `.biome.json` stays at the root.

### commitlint

The configuration was placed at `.config/commitlintrc.ts`, `.mts`, `.mjs`
and `.js`. commitlint found none. Its `load-config.js` overrides
cosmiconfig's `searchPlaces` with a list that omits `.config/`, and the
shared CI runs commitlint with no `--config`. **Result:**
`.commitlintrc.mts` stays at the root.

### markdownlint-cli2

`markdownlint-cli2 --config .config/markdownlint-cli2.jsonc` was run over
`.github/pull_request_template.md` and the files in `.agents/memory/`. Both
passed, so the directory overrides still merge over the given
configuration, and a long line was flagged MD013. **Result:** the
configuration moves, given by `--config`. Task 5 repeated it through
`mise run --force lint:md` (exit 0, the file set including both
directories) and with a tracked 102-character line in `docs/`.

### remark

`remark --rc-path .config/remarkrc.json` flagged a 150-character line and
exited 1 under `--frail`. **Result:** the configuration moves, as
`.config/remarkrc.json`, given by `--rc-path`. Task 5 found two things the
probe did not: Biome wants the file's plugin array laid out on three lines,
and remark leaves a final line unreported (its preset's documented
behaviour), so a long line last in a file is caught by markdownlint's MD013
instead (`Expected: 80; Actual: 102`).

### Tombi

Tombi formatted a scratch TOML file, aligning values within a group, using
`.config/tombi.toml` found natively. **Result:** the configuration moves.
After the move `mise run --force lint:toml` linted and formatted seven TOML
files cleanly.

### yamllint

The shared CI's configuration was compared with
`@chewygumxx/yamllint-config`: the diff of their non-comment lines was
empty. **Result:** `.yamllint.yaml` is deleted. mise's `[env]` sets
`YAMLLINT_CONFIG_FILE` to the package's `config.yaml` by absolute path
(`mise env` resolves it), and the shared CI falls back to the same style.

### editorconfig-checker

Over the tracked files the checker reported 2172 errors with its defaults
and none with `-disable-indent-size`, which is the shared CI's default.
**Result:** `lint:editorconfig` runs with `-disable-indent-size`.

### The other added linters

shellcheck, shfmt, tombi and actionlint were clean over the repository's
files as they stood, so adding them to `check` needed no fixes.

### Trust

A fresh worktree's mise configuration was reported trusted, and
`mise run` ran the tasks of an untrusted configuration without prompting
(mise 2026.11.4). **Result:** no `mise trust` step; the README dropped it.
Task 3 found that no test needed `MISE_TRUSTED_CONFIG_PATHS`, and `mise
trust` was never run on anyone's behalf.

### Probes run by the tasks

- **Spawn environment (Task 2).** Bun 1.4.2's `Bun.spawn` and
  `Bun.spawnSync`, given no `env`, pass the process's startup environment
  and ignore both deletions and assignments to `process.env`;
  `node:child_process` and Bun's `$` reflect them. Deleting the `GIT_*` keys
  in `test-setup.ts` alone left the child test failing, so the preload also
  wraps both functions to default `env` to `process.env`, which carries the
  `XDG_*` and `FORCE_COLOR` isolation to those children too.
- **Em dash bytes (Task 3).** `git grep -P '\x{2014}'` fails under
  `LC_ALL=C` ("code point too large"); the task greps the three UTF-8 bytes
  with `-F`, which works in any locale. A staged file holding the character
  failed (exit 123) in UTF-8 and C locales, and a clean tree passed.
- **Task records (Task 3).** mise keeps task records in its state
  directory, not its cache, so `mise cache clear` does not reach them. The
  cold run used fresh `MISE_STATE_DIR` and `MISE_CACHE_DIR`.
- **Format ordering (Task 3).** With a staged probe file whose breadcrumb
  and formatting were both wrong, `mise run format` finished `format:header`
  before any `format:<kind>` started, and the forced lint then passed. The
  `wait_for` entries make it so. They order only tasks already in the run,
  so `mise run format:code --staged` alone does not run `format:header`.

## Rulings

Made while carrying the plan out, each with its reason.

- **`build(config):` for configuration commits.** The plan's `config:`
  headers fail commitlint, where `config` is a scope, not a type.
  `build(config):` follows the earlier `build(config): Pin Node for Pi`.
- **"Each commit leaves `bun run check` passing" means no failure beyond
  the baseline.** At the start, in the controller's agent environment, 48
  tests failed on a pristine checkout (45 in
  `scripts/agent-stewardship.test.ts`, two in `scripts/statusline.test.ts`
  and one in `scripts/probe-pi-stewardship.test.ts`), the environment's, not
  the code's: they pass under `mise run`, whose environment is cleaner.
  From Task 3 on, every commit passed the whole suite through the hook.
- **Herdr's pin stays in its provenance.** Dropping the `skills` field broke
  `extension.test.ts`, which compared the vendored extension's `PROVENANCE.md`
  pin with `package.json`. The test now asserts only that the file carries a
  `Pin:` of 40 hexadecimal digits, and `PROVENANCE.md` states the pin as the
  commit the copy came from. The digests remain the real check.
- **The main CI failure was a flake and got its own task.**
  `herdr.test.ts` "hold nothing of this machine" asserts that its fixture
  lacks the string `w3`, but the fixture embeds a random `mkdtemp` root, and
  CI drew `/tmp/dorothy-steward-Jw3efw`. Task 1b checks the string against the
  fixture with its scratch root removed. RED: a root forced to contain `w3`
  failed the test; GREEN: it passes with the forcing in place and without.
- **`ci.yaml` keeps one why inline.** The plan sent two narratives to the
  wiki and gave `ci.md` the jobs contract. The concurrency why is tied to one
  line, so the spec's comment rules keep it there as one line; the dispatch
  narrative moved to the wiki, and `ci.md` holds the dispatch fact alone.
- **Mise's task records.** The plan's cold run used `mise cache clear`,
  which does not clear them; fresh state and cache directories do.
- **The skip floor stays.** A `lint` whose every task skips takes about 12
  seconds on mise 2026.11.4, which walks `node_modules` for each `**/*`
  source set. The librarian found the fix upstream (mise 2026.11.6, below).
  The repository keeps the skill's source form and lists no top-level
  directories, as a new directory would then go unwatched.
- **Full runs check tracked files only.** A task given no `--staged` hands
  its tool the tracked files, so an untracked file goes unchecked until it is
  staged, where the pre-commit hook and CI check it.
- **Unprobed stays are marked.** The wiki first stated every reason a file
  stays at the root as if probed. Only Biome's, commitlint's and the
  markdownlint overrides were. The page now cites a tool's documentation or
  the shared CI for the rest, and marks `skills-lock.json`, commitizen's
  configuration, Markdown Oxide and worktrunk's reading of
  `.worktreeinclude` as unprobed.

## Comment audit

The spec's audit classified every comment below the house header in the 23
configuration files, hooks and `scripts/prepare.sh`. The same set is
counted again after the work; `.yamllint.yaml` is deleted, leaving 22.
Headers, modelines, shebangs and schema lines are directives and are not
counted.

| Kind                          | Spec audit | Before the trim | After |
| ----------------------------- | ---------- | --------------- | ----- |
| Labels                        | 21         | 22              | 24    |
| One-line whys                 | 9          | 11              | 20    |
| Contracts, one line (labels)  | 4 of 7     | 3               | 4     |
| Contracts longer than a line  | 3 of 7     | 1               | 0     |
| Narratives                    | 28         | 24              | 0     |

"Before the trim" is the commit that paired the contracts, before the
narratives went to the wiki. Narratives were `.moxide.toml` 16 (copied from
the tool's template, deleted), `bunfig.toml` 4, and `.shellcheckrc`,
`.worktreeinclude`, `post-checkout` and `post-merge` 1 each; the
multi-line contract was `.commitlintrc.mts`'s. Every removed narrative
landed on the wiki page except `.moxide.toml`'s, which restated the tool's
documentation and was replaced by its reference URL. The new
`.config/mise/tasks.toml`, outside the audited set, has eight labels and one
why. No narrative remains, and no contract is longer than a line.

## Verification

From Task 4, when the hook became `mise run check --staged`, each commit
passed it with the whole suite, and commitlint, none with `--no-verify`;
the passing count grew from 4689 to 4698, with none failing. A commit that
failed the hook was fixed at its cause and retried, never bypassed.

### mise run

```sh
mise run --force check
```

Exit 0, every lint task ran and none skipped. Lint output was one Biome
info, `useTemplate` in `packages/memory/src/memory/reviewer.test.ts:39`,
which predates the work. Tests: `4698 pass`, `0 fail`, `Ran 4702 tests
across 224 files` in 157 s (four skipped).

### bun run

```sh
bun run check
```

Exit 0. It is `mise run check`, so the four file-based tasks whose sources
had not changed since the forced run (actions, shell, toml and yaml) said
`sources up-to-date, skipping`, and the rest ran. Tests: `4698 pass`,
`0 fail`, `Ran 4702 tests across 224 files` in 158 s.

### Skipping and staging

```sh
mise run lint
mise run lint
touch README.md && mise run lint
git add README.md && mise run lint --staged
```

The second run skipped all nine file-based tasks, leaving `lint:types` and
`lint:header` (which declare no sources). After the touch `lint:md`,
`lint:code`, `lint:editorconfig`, `lint:emdash` and `lint:secrets` reran,
the `**/*` tasks, and actions, shell, toml and yaml skipped. The staged run
handed `./README.md` alone to the Markdown tasks and nothing to the shell,
TOML and YAML tasks; a second staged run skipped all nine.

### CI's cold start

With fresh `MISE_STATE_DIR` and `MISE_CACHE_DIR`, `mise run check` exited 0
with no "skipping" line and 4688 passing and none failing, and wrote nine
auto-output records. No trust prompt appeared. (Review focus 2.)

### Mise absent

In a scratch clone of the branch with `node_modules` removed and a stub
`mise` first on `PATH` that logs and exits 99, `bun install` exited 0 (its
`prepare` ran) and `bun run dev -- --help` exited 0 and printed the usage.
The stub was never called, so no log was written. The clone was removed.
(Review focus 3.)

### Hook isolation

`GIT_INDEX_FILE=/nonexistent bun test test-setup.test.ts` fails without the
preload and passes with it. A third test runs a probe test under the preload
in a scratch directory with an explicit environment holding
`GIT_INDEX_FILE`, and checks the probe's own environment and three kinds of
child: `Bun.spawnSync` in array form, `Bun.spawn({ cmd })`, and one given an
explicit `env`, whose `GIT_KEPT=yes` survives. Not stripping `GIT_` fails all
three tests; removing the wrapper's default fails the child test and the
preload test. (Review focus 1.)

### Overrides after the move

`mise run --force lint:md` over `.github/pull_request_template.md` and
`.agents/memory/` passed with the configuration at
`.config/markdownlint-cli2.jsonc`. (Review focus 5.)

### Pairs

`bun test pairs.test.ts`: 9 pass, 15 expectations. Each pair also has a
drift test on in-memory fixtures (an extra job, an extra recipient, an extra
command), which pass only because the comparison fails on the drift. Before
the Markdown files existed the same file failed with `ENOENT`. The
recipients compared are public keys; no secret value is read or printed.

### Guards

`git grep -nE 'bun run (commit|format|lint|test|typecheck)\b'` outside the
dated records printed nothing, and a wider grep for any `bun run <script>`
other than `dev`, `start`, `eval`, `skills`, `check` and `prepare` printed
nothing. `bun run check` and every task wrote nothing: `git status --short`
was empty after.

## Limits

- **The skip floor.** A `lint` that skips everything takes about 12 s on
  mise 2026.11.4, as above. mise 2026.11.6, released on 2026-11-10, prunes
  the directories a trailing `!**/node_modules/**` excludes
  ([jdx/mise#15499](https://github.com/jdx/mise/pull/15499), merged on
  2026-11-09). Neither the repository's pin (`min_version = "2026.9.0"`) nor
  `configuring-mise-tasks` has adopted it: the skill will move the exclusion
  last once it is benchmarked on 2026.11.6. The report did not measure it.
- **One flake.** In the hook of one commit,
  `scripts/probe-pi-stewardship.test.ts` "the live control boundary > locks
  the interrupter and prompt sender in one trial namespace" failed once
  (expected exit 7, received 10, after 13.5 s). It passed twice alone and on
  the retried commit. It is timing-sensitive under the hook's load, a
  possible CI flake, and is not diagnosed.
- **The agent environment's baseline.** The 48 failures that predate the
  branch were never diagnosed here; they pass under `mise run`.
- **Unprobed stays.** The reasons `skills-lock.json`, commitizen's
  configuration, `.moxide.toml` and `.worktreeinclude` stay at the root are
  the repository's reading of documentation; a later probe could move them.
- **`act` is untested.** It needs Docker and the network, and the remote
  task it wraps follows `v1`.
- **Staged runs read the working tree.** Under `--staged` the tools see the
  working-tree copies of the staged files, not the index's blobs.
- **Editors outside mise.** An editor's yamllint run no longer finds the
  house style in the repository, as the variable lives in mise's
  environment. The editor plugins for markdownlint and remark also look
  for configuration at the root or in `package.json`'s `remarkConfig`, so
  they lose the house presets after the move.
- **An 84-character line.** `.github/.markdownlint-cli2.jsonc` holds an
  `MD041` why of 84 characters, which predates the work; lint passes it.
- **Added references.** `.worktreeinclude` and `.moxide.toml` gained a
  reference URL where they had none.
- **Secrets stay put.** `secrets.json` and `.sops.yaml` did not move; their
  relocation is a [roadmap candidate](../roadmap.md#candidates).

## Related

- [Build configuration restructuring
  design](../specs/2026-11-10_build-configuration.md)
- [Build configuration restructuring
  plan](../plans/2026-11-11_build-configuration.md)
- [Build configuration](../wiki/topics/build-configuration.md)
- [Data by function deferred
  findings](../deferred/2026-11-11_data-by-function-deferred.md)
