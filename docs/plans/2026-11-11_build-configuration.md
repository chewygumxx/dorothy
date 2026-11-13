---
ctime: 2026-11-11
mtime: 2026-11-11
spdx: GPL-3.0-only
title: Build configuration restructuring plan
description: >-
  Task by task: herdr's removal, test isolation from git's hook variables,
  mise configuration and tasks, package.json's two layers, configuration
  moved into .config/, terse comments with paired contracts, and the wiki.
tags:
  - config
  - plan
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/plans/2026-11-11_build-configuration.md
   -
   -->

# Build configuration restructuring plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> subagent-driven-development (recommended) or executing-plans to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mise tasks become the development interface beside Bun's runtime
layer, configuration turns terse and moves into `.config/` where mise can
reach it, and contracts and reasoning leave configuration files.

**Architecture:** `.config/mise/config.toml` pins tools and includes
`.config/mise/tasks.toml`, which defines every development task in
`configuring-mise-tasks`' standard set. `package.json` keeps only
`prepare`, `dev`, `start`, `eval`, `skills` and a `check` that runs
`mise run check`. Hooks are one line. Three contracts move to paired
Markdown files checked by `pairs.test.ts`; narratives move to a wiki page.

**Tech Stack:** mise 2026.11, Bun 1.4, husky 9, Biome, remark,
markdownlint-cli2, Prettier, yamllint, shellcheck, shfmt, tombi,
editorconfig-checker, actionlint, commitlint.

**Spec:** [build configuration
restructuring](../specs/2026-11-10_build-configuration.md)

## Global Constraints

- Work in `~/dev/dorothy-build-config` on `build/cleanup-config`. Never
  in `~/dev/dorothy` or its worktrees.
- `bun install`, `prepare`, `bun run dev`, `bun run start`,
  `bun run eval` and `bun run skills` never call mise.
- No task calls `bun run <script>` for a script that calls `mise run`.
- npm CLIs run as `bunx --bun --no-install <cli>`; mise-pinned tools by
  name.
- `lint`, `test` and `check` never write files.
- Never run `mise trust` for the user.
- Tests and probes never touch real user data or the real repository.
- Every new headed file (`.ts .mts .sh .toml .yaml .jsonc .md`) carries
  the house header copied from a sibling; `bun run format:header` until
  Task 4, `mise run format:header` after, rewrites a copied breadcrumb.
- Lines at most 80 characters in Markdown; no em dash anywhere.
- Commits: Conventional Commits, header at most 50 characters, body lines
  at most 72, scopes `config`, `claude`, `api` or a package name; agent
  assets take the `ai` type. No agent trailers.
- Each commit leaves `bun run check` passing.

## Review Focus

1. A commit made from a hook: `mise run check --staged` runs the tests
   with `GIT_INDEX_FILE` set; a test running git in a scratch repository
   must not touch this repository's index (Task 2 pins it).
2. `bun run check` in CI, where mise comes from `jdx/mise-action` and no
   task record exists: every task runs, none skips (Task 3, step 6).
3. A fresh clone with mise absent from `PATH`: `bun install` succeeds and
   `bun run dev -- --help` starts (Task 4, step 6).
4. A second `mise run lint` with nothing changed skips every file-based
   task; touching one Markdown file reruns `lint:md` alone (Task 3,
   step 5).
5. A staged file in a directory with an override config, such as
   `.github/pull_request_template.md`, still passes markdownlint after
   the move (Task 5, step 3).

---

### Task 1: Remove the herdr skill's pins

**Files:**

- Modify: `package.json` (the user's uncommitted edit: `skills` field
  removed)
- Modify: `skills-lock.json` (remove the `herdr` entry)
- Modify: `agents.test.ts:157-169` (remove "pins every remote skill
  source to a commit")

**Interfaces:**

- Produces: `prepare` passing again, which every later `bun install`
  relies on.

- [ ] **Step 1: Confirm the failure**

Run: `bun test agents.test.ts --test-name-pattern 'the skills'`
Expected: FAIL in "pins every remote skill source to a commit",
`manifest.skills` undefined.

- [ ] **Step 2: Remove the test and the lock entry**

Delete the `it(...)` block; delete `skills.herdr` from
`skills-lock.json` with `jq` (keep its two-space format).

- [ ] **Step 3: Verify**

Run: `bun install && bun test agents.test.ts`
Expected: `prepare` exits 0; all pass, "links nothing the lock does not
record" included (the sync drops herdr's links).

- [ ] **Step 4: Commit**

```sh
git add package.json skills-lock.json agents.test.ts
git commit -m "ai: Remove the herdr skill's pins"
```

### Task 2: Isolate tests from git's hook variables

**Files:**

- Modify: `test-setup.ts`
- Create: `test-setup.test.ts`
- Modify: `tsconfig.json` (`include` gains `test-setup.test.ts`)

**Interfaces:**

- Produces: no `GIT_*` variable in `process.env`, nor in a child spawned
  without an explicit `env`, during any test.

- [ ] **Step 1: Write the failing test**

```ts
describe("the test environment", () => {
    it("carries none of git's hook variables", () => {
        expect(gitVariables(process.env)).toEqual([]);
    });
    it("passes none to a child", () => {
        const child = Bun.spawnSync(["env"]);
        expect(gitVariables(lines(child.stdout))).toEqual([]);
    });
});
```

`gitVariables` returns the names starting `GIT_`; `lines` parses
`NAME=value` output into an object.

- [ ] **Step 2: Run it under a hook's variables**

Run: `GIT_INDEX_FILE=/nonexistent bun test test-setup.test.ts`
Expected: FAIL, `["GIT_INDEX_FILE"]`.

- [ ] **Step 3: Strip them in `test-setup.ts`**

Delete every `process.env` key starting `GIT_`, with a one-line why:
a pre-commit hook runs the tests with git's variables set.

- [ ] **Step 4: Verify**

Run: `GIT_INDEX_FILE=/nonexistent bun test test-setup.test.ts`, then
`bun test`
Expected: PASS; full suite passes.

- [ ] **Step 5: Commit**

```sh
git add test-setup.ts test-setup.test.ts tsconfig.json
git commit -m "test: Drop git's hook variables in tests"
```

### Task 3: mise configuration and tasks

**Files:**

- Move: `mise.toml` to `.config/mise/config.toml`, with the user's
  uncommitted edit
- Create: `.config/mise/tasks.toml`
- Create: `scripts/with-files.sh` (from the skill)
- Modify: `skills-lock.json` (by `skills add`)

**Interfaces:**

- Consumes: Task 2's isolation.
- Produces: these tasks, by name, for every later task:

  - `install` (`i`): `bun ci`.
  - `lint` (`l`): every `lint:*` but `lint:commit`; forwards `--staged`.
  - `format` (`f`): every `format:*`; forwards `--staged`.
  - `test` (`t`): `bun test`.
  - `check` (`c`): `lint` and `test`; forwards `--staged`.
  - `lint:code`: `biome check` (lint and format check); takes `--staged`.
  - `lint:types`: `tsc`.
  - `lint:md`: remark `--frail`, then markdownlint-cli2; takes `--staged`.
  - `lint:yaml`: `prettier --check`, then `yamllint --strict`; takes `--staged`.
  - `lint:shell`: shellcheck, then `shfmt -d`; takes `--staged`.
  - `lint:toml`: `tombi lint`, then `tombi format --check`; takes `--staged`.
  - `lint:editorconfig`: `editorconfig-checker -disable-indent-size`;
    takes `--staged`.
  - `lint:actions`: actionlint; takes `--staged`.
  - `lint:secrets`: `scripts/check-secrets.sh`, `--tracked` or with
    `--staged`.
  - `lint:emdash`: no U+2014 in tracked text files; takes `--staged`.
  - `lint:header`: `sync-header-metadata`.
  - `lint:commit`: `commitlint --edit <file>`.
  - `format:code`: `biome format --write`; takes `--staged`.
  - `format:yaml`: `prettier --write`; takes `--staged`.
  - `format:shell`: `shfmt -w`; takes `--staged`.
  - `format:toml`: `tombi format`; takes `--staged`.
  - `format:header`: `sync-header-metadata --update`.
  - `dev`, `start`, `eval`, `skills`: `bun run <same name>`.
  - `commit`: `cz`.
  - `act`, `act-cached`: as the user wrote them.

- [ ] **Step 1: Install the skill**

```sh
bunx skills add chewygumxx/agent-library --skill configuring-mise-tasks
```

Copy its `scripts/with-files.sh` to `scripts/`, then
`bun run format:header`. Commit `skills-lock.json` and the script:
`ai: Add configuring-mise-tasks`.

- [ ] **Step 2: Move and correct the mise configuration**

`git mv mise.toml .config/mise/config.toml`. Then, in the terse form:
restore `"aqua:jqlang/jq" = "1"` under a `# Utilities` label with the
why "statusline, check-secrets"; relabel `node` as "Pi runs under
Node >= 22.19"; delete every `[tasks.*]`; add
`[task_config] includes = [".config/mise/tasks.toml"]`, `[settings]
experimental = true` (the `git::` remote task needs it) and this:

```toml
[env]
YAMLLINT_CONFIG_FILE = "{{config_root}}/node_modules/@chewygumxx/yamllint-config/config.yaml"
```

The purpose block names `jdx/mise-action` and the reference URL.

- [ ] **Step 3: Write `.config/mise/tasks.toml`**

From the skill's `assets/tasks.toml`, one table per row above, each
with a `description`. File-based tasks run
`scripts/with-files.sh ${usage_staged:+--staged} '<pathspec>' -- <cmd>`
and declare `sources` (their pathspec, `!node_modules/**`, their
tool's configuration, `bun.lock`, `.config/mise/config.toml`, and the
index under `--staged`, as the skill gives it) with
`outputs = { auto = true }`. `lint:types`, `lint:header` and `test`
declare none. `act` and `act-cached` keep the user's definitions.

- [ ] **Step 4: Verify every task runs**

Run: `mise tasks ls`, then `mise run --force check`
Expected: the names above; check passes. A test that replaces `HOME`
and fails on mise's trust gets `MISE_TRUSTED_CONFIG_PATHS` set to the
repository root in its own environment.

- [ ] **Step 5: Verify skipping and staging**

Run: `mise run lint`, twice; then `touch README.md && mise run lint`;
then `git add README.md && mise run lint --staged`
Expected: second run skips every file-based task; after the touch only
`lint:md` and the tasks whose sources include `README.md` rerun; the
staged run checks `./README.md` alone.

- [ ] **Step 6: Verify a cold run**

Run: `mise cache clear && mise run check`
Expected: no task skips; pass.

- [ ] **Step 7: Commit**

```sh
git add .config/mise
git commit -m "config: Define development tasks in mise"
```

### Task 4: Two layers and one-line hooks

**Files:**

- Modify: `package.json` (`scripts` to six; `remarkConfig` stays until
  Task 5)
- Modify: `.husky/pre-commit`, `.husky/commit-msg`
- Modify: `AGENTS.md:40`, `README.md:36-41,796-801`,
  `docs/wiki/questions.md:249`,
  `docs/wiki/topics/repository-workflow.md:73-110`,
  `packages/cli/src/hosts/AGENTS.md:141`,
  `packages/cli/src/hosts/pi/runtime.test.ts:160`,
  `packages/cli/src/hosts/pi/testing.ts:172`, `scripts/pi-proxy.ts:21`,
  `scripts/probe-pi-delivery.ts:30`

**Interfaces:**

- Consumes: Task 3's task names.
- Produces: `package.json` scripts `check` (`mise run check`), `dev`,
  `eval`, `prepare`, `skills`, `start`, unchanged otherwise.

- [ ] **Step 1: Rewrite the scripts**

Keep `dev`, `eval`, `prepare`, `skills` and `start` as they are; set
`check` to `mise run check`; delete the rest.

- [ ] **Step 2: Make the hooks one line**

`pre-commit`: `mise run check --staged`. `commit-msg`:
`mise run lint:commit "$1"`. Each keeps its shebang and house header.

- [ ] **Step 3: Rename the mentions**

`bun run test` to `mise run test`, `bun run commit` to
`mise run commit`, `bun run format` to `mise run format`. The two Pi
comments say a `bun run` script prepends a Bun `node` alias, which the
filter drops. `repository-workflow.md`'s checks list becomes the task
table's `lint:*` kinds and `test`, run in parallel; its hooks paragraph
says `mise run check --staged` and `--no-verify`. `README.md`'s
prerequisites keep Bun as the only runtime need and name mise for
development.

- [ ] **Step 4: Verify the mentions**

```sh
git grep -nE 'bun run (commit|format|lint|test|typecheck)\b' -- \
    ':!docs/plans' ':!docs/specs' ':!docs/reports' ':!docs/notes' \
    ':!docs/deferred'
```

Expected: no output.

- [ ] **Step 5: Verify a commit through the hook**

Stage this task's files and commit; the hook runs
`mise run check --staged`.
Expected: the hook passes; `git status` shows no unexpected change to
the index.

```sh
git commit -m "config: Run development tasks through mise"
```

- [ ] **Step 6: Verify Bun's layer without mise**

Clone the branch into a scratch directory and run there with mise's
directories removed from `PATH`:

```sh
env PATH="$(dirname "$(command -v bun)"):/usr/bin:/bin" \
    sh -c 'bun install && bun run dev -- --help'
```

Expected: install and `prepare` exit 0; the help prints. Remove the
scratch clone.

### Task 5: Configuration into `.config/`

**Files:**

- Move: `.tombi.toml` to `.config/tombi.toml`
- Move: `.markdownlint-cli2.jsonc` to `.config/markdownlint-cli2.jsonc`
- Create: `.config/remarkrc.json`; Modify: `package.json` (drop
  `remarkConfig`)
- Delete: `.yamllint.yaml`
- Modify: `.config/mise/tasks.toml` (`lint:md` flags and sources)
- Create: `.config/AGENTS.md`
- Modify: `docs/specs/2026-11-10_build-configuration.md` (Biome and
  commitlint stay)

**Interfaces:**

- Consumes: Task 3's `lint:md`, `lint:toml`, `lint:yaml`.
- Produces: `.config/AGENTS.md`, listing each tool configured in
  `.config/` and what mise supplies: `--rc-path .config/remarkrc.json`
  (remark), `--config .config/markdownlint-cli2.jsonc` (markdownlint),
  `YAMLLINT_CONFIG_FILE` (yamllint), nothing (tombi, mise).

- [ ] **Step 1: Move tombi's and delete yamllint's**

`git mv`; `bun run format:header` is now `mise run format:header`.

- [ ] **Step 2: Move remark's and markdownlint's**

`.config/remarkrc.json` is `{"plugins": ["@chewygumxx/remark-preset"]}`;
`lint:md` passes `--rc-path` and `--config` as above, and its `sources`
name both files.

- [ ] **Step 3: Verify the overrides still merge**

Run: `mise run --force lint:md` and
`mise run --force lint:toml lint:yaml`
Expected: pass, `.github/pull_request_template.md` and `.agents/memory/`
included. Then a file with a 92-character line under `docs/` fails
`lint:md` with MD013 and remark's line length; delete it.

- [ ] **Step 4: Record what stays**

In the spec's "Where configuration lives", Biome and commitlint stay at
the root: Biome refuses a configuration in a subdirectory as a second
root (probed 2026-11-11, by path and by `BIOME_CONFIG_PATH`), and
commitlint's search omits `.config/` while the shared CI passes no
`--config`.

- [ ] **Step 5: Write `.config/AGENTS.md`**

House header from `packages/core/AGENTS.md`; the list above; one line
each.

- [ ] **Step 6: Commit**

```sh
git commit -m "config: Move tool configuration into .config"
```

### Task 6: Contracts beside their files

**Files:**

- Create: `pairs.test.ts`; Modify: `tsconfig.json` (`include`)
- Create: `.github/workflows/ci.md`, `.sops.md`, `scripts/prepare.md`
- Modify: `.github/workflows/ci.yaml`, `.sops.yaml`, `scripts/prepare.sh`
  (contracts removed)

**Interfaces:**

- Produces: `pairs.test.ts`, a `describe` per pair.

- [ ] **Step 1: Write the failing tests**

```ts
it("names ci.yaml's jobs, and only those", () => {
    expect(codeSpans(ci_md).filter(isJob)).toEqual(jobs(ci_yaml));
});
it("names .sops.yaml's recipients, which secrets.json uses", () => {
    expect(recipients(sops_md)).toEqual(recipients(sops_yaml));
    expect(recipients(sops_yaml)).toEqual(ageRecipients(secrets_json));
});
it("names the commands prepare.sh runs, in order", () => {
    expect(commandSpans(prepare_md)).toEqual(commands(prepare_sh));
});
```

`jobs` reads `ci.yaml`'s `jobs` keys with `Bun.YAML`; `recipients`
matches `age1[0-9a-z]+`; `ageRecipients` reads
`secrets.json`'s `sops.age[].recipient` (public keys only, never a
value); `commands` takes `prepare.sh`'s non-comment, non-control lines
(`husky`, `bun run skills --no-remote`, the `bun test` line,
`bun scripts/agent-memory.ts`); `commandSpans` the code spans in
`prepare.md`'s steps list.

- [ ] **Step 2: Run them**

Run: `bun test pairs.test.ts`
Expected: FAIL, the three `.md` files absent.

- [ ] **Step 3: Write the three files, and strip their pairs**

Each opens with a house header like `packages/core/AGENTS.md`'s, then
what its file is for and promises, taken from today's comments:
`ci.md` the two jobs and why the header sync is never cancelled
mid-run; `.sops.md` the recipient, where its private half lives
(`~/.config/sops/age/keys.txt`) and that `saveSecret` reads
`.sops.yaml` beside the file; `prepare.md` when it runs, the
production no-op and each step. The three source files keep only
directives, labels and one-line whys.

- [ ] **Step 4: Verify**

Run: `bun test pairs.test.ts`, then add a job to a scratch copy of
`ci.yaml` in the test's own fixture and confirm the test fails.
Expected: PASS for the real files; the mismatch fails.

- [ ] **Step 5: Commit**

```sh
git commit -m "config: Pair contracts with their files"
```

### Task 7: Terse configuration and the wiki

**Files:**

- Modify: every remaining configuration with a narrative:
  `bunfig.toml`, `.shellcheckrc`, `.worktreeinclude`, `.moxide.toml`,
  `.husky/post-checkout`, `.husky/post-merge`, `ci.yaml` (the two whys
  left after Task 6), `.editorconfig`, `.gitignore`
- Create: `docs/wiki/topics/build-configuration.md`
- Modify: `docs/wiki/decisions.md`, `docs/wiki/records.md`,
  `docs/README.md` (the new topic page),
  `docs/wiki/topics/development-evidence.md:181` (the `mise.toml` path)

**Interfaces:**

- Produces: the wiki page, one `##` section per tool, which
  `.config/AGENTS.md` links.

- [ ] **Step 1: Move the narratives**

Each narrative becomes a paragraph in its tool's section of
`build-configuration.md`; the file keeps its label, URL and any
one-line why. `.moxide.toml`'s sixteen template blocks are deleted,
its URL kept. The page also records what stays at the root and why
(Biome, commitlint, `.husky/`, the root-only files).

- [ ] **Step 2: Record the decisions**

`decisions.md` gains: the two layers; `.config/` where mise can reach;
configuration keeps directives, labels and one-line whys; approach 1.

- [ ] **Step 3: Verify**

Run: `mise run --force check`, `bun run check`
Expected: pass. Count the comments again as the spec's audit did:
no narrative remains; no contract longer than a line.

- [ ] **Step 4: Commit**

```sh
git commit -m "docs: Move configuration reasoning to the wiki"
```

### Task 8: Close-out

- [ ] **Step 1: Report**

`docs/reports/2026-11-11_build-configuration.md`: each probe and its
result (Biome, commitlint, markdownlint, remark, tombi, yamllint,
editorconfig-checker, trust), the rulings, the comment audit before
and after, and the verification with commands and output. List it in
`records.md`.

- [ ] **Step 2: Roadmap**

Move the work to Done as the roadmap's Revising section says.

- [ ] **Step 3: Verify, push and open the pull request**

Run: `bun run check`; push; open the pull request; merge once CI
passes, as the root `AGENTS.md` allows.
