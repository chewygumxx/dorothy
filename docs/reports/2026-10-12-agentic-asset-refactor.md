---
ctime: 2026-10-12
mtime: 2026-10-18
spdx: GPL-3.0-only
title: Agentic asset refactor probes
description: >-
  The probes the agentic asset refactor rests on, the skills sync, how
  Claude Code loads the guidance and the reworked prepare, and the
  session's prompt measured before and after.
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

# Agentic asset refactor probes

## Summary

These are the probes and measurements of the agentic asset refactor; how
it was built, its rulings, its reviews and its commits are in the
[implementation report](2026-10-13-agentic-asset-refactor-implementation.md).

- `sync-header-metadata` verified the repository's headers before any
  change.
- The `skills` CLI linked superpowers' eleven skills from `node_modules`
  and fetched herdr only when it was absent; a stale lock entry from the
  hand-made install had to go first.
- Claude Code loaded the root `AGENTS.md` at launch, and a package's own
  once a file beneath it was read, with the files' headers stripped.
- The reworked `prepare` fails an install that leaves a skill unlinked,
  and does nothing on an install without development dependencies.
- A one-word session's prompt fell from 26,333 to 20,216 tokens from the
  root (23%), and from 23,287 to 20,278 from `packages/tui/src` (13%).

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

`prepare` as first written, with its sync replaced by `false`, exits 1,
so a sync that fails outright fails `bun install`; with husky's directory
absent and the sync replaced by `true` it exits 0, so a missing husky
does not. The review then showed both guarantees fall short, as the next
section probes.

### The reworked prepare

`prepare` became `scripts/prepare.sh`. Each case ran against the old
`prepare` first, then the new:

| Case                                                                     | Before | After |
| ------------------------------------------------------------------------ | ------ | ----- |
| `.claude/skills/brainstorming` a link to a directory elsewhere           | 0      | 1     |
| A copy of `package.json` with no `node_modules`, as a production install | 127    | 0     |

- The sync skipped the linked skill ("Skipped brainstorming from
  superpowers: ... is a symlink to /tmp/elsewhere/brainstorming") and
  exited 0, so the old `prepare` passed with the skill unlinked. The new
  one runs the skills' own checks after the sync (16 tests, 25 filtered
  out) and failed on "links brainstorming for every agent".
- Without development dependencies, the old `prepare` failed on the
  missing `skills` command (127); the new one finds no husky and does
  nothing.
- A real directory put in place of `.agents/skills/brainstorming` is not
  such a case: the sync replaced it with the link, as the lock records the
  skill as its own.

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

## Known limitations

- **One prompt per directory.** A few hundred tokens either way are
  noise, and the root's and the package's unequal totals before the
  change are not explained.
- **Codex** was not installed, so its loading and its numbers are
  unmeasured.
- **Memory loading is not probed.** That a new session reads
  `.agents/memory/MEMORY.md` rests on `autoMemoryDirectory`, which the
  review found read from the local settings in Claude Code's binary.
