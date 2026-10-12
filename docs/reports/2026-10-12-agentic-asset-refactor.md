---
ctime: 2026-10-12
mtime: 2026-10-12
spdx: GPL-3.0-only
title: Agentic asset refactor report
description: >-
  How the agent guidance, skills and memory moved into conventions every
  coding agent reads: the probes, the measurements, the rulings and what
  is left.
tags:
  - dorothy
  - agents
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-12-agentic-asset-refactor.md
   -
   -->

# Agentic asset refactor report

## Summary

The 15 KB `.claude/CLAUDE.md` is now a root `AGENTS.md` of 99 lines,
`docs/AGENTS.md` and one per package, which Claude Code loads natively,
the package's own only once a file there is read. Superpowers and herdr
are declared dependencies linked for every agent, agent memory lives in
`.agents/memory/` with `prepare` pointing Claude Code at it, and Claude's
settings keep eight plugins instead of fourteen, all declared in the
repository. A one-word session's prompt fell from 26,333 to 20,216 tokens
from the root (23%) and from 23,287 to 20,278 from `packages/tui/src`
(13%). `agents.test.ts` pins the layout in 35 tests.

## The probes

### Header verification

`bunx sync-header-metadata@2.4.2` in verify mode, on this branch before
any change but the spec's and plan's: 249 files parsed, 213 breadcrumbs
correct, none out of sync, 36 files without one (warnings only). Exit 0.

### The skills

`bun install` under the isolated linker installed superpowers from GitHub,
pinned in `bun.lock` to its tag's commit
(`+ superpowers@github:obra/superpowers#b92c4fa`), and `prepare`'s sync
found its skills in `node_modules`: "Found 11 skills in node_modules",
the four excluded never offered. Each landed as a link,
`.agents/skills/<name>` into `node_modules/superpowers/skills/<name>` and
`.claude/skills/<name>` into `.agents/skills/<name>`, and the lock records
eleven `node_modules` entries with superpowers' version, 6.4.1.

The first `bun run skills` skipped herdr: "installed with `skills add`
from herdrdev/herdr". The sync claims only the remote skills it installed
itself, marked by a `via` field, and the lock's herdr entry came from the
hand-made install of 2026-10-09. With that entry deleted, the sync
installed herdr and recorded it with `"via": "."`.

The remote's behaviour, captured in `sync.txt` with the CLI's spinner and
colour codes stripped and its em dashes made hyphens, as the repository
allows none:

- With herdr removed, `bun run skills --no-remote` synced the eleven and
  kept herdr's lock entry, and `bun test agents.test.ts` passed with
  herdr's test skipped (`1 skip`, `0 fail`), as in CI.
- `bun run skills` then cloned herdrdev/herdr and installed it
  ("Installed herdr from herdrdev/herdr").
- Run again with herdr present, it fetched nothing: the eleven synced,
  and no clone.

`prepare` with its sync replaced by `false` exits 1, so a failing sync
fails `bun install`; with husky's directory absent and the sync replaced
by `true` it exits 0, so a missing husky does not.

### How the guidance loads

Captured in `loading.txt`:

- From the root, asked without reading any file which commit type agent
  assets take, the model answered `` `ai` ``, which only the root
  `AGENTS.md` states: it is loaded at launch.
- Asked to read `packages/tui/src/state.ts`, the session's transcript
  holds one attachment naming `packages/tui/AGENTS.md`: a
  `hook_additional_context` from the hook `tool.call` on `PostToolUse`,
  whose content opens "Contents of .../packages/tui/AGENTS.md:", then the
  file from its heading. That is the built-in `cc-plugin-agents-md`
  attaching a package's file once a file beneath it is read, as Claude
  Code attaches a nested `CLAUDE.md`. The `stream-json` output names it
  nowhere, as attachments are not streamed.
- The attached text starts at the `#` heading: the frontmatter and the
  breadcrumb comment are stripped, so a file's header costs no tokens,
  though the budgets count its lines.

## Measurements

A one-word prompt (`claude -p --output-format json "hi"`), from the root
and from `packages/tui/src/`, with the user's settings as they are. Raw
fields are in `2026-10-12-agentic-asset-refactor/`.

Nearly the whole prompt is served from or written to the cache, so the
uncached `input_tokens` is 2 either way; the prompt's size is the Total,
input plus cache write plus cache read, and that is what the phase is
judged on.

| When   | From               | Input | Cache write | Cache read | Total | Wall (ms) |
| ------ | ------------------ | ----- | ----------- | ---------- | ----- | --------- |
| Before | root               | 2     | 17981       | 8350       | 26333 | 9500      |
| Before | `packages/tui/src` | 2     | 13464       | 9821       | 23287 | 5634      |
| After  | root               | 2     | 11864       | 8350       | 20216 | 7288      |
| After  | `packages/tui/src` | 2     | 10455       | 9821       | 20278 | 5607      |

- From the root, the prompt fell by 6,117 tokens (23%).
- From `packages/tui/src`, it fell by 3,009 tokens (13%).

The phase succeeded: the prompt fell from both directories. The cached
part read back (8,350 and 9,821) is the same before and after, so the
savings are all in what each session wrote anew: the 15 KB `CLAUDE.md`
became a 99-line root `AGENTS.md`, and six plugins came out with their
session-start hooks and instructions. Before, the root's prompt was
3,046 tokens larger than the package's; after, the two are within 62
tokens. One prompt per directory does not explain why.

Plugins enabled before and after: `plugins-before.txt` and
`plugins-after.txt`, listed from `/tmp`, so they show the user's own
plugin state (every plugin disabled outside a project that enables it).
They are identical, so the two measurements ran under the same user
settings. Codex: not installed.

## Rulings made during execution

The plan's rulings on the spec held:

1. `repo-memory` left with the memory (Task 5), not with the other
   plugins, as it rewrote `autoMemoryDirectory` at every session start.
2. The test pins superpowers' eleven skills by name.
3. The test pins memory's index.
4. The `CLAUDE.md` search walks the filesystem, so a gitignored
   `CLAUDE.local.md` is caught (planted in Task 4, it failed the test).
5. The `AGENTS.md` files carry the house header within their budgets,
   without the vim modeline.
6. `DO_NOT_TRACK=1` is asserted by the test.
7. The husky hooks were probed by hand: the same heads and a file
   checkout installed nothing, and a checkout against `main` ran
   `bun install`.

Made while executing:

- The prompt is judged on its Total, input plus cache write plus cache
  read, as `input_tokens` is 2 with caching.
- The stale herdr entry in the untracked `skills-lock.json` was deleted
  before the sync, which otherwise refused herdr as installed by
  `skills add`.
- The captured sync output is stripped of the CLI's spinner and colour
  codes, and its em dashes made hyphens, for `lint:emdash`.
- Captured JSON is formatted by Biome before commit.
- The three retired memories needed `git rm -f`, being staged as renames.
- `.worktreeinclude` was deleted with `rm` and staged for its own commit,
  so the deletion stayed out of the hooks' commit; the empty
  `.claude/worktrees/` went with it.

## Verification

`bun run check` on the final tree passes, ending:

```text
 1154 pass
 0 fail
 134125 expect() calls
Ran 1154 tests across 66 files.
```

`bun test agents.test.ts`: 35 pass, 0 fail. `bun run lint:header`:
verification passed, none out of sync.

## Commits

The spec and the plan:

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
4e8c31a docs: Plan the agentic asset refactor
1980cc6 docs: Mark the asset refactor planned
fe11a74 docs: Declare agentic assets in the repository
0e8ca2c docs: Declare the plan's plugins and memory path
```

The tasks:

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
```

This report's own commit follows.

## Known limitations

- **herdr is unpinned.** A remote source, it follows its upstream's
  default branch whenever `bun run skills` fetches it, and a fresh
  checkout has none until then; CI never has it.
- **The sync is experimental.** `skills experimental_sync` is pinned at
  1.7.2 and upgraded on purpose; `agents.test.ts` fails if its links stop
  matching the lock.
- **A remote switch.** Claude Code's `AGENTS.md` loading is the built-in
  `cc-plugin-agents-md`, available behind the feature flag
  `tengu_agents_md_mod`. Were it turned off, sessions here would load no
  guidance; the fallback is a root `CLAUDE.md` importing `@AGENTS.md`.
- **Losing `using-superpowers`.** Nothing now makes skill use the first
  thing in a session; the root's Process section names when each skill
  applies. Whether agents follow it is for later sessions to show.
- **The skills' own text** still names `docs/superpowers/` and worktrees
  in places; the root's rules say they win.
- **Codex** was not installed, so its loading and its numbers are
  unmeasured.
- **The measurement is one prompt per directory**, so a few hundred
  tokens either way are noise; the root's and the package's unequal
  totals before the change are not explained.
