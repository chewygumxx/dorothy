---
ctime: 2026-10-12
mtime: 2026-10-12
spdx: GPL-3.0-only
title: Agentic asset refactor plan
description: >-
  Implementation plan for moving the agent guidance into AGENTS.md files,
  declaring the skills as dependencies, moving agent memory under .agents/
  and reducing Claude's settings, with the checks that pin them.
tags:
  - dorothy
  - agents
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-12-agentic-asset-refactor.md
   -
   -->

# Agentic Asset Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every coding agent reads this repository's guidance from
`AGENTS.md` files, its skills from declared dependencies and its memory
from `.agents/`, and a session in it costs fewer input tokens than today.

**Architecture:** The 15 KB `.claude/CLAUDE.md` splits into a root
`AGENTS.md`, `docs/AGENTS.md` and one per package, which Claude Code and
Codex read natively. Superpowers and herdr become dependencies that the
`skills` CLI links into `.agents/skills/` and `.claude/skills/` on
install. Agent memory moves to `.agents/memory/`, and `prepare` points
Claude Code at it. Claude's settings keep only plugins with no neutral
form, declared rather than left to a user's settings; husky and
`sync-header-metadata` take over what the others did. One root test,
`agents.test.ts`, grows a section per task and pins the result.

**Tech Stack:** Bun 1.4 (`bun test`, isolated linker, lifecycle scripts),
the `skills` CLI 1.7.2 (`experimental_sync`), superpowers 6.4.1, husky 9,
Biome 2.5, remark, `sync-header-metadata` 2.4.2, Claude Code 2.1.296.

**Spec:** `docs/specs/2026-10-11-agentic-asset-refactor-design.md`.

## Global Constraints

- Plain branch `feat/agentic-asset-refactor` in the main checkout; no
  worktrees. Never push or open a pull request without asking the user.
- Every commit passes `bun run check`. Commits are Conventional: header at
  most 50 characters, body lines at most 72, no em dashes, no agent
  trailers. Agent assets take the `ai` type, tooling `build` or `chore`,
  documents `docs`; no commit here needs a scope.
- Markdown lines at most 80 characters; links are Markdown links, never
  `[[...]]`. No em dashes anywhere (`bun run lint:emdash`).
- Every new file carries the house header, copied from a sibling. The
  `AGENTS.md` files carry frontmatter and breadcrumb, and no vim modeline.
- Budgets, header included: the root `AGENTS.md` at most 100 lines,
  `docs/AGENTS.md` at most 60, every `AGENTS.md` under `packages/` at most
  150.
- `AGENTS.md` files name no client, tool, plugin or personal skill, except
  `.claude/` where a rule is about it. They state the code as it is.
- Exact versions: `"skills": "1.7.2"`,
  `"superpowers": "github:obra/superpowers#v6.4.1"`,
  `"sync-header-metadata": "2.4.2"`.
- Excluded skills, exactly: `using-git-worktrees`, `using-superpowers`,
  `diagnosing-superpowers`, `writing-skills`.
- `.claude/settings.json`'s `enabledPlugins`, exactly:
  `superpowers@claude-plugins-official: false`, and `true` for
  `typescript-lsp`, `agent-sdk-dev`, `claude-code-setup`,
  `claude-md-management`, `code-simplifier`, `explanatory-output-style`
  (all `@claude-plugins-official`) and `repo-metadata@chewygumxx`.
- `agents.test.ts` reads only the repository; it touches neither user
  data nor the network.
- The agentic assets and utilities the repository employs are declared
  in it; nothing relies on a user's own settings or a hand-made step. The
  user's settings are never changed. The one file outside the tracked
  tree this plan writes is the gitignored `.claude/settings.local.json`,
  and only through `scripts/agent-memory.ts` (Task 5).
- Do not save agent memories while executing this plan: the session's
  memory directory is fixed when it starts, and a write would recreate
  `.claude/memory/` after Task 5 moves it.

## Review Focus

1. A fresh checkout, as in CI, has superpowers linked but no herdr: the
   test must skip herdr there, not fail. Task 2 Step 8 removes herdr and
   runs the test.
2. A failing sync must fail `bun install`, while a missing husky must not.
   Task 2 Step 9 runs `prepare` with the sync swapped for `false`.
3. A `CLAUDE.local.md` is gitignored (`*.local.*`) yet still switches
   Claude Code's `AGENTS.md` off, so the search must see ignored files.
   Task 4 Step 6 plants one and watches the test fail.
4. A broken relative link in an `AGENTS.md` fails the test by name, and an
   external link or a `#fragment` does not. Task 3 Step 6 plants both.
5. A file checkout (`git checkout -- <path>`, flag `0`) or a checkout that
   leaves `package.json` and `bun.lock` alone must not reinstall. Task 6
   Step 4 invokes `post-checkout` with each.

## File Structure

| File | Task | Responsibility |
| --- | --- | --- |
| `docs/reports/2026-10-12-agentic-asset-refactor.md` (+ dir) | 1, 2, 8 | Probes, measurements, rulings, verification |
| `agents.test.ts` | 2 to 6 | Pins the layout, budgets, links, skills, memory, plugins |
| `tsconfig.json` | 2, 5 | Includes `agents.test.ts` and `scripts/**/*.ts` |
| `package.json`, `bun.lock` | 2, 6 | The skills, the sync, `prepare`, `lint:header` |
| `skills-lock.json` | 2 | The skills CLI's lock, committed |
| `.biome.json` | 2 | Leaves `skills-lock.json` out of formatting |
| `.gitignore` | 2, 6 | Ignores the links; drops `/.claude/worktrees/` |
| `packages/*/AGENTS.md` | 3 | Each package's guidance |
| `AGENTS.md`, `docs/AGENTS.md` | 4 | The root's and the docs' guidance |
| `.claude/CLAUDE.md` | 4 | Deleted |
| `README.md` | 4 | Points at `AGENTS.md` |
| `.agents/memory/` | 5 | Agent memory, moved from `.claude/memory/` |
| `.claude/settings.json` | 5, 6 | Eight plugin entries |
| `scripts/agent-memory.ts` | 5 | Writes `autoMemoryDirectory` on install |
| `.husky/post-checkout`, `.husky/post-merge` | 6 | Reinstall on dependency changes |
| `.worktreeinclude` | 6 | Deleted |
| `docs/roadmap.md` | 7 | Revising step, phase to Done |

---

### Task 1: The baseline

**Files:**

- Create: `docs/reports/2026-10-12-agentic-asset-refactor.md`
- Create: `docs/reports/2026-10-12-agentic-asset-refactor/` (captured
  output)

**Interfaces:**

- Produces: the report's sections (`## Summary`, `## The probes`,
  `## Measurements`, `## Rulings made during execution`,
  `## Verification`, `## Commits`, `## Known limitations`), which Tasks 2
  and 8 fill; `before-*.json` and `plugins-before.txt` in its directory.

- [ ] **Step 1: Record the enabled plugins**

```sh
R=docs/reports/2026-10-12-agentic-asset-refactor
mkdir -p "$R"
(cd /tmp && claude plugin list) |
    awk '/❯/{n=$2} /Scope:/{s=$2} /Status/{print n, s, $NF}' |
    sort -u >"$R/plugins-before.txt"
cat "$R/plugins-before.txt"
```

Expected: one line per plugin, scope and state. The user's own plugins
are left as they are; the listing records them so Task 8 can show the
two measurements ran under the same settings.

- [ ] **Step 2: Measure from the root and from a package**

```sh
R=docs/reports/2026-10-12-agentic-asset-refactor
measure() {
    start=$(date +%s%N)
    (cd "$1" && claude -p --output-format json "hi") >/tmp/measure.json
    end=$(date +%s%N)
    jq --arg wall "$(((end - start) / 1000000))" \
        '{wall_ms: ($wall | tonumber), duration_ms, num_turns, usage}' \
        /tmp/measure.json >"$2"
    cat "$2"
}
measure . "$R/before-root.json"
measure packages/tui/src "$R/before-tui.json"
command -v codex || echo "codex: not installed"
```

Expected: each file holds `usage.input_tokens`,
`usage.cache_creation_input_tokens` and `usage.cache_read_input_tokens`,
and `num_turns` is 1. If `num_turns` is above 1, note it: the usage then
spans more than the first request.

- [ ] **Step 3: Begin the report**

Write `docs/reports/2026-10-12-agentic-asset-refactor.md`:

```markdown
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

Written last.

## The probes

### Header verification

`bunx sync-header-metadata@2.4.2` in verify mode, on `main`'s tree before
any change: 249 files parsed, 213 breadcrumbs correct, none out of sync,
36 files without one (warnings only). Exit 0.

## Measurements

A one-word prompt (`claude -p --output-format json "hi"`), from the root
and from `packages/tui/src/`, with the user's settings as they are. Raw
fields are in `2026-10-12-agentic-asset-refactor/`.

| When | From | Input | Cache write | Cache read | Wall (ms) |
| --- | --- | --- | --- | --- | --- |
| Before | root | | | | |
| Before | `packages/tui/src` | | | | |

Plugins enabled before: `plugins-before.txt`. Codex: not installed.

## Rulings made during execution

## Verification

## Commits

## Known limitations
```

Fill the two Before rows from `before-root.json` and `before-tui.json`
(`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`,
`wall_ms`). If Step 2 found Codex, replace "Codex: not installed" with its
numbers, measured with `codex exec "hi"` from the same two directories.

- [ ] **Step 4: Lint and commit**

```sh
bunx --bun --no-install remark --frail --quiet --no-stdout \
    docs/reports/2026-10-12-agentic-asset-refactor.md
git add docs/reports/2026-10-12-agentic-asset-refactor.md \
    docs/reports/2026-10-12-agentic-asset-refactor
git commit -m "docs: Begin the asset refactor report"
```

---

### Task 2: The skills

**Files:**

- Create: `agents.test.ts`
- Modify: `tsconfig.json` (`include`), `package.json`, `bun.lock`,
  `.biome.json`, `.gitignore`
- Commit: `skills-lock.json` (today untracked)
- Modify: `docs/reports/2026-10-12-agentic-asset-refactor.md`

**Interfaces:**

- Produces: `agents.test.ts` with its header, the helpers `ROOT`, `at`,
  `read`, and `describe("the skills")`; Tasks 3 to 6 add sections to it.
- Produces: the scripts `skills` and `prepare` in `package.json`.

- [ ] **Step 1: Ignore the links, and clear the hand-made install**

Look first: `ls -la .agents .agents/skills .claude/skills`. Expected: only
`herdr` in each (the untracked install of 2026-10-09). Then:

```sh
rm -rf .agents/skills/herdr .claude/skills/herdr
```

In `.gitignore`, after `/.remember/`, add:

```gitignore
/.agents/skills/
/.claude/skills/
```

Leave the untracked `skills-lock.json` in place; the sync rewrites it.

- [ ] **Step 2: Write the failing test**

Create `agents.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/agents.test.ts
//
//

// The agent assets' layout, as the agentic asset refactor agreed it: the
// guidance and its budgets, the linked skills, agent memory and Claude's
// plugins. It reads only the repository.

import { describe, expect, it } from "bun:test";
import {
    existsSync,
    lstatSync,
    readdirSync,
    readFileSync,
    realpathSync,
} from "node:fs";
import { join } from "node:path";

const ROOT = import.meta.dir;
const at = (...parts: string[]) => join(ROOT, ...parts);
const read = (path: string) => readFileSync(path, "utf8");

type Lock = {
    skills: Record<string, { source: string; sourceType: string }>;
};

// Superpowers' skills less the four the `skills` script excludes.
const SKILLS = [
    "brainstorming",
    "dispatching-parallel-agents",
    "executing-plans",
    "finishing-a-development-branch",
    "receiving-code-review",
    "requesting-code-review",
    "subagent-driven-development",
    "systematic-debugging",
    "test-driven-development",
    "verification-before-completion",
    "writing-plans",
];

const EXCLUDED = [
    "diagnosing-superpowers",
    "using-git-worktrees",
    "using-superpowers",
    "writing-skills",
];

const LINKS = [".agents/skills", ".claude/skills"];

const lock = (): Lock => JSON.parse(read(at("skills-lock.json")));

const skillsScript = (): string =>
    JSON.parse(read(at("package.json"))).scripts.skills;

const linked = (dir: string): string[] =>
    existsSync(at(dir)) ? readdirSync(at(dir)).sort() : [];

const skillName = (dir: string): string | undefined =>
    read(join(dir, "SKILL.md")).match(/^name:\s*["']?([^"'\s]+)/m)?.[1];

describe("the skills", () => {
    it("records superpowers' skills less the excluded four", () => {
        const fromPackages = Object.entries(lock().skills)
            .filter(([, entry]) => entry.sourceType === "node_modules")
            .map(([name]) => name)
            .sort();
        expect(fromPackages).toEqual(SKILLS);
    });

    it("excludes the four in the skills script, and links none", () => {
        const named = [...skillsScript().matchAll(/--exclude '[^#']+#([^']+)'/g)]
            .map((match) => match[1] as string)
            .sort();
        expect(named).toEqual(EXCLUDED);
        for (const dir of LINKS) {
            expect(linked(dir).filter((name) => EXCLUDED.includes(name))).toEqual(
                [],
            );
        }
    });

    it("syncs without reporting to skills.sh", () => {
        expect(skillsScript()).toStartWith("DO_NOT_TRACK=1 ");
    });

    for (const [name, entry] of Object.entries(lock().skills)) {
        // A remote skill (herdr) arrives with `bun run skills`, never in
        // CI, so it is checked only where it is installed.
        const fromPackage = entry.sourceType === "node_modules";
        const present = fromPackage || existsSync(at(".agents/skills", name));
        it.if(present)(`links ${name} for every agent`, () => {
            const canonical = realpathSync(at(".agents/skills", name));
            expect(realpathSync(at(".claude/skills", name))).toBe(canonical);
            expect(skillName(canonical)).toBe(name);
            if (fromPackage) {
                expect(
                    lstatSync(at(".agents/skills", name)).isSymbolicLink(),
                ).toBe(true);
                expect(canonical).toContain("/node_modules/");
            }
        });
    }

    it("links nothing the lock does not record", () => {
        const recorded = Object.keys(lock().skills);
        for (const dir of LINKS) {
            expect(linked(dir).filter((name) => !recorded.includes(name))).toEqual(
                [],
            );
        }
    });
});
```

Biome reflows the long lines: run `bunx biome format --write
agents.test.ts` after writing it.

In `tsconfig.json`'s `include`, add `"agents.test.ts"` just before
`"workspace.test.ts"`.

- [ ] **Step 3: Run it to see it fail**

Run: `bun test agents.test.ts`
Expected: FAIL. "records superpowers' skills" gets `[]` (the lock holds
only herdr), and the two script tests fail on an undefined
`scripts.skills`.

- [ ] **Step 4: Declare the skills**

In `package.json`, append to `devDependencies`:

```json
"skills": "1.7.2",
"superpowers": "github:obra/superpowers#v6.4.1",
```

Add a top-level `"skills"` field after `"config"`:

```json
"skills": [{ "source": "herdrdev/herdr", "skills": ["herdr"] }],
```

In `scripts`, which are sorted, replace `prepare` and add `skills` after
it:

```json
"prepare": "{ test -d node_modules/husky && husky || true; } && bun run skills --no-remote",
"skills": "DO_NOT_TRACK=1 skills experimental_sync -y --agent claude-code codex --exclude 'superpowers#using-git-worktrees' --exclude 'superpowers#using-superpowers' --exclude 'superpowers#diagnosing-superpowers' --exclude 'superpowers#writing-skills'",
```

The braces keep `|| true` to husky alone: a failing sync fails `prepare`,
and `bun install` with it. `bun run skills --no-remote` passes the flag
through to the script (checked: `bun run` appends trailing arguments).

- [ ] **Step 5: Leave the lock out of formatting**

The CLI writes `skills-lock.json` indented by two spaces; Biome formats
by four. Replace `.biome.json` with:

```json
{
    "$schema": "https://biomejs.dev/schemas/2.5.14/schema.json",
    "extends": ["@chewygumxx/biome-config"],
    "files": {
        "includes": ["**", "!skills-lock.json"]
    }
}
```

- [ ] **Step 6: Install, then fetch herdr**

```sh
bun install
bun run skills
ls -la .agents/skills .claude/skills
jq '.skills | map_values({sourceType, source})' skills-lock.json
```

Expected: `bun install` updates `bun.lock` with `skills` and
`superpowers`, and `prepare` links eleven skills; `bun run skills` then
fetches herdr. `.agents/skills/` holds eleven links into `node_modules`
and a `herdr` directory; `.claude/skills/` holds twelve links into
`.agents/skills/`. The lock records eleven `node_modules` entries and
herdr as `github`.

If `bun install` installs superpowers but links nothing, run
`bun run skills --no-remote` by hand and read its output: the sync
reports each skill it skipped and why.

- [ ] **Step 7: Run the test to see it pass**

Run: `bun test agents.test.ts`
Expected: PASS, twelve `links ... for every agent` tests among them.

- [ ] **Step 8: Probe the remote's behaviour (Review Focus 1)**

```sh
R=docs/reports/2026-10-12-agentic-asset-refactor
{
    rm -rf .agents/skills/herdr .claude/skills/herdr
    echo '$ bun run skills --no-remote'
    bun run skills --no-remote 2>&1
    echo '$ jq .skills.herdr skills-lock.json'
    jq .skills.herdr skills-lock.json
    echo '$ bun test agents.test.ts'
    bun test agents.test.ts 2>&1 | tail -4
    echo '$ bun run skills'
    bun run skills 2>&1
    echo '$ bun run skills   # again, with herdr present'
    bun run skills 2>&1
} >"$R/sync.txt"
cat "$R/sync.txt"
```

Expected: with herdr gone, `--no-remote` keeps its lock entry and the
test passes with herdr's test skipped (as in CI); the first
`bun run skills` fetches herdr; the second reports nothing to fetch.

- [ ] **Step 9: Prove a failing sync fails the install (Review Focus 2)**

```sh
prepare=$(jq -r .scripts.prepare package.json)
sh -c "$(printf '%s' "$prepare" | sed 's/bun run skills --no-remote/false/')"
echo "sync fails: exit $?"
sh -c "$(printf '%s' "$prepare" | sed 's#node_modules/husky#node_modules/absent#; s/bun run skills --no-remote/true/')"
echo "husky absent: exit $?"
```

Expected: `sync fails: exit 1`, `husky absent: exit 0`.

- [ ] **Step 10: Record the probes**

Under `## The probes` in the report, after `### Header verification`, add
`### The skills`. Record: that bun's isolated linker installed superpowers
from GitHub (the `bun install` output line naming it), that the sync
discovered and linked its eleven skills and pruned the four excluded
(Step 6's listing), Step 8's transcript (point at `sync.txt` and quote its
key lines), and Step 9's two exit codes.

- [ ] **Step 11: Check and commit**

```sh
bun run check
git add .gitignore .biome.json package.json bun.lock skills-lock.json \
    tsconfig.json agents.test.ts \
    docs/reports/2026-10-12-agentic-asset-refactor.md \
    docs/reports/2026-10-12-agentic-asset-refactor
git commit -F - <<'EOF'
ai: Declare the skills as dependencies

Superpowers is a pinned development dependency and herdr a remote
source; prepare links superpowers' skills on every install, without
the network, and `bun run skills` fetches herdr. agents.test.ts pins
the links, the lock and the four excluded skills.
EOF
```

Expected: `bun run check` passes; `format:check` no longer reports
`skills-lock.json`. If it still does (Biome formatting a path passed to
it explicitly despite `files.includes`), revert Step 5 and instead
exclude the lock from the file lists of `format` and `format:check` by
appending `-- . ':!skills-lock.json'` to their `git ls-files` calls.

---

### Task 3: Each package's guidance

**Files:**

- Create: `packages/core/AGENTS.md`, `packages/memory/AGENTS.md`,
  `packages/agent/AGENTS.md`, `packages/tui/AGENTS.md`,
  `packages/cli/AGENTS.md`
- Modify: `agents.test.ts`

**Interfaces:**

- Consumes: `ROOT`, `at`, `read` from Task 2.
- Produces: `BUDGET`, `lines(path)`, `walk(dir)`, `guidanceUnder(dir)` and
  `brokenLinks(path)`, which Task 4 uses.

- [ ] **Step 1: Write the failing test**

Extend `agents.test.ts`'s `node:path` import to:

```ts
import { basename, dirname, join, relative } from "node:path";
```

After the helpers, before `describe("the skills")`, add:

```ts
// Lines, header included, each kind of guidance file may run to. A
// package that outgrows its budget gains a nested AGENTS.md instead.
const BUDGET = { docs: 60, package: 150, root: 100 };

const lines = (path: string) => read(path).trimEnd().split("\n").length;

// Every file beneath a directory, skipping dependencies, git and links.
const walk = (dir: string, found: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git") {
            continue;
        }
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(path, found);
        } else if (entry.isFile()) {
            found.push(path);
        }
    }
    return found;
};

const guidanceUnder = (dir: string): string[] =>
    walk(dir).filter((path) => basename(path) === "AGENTS.md");

// Relative links that resolve to nothing; remark checks none of them.
const brokenLinks = (path: string): string[] =>
    [...read(path).matchAll(/\]\(([^)\s]+)\)/g)]
        .map((match) => (match[1] as string).split("#")[0] as string)
        .filter((target) => target !== "" && !/^[a-z]+:/i.test(target))
        .filter((target) => !existsSync(join(dirname(path), target)));

const PACKAGES = at("packages");
```

At the end of the file, add:

```ts
describe("the packages' guidance", () => {
    it("gives every package an AGENTS.md", () => {
        const missing = readdirSync(PACKAGES).filter(
            (name) => !existsSync(join(PACKAGES, name, "AGENTS.md")),
        );
        expect(missing).toEqual([]);
    });

    for (const path of guidanceUnder(PACKAGES)) {
        const shown = relative(ROOT, path);

        it(`keeps ${shown} within ${BUDGET.package} lines`, () => {
            expect(lines(path)).toBeLessThanOrEqual(BUDGET.package);
        });

        it(`resolves every link in ${shown}`, () => {
            expect(brokenLinks(path)).toEqual([]);
        });
    }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test agents.test.ts`
Expected: FAIL in "gives every package an AGENTS.md", with all five
packages listed as missing.

- [ ] **Step 3: Write the five files**

Create each file exactly as below. They are drafted from today's
`.claude/CLAUDE.md`, checked against the code (every name they cite
exists), linted by remark, and within budget (core 62, memory 129, agent
85, tui 67, cli 69 lines). Do not add to them beyond fixing a fact found
wrong; if one is wrong, fix it and note it in the report's rulings.

`packages/core/AGENTS.md`:

````markdown
---
ctime: 2026-10-12
mtime: 2026-10-12
spdx: GPL-3.0-only
title: packages/core/AGENTS.md
description: >-
  The core package's guide: the contracts the other packages meet on and
  the basics they share.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/core/AGENTS.md
   -
   -->

# packages/core/AGENTS.md

`@dorothy/core` holds the contracts the other packages meet on and the
basics they share. Every other package depends on it; it depends on none.

## Entry points and imports

One entry point, `"."` (`src/index.ts`), which re-exports every module
below. It declares `niceware` alone, and never imports another
`@dorothy` package or any model provider's SDK.

## Files

- `contracts/session.ts`: `ChatSession`, its `ConversationEvent`s, `Turn`
  and `RawMessage`, the structural stand-in for an SDK message.
- `contracts/start.ts`: `SessionStart`, the values a session starts from,
  and `withSection`, which joins a section (the memory block, the earlier
  turns' abstracts) to a system prompt.
- `contracts/structured.ts`: `StructuredCall`, the one-shot call reviews
  and compaction take.
- `contracts/notices.ts`: `Notice` and `NoticeSource`, what memory and
  history show on screen.
- `contracts/editor.ts`: `Editor`, the external editor's contract.
- `contracts/recall.ts`: the recall tools' names and shapes.
- `config.ts`: `config.toml` (`readConfig`, `parseConfig`).
- `xdg.ts`: the XDG directories (`xdgDir`).
- `session-id.ts`: session phrases; `timers.ts`: injectable timers.

## Invariants

- Contracts are structural and free of SDK types, so no consumer of a
  session needs the SDK.
- A function that reads or writes the filesystem takes its directory or
  environment as a parameter (`Env`), so tests pass temporary ones.

## Tests

Tests sit beside their modules (`*.test.ts`). Pass every environment in;
never read the user's XDG directories.

## See also

- [Workspace modularity spec](../../docs/specs/2026-10-09-workspace-modularity-design.md)
````

`packages/memory/AGENTS.md`:

````markdown
---
ctime: 2026-10-12
mtime: 2026-10-12
spdx: GPL-3.0-only
title: packages/memory/AGENTS.md
description: >-
  The memory package's guide: transcripts, notes, recall, compaction, tags
  and history, and the locks and wiring that hold them together.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/memory/AGENTS.md
   -
   -->

# packages/memory/AGENTS.md

`@dorothy/memory` is Dorothy's memory database in all its parts:
transcripts, the notes on each conversation, recall, compaction, tags and
history. It never imports the agent or a model provider's SDK: reviews and
compaction take core's `StructuredCall` and their prompts as text
(`MemoryPrompts`).

## Entry points and imports

- `"."` (`src/index.ts`): `openMemory` and `previewStart`.
- `"./commands"` (`src/commands.ts`): `--list`, `--memory`, `--tags`,
  `--edit-tags`, the history commands and `commandHistory()`.
- `"./recall-server"` (`src/recall-server.ts`): `runRecallServer`, loaded
  without the rest of memory.

Of the `@dorothy` packages it depends on `core` alone. `recall/server.ts`
is the only file importing `@modelcontextprotocol/sdk`.

## Files

- `transcript.ts`: transcripts, private JSONL under
  `$XDG_DATA_HOME/dorothy/`.
- `memory/open.ts`: `openMemory` opens a chat's memory and returns its
  `createSession(turns)`, whose sessions are compacting, tracked by memory
  and recorded by `sessionRecorder` (`record.ts`). Each starts from the
  `SessionStart` values memory renders, handed to the `connect` the CLI
  passes. `preview.ts` gives `--dump-context` a start without history.
- `memory/sidecar.ts`: the notes, kept in `<phrase>.meta.json` beside the
  transcript. `service.ts`'s `MemoryService` builds the memory block each
  session starts with, frozen for the session, and schedules reviews
  (`review.ts`, `scheduler.ts`): one-shot calls that never block the chat.
  `track.ts`'s `trackMemory` decorates the `ChatSession`, so `App` sees
  only notices. `rank.ts`, `block.ts`, `edit-view.ts` and `list.ts` are
  pure; `commands.ts` has `--list` and `--memory`.
- `memory/vocabulary.ts`, `tagging.ts`, `tags-view.ts`: tags, a SKOS-style
  vocabulary in `tags.json` (concepts with `prefLabel`, `altLabel`,
  `broader` and `scopeNote`, and the tombstones of deleted and merged
  ones). Each sidecar holds its conversation's concept ids. `applyTagging`
  checks a review's tags leniently, a bad tag never failing the notes, and
  coins concepts inside the sidecar's lock.
- `recall/`: search over past conversations. `store.ts` is a derived
  SQLite FTS5 index in the XDG cache; `sync.ts` syncs it from the
  transcripts and sidecars before every query; `query.ts` has `search` and
  `open`; `tags.ts` mirrors the vocabulary; `server.ts` serves them over
  MCP on stdio as `dorothy --recall-server`. Reviews appraise each read
  into the sidecar, and `salience()` (`rank.ts`) weighs appraised reads
  with visits.
- `compaction/`: past `[compaction] soft` tokens, at the next idle (past
  `hard`, before the next message), `compact()` splits the turns before
  the verbatim tail into topical clusters with an abstract each
  (`clusters.ts`, `plan.ts`). `Compaction` (`session.ts`) wraps the
  session; a pass (`run.ts`, on `shared.ts`'s state) appends the clusters
  to the sidecar, writes a `compaction` transcript event, and swaps in a
  session seeded with the abstracts and the turns after them.
- `history/`: the data directory as a git repository. `MemoryRepo`
  (`repo.ts`) has two engines, the git binary run isolated from the
  user's configuration (`binary.ts`) and isomorphic-git (`iso.ts`), chosen
  once per process (`open.ts`). `MemoryHistory` (`history.ts`) commits
  each logical change, sweeps up outside changes first, and restores a
  file that fails `lint.ts` (`heal.ts`), keeping its bytes under
  `broken/`. `mirror.ts` seals new commits as AES-256-GCM bundles
  (`seal.ts`) on the orphan branch `sealed` and pushes it to the remote
  `mirror` under `DOROTHY_MIRROR_KEY`; `--recover` rebuilds from it.
- `sqlite-lock.ts`: `exclusiveLock`, a SQLite `BEGIN IMMEDIATE` write
  lock.

## Invariants

- The recall index doubles as the sidecar write lock and holds review
  claims, so two TUIs never review one conversation at once. Without the
  index, history's `FileLock` (`.git/dorothy.lock`) is the lock; both are
  `exclusiveLock`. History commits a change inside the lock it was written
  under; healing takes the lock, so it happens only outside it.
- `updateSidecar`'s change may be async, so coining a concept inside its
  lock means two runs never coin one label twice.
- The notes never import history; only `openMemory` wires the two.
  Writers take a `Recording` through `updateSidecar` and
  `updateVocabulary`, the service a `HistoryHandle`, and the commands an
  `OpenHistory`, which the CLI passes from `commandHistory()`.
- `openMemory` opens the index and history before it reads anything, and
  commits each turn once the transcript is flushed.
- The memory block charges the earlier turns' abstracts to its budget
  first.
- `recollect` is registered only with `--recollect`, which the agent adds
  when a chat has clusters.
- A concept only hidden conversations carry is never shown to her.
- A key that does not open the newest sealed bundle seals nothing.
- The vocabulary path is always passed (`vocabularyPath()`), never derived
  from the transcripts directory.

## Tests

- Pass every root, key and environment in; tests keep to temporary
  directories (`history/testing.ts` has `tempRoot` and `TEST_ENV`).
- The git binary's tests shut out the user's git configuration.
- One contract test runs against both history engines, and across them.
- `memory/fake-session.ts` stands in for a `ChatSession`.

## See also

- Specs: [catalogue](../../docs/specs/2026-10-05-conversation-catalogue-design.md),
  [recall](../../docs/specs/2026-10-06-recall-design.md),
  [compaction](../../docs/specs/2026-10-07-compaction-design.md),
  [tags](../../docs/specs/2026-10-07-tags-design.md),
  [history](../../docs/specs/2026-10-08-memory-history-design.md)
- Reports: [recall](../../docs/reports/2026-10-06-recall.md),
  [compaction](../../docs/reports/2026-10-07-compaction.md),
  [tags](../../docs/reports/2026-10-08-tags.md),
  [history](../../docs/reports/2026-10-08-memory-history.md)
````

`packages/agent/AGENTS.md`:

````markdown
---
ctime: 2026-10-12
mtime: 2026-10-12
spdx: GPL-3.0-only
title: packages/agent/AGENTS.md
description: >-
  The agent package's guide: Dorothy's model side, the persona, and the
  Agent SDK's single holder.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/agent/AGENTS.md
   -
   -->

# packages/agent/AGENTS.md

`@dorothy/agent` is Dorothy's model side, and the only package declaring
`@anthropic-ai/claude-agent-sdk`. It calls `query()` with a custom
`systemPrompt` string, replacing Claude Code's preset entirely, and
streams the `text_delta` events of `stream_event` messages
(`includePartialMessages: true`). Model Providers is to replace it.

## Entry points and imports

One entry point, `"."` (`src/index.ts`): `Conversation`,
`conversationOptions`, `runOneShot`, `structuredCall`, `dumpRequest`,
`personaPrompt`, `systemPrompt`, `promptHash` and `prepareCliHome`. Of the
`@dorothy` packages it depends on `core` alone. It declares `zod` because
the Agent SDK takes it as a peer; never prune it as unused.

## Files

- `conversation.ts`: `Conversation`, core's `ChatSession`, keeping one
  `query()` alive in streaming input mode and emitting `ready`, `delta`,
  `turn-end`, `sdk`, `lookup` and `error`; recall's tool calls become
  `lookup` events. `conversationOptions()` builds what a session starts
  with from `SessionStart` and the persona, joining the memory block and
  the earlier section with `withSection` and the turns with `withHistory`.
- `one-shot.ts`: `runOneShot`, a one-shot prompt streamed to stdout.
- `structured.ts`: `structuredCall`, the `StructuredCall` reviews and
  compaction take.
- `persona.ts`: the persona, composed from `personaComponents` (identity,
  voice, capabilities, plumbing, provenance, memory) in chat mode or
  development mode (`--dev`: a mode component, no provenance, and Dorothy
  describes her context); `baseOptions` and `cliOptions`; `promptHash`
  (`xxh3:<hex>`), which transcripts record and nothing reads back.
- `capture.ts`: `dumpRequest` sends a chat's first request to a loopback
  stand-in for the API and returns the body, for `--dump-context`.

## Invariants

- `query()` spawns the SDK's bundled `claude` binary on every call, so
  `baseOptions` keeps it lean: `tools: []` drops some 32k input tokens of
  tool definitions, and `settingSources: []` stops it loading settings,
  hooks and plugins.
- Every call spreads `cliOptions()`: the CLI runs in a private home
  (`$XDG_CACHE_HOME/dorothy/claude`, 0700, made by `prepareCliHome`) as
  both `CLAUDE_CONFIG_DIR` and `cwd`, with
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and `DISABLE_COMPACT=1`. It is a
  function because dotenvx loads the credentials after import.
- The CLI still prepends its identity line and appends a system message
  after each user turn (working directory, platform, model, date). The
  persona has the model treat those as incidental and not volunteer its
  provenance.
- The CLI's own compaction is off; a `compact_boundary` message is
  reported as a warning, as an error would end the turn on screen.
- Reconnecting seeds a new session with the turns held in memory, and
  `--resume` with the transcript's.

## Tests

- `persona.test.ts` pins the chat prompt byte for byte: change it only
  when the persona is meant to change.
- Inject `query()` (`QueryFn`, `StructuredQueryFn`, `CaptureQueryFn`);
  no test reaches the API.

## See also

- [Context leak findings](../../docs/reports/2026-10-07-context-leak.md)
- [Compaction probes](../../docs/reports/2026-10-07-compaction.md)
````

`packages/tui/AGENTS.md`:

````markdown
---
ctime: 2026-10-12
mtime: 2026-10-12
spdx: GPL-3.0-only
title: packages/tui/AGENTS.md
description: >-
  The TUI package's guide: the Ink chat, its pure reducer and its input
  editor.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/tui/AGENTS.md
   -
   -->

# packages/tui/AGENTS.md

`@dorothy/tui` is the Ink chat. It knows a session only as core's
`ChatSession`, made by the `createSession` it is given, and needs no SDK
types: the `sdk` event carries core's structural `RawMessage`.

## Entry points and imports

One entry point, `"."` (`src/index.ts`): `runApp`, which renders the chat
until it exits, and `editInEditor`, which the CLI also passes to
`--memory` and `--edit-tags`. Of the `@dorothy` packages it depends on
`core` alone.

## Files

- `run-app.tsx`: `runApp`. `App.tsx`: the screen. It owns the draft and
  the editor's memory (kill buffer, goal column, input history), since the
  Too Small screen unmounts `Input`, and runs Ctrl+G's `$EDITOR`
  (`external-editor.ts`) inside Ink's `suspendTerminal`.
- `state.ts`: a pure reducer over the chat's state.
- `editor.ts` (draft edits, wrapped layout, cursor movement) and
  `recall.ts` (the input's history, not memory's recall): the pure input
  editor. `Input.tsx` only maps keys onto them.
- `layout.ts`: the minimum size and the Too Small screen.
- `Header.tsx`, `statusline.ts`: the header and its status line.
- `History.tsx`, `LiveReply.tsx`, `RawPane.tsx`: past turns, the reply
  streaming in, and the raw SDK messages.
- `Markdown.tsx` and `markdown/`: replies rendered as Markdown
  (`render.ts`, `spans.ts`), code highlighted by lowlight
  (`highlight.ts`).

## Invariants

- Screen logic lives in the pure modules (`state.ts`, `editor.ts`,
  `recall.ts`, `layout.ts`, `statusline.ts`, `markdown/`), so it is tested
  without Ink; components map keys and events onto them and render.

## Tests

Frame tests compare rendered frames as plain text: `test-setup.ts`,
preloaded by `bunfig.toml`, sets `FORCE_COLOR=0` before Ink loads.

## See also

- Specs: [TUI chat](../../docs/specs/2026-10-03-tui-chat-design.md),
  [input editor](../../docs/specs/2026-10-03-input-editor-design.md),
  [Markdown replies](../../docs/specs/2026-10-03-markdown-replies-design.md),
  [status line](../../docs/specs/2026-10-05-statusline-and-minimum-size-design.md)
````

`packages/cli/AGENTS.md`:

````markdown
---
ctime: 2026-10-12
mtime: 2026-10-12
spdx: GPL-3.0-only
title: packages/cli/AGENTS.md
description: >-
  The CLI package's guide: the dorothy program, which wires memory, the
  agent and the TUI together, and auth.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/cli/AGENTS.md
   -
   -->

# packages/cli/AGENTS.md

`@dorothy/cli` is the `dorothy` program. It is run, not imported: it
exports nothing, and depends on all four other packages, wiring memory,
the agent and the TUI together.

## Entry points and imports

No entry points. `src/index.ts` parses the flags and loads each mode's
package lazily (`await import(...)`): memory's commands and recall server
through their own entry points (`@dorothy/memory/commands`,
`@dorothy/memory/recall-server`), and even `prepareCliHome` only for the
model modes, so `--help`, `--list` and `--recall-server` never load the
Agent SDK. Keep every new mode's import lazy.

## Files

- `index.ts`: the entry guard, the flags (`parseArgs`, `USAGE`) and the
  modes.
- `run-tui.ts`: `runTui` connects memory, the agent and `runApp`.
  `openMemory` gets `structuredCall`, the persona's prompts as text and a
  `connect` that starts a `Conversation`, and the screen runs over its
  `createSession`. Once `runTui` resolves, everything is closed and the
  CLI ends the process, so a push or repack still running never holds the
  terminal.
- `dump.ts`: `runDump` composes `previewStart` with `dumpRequest` for
  `--dump-context`.
- `recall-launch.ts`: `recallLaunch` launches this program again as the
  recall server, leaving out the conversation it serves.

## Invariants

- Auth comes from `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` in
  `.env`; the entry guard calls dotenvx's `config()` to decrypt it with
  the private key from Dotenvx Armor or a gitignored `.env.keys`.
- `@dotenvx/dotenvx` is declared here and again in the root's development
  dependencies, which the root's `lint:env` script and the pre-commit hook
  need.
- The CLI passes `commandHistory()` to memory's commands, and
  `editInEditor` to `--memory` and `--edit-tags`.

## Tests

Pass every root and environment in; no test decrypts the real `.env` or
starts a model.

## See also

- [Workspace modularity spec](../../docs/specs/2026-10-09-workspace-modularity-design.md)
- [Workspace modularity report](../../docs/reports/2026-10-09-workspace-modularity.md)
````

- [ ] **Step 4: Run the test to see it pass**

Run: `bun test agents.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint the files**

Run: `bun run lint:md && bun run lint:emdash`
Expected: both exit 0.

- [ ] **Step 6: Plant a broken link and an external one (Review Focus 4)**

Append to `packages/tui/AGENTS.md`, temporarily:

```markdown
[gone](./no-such-file.md) [fine](https://example.com)
[also fine](../../README.md#ci)
```

Run: `bun test agents.test.ts`
Expected: FAIL in "resolves every link in packages/tui/AGENTS.md", with
`["./no-such-file.md"]` and nothing else. Then remove the two lines and
run it again: PASS.

- [ ] **Step 7: Check and commit**

```sh
bun run check
git add packages/*/AGENTS.md agents.test.ts
git commit -m "ai: Guide agents through each package"
```

---

### Task 4: The root's guidance, and CLAUDE.md goes

**Files:**

- Create: `AGENTS.md`, `docs/AGENTS.md`
- Delete: `.claude/CLAUDE.md`
- Modify: `README.md:266-268`, `agents.test.ts`

**Interfaces:**

- Consumes: `BUDGET`, `lines`, `walk`, `brokenLinks` from Task 3.

- [ ] **Step 1: Write the failing test**

At the end of `agents.test.ts`, add:

```ts
// Claude Code reads AGENTS.md only where the project has no instruction
// file of its own by these names, ignored or not.
const CLAUDE_FILES = ["CLAUDE.md", "CLAUDE.local.md"];

describe("the root's guidance", () => {
    it(`keeps AGENTS.md within ${BUDGET.root} lines`, () => {
        expect(lines(at("AGENTS.md"))).toBeLessThanOrEqual(BUDGET.root);
    });

    it(`keeps docs/AGENTS.md within ${BUDGET.docs} lines`, () => {
        expect(lines(at("docs/AGENTS.md"))).toBeLessThanOrEqual(BUDGET.docs);
    });

    it("resolves every link in them", () => {
        expect([
            ...brokenLinks(at("AGENTS.md")),
            ...brokenLinks(at("docs/AGENTS.md")),
        ]).toEqual([]);
    });

    it("leaves no CLAUDE.md to switch them off", () => {
        const found = walk(ROOT)
            .filter((path) => CLAUDE_FILES.includes(basename(path)))
            .map((path) => relative(ROOT, path));
        expect(found).toEqual([]);
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test agents.test.ts`
Expected: FAIL: the budget tests with `ENOENT` for `AGENTS.md` and
`docs/AGENTS.md`, and "leaves no CLAUDE.md" with `[".claude/CLAUDE.md"]`.

- [ ] **Step 3: Write the two files**

Create each exactly as below (root 99 lines, docs 43; linted).

`AGENTS.md`:

````markdown
---
ctime: 2026-10-12
mtime: 2026-10-12
spdx: GPL-3.0-only
title: AGENTS.md
description: >-
  Every coding agent's guide to Dorothy: what she is, the packages, the
  commands, the working rules, commits and the process.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/AGENTS.md
   -
   -->

# AGENTS.md

Dorothy is a conversational LLM interface: a terminal chat over a model,
with a memory of her past conversations that she can search, compact and
tag. Bun runs her from source; there is no build.

## Packages

Five Bun workspace packages under `packages/`, each `@dorothy/<name>`.
`core` holds the contracts the others meet on; `memory`, `agent` and `tui`
depend on `core` alone, never on each other; `cli` depends on all four and
wires them. A package exports only the entry points its `package.json`
names and imports only what it declares: under Bun's isolated linker, an
undeclared package or another package's internal path fails under Bun and
`tsc`. `workspace.test.ts` pins the graph, the entry points and the Agent
SDK's single holder, `agent`.

## Commands

- `bun run check`: everything CI runs, ending with the tests;
  `bun run test` runs the tests alone.
- `bun run dev`: the CLI from source.
- `bun run skills`: fetches the remote skills a fresh checkout lacks;
  `bun install` links the rest.
- After removing a `@dorothy` dependency, reinstall from clean to see the
  boundary: `rm -rf node_modules packages/*/node_modules && bun install`.

## Working rules

- Work on a plain branch in the main checkout, never in a worktree.
- Tests and probes never touch real user data (`$XDG_DATA_HOME/dorothy`,
  `$XDG_CACHE_HOME/dorothy`): every root, key and environment is passed in.
- `.env` is committed encrypted by dotenvx: set values only with
  `dotenvx set`, and never print a secret or put one in a command line or
  URL. `bunfig.toml` keeps Bun from loading `.env` itself
  (`[env] file = false`); the pre-commit hook rejects a plaintext value.
- Confirm with the user before pushing, opening a pull request or changing
  repository settings, which change only through `.repo-metadata.jsonc`,
  never `gh repo edit`.
- New subsystems stay independent of any model provider's SDK, speaking
  standard protocols, with SDK types at a thin edge.
- Declare in this repository every agentic asset and utility it employs;
  never leave one to a user's own settings or a hand-made step.
- Every new file carries the house header, copied from a sibling;
  `lint:header` keeps headers in sync but only warns of a missing one.
- A change to a package's architecture updates its `AGENTS.md` in the
  same branch.

## Commits

Commit granularly as you work, in Conventional Commits: one line where
that suffices, a body where the change needs context. No agent trailers.
Scopes are the package names, `config`, `claude` and `api`; agent assets
take the `ai` type. commitlint enforces the form and the pre-commit hook
rejects em dashes.

## Process

Design work starts with `brainstorming`. Specs go in `docs/specs/`, plans
in `docs/plans/`, written with `writing-plans` and carried out with
`subagent-driven-development`. Bugs start with `systematic-debugging`, and
nothing is claimed done without `verification-before-completion`. The
skills are in `.agents/skills/`; where one names another path, a worktree
or `docs/superpowers/`, these rules win.

`docs/roadmap.md` orders the phases. Once a phase merges, revise the
roadmap as its Revising section says before starting the next, and add
work found along the way where it serves best.

## Memory

Agent memory is in `.agents/memory/`, indexed by its `MEMORY.md`. A memory
names another by its file name or a relative Markdown link, never a
`[[...]]` wiki link, whatever a client's own memory instructions say;
remark rejects one.

## Before you start

Before working in a package, read `packages/<name>/AGENTS.md`; before
writing docs, `docs/AGENTS.md`.
````

`docs/AGENTS.md`:

````markdown
---
ctime: 2026-10-12
mtime: 2026-10-12
spdx: GPL-3.0-only
title: docs/AGENTS.md
description: >-
  Where Dorothy's documents go, how they are named and how they are
  written.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/AGENTS.md
   -
   -->

# docs/AGENTS.md

## Where things go

- `specs/`: designs, `YYYY-MM-DD-<topic>-design.md`.
- `plans/`: implementation plans, `YYYY-MM-DD-<topic>.md`.
- `reports/`: a phase's probes, rulings and verification,
  `YYYY-MM-DD-<topic>.md`, with any captured output in a directory beside
  it of the same name.
- `notes/`: research kept for reference, `YYYY-MM-DD_<topic>.md`.
- `deferred/`: findings left for later, `YYYY-MM-DD_<topic>.md`.
- `roadmap.md`: the phases in order, revised as its Revising section says.

## How they are written

- Each file opens with frontmatter (`ctime`, `mtime`, `spdx`, `title`,
  `description`, `tags`) and the breadcrumb comment; copy both from a
  sibling, and bump `mtime` when you edit. `lint:header` checks the
  breadcrumb against the file's path.
- Lines are at most 80 characters, and links are Markdown links, never
  `[[...]]` wiki links; remark (`lint:md`) enforces both.
- A spec says what and why; a plan says how, task by task, with the code.
- A report records each probe and how it was run, the rulings made on the
  spec, and the verification, with commands and their output.
````

- [ ] **Step 4: Delete CLAUDE.md and repoint the README**

```sh
git rm .claude/CLAUDE.md
```

In `README.md`, replace:

```markdown
The code is five Bun workspace packages under `packages/` (`core`, `memory`,
`agent`, `tui` and `cli`), linked by Bun's isolated linker; `.claude/CLAUDE.md`
describes them.
```

with:

```markdown
The code is five Bun workspace packages under `packages/` (`core`, `memory`,
`agent`, `tui` and `cli`), linked by Bun's isolated linker;
[`AGENTS.md`](./AGENTS.md) and each package's own describe them.
```

- [ ] **Step 5: Run the test to see it pass**

Run: `bun test agents.test.ts`
Expected: PASS.

- [ ] **Step 6: Plant an ignored CLAUDE.local.md (Review Focus 3)**

```sh
touch packages/tui/CLAUDE.local.md
git check-ignore -v packages/tui/CLAUDE.local.md
bun test agents.test.ts 2>&1 | grep -A3 'leaves no CLAUDE.md'
rm packages/tui/CLAUDE.local.md
```

Expected: `git check-ignore` names `*.local.*`, and the test fails with
`["packages/tui/CLAUDE.local.md"]`. After `rm`, the test passes again.

- [ ] **Step 7: Check and commit**

```sh
bun run check
git add AGENTS.md docs/AGENTS.md README.md agents.test.ts
git commit -F - <<'EOF'
ai: Move the guidance into AGENTS.md

The root AGENTS.md and docs/AGENTS.md replace .claude/CLAUDE.md, whose
package paragraphs now live in each package's own. Claude Code reads
them only where no CLAUDE.md exists, which the test pins.
EOF
```

---

### Task 5: Agent memory under .agents/

**Files:**

- Move: `.claude/memory/` to `.agents/memory/`
- Delete: `.agents/memory/docs-location.md`, `no-worktrees.md`,
  `sdk-independent-modules.md`
- Modify: `.agents/memory/MEMORY.md`,
  `.agents/memory/maintenance-design-agreed.md` (breadcrumb),
  `.claude/settings.json` (`repo-memory` out), `agents.test.ts`
- Create: `scripts/agent-memory.ts`
- Modify: `package.json` (`prepare`), `tsconfig.json` (`include`)
- Written by the script, never committed: `.claude/settings.local.json`

**Interfaces:**

- Consumes: `at`, `read` from Task 2.

- [ ] **Step 1: Write the failing test**

Add to `agents.test.ts`'s imports:

```ts
import { withMemoryDirectory } from "./scripts/agent-memory.js";
```

At the end of `agents.test.ts`, add:

```ts
const MEMORY = at(".agents/memory");

describe("agent memory", () => {
    it("lives in .agents/memory, not .claude/memory", () => {
        expect(existsSync(join(MEMORY, "MEMORY.md"))).toBe(true);
        expect(existsSync(at(".claude/memory"))).toBe(false);
    });

    it("indexes every memory there, and nothing else", () => {
        const indexed = [
            ...read(join(MEMORY, "MEMORY.md")).matchAll(/\]\(\.\/([^)]+)\)/g),
        ]
            .map((match) => match[1] as string)
            .sort();
        const memories = readdirSync(MEMORY)
            .filter((name) => name.endsWith(".md") && name !== "MEMORY.md")
            .sort();
        expect(indexed).toEqual(memories);
    });

    it("points auto memory at .agents/memory, keeping other settings", () => {
        const settings = {
            autoMemoryDirectory: "/checkout/.claude/memory",
            enabledMcpjsonServers: ["github"],
        };
        expect(withMemoryDirectory(settings, "/checkout")).toEqual({
            autoMemoryDirectory: "/checkout/.agents/memory",
            enabledMcpjsonServers: ["github"],
        });
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test agents.test.ts`
Expected: FAIL: the file does not load, as `./scripts/agent-memory.js`
does not exist yet.

- [ ] **Step 3: Move the memory and retire three**

```sh
git mv .claude/memory .agents/memory
git rm .agents/memory/docs-location.md .agents/memory/no-worktrees.md \
    .agents/memory/sdk-independent-modules.md
```

The root `AGENTS.md` now states all three: the docs locations (Process),
plain branches (Working rules) and SDK independence, widened to any
provider (Working rules).

Replace `.agents/memory/MEMORY.md` with:

```markdown
- [Background sessions force colour](./bg-session-force-color.md)
  `--bg` sessions export FORCE_COLOR=3, the user's shell doesn't
- [Maintenance design agreed](./maintenance-design-agreed.md)
  sub-project 4a decisions, queued after workspace modularity
```

- [ ] **Step 4: Repair the moved breadcrumb**

```sh
bunx sync-header-metadata@2.4.2 --update
git diff --stat
```

Expected: only `.agents/memory/maintenance-design-agreed.md` changes, its
`::: :/` line now `.agents/memory/maintenance-design-agreed.md`. If other
files change, revert them (`git checkout -- <file>`) and note them in the
report.

- [ ] **Step 5: Stop repo-memory, and declare the memory directory**

`repo-memory` rewrites `autoMemoryDirectory` to `.claude/memory` at
every session start, so it leaves with the move. In
`.claude/settings.json`, delete the line
`"repo-memory@chewygumxx": true,`.

The setting must be absolute, so it can live only in the gitignored
`.claude/settings.local.json`; a tracked script writes it there on every
install, so no one sets it by hand. Create `scripts/agent-memory.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/agent-memory.ts
//
//

// Points Claude Code's auto memory at .agents/memory/. The setting must be
// absolute, so it can live only in the gitignored settings.local.json;
// `prepare` runs this on every install, from the checkout's own path, so
// no one sets it by hand.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Settings = Record<string, unknown>;

// The settings with auto memory pointed at the checkout's .agents/memory/,
// every other setting left as it was.
export const withMemoryDirectory = (
    settings: Settings,
    root: string,
): Settings => ({
    ...settings,
    autoMemoryDirectory: join(root, ".agents", "memory"),
});

if (import.meta.main) {
    const root = join(import.meta.dir, "..");
    const path = join(root, ".claude", "settings.local.json");
    const settings: Settings = existsSync(path)
        ? JSON.parse(readFileSync(path, "utf8"))
        : {};
    const next = withMemoryDirectory(settings, root);
    if (next.autoMemoryDirectory !== settings.autoMemoryDirectory) {
        writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
    }
}
```

In `tsconfig.json`'s `include`, add `"scripts/**/*.ts"` after
`"scripts/**/*.mjs"`. In `package.json`, append the script to `prepare`:

```json
"prepare": "{ test -d node_modules/husky && husky || true; } && bun run skills --no-remote && bun scripts/agent-memory.ts",
```

Then run it as an install would, and look:

```sh
bun run prepare
jq '{autoMemoryDirectory, keys: keys}' .claude/settings.local.json
git check-ignore -q .claude/settings.local.json && echo ignored
```

Expected: `autoMemoryDirectory` is the checkout's absolute path ending
`/.agents/memory`; `keys` still holds `enableAllProjectMcpServers`,
`enabledMcpjsonServers` and `permissions`; then `ignored`.

- [ ] **Step 6: Run the test to see it pass**

Run: `bun test agents.test.ts`
Expected: PASS.

- [ ] **Step 7: Check and commit**

```sh
bun run check
git add .agents/memory .claude/settings.json agents.test.ts \
    scripts/agent-memory.ts package.json tsconfig.json
git commit -F - <<'EOF'
ai: Move agent memory under .agents

Three memories became rules in the root AGENTS.md and are retired.
prepare now points auto memory at .agents/memory from the checkout's
path, and repo-memory, which pointed it back at .claude/memory at
every session start, leaves with the move.
EOF
```

---

### Task 6: Claude's settings and their replacements

**Files:**

- Modify: `.claude/settings.json`, `package.json`, `bun.lock`,
  `.gitignore`, `agents.test.ts`
- Create: `.husky/post-checkout`, `.husky/post-merge`
- Delete: `.worktreeinclude`

**Interfaces:**

- Consumes: `at`, `read` from Task 2.
- Produces: the scripts `lint:header` and `format:header`.

- [ ] **Step 1: Write the failing test**

At the end of `agents.test.ts`, add:

```ts
// Each stays because nothing neutral does its job, and is declared here
// rather than left to a user's settings; a plugin added later is a
// decision a review sees.
const PLUGINS = {
    "agent-sdk-dev@claude-plugins-official": true,
    "claude-code-setup@claude-plugins-official": true,
    "claude-md-management@claude-plugins-official": true,
    "code-simplifier@claude-plugins-official": true,
    "explanatory-output-style@claude-plugins-official": true,
    "repo-metadata@chewygumxx": true,
    "superpowers@claude-plugins-official": false,
    "typescript-lsp@claude-plugins-official": true,
};

describe("Claude's settings", () => {
    it("enables exactly the agreed plugins", () => {
        const settings = JSON.parse(read(at(".claude/settings.json")));
        expect(settings.enabledPlugins).toEqual(PLUGINS);
    });
});
```

Run: `bun test agents.test.ts`
Expected: FAIL, the diff listing the plugins still enabled.

- [ ] **Step 2: Reinstall when the dependencies change**

`bun-install` ran `bun install` at every session start; these hooks run
it only when a checkout or merge changes the dependencies. Create
`.husky/post-checkout`:

```sh
#!/usr/bin/env sh
# vim:set expandtab shiftwidth=4 filetype=sh:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~chewygumxx/dorothy.git
# ::: :/.husky/post-checkout
#
#

# A branch checkout ($3 is 1) that changes the dependencies reinstalls
# them, and prepare relinks the skills. A file checkout, or a branch
# checkout leaving package.json and bun.lock alone, does nothing.

[ "$3" = 1 ] || exit 0
git diff --quiet "$1" "$2" -- package.json bun.lock && exit 0
bun install
```

Create `.husky/post-merge`:

```sh
#!/usr/bin/env sh
# vim:set expandtab shiftwidth=4 filetype=sh:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~chewygumxx/dorothy.git
# ::: :/.husky/post-merge
#
#

# A merge or pull that changes the dependencies reinstalls them, and
# prepare relinks the skills. ORIG_HEAD is the head before it.

git diff --quiet ORIG_HEAD HEAD -- package.json bun.lock && exit 0
bun install
```

```sh
chmod +x .husky/post-checkout .husky/post-merge
```

A `pull --rebase` fires `post-rewrite`, not `post-merge`; it is left out,
as the spec names only these two.

- [ ] **Step 3: Check headers with sync-header-metadata**

`header-metadata` wrote headers into new files; the root's rule covers
that now, and `sync-header-metadata` checks every breadcrumb. In
`package.json`, append to `devDependencies`:

```json
"sync-header-metadata": "2.4.2",
```

Add to `scripts`, keeping them sorted (`format:header` after
`format:check`, `lint:header` after `lint:env`):

```json
"format:header": "sync-header-metadata --update",
"lint:header": "sync-header-metadata",
```

In `check`, insert `&& bun run lint:header` before `&& bun run test`.

```sh
bun install
bun run lint:header
```

Expected: `Verification Passed`, none out of sync, exit 0.

- [ ] **Step 4: Probe the hooks (Review Focus 5)**

```sh
sh .husky/post-checkout HEAD HEAD 1; echo "same heads: exit $?"
sh .husky/post-checkout main HEAD 0; echo "file checkout: exit $?"
sh .husky/post-checkout main HEAD 1 2>&1 | tail -2
```

Expected: the first two print nothing but `exit 0` (no install); the
third runs `bun install`, since `bun.lock` differs from `main`'s.

- [ ] **Step 5: Reduce the settings**

Replace `.claude/settings.json` with:

```json
{
    "$schema": "https://www.schemastore.org/claude-code-settings.json",
    "attribution": {
        "commit": "",
        "pr": "",
        "sessionUrl": false
    },
    "enabledPlugins": {
        "claude-code-setup@claude-plugins-official": true,
        "claude-md-management@claude-plugins-official": true,
        "code-simplifier@claude-plugins-official": true,
        "explanatory-output-style@claude-plugins-official": true,
        "superpowers@claude-plugins-official": false,
        "agent-sdk-dev@claude-plugins-official": true,
        "typescript-lsp@claude-plugins-official": true,

        "repo-metadata@chewygumxx": true
    },
    "extraKnownMarketplaces": {
        "chewygumxx": {
            "source": {
                "source": "github",
                "repo": "chewygumxx/claude-library"
            },
            "autoUpdate": true
        }
    }
}
```

`github-mcp` duplicates the tracked `.mcp.json`; `prohibit-em-dash` is
the pre-commit hook and `lint:emdash`; `bun-install` is Step 2's hooks;
`header-metadata` is Step 3; `remember` leaves with nothing in its place.
The four workflow plugins stay: they are utilities with no neutral form,
installed at user scope but enabled nowhere else, so this file is what
turns them on here.

- [ ] **Step 6: Drop the worktree leftovers**

```sh
git rm .worktreeinclude
```

In `.gitignore`, delete the line `/.claude/worktrees/`.

- [ ] **Step 7: Run the test to see it pass**

Run: `bun test agents.test.ts`
Expected: PASS.

- [ ] **Step 8: Check and commit, in four commits**

```sh
bun run check
git add .husky/post-checkout .husky/post-merge
git commit -m "build: Reinstall when the dependencies change"
git add package.json bun.lock
git commit -m "build: Check headers with sync-header-metadata"
git add .worktreeinclude .gitignore
git commit -m "chore: Drop the worktree leftovers"
git add .claude/settings.json agents.test.ts
git commit -F - <<'EOF'
ai: Trim Claude's settings to eight plugins

Husky, CI and the tests now enforce what the removed plugins did, and
remember leaves. The four workflow utilities stay declared here, as
nothing else enables them. agents.test.ts pins the eight.
EOF
```

---

### Task 7: The roadmap

**Files:**

- Modify: `docs/roadmap.md`

- [ ] **Step 1: Add the Revising step**

In `## Revising`, after step 4, add:

```markdown
5. Check the root and each package's `AGENTS.md` against what merged,
   and correct any that no longer describe the code.
```

- [ ] **Step 2: Move the phase to Done**

Delete the `### Agentic Asset Refactor` section from `## Ahead`. At the
end of `## Done`'s list, add:

```markdown
- **Agentic asset refactor**:
  [spec](./specs/2026-10-11-agentic-asset-refactor-design.md),
  [plan](./plans/2026-10-12-agentic-asset-refactor.md),
  [report](./reports/2026-10-12-agentic-asset-refactor.md).
```

Model Providers is then first in `## Ahead`, and needs no other change.

- [ ] **Step 3: Add the revision**

At the end of `## Revisions`, add:

```markdown
- 2026-10-12: The Agentic Asset Refactor is done, so Model Providers is
  next. Revising gains a step that checks the `AGENTS.md` files against
  what merged.
```

Bump the frontmatter's `mtime` to `2026-10-12`.

- [ ] **Step 4: Lint and commit**

```sh
bun run lint:md
git add docs/roadmap.md
git commit -m "docs: Move the asset refactor to Done"
```

---

### Task 8: Measure again, and the report

**Files:**

- Modify: `docs/reports/2026-10-12-agentic-asset-refactor.md`
- Create: `after-*.json`, `plugins-after.txt`, `loading.txt` in its
  directory

- [ ] **Step 1: Measure again**

Use Task 1 Step 2's `measure` function, unchanged, writing
`after-root.json` and `after-tui.json`, and Task 1 Step 1's listing into
`plugins-after.txt`. Then:

```sh
R=docs/reports/2026-10-12-agentic-asset-refactor
diff "$R/plugins-before.txt" "$R/plugins-after.txt"
```

Expected: no difference. Run from `/tmp`, the listing shows the user's
own plugin state, which this plan never changes. If they differ, ask the
user before measuring, since the two measurements then do not compare.

- [ ] **Step 2: Probe how Claude Code loads the guidance**

```sh
R=docs/reports/2026-10-12-agentic-asset-refactor
{
    echo '$ root: commit type for agent assets'
    claude -p "Without reading any file, which commit type do agent \
assets take in this repository? Reply with the type alone."
    echo '$ nested: read a tui file'
    claude -p --output-format stream-json --verbose \
        "Read packages/tui/src/state.ts, then reply with the word done." \
        >/tmp/nested.jsonl
    echo "mentions of packages/tui/AGENTS.md in the stream: \
$(grep -c 'packages/tui/AGENTS.md' /tmp/nested.jsonl)"
    session=$(jq -r 'select(.session_id) | .session_id' /tmp/nested.jsonl |
        head -1)
    log=$(ls "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/projects/*/"$session".jsonl)
    echo "mentions in the session's transcript: \
$(grep -c 'packages/tui/AGENTS.md' "$log")"
} >"$R/loading.txt" 2>&1
cat "$R/loading.txt"
```

Expected: the first answer is `ai`, from the root `AGENTS.md` alone; the
nested probe finds `packages/tui/AGENTS.md` in the stream or the session's
transcript at least once. If neither finds it, record so: the per-package
files are then not loaded on demand, and the root's "Before you start"
rule is what brings them in. Do not change the design here; note it under
Known limitations.

- [ ] **Step 3: Write the report**

Fill `docs/reports/2026-10-12-agentic-asset-refactor.md`:

- `## Measurements`: add the two After rows from `after-*.json`, a line
  per directory giving the change in input tokens, and whether the phase
  succeeded: it does if the first request's input tokens fell from both
  directories. A rise in either is a finding to explain here.
- `## The probes`: add `### How the guidance loads`, quoting
  `loading.txt`.
- `## Rulings made during execution`: start with the plan's rulings below
  that held, then any made while executing.
- `## Verification`: `bun run check`'s last lines, and
  `bun test agents.test.ts`'s count.
- `## Commits`: `git log --oneline main..HEAD`, grouped by task.
- `## Known limitations`: at least the unpinned herdr, the experimental
  sync, the remote flag (`tengu_agents_md_mod`) and any probe that fell
  short.
- `## Summary`: three or four sentences: what moved, the token change,
  and what is left.

- [ ] **Step 4: Check and commit**

```sh
bun run check
git add docs/reports/2026-10-12-agentic-asset-refactor.md \
    docs/reports/2026-10-12-agentic-asset-refactor
git commit -m "docs: Report the agentic asset refactor"
```

Then stop: pushing and the pull request wait for the user.

---

## Rulings on the spec

1. **`repo-memory` leaves with the memory (Task 5), not with the other
   plugins (Task 6).** It rewrites `autoMemoryDirectory` to
   `.claude/memory` at every session start, so between the two tasks a
   new session would undo the move.
2. **The test pins superpowers' eleven skills by name**, not only "every
   skill in the lock is linked", so a dependency that starts shipping
   skills is a change a review sees.
3. **The test pins memory's index** (every memory indexed, nothing else,
   nothing left in `.claude/memory/`), as part of "the layout" the spec's
   Decisions say it pins.
4. **The `CLAUDE.md` search walks the filesystem** (skipping
   `node_modules`, `.git` and links) rather than listing git's files, as
   a gitignored `CLAUDE.local.md` still switches `AGENTS.md` off.
5. **The `AGENTS.md` files carry the house header within their budgets**,
   without the vim modeline other Markdown files end with, as every line
   is read by every session.
6. **`DO_NOT_TRACK=1` is asserted by the test**, since losing it would
   send every sync to `skills.sh` with nothing else noticing.
7. **The husky hooks are probed by hand, not tested**: they are shell, and
   the probe in Task 6 runs each case the spec names.
