---
ctime: 2026-10-15
mtime: 2026-10-15
spdx: GPL-3.0-only
title: Dorothy's memory store plan
description: >-
  Implementation plan for the memory store: tool events, facts in
  trap-free Markdown, retiring, projects and their sync with a
  repository, the recall index's facts, and the commands over them.
tags:
  - dorothy
  - memory
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-15-memory-store.md
   -
   -->

# Dorothy's Memory Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dorothy's store holds facts beside conversations, each fact
personal or a project's, synced both ways with a project's repository,
and records any body's tool calls; nothing in it is ever forgotten.

**Architecture:** All in `@dorothy/memory`. `transcript.ts` gains the
session event's source fields and a scrubbed, trimmed tool event.
`facts/` holds the fact file format (`file.ts`), the store's reads and
writes (`store.ts`) and the commands (`commands.ts`). `projects/`
identifies a repository (`identify.ts`), keeps `projects.json`
(`registry.ts`), renders the exported form and `MEMORY.md`
(`export.ts`) and reconciles the two sides (`sync.ts`). History lints
and canonicalises facts; the recall index indexes them. `@dorothy/cli`
parses and dispatches five new commands.

**Tech Stack:** Bun 1.4.2 (`Bun.YAML.parse`, `bun:sqlite` FTS5,
`bun test`), TypeScript 7, Biome 2.5, remark. No new dependency.

**Spec:** `docs/specs/2026-10-15-memory-store-design.md`. Research:
`docs/notes/2026-10-15_memory-systems-comparison.md`.

## Global Constraints

- Every new file carries the house header, copied from a sibling;
  `bun run lint:header` checks the breadcrumb against the path.
- No em dash (U+2014) anywhere; Markdown lines at most 80 characters.
- Commits in Conventional Commits, header at most 50 characters, body
  lines at most 72; scopes `memory`, `cli`; no agent trailers.
- Tests and probes never touch `$XDG_DATA_HOME/dorothy` or
  `$XDG_CACHE_HOME/dorothy`: every root, repository and environment is
  passed in, in temporary directories.
- `@dorothy/memory` still depends on `core` alone of the `@dorothy`
  packages, and gains no dependency: YAML is `Bun.YAML.parse`.
- Fact limits, exactly: `name` 64 characters, `title` 60,
  `description` 160, `retired.why` 160, body 8,000 (see Rulings);
  `importance` an integer 1 to 10; tool text 2,000 characters each side.
- Frontmatter keys in this order: `name`, `title`, `description`,
  `metadata`, `tags`, `importance`, `provenance`, `retired`. Free text in
  normalised `>-` blocks wrapped at 80 columns; closed sets and patterns
  plain; `importance` a plain integer; everything else `JSON.stringify`.
- Origins exactly `user`, `dorothy`, `external`, `repo`; writers exactly
  `dorothy`, `user`, `review`, `repo`; fact types exactly `user`,
  `feedback`, `project`, `reference`.
- `MEMORY.md` within 200 lines and 25,000 bytes.
- Sync never commits or pushes a repository, and never writes outside
  `<root>/<memoryDir>`.
- `packages/memory/AGENTS.md` at most 150 lines (137 now), the root's at
  most 100.
- Every commit passes `bun run check`.

## Review Focus

- **Credentials in an origin URL.** `https://user:token@host/owner/repo`
  must yield `host/owner/repo`; no token may reach an id,
  `projects.json` or a commit message. Pinned in Task 4.
- **An uncommitted edit in a repository.** A fact the user is editing in
  the working tree must never be overwritten by sync, whichever side
  also changed. Pinned in Task 8.
- **A repository file that is not a fact,** or one with YAML traps
  (`title: null`, `description: 1e3`, no frontmatter): skipped and
  named, never imported, overwritten or retired. Pinned in Task 8.
- **A memory directory that escapes,** by `..` in `projects.json` or a
  symlink in the repository: sync refuses and writes nothing. Pinned in
  Task 4 (`memoryDirProblem`) and Task 8.
- **A hand-kept `MEMORY.md` with nothing readable beside it:** sync must
  leave it alone rather than empty it. Pinned in Task 8.

## Rulings on the spec

Found while planning; Task 2 writes the first into the spec, Task 10
the rest into the report.

1. **The body cap is 8,000 characters, not 2,000.** This repository's
   own `.agents/memory/maintenance-design-agreed.md` has a 2,638
   character body; at 2,000 the first sync would refuse to adopt it.
2. **A project's origin is read from `.git/config` directly,** not from
   `git`: Dorothy runs without git installed (history falls back to
   isomorphic-git), and a user's `insteadOf` rewrites must not change
   an id. A worktree's or submodule's `.git` file is followed.
3. **An origin that is a local path or `file://` URL is no origin:**
   the project is `local-` and its root's hash.
4. **`MEMORY.md` is left alone** when any repository file was skipped,
   or the project has no live fact, so that a hand-kept index never
   loses entries sync could not read.
5. **Repository files are written mode 0644** in ordinary directories;
   the store's own stay 0600 in 0700.
6. **Repository files over 64 KiB are skipped unread,** and symlinks are
   never followed.
7. **A fact added or edited by hand in the store may omit
   `provenance`;** the sweep fills it in as the user's.
8. **Facts adopted from a `MEMORY.md` take creation times in its
   order,** a millisecond apart, so the regenerated index keeps it.
9. **CRLF line ends read as LF.**

## File Structure

| File (under `packages/memory/src/`) | Responsibility |
| --- | --- |
| `scrub.ts` (new) | replaces the shapes of secrets in text |
| `transcript.ts` | session event's source fields; tool event; `toolEntry` |
| `facts/file.ts` (new) | a fact's type, canonical render, parse, lint, origin rule |
| `facts/store.ts` (new) | paths and scopes; list, read, write, move, retire, revive |
| `facts/commands.ts` (new) | `--facts`, `--retire`, `--revive`, `--sync`, `--projects` |
| `projects/identify.ts` (new) | a path's repository root and project id |
| `projects/registry.ts` (new) | `projects.json`; the memory directory's choice and checks |
| `projects/export.ts` (new) | exported form, its hash, `MEMORY.md` |
| `projects/sync.ts` (new) | `syncProject`, the reconciliation |
| `history/lint.ts` | fact and projects file kinds and their lint |
| `history/history.ts` | hand edits to facts rewritten canonically in the sweep |
| `recall/store.ts` | schema 4: `source`, `project`, `facts`, `fact_tags`, `facts_fts` |
| `recall/sync.ts` | source and project from the first session; `syncFacts` |
| `commands.ts` | exports the new commands |

`packages/cli/src/index.ts` parses and dispatches the commands.

---

### Task 1: Tool events and the session's source

**Files:**

- Create: `packages/memory/src/scrub.ts`
- Create: `packages/memory/src/scrub.test.ts`
- Modify: `packages/memory/src/transcript.ts`
- Test: `packages/memory/src/transcript.test.ts`,
  `packages/memory/src/compaction/plan.test.ts`,
  `packages/memory/src/memory/review.test.ts`

**Interfaces:**

- Produces: `scrub(text: string): string`; in `transcript.ts`:
  `type Source = "chat" | "claude-code"`, `SessionEvent`'s optional
  `source`, `sourceSession`, `project`; `type ToolEvent`;
  `sourceOf(event: { source?: unknown }): Source`;
  `TOOL_TEXT_LIMIT = 2000`; `toolEntry({ name, input, output, ok,
  memory? }): Extract<TranscriptEntry, { kind: "tool" }>`.

- [ ] **Step 1: Write the failing scrub tests**

`packages/memory/src/scrub.test.ts` (header copied from `transcript.ts`
with the breadcrumb `:/packages/memory/src/scrub.test.ts`):

```ts
import { describe, expect, it } from "bun:test";
import { scrub } from "./scrub.js";

const CASES: [string, string][] = [
    ["export API_KEY=abc123", "export API_KEY=[secret]"],
    ['{"password": "hunter2"}', '{"password": "[secret]"}'],
    [
        "curl -H 'Authorization: Bearer abcdefgh12345678'",
        "curl -H 'Authorization: Bearer [secret]'",
    ],
    ["token: ghp_abcdefghijklmnopqrstuvwxyz0123", "token: [secret]"],
    ["key sk-ant-api03-abcdefghij", "key [secret]"],
    ["AKIAABCDEFGHIJKLMNOP", "[secret]"],
    [
        "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
        "[secret]",
    ],
];

describe("scrub", () => {
    it.each(CASES)("replaces the secret in %p", (input, expected) => {
        expect(scrub(input)).toBe(expected);
    });

    it("leaves text with no secret's shape alone", () => {
        const text = "git status --short\n M docs/roadmap.md\n";
        expect(scrub(text)).toBe(text);
    });

    it("gives the same text when run twice", () => {
        for (const [input] of CASES) {
            expect(scrub(scrub(input))).toBe(scrub(input));
        }
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/memory/src/scrub.test.ts`
Expected: FAIL, `Cannot find module './scrub.js'`.

- [ ] **Step 3: Write `scrub.ts`**

```ts
// The shapes of secrets a tool call's text may carry, replaced before the
// call is written to a transcript. A secret with no telling shape, such as
// a password with no key beside it, is not caught.

const SECRET = "[secret]";

const PRIVATE_KEY =
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g;
// The prefixes providers give their keys.
const PREFIXED =
    /\b(?:sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/g;
// key=value or key: value, quoted or not, where the key names a secret.
// A value that is a Bearer or Basic scheme was handled above.
const NAMED =
    /\b([\w.-]*(?:token|key|secret|password|passwd|auth)[\w.-]*)(["']?\s*[=:]\s*)(["']?)(?!(?:Bearer|Basic)\s)([^\s"'&,;]+)/gi;

export function scrub(text: string): string {
    return text
        .replace(PRIVATE_KEY, SECRET)
        .replace(BEARER, (_, scheme: string) => `${scheme} ${SECRET}`)
        .replace(PREFIXED, SECRET)
        .replace(
            NAMED,
            (_, key: string, separator: string, quote: string) =>
                `${key}${separator}${quote}${SECRET}`,
        );
}
```

- [ ] **Step 4: Run the scrub tests to see them pass**

Run: `bun test packages/memory/src/scrub.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the failing transcript tests**

In `packages/memory/src/transcript.test.ts`, add `sourceOf` and
`toolEntry` to the import from `./transcript.js`, and append:

```ts
describe("toolEntry", () => {
    it("scrubs each side, then trims it to 2,000 characters and counts the cut", () => {
        expect(
            toolEntry({
                name: "Bash",
                input: '{"command":"export API_KEY=abc123"}',
                output: "x".repeat(2500),
                ok: true,
            }),
        ).toEqual({
            kind: "tool",
            name: "Bash",
            input: '{"command":"export API_KEY=[secret]"}',
            output: "x".repeat(2000),
            ok: true,
            cut: { input: 0, output: 500 },
        });
    });

    it("counts code points, so a trim never splits a character", () => {
        const entry = toolEntry({
            name: "Read",
            input: "{}",
            output: "😀".repeat(2001),
            ok: true,
        });
        expect([...entry.output]).toHaveLength(2000);
        expect(entry.cut.output).toBe(1);
    });

    it("marks a call to Dorothy's own memory tools, and only those", () => {
        const call = { name: "search", input: "{}", output: "", ok: true };
        expect(toolEntry({ ...call, memory: true }).memory).toBe(true);
        expect("memory" in toolEntry(call)).toBe(false);
    });

    it("is written with v and at like any event", async () => {
        const path = join(dir, "t.jsonl");
        const writer = await TranscriptWriter.open(path, () => NOW);
        await writer.append(
            toolEntry({ name: "Bash", input: "{}", output: "", ok: false }),
        );
        await writer.close();
        expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
            v: 1,
            kind: "tool",
            at: NOW.toISOString(),
            name: "Bash",
            input: "{}",
            output: "",
            ok: false,
            cut: { input: 0, output: 0 },
        });
    });
});

describe("tool events in a transcript", () => {
    const at = "2026-10-15T09:00:00.000Z";
    const line = (fields: object) => JSON.stringify({ v: 1, at, ...fields });
    const tool = line({
        kind: "tool",
        name: "Bash",
        input: "{}",
        output: "",
        ok: true,
        cut: { input: 0, output: 0 },
    });

    it("are neither turns nor skipped", () => {
        expect(toTurn(JSON.parse(tool))).toBe("ignore");
        const read = parseTranscript(
            [
                line({ kind: "user", text: "hi" }),
                tool,
                line({ kind: "assistant", text: "done", interrupted: false }),
            ].join("\n"),
        );
        expect(read.skipped).toBe(0);
        expect(read.turns.map((turn) => turn.role)).toEqual([
            "user",
            "assistant",
        ]);
    });

    it("leave consecutive assistant turns as they are", () => {
        const read = parseTranscript(
            [
                line({ kind: "user", text: "fix it" }),
                line({ kind: "assistant", text: "Looking.", interrupted: false }),
                tool,
                line({ kind: "assistant", text: "Fixed.", interrupted: false }),
            ].join("\n"),
        );
        expect(read.turns.map((turn) => [turn.role, turn.text])).toEqual([
            ["user", "fix it"],
            ["assistant", "Looking."],
            ["assistant", "Fixed."],
        ]);
    });
});

describe("sourceOf", () => {
    it("reads chat when a session event names no source, or one unknown", () => {
        expect(sourceOf({})).toBe("chat");
        expect(sourceOf({ source: "telegram" })).toBe("chat");
        expect(sourceOf({ source: "claude-code" })).toBe("claude-code");
    });
});
```

`dir` and `NOW` are the names the file's existing `TranscriptWriter`
tests use; if the file names them differently, use its names.

- [ ] **Step 6: Write the failing compaction test**

Append to `packages/memory/src/compaction/plan.test.ts`, inside its
`describe("outgoing", ...)` block:

```ts
    it("treats consecutive assistant turns as any other turns", () => {
        const turns: Turn[] = [
            { role: "user", text: "a ".repeat(400) },
            { role: "assistant", text: "b ".repeat(400) },
            { role: "assistant", text: "c ".repeat(400) },
            { role: "user", text: "next" },
            { role: "assistant", text: "d" },
            { role: "assistant", text: "e" },
        ];
        expect(outgoing(turns, [], 10)).toEqual({ from: 1, through: 3 });
    });
```

Append to `packages/memory/src/memory/review.test.ts`, beside the test
"escapes the conversation so nothing in it can close the element":

```ts
    it("gives each of consecutive replies its own line", () => {
        const prompt = reviewPrompt(
            [
                { role: "user", text: "fix it" },
                { role: "assistant", text: "Looking." },
                { role: "assistant", text: "Fixed." },
            ],
            null,
        );
        expect(prompt).toContain("User: fix it\n\nDorothy: Looking.\n\nDorothy: Fixed.");
    });
```

- [ ] **Step 7: Run them to see them fail**

Run:

```bash
bun test packages/memory/src/transcript.test.ts packages/memory/src/compaction/plan.test.ts packages/memory/src/memory/review.test.ts
```

Expected: FAIL: `toolEntry` and `sourceOf` are not exported; the
compaction and review tests pass already (they pin behaviour).

- [ ] **Step 8: Extend `transcript.ts`**

Import `scrub` at the top:

```ts
import { scrub } from "./scrub.js";
```

Replace `SessionEvent` and add the source and tool types above
`UserEvent`:

```ts
// The body a session ran in. A session event without one is chat's.
export type Source = "chat" | "claude-code";
export type SessionEvent = {
    v: 1;
    kind: "session";
    at: string;
    phrase: string;
    sdkSessionId: string;
    model: string;
    promptHash: string;
    resumed: boolean;
    source?: Source;
    // The body's own session id, so a resumed session continues its
    // conversation.
    sourceSession?: string;
    // The project the session ran in; none for chat.
    project?: string;
};
// A body's tool call, its text scrubbed of secrets and trimmed. memory
// marks a call to Dorothy's own memory tools, so that no review learns as
// new what memory supplied.
export type ToolEvent = {
    v: 1;
    kind: "tool";
    at: string;
    name: string;
    input: string;
    output: string;
    ok: boolean;
    cut: { input: number; output: number };
    memory?: true;
};
```

Add `| ToolEvent` to the `TranscriptEvent` union. After the
`TranscriptEntry` type add:

```ts
export const sourceOf = (event: { source?: unknown }): Source =>
    event.source === "claude-code" ? "claude-code" : "chat";

// Each side of a tool call keeps this many characters, counted in code
// points.
export const TOOL_TEXT_LIMIT = 2000;

function trimmed(text: string): { text: string; cut: number } {
    const points = [...text];
    return points.length <= TOOL_TEXT_LIMIT
        ? { text, cut: 0 }
        : {
              text: points.slice(0, TOOL_TEXT_LIMIT).join(""),
              cut: points.length - TOOL_TEXT_LIMIT,
          };
}

// A tool call as a transcript entry: scrubbed first, so a secret is never
// half kept by the trim.
export function toolEntry({
    name,
    input,
    output,
    ok,
    memory = false,
}: {
    name: string;
    input: string;
    output: string;
    ok: boolean;
    memory?: boolean;
}): Extract<TranscriptEntry, { kind: "tool" }> {
    const inside = trimmed(scrub(input));
    const outside = trimmed(scrub(output));
    return {
        kind: "tool",
        name,
        input: inside.text,
        output: outside.text,
        ok,
        cut: { input: inside.cut, output: outside.cut },
        ...(memory ? { memory: true as const } : {}),
    };
}
```

In `toTurn`, make tool events ignorable:

```ts
    return kind === "session" ||
        kind === "stats" ||
        kind === "compaction" ||
        kind === "tool"
        ? "ignore"
        : "malformed";
```

- [ ] **Step 9: Run the tests and the type check**

Run: `bun test packages/memory/src && bun run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/memory/src/scrub.ts packages/memory/src/scrub.test.ts \
  packages/memory/src/transcript.ts packages/memory/src/transcript.test.ts \
  packages/memory/src/compaction/plan.test.ts \
  packages/memory/src/memory/review.test.ts
git commit -m "feat(memory): Record tool calls, scrubbed" \
  -m "A tool event keeps a body's call, its text scrubbed of the shapes of
secrets and trimmed to 2,000 characters a side; a session event may
name its source, the body's session and its project."
```

---

### Task 2: The fact file

**Files:**

- Create: `packages/memory/src/facts/file.ts`
- Create: `packages/memory/src/facts/file.test.ts`
- Modify: `docs/specs/2026-10-15-memory-store-design.md` (Ruling 1)

**Interfaces:**

- Consumes: `normalise`, `characters`, `CONCEPT_ID` from
  `../memory/sidecar.js`; `isPhrase` from `@dorothy/core`.
- Produces: `FACT_TYPES`, `type FactType`, `ORIGINS`, `type Origin`,
  `WRITERS`, `type Writer`, `FACT_LIMITS`, `FACT_NAME`, `type Extra`,
  `type FactProvenance`, `type Retired`, `type Fact`, `type FactRead`,
  `hiddenCharacter(text): string | null`,
  `splitFrontmatter(text): { yaml: string; body: string } | null`,
  `wrap(text, width): string[]`, `folded(key, text, indent?): string[]`,
  `frontmatterOf(text): { data; body }` (throws `Problem`),
  `readCommon(data, body, stem?)`, `checkBody(body)`,
  `renderFact(fact): string`, `parseFact(text, stem?): FactRead`,
  `handEdited(text, stem, now: Date): string | null`,
  `nextOrigin(previous, written, by): Origin`, `Problem` (an `Error`).

- [ ] **Step 1: Write the failing tests**

`packages/memory/src/facts/file.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
    type Fact,
    handEdited,
    hiddenCharacter,
    nextOrigin,
    parseFact,
    renderFact,
    wrap,
} from "./file.js";

const AT = "2026-10-15T09:30:00.000Z";
const PHRASE = "bingo-overabundance-mazer-kasha";

const fact = (fields: Partial<Fact> = {}): Fact => ({
    name: "likes-tea",
    title: "Likes tea",
    description: "Prefers tea to coffee in the afternoon.",
    type: "user",
    extra: {},
    tags: [],
    importance: null,
    provenance: { origin: "user", by: "dorothy", at: AT, created: AT },
    retired: null,
    body: "Asked for tea twice.",
    ...fields,
});

const CANONICAL = [
    "---",
    "name: likes-tea",
    "title: >-",
    "  Likes tea",
    "description: >-",
    "  Prefers tea to coffee in the afternoon.",
    "metadata:",
    "  type: user",
    "  node_type: \"memory\"",
    "tags:",
    "  - k1a2b3c4d",
    "importance: 7",
    "provenance:",
    "  origin: user",
    "  by: dorothy",
    `  at: "${AT}"`,
    `  created: "${AT}"`,
    "  model: \"claude-opus-5-5\"",
    `  from: "${PHRASE}#12"`,
    "---",
    "",
    "Asked for tea twice.",
    "",
].join("\n");

describe("renderFact", () => {
    it("writes the keys in order, free text in >- blocks, the rest as JSON", () => {
        expect(
            renderFact(
                fact({
                    extra: { node_type: "memory" },
                    tags: ["k1a2b3c4d"],
                    importance: 7,
                    provenance: {
                        origin: "user",
                        by: "dorothy",
                        at: AT,
                        created: AT,
                        model: "claude-opus-5-5",
                        from: `${PHRASE}#12`,
                    },
                }),
            ),
        ).toBe(CANONICAL);
    });

    it("wraps free text at 80 columns", () => {
        const description = `${"word ".repeat(31)}end`;
        const text = renderFact(fact({ description }));
        for (const line of text.split("\n")) {
            expect(line.length).toBeLessThanOrEqual(80);
        }
        expect(parseFact(text, "likes-tea")).toEqual({
            kind: "ok",
            fact: fact({ description }),
        });
    });

    it("writes a retirement after provenance", () => {
        const text = renderFact(
            fact({ retired: { at: AT, by: "user", why: "No longer true." } }),
        );
        expect(text).toContain(
            `retired:\n  at: "${AT}"\n  by: user\n  why: >-\n    No longer true.\n---`,
        );
    });
});

// A small, seeded generator, so a failure reproduces.
function random(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const PIECES = [
    "null", "~", "no", "yes", "1e3", "0o17", "true", ":", "a: b", " #",
    "#", "*x", "&y", "!z", "[", "]", "{", "}", "|", ">", "'", '"', "\\",
    "-", "---", "%", "@", "`", "é", "日本", "😀", "word", "tea", "",
];

describe("parseFact", () => {
    it("reads back every field it renders, whatever the text", () => {
        const next = random(42);
        const pick = () => PIECES[Math.floor(next() * PIECES.length)] ?? "";
        const phrase = (count: number) =>
            Array.from({ length: count }, pick).join(" ");
        for (let run = 0; run < 300; run++) {
            const clip = (text: string, limit: number) =>
                [...text].slice(0, limit).join("").trim() || "x";
            const normal = (text: string, limit: number) =>
                clip(text.replace(/\s+/g, " ").trim(), limit);
            const written = fact({
                title: normal(phrase(8), 60),
                description: normal(phrase(30), 160),
                extra: { note: phrase(5), count: run, flag: run % 2 === 0 },
                provenance: {
                    origin: "dorothy",
                    by: "review",
                    at: AT,
                    created: AT,
                    model: `m ${phrase(2)}`,
                },
                retired:
                    run % 3 === 0
                        ? { at: AT, by: "user", why: normal(phrase(10), 160) }
                        : null,
                body: Array.from({ length: 4 }, () => phrase(6)).join("\n").trim(),
            });
            const read = parseFact(renderFact(written), "likes-tea");
            expect(read).toEqual({ kind: "ok", fact: written });
        }
    });

    it("normalises free text written by hand", () => {
        const text = CANONICAL.replace(
            "title: >-\n  Likes tea",
            'title: "Likes   tea "',
        );
        const read = parseFact(text, "likes-tea");
        expect(read.kind === "ok" && read.fact.title).toBe("Likes tea");
    });

    it("reads CRLF line ends as LF", () => {
        const read = parseFact(CANONICAL.replaceAll("\n", "\r\n"), "likes-tea");
        expect(read.kind).toBe("ok");
    });

    const broken: [string, string, string][] = [
        ["a null title", "title: >-\n  Likes tea", "title: null"],
        ["a numeric title", "title: >-\n  Likes tea", "title: 1e3"],
        ["a tilde title", "title: >-\n  Likes tea", "title: ~"],
        ["an octal title", "title: >-\n  Likes tea", "title: 0o17"],
        ["a colon in plain text", "title: >-\n  Likes tea", "title: a: b"],
        ["importance as text", "importance: 7", 'importance: "7"'],
        ["importance out of range", "importance: 7", "importance: 11"],
        ["an unknown type", "  type: user", "  type: notes"],
        ["a nested extra", '  node_type: "memory"', "  node_type:\n    a: 1"],
        ["a name not its stem", "name: likes-tea", "name: other"],
        ["an unknown key", "importance: 7", "importance: 7\ncolor: blue"],
        ["an unknown origin", "  origin: user", "  origin: owner"],
        ["a time that is not one", `  at: "${AT}"`, '  at: "yesterday"'],
        ["a from that is no phrase", `  from: "${PHRASE}#12"`, '  from: "x"'],
        ["a tag that is no concept", "  - k1a2b3c4d", "  - tea"],
        ["an unknown provenance key", "  origin: user\n", "  origin: user\n  extra: 1\n"],
    ];

    it.each(broken)("refuses %s", (_, from, to) => {
        const text = CANONICAL.replace(from, to);
        expect(text).not.toBe(CANONICAL);
        expect(parseFact(text, "likes-tea").kind).toBe("unparseable");
    });

    it("refuses a fact with no provenance", () => {
        const text = CANONICAL.replace(/provenance:\n(?: {2}.*\n)+/, "");
        expect(text).not.toContain("provenance");
        expect(parseFact(text, "likes-tea")).toEqual({
            kind: "unparseable",
            reason: "provenance is not a mapping",
        });
    });

    it("refuses a fact with no frontmatter, or none closed", () => {
        expect(parseFact("Just text.\n", "likes-tea").kind).toBe("unparseable");
        expect(parseFact("---\nname: likes-tea\n", "likes-tea").kind).toBe(
            "unparseable",
        );
    });

    it("refuses hidden and control characters anywhere", () => {
        for (const hidden of ["\u200b", "\u202e", "\u0007", "\ufeff", "\u{e0041}"]) {
            const text = CANONICAL.replace("twice.", `twice.${hidden}`);
            const read = parseFact(text, "likes-tea");
            expect(read.kind).toBe("unparseable");
        }
    });

    it("refuses a body over 8,000 characters", () => {
        const text = renderFact(fact({ body: "x".repeat(8001) }));
        expect(parseFact(text, "likes-tea")).toEqual({
            kind: "unparseable",
            reason: "its body is 8001 characters, over 8000",
        });
    });

    it("refuses a link to a fact outside its directory", () => {
        for (const link of ["../other.md", "/etc/x.md", "sub/x.md", "./Bad.md"]) {
            const text = renderFact(fact({ body: `See [it](${link}).` }));
            expect(parseFact(text, "likes-tea").kind).toBe("unparseable");
        }
        const ok = renderFact(fact({ body: "See [it](./other-fact.md#why)." }));
        expect(parseFact(ok, "likes-tea").kind).toBe("ok");
    });
});

describe("hiddenCharacter", () => {
    it("names the first hidden character, and allows tab and newline", () => {
        expect(hiddenCharacter("a\tb\nc")).toBeNull();
        expect(hiddenCharacter("a\u200bb")).toBe("U+200B");
    });
});

describe("wrap", () => {
    it("keeps a word longer than the width whole, on a line of its own", () => {
        expect(wrap(`a ${"x".repeat(90)} b`, 78)).toEqual([
            "a",
            "x".repeat(90),
            "b",
        ]);
    });
});

describe("handEdited", () => {
    const now = new Date("2026-10-16T08:00:00.000Z");

    it("fills in a hand-added fact's provenance as the user's", () => {
        const text = [
            "---",
            "name: likes-tea",
            "title: Likes tea",
            "description: Prefers tea.",
            "metadata:",
            "  type: user",
            "---",
            "",
            "Tea.",
            "",
        ].join("\n");
        const canonical = handEdited(text, "likes-tea", now);
        expect(canonical).not.toBeNull();
        const read = parseFact(canonical as string, "likes-tea");
        expect(read.kind === "ok" && read.fact.provenance).toEqual({
            origin: "user",
            by: "user",
            at: now.toISOString(),
            created: now.toISOString(),
        });
    });

    it("keeps when a fact was created and where it came from", () => {
        const edited = renderFact(
            fact({
                body: "Tea, always.",
                provenance: {
                    origin: "external",
                    by: "review",
                    at: AT,
                    created: AT,
                    model: "m",
                    from: `${PHRASE}#3`,
                },
            }),
        );
        const read = parseFact(
            handEdited(edited, "likes-tea", now) as string,
            "likes-tea",
        );
        expect(read.kind === "ok" && read.fact.provenance).toEqual({
            origin: "user",
            by: "user",
            at: now.toISOString(),
            created: AT,
            from: `${PHRASE}#3`,
        });
    });

    it("gives null for a file that is no fact", () => {
        expect(handEdited("Just text.\n", "likes-tea", now)).toBeNull();
    });
});

describe("nextOrigin", () => {
    it("lets a later writer lower a fact's origin but not raise it", () => {
        expect(nextOrigin(null, "dorothy", "dorothy")).toBe("dorothy");
        expect(nextOrigin("user", "external", "review")).toBe("external");
        expect(nextOrigin("external", "dorothy", "dorothy")).toBe("external");
        expect(nextOrigin("repo", "dorothy", "review")).toBe("repo");
    });

    it("makes a version the user writes the user's", () => {
        expect(nextOrigin("external", "external", "user")).toBe("user");
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/memory/src/facts/file.test.ts`
Expected: FAIL, `Cannot find module './file.js'`.

- [ ] **Step 3: Write `facts/file.ts`**

```ts
// A fact: Markdown with YAML frontmatter, one file each. Only Dorothy's
// code renders frontmatter, in a form with one reading: free text in
// normalised >- blocks, closed sets and patterns plain, the rest through
// JSON.stringify. Read, every value is checked for its type, so a YAML
// trap written by hand fails rather than being coerced.

import { isPhrase } from "@dorothy/core";
import { CONCEPT_ID, characters, normalise } from "../memory/sidecar.js";

export const FACT_TYPES = ["user", "feedback", "project", "reference"] as const;
export type FactType = (typeof FACT_TYPES)[number];
// Where a fact's content came from, most trusted last.
export const ORIGINS = ["external", "repo", "dorothy", "user"] as const;
export type Origin = (typeof ORIGINS)[number];
export const WRITERS = ["dorothy", "user", "review", "repo"] as const;
export type Writer = (typeof WRITERS)[number];

export const FACT_LIMITS = {
    name: 64,
    title: 60,
    description: 160,
    why: 160,
    body: 8000,
} as const;
export const FACT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXTRA_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export type Extra = string | number | boolean;
export type FactProvenance = {
    origin: Origin;
    by: Writer;
    at: string;
    created: string;
    model?: string;
    from?: string;
};
export type Retired = { at: string; by: Writer; why: string };
export type Fact = {
    name: string;
    title: string;
    description: string;
    type: FactType;
    // metadata's keys besides type, as they were written.
    extra: Record<string, Extra>;
    tags: string[];
    importance: number | null;
    provenance: FactProvenance;
    retired: Retired | null;
    body: string;
};
export type FactRead =
    | { kind: "ok"; fact: Fact }
    | { kind: "unparseable"; reason: string };

// Why a fact cannot be read; thrown by the readers below, caught by
// whoever called them.
export class Problem extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// Controls but tab and newline, and the format characters text can hide
// instructions in: zero widths, bidirectional overrides, tags.
const HIDDEN = /(?![\t\n])[\p{Cc}\p{Cf}]/u;

export function hiddenCharacter(text: string): string | null {
    const found = HIDDEN.exec(text)?.[0];
    return found === undefined
        ? null
        : `U+${(found.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")}`;
}

// The frontmatter between the opening --- and the first line that is
// only ---, and the body after it.
export function splitFrontmatter(
    text: string,
): { yaml: string; body: string } | null {
    const whole = text.endsWith("\n") ? text : `${text}\n`;
    if (!whole.startsWith("---\n")) {
        return null;
    }
    const end = whole.indexOf("\n---\n", 3);
    if (end === -1) {
        return null;
    }
    return {
        yaml: whole.slice(4, end + 1),
        body: whole.slice(end + 5).replace(/^\n+/, "").trimEnd(),
    };
}

// Words onto lines of at most width code points; a longer word keeps a
// line of its own. Text is normalised first, so no line begins with a
// space and folding gives the text back.
export function wrap(text: string, width: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
        if (line === "") {
            line = word;
        } else if (characters(line) + 1 + characters(word) <= width) {
            line += ` ${word}`;
        } else {
            lines.push(line);
            line = word;
        }
    }
    lines.push(line);
    return lines;
}

// Free text as a chomped folded block scalar: always a string, never
// escaped.
export const folded = (key: string, text: string, indent = ""): string[] => [
    `${indent}${key}: >-`,
    ...wrap(text, 80 - indent.length - 2).map((line) => `${indent}  ${line}`),
];

const json = (value: Extra) => JSON.stringify(value);

export function renderFact(fact: Fact): string {
    const { provenance, retired } = fact;
    return [
        "---",
        `name: ${fact.name}`,
        ...folded("title", fact.title),
        ...folded("description", fact.description),
        "metadata:",
        `  type: ${fact.type}`,
        ...Object.entries(fact.extra).map(
            ([key, value]) => `  ${key}: ${json(value)}`,
        ),
        ...(fact.tags.length === 0
            ? []
            : ["tags:", ...fact.tags.map((id) => `  - ${id}`)]),
        ...(fact.importance === null ? [] : [`importance: ${fact.importance}`]),
        "provenance:",
        `  origin: ${provenance.origin}`,
        `  by: ${provenance.by}`,
        `  at: ${json(provenance.at)}`,
        `  created: ${json(provenance.created)}`,
        ...(provenance.model === undefined
            ? []
            : [`  model: ${json(provenance.model)}`]),
        ...(provenance.from === undefined
            ? []
            : [`  from: ${json(provenance.from)}`]),
        ...(retired === null
            ? []
            : [
                  "retired:",
                  `  at: ${json(retired.at)}`,
                  `  by: ${retired.by}`,
                  ...folded("why", retired.why, "  "),
              ]),
        "---",
        "",
        fact.body,
        "",
    ].join("\n");
}

function text(value: unknown, key: string, limit: number): string {
    if (typeof value !== "string") {
        throw new Problem(`${key} is not text`);
    }
    const normal = normalise(value);
    if (normal === "") {
        throw new Problem(`${key} is empty`);
    }
    if (characters(normal) > limit) {
        throw new Problem(
            `${key} is ${characters(normal)} characters, over ${limit}`,
        );
    }
    return normal;
}

function oneOf<T extends string>(
    value: unknown,
    key: string,
    set: readonly T[],
): T {
    if (typeof value !== "string" || !(set as readonly string[]).includes(value)) {
        throw new Problem(`${key} is not one of ${set.join(", ")}`);
    }
    return value as T;
}

function time(value: unknown, key: string): string {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
        throw new Problem(`${key} is not a time`);
    }
    return value;
}

function only(
    record: Record<string, unknown>,
    keys: readonly string[],
    where: string,
): void {
    const unknown = Object.keys(record).find((key) => !keys.includes(key));
    if (unknown !== undefined) {
        throw new Problem(`${where} has an unknown key, ${unknown}`);
    }
}

const LINK = /\]\(([^)\s]*\.md(?:#[^)\s]*)?)\)/g;
const SIBLING = /^\.\/[a-z0-9]+(?:-[a-z0-9]+)*\.md(?:#[^)\s]*)?$/;

export function checkBody(body: string): string {
    if (characters(body) > FACT_LIMITS.body) {
        throw new Problem(
            `its body is ${characters(body)} characters, over ${FACT_LIMITS.body}`,
        );
    }
    for (const [, target] of body.matchAll(LINK)) {
        if (!SIBLING.test(target as string)) {
            throw new Problem(`it links to ${target}, not a fact beside it`);
        }
    }
    return body;
}

// What every fact has, in the store and in a repository.
export function readCommon(
    data: Record<string, unknown>,
    body: string,
    stem?: string,
): Pick<Fact, "name" | "description" | "type" | "extra" | "body"> {
    const { name, metadata } = data;
    if (
        typeof name !== "string" ||
        !FACT_NAME.test(name) ||
        name.length > FACT_LIMITS.name
    ) {
        throw new Problem("name is not a fact's name");
    }
    if (stem !== undefined && name !== stem) {
        throw new Problem(`its name is ${name}, not its file's, ${stem}`);
    }
    if (!isRecord(metadata)) {
        throw new Problem("metadata is not a mapping");
    }
    const type = oneOf(metadata.type, "metadata.type", FACT_TYPES);
    const extra: Record<string, Extra> = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (key === "type") {
            continue;
        }
        if (
            !EXTRA_KEY.test(key) ||
            !(
                typeof value === "string" ||
                typeof value === "boolean" ||
                (typeof value === "number" && Number.isFinite(value))
            )
        ) {
            throw new Problem(`metadata.${key} is not text, a number or a boolean`);
        }
        extra[key] = value;
    }
    return {
        name,
        description: text(data.description, "description", FACT_LIMITS.description),
        type,
        extra,
        body: checkBody(body),
    };
}

const FROM = /^([a-z]+(?:-[a-z]+){3})(?:#[1-9][0-9]*)?$/;

function readProvenance(value: unknown): FactProvenance {
    if (!isRecord(value)) {
        throw new Problem("provenance is not a mapping");
    }
    only(value, ["origin", "by", "at", "created", "model", "from"], "provenance");
    const provenance: FactProvenance = {
        origin: oneOf(value.origin, "provenance.origin", ORIGINS),
        by: oneOf(value.by, "provenance.by", WRITERS),
        at: time(value.at, "provenance.at"),
        created: time(value.created, "provenance.created"),
    };
    if (value.model !== undefined) {
        if (typeof value.model !== "string" || value.model === "") {
            throw new Problem("provenance.model is not text");
        }
        provenance.model = value.model;
    }
    if (value.from !== undefined) {
        const phrase =
            typeof value.from === "string" ? FROM.exec(value.from)?.[1] : undefined;
        if (phrase === undefined || !isPhrase(phrase)) {
            throw new Problem("provenance.from is not a conversation");
        }
        provenance.from = value.from as string;
    }
    return provenance;
}

function readRetired(value: unknown): Retired | null {
    if (value === undefined) {
        return null;
    }
    if (!isRecord(value)) {
        throw new Problem("retired is not a mapping");
    }
    only(value, ["at", "by", "why"], "retired");
    return {
        at: time(value.at, "retired.at"),
        by: oneOf(value.by, "retired.by", WRITERS),
        why: text(value.why, "retired.why", FACT_LIMITS.why),
    };
}

const STORE_KEYS = [
    "name",
    "title",
    "description",
    "metadata",
    "tags",
    "importance",
    "provenance",
    "retired",
] as const;

// The frontmatter as YAML, checked for hidden characters first.
export function frontmatterOf(source: string): {
    data: Record<string, unknown>;
    body: string;
} {
    const text = source.replaceAll("\r\n", "\n");
    const hidden = hiddenCharacter(text);
    if (hidden !== null) {
        throw new Problem(`it holds a hidden character, ${hidden}`);
    }
    const parts = splitFrontmatter(text);
    if (parts === null) {
        throw new Problem("it has no frontmatter");
    }
    let data: unknown;
    try {
        data = Bun.YAML.parse(parts.yaml);
    } catch (error) {
        throw new Problem(
            `its frontmatter is not YAML (${error instanceof Error ? error.message : String(error)})`,
        );
    }
    if (!isRecord(data)) {
        throw new Problem("its frontmatter is not a mapping");
    }
    return { data, body: parts.body };
}

function readFact(
    source: string,
    stem: string | undefined,
    provenanceOf: (value: unknown) => FactProvenance,
): Fact {
    const { data, body } = frontmatterOf(source);
    only(data, STORE_KEYS, "its frontmatter");
    const tags = data.tags ?? [];
    if (
        !Array.isArray(tags) ||
        !tags.every((id) => typeof id === "string" && CONCEPT_ID.test(id))
    ) {
        throw new Problem("tags are not concept ids");
    }
    const importance = data.importance ?? null;
    if (
        importance !== null &&
        !(
            typeof importance === "number" &&
            Number.isInteger(importance) &&
            importance >= 1 &&
            importance <= 10
        )
    ) {
        throw new Problem("importance is not a whole number from 1 to 10");
    }
    const common = readCommon(data, body, stem);
    return {
        name: common.name,
        title: text(data.title, "title", FACT_LIMITS.title),
        description: common.description,
        type: common.type,
        extra: common.extra,
        tags: tags as string[],
        importance: importance as number | null,
        provenance: provenanceOf(data.provenance),
        retired: readRetired(data.retired),
        body: common.body,
    };
}

export function parseFact(source: string, stem?: string): FactRead {
    try {
        return { kind: "ok", fact: readFact(source, stem, readProvenance) };
    } catch (error) {
        if (error instanceof Problem) {
            return { kind: "unparseable", reason: error.message };
        }
        throw error;
    }
}

// A fact the user added or edited by hand, rewritten as Dorothy writes
// one and made the user's; null when it is no fact. It may omit
// provenance, which a hand-added fact has none of.
export function handEdited(
    source: string,
    stem: string,
    now: Date,
): string | null {
    const at = now.toISOString();
    try {
        const fact = readFact(source, stem, (value) => {
            const before = value === undefined ? null : readProvenance(value);
            return {
                origin: "user",
                by: "user",
                at,
                created: before?.created ?? at,
                ...(before?.from === undefined ? {} : { from: before.from }),
            };
        });
        return renderFact(fact);
    } catch (error) {
        if (error instanceof Problem) {
            return null;
        }
        throw error;
    }
}

// A later version may lower a fact's origin; only one the user writes
// raises it, to the user's.
export function nextOrigin(
    previous: Origin | null,
    written: Origin,
    by: Writer,
): Origin {
    if (by === "user") {
        return "user";
    }
    if (previous === null) {
        return written;
    }
    return ORIGINS.indexOf(written) < ORIGINS.indexOf(previous)
        ? written
        : previous;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `bun test packages/memory/src/facts/file.test.ts`
Expected: PASS. If the property test fails, the printed fact shows the
text that did not survive: fix `wrap`, `folded` or the normalisation it
names, never the test's alphabet.

- [ ] **Step 5: Write Ruling 1 into the spec**

In `docs/specs/2026-10-15-memory-store-design.md`, replace the bullet
that begins "The body is at most 2,000 characters" with:

```markdown
- The body is at most 8,000 characters: this repository's own memory
  has a fact of 2,638. Dorothy writes lines of at most 80, but the lint
  does not require it, so a repository's own style imports.
```

Run: `bunx remark --frail --quiet --no-stdout docs/specs/2026-10-15-memory-store-design.md`
Expected: no output, exit 0.

- [ ] **Step 6: Run the checks and commit**

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: PASS. (`bunx biome format --write packages/memory/src/facts`
fixes formatting.)

```bash
git add packages/memory/src/facts docs/specs/2026-10-15-memory-store-design.md
git commit -m "feat(memory): Read and write facts without traps" \
  -m "A fact is Markdown with frontmatter in one canonical form: free text
in normalised >- blocks, closed sets plain, the rest as JSON. Every
value is checked for its type once read, hidden characters are refused
and a fact's body may be 8,000 characters."
```

---

### Task 3: The store's facts

**Files:**

- Create: `packages/memory/src/facts/store.ts`
- Create: `packages/memory/src/facts/store.test.ts`

**Interfaces:**

- Consumes: Task 2's `Fact`, `FactRead`, `FactType`, `Origin`, `Writer`,
  `FACT_NAME`, `nextOrigin`, `parseFact`, `renderFact`; `writeAtomic`,
  `normalise`, `Lock`, `Recorder` from `../memory/sidecar.js`;
  `transcriptDir` from `../transcript.js`.
- Produces: `type Scope = { kind: "personal" } | { kind: "project"; id:
  string }`, `PERSONAL`, `PROJECT_ID`, `isProjectId(id)`,
  `dataRoot(env?)`, `scopeDir(root, scope)`, `factPath(root, scope,
  name)`, `scopeLabel(scope)`, `parseTarget(target): { scope; name } |
  null`, `type FactFile = { scope; name; path }`, `factFiles(root,
  scope?)`, `readFactFile(path, name): Promise<FactRead | { kind: "none"
  }>`, `type StoredFact = { scope; path; fact }`, `listFacts(root,
  scope?): Promise<{ facts: StoredFact[]; broken: { path; reason }[] }>`,
  `putFact(root, scope, fact): Promise<string>`, `type FactStore = {
  root; lock; recorder; now? }`, `type FactInput`, `type FactResult`,
  `writeFact`, `moveFact`, `retireFact`, `reviveFact`, `retireFacts`.

- [ ] **Step 1: Write the failing tests**

`packages/memory/src/facts/store.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFact } from "./file.js";
import {
    type FactInput,
    type FactStore,
    factFiles,
    factPath,
    listFacts,
    moveFact,
    PERSONAL,
    parseTarget,
    retireFact,
    retireFacts,
    reviveFact,
    type Scope,
    writeFact,
} from "./store.js";

const NOW = new Date("2026-10-15T09:30:00.000Z");
const LATER = new Date("2026-10-16T09:30:00.000Z");
const PHRASE = "bingo-overabundance-mazer-kasha";
const OTHER = "anabolic-gat-sangh-autodidact";
const PROJECT: Scope = { kind: "project", id: "github.com/chewygumxx/dorothy" };

let root = "";
let commits: { paths: string[]; message: string }[] = [];
let clock = NOW;
const store = (): FactStore => ({
    root,
    lock: (work) => work(),
    recorder: async (paths, message) => {
        commits.push({ paths: [...paths], message });
    },
    now: () => clock,
});
const input = (fields: Partial<FactInput> = {}): FactInput => ({
    scope: PERSONAL,
    name: "likes-tea",
    title: "Likes tea",
    description: "Prefers tea to coffee.",
    type: "user",
    body: "Asked for tea twice.",
    origin: "user",
    by: "dorothy",
    ...fields,
});

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dorothy-facts-"));
    commits = [];
    clock = NOW;
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

const read = async (scope: Scope, name: string) => {
    const result = parseFact(
        await readFile(factPath(root, scope, name), "utf8"),
        name,
    );
    if (result.kind !== "ok") {
        throw new Error(result.reason);
    }
    return result.fact;
};

describe("writeFact", () => {
    it("writes a personal fact and records it", async () => {
        const result = await writeFact(store(), input());
        expect(result.kind).toBe("written");
        expect(factPath(root, PERSONAL, "likes-tea")).toBe(
            join(root, "facts", "personal", "likes-tea.md"),
        );
        expect(await read(PERSONAL, "likes-tea")).toMatchObject({
            title: "Likes tea",
            provenance: { origin: "user", by: "dorothy", at: NOW.toISOString() },
            retired: null,
        });
        expect(commits).toEqual([
            {
                paths: [factPath(root, PERSONAL, "likes-tea")],
                message: "fact: personal/likes-tea",
            },
        ]);
    });

    it("writes a project's fact under its id", async () => {
        await writeFact(store(), input({ scope: PROJECT, type: "project" }));
        expect(factPath(root, PROJECT, "likes-tea")).toBe(
            join(root, "facts", "projects", "github.com", "chewygumxx", "dorothy", "likes-tea.md"),
        );
        expect((await read(PROJECT, "likes-tea")).type).toBe("project");
    });

    it("keeps creation, metadata and tags, and lowers the origin", async () => {
        await writeFact(store(), input({ tags: ["k1a2b3c4d"], importance: 6 }));
        clock = LATER;
        await writeFact(
            store(),
            input({ description: "Tea, always.", origin: "external", by: "review" }),
        );
        expect(await read(PERSONAL, "likes-tea")).toMatchObject({
            description: "Tea, always.",
            tags: ["k1a2b3c4d"],
            importance: 6,
            provenance: {
                origin: "external",
                by: "review",
                at: LATER.toISOString(),
                created: NOW.toISOString(),
            },
        });
        await writeFact(store(), input({ origin: "dorothy", by: "dorothy" }));
        expect((await read(PERSONAL, "likes-tea")).provenance.origin).toBe(
            "external",
        );
        await writeFact(store(), input({ origin: "dorothy", by: "user" }));
        expect((await read(PERSONAL, "likes-tea")).provenance.origin).toBe(
            "user",
        );
    });

    it("revives a retired fact it writes again", async () => {
        await writeFact(store(), input());
        await retireFact(store(), { scope: PERSONAL, name: "likes-tea" }, {
            by: "user",
            why: "Not true.",
        });
        await writeFact(store(), input());
        expect((await read(PERSONAL, "likes-tea")).retired).toBeNull();
    });

    it("refuses a name that is not a fact's, and writes nothing", async () => {
        const result = await writeFact(store(), input({ name: "../escape" }));
        expect(result).toEqual({
            kind: "failed",
            reason: "../escape is not a fact's name",
        });
        expect(await factFiles(root)).toEqual([]);
        expect(commits).toEqual([]);
    });

    it("refuses to write over a fact that is broken", async () => {
        const path = factPath(root, PERSONAL, "likes-tea");
        await mkdir(join(root, "facts", "personal"), { recursive: true });
        await writeFile(path, "not a fact\n");
        const result = await writeFact(store(), input());
        expect(result).toEqual({
            kind: "failed",
            reason: "it is broken: it has no frontmatter",
        });
        expect(await readFile(path, "utf8")).toBe("not a fact\n");
    });
});

describe("moveFact", () => {
    it("moves a fact to another scope in one commit, provenance and all", async () => {
        await writeFact(store(), input());
        commits = [];
        const result = await moveFact(store(), { scope: PERSONAL, name: "likes-tea" }, PROJECT);
        expect(result.kind).toBe("written");
        expect((await read(PROJECT, "likes-tea")).provenance.created).toBe(
            NOW.toISOString(),
        );
        expect(await factFiles(root, PERSONAL)).toEqual([]);
        expect(commits).toEqual([
            {
                paths: [
                    factPath(root, PERSONAL, "likes-tea"),
                    factPath(root, PROJECT, "likes-tea"),
                ],
                message: "move: personal/likes-tea to github.com/chewygumxx/dorothy",
            },
        ]);
    });

    it("refuses to move over a fact already there", async () => {
        await writeFact(store(), input());
        await writeFact(store(), input({ scope: PROJECT }));
        expect(
            await moveFact(store(), { scope: PERSONAL, name: "likes-tea" }, PROJECT),
        ).toEqual({
            kind: "failed",
            reason: "there is already a fact github.com/chewygumxx/dorothy/likes-tea",
        });
    });
});

describe("retiring", () => {
    it("retires a fact in place, so it is still listed and read", async () => {
        await writeFact(store(), input());
        const result = await retireFact(
            store(),
            { scope: PERSONAL, name: "likes-tea" },
            { by: "user", why: "  No longer  true. " },
        );
        expect(result.kind).toBe("written");
        expect((await read(PERSONAL, "likes-tea")).retired).toEqual({
            at: NOW.toISOString(),
            by: "user",
            why: "No longer true.",
        });
        const { facts } = await listFacts(root);
        expect(facts.map(({ fact }) => fact.name)).toEqual(["likes-tea"]);
        expect(commits.at(-1)?.message).toBe("retire: personal/likes-tea");
    });

    it("says when a fact is retired already, or missing", async () => {
        await writeFact(store(), input());
        const target = { scope: PERSONAL, name: "likes-tea" };
        const why = { by: "user" as const, why: "x" };
        await retireFact(store(), target, why);
        expect((await retireFact(store(), target, why)).kind).toBe("unchanged");
        expect(
            (await retireFact(store(), { scope: PERSONAL, name: "nothing" }, why)).kind,
        ).toBe("missing");
    });

    it("revives a retired fact, and leaves a live one alone", async () => {
        await writeFact(store(), input());
        const target = { scope: PERSONAL, name: "likes-tea" };
        expect((await reviveFact(store(), target)).kind).toBe("unchanged");
        await retireFact(store(), target, { by: "user", why: "x" });
        expect((await reviveFact(store(), target)).kind).toBe("written");
        expect((await read(PERSONAL, "likes-tea")).retired).toBeNull();
        expect(commits.at(-1)?.message).toBe("revive: personal/likes-tea");
    });

    it("retires every live fact one conversation gave, in one commit", async () => {
        await writeFact(store(), input({ name: "a", from: `${PHRASE}#3` }));
        await writeFact(store(), input({ name: "b", from: PHRASE, scope: PROJECT }));
        await writeFact(store(), input({ name: "c", from: `${OTHER}#1` }));
        await writeFact(store(), input({ name: "d" }));
        commits = [];
        const result = await retireFacts(store(), PHRASE, {
            by: "user",
            why: "That conversation was wrong.",
        });
        expect(result).toEqual({
            kind: "done",
            retired: ["personal/a", "github.com/chewygumxx/dorothy/b"],
        });
        expect(commits).toHaveLength(1);
        expect(commits[0]?.message).toBe(`retire: 2 facts from ${PHRASE}`);
        expect((await read(PERSONAL, "c")).retired).toBeNull();
    });
});

describe("listFacts", () => {
    it("lists personal facts first, then each project's, and names broken ones", async () => {
        await writeFact(store(), input({ name: "b", scope: PROJECT }));
        await writeFact(store(), input({ name: "a" }));
        await writeFile(join(root, "facts", "personal", "z.md"), "broken\n");
        const { facts, broken } = await listFacts(root);
        expect(facts.map(({ scope, fact }) => [scope, fact.name])).toEqual([
            [PERSONAL, "a"],
            [PROJECT, "b"],
        ]);
        expect(broken).toEqual([
            {
                path: join(root, "facts", "personal", "z.md"),
                reason: "it has no frontmatter",
            },
        ]);
    });

    it("ignores symlinks, files that are not facts, and files outside a scope", async () => {
        await writeFact(store(), input());
        const outside = join(root, "outside.md");
        await writeFile(outside, "x\n");
        await symlink(outside, join(root, "facts", "personal", "linked.md"));
        await writeFile(join(root, "facts", "personal", "notes.txt"), "x\n");
        await mkdir(join(root, "facts", "projects"), { recursive: true });
        await writeFile(join(root, "facts", "projects", "loose.md"), "x\n");
        expect((await factFiles(root)).map(({ name }) => name)).toEqual([
            "likes-tea",
        ]);
    });
});

describe("parseTarget", () => {
    it("reads personal/<name> and <project id>/<name>", () => {
        expect(parseTarget("personal/likes-tea")).toEqual({
            scope: PERSONAL,
            name: "likes-tea",
        });
        expect(parseTarget("github.com/chewygumxx/dorothy/likes-tea")).toEqual({
            scope: PROJECT,
            name: "likes-tea",
        });
        expect(parseTarget("local-0123456789ab/x")).toEqual({
            scope: { kind: "project", id: "local-0123456789ab" },
            name: "x",
        });
    });

    it.each(["likes-tea", "personal/", "/x", "personal/Bad", "host/../x/y", "github.com/x"])(
        "refuses %p",
        (target) => {
            expect(parseTarget(target)).toBeNull();
        },
    );
});
```

`github.com/x` is refused because `github.com` alone is no project id:
an id has a host and at least one path segment.

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/memory/src/facts/store.test.ts`
Expected: FAIL, `Cannot find module './store.js'`.

- [ ] **Step 3: Write `facts/store.ts`**

```ts
// The store's facts: personal ones in facts/personal/, a project's in
// facts/projects/<id>/, one file each. Writes take the store's lock and
// are recorded by history. Nothing here deletes a fact: a fact that no
// longer serves is retired, and stays.

import { readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { Env } from "@dorothy/core";
import {
    type Lock,
    normalise,
    type Recorder,
    writeAtomic,
} from "../memory/sidecar.js";
import { transcriptDir } from "../transcript.js";
import {
    FACT_NAME,
    type Fact,
    type FactRead,
    type FactType,
    nextOrigin,
    type Origin,
    parseFact,
    renderFact,
    type Writer,
} from "./file.js";

export type Scope = { kind: "personal" } | { kind: "project"; id: string };
export const PERSONAL: Scope = Object.freeze({ kind: "personal" });

// local- and 12 hex digits, or a host and at least one path segment, as
// projects/identify.ts makes them.
export const PROJECT_ID =
    /^(?:local-[0-9a-f]{12}|[a-z0-9.-]+(?:\/[A-Za-z0-9._~-]+)+)$/;
export const isProjectId = (id: string) =>
    PROJECT_ID.test(id) &&
    !id.split("/").some((part) => part === "." || part === "..");

// The data directory: transcripts/, tags.json, facts/ and projects.json.
export const dataRoot = (env: Env = process.env) => dirname(transcriptDir(env));

export function scopeDir(root: string, scope: Scope): string {
    if (scope.kind === "personal") {
        return join(root, "facts", "personal");
    }
    if (!isProjectId(scope.id)) {
        throw new Error(`${scope.id} is not a project id`);
    }
    return join(root, "facts", "projects", ...scope.id.split("/"));
}

export const factPath = (root: string, scope: Scope, name: string) =>
    join(scopeDir(root, scope), `${name}.md`);

export const scopeLabel = (scope: Scope) =>
    scope.kind === "personal" ? "personal" : scope.id;

// personal/<name> or <project id>/<name>, as the commands take them.
export function parseTarget(
    target: string,
): { scope: Scope; name: string } | null {
    const at = target.lastIndexOf("/");
    const label = target.slice(0, at);
    const name = target.slice(at + 1);
    if (at <= 0 || !FACT_NAME.test(name)) {
        return null;
    }
    if (label === "personal") {
        return { scope: PERSONAL, name };
    }
    return isProjectId(label) ? { scope: { kind: "project", id: label }, name } : null;
}

export type FactFile = { scope: Scope; name: string; path: string };

const codeOf = (error: unknown) => (error as { code?: unknown }).code;
const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

async function entries(dir: string) {
    try {
        return await readdir(dir, { withFileTypes: true });
    } catch (error) {
        if (codeOf(error) === "ENOENT") {
            return [];
        }
        throw error;
    }
}

const factName = (file: string) =>
    file.endsWith(".md") && FACT_NAME.test(file.slice(0, -3))
        ? file.slice(0, -3)
        : null;

// Every fact file, or one scope's, personal first, then by project and
// name. Symlinks are never followed.
export async function factFiles(root: string, scope?: Scope): Promise<FactFile[]> {
    const files: FactFile[] = [];
    const inScope = async (dir: string, of: Scope) => {
        for (const entry of await entries(dir)) {
            const name = entry.isFile() ? factName(entry.name) : null;
            if (name !== null) {
                files.push({ scope: of, name, path: join(dir, entry.name) });
            }
        }
    };
    const projects = join(root, "facts", "projects");
    const walk = async (dir: string): Promise<void> => {
        const id = relative(projects, dir).split(sep).join("/");
        if (id !== "" && isProjectId(id)) {
            await inScope(dir, { kind: "project", id });
        }
        for (const entry of await entries(dir)) {
            if (entry.isDirectory()) {
                await walk(join(dir, entry.name));
            }
        }
    };
    if (scope !== undefined) {
        await inScope(scopeDir(root, scope), scope);
    } else {
        await inScope(scopeDir(root, PERSONAL), PERSONAL);
        await walk(projects);
    }
    const key = (file: FactFile) =>
        `${file.scope.kind === "personal" ? "" : file.scope.id}\u0000${file.name}`;
    return files.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

export async function readFactFile(
    path: string,
    name: string,
): Promise<FactRead | { kind: "none" }> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        if (codeOf(error) === "ENOENT") {
            return { kind: "none" };
        }
        return { kind: "unparseable", reason: describeError(error) };
    }
    return parseFact(text, name);
}

export type StoredFact = { scope: Scope; path: string; fact: Fact };

export async function listFacts(
    root: string,
    scope?: Scope,
): Promise<{ facts: StoredFact[]; broken: { path: string; reason: string }[] }> {
    const facts: StoredFact[] = [];
    const broken: { path: string; reason: string }[] = [];
    for (const file of await factFiles(root, scope)) {
        const read = await readFactFile(file.path, file.name);
        if (read.kind === "ok") {
            facts.push({ scope: file.scope, path: file.path, fact: read.fact });
        } else if (read.kind === "unparseable") {
            broken.push({ path: file.path, reason: read.reason });
        }
    }
    return { facts, broken };
}

// Writes a fact where it belongs once it reads back as written. The
// caller holds the lock and records the path.
export async function putFact(root: string, scope: Scope, fact: Fact): Promise<string> {
    const text = renderFact(fact);
    const read = parseFact(text, fact.name);
    if (read.kind !== "ok") {
        throw new Error(`${scopeLabel(scope)}/${fact.name}: ${read.reason}`);
    }
    const path = factPath(root, scope, fact.name);
    await writeAtomic(path, text);
    return path;
}

export type FactStore = {
    root: string;
    lock: Lock;
    recorder: Recorder | null;
    now?: () => Date;
};

export type FactInput = {
    scope: Scope;
    name: string;
    title: string;
    description: string;
    type: FactType;
    body: string;
    origin: Origin;
    by: Writer;
    tags?: string[];
    importance?: number | null;
    model?: string;
    from?: string;
};

export type FactResult =
    | { kind: "written"; fact: Fact }
    | { kind: "unchanged" }
    | { kind: "missing" }
    | { kind: "failed"; reason: string };

type Target = { scope: Scope; name: string };

const at = (store: FactStore) => (store.now?.() ?? new Date()).toISOString();
const label = ({ scope, name }: Target) => `${scopeLabel(scope)}/${name}`;

// Runs work under the store's lock; a throw becomes a failure.
function held<T>(
    store: FactStore,
    work: () => Promise<T>,
): Promise<T | { kind: "failed"; reason: string }> {
    return store
        .lock(work)
        .catch((error: unknown) => ({ kind: "failed" as const, reason: describeError(error) }));
}

async function existing(
    store: FactStore,
    target: Target,
): Promise<{ path: string; fact: Fact | null } | { kind: "failed"; reason: string }> {
    if (!FACT_NAME.test(target.name)) {
        return { kind: "failed", reason: `${target.name} is not a fact's name` };
    }
    const path = factPath(store.root, target.scope, target.name);
    const read = await readFactFile(path, target.name);
    if (read.kind === "unparseable") {
        return { kind: "failed", reason: `it is broken: ${read.reason}` };
    }
    return { path, fact: read.kind === "ok" ? read.fact : null };
}

export function writeFact(store: FactStore, input: FactInput): Promise<FactResult> {
    return held(store, async (): Promise<FactResult> => {
        const found = await existing(store, input);
        if ("kind" in found) {
            return found;
        }
        const before = found.fact;
        const now = at(store);
        const fact: Fact = {
            name: input.name,
            title: normalise(input.title),
            description: normalise(input.description),
            type: input.type,
            extra: before?.extra ?? {},
            tags: input.tags ?? before?.tags ?? [],
            importance:
                input.importance === undefined
                    ? (before?.importance ?? null)
                    : input.importance,
            provenance: {
                origin: nextOrigin(before?.provenance.origin ?? null, input.origin, input.by),
                by: input.by,
                at: now,
                created: before?.provenance.created ?? now,
                ...(input.model === undefined ? {} : { model: input.model }),
                ...(input.from === undefined ? {} : { from: input.from }),
            },
            retired: null,
            body: input.body.trim(),
        };
        const path = await putFact(store.root, input.scope, fact);
        await store.recorder?.([path], `fact: ${label(input)}`);
        return { kind: "written", fact };
    });
}

export function moveFact(store: FactStore, from: Target, to: Scope): Promise<FactResult> {
    return held(store, async (): Promise<FactResult> => {
        const found = await existing(store, from);
        if ("kind" in found) {
            return found;
        }
        if (found.fact === null) {
            return { kind: "missing" };
        }
        const there = await existing(store, { scope: to, name: from.name });
        if ("kind" in there) {
            return there;
        }
        if (there.fact !== null) {
            return {
                kind: "failed",
                reason: `there is already a fact ${label({ scope: to, name: from.name })}`,
            };
        }
        const path = await putFact(store.root, to, found.fact);
        await rm(found.path);
        await store.recorder?.(
            [found.path, path],
            `move: ${label(from)} to ${scopeLabel(to)}`,
        );
        return { kind: "written", fact: found.fact };
    });
}

export function retireFact(
    store: FactStore,
    target: Target,
    { by, why }: { by: Writer; why: string },
): Promise<FactResult> {
    return held(store, async (): Promise<FactResult> => {
        const found = await existing(store, target);
        if ("kind" in found) {
            return found;
        }
        if (found.fact === null) {
            return { kind: "missing" };
        }
        if (found.fact.retired !== null) {
            return { kind: "unchanged" };
        }
        const fact = { ...found.fact, retired: { at: at(store), by, why: normalise(why) } };
        const path = await putFact(store.root, target.scope, fact);
        await store.recorder?.([path], `retire: ${label(target)}`);
        return { kind: "written", fact };
    });
}

export function reviveFact(store: FactStore, target: Target): Promise<FactResult> {
    return held(store, async (): Promise<FactResult> => {
        const found = await existing(store, target);
        if ("kind" in found) {
            return found;
        }
        if (found.fact === null) {
            return { kind: "missing" };
        }
        if (found.fact.retired === null) {
            return { kind: "unchanged" };
        }
        const fact = { ...found.fact, retired: null };
        const path = await putFact(store.root, target.scope, fact);
        await store.recorder?.([path], `revive: ${label(target)}`);
        return { kind: "written", fact };
    });
}

// Every live fact whose provenance names the conversation, retired in one
// commit, for when a conversation turns out to have been wrong.
export function retireFacts(
    store: FactStore,
    phrase: string,
    { by, why }: { by: Writer; why: string },
): Promise<{ kind: "done"; retired: string[] } | { kind: "failed"; reason: string }> {
    return held(store, async () => {
        const { facts } = await listFacts(store.root);
        const paths: string[] = [];
        const retired: string[] = [];
        const now = at(store);
        for (const { scope, fact } of facts) {
            if (fact.retired !== null || fact.provenance.from?.split("#")[0] !== phrase) {
                continue;
            }
            const next = { ...fact, retired: { at: now, by, why: normalise(why) } };
            paths.push(await putFact(store.root, scope, next));
            retired.push(label({ scope, name: fact.name }));
        }
        if (paths.length > 0) {
            await store.recorder?.(
                paths,
                `retire: ${paths.length} ${paths.length === 1 ? "fact" : "facts"} from ${phrase}`,
            );
        }
        return { kind: "done" as const, retired };
    });
}
```

`writeFact` takes the `Target` shape from its input, as `FactInput` has
`scope` and `name`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `bun test packages/memory/src/facts/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the checks and commit**

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: PASS (`bunx biome format --write packages/memory/src/facts`
first if format fails).

```bash
git add packages/memory/src/facts/store.ts packages/memory/src/facts/store.test.ts
git commit -m "feat(memory): Keep facts, personal or a project's" \
  -m "Facts are written, moved, retired and revived under the store's lock
and recorded by history; a retired fact stays where it is, listed and
read, and nothing deletes one."
```

---

### Task 4: Projects and their registry

**Files:**

- Create: `packages/memory/src/projects/identify.ts`
- Create: `packages/memory/src/projects/identify.test.ts`
- Create: `packages/memory/src/projects/registry.ts`
- Create: `packages/memory/src/projects/registry.test.ts`

**Interfaces:**

- Consumes: `PROJECT_ID`, `isProjectId` from `../facts/store.js`;
  `FACT_NAME` from `../facts/file.js`; `writeAtomic` from
  `../memory/sidecar.js`.
- Produces: in `identify.ts`: `type Project = { root: string; id:
  string; name: string }`, `normaliseRemote(url): string | null`,
  `localId(root): string`, `originUrl(config): string | null`,
  `identify(path): Promise<Project | null>`. In `registry.ts`: `type
  ProjectEntry = { name; roots: string[]; memoryDir; synced: Record<string,
  string> }`, `type Registry = { v: 1; projects: Record<string,
  ProjectEntry> }`, `EMPTY_REGISTRY`, `projectsPath(root)`, `type
  RegistryRead`, `parseRegistry(text)`, `readRegistry(path)`,
  `writeRegistry(path, registry)`, `memoryDirProblem(dir): string |
  null`, `chooseMemoryDir(root): Promise<string>`,
  `withProject(registry, project, memoryDir, synced): Registry`.

- [ ] **Step 1: Write the failing identify tests**

`packages/memory/src/projects/identify.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identify, localId, normaliseRemote, originUrl } from "./identify.js";

const ID = "github.com/chewygumxx/dorothy";

describe("normaliseRemote", () => {
    it.each([
        ["git@github.com:chewygumxx/dorothy.git", ID],
        ["https://github.com/chewygumxx/dorothy.git", ID],
        ["https://GitHub.com/chewygumxx/dorothy", ID],
        ["ssh://git@github.com:22/chewygumxx/dorothy.git/", ID],
        ["git://github.com/chewygumxx/dorothy", ID],
        ["https://gitlab.com/group/sub/project.git", "gitlab.com/group/sub/project"],
    ])("reads %p as %p", (url, id) => {
        expect(normaliseRemote(url)).toBe(id);
    });

    it("drops the credentials a URL carries", () => {
        const id = normaliseRemote(
            "https://chewygumxx:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/chewygumxx/dorothy.git",
        );
        expect(id).toBe(ID);
    });

    it.each([
        "/srv/git/dorothy.git",
        "../dorothy",
        "file:///srv/git/dorothy.git",
        "https://github.com/",
        "git@github.com:../../etc",
        "",
    ])("finds no host in %p", (url) => {
        expect(normaliseRemote(url)).toBeNull();
    });
});

describe("originUrl", () => {
    it("reads the origin's url and no other remote's", () => {
        const config = [
            "[core]",
            "\tbare = false",
            '[remote "upstream"]',
            "\turl = https://example.com/upstream.git",
            '[remote "origin"]',
            "\t# a comment",
            '\turl = "git@github.com:chewygumxx/dorothy.git" ; trailing',
            "\tfetch = +refs/heads/*:refs/remotes/origin/*",
        ].join("\n");
        expect(originUrl(config)).toBe("git@github.com:chewygumxx/dorothy.git");
    });

    it("gives null with no origin", () => {
        expect(originUrl('[remote "upstream"]\n\turl = x\n')).toBeNull();
    });
});

describe("identify", () => {
    let base = "";
    beforeEach(async () => {
        base = await realpath(await mkdtemp(join(tmpdir(), "dorothy-identify-")));
    });
    afterEach(async () => {
        await rm(base, { recursive: true, force: true });
    });

    const repo = async (dir: string, config: string) => {
        await mkdir(join(dir, ".git"), { recursive: true });
        await writeFile(join(dir, ".git", "config"), config);
    };

    it("finds the repository a path is in, by its origin", async () => {
        const root = join(base, "dorothy");
        await repo(root, '[remote "origin"]\n\turl = git@github.com:chewygumxx/dorothy.git\n');
        await mkdir(join(root, "packages", "memory"), { recursive: true });
        expect(await identify(join(root, "packages", "memory"))).toEqual({
            root,
            id: ID,
            name: "dorothy",
        });
    });

    it("follows a worktree's .git file to the shared config", async () => {
        const main = join(base, "main");
        await repo(main, '[remote "origin"]\n\turl = https://github.com/chewygumxx/dorothy\n');
        const gitdir = join(main, ".git", "worktrees", "wt");
        await mkdir(gitdir, { recursive: true });
        await writeFile(join(gitdir, "commondir"), "../..\n");
        const tree = join(base, "wt");
        await mkdir(tree);
        await writeFile(join(tree, ".git"), `gitdir: ${gitdir}\n`);
        expect((await identify(tree))?.id).toBe(ID);
    });

    it("names a repository with no origin by its root", async () => {
        const root = join(base, "scratch");
        await repo(root, "[core]\n\tbare = false\n");
        expect(await identify(root)).toEqual({
            root,
            id: localId(root),
            name: "scratch",
        });
        expect(localId(root)).toMatch(/^local-[0-9a-f]{12}$/);
    });

    it("gives null outside any repository", async () => {
        expect(await identify(base)).toBeNull();
    });
});
```

`identify(base)` relies on the temporary directory having no `.git`
above it; `/tmp` has none.

- [ ] **Step 2: Write the failing registry tests**

`packages/memory/src/projects/registry.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    chooseMemoryDir,
    EMPTY_REGISTRY,
    memoryDirProblem,
    parseRegistry,
    readRegistry,
    type Registry,
    withProject,
    writeRegistry,
} from "./registry.js";

const ID = "github.com/chewygumxx/dorothy";
const HASH = "a".repeat(64);
const registry = (fields: object = {}): Registry => ({
    v: 1,
    projects: {
        [ID]: {
            name: "dorothy",
            roots: ["/home/u/dev/dorothy"],
            memoryDir: ".agents/memory",
            synced: { "likes-tea": HASH },
            ...fields,
        },
    },
});

describe("parseRegistry", () => {
    it("reads what writeRegistry writes", async () => {
        const dir = await mkdtemp(join(tmpdir(), "dorothy-registry-"));
        try {
            const path = join(dir, "projects.json");
            expect(await readRegistry(path)).toEqual({ kind: "none" });
            await writeRegistry(path, registry());
            expect(await readFile(path, "utf8")).toEndWith("}\n");
            expect(await readRegistry(path)).toEqual({ kind: "ok", registry: registry() });
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it.each([
        ["no version", { projects: {} }],
        ["an id that is none", { v: 1, projects: { "not an id": registry().projects[ID] } }],
        ["a memory directory that escapes", registry({ memoryDir: "../outside" })],
        ["an absolute memory directory", registry({ memoryDir: "/etc" })],
        ["a relative root", registry({ roots: ["dev/dorothy"] })],
        ["a hash that is none", registry({ synced: { "likes-tea": "x" } })],
        ["a synced name that is no fact's", registry({ synced: { "Bad Name": HASH } })],
    ])("refuses %s", (_, value) => {
        expect(parseRegistry(JSON.stringify(value)).kind).toBe("unparseable");
    });
});

describe("memoryDirProblem", () => {
    it("allows a relative path inside the repository, and nothing else", () => {
        expect(memoryDirProblem(".agents/memory")).toBeNull();
        expect(memoryDirProblem("docs/memory")).toBeNull();
        for (const dir of ["", "/etc", "../x", "a/../../x", "./x", "a//b", "a\\b"]) {
            expect(memoryDirProblem(dir)).not.toBeNull();
        }
    });
});

describe("chooseMemoryDir", () => {
    let root = "";
    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "dorothy-choose-"));
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("takes .agents/memory, else .claude/memory, else .agents/memory", async () => {
        expect(await chooseMemoryDir(root)).toBe(".agents/memory");
        await mkdir(join(root, ".claude", "memory"), { recursive: true });
        expect(await chooseMemoryDir(root)).toBe(".claude/memory");
        await mkdir(join(root, ".agents", "memory"), { recursive: true });
        expect(await chooseMemoryDir(root)).toBe(".agents/memory");
    });
});

describe("withProject", () => {
    const project = { root: "/home/u/dev/dorothy", id: ID, name: "dorothy" };

    it("registers a project with its root, memory directory and hashes", () => {
        expect(withProject(EMPTY_REGISTRY, project, ".agents/memory", { b: HASH, a: HASH })).toEqual({
            v: 1,
            projects: {
                [ID]: {
                    name: "dorothy",
                    roots: ["/home/u/dev/dorothy"],
                    memoryDir: ".agents/memory",
                    synced: { a: HASH, b: HASH },
                },
            },
        });
    });

    it("adds a root it has not seen, once", () => {
        const other = { ...project, root: "/home/u/work/dorothy" };
        const once = withProject(registry(), other, ".agents/memory", {});
        const twice = withProject(once, other, ".agents/memory", {});
        expect(twice.projects[ID]?.roots).toEqual([
            "/home/u/dev/dorothy",
            "/home/u/work/dorothy",
        ]);
    });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `bun test packages/memory/src/projects`
Expected: FAIL, the modules do not exist.

- [ ] **Step 4: Write `projects/identify.ts`**

```ts
// Which project a path belongs to: the git repository it is in, named by
// its origin remote. The origin is read from the repository's config
// file rather than from git, so Dorothy needs no git installed and no
// rewrite (insteadOf) in the user's configuration changes an id.

import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { isProjectId } from "../facts/store.js";

export type Project = { root: string; id: string; name: string };

const codeOf = (error: unknown) => (error as { code?: unknown }).code;

// The origin as an id: scheme, user, credentials, port and .git dropped,
// the host lowercased. Null for a remote that names no host, such as a
// local path or a file:// URL.
export function normaliseRemote(url: string): string | null {
    const trimmed = url.trim();
    let host: string;
    let path: string;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
        let parsed: URL;
        try {
            parsed = new URL(trimmed);
        } catch {
            return null;
        }
        if (parsed.protocol === "file:" || parsed.hostname === "") {
            return null;
        }
        host = parsed.hostname;
        path = decodeURIComponent(parsed.pathname);
    } else {
        // scp-like: [user@]host:path
        const scp = /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(trimmed);
        if (scp === null) {
            return null;
        }
        host = scp[1] as string;
        path = scp[2] as string;
    }
    const parts = path.split("/").filter((part) => part !== "");
    const last = parts.length - 1;
    if (last < 0) {
        return null;
    }
    parts[last] = (parts[last] as string).replace(/\.git$/, "");
    const id = [host.toLowerCase(), ...parts].join("/");
    return isProjectId(id) ? id : null;
}

export const localId = (root: string) =>
    `local-${createHash("sha256").update(root).digest("hex").slice(0, 12)}`;

// The nearest directory up from path that holds .git.
async function findRoot(path: string): Promise<{ root: string; git: string } | null> {
    let dir = await realpath(path);
    for (;;) {
        const git = join(dir, ".git");
        try {
            await stat(git);
            return { root: dir, git };
        } catch (error) {
            if (codeOf(error) !== "ENOENT") {
                throw error;
            }
        }
        const up = dirname(dir);
        if (up === dir) {
            return null;
        }
        dir = up;
    }
}

// The config file a .git directory, or a worktree's or submodule's .git
// file, leads to.
async function configPath(git: string): Promise<string> {
    if ((await stat(git)).isDirectory()) {
        return join(git, "config");
    }
    const found = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(git, "utf8"));
    if (found === null) {
        throw new Error(`${git} names no gitdir`);
    }
    const gitdir = resolve(dirname(git), found[1] as string);
    try {
        const common = (await readFile(join(gitdir, "commondir"), "utf8")).trim();
        return join(resolve(gitdir, common), "config");
    } catch (error) {
        if (codeOf(error) !== "ENOENT") {
            throw error;
        }
        return join(gitdir, "config");
    }
}

// [remote "origin"]'s url in a git config file.
export function originUrl(config: string): string | null {
    let inOrigin = false;
    for (const raw of config.split("\n")) {
        const line = raw.trim();
        if (line === "" || line.startsWith("#") || line.startsWith(";")) {
            continue;
        }
        const section = /^\[\s*([^\s\]"]+)(?:\s+"([^"]*)")?\s*\]/.exec(line);
        if (section !== null) {
            inOrigin = section[1]?.toLowerCase() === "remote" && section[2] === "origin";
            continue;
        }
        const url = /^url\s*=\s*(.*)$/i.exec(line);
        if (inOrigin && url !== null) {
            const value = (url[1] as string).replace(/\s+[#;].*$/, "").trim();
            return value.replace(/^"(.*)"$/, "$1");
        }
    }
    return null;
}

export async function identify(path: string): Promise<Project | null> {
    const found = await findRoot(path);
    if (found === null) {
        return null;
    }
    let config = "";
    try {
        config = await readFile(await configPath(found.git), "utf8");
    } catch (error) {
        if (codeOf(error) !== "ENOENT") {
            throw error;
        }
    }
    const url = originUrl(config);
    const remote = url === null ? null : normaliseRemote(url);
    return {
        root: found.root,
        id: remote ?? localId(found.root),
        name: remote?.split("/").at(-1) ?? basename(found.root),
    };
}
```

- [ ] **Step 5: Write `projects/registry.ts`**

```ts
// projects.json: each project Dorothy has synced, its roots on this
// machine, its repository's memory directory and the hash of each fact
// as both sides last held it.

import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { FACT_NAME } from "../facts/file.js";
import { isProjectId } from "../facts/store.js";
import { writeAtomic } from "../memory/sidecar.js";
import type { Project } from "./identify.js";

export type ProjectEntry = {
    name: string;
    roots: string[];
    memoryDir: string;
    synced: Record<string, string>;
};
export type Registry = { v: 1; projects: Record<string, ProjectEntry> };
export type RegistryRead =
    | { kind: "ok"; registry: Registry }
    | { kind: "none" }
    | { kind: "unparseable"; reason: string };

export const EMPTY_REGISTRY: Registry = Object.freeze({
    v: 1,
    projects: Object.freeze({}),
}) as Registry;

export const projectsPath = (root: string) => join(root, "projects.json");

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const HASH = /^[0-9a-f]{64}$/;
const codeOf = (error: unknown) => (error as { code?: unknown }).code;

// Null when dir is a relative path that stays inside the repository.
export function memoryDirProblem(dir: string): string | null {
    if (dir === "" || isAbsolute(dir) || dir.includes("\\")) {
        return `${dir || "an empty path"} is not a relative path`;
    }
    if (dir.split("/").some((part) => part === "" || part === "." || part === "..")) {
        return `${dir} leaves the repository or names it oddly`;
    }
    return null;
}

function entryProblem(id: string, entry: unknown): string | null {
    if (!isProjectId(id)) {
        return `${id} is not a project id`;
    }
    if (!isRecord(entry) || typeof entry.name !== "string") {
        return `${id} has no name`;
    }
    if (
        !Array.isArray(entry.roots) ||
        !entry.roots.every((root) => typeof root === "string" && isAbsolute(root))
    ) {
        return `${id}'s roots are not absolute paths`;
    }
    if (typeof entry.memoryDir !== "string") {
        return `${id} has no memory directory`;
    }
    const dir = memoryDirProblem(entry.memoryDir);
    if (dir !== null) {
        return `${id}'s memory directory: ${dir}`;
    }
    if (
        !isRecord(entry.synced) ||
        !Object.entries(entry.synced).every(
            ([name, hash]) => FACT_NAME.test(name) && typeof hash === "string" && HASH.test(hash),
        )
    ) {
        return `${id}'s synced hashes are not facts' hashes`;
    }
    return null;
}

export function parseRegistry(text: string): RegistryRead {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return { kind: "unparseable", reason: "it is not JSON" };
    }
    if (!isRecord(value) || value.v !== 1 || !isRecord(value.projects)) {
        return { kind: "unparseable", reason: "it is not a version 1 registry" };
    }
    for (const [id, entry] of Object.entries(value.projects)) {
        const problem = entryProblem(id, entry);
        if (problem !== null) {
            return { kind: "unparseable", reason: problem };
        }
    }
    return { kind: "ok", registry: value as Registry };
}

export async function readRegistry(path: string): Promise<RegistryRead> {
    try {
        return parseRegistry(await readFile(path, "utf8"));
    } catch (error) {
        if (codeOf(error) === "ENOENT") {
            return { kind: "none" };
        }
        return {
            kind: "unparseable",
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}

export function writeRegistry(path: string, registry: Registry): Promise<void> {
    return writeAtomic(path, `${JSON.stringify(registry, null, 2)}\n`);
}

const isDirectory = async (path: string) => {
    try {
        return (await lstat(path)).isDirectory();
    } catch {
        return false;
    }
};

// Where a repository keeps its memory: .agents/memory if it exists, else
// .claude/memory if that does, else .agents/memory.
export async function chooseMemoryDir(root: string): Promise<string> {
    if (await isDirectory(join(root, ".agents", "memory"))) {
        return ".agents/memory";
    }
    return (await isDirectory(join(root, ".claude", "memory")))
        ? ".claude/memory"
        : ".agents/memory";
}

const sorted = (synced: Record<string, string>) =>
    Object.fromEntries(Object.entries(synced).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export function withProject(
    registry: Registry,
    project: Project,
    memoryDir: string,
    synced: Record<string, string>,
): Registry {
    const known = registry.projects[project.id];
    const roots = known?.roots ?? [];
    return {
        v: 1,
        projects: {
            ...registry.projects,
            [project.id]: {
                name: known?.name ?? project.name,
                roots: roots.includes(project.root) ? roots : [...roots, project.root],
                memoryDir,
                synced: sorted(synced),
            },
        },
    };
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `bun test packages/memory/src/projects`
Expected: PASS.

- [ ] **Step 7: Run the checks and commit**

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: PASS.

```bash
git add packages/memory/src/projects
git commit -m "feat(memory): Know projects by their origin" \
  -m "A project is the git repository a path is in, its id the origin
remote with credentials, port and .git dropped, read from the config
file without git. projects.json keeps each one's roots, memory
directory and sync hashes."
```

---

### Task 5: Facts in history

**Files:**

- Modify: `packages/memory/src/history/lint.ts`
- Modify: `packages/memory/src/history/history.ts`
- Test: `packages/memory/src/history/lint.test.ts`,
  `packages/memory/src/history/history.test.ts`

**Interfaces:**

- Consumes: `parseFact`, `handEdited` (Task 2); `isProjectId` (Task 3);
  `parseRegistry` (Task 4); `writeAtomic`.
- Produces: `FileKind` gains `"fact"` and `"projects"`; the sweep
  rewrites a hand-edited fact canonically as the user's before linting
  and committing it.

- [ ] **Step 1: Write the failing lint tests**

Append to `packages/memory/src/history/lint.test.ts` (import
`renderFact` from `../facts/file.js`):

```ts
const FACT = renderFact({
    name: "likes-tea",
    title: "Likes tea",
    description: "Prefers tea.",
    type: "user",
    extra: {},
    tags: [],
    importance: null,
    provenance: {
        origin: "user",
        by: "dorothy",
        at: "2026-10-15T00:00:00.000Z",
        created: "2026-10-15T00:00:00.000Z",
    },
    retired: null,
    body: "Tea.",
});

describe("facts and projects", () => {
    it("knows facts and the registry by where they sit", () => {
        expect(fileKind("facts/personal/likes-tea.md")).toBe("fact");
        expect(fileKind("facts/projects/github.com/a/b/likes-tea.md")).toBe("fact");
        expect(fileKind("projects.json")).toBe("projects");
        expect(fileKind("facts/likes-tea.md")).toBe("other");
        expect(fileKind("facts/personal/sub/likes-tea.md")).toBe("other");
    });

    it("lints a fact against its file's name and scope", () => {
        expect(lint("facts/personal/likes-tea.md", bytes(FACT), null)).toBeNull();
        expect(lint("facts/personal/other.md", bytes(FACT), null)).toBe(
            "its name is likes-tea, not its file's, other",
        );
        expect(lint("facts/projects/nohost/likes-tea.md", bytes(FACT), null)).toBe(
            "it is not under a project id",
        );
        expect(lint("facts/personal/likes-tea.md", bytes("x\n"), null)).toBe(
            "it has no frontmatter",
        );
    });

    it("lints the registry", () => {
        expect(lint("projects.json", bytes('{"v":1,"projects":{}}'), null)).toBeNull();
        expect(lint("projects.json", bytes("{"), null)).toBe("it is not JSON");
    });
});
```

- [ ] **Step 2: Write the failing history tests**

Append to `packages/memory/src/history/history.test.ts`, inside
`describe("adopting", ...)` (import `renderFact`, `parseFact` from
`../facts/file.js`):

```ts
    it("rewrites a fact edited by hand as Dorothy writes one, and makes it the user's", async () => {
        const path = "facts/personal/likes-tea.md";
        const fact = {
            name: "likes-tea",
            title: "Likes tea",
            description: "Prefers tea.",
            type: "user" as const,
            extra: {},
            tags: [],
            importance: null,
            provenance: {
                origin: "dorothy" as const,
                by: "review" as const,
                at: "2026-10-01T00:00:00.000Z",
                created: "2026-10-01T00:00:00.000Z",
                model: "m",
            },
            retired: null,
            body: "Tea.",
        };
        put(root, path, renderFact(fact));
        const history = await open();
        put(root, path, renderFact(fact).replace("title: >-\n  Likes tea", 'title: "Likes  coffee"'));
        await history.sweep();
        const read = parseFact(readFileSync(join(root, path), "utf8"), "likes-tea");
        expect(read).toEqual({
            kind: "ok",
            fact: {
                ...fact,
                title: "Likes coffee",
                provenance: {
                    origin: "user",
                    by: "user",
                    at: NOW.toISOString(),
                    created: "2026-10-01T00:00:00.000Z",
                },
            },
        });
        expect((await messages(history))[0]).toBe(`outside: ${path}`);
    });

    it("takes a fact added by hand without provenance as the user's", async () => {
        const history = await open();
        const path = "facts/personal/likes-tea.md";
        put(
            root,
            path,
            "---\nname: likes-tea\ntitle: Likes tea\ndescription: Prefers tea.\nmetadata:\n  type: user\n---\n\nTea.\n",
        );
        await history.sweep();
        const read = parseFact(readFileSync(join(root, path), "utf8"), "likes-tea");
        expect(read.kind === "ok" && read.fact.provenance.by).toBe("user");
        expect((await messages(history))[0]).toBe(`outside: ${path}`);
    });

    it("keeps a copy of a fact edited into something that is no fact", async () => {
        const history = await open();
        put(root, "facts/personal/likes-tea.md", "title: null\n");
        await history.sweep();
        expect(warnings[0]).toContain("facts/personal/likes-tea.md is broken");
        expect((await messages(history))[0]).toBe(
            "broken: facts/personal/likes-tea.md kept, no good version",
        );
    });
```

- [ ] **Step 3: Run them to see them fail**

Run: `bun test packages/memory/src/history/lint.test.ts packages/memory/src/history/history.test.ts`
Expected: FAIL: `fileKind` gives `"other"` for facts, and the sweep
commits the hand edit unchanged.

- [ ] **Step 4: Teach the lint facts and the registry**

In `packages/memory/src/history/lint.ts`, add the imports:

```ts
import { basename } from "node:path";
import { parseFact } from "../facts/file.js";
import { isProjectId } from "../facts/store.js";
import { parseRegistry } from "../projects/registry.js";
```

Replace `FileKind` and `fileKind`:

```ts
// What a path in the data directory holds, by where it sits.
export type FileKind =
    | "vocabulary"
    | "sidecar"
    | "transcript"
    | "fact"
    | "projects"
    | "other";

const PERSONAL_FACT = /^facts\/personal\/[^/]+\.md$/;
const PROJECT_FACT = /^facts\/projects\/(.+)\/[^/]+\.md$/;

export function fileKind(path: string): FileKind {
    if (path === "tags.json") {
        return "vocabulary";
    }
    if (path === "projects.json") {
        return "projects";
    }
    if (PERSONAL_FACT.test(path) || PROJECT_FACT.test(path)) {
        return "fact";
    }
    if (/^transcripts\/[^/]+\.meta\.json$/.test(path)) {
        return "sidecar";
    }
    if (/^transcripts\/[^/]+\.jsonl$/.test(path)) {
        return "transcript";
    }
    return "other";
}
```

In `lint`, replace the final `const read = ...; return ...` with:

```ts
    if (kind === "fact") {
        const id = PROJECT_FACT.exec(path)?.[1];
        if (id !== undefined && !isProjectId(id)) {
            return "it is not under a project id";
        }
        const read = parseFact(text, basename(path, ".md"));
        return read.kind === "ok" ? null : read.reason;
    }
    if (kind === "projects") {
        const read = parseRegistry(text);
        return read.kind === "ok" ? null : read.reason;
    }
    const read =
        kind === "vocabulary" ? parseVocabulary(text) : parseSidecar(text);
    return read.kind === "ok" ? null : read.reason;
```

- [ ] **Step 5: Rewrite hand edits in the sweep**

In `packages/memory/src/history/history.ts`, add `handEdited` from
`../facts/file.js` and `writeAtomic` from `../memory/sidecar.js` to the
imports. In `#settle`, at the top of the `for` loop's body after the
`except` check, add:

```ts
            if (fileKind(path) === "fact") {
                await this.#canonicalise(path);
            }
```

and add the method after `#settle`:

```ts
    // A fact added or edited by hand is rewritten as Dorothy writes one,
    // and made the user's, before it is linted; one that is no fact is
    // left for the lint to restore.
    async #canonicalise(path: string): Promise<void> {
        const full = join(this.root, path);
        if (!existsSync(full)) {
            return;
        }
        const text = await readFile(full, "utf8");
        const canonical = handEdited(text, basename(path, ".md"), this.#now());
        if (canonical !== null && canonical !== text) {
            await writeAtomic(full, canonical);
        }
    }
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `bun test packages/memory/src/history`
Expected: PASS, the existing history tests included.

- [ ] **Step 7: Run the checks and commit**

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: PASS.

```bash
git add packages/memory/src/history
git commit -m "feat(memory): Lint facts and the projects registry" \
  -m "History knows facts and projects.json by where they sit and lints
them; a fact the user edits or adds by hand is rewritten canonically,
as the user's, before it is committed."
```

---

### Task 6: The recall index's facts and sources

**Files:**

- Create: `packages/memory/src/recall/facts.ts`
- Create: `packages/memory/src/recall/facts.test.ts`
- Modify: `packages/memory/src/recall/store.ts`
- Modify: `packages/memory/src/recall/sync.ts`
- Test: `packages/memory/src/recall/store.test.ts`,
  `packages/memory/src/recall/sync.test.ts`

**Interfaces:**

- Consumes: `parseFact` (Task 2); `factFiles`, `scopeLabel` (Task 3);
  `sourceOf` (Task 1).
- Produces: `SCHEMA_VERSION = 4`; `conversations.source` (`'chat'` by
  default) and `conversations.project`; tables `facts`, `fact_tags`,
  `facts_fts`; `syncFacts(index, root): Promise<string[]>`; `syncIndex`'s
  fifth parameter `facts: string | null = null`, the data directory.

- [ ] **Step 1: Write the failing tests**

`packages/memory/src/recall/facts.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fact } from "../facts/file.js";
import { factPath, PERSONAL, putFact, type Scope } from "../facts/store.js";
import { syncFacts } from "./facts.js";
import { RecallIndex } from "./store.js";

const AT = "2026-10-15T09:30:00.000Z";
const PROJECT: Scope = { kind: "project", id: "github.com/chewygumxx/dorothy" };
const fact = (name: string, fields: Partial<Fact> = {}): Fact => ({
    name,
    title: `About ${name}`,
    description: `What Dorothy knows of ${name}.`,
    type: "user",
    extra: {},
    tags: [],
    importance: null,
    provenance: { origin: "user", by: "dorothy", at: AT, created: AT },
    retired: null,
    body: "Body.",
    ...fields,
});

let root = "";
let index: RecallIndex;
beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dorothy-recall-facts-"));
    index = RecallIndex.open(join(root, "index", "recall.sqlite"));
});
afterEach(async () => {
    index.close();
    await rm(root, { recursive: true, force: true });
});

const rows = () =>
    index.db
        .query(
            "SELECT path, scope, name, title, type, origin, importance, retired FROM facts ORDER BY path",
        )
        .all();
const search = (words: string) =>
    (
        index.db
            .query(
                "SELECT f.name AS name FROM facts_fts JOIN facts f ON f.rowid = facts_fts.rowid WHERE facts_fts MATCH ? ORDER BY f.name",
            )
            .all(words) as { name: string }[]
    ).map(({ name }) => name);

describe("syncFacts", () => {
    it("indexes every fact, retired ones too, with scope, origin and importance", async () => {
        await putFact(root, PERSONAL, fact("tea", { importance: 7 }));
        await putFact(
            root,
            PROJECT,
            fact("gateway", {
                type: "project",
                provenance: { origin: "repo", by: "repo", at: AT, created: AT },
                retired: { at: AT, by: "user", why: "Done." },
            }),
        );
        expect(await syncFacts(index, root)).toEqual([]);
        expect(rows()).toEqual([
            {
                path: "facts/personal/tea.md",
                scope: "personal",
                name: "tea",
                title: "About tea",
                type: "user",
                origin: "user",
                importance: 7,
                retired: 0,
            },
            {
                path: "facts/projects/github.com/chewygumxx/dorothy/gateway.md",
                scope: "github.com/chewygumxx/dorothy",
                name: "gateway",
                title: "About gateway",
                type: "project",
                origin: "repo",
                importance: null,
                retired: 1,
            },
        ]);
    });

    it("finds facts by their title, description and body", async () => {
        await putFact(root, PERSONAL, fact("tea", { body: "Darjeeling, mostly." }));
        await putFact(root, PERSONAL, fact("coffee"));
        await syncFacts(index, root);
        expect(search("darjeeling")).toEqual(["tea"]);
        expect(search("knows")).toEqual(["coffee", "tea"]);
    });

    it("reads a changed fact again, and drops one that is gone", async () => {
        await putFact(root, PERSONAL, fact("tea"));
        await putFact(root, PERSONAL, fact("coffee"));
        await syncFacts(index, root);
        await putFact(root, PERSONAL, fact("tea", { body: "Assam now." }));
        const later = new Date(Date.parse(AT) + 60_000);
        await utimes(factPath(root, PERSONAL, "tea"), later, later);
        await rm(factPath(root, PERSONAL, "coffee"));
        await syncFacts(index, root);
        expect(search("assam")).toEqual(["tea"]);
        expect(rows()).toHaveLength(1);
    });

    it("leaves out a fact it cannot read, and says why", async () => {
        await mkdir(join(root, "facts", "personal"), { recursive: true });
        await writeFile(join(root, "facts", "personal", "tea.md"), "no fact\n");
        expect(await syncFacts(index, root)).toEqual([
            `${join(root, "facts", "personal", "tea.md")}: it has no frontmatter`,
        ]);
        expect(rows()).toEqual([]);
    });

    it("keeps a fact's tags", async () => {
        await putFact(root, PERSONAL, fact("tea", { tags: ["k00000002", "k00000001"] }));
        await syncFacts(index, root);
        expect(
            index.db.query("SELECT n, id FROM fact_tags ORDER BY n").all(),
        ).toEqual([
            { n: 0, id: "k00000002" },
            { n: 1, id: "k00000001" },
        ]);
    });
});
```

Append to `packages/memory/src/recall/sync.test.ts`'s
`describe("syncIndex", ...)` (import `PERSONAL` and `putFact` from
`../facts/store.js`):

```ts
    it("takes a conversation's source and project from its first session", async () => {
        await writeFile(
            transcript(A),
            [
                event("session", 0, {
                    phrase: "p",
                    sdkSessionId: "",
                    model: "m",
                    promptHash: "",
                    resumed: false,
                    source: "claude-code",
                    project: "github.com/chewygumxx/dorothy",
                }),
                user(1, "fix it"),
                reply(2, "Looking."),
                event("tool", 2, {
                    name: "Bash",
                    input: "{}",
                    output: "secret-free output",
                    ok: true,
                    cut: { input: 0, output: 0 },
                }),
                reply(3, "Fixed."),
                session(4),
            ].join(""),
        );
        await writeFile(transcript(B), [session(0), user(1, "hi")].join(""));
        await syncIndex(index, dir);
        // Tool output is never indexed; consecutive replies are turns.
        expect(turns(A)).toEqual([
            { n: 1, role: "user", text: "fix it" },
            { n: 2, role: "assistant", text: "Looking." },
            { n: 3, role: "assistant", text: "Fixed." },
        ]);
        expect(row(A)).toMatchObject({
            source: "claude-code",
            project: "github.com/chewygumxx/dorothy",
        });
        expect(row(B)).toMatchObject({ source: "chat", project: null });
    });

    it("syncs facts too when given the data directory", async () => {
        await putFact(dir, PERSONAL, {
            name: "tea",
            title: "Tea",
            description: "Likes tea.",
            type: "user",
            extra: {},
            tags: [],
            importance: null,
            provenance: {
                origin: "user",
                by: "dorothy",
                at: T(0),
                created: T(0),
            },
            retired: null,
            body: "Tea.",
        });
        await syncIndex(index, dir, Date.now(), null, dir);
        expect(
            index.db.query("SELECT name FROM facts").all(),
        ).toEqual([{ name: "tea" }]);
    });
```

In `packages/memory/src/recall/store.test.ts`, change the test titled
"is at schema version 3, with clusters and vocabulary tables" to "is at
schema version 4, with clusters, vocabulary and facts tables", its
`expect(SCHEMA_VERSION).toBe(3)` to `toBe(4)`, and add `'facts',
'fact_tags'` to its `IN (...)` list and the two names, in order, to the
array it expects.

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/memory/src/recall`
Expected: FAIL: `./facts.js` is missing, `source` is no column, and the
schema is version 3.

- [ ] **Step 3: Extend the schema**

In `packages/memory/src/recall/store.ts`, set `SCHEMA_VERSION = 4`. In
`CREATE TABLE conversations`, after `hidden INTEGER NOT NULL DEFAULT 0,`
add:

```sql
        source TEXT NOT NULL DEFAULT 'chat',
        project TEXT,
```

Add to `SCHEMA`, after the `tagged` table:

```ts
    // Every fact in the store, retired ones too; scope is "personal" or a
    // project id, created milliseconds since the epoch.
    `CREATE TABLE facts (
        path TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        type TEXT NOT NULL,
        body TEXT NOT NULL,
        origin TEXT NOT NULL,
        importance INTEGER,
        created INTEGER NOT NULL,
        retired INTEGER NOT NULL,
        mtime REAL NOT NULL
    )`,
    `CREATE TABLE fact_tags (
        path TEXT NOT NULL,
        n INTEGER NOT NULL,
        id TEXT NOT NULL,
        PRIMARY KEY (path, id)
    )`,
```

after the `notes_fts` virtual table:

```ts
    `CREATE VIRTUAL TABLE facts_fts USING fts5(
        title, description, body, content=facts,
        tokenize='porter unicode61 remove_diacritics 2'
    )`,
```

and after the last `notes_au` trigger:

```ts
    `CREATE TRIGGER facts_ai AFTER INSERT ON facts BEGIN
        INSERT INTO facts_fts (rowid, title, description, body)
        VALUES (new.rowid, new.title, new.description, new.body);
    END`,
    `CREATE TRIGGER facts_ad AFTER DELETE ON facts BEGIN
        INSERT INTO facts_fts (facts_fts, rowid, title, description, body)
        VALUES ('delete', old.rowid, old.title, old.description, old.body);
    END`,
```

Facts are only inserted and deleted, never updated, so no update
trigger is needed.

- [ ] **Step 4: Write `recall/facts.ts`**

```ts
// The store's facts in the recall index, synced by each file's mtime: a
// changed fact is read again, a gone one dropped, and one that cannot be
// read left out with a warning.

import { readFile, stat } from "node:fs/promises";
import { relative, sep } from "node:path";
import { parseFact } from "../facts/file.js";
import { factFiles, scopeLabel } from "../facts/store.js";
import type { RecallIndex } from "./store.js";

const codeOf = (error: unknown) => (error as { code?: unknown }).code;

function drop(index: RecallIndex, path: string): void {
    index.db.run("DELETE FROM fact_tags WHERE path = ?", [path]);
    index.db.run("DELETE FROM facts WHERE path = ?", [path]);
}

export async function syncFacts(index: RecallIndex, root: string): Promise<string[]> {
    const warnings: string[] = [];
    await index.exclusive(async () => {
        const known = new Map(
            (
                index.db.query("SELECT path, mtime FROM facts").all() as {
                    path: string;
                    mtime: number;
                }[]
            ).map(({ path, mtime }) => [path, mtime]),
        );
        const seen = new Set<string>();
        for (const file of await factFiles(root)) {
            const key = relative(root, file.path).split(sep).join("/");
            let mtime: number;
            let text: string;
            try {
                mtime = (await stat(file.path)).mtimeMs;
                if (known.get(key) === mtime) {
                    seen.add(key);
                    continue;
                }
                text = await readFile(file.path, "utf8");
            } catch (error) {
                if (codeOf(error) === "ENOENT") {
                    continue;
                }
                throw error;
            }
            seen.add(key);
            drop(index, key);
            const read = parseFact(text, file.name);
            if (read.kind !== "ok") {
                warnings.push(`${file.path}: ${read.reason}`);
                continue;
            }
            const { fact } = read;
            index.db.run(
                "INSERT INTO facts (path, scope, name, title, description, type, body, origin, importance, created, retired, mtime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    key,
                    scopeLabel(file.scope),
                    fact.name,
                    fact.title,
                    fact.description,
                    fact.type,
                    fact.body,
                    fact.provenance.origin,
                    fact.importance,
                    Date.parse(fact.provenance.created),
                    fact.retired === null ? 0 : 1,
                    mtime,
                ],
            );
            for (const [n, id] of fact.tags.entries()) {
                index.db.run(
                    "INSERT OR IGNORE INTO fact_tags (path, n, id) VALUES (?, ?, ?)",
                    [key, n, id],
                );
            }
        }
        for (const path of known.keys()) {
            if (!seen.has(path)) {
                drop(index, path);
            }
        }
    });
    return warnings;
}
```

An unreadable fact keeps no row, so the next sync reads it again and
warns again until it is mended.

- [ ] **Step 5: Take the source and project in `recall/sync.ts`**

Import `syncFacts` from `./facts.js` and `sourceOf` beside `toRecall`
and `toTurn` from `../transcript.js`. In `applyLines`, replace the
`kind === "session"` branch with:

```ts
        if (kind === "session") {
            // The first session says which body, and which project, the
            // conversation began in.
            if (row.sessions === 0 && isRecord(event)) {
                index.db.run(
                    "UPDATE conversations SET source = ?, project = ? WHERE phrase = ?",
                    [
                        sourceOf(event),
                        typeof event.project === "string" ? event.project : null,
                        row.phrase,
                    ],
                );
            }
            row.sessions++;
            continue;
        }
```

Give `syncIndex` a fifth parameter and sync facts after the leftovers:

```ts
// With the data directory as facts, the store's facts are synced too.
export async function syncIndex(
    index: RecallIndex,
    dir: string,
    now: number = Date.now(),
    vocabulary: string | null = null,
    facts: string | null = null,
): Promise<string[]> {
```

and, after `await removeLeftovers(dir, names, now);`:

```ts
    if (facts !== null) {
        warnings.push(...(await syncFacts(index, facts)));
    }
```

Add the comment line above to the function's existing comment rather
than a second comment block.

- [ ] **Step 6: Run the tests to see them pass**

Run: `bun test packages/memory/src`
Expected: PASS, every existing recall test included.

- [ ] **Step 7: Run the checks and commit**

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: PASS.

```bash
git add packages/memory/src/recall
git commit -m "feat(memory): Index facts and where chats began" \
  -m "The recall index, at schema 4, holds every fact with its scope,
origin, importance and whether it is retired, searchable by its text,
and each conversation's source and project from its first session."
```

---

### Task 7: The exported form and MEMORY.md

**Files:**

- Create: `packages/memory/src/projects/export.ts`
- Create: `packages/memory/src/projects/export.test.ts`

**Interfaces:**

- Consumes: `Fact`, `Extra`, `FactType`, `folded`, `frontmatterOf`,
  `Problem`, `readCommon`, `wrap` (Task 2); `normalise` from
  `../memory/sidecar.js`.
- Produces: `type ExportedFact = Pick<Fact, "name" | "description" |
  "type" | "extra" | "body">`, `exportedForm(fact)`,
  `renderExported(form)`, `type ExportedRead`, `parseExported(text,
  stem)`, `formHash(form): string`, `INDEX_LIMITS`, `type IndexEntry =
  { name; title; description; importance: number | null; created:
  string }`, `renderIndex(entries): { text: string; omitted: number }`,
  `indexTitles(text): Map<string, string>`.

- [ ] **Step 1: Write the failing tests**

`packages/memory/src/projects/export.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
    type ExportedFact,
    formHash,
    type IndexEntry,
    indexTitles,
    parseExported,
    renderExported,
    renderIndex,
} from "./export.js";

// As Claude Code's auto-memory writes a fact, unquoted date and all.
const NATIVE = [
    "---",
    "name: bg-session-force-color",
    "description: \"Claude Code background sessions export FORCE_COLOR=3; the user's own shell does not\"",
    "metadata:",
    "  node_type: memory",
    "  type: reference",
    "  originSessionId: 4a3e48ae-7145-48e9-ace9-ed4dc9f0042f",
    "  modified: 2026-10-04T20:20:14.359Z",
    "---",
    "",
    "Background sessions export it; the shell does not.",
    "",
].join("\n");

const FORM: ExportedFact = {
    name: "bg-session-force-color",
    description:
        "Claude Code background sessions export FORCE_COLOR=3; the user's own shell does not",
    type: "reference",
    extra: {
        node_type: "memory",
        originSessionId: "4a3e48ae-7145-48e9-ace9-ed4dc9f0042f",
        modified: "2026-10-04T20:20:14.359Z",
    },
    body: "Background sessions export it; the shell does not.",
};

describe("parseExported", () => {
    it("reads a fact as Claude Code's auto-memory writes one", () => {
        expect(parseExported(NATIVE, "bg-session-force-color")).toEqual({
            kind: "ok",
            form: FORM,
        });
    });

    it("reads back what renderExported writes", () => {
        const text = renderExported(FORM);
        expect(text).toStartWith(
            "---\nname: bg-session-force-color\ndescription: >-\n  Claude Code",
        );
        expect(parseExported(text, "bg-session-force-color")).toEqual({
            kind: "ok",
            form: FORM,
        });
    });

    it.each([
        ["a title", "metadata:", "title: x\nmetadata:", "its frontmatter has an unknown key, title"],
        ["a numeric description", 'description: "Claude', "description: 1e3\nx: \"", "its frontmatter has an unknown key, x"],
        ["no frontmatter", "---\nname", "name", "it has no frontmatter"],
        ["a name not its stem", "name: bg-session-force-color", "name: other", "its name is other, not its file's, bg-session-force-color"],
    ])("refuses %s", (_, from, to, reason) => {
        expect(parseExported(NATIVE.replace(from, to), "bg-session-force-color")).toEqual({
            kind: "unparseable",
            reason,
        });
    });

    it("refuses a description that YAML reads as a number", () => {
        const text = [
            "---",
            "name: n",
            "description: 1e3",
            "metadata:",
            "  type: project",
            "---",
            "",
            "x",
            "",
        ].join("\n");
        expect(parseExported(text, "n")).toEqual({
            kind: "unparseable",
            reason: "description is not text",
        });
    });
});

describe("formHash", () => {
    it("hashes the content, not how it is written", () => {
        expect(formHash(FORM)).toMatch(/^[0-9a-f]{64}$/);
        const read = parseExported(renderExported(FORM), FORM.name);
        expect(read.kind === "ok" && formHash(read.form)).toBe(formHash(FORM));
        const reordered = { ...FORM, extra: { modified: FORM.extra.modified as string, node_type: "memory", originSessionId: FORM.extra.originSessionId as string } };
        expect(formHash(reordered)).toBe(formHash(FORM));
    });

    it("changes with the content", () => {
        expect(formHash({ ...FORM, body: "Other." })).not.toBe(formHash(FORM));
        expect(formHash({ ...FORM, type: "project" })).not.toBe(formHash(FORM));
    });
});

const entry = (name: string, fields: Partial<IndexEntry> = {}): IndexEntry => ({
    name,
    title: name,
    description: `About ${name}.`,
    importance: null,
    created: "2026-10-15T00:00:00.000Z",
    ...fields,
});

describe("renderIndex", () => {
    it("lists facts as they were created, each description wrapped beneath", () => {
        const { text, omitted } = renderIndex([
            entry("b", { title: "Bee [2]", created: "2026-10-02T00:00:00.000Z" }),
            entry("a", {
                title: "Ay",
                description: `${"word ".repeat(20)}end`,
                created: "2026-10-01T00:00:00.000Z",
            }),
        ]);
        expect(omitted).toBe(0);
        expect(text).toBe(
            [
                "- [Ay](./a.md)",
                `  ${"word ".repeat(15).trimEnd()}`,
                `  ${"word ".repeat(5)}end`,
                "- [Bee \\[2\\]](./b.md)",
                "  About b.",
                "",
            ].join("\n"),
        );
    });

    it("keeps within 200 lines, the most important first", () => {
        const entries = Array.from({ length: 150 }, (_, at) =>
            entry(`f-${String(at).padStart(3, "0")}`, {
                importance: at >= 140 ? 9 : null,
                created: new Date(Date.UTC(2026, 9, 1, 0, at)).toISOString(),
            }),
        );
        const { text, omitted } = renderIndex(entries);
        expect(omitted).toBe(50);
        expect(text.split("\n").length - 1).toBe(200);
        for (let at = 140; at < 150; at++) {
            expect(text).toContain(`./f-${at}.md`);
        }
    });

    it("keeps within 25,000 bytes", () => {
        const entries = Array.from({ length: 60 }, (_, at) =>
            entry(`f-${at}`, { description: "日".repeat(160) }),
        );
        const { text, omitted } = renderIndex(entries);
        expect(omitted).toBeGreaterThan(0);
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(25_000);
    });

    it("is empty for no facts", () => {
        expect(renderIndex([])).toEqual({ text: "", omitted: 0 });
    });
});

describe("indexTitles", () => {
    it("reads each entry's title by its fact's name", () => {
        const titles = indexTitles(
            [
                "- [Background sessions force colour](./bg-session-force-color.md)",
                "  `--bg` sessions export FORCE_COLOR=3",
                "- [Bee \\[2\\]](./b.md)",
                "Some prose.",
            ].join("\n"),
        );
        expect([...titles]).toEqual([
            ["bg-session-force-color", "Background sessions force colour"],
            ["b", "Bee [2]"],
        ]);
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/memory/src/projects/export.test.ts`
Expected: FAIL, `Cannot find module './export.js'`.

- [ ] **Step 3: Write `projects/export.ts`**

```ts
// A project's facts as its repository holds them: the exported form,
// which keeps what Claude Code's auto-memory reads (name, description,
// metadata and the body), its hash, and MEMORY.md, the index Claude Code
// loads at startup.

import { createHash } from "node:crypto";
import {
    type Fact,
    folded,
    frontmatterOf,
    Problem,
    readCommon,
    wrap,
} from "../facts/file.js";
import { normalise } from "../memory/sidecar.js";

export type ExportedFact = Pick<
    Fact,
    "name" | "description" | "type" | "extra" | "body"
>;
export type ExportedRead =
    | { kind: "ok"; form: ExportedFact }
    | { kind: "unparseable"; reason: string };

export const exportedForm = (fact: Fact): ExportedFact => ({
    name: fact.name,
    description: fact.description,
    type: fact.type,
    extra: fact.extra,
    body: fact.body,
});

export function renderExported(form: ExportedFact): string {
    return [
        "---",
        `name: ${form.name}`,
        ...folded("description", form.description),
        "metadata:",
        `  type: ${form.type}`,
        ...Object.entries(form.extra).map(
            ([key, value]) => `  ${key}: ${JSON.stringify(value)}`,
        ),
        "---",
        "",
        form.body,
        "",
    ].join("\n");
}

const EXPORTED_KEYS = ["name", "description", "metadata"];

export function parseExported(source: string, stem: string): ExportedRead {
    try {
        const { data, body } = frontmatterOf(source);
        const unknown = Object.keys(data).find((key) => !EXPORTED_KEYS.includes(key));
        if (unknown !== undefined) {
            throw new Problem(`its frontmatter has an unknown key, ${unknown}`);
        }
        return { kind: "ok", form: readCommon(data, body, stem) };
    } catch (error) {
        if (error instanceof Problem) {
            return { kind: "unparseable", reason: error.message };
        }
        throw error;
    }
}

const byKey = ([a]: [string, unknown], [b]: [string, unknown]) =>
    a < b ? -1 : a > b ? 1 : 0;

// Of the parsed form, so a file written another way hashes the same.
export function formHash(form: ExportedFact): string {
    return createHash("sha256")
        .update(
            JSON.stringify([
                form.name,
                form.description,
                form.type,
                Object.entries(form.extra).sort(byKey),
                form.body,
            ]),
        )
        .digest("hex");
}

// What Claude Code loads of MEMORY.md; it drops the rest silently.
export const INDEX_LIMITS = { lines: 200, bytes: 25_000 } as const;

export type IndexEntry = {
    name: string;
    title: string;
    description: string;
    importance: number | null;
    created: string;
};

const escapeLink = (text: string) => text.replace(/[\\[\]]/g, (c) => `\\${c}`);
const entryLines = (entry: IndexEntry) => [
    `- [${escapeLink(entry.title)}](./${entry.name}.md)`,
    ...wrap(entry.description, 78).map((line) => `  ${line}`),
];
const render = (entries: readonly IndexEntry[]) =>
    entries.length === 0 ? "" : `${entries.flatMap(entryLines).join("\n")}\n`;
const fits = (text: string) =>
    text.split("\n").length - 1 <= INDEX_LIMITS.lines &&
    Buffer.byteLength(text) <= INDEX_LIMITS.bytes;
const byCreated = (a: IndexEntry, b: IndexEntry) =>
    a.created < b.created
        ? -1
        : a.created > b.created
          ? 1
          : a.name < b.name
            ? -1
            : a.name > b.name
              ? 1
              : 0;
// A fact without importance ranks as a 5.
const byWeight = (a: IndexEntry, b: IndexEntry) =>
    (b.importance ?? 5) - (a.importance ?? 5) || byCreated(b, a);

// Every fact as it was created when they fit; otherwise as many as fit,
// the most important and then the newest first.
export function renderIndex(entries: readonly IndexEntry[]): {
    text: string;
    omitted: number;
} {
    const whole = render([...entries].sort(byCreated));
    if (fits(whole)) {
        return { text: whole, omitted: 0 };
    }
    const kept: IndexEntry[] = [];
    for (const entry of [...entries].sort(byWeight)) {
        if (fits(render([...kept, entry]))) {
            kept.push(entry);
        }
    }
    return { text: render(kept), omitted: entries.length - kept.length };
}

const ENTRY = /^- \[((?:\\.|[^\]\\])*)\]\(\.\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md\)\s*$/;

// Each entry's title, by its fact's name, in the index's order.
export function indexTitles(text: string): Map<string, string> {
    const titles = new Map<string, string>();
    for (const line of text.split("\n")) {
        const found = ENTRY.exec(line);
        const name = found?.[2];
        if (name !== undefined && !titles.has(name)) {
            titles.set(name, normalise((found?.[1] as string).replace(/\\(.)/g, "$1")));
        }
    }
    return titles;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `bun test packages/memory/src/projects/export.test.ts`
Expected: PASS. In the 200-line test, each entry is two lines, so 100
fit; the ten of importance 9 rank first and the rest by recency.

- [ ] **Step 5: Run the checks and commit**

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: PASS.

```bash
git add packages/memory/src/projects/export.ts packages/memory/src/projects/export.test.ts
git commit -m "feat(memory): Write facts as a repository keeps them" \
  -m "The exported form keeps what Claude Code's auto-memory reads and
hashes by content, not formatting; MEMORY.md lists live facts within
the 200 lines and 25,000 bytes Claude Code loads."
```

---

### Task 8: Sync with a repository

**Files:**

- Create: `packages/memory/src/projects/sync.ts`
- Create: `packages/memory/src/projects/sync.test.ts`
- Create: `packages/memory/src/projects/AGENTS.md`

**Interfaces:**

- Consumes: Tasks 2 to 4 and 7: `Fact`, `FACT_LIMITS`, `FACT_NAME`,
  `nextOrigin`; `listFacts`, `putFact`, `Scope`; `identify`, `Project`;
  `EMPTY_REGISTRY`, `chooseMemoryDir`, `memoryDirProblem`,
  `projectsPath`, `readRegistry`, `withProject`, `writeRegistry`;
  `exportedForm`, `formHash`, `indexTitles`, `parseExported`,
  `renderExported`, `renderIndex`; `characters`, `normalise`, `Lock`,
  `Recorder` from `../memory/sidecar.js`.
- Produces: `MAX_FILE_BYTES = 65536`, `type SyncOptions = { root: string;
  lock: Lock; recorder: Recorder | null; now?: () => Date }`, `type
  SyncReport = { project: Project; memoryDir: string; imported: string[];
  exported: string[]; removed: string[]; retired: string[]; conflicts:
  string[]; skipped: { name: string; reason: string }[]; index: "written"
  | "unchanged" | "left"; omitted: number }`, `type SyncResult = { kind:
  "ok"; report } | { kind: "not-a-repository" } | { kind: "failed";
  reason: string }`, `syncProject(path, options): Promise<SyncResult>`.

- [ ] **Step 1: Write the failing tests**

`packages/memory/src/projects/sync.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    chmod,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    realpath,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fact } from "../facts/file.js";
import { factPath, listFacts, PERSONAL, putFact, type Scope } from "../facts/store.js";
import { RecallIndex } from "../recall/store.js";
import { projectsPath } from "./registry.js";
import { type SyncOptions, type SyncReport, syncProject } from "./sync.js";

const NOW = new Date("2026-10-15T09:30:00.000Z");
const ID = "github.com/chewygumxx/dorothy";
const SCOPE: Scope = { kind: "project", id: ID };

let base = "";
let data = "";
let repo = "";
let commits: { paths: string[]; message: string }[] = [];

const options = (fields: Partial<SyncOptions> = {}): SyncOptions => ({
    root: data,
    lock: (work) => work(),
    recorder: async (paths, message) => {
        commits.push({ paths: [...paths], message });
    },
    now: () => NOW,
    ...fields,
});

beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), "dorothy-sync-")));
    data = join(base, "data");
    repo = join(base, "repo");
    await mkdir(join(repo, ".git"), { recursive: true });
    await writeFile(
        join(repo, ".git", "config"),
        '[remote "origin"]\n\turl = git@github.com:chewygumxx/dorothy.git\n',
    );
    commits = [];
});
afterEach(async () => {
    await rm(base, { recursive: true, force: true });
});

const memory = (file: string) => join(repo, ".agents", "memory", file);
const putRepo = async (file: string, text: string) => {
    await mkdir(join(repo, ".agents", "memory"), { recursive: true });
    await writeFile(memory(file), text);
};
const repoFact = (name: string, description: string, body = "Body.") =>
    [
        "---",
        `name: ${name}`,
        `description: "${description}"`,
        "metadata:",
        "  type: project",
        "---",
        "",
        body,
        "",
    ].join("\n");
const storeFact = (name: string, fields: Partial<Fact> = {}): Fact => ({
    name,
    title: name,
    description: `About ${name}.`,
    type: "project",
    extra: {},
    tags: [],
    importance: null,
    provenance: {
        origin: "dorothy",
        by: "dorothy",
        at: NOW.toISOString(),
        created: NOW.toISOString(),
    },
    retired: null,
    body: "Body.",
    ...fields,
});
const facts = async () =>
    (await listFacts(data, SCOPE)).facts.map(({ fact }) => fact);
const files = async () =>
    (await readdir(join(repo, ".agents", "memory"))).sort();

async function sync(): Promise<SyncReport> {
    const result = await syncProject(repo, options());
    if (result.kind !== "ok") {
        throw new Error(JSON.stringify(result));
    }
    return result.report;
}
const moved = (report: SyncReport) => ({
    imported: report.imported,
    exported: report.exported,
    removed: report.removed,
    retired: report.retired,
    conflicts: report.conflicts,
});
const NOTHING = { imported: [], exported: [], removed: [], retired: [], conflicts: [] };

describe("syncProject", () => {
    it("adopts a repository's memory whole, with MEMORY.md's titles and order", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await putRepo("b.md", repoFact("b", "Second fact."));
        await putRepo("MEMORY.md", "- [Bee](./b.md)\n  second\n- [Ay](./a.md)\n  first\n");
        const report = await sync();
        expect(moved(report)).toEqual({ ...NOTHING, imported: ["a", "b"] });
        const [a, b] = await facts();
        expect([a?.title, a?.provenance.origin, b?.title, b?.provenance.by]).toEqual([
            "Ay",
            "repo",
            "Bee",
            "repo",
        ]);
        expect((b?.provenance.created ?? "") < (a?.provenance.created ?? "")).toBe(true);
        expect(await readFile(memory("MEMORY.md"), "utf8")).toBe(
            "- [Bee](./b.md)\n  Second fact.\n- [Ay](./a.md)\n  First fact.\n",
        );
        expect(report.index).toBe("written");
        expect(commits).toEqual([
            {
                paths: [factPath(data, SCOPE, "a"), factPath(data, SCOPE, "b"), projectsPath(data)],
                message: `sync: ${ID}: 2 in, 0 out`,
            },
        ]);
    });

    it("does nothing the second time", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await sync();
        commits = [];
        const report = await sync();
        expect(moved(report)).toEqual(NOTHING);
        expect(report.index).toBe("unchanged");
        expect(commits).toEqual([]);
    });

    it("exports a project's fact from the store, in the exported form", async () => {
        await putFact(data, SCOPE, storeFact("likes-tea", { importance: 7 }));
        const report = await sync();
        expect(moved(report)).toEqual({ ...NOTHING, exported: ["likes-tea"] });
        expect(await readFile(memory("likes-tea.md"), "utf8")).toBe(
            [
                "---",
                "name: likes-tea",
                "description: >-",
                "  About likes-tea.",
                "metadata:",
                "  type: project",
                "---",
                "",
                "Body.",
                "",
            ].join("\n"),
        );
        expect(commits[0]?.message).toBe(`sync: ${ID}: 0 in, 1 out`);
    });

    it("exports what changed in the store since the last sync", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await sync();
        const [a] = await facts();
        await putFact(data, SCOPE, { ...(a as Fact), description: "First, revised." });
        expect(moved(await sync())).toEqual({ ...NOTHING, exported: ["a"] });
        expect(await readFile(memory("a.md"), "utf8")).toContain("First, revised.");
    });

    it("imports what changed in the repository, keeping the store's own fields", async () => {
        await putFact(data, SCOPE, storeFact("a", { importance: 7, tags: ["k1a2b3c4d"] }));
        await sync();
        await putRepo("a.md", repoFact("a", "Edited in the repository."));
        expect(moved(await sync())).toEqual({ ...NOTHING, imported: ["a"] });
        expect((await facts())[0]).toMatchObject({
            description: "Edited in the repository.",
            importance: 7,
            tags: ["k1a2b3c4d"],
            provenance: { origin: "repo", by: "repo", created: NOW.toISOString() },
        });
    });

    it("keeps the repository's version when both changed, and never touches its file", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await sync();
        const [a] = await facts();
        await putFact(data, SCOPE, { ...(a as Fact), description: "Changed in the store." });
        const edit = repoFact("a", "Changed in the working tree.");
        await putRepo("a.md", edit);
        expect(moved(await sync())).toEqual({ ...NOTHING, imported: ["a"], conflicts: ["a"] });
        expect(await readFile(memory("a.md"), "utf8")).toBe(edit);
        expect((await facts())[0]?.description).toBe("Changed in the working tree.");
    });

    it("removes a fact retired in the store from the repository, and keeps it in the store", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await putRepo("b.md", repoFact("b", "Second fact."));
        await sync();
        const [a] = await facts();
        await putFact(data, SCOPE, {
            ...(a as Fact),
            retired: { at: NOW.toISOString(), by: "user", why: "Wrong." },
        });
        expect(moved(await sync())).toEqual({ ...NOTHING, removed: ["a"] });
        expect(await files()).toEqual(["MEMORY.md", "b.md"]);
        expect(await readFile(memory("MEMORY.md"), "utf8")).not.toContain("./a.md");
        expect((await facts()).map((fact) => [fact.name, fact.retired !== null])).toEqual([
            ["a", true],
            ["b", false],
        ]);
    });

    it("retires a fact deleted in the repository", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await sync();
        await rm(memory("a.md"));
        expect(moved(await sync())).toEqual({ ...NOTHING, retired: ["a"] });
        expect((await facts())[0]?.retired).toEqual({
            at: NOW.toISOString(),
            by: "repo",
            why: "deleted in the repository",
        });
    });

    it("revives a retired fact the repository writes again", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await sync();
        await rm(memory("a.md"));
        await sync();
        await putRepo("a.md", repoFact("a", "Back again."));
        expect(moved(await sync())).toEqual({ ...NOTHING, imported: ["a"] });
        expect((await facts())[0]).toMatchObject({ description: "Back again.", retired: null });
    });

    it("takes a repository file written another way as unchanged", async () => {
        await putFact(data, SCOPE, storeFact("a"));
        await sync();
        const restyled = [
            "---",
            "name: a",
            "metadata:",
            "  type: project",
            'description: "About a."',
            "---",
            "",
            "Body.",
            "",
        ].join("\n");
        await putRepo("a.md", restyled);
        expect(moved(await sync())).toEqual(NOTHING);
        expect(await readFile(memory("a.md"), "utf8")).toBe(restyled);
    });

    it("skips and names what is no fact, and imports, overwrites and retires none of it", async () => {
        await putFact(data, SCOPE, storeFact("trap"));
        const trap = [
            "---",
            "name: trap",
            "description: 1e3",
            "metadata:",
            "  type: project",
            "---",
            "",
            "x",
            "",
        ].join("\n");
        await putRepo("trap.md", trap);
        await putRepo("notes.md", "Just notes.\n");
        await putRepo("big.md", `---\nname: big\n---\n${"x".repeat(70_000)}\n`);
        await writeFile(join(base, "elsewhere.md"), repoFact("linked", "Elsewhere."));
        await symlink(join(base, "elsewhere.md"), memory("linked.md"));
        await putRepo("MEMORY.md", "kept by hand\n");
        const report = await sync();
        expect(moved(report)).toEqual(NOTHING);
        expect(report.skipped).toEqual([
            { name: "big", reason: "it is over 64 KiB" },
            { name: "linked", reason: "it is a symlink" },
            { name: "notes", reason: "it has no frontmatter" },
            { name: "trap", reason: "description is not text" },
        ]);
        expect(await readFile(memory("trap.md"), "utf8")).toBe(trap);
        expect(report.index).toBe("left");
        expect(await readFile(memory("MEMORY.md"), "utf8")).toBe("kept by hand\n");
        expect((await facts()).map((fact) => [fact.name, fact.retired])).toEqual([["trap", null]]);
    });

    it("leaves a hand-kept MEMORY.md alone when there is nothing to list", async () => {
        const kept = "- [Gone](./gone.md)\n  kept by hand\n";
        await putRepo("MEMORY.md", kept);
        expect((await sync()).index).toBe("left");
        expect(await readFile(memory("MEMORY.md"), "utf8")).toBe(kept);
    });

    it("refuses a memory directory that leaves the repository, and writes nothing", async () => {
        await putFact(data, SCOPE, storeFact("a"));
        await writeFile(
            projectsPath(data),
            JSON.stringify({
                v: 1,
                projects: {
                    [ID]: { name: "dorothy", roots: [repo], memoryDir: "../outside", synced: {} },
                },
            }),
        );
        expect(await syncProject(repo, options())).toEqual({
            kind: "failed",
            reason: `${projectsPath(data)}: ${ID}'s memory directory: ../outside leaves the repository or names it oddly`,
        });
        expect((await readdir(base)).sort()).toEqual(["data", "repo"]);
        expect(commits).toEqual([]);
    });

    it("refuses a memory directory reached through a symlink", async () => {
        await putFact(data, SCOPE, storeFact("a"));
        await mkdir(join(base, "outside"));
        await symlink(join(base, "outside"), join(repo, ".agents"));
        expect(await syncProject(repo, options())).toEqual({
            kind: "failed",
            reason: `.agents/memory passes through a symlink, ${join(repo, ".agents")}`,
        });
        expect(await readdir(join(base, "outside"))).toEqual([]);
    });

    it("never writes a personal fact into a repository", async () => {
        for (let seed = 0; seed < 20; seed++) {
            const name = `fact-${seed}`;
            await putFact(data, PERSONAL, storeFact(name, { type: "user", body: "Personal." }));
            if (seed % 3 === 0) {
                await putFact(data, SCOPE, storeFact(name));
            }
            await sync();
            const written = (await files()).filter((file) => file !== "MEMORY.md");
            expect(written).toEqual((await facts()).map((fact) => `${fact.name}.md`).sort());
            for (const file of written) {
                expect(await readFile(memory(file), "utf8")).not.toContain("Personal.");
            }
        }
    });

    it("imports what it can when the memory directory cannot be written", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await putFact(data, SCOPE, storeFact("b"));
        const dir = join(repo, ".agents", "memory");
        await chmod(dir, 0o555);
        try {
            const report = await sync();
            expect(report.imported).toEqual(["a"]);
            expect(report.exported).toEqual([]);
            expect(report.skipped.map(({ name }) => name)).toEqual(["b"]);
            expect(report.index).toBe("left");
        } finally {
            await chmod(dir, 0o755);
        }
    });

    it("says when a path is in no repository", async () => {
        expect(await syncProject(base, options())).toEqual({ kind: "not-a-repository" });
    });

    it("keeps credentials in the origin out of the registry and the commit", async () => {
        await writeFile(
            join(repo, ".git", "config"),
            '[remote "origin"]\n\turl = https://u:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/chewygumxx/dorothy.git\n',
        );
        await putRepo("a.md", repoFact("a", "First fact."));
        await sync();
        expect(await readFile(projectsPath(data), "utf8")).not.toContain("ghp_");
        expect(JSON.stringify(commits)).not.toContain("ghp_");
        expect(commits[0]?.message).toBe(`sync: ${ID}: 1 in, 0 out`);
    });

    it("syncs once when two run at once under one lock", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await putRepo("b.md", repoFact("b", "Second fact."));
        const index = RecallIndex.open(join(base, "index", "recall.sqlite"));
        try {
            const results = await Promise.all([
                syncProject(repo, options({ lock: index.lock })),
                syncProject(repo, options({ lock: index.lock })),
            ]);
            const imported = results.flatMap((result) =>
                result.kind === "ok" ? result.report.imported : ["failed"],
            );
            expect(imported.sort()).toEqual(["a", "b"]);
            expect(commits).toHaveLength(1);
        } finally {
            index.close();
        }
    });
});
```

`base` is a real path, so the symlink and registry messages, which
`identify` reports by real path, compare equal.

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/memory/src/projects/sync.test.ts`
Expected: FAIL, `Cannot find module './sync.js'`.

- [ ] **Step 3: Write `projects/sync.ts`**

```ts
// Reconciles a project's facts in the store with its repository's memory
// directory. The store is the truth: a fact changed only in the store is
// exported, one changed only in the repository imported, and one changed
// in both takes the repository's version, the store's kept in history.
// What the store last held is compared, not the files, so a working
// tree's edit is never overwritten; sync never commits or pushes.

import { randomBytes } from "node:crypto";
import {
    lstat,
    mkdir,
    readdir,
    readFile,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { FACT_LIMITS, FACT_NAME, type Fact, nextOrigin } from "../facts/file.js";
import { listFacts, putFact, type Scope } from "../facts/store.js";
import {
    characters,
    type Lock,
    normalise,
    type Recorder,
} from "../memory/sidecar.js";
import {
    type ExportedFact,
    exportedForm,
    formHash,
    indexTitles,
    parseExported,
    renderExported,
    renderIndex,
} from "./export.js";
import { identify, type Project } from "./identify.js";
import {
    chooseMemoryDir,
    EMPTY_REGISTRY,
    memoryDirProblem,
    projectsPath,
    readRegistry,
    withProject,
    writeRegistry,
} from "./registry.js";

// A repository file larger than this is no fact, and is not read.
export const MAX_FILE_BYTES = 64 * 1024;
const INDEX = "MEMORY.md";

export type SyncOptions = {
    // The data directory.
    root: string;
    lock: Lock;
    recorder: Recorder | null;
    now?: () => Date;
};

export type SyncReport = {
    project: Project;
    memoryDir: string;
    imported: string[];
    exported: string[];
    removed: string[];
    retired: string[];
    conflicts: string[];
    skipped: { name: string; reason: string }[];
    index: "written" | "unchanged" | "left";
    // Live facts MEMORY.md had no room for.
    omitted: number;
};

export type SyncResult =
    | { kind: "ok"; report: SyncReport }
    | { kind: "not-a-repository" }
    | { kind: "failed"; reason: string };

const codeOf = (error: unknown) => (error as { code?: unknown }).code;
const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// The memory directory, refused if it leaves the repository or passes
// through a symlink; it need not exist yet.
async function safeDir(root: string, memoryDir: string): Promise<string> {
    const problem = memoryDirProblem(memoryDir);
    if (problem !== null) {
        throw new Error(problem);
    }
    let at = root;
    for (const part of memoryDir.split("/")) {
        at = join(at, part);
        let info: Awaited<ReturnType<typeof lstat>>;
        try {
            info = await lstat(at);
        } catch (error) {
            if (codeOf(error) === "ENOENT") {
                continue;
            }
            throw error;
        }
        if (info.isSymbolicLink()) {
            throw new Error(`${memoryDir} passes through a symlink, ${at}`);
        }
        if (!info.isDirectory()) {
            throw new Error(`${at} is not a directory`);
        }
    }
    return at;
}

type RepoSide = {
    forms: Map<string, ExportedFact>;
    skipped: { name: string; reason: string }[];
    titles: Map<string, string>;
    // MEMORY.md's text; null when there is none.
    index: string | null;
    // MEMORY.md is a symlink, and never written.
    indexBlocked: boolean;
};

async function readRepo(dir: string): Promise<RepoSide> {
    const side: RepoSide = {
        forms: new Map(),
        skipped: [],
        titles: new Map(),
        index: null,
        indexBlocked: false,
    };
    let names: string[];
    try {
        names = (await readdir(dir)).sort();
    } catch (error) {
        if (codeOf(error) === "ENOENT") {
            return side;
        }
        throw error;
    }
    for (const file of names) {
        if (!file.endsWith(".md")) {
            continue;
        }
        const path = join(dir, file);
        const info = await lstat(path);
        const name = file.slice(0, -3);
        if (file === INDEX) {
            if (info.isSymbolicLink()) {
                side.indexBlocked = true;
            } else if (info.isFile()) {
                side.index = await readFile(path, "utf8");
                side.titles = indexTitles(side.index);
            }
            continue;
        }
        if (info.isSymbolicLink()) {
            side.skipped.push({ name, reason: "it is a symlink" });
        } else if (!info.isFile()) {
            continue;
        } else if (!FACT_NAME.test(name)) {
            side.skipped.push({ name, reason: "its name is not a fact's" });
        } else if (info.size > MAX_FILE_BYTES) {
            side.skipped.push({ name, reason: "it is over 64 KiB" });
        } else {
            const read = parseExported(await readFile(path, "utf8"), name);
            if (read.kind === "ok") {
                side.forms.set(name, read.form);
            } else {
                side.skipped.push({ name, reason: read.reason });
            }
        }
    }
    return side;
}

// A repository file, written whole or not at all, as the repository's
// other files are: mode 0644, in ordinary directories. Never through a
// symlink.
async function writeRepoFile(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    try {
        if ((await lstat(path)).isSymbolicLink()) {
            throw new Error(`${path} is a symlink`);
        }
    } catch (error) {
        if (codeOf(error) !== "ENOENT") {
            throw error;
        }
    }
    const temporary = `${path}.${randomBytes(4).toString("hex")}.tmp`;
    try {
        await writeFile(temporary, text, { mode: 0o644, flag: "wx" });
        await rename(temporary, path);
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}

export async function syncProject(
    path: string,
    options: SyncOptions,
): Promise<SyncResult> {
    let project: Project | null;
    try {
        project = await identify(path);
    } catch (error) {
        return { kind: "failed", reason: describeError(error) };
    }
    if (project === null) {
        return { kind: "not-a-repository" };
    }
    const found = project;
    try {
        return await options.lock(() => reconcile(found, options));
    } catch (error) {
        return { kind: "failed", reason: describeError(error) };
    }
}

async function reconcile(
    project: Project,
    { root, recorder, now: clock = () => new Date() }: SyncOptions,
): Promise<SyncResult> {
    const now = clock();
    const at = now.toISOString();
    const registryPath = projectsPath(root);
    const registryRead = await readRegistry(registryPath);
    if (registryRead.kind === "unparseable") {
        return { kind: "failed", reason: `${registryPath}: ${registryRead.reason}` };
    }
    const registry =
        registryRead.kind === "ok" ? registryRead.registry : EMPTY_REGISTRY;
    const known = registry.projects[project.id];
    const memoryDir = known?.memoryDir ?? (await chooseMemoryDir(project.root));
    const dir = await safeDir(project.root, memoryDir);
    const scope: Scope = { kind: "project", id: project.id };
    const synced: Record<string, string> = { ...(known?.synced ?? {}) };

    const repo = await readRepo(dir);
    const listed = await listFacts(root, scope);
    const store = new Map(listed.facts.map(({ fact }) => [fact.name, fact]));
    const report: SyncReport = {
        project,
        memoryDir,
        imported: [],
        exported: [],
        removed: [],
        retired: [],
        conflicts: [],
        skipped: [
            ...repo.skipped,
            ...listed.broken.map(({ path }) => ({
                name: basename(path, ".md"),
                reason: "it is broken in the store",
            })),
        ],
        index: "left",
        omitted: 0,
    };
    const passed = new Set(report.skipped.map(({ name }) => name));
    const written: string[] = [];

    // Facts adopted from the repository take creation times in the
    // index's order, then by name, a millisecond apart.
    const order = [
        ...repo.titles.keys(),
        ...[...repo.forms.keys()].filter((name) => !repo.titles.has(name)),
    ];
    const createdFor = (name: string) =>
        new Date(now.getTime() + Math.max(0, order.indexOf(name))).toISOString();
    const titleFor = (name: string) => {
        const title = normalise(repo.titles.get(name) ?? "");
        return title !== "" && characters(title) <= FACT_LIMITS.title
            ? title
            : [...name].slice(0, FACT_LIMITS.title).join("");
    };

    const names = new Set([...store.keys(), ...repo.forms.keys(), ...Object.keys(synced)]);
    for (const name of [...names].sort()) {
        if (passed.has(name)) {
            continue;
        }
        const held = store.get(name) ?? null;
        const live = held !== null && held.retired === null ? exportedForm(held) : null;
        const theirs = repo.forms.get(name) ?? null;
        const ours = live === null ? null : formHash(live);
        const their = theirs === null ? null : formHash(theirs);
        const last = synced[name];
        if (ours === their) {
            if (ours === null) {
                delete synced[name];
            } else {
                synced[name] = ours;
            }
            continue;
        }
        const oursChanged = last === undefined ? ours !== null : ours !== last;
        const theirsChanged = last === undefined ? their !== null : their !== last;
        if (oursChanged && !theirsChanged) {
            // A file that cannot be written is skipped; the rest go on.
            try {
                if (live === null) {
                    await rm(join(dir, `${name}.md`));
                    report.removed.push(name);
                    delete synced[name];
                } else {
                    await writeRepoFile(join(dir, `${name}.md`), renderExported(live));
                    report.exported.push(name);
                    synced[name] = ours as string;
                }
            } catch (error) {
                report.skipped.push({ name, reason: describeError(error) });
            }
            continue;
        }
        // The repository changed, alone or with the store: its version
        // wins, and the store's stays in history.
        if (oursChanged) {
            report.conflicts.push(name);
        }
        try {
            if (theirs === null) {
                if (held !== null && held.retired === null) {
                    written.push(
                        await putFact(root, scope, {
                            ...held,
                            retired: { at, by: "repo", why: "deleted in the repository" },
                        }),
                    );
                    report.retired.push(name);
                }
                delete synced[name];
                continue;
            }
            const fact: Fact = {
                ...theirs,
                title: held?.title ?? titleFor(name),
                tags: held?.tags ?? [],
                importance: held?.importance ?? null,
                provenance: {
                    origin: nextOrigin(held?.provenance.origin ?? null, "repo", "repo"),
                    by: "repo",
                    at,
                    created: held?.provenance.created ?? createdFor(name),
                    ...(held?.provenance.from === undefined
                        ? {}
                        : { from: held.provenance.from }),
                },
                retired: null,
            };
            written.push(await putFact(root, scope, fact));
            report.imported.push(name);
            synced[name] = their as string;
        } catch (error) {
            report.skipped.push({ name, reason: describeError(error) });
        }
    }

    // MEMORY.md is regenerated only when everything was read and there is
    // something to list, so a hand-kept index never loses what sync could
    // not read.
    const lives = (await listFacts(root, scope)).facts
        .map(({ fact }) => fact)
        .filter((fact) => fact.retired === null);
    if (report.skipped.length === 0 && lives.length > 0 && !repo.indexBlocked) {
        const { text, omitted } = renderIndex(
            lives.map((fact) => ({
                name: fact.name,
                title: fact.title,
                description: fact.description,
                importance: fact.importance,
                created: fact.provenance.created,
            })),
        );
        report.omitted = omitted;
        if (text === repo.index) {
            report.index = "unchanged";
        } else {
            try {
                await writeRepoFile(join(dir, INDEX), text);
                report.index = "written";
            } catch (error) {
                report.skipped.push({ name: INDEX, reason: describeError(error) });
            }
        }
    }

    const next = withProject(registry, project, memoryDir, synced);
    if (JSON.stringify(next) !== JSON.stringify(registry)) {
        await writeRegistry(registryPath, next);
        written.push(registryPath);
    }
    if (written.length > 0) {
        await recorder?.(
            written,
            `sync: ${project.id}: ${report.imported.length + report.retired.length} in, ${report.exported.length + report.removed.length} out`,
        );
    }
    return { kind: "ok", report };
}
```

The failure tests rely on `safeDir` and `readRegistry` throwing or
failing before anything is written; keep both before the first write.

- [ ] **Step 4: Run the tests to see them pass**

Run: `bun test packages/memory/src/projects/sync.test.ts`
Expected: PASS. In "adopts", `b` is first in `MEMORY.md`, so it is
created a millisecond before `a`, and the regenerated index keeps that
order.

- [ ] **Step 5: Write `packages/memory/src/projects/AGENTS.md`**

Copy the frontmatter and breadcrumb from `packages/memory/AGENTS.md`,
with the title `packages/memory/src/projects/AGENTS.md`, the description
"How a project's facts are identified, exported and synced with its
repository." and the breadcrumb path
`:/packages/memory/src/projects/AGENTS.md`. The body:

```markdown
# packages/memory/src/projects/AGENTS.md

A project is the git repository a path is in. Its facts live in the
store under `facts/projects/<id>/` and are synced to the repository's
memory directory, `.agents/memory/` by default.

## Files

- `identify.ts`: `identify` finds the repository root and reads its
  `origin` from the config file, never through `git`; `normaliseRemote`
  drops scheme, credentials, port and `.git`. No `origin`, or a local
  one, is `local-` and the root's hash.
- `registry.ts`: `projects.json`, each project's roots, memory directory
  and the hash of each fact as both sides last held it.
- `export.ts`: the exported form Claude Code's auto-memory reads, its
  hash by content, and `MEMORY.md` within 200 lines and 25,000 bytes.
- `sync.ts`: `syncProject`, the reconciliation.

## Invariants

- Only a project's own directory is exported: a personal fact can never
  reach a repository.
- A fact changed in both places takes the repository's version; a file
  is overwritten only when its content still matches the last sync.
- A repository file that is no fact, a symlink, or over 64 KiB is
  skipped and named, never imported, overwritten or retired.
- `MEMORY.md` is regenerated only when nothing was skipped and a live
  fact exists.
- Sync never commits or pushes, never writes outside the memory
  directory, and refuses a memory directory that escapes.
```

Run: `bun test agents.test.ts && bunx remark --frail --quiet --no-stdout packages/memory/src/projects/AGENTS.md`
Expected: PASS, no output.

- [ ] **Step 6: Run the checks and commit**

Run: `bun run typecheck && bun run lint && bun run format:check && bun run lint:header`
Expected: PASS.

```bash
git add packages/memory/src/projects
git commit -m "feat(memory): Sync a project's facts with its repo" \
  -m "The store stays the truth: what changed on one side since the last
sync moves to the other, and when both changed the repository wins.
Personal facts never leave the store, a working tree's edit is never
overwritten, and sync never commits."
```

---

### Task 9: The commands

**Files:**

- Create: `packages/memory/src/facts/commands.ts`
- Create: `packages/memory/src/facts/commands.test.ts`
- Modify: `packages/memory/src/commands.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/src/index.test.ts`

**Interfaces:**

- Consumes: Task 3's store; Task 4's `projectsPath`, `readRegistry`;
  Task 8's `syncProject`, `SyncReport`; `RecallIndex`, `indexPath`;
  `OpenHistory`.
- Produces: `runFacts(options)`, `runRetire(target, options)`,
  `runRetireFrom(phrase, options)`, `runRevive(target, options)`,
  `runSync(path: string | null, options & { cwd?: string })`,
  `runProjects(options)`, each `Promise<number>`, exported from
  `@dorothy/memory/commands`; `formatFacts`, `formatReport`. CLI modes
  `facts`, `retire`, `retire-from`, `revive`, `sync`, `projects`.

- [ ] **Step 1: Write the failing command tests**

`packages/memory/src/facts/commands.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HistoryHandle, OpenHistory } from "../memory/sidecar.js";
import {
    runFacts,
    runProjects,
    runRetire,
    runRetireFrom,
    runRevive,
    runSync,
} from "./commands.js";
import type { Fact } from "./file.js";
import { dataRoot, PERSONAL, putFact, readFactFile, factPath, type Scope } from "./store.js";

const NOW = new Date("2026-10-15T09:30:00.000Z");
const PHRASE = "bingo-overabundance-mazer-kasha";
const PROJECT: Scope = { kind: "project", id: "github.com/chewygumxx/dorothy" };

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

let dir = "";
let env: Record<string, string> = {};
let out = capture();
let err = capture();
let commits: string[] = [];
beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "dorothy-fact-commands-")));
    env = {
        XDG_DATA_HOME: dir,
        XDG_CACHE_HOME: join(dir, "cache"),
        XDG_CONFIG_HOME: dir,
        HOME: dir,
    };
    out = capture();
    err = capture();
    commits = [];
});
afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

const history: OpenHistory = async (index) => {
    const handle: HistoryHandle = {
        recorder: async (_, message) => {
            commits.push(message);
        },
        lock: index?.lock ?? ((work) => work()),
        sweep: async () => {},
        heal: async () => false,
        close: () => {},
    };
    return handle;
};
const options = () => ({ env, out, err, now: () => NOW, openHistory: history });
const fact = (name: string, fields: Partial<Fact> = {}): Fact => ({
    name,
    title: name,
    description: `About ${name}.`,
    type: "user",
    extra: {},
    tags: [],
    importance: null,
    provenance: { origin: "user", by: "dorothy", at: NOW.toISOString(), created: NOW.toISOString() },
    retired: null,
    body: "Body.",
    ...fields,
});

describe("runFacts", () => {
    it("lists facts by scope, says which are retired, and names broken ones", async () => {
        const root = dataRoot(env);
        await putFact(root, PERSONAL, fact("likes-tea", { title: "Likes tea", description: "Prefers tea." }));
        await putFact(root, PROJECT, fact("gateway", {
            type: "project",
            title: "The gateway",
            description: "Rewrites the prompt.",
            retired: { at: NOW.toISOString(), by: "user", why: "Done." },
        }));
        await writeFile(join(root, "facts", "personal", "broken.md"), "x\n");
        expect(await runFacts(options())).toBe(0);
        expect(out.text).toBe(
            [
                "personal",
                "  user       likes-tea  Likes tea",
                "             Prefers tea.",
                "github.com/chewygumxx/dorothy",
                "  project    gateway  The gateway (retired)",
                "             Rewrites the prompt.",
                "",
            ].join("\n"),
        );
        expect(err.text).toBe(
            `dorothy: ${join(root, "facts", "personal", "broken.md")}: it has no frontmatter\n`,
        );
    });

    it("says when there are none", async () => {
        expect(await runFacts(options())).toBe(0);
        expect(out.text).toBe("No facts yet.\n");
    });
});

describe("retiring and reviving", () => {
    it("retires a fact as the user's choice, records it, and revives it", async () => {
        await putFact(dataRoot(env), PERSONAL, fact("likes-tea"));
        expect(await runRetire("personal/likes-tea", options())).toBe(0);
        expect(out.text).toBe("Retired personal/likes-tea.\n");
        const read = await readFactFile(factPath(dataRoot(env), PERSONAL, "likes-tea"), "likes-tea");
        expect(read.kind === "ok" && read.fact.retired?.by).toBe("user");
        expect(await runRetire("personal/likes-tea", options())).toBe(0);
        expect(out.text).toEndWith("personal/likes-tea was retired already.\n");
        expect(await runRevive("personal/likes-tea", options())).toBe(0);
        expect(out.text).toEndWith("Revived personal/likes-tea.\n");
        expect(commits).toEqual(["retire: personal/likes-tea", "revive: personal/likes-tea"]);
    });

    it("refuses a target that names no fact, and one that is missing", async () => {
        expect(await runRetire("likes-tea", options())).toBe(1);
        expect(err.text).toBe(
            "dorothy: likes-tea names no fact; give personal/<name> or <project id>/<name>\n",
        );
        expect(await runRevive("personal/nothing", options())).toBe(1);
        expect(err.text).toEndWith("dorothy: there is no fact personal/nothing\n");
    });

    it("retires what one conversation gave", async () => {
        await putFact(dataRoot(env), PERSONAL, fact("a", {
            provenance: { origin: "dorothy", by: "review", at: NOW.toISOString(), created: NOW.toISOString(), from: `${PHRASE}#2` },
        }));
        expect(await runRetireFrom(PHRASE, options())).toBe(0);
        expect(out.text).toBe(`Retired 1 fact from ${PHRASE}.\n`);
    });
});

describe("runSync and runProjects", () => {
    it("syncs the repository the working directory is in, and lists it", async () => {
        const repo = join(dir, "repo");
        await mkdir(join(repo, ".git"), { recursive: true });
        await writeFile(join(repo, ".git", "config"), '[remote "origin"]\n\turl = git@github.com:chewygumxx/dorothy.git\n');
        await mkdir(join(repo, ".agents", "memory"), { recursive: true });
        await writeFile(
            join(repo, ".agents", "memory", "a.md"),
            '---\nname: a\ndescription: "First."\nmetadata:\n  type: project\n---\n\nBody.\n',
        );
        expect(await runSync(null, { ...options(), cwd: repo })).toBe(0);
        expect(out.text).toBe("github.com/chewygumxx/dorothy: 1 in, 0 out (.agents/memory)\n");
        expect(commits).toEqual(["sync: github.com/chewygumxx/dorothy: 1 in, 0 out"]);
        const listed = capture();
        expect(await runProjects({ ...options(), out: listed })).toBe(0);
        expect(listed.text).toBe(`github.com/chewygumxx/dorothy  .agents/memory  ${repo}\n`);
    });

    it("says when the path is in no repository", async () => {
        expect(await runSync("elsewhere", { ...options(), cwd: dir })).toBe(1);
        expect(err.text).toBe(`dorothy: ${join(dir, "elsewhere")} is not in a git repository\n`);
    });

    it("says when there are no projects", async () => {
        expect(await runProjects(options())).toBe(0);
        expect(out.text).toBe("No projects yet.\n");
    });
});
```

`runSync("elsewhere", ...)` names a path that does not exist; `identify`
throws on it, so `runSync` checks the path exists first and reports it
as in no repository.

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/memory/src/facts/commands.test.ts`
Expected: FAIL, `Cannot find module './commands.js'`.

- [ ] **Step 3: Write `facts/commands.ts`**

```ts
// The commands over facts and projects: each opens the index for its
// lock, has history swept first, and writes through the store.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "@dorothy/core";
import type { OpenHistory } from "../memory/sidecar.js";
import { projectsPath, readRegistry } from "../projects/registry.js";
import { type SyncReport, syncProject } from "../projects/sync.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import {
    dataRoot,
    type FactResult,
    type FactStore,
    listFacts,
    parseTarget,
    retireFact,
    retireFacts,
    reviveFact,
    type Scope,
    type StoredFact,
    scopeLabel,
} from "./store.js";

export type Output = { write(text: string): unknown };
export type FactCommandOptions = {
    env?: Env;
    out?: Output;
    err?: Output;
    now?: () => Date;
    openHistory?: OpenHistory;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// The store under the index's lock, history swept first; null, said on
// err, when the index cannot be opened.
async function openStore({
    env = process.env,
    err = process.stderr,
    now,
    openHistory,
}: FactCommandOptions): Promise<{ store: FactStore; close(): void } | null> {
    let index: RecallIndex;
    try {
        index = RecallIndex.open(indexPath(env));
    } catch (error) {
        err.write(`dorothy: the memory index can't be opened: ${describeError(error)}\n`);
        return null;
    }
    const versions = (await openHistory?.(index)) ?? null;
    return {
        store: {
            root: dataRoot(env),
            lock: index.lock,
            recorder: versions?.recorder ?? null,
            ...(now === undefined ? {} : { now }),
        },
        close: () => {
            versions?.close();
            index.close();
        },
    };
}

export function formatFacts(facts: readonly StoredFact[]): string {
    if (facts.length === 0) {
        return "No facts yet.\n";
    }
    const lines: string[] = [];
    let scope: string | null = null;
    for (const { scope: of, fact } of facts) {
        const label = scopeLabel(of);
        if (label !== scope) {
            lines.push(label);
            scope = label;
        }
        lines.push(
            `  ${fact.type.padEnd(10)} ${fact.name}  ${fact.title}${fact.retired === null ? "" : " (retired)"}`,
        );
        lines.push(`             ${fact.description}`);
    }
    return `${lines.join("\n")}\n`;
}

export async function runFacts(options: FactCommandOptions = {}): Promise<number> {
    const { out = process.stdout, err = process.stderr } = options;
    const opened = await openStore(options);
    if (opened === null) {
        return 1;
    }
    try {
        const { facts, broken } = await listFacts(opened.store.root);
        for (const { path, reason } of broken) {
            err.write(`dorothy: ${path}: ${reason}\n`);
        }
        out.write(formatFacts(facts));
        return 0;
    } finally {
        opened.close();
    }
}

// --retire and --revive: one fact, by its target.
async function onTarget(
    target: string,
    options: FactCommandOptions,
    act: (store: FactStore, at: { scope: Scope; name: string }) => Promise<FactResult>,
    said: { done: string; already: string },
): Promise<number> {
    const { out = process.stdout, err = process.stderr } = options;
    const parsed = parseTarget(target);
    if (parsed === null) {
        err.write(
            `dorothy: ${target} names no fact; give personal/<name> or <project id>/<name>\n`,
        );
        return 1;
    }
    const opened = await openStore(options);
    if (opened === null) {
        return 1;
    }
    try {
        const result = await act(opened.store, parsed);
        if (result.kind === "written") {
            out.write(`${said.done} ${target}.\n`);
            return 0;
        }
        if (result.kind === "unchanged") {
            out.write(`${target} ${said.already}.\n`);
            return 0;
        }
        err.write(
            result.kind === "missing"
                ? `dorothy: there is no fact ${target}\n`
                : `dorothy: ${target}: ${result.reason}\n`,
        );
        return 1;
    } finally {
        opened.close();
    }
}

export function runRetire(target: string, options: FactCommandOptions = {}): Promise<number> {
    return onTarget(
        target,
        options,
        (store, at) => retireFact(store, at, { by: "user", why: "retired by the user" }),
        { done: "Retired", already: "was retired already" },
    );
}

export function runRevive(target: string, options: FactCommandOptions = {}): Promise<number> {
    return onTarget(target, options, reviveFact, {
        done: "Revived",
        already: "is not retired",
    });
}

export async function runRetireFrom(
    phrase: string,
    options: FactCommandOptions = {},
): Promise<number> {
    const { out = process.stdout, err = process.stderr } = options;
    const opened = await openStore(options);
    if (opened === null) {
        return 1;
    }
    try {
        const result = await retireFacts(opened.store, phrase, {
            by: "user",
            why: `retired with what ${phrase} gave`,
        });
        if (result.kind === "failed") {
            err.write(`dorothy: ${result.reason}\n`);
            return 1;
        }
        const count = result.retired.length;
        out.write(`Retired ${count} ${count === 1 ? "fact" : "facts"} from ${phrase}.\n`);
        return 0;
    } finally {
        opened.close();
    }
}

export function formatReport(report: SyncReport): string {
    const lines = [
        `${report.project.id}: ${report.imported.length + report.retired.length} in, ${report.exported.length + report.removed.length} out (${report.memoryDir})`,
        ...report.conflicts.map(
            (name) => `conflict: ${name}; the repository's version was kept`,
        ),
        ...report.skipped.map(({ name, reason }) => `skipped: ${name} (${reason})`),
    ];
    if (report.skipped.length > 0) {
        lines.push("MEMORY.md left as it is, as some files were skipped");
    }
    if (report.omitted > 0) {
        lines.push(
            `MEMORY.md leaves out ${report.omitted} facts, past what Claude Code loads`,
        );
    }
    return `${lines.join("\n")}\n`;
}

export async function runSync(
    path: string | null,
    options: FactCommandOptions & { cwd?: string } = {},
): Promise<number> {
    const { out = process.stdout, err = process.stderr, cwd = process.cwd() } = options;
    const target = resolve(cwd, path ?? ".");
    if (!existsSync(target)) {
        err.write(`dorothy: ${target} is not in a git repository\n`);
        return 1;
    }
    const opened = await openStore(options);
    if (opened === null) {
        return 1;
    }
    try {
        const { store } = opened;
        const result = await syncProject(target, {
            root: store.root,
            lock: store.lock,
            recorder: store.recorder,
            ...(store.now === undefined ? {} : { now: store.now }),
        });
        if (result.kind === "not-a-repository") {
            err.write(`dorothy: ${target} is not in a git repository\n`);
            return 1;
        }
        if (result.kind === "failed") {
            err.write(`dorothy: sync failed: ${result.reason}\n`);
            return 1;
        }
        out.write(formatReport(result.report));
        return 0;
    } finally {
        opened.close();
    }
}

export async function runProjects({
    env = process.env,
    out = process.stdout,
    err = process.stderr,
}: FactCommandOptions = {}): Promise<number> {
    const path = projectsPath(dataRoot(env));
    const read = await readRegistry(path);
    if (read.kind === "unparseable") {
        err.write(`dorothy: ${path}: ${read.reason}\n`);
        return 1;
    }
    const entries = read.kind === "ok" ? Object.entries(read.registry.projects) : [];
    if (entries.length === 0) {
        out.write("No projects yet.\n");
        return 0;
    }
    for (const [id, entry] of entries.sort(([a], [b]) => (a < b ? -1 : 1))) {
        out.write(`${id}  ${entry.memoryDir}  ${entry.roots.join(", ")}\n`);
    }
    return 0;
}
```

- [ ] **Step 4: Export the commands**

In `packages/memory/src/commands.ts`, add:

```ts
export {
    runFacts,
    runProjects,
    runRetire,
    runRetireFrom,
    runRevive,
    runSync,
} from "./facts/commands.js";
```

- [ ] **Step 5: Run the command tests to see them pass**

Run: `bun test packages/memory/src/facts`
Expected: PASS.

- [ ] **Step 6: Write the failing CLI tests**

Append to `packages/cli/src/index.test.ts`, inside
`describe("parseArgs", ...)`:

```ts
    it("parses the fact commands, terminal or not", () => {
        const RETIRE = "--retire takes <scope>/<name> or --from <phrase>";
        expect(parseArgs(["--facts"], false)).toEqual({ kind: "facts" });
        expect(parseArgs(["--facts", "x"], false)).toEqual({
            kind: "usage",
            message: "--facts takes no arguments",
        });
        expect(parseArgs(["--retire", "personal/likes-tea"], false)).toEqual({
            kind: "retire",
            target: "personal/likes-tea",
        });
        expect(parseArgs(["--retire", "--from", phrase], false)).toEqual({
            kind: "retire-from",
            phrase,
        });
        for (const rest of [[], ["--from"], ["--from", "nope"], ["a", "b"], ["-x"]]) {
            expect(parseArgs(["--retire", ...rest], false)).toEqual({
                kind: "usage",
                message: RETIRE,
            });
        }
        expect(parseArgs(["--revive", "personal/likes-tea"], true)).toEqual({
            kind: "revive",
            target: "personal/likes-tea",
        });
        expect(parseArgs(["--revive"], true)).toEqual({
            kind: "usage",
            message: "--revive takes <scope>/<name>",
        });
        expect(parseArgs(["--sync"], false)).toEqual({ kind: "sync", path: null });
        expect(parseArgs(["--sync", "../repo"], false)).toEqual({
            kind: "sync",
            path: "../repo",
        });
        expect(parseArgs(["--sync", "a", "b"], false)).toEqual({
            kind: "usage",
            message: "--sync takes [<path>]",
        });
        expect(parseArgs(["--projects"], false)).toEqual({ kind: "projects" });
        expect(parseArgs(["--projects", "x"], false)).toEqual({
            kind: "usage",
            message: "--projects takes no arguments",
        });
    });

    it("lists the fact commands in the usage", () => {
        for (const line of [
            "dorothy --facts            what Dorothy knows, by scope",
            "dorothy --retire <scope>/<name> | --from <phrase>",
            "dorothy --revive <scope>/<name>",
            "dorothy --sync [<path>]    sync a project's facts with its repo",
            "dorothy --projects         the projects Dorothy knows",
        ]) {
            expect(USAGE).toContain(line);
        }
    });
```

Run: `bun test packages/cli/src/index.test.ts`
Expected: FAIL: `--facts` is an unknown option.

- [ ] **Step 7: Parse, list and dispatch the commands**

In `packages/cli/src/index.ts`, add to `Mode`:

```ts
    | { kind: "facts" }
    | { kind: "retire"; target: string }
    | { kind: "retire-from"; phrase: string }
    | { kind: "revive"; target: string }
    | { kind: "sync"; path: string | null }
    | { kind: "projects" }
```

Add to `USAGE`, after the `--recover` line:

```ts
    "       dorothy --facts            what Dorothy knows, by scope",
    "       dorothy --retire <scope>/<name> | --from <phrase>",
    "                                  retire a fact, or what a chat gave",
    "       dorothy --revive <scope>/<name>",
    "                                  bring a retired fact back",
    "       dorothy --sync [<path>]    sync a project's facts with its repo",
    "       dorothy --projects         the projects Dorothy knows",
```

In `parseArgs`, before the `--recall-server` branch:

```ts
    if (first === "--facts" || first === "--projects") {
        return rest.length === 0
            ? { kind: first === "--facts" ? "facts" : "projects" }
            : { kind: "usage", message: `${first} takes no arguments` };
    }
    if (first === "--retire") {
        const usage = {
            kind: "usage" as const,
            message: "--retire takes <scope>/<name> or --from <phrase>",
        };
        if (rest[0] === "--from") {
            const phrase = rest[1];
            return rest.length === 2 && phrase !== undefined && isPhrase(phrase)
                ? { kind: "retire-from", phrase }
                : usage;
        }
        const target = rest[0];
        return rest.length === 1 && target !== undefined && !target.startsWith("-")
            ? { kind: "retire", target }
            : usage;
    }
    if (first === "--revive") {
        const target = rest[0];
        return rest.length === 1 && target !== undefined && !target.startsWith("-")
            ? { kind: "revive", target }
            : { kind: "usage", message: "--revive takes <scope>/<name>" };
    }
    if (first === "--sync") {
        return rest.length <= 1
            ? { kind: "sync", path: rest[0] ?? null }
            : { kind: "usage", message: "--sync takes [<path>]" };
    }
```

In the entry guard, after the `recover` branch:

```ts
    } else if (mode.kind === "facts") {
        const { commandHistory, runFacts } = await import("@dorothy/memory/commands");
        process.exitCode = await runFacts({ openHistory: commandHistory() });
    } else if (mode.kind === "retire" || mode.kind === "revive") {
        const { commandHistory, runRetire, runRevive } = await import(
            "@dorothy/memory/commands"
        );
        const run = mode.kind === "retire" ? runRetire : runRevive;
        process.exitCode = await run(mode.target, { openHistory: commandHistory() });
    } else if (mode.kind === "retire-from") {
        const { commandHistory, runRetireFrom } = await import(
            "@dorothy/memory/commands"
        );
        process.exitCode = await runRetireFrom(mode.phrase, {
            openHistory: commandHistory(),
        });
    } else if (mode.kind === "sync") {
        const { commandHistory, runSync } = await import("@dorothy/memory/commands");
        process.exitCode = await runSync(mode.path, { openHistory: commandHistory() });
    } else if (mode.kind === "projects") {
        const { runProjects } = await import("@dorothy/memory/commands");
        process.exitCode = await runProjects();
```

`bun run dev` runs from the repository root, so `--sync` without a path
syncs this repository; `userShell` is not needed, as `process.cwd()` is
where the user ran it from when they run `dorothy` directly.

- [ ] **Step 8: Run the tests to see them pass**

Run: `bun test packages/cli packages/memory && bun run typecheck`
Expected: PASS.

- [ ] **Step 9: Run the checks and commit**

Run: `bun run lint && bun run format:check`
Expected: PASS.

```bash
git add packages/memory/src/facts/commands.ts packages/memory/src/facts/commands.test.ts \
  packages/memory/src/commands.ts packages/cli/src/index.ts packages/cli/src/index.test.ts
git commit -m "feat(memory): List, retire and sync facts" \
  -m "dorothy --facts lists them by scope; --retire and --revive take a
fact, and --retire --from what one chat gave; --sync syncs the project
a path is in with its repository; --projects lists them."
```

---

### Task 10: Documentation, probe and report

**Files:**

- Modify: `packages/memory/AGENTS.md`, `packages/cli/AGENTS.md`,
  `README.md`, `docs/roadmap.md`
- Create: `docs/reports/<today>-memory-store-implementation.md`, with
  `<today>` the date the probe runs, `YYYY-MM-DD`

- [ ] **Step 1: Update `packages/memory/AGENTS.md`**

In "Entry points and imports", change the `"./commands"` bullet to:

```markdown
- `"./commands"` (`src/commands.ts`): `--list`, `--memory`, `--tags`,
  `--edit-tags`, `--facts`, `--retire`, `--revive`, `--sync`,
  `--projects`, the history commands and `commandHistory()`.
```

In "Files", replace the `transcript.ts` bullet with:

```markdown
- `transcript.ts`: transcripts, private JSONL under
  `$XDG_DATA_HOME/dorothy/`, of any body's sessions; a tool call is
  scrubbed of secrets (`scrub.ts`) and trimmed.
```

and add, after the `memory/vocabulary.ts` bullet:

```markdown
- `facts/`: facts, Markdown in one canonical form (`file.ts`), personal
  or a project's, written, moved, retired and revived under the sidecar
  lock (`store.ts`); `commands.ts` has the fact and project commands.
- `projects/`: a project's identity, registry, exported form and sync
  with its repository; read [its own guide](./src/projects/AGENTS.md).
```

In the `recall/` bullet, after "`tags.ts` mirrors the vocabulary;" add
"`facts.ts` indexes the store's facts;". In "Invariants", add:

```markdown
- Nothing deletes a fact: one retired stays indexed, searchable and in
  history. Its origin is set by the code that writes it, never read
  from its text, and only the user raises it.
```

In "See also", add the
[memory store](../../docs/specs/2026-10-15-memory-store-design.md) spec
to the list of specs.

Run: `bun test agents.test.ts && bunx remark --frail --quiet --no-stdout packages/memory/AGENTS.md`
Expected: PASS; the file at most 150 lines. If it is over, move the
`compaction/` bullet's second and third sentences into a new
`packages/memory/src/compaction/AGENTS.md` written as Task 8 wrote the
projects guide, leaving the first sentence and a link.

- [ ] **Step 2: Update `packages/cli/AGENTS.md`**

Replace the last invariant with:

```markdown
- The CLI passes `commandHistory()` to memory's commands, the fact and
  project commands among them, and `editInEditor` to `--memory` and
  `--edit-tags`.
```

- [ ] **Step 3: Update `README.md`**

In "Memory", after the paragraph that ends "`--restore` and
`--rollback` take as `<rev>`.", add:

````markdown
Beside her notes on each chat, Dorothy keeps facts: what she knows of
you, your work and what has worked, one Markdown file each under
`facts/` in the data directory. A fact is personal or a project's, and a
project is the git repository you are in, named by its `origin`. A
project's facts are synced with its repository's `.agents/memory/`, the
format Claude Code's auto-memory reads, so its other contributors' agents
read them too; personal facts never leave her store. Nothing is
forgotten: a fact you retire leaves the repository and her context but
stays searchable, and can be revived.

```sh
bun run dev -- --facts                        # what she knows, by scope
bun run dev -- --retire personal/<name>       # retire a fact
bun run dev -- --retire --from <phrase>       # retire what a chat gave
bun run dev -- --revive personal/<name>       # bring it back
bun run dev -- --sync [<path>]                # sync a project with its repo
bun run dev -- --projects                     # the projects she knows
```

Sync never commits: the files it writes are committed with your work.
When a fact changed both in her store and in the repository, the
repository's version is kept, and hers stays in her history.
````

- [ ] **Step 4: Update `docs/roadmap.md`**

In "Dorothy's Memory", set:

```markdown
- **Status**: Store Built; Bodies Pending Design
```

and append to its description: "The store: [spec](./specs/2026-10-15-memory-store-design.md),
[plan](./plans/2026-10-15-memory-store.md), [report](./reports/<today>-memory-store-implementation.md)."
wrapped to 80 columns, with `<today>` the report's date.

- [ ] **Step 5: Run the probe, in scratch directories only**

The probe adopts this repository's real `.agents/memory/` into a scratch
store through a scratch clone; it never touches the user's data
directory or this checkout's working tree.

```bash
REPO=$(git rev-parse --show-toplevel)
P=$(mktemp -d)
export XDG_DATA_HOME=$P/data XDG_CACHE_HOME=$P/cache XDG_CONFIG_HOME=$P/config
D="bun $REPO/packages/cli/src/index.ts"
git clone -q "$REPO" "$P/dorothy"
git -C "$P/dorothy" remote set-url origin git@github.com:chewygumxx/dorothy.git
$D --sync "$P/dorothy"
$D --facts
$D --projects
git -C "$P/dorothy" diff --stat
$D --sync "$P/dorothy"
$D --retire github.com/chewygumxx/dorothy/bg-session-force-color
$D --sync "$P/dorothy"; ls "$P/dorothy/.agents/memory"
$D --revive github.com/chewygumxx/dorothy/bg-session-force-color
$D --sync "$P/dorothy"; ls "$P/dorothy/.agents/memory"
sed -i 's/FORCE_COLOR=3/FORCE_COLOR=3 (probed)/' "$P/dorothy/.agents/memory/bg-session-force-color.md"
$D --sync "$P/dorothy"
$D --history -n 12
rm -rf "$P"
```

Expected:

- The first sync reads `github.com/chewygumxx/dorothy: 4 in, 0 out
  (.agents/memory)`; `--facts` lists the four under that project with
  their `MEMORY.md` titles; the diff touches only `MEMORY.md`, its hooks
  replaced by the facts' descriptions.
- The second sync reads `0 in, 0 out`.
- Retiring removes `bg-session-force-color.md` at the next sync
  (`0 in, 1 out`); reviving brings it back (`0 in, 1 out`).
- The edit in the clone imports (`1 in, 0 out`).
- `--history` shows `adopt`, the `sync:`, `retire:` and `revive:`
  commits in order.

If any differs, stop and use `systematic-debugging`; the probe's output
is evidence, not a step to make pass.

- [ ] **Step 6: Write the report**

`docs/reports/<today>-memory-store-implementation.md`, its header copied
from `docs/reports/2026-10-15-identity-gateway-implementation.md` with
the title "Memory store implementation report", tags `dorothy`,
`memory`, `report`, and these sections:

- **Summary**: what the store now does, in a paragraph.
- **The probe**: the commands of Step 5 and their output, verbatim,
  in a fenced block.
- **Rulings**: the nine rulings of this plan, one line each, and any
  made during the work.
- **Verification**: `bun run check`'s last lines, with the count of
  tests before (1,234) and after.
- **Commits**: `git log --oneline main..HEAD`.
- **Known limitations**: the spec's known risks that remain, and that
  a fact retired by a repository deletion leaves the last `MEMORY.md`
  as it was until a live fact is synced.

- [ ] **Step 7: Run everything and commit**

Run: `bun run check`
Expected: PASS, with the test count above 1,234.

```bash
git add packages/memory/AGENTS.md packages/cli/AGENTS.md README.md docs/roadmap.md docs/reports
git commit -m "docs: Report the memory store" \
  -m "The guides, README and roadmap describe facts, projects and sync;
the report records the probe against this repository's own memory."
```
