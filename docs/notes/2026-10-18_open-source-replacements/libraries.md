---
ctime: 2026-10-18
mtime: 2026-10-18
spdx: GPL-3.0-only
title: "Dorothy's infrastructure code and the off-the-shelf software that could replace it"
description: >-
  Smaller libraries and tools that could replace hand-written
  infrastructure in Dorothy, area by area.
tags:
  - dorothy
  - notes
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-10-18_open-source-replacements/libraries.md
   -
   -->

# Dorothy's infrastructure code and the off-the-shelf software that could replace it

A research agent's report, kept as it was written apart from its line
wrapping, its em dashes and this header, for the
[note on open-source replacements](../2026-10-18_open-source-replacements.md).

I only read the code and changed nothing. Line counts are non-test `.ts`/`.tsx`
at `aeaa30b`. The whole tree is 27,273 lines, test helpers included.

**Where the version facts come from.** Versions, release dates and licences for
npm packages are from `https://registry.npmjs.org/<name>`. Licence, archive
status, last push and latest release for GitHub repos are from `gh api
repos/<owner>/<repo>` and its `/releases/latest`. Both were queried on
2026-10-18. Anything I could not verify is marked **\[unverified\]**.

---

## 1. Memory history and encrypted mirror

**Code:** `/home/chewygumxx/dev/dorothy/packages/memory/src/history/`, 3,076
lines plus the 53-line `testing.ts`.

- `commands.ts` 755, `history.ts` 593, `binary.ts` 472, `iso.ts` 435,
  `mirror.ts` 258
- `lint.ts` 138, `heal.ts` 123, `seal.ts` 123, `repo.ts` 112, `lock.ts` 40,
  `open.ts` 27

### What it does

- **Repository and engines.** The data directory is a git repository behind a
  `MemoryRepo` interface with two engines:
  - the git binary, isolated from the user's config, hooks, signing and template
    variables, with its own credential helper and ssh batch mode;
  - isomorphic-git, pinned at 1.43.1 (latest is 1.44.3, released 2026-10-17,
    <https://github.com/isomorphic-git/isomorphic-git>). It cannot push to a
    non-https mirror (`NEEDS_BINARY`).
- **Commits.** `MemoryHistory` commits each logical change under the writer's
  lock. It first sweeps up outside edits, keeping a fact's provenance and
  canonicalising it.
- **Lint and heal.** Each file is linted by kind (facts, sidecars, `tags.json`,
  `projects.json`, and transcripts, which may only be appended to). A file that
  fails is healed from its last good version, looking back up to 200 commits,
  and its bad bytes are kept under `broken/`.
- **Pre-commit hook.** It installs one in the data repository.
- **Mirror.**
  - New commits are packed as a git bundle.
  - The bundle is sealed with AES-256-GCM through WebCrypto, with the header as
    associated data.
  - The sealed bundle is appended to the orphan branch `sealed` and pushed
    fast-forward only to a remote called `mirror`, at most once every
    `pushSeconds`.
  - The key is set with `dotenvx set`, and a key that does not open the existing
    bundles is refused.
  - `--recover` replays the chain of bundles.

### Candidates

- **git-remote-gcrypt** (GPL-3.0; a shell script plus GPG; no GitHub releases,
  last commit 2026-08-15; <https://github.com/spwhitton/git-remote-gcrypt>).
  - Encrypts the whole repository, history included, into GPG-encrypted
    packfiles plus a signed manifest.
  - Every push is effectively forced, and the README says: "Be sure to pull
    before pushing."
  - With a git URL or sftp it "requires uploading the entire repository history
    with each push", and it may repack without warning.
  - **Fit:** poor for Dorothy's ever-growing transcripts on a git host; workable
    over rsync to your own server.
  - **Lost:** incremental pushes, needing no GPG, and the wrong-key guard.
- **git-crypt** (GPL-3.0, 0.8.0, 2025-09). Encrypts selected files with
  AES-256-CTR, but "does not encrypt file names, commit messages… or other
  metadata" and is "not the best tool for encrypting most or all of the files"
  (<https://github.com/AGWA/git-crypt>). **Not a fit.**
- **git-annex** (AGPL-3+, 10.20261006;
  <https://git-annex.branchable.com/license/>,
  <https://hackage.haskell.org/package/git-annex>). It encrypts only
  special-remote contents; the repository itself "mostly does not use
  encryption" (<https://git-annex.branchable.com/encryption/>). **Not a fit.**
- **age / rage / typage.**
  - age: BSD-3, v1.3.2, 2026-08-29.
  - rage: Apache-2.0, v0.12.1.
  - npm `age-encryption`: BSD-3, 0.3.1, 2026-08-28, pure TypeScript
    (<https://github.com/FiloSottile/typage>).
  - These could replace only `seal.ts`'s custom format with a standard one, so a
    mirror can be opened with `age -d` without Dorothy. That saves about 90
    lines and gains interoperability.
- **sops** (MPL-2.0, v3.13.3). Encrypts values in structured files and is a poor
  fit for binary bundles (<https://github.com/getsops/sops>); dotenvx already
  covers the secrets themselves.
- **restic** (BSD-2, v0.19.1, 2026-07-05; a Go binary).
  - AES-256-CTR with Poly1305-AES, an scrypt key derivation, and exclusive locks
    (<https://restic.readthedocs.io/en/stable/100_references.html>).
  - Deduplicated snapshots, with many backends including rclone.
  - Running `restic backup` over the data directory, `.git` included, replaces
    sealing, pushing, scheduling and `--recover`.
  - **Lost:** a git host as the mirror, the in-app `--mirror`/`--recover`
    experience, and sealing per commit (unneeded, since `.git` holds every
    commit).
- **kopia** (Apache-2.0, v0.23.1). Same role as restic, with AES-256-GCM or
  ChaCha20-Poly1305 encryptors
  (<https://github.com/kopia/kopia/tree/master/repo/encryption>).
- **borg** (BSD-3, 1.4.5; 2.0 is still beta at 2.0.0b25) and **borgmatic**
  (GPL-3.0, 2.1.10). Need borg running on the server over ssh
  (<https://github.com/borgbackup/borg>).
- **rclone crypt** (MIT, v1.75.2). XSalsa20-Poly1305 per 64 KiB chunk, but file
  sizes, mtimes and (by default) directory structure stay visible, and it keeps
  no versions (<https://rclone.org/crypt/>). Syncing a live `.git` this way is
  risky. **Partial at best.**
- **Syncthing** (MPL-2.0, v2.1.6). Replication, not backup; its encryption for
  untrusted devices "should still be considered beta / testing only"
  (<https://docs.syncthing.net/users/untrusted.html>). **Not a fit.**
- **jj** (Apache-2.0, v0.46.0). Calls itself "experimental", uses Git as
  storage, and documents no encryption (<https://github.com/jj-vcs/jj>). **Not a
  fit.**
- **Plain git with a private remote.** The mirror becomes `git push`, saving
  about 400 lines, but the host can read every transcript.

**Biggest simplification without any new tool:** require the git binary and drop
`iso.ts` (435 lines) and the cross-engine contract tests. isomorphic-git already
defers to the binary for ssh.

**Keep** commit-per-change, sweep, lint and heal: they are Dorothy-specific
(fact provenance, append-only transcripts).

**Verdict: partly replace.** Use restic or kopia for the mirror (or age-format
bundles if it must stay on a git host), and drop isomorphic-git.

## 2. Configuration and XDG

**Code:** `/home/chewygumxx/dev/dorothy/packages/core/src/config.ts` (389) and
`xdg.ts` (29).

**What it does.** It already parses with `Bun.TOML.parse`. Each bad value gives
a warning and falls back to its own default. It warns on unknown keys and checks
`tail < soft < hard`.

Bun's TOML errors carry no position. The docs show only `"TOML Parse error:
Expected a value but found '='"` (<https://bun.com/docs/runtime/toml>), and on
Bun 1.4.2 I confirmed that `e.line`/`e.column` give the JavaScript call site. So
`errorLine()` finds the line by re-parsing ever-shorter prefixes of the file.

### Candidates

- **smol-toml** (BSD-3, 1.9.1, 2026-10-09; TOML 1.1). `TomlError` has `line`,
  `column` and `codeblock`
  (<https://github.com/squirrelchat/smol-toml/blob/mistress/src/error.ts>). That
  replaces `errorLine` (about 15 lines) at the cost of a dependency.
- **zod 4** (MIT, 4.6.7; already in `memory` and `agent`).
  - `.catch((ctx) => …)` gets `ctx.error`, so a field can warn and fall back
    (<https://zod.dev/api>).
  - `z.object` strips unknown keys silently, so the unknown-key warnings still
    need a small pass of their own.
  - **Saves** about 150 of 389 lines. **Loses** the hand-worded messages unless
    each is customised.
- **valibot** (MIT, 1.5.0) and **arktype** (MIT, 2.2.8) would do the same job.
- **c12** (MIT, 4.0.0-rc.2), **cosmiconfig** (MIT, 10.0.1) and **confbox** (MIT,
  0.3.1). Multi-format discovery and merging; overkill for one file.
- **XDG libraries.**
  - xdg-basedir (MIT, 5.1.0, last released 2021) reads `process.env` once at
    import time and accepts relative paths
    (<https://github.com/sindresorhus/xdg-basedir/blob/main/index.js>). That
    breaks both the injected-`Env` rule and the XDG rule `xdg.ts` keeps.
  - env-paths (MIT, 4.0.0) appends `-nodejs` by default and uses macOS `Library`
    paths (<https://github.com/sindresorhus/env-paths>).

**Verdict:** config can be partly replaced (zod, plus smol-toml if line numbers
matter); keep `xdg.ts`.

## 3. CLI argument parsing

**Code:** `/home/chewygumxx/dev/dorothy/packages/cli/src/args.ts` (398).

### What it does

- Modes are selected by a leading flag (`--list`, `--memory <phrase>` and so
  on), not by subcommand words.
- Per-mode options already go through `node:util` `parseArgs`.
- Some modes need a terminal (TTY checks).
- Arguments are validated as four-word phrases.
- `--dev` modifies another mode.
- `--claude` passes its arguments through.
- An unknown option is refused rather than sent, and paid for, as a prompt.

**Candidates** (all MIT): commander 15.0.0, yargs 18.2.0, cac 7.1.0, citty
0.2.2, cleye 2.7.0, gunshi 0.37.3, and clipanion 4.0.0-rc.4 (stale since
2024-09).

- All of them are built around subcommand words. Modelling Dorothy's mutually
  exclusive mode flags in them takes custom code.
- **@optique/core and @optique/run** (MIT, 1.3.6, 2026-10-14) are the closest
  fit (<https://github.com/dahlia/optique>):
  - `or()` for exclusive alternatives, with an inferred discriminated union like
    Dorothy's `Mode` type;
  - `passThrough()` for the `--claude` arguments;
  - generated help and shell completion;
  - support for Node, Deno and Bun.
- The TTY, phrase and `--dev` rules would stay custom. Saves perhaps 100 lines.

**Verdict: keep.** Consider Optique only if the number of modes keeps growing.

## 4. Terminal UI

**Code:** `/home/chewygumxx/dev/dorothy/packages/tui/src` (2,742).

- **Input editor**, 720 lines: `editor.ts` 228, `Input.tsx` 378, `recall.ts` 58,
  `external-editor.ts` 56.
- **Markdown renderer**, 676 lines: `render.ts` 367, `spans.ts` 168,
  `highlight.ts` 99, `Markdown.tsx` 42. It turns marked tokens into styled span
  rows that Ink draws: tables are fitted to the width, lists hang, and
  lowlight's classes are mapped to the 16 ANSI colours.
- **Status line and layout**, 264 lines.
- **Reducer, App and history views**, 1,082 lines.

### Candidates

- **@inkjs/ui** (MIT, 2.0.0, 2024-05): `TextInput` is "single-line"
  (<https://github.com/vadimdemedes/ink-ui>).
- **ink-text-input** (MIT, 6.0.0, 2024): single-line.
- **ink-multiline-input** (MIT, a single release, 0.1.0 in 2026-01): arrows,
  backspace and delete only, with no readline keys
  (<https://github.com/ByteLandTechnology/ink-multiline-input>). **None of these
  covers Dorothy's editor.**
- **marked-terminal** (MIT, 7.3.0, 2025-01):
  - needs marked older than 16 (Dorothy uses 18);
  - uses cli-highlight, last released in 2021;
  - outputs ANSI strings rather than span rows.
- **ink-markdown** (MIT, 1.0.4, 2023): wraps marked 9 and marked-terminal 6.
  Stale.
- **cli-markdown**: GPL-3.0-or-later, 3.5.1.
- **shiki** (MIT, 4.5.0): `@shikijs/cli` exports `codeToANSI`, but in theme
  colours rather than the terminal's palette.
- **OpenTUI** (MIT, 0.6.6, 2026-10-14; <https://github.com/anomalyco/opentui>,
  formerly sst):
  - native core in Zig;
  - engines are Bun ≥1.3.14 and Node ≥26.4;
  - has `Textarea`, `Markdown`, tree-sitter `Code`, `ScrollBox` and React
    bindings;
  - still pre-1.0.
- **pi-tui** (now `@earendil-works/pi-tui`, MIT, 1.3.0, 2026-10-15;
  <https://github.com/earendil-works/pi/tree/main/packages/tui>):
  - differential rendering;
  - its `Editor` has a kill ring, an undo stack, prompt history and readline
    keys (`kill-ring.ts`, `undo-stack.ts`, `addToHistory`);
  - a `Markdown` component with pluggable code highlighting;
  - it is imperative, not React;
  - its engines say Node ≥22.19 and it ships N-API prebuilds. **Bun support
    \[unverified\].**
- **Ink 8.0.0** (2026-10-03) requires React 19.3 and still has no text input
  (<https://github.com/vadimdemedes/ink/releases/tag/v8.0.0>). Dorothy is on Ink
  ^7.1.1.
- **Glow/Glamour/Bubble Tea** (Go, MIT; Bubble Tea is at v2.1.0), **Textual**
  (Python, MIT, v8.2.8) and **Ratatui** (Rust, MIT, 0.30.2) all mean rewriting
  the whole UI in another language.

**What a move to pi-tui would remove:** about 1,100 lines (editor plus
Markdown). But App, History and the status line would be rewritten, and the
frame tests built on ink-testing-library would be lost.

**Verdict: keep on Ink.** If the TUI is ever rewritten, pi-tui is the best
match, with OpenTUI next.

## 5. Locks

**Code:** `/home/chewygumxx/dev/dorothy/packages/memory/src/sqlite-lock.ts` (41)
and `history/lock.ts` (40), 81 in all. This already *is* SQLite's own locking:
`BEGIN IMMEDIATE`, queued in-process, released by the operating system if the
process dies, with a 5 s `busy_timeout` for `FileLock`.

### Candidates

- **proper-lockfile** (MIT, 4.1.2, last released 2021). Uses `mkdir` with
  mtime-based staleness and "compromised" lock states
  (<https://github.com/moxystudio/node-proper-lockfile>). That would be weaker
  than what Dorothy has.
- **lockfile** (ISC, 1.0.4, 2018). Stale.
- **fs-ext** (MIT, 2.1.1). Its `flock` is a NAN/node-gyp addon. **Bun support
  \[unverified\].**

### Verdict: keep

## 6. Transcripts and secret scrubbing

**Code:** `/home/chewygumxx/dev/dorothy/packages/memory/src/transcript.ts` (516:
the versioned JSONL event schema, its writer and readers) and `scrub.ts` (84).

`scrub.ts` covers four kinds of secret:

- private-key blocks, including ones cut short;
- Bearer, Basic and token authorisation values;
- about eight provider key prefixes;
- a bounded, ReDoS-hardened `key=value` rule.

### Candidates

- **secretlint** (MIT, 13.0.7, 2026-10-03).
  - The recommended preset has 28 rules: AWS, GCP, GitHub, GitLab, Slack,
    OpenAI, Anthropic, Groq, Hugging Face, database connection strings, and
    others
    (<https://www.npmjs.com/package/@secretlint/secretlint-rule-preset-recommend>).
  - `@secretlint/core` exports an async `lintSource()` that returns match ranges
    (<https://github.com/secretlint/secretlint/blob/master/packages/%40secretlint/core/src/index.ts>).
  - Wider provider coverage, but `toolEntry` would have to become async and it
    pulls in a dependency tree. It has no generic `password=` rule equivalent to
    Dorothy's **\[unverified beyond the preset list\]**.
- **gitleaks** (MIT, v8.30.1). 222 rules in `config/gitleaks.toml`
  (<https://github.com/gitleaks/gitleaks>), plus stdin and `--redact` modes.
  Best used as a *data source*: port its regexes into `scrub.ts`.
- **TruffleHog** (AGPL-3.0, v3.99.2). 800+ detectors, and it verifies secrets by
  logging in with them (<https://github.com/trufflesecurity/trufflehog>). That
  is wrong for redaction.
- **detect-secrets** (Apache-2.0). Python; last release v1.5.0 in 2024-05.
- `redact-pii` (2022) and `@redactpii/node` target personal data, not
  credentials.

**Verdict: keep, and widen the patterns** from gitleaks or secretlint.
`transcript.ts` is Dorothy's own schema: keep.

## 7. Full-text recall index and MCP server

**Code:** `/home/chewygumxx/dev/dorothy/packages/memory/src/recall/` (2,726).

- `query.ts` 966, `sync.ts` 550, `server.ts` 369, `store.ts` 350, `remember.ts`
  178, `tags.ts` 159, `facts.ts` 154.

### What it does

- `store.ts` sets up three FTS5 tables (`porter unicode61 remove_diacritics 2`)
  with bm25 ranking and `snippet()`.
- The same database also holds visits, reads, appraisals, review claims, the
  vocabulary mirror and facts, and it doubles as the sidecar write lock.
- Most of `query.ts` is domain logic: salience, tag scope, windows of turns,
  hidden conversations.

### Candidates

- **Orama** (Apache-2.0, 3.1.18, 2025-12): full-text, vector and hybrid search,
  BM25, 30 languages, with persistence as a plugin
  (<https://github.com/oramasearch/orama>).
- **MiniSearch** (MIT, 7.2.0) and **FlexSearch** (Apache-2.0, 0.8.212):
  in-memory.
- **Lunr** (MIT, 2.3.9, 2020): stale.
- **Tantivy** (MIT, 0.26.1): Rust, with Python bindings only. I found no
  maintained npm binding (`tantivy-js` and `@tantivy/tantivy` don't exist).
- **Meilisearch** (MIT, with Enterprise parts under BUSL-1.1) and **Typesense**
  (GPL-3.0): servers.

Each of these would drop the locking and claims that SQLite gives Dorothy for
free, and none removes the domain logic. **Keep FTS5.**

**For semantic search later:** sqlite-vec (MIT/Apache, v0.1.9, still alpha)
loads into `bun:sqlite` with `loadExtension`. macOS needs
`Database.setCustomSQLite` (<https://bun.com/docs/runtime/sqlite>,
<https://alexgarcia.xyz/sqlite-vec/js.html>).

**MCP server.** `server.ts` already uses `McpServer.registerTool`, and about 90
of its lines are tool descriptions.

- **FastMCP** (MIT, 4.22.10) is "built on top of the official SDK" and
  implements only the older protocol revisions
  (<https://github.com/punkpeye/fastmcp>).
- **xmcp** (MIT, 1.7.2) is a framework that auto-registers tools from
  directories (<https://github.com/basementstudio/xmcp>).
- Either would save fewer than 50 lines.
- **The real maintenance item:** the SDK's v2 (`@modelcontextprotocol/server`
  2.3.1) is now "the stable release line". v1 gets fixes for at least six months
  after 2026-07-27 (<https://github.com/modelcontextprotocol/typescript-sdk>),
  and an `@modelcontextprotocol/codemod` package exists.

**Verdict: keep both.** Plan the move to SDK v2.

## 8. Tag vocabulary

**Code:** `/home/chewygumxx/dev/dorothy/packages/memory/src/memory/`
`vocabulary.ts` (495), `tagging.ts` (250) and `tags-view.ts` (596), 1,341 in
all, plus `recall/tags.ts` (159).

**What it does.** It is JSON shaped after SKOS, using no RDF:

- concepts have `prefLabel`, `altLabel`, `broader` (several parents allowed,
  cycles checked) and `scopeNote`;
- deleted and merged concepts leave tombstones;
- model output is read leniently;
- users get a text view to edit (`Under:`/`Merge:`).

**Libraries.** jsonld (BSD-3, 9.0.0), rdflib (MIT, 2.4.1) and n3 (MIT, 2.13.12)
provide RDF serialisation. None of them provides tombstones, merges, label
resolution, the cycle-safe coining step or the edit view. They would only *add*
code.

**Does SKOS earn its keep?** The spec's own findings say she "coins hierarchy
unprompted" and adds alternative labels (`docs/reports/2026-10-08-tags.md`).

- The parts that clearly pay off are **altLabel** (merging near-duplicates the
  model coins) and **tombstones** (a user's deletion stays deleted).
- The polyhierarchy, meaning several parents, cycle checks, the tree view and
  the `Under` edits, is roughly 300 to 500 lines. It mainly serves `--tags` and
  searching by a broader tag.
- A flat list with aliases, or slash-nested tags as most note tools use, would
  keep most of the value.

**Verdict:** no library replaces it. Keep the format; simplifying the hierarchy
is a design choice worth about 400 to 600 lines.

## 9. Project fact sync

**Code:** `/home/chewygumxx/dev/dorothy/packages/memory/src/projects/` (1,253):
`sync.ts` 607, `registry.ts` 263, `export.ts` 222, `identify.ts` 161.

### What it does

- A three-way reconciliation against per-checkout, per-directory hashes of what
  both sides last held. "Repository wins" on conflict.
- Retires facts instead of deleting them.
- Re-reads a file before overwriting it, refuses symlinks and `..`, and skips
  files over 64 KiB.
- Converts between the store's canonical form and the export format.
- Generates a `MEMORY.md` index. Its 200-line and 25 KB limits match Claude
  Code's auto-memory, which loads "the first 200 lines … or the first 25KB"
  (<https://code.claude.com/docs/en/memory>).

### Candidates

- **Unison** (GPL-3.0, v2.54.0). Tracks state between the two sides, and
  `-prefer` picks a side on conflict
  (<https://man.archlinux.org/man/unison.1.en>). Its maintainers estimate about
  0.1 full-time effort (<https://github.com/bcpierce00/unison>).
- **rclone bisync**. `--conflict-resolve path1|path2|newer`, needs `--resync` on
  the first run, and is described as "an advanced command, so use with care"
  (<https://rclone.org/bisync/>).
- **Syncthing**. Continuous replication.

All three sync bytes between identical trees. None converts formats, maps one
store to many checkouts, retires instead of deleting, or writes an index.

**Conventions.** Claude Code reads `AGENTS.md` natively (v2.1.277 and later),
and auto-memory can be pointed at a directory with `autoMemoryDirectory`, which
must be absolute or start with `~/` (same page). That justifies
`scripts/agent-memory.ts`. I found no cross-tool standard for a memory directory
(a web search turned up none).

**Verdict: keep.** The only large saving is a design change: make the
repository's `.agents/memory/` canonical and index it read-only, which removes
most of the 1,253 lines.

## 10. Claude Code session recording

**Code:** `/home/chewygumxx/dev/dorothy/packages/memory/src/bodies/` (2,332):
`hook.ts` 673, `claude-code.ts` 510, `record.ts` 370, `unread.ts` 271,
`launches.ts` 252, `launch.ts` 101, `fixtures.ts` 81, `log.ts` 74.

Claude Code-only code outside it is 1,231 lines:

- `cli/src/claude.ts` 835, `claude-hook.ts` 245, `claude-dump.ts` 99,
  `recall-launch.ts` 32;
- `memory/src/claude-hook.ts` 20.

### What it does

- Claude Code's `Stop` and `SessionEnd` hooks run `dorothy --claude-hook`.
- The hook maps the undocumented JSONL lines to Dorothy's events, resuming after
  the last `sourceUuid` it recorded.
- On a line shape it does not expect, it stops reading and keeps the rest aside,
  mode 0600.
- It records, commits and reviews.

### Candidates

- **claude-code-log** (MIT; on PyPI, 1.7.0, Python;
  <https://github.com/daaain/claude-code-log>). JSONL to HTML or Markdown, with
  a TUI. The npm package with that name is an unrelated fork.
- **ccusage** (MIT, 20.0.35). Token and cost analytics only
  (<https://github.com/ccusage/ccusage>).
- **SpecStory CLI** (Apache-2.0, v2.15.1). Wraps agents and saves Markdown to
  `.specstory/history/`; cloud sync is optional
  (<https://github.com/specstoryai/getspecstory>).
- **cass** (Rust, v0.10.0). Its licence is "MIT with OpenAI/Anthropic Rider",
  which bars those companies and anyone acting "for the benefit of" them. **Not
  OSI open source**
  (<https://github.com/Dicklesworthstone/coding_agent_session_search>).
- **Agent Sessions** (MIT, v5.7). A macOS app only
  (<https://github.com/jazzyalex/agent-sessions>).
- None of these feeds an external store or hooks into reviews. They are viewers.
- **Documented interfaces worth knowing.**
  - **OpenTelemetry events.** Claude Code emits `user_prompt`,
    `assistant_response` (redacted unless `OTEL_LOG_ASSISTANT_RESPONSES=1`; text
    blocks only, cut at 60 KB), and `tool_result` (with inputs under
    `OTEL_LOG_TOOL_DETAILS=1`)
    (<https://code.claude.com/docs/en/monitoring-usage>).
    - Dorothy would need its own OTLP log receiver.
    - Events are lost if the receiver is down, whereas JSONL on disk is durable.
  - **Agent SDK session reader.** The SDK's `getSessionMessages()` reads
    transcripts (<https://code.claude.com/docs/en/agent-sdk/sessions>). But only
    `agent` may import the SDK, and the mapping to Dorothy's events would
    remain.

### If Claude Code is dropped

- the 2,332 lines in `bodies/` and the 1,231 CLI lines go;
- the gateway (419 lines, Anthropic protocol) probably goes too;
- `export.ts`'s auto-memory format loses its consumer.

`record.ts`, `unread.ts`, `log.ts` and the launch notes are worth keeping as the
pattern for the next host's recorder.

**Verdict:** keep while Claude Code is used; delete it with Claude Code.

## 11. Dev tooling

### Off the shelf

- husky 9.1.7 and commitlint 21.2.3, with `@chewygumxx/commitlint-config`.
- commitizen 4.3.2 with `@chewygumxx/cz-commitlint`.
- remark-cli 12.0.1 with `@chewygumxx/remark-preset` (gfm, frontmatter, and the
  recommended and consistent presets).
- markdownlint-cli2 0.23.3.
- Biome 2.5.15, prettier 3.9.10 (YAML only) and yamllint 1.38.0 (installed
  through mise and uv).
- dotenvx 2.38.0, TypeScript 7, and mise.
- The `skills` CLI 1.7.2 (<https://github.com/vercel-labs/skills>).
- The superpowers skills, pinned at v6.4.1; **v7.0.0 came out 2026-10-10**
  (<https://github.com/obra/superpowers>).
- sync-header-metadata 2.4.2, the owner's own package (GPL-3.0, on npm).

### Custom

- `scripts/agent-memory.ts` (95) and `scripts/prepare.sh` (28).
- Four husky hooks.
- The `lint:emdash` and `lint:env` script wrappers.
- `agents.test.ts` and `workspace.test.ts`.
- A Claude hook, `prohibit-em-dash.sh`.

### Duplicates

- **Two Markdown linters**: remark-lint and markdownlint overlap.
- **YAML is checked twice**: prettier `--check` and yamllint cover the same
  formatting.
  - Prettier has to stay for now: Biome's YAML and Markdown support is still "in
    progress" (<https://biomejs.dev/internals/language-support/>).
- **The em dash ban is enforced three times**: the `lint:emdash` script, the
  pre-commit hook and the Claude hook.
- **commitizen** adds little when agents write the commits.
- **Biome runs twice**: `format:check` and `lint` are separate runs where one
  `biome ci` would do.
- **Undeclared tools**: `.tombi.toml` and `.moxide.toml` configure tools that
  neither mise nor `package.json` declares, which breaks the repository's own
  "declare every utility" rule.

---

## Summary

| Area | Dorothy lines | Best replacement | Lines likely removed | Verdict |
| --- | --- | --- | --- | --- |
| 1. History and mirror | 3,076 | restic or kopia for the mirror; git binary only | ~1,300 (~900 mirror/seal/recover, ~435 isomorphic-git engine) | Partly replace |
| 2. Config and XDG | 418 | zod 4 `.catch`, plus smol-toml for line numbers | ~150 | Partly replace (optional); keep `xdg.ts` |
| 3. CLI args | 398 | @optique/core + run | ~100 | Keep |
| 4. TUI | 2,742 | Stay on Ink; pi-tui if ever rewritten | 0 on Ink (~1,100 if moved, with a rewrite) | Keep |
| 5. Locks | 81 | Already SQLite locking | 0 | Keep |
| 6. Transcripts and scrub | 600 | gitleaks or secretlint patterns as data | ~0 (adds coverage) | Keep, widen rules |
| 7. Recall index and MCP | 2,726 | FTS5 already; MCP SDK v2 | <50 | Keep; migrate to SDK v2 |
| 8. Tags | 1,341 (+159) | No library; flat tags with aliases | 400 to 600 (design change) | Keep format, consider simplifying |
| 9. Project sync | 1,253 | None fits (Unison and bisync sync bytes only) | 0 (~1,000 by making the repo canonical) | Keep |
| 10. Claude Code recording | 2,332 + 1,231 CLI | None fits; OpenTelemetry is a partial feed | 0 now; ~3,500+ when Claude Code goes | Keep, then delete |
| 11. Dev tooling | 123 + hooks | Already off the shelf | Small (remove duplicates) | Keep; dedupe; update superpowers |

**Overall.** Swapping in libraries or tools removes about 1,500 to 1,700 lines
of the ~27k, almost all of it in history (the mirror and the second engine).
Dropping Claude Code (about 3,500 lines) and simplifying tags or project sync
are design choices, not library swaps.
