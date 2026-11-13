---
ctime: 2026-11-14
mtime: 2026-11-14
spdx: GPL-3.0-only
title: Repository configuration of agent assets
description: >-
  Skills declared in package.json's skills array, the repository's own
  skills as a workspace package, agent memory moved to docs/memory, and
  .agents and .claude ignored whole.
tags:
  - config
  - agents
  - spec
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/specs/2026-11-14_repo-config.md
   -
   -->

# Repository configuration of agent assets

## Status and intent

Drafted with the user on 2026-11-14, on `build/repo-config`. The user
asked how skills could be declared better than by `package.json`'s
`skills` script, how agent memory could move to `docs/`, and what would
then let `.agents/` and `.claude/` be ignored whole. They chose the
`skills` array that `skills experimental_sync` reads, accepted that
superpowers' skills then need a download and that the command is
experimental, removed `.claude/settings.json` themselves, ruled the
three settings it held outside the repository's purview, and chose
approach A below.

The why: every agent asset is declared in files the repository owns, by
one mechanism each, and `.agents/` and `.claude/` hold only what tools
generate from them, so nothing in either is tracked or edited by hand.

## Goals

- `package.json`'s `skills` array declares every third-party skill, each
  source pinned to a commit and narrowed to the skills taken.
- The repository's own skills live in a workspace package,
  `@dorothy/skills`, which sync links like any dependency's skills.
- One command links every skill:
  `skills experimental_sync -y --agent claude-code codex`.
- Agent memory lives in `docs/memory/`, where Claude Code's auto memory
  and Dorothy's fact sync both read and write it.
- `.gitignore` ignores `/.agents/` and `/.claude/` whole, and
  `git ls-files .agents .claude` is empty.

## Non-goals

- Claude Code's settings. Attribution, enabled plugins and the status
  line are each user's own (the user's ruling); the repository declares
  none of them. `.claude/settings.local.json`, which `prepare` writes
  for auto memory, stays as it is.
- mise's `skills sync` for `packslip:` tools. It suits only skills a
  publisher releases that way; it may come later, should
  `chewygumxx/agent-library` or `claude-library` publish so.
- Changing where other repositories keep their memory: Dorothy's default
  for a repository with no memory directory stays `.agents/memory`.

## Anti-goals

The work fails, however it runs, if:

- the move retires, duplicates or loses any fact in Dorothy's store, or
  any memory file;
- a test or probe touches real user data (`$XDG_DATA_HOME/dorothy`,
  `$XDG_CACHE_HOME/dorothy`, or the user's Claude configuration);
- a fresh clone or a new worktree needs a hand-made step beyond
  `bun install` to have every skill linked;
- the repository's own skills or the memory need a network to be present.

## Constraints

- `prepare` stays in Bun's layer and never calls mise
  ([build configuration](../wiki/topics/build-configuration.md#two-layers)).
  Git hooks may call `mise run`.
- The parser (`node_modules/skills/dist/cli.mjs`, `parseSkillsField`)
  accepts an entry as a string or `{ source, ref?, skills? }`. A git
  source (`owner/repo`, `owner/repo@skill`) may take a `ref` and a list
  of skills to take. An `npm:` entry needs an installed dependency. A
  local path is rejected (`is not a git source`), which a dry run
  confirmed on 2026-11-14.
- Sync links every skill of every dependency whether the array names it
  or not, so an `npm:` entry cannot narrow superpowers. Superpowers
  therefore leaves `devDependencies`.
- Sync exits 0 on a skipped skill, so a test after each sync still fails
  the run, as `prepare` does today. It exits 1 on an invalid array or a
  failed fetch (corrected on 2026-11-14 by Task 5's offline probe).
- A skill in `skills-lock.json` installed by `skills add` is never
  shadowed by sync, so the remote entries recorded that way today must
  be removed before sync can manage them.
- Dorothy's fact sync uses the memory directory its registry recorded
  for a project before choosing one
  (`packages/memory/src/projects/sync.ts:355`). This repository is
  recorded with `.agents/memory`, so choosing alone would not move it.
- Claude Code's `autoMemoryDirectory` must be absolute, so it stays in
  the gitignored `.claude/settings.local.json` that
  `scripts/agent-memory.ts` writes.
- The packages' rules apply to the new package: an `AGENTS.md`, exports
  only through its `package.json`, imports only what it declares, and
  `workspace.test.ts` pinning the graph.
- Every split pair has a check that fails when the two disagree.

## Approaches

- **A. A ninth workspace package (chosen).** The own skills move to
  `packages/skills/skills/<name>/`, published as `@dorothy/skills`, a dev
  dependency of the root. Sync links them offline beside every other
  skill; `cli` declares the package to reach the stewardship scripts.
  Trades the eight-package rule for one linking mechanism, and code
  finding the scripts through a declared package.
- **B. A root `skills/` and a linking script.** Keeps eight packages,
  but adds a second linker beside sync, with its own tests and links
  sync refuses to replace, and leaves `engine.ts` on a repository path.
- **C. The own skills moved to `chewygumxx/agent-library`.** Puts every
  skill in the array alike, but these skills serve this repository
  alone, and each change would span two repositories. Rejected.

The user chose A.

## Design

### Skills

`package.json`:

- A `skills` array, each entry `{ source, ref, skills }`:
  - `obra/superpowers`, ref `2ce8aa1` (the commit `bun.lock` pins now,
    in full), skills: `brainstorming`, `dispatching-parallel-agents`,
    `executing-plans`, `finishing-a-development-branch`,
    `receiving-code-review`, `requesting-code-review`,
    `subagent-driven-development`, `systematic-debugging`,
    `test-driven-development`, `verification-before-completion`,
    `writing-plans`.
  - `chewygumxx/agent-library`: `configuring-mise-tasks`.
  - `chewygumxx/claude-library`: `compact-summary` (under
    `plugins/compact/skills/` there).
  - `addyosmani/agent-skills`: `code-simplification`.
  - `vercel-labs/skills`: `find-skills`.
  - `ayghri/i-have-adhd`: `i-have-adhd`.
- `devDependencies` lose `superpowers` and gain
  `"@dorothy/skills": "workspace:*"`; the `skills` CLI stays, since
  `prepare` runs it without mise.
- `scripts` lose `skills`, as package.json keeps only lifecycle scripts,
  entry points and names outside callers use.

`@dorothy/skills` (`packages/skills/`):

- `skills/agent-pre-screening/`, `skills/agent-stewardship/`,
  `skills/development-evidence/` and `skills/worktrees/`, moved with
  `git mv` from `.agents/skills/`, headers resynced by `format:header`.
- `package.json`: private, ESM, no dependencies, exporting the
  stewardship scripts that `cli` runs.
- `AGENTS.md`: what the package holds and that its skills reach agents
  only through sync.
- `cli` declares it, and `hosts/pi/steward/engine.ts` resolves
  `send-prompt.sh` and `send-interrupt.sh` through it, not through
  `.agents/skills`.

Linking:

- `prepare.sh` runs the sync, then the skills' test as today, then
  `agent-memory.ts`. Outside CI the sync fetches every remote skill it
  lacks, so a plain `bun install` links every skill (the user's ruling,
  2026-11-14). Under `CI` it adds `--no-remote`, as CI needs no skill:

  ```sh
  DO_NOT_TRACK=1 skills experimental_sync -y \
      --agent claude-code codex ${CI:+--no-remote}
  ```

- A failed fetch, as offline, makes the sync exit 1. `prepare` then
  warns on stderr and re-runs it with `--no-remote`, linking the
  package's skills alone, so the install succeeds and the test after it
  tolerates an absent remote skill. A failure of that retry, as from a
  broken array or package, fails the install (the user's ruling: an
  offline install only warns).
- A mise `skills` task runs the same sync and test, to relink without
  an install, as after editing the array alone. It replaces
  `bun.task.toml`'s wrapper, moving to `other.task.toml`.
- The husky hooks stay as they are: a new worktree's `post-checkout`, and
  a checkout or merge changing `package.json` or `bun.lock`, run
  `bun install`, whose `prepare` links every skill. They need no mise.
- `.worktreeinclude` drops its skills lines, since `prepare` fetches
  them in each checkout.
- `skills-lock.json`: the remote entries `skills add` recorded are
  removed, and the first full sync records every skill as sync's.

### Memory

- `git mv .agents/memory docs/memory`, its `.markdownlint-cli2.jsonc`
  included; breadcrumbs resynced. `header.test.ts`'s exemption follows
  `MEMORY.md`.
- `scripts/agent-memory.ts` points `autoMemoryDirectory` at
  `docs/memory`; its tests and `scripts/prepare.md` follow.
- `docs/AGENTS.md` lists `memory/`: agent memory in Claude Code's
  format, its files named by the fact, undated, and not records.
- Dorothy's fact sync:
  - `chooseMemoryDir` prefers `docs/memory`, then `.agents/memory`, then
    `.claude/memory`, defaulting to `.agents/memory`. `docs/memory`
    counts only when it holds `MEMORY.md`, since a repository may keep
    documentation about memory there.
  - Sync judges by content. For a root with a record, it takes, of the
    directory the root synced last and each of `docs/memory`,
    `.agents/memory` and `.claude/memory` present there, the one holding
    the most files of the live facts in the root's record for that
    directory, a file counting as its fact by the stem logic sync reads
    it with; ties go to the recorded directory, then by that order. A
    stray or recreated `.agents/memory` beside a moved `docs/memory`
    holds none of the facts, so sync follows the move. A real deletion
    leaves no candidate holding them and keeps the recorded directory,
    so deleting the one memory directory still retires every fact, and
    a partial deletion inside it retires just those, while moving it
    retires none. With no record for the root, or no live fact in it,
    sync uses the recorded directory where it is present; else the
    first of the three present, recording it; else the recorded one.
    The registry already keeps a record per root and directory, and
    the one synced last (`RootSync` and `syncRecord`), which this
    relies on.
  - Today a recorded directory gone from disk retires every fact
    (`sync.test.ts:903`), so a checkout losing `.agents/memory` under the
    old code would retire them all. The sync change therefore merges
    first, in a pull request of its own; the user restarts any running
    `--serve` and updates the main checkout; only then does any checkout
    lose `.agents/memory`. The existing test that retires every fact when
    `docs/memory` is gone while `.agents/memory` remains now expects the
    switch instead.
  - A test on a scratch store and repository moves a synced
    `.agents/memory` to `docs/memory` and syncs: every fact stays live,
    none is retired or duplicated, and the registry names `docs/memory`.
  - The same test then syncs alternately from a second root still on
    `.agents/memory`, as a worktree on an older branch is, and from the
    first, with a fact added on each side: neither sync retires or
    duplicates a fact, and each new fact reaches the other directory.
  - Tests leave `.agents/memory` beside the moved `docs/memory`, empty
    or holding a new file, before and after the root syncs
    `docs/memory`: sync stays with `docs/memory`, retires nothing and
    imports nothing from the stray directory.
  - No test or probe syncs the user's own store; their first sync after
    the merge is their own use of Dorothy.
- The links follow: `AGENTS.md`, `.config/AGENTS.md`, `README.md`, the
  wiki's problems, orchestration and repository workflow pages,
  `docs/roadmap.md`, and `packages/memory/src/projects/AGENTS.md`.

### Ignoring `.agents` and `.claude`

- `.gitignore` replaces the skills block with `/.agents/` and
  `/.claude/`; `.claude/worktrees/` is covered by the latter.
- `git rm --cached` the `.claude/skills/*` links; the user's staged
  removal of `.claude/settings.json` is committed with this work.
- `agents.test.ts` loses "Claude's settings" and its plugin list.
- `scripts/statusline.sh` and its test stay: the stewardship skill's
  budget routing reads the usage file it writes. The skill's Claude Code
  reference says that the user's own status line setting must run it,
  and that without it `with-claude.sh` finds no reading and tries the
  primary account, as it already does.
- The root `AGENTS.md`'s rule on declaring agentic assets says that a
  harness's settings are the user's own.

### Checks

- Nothing under `.agents/` or `.claude/` is tracked.
- Every skill in `@dorothy/skills` is linked in `.agents/skills/` and
  `.claude/skills/`, through `node_modules`.
- A remote skill present is linked in both, and nothing the lock does
  not record is; an absent remote skill is tolerated, as CI never
  fetches one (the shared workflow runs `bun install --frozen-lockfile`
  then `bun run check`), and `agents.test.ts` skips such a skill today.
- Superpowers' four unwanted skills are linked nowhere.
- `skills-lock.json` records exactly the array's skills and the
  package's, and is committed as the last full sync wrote it, since the
  CLI runs frozen in CI. That `bun install --frozen-lockfile` under
  `CI=1` passes with no remote skill fetched is verified before merge.
- Each array entry pins a full commit.
- A `lint:skills` task, part of `lint`, runs the sync frozen, offline and
  dry (`--frozen-lockfile --no-remote --dry-run`), which exits 1 when an
  own skill changed without the lock (probed 2026-11-14), so a commit
  fails before CI does.
- `workspace.test.ts` pins `@dorothy/skills` in the graph.
- The memory move test above.

### Records

- `docs/wiki/decisions.md`: skills by the array and a package, memory in
  `docs/memory`, the two directories ignored, harness settings the
  user's.
- The build configuration and repository workflow pages, the packages
  profile, the root `AGENTS.md`'s packages and memory sections.
- This spec and its plan in `docs/wiki/records.md`.

## Left to the builder

- Each array entry's full commit, taken from its source's head at
  implementation, and superpowers' in full from `2ce8aa1`.
- The shape of `@dorothy/skills`' exports, and the tests' wording.
- The order of commits.
- Whether `compact-summary` needs its subpath in the source; a real sync
  settles it.

The builder may use the network during implementation, and regenerates
`skills-lock.json` with a real full sync in its checkout once the
explicit remote entries are removed and the commits chosen.

## Probes

- 2026-11-14, a scratch repository with a `workspace:*` dev dependency
  holding `skills/demo/SKILL.md`, installed with Bun's isolated linker:
  two runs of the sync with `--no-remote` each linked `demo` into
  `.agents/skills` through `../../node_modules/@p/skills/skills/demo`,
  with `.claude/skills/demo` linking that, and recorded it in
  `skills-lock.json` as `sourceType: "node_modules"`. Approach A holds.
