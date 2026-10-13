---
ctime: 2026-10-13
mtime: 2026-10-13
spdx: GPL-3.0-only
title: Agentic asset refactor implementation report
description: >-
  How the agentic asset refactor was built: the spec's amendments, the
  plan's tasks, the rulings made, what two rounds of review changed,
  every commit and what is left.
tags:
  - dorothy
  - agents
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-13-agentic-asset-refactor-implementation.md
   -
   -->

# Agentic asset refactor implementation report

## Summary

Every coding agent now reads this repository's guidance, skills and
memory from conventions it understands, declared in the repository:

- **Guidance.** The 15 KB `.claude/CLAUDE.md` is gone. A root `AGENTS.md`
  (100 lines), `docs/AGENTS.md` and one `AGENTS.md` per package replace
  it. Claude Code loads the root's at launch and a package's once a file
  beneath it is read; Codex reads them from the root down.
- **Skills.** Superpowers (pinned at 6.4.1) and herdr are declared in
  `package.json`. `prepare` links superpowers' eleven skills into
  `.agents/skills/` and `.claude/skills/` on every install, checks the
  links, and `bun run skills` fetches herdr.
- **Memory.** Agent memory moved to `.agents/memory/`, three memories
  became rules in the root, and `prepare` points Claude Code's auto memory
  there.
- **Settings.** `.claude/settings.json` keeps eight plugins instead of
  fourteen. Husky reinstalls when a checkout or merge changes the
  dependencies, and `lint:header` checks every breadcrumb.
- **One check.** `agents.test.ts` pins the layout, the budgets, the
  links, the skills, memory, the plugins and both install hooks in 49
  tests.

A one-word session's prompt fell from 26,333 to 20,216 tokens from the
root (23%) and from 23,287 to 20,278 from `packages/tui/src` (13%).

- Spec: [`docs/specs/2026-10-11-agentic-asset-refactor-design.md`](../specs/2026-10-11-agentic-asset-refactor-design.md)
- Plan: [`docs/plans/2026-10-12-agentic-asset-refactor.md`](../plans/2026-10-12-agentic-asset-refactor.md)
- Probes: [`docs/reports/2026-10-12-agentic-asset-refactor.md`](2026-10-12-agentic-asset-refactor.md),
  with their captures in
  [`2026-10-12-agentic-asset-refactor/`](2026-10-12-agentic-asset-refactor/)
- Roadmap: [`docs/roadmap.md`](../roadmap.md)
- Branch: `feat/agentic-asset-refactor`, from `main` at `23fc00e`

At the head of the branch `bun run check` passes with 1,168 tests across
66 files, up from 1,119 on `main`.

## How it was built

**The spec**, drafted on 2026-10-11, was reviewed before planning against
the repository, CI, the installed plugins and the user's Claude Code
configuration. Two premises needed amending:

- The user-level plugins it relied on were not enabled anywhere. The user
  dropped `remember` from the phase and then ruled that every agentic
  asset and utility the repository employs is declared in it, so the four
  workflow plugins stay in `.claude/settings.json`, and a tracked script
  writes the one setting that must be absolute.
- CI's shared workflow runs `bun install` with lifecycle scripts, so the
  sync's behaviour there had to be specified. Read from the `skills` CLI's
  source: it fetches a remote skill only when absent, keeps a remote's
  lock entry under `--no-remote`, and reports to `skills.sh` unless
  `DO_NOT_TRACK` is set.

Smaller corrections followed: the docs' naming, wiki links left to remark,
the README and the worktree leftovers, each check landing with its own
step, the report and its probes, the lock kept out of formatting, and
Claude Code's `AGENTS.md` loading confirmed in its 2.1.296 binary as the
built-in `cc-plugin-agents-md`.

**The plan** has eight tasks, each a test cycle: the baseline, the skills,
each package's guidance, the root's, memory, Claude's settings, the
roadmap, and the measurements with the probes report. The seven
`AGENTS.md` files were drafted in full in the plan, checked against the
code, linted and counted against their budgets before any task ran.

**Execution** was inline, in this session, with a ledger of every ruling.
Each task wrote its part of `agents.test.ts` first and watched it fail:

1. **The baseline.** The user's plugin state and the prompt from the root
   and from `packages/tui/src` were recorded before any change.
2. **The skills.** Declared, synced and locked; the remote's behaviour and
   `prepare`'s exit codes probed.
3. **Each package's guidance.** Five files, with their budget and link
   checks; a planted broken link failed the test by name.
4. **The root's guidance.** The root and `docs/AGENTS.md`;
   `.claude/CLAUDE.md` deleted and the README repointed. A planted,
   gitignored `CLAUDE.local.md` failed the test.
5. **Memory.** Moved, three retired, `repo-memory` removed, and
   `scripts/agent-memory.ts` added to `prepare`.
6. **Claude's settings.** Eight plugins, the husky hooks,
   `sync-header-metadata`, and the worktree leftovers gone.
7. **The roadmap.** A Revising step checks the `AGENTS.md` files against
   what merged, and the phase moved to Done.
8. **Measured again**, and the probes report written.

## Deviations from the spec

### Settled in the plan

1. `repo-memory` left with the memory (Task 5), not with the other
   plugins (Task 6): it rewrote `autoMemoryDirectory` at every session
   start, so between the two a new session would have undone the move.
2. The test pins superpowers' eleven skills by name, so a dependency that
   starts shipping skills is a change a review sees.
3. The test pins memory's index, as part of the layout.
4. The `CLAUDE.md` search walks the filesystem rather than git's file
   list, as a gitignored `CLAUDE.local.md` still switches `AGENTS.md`
   off.
5. The `AGENTS.md` files carry the house header within their budgets,
   without the vim modeline. Claude Code strips the header when it loads
   a file, so it costs no tokens.
6. The test asserts `DO_NOT_TRACK=1` in the `skills` script.
7. The husky hooks were to be probed by hand. The review's second round
   made them tested instead (see below).

### Made during the implementation

- **The prompt is judged on its Total**, input plus cache write plus cache
  read. With caching, `input_tokens` is 2 either way, so the spec's
  "input tokens fall" can only mean the whole prompt.
- **The stale herdr lock entry was deleted.** The sync claims only remote
  skills it installed itself, marked by `via`, and refused herdr as
  "installed with `skills add`" while the hand-made entry of 2026-10-09
  remained.
- **Captured output was made lintable.** The sync's capture lost its
  spinner and colour codes, and its em dashes became hyphens; captured
  JSON was formatted by Biome. The probes report says so.
- **Two plan commands could not work as written.** `git rm` of the three
  retired memories needed `-f`, as `git mv` had staged them as renames,
  and `.worktreeinclude` was deleted with `rm` and staged for its own
  commit, so the deletion stayed out of the hooks' commit.
- **The tests reach beyond the repository.** The spec says they read only
  the repository. The symlink, link-check, memory-script and hook tests
  write to temporary directories, and the hook tests run git there, shut
  out of the user's configuration with `GIT_CONFIG_GLOBAL=/dev/null` and
  `GIT_CONFIG_NOSYSTEM=1`. None touches user data or the network.
- **The final review ran on Opus 5.5**, as Fable 5.1 needed usage
  credits.

## Review

### The final review

A fresh reviewer read the whole branch and found nothing critical. Two
findings were important, and two minors were raised to important because
the guidance is the phase's deliverable:

- **Claude Code's memory format.** Its own memory instructions index a
  memory as `(file.md)`, without `./`, with an em dash and past 80
  columns, so its first saved memory would have failed the index test,
  `lint:emdash` and remark. The test now reads both link forms, and the
  root's Memory section says how to write an entry.
- **A linked `CLAUDE.md`.** `walk` listed only regular files, so
  `ln -s AGENTS.md CLAUDE.md`, the usual way one returns, passed the test
  while switching every package's `AGENTS.md` off. It now lists links,
  never following one into a directory.
- **`compact()` misplaced.** `packages/memory/AGENTS.md` put it in
  `clusters.ts` and `plan.ts`; it is in `compact.ts`.
- **The check unnamed.** No guidance named `agents.test.ts` or the
  budgets, as the spec's rules ask; `docs/AGENTS.md` now does, with the
  way past a budget.

The first two were fixed test first, each test failing before the fix;
the last two are guidance, checked against the source and the spec.

### The minors

The reviewer's seven minor findings were deferred, then fixed at the
user's request:

- **The memory script.** An empty `settings.local.json` reads as no
  settings, and anything but a JSON object names the file and how to
  recover. The script writes only a gitignored file, through a temporary
  file, readable by its owner alone. Tests covered each, failing first.
- **A skipped skill, and a production install.** The sync logs a skill it
  skips, such as one whose destination is a link elsewhere, and exits 0.
  `prepare` became `scripts/prepare.sh`, which runs the skills' checks
  after the sync and does nothing without development dependencies. Both
  cases were run against the old `prepare` first (probes report).
- **The link check.** It now reads titled, angle-bracket and reference
  links, skips code, and resolves a leading slash from the root; the
  root's and docs' files get a test each.
- **The maps.** The memory map gained `catalogue.ts`, the history
  commands and `FileLock`; the cli map now says `memory` declares dotenvx
  too. Checked against the source.
- **A stale comment.** `persona.ts` no longer cites the removed
  `bun-install` hook as current.
- **A squash merge.** It changes only the working tree, leaving `HEAD`
  where `ORIG_HEAD` is, so `post-merge` compares `ORIG_HEAD` with the
  working tree. Both install hooks are now tested in a scratch repository;
  the squash merge failed first.

### Set aside

The reviewer set nine behaviours aside, and each was ruled to stand:
`.mcp.json`'s server left to each user's approval; em dashes in commit
messages unguarded, as before; agents other than Claude told where memory
is but not to read it first; herdr unpinned; single-sample wall times;
`bun` missing from a git GUI's `PATH`; the `.html` diagram in `specs/`;
`post-checkout` inside CI's own workflows; and the phase marked Done
before its merge, as the plan chose.

## Commits

### Design

```text
cd46f5c docs: Specify the agentic asset refactor
1888a31 docs: Revise the roadmap for model providers
cd6f10b docs: Keep remember out of the asset refactor
e0b41d5 docs: Specify the skills sync on install and in CI
bebcaba docs: Name notes and deferred files as they are
74d531f docs: Leave wiki links in memory to remark
f52756c docs: Migrate the README and worktree leftovers
0c6cffe docs: Land each asset check with its own step
385df56 docs: Name the asset refactor report and probes
be470c7 docs: Keep the skills lock out of formatting
66d45cd docs: Link herdr only when it is fetched
20e30c5 docs: Reflow the docs conventions paragraph
505f15c docs: Say lint:header only syncs headers
501315f docs: Ground AGENTS.md loading in the binary
fe11a74 docs: Declare agentic assets in the repository
```

### Plan

```text
4e8c31a docs: Plan the agentic asset refactor
1980cc6 docs: Mark the asset refactor planned
0e8ca2c docs: Declare the plan's plugins and memory path
```

### Tasks 1 to 8

```text
b9c8d62 docs: Begin the asset refactor report            (Task 1)
8d60424 ai: Declare the skills as dependencies           (Task 2)
f1ac776 ai: Guide agents through each package            (Task 3)
9aac691 ai: Move the guidance into AGENTS.md             (Task 4)
993a173 ai: Move agent memory under .agents              (Task 5)
013f0dd build: Reinstall when the dependencies change    (Task 6)
9f4d2f3 build: Check headers with sync-header-metadata   (Task 6)
6aa70bf chore: Drop the worktree leftovers               (Task 6)
2ba4351 ai: Trim Claude's settings to eight plugins      (Task 6)
2600278 docs: Move the asset refactor to Done            (Task 7)
afeff49 docs: Report the agentic asset refactor          (Task 8)
```

### Review fixes

```text
529db54 ai: Accept Claude Code's memory index form
13da2bd ai: Catch a CLAUDE.md that is a link
b39aca3 ai: Place compact() and the commands correctly
3094efc ai: Name agents.test.ts and the budgets
5312711 docs: Record the final review in the report
```

### The minors

```text
eb87627 build: Harden the agent memory script
feb5efb build: Fail an install leaving a skill unlinked
c4566bf ai: Read every link form in the guidance
ffafff7 build: Reinstall after a squash merge
5ed2fa2 ai: Fill the gaps in the memory and cli maps
dccce8f docs(agent): Update the settingSources comment
```

This report, the probes report's reshaping and the roadmap's link to it
follow.

## Verification

`bun run check` at the head of the branch:

```text
 1168 pass
 0 fail
 134152 expect() calls
Ran 1168 tests across 66 files.
```

`bun test agents.test.ts`: 49 pass, 0 fail. `bun run lint:header`:
verification passed, none out of sync. `bun run prepare`: exit 0, its
skills checks 16 pass.

## Known limitations

- **herdr is unpinned.** A remote source, it follows its upstream's
  default branch whenever `bun run skills` fetches it; a fresh checkout,
  CI's among them, has none until then.
- **The sync is experimental.** `skills experimental_sync` is pinned at
  1.7.2 and upgraded on purpose; `prepare` and `agents.test.ts` fail if
  its links stop matching the lock.
- **A remote switch.** Claude Code's `AGENTS.md` loading is the built-in
  `cc-plugin-agents-md`, behind the feature flag `tengu_agents_md_mod`.
  Were it turned off, sessions here would load no guidance; the fallback
  is a root `CLAUDE.md` importing `@AGENTS.md`.
- **The root is at its budget.** The root `AGENTS.md` is 100 of 100
  lines, so the next rule there means moving detail into the file where
  it is needed.
- **Losing `using-superpowers`.** Nothing now makes skill use the first
  thing in a session; the root's Process section names when each skill
  applies. Whether agents follow it, later sessions will show.
- **The skills' own text** still names `docs/superpowers/` and worktrees
  in places; the root's rules say they win.
- **Two probes are left.** The review suggested a session started inside
  a package, to explain why the root's and the package's prompts are so
  close, and a fresh session reading `.agents/memory/MEMORY.md`.
