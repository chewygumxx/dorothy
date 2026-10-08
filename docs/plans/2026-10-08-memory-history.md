---
ctime: 2026-10-08
mtime: 2026-10-08
spdx: GPL-3.0-only
title: Memory history implementation plan
description: "Plan for keeping Dorothy's data directory as a git repository, with recovery and a sealed mirror"
tags:
  - dorothy
  - memory
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-08-memory-history.md
   -
   -->

# Memory History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dorothy's data directory becomes a git repository: every change
to her memory is a commit, a lint guards each commit, a broken file is
restored from history automatically, and the history is pushed, sealed, to
a mirror.

**Architecture:** `src/history/` holds a `MemoryRepo` interface with two
engines, the git binary (`binary.ts`) and isomorphic-git (`iso.ts`), chosen
once per process (`open.ts`). `lint.ts` checks a file by its kind,
`heal.ts` restores a broken one, and `MemoryHistory` (`history.ts`) adopts
the directory, records each logical change under the write lock, sweeps up
outside changes and warns. Memory's writers record through an injected
`Recorder` and never import history. `mirror.ts` seals new commits as
AES-256-GCM bundles (`seal.ts`) on an orphan branch and pushes it;
`commands.ts` serves `--history`, `--restore`, `--rollback`, `--check`,
`--mirror` and `--recover`.

**Tech Stack:** Bun 1.4 (`bun:sqlite`, `Bun.spawn`, Web Crypto, `bun test`),
TypeScript 7, git 2.56 (the binary), isomorphic-git 1.43.1,
`@dotenvx/dotenvx` 2.32, Ink.

**Spec:** `docs/specs/2026-10-08-memory-history-design.md`, which builds on
`docs/specs/2026-10-07-tags-design.md` and
`docs/specs/2026-10-05-conversation-catalogue-design.md`.

## Global Constraints

- Every new source file starts with the repository header, copied from
  `src/persona.ts` with its own path in the `::: :/` breadcrumb.
- No em dashes (U+2014) in any file; `bun run lint:emdash` must pass.
- Commits: Conventional Commits, header at most 50 characters, body lines
  at most 72, one line unless a body is warranted. Scopes, as
  `.commitlintrc.mts` allows: `sdk` for `src/` outside `src/tui/`, `tui`
  for `src/tui/`; docs take no scope; `build` changes to `package.json`
  and `bun.lock` take `build` as their type and no scope. Each task's
  commit command gives the exact message.
- Before each commit run `bunx biome check --write <touched files>`; the
  pre-commit hook rejects unformatted files and import order.
- After committing, confirm with `git log --oneline -1` and `git status`.
- Work on the plain branch `feat/memory-history` in the main checkout; no
  worktrees.
- Nothing in `src/history/` imports `@anthropic-ai/claude-agent-sdk` or
  `src/tui/`; nothing in `src/memory/` imports `src/history/`
  (`src/history/boundary.test.ts`, Task 1).
- Never edit `dist/`. Set `.env` values only with `dotenvx set` (in code,
  dotenvx's `set`).
- Tests and probes never touch real user data: every repository root,
  transcripts directory, vocabulary path, key and environment is a
  temporary directory or a value passed in. Tests that run the git binary
  pass an environment whose `GIT_CONFIG_GLOBAL` is `/dev/null` or a
  temporary file, never the user's.
- Values, verbatim from the spec:
  - the author `Dorothy <dorothy@localhost>`;
  - the branch `main`, the orphan branch `sealed`, the remote `mirror`,
    the ref `refs/dorothy/sealed-through`;
  - `.gitignore` holds `*.tmp`;
  - a broken copy is `broken/<path>.<UTC stamp>`;
  - a sealed file is `bundles/<six-digit sequence>.enc`, its header
    `dorothy-sealed 1\n<nonce, base64>\n`, AES-256-GCM, a 12-byte nonce;
  - `DOROTHY_MIRROR_KEY` is 32 bytes in base64; `DOROTHY_MIRROR_TOKEN` is
    the https token for isomorphic-git;
  - `[history] enabled = true`, `push-seconds = 60`;
  - commit messages: `adopt: <n> files`, `review: <phrase> (dorothy, <model>)`,
    `edit: <phrase> (user)`, `edit-tags: <n> concepts (user)`,
    `compaction: <phrase> (dorothy, <model>)`, `turn: <phrase> #<n>`,
    `outside: <path>`, `catch-up: <paths>`,
    `restore: <path> from <short sha> (broken kept)`,
    `rollback: to <short sha> (user)`;
  - the warning `Restored <path> from <short sha> (<date>); the broken copy is in broken/`;
  - the reminder `memory has no mirror · dorothy --mirror <url>`.
- `bun run check` passes at the end of every task.

## Rulings

Decisions made while planning, each against the spec; the spec stays the
authority where these are silent.

1. **Compaction is recorded in `src/tui/run.tsx`.** The spec's module table
   names `src/compaction/run.ts`, but compaction saves its clusters through
   `clusterSaver` in `run.tsx`; that is where the recording goes, and
   `src/compaction/` is unchanged.
2. **Isolation flags.** `core.hooksPath=/dev/null` (an empty value is not a
   reliable "no hooks"), plus `--no-verify` on every commit, `gc.auto=0`
   and `maintenance.auto=false`, so a commit never pauses to collect
   garbage; `maintain()` runs `git gc -q` instead. The credential helpers
   are carried over through `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<i>` and
   `GIT_CONFIG_VALUE_<i>`, not `-c`, for pushes and fetches only. Verified
   against git 2.56: with these, neither a global nor a repository hook
   runs and nothing is signed.
3. **`MemoryRepo` is wider than the spec's sketch.** It adds `exists`,
   `init`, `files`, `resolve` (for `ref`), `setRef`, `appendSealed`,
   `sealedNames`, `sealedFile`, `setRemote`, `remote`, `fetch` and
   `checkout`, which sealing and recovery need; `Commit` has no `paths`,
   which nothing reads.
4. **A commit takes the whole index.** Both engines stage the named paths
   and commit the index, so a change the user staged by hand in the data
   directory rides along with Dorothy's next commit. Dorothy stages only
   right before committing, so this needs the user to have staged
   something themselves.
5. **More messages.** The spec's table covers changes; the service has
   four write sites, so: `title: <phrase> (prompt)` for the provisional
   title, `review: <phrase> (dorothy, nothing new)` when every note is the
   user's, `review: <phrase> (dorothy, failed)` for a failed review's
   mark. A transcript found changed by a sweep is committed as
   `turn: <phrase>` (no count: the sweep does not know it). A file with no
   good version is committed aside as
   `broken: <path> kept, no good version`. A sealed commit is
   `seal <sequence>`.
6. **Recovery walks at most 200 commits** of the file's history.
7. **Memory never imports history.** `Recorder`, `Recording`,
   `HistoryHandle` and `OpenHistory` are types in `src/memory/sidecar.ts`;
   `MemoryService` takes a `HistoryHandle` as `versions` (its `history`
   option already holds the resumed turns), and the memory commands take an
   `openHistory` factory that `src/index.ts` builds from `src/history/`.
8. **One lock per process.** History commits under `index.lock` when the
   recall index is open, and under a `FileLock` on `.git/dorothy.lock`
   otherwise; writers that had no lock without the index now take
   history's. A process without the index and one with it do not exclude
   each other, as for sidecars today.
9. **`--check --staged` checks the repository in the current directory**,
   which is where git runs a hook, and needs the git binary: the hook only
   ever runs under it.
10. **Healing at read time happens only outside the lock**, since
    `RecallIndex.exclusive` is not re-entrant: before a review, when the
    vocabulary or the reviewed conversation's sidecar reads as broken.
    Inside a review's write (`#tag`) a broken vocabulary still skips tags,
    as today.
11. **The hook** runs `<bun> <entry script> --check --staged`, from
    `process.execPath` and `process.argv[1]`; it is rewritten at each open
    while it carries the line `# dorothy pre-commit`, a hook without that
    line is the user's and never replaced, and a missing entry script
    skips the lint with a message rather than blocking the user's commit.
12. **`--list` and `--tags` sweep too**, as `--memory` and `--edit-tags`
    do: every command that reads memory heals first.
13. **`--restore` keeps the replaced file** under `broken/` even when it
    was valid, as the spec's "the same two commits" says.
14. **isomorphic-git's bundles are not delta-compressed**
    (`packObjects` writes whole objects), so a sealed bundle under the
    fallback carries each changed file whole. The binary's are deltas.
15. **Restoring a live transcript** that another running TUI appends to
    leaves that TUI appending to the replaced file's inode until it
    reopens it. It needs the live transcript to be broken; accepted.
16. **Sealing happens under the lock; pushing does not.** A push may take
    seconds on the network and must not hold up writers. A push is tried
    at each scheduled turn even when nothing new was sealed, so a failed
    one is retried.
17. **An existing `DOROTHY_MIRROR_KEY` is never replaced.** `--mirror`
    generates a key only when none is set; one that is set but is not 32
    bytes of base64 is an error, never overwritten, since bundles already
    sealed under it would be lost.
18. **Paths in commits use `/`**, relative to the data directory; a path
    outside it is ignored.
19. **isomorphic-git trusts file stats.** Its `changed()` reads a file as
    unchanged when its size and modification time match the index, so a
    rewrite of the same size within the second of the last commit goes
    unlisted until it changes again. Dorothy's own commits re-hash what
    they stage, and a broken file is still caught when it is read; only
    the sweep of outside changes can miss one. The contract's edit changes
    a file's size for that reason.
20. **The chat opens the index first.** `runTui` read a resumed chat's
    transcript and notes before it opened the index, but history must
    sweep, under the index's lock, before anything is read. The index now
    opens first, deciding by `config.compaction.enabled` rather than by
    whether the notes read; when memory and recall are both off and a
    resumed chat's notes are broken, the index opens and serves nothing.
21. **`--mirror` says whether commits wait, not how many.** The spec's
    status line counts them; counting means walking main back to the last
    sealed commit for a number nobody acts on. It prints `Waiting: yes` or
    `no`, beside the last sealed commit.

## Review Focus

The five inputs most likely to bite a person that no task's main tests
exercise; each has a test in the task named.

1. **A file name with a space** (a hand-copied transcript, or a test
   fixture): every engine commits, shows and lists it unquoted (Task 3's
   contract, `core.quotePath=false`).
2. **Another running TUI's live transcript** found changed by a commit:
   it is committed as `turn: <phrase>`, never `outside:` (Task 6).
3. **A broken file met mid-run** while the lock is held: healing never
   runs inside the lock, so it never deadlocks (Task 7: a review over a
   broken vocabulary heals before its write, and `#tag` never heals).
4. **A malformed `DOROTHY_MIRROR_KEY` already set**: `--mirror` refuses
   and leaves it, rather than generating a new key over it (Task 9).
5. **`--recover` into a data directory that holds anything**: refused
   before anything is written (Task 9).

## Files

| File                              | Task | Responsibility                                                                 |
| --------------------------------- | ---- | ------------------------------------------------------------------------------ |
| `src/history/lint.ts`             | 1    | pure: a file's kind; the lint                                                  |
| `src/history/boundary.test.ts`    | 1    | no SDK or TUI in history; memory never imports history                         |
| `src/history/seal.ts`             | 2    | the mirror key; sealing and opening bundles; sealed names                      |
| `src/history/repo.ts`             | 3    | `MemoryRepo`, `Commit`, the refs and author; `hasGitBinary`                    |
| `src/history/binary.ts`           | 3    | the git binary engine, isolated                                                |
| `src/history/testing.ts`          | 3    | test helpers: temporary roots, files, a bare repository                        |
| `src/history/repo.test.ts`        | 3, 4 | the contract, run against both engines                                         |
| `src/history/iso.ts`              | 4    | the isomorphic-git engine                                                      |
| `src/history/open.ts`             | 4    | choosing the engine                                                            |
| `src/history/cross.test.ts`       | 4    | one engine writes, the other reads                                             |
| `src/memory/sidecar.ts`           | 5, 6, 7 | `writeAtomic` takes bytes; history's types; `updateSidecar` records         |
| `src/history/heal.ts`             | 5    | the newest good version; restoring a file; broken copies                       |
| `src/history/lock.ts`             | 6    | `FileLock`, history's own lock                                                 |
| `src/history/history.ts`          | 6    | `MemoryHistory`; `openHistory`; the hook                                       |
| `src/config.ts`                   | 6    | `[history]`                                                                    |
| `src/memory/vocabulary.ts`        | 7    | `updateVocabulary` records                                                     |
| `src/memory/service.ts`           | 7    | records reviews and titles; heals before a review                              |
| `src/memory/commands.ts`          | 7    | sweeps before reading; records `--memory` and `--edit-tags`                    |
| `src/history/commands.ts`         | 7, 9 | the opener for memory's commands; history's own commands                       |
| `src/history/mirror.ts`           | 8    | sealing pending commits; pushing; recovering                                   |
| `src/index.ts`                    | 7, 9 | passes the opener; the new modes; decrypting for the mirror                    |
| `src/tui/run.tsx`                 | 10   | opens history; turn commits; compaction's recording; the mirror; notices       |
| `README.md`, `.claude/CLAUDE.md`  | 10   | describe history                                                               |
| `docs/reports/2026-10-08-memory-history.md` | 11 | the live probe                                                        |

---

### Task 1: The lint

**Files:**

- Create: `src/history/lint.ts`
- Create: `src/history/lint.test.ts`
- Create: `src/history/boundary.test.ts`

**Interfaces:**

- Consumes: `parseVocabulary(text)` from `src/memory/vocabulary.ts` and
  `parseSidecar(text)` from `src/memory/sidecar.ts`, each returning
  `{ kind: "ok", ... } | { kind: "unparseable"; reason: string }`.
- Produces:
  - `type FileKind = "vocabulary" | "sidecar" | "transcript" | "other"`
  - `fileKind(path: string): FileKind`, for a path relative to the data
    directory with `/` separators
  - `lint(path: string, bytes: Uint8Array, committed: Uint8Array | null): string | null`:
    `null` when the file may be committed, otherwise the reason.
    `committed` is the file as last committed, or `null`; only transcripts
    use it.

- [ ] **Step 1: Write the boundary test**

Create `src/history/boundary.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/boundary.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Glob } from "bun";

// Every source file under a directory, nested ones included, this one
// aside.
async function sources(dir: string): Promise<{ path: string; text: string }[]> {
    const files: { path: string; text: string }[] = [];
    for await (const path of new Glob("**/*.ts").scan(dir)) {
        const full = join(dir, path);
        if (full !== join(import.meta.dir, import.meta.file)) {
            files.push({ path, text: await Bun.file(full).text() });
        }
    }
    return files;
}

const importing = async (dir: string, pattern: RegExp) =>
    (await sources(dir))
        .filter(({ text }) => pattern.test(text))
        .map(({ path }) => path);

describe("history", () => {
    it("imports nothing from the Agent SDK", async () => {
        expect(
            await importing(import.meta.dir, /@anthropic-ai\/claude-agent-sdk/),
        ).toEqual([]);
    });

    it("imports nothing from the TUI", async () => {
        expect(await importing(import.meta.dir, /from "\.\.\/tui\//)).toEqual(
            [],
        );
    });

    // Memory's writers record through what they are given.
    it("is never imported by memory", async () => {
        expect(
            await importing(
                join(import.meta.dir, "..", "memory"),
                /from "\.\.\/history\//,
            ),
        ).toEqual([]);
    });
});
```

- [ ] **Step 2: Write the failing lint tests**

Create `src/history/lint.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/lint.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { EMPTY_SIDECAR } from "../memory/sidecar.js";
import { fileKind, lint } from "./lint.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const event = (kind: string, text = "hi") =>
    `${JSON.stringify({ v: 1, kind, at: "2026-10-08T00:00:00.000Z", text })}\n`;
const GROWS = "it changed before its end, and a transcript only grows";

describe("fileKind", () => {
    it("knows the vocabulary, sidecars and transcripts by where they sit", () => {
        expect(fileKind("tags.json")).toBe("vocabulary");
        expect(fileKind("transcripts/a-b-c-d.meta.json")).toBe("sidecar");
        expect(fileKind("transcripts/a-b-c-d.jsonl")).toBe("transcript");
        expect(fileKind("broken/tags.json.2026-10-08T00-00-00-000Z")).toBe(
            "other",
        );
        expect(fileKind("transcripts/nested/x.jsonl")).toBe("other");
        expect(fileKind(".gitignore")).toBe("other");
    });
});

describe("lint", () => {
    it("passes a vocabulary that parses and says why one does not", () => {
        expect(
            lint("tags.json", bytes('{"v":1,"rev":0,"concepts":{}}\n'), null),
        ).toBeNull();
        expect(lint("tags.json", bytes("{"), null)).not.toBeNull();
        expect(
            lint("tags.json", bytes('{"v":2,"rev":0,"concepts":{}}'), null),
        ).not.toBeNull();
    });

    it("passes a sidecar that parses", () => {
        const path = "transcripts/a-b-c-d.meta.json";
        expect(lint(path, bytes(JSON.stringify(EMPTY_SIDECAR)), null)).toBeNull();
        expect(lint(path, bytes("[]"), null)).toBe("not a JSON object");
        expect(lint(path, bytes('{"v":2}'), null)).toBe("unknown version 2");
    });

    it("refuses a vocabulary or sidecar that is not UTF-8", () => {
        expect(lint("tags.json", new Uint8Array([0xff, 0xfe]), null)).toBe(
            "it is not UTF-8",
        );
    });

    it("passes anything else", () => {
        expect(lint(".gitignore", new Uint8Array([0xff]), null)).toBeNull();
    });
});

describe("lint on transcripts", () => {
    const path = "transcripts/a-b-c-d.jsonl";
    const two = event("user") + event("assistant");

    it("passes whole events, and a torn last line", () => {
        expect(lint(path, bytes(two), null)).toBeNull();
        expect(lint(path, bytes(`${two}{"v":1,"ki`), null)).toBeNull();
        expect(lint(path, bytes(""), null)).toBeNull();
    });

    it("names the first line that is not an event", () => {
        expect(lint(path, bytes(`${event("user")}not json\n`), null)).toBe(
            "line 2 is not JSON",
        );
        expect(lint(path, bytes(`${event("user")}{"v":1}\n`), null)).toBe(
            "line 2 is not an event with v and kind",
        );
        expect(lint(path, bytes(`${event("user")}[1]\n`), null)).toBe(
            "line 2 is not an event with v and kind",
        );
        expect(lint(path, new Uint8Array([0xff, 0x0a]), null)).toBe(
            "line 1 is not JSON",
        );
    });

    it("passes what grows from the committed text", () => {
        expect(lint(path, bytes(two), bytes(event("user")))).toBeNull();
        expect(lint(path, bytes(two), bytes(two))).toBeNull();
    });

    it("refuses a truncation or a rewritten earlier line", () => {
        expect(lint(path, bytes(event("user")), bytes(two))).toBe(GROWS);
        expect(
            lint(
                path,
                bytes(event("user", "edited") + event("assistant")),
                bytes(two),
            ),
        ).toBe(GROWS);
    });

    it("checks only the lines that start after the committed end", () => {
        // A torn line was committed, and a resumed chat appended after it.
        const torn = `${event("user")}{"v":1,"ki`;
        expect(
            lint(path, bytes(`${torn}${event("assistant")}`), bytes(torn)),
        ).toBeNull();
        expect(
            lint(path, bytes(`${torn}${event("assistant")}oops\n`), bytes(torn)),
        ).toBe("line 3 is not JSON");
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/history/`
Expected: FAIL, `lint.test.ts` with "Cannot find module './lint.js'"; the
three boundary tests pass.

- [ ] **Step 4: Write the lint**

Create `src/history/lint.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/lint.ts
//
//

import { parseSidecar } from "../memory/sidecar.js";
import { parseVocabulary } from "../memory/vocabulary.js";

// What a path in the data directory holds, by where it sits.
export type FileKind = "vocabulary" | "sidecar" | "transcript" | "other";

export function fileKind(path: string): FileKind {
    if (path === "tags.json") {
        return "vocabulary";
    }
    if (/^transcripts\/[^/]+\.meta\.json$/.test(path)) {
        return "sidecar";
    }
    if (/^transcripts\/[^/]+\.jsonl$/.test(path)) {
        return "transcript";
    }
    return "other";
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function eventProblem(line: Uint8Array): string | null {
    let event: unknown;
    try {
        event = JSON.parse(utf8.decode(line));
    } catch {
        return "not JSON";
    }
    return isRecord(event) &&
        typeof event.v === "number" &&
        typeof event.kind === "string"
        ? null
        : "not an event with v and kind";
}

const startsWith = (bytes: Uint8Array, prefix: Uint8Array) =>
    bytes.length >= prefix.length &&
    prefix.every((byte, index) => bytes[index] === byte);

// A transcript only grows: what was committed stays as it was, and each
// whole line after it is an event. A last line with no newline is what a
// crash mid-append leaves, and is allowed; so is a line that began before
// the committed end, which was a torn line when it was committed.
function transcriptProblem(
    bytes: Uint8Array,
    committed: Uint8Array | null,
): string | null {
    if (committed !== null && !startsWith(bytes, committed)) {
        return "it changed before its end, and a transcript only grows";
    }
    const from = committed?.length ?? 0;
    let start = 0;
    let line = 1;
    for (;;) {
        const end = bytes.indexOf(0x0a, start);
        if (end === -1) {
            return null;
        }
        if (start >= from) {
            const problem = eventProblem(bytes.subarray(start, end));
            if (problem !== null) {
                return `line ${line} is ${problem}`;
            }
        }
        start = end + 1;
        line += 1;
    }
}

// Null when the file may be committed, otherwise why not. committed is
// the file as last committed, or null when it never was; only a
// transcript's lint reads it.
export function lint(
    path: string,
    bytes: Uint8Array,
    committed: Uint8Array | null,
): string | null {
    const kind = fileKind(path);
    if (kind === "other") {
        return null;
    }
    if (kind === "transcript") {
        return transcriptProblem(bytes, committed);
    }
    let text: string;
    try {
        text = utf8.decode(bytes);
    } catch {
        return "it is not UTF-8";
    }
    const read =
        kind === "vocabulary" ? parseVocabulary(text) : parseSidecar(text);
    return read.kind === "ok" ? null : read.reason;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/history/`
Expected: PASS, every test in `lint.test.ts` and `boundary.test.ts`.

- [ ] **Step 6: Check and commit**

```bash
bunx biome check --write src/history/
bun run check
git add src/history/lint.ts src/history/lint.test.ts src/history/boundary.test.ts
git commit -m "feat(sdk): Lint memory's files by their kind"
git log --oneline -1 && git status --short
```

---

### Task 2: Sealing bundles

**Files:**

- Create: `src/history/seal.ts`
- Create: `src/history/seal.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `newKey(): string`: 32 random bytes in base64, a new
    `DOROTHY_MIRROR_KEY`
  - `parseKey(text: string | undefined): Uint8Array | null`: the key's
    32 bytes, or `null` when it is missing or not 32 bytes of base64
  - `seal(bundle: Uint8Array, key: Uint8Array, nonce?: Uint8Array): Promise<Uint8Array>`
  - `type Opened = { ok: true; bundle: Uint8Array } | { ok: false; reason: string }`
  - `unseal(sealed: Uint8Array, key: Uint8Array): Promise<Opened>`
  - `sealedName(sequence: number): string`: `bundles/000042.enc`
  - `SEALED_README: string`, the text of the sealed branch's `SEALED`

- [ ] **Step 1: Write the failing tests**

Create `src/history/seal.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/seal.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    newKey,
    parseKey,
    SEALED_README,
    seal,
    sealedName,
    unseal,
} from "./seal.js";

const KEY = new Uint8Array(32).fill(7);
const OTHER = new Uint8Array(32).fill(8);
const BUNDLE = new TextEncoder().encode("# v2 git bundle\nabc refs/heads/main\n\nPACK");
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("keys", () => {
    it("makes 32 random bytes as base64, and reads them back", () => {
        const key = newKey();
        expect(parseKey(key)).toHaveLength(32);
        expect(newKey()).not.toBe(key);
    });

    it("refuses a key that is missing or not 32 bytes of base64", () => {
        expect(parseKey(undefined)).toBeNull();
        expect(parseKey("")).toBeNull();
        expect(parseKey(Buffer.alloc(16).toString("base64"))).toBeNull();
        expect(parseKey("not base64 at all!")).toBeNull();
    });
});

describe("seal", () => {
    it("opens what it sealed, with the same key", async () => {
        const sealed = await seal(BUNDLE, KEY);
        expect(text(sealed.subarray(0, 17))).toBe("dorothy-sealed 1\n");
        expect(await unseal(sealed, KEY)).toEqual({ ok: true, bundle: BUNDLE });
    });

    it("draws a fresh nonce each time", async () => {
        const a = await seal(BUNDLE, KEY);
        const b = await seal(BUNDLE, KEY);
        expect(Buffer.compare(a, b)).not.toBe(0);
    });

    it("never opens with another key", async () => {
        expect(await unseal(await seal(BUNDLE, KEY), OTHER)).toEqual({
            ok: false,
            reason: "it does not open with this key, or it was changed",
        });
    });

    it("never opens once a byte is changed, the header's included", async () => {
        const sealed = await seal(BUNDLE, KEY);
        const body = sealed.slice();
        body[body.length - 1] = (body.at(-1) ?? 0) ^ 1;
        expect((await unseal(body, KEY)).ok).toBe(false);
        // The nonce line is authenticated with the ciphertext.
        const nonce = new Uint8Array(12).fill(1);
        const other = await seal(BUNDLE, KEY, nonce);
        const swapped = new TextEncoder().encode(
            text(other).replace(
                Buffer.from(nonce).toString("base64"),
                Buffer.from(new Uint8Array(12).fill(2)).toString("base64"),
            ),
        );
        expect((await unseal(swapped, KEY)).ok).toBe(false);
    });

    it("never opens when cut short", async () => {
        const sealed = await seal(BUNDLE, KEY);
        expect((await unseal(sealed.subarray(0, sealed.length - 4), KEY)).ok).toBe(
            false,
        );
        expect(await unseal(sealed.subarray(0, 10), KEY)).toEqual({
            ok: false,
            reason: "it is not a sealed bundle",
        });
    });

    it("names a version it does not know", async () => {
        const sealed = await seal(BUNDLE, KEY);
        const later = new Uint8Array(sealed);
        later[15] = "2".charCodeAt(0);
        expect(await unseal(later, KEY)).toEqual({
            ok: false,
            reason: "it is sealed as version 2, not 1",
        });
        expect(
            await unseal(new TextEncoder().encode("hello\nthere\nyou"), KEY),
        ).toEqual({ ok: false, reason: "it is not a sealed bundle" });
    });
});

describe("the sealed branch", () => {
    it("names bundles by sequence", () => {
        expect(sealedName(1)).toBe("bundles/000001.enc");
        expect(sealedName(42)).toBe("bundles/000042.enc");
    });

    it("says how to recover", () => {
        expect(SEALED_README).toContain("dorothy --recover");
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/history/seal.test.ts`
Expected: FAIL with "Cannot find module './seal.js'".

- [ ] **Step 3: Write the sealing**

Create `src/history/seal.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/seal.ts
//
//

const MAGIC = "dorothy-sealed 1";
const NONCE_BYTES = 12;
const KEY_BYTES = 32;

const encoder = new TextEncoder();

// Web Crypto wants bytes on an ArrayBuffer of their own.
const own = (bytes: Uint8Array) => new Uint8Array(bytes);
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

export type Opened =
    | { ok: true; bundle: Uint8Array }
    | { ok: false; reason: string };

// A new DOROTHY_MIRROR_KEY: 32 random bytes, as base64.
export function newKey(): string {
    return base64(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

// The key's bytes, or null when it is missing or not 32 bytes of base64.
export function parseKey(text: string | undefined): Uint8Array | null {
    const trimmed = text?.trim() ?? "";
    const bytes = Buffer.from(trimmed, "base64");
    return bytes.length === KEY_BYTES && base64(bytes) === trimmed
        ? new Uint8Array(bytes)
        : null;
}

const importKey = (key: Uint8Array) =>
    crypto.subtle.importKey("raw", own(key), "AES-GCM", false, [
        "encrypt",
        "decrypt",
    ]);

// AES-256-GCM under a fresh nonce, behind a header that names the format
// and carries the nonce. The header is authenticated with the bundle, so
// a changed version or nonce fails to open.
export async function seal(
    bundle: Uint8Array,
    key: Uint8Array,
    nonce: Uint8Array = crypto.getRandomValues(new Uint8Array(NONCE_BYTES)),
): Promise<Uint8Array> {
    const header = encoder.encode(`${MAGIC}\n${base64(nonce)}\n`);
    const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: own(nonce), additionalData: header },
            await importKey(key),
            own(bundle),
        ),
    );
    const out = new Uint8Array(header.length + sealed.length);
    out.set(header);
    out.set(sealed, header.length);
    return out;
}

export async function unseal(
    sealed: Uint8Array,
    key: Uint8Array,
): Promise<Opened> {
    const first = sealed.indexOf(0x0a);
    const second = first === -1 ? -1 : sealed.indexOf(0x0a, first + 1);
    const magic = Buffer.from(sealed.subarray(0, Math.max(first, 0))).toString(
        "utf8",
    );
    if (second === -1 || !magic.startsWith("dorothy-sealed ")) {
        return { ok: false, reason: "it is not a sealed bundle" };
    }
    if (magic !== MAGIC) {
        return {
            ok: false,
            reason: `it is sealed as version ${magic.slice("dorothy-sealed ".length)}, not 1`,
        };
    }
    const nonce = Buffer.from(
        Buffer.from(sealed.subarray(first + 1, second)).toString("utf8"),
        "base64",
    );
    if (nonce.length !== NONCE_BYTES) {
        return { ok: false, reason: "its nonce is not 12 bytes" };
    }
    try {
        const bundle = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: own(nonce),
                additionalData: own(sealed.subarray(0, second + 1)),
            },
            await importKey(key),
            own(sealed.subarray(second + 1)),
        );
        return { ok: true, bundle: new Uint8Array(bundle) };
    } catch {
        return {
            ok: false,
            reason: "it does not open with this key, or it was changed",
        };
    }
}

export const sealedName = (sequence: number) =>
    `bundles/${String(sequence).padStart(6, "0")}.enc`;

export const SEALED_README = [
    "This branch holds Dorothy's memory, sealed.",
    "",
    "Each file in bundles/ is a git bundle of the commits after the one",
    "before it, encrypted with AES-256-GCM under DOROTHY_MIRROR_KEY.",
    "Rebuild the memory into an empty data directory with:",
    "",
    "    dorothy --recover <this repository's url or path>",
    "",
].join("\n");
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/history/seal.test.ts`
Expected: PASS, every test.

- [ ] **Step 5: Check and commit**

```bash
bunx biome check --write src/history/seal.ts src/history/seal.test.ts
bun run check
git add src/history/seal.ts src/history/seal.test.ts
git commit -m "feat(sdk): Seal bundles for the mirror"
git log --oneline -1 && git status --short
```

---

### Task 3: The repository, and the git binary engine

**Files:**

- Create: `src/history/repo.ts`
- Create: `src/history/binary.ts`
- Create: `src/history/testing.ts`
- Create: `src/history/repo.test.ts`
- Create: `src/history/binary.test.ts`

**Interfaces:**

- Consumes: `Env` from `src/xdg.ts`.
- Produces, in `repo.ts`:
  - `type Engine = "git" | "isomorphic-git"`
  - `type Commit = { sha: string; at: string; message: string }`, `at`
    an ISO UTC string to the second (`.000Z`)
  - `type MemoryRepo` (below), every path relative to `root` with `/`
  - `AUTHOR = { name: "Dorothy", email: "dorothy@localhost" }`
  - `MAIN = "refs/heads/main"`, `SEALED = "refs/heads/sealed"`,
    `SEALED_THROUGH = "refs/dorothy/sealed-through"`
  - `NEEDS_BINARY = "this mirror needs the git binary"`
  - `MIRROR = "mirror"`, and `NO_MIRROR`, the reminder
    `memory has no mirror · dorothy --mirror <url>`
  - `hasGitBinary(env?: Env): Promise<boolean>`
- Produces, in `binary.ts`:
  - `binaryRepo(root: string, options?: { env?: Env }): MemoryRepo`
  - `isolatedEnv(env: Env): Record<string, string>`
  - `credentialHelpers(env?: Env): Promise<string[]>`
- Produces, in `testing.ts` (test helpers, imported only by tests):
  `tempRoot(): string`, `removeRoots(): void`,
  `put(root: string, path: string, text: string): void`,
  `bareRepo(): Promise<string>`, `TEST_ENV: Record<string, string>`

- [ ] **Step 1: Write the repository's types**

Create `src/history/repo.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/repo.ts
//
//

import type { Env } from "../xdg.js";

export type Engine = "git" | "isomorphic-git";

// A commit as history lists it; at is UTC, to the second.
export type Commit = { sha: string; at: string; message: string };

// Dorothy's data directory as a repository. Both engines read and write
// one on-disk format, so either can take over what the other wrote. Every
// path is relative to root, with / between its parts.
export type MemoryRepo = {
    readonly engine: Engine;
    readonly root: string;
    // Whether root holds a repository.
    exists(): boolean;
    // Makes root a repository on main; root is made if it is missing.
    init(): Promise<void>;
    // Stages the paths as they are on disk (a missing one as deleted) and
    // commits the index; null when that changes nothing.
    commit(paths: readonly string[], message: string): Promise<string | null>;
    // main's commits, newest first, or those touching one path.
    log(path?: string, limit?: number): Promise<Commit[]>;
    // A file as it was at a revision; null when it was not there.
    show(path: string, rev: string): Promise<Uint8Array | null>;
    // Every file at a revision, sorted.
    files(rev: string): Promise<string[]>;
    // Files that differ from the last commit: changed, deleted or new,
    // ignored ones aside.
    changed(): Promise<string[]>;
    // A revision's commit, or null.
    resolve(rev: string): Promise<string | null>;
    setRef(name: string, sha: string): Promise<void>;
    // The commits on main after since (all of them for null) as a git
    // bundle; null when there are none.
    bundle(since: string | null): Promise<Uint8Array | null>;
    // Applies a bundle to main; returns main's new tip.
    unbundle(bundle: Uint8Array): Promise<string>;
    // Adds a file to the sealed branch in a commit of its own, with
    // SEALED at the branch's root; main and the working tree are untouched.
    appendSealed(
        name: string,
        bytes: Uint8Array,
        readme: string,
        message: string,
    ): Promise<string>;
    // The sealed branch's bundles, sorted.
    sealedNames(): Promise<string[]>;
    sealedFile(name: string): Promise<Uint8Array>;
    // Records a remote, replacing one of the same name.
    setRemote(name: string, url: string): Promise<void>;
    remote(name: string): Promise<string | null>;
    // Fast-forward only. token is for an https remote under
    // isomorphic-git; the binary uses the user's credential helpers.
    push(remote: string, branch: string, token: string | null): Promise<void>;
    // Into refs/heads/<branch>.
    fetch(url: string, branch: string, token: string | null): Promise<void>;
    // Makes the working tree main's, as recovery needs.
    checkout(): Promise<void>;
    // Packs loose objects; nothing under isomorphic-git.
    maintain(): Promise<void>;
};

export const AUTHOR = { name: "Dorothy", email: "dorothy@localhost" } as const;
export const MAIN = "refs/heads/main";
export const SEALED = "refs/heads/sealed";
export const SEALED_THROUGH = "refs/dorothy/sealed-through";
export const NEEDS_BINARY = "this mirror needs the git binary";
// The remote the sealed branch is pushed to.
export const MIRROR = "mirror";
// Said at each launch, and by each command, until a mirror is set.
export const NO_MIRROR = "memory has no mirror · dorothy --mirror <url>";

const defined = (env: Env): Record<string, string> =>
    Object.fromEntries(
        Object.entries(env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
        ),
    );

export async function hasGitBinary(env: Env = process.env): Promise<boolean> {
    try {
        const proc = Bun.spawn(["git", "--version"], {
            env: defined(env),
            stdout: "ignore",
            stderr: "ignore",
        });
        return (await proc.exited) === 0;
    } catch {
        return false;
    }
}
```

- [ ] **Step 2: Write the test helpers**

Create `src/history/testing.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/testing.ts
//
//

// Helpers for history's tests: temporary roots, files in them and a bare
// repository to push to. Nothing here touches the user's git setup.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isolatedEnv } from "./binary.js";

const roots: string[] = [];

// The environment tests run git with: the user's global configuration
// shut out.
export const TEST_ENV = isolatedEnv(process.env);

export function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "dorothy-history-"));
    roots.push(root);
    return root;
}

export function removeRoots(): void {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
}

export function put(root: string, path: string, text: string): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
}

export async function bareRepo(): Promise<string> {
    const path = join(tempRoot(), "mirror.git");
    const proc = Bun.spawn(["git", "init", "-q", "--bare", path], {
        env: TEST_ENV,
        stdout: "ignore",
        stderr: "ignore",
    });
    if ((await proc.exited) !== 0) {
        throw new Error("git init --bare failed");
    }
    return path;
}
```

- [ ] **Step 3: Write the failing contract**

Create `src/history/repo.test.ts`. The contract is a function so that
Task 4 can run it against the second engine from this same file.

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/repo.test.ts
//
//

import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { binaryRepo } from "./binary.js";
import { MAIN, type MemoryRepo, SEALED } from "./repo.js";
import { put, removeRoots, TEST_ENV, tempRoot } from "./testing.js";

afterAll(removeRoots);

const text = (bytes: Uint8Array | null) =>
    bytes === null ? null : new TextDecoder().decode(bytes);
const messages = async (repo: MemoryRepo, path?: string, limit?: number) =>
    (await repo.log(path, limit)).map((commit) => commit.message);

function contract(make: (root: string) => MemoryRepo): void {
    const fresh = async () => {
        const repo = make(join(tempRoot(), "data"));
        await repo.init();
        return repo;
    };

    it("starts empty", async () => {
        const repo = await fresh();
        expect(repo.exists()).toBe(true);
        expect(await repo.log()).toEqual([]);
        expect(await repo.resolve(MAIN)).toBeNull();
        expect(await repo.show("tags.json", "HEAD")).toBeNull();
        expect(await repo.bundle(null)).toBeNull();
        expect(await repo.sealedNames()).toEqual([]);
        expect(await repo.changed()).toEqual([]);
    });

    it("commits the paths it is given, and nothing when they are unchanged", async () => {
        const repo = await fresh();
        put(repo.root, "tags.json", "{}\n");
        // A space in a name, printed as it is.
        put(repo.root, "transcripts/a b.jsonl", "1\n");
        const sha = await repo.commit(
            ["tags.json", "transcripts/a b.jsonl"],
            "adopt: 2 files",
        );
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
        expect(await repo.commit(["tags.json"], "again")).toBeNull();
        const [head] = await repo.log();
        expect(head?.sha).toBe(sha as string);
        expect(head?.message).toBe("adopt: 2 files");
        expect(head?.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/);
        expect(await repo.files(sha as string)).toEqual([
            "tags.json",
            "transcripts/a b.jsonl",
        ]);
        expect(text(await repo.show("transcripts/a b.jsonl", "HEAD"))).toBe(
            "1\n",
        );
    });

    it("logs one path's commits, newest first, up to a limit", async () => {
        const repo = await fresh();
        put(repo.root, "a.txt", "1\n");
        await repo.commit(["a.txt"], "one");
        put(repo.root, "b.txt", "1\n");
        await repo.commit(["b.txt"], "two");
        put(repo.root, "a.txt", "2\n");
        await repo.commit(["a.txt"], "three");
        expect(await messages(repo, "a.txt")).toEqual(["three", "one"]);
        expect(await messages(repo, undefined, 2)).toEqual(["three", "two"]);
        expect(await messages(repo, "never.txt")).toEqual([]);
    });

    it("shows a file as it was at a revision", async () => {
        const repo = await fresh();
        put(repo.root, "a.txt", "1\n");
        const first = (await repo.commit(["a.txt"], "one")) as string;
        put(repo.root, "a.txt", "2\n");
        await repo.commit(["a.txt"], "two");
        expect(text(await repo.show("a.txt", first))).toBe("1\n");
        expect(text(await repo.show("a.txt", "HEAD"))).toBe("2\n");
        expect(await repo.show("missing.txt", "HEAD")).toBeNull();
        expect(await repo.show("a.txt", "nonsense")).toBeNull();
        expect(await repo.resolve(first.slice(0, 7))).toBe(first);
        expect(await repo.resolve("nonsense")).toBeNull();
    });

    it("commits a deletion, and passes over a path never tracked", async () => {
        const repo = await fresh();
        put(repo.root, "a.txt", "1\n");
        put(repo.root, "b.txt", "1\n");
        await repo.commit(["a.txt", "b.txt"], "one");
        rmSync(join(repo.root, "a.txt"));
        expect(
            await repo.commit(["a.txt", "never.txt"], "outside: a.txt"),
        ).not.toBeNull();
        expect(await repo.files("HEAD")).toEqual(["b.txt"]);
        expect(await repo.commit(["never.txt"], "nothing")).toBeNull();
    });

    it("lists what changed since the last commit, ignored files aside", async () => {
        const repo = await fresh();
        put(repo.root, ".gitignore", "*.tmp\n");
        put(repo.root, "a.txt", "1\n");
        put(repo.root, "d.txt", "1\n");
        await repo.commit([".gitignore", "a.txt", "d.txt"], "one");
        put(repo.root, "a.txt", "22\n");
        put(repo.root, "transcripts/b.jsonl", "1\n");
        put(repo.root, "c.tmp", "x");
        rmSync(join(repo.root, "d.txt"));
        expect((await repo.changed()).sort()).toEqual([
            "a.txt",
            "d.txt",
            "transcripts/b.jsonl",
        ]);
        await repo.commit(["a.txt", "d.txt", "transcripts/b.jsonl"], "two");
        expect(await repo.changed()).toEqual([]);
    });

    it("bundles commits and applies them to another repository", async () => {
        const a = await fresh();
        put(a.root, "a.txt", "1\n");
        const first = (await a.commit(["a.txt"], "one")) as string;
        const b = await fresh();
        expect(await b.unbundle((await a.bundle(null)) as Uint8Array)).toBe(
            first,
        );
        put(a.root, "a.txt", "1\n2\n");
        const second = (await a.commit(["a.txt"], "two")) as string;
        const later = (await a.bundle(first)) as Uint8Array;
        expect(await a.bundle(second)).toBeNull();
        expect(await b.unbundle(later)).toBe(second);
        expect(await b.resolve(MAIN)).toBe(second);
        await b.checkout();
        expect(readFileSync(join(b.root, "a.txt"), "utf8")).toBe("1\n2\n");
        expect(await messages(b)).toEqual(["two", "one"]);
    });

    it("refuses a bundle whose prerequisite it lacks", async () => {
        const a = await fresh();
        put(a.root, "a.txt", "1\n");
        const first = (await a.commit(["a.txt"], "one")) as string;
        put(a.root, "a.txt", "2\n");
        await a.commit(["a.txt"], "two");
        const b = await fresh();
        await expect(
            b.unbundle((await a.bundle(first)) as Uint8Array),
        ).rejects.toThrow();
        expect(await b.resolve(MAIN)).toBeNull();
    });

    it("appends sealed files on their own branch, leaving main alone", async () => {
        const repo = await fresh();
        put(repo.root, "a.txt", "1\n");
        const tip = await repo.commit(["a.txt"], "one");
        await repo.appendSealed(
            "bundles/000001.enc",
            new Uint8Array([1, 2]),
            "readme\n",
            "seal 1",
        );
        await repo.appendSealed(
            "bundles/000002.enc",
            new Uint8Array([3]),
            "readme\n",
            "seal 2",
        );
        expect(await repo.sealedNames()).toEqual([
            "bundles/000001.enc",
            "bundles/000002.enc",
        ]);
        expect([...(await repo.sealedFile("bundles/000001.enc"))]).toEqual([
            1, 2,
        ]);
        expect(await repo.files(SEALED)).toEqual([
            "SEALED",
            "bundles/000001.enc",
            "bundles/000002.enc",
        ]);
        expect(text(await repo.show("SEALED", SEALED))).toBe("readme\n");
        expect(await repo.resolve(MAIN)).toBe(tip);
        expect(await repo.changed()).toEqual([]);
    });

    it("records a remote and replaces it", async () => {
        const repo = await fresh();
        expect(await repo.remote("mirror")).toBeNull();
        await repo.setRemote("mirror", "/tmp/one.git");
        expect(await repo.remote("mirror")).toBe("/tmp/one.git");
        await repo.setRemote("mirror", "/tmp/two.git");
        expect(await repo.remote("mirror")).toBe("/tmp/two.git");
    });

    it("moves a ref", async () => {
        const repo = await fresh();
        put(repo.root, "a.txt", "1\n");
        const sha = (await repo.commit(["a.txt"], "one")) as string;
        await repo.setRef("refs/dorothy/sealed-through", sha);
        expect(await repo.resolve("refs/dorothy/sealed-through")).toBe(sha);
    });

    it("maintains itself without complaint", async () => {
        const repo = await fresh();
        put(repo.root, "a.txt", "1\n");
        await repo.commit(["a.txt"], "one");
        await repo.maintain();
        expect(await messages(repo)).toEqual(["one"]);
    });
}

describe("the git binary engine", () => {
    contract((root) => binaryRepo(root, { env: TEST_ENV }));
});

```

- [ ] **Step 4: Write the failing engine tests**

Create `src/history/binary.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/binary.test.ts
//
//

import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { binaryRepo, credentialHelpers, isolatedEnv } from "./binary.js";
import {
    bareRepo,
    put,
    removeRoots,
    TEST_ENV,
    tempRoot,
} from "./testing.js";

afterAll(removeRoots);

async function gitOut(root: string, args: string[]): Promise<string> {
    const proc = Bun.spawn(["git", ...args], {
        cwd: root,
        env: TEST_ENV,
        stdout: "pipe",
        stderr: "ignore",
    });
    return (await new Response(proc.stdout).text()).trim();
}

describe("isolatedEnv", () => {
    it("shuts out the user's configuration and anything locating a repository", () => {
        const env = isolatedEnv({
            PATH: "/usr/bin",
            GIT_DIR: "/elsewhere",
            GIT_WORK_TREE: "/elsewhere",
            GIT_INDEX_FILE: "/elsewhere/index",
            GIT_CONFIG_PARAMETERS: "'core.bare'='true'",
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: "core.bare",
            GIT_CONFIG_VALUE_0: "true",
            GIT_SSH_COMMAND: "ssh -i key",
            HOME: undefined,
        });
        expect(env).toEqual({
            PATH: "/usr/bin",
            GIT_SSH_COMMAND: "ssh -i key",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_TERMINAL_PROMPT: "0",
            GIT_AUTHOR_NAME: "Dorothy",
            GIT_AUTHOR_EMAIL: "dorothy@localhost",
            GIT_COMMITTER_NAME: "Dorothy",
            GIT_COMMITTER_EMAIL: "dorothy@localhost",
        });
    });
});

describe("the git binary engine", () => {
    it("keeps the user's signing and hooks away from its commits", async () => {
        const home = tempRoot();
        const hook = join(home, "hooks", "pre-commit");
        put(home, "hooks/pre-commit", "#!/bin/sh\nexit 1\n");
        chmodSync(hook, 0o755);
        const config = join(home, "gitconfig");
        writeFileSync(
            config,
            `[commit]\n\tgpgsign = true\n[core]\n\thooksPath = ${join(home, "hooks")}\n`,
        );
        const root = join(tempRoot(), "data");
        const repo = binaryRepo(root, {
            env: { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_DIR: home },
        });
        await repo.init();
        // The repository's own hook is skipped too.
        put(root, ".git/hooks/pre-commit", "#!/bin/sh\nexit 1\n");
        chmodSync(join(root, ".git/hooks/pre-commit"), 0o755);
        put(root, "a.txt", "1\n");
        expect(await repo.commit(["a.txt"], "one")).not.toBeNull();
        expect(
            await gitOut(root, ["log", "-1", "--format=%an <%ae> %cn %G?"]),
        ).toBe("Dorothy <dorothy@localhost> Dorothy N");
    });

    it("pushes a branch to a bare repository and fetches it back", async () => {
        const mirror = await bareRepo();
        const a = binaryRepo(join(tempRoot(), "a"), { env: TEST_ENV });
        await a.init();
        await a.appendSealed(
            "bundles/000001.enc",
            new Uint8Array([1]),
            "readme\n",
            "seal 1",
        );
        await a.setRemote("mirror", mirror);
        await a.push("mirror", "sealed", null);
        const b = binaryRepo(join(tempRoot(), "b"), { env: TEST_ENV });
        await b.init();
        await b.fetch(mirror, "sealed", null);
        expect(await b.sealedNames()).toEqual(["bundles/000001.enc"]);
    });

    it("refuses to push over a mirror that went its own way", async () => {
        const mirror = await bareRepo();
        for (const name of ["a", "b"]) {
            const repo = binaryRepo(join(tempRoot(), name), { env: TEST_ENV });
            await repo.init();
            await repo.appendSealed(
                "bundles/000001.enc",
                new TextEncoder().encode(name),
                "readme\n",
                "seal 1",
            );
            await repo.setRemote("mirror", mirror);
            if (name === "a") {
                await repo.push("mirror", "sealed", null);
            } else {
                await expect(
                    repo.push("mirror", "sealed", null),
                ).rejects.toThrow();
            }
        }
    });
});

describe("credentialHelpers", () => {
    it("reads the user's helpers from their global configuration", async () => {
        const config = join(tempRoot(), "gitconfig");
        writeFileSync(
            config,
            "[credential]\n\thelper = store\n\thelper = cache --timeout=60\n",
        );
        expect(
            await credentialHelpers({ ...process.env, GIT_CONFIG_GLOBAL: config }),
        ).toEqual(["store", "cache --timeout=60"]);
        expect(
            await credentialHelpers({
                ...process.env,
                GIT_CONFIG_GLOBAL: "/dev/null",
            }),
        ).toEqual([]);
    });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `bun test src/history/repo.test.ts src/history/binary.test.ts`
Expected: FAIL with "Cannot find module './binary.js'".

- [ ] **Step 6: Write the engine**

Create `src/history/binary.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/binary.ts
//
//

import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Env } from "../xdg.js";
import {
    AUTHOR,
    type Commit,
    MAIN,
    type MemoryRepo,
    SEALED,
} from "./repo.js";

// Before every command: the user's signing, hooks and automatic garbage
// collection never reach Dorothy's repository, and paths print as they
// are rather than quoted.
const ISOLATION = [
    "-c",
    "commit.gpgsign=false",
    "-c",
    "tag.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "init.defaultBranch=main",
    "-c",
    "core.quotePath=false",
    "-c",
    "gc.auto=0",
    "-c",
    "maintenance.auto=false",
];

// Variables that would point git at another repository, or carry
// configuration of their own.
const LOCATING = new Set([
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_NAMESPACE",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
]);

// The environment every command runs in: the caller's, less what locates
// a repository or configures git, with the user's global and system
// configuration shut out and Dorothy as the author.
export function isolatedEnv(env: Env): Record<string, string> {
    const isolated: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (
            value !== undefined &&
            !LOCATING.has(key) &&
            !/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key)
        ) {
            isolated[key] = value;
        }
    }
    return {
        ...isolated,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: AUTHOR.name,
        GIT_AUTHOR_EMAIL: AUTHOR.email,
        GIT_COMMITTER_NAME: AUTHOR.name,
        GIT_COMMITTER_EMAIL: AUTHOR.email,
    };
}

// The user's own credential helpers: the one setting carried over from
// their global configuration, for pushing and fetching only.
export async function credentialHelpers(
    env: Env = process.env,
): Promise<string[]> {
    try {
        const proc = Bun.spawn(
            ["git", "config", "--global", "--get-all", "credential.helper"],
            {
                env: Object.fromEntries(
                    Object.entries(env).filter(
                        (entry): entry is [string, string] =>
                            entry[1] !== undefined,
                    ),
                ),
                stdout: "pipe",
                stderr: "ignore",
            },
        );
        const [out, code] = await Promise.all([
            new Response(proc.stdout).text(),
            proc.exited,
        ]);
        return code === 0 ? out.split("\n").filter((line) => line !== "") : [];
    } catch {
        return [];
    }
}

type Ran = { code: number; stdout: Uint8Array; stderr: string };

const decoder = new TextDecoder();
const text = (ran: Ran) => decoder.decode(ran.stdout);

export function binaryRepo(
    root: string,
    { env = process.env }: { env?: Env } = {},
): MemoryRepo {
    const base = isolatedEnv(env);
    let helpers: Promise<string[]> | null = null;

    const run = async (
        args: readonly string[],
        {
            input,
            extra = {},
        }: { input?: Uint8Array; extra?: Record<string, string> } = {},
    ): Promise<Ran> => {
        const proc = Bun.spawn(["git", ...ISOLATION, ...args], {
            cwd: root,
            env: { ...base, ...extra },
            stdin: input ?? "ignore",
            stdout: "pipe",
            stderr: "pipe",
        });
        const [stdout, stderr, code] = await Promise.all([
            new Response(proc.stdout).bytes(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        return { code, stdout, stderr };
    };
    const must = async (
        args: readonly string[],
        options?: { input?: Uint8Array; extra?: Record<string, string> },
    ): Promise<Ran> => {
        const ran = await run(args, options);
        if (ran.code !== 0) {
            throw new Error(
                `git ${args[0]}: ${ran.stderr.trim() || `exit ${ran.code}`}`,
            );
        }
        return ran;
    };
    const resolve = async (rev: string): Promise<string | null> => {
        const ran = await run(["rev-parse", "--verify", "-q", `${rev}^{commit}`]);
        return ran.code === 0 ? text(ran).trim() : null;
    };
    // The helpers as configuration in the environment, where a command's
    // own -c would not reach them past ISOLATION's.
    const credentials = async (): Promise<Record<string, string>> => {
        helpers ??= credentialHelpers(env);
        const found = await helpers;
        const extra: Record<string, string> = {
            GIT_CONFIG_COUNT: String(found.length),
        };
        found.forEach((helper, index) => {
            extra[`GIT_CONFIG_KEY_${index}`] = "credential.helper";
            extra[`GIT_CONFIG_VALUE_${index}`] = helper;
        });
        return extra;
    };

    return {
        engine: "git",
        root,
        exists: () => existsSync(join(root, ".git", "HEAD")),
        async init() {
            await mkdir(root, { recursive: true, mode: 0o700 });
            await must(["init", "-q", "-b", "main"]);
        },
        async commit(paths, message) {
            if (paths.length === 0) {
                return null;
            }
            for (const path of paths) {
                await must(
                    existsSync(join(root, path))
                        ? ["add", "--", path]
                        : ["rm", "--cached", "--ignore-unmatch", "-q", "--", path],
                );
            }
            if ((await run(["diff", "--cached", "--quiet"])).code === 0) {
                return null;
            }
            await must(["commit", "-q", "--no-verify", "-m", message]);
            return resolve("HEAD");
        },
        async log(path, limit = 20) {
            if ((await resolve(MAIN)) === null) {
                return [];
            }
            const ran = await must([
                "log",
                MAIN,
                `--max-count=${limit}`,
                "--format=%H%x00%cI%x00%s%x1e",
                ...(path === undefined ? [] : ["--", path]),
            ]);
            return text(ran)
                .split("\x1e")
                .map((entry) => entry.trim())
                .filter((entry) => entry !== "")
                .map((entry): Commit => {
                    const [sha = "", at = "", message = ""] = entry.split("\0");
                    return { sha, at: new Date(at).toISOString(), message };
                });
        },
        async show(path, rev) {
            const ran = await run(["cat-file", "blob", `${rev}:${path}`]);
            return ran.code === 0 ? ran.stdout : null;
        },
        async files(rev) {
            return text(await must(["ls-tree", "-r", "-z", "--name-only", rev]))
                .split("\0")
                .filter((path) => path !== "")
                .sort();
        },
        async changed() {
            const entries = text(
                await must([
                    "status",
                    "--porcelain=v1",
                    "-z",
                    "--untracked-files=all",
                ]),
            ).split("\0");
            const paths: string[] = [];
            for (let index = 0; index < entries.length; index++) {
                const entry = entries[index] ?? "";
                if (entry === "") {
                    continue;
                }
                paths.push(entry.slice(3));
                // A rename or copy is followed by the path it came from.
                if (entry[0] === "R" || entry[0] === "C") {
                    index++;
                }
            }
            return paths;
        },
        resolve,
        async setRef(name, sha) {
            await must(["update-ref", name, sha]);
        },
        async bundle(since) {
            const tip = await resolve(MAIN);
            if (tip === null || tip === since) {
                return null;
            }
            const ran = await must([
                "bundle",
                "create",
                "-q",
                "-",
                since === null ? "main" : `${since}..main`,
            ]);
            return ran.stdout;
        },
        async unbundle(bundle) {
            const file = join(root, ".git", "dorothy-incoming.bundle");
            await writeFile(file, bundle);
            try {
                await must(["bundle", "verify", "-q", file]);
                await must([
                    "fetch",
                    "-q",
                    "--update-head-ok",
                    file,
                    `${MAIN}:${MAIN}`,
                ]);
            } finally {
                await rm(file, { force: true });
            }
            const tip = await resolve(MAIN);
            if (tip === null) {
                throw new Error("the bundle left main empty");
            }
            return tip;
        },
        async appendSealed(name, bytes, readme, message) {
            // A private index, so the working tree's is never touched.
            const index = join(root, ".git", "dorothy-sealed.index");
            const extra = { GIT_INDEX_FILE: index };
            await rm(index, { force: true });
            try {
                const tip = await resolve(SEALED);
                await must(tip === null ? ["read-tree", "--empty"] : ["read-tree", tip], {
                    extra,
                });
                const blob = text(
                    await must(["hash-object", "-w", "--stdin"], { input: bytes }),
                ).trim();
                const note = text(
                    await must(["hash-object", "-w", "--stdin"], {
                        input: new TextEncoder().encode(readme),
                    }),
                ).trim();
                for (const [sha, path] of [
                    [blob, name],
                    [note, "SEALED"],
                ] as const) {
                    await must(
                        ["update-index", "--add", "--cacheinfo", `100644,${sha},${path}`],
                        { extra },
                    );
                }
                const tree = text(await must(["write-tree"], { extra })).trim();
                const commit = text(
                    await must([
                        "commit-tree",
                        tree,
                        ...(tip === null ? [] : ["-p", tip]),
                        "-m",
                        message,
                    ]),
                ).trim();
                await must(["update-ref", SEALED, commit]);
                return commit;
            } finally {
                await rm(index, { force: true });
            }
        },
        async sealedNames() {
            const tip = await resolve(SEALED);
            if (tip === null) {
                return [];
            }
            return text(
                await must(["ls-tree", "-r", "-z", "--name-only", tip, "--", "bundles"]),
            )
                .split("\0")
                .filter((path) => path !== "")
                .sort();
        },
        async sealedFile(name) {
            return (await must(["cat-file", "blob", `${SEALED}:${name}`])).stdout;
        },
        async setRemote(name, url) {
            await run(["remote", "remove", name]);
            await must(["remote", "add", name, url]);
        },
        async remote(name) {
            const ran = await run(["remote", "get-url", name]);
            return ran.code === 0 ? text(ran).trim() : null;
        },
        async push(remote, branch, _token) {
            await must(
                ["push", "-q", remote, `refs/heads/${branch}:refs/heads/${branch}`],
                { extra: await credentials() },
            );
        },
        async fetch(url, branch, _token) {
            await must(
                [
                    "fetch",
                    "-q",
                    "--update-head-ok",
                    url,
                    `refs/heads/${branch}:refs/heads/${branch}`,
                ],
                { extra: await credentials() },
            );
        },
        async checkout() {
            await must(["reset", "-q", "--hard", MAIN]);
        },
        async maintain() {
            await must(["gc", "-q"]);
        },
    };
}
```

If TypeScript rejects `stdin: input ?? "ignore"` because `Uint8Array` is
not a `Bun.spawn` input type in this version, pass
`input === undefined ? "ignore" : new Blob([new Uint8Array(input)])`
instead.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test src/history/repo.test.ts src/history/binary.test.ts`
Expected: PASS, every test.

- [ ] **Step 8: Check and commit**

```bash
bunx biome check --write src/history/
bun run check
git add src/history/repo.ts src/history/binary.ts src/history/testing.ts src/history/repo.test.ts src/history/binary.test.ts
git commit -m "feat(sdk): Keep memory's history with git"
git log --oneline -1 && git status --short
```

---

### Task 4: The isomorphic-git engine

**Files:**

- Modify: `package.json`, `bun.lock` (the dependency)
- Create: `src/history/iso.ts`
- Create: `src/history/open.ts`
- Create: `src/history/cross.test.ts`
- Create: `src/history/open.test.ts`
- Modify: `src/history/repo.test.ts` (run the contract against this engine)

**Interfaces:**

- Consumes: `MemoryRepo`, `Commit`, `AUTHOR`, `MAIN`, `SEALED`,
  `NEEDS_BINARY`, `hasGitBinary` (Task 3); `binaryRepo` (Task 3).
- Produces:
  - `isoRepo(root: string): MemoryRepo`, in `iso.ts`
  - `openRepo(root: string, options?: { engine?: Engine; probe?: () => Promise<boolean> }): Promise<MemoryRepo>`,
    in `open.ts`: the binary when `probe()` (by default `hasGitBinary`)
    says so, isomorphic-git otherwise, unless `engine` names one

- [ ] **Step 1: Add the dependency**

```bash
bun add isomorphic-git@1.43.1 --exact
```

Expected: `package.json` gains `"isomorphic-git": "1.43.1"` under
`dependencies`, and `bun.lock` changes.

- [ ] **Step 2: Run the contract against the new engine**

In `src/history/repo.test.ts`, add the import beside `binaryRepo`'s:

```ts
import { isoRepo } from "./iso.js";
```

and, after the `describe("the git binary engine", ...)` block at the end:

```ts
describe("the isomorphic-git engine", () => {
    contract((root) => isoRepo(root));
});
```

- [ ] **Step 3: Write the failing cross-engine and choice tests**

Create `src/history/cross.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/cross.test.ts
//
//

import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { binaryRepo } from "./binary.js";
import { isoRepo } from "./iso.js";
import { MAIN, type MemoryRepo, NEEDS_BINARY } from "./repo.js";
import { bareRepo, put, removeRoots, TEST_ENV, tempRoot } from "./testing.js";

afterAll(removeRoots);

const text = (bytes: Uint8Array | null) =>
    bytes === null ? null : new TextDecoder().decode(bytes);
const git = (root: string) => binaryRepo(root, { env: TEST_ENV });
const iso = (root: string) => isoRepo(root);
const ENGINES: [string, (root: string) => MemoryRepo, (root: string) => MemoryRepo][] = [
    ["git then isomorphic-git", git, iso],
    ["isomorphic-git then git", iso, git],
];

// A long transcript, so that the binary's bundles carry deltas against
// objects the receiving side already holds.
const transcript = (lines: number) =>
    Array.from(
        { length: lines },
        (_, index) =>
            `${JSON.stringify({ v: 1, kind: "user", text: `line ${index} of a long chat` })}\n`,
    ).join("");

describe.each(ENGINES)("%s", (_, first, second) => {
    it("reads and continues the other's commits", async () => {
        const root = join(tempRoot(), "data");
        const a = first(root);
        await a.init();
        put(root, "tags.json", "{}\n");
        const one = (await a.commit(["tags.json"], "one")) as string;
        const b = second(root);
        expect(b.exists()).toBe(true);
        expect((await b.log()).map((commit) => commit.message)).toEqual(["one"]);
        expect(text(await b.show("tags.json", one))).toBe("{}\n");
        expect(await b.changed()).toEqual([]);
        put(root, "tags.json", "{ }\n");
        expect(await b.changed()).toEqual(["tags.json"]);
        await b.commit(["tags.json"], "two");
        expect((await a.log()).map((commit) => commit.message)).toEqual([
            "two",
            "one",
        ]);
    });

    it("applies the other's bundles, thin ones included", async () => {
        const a = first(join(tempRoot(), "a"));
        await a.init();
        put(a.root, "transcripts/x.jsonl", transcript(3000));
        const one = (await a.commit(["transcripts/x.jsonl"], "one")) as string;
        const full = (await a.bundle(null)) as Uint8Array;
        put(a.root, "transcripts/x.jsonl", transcript(3001));
        const two = (await a.commit(["transcripts/x.jsonl"], "two")) as string;
        const later = (await a.bundle(one)) as Uint8Array;
        const b = second(join(tempRoot(), "b"));
        await b.init();
        expect(await b.unbundle(full)).toBe(one);
        expect(await b.unbundle(later)).toBe(two);
        await b.checkout();
        expect(readFileSync(join(b.root, "transcripts/x.jsonl"), "utf8")).toBe(
            transcript(3001),
        );
    });

    it("continues the other's sealed branch", async () => {
        const root = join(tempRoot(), "data");
        const a = first(root);
        await a.init();
        await a.appendSealed("bundles/000001.enc", new Uint8Array([1]), "r\n", "seal 1");
        const b = second(root);
        await b.appendSealed("bundles/000002.enc", new Uint8Array([2]), "r\n", "seal 2");
        expect(await a.sealedNames()).toEqual([
            "bundles/000001.enc",
            "bundles/000002.enc",
        ]);
        expect([...(await a.sealedFile("bundles/000002.enc"))]).toEqual([2]);
        expect(await a.resolve(MAIN)).toBeNull();
    });
});

describe("the isomorphic-git engine", () => {
    it("pushes only over https", async () => {
        const mirror = await bareRepo();
        const repo = iso(join(tempRoot(), "data"));
        await repo.init();
        await repo.appendSealed("bundles/000001.enc", new Uint8Array([1]), "r\n", "seal 1");
        await repo.setRemote("mirror", mirror);
        await expect(repo.push("mirror", "sealed", null)).rejects.toThrow(
            NEEDS_BINARY,
        );
        await expect(repo.fetch(mirror, "sealed", null)).rejects.toThrow(
            NEEDS_BINARY,
        );
    });
});
```

Create `src/history/open.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/open.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { openRepo } from "./open.js";
import { hasGitBinary } from "./repo.js";

describe("openRepo", () => {
    it("prefers the binary and falls back to isomorphic-git", async () => {
        expect(
            (await openRepo("/nonexistent", { probe: async () => true })).engine,
        ).toBe("git");
        expect(
            (await openRepo("/nonexistent", { probe: async () => false }))
                .engine,
        ).toBe("isomorphic-git");
        expect(
            (
                await openRepo("/nonexistent", {
                    engine: "isomorphic-git",
                    probe: async () => true,
                })
            ).engine,
        ).toBe("isomorphic-git");
    });

    it("finds the binary on this machine", async () => {
        expect(await hasGitBinary()).toBe(true);
    });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `bun test src/history/`
Expected: FAIL with "Cannot find module './iso.js'" and
"Cannot find module './open.js'".

- [ ] **Step 5: Write the engine**

Create `src/history/iso.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/iso.ts
//
//

import fs, { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import {
    AUTHOR,
    type Commit,
    MAIN,
    type MemoryRepo,
    NEEDS_BINARY,
    SEALED,
} from "./repo.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type StatusRow = [string, 0 | 1, 0 | 1 | 2, 0 | 1 | 2 | 3];

// A staged path differs from HEAD: added, deleted or changed in the index.
const staged = ([, head, , stage]: StatusRow) =>
    head === 0 ? stage !== 0 : stage !== 1;

const firstLine = (message: string) => message.trim().split("\n")[0] ?? "";

// Where the blank line that ends a bundle's header sits.
function headerEnd(bundle: Uint8Array): number {
    for (let index = 0; index + 1 < bundle.length; index++) {
        if (bundle[index] === 0x0a && bundle[index + 1] === 0x0a) {
            return index;
        }
    }
    throw new Error("not a git bundle");
}

const https = (url: string) => /^https:\/\//.test(url);

// The engine for a machine without git. It reads and writes the same
// repository the binary does; it cannot repack, and pushes only over
// https.
export function isoRepo(root: string): MemoryRepo {
    const dir = root;
    const auth = (token: string | null) =>
        token === null
            ? {}
            : { onAuth: () => ({ username: "dorothy", password: token }) };

    const resolve = async (rev: string): Promise<string | null> => {
        try {
            return await git.resolveRef({ fs, dir, ref: rev });
        } catch {}
        try {
            return await git.expandOid({ fs, dir, oid: rev });
        } catch {
            return null;
        }
    };

    const hasCommit = async (oid: string): Promise<boolean> => {
        try {
            await git.readCommit({ fs, dir, oid });
            return true;
        } catch {
            return false;
        }
    };

    // Every tree and blob under a tree, less those already known.
    const collect = async (
        tree: string,
        into: Set<string>,
        known: ReadonlySet<string>,
    ): Promise<void> => {
        if (known.has(tree) || into.has(tree)) {
            return;
        }
        into.add(tree);
        for (const entry of (await git.readTree({ fs, dir, oid: tree })).tree) {
            if (entry.type === "tree") {
                await collect(entry.oid, into, known);
            } else if (entry.type === "blob" && !known.has(entry.oid)) {
                into.add(entry.oid);
            }
        }
    };

    // The sealed branch's bundles directory, as entries.
    const sealedEntries = async (tip: string | null) => {
        if (tip === null) {
            return [];
        }
        const { commit } = await git.readCommit({ fs, dir, oid: tip });
        const bundles = (await git.readTree({ fs, dir, oid: commit.tree })).tree.find(
            (entry) => entry.path === "bundles",
        );
        return bundles === undefined
            ? []
            : (await git.readTree({ fs, dir, oid: bundles.oid })).tree;
    };

    return {
        engine: "isomorphic-git",
        root,
        exists: () => existsSync(join(root, ".git", "HEAD")),
        async init() {
            await mkdir(root, { recursive: true, mode: 0o700 });
            await git.init({ fs, dir, defaultBranch: "main" });
        },
        async commit(paths, message) {
            if (paths.length === 0) {
                return null;
            }
            for (const filepath of paths) {
                if (existsSync(join(dir, filepath))) {
                    await git.add({ fs, dir, filepath });
                } else {
                    await git.remove({ fs, dir, filepath });
                }
            }
            const rows = (await git.statusMatrix({
                fs,
                dir,
                filepaths: [...paths],
            })) as StatusRow[];
            if (!rows.some(staged)) {
                return null;
            }
            return git.commit({ fs, dir, message, author: AUTHOR, committer: AUTHOR });
        },
        async log(path, limit = 20) {
            if ((await resolve(MAIN)) === null) {
                return [];
            }
            let entries: Awaited<ReturnType<typeof git.log>>;
            try {
                entries = await git.log({
                    fs,
                    dir,
                    ref: MAIN,
                    ...(path === undefined ? { depth: limit } : { filepath: path }),
                });
            } catch {
                return [];
            }
            return entries.slice(0, limit).map(
                (entry): Commit => ({
                    sha: entry.oid,
                    at: new Date(entry.commit.committer.timestamp * 1000).toISOString(),
                    message: firstLine(entry.commit.message),
                }),
            );
        },
        async show(path, rev) {
            const oid = await resolve(rev);
            if (oid === null) {
                return null;
            }
            try {
                return (await git.readBlob({ fs, dir, oid, filepath: path })).blob;
            } catch {
                return null;
            }
        },
        async files(rev) {
            const oid = await resolve(rev);
            if (oid === null) {
                throw new Error(`no revision ${rev}`);
            }
            return (await git.listFiles({ fs, dir, ref: oid })).sort();
        },
        async changed() {
            const rows = (await git.statusMatrix({ fs, dir })) as StatusRow[];
            return rows
                .filter(
                    ([, head, workdir, stage]) =>
                        !(head === 1 && workdir === 1 && stage === 1),
                )
                .map(([path]) => path);
        },
        resolve,
        async setRef(name, sha) {
            await git.writeRef({ fs, dir, ref: name, value: sha, force: true });
        },
        async bundle(since) {
            const tip = await resolve(MAIN);
            if (tip === null || tip === since) {
                return null;
            }
            // main is a line: walk back from the tip to since.
            const commits: string[] = [];
            let at: string | null = tip;
            while (at !== null && at !== since) {
                commits.push(at);
                const { commit } = await git.readCommit({ fs, dir, oid: at });
                at = commit.parent[0] ?? null;
            }
            if (since !== null && at === null) {
                throw new Error(`${since} is not in main's history`);
            }
            const known = new Set<string>();
            if (since !== null) {
                const { commit } = await git.readCommit({ fs, dir, oid: since });
                await collect(commit.tree, known, new Set());
            }
            const oids = new Set<string>();
            for (const oid of commits) {
                oids.add(oid);
                const { commit } = await git.readCommit({ fs, dir, oid });
                await collect(commit.tree, oids, known);
            }
            const { packfile } = await git.packObjects({ fs, dir, oids: [...oids] });
            if (packfile === undefined) {
                throw new Error("isomorphic-git made no pack");
            }
            const header = encoder.encode(
                `# v2 git bundle\n${since === null ? "" : `-${since} prerequisite\n`}${tip} ${MAIN}\n\n`,
            );
            const out = new Uint8Array(header.length + packfile.length);
            out.set(header);
            out.set(packfile, header.length);
            return out;
        },
        async unbundle(bundle) {
            const end = headerEnd(bundle);
            const lines = decoder.decode(bundle.subarray(0, end)).split("\n");
            if (lines[0] !== "# v2 git bundle") {
                throw new Error("not a v2 git bundle");
            }
            // resolveRef takes any 40 hex digits on trust: read the commit.
            for (const line of lines.slice(1)) {
                const oid = line.slice(1, 41);
                if (line.startsWith("-") && !(await hasCommit(oid))) {
                    throw new Error(`the bundle needs ${oid}, which is missing`);
                }
            }
            const tip = lines.find((line) => line.endsWith(` ${MAIN}`))?.slice(0, 40);
            if (tip === undefined) {
                throw new Error("the bundle has no main");
            }
            const filepath = join(
                ".git",
                "objects",
                "pack",
                `pack-${crypto.randomUUID().replaceAll("-", "")}.pack`,
            );
            await mkdir(join(dir, ".git", "objects", "pack"), { recursive: true });
            await writeFile(join(dir, filepath), bundle.subarray(end + 2));
            await git.indexPack({ fs, dir, filepath });
            await git.writeRef({ fs, dir, ref: MAIN, value: tip, force: true });
            return tip;
        },
        async appendSealed(name, bytes, readme, message) {
            const tip = await resolve(SEALED);
            const leaf = name.slice("bundles/".length);
            const blob = await git.writeBlob({ fs, dir, blob: bytes });
            const note = await git.writeBlob({ fs, dir, blob: encoder.encode(readme) });
            const bundles = await git.writeTree({
                fs,
                dir,
                tree: [
                    ...(await sealedEntries(tip)).filter((entry) => entry.path !== leaf),
                    { mode: "100644", path: leaf, oid: blob, type: "blob" },
                ],
            });
            const tree = await git.writeTree({
                fs,
                dir,
                tree: [
                    { mode: "100644", path: "SEALED", oid: note, type: "blob" },
                    { mode: "040000", path: "bundles", oid: bundles, type: "tree" },
                ],
            });
            return git.commit({
                fs,
                dir,
                message,
                author: AUTHOR,
                committer: AUTHOR,
                tree,
                parent: tip === null ? [] : [tip],
                ref: SEALED,
            });
        },
        async sealedNames() {
            return (await sealedEntries(await resolve(SEALED)))
                .map((entry) => `bundles/${entry.path}`)
                .sort();
        },
        async sealedFile(name) {
            const tip = await resolve(SEALED);
            if (tip === null) {
                throw new Error("there is no sealed branch");
            }
            return (await git.readBlob({ fs, dir, oid: tip, filepath: name })).blob;
        },
        async setRemote(name, url) {
            await git.addRemote({ fs, dir, remote: name, url, force: true });
        },
        async remote(name) {
            const remotes = await git.listRemotes({ fs, dir });
            return remotes.find((remote) => remote.remote === name)?.url ?? null;
        },
        async push(remote, branch, token) {
            const url = await this.remote(remote);
            if (url === null || !https(url)) {
                throw new Error(NEEDS_BINARY);
            }
            const result = await git.push({
                fs,
                http,
                dir,
                remote,
                ref: `refs/heads/${branch}`,
                remoteRef: `refs/heads/${branch}`,
                ...auth(token),
            });
            if (!result.ok) {
                throw new Error(result.error ?? "the push was refused");
            }
        },
        async fetch(url, branch, token) {
            if (!https(url)) {
                throw new Error(NEEDS_BINARY);
            }
            const result = await git.fetch({
                fs,
                http,
                dir,
                url,
                ref: branch,
                singleBranch: true,
                tags: false,
                ...auth(token),
            });
            if (result.fetchHead === null) {
                throw new Error(`the mirror has no ${branch}`);
            }
            await git.writeRef({
                fs,
                dir,
                ref: `refs/heads/${branch}`,
                value: result.fetchHead,
                force: true,
            });
        },
        async checkout() {
            await git.checkout({ fs, dir, ref: "main", force: true });
        },
        async maintain() {},
    };
}
```

If TypeScript rejects the `this.remote(remote)` call inside `push`
(object literal `this`), hoist `remote` into a local function as
`resolve` is, and call it from both places.

- [ ] **Step 6: Write the engine's choice**

Create `src/history/open.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/open.ts
//
//

import { binaryRepo } from "./binary.js";
import { isoRepo } from "./iso.js";
import { type Engine, hasGitBinary, type MemoryRepo } from "./repo.js";

// Chosen once, for the whole process: the binary when there is one,
// isomorphic-git otherwise. Never switched, so one process never mixes
// the two engines' writes.
export async function openRepo(
    root: string,
    {
        engine,
        probe = () => hasGitBinary(),
    }: { engine?: Engine; probe?: () => Promise<boolean> } = {},
): Promise<MemoryRepo> {
    const chosen = engine ?? ((await probe()) ? "git" : "isomorphic-git");
    return chosen === "git" ? binaryRepo(root) : isoRepo(root);
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test src/history/`
Expected: PASS, the contract under both engines, the cross-engine tests
both ways and the choice.

- [ ] **Step 8: Check and commit**

Two commits: the dependency alone, then the engine.

```bash
bunx biome check --write src/history/
bun run check
git add package.json bun.lock
git commit -m "build: Add isomorphic-git"
git add src/history/iso.ts src/history/open.ts src/history/open.test.ts src/history/cross.test.ts src/history/repo.test.ts
git commit -m "feat(sdk): Fall back to isomorphic-git"
git log --oneline -2 && git status --short
```

---

### Task 5: Recovering a file

**Files:**

- Modify: `src/memory/sidecar.ts` (`writeAtomic` takes bytes)
- Modify: `src/memory/sidecar.test.ts`
- Create: `src/history/heal.ts`
- Create: `src/history/heal.test.ts`

**Interfaces:**

- Consumes: `lint` (Task 1); `MemoryRepo` (Task 3); `binaryRepo`,
  `testing.ts` helpers (Task 3).
- Produces, in `heal.ts`:
  - `type Version = { sha: string; at: string; bytes: Uint8Array }`
  - `type Healed = { kind: "restored"; path: string; from: string; at: string; broken: string } | { kind: "unrecoverable"; path: string; broken: string }`
  - `RECOVERY_DEPTH = 200`
  - `stamp(now: Date): string`: `2026-10-15T09-12-03-123Z`
  - `goodVersion(repo: MemoryRepo, path: string): Promise<Version | null>`:
    the newest committed version that passes the lint
  - `keepCopy(root: string, path: string, bytes: Uint8Array, now: Date): Promise<string>`:
    the copy's path under `broken/`, relative to `root`
  - `putBack(repo: MemoryRepo, root: string, path: string, version: Version, now: Date): Promise<string | null>`:
    writes the version, keeps what it replaces, commits both; returns
    the copy's path, or `null` when there was no file
  - `recoverFile(repo: MemoryRepo, root: string, path: string, now: Date): Promise<Healed>`
- Changes: `writeAtomic(path: string, text: string | Uint8Array): Promise<void>`

- [ ] **Step 1: Write the failing tests**

In `src/memory/sidecar.test.ts`, add `writeAtomic` to the import from
`./sidecar.js` (and `readFile` from `node:fs/promises` if it is not
imported yet), then add at the end of the file:

```ts
describe("writeAtomic", () => {
    it("writes bytes as well as text", async () => {
        const dir = await mkdtemp(join(tmpdir(), "dorothy-atomic-"));
        try {
            const path = join(dir, "file");
            await writeAtomic(path, new Uint8Array([0xff, 0x0a]));
            expect([...(await readFile(path))]).toEqual([0xff, 0x0a]);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
```

(`mkdtemp`, `rm`, `tmpdir` and `join` are imported at the top of
`sidecar.test.ts` already; add any that are not.)

Create `src/history/heal.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/heal.test.ts
//
//

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { binaryRepo } from "./binary.js";
import {
    goodVersion,
    keepCopy,
    putBack,
    RECOVERY_DEPTH,
    recoverFile,
    stamp,
} from "./heal.js";
import type { MemoryRepo } from "./repo.js";
import { put, removeRoots, TEST_ENV, tempRoot } from "./testing.js";

afterAll(removeRoots);

const NOW = new Date("2026-10-08T00:00:00.000Z");
const LATER = new Date("2026-10-09T00:00:00.000Z");
const vocabulary = (rev: number) =>
    `${JSON.stringify({ v: 1, rev, concepts: {} })}\n`;
const event = (text: string) =>
    `${JSON.stringify({ v: 1, kind: "user", at: NOW.toISOString(), text })}\n`;
const TRANSCRIPT = "transcripts/a-b-c-d.jsonl";

let repo: MemoryRepo;
let root = "";
const read = (path: string) => readFileSync(join(root, path), "utf8");
const commitFile = async (path: string, text: string, message: string) => {
    put(root, path, text);
    return (await repo.commit([path], message)) as string;
};

beforeEach(async () => {
    root = join(tempRoot(), "data");
    repo = binaryRepo(root, { env: TEST_ENV });
    await repo.init();
});

describe("stamp", () => {
    it("is a UTC time safe in a file name", () => {
        expect(stamp(NOW)).toBe("2026-10-08T00-00-00-000Z");
    });
});

describe("goodVersion", () => {
    it("finds the newest committed version that passes the lint", async () => {
        await commitFile("tags.json", vocabulary(1), "one");
        const two = await commitFile("tags.json", vocabulary(2), "two");
        // Committed by hand, past the lint.
        await commitFile("tags.json", "{", "three");
        expect(await goodVersion(repo, "tags.json")).toMatchObject({
            sha: two,
            bytes: new TextEncoder().encode(vocabulary(2)),
        });
        expect(await goodVersion(repo, "missing.json")).toBeNull();
        expect(RECOVERY_DEPTH).toBe(200);
    });
});

describe("recoverFile", () => {
    it("restores the newest good version and keeps the broken bytes", async () => {
        await commitFile("tags.json", vocabulary(1), "one");
        const two = await commitFile("tags.json", vocabulary(2), "two");
        put(root, "tags.json", "{{");
        expect(await recoverFile(repo, root, "tags.json", NOW)).toEqual({
            kind: "restored",
            path: "tags.json",
            from: two,
            at: expect.any(String),
            broken: "broken/tags.json.2026-10-08T00-00-00-000Z",
        });
        expect(read("tags.json")).toBe(vocabulary(2));
        expect(read("broken/tags.json.2026-10-08T00-00-00-000Z")).toBe("{{");
        expect((await repo.log())[0]?.message).toBe(
            `restore: tags.json from ${two.slice(0, 7)} (broken kept)`,
        );
        expect(await repo.changed()).toEqual([]);
    });

    it("keeps one copy of the same broken bytes", async () => {
        await commitFile("tags.json", vocabulary(1), "one");
        put(root, "tags.json", "{{");
        const first = await recoverFile(repo, root, "tags.json", NOW);
        put(root, "tags.json", "{{");
        const second = await recoverFile(repo, root, "tags.json", LATER);
        expect(second.broken).toBe(first.broken);
        expect(readdirSync(join(root, "broken"))).toHaveLength(1);
    });

    it("keeps a copy and restores nothing when no version is good", async () => {
        put(root, "tags.json", "{");
        expect(await recoverFile(repo, root, "tags.json", NOW)).toEqual({
            kind: "unrecoverable",
            path: "tags.json",
            broken: "broken/tags.json.2026-10-08T00-00-00-000Z",
        });
        expect(read("tags.json")).toBe("{");
        expect((await repo.log())[0]?.message).toBe(
            "broken: tags.json kept, no good version",
        );
    });

    it("restores a cut transcript, keeping what was left of it", async () => {
        await commitFile(TRANSCRIPT, event("one") + event("two"), "turn");
        put(root, TRANSCRIPT, event("one"));
        expect((await recoverFile(repo, root, TRANSCRIPT, NOW)).kind).toBe(
            "restored",
        );
        expect(read(TRANSCRIPT)).toBe(event("one") + event("two"));
        expect(
            read("broken/transcripts/a-b-c-d.jsonl.2026-10-08T00-00-00-000Z"),
        ).toBe(event("one"));
    });
});

describe("putBack", () => {
    it("puts an earlier version over a valid file, keeping the file", async () => {
        const one = await commitFile("tags.json", vocabulary(1), "one");
        await commitFile("tags.json", vocabulary(2), "two");
        const bytes = (await repo.show("tags.json", one)) as Uint8Array;
        const copy = await putBack(
            repo,
            root,
            "tags.json",
            { sha: one, at: NOW.toISOString(), bytes },
            NOW,
        );
        expect(copy).toBe("broken/tags.json.2026-10-08T00-00-00-000Z");
        expect(read("tags.json")).toBe(vocabulary(1));
        expect(read(copy as string)).toBe(vocabulary(2));
    });

    it("puts back a deleted file with nothing to keep", async () => {
        const one = await commitFile("tags.json", vocabulary(1), "one");
        rmSync(join(root, "tags.json"));
        const bytes = (await repo.show("tags.json", one)) as Uint8Array;
        expect(
            await putBack(
                repo,
                root,
                "tags.json",
                { sha: one, at: NOW.toISOString(), bytes },
                NOW,
            ),
        ).toBeNull();
        expect(read("tags.json")).toBe(vocabulary(1));
    });
});

describe("keepCopy", () => {
    it("files a copy under broken/, beside the path it came from", async () => {
        expect(
            await keepCopy(root, TRANSCRIPT, new Uint8Array([1]), NOW),
        ).toBe("broken/transcripts/a-b-c-d.jsonl.2026-10-08T00-00-00-000Z");
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/history/heal.test.ts src/memory/sidecar.test.ts`
Expected: FAIL, "Cannot find module './heal.js'", and the `writeAtomic`
test with a type error or a wrong file (it writes a string today).

- [ ] **Step 3: Let `writeAtomic` take bytes**

In `src/memory/sidecar.ts`, change `writeAtomic`'s signature, leaving its
body as it is (`writeFile` takes both):

```ts
export async function writeAtomic(
    path: string,
    text: string | Uint8Array,
): Promise<void> {
```

- [ ] **Step 4: Write recovery**

Create `src/history/heal.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/heal.ts
//
//

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { writeAtomic } from "../memory/sidecar.js";
import { lint } from "./lint.js";
import type { MemoryRepo } from "./repo.js";

export type Version = { sha: string; at: string; bytes: Uint8Array };
export type Healed =
    | {
          kind: "restored";
          path: string;
          from: string;
          at: string;
          broken: string;
      }
    | { kind: "unrecoverable"; path: string; broken: string };

// How many of a file's commits recovery looks through for a good one.
export const RECOVERY_DEPTH = 200;

// A UTC time safe in a file name: 2026-10-15T09-12-03-123Z.
export const stamp = (now: Date) =>
    now.toISOString().replaceAll(/[:.]/g, "-");

// The newest committed version of a file that passes the lint on its own.
export async function goodVersion(
    repo: MemoryRepo,
    path: string,
): Promise<Version | null> {
    for (const commit of await repo.log(path, RECOVERY_DEPTH)) {
        const bytes = await repo.show(path, commit.sha);
        if (bytes !== null && lint(path, bytes, null) === null) {
            return { sha: commit.sha, at: commit.at, bytes };
        }
    }
    return null;
}

// Keeps a file's bytes under broken/, beside the path they came from and
// named for when; when the newest copy already holds them, that copy is
// returned rather than another made. The path is relative to root.
export async function keepCopy(
    root: string,
    path: string,
    bytes: Uint8Array,
    now: Date,
): Promise<string> {
    const folder = join("broken", dirname(path));
    const name = basename(path);
    let copies: string[] = [];
    try {
        copies = (await readdir(join(root, folder)))
            .filter((entry) => entry.startsWith(`${name}.`))
            .sort();
    } catch {
        // No copies yet.
    }
    const newest = copies.at(-1);
    if (
        newest !== undefined &&
        Buffer.compare(await readFile(join(root, folder, newest)), bytes) === 0
    ) {
        return join(folder, newest);
    }
    const copy = join(folder, `${name}.${stamp(now)}`);
    await mkdir(join(root, folder), { recursive: true, mode: 0o700 });
    await writeFile(join(root, copy), bytes, { mode: 0o600 });
    return copy;
}

// Writes a version in place, keeping what it replaces, and commits both;
// the copy's path, or null when no file was there.
export async function putBack(
    repo: MemoryRepo,
    root: string,
    path: string,
    version: Version,
    now: Date,
): Promise<string | null> {
    const full = join(root, path);
    const copy = existsSync(full)
        ? await keepCopy(root, path, await readFile(full), now)
        : null;
    await writeAtomic(full, version.bytes);
    await repo.commit(
        copy === null ? [path] : [copy, path],
        `restore: ${path} from ${version.sha.slice(0, 7)} (broken kept)`,
    );
    return copy;
}

// A file that failed the lint: put back its newest good version, or, when
// it has none, keep a copy and leave it.
export async function recoverFile(
    repo: MemoryRepo,
    root: string,
    path: string,
    now: Date,
): Promise<Healed> {
    const good = await goodVersion(repo, path);
    if (good === null) {
        const broken = await keepCopy(
            root,
            path,
            await readFile(join(root, path)),
            now,
        );
        await repo.commit([broken], `broken: ${path} kept, no good version`);
        return { kind: "unrecoverable", path, broken };
    }
    const broken = (await putBack(repo, root, path, good, now)) ?? "";
    return { kind: "restored", path, from: good.sha, at: good.at, broken };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/history/heal.test.ts src/memory/sidecar.test.ts`
Expected: PASS, every test.

- [ ] **Step 6: Check and commit**

```bash
bunx biome check --write src/history/heal.ts src/history/heal.test.ts src/memory/sidecar.ts src/memory/sidecar.test.ts
bun run check
git add src/history/heal.ts src/history/heal.test.ts src/memory/sidecar.ts src/memory/sidecar.test.ts
git commit -m "feat(sdk): Restore a broken file from history"
git log --oneline -1 && git status --short
```

---

### Task 6: `MemoryHistory`

**Files:**

- Modify: `src/memory/sidecar.ts` (history's types, for memory's writers)
- Modify: `src/config.ts`, `src/config.test.ts` (`[history]`)
- Create: `src/history/lock.ts`, `src/history/lock.test.ts`
- Create: `src/history/history.ts`, `src/history/history.test.ts`

**Interfaces:**

- Consumes: `lint`, `fileKind` (Task 1); `MemoryRepo`, `MAIN`, `Engine`
  (Task 3); `openRepo` (Task 4); `recoverFile`, `stamp` (Task 5);
  `parseTable`, `toggle`, `whole` inside `src/config.ts`;
  `transcriptDir` from `src/transcript.ts`.
- Produces, in `src/memory/sidecar.ts`:
  - `type Recorder = (paths: readonly string[], message: string) => Promise<void>`
  - `type Recording = { recorder: Recorder; message: string; also?: readonly string[] }`
  - `type HistoryHandle = { recorder: Recorder; lock: Lock; sweep(): Promise<void>; heal(path: string): Promise<boolean>; close(): void }`
  - `type OpenHistory = (index: { lock: Lock } | null) => Promise<HistoryHandle | null>`
- Produces, in `src/config.ts`: `type HistoryConfig = { enabled: boolean; pushSeconds: number }`,
  `Config.history`, defaults `{ enabled: true, pushSeconds: 60 }`.
- Produces, in `lock.ts`: `class FileLock { static open(path: string, busyMs?: number): FileLock; readonly lock: Lock; close(): void }`
- Produces, in `history.ts`:
  - `historyRoot(env?: Env): string`: the data directory
  - `HOOK_MARK`, `hookScript(exec: string, script: string): string`
  - `type HookCommand = { exec: string; script: string }`
  - `class MemoryHistory` with `static open(options)`, `repo`, `root`,
    `lock`, `record(paths, message)` (the caller holds the lock),
    `recorder`, `sweep()`, `turn(path, count)`, `heal(path)` (each takes
    the lock), `afterCommit(fn)`, `warn(message)`, `subscribe(listener)`,
    `takeWarnings()`, `handle(close)`
  - `type OpenedHistory = { ok: true; history: MemoryHistory; close(): void } | { ok: false; reason: string }`
  - `openHistory(options: { root: string; index: { lock: Lock } | null; engine?: Engine; hook?: HookCommand | null; warn?: (message: string) => void; now?: () => Date }): Promise<OpenedHistory>`

- [ ] **Step 1: Add history's types to `src/memory/sidecar.ts`**

After the `Lock` type, add:

```ts
// Commits paths with a message once they are written, inside the lock
// they were written under. It never throws: a failed commit is warned of
// and retried by history (src/history/), which memory never imports.
export type Recorder = (
    paths: readonly string[],
    message: string,
) => Promise<void>;
// A write's commit: its message, and any files written beside it.
export type Recording = {
    recorder: Recorder;
    message: string;
    also?: readonly string[];
};
// What memory sees of history.
export type HistoryHandle = {
    recorder: Recorder;
    // The lock history commits under: the index's, or history's own.
    lock: Lock;
    // Commits or restores whatever changed while Dorothy was away.
    sweep(): Promise<void>;
    // Restores a file found broken; true when it was. Takes the lock.
    heal(path: string): Promise<boolean>;
    close(): void;
};
// For a command: history with the index's lock, or null when it is off.
export type OpenHistory = (
    index: { lock: Lock } | null,
) => Promise<HistoryHandle | null>;
```

- [ ] **Step 2: Write the failing config tests**

In `src/config.test.ts`, add inside the top-level `describe` that tests
`parseConfig` (or at the end of the file, in a `describe("[history]")`):

```ts
it("reads [history]", () => {
    expect(DEFAULT_CONFIG.history).toEqual({ enabled: true, pushSeconds: 60 });
    expect(
        parseConfig("[history]\nenabled = false\npush-seconds = 300\n"),
    ).toEqual({
        config: {
            ...DEFAULT_CONFIG,
            history: { enabled: false, pushSeconds: 300 },
        },
        warnings: [],
    });
    expect(parseConfig("[history]\npush-seconds = 5\n").warnings).toEqual([
        "config.toml: history.push-seconds must be a whole number from 10 to 86400",
    ]);
});
```

(Import `DEFAULT_CONFIG` and `parseConfig` from `./config.js` if the file
does not already.)

- [ ] **Step 3: Run the config tests to verify they fail**

Run: `bun test src/config.test.ts`
Expected: FAIL; `DEFAULT_CONFIG.history` is undefined and `[history]` is
an unknown key.

- [ ] **Step 4: Add `[history]` to the config**

In `src/config.ts`, after `CompactionConfig`:

```ts
export type HistoryConfig = {
    enabled: boolean;
    // Seconds between pushes to the mirror, at most.
    pushSeconds: number;
};
```

Add `history: HistoryConfig;` to `Config`, and to `DEFAULT_CONFIG` after
`compaction`:

```ts
    history: {
        enabled: true,
        pushSeconds: 60,
    },
```

After `parseMemory`:

```ts
const parseHistory = (value: unknown, warnings: string[]): HistoryConfig =>
    parseTable(
        "history",
        value,
        DEFAULT_CONFIG.history,
        {
            enabled: toggle("enabled"),
            pushSeconds: whole("push-seconds", 10, 86400),
        },
        warnings,
    );
```

and in `parseConfig`, after the `compaction` branch:

```ts
        } else if (key === "history") {
            config.history = parseHistory(value, warnings);
```

Run `bun run typecheck`: any test or module that builds a whole `Config`
by hand rather than spreading `DEFAULT_CONFIG` now lacks `history`; give
it `history: DEFAULT_CONFIG.history`. `config.test.ts`'s "reads both
tables" test is one: its expected config gains
`history: { enabled: true, pushSeconds: 60 }`.

- [ ] **Step 5: Run the config tests to verify they pass**

Run: `bun test src/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing lock and history tests**

Create `src/history/lock.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/lock.test.ts
//
//

import { afterAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { FileLock } from "./lock.js";
import { removeRoots, tempRoot } from "./testing.js";

afterAll(removeRoots);

describe("FileLock", () => {
    it("holds another connection off until the work is done", async () => {
        const path = join(tempRoot(), ".git", "dorothy.lock");
        const a = FileLock.open(path);
        const b = FileLock.open(path, 50);
        let release = () => {};
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const first = a.lock(async () => {
            await held;
            return "a";
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
        await expect(b.lock(async () => "b")).rejects.toThrow();
        release();
        expect(await first).toBe("a");
        expect(await b.lock(async () => "b")).toBe("b");
        a.close();
        b.close();
    });

    it("takes turns within one process, and lets go after a failure", async () => {
        const lock = FileLock.open(join(tempRoot(), "lock"));
        const order: string[] = [];
        await Promise.all([
            lock.lock(async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                order.push("first");
            }),
            lock.lock(async () => {
                order.push("second");
            }),
        ]);
        expect(order).toEqual(["first", "second"]);
        await expect(
            lock.lock(async () => {
                throw new Error("no");
            }),
        ).rejects.toThrow("no");
        expect(await lock.lock(async () => 1)).toBe(1);
        lock.close();
    });
});
```

Create `src/history/history.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/history.test.ts
//
//

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_SIDECAR } from "../memory/sidecar.js";
import {
    HOOK_MARK,
    hookScript,
    type MemoryHistory,
    openHistory,
} from "./history.js";
import { put, removeRoots, tempRoot } from "./testing.js";

afterAll(removeRoots);

const NOW = new Date("2026-10-08T00:00:00.000Z");
const PHRASE = "a-b-c-d";
const SIDECAR = `transcripts/${PHRASE}.meta.json`;
const TRANSCRIPT = `transcripts/${PHRASE}.jsonl`;
const vocabulary = (rev: number) =>
    `${JSON.stringify({ v: 1, rev, concepts: {} })}\n`;
const sidecar = (title: string) =>
    `${JSON.stringify({ ...EMPTY_SIDECAR, rev: 1, title })}\n`;
const event = (text: string) =>
    `${JSON.stringify({ v: 1, kind: "user", at: NOW.toISOString(), text })}\n`;

let root = "";
let warnings: string[] = [];
const closers: (() => void)[] = [];

beforeEach(() => {
    root = join(tempRoot(), "data");
    warnings = [];
});
afterEach(() => {
    for (const close of closers.splice(0)) {
        close();
    }
});

async function open(
    options: { quiet?: boolean; hook?: { exec: string; script: string } } = {},
): Promise<MemoryHistory> {
    const opened = await openHistory({
        root,
        index: null,
        engine: "git",
        now: () => NOW,
        hook: options.hook ?? null,
        ...(options.quiet ? {} : { warn: (message: string) => warnings.push(message) }),
    });
    if (!opened.ok) {
        throw new Error(opened.reason);
    }
    closers.push(opened.close);
    return opened.history;
}

const messages = async (history: MemoryHistory) =>
    (await history.repo.log(undefined, 50)).map((commit) => commit.message);
const record = (history: MemoryHistory, paths: string[], message: string) =>
    history.lock(() =>
        history.record(
            paths.map((path) => join(root, path)),
            message,
        ),
    );

describe("adopting", () => {
    it("commits what the directory holds, once", async () => {
        put(root, "tags.json", vocabulary(1));
        put(root, TRANSCRIPT, event("hi"));
        const history = await open();
        expect(await messages(history)).toEqual(["adopt: 3 files"]);
        expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe("*.tmp\n");
        expect(await history.repo.files("HEAD")).toEqual([
            ".gitignore",
            "tags.json",
            TRANSCRIPT,
        ]);
        await open();
        expect(await messages(history)).toEqual(["adopt: 3 files"]);
    });

    it("adopts a directory that is not there yet", async () => {
        const history = await open();
        expect(await messages(history)).toEqual(["adopt: 1 files"]);
    });

    it("moves a broken file aside, and says so", async () => {
        put(root, "tags.json", "{");
        const history = await open();
        expect(existsSync(join(root, "tags.json"))).toBe(false);
        const copy = "broken/tags.json.2026-10-08T00-00-00-000Z";
        expect(readFileSync(join(root, copy), "utf8")).toBe("{");
        expect(await history.repo.files("HEAD")).toContain(copy);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(
            /^history: tags\.json was broken \(.+\); it is kept in broken\/tags\.json\.2026-10-08T00-00-00-000Z$/,
        );
    });

    it("writes its pre-commit hook, and never replaces the user's", async () => {
        const hook = { exec: "/usr/bin/bun", script: "/opt/dorothy/src/index.ts" };
        await open({ hook });
        const path = join(root, ".git", "hooks", "pre-commit");
        expect(readFileSync(path, "utf8")).toBe(hookScript(hook.exec, hook.script));
        expect(statSync(path).mode & 0o777).toBe(0o700);
        writeFileSync(path, "#!/bin/sh\nexit 0\n");
        await open({ hook });
        expect(readFileSync(path, "utf8")).toBe("#!/bin/sh\nexit 0\n");
    });

    it("hooks a lint that steps aside when Dorothy is gone", () => {
        const script = hookScript("/usr/bin/bun", "/it's/index.ts");
        expect(script).toContain(HOOK_MARK);
        expect(script).toContain(
            "exec '/usr/bin/bun' '/it'\\''s/index.ts' --check --staged",
        );
        expect(script).toContain("if [ ! -f '/it'\\''s/index.ts' ]; then");
    });
});

describe("recording", () => {
    it("commits a change once, under its message", async () => {
        const history = await open();
        put(root, SIDECAR, sidecar("One"));
        put(root, "tags.json", vocabulary(1));
        const message = `review: ${PHRASE} (dorothy, claude-test)`;
        await record(history, [SIDECAR, "tags.json"], message);
        expect(await messages(history)).toEqual([message, "adopt: 1 files"]);
        await record(history, [SIDECAR], "again");
        await history.lock(() => history.record(["/elsewhere/file"], "away"));
        expect(await messages(history)).toEqual([message, "adopt: 1 files"]);
    });

    it("commits an outside change first, as its own", async () => {
        put(root, "tags.json", vocabulary(1));
        const history = await open();
        put(root, "tags.json", vocabulary(2));
        put(root, SIDECAR, sidecar("One"));
        await record(history, [SIDECAR], `edit: ${PHRASE} (user)`);
        expect(await messages(history)).toEqual([
            `edit: ${PHRASE} (user)`,
            "outside: tags.json",
            "adopt: 2 files",
        ]);
    });

    it("commits another chat's new turns as a turn, never as outside", async () => {
        put(root, TRANSCRIPT, event("one"));
        const history = await open();
        appendFileSync(join(root, TRANSCRIPT), event("two"));
        put(root, "tags.json", vocabulary(1));
        await record(history, ["tags.json"], "edit-tags: 1 concepts (user)");
        expect((await messages(history)).slice(0, 2)).toEqual([
            "edit-tags: 1 concepts (user)",
            `turn: ${PHRASE}`,
        ]);
    });

    it("restores a file an outside edit broke, and warns", async () => {
        put(root, "tags.json", vocabulary(1));
        const history = await open();
        put(root, "tags.json", "{");
        put(root, SIDECAR, sidecar("One"));
        await record(history, [SIDECAR], `edit: ${PHRASE} (user)`);
        expect(readFileSync(join(root, "tags.json"), "utf8")).toBe(vocabulary(1));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(
            /^Restored tags\.json from [0-9a-f]{7} \(\d{4}-\d\d-\d\d\); the broken copy is in broken\/$/,
        );
    });

    it("restores rather than commits a named file that fails the lint", async () => {
        put(root, "tags.json", vocabulary(1));
        const history = await open();
        put(root, "tags.json", "{");
        await record(history, ["tags.json"], "edit-tags: 1 concepts (user)");
        expect(readFileSync(join(root, "tags.json"), "utf8")).toBe(vocabulary(1));
        expect((await messages(history))[0]).toMatch(/^restore: tags\.json from /);
    });

    it("commits a failed change with the next, as a catch-up", async () => {
        const history = await open();
        const commit = history.repo.commit;
        let fail = true;
        history.repo.commit = async (paths, message) => {
            if (fail) {
                fail = false;
                throw new Error("disk full");
            }
            return commit(paths, message);
        };
        put(root, "tags.json", vocabulary(1));
        await record(history, ["tags.json"], "edit-tags: 1 concepts (user)");
        expect(warnings).toEqual([
            "history: couldn't commit (disk full); it will be committed with the next change",
        ]);
        put(root, SIDECAR, sidecar("One"));
        await record(history, [SIDECAR], `edit: ${PHRASE} (user)`);
        expect(await messages(history)).toEqual([
            `edit: ${PHRASE} (user)`,
            "catch-up: tags.json",
            "adopt: 1 files",
        ]);
    });

    it("calls back after each commit", async () => {
        const history = await open();
        let commits = 0;
        history.afterCommit(() => {
            commits += 1;
        });
        put(root, "tags.json", vocabulary(1));
        await record(history, ["tags.json"], "edit-tags: 1 concepts (user)");
        await record(history, ["tags.json"], "unchanged");
        expect(commits).toBe(1);
    });

    it("gives memory a recorder, the lock and healing", async () => {
        const history = await open();
        let closed = false;
        const handle = history.handle(() => {
            closed = true;
        });
        put(root, "tags.json", vocabulary(1));
        await handle.lock(() =>
            handle.recorder([join(root, "tags.json")], "edit-tags: 1 concepts (user)"),
        );
        expect((await messages(history))[0]).toBe("edit-tags: 1 concepts (user)");
        handle.close();
        expect(closed).toBe(true);
    });
});

describe("taking the lock itself", () => {
    it("commits a turn with its count", async () => {
        const history = await open();
        put(root, TRANSCRIPT, event("one"));
        await history.turn(join(root, TRANSCRIPT), 3);
        expect((await messages(history))[0]).toBe(`turn: ${PHRASE} #3`);
    });

    it("heals a file found broken, and only a broken one", async () => {
        put(root, "tags.json", vocabulary(1));
        const history = await open();
        put(root, "tags.json", "{");
        expect(await history.heal(join(root, "tags.json"))).toBe(true);
        expect(readFileSync(join(root, "tags.json"), "utf8")).toBe(vocabulary(1));
        expect(await history.heal(join(root, "tags.json"))).toBe(false);
        expect(await history.heal(join(root, "missing.json"))).toBe(false);
    });

    it("sweeps up what changed while Dorothy was away", async () => {
        put(root, "tags.json", vocabulary(1));
        const history = await open();
        put(root, "tags.json", vocabulary(2));
        await history.sweep();
        expect((await messages(history))[0]).toBe("outside: tags.json");
    });
});

describe("warnings", () => {
    it("wait for the first subscriber, and come once each", async () => {
        const history = await open({ quiet: true });
        put(root, `transcripts/${PHRASE}.meta.json`, "[]");
        await history.sweep();
        await history.sweep();
        const notices: unknown[] = [];
        history.subscribe((notice) => notices.push(notice));
        expect(notices).toEqual([
            {
                type: "warning",
                message: `history: ${SIDECAR} is broken (not a JSON object) and has no good version; a copy is in broken/`,
            },
        ]);
        expect(history.takeWarnings()).toEqual([]);
    });

    it("can be taken before anyone subscribes", async () => {
        const history = await open({ quiet: true });
        history.warn("one");
        history.warn("one");
        expect(history.takeWarnings()).toEqual(["one"]);
    });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `bun test src/history/lock.test.ts src/history/history.test.ts`
Expected: FAIL with "Cannot find module './lock.js'" and
"Cannot find module './history.js'".

- [ ] **Step 8: Write the lock**

Create `src/history/lock.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/lock.ts
//
//

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Lock } from "../memory/sidecar.js";

// History's own write lock, for when there is no recall index to hold
// one: SQLite's, on a file of its own, the way the index holds its lock.
// Other processes wait for it, and SQLite lets go if this one dies; work
// in this process takes turns.
export class FileLock {
    readonly #db: Database;
    #queue: Promise<unknown> = Promise.resolve();

    private constructor(db: Database) {
        this.#db = db;
    }

    static open(path: string, busyMs = 5000): FileLock {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        const db = new Database(path, { create: true });
        db.run(`PRAGMA busy_timeout = ${busyMs}`);
        return new FileLock(db);
    }

    readonly lock: Lock = <T>(work: () => Promise<T>): Promise<T> => {
        const run = async (): Promise<T> => {
            this.#db.run("BEGIN IMMEDIATE");
            try {
                const value = await work();
                this.#db.run("COMMIT");
                return value;
            } catch (error) {
                try {
                    this.#db.run("ROLLBACK");
                } catch {
                    // A failed statement may have ended the transaction.
                }
                throw error;
            }
        };
        const result = this.#queue.then(run, run);
        this.#queue = result.catch(() => {});
        return result;
    };

    close(): void {
        this.#db.close();
    }
}
```

- [ ] **Step 9: Write `MemoryHistory`**

Create `src/history/history.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/history.ts
//
//

import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { HistoryHandle, Lock, Recorder } from "../memory/sidecar.js";
import { transcriptDir } from "../transcript.js";
import type { Env } from "../xdg.js";
import { recoverFile, stamp } from "./heal.js";
import { fileKind, lint } from "./lint.js";
import { FileLock } from "./lock.js";
import { openRepo } from "./open.js";
import { type Engine, MAIN, type MemoryRepo } from "./repo.js";

export type HistoryNotice = { type: "warning"; message: string };
export type HookCommand = { exec: string; script: string };

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// The data directory: transcripts/, tags.json and, now, .git/.
export const historyRoot = (env: Env = process.env) =>
    dirname(transcriptDir(env));

// A hook carrying this line is Dorothy's to rewrite; one without it is the
// user's, and never replaced.
export const HOOK_MARK = "# dorothy pre-commit";

const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

// The pre-commit hook: the user's own commits in the data directory are
// linted as Dorothy's are. When Dorothy is gone it steps aside, rather
// than block every commit.
export function hookScript(exec: string, script: string): string {
    return [
        "#!/bin/sh",
        HOOK_MARK,
        "# Lints what is staged, as Dorothy lints her own commits.",
        `if [ ! -f ${quote(script)} ]; then`,
        "    echo 'dorothy: its entry script is gone; not linted' >&2",
        "    exit 0",
        "fi",
        `exec ${quote(exec)} ${quote(script)} --check --staged`,
        "",
    ].join("\n");
}

export type HistoryOptions = {
    repo: MemoryRepo;
    lock: Lock;
    now?: () => Date;
    // Where warnings go; without it they wait for a subscriber.
    warn?: (message: string) => void;
    // The command the pre-commit hook runs Dorothy with.
    hook?: HookCommand | null;
};

// Dorothy's memory as a history of commits. Each logical change is one
// commit, made under the lock the change was written under; whatever
// else changed is committed first, alone, or restored when it fails the
// lint. Nothing here throws at a writer: failures are warnings.
export class MemoryHistory {
    readonly repo: MemoryRepo;
    readonly root: string;
    readonly lock: Lock;
    readonly #now: () => Date;
    readonly #warnTo: ((message: string) => void) | undefined;
    readonly #listeners = new Set<(notice: HistoryNotice) => void>();
    readonly #waiting: string[] = [];
    readonly #warned = new Set<string>();
    readonly #catchUp = new Set<string>();
    #afterCommit: () => void = () => {};

    private constructor(options: HistoryOptions) {
        this.repo = options.repo;
        this.root = options.repo.root;
        this.lock = options.lock;
        this.#now = options.now ?? (() => new Date());
        this.#warnTo = options.warn;
    }

    // Adopts the directory first when it holds no commits yet. Throws when
    // the repository can't be used at all.
    static async open(options: HistoryOptions): Promise<MemoryHistory> {
        const history = new MemoryHistory(options);
        await history.lock(async () => {
            if (
                !history.repo.exists() ||
                (await history.repo.resolve(MAIN)) === null
            ) {
                await history.#adopt();
            }
        });
        if (options.hook) {
            await history.#installHook(options.hook);
        }
        return history;
    }

    // For memory's writers, which call it inside the lock.
    readonly recorder: Recorder = (paths, message) =>
        this.record(paths, message);

    // What memory sees of history; close is whoever opened it's.
    handle(close: () => void = () => {}): HistoryHandle {
        return {
            recorder: this.recorder,
            lock: this.lock,
            sweep: () => this.sweep(),
            heal: (path) => this.heal(path),
            close,
        };
    }

    afterCommit(fn: () => void): void {
        this.#afterCommit = fn;
    }

    // One logical change. The caller holds the lock. Paths may be absolute
    // or relative to the root; ones outside it are passed over.
    async record(paths: readonly string[], message: string): Promise<void> {
        const named = this.#relative(paths);
        if (named.length === 0) {
            return;
        }
        try {
            await this.#settle(new Set(named));
            await this.#commitChecked(named, message);
        } catch (error) {
            for (const path of named) {
                this.#catchUp.add(path);
            }
            this.warn(
                `history: couldn't commit (${describeError(error)}); it will be committed with the next change`,
            );
        }
    }

    // At launch: whatever changed while Dorothy was away.
    sweep(): Promise<void> {
        return this.lock(async () => {
            try {
                await this.#settle(new Set());
            } catch (error) {
                this.warn(
                    `history: couldn't look for changes (${describeError(error)})`,
                );
            }
        });
    }

    // A turn of the live conversation, once its transcript is flushed.
    turn(path: string, count: number): Promise<void> {
        return this.lock(() =>
            this.record([path], `turn: ${basename(path, ".jsonl")} #${count}`),
        );
    }

    // A file found broken mid-run, outside the lock; true when it was
    // restored and may be read again.
    heal(path: string): Promise<boolean> {
        const [named] = this.#relative([path]);
        if (named === undefined) {
            return Promise.resolve(false);
        }
        return this.lock(async () => {
            try {
                const problem = await this.#problem(named);
                return problem !== null && (await this.#recover(named, problem));
            } catch (error) {
                this.warn(
                    `history: couldn't restore ${named} (${describeError(error)})`,
                );
                return false;
            }
        });
    }

    warn(message: string): void {
        if (this.#warned.has(message)) {
            return;
        }
        this.#warned.add(message);
        if (this.#warnTo !== undefined) {
            this.#warnTo(message);
        } else if (this.#listeners.size > 0) {
            for (const listener of this.#listeners) {
                listener({ type: "warning", message });
            }
        } else {
            this.#waiting.push(message);
        }
    }

    // Warnings no one has heard yet, for a screen that shows them at once.
    takeWarnings(): string[] {
        return this.#waiting.splice(0);
    }

    subscribe(listener: (notice: HistoryNotice) => void): () => void {
        this.#listeners.add(listener);
        for (const message of this.#waiting.splice(0)) {
            listener({ type: "warning", message });
        }
        return () => {
            this.#listeners.delete(listener);
        };
    }

    #relative(paths: readonly string[]): string[] {
        const named = new Set<string>();
        for (const path of paths) {
            const inside = isAbsolute(path) ? relative(this.root, path) : path;
            if (inside !== "" && !inside.startsWith("..") && !isAbsolute(inside)) {
                named.add(inside.split(sep).join("/"));
            }
        }
        return [...named];
    }

    // Why a file may not be committed as it is, or null; a missing file is
    // a deletion, which may.
    async #problem(path: string): Promise<string | null> {
        const full = join(this.root, path);
        if (!existsSync(full)) {
            return null;
        }
        const committed =
            fileKind(path) === "transcript"
                ? await this.repo.show(path, "HEAD")
                : null;
        return lint(path, await readFile(full), committed);
    }

    async #commit(paths: readonly string[], message: string): Promise<void> {
        if ((await this.repo.commit(paths, message)) !== null) {
            this.#afterCommit();
        }
    }

    // Commits the paths that pass the lint; the rest are restored.
    async #commitChecked(
        paths: readonly string[],
        message: string,
    ): Promise<void> {
        const clean: string[] = [];
        for (const path of paths) {
            const problem = await this.#problem(path);
            if (problem === null) {
                clean.push(path);
            } else {
                await this.#recover(path, problem);
            }
        }
        await this.#commit(clean, message);
    }

    // Before a change of Dorothy's: what an earlier failed commit left,
    // then whatever else changed, each in a commit of its own. A
    // transcript that grew is a conversation's own turns, whoever wrote
    // them, never an outside change.
    async #settle(except: ReadonlySet<string>): Promise<void> {
        if (this.#catchUp.size > 0) {
            const paths = [...this.#catchUp];
            await this.#commitChecked(paths, `catch-up: ${paths.join(", ")}`);
            this.#catchUp.clear();
        }
        for (const path of await this.repo.changed()) {
            if (except.has(path)) {
                continue;
            }
            const problem = await this.#problem(path);
            if (problem !== null) {
                await this.#recover(path, problem);
                continue;
            }
            await this.#commit(
                [path],
                fileKind(path) === "transcript"
                    ? `turn: ${basename(path, ".jsonl")}`
                    : `outside: ${path}`,
            );
        }
    }

    async #recover(path: string, reason: string): Promise<boolean> {
        const healed = await recoverFile(this.repo, this.root, path, this.#now());
        this.#afterCommit();
        if (healed.kind === "restored") {
            this.warn(
                `Restored ${path} from ${healed.from.slice(0, 7)} (${healed.at.slice(0, 10)}); the broken copy is in broken/`,
            );
            return true;
        }
        this.warn(
            `history: ${path} is broken (${reason}) and has no good version; a copy is in broken/`,
        );
        return false;
    }

    async #adopt(): Promise<void> {
        if (!this.repo.exists()) {
            await this.repo.init();
        }
        const ignore = join(this.root, ".gitignore");
        if (!existsSync(ignore)) {
            await writeFile(ignore, "*.tmp\n", { mode: 0o600 });
        }
        const kept: string[] = [];
        for (const path of await this.repo.changed()) {
            const full = join(this.root, path);
            const problem = lint(path, await readFile(full), null);
            if (problem === null) {
                kept.push(path);
                continue;
            }
            const copy = `broken/${path}.${stamp(this.#now())}`;
            await mkdir(dirname(join(this.root, copy)), {
                recursive: true,
                mode: 0o700,
            });
            await rename(full, join(this.root, copy));
            kept.push(copy);
            this.warn(
                `history: ${path} was broken (${problem}); it is kept in ${copy}`,
            );
        }
        await this.#commit(kept, `adopt: ${kept.length} files`);
    }

    async #installHook({ exec, script }: HookCommand): Promise<void> {
        const path = join(this.root, ".git", "hooks", "pre-commit");
        const wanted = hookScript(exec, script);
        let current: string | null = null;
        try {
            current = await readFile(path, "utf8");
        } catch {
            // No hook yet.
        }
        if (current === wanted || (current !== null && !current.includes(HOOK_MARK))) {
            return;
        }
        try {
            await mkdir(dirname(path), { recursive: true, mode: 0o700 });
            await writeFile(path, wanted, { mode: 0o700 });
            await chmod(path, 0o700);
        } catch (error) {
            this.warn(
                `history: couldn't write the pre-commit hook (${describeError(error)})`,
            );
        }
    }
}

export type OpenedHistory =
    | { ok: true; history: MemoryHistory; close(): void }
    | { ok: false; reason: string };

// History under the index's lock when the index is open, otherwise under
// a lock of its own in .git; not ok, with the reason, when it can't be
// used at all.
export async function openHistory({
    root,
    index,
    engine,
    hook = null,
    warn,
    now,
}: {
    root: string;
    index: { lock: Lock } | null;
    engine?: Engine;
    hook?: HookCommand | null;
    warn?: (message: string) => void;
    now?: () => Date;
}): Promise<OpenedHistory> {
    let file: FileLock | null = null;
    try {
        const repo = await openRepo(root, engine === undefined ? {} : { engine });
        if (index === null) {
            file = FileLock.open(join(root, ".git", "dorothy.lock"));
        }
        const history = await MemoryHistory.open({
            repo,
            lock: index?.lock ?? (file as FileLock).lock,
            hook,
            ...(warn === undefined ? {} : { warn }),
            ...(now === undefined ? {} : { now }),
        });
        const held = file;
        return { ok: true, history, close: () => held?.close() };
    } catch (error) {
        file?.close();
        return { ok: false, reason: `history is off: ${describeError(error)}` };
    }
}
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `bun test src/history/ src/config.test.ts`
Expected: PASS, every test.

- [ ] **Step 11: Check and commit**

Two commits: the config, then history.

```bash
bunx biome check --write src/config.ts src/config.test.ts src/memory/sidecar.ts src/history/
bun run check
git add src/config.ts src/config.test.ts
git commit -m "feat(sdk): Configure memory history"
git add src/memory/sidecar.ts src/history/lock.ts src/history/lock.test.ts src/history/history.ts src/history/history.test.ts
git commit -m "feat(sdk): Record each change to memory"
git log --oneline -2 && git status --short
```

---

### Task 7: Memory's writers record

**Files:**

- Modify: `src/memory/sidecar.ts` (`updateSidecar` records)
- Modify: `src/memory/vocabulary.ts` (`updateVocabulary` records)
- Modify: `src/memory/service.ts`, `src/memory/service.test.ts`
- Modify: `src/memory/commands.ts`, `src/memory/commands.test.ts`
- Create: `src/history/commands.ts`, `src/history/commands.test.ts`
- Modify: `src/index.ts` (the memory commands get the opener)

**Interfaces:**

- Consumes: `Recorder`, `Recording`, `HistoryHandle`, `OpenHistory`
  (Task 6, `src/memory/sidecar.ts`); `openHistory`, `historyRoot`,
  `HookCommand` (Task 6); `readConfig` from `src/config.ts`.
- Produces:
  - `updateSidecar(dir, phrase, change, lock?, record?: Recording)`
  - `updateVocabulary(path, change, lock?, record?: Recording)`
  - `MemoryServiceOptions.versions?: HistoryHandle | null`
  - `runList`, `runTags`, `runMemoryEdit`, `runTagsEdit` take
    `openHistory?: OpenHistory` among their options
  - in `src/history/commands.ts`:
    `entryHook(): HookCommand | null` and
    `commandHistory(options?: { env?: Env; err?: Output; hook?: HookCommand | null }): OpenHistory`,
    with `type Output = { write(text: string): unknown }`

A write records inside the lock it was written under, right after its
atomic rename. Healing takes the lock, so it happens only where no lock
is held (Ruling 10).

- [ ] **Step 1: Write the failing service tests**

In `src/memory/service.test.ts`, add `type HistoryHandle` to the import
from `./sidecar.js`, then add at the end of the file:

```ts
describe("versions", () => {
    const OTHER = phrase(1);
    const tagsPath = () => join(dir, "tags.json");

    // A history that records what it is asked to and heals with the
    // function given; healing under its lock fails the test.
    function fakeVersions(
        heal: (path: string) => Promise<boolean> = async () => false,
    ) {
        const recorded: { paths: readonly string[]; message: string }[] = [];
        const healed: string[] = [];
        let locked = false;
        const versions: HistoryHandle = {
            recorder: async (paths, message) => {
                recorded.push({ paths, message });
            },
            lock: async (work) => {
                locked = true;
                try {
                    return await work();
                } finally {
                    locked = false;
                }
            },
            sweep: async () => {},
            heal: async (path) => {
                if (locked) {
                    throw new Error("healed under the lock");
                }
                healed.push(path);
                return heal(path);
            },
            close: () => {},
        };
        return { versions, recorded, healed };
    }

    it("records the provisional title", async () => {
        const { versions, recorded } = fakeVersions();
        const { memory } = setup({ queryFn: reviews().fn, versions });
        memory.sent("Hey there");
        await until(() => recorded.length > 0);
        expect(recorded).toEqual([
            {
                paths: [sidecarPath(dir, LIVE)],
                message: `title: ${LIVE} (prompt)`,
            },
        ]);
    });

    it("records a review with the vocabulary beside it", async () => {
        await transcript(LIVE, [user("Hi"), reply("Hello")]);
        const { versions, recorded } = fakeVersions();
        const { memory } = setup({
            queryFn: reviews({ ...NOTES, tags: [], coined: [] }).fn,
            versions,
            vocabulary: tagsPath(),
        });
        memory.turnEnded();
        await until(() =>
            recorded.some((entry) => entry.message.startsWith("review:")),
        );
        expect(recorded).toContainEqual({
            paths: [sidecarPath(dir, LIVE), tagsPath()],
            message: `review: ${LIVE} (dorothy, claude-test)`,
        });
    });

    it("records a failed review's mark", async () => {
        await transcript(LIVE, [user("Hi"), reply("Hello")]);
        const { versions, recorded } = fakeVersions();
        const { memory } = setup({
            queryFn: reviews(new Error("down")).fn,
            versions,
        });
        memory.turnEnded();
        await until(() => recorded.length > 0);
        expect(recorded).toEqual([
            {
                paths: [sidecarPath(dir, LIVE)],
                message: `review: ${LIVE} (dorothy, failed)`,
            },
        ]);
    });

    it("heals a broken vocabulary before a review, never under the lock", async () => {
        await writeFile(tagsPath(), "{");
        await transcript(OTHER, [user("a"), reply("b")]);
        const { versions, healed } = fakeVersions(async (path) => {
            await writeFile(path, '{"v":1,"rev":1,"concepts":{}}');
            return true;
        });
        const { memory } = setup({
            queryFn: reviews({
                ...NOTES,
                tags: ["memory"],
                coined: [{ prefLabel: "memory", scopeNote: "Remembering." }],
            }).fn,
            versions,
            vocabulary: tagsPath(),
            entries: [entry(OTHER, null)],
        });
        memory.ready();
        await until(async () => ((await sidecarOf(OTHER))?.tags.length ?? 0) > 0);
        expect(healed).toEqual([tagsPath()]);
        expect((await sidecarOf(OTHER))?.tags).toHaveLength(1);
    });

    it("heals a broken sidecar before reviewing it", async () => {
        await transcript(OTHER, [user("a"), reply("b")]);
        await writeFile(sidecarPath(dir, OTHER), "[]");
        const { versions, healed } = fakeVersions(async (path) => {
            await writeFile(path, JSON.stringify(EMPTY_SIDECAR));
            return true;
        });
        const { memory } = setup({
            queryFn: reviews(NOTES).fn,
            versions,
            entries: [entry(OTHER, null)],
        });
        memory.ready();
        await until(async () => (await sidecarOf(OTHER))?.title === NOTES.title);
        expect(healed).toEqual([sidecarPath(dir, OTHER)]);
    });
});
```

- [ ] **Step 2: Run the service tests to verify they fail**

Run: `bun test src/memory/service.test.ts`
Expected: FAIL in `versions`: nothing is recorded, and nothing healed.

- [ ] **Step 3: Record in `updateSidecar` and `updateVocabulary`**

In `src/memory/sidecar.ts`, give `updateSidecar` a fifth parameter and
record after the write, inside `write` (so inside the lock):

```ts
export function updateSidecar(
    dir: string,
    phrase: string,
    change: (
        current: Sidecar | null,
    ) => Sidecar | null | Promise<Sidecar | null>,
    lock?: Lock,
    record?: Recording,
): Promise<UpdateResult> {
```

and in `write`, after `await writeAtomic(path, ...)`:

```ts
        await record?.recorder([path, ...(record.also ?? [])], record.message);
```

In `src/memory/vocabulary.ts`, import `type Recording` from
`./sidecar.js` beside `Lock`, give `updateVocabulary` a fourth parameter
`record?: Recording`, and in its `write`, after
`await writeVocabulary(path, vocabulary);`:

```ts
        await record?.recorder([path, ...(record.also ?? [])], record.message);
```

- [ ] **Step 4: Record and heal in the service**

In `src/memory/service.ts`:

1. Import `type HistoryHandle`, `type Lock` and `type Recording` from
   `./sidecar.js`, and `sidecarPath` if it is not imported yet.
2. In `MemoryServiceOptions`, after `vocabulary`:

   ```ts
       // History: each write is committed, and a broken file is restored
       // before a review reads it. Null or absent without.
       versions?: HistoryHandle | null;
   ```

3. Add the field `readonly #versions: HistoryHandle | null;`, set in the
   constructor with `this.#versions = options.versions ?? null;`, and two
   helpers beside `#warn`:

   ```ts
       // The lock writes take: the index's, or history's own without it.
       get #lock(): Lock | undefined {
           return this.#index?.lock ?? this.#versions?.lock;
       }

       #recording(
           message: string,
           also: readonly string[] = [],
       ): Recording | undefined {
           return this.#versions === null
               ? undefined
               : { recorder: this.#versions.recorder, message, also };
       }
   ```

4. In `sent`, the provisional title's write becomes:

   ```ts
           void updateSidecar(
               this.#dir,
               this.#phrase,
               (current) => withProvisional(current, title, at),
               this.#lock,
               this.#recording(`title: ${this.#phrase} (prompt)`),
           ).then((result) => {
   ```

5. In the review (the method holding `const lock = this.#index?.lock;`),
   that line becomes `const lock = this.#lock;`, and the three
   `updateSidecar` calls after it gain a fifth argument:
   - the one writing `markReviewed` (every note the user's):
     `this.#recording(`review: ${phrase} (dorothy, nothing new)`)`
   - the one writing `markFailed`:
     `this.#recording(`review: ${phrase} (dorothy, failed)`)`
   - the one writing `mergeReview`:

     ```ts
                 this.#recording(
                     `review: ${phrase} (dorothy, ${outcome.model})`,
                     this.#vocabulary === null ? [] : [this.#vocabulary],
                 ),
     ```

6. In `#readVocabulary`, replace `const read = await readVocabulary(path);`
   with:

   ```ts
           let read = await readVocabulary(path);
           // Restored from history, it is read again. Never inside the
           // lock: healing takes it.
           if (
               read.kind === "unparseable" &&
               (await this.#versions?.heal(path))
           ) {
               read = await readVocabulary(path);
           }
   ```

7. In `#reviewClaimed`, replace
   `const read = await readSidecar(this.#dir, phrase);` with:

   ```ts
           let read = await readSidecar(this.#dir, phrase);
           if (
               read.kind === "unparseable" &&
               (await this.#versions?.heal(sidecarPath(this.#dir, phrase)))
           ) {
               read = await readSidecar(this.#dir, phrase);
           }
   ```

`#tag`, which runs inside the sidecar's lock, is unchanged: a vocabulary
broken there still leaves the tags as they are.

- [ ] **Step 5: Run the service tests to verify they pass**

Run: `bun test src/memory/service.test.ts src/memory/sidecar.test.ts src/memory/vocabulary.test.ts`
Expected: PASS, the new tests and every existing one.

- [ ] **Step 6: Write the failing command tests**

In `src/memory/commands.test.ts`, add `type HistoryHandle` and
`type OpenHistory` to the import from `./sidecar.js`, then add after the
`editor` helper:

```ts
// A history that notes what each command asks of it.
function fakeHistory() {
    const calls: string[] = [];
    const recorded: { paths: readonly string[]; message: string }[] = [];
    const handle: HistoryHandle = {
        recorder: async (paths, message) => {
            recorded.push({ paths, message });
        },
        lock: (work) => work(),
        sweep: async () => {
            calls.push("sweep");
        },
        heal: async () => false,
        close: () => {
            calls.push("close");
        },
    };
    const openHistory: OpenHistory = async (index) => {
        calls.push(index === null ? "open without index" : "open");
        return handle;
    };
    return { openHistory, calls, recorded };
}
```

and these tests, each in the `describe` of its command:

```ts
    // In describe("runList"):
    it("sweeps history before reading, and closes it", async () => {
        const history = fakeHistory();
        const out = capture();
        expect(
            await runList({
                env,
                out,
                err: capture(),
                now: NOW.getTime(),
                openHistory: history.openHistory,
            }),
        ).toBe(0);
        expect(history.calls).toEqual(["open", "close"]);
    });
```

The opener itself sweeps (Step 9), so a command only opens and closes.

```ts
    // In describe("runMemoryEdit"):
    it("records the user's edit with the vocabulary beside it", async () => {
        await writeFile(join(transcripts, `${a}.jsonl`), chat);
        const history = fakeHistory();
        const { edit } = editor((text) => ({
            ok: true,
            text: text.replace("Title:", "Title: Mine"),
        }));
        expect(
            await runMemoryEdit(a, {
                env,
                err: capture(),
                edit,
                now: () => NOW,
                openHistory: history.openHistory,
            }),
        ).toBe(0);
        expect(history.recorded).toEqual([
            {
                paths: [
                    sidecarPath(transcripts, a),
                    join(dir, "dorothy", "tags.json"),
                ],
                message: `edit: ${a} (user)`,
            },
        ]);
        expect(history.calls).toEqual(["open", "close"]);
    });
```

```ts
    // In describe("runTagsEdit"), beside the test that renames memory:
    it("records the edit, counting the concepts it changed", async () => {
        await writeFile(tagsFile(), JSON.stringify(vocabulary));
        const history = fakeHistory();
        expect(
            await runTagsEdit({
                env,
                err: capture(),
                edit: async (text: string): Promise<EditResult> => ({
                    ok: true,
                    text: text.replace("Tag: memory", "Tag: remembering"),
                }),
                now: () => NOW,
                openHistory: history.openHistory,
            }),
        ).toBe(0);
        expect(history.recorded).toEqual([
            { paths: [tagsFile()], message: "edit-tags: 1 concepts (user)" },
        ]);
    });
```

(Use the names the surrounding `describe` blocks already define:
`tagsFile` and `vocabulary` in `runTagsEdit`'s; `a` and `capture` as
above. If `runTags`' `describe` defines its own `tagsFile`, a test there
is not needed: `runTags` changes as `runList` does.)

- [ ] **Step 7: Run the command tests to verify they fail**

Run: `bun test src/memory/commands.test.ts`
Expected: FAIL; the commands take no `openHistory` yet.

- [ ] **Step 8: Open history in the commands**

In `src/memory/commands.ts`, add `type OpenHistory` to the import from
`./sidecar.js` and `type TagsEdit` to the import from `./tags-view.js`.
Each command opens history once it has tried the index and before it
reads anything, and closes it first in the `finally` that closes the
index. Replace the four functions with these (the loops are as they
were, apart from the lock and the recording passed to the writes):

```ts
// What Dorothy remembers, as a new session would see it. It works whether
// memory is on or not: it is the user's view, not hers.
export async function runList({
    env = process.env,
    out = process.stdout,
    err = process.stderr,
    now = Date.now(),
    openHistory,
}: {
    env?: Env;
    out?: Output;
    err?: Output;
    now?: number;
    openHistory?: OpenHistory;
} = {}): Promise<number> {
    const { config, warnings } = await readConfig(env);
    let index: RecallIndex;
    try {
        index = RecallIndex.open(indexPath(env));
    } catch (error) {
        err.write(
            `dorothy: the memory index can't be opened: ${describeError(error)}\n`,
        );
        return 1;
    }
    // Whatever changed while Dorothy was away is committed, or restored,
    // before anything is read.
    const versions = (await openHistory?.(index)) ?? null;
    try {
        const loaded = await indexCatalogue(index, transcriptDir(env)).load();
        for (const warning of [...warnings, ...loaded.warnings]) {
            err.write(`dorothy: ${warning}\n`);
        }
        const tiered = tier(
            rank(loaded.entries, {
                now,
                halfLifeDays: config.memory.halfLifeDays,
            }),
            config.memory.budget,
        );
        out.write(`${formatList(listRows(loaded.entries, tiered))}\n`);
        return 0;
    } finally {
        versions?.close();
        index.close();
    }
}

// The vocabulary as a tree, each concept with how many chats carry it,
// hidden ones too: the user's view, not hers.
export async function runTags({
    env = process.env,
    out = process.stdout,
    err = process.stderr,
    now = Date.now(),
    openHistory,
}: {
    env?: Env;
    out?: Output;
    err?: Output;
    now?: number;
    openHistory?: OpenHistory;
} = {}): Promise<number> {
    const path = vocabularyPath(env);
    let index: RecallIndex;
    try {
        index = RecallIndex.open(indexPath(env));
    } catch (error) {
        err.write(
            `dorothy: the memory index can't be opened: ${describeError(error)}\n`,
        );
        return 1;
    }
    // Whatever changed while Dorothy was away is committed, or restored,
    // before anything is read.
    const versions = (await openHistory?.(index)) ?? null;
    try {
        const read = await readVocabulary(path);
        if (read.kind === "unparseable") {
            err.write(`dorothy: ${path}: ${read.reason}\n`);
            return 1;
        }
        for (const warning of await syncIndex(
            index,
            transcriptDir(env),
            now,
            path,
        )) {
            err.write(`dorothy: ${warning}\n`);
        }
        const counts = await index.exclusive(() => carrierCounts(index));
        const tree = renderTagsTree(
            read.kind === "ok" ? read.vocabulary : EMPTY_VOCABULARY,
            counts,
        );
        if (tree !== "") {
            out.write(`${tree}\n`);
        }
        return 0;
    } catch (error) {
        err.write(
            `dorothy: the memory index failed: ${describeError(error)}\n`,
        );
        return 1;
    } finally {
        versions?.close();
        index.close();
    }
}

// Opens a conversation's notes in $EDITOR until they parse, then writes
// only what the user changed.
export async function runMemoryEdit(
    phrase: string,
    {
        env = process.env,
        err = process.stderr,
        edit = (text: string) => editInEditor(text),
        now = () => new Date(),
        openHistory,
    }: {
        env?: Env;
        err?: Output;
        edit?: (text: string) => Promise<EditResult>;
        now?: () => Date;
        openHistory?: OpenHistory;
    } = {},
): Promise<number> {
    const dir = transcriptDir(env);
    const transcript = join(dir, `${phrase}.jsonl`);
    try {
        await access(transcript);
    } catch (error) {
        err.write(`dorothy: no chat ${phrase}: ${describeError(error)}\n`);
        return 1;
    }
    let index: RecallIndex | null = null;
    try {
        index = RecallIndex.open(indexPath(env));
    } catch {
        // Without the index the edit takes history's lock, or none, as
        // before recall.
    }
    // Whatever changed while Dorothy was away is committed, or restored,
    // before anything is read.
    const versions = (await openHistory?.(index)) ?? null;
    const lock = index?.lock ?? versions?.lock;
    try {
        const read = await readSidecar(dir, phrase);
        if (read.kind === "unparseable") {
            err.write(`dorothy: ${sidecarPath(dir, phrase)}: ${read.reason}\n`);
            return 1;
        }
        const shown = read.kind === "ok" ? read.sidecar : null;
        const path = vocabularyPath(env);
        const tags = tagsContext(await readVocabulary(path));
        let text = renderEditView(phrase, shown, tags);
        for (;;) {
            const result = await edit(text);
            if (!result.ok) {
                err.write(`dorothy: ${result.message}\n`);
                return 1;
            }
            const reopen = (reason: string) =>
                `# error: ${reason}\n${result.text.replace(ERROR_LINES, "")}`;
            // Labels resolve against the vocabulary as it is now, so one
            // coined while the editor was open is known. Broken meanwhile,
            // it leaves the line to be checked against what was shown.
            const fresh = tagsContext(await readVocabulary(path));
            const parsed = parseEditView(
                result.text,
                shown,
                fresh.kind === "ok" ? fresh : tags,
            );
            if (parsed.kind === "unchanged") {
                return 0;
            }
            if (parsed.kind === "error") {
                text = reopen(parsed.reason);
                continue;
            }
            const at = now().toISOString();
            const refused = { tags: false };
            // Under the sidecar's lock the vocabulary is read once more:
            // the tags as they are now, a review's among them, are pruned
            // only against one that reads, and kept as they are otherwise.
            const update = await updateSidecar(
                dir,
                phrase,
                async (current) => {
                    const latest = await readVocabulary(path);
                    if (latest.kind === "unparseable") {
                        if (parsed.changes.tags !== undefined) {
                            refused.tags = true;
                            return null;
                        }
                        return mergeEdit(current, parsed.changes, at);
                    }
                    const next = mergeEdit(current, parsed.changes, at);
                    return {
                        ...next,
                        tags: resolveTags(
                            latest.kind === "ok"
                                ? latest.vocabulary
                                : EMPTY_VOCABULARY,
                            next.tags,
                        ),
                    };
                },
                lock,
                versions === null
                    ? undefined
                    : {
                          recorder: versions.recorder,
                          message: `edit: ${phrase} (user)`,
                          also: [path],
                      },
            );
            if (refused.tags) {
                text = reopen(TAGS_BROKEN);
                continue;
            }
            if (update.kind === "unparseable" || update.kind === "failed") {
                err.write(
                    `dorothy: ${sidecarPath(dir, phrase)}: ${update.reason}\n`,
                );
                return 1;
            }
            return 0;
        }
    } finally {
        versions?.close();
        index?.close();
    }
}

// How many concepts an edit touches, for its commit.
const edited = (edit: TagsEdit) =>
    edit.changed.size +
    edit.created.length +
    edit.deleted.length +
    edit.merged.size;

export async function runTagsEdit({
    env = process.env,
    err = process.stderr,
    edit = (text: string) => editInEditor(text),
    now = () => new Date(),
    openHistory,
}: {
    env?: Env;
    err?: Output;
    edit?: (text: string) => Promise<EditResult>;
    now?: () => Date;
    openHistory?: OpenHistory;
} = {}): Promise<number> {
    const path = vocabularyPath(env);
    let index: RecallIndex | null = null;
    try {
        index = RecallIndex.open(indexPath(env));
    } catch {
        // Without the index the view has no counts and the save takes
        // history's lock, or none, as --memory's does.
    }
    // Whatever changed while Dorothy was away is committed, or restored,
    // before anything is read.
    const versions = (await openHistory?.(index)) ?? null;
    try {
        const read = await readVocabulary(path);
        if (read.kind === "unparseable") {
            err.write(`dorothy: ${path}: ${read.reason}\n`);
            return 1;
        }
        const shown = read.kind === "ok" ? read.vocabulary : EMPTY_VOCABULARY;
        let counts = new Map<string, number>();
        if (index !== null) {
            const opened = index;
            try {
                await syncIndex(opened, transcriptDir(env), now().getTime(), path);
                counts = await opened.exclusive(() => carrierCounts(opened));
            } catch {
                // A failed sync leaves the view without counts; the index
                // still holds the lock.
            }
        }
        let text = renderTagsView(shown, counts);
        for (;;) {
            const result = await edit(text);
            if (!result.ok) {
                err.write(`dorothy: ${result.message}\n`);
                return 1;
            }
            const reopen = (reason: string) =>
                `# error: ${reason}\n${result.text.replace(ERROR_LINES, "")}`;
            const parsed = parseTagsView(result.text, shown);
            if (parsed.kind === "unchanged") {
                return 0;
            }
            if (parsed.kind === "error") {
                text = reopen(parsed.reason);
                continue;
            }
            const at = now().toISOString();
            const refused: { reason: string | null } = { reason: null };
            const update = await updateVocabulary(
                path,
                (current) => {
                    const applied = applyTagsEdit(current, parsed.edit, at);
                    if (!applied.ok) {
                        refused.reason = applied.reason;
                        return null;
                    }
                    return applied.vocabulary;
                },
                index?.lock ?? versions?.lock,
                versions === null
                    ? undefined
                    : {
                          recorder: versions.recorder,
                          message: `edit-tags: ${edited(parsed.edit)} concepts (user)`,
                      },
            );
            if (refused.reason !== null) {
                text = reopen(refused.reason);
                continue;
            }
            if (update.kind === "unparseable" || update.kind === "failed") {
                err.write(`dorothy: ${path}: ${update.reason}\n`);
                return 1;
            }
            return 0;
        }
    } finally {
        versions?.close();
        index?.close();
    }
}
```

- [ ] **Step 9: Write the opener**

Create `src/history/commands.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/commands.test.ts
//
//

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { binaryRepo } from "./binary.js";
import { commandHistory } from "./commands.js";
import { put, removeRoots, TEST_ENV, tempRoot } from "./testing.js";

afterAll(removeRoots);

function capture() {
    let text = "";
    return {
        write: (chunk: string) => {
            text += chunk;
        },
        get text() {
            return text;
        },
    };
}

let home = "";
let env: Record<string, string> = {};
beforeEach(() => {
    home = tempRoot();
    env = { XDG_DATA_HOME: home, XDG_CONFIG_HOME: home, HOME: home };
});

const messages = async () =>
    (await binaryRepo(join(home, "dorothy"), { env: TEST_ENV }).log()).map(
        (commit) => commit.message,
    );

describe("commandHistory", () => {
    it("adopts and sweeps the data directory, and closes", async () => {
        put(home, "dorothy/tags.json", '{"v":1,"rev":1,"concepts":{}}\n');
        const err = capture();
        const handle = await commandHistory({ env, err, hook: null })(null);
        expect(handle).not.toBeNull();
        expect(await messages()).toEqual(["adopt: 2 files"]);
        put(home, "dorothy/tags.json", '{"v":1,"rev":2,"concepts":{}}\n');
        await handle?.sweep();
        expect((await messages())[0]).toBe("outside: tags.json");
        handle?.close();
        expect(err.text).toBe(
            "dorothy: memory has no mirror · dorothy --mirror <url>\n",
        );
    });

    it("is off when the config says so", async () => {
        mkdirSync(join(home, "dorothy"), { recursive: true });
        writeFileSync(
            join(home, "dorothy", "config.toml"),
            "[history]\nenabled = false\n",
        );
        expect(await commandHistory({ env, hook: null })(null)).toBeNull();
    });

    it("says why when history can't be used, and goes on without", async () => {
        // The data directory is a file.
        writeFileSync(join(home, "dorothy"), "");
        const err = capture();
        expect(await commandHistory({ env, err, hook: null })(null)).toBeNull();
        expect(err.text).toStartWith("dorothy: history is off: ");
    });
});
```

Create `src/history/commands.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/commands.ts
//
//

import { resolve } from "node:path";
import { readConfig } from "../config.js";
import type { OpenHistory } from "../memory/sidecar.js";
import type { Env } from "../xdg.js";
import { type HookCommand, historyRoot, openHistory } from "./history.js";
import { MIRROR, NO_MIRROR } from "./repo.js";

export type Output = { write(text: string): unknown };

// How the pre-commit hook runs this Dorothy: the same bun, the same entry
// script.
export function entryHook(): HookCommand | null {
    const script = process.argv[1];
    return script === undefined
        ? null
        : { exec: process.execPath, script: resolve(script) };
}

// For memory's commands: history under the index's lock (or its own),
// swept before the command reads anything. Null when the config turns it
// off, or when it can't be used, which is said on err.
export function commandHistory({
    env = process.env,
    err = process.stderr,
    hook = entryHook(),
}: { env?: Env; err?: Output; hook?: HookCommand | null } = {}): OpenHistory {
    return async (index) => {
        const { config } = await readConfig(env);
        if (!config.history.enabled) {
            return null;
        }
        const warn = (message: string) => err.write(`dorothy: ${message}\n`);
        const opened = await openHistory({
            root: historyRoot(env),
            index,
            hook,
            warn,
        });
        if (!opened.ok) {
            warn(opened.reason);
            return null;
        }
        await opened.history.sweep();
        if ((await opened.history.repo.remote(MIRROR)) === null) {
            warn(NO_MIRROR);
        }
        return opened.history.handle(opened.close);
    };
}
```

The config warnings `readConfig` returns are the commands' own to print;
the opener leaves them.

- [ ] **Step 10: Pass the opener from the entry point**

In `src/index.ts`, each memory command gets the opener:

```ts
    } else if (mode.kind === "list") {
        const { runList } = await import("./memory/commands.js");
        const { commandHistory } = await import("./history/commands.js");
        process.exitCode = await runList({ openHistory: commandHistory() });
    } else if (mode.kind === "memory") {
        const { runMemoryEdit } = await import("./memory/commands.js");
        const { commandHistory } = await import("./history/commands.js");
        process.exitCode = await runMemoryEdit(mode.phrase, {
            openHistory: commandHistory(),
        });
    } else if (mode.kind === "tags") {
        const { runTags } = await import("./memory/commands.js");
        const { commandHistory } = await import("./history/commands.js");
        process.exitCode = await runTags({ openHistory: commandHistory() });
    } else if (mode.kind === "tags-edit") {
        const { runTagsEdit } = await import("./memory/commands.js");
        const { commandHistory } = await import("./history/commands.js");
        process.exitCode = await runTagsEdit({
            openHistory: commandHistory(),
        });
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `bun test src/memory/ src/history/ src/index.test.ts`
Expected: PASS, every test.

- [ ] **Step 12: Check and commit**

Two commits: memory's writers, then the commands.

```bash
bunx biome check --write src/memory/ src/history/ src/index.ts
bun run check
git add src/memory/sidecar.ts src/memory/vocabulary.ts src/memory/service.ts src/memory/service.test.ts
git commit -m "feat(sdk): Record reviews and titles in history"
git add src/memory/commands.ts src/memory/commands.test.ts src/history/commands.ts src/history/commands.test.ts src/index.ts
git commit -m "feat(sdk): Sweep history before memory commands"
git log --oneline -2 && git status --short
```

---

### Task 8: The sealed mirror

**Files:**

- Create: `src/history/mirror.ts`
- Create: `src/history/mirror.test.ts`

**Interfaces:**

- Consumes: `MemoryRepo`, `MAIN`, `MIRROR`, `SEALED`, `SEALED_THROUGH`
  (Task 3);
  `seal`, `unseal`, `sealedName`, `SEALED_README` (Task 2); `Lock`
  (`src/memory/sidecar.ts`); `Timers`, `REAL_TIMERS` (`src/timers.ts`).
- Produces:
  - `sealPending(repo: MemoryRepo, key: Uint8Array): Promise<boolean>`:
    the caller holds the lock
  - `waiting(repo: MemoryRepo): Promise<boolean>`: main has commits not
    yet sealed
  - `type PushOutcome = { kind: "no-mirror" } | { kind: "no-key" } | { kind: "pushed"; sealed: boolean } | { kind: "failed"; reason: string }`
  - `class Mirror { constructor(options: MirrorOptions); schedule(): void; push(): Promise<PushOutcome>; stop(): void }`
    with `type MirrorOptions = { repo: MemoryRepo; lock: Lock; key: () => Uint8Array | null; token: () => string | null; warn: (message: string) => void; pushMs: number; timers?: Timers }`
  - `type Recovered = { applied: number; of: number; tip: string | null; stopped: string | null }`
  - `recover(options: { repo: MemoryRepo; url: string; key: Uint8Array; token: string | null }): Promise<Recovered>`

- [ ] **Step 1: Write the failing tests**

Create `src/history/mirror.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/mirror.test.ts
//
//

import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Lock } from "../memory/sidecar.js";
import type { Timers } from "../timers.js";
import { binaryRepo } from "./binary.js";
import { isoRepo } from "./iso.js";
import { Mirror, recover, sealPending, waiting } from "./mirror.js";
import { MAIN, type MemoryRepo, SEALED_THROUGH } from "./repo.js";
import { bareRepo, put, removeRoots, TEST_ENV, tempRoot } from "./testing.js";

afterAll(removeRoots);

const KEY = new Uint8Array(32).fill(3);
const OTHER = new Uint8Array(32).fill(4);
const lock: Lock = (work) => work();

class FakeTimers implements Timers {
    #next = 1;
    readonly pending = new Map<number, () => void>();
    set(fn: () => void): number {
        const id = this.#next++;
        this.pending.set(id, fn);
        return id;
    }
    clear(handle: unknown): void {
        this.pending.delete(handle as number);
    }
    fire(): void {
        for (const [id, fn] of [...this.pending]) {
            this.pending.delete(id);
            fn();
        }
    }
}

async function repoWith(files: Record<string, string>): Promise<MemoryRepo> {
    const repo = binaryRepo(join(tempRoot(), "data"), { env: TEST_ENV });
    await repo.init();
    await commit(repo, files, "adopt");
    return repo;
}

async function commit(
    repo: MemoryRepo,
    files: Record<string, string>,
    message: string,
): Promise<void> {
    for (const [path, text] of Object.entries(files)) {
        put(repo.root, path, text);
    }
    await repo.commit(Object.keys(files), message);
}

function mirrorOf(
    repo: MemoryRepo,
    { key = KEY, timers = new FakeTimers() }: { key?: Uint8Array | null; timers?: FakeTimers } = {},
) {
    const warnings: string[] = [];
    const mirror = new Mirror({
        repo,
        lock,
        key: () => key,
        token: () => null,
        warn: (message) => warnings.push(message),
        pushMs: 60_000,
        timers,
    });
    return { mirror, warnings, timers };
}

describe("sealPending", () => {
    it("seals new commits as the next bundle, and nothing twice", async () => {
        const repo = await repoWith({ "tags.json": "{}\n" });
        expect(await waiting(repo)).toBe(true);
        expect(await sealPending(repo, KEY)).toBe(true);
        expect(await waiting(repo)).toBe(false);
        expect(await sealPending(repo, KEY)).toBe(false);
        await commit(repo, { "tags.json": "{ }\n" }, "two");
        expect(await sealPending(repo, KEY)).toBe(true);
        expect(await repo.sealedNames()).toEqual([
            "bundles/000001.enc",
            "bundles/000002.enc",
        ]);
        expect(await repo.resolve(SEALED_THROUGH)).toBe(
            await repo.resolve(MAIN),
        );
    });
});

describe("Mirror", () => {
    it("pushes the sealed branch to the mirror", async () => {
        const bare = await bareRepo();
        const repo = await repoWith({ "tags.json": "{}\n" });
        await repo.setRemote("mirror", bare);
        const { mirror, warnings } = mirrorOf(repo);
        expect(await mirror.push()).toEqual({ kind: "pushed", sealed: true });
        expect(await mirror.push()).toEqual({ kind: "pushed", sealed: false });
        const proc = Bun.spawn(
            ["git", "--git-dir", bare, "ls-tree", "-r", "--name-only", "refs/heads/sealed"],
            { env: TEST_ENV, stdout: "pipe" },
        );
        expect((await new Response(proc.stdout).text()).trim().split("\n")).toEqual([
            "SEALED",
            "bundles/000001.enc",
        ]);
        expect(warnings).toEqual([]);
    });

    it("says when there is no mirror, and warns when there is no key", async () => {
        const repo = await repoWith({ "tags.json": "{}\n" });
        const without = mirrorOf(repo);
        expect(await without.mirror.push()).toEqual({ kind: "no-mirror" });
        expect(without.warnings).toEqual([]);
        await repo.setRemote("mirror", await bareRepo());
        const keyless = mirrorOf(repo, { key: null });
        expect(await keyless.mirror.push()).toEqual({ kind: "no-key" });
        expect(keyless.warnings).toEqual([
            "history: the mirror needs DOROTHY_MIRROR_KEY; set it with dorothy --mirror",
        ]);
        expect(await repo.sealedNames()).toEqual([]);
    });

    it("warns of a failed push and keeps what it sealed", async () => {
        const repo = await repoWith({ "tags.json": "{}\n" });
        await repo.setRemote("mirror", join(tempRoot(), "nowhere.git"));
        const { mirror, warnings } = mirrorOf(repo);
        const outcome = await mirror.push();
        expect(outcome.kind).toBe("failed");
        expect(warnings[0]).toStartWith("history: couldn't push to the mirror (");
        expect(await repo.sealedNames()).toEqual(["bundles/000001.enc"]);
    });

    it("pushes at most once a period, and not after it stops", async () => {
        const repo = await repoWith({ "tags.json": "{}\n" });
        const { mirror, timers } = mirrorOf(repo);
        mirror.schedule();
        mirror.schedule();
        expect(timers.pending.size).toBe(1);
        timers.fire();
        expect(timers.pending.size).toBe(0);
        mirror.schedule();
        mirror.stop();
        expect(timers.pending.size).toBe(0);
        mirror.schedule();
        expect(timers.pending.size).toBe(0);
    });
});

describe("recover", () => {
    async function mirrored(): Promise<{ bare: string; repo: MemoryRepo }> {
        const bare = await bareRepo();
        const repo = await repoWith({
            "tags.json": "{}\n",
            "transcripts/a-b-c-d.jsonl": '{"v":1,"kind":"user"}\n',
        });
        await repo.setRemote("mirror", bare);
        const { mirror } = mirrorOf(repo);
        await mirror.push();
        await commit(
            repo,
            { "transcripts/a-b-c-d.jsonl": '{"v":1,"kind":"user"}\n{"v":1,"kind":"assistant"}\n' },
            "turn: a-b-c-d #1",
        );
        await mirror.push();
        return { bare, repo };
    }

    it("rebuilds a data directory from every sealed bundle", async () => {
        const { bare, repo } = await mirrored();
        const fresh = binaryRepo(join(tempRoot(), "data"), { env: TEST_ENV });
        expect(await recover({ repo: fresh, url: bare, key: KEY, token: null })).toEqual({
            applied: 2,
            of: 2,
            tip: await repo.resolve(MAIN),
            stopped: null,
        });
        for (const path of ["tags.json", "transcripts/a-b-c-d.jsonl"]) {
            expect(readFileSync(join(fresh.root, path), "utf8")).toBe(
                readFileSync(join(repo.root, path), "utf8"),
            );
        }
        expect((await fresh.log()).map((commit) => commit.message)).toEqual([
            "turn: a-b-c-d #1",
            "adopt",
        ]);
        expect(await fresh.remote("mirror")).toBe(bare);
        expect(await waiting(fresh)).toBe(false);
    });

    it("stops at a bundle that will not open", async () => {
        const { bare } = await mirrored();
        const fresh = binaryRepo(join(tempRoot(), "data"), { env: TEST_ENV });
        expect(await recover({ repo: fresh, url: bare, key: OTHER, token: null })).toEqual({
            applied: 0,
            of: 2,
            tip: null,
            stopped: "bundles/000001.enc: it does not open with this key, or it was changed",
        });
    });

    it("says why when the mirror can't be reached", async () => {
        const { bare } = await mirrored();
        const fresh = isoRepo(join(tempRoot(), "data"));
        const recovered = await recover({ repo: fresh, url: bare, key: KEY, token: null });
        expect(recovered).toEqual({
            applied: 0,
            of: 0,
            tip: null,
            stopped: "this mirror needs the git binary",
        });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/history/mirror.test.ts`
Expected: FAIL with "Cannot find module './mirror.js'".

- [ ] **Step 3: Write the mirror**

Create `src/history/mirror.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/mirror.ts
//
//

import type { Lock } from "../memory/sidecar.js";
import { REAL_TIMERS, type Timers } from "../timers.js";
import {
    MAIN,
    MIRROR,
    type MemoryRepo,
    SEALED,
    SEALED_THROUGH,
} from "./repo.js";
import { SEALED_README, seal, sealedName, unseal } from "./seal.js";

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// The commits on main since the last sealed one, sealed as the next bundle
// on the sealed branch; false when there were none. The caller holds the
// lock.
export async function sealPending(
    repo: MemoryRepo,
    key: Uint8Array,
): Promise<boolean> {
    const since = await repo.resolve(SEALED_THROUGH);
    const tip = await repo.resolve(MAIN);
    if (tip === null || tip === since) {
        return false;
    }
    const bundle = await repo.bundle(since);
    if (bundle === null) {
        return false;
    }
    const sequence = (await repo.sealedNames()).length + 1;
    await repo.appendSealed(
        sealedName(sequence),
        await seal(bundle, key),
        SEALED_README,
        `seal ${sequence}`,
    );
    await repo.setRef(SEALED_THROUGH, tip);
    return true;
}

// Whether main has commits not yet sealed.
export async function waiting(repo: MemoryRepo): Promise<boolean> {
    const tip = await repo.resolve(MAIN);
    return tip !== null && tip !== (await repo.resolve(SEALED_THROUGH));
}

export type PushOutcome =
    | { kind: "no-mirror" }
    | { kind: "no-key" }
    | { kind: "pushed"; sealed: boolean }
    | { kind: "failed"; reason: string };

export type MirrorOptions = {
    repo: MemoryRepo;
    lock: Lock;
    key: () => Uint8Array | null;
    // For an https mirror under isomorphic-git.
    token: () => string | null;
    warn: (message: string) => void;
    pushMs: number;
    timers?: Timers;
};

// Pushes the sealed branch to the mirror, at most once a period after
// commits. Sealing happens under the lock; the push, which may take a
// while, does not. One push runs at a time.
export class Mirror {
    readonly #options: MirrorOptions;
    readonly #timers: Timers;
    #timer: unknown = null;
    #stopped = false;
    #running: Promise<PushOutcome> | null = null;

    constructor(options: MirrorOptions) {
        this.#options = options;
        this.#timers = options.timers ?? REAL_TIMERS;
    }

    schedule(): void {
        if (this.#stopped || this.#timer !== null) {
            return;
        }
        this.#timer = this.#timers.set(() => {
            this.#timer = null;
            void this.push();
        }, this.#options.pushMs);
    }

    push(): Promise<PushOutcome> {
        this.#running ??= this.#push().finally(() => {
            this.#running = null;
        });
        return this.#running;
    }

    // Quitting never waits on a push; what is left goes at the next launch.
    stop(): void {
        this.#stopped = true;
        if (this.#timer !== null) {
            this.#timers.clear(this.#timer);
            this.#timer = null;
        }
    }

    async #push(): Promise<PushOutcome> {
        const { repo, lock, warn } = this.#options;
        try {
            if ((await repo.remote(MIRROR)) === null) {
                return { kind: "no-mirror" };
            }
            const key = this.#options.key();
            if (key === null) {
                warn(
                    "history: the mirror needs DOROTHY_MIRROR_KEY; set it with dorothy --mirror",
                );
                return { kind: "no-key" };
            }
            const sealed = await lock(() => sealPending(repo, key));
            if ((await repo.resolve(SEALED)) === null) {
                return { kind: "pushed", sealed: false };
            }
            await repo.push(MIRROR, "sealed", this.#options.token());
            return { kind: "pushed", sealed };
        } catch (error) {
            const reason = describeError(error);
            warn(`history: couldn't push to the mirror (${reason})`);
            return { kind: "failed", reason };
        }
    }
}

export type Recovered = {
    applied: number;
    of: number;
    tip: string | null;
    // The bundle recovery stopped at and why, or why it could not start.
    stopped: string | null;
};

// Rebuilds an empty repository from a mirror: each sealed bundle opened
// and applied in order. It stops at the first that fails, keeping what
// came before it.
export async function recover({
    repo,
    url,
    key,
    token,
}: {
    repo: MemoryRepo;
    url: string;
    key: Uint8Array;
    token: string | null;
}): Promise<Recovered> {
    await repo.init();
    await repo.setRemote(MIRROR, url);
    let names: string[];
    try {
        await repo.fetch(url, "sealed", token);
        names = await repo.sealedNames();
    } catch (error) {
        return { applied: 0, of: 0, tip: null, stopped: describeError(error) };
    }
    let applied = 0;
    let tip: string | null = null;
    let stopped: string | null = null;
    for (const name of names) {
        const opened = await unseal(await repo.sealedFile(name), key);
        if (!opened.ok) {
            stopped = `${name}: ${opened.reason}`;
            break;
        }
        try {
            tip = await repo.unbundle(opened.bundle);
        } catch (error) {
            stopped = `${name}: ${describeError(error)}`;
            break;
        }
        applied += 1;
    }
    if (tip !== null) {
        await repo.checkout();
        await repo.setRef(SEALED_THROUGH, tip);
    }
    return { applied, of: names.length, tip, stopped };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/history/mirror.test.ts`
Expected: PASS, every test.

- [ ] **Step 5: Check and commit**

```bash
bunx biome check --write src/history/mirror.ts src/history/mirror.test.ts
bun run check
git add src/history/mirror.ts src/history/mirror.test.ts
git commit -m "feat(sdk): Push memory, sealed, to a mirror"
git log --oneline -1 && git status --short
```

---

### Task 9: History's commands

**Files:**

- Modify: `src/history/commands.ts` (replaced whole, below),
  `src/history/commands.test.ts`
- Modify: `src/index.ts`, `src/index.test.ts`

**Interfaces:**

- Consumes: `openHistory`, `historyRoot`, `MemoryHistory` (Task 6);
  `goodVersion`, `putBack`, `RECOVERY_DEPTH`, `Version` (Task 5);
  `lint`, `fileKind` (Task 1); `openRepo` (Task 4); `Mirror`,
  `recover`, `waiting` (Task 8); `newKey`, `parseKey` (Task 2);
  `MAIN`, `MIRROR`, `NO_MIRROR`, `SEALED_THROUGH`, `Engine` (Task 3); `writeAtomic`
  (`src/memory/sidecar.ts`); `RecallIndex`, `indexPath`
  (`src/recall/store.ts`); dotenvx's `set`.
- Produces, in `src/history/commands.ts` (besides Task 7's `entryHook`,
  `commandHistory` and `Output`):
  - `type CommandOptions = { env?: Env; out?: Output; err?: Output; engine?: Engine; hook?: HookCommand | null; now?: () => Date }`
  - `runHistory(options: CommandOptions & { path?: string | null; count?: number }): Promise<number>`
  - `runRestore(path: string, rev: string | null, options?: CommandOptions): Promise<number>`
  - `runRollback(rev: string, options?: CommandOptions): Promise<number>`
  - `runCheck(options: CommandOptions & { staged?: boolean; root?: string }): Promise<number>`
  - `runMirror(url: string | null, options?: CommandOptions & { setSecret?: (name: string, value: string) => Promise<void> }): Promise<number>`
  - `runRecover(url: string, options?: CommandOptions): Promise<number>`
  - `authorOf(message: string): string`, `isLocal(url: string): boolean`
- Produces, in `src/index.ts`: the `Mode` kinds
  `{ kind: "history"; path: string | null; count: number }`,
  `{ kind: "restore"; path: string; rev: string | null }`,
  `{ kind: "rollback"; rev: string }`, `{ kind: "check"; staged: boolean }`,
  `{ kind: "mirror"; url: string | null }`, `{ kind: "recover"; url: string }`

Every command but `--check` opens history as the memory commands do,
under the index's lock when it opens, and sweeps first; without history
it exits 1 saying why. `--check` changes nothing: it opens the repository
alone, and lints files on disk without the append-only check when there
is none.

- [ ] **Step 1: Write the failing command tests**

Replace `src/history/commands.test.ts` with:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/commands.test.ts
//
//

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
    appendFileSync,
    existsSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { EMPTY_SIDECAR } from "../memory/sidecar.js";
import { binaryRepo } from "./binary.js";
import {
    authorOf,
    commandHistory,
    isLocal,
    runCheck,
    runHistory,
    runMirror,
    runRecover,
    runRestore,
    runRollback,
} from "./commands.js";
import { newKey } from "./seal.js";
import { bareRepo, put, removeRoots, TEST_ENV, tempRoot } from "./testing.js";

afterAll(removeRoots);

const NOW = new Date("2026-10-08T00:00:00.000Z");
const PHRASE = "a-b-c-d";
const SIDECAR = `transcripts/${PHRASE}.meta.json`;
const TRANSCRIPT = `transcripts/${PHRASE}.jsonl`;
const vocabulary = (rev: number) =>
    `${JSON.stringify({ v: 1, rev, concepts: {} })}\n`;
const sidecar = (title: string) =>
    `${JSON.stringify({ ...EMPTY_SIDECAR, rev: 1, title })}\n`;
const event = (text: string) =>
    `${JSON.stringify({ v: 1, kind: "user", at: NOW.toISOString(), text })}\n`;

function capture() {
    let text = "";
    return {
        write: (chunk: string) => {
            text += chunk;
        },
        get text() {
            return text;
        },
    };
}

let home = "";
let env: Record<string, string> = {};
let out = capture();
let err = capture();
beforeEach(() => {
    home = tempRoot();
    env = {
        XDG_DATA_HOME: home,
        XDG_CONFIG_HOME: home,
        XDG_CACHE_HOME: join(home, "cache"),
        HOME: home,
        PATH: process.env.PATH ?? "",
    };
    out = capture();
    err = capture();
});

const data = (path = "") => join(home, "dorothy", path);
const write = (path: string, text: string) => put(data(), path, text);
const read = (path: string) => readFileSync(data(path), "utf8");
const options = () => ({
    env,
    out,
    err,
    engine: "git" as const,
    hook: null,
    now: () => NOW,
});
const repo = () => binaryRepo(data(), { env: TEST_ENV });
const messages = async () =>
    (await repo().log(undefined, 50)).map((commit) => commit.message);
// A command that sweeps, to commit what the test wrote.
const sweep = () => runHistory({ ...options(), out: capture() });

describe("commandHistory", () => {
    it("adopts and sweeps the data directory, and closes", async () => {
        write("tags.json", vocabulary(1));
        const handle = await commandHistory({ env, err, hook: null })(null);
        expect(handle).not.toBeNull();
        expect(await messages()).toEqual(["adopt: 2 files"]);
        write("tags.json", vocabulary(2));
        await handle?.sweep();
        expect((await messages())[0]).toBe("outside: tags.json");
        handle?.close();
        expect(err.text).toBe(
            "dorothy: memory has no mirror · dorothy --mirror <url>\n",
        );
    });

    it("is off when the config says so", async () => {
        put(home, "dorothy/config.toml", "[history]\nenabled = false\n");
        expect(await commandHistory({ env, hook: null })(null)).toBeNull();
    });

    it("says why when history can't be used, and goes on without", async () => {
        // The data directory is a file.
        writeFileSync(data(), "");
        expect(await commandHistory({ env, err, hook: null })(null)).toBeNull();
        expect(err.text).toStartWith("dorothy: history is off: ");
    });
});

describe("authorOf", () => {
    it("names who made a commit from its message", () => {
        expect(authorOf("review: x (dorothy, claude-test)")).toBe("dorothy");
        expect(authorOf("compaction: x (dorothy, claude-test)")).toBe("dorothy");
        expect(authorOf("title: x (prompt)")).toBe("dorothy");
        expect(authorOf("catch-up: tags.json")).toBe("dorothy");
        expect(authorOf("edit: x (user)")).toBe("user");
        expect(authorOf("edit-tags: 2 concepts (user)")).toBe("user");
        expect(authorOf("rollback: to 3f9a2c1 (user)")).toBe("user");
        expect(authorOf("turn: x #3")).toBe("turn");
        expect(authorOf("outside: tags.json")).toBe("outside");
        expect(authorOf("restore: tags.json from 3f9a2c1 (broken kept)")).toBe(
            "restore",
        );
        expect(authorOf("broken: tags.json kept, no good version")).toBe(
            "restore",
        );
        expect(authorOf("adopt: 3 files")).toBe("adopt");
        expect(authorOf("something else")).toBe("other");
    });
});

describe("runHistory", () => {
    it("lists commits newest first, for all or for one file", async () => {
        write("tags.json", vocabulary(1));
        write(SIDECAR, sidecar("One"));
        await sweep();
        write("tags.json", vocabulary(2));
        await sweep();
        expect(await runHistory(options())).toBe(0);
        const lines = out.text.trimEnd().split("\n");
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatch(
            /^\d{4}-\d\d-\d\d \d\d:\d\d {2}outside {2}outside: tags\.json$/,
        );
        expect(lines[1]).toMatch(/ {2}adopt {4}adopt: 3 files$/);
        out = capture();
        expect(await runHistory({ ...options(), path: SIDECAR })).toBe(0);
        expect(out.text).toContain("adopt: 3 files");
        expect(out.text).not.toContain("outside");
        out = capture();
        expect(await runHistory({ ...options(), count: 1 })).toBe(0);
        expect(out.text.trimEnd().split("\n")).toHaveLength(1);
    });

    it("reminds of a missing mirror, once", async () => {
        expect(await runHistory(options())).toBe(0);
        expect(err.text).toBe(
            "dorothy: memory has no mirror · dorothy --mirror <url>\n",
        );
    });

    it("exits 1 when history is off", async () => {
        put(home, "dorothy/config.toml", "[history]\nenabled = false\n");
        expect(await runHistory(options())).toBe(1);
        expect(err.text).toBe("dorothy: history is off in config.toml\n");
    });
});

describe("runRestore", () => {
    it("puts back a file as it was, keeping what it replaces", async () => {
        write("tags.json", vocabulary(1));
        await sweep();
        const first = (await repo().log())[0]?.sha as string;
        write("tags.json", vocabulary(2));
        await sweep();
        expect(await runRestore("tags.json", first.slice(0, 7), options())).toBe(0);
        expect(read("tags.json")).toBe(vocabulary(1));
        const copy = "broken/tags.json.2026-10-08T00-00-00-000Z";
        expect(read(copy)).toBe(vocabulary(2));
        expect(out.text).toBe(
            `Restored tags.json from ${first.slice(0, 7)}; what it replaced is in ${copy}\n`,
        );
        expect((await messages())[0]).toBe(
            `restore: tags.json from ${first.slice(0, 7)} (broken kept)`,
        );
    });

    it("brings back a deleted file from its newest good version", async () => {
        write("tags.json", vocabulary(1));
        await sweep();
        Bun.spawnSync(["rm", data("tags.json")]);
        expect(await runRestore(data("tags.json"), null, options())).toBe(0);
        expect(read("tags.json")).toBe(vocabulary(1));
    });

    it("says when the file is already as it was", async () => {
        write("tags.json", vocabulary(1));
        await sweep();
        const head = (await repo().log())[0]?.sha as string;
        expect(await runRestore("tags.json", head, options())).toBe(0);
        expect(out.text).toBe(
            `tags.json is already as it was at ${head.slice(0, 7)}\n`,
        );
    });

    it("refuses a revision without the file, or a path outside", async () => {
        write("tags.json", vocabulary(1));
        await sweep();
        expect(await runRestore(SIDECAR, "HEAD", options())).toBe(1);
        expect(err.text).toEndWith(`dorothy: no ${SIDECAR} at HEAD\n`);
        err = capture();
        expect(await runRestore("/etc/passwd", null, options())).toBe(1);
        expect(err.text).toEndWith(
            `dorothy: /etc/passwd is not in ${data()}\n`,
        );
    });
});

describe("runRollback", () => {
    it("puts notes and tags back as they were, transcripts aside", async () => {
        write("tags.json", vocabulary(1));
        write(SIDECAR, sidecar("One"));
        write(TRANSCRIPT, event("one"));
        await sweep();
        const first = (await repo().log())[0]?.sha as string;
        write("tags.json", vocabulary(2));
        write(SIDECAR, sidecar("Two"));
        appendFileSync(data(TRANSCRIPT), event("two"));
        await sweep();
        expect(await runRollback(first, options())).toBe(0);
        expect(read("tags.json")).toBe(vocabulary(1));
        expect(read(SIDECAR)).toBe(sidecar("One"));
        expect(read(TRANSCRIPT)).toBe(event("one") + event("two"));
        expect(out.text).toBe(`Rolled back 2 files to ${first.slice(0, 7)}\n`);
        expect((await messages())[0]).toBe(
            `rollback: to ${first.slice(0, 7)} (user)`,
        );
    });

    it("says when there is nothing to roll back, or no such revision", async () => {
        write("tags.json", vocabulary(1));
        await sweep();
        expect(await runRollback("HEAD", options())).toBe(0);
        expect(out.text).toMatch(/^Nothing to roll back: notes and tags are as at [0-9a-f]{7}\n$/);
        expect(await runRollback("nonsense", options())).toBe(1);
        expect(err.text).toEndWith("dorothy: no revision nonsense\n");
    });
});

describe("runCheck", () => {
    it("lints every file and changes nothing", async () => {
        write("tags.json", vocabulary(1));
        write(TRANSCRIPT, event("one"));
        await sweep();
        expect(await runCheck(options())).toBe(0);
        expect(out.text).toBe("All 3 files pass.\n");
        write("tags.json", "{");
        writeFileSync(data(TRANSCRIPT), "");
        out = capture();
        expect(await runCheck(options())).toBe(1);
        expect(out.text).toContain(
            `${TRANSCRIPT}: it changed before its end, and a transcript only grows\n`,
        );
        expect(out.text).toMatch(/^tags\.json: /m);
        expect(read("tags.json")).toBe("{");
    });

    it("lints a directory with no history yet", async () => {
        write("tags.json", "{");
        write(SIDECAR, sidecar("One"));
        expect(await runCheck(options())).toBe(1);
        expect(out.text).toMatch(/^tags\.json: .+\n1 of 2 files broken\.\n$/);
        expect(existsSync(data(".git"))).toBe(false);
    });

    it("lints what is staged, for the pre-commit hook", async () => {
        write("tags.json", vocabulary(1));
        await sweep();
        write("tags.json", "{");
        Bun.spawnSync(["git", "add", "tags.json"], { cwd: data(), env: TEST_ENV });
        expect(await runCheck({ ...options(), staged: true, root: data() })).toBe(1);
        expect(out.text).toMatch(/^tags\.json: /);
        write("tags.json", vocabulary(2));
        Bun.spawnSync(["git", "add", "tags.json"], { cwd: data(), env: TEST_ENV });
        out = capture();
        expect(await runCheck({ ...options(), staged: true, root: data() })).toBe(0);
    });
});

describe("runMirror", () => {
    it("says when there is no mirror yet", async () => {
        expect(await runMirror(null, options())).toBe(0);
        expect(out.text).toBe(
            "No mirror yet; set one with dorothy --mirror <url-or-path>\n",
        );
    });

    it("sets a mirror, makes a key when there is none, and pushes", async () => {
        write("tags.json", vocabulary(1));
        const bare = await bareRepo();
        const saved: [string, string][] = [];
        const setSecret = async (name: string, value: string) => {
            saved.push([name, value]);
        };
        expect(await runMirror(bare, { ...options(), setSecret })).toBe(0);
        expect(saved.map(([name]) => name)).toEqual(["DOROTHY_MIRROR_KEY"]);
        expect(out.text).toContain("Made DOROTHY_MIRROR_KEY");
        expect(out.text).toContain(`Pushed to ${bare}\n`);
        expect(out.text).not.toContain("stored at");
        out = capture();
        expect(
            await runMirror(null, {
                ...options(),
                env: { ...env, DOROTHY_MIRROR_KEY: saved[0]?.[1] ?? "" },
            }),
        ).toBe(0);
        expect(out.text).toMatch(
            new RegExp(`^Mirror: ${bare}\\nSealed through: [0-9a-f]{7}\\nWaiting: no\\n$`),
        );
    });

    it("never replaces a key that is set but malformed", async () => {
        const bare = await bareRepo();
        let saved = 0;
        const code = await runMirror(bare, {
            ...options(),
            env: { ...env, DOROTHY_MIRROR_KEY: "short" },
            setSecret: async () => {
                saved += 1;
            },
        });
        expect(code).toBe(1);
        expect(saved).toBe(0);
        expect(err.text).toBe(
            "dorothy: DOROTHY_MIRROR_KEY is set but is not 32 bytes of base64; it is left as it is, and no mirror is set\n",
        );
        expect(await repo().remote("mirror")).toBeNull();
    });

    it("knows a local mirror from a hosted one", () => {
        expect(isLocal("/mnt/backup/memory.git")).toBe(true);
        expect(isLocal("./memory.git")).toBe(true);
        expect(isLocal("~/memory.git")).toBe(true);
        expect(isLocal("file:///mnt/memory.git")).toBe(true);
        expect(isLocal("https://example.com/memory.git")).toBe(false);
        expect(isLocal("git@example.com:me/memory.git")).toBe(false);
    });
});

describe("runRecover", () => {
    it("rebuilds an empty data directory from a mirror", async () => {
        write("tags.json", vocabulary(1));
        write(TRANSCRIPT, event("one"));
        const key = newKey();
        const bare = await bareRepo();
        const keyed = { ...options(), env: { ...env, DOROTHY_MIRROR_KEY: key } };
        expect(await runMirror(bare, keyed)).toBe(0);
        const original = read("tags.json");
        const other = tempRoot();
        const fresh = {
            ...keyed,
            out: capture(),
            env: { ...keyed.env, XDG_DATA_HOME: other, HOME: other },
        };
        expect(await runRecover(bare, fresh)).toBe(0);
        expect(readFileSync(join(other, "dorothy", "tags.json"), "utf8")).toBe(
            original,
        );
        expect(fresh.out.text).toMatch(
            /^Recovered 1 of 1 bundles; main is at [0-9a-f]{7}\nAll 3 files pass\.\n$/,
        );
    });

    it("refuses a data directory that holds anything, or no key", async () => {
        write("tags.json", vocabulary(1));
        expect(
            await runRecover("/nowhere.git", {
                ...options(),
                env: { ...env, DOROTHY_MIRROR_KEY: newKey() },
            }),
        ).toBe(1);
        expect(err.text).toBe(
            `dorothy: ${data()} is not empty; --recover only fills an empty data directory\n`,
        );
        const other = tempRoot();
        err = capture();
        expect(
            await runRecover("/nowhere.git", {
                ...options(),
                err,
                env: { ...env, XDG_DATA_HOME: other },
            }),
        ).toBe(1);
        expect(err.text).toBe(
            "dorothy: --recover needs DOROTHY_MIRROR_KEY, the key the mirror was sealed with\n",
        );
        expect(existsSync(join(other, "dorothy"))).toBe(false);
    });
});
```

- [ ] **Step 2: Write the failing argument tests**

In `src/index.test.ts`, inside `describe("parseArgs", ...)`:

```ts
    it("parses history's commands", () => {
        expect(parseArgs(["--history"], false)).toEqual({
            kind: "history",
            path: null,
            count: 20,
        });
        expect(parseArgs(["--history", "tags.json", "-n", "5"], false)).toEqual({
            kind: "history",
            path: "tags.json",
            count: 5,
        });
        expect(parseArgs(["--history", "-n", "0"], false)).toEqual({
            kind: "usage",
            message: "--history takes [<path>] [-n <count>]",
        });
        expect(parseArgs(["--restore", "tags.json"], false)).toEqual({
            kind: "restore",
            path: "tags.json",
            rev: null,
        });
        expect(parseArgs(["--restore", "tags.json", "3f9a2c1"], false)).toEqual({
            kind: "restore",
            path: "tags.json",
            rev: "3f9a2c1",
        });
        expect(parseArgs(["--restore"], false)).toEqual({
            kind: "usage",
            message: "--restore takes <path> [<rev>]",
        });
        expect(parseArgs(["--rollback", "3f9a2c1"], false)).toEqual({
            kind: "rollback",
            rev: "3f9a2c1",
        });
        expect(parseArgs(["--rollback"], false)).toEqual({
            kind: "usage",
            message: "--rollback takes one revision",
        });
        expect(parseArgs(["--check"], false)).toEqual({
            kind: "check",
            staged: false,
        });
        expect(parseArgs(["--check", "--staged"], false)).toEqual({
            kind: "check",
            staged: true,
        });
        expect(parseArgs(["--check", "x"], false)).toEqual({
            kind: "usage",
            message: "--check takes only --staged",
        });
        expect(parseArgs(["--mirror"], false)).toEqual({
            kind: "mirror",
            url: null,
        });
        expect(parseArgs(["--mirror", "/mnt/m.git"], false)).toEqual({
            kind: "mirror",
            url: "/mnt/m.git",
        });
        expect(parseArgs(["--recover", "/mnt/m.git"], false)).toEqual({
            kind: "recover",
            url: "/mnt/m.git",
        });
        expect(parseArgs(["--recover"], false)).toEqual({
            kind: "usage",
            message: "--recover takes one url or path",
        });
    });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/history/commands.test.ts src/index.test.ts`
Expected: FAIL; `runHistory` and the rest are not exported, and
`parseArgs` calls `--history` an unknown option.

- [ ] **Step 4: Write the commands**

Replace `src/history/commands.ts` with:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/commands.ts
//
//

import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { set } from "@dotenvx/dotenvx";
import { readConfig } from "../config.js";
import { type OpenHistory, writeAtomic } from "../memory/sidecar.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import type { Env } from "../xdg.js";
import { goodVersion, putBack, RECOVERY_DEPTH, type Version } from "./heal.js";
import {
    type HookCommand,
    historyRoot,
    type MemoryHistory,
    openHistory,
} from "./history.js";
import { fileKind, lint } from "./lint.js";
import { Mirror, recover, waiting } from "./mirror.js";
import { openRepo } from "./open.js";
import {
    type Engine,
    MAIN,
    MIRROR,
    type MemoryRepo,
    NO_MIRROR,
    SEALED_THROUGH,
} from "./repo.js";
import { newKey, parseKey } from "./seal.js";

export type Output = { write(text: string): unknown };

export type CommandOptions = {
    env?: Env;
    out?: Output;
    err?: Output;
    engine?: Engine;
    hook?: HookCommand | null;
    now?: () => Date;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
const short = (sha: string) => sha.slice(0, 7);
const sameBytes = (a: Uint8Array, b: Uint8Array) =>
    Buffer.compare(a, b) === 0;

// How the pre-commit hook runs this Dorothy: the same bun, the same entry
// script.
export function entryHook(): HookCommand | null {
    const script = process.argv[1];
    return script === undefined
        ? null
        : { exec: process.execPath, script: resolve(script) };
}

// For memory's commands: history under the index's lock (or its own),
// swept before the command reads anything. Null when the config turns it
// off, or when it can't be used, which is said on err.
export function commandHistory({
    env = process.env,
    err = process.stderr,
    hook = entryHook(),
}: { env?: Env; err?: Output; hook?: HookCommand | null } = {}): OpenHistory {
    return async (index) => {
        const { config } = await readConfig(env);
        if (!config.history.enabled) {
            return null;
        }
        const warn = (message: string) => err.write(`dorothy: ${message}\n`);
        const opened = await openHistory({
            root: historyRoot(env),
            index,
            hook,
            warn,
        });
        if (!opened.ok) {
            warn(opened.reason);
            return null;
        }
        await opened.history.sweep();
        if ((await opened.history.repo.remote(MIRROR)) === null) {
            warn(NO_MIRROR);
        }
        return opened.history.handle(opened.close);
    };
}

// History for one of its own commands: under the index's lock when the
// index opens, swept first. Null, said on err, when it is off or broken.
async function session(
    {
        env = process.env,
        err = process.stderr,
        engine,
        hook = entryHook(),
        now,
    }: CommandOptions,
    // Whether to remind of a missing mirror: not when one is being set.
    remind = true,
): Promise<{ history: MemoryHistory; close(): void } | null> {
    const { config } = await readConfig(env);
    if (!config.history.enabled) {
        err.write("dorothy: history is off in config.toml\n");
        return null;
    }
    let index: RecallIndex | null = null;
    try {
        index = RecallIndex.open(indexPath(env));
    } catch {
        // History takes a lock of its own.
    }
    const opened = await openHistory({
        root: historyRoot(env),
        index,
        hook,
        warn: (message) => err.write(`dorothy: ${message}\n`),
        ...(engine === undefined ? {} : { engine }),
        ...(now === undefined ? {} : { now }),
    });
    if (!opened.ok) {
        index?.close();
        err.write(`dorothy: ${opened.reason}\n`);
        return null;
    }
    await opened.history.sweep();
    if (remind && (await opened.history.repo.remote(MIRROR)) === null) {
        err.write(`dorothy: ${NO_MIRROR}\n`);
    }
    return {
        history: opened.history,
        close: () => {
            opened.close();
            index?.close();
        },
    };
}

// A path the user typed, as history names it: relative to the data
// directory, with /. Null when it lies outside.
function named(root: string, path: string): string | null {
    const inside = isAbsolute(path) ? relative(root, path) : path;
    return inside === "" || inside.startsWith("..") || isAbsolute(inside)
        ? null
        : inside.split(sep).join("/");
}

// Who made a commit, from its message.
export function authorOf(message: string): string {
    if (message.endsWith("(user)")) {
        return "user";
    }
    switch (message.slice(0, message.indexOf(":"))) {
        case "review":
        case "compaction":
        case "title":
        case "catch-up":
            return "dorothy";
        case "turn":
            return "turn";
        case "outside":
            return "outside";
        case "restore":
        case "broken":
            return "restore";
        case "adopt":
            return "adopt";
        default:
            return "other";
    }
}

const pad = (value: number) => String(value).padStart(2, "0");
// Local time, to the minute.
const when = (at: string) => {
    const date = new Date(at);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export async function runHistory(
    options: CommandOptions & { path?: string | null; count?: number },
): Promise<number> {
    const { out = process.stdout, err = process.stderr } = options;
    const opened = await session(options);
    if (opened === null) {
        return 1;
    }
    try {
        const { history } = opened;
        let path: string | undefined;
        if (options.path !== undefined && options.path !== null) {
            const inside = named(history.root, options.path);
            if (inside === null) {
                err.write(`dorothy: ${options.path} is not in ${history.root}\n`);
                return 1;
            }
            path = inside;
        }
        for (const commit of await history.repo.log(path, options.count ?? 20)) {
            out.write(
                `${when(commit.at)}  ${authorOf(commit.message).padEnd(7)}  ${commit.message}\n`,
            );
        }
        return 0;
    } finally {
        opened.close();
    }
}

export async function runRestore(
    path: string,
    rev: string | null,
    options: CommandOptions = {},
): Promise<number> {
    const { out = process.stdout, err = process.stderr } = options;
    const now = options.now ?? (() => new Date());
    const opened = await session(options);
    if (opened === null) {
        return 1;
    }
    const { history } = opened;
    const repo = history.repo;
    try {
        const inside = named(history.root, path);
        if (inside === null) {
            err.write(`dorothy: ${path} is not in ${history.root}\n`);
            return 1;
        }
        return await history.lock(async () => {
            let version: Version | null;
            if (rev === null) {
                version = await goodVersion(repo, inside);
                if (version === null) {
                    err.write(`dorothy: ${inside} has no good version in its history\n`);
                    return 1;
                }
            } else {
                const sha = await repo.resolve(rev);
                const bytes = sha === null ? null : await repo.show(inside, sha);
                if (sha === null || bytes === null) {
                    err.write(`dorothy: no ${inside} at ${rev}\n`);
                    return 1;
                }
                const problem = lint(inside, bytes, null);
                if (problem !== null) {
                    err.write(`dorothy: ${inside} at ${rev} is broken too (${problem})\n`);
                    return 1;
                }
                const at =
                    (await repo.log(inside, RECOVERY_DEPTH)).find(
                        (commit) => commit.sha === sha,
                    )?.at ?? "";
                version = { sha, at, bytes };
            }
            const full = join(history.root, inside);
            if (existsSync(full) && sameBytes(await readFile(full), version.bytes)) {
                out.write(`${inside} is already as it was at ${short(version.sha)}\n`);
                return 0;
            }
            const copy = await putBack(repo, history.root, inside, version, now());
            out.write(
                `Restored ${inside} from ${short(version.sha)}${copy === null ? "" : `; what it replaced is in ${copy}`}\n`,
            );
            return 0;
        });
    } finally {
        opened.close();
    }
}

// Notes and tags as they were at a revision, in one commit. Transcripts
// are never rolled back: rolling back returns to an earlier judgement of
// the conversations, never an earlier record of them.
export async function runRollback(
    rev: string,
    options: CommandOptions = {},
): Promise<number> {
    const { out = process.stdout, err = process.stderr } = options;
    const opened = await session(options);
    if (opened === null) {
        return 1;
    }
    const { history } = opened;
    const repo = history.repo;
    try {
        return await history.lock(async () => {
            const sha = await repo.resolve(rev);
            if (sha === null) {
                err.write(`dorothy: no revision ${rev}\n`);
                return 1;
            }
            const changed: string[] = [];
            for (const path of await repo.files(sha)) {
                const kind = fileKind(path);
                const bytes =
                    kind === "vocabulary" || kind === "sidecar"
                        ? await repo.show(path, sha)
                        : null;
                if (bytes === null) {
                    continue;
                }
                const problem = lint(path, bytes, null);
                if (problem !== null) {
                    err.write(
                        `dorothy: ${path} at ${short(sha)} is broken (${problem}); it is left as it is\n`,
                    );
                    continue;
                }
                const full = join(history.root, path);
                if (existsSync(full) && sameBytes(await readFile(full), bytes)) {
                    continue;
                }
                await writeAtomic(full, bytes);
                changed.push(path);
            }
            if (changed.length === 0) {
                out.write(
                    `Nothing to roll back: notes and tags are as at ${short(sha)}\n`,
                );
                return 0;
            }
            await repo.commit(changed, `rollback: to ${short(sha)} (user)`);
            out.write(
                `Rolled back ${changed.length} ${changed.length === 1 ? "file" : "files"} to ${short(sha)}\n`,
            );
            return 0;
        });
    } finally {
        opened.close();
    }
}

type Checked = { path: string; problem: string | null };

// Every file in the data directory, linted: against its last commit when
// there is a history, on its own when there is none.
async function checkTree(root: string, repo: MemoryRepo | null): Promise<Checked[]> {
    let paths: string[];
    if (repo !== null) {
        paths = [
            ...new Set([...(await repo.files("HEAD")), ...(await repo.changed())]),
        ].sort();
    } else if (existsSync(root)) {
        paths = (readdirSync(root, { recursive: true }) as string[])
            .map((path) => path.split(sep).join("/"))
            .filter(
                (path) =>
                    !path.startsWith(".git/") &&
                    path !== ".git" &&
                    statSync(join(root, path)).isFile(),
            )
            .sort();
    } else {
        paths = [];
    }
    const checked: Checked[] = [];
    for (const path of paths) {
        const full = join(root, path);
        if (!existsSync(full)) {
            continue;
        }
        const committed =
            repo !== null && fileKind(path) === "transcript"
                ? await repo.show(path, "HEAD")
                : null;
        checked.push({ path, problem: lint(path, await readFile(full), committed) });
    }
    return checked;
}

function report(checked: readonly Checked[], out: Output): number {
    const broken = checked.filter((file) => file.problem !== null);
    for (const file of broken) {
        out.write(`${file.path}: ${file.problem}\n`);
    }
    out.write(
        broken.length === 0
            ? `All ${checked.length} files pass.\n`
            : `${broken.length} of ${checked.length} files broken.\n`,
    );
    return broken.length === 0 ? 0 : 1;
}

async function gitIn(
    root: string,
    env: Env,
    args: string[],
): Promise<{ code: number; stdout: Uint8Array }> {
    const proc = Bun.spawn(["git", ...args], {
        cwd: root,
        env: Object.fromEntries(
            Object.entries(env).filter(
                (entry): entry is [string, string] => entry[1] !== undefined,
            ),
        ),
        stdout: "pipe",
        stderr: "ignore",
    });
    const [stdout, code] = await Promise.all([
        new Response(proc.stdout).bytes(),
        proc.exited,
    ]);
    return { code, stdout };
}

// What a commit in progress would hold, for the pre-commit hook: the
// environment is git's own, so a commit's temporary index is the one read.
async function checkStaged(root: string, env: Env): Promise<Checked[]> {
    const names = await gitIn(root, env, [
        "diff",
        "--cached",
        "--name-only",
        "-z",
        "--no-renames",
    ]);
    if (names.code !== 0) {
        throw new Error(`${root} is not a repository git can read`);
    }
    const checked: Checked[] = [];
    for (const path of new TextDecoder()
        .decode(names.stdout)
        .split("\0")
        .filter((name) => name !== "")) {
        const staged = await gitIn(root, env, ["cat-file", "blob", `:${path}`]);
        if (staged.code !== 0) {
            continue;
        }
        const head = await gitIn(root, env, ["cat-file", "blob", `HEAD:${path}`]);
        checked.push({
            path,
            problem: lint(path, staged.stdout, head.code === 0 ? head.stdout : null),
        });
    }
    return checked;
}

export async function runCheck(
    options: CommandOptions & { staged?: boolean; root?: string },
): Promise<number> {
    const {
        env = process.env,
        out = process.stdout,
        err = process.stderr,
    } = options;
    try {
        if (options.staged) {
            return report(await checkStaged(options.root ?? process.cwd(), env), out);
        }
        const root = options.root ?? historyRoot(env);
        const repo = await openRepo(
            root,
            options.engine === undefined ? {} : { engine: options.engine },
        );
        const committed = repo.exists() && (await repo.resolve(MAIN)) !== null;
        return report(await checkTree(root, committed ? repo : null), out);
    } catch (error) {
        err.write(`dorothy: couldn't check: ${describeError(error)}\n`);
        return 1;
    }
}

// A mirror on this machine, as against one on a host.
export const isLocal = (url: string) =>
    /^(\/|\.{1,2}\/|~|file:\/\/)/.test(url);

// dotenvx's set, which encrypts the value into .env.
async function saveSecret(name: string, value: string): Promise<void> {
    const result = await set(name, value);
    for (const processed of result.processedEnvs) {
        if (processed.error !== undefined) {
            throw processed.error;
        }
    }
}

export async function runMirror(
    url: string | null,
    options: CommandOptions & {
        setSecret?: (name: string, value: string) => Promise<void>;
    } = {},
): Promise<number> {
    const {
        env = process.env,
        out = process.stdout,
        err = process.stderr,
        setSecret = saveSecret,
    } = options;
    const opened = await session(options, false);
    if (opened === null) {
        return 1;
    }
    const { history } = opened;
    const repo = history.repo;
    try {
        if (url === null) {
            const current = await repo.remote(MIRROR);
            if (current === null) {
                out.write("No mirror yet; set one with dorothy --mirror <url-or-path>\n");
                return 0;
            }
            const through = await repo.resolve(SEALED_THROUGH);
            out.write(
                `Mirror: ${current}\nSealed through: ${through === null ? "nothing yet" : short(through)}\nWaiting: ${(await waiting(repo)) ? "yes" : "no"}\n`,
            );
            return 0;
        }
        const existing = env.DOROTHY_MIRROR_KEY;
        let key = parseKey(existing);
        // Bundles sealed under a key are lost with it: one already set is
        // never replaced, even one that does not read.
        if (existing !== undefined && existing !== "" && key === null) {
            err.write(
                "dorothy: DOROTHY_MIRROR_KEY is set but is not 32 bytes of base64; it is left as it is, and no mirror is set\n",
            );
            return 1;
        }
        await repo.setRemote(MIRROR, url);
        if (key === null) {
            const made = newKey();
            await setSecret("DOROTHY_MIRROR_KEY", made);
            key = parseKey(made);
            out.write(
                "Made DOROTHY_MIRROR_KEY and saved it with dotenvx. Keep a copy somewhere else (dotenvx get DOROTHY_MIRROR_KEY): without it the mirror can't be read.\n",
            );
        }
        if (!isLocal(url)) {
            out.write(`Your conversations will be stored at ${url}, encrypted.\n`);
        }
        const sealing = key;
        const outcome = await new Mirror({
            repo,
            lock: history.lock,
            key: () => sealing,
            token: () => env.DOROTHY_MIRROR_TOKEN ?? null,
            warn: (message) => err.write(`dorothy: ${message}\n`),
            pushMs: 0,
        }).push();
        if (outcome.kind !== "pushed") {
            return 1;
        }
        out.write(`Pushed to ${url}\n`);
        return 0;
    } finally {
        opened.close();
    }
}

export async function runRecover(
    url: string,
    options: CommandOptions = {},
): Promise<number> {
    const {
        env = process.env,
        out = process.stdout,
        err = process.stderr,
    } = options;
    const root = historyRoot(env);
    if (existsSync(root) && readdirSync(root).length > 0) {
        err.write(
            `dorothy: ${root} is not empty; --recover only fills an empty data directory\n`,
        );
        return 1;
    }
    const key = parseKey(env.DOROTHY_MIRROR_KEY);
    if (key === null) {
        err.write(
            "dorothy: --recover needs DOROTHY_MIRROR_KEY, the key the mirror was sealed with\n",
        );
        return 1;
    }
    const repo = await openRepo(
        root,
        options.engine === undefined ? {} : { engine: options.engine },
    );
    const recovered = await recover({
        repo,
        url,
        key,
        token: env.DOROTHY_MIRROR_TOKEN ?? null,
    });
    out.write(
        `Recovered ${recovered.applied} of ${recovered.of} bundles${recovered.tip === null ? "" : `; main is at ${short(recovered.tip)}`}\n`,
    );
    if (recovered.stopped !== null) {
        err.write(`dorothy: recovery stopped: ${recovered.stopped}\n`);
        return 1;
    }
    return report(await checkTree(root, repo), out);
}
```

- [ ] **Step 5: Parse and run the commands**

In `src/index.ts`, add the six kinds to `Mode` (after `tags-edit`):

```ts
    | { kind: "history"; path: string | null; count: number }
    | { kind: "restore"; path: string; rev: string | null }
    | { kind: "rollback"; rev: string }
    | { kind: "check"; staged: boolean }
    | { kind: "mirror"; url: string | null }
    | { kind: "recover"; url: string }
```

add to `USAGE`, after the `--edit-tags` line:

```ts
    "       dorothy --history [<path>] [-n <count>]",
    "                                  what changed in her memory, newest first",
    "       dorothy --restore <path> [<rev>]",
    "                                  put a file back as it was",
    "       dorothy --rollback <rev>   put notes and tags back as they were",
    "       dorothy --check [--staged] lint memory's files",
    "       dorothy --mirror [<url>]   set or show the sealed mirror",
    "       dorothy --recover <url>    rebuild memory from the mirror",
```

and in `parseArgs`, before the `--memory` branch:

```ts
    if (first === "--history") {
        const usage = {
            kind: "usage",
            message: "--history takes [<path>] [-n <count>]",
        } as const;
        let path: string | null = null;
        let count = 20;
        for (let index = 0; index < rest.length; index++) {
            const word = rest[index] as string;
            if (word === "-n") {
                const value = Number(rest[index + 1]);
                if (!Number.isInteger(value) || value < 1) {
                    return usage;
                }
                count = value;
                index++;
            } else if (path === null && !word.startsWith("-")) {
                path = word;
            } else {
                return usage;
            }
        }
        return { kind: "history", path, count };
    }
    if (first === "--restore") {
        const [path, rev] = rest;
        return path !== undefined && rest.length <= 2
            ? { kind: "restore", path, rev: rev ?? null }
            : { kind: "usage", message: "--restore takes <path> [<rev>]" };
    }
    if (first === "--rollback") {
        const [rev] = rest;
        return rev !== undefined && rest.length === 1
            ? { kind: "rollback", rev }
            : { kind: "usage", message: "--rollback takes one revision" };
    }
    if (first === "--check") {
        if (rest.length === 0 || (rest.length === 1 && rest[0] === "--staged")) {
            return { kind: "check", staged: rest.length === 1 };
        }
        return { kind: "usage", message: "--check takes only --staged" };
    }
    if (first === "--mirror") {
        return rest.length <= 1
            ? { kind: "mirror", url: rest[0] ?? null }
            : { kind: "usage", message: "--mirror takes one url or path" };
    }
    if (first === "--recover") {
        const [url] = rest;
        return url !== undefined && rest.length === 1
            ? { kind: "recover", url }
            : { kind: "usage", message: "--recover takes one url or path" };
    }
```

In the entry guard, the mirror's two commands need the key, so they
decrypt `.env` too (without the CLI's home, which only the model needs):

```ts
    if (mode.kind === "mirror" || mode.kind === "recover") {
        config({ quiet: true });
    }
```

and in the dispatch, before `recall-server`:

```ts
    } else if (mode.kind === "history") {
        const { runHistory } = await import("./history/commands.js");
        process.exitCode = await runHistory({
            path: mode.path,
            count: mode.count,
        });
    } else if (mode.kind === "restore") {
        const { runRestore } = await import("./history/commands.js");
        process.exitCode = await runRestore(mode.path, mode.rev);
    } else if (mode.kind === "rollback") {
        const { runRollback } = await import("./history/commands.js");
        process.exitCode = await runRollback(mode.rev);
    } else if (mode.kind === "check") {
        const { runCheck } = await import("./history/commands.js");
        process.exitCode = await runCheck({ staged: mode.staged });
    } else if (mode.kind === "mirror") {
        const { runMirror } = await import("./history/commands.js");
        process.exitCode = await runMirror(mode.url);
    } else if (mode.kind === "recover") {
        const { runRecover } = await import("./history/commands.js");
        process.exitCode = await runRecover(mode.url);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/history/ src/index.test.ts`
Expected: PASS, every test.

- [ ] **Step 7: Check and commit**

```bash
bunx biome check --write src/history/commands.ts src/history/commands.test.ts src/index.ts src/index.test.ts
bun run check
git add src/history/commands.ts src/history/commands.test.ts src/index.ts src/index.test.ts
git commit -m "feat(sdk): Show, restore and mirror memory history"
git log --oneline -1 && git status --short
```

---

### Task 10: History in the chat

**Files:**

- Modify: `src/history/history.ts`, `src/history/history.test.ts`
  (`maintainDaily`)
- Modify: `src/tui/run.tsx`, `src/tui/run.test.ts`
- Modify: `src/tui/boundary.test.ts`
- Modify: `README.md`, `.claude/CLAUDE.md`

**Interfaces:**

- Consumes: `openHistory`, `historyRoot`, `MemoryHistory` (Task 6);
  `entryHook` (Task 7); `Mirror`, `waiting` (Task 8); `MIRROR`,
  `NO_MIRROR` (Task 3);
  `parseKey` (Task 2); `Recorder` (Task 6); `NoticeSource` from
  `src/tui/App.tsx`.
- Produces:
  - `maintainDaily(repo: MemoryRepo, now?: number): Promise<boolean>`,
    in `history.ts`
  - in `run.tsx`: `withTurnEnd`, `turnCommitter`, `mergeNotices`,
    `launchHistory`, `type LaunchedHistory`; `clusterSaver` takes
    `recorder?: Recorder | null`; `sessionMaker` takes
    `turnEnded?: (() => void) | null`

The index now opens before a resumed chat's transcript and notes are
read, so that history restores a broken file first (Ruling 20).

- [ ] **Step 1: Write the failing tests**

In `src/history/history.test.ts`, add `maintainDaily` to the import from
`./history.js`, `isoRepo` from `./iso.js` and `binaryRepo` from
`./binary.js`, `TEST_ENV` to the import from `./testing.js`, and:

```ts
describe("maintainDaily", () => {
    it("repacks under the binary at most once a day", async () => {
        const repo = binaryRepo(root, { env: TEST_ENV });
        await repo.init();
        put(root, "tags.json", vocabulary(1));
        await repo.commit(["tags.json"], "one");
        const now = Date.now();
        expect(await maintainDaily(repo, now)).toBe(true);
        expect(await maintainDaily(repo, now + 1000)).toBe(false);
        expect(await maintainDaily(repo, now + 2 * 86_400_000)).toBe(true);
    });

    it("leaves isomorphic-git alone, which cannot repack", async () => {
        expect(await maintainDaily(isoRepo(root))).toBe(false);
    });
});
```

In `src/tui/boundary.test.ts`, after the compaction test:

```ts
    it("leaves history to run.tsx, which wires it in", async () => {
        const importers: string[] = [];
        for await (const path of new Glob("*.{ts,tsx}").scan(import.meta.dir)) {
            const text = await Bun.file(`${import.meta.dir}/${path}`).text();
            if (path !== import.meta.file && text.includes("../history/")) {
                importers.push(path);
            }
        }
        expect(importers.sort()).toEqual(["run.tsx"]);
    });
```

In `src/tui/run.test.ts`, add `launchHistory`, `mergeNotices`,
`turnCommitter` and `withTurnEnd` to the import from `./run.js`, and:

```ts
describe("withTurnEnd", () => {
    it("tells history of each turn's end after memory", () => {
        const log: string[] = [];
        const hooks = withTurnEnd(
            {
                sent: (text) => log.push(`sent ${text}`),
                ready: () => log.push("ready"),
                turnEnded: () => log.push("memory"),
            },
            () => log.push("history"),
        );
        hooks?.sent("hi");
        hooks?.ready();
        hooks?.turnEnded();
        expect(log).toEqual(["sent hi", "ready", "memory", "history"]);
        const alone = withTurnEnd(null, () => log.push("alone"));
        alone?.turnEnded();
        expect(log.at(-1)).toBe("alone");
        expect(withTurnEnd(null, null)).toBeNull();
    });
});

describe("turnCommitter", () => {
    it("commits each turn once its transcript is flushed, in order", async () => {
        const log: string[] = [];
        const turns = turnCommitter(
            {
                turn: async (path, count) => {
                    log.push(`turn ${path} #${count}`);
                },
                warn: (message) => log.push(message),
            },
            "/data/x.jsonl",
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 5));
                log.push("flushed");
            },
            3,
        );
        turns.ended();
        turns.ended();
        await turns.settled();
        expect(log).toEqual([
            "flushed",
            "turn /data/x.jsonl #4",
            "flushed",
            "turn /data/x.jsonl #5",
        ]);
    });

    it("warns rather than throws when a turn can't be committed", async () => {
        const warnings: string[] = [];
        const turns = turnCommitter(
            {
                turn: async () => {
                    throw new Error("locked");
                },
                warn: (message) => warnings.push(message),
            },
            "/data/x.jsonl",
            async () => {},
            0,
        );
        turns.ended();
        await turns.settled();
        expect(warnings).toEqual(["history: couldn't commit turn 1 (locked)"]);
    });
});

describe("mergeNotices", () => {
    it("listens to every source, and stops listening to all", () => {
        const listeners: ((notice: { type: "warning"; message: string }) => void)[] = [];
        let off = 0;
        const source = {
            subscribe: (listener: (notice: { type: "warning"; message: string }) => void) => {
                listeners.push(listener);
                return () => {
                    off += 1;
                };
            },
        };
        const seen: unknown[] = [];
        const merged = mergeNotices(source, null, source);
        const stop = merged?.subscribe((notice) => seen.push(notice));
        for (const listener of listeners) {
            listener({ type: "warning", message: "w" });
        }
        expect(seen).toHaveLength(2);
        stop?.();
        expect(off).toBe(2);
        expect(mergeNotices(null, undefined)).toBeUndefined();
        expect(mergeNotices(source)).toBe(source);
    });
});

describe("launchHistory", () => {
    it("adopts the data directory and asks for a mirror", async () => {
        const warnings: string[] = [];
        const launched = await launchHistory({
            config: DEFAULT_CONFIG,
            index: null,
            warnings,
            hook: null,
        });
        expect(launched).not.toBeNull();
        expect(existsSync(join(dir, "dorothy", ".git", "HEAD"))).toBe(true);
        expect(warnings).toEqual(["memory has no mirror · dorothy --mirror <url>"]);
        launched?.close();
    });

    it("is off when the config says so", async () => {
        expect(
            await launchHistory({
                config: { history: { enabled: false, pushSeconds: 60 } },
                index: null,
                warnings: [],
                hook: null,
            }),
        ).toBeNull();
    });
});
```

and in `describe("clusterSaver")`:

```ts
    it("records the compaction in history", async () => {
        const phrase = newPhrase();
        const recorded: { paths: readonly string[]; message: string }[] = [];
        const save = clusterSaver({
            dir,
            phrase,
            transcript: true,
            recorder: async (paths, message) => {
                recorded.push({ paths, message });
            },
        });
        expect(await save([cluster(1, 4)], 0.25)).toEqual({ ok: true });
        expect(recorded).toEqual([
            {
                paths: [join(dir, `${phrase}.meta.json`)],
                message: `compaction: ${phrase} (dorothy, claude-test)`,
            },
        ]);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/tui/ src/history/history.test.ts`
Expected: FAIL; `maintainDaily`, `withTurnEnd`, `turnCommitter`,
`mergeNotices` and `launchHistory` are not exported, and the boundary
test passes until Step 4 adds the import (then it must still pass).

- [ ] **Step 3: Write `maintainDaily`**

In `src/history/history.ts`, add `statSync` to the `node:fs` import, then
after `openHistory`:

```ts
const DAY_MS = 86_400_000;

// A repack at most once a day, under the binary. Nothing waits on it, so
// a failure is quiet.
export async function maintainDaily(
    repo: MemoryRepo,
    now: number = Date.now(),
): Promise<boolean> {
    if (repo.engine !== "git") {
        return false;
    }
    const marker = join(repo.root, ".git", "dorothy-maintained");
    try {
        if (now - statSync(marker).mtimeMs < DAY_MS) {
            return false;
        }
    } catch {
        // Never maintained.
    }
    try {
        await repo.maintain();
        await writeFile(marker, "");
        await utimes(marker, now / 1000, now / 1000);
        return true;
    } catch {
        return false;
    }
}
```

and add `utimes` to the `node:fs/promises` import. (The marker's time is
set to `now` so that a test, or a clock, decides the day.)

- [ ] **Step 4: Wire history into the chat**

In `src/tui/run.tsx`:

1. Imports. Add:

   ```ts
   import { entryHook } from "../history/commands.js";
   import {
       historyRoot,
       type HookCommand,
       type MemoryHistory,
       maintainDaily,
       openHistory,
   } from "../history/history.js";
   import { Mirror, waiting } from "../history/mirror.js";
   import { MIRROR, NO_MIRROR } from "../history/repo.js";
   import { parseKey } from "../history/seal.js";
   import type { Env } from "../xdg.js";
   ```

   add `type Recorder` to the import from `../memory/sidecar.js`, and
   `type NoticeSource` to the import from `./App.js`.

2. After `sessionMaker`, add:

   ```ts
   // Memory's hooks, with history told of each turn's end after memory.
   export function withTurnEnd(
       memory: MemoryHooks | null,
       turnEnded: (() => void) | null,
   ): MemoryHooks | null {
       if (turnEnded === null) {
           return memory;
       }
       return {
           sent: (text) => memory?.sent(text),
           ready: () => memory?.ready(),
           turnEnded: () => {
               memory?.turnEnded();
               turnEnded();
           },
       };
   }

   // Commits the live transcript at each turn's end, once it is flushed:
   // in order, and never awaited by the chat. settled() is for quitting.
   export function turnCommitter(
       history: Pick<MemoryHistory, "turn" | "warn">,
       path: string,
       flushed: () => Promise<void>,
       done: number,
   ): { ended: () => void; settled: () => Promise<void> } {
       let count = done;
       let chain: Promise<void> = Promise.resolve();
       return {
           ended: () => {
               count += 1;
               const turn = count;
               chain = chain.then(async () => {
                   try {
                       await flushed();
                       await history.turn(path, turn);
                   } catch (error) {
                       history.warn(
                           `history: couldn't commit turn ${turn} (${describeError(error)})`,
                       );
                   }
               });
           },
           settled: () => chain,
       };
   }

   // One source for App: memory's notices and history's.
   export function mergeNotices(
       ...sources: (NoticeSource | null | undefined)[]
   ): NoticeSource | undefined {
       const present = sources.filter(
           (source): source is NoticeSource =>
               source !== null && source !== undefined,
       );
       if (present.length <= 1) {
           return present[0];
       }
       return {
           subscribe(listener) {
               const stops = present.map((source) => source.subscribe(listener));
               return () => {
                   for (const stop of stops) {
                       stop();
                   }
               };
           },
       };
   }

   export type LaunchedHistory = {
       history: MemoryHistory;
       mirror: Mirror;
       close(): void;
   };

   // History at launch, before anything is read: opened under the index's
   // lock, swept, and the mirror pushed in the background when commits
   // wait. Null when the config turns it off, or when it can't be used,
   // which joins the launch's warnings with its own.
   export async function launchHistory({
       config,
       index,
       warnings,
       env = process.env,
       hook = entryHook(),
   }: {
       config: Pick<Config, "history">;
       index: { lock: Lock } | null;
       warnings: string[];
       env?: Env;
       hook?: HookCommand | null;
   }): Promise<LaunchedHistory | null> {
       if (!config.history.enabled) {
           return null;
       }
       const opened = await openHistory({
           root: historyRoot(env),
           index,
           hook,
       });
       if (!opened.ok) {
           warnings.push(opened.reason);
           return null;
       }
       const { history } = opened;
       await history.sweep();
       const mirror = new Mirror({
           repo: history.repo,
           lock: history.lock,
           key: () => parseKey(env.DOROTHY_MIRROR_KEY),
           token: () => env.DOROTHY_MIRROR_TOKEN ?? null,
           warn: (message) => history.warn(message),
           pushMs: config.history.pushSeconds * 1000,
       });
       history.afterCommit(() => mirror.schedule());
       if ((await history.repo.remote(MIRROR)) === null) {
           history.warn(NO_MIRROR);
       } else if (await waiting(history.repo)) {
           void mirror.push();
       }
       void maintainDaily(history.repo);
       warnings.push(...history.takeWarnings());
       return {
           history,
           mirror,
           close: () => {
               mirror.stop();
               opened.close();
           },
       };
   }
   ```

3. `sessionMaker` takes the turn's end:

   ```ts
   export function sessionMaker({
       compaction,
       connect,
       clusters,
       memory,
       turnEnded = null,
   }: {
       compaction: Pick<Compaction, "session"> | null;
       // A new session from its seed, untracked.
       connect: (seed: Seed) => ChatSession;
       clusters: readonly Cluster[];
       memory: MemoryHooks | null;
       turnEnded?: (() => void) | null;
   }): (turns: Turn[]) => ChatSession {
       const hooks = withTurnEnd(memory, turnEnded);
       return (turns) => {
           const session =
               compaction === null
                   ? connect({ turns: seedTurns(turns, clusters), clusters })
                   : compaction.session(turns, connect);
           return hooks === null ? session : trackMemory(session, hooks);
       };
   }
   ```

4. `clusterSaver` takes a recorder: add `recorder = null` to its
   parameters and `recorder?: Recorder | null;` to their type, and pass
   to `updateSidecar` after `lock`:

   ```ts
               recorder === null
                   ? undefined
                   : {
                         recorder,
                         message: `compaction: ${phrase} (dorothy, ${added[0]?.model ?? "unknown"})`,
                     },
   ```

5. In `runTui`, right after `warnings.push(...configWarnings);`:

   ```ts
       // The index and history open before anything is read, so that
       // history restores a broken file first. The index serves compaction
       // whenever the config lets it, since this chat's notes are not read
       // yet.
       const opened = openChatIndex(config, config.compaction.enabled);
       const index = opened.index;
       if (opened.warning !== null) {
           warnings.push(opened.warning);
       }
       const launched = await launchHistory({ config, index, warnings });
   ```

   In the resume branch's `catch`, before `return 1;`:

   ```ts
               await closeInOrder([
                   () => launched?.close(),
                   () => index?.close(),
               ]);
   ```

   Delete the later block that opened the index (from
   `// The index is opened before the first session, whose prompt carries`
   through the `if (opened.warning !== null) { ... }` after it).

6. Still in `runTui`: `new MemoryService({ ... })` gains
   `versions: launched?.history.handle() ?? null,`. Before
   `const compaction = ...`, add:

   ```ts
       // Writes outside memory's service take the index's lock, or
       // history's own without it.
       const writeLock = claims?.lock ?? launched?.history.lock;
       const turns =
           launched === null || transcript === null
               ? null
               : turnCommitter(
                     launched.history,
                     path,
                     () => transcript.flushed(),
                     history.filter((turn) => turn.role === "user").length,
                 );
   ```

   (`claims` is declared just above as `const claims = index;`; keep it,
   and put these lines after it.) In the `Compaction`'s options, `save`
   becomes:

   ```ts
                 save: clusterSaver({
                     dir,
                     phrase,
                     ...(writeLock === undefined ? {} : { lock: writeLock }),
                     transcript: transcript !== null,
                     recorder: launched?.history.recorder ?? null,
                 }),
   ```

   `sessionMaker({ ... })` gains `turnEnded: turns?.ended ?? null,`;
   `notices={memory ?? undefined}` becomes
   `notices={mergeNotices(memory, launched?.history)}`; and quitting
   becomes:

   ```ts
           await closeInOrder([
               () => compaction?.stop(),
               () => memory?.stop(),
               () => turns?.settled(),
               () => launched?.close(),
               () => index?.close(),
               () => writer?.close(),
           ]);
   ```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/tui/ src/history/`
Expected: PASS, every test, `runTui`'s two included (history adopts the
test's temporary data directory).

- [ ] **Step 6: Describe history**

In `README.md`, at the end of `### Memory` (after the `[memory]` table):

````markdown
Her memory keeps its own history. The data directory is a git repository:
each review, edit, compaction and turn is a commit, checked before it is
made, and a file found broken is put back as it last was, with the broken
copy kept under `broken/` and a warning. Git is used when it is installed,
and a built-in implementation when it is not.

```sh
bun run dev -- --history [<path>] [-n 20]  # what changed, newest first
bun run dev -- --restore <path> [<rev>]    # put a file back as it was
bun run dev -- --rollback <rev>            # notes and tags as they were
bun run dev -- --check                     # lint every file
bun run dev -- --mirror <url-or-path>      # set the sealed mirror
bun run dev -- --recover <url-or-path>     # rebuild an empty data dir
```

The history is pushed to a mirror off this machine, encrypted: set one
with `--mirror`, which makes `DOROTHY_MIRROR_KEY` and stores it with
dotenvx. Keep a copy of that key elsewhere; without it the mirror cannot
be read. Until a mirror is set, each launch reminds you. Under the
built-in implementation only an `https://` mirror can be pushed, with a
token in `DOROTHY_MIRROR_TOKEN`.

```toml
[history]
enabled = true     # false: no history, no mirror
push-seconds = 60  # at most one push per this many seconds, 10 to 86400
```
````

In `.claude/CLAUDE.md`, after the tags paragraph:

```markdown
History (`src/history/`) keeps the data directory as a git repository.
`MemoryRepo` (`repo.ts`) has two engines, the git binary run isolated from
the user's configuration (`binary.ts`) and isomorphic-git (`iso.ts`),
chosen once per process (`open.ts`); one contract test runs against both,
and across them. `MemoryHistory` (`history.ts`) adopts the directory,
commits each logical change inside the lock it was written under, sweeps
up outside changes first, and restores a file that fails the lint
(`lint.ts`, `heal.ts`), keeping its bytes under `broken/`. Memory never
imports history: writers take a `Recording` through `updateSidecar` and
`updateVocabulary`, the service a `HistoryHandle` as `versions`, and
memory's commands an `OpenHistory` from `src/index.ts`. Healing takes the
lock, so it happens only outside it. `mirror.ts` seals new commits as
AES-256-GCM bundles (`seal.ts`) on the orphan branch `sealed`, pushes it to
the remote `mirror` under `DOROTHY_MIRROR_KEY`, and `--recover` rebuilds
from it. `run.tsx` opens the index and history before it reads anything,
commits each turn once the transcript is flushed, and shows history's
notices with memory's. Tests pass every root, key and environment in, and
the binary's tests shut out the user's git configuration.
```

- [ ] **Step 7: Check and commit**

Three commits: history's housekeeping, the chat's wiring, the docs.

```bash
bunx biome check --write src/history/history.ts src/history/history.test.ts src/tui/run.tsx src/tui/run.test.ts src/tui/boundary.test.ts
bun run check
git add src/history/history.ts src/history/history.test.ts
git commit -m "feat(sdk): Repack memory's history daily"
git add src/tui/run.tsx src/tui/run.test.ts src/tui/boundary.test.ts
git commit -m "feat(tui): Keep memory's history from the chat"
git add README.md .claude/CLAUDE.md
git commit -m "docs: Describe memory history"
git log --oneline -3 && git status --short
```

---

### Task 11: The live probe

**Files:**

- Create: `docs/reports/2026-10-08-memory-history.md`
- Create: `docs/reports/2026-10-08-memory-history/` (sample data)

No code. Run Dorothy for real in tmux against throwaway XDG directories,
seeded with the tags probe's data, and report what happened. The report
and its sample data are committed to the branch; the PR links them.

**Safety, before anything else:**

- `XDG_DATA_HOME`, `XDG_CACHE_HOME` and `XDG_CONFIG_HOME` all point under
  one `mktemp -d` directory. Nothing reads or writes `~/.local/share`.
- `DOROTHY_MIRROR_KEY` is set in the probe's environment before any
  `--mirror`, so `--mirror` uses it and never calls dotenvx's `set`,
  which would write a key into this repository's real `.env`.
- The mirror is a bare repository under the same temporary directory.

- [ ] **Step 1: Set up**

```bash
P=$(mktemp -d /tmp/dorothy-history-probe.XXXXXX)
mkdir -p "$P/data" "$P/cache" "$P/config/dorothy" "$P/probe"
cp -r docs/reports/2026-10-08-tags/data/dorothy "$P/data/"
printf '[memory]\nidle-seconds = 10\n\n[history]\npush-seconds = 10\n' > "$P/config/dorothy/config.toml"
cat > "$P/probe/env.sh" <<ENV
# shellcheck shell=sh
# Sourced before each launch: throwaway XDG directories, dotenvx's own
# key, a mirror key of the probe's own, and \$B, bun run directly.
export XDG_DATA_HOME=$P/data XDG_CACHE_HOME=$P/cache XDG_CONFIG_HOME=$P/config DOTENVX_CONFIG="\$HOME/.config/dotenvx"
export DOROTHY_MIRROR_KEY=$(head -c 32 /dev/urandom | base64)
unset FORCE_COLOR
export B=$HOME/.local/share/mise/installs/bun/1.4/bin/bun
cd $(pwd) || return
ENV
git init -q --bare "$P/mirror.git"
tmux new-session -d -s historyprobe -x 120 -y 40
tmux send-keys -t historyprobe ". $P/probe/env.sh" Enter
```

Copy `say.sh` from `docs/reports/2026-10-08-tags/probe/` into
`$P/probe/`, changing its session name from `tagsprobe` to
`historyprobe`. Run `shellcheck` and
`mise x aqua:mvdan/sh@3.14.1 -- shfmt -d` on both scripts before they are
committed: CI lints shell, and `bun run check` does not.

- [ ] **Step 2: Adoption, and the reminder**

```bash
tmux send-keys -t historyprobe '$B src/index.ts' Enter
```

Expected: the first screen shows the warning
`memory has no mirror · dorothy --mirror <url>`. Quit (Ctrl+C twice), then
in a second tmux window (sourced the same way) run `$B src/index.ts --history`.
Expected: one commit, `adopt: <n> files`, where n counts `tags.json`, the
four transcripts, their four sidecars and `.gitignore` (10).

- [ ] **Step 3: Turns and a review**

Launch again, send two messages with `say.sh` (a new subject, say
houseplant care), and wait past the 10-second idle for the review.
Expected in `--history`: `turn: <phrase> #1`, `#2`, then
`review: <phrase> (dorothy, <model>)`; `title: <phrase> (prompt)` before
them. Record the exact lines.

- [ ] **Step 4: A broken `tags.json` restored**

Quit. Cut `tags.json` short (`head -c 40 tags.json > t && mv t tags.json`
in `$P/data/dorothy`). Run `$B src/index.ts --check`. Expected: exit 1,
naming `tags.json` with the parse error. Launch the TUI. Expected: a
warning `Restored tags.json from <sha> (<date>); the broken copy is in
broken/`; `tags.json` equal to its last committed version; the cut bytes
in `broken/tags.json.<stamp>`; `--history` shows the `restore:` commit.

- [ ] **Step 5: An edit, then a rollback**

Rename a concept with `--edit-tags` through a `$VISUAL` script (as the
tags probe did: `VISUAL` outranks `EDITOR` in this shell). Expected:
`edit-tags: 1 concepts (user)`. Then `--rollback <sha before the edit>`.
Expected: `Rolled back 1 file to <sha>`, the old label back, a
`rollback: to <sha> (user)` commit, and the transcripts untouched
(`git -C $P/data/dorothy diff <sha> HEAD -- transcripts/` lists only
turn changes made after it, none undone).

- [ ] **Step 6: The mirror**

`$B src/index.ts --mirror $P/mirror.git`. Expected: no `Made
DOROTHY_MIRROR_KEY` line (the key was set), `Pushed to <path>`, and
`git --git-dir $P/mirror.git ls-tree -r --name-only sealed` listing
`SEALED` and `bundles/000001.enc`. Launch the TUI, send one message, wait
past the review and 10 more seconds. Expected: `bundles/000002.enc` on the
mirror, and `--mirror` with no argument printing `Waiting: no`. Check that
no bundle's bytes contain a phrase or a word of the chats
(`git --git-dir $P/mirror.git show sealed:bundles/000001.enc | grep -a -c houseplant`
prints 0).

- [ ] **Step 7: Recovery**

In a fresh environment with `XDG_DATA_HOME=$P/recovered` and the same
`DOROTHY_MIRROR_KEY`: `$B src/index.ts --recover $P/mirror.git`.
Expected: `Recovered 2 of 2 bundles; main is at <sha>` and
`All <n> files pass.` Then
`diff -r --exclude=.git $P/data/dorothy $P/recovered/dorothy` prints
nothing, except for changes committed after the last push (say so if any
are).

- [ ] **Step 8: The fallback engine, and the hook**

`env PATH=/nonexistent $B src/index.ts --history -n 5` (bun is run by its
full path, so only git is missing). Expected: the same five newest
commits as with the binary, read by isomorphic-git. Then, in
`$P/data/dorothy`, with the shell's own git:
`printf '{' > tags.json && git add tags.json && git commit -m x`.
Expected: the commit refused by the pre-commit hook, naming `tags.json`;
then `git checkout -- tags.json` and `git reset -q` restore it.

- [ ] **Step 9: Write the report**

Write `docs/reports/2026-10-08-memory-history.md` in the shape of
`docs/reports/2026-10-08-tags.md`: front matter, a link list (spec, plan,
branch at its commit, sample data), Setup, one section per step above
with **Run**, **Expected** and **Happened**, Findings (each said to be a
defect or not), and Sample data. Quote real output, trimmed and marked as
trimmed; never quote a shorthand as if it were output.

Sample data in `docs/reports/2026-10-08-memory-history/`, none of it a
`.git` directory (git would take one for a submodule):

- `history.txt`: the final `--history -n 50`;
- `tags-cut.json` and `tags-restored.json`: the bytes before and after
  Step 4;
- `check-broken.txt`: Step 4's `--check` output;
- `sealed.txt`: the mirror's `ls-tree` after Step 6;
- `recover.txt`: Step 7's output and the empty `diff`;
- `hook.txt`: Step 8's refused commit;
- `probe/`: `env.sh`, `say.sh`, `config.toml` and the editor script,
  with `env.sh`'s key line replaced by
  `export DOROTHY_MIRROR_KEY=<32 random bytes, base64>`.

Biome formats any JSON under `docs/`; note that in the report, as the
tags report does. Store editor views as `.txt`, so the Markdown lint skips
them.

- [ ] **Step 10: Check and commit**

```bash
bunx biome check --write docs/reports/2026-10-08-memory-history/
shellcheck docs/reports/2026-10-08-memory-history/probe/*.sh
mise x aqua:mvdan/sh@3.14.1 -- shfmt -d docs/reports/2026-10-08-memory-history/probe/
bun run check
git add docs/reports/2026-10-08-memory-history/
git commit -m "docs: Keep the history probe's sample data"
git add docs/reports/2026-10-08-memory-history.md
git commit -m "docs: Report the history probe"
git log --oneline -2 && git status --short
```

Kill the tmux session and delete `$P` once the report is committed.

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
