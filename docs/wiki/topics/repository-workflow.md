---
ctime: 2026-11-03
mtime: 2026-11-11
spdx: GPL-3.0-only
title: Repository workflow
description: >-
  How work on Dorothy's repository is done: package boundaries, worktrees,
  the checks, agent assets, secrets and keeping documentation current.
tags:
  - wiki
  - workflow
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/wiki/topics/repository-workflow.md
   -
   -->

# Repository workflow

[Wiki home](../../README.md)

This page explains how the repository is worked in, as it stands. The rules
themselves are the root [`AGENTS.md`](../../../AGENTS.md) and
[`docs/AGENTS.md`](../../AGENTS.md), which agents read; this page gives
the reasons and the machinery behind them, and links the dated records
under [records](../records.md#repository-workflow). Where a rule has a
test, the test is named, since a rule only prose states can drift.

## Package boundaries

Dorothy is eight Bun workspace packages under `packages/`. `core` holds the
contracts the others meet on and `identity` who Dorothy is; `memory` and
`tui` depend on `core` alone, `agent` and `gateway` on it and `identity`,
never on each other, `eval` on `core` and `memory`; `cli` on all but
`eval`, and wires them. A package exports only the
entry points its `package.json` names and imports only what it declares,
as Bun's isolated linker fails an undeclared or internal import, and
`workspace.test.ts` pins the graph and the entry points. The graph, each
package's entry points and its guide are on
[packages](../profiles/packages.md); the reason for the split is in the
[workspace modularity
spec](../../specs/2026-10-09-workspace-modularity-design.md#purpose).

Before working in a package, read its `packages/<name>/AGENTS.md`. After
removing a `@dorothy` dependency, reinstall from clean to see the boundary,
because the old links linger:

```sh
rm -rf node_modules packages/*/node_modules && bun install
```

## Worktrees

Work happens on a branch, in the main checkout or in a worktree. Where a
worktree goes is the user's tools' to say: worktrunk's
`wt switch --create <branch>`, Claude Code's worktree or herdr's. An agent
never chooses a path itself, and never uses superpowers'
`using-git-worktrees` or a `.worktrees/` directory; where a skill asks for
either, `AGENTS.md` wins. The
[worktrees skill](../../../.agents/skills/worktrees/SKILL.md) holds the
procedure to make, check, repair and remove one.

A worktree shares neither dependencies, git hooks nor skill links with the
main checkout, so two declared steps set one up whichever tool made it:
`.husky/post-checkout` runs `bun install`, and `.worktreeinclude` has
Claude Code and worktrunk copy the skills that `skills add` installed
and `bun install` cannot link. A worktree's auto memory points at its own
`.agents/memory/`, so a memory written there is committed on its branch.

## The checks

`mise run check` runs everything CI runs, and `bun run check` is its shim.
The tasks live in
[`.config/mise/tasks.toml`](../../../.config/mise/tasks.toml), and
`mise tasks ls` lists them. `check` runs `lint` and `test` in parallel, and
`lint` runs these kinds in parallel:

1. `lint:types`: `tsc`.
2. `lint:code`: Biome's linter and format check over the files git knows.
3. `lint:md`: remark with `--frail`, then markdownlint, over every tracked
   Markdown file.
4. `lint:yaml`: Prettier and yamllint on YAML.
5. `lint:toml`: Tombi on TOML.
6. `lint:shell`: ShellCheck and shfmt on shell scripts.
7. `lint:actions`: actionlint on GitHub workflows.
8. `lint:editorconfig`: files against `.editorconfig`.
9. `lint:secrets`: `scripts/check-secrets.sh`, refusing a plaintext
   secret.
10. `lint:emdash`: no em dash in a tracked file, or in a staged one under
    `--staged`.
11. `lint:header`: every file's house header and breadcrumb match its path.

`test` is `bun test`, and `mise run test` runs the tests alone. `--staged`
narrows `lint` and `check` to the staged files, except that `lint:types`
and `lint:header` still check the whole project and the tests run whole.
`format` applies the formatters and `commit` composes a commit. Bun's own
layer, which needs no mise, keeps `dev`, `start`, `eval`, `skills` and
`prepare` as `bun run` scripts. `.config/mise/config.toml` pins Bun and
Node, since `--pi` and its tests run the published Pi under Node 22.19 or
later, and CI installs both from it. `scripts/probe-pi-delivery.ts` is a
probe, not a test file, so `check` never runs it. The tests also pin
conventions that are prose elsewhere: `workspace.test.ts` the package
graph, `agents.test.ts` the guidance budgets (`docs/AGENTS.md` within 60
lines), the skills and the memory index, `header.test.ts` the house header
on every new file, and `docs.test.ts` the wiki's links, fragments and
catalogue.

The pre-commit hook runs `mise run check --staged`, and the commit-msg hook
runs `mise run lint:commit`, which is commitlint. Each is one line, and
`--no-verify` skips both, kept for a granular commit that cannot yet pass
alone. Commits are granular, in Conventional Commits, with the package
names, `config`, `claude` and `api` as scopes and agent assets under the
`ai` type, and no agent trailers. A header is at most 50 characters and a
body line at most 72, limits that come from the shared commitlint config
and that a plan's commit steps must keep too
([plan commit headers](../../../.agents/memory/plan-commit-headers.md)).

Branches are pushed and their pull requests opened by the agent, who
merges its own once CI passes, as the user approved. Repository settings
change only through `.repo-metadata.jsonc`, after confirming, and never
through `gh repo edit` (root [`AGENTS.md`](../../../AGENTS.md)).

## Agent assets

Everything agents rely on is declared in the repository, so that it does
not depend on one user's settings or a hand-made step. The rule was the
aim of the
[agentic asset
refactor](../../specs/2026-10-11-agentic-asset-refactor-design.md#purpose),
and the consolidation that followed moved the coordination procedures out
of memory and scratch scripts into skills
([consolidation
spec](../../specs/2026-10-31-agentic-asset-consolidation-design.md#summary)).
The assets are:

- **Guidance** in `AGENTS.md` files: the root's, one in `docs/` and one per
  package, which Claude Code and Codex both read. No `CLAUDE.md` may exist
  in the tree, as one would switch `AGENTS.md` off for Claude Code
  (`agents.test.ts` checks).
- **Skills** in `.agents/skills/`. The repository commits four of its own:
  `agent-stewardship`, `agent-pre-screening`, `development-evidence` and
  `worktrees`. Third-party skills are dependencies, declared in
  `package.json`, recorded in
  `skills-lock.json` and pinned to a commit: superpowers (less four
  excluded skills) is linked by `bun install`, and herdr's, a remote one,
  by `bun run skills`.
- **Memory** in `.agents/memory/`, indexed by its `MEMORY.md`, each entry
  a link with its hook on the next line. It holds the user's preferences and
  their reasons, not procedures, which belong in skills. Memories link
  one another by relative Markdown link, and carry no em dash and no line
  over 80 characters, whatever a client's own memory instructions say.

`bun install` points Claude's auto memory at `.agents/memory/`. The
coordination of agents that the stewardship skill governs is the subject of
[orchestration](./orchestration.md#how-her-developers-are-coordinated-today).

## Secrets

Dorothy's secrets are in `secrets.json` at the repository's root,
encrypted by sops to an age key. `.sops.yaml` names the recipient; the key
is at `~/.config/sops/age/keys.txt`, or where `SOPS_AGE_KEY_FILE` points,
and the user backs it up off the machine, since without it the file cannot
be read. The choice replaced a paid service that held the earlier key, and
is recorded in the
[sops spec](../../specs/2026-10-21-sops-secrets-design.md#summary) and
[report](../../reports/2026-10-21-sops-secrets.md#summary).

The rules for an agent:

- Edit only with `sops edit secrets.json`, or through core's `saveSecret`,
  which passes the value on standard input.
- Never print a value, or put one in argv or a URL. A load failure returns
  a code alone, never sops's own message, so a log holds no fragment.
- A variable already set in the environment is kept over the file's.
- `bunfig.toml` skips `.env` files, so a project's `.env` never reaches
  Dorothy's environment. The pre-commit hook and `lint:secrets` reject a
  plaintext value in `secrets.json`, any `.env` file and any age secret key.
- Tests and probes never touch the user's key or real data: every root,
  key and environment is passed in, and a test makes its own age key in a
  temporary directory.

This page names no secret, in keeping with the rules.

## Development evidence

The [development evidence procedure](./development-evidence.md) covers
selection, staging, encryption, authentication and recovery. The
repository-owned `development-evidence` skill routes to that procedure;
`scripts/evidence-manifest.ts`, `scripts/evidence-package.ts` and
`scripts/evidence-transfer.ts` expose their current interfaces with
`--help`. They preserve explicit stable staging inputs and encrypted
outputs; transfer uses bucket-scoped S3 credentials loaded from encrypted
secrets, with an explicit account and bucket in both modes. Local tests
cover synthetic data and loopback S3 requests, not live R2 authentication
or large-file multipart transfers. Upload is separate from verified
download and full recovery.

The Pi integration's private captures are preserved as encrypted bundles
in private Cloudflare R2 Standard storage. The
[catalogue and recovery guide](../../reports/2026-11-06_pi-evidence-preservation.md)
link the ordered objects and hashes. That report records its authorized
Cloudflare session; routine helper transfers need the S3 credential pair
and recovery needs the existing age private key. Raw captures stay
outside Git; small sanitized findings and regression fixtures can be
promoted later.

Local originals remain. An additional independent backup destination is
outstanding. The owner's US$5 monthly target is not an R2 hard cap;
budget alerts are informational. The guide records actual verification
and alert setup status, including any outstanding work.

## Keeping documentation current

Documentation lives under `docs/`, in the directories
[`docs/AGENTS.md`](../../AGENTS.md) names: specs for what and why, plans
for how, reports for probes, rulings and verification, notes for research,
deferred findings, and the roadmap. Dated records keep a
`YYYY-MM-DD_<abbreviated-title>.md` name and are not rewritten; living pages
take stable names. Each file opens with frontmatter and a breadcrumb that
`lint:header` checks, and lines are at most 80 characters, inline code
included.

Design work starts with brainstorming and becomes a spec; a plan written
from it is carried out with subagent-driven development; a bug starts with
systematic debugging; nothing is claimed done without verification. The
roadmap orders the phases, and after a phase merges it is
revised as its own Revising section says, ending with a check of the root
and each package's `AGENTS.md` against what merged
([roadmap](../../roadmap.md#revising)).

A change to a package's architecture updates that package's `AGENTS.md` in
the same branch. The wiki has its own rule, from the
[wiki's design](../../specs/2026-11-03_repository-wiki-design.md#maintenance):

- The same branch that changes a subsystem updates its affected wiki pages.
- A phase's roadmap revision also updates the priorities summary.
- New records join the subject catalogue ([records](../records.md)), and a
  changed decision updates its entry with the reason and source.
- Package guides stay the coding instructions; the wiki explains and links
  them rather than copying their inventories.
- One page explains each subject; elsewhere a short answer and a link.
  There is no second priority queue, since the roadmap alone orders work.
- A page's `ctime` stays fixed and its `mtime` changes when the page does.

`docs.test.ts` checks local links and fragments in the root `README.md`,
`docs/README.md`, the roadmap, wiki pages and both root and docs
`AGENTS.md`. It rejects missing records and duplicate catalogue entries
after resolving aliases to the same record. Entries count inline links
and ordinary full, collapsed and shortcut reference uses, matching labels
without regard to case and with normalized whitespace. Unused definitions
do not count as entries; link validation still checks their destinations.
Repeated links to non-record pages are allowed. The occurrence inventory
shares the parser's code-example exclusions and lightweight syntax limits;
it is not a full Markdown renderer. It also checks every wiki page is
linked from home.
Temporary-file fixtures use the same helpers in `scripts/docs-links.ts`
to test valid and broken destinations, fragments, root-relative paths
and percent escapes. The
[follow-up report](../../reports/2026-11-03_wiki-follow-up.md) records the
coverage and remaining parser limits.

## Related

- [Build configuration](./build-configuration.md)
- [Packages](../profiles/packages.md)
- [Orchestration](./orchestration.md)
- [Services and providers](../profiles/services-and-providers.md)
- [Decisions](../decisions.md)
- [Problems](../problems.md)
- [Questions](../questions.md)
