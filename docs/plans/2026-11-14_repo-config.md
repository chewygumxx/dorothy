---
ctime: 2026-11-14
mtime: 2026-11-14
spdx: GPL-3.0-only
title: Repository configuration of agent assets plan
description: >-
  Task by task, over two pull requests: Claude's settings dropped and fact
  sync following a moved memory directory; then memory in docs/memory,
  the own skills as @dorothy/skills, skills by package.json's array, and
  .agents and .claude ignored whole.

tags:
  - config
  - agents
  - plan

---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/plans/2026-11-14_repo-config.md
   -
   -->

# Repository configuration of agent assets plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> subagent-driven-development (recommended) or executing-plans to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every agent asset is declared in files the repository owns, and
`.agents/` and `.claude/` hold only what tools generate, ignored whole.

**Architecture:** skills come from `package.json`'s `skills` array (git
sources pinned to commits) and from a new workspace package,
`@dorothy/skills`, all linked by `skills experimental_sync` in `prepare`.
Memory moves to `docs/memory/`, after Dorothy's fact sync learns to follow
a moved directory instead of retiring every fact.

**Tech Stack:** Bun workspaces (isolated linker), `skills` 1.7.5's
`experimental_sync`, mise tasks, husky, `bun:test`.

**Spec:** [repository configuration of agent
assets](../specs/2026-11-14_repo-config.md).

## Global Constraints

- Two pull requests. PR 1 (Tasks 1 and 2) on `build/repo-config`; PR 2
  (Tasks 3 to 6) on `build/agent-assets`, branched from `origin/main`
  only after PR 1 merges and the user confirms the gate after Task 2.
- No checkout may lose `.agents/memory` before PR 1's sync change runs
  everywhere Dorothy syncs (the gate after Task 2).
- Tests and probes never touch `$XDG_DATA_HOME/dorothy`,
  `$XDG_CACHE_HOME/dorothy` or the user's Claude configuration.
- `prepare` never calls mise; git hooks stay as they are.
- Commit headers at most 50 characters, body lines at most 72;
  Conventional Commits, scopes the package names, `config`, `claude`,
  `api`; agent assets take the `ai` type. No em dash anywhere, no
  Markdown line over 80 characters.
- Every new file carries the house header, copied from a sibling;
  `mise run format:header` resyncs breadcrumbs after a move.
- Each sync runs with `DO_NOT_TRACK=1` and
  `--agent claude-code codex`.
- Pinned commits (full SHAs, resolved 2026-11-14):
  - `obra/superpowers`: `2ce8aa15d05bd57213e6f746f953aafb7ded7a8b`
  - `chewygumxx/agent-library`: `aea953d507ad5eee40f00c10347c1a0ae296c245`
  - `chewygumxx/claude-library`: `69327fc0c7fd3bc27f53a7c322556b2f4ea73b73`
  - `addyosmani/agent-skills`: `301b02b12bff98e4688e6984af6556802322bbde`
  - `vercel-labs/skills`: `b716f9dc2ba36b6aa8f0080615e5a3a6caeac63b`
  - `ayghri/i-have-adhd`: `1ecea1993b7fce257ffbd686c070948b5e07eda6`

## Review Focus

1. A checkout holding both `docs/memory` and a stray `.agents/memory`
   (an old Claude session recreating it): sync keeps the recorded
   directory. Pinned in Task 2.

2. A checkout on an older branch, still on `.agents/memory`, synced in
   turn with one on `docs/memory`: no fact retired, new facts cross.
   Pinned in Task 2.

3. A stewardship script run through `.agents/skills`, `.claude/skills` or
   its real path finds the same checkout. Pinned in Task 4.

4. An install without network: `prepare` succeeds and the own skills are
   linked. Verified in Task 5.

5. An own skill edited without re-syncing: `lint:skills` fails at commit,
   not in CI. Verified in Task 5.

---

## PR 1: on `build/repo-config`

### Task 1: Claude's settings leave the repository

The user removed `.claude/settings.json` (staged); attribution, plugins
and the status line are each user's own.

**Files:**

- Delete: `.claude/settings.json` (already staged)
- Modify: `agents.test.ts` (the `PLUGINS` constant and
  `describe("Claude's settings")`)
- Modify: `.agents/skills/agent-stewardship/references/claude-code.md`
  (Budget and context)
- Modify: `AGENTS.md` (Working rules, the rule on declaring assets)
- Modify: `docs/wiki/topics/repository-workflow.md` (Agent assets),
  `docs/wiki/decisions.md` (new entry)
- Add: `docs/specs/2026-11-14_repo-config.md`, this plan,
  `docs/wiki/records.md` (both catalogued)

- [ ] **Step 1: See the failure**

Run `bun test agents.test.ts -t "Claude's settings"`. Expected: FAIL,
`ENOENT` reading `.claude/settings.json`.

- [ ] **Step 2: Remove the settings test**

Delete the `PLUGINS` constant and the
`describe("Claude's settings")` block.

- [ ] **Step 3: Reword the reference**

In `claude-code.md`, say that the
user's own Claude Code `statusLine` setting must run
`sh <checkout>/scripts/statusline.sh` for a reading to exist, and that
without one `with-claude.sh` tries the primary account, as it does on
any missing reading.

- [ ] **Step 4: Amend the rule**

The root `AGENTS.md`'s "Declare in this
repository every agentic asset" gains: a harness's own settings are the
user's. Mirror it in repository-workflow's Agent assets, and add a
decisions entry, "A harness's settings are the user's", in the file's
existing entry form (context, choice, alternatives, cost, standing).

- [ ] **Step 5: Verify**

`mise run check`. Expected: exit 0.

- [ ] **Step 6: Commit**

In two:

```bash
git add agents.test.ts AGENTS.md docs/wiki/decisions.md \
    docs/wiki/topics/repository-workflow.md \
    .agents/skills/agent-stewardship/references/claude-code.md
git commit -m "chore(claude): Drop the project settings"
git add docs/specs/2026-11-14_repo-config.md \
    docs/plans/2026-11-14_repo-config.md docs/wiki/records.md
git commit -m "docs: Specify and plan agent asset config"
```

### Task 2: Fact sync follows a moved memory directory

**Files:**

- Modify: `packages/memory/src/projects/registry.ts:193-202`
- Modify: `packages/memory/src/projects/sync.ts:355`
- Test: `packages/memory/src/projects/registry.test.ts`,
  `packages/memory/src/projects/sync.test.ts`
- Modify: `packages/memory/src/projects/AGENTS.md`, `README.md:340`,
  and `docs/wiki/topics/memory.md` where it says where project facts sync

**Interfaces:**

- Produces, in `registry.ts`:
  - `export const MEMORY_DIRS = ["docs/memory", ".agents/memory",
    ".claude/memory"] as const;`
  - `chooseMemoryDir(root: string): Promise<string>`: the first of
    `MEMORY_DIRS` that is a directory under `root`, `docs/memory` only
    when it holds `MEMORY.md`, else `".agents/memory"`.
  - `resolveMemoryDir(root: string, entry: ProjectEntry | undefined):
    Promise<string>`: `chooseMemoryDir(root)` when `entry` is
    undefined. Else `recorded` is the root's own `synced[root].last`,
    falling back to `entry.memoryDir`, and the facts are the names in
    the root's record for `recorded` whose hash is not `removed:`.
    With facts, of `recorded` and each of `MEMORY_DIRS` present (as
    `chooseMemoryDir` counts them), the one holding the most of those
    facts' files, a file counting as its fact by `nameOfStem`; ties go
    to `recorded`, then by `MEMORY_DIRS`. With none, `recorded` when
    it is a directory under `root`; else the first of `MEMORY_DIRS`
    present; else `recorded`.
- `sync.ts:355` passes the project's registry entry:
  `const memoryDir = await resolveMemoryDir(project.root, known);`.

- [ ] **Step 1: Write the failing registry tests**

Replace
"takes .agents/memory, else .claude/memory, else .agents/memory" with
"takes docs/memory, else .agents/memory, else .claude/memory, else
.agents/memory": empty root gives `.agents/memory`; after
`.claude/memory`, `.claude/memory`; after `.agents/memory`,
`.agents/memory`; after `docs/memory`, `docs/memory`. Add
`describe("resolveMemoryDir")`:

- "chooses when nothing is recorded": `(root, undefined)` equals
  `chooseMemoryDir(root)`.
- "keeps the recorded directory while present, though another is too":
  both `docs/memory` and `.agents/memory` exist; recorded
  `.agents/memory` gives `.agents/memory`.
- "follows the memory when the recorded directory is gone": only
  `docs/memory` exists; recorded `.agents/memory` gives `docs/memory`.
- "keeps a recorded directory gone with no other present": nothing
  exists; recorded `docs/memory` gives `docs/memory`.
- [ ] **Step 2: Write the failing sync tests**

In `syncProject`'s
describe. Give the file's `sync()` helper an optional checkout path,
defaulting to `repo`; a second checkout is `join(base, "other")` with
the same `.git/config` origin as `repo`.

- "follows the memory to docs/memory, retiring nothing": `putRepo` a
  and b; `sync()`; `mkdir(repo/docs)`; `rename` `repo/.agents/memory`
  to `repo/docs/memory`; `moved(await sync())` equals `NOTHING`; every
  fact's `retired` is null; the registry's `projects[ID].memoryDir` is
  `"docs/memory"`; `readdir(repo/docs/memory)` is
  `["MEMORY.md", "a.md", "b.md"]`.
- "keeps checkouts on either directory in step, retiring nothing":
  after the move above, `other/.agents/memory` exists empty;
  `sync(other)` exports a and b; a fact c written to
  `other/.agents/memory` is imported by `sync(other)` and exported by
  `sync()` to `docs/memory`; a fact d written to `repo/docs/memory` is
  imported by `sync()` and exported by `sync(other)`; no report ever
  lists a retirement; both directories end holding a, b, c, d.
- Rename "retires every fact when the directory last synced is gone"
  to "switches to a present directory when the one last synced is
  gone": same set-up; after removing `docs/memory`, `moved(await
  sync())` equals `NOTHING` and no fact is retired.
- Add "retires every fact when the directory last synced is gone and
  no other is present": as above, removing `.agents/memory` too;
  `moved(await sync())` equals `{ ...NOTHING, retired: ["a", "b"] }`.
- [ ] **Step 3: Run them**

`bun test packages/memory/src/projects`.
Expected: the new tests FAIL (`resolveMemoryDir` not exported; the
move retires a and b).

- [ ] **Step 4: Implement**

Add `MEMORY_DIRS`, `chooseMemoryDir` and
`resolveMemoryDir` with the file's `isDirectory`, and the one line in
`sync.ts`.

- [ ] **Step 5: Run them**

Same command. Expected: PASS, the existing
"retires every fact when the memory directory it synced is gone"
included.

- [ ] **Step 6: Document**

`projects/AGENTS.md`: the directory line
names `MEMORY_DIRS` and the rule; Invariants gain "A memory directory
is switched to only when present: deleting the one directory retires
every fact, moving it retires none." `README.md:340`: a project's facts
sync with its repository's `docs/memory/`, `.agents/memory/` or
`.claude/memory/`, whichever it holds. Bump each page's `mtime`.

- [ ] **Step 7: Verify**

`mise run check`. Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/memory README.md docs/wiki/topics/memory.md
git commit -m "feat(memory): Follow a moved memory directory"
```

- [ ] **Step 9: Ship PR 1**

Push, open the pull request, merge once CI
passes.

- [ ] **Step 10: Gate**

Ask the user to quit any Claude session in a
checkout before pulling, to update the main checkout to the merge, to
restart any running `dorothy --serve`, and, after updating, to check
every checkout for a surviving `.agents/memory`
(`git status --ignored`); wait for their confirmation. Only then does
Task 3 begin.

---

## PR 2: on `build/agent-assets`

Branch: `git switch -c build/agent-assets origin/main` after
`git fetch`, in this worktree.

### Task 3: Memory moves to `docs/memory`

**Files:**

- Move: `.agents/memory/` to `docs/memory/`, its
  `.markdownlint-cli2.jsonc` included
- Modify: `scripts/agent-memory.ts` (`withMemoryDirectory`, comments)
- Modify: `agents.test.ts` (`MEMORY`, the "agent memory" and
  "agent memory preparation" describes)
- Modify: `header.test.ts:59`, `scripts/prepare.md` step 4 prose,
  `docs/AGENTS.md`, `.config/AGENTS.md`, `AGENTS.md` (Commands, Memory)
- Modify: every relative link to `.agents/memory/`, records included

- [ ] **Step 1: Write the failing tests**

In `agents.test.ts`:
`MEMORY = at("docs/memory")`; rename "lives in .agents/memory, not
.claude/memory" to "lives in docs/memory, not .agents/memory or
.claude/memory", asserting `docs/memory/MEMORY.md` exists and neither
other directory does; every expected `autoMemoryDirectory` becomes
`join(<root>, "docs", "memory")` (lines 383, 416, 479, 539-541, 558).

- [ ] **Step 2: Run them**

`bun test agents.test.ts -t memory`.
Expected: FAIL.

- [ ] **Step 3: Move and repoint**

`mkdir -p docs && git mv .agents/memory docs/memory`;
`withMemoryDirectory` joins `root, "docs", "memory"`;
`mise run format:header`; `header.test.ts` exempts
`docs/memory/MEMORY.md`.

- [ ] **Step 4: Run them**

Same command. Expected: PASS.

- [ ] **Step 5: Fix links and guidance**

`git grep -n '\.agents/memory'`
and repoint each relative link and mention outside dated specs' and
plans' prose (whose paths stay historical unless a link breaks).
`docs/AGENTS.md`'s table gains `memory/`: agent memory, in Claude
Code's format, named by fact, undated, not records. `.config/AGENTS.md`
names `docs/memory/` for the markdownlint override. `AGENTS.md`'s
Memory section and `bun install` line say `docs/memory`.

- [ ] **Step 6: Repoint this checkout**

`bun scripts/agent-memory.ts`,
then `jq -r .autoMemoryDirectory .claude/settings.local.json`.
Expected: ends `/docs/memory`.

- [ ] **Step 7: Verify**

`mise run check`. Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add -A docs .agents agents.test.ts header.test.ts scripts \
    AGENTS.md .config/AGENTS.md README.md
git commit -m "ai: Move agent memory to docs/memory"
```

### Task 4: The own skills become `@dorothy/skills`

**Files:**

- Move: `.agents/skills/{agent-pre-screening,agent-stewardship,`
  `development-evidence,worktrees}` to `packages/skills/skills/`
- Create: `packages/skills/package.json`, `packages/skills/AGENTS.md`,
  `packages/skills/src/index.ts`, `packages/skills/src/index.test.ts`
- Modify: `package.json` (devDependencies), `packages/cli/package.json`,
  `packages/cli/src/hosts/pi/steward/engine.ts:55-76`, `engine.test.ts`
  (lines 282-285, 1130-1133)
- Modify: `packages/skills/skills/agent-stewardship/scripts/with-claude.sh:39`
- Modify: `scripts/agent-stewardship.test.ts` (`scripts`, and "finds one
  checkout through the .claude/skills link")
- Modify: `agents.test.ts` (the own skills tests, the evidence skill's
  path), `workspace.test.ts`, `.gitignore`, `skills-lock.json`
- Modify: `.commitlintrc.mts` (a `skills` scope, beside the other
  packages'), `AGENTS.md` (Packages), `docs/wiki/profiles/packages.md`,
  and every relative link into the moved skills, records included

**Interfaces:**

- Produces, in `@dorothy/skills` (`"."` is `./src/index.ts`):
  - `export const sendPrompt: string`: absolute path of
    `skills/agent-stewardship/scripts/send-prompt.sh`, from
    `import.meta.dir`.
  - `export const sendInterrupt: string`: likewise `send-interrupt.sh`.
- `engine.ts`: `SENDER = sendPrompt`, `INTERRUPTER = sendInterrupt`,
  imported from `@dorothy/skills`.

- [ ] **Step 1: Write the failing tests**

- `workspace.test.ts`: `GRAPH.skills = []`, `GRAPH.cli` gains
  `"skills"`, `ENTRIES.skills = ["."]`.
- `packages/skills/src/index.test.ts`: "names the stewardship scripts
  it ships": each path ends
  `/packages/skills/skills/agent-stewardship/scripts/<name>.sh` and is
  an executable file.
- `engine.test.ts`: `SENDER` and `INTERRUPTER` end with
  `/packages/skills/skills/agent-stewardship/scripts/send-prompt.sh`
  and `.../send-interrupt.sh`.
- `agents.test.ts`: replace "commits its own skills, linked for every
  agent" with "ships its own skills in @dorothy/skills, linked for
  every agent": for each `OWN` name,
  `packages/skills/skills/<name>/SKILL.md` names it;
  `readlinkSync(.agents/skills/<name>)` contains
  `node_modules/@dorothy/skills/skills/`; `.claude/skills/<name>`
  resolves to the package's directory; the lock's entry has
  `source: "@dorothy/skills"` and `sourceType: "node_modules"`. In the
  per-entry loop, a package skill's link (not its realpath) contains
  `node_modules/`. The evidence skill's `path` moves to the package,
  and its expected link to the wiki gains one `../` per new level.
- `scripts/agent-stewardship.test.ts`: `scripts` points into
  `packages/skills/skills/agent-stewardship/scripts`; the checkout test
  builds `packages/skills/skills/agent-stewardship/scripts/`,
  `node_modules/@dorothy/skills -> ../../packages/skills`,
  `.agents/skills/agent-stewardship ->
  ../../node_modules/@dorothy/skills/skills/agent-stewardship` and
  `.claude/skills/agent-stewardship ->
  ../../.agents/skills/agent-stewardship`, and runs `with-claude.sh`
  through each of the three paths, expecting the checkout's
  `secrets.json` each time.
- [ ] **Step 2: Run them**

`bun test workspace.test.ts agents.test.ts
scripts/agent-stewardship.test.ts packages/cli/src/hosts/pi/steward`.
Expected: FAIL.

- [ ] **Step 3: Build the package**

`git mv` the four directories;
write the manifest (`@dorothy/skills`, private, ESM,
`exports: { ".": "./src/index.ts" }`, no dependencies), `index.ts` and
`AGENTS.md` (what it holds; agents reach the skills only through sync;
`cli` reaches the scripts through the exports). `with-claude.sh:39`
climbs five levels (`/../../../../..`). Declare
`"@dorothy/skills": "workspace:*"` in the root's devDependencies and
`cli`'s dependencies; repoint `engine.ts`. Add the `skills` scope to
`.commitlintrc.mts` ("The repository's own agent skills, ie.
packages/skills/"). `mise run format:header`.
Fix each relative link inside the moved skills (one more `../../` each).

- [ ] **Step 4: Relink**

In `.gitignore`, the skills block becomes
`/.agents/skills/` and `/.claude/skills/`; `git rm --cached` the four
`.claude/skills/*` links; `rm -rf .agents/skills .claude/skills`;
`bun install`. Expected: `prepare` links all four through
`node_modules` and `skills-lock.json` gains their `node_modules`
entries.

- [ ] **Step 5: Run them**

Same command as Step 2. Expected: PASS.

- [ ] **Step 6: Document**

`AGENTS.md`: nine packages, `skills`
holding the repository's own skills and depending on nothing, `cli` on
all but `eval`; the Process section's skills line names
`packages/skills/`. The packages profile gains `skills`. Repoint every
link into the moved skills (`git grep -n '\.agents/skills/'`).

- [ ] **Step 7: Verify**

`mise run check`. Expected: exit 0.

- [ ] **Step 8: Commit**

In two: the package with its moves and tests
(`feat(skills): Ship the own skills as a package`), then `cli`'s
wiring (`refactor(cli): Reach stewardship via the package`), each
under 50 characters.

### Task 5: Skills by `package.json`'s array

**Files:**

- Modify: `package.json` (`skills`, devDependencies, scripts)
- Modify: `scripts/prepare.sh`, `scripts/prepare.md` (step 2)
- Modify: `.config/mise/tasks/bun.task.toml` (drop `[skills]`),
  `other.task.toml` (add `[skills]`), `lint.task.toml` (add
  `lint:skills`, and to `lint`'s depends)
- Modify: `skills-lock.json`, `agents.test.ts` ("the skills")
- Delete: `.worktreeinclude`

The array, exactly:

```json
"skills": [
    {
        "source": "obra/superpowers",
        "ref": "2ce8aa15d05bd57213e6f746f953aafb7ded7a8b",
        "skills": [
            "brainstorming", "dispatching-parallel-agents",
            "executing-plans", "finishing-a-development-branch",
            "receiving-code-review", "requesting-code-review",
            "subagent-driven-development", "systematic-debugging",
            "test-driven-development", "verification-before-completion",
            "writing-plans"
        ]
    },
    { "source": "chewygumxx/agent-library",
      "ref": "aea953d507ad5eee40f00c10347c1a0ae296c245",
      "skills": ["configuring-mise-tasks"] },
    { "source": "chewygumxx/claude-library",
      "ref": "69327fc0c7fd3bc27f53a7c322556b2f4ea73b73",
      "skills": ["compact-summary"] },
    { "source": "addyosmani/agent-skills",
      "ref": "301b02b12bff98e4688e6984af6556802322bbde",
      "skills": ["code-simplification"] },
    { "source": "vercel-labs/skills",
      "ref": "b716f9dc2ba36b6aa8f0080615e5a3a6caeac63b",
      "skills": ["find-skills"] },
    { "source": "ayghri/i-have-adhd",
      "ref": "1ecea1993b7fce257ffbd686c070948b5e07eda6",
      "skills": ["i-have-adhd"] }
]
```

The sync command, in `prepare.sh` and the `skills` task alike:

```sh
DO_NOT_TRACK=1 skills experimental_sync -y \
    --agent claude-code codex ${CI:+--no-remote}
```

- [ ] **Step 1: Write the failing tests**

Rewrite "the skills" in
`agents.test.ts`, reading the array from `package.json`:

- "pins every source to a full commit": each entry's `ref` matches
  `/^[0-9a-f]{40}$/` and its `skills` is non-empty.
- "takes superpowers' skills less the four": the `obra/superpowers`
  entry's skills equal `SKILLS`; no entry names one of `EXCLUDED`;
  neither link directory holds one.
- "records exactly the declared skills and its own": the lock's keys,
  sorted, equal every array skill plus `OWN`, sorted.
- "records each declared skill at its commit": each array skill's lock
  entry has the declaring entry's `ref`.
- "syncs without reporting to skills.sh": `prepare.sh`'s sync line and
  the `skills` task's run start with `DO_NOT_TRACK=1` and a space.
- "declares superpowers nowhere as a package": the root's
  devDependencies lack `superpowers` and `scripts` lacks `skills`.
- Keep the per-entry link loop (an absent remote skill skipped) and
  "links nothing the lock does not record"; drop `skillsScript`.
- [ ] **Step 2: Run them**

`bun test agents.test.ts -t "the skills"`.
Expected: FAIL.

- [ ] **Step 3: Declare**

Add the array; remove `superpowers` from
devDependencies and `skills` from scripts; `prepare.sh` runs the sync
command above in place of `bun run skills --no-remote`, and
`prepare.md` step 2 names it, saying a failed fetch warns and re-runs
the sync with `--no-remote`, leaving the install to succeed, and CI
fetches nothing. The `skills` task (in
`other.task.toml`, description "Link every declared skill") runs the
sync command, then
`bun test --bail agents.test.ts --test-name-pattern 'the skills'`.
`lint:skills` (description "Check skills-lock.json against the
skills") runs the sync with
`--no-remote --frozen-lockfile --dry-run` in place of
`${CI:+--no-remote}`, through `bunx --bun --no-install skills`, sources
`packages/skills/skills/**`, `skills-lock.json`, `package.json`.
Delete `.worktreeinclude`.

- [ ] **Step 4: Regenerate the lock**

Remove every non-`@dorothy/skills`
entry from `skills-lock.json`; `rm -rf .agents/skills .claude/skills`;
`bun install`. Expected: twenty skills linked, the lock recording 16
from git sources with their refs and four from `@dorothy/skills`. If
`compact-summary` is missing, give its entry the subpath
(`chewygumxx/claude-library/plugins/compact`) and re-run.

- [ ] **Step 5: Run them**

Same command as Step 2. Expected: PASS.

- [ ] **Step 6: Verify the edges**

- CI: `CI=1 bun install --frozen-lockfile`. Expected: exit 0.
- Offline (Review Focus 4): `rm -rf .agents/skills`, then
  `HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9
  bun run prepare`. Expected: exit 0, prepare's warning on stderr, the
  four own skills linked.
  Then `bun install` to restore.
- Stale lock (Review Focus 5): append a blank line to
  `packages/skills/skills/worktrees/SKILL.md`; `mise run lint:skills`.
  Expected: exit 1, "worktrees has changed since skills-lock.json was
  written". Revert; expected: exit 0.
- [ ] **Step 7: Verify**

`mise run check`. Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock skills-lock.json scripts .config/mise \
    agents.test.ts .worktreeinclude
git commit -m "build(config): Declare skills in package.json"
```

### Task 6: `.agents` and `.claude` ignored whole

**Files:**

- Modify: `.gitignore`, `agents.test.ts`
- Modify: `AGENTS.md` (Commands: `mise run skills` relinks;
  `bun install` links every skill), `docs/wiki/decisions.md`,
  `docs/wiki/topics/repository-workflow.md` (Agent assets),
  `docs/wiki/topics/build-configuration.md` (two layers' list of
  scripts; Worktrees), `docs/wiki/profiles/protocols.md:191`,
  `docs/roadmap.md`

- [ ] **Step 1: Write the failing test**

`agents.test.ts`, "tracks
nothing under .agents or .claude": `git ls-files .agents .claude` is
empty and `git check-ignore -q .agents/x .claude/x` exits 0.

- [ ] **Step 2: Run it**

Expected: FAIL on `check-ignore`.

- [ ] **Step 3: Ignore**

The skills block and `/.claude/worktrees/`
become `/.agents/` and `/.claude/`.

- [ ] **Step 4: Run it**

Expected: PASS.

- [ ] **Step 5: Record**

A decisions entry "Agent assets are declared
outside .agents and .claude" (context, choice, alternatives B and C,
cost: a ninth package, a download on install, the experimental sync);
rewrite repository-workflow's Agent assets for the array, the package
and `docs/memory`; build-configuration drops `skills` from Bun's
layer and `.worktreeinclude`; protocols' line follows; the roadmap's
Done gains this work with its spec and plan, and its remaining-limits
line drops `skills-lock.json` and `.worktreeinclude`. Bump each
`mtime`.

- [ ] **Step 6: Verify**

`mise run check`, then `git status --short`.
Expected: exit 0; nothing under `.agents/` or `.claude/` listed.

- [ ] **Step 7: Commit**

In two: `build(config): Ignore .agents and
.claude whole`, then `docs: Record the agent asset configuration`.

- [ ] **Step 8: Ship PR 2**

Push, open the pull request, merge once CI
passes. Tell the user that each existing checkout, the main one and every
worktree, needs a one-time reset to link the skills and repoint memory:

```sh
rm -rf .agents/skills .claude/skills && bun install
```

Fresh clones and new worktrees need `bun install` alone. Claude sessions
started before it still write to the old directory.
