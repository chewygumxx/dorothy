---
ctime: 2026-10-07
mtime: 2026-10-07
spdx: GPL-3.0-only
title: Compaction implementation plan
description: "Plan for compacting a long conversation into clusters"
tags:
  - dorothy
  - memory
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-07-compaction.md
   -
   -->

# Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A long conversation decays from context into memory: its older
turns are compacted into topical clusters, each summarised by Dorothy in an
abstract that stays in her context, each openable word for word through
`recollect`, while the CLI's own compaction stays off.

**Architecture:** `src/compaction/` is SDK-free: it plans what leaves the
verbatim tail, asks Dorothy for clusters through an injected
`StructuredCall`, and wraps the `ChatSession` so that, between turns, a new
`Conversation` seeded with the abstracts and the tail takes over.
`src/structured.ts` implements `StructuredCall` over a one-shot `query()`,
and reviews move onto it. Clusters live in the sidecar, a `compaction` event
in the transcript, and a `clusters` table in the recall index, which serves
`recollect` beside `search` and `open`.

**Tech Stack:** Bun 1.4 (`bun:sqlite` with FTS5, `bun test`), TypeScript 7,
`@modelcontextprotocol/sdk` 1.31, `zod` 4, `@anthropic-ai/claude-agent-sdk`
(adapters only), Ink.

**Spec:** `docs/specs/2026-10-07-compaction-design.md`, which builds on
`docs/specs/2026-10-06-recall-design.md` and
`docs/specs/2026-10-05-conversation-catalogue-design.md`.

## Global Constraints

- Every new source file starts with the repository header, copied from
  `src/persona.ts` with its own path in the `::: :/` breadcrumb.
- No em dashes (U+2014) in any file; `bun run lint:emdash` must pass.
- Commits: Conventional Commits, header at most 50 characters, body lines
  at most 72, one line unless a body is warranted. Scopes, as
  `.commitlintrc.mts` allows: `sdk` for `src/` outside `src/tui/` and
  `src/compaction/`, `tui` for `src/tui/`, `config` for `src/config.ts`;
  `src/compaction/` (SDK-free) and docs take no scope, `.claude/` takes
  `claude`. Each task's commit command gives the exact message.
- Before each commit run `bunx biome check --write <touched files>`; the
  pre-commit hook rejects unformatted files and import order.
- After committing, confirm with `git log --oneline -1` and `git status`.
- Work on the plain branch `feat/compaction` in the main checkout; no
  worktrees.
- Nothing in `src/compaction/` imports `@anthropic-ai/claude-agent-sdk`;
  `src/tui/` imports none either; `src/recall/` still imports none. Type
  imports from `../conversation.js` are allowed in `src/compaction/`, as
  they are in `src/tui/state.ts`.
- `src/tui/` imports `../compaction/` only from `run.tsx`.
- Never edit `dist/`. Set `.env` values only with `dotenvx set`.
- Tests and probes never touch real user data: transcripts, config and the
  index live in temporary directories.
- Values, verbatim from the spec: `[compaction]` defaults `enabled = true`,
  `soft = 64000` (2000 to 900000), `hard = 128000` (4000 to 950000),
  `tail = 16000` (500 to 200000), and `tail < soft < hard`; `[memory]
  budget` defaults to 4000; an abstract holds at most 1000 code points;
  `DISABLE_COMPACT=1` on every CLI call; the call's timeout is the review's,
  120 seconds; after three failed compactions in a run, none until the next
  launch; each failure doubles the idle wait before the next try.
- User-visible texts, verbatim: `compacting…`;
  `compacted turns <from>-<through> into <n> cluster(s)` (`cluster` for
  one); `⌕ recollected cluster <n>, turns <a>-<b>`;
  `⌕ couldn't recollect cluster <n>`.
- Tool error texts, verbatim: `No cluster by that number.`,
  `turn must be from <from> to <through>, within cluster <n>.`,
  `Give some words to look for.`
- `bun run check` passes at the end of every task.

## Rulings

Where this plan settles what the spec leaves open or adjusts it:

- **The context size** is the last assistant message's input (uncached,
  cache read and cache write) plus the reply's estimated tokens, falling back
  to the result's usage when no assistant message carried usage. The result's
  own usage sums every request of a turn, so a turn with lookups would
  overstate it. It rides on `turn-end` as an optional `contextTokens`.
- **Offering `recollect`.** `allowedTools` does not hide a tool from the
  model, only its permission, so the server registers `recollect` only when
  launched with `--recollect`. `conversationOptions` adds the flag and the
  allowed tool whenever the session is seeded with clusters, so the two never
  disagree.
- **Invalid clusters in a sidecar** are dropped silently from the first
  invalid one on, as every other malformed sidecar field reads as absent;
  sidecar readers have no warning channel. The next compaction covers the
  turns again.
- **`StructuredCall`** lives in `src/compaction/types.ts`. Its request also
  carries `timeoutMs` and `what` (the noun in "the review ended without a
  result"); its outcome is a union so that a failed call still reports its
  cost. `runReview` is rebuilt on `structuredCall()` rather than duplicated.
- **Compaction and reviews never run at once** for one conversation: both
  take its claim in the index. The order is not enforced. A compaction that
  is holding a message retries the claim every 2 seconds; any other gives up
  until the next idle.
- **Costs** of compaction calls reach `memory-cost` through a new
  `memory-cost` conversation event, so the wrapper needs no notice channel of
  its own.
- **The compaction lines** reuse the dim, unlabelled `lookup` line role, and
  are shown live only; a resumed chat shows none.
- **Reviews** of a compacted conversation list its pending reads as before;
  reads made in compacted turns are listed without a mark in the text.
- **Without a transcript** (it could not be opened), new clusters are kept in
  memory only: there is no conversation for a sidecar to describe.
- **The `DISABLE_COMPACT` probe** runs against the live API with a tiny
  compaction window: the capture server answers every request with an error,
  so the CLI never gets far enough to compact through it. The probe watches
  for `compact_boundary` messages.
- **Config parsing** of `[memory]` and `[compaction]` shares one table
  parser instead of repeating the loop.

## Review Focus

The inputs most likely to bite a user that the spec implies but does not
spell out; each has a test in the task named.

1. A message sent while an idle compaction is running reaches the old
   session, and its turns land in the new session's tail, not in a cluster
   (Task 12).
2. Reconnecting after an error, once compacted, seeds the abstracts and the
   tail, never the whole conversation again (Task 12).
3. A latest exchange larger than the tail budget is still kept whole, and
   with nothing else to compact, compaction is skipped until another
   exchange (Task 10, Task 12).
4. `recollect` with words that match only before `turn`, or only in another
   cluster, reports no match rather than reading outside the range
   (Task 6).
5. Quitting while Dorothy's call runs writes nothing: no clusters in the
   sidecar and no `compaction` event (Task 12).

## File Structure

| File                              | Responsibility                                                             |
| --------------------------------- | -------------------------------------------------------------------------- |
| `src/compaction/types.ts`         | `StructuredRequest`, `StructuredOutcome`, `StructuredCall`                 |
| `src/compaction/plan.ts`          | the outgoing range, the seed's turns, cluster tokens, pressure             |
| `src/compaction/clusters.ts`      | Dorothy's instructions, prompt, schema and validation                      |
| `src/compaction/compact.ts`       | one compaction: plan, call, validate                                       |
| `src/compaction/session.ts`       | `Compaction` and its compacting `ChatSession` wrapper                      |
| `src/compaction/boundary.test.ts` | no Agent SDK in `src/compaction/`                                          |
| `src/structured.ts`               | `structuredCall()` over a one-shot `query()`                               |
| `src/persona.ts`                  | `DISABLE_COMPACT`, `withClusters`                                          |
| `src/conversation.ts`             | `contextTokens`, `compact_boundary`, clusters in the options, events       |
| `src/config.ts`                   | `[compaction]`, the budget default, the shared table parser                |
| `src/memory/sidecar.ts`           | `Cluster`, `clusters`, `appendClusters`                                    |
| `src/memory/block.ts`             | `unescapeXml`, moved from `review.ts`                                      |
| `src/memory/rank.ts`              | `buildMemory` with `reserved`                                              |
| `src/memory/service.ts`           | `block(reserved)`, the clusters instruction in reviews                     |
| `src/memory/review.ts`            | the review prompt over abstracts and tail; `runReview` on `structuredCall` |
| `src/transcript.ts`               | the `compaction` event, the `recollect` lookup                             |
| `src/recall/types.ts`             | `recollect`'s names, input, result and lookup                              |
| `src/recall/store.ts`, `sync.ts`  | the `clusters` table                                                       |
| `src/recall/query.ts`             | `recollect`                                                                |
| `src/recall/server.ts`            | registering `recollect`                                                    |
| `src/index.ts`                    | `--recall-server --exclude <phrase> --recollect`                           |
| `src/tui/state.ts`                | the compaction lines, the recollect line, `memory-cost` events             |
| `src/tui/run.tsx`                 | seeding from clusters, wiring `Compaction`                                 |
| `src/dump.ts`                     | `--dump-context --resume` shows the compacted seed                         |

---

### Task 1: The CLI's compaction off, and the context size

**Files:**

- Modify: `src/persona.ts` (`cliOptions`)
- Modify: `src/conversation.ts` (`ConversationEvent`, `#handleMessage`)
- Test: `src/persona.test.ts`, `src/conversation.test.ts`

**Interfaces:**

- Produces: `cliOptions(env).env.DISABLE_COMPACT === "1"`; the `turn-end`
  event gains `contextTokens?: number`, always set by `Conversation`;
  `COMPACTED_BY_CLI`, the error text for a `compact_boundary` message.

- [ ] **Step 1: Write the failing tests**

In `src/persona.test.ts`, inside `describe("cliOptions", ...)`, add:

```ts
    it("switches off the CLI's own compaction, automatic and manual", () => {
        expect(cliOptions(env).env).toMatchObject({ DISABLE_COMPACT: "1" });
    });
```

In `src/conversation.test.ts`, add `COMPACTED_BY_CLI` to the import from
`./conversation.js`, add these helpers after `executionError`:

```ts
// What the CLI says each time a request's response arrives: the usage of
// that one request, not the turn's.
const usage = (input: number, cacheRead: number, cacheWrite: number) =>
    ({
        type: "assistant",
        message: {
            content: [],
            usage: {
                input_tokens: input,
                cache_read_input_tokens: cacheRead,
                cache_creation_input_tokens: cacheWrite,
                output_tokens: 1,
            },
        },
        parent_tool_use_id: null,
    }) as unknown as SDKMessage;
const compactBoundary = () =>
    ({
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { trigger: "auto", pre_tokens: 100 },
    }) as unknown as SDKMessage;
```

and these tests inside `describe("Conversation", ...)`:

```ts
    it("measures the context from the last request, plus the reply", async () => {
        const fake = fakeQuery([
            [
                usage(5, 1000, 100),
                usage(7, 2000, 300),
                delta("12345678"),
                result(0.001),
            ],
        ]);
        const { conversation, events } = started(fake);
        conversation.send("hi");
        await until(() => of(events, "turn-end").length === 1);
        // 7 + 2000 + 300, and 8 characters of reply at 4 a token.
        expect(of(events, "turn-end")[0]?.contextTokens).toBe(2309);
    });

    it("falls back on the turn's usage when no request reported any", async () => {
        const fake = fakeQuery([[delta("Hello"), result(0.001)]]);
        const { conversation, events } = started(fake);
        conversation.send("hi");
        await until(() => of(events, "turn-end").length === 1);
        // 10 + 3000 + 400 from the result, and 5 characters of reply.
        expect(of(events, "turn-end")[0]?.contextTokens).toBe(3412);
    });

    it("measures each turn afresh", async () => {
        const fake = fakeQuery([
            [usage(1, 100, 0), result(0.001)],
            [result(0.002)],
        ]);
        const { conversation, events } = started(fake);
        conversation.send("one");
        await until(() => of(events, "turn-end").length === 1);
        conversation.send("two");
        await until(() => of(events, "turn-end").length === 2);
        expect(of(events, "turn-end").map((e) => e.contextTokens)).toEqual([
            101, 3410,
        ]);
    });

    it("reports the CLI compacting on its own as an error", async () => {
        const fake = fakeQuery([[compactBoundary()]]);
        const { conversation, events } = started(fake);
        conversation.send("hi");
        await until(() => of(events, "error").length === 1);
        expect(of(events, "error")[0]?.message).toBe(COMPACTED_BY_CLI);
    });
```

In the existing test "streams deltas and ends the turn with reply and
stats", add `contextTokens: 3412,` after `interrupted: false,` in the
expected `turn-end` event.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/persona.test.ts src/conversation.test.ts`
Expected: FAIL: `DISABLE_COMPACT` missing; `COMPACTED_BY_CLI` is not
exported; `contextTokens` is undefined.

- [ ] **Step 3: Implement**

In `src/persona.ts`, extend the comment above `cliOptions` and its `env`:

```ts
// settingSources does not cover what the CLI reads outside its settings
// files. From the user's config directory it takes the signed-in account,
// and tells Dorothy the user's email address; from the working directory's
// repository, its auto-memory, git status and worktree instructions. Applied
// at each call, after dotenvx has loaded the credentials into process.env.
// Compaction is Dorothy's own (src/compaction/): DISABLE_COMPACT switches
// the CLI's off, automatic and /compact alike.
export function cliOptions(
    env: Env = process.env,
): Pick<Options, "cwd" | "env"> {
    const home = cliHome(env);
    return {
        cwd: home,
        env: {
            ...env,
            CLAUDE_CONFIG_DIR: home,
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
            DISABLE_COMPACT: "1",
        },
    };
}
```

In `src/conversation.ts`, change the `turn-end` member of
`ConversationEvent`:

```ts
    | {
          type: "turn-end";
          reply: string;
          interrupted: boolean;
          stats: TurnStats;
          // Estimated tokens the next request starts from: what the last
          // request read, plus the reply it added. Conversation always sets
          // it.
          contextTokens?: number;
      }
```

Add, after `CLOSE_GRACE_MS`:

```ts
// DISABLE_COMPACT keeps the CLI from compacting; if it ever does, the
// conversation it summarised is no longer the one Dorothy's compaction
// planned, so the session is given up rather than silently continued.
export const COMPACTED_BY_CLI =
    "the CLI compacted this session itself, despite DISABLE_COMPACT";

// Characters as the note limits count them, four to a token.
const estimate = (text: string) => Math.ceil([...text].length / 4);
```

Add a field to the class, after `#ready = false;`:

```ts
    // What the latest request of this turn read, from its usage.
    #lastInput: number | null = null;
```

In `#handleMessage`, before the `if (message.type === "system" &&
message.subtype === "init")` check, add:

```ts
        if (message.type === "system" && message.subtype === "compact_boundary") {
            this.#fail(COMPACTED_BY_CLI);
            return;
        }
```

In the `message.type === "assistant"` branch, before the `for` loop, add:

```ts
            const usage = message.message.usage;
            if (usage !== undefined && usage !== null) {
                this.#lastInput =
                    usage.input_tokens +
                    (usage.cache_read_input_tokens ?? 0) +
                    (usage.cache_creation_input_tokens ?? 0);
            }
```

Replace the final `else if (message.type === "result")` branch with:

```ts
        } else if (message.type === "result") {
            this.#settleCalls();
            const stats = this.#stats(message);
            const read =
                this.#lastInput ??
                stats.inputTokens +
                    stats.cacheReadTokens +
                    stats.cacheWriteTokens;
            this.#emit({
                type: "turn-end",
                reply: this.#reply,
                interrupted: this.#interrupted,
                stats,
                contextTokens: read + estimate(this.#reply),
            });
            this.#reply = "";
            this.#interrupted = false;
            this.#streaming = false;
            this.#lastInput = null;
        }
```

In the `is_error` result branch, add `this.#lastInput = null;` after
`this.#streaming = false;`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/persona.test.ts src/conversation.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
bunx biome check --write src/persona.ts src/persona.test.ts src/conversation.ts src/conversation.test.ts
bun run check
git add src/persona.ts src/persona.test.ts src/conversation.ts src/conversation.test.ts
git commit -m "feat(sdk): Keep compaction from the CLI" -m "Measure each turn's context for Dorothy's own compaction."
git log --oneline -1 && git status --short
```

### Task 2: The `[compaction]` table and a larger budget

**Files:**

- Modify: `src/config.ts`
- Test: `src/config.test.ts`

**Interfaces:**

- Produces: `type CompactionConfig = { enabled: boolean; soft: number;
  hard: number; tail: number }`; `Config.compaction`;
  `DEFAULT_CONFIG.compaction = { enabled: true, soft: 64000, hard: 128000,
  tail: 16000 }`; `DEFAULT_CONFIG.memory.budget === 4000`.

- [ ] **Step 1: Write the failing tests**

In `src/config.test.ts`, inside the top-level `describe` for `parseConfig`,
add:

```ts
    it("budgets 4000 tokens of memory by default", () => {
        expect(DEFAULT_CONFIG.memory.budget).toBe(4000);
    });

    it("reads the compaction table", () => {
        const text = [
            "[compaction]",
            "enabled = false",
            "soft = 3000",
            "hard = 5000",
            "tail = 1000",
        ].join("\n");
        expect(parseConfig(text)).toEqual({
            config: {
                ...DEFAULT_CONFIG,
                compaction: {
                    enabled: false,
                    soft: 3000,
                    hard: 5000,
                    tail: 1000,
                },
            },
            warnings: [],
        });
    });

    it("warns of each bad compaction value and keeps its default", () => {
        const text = [
            "[compaction]",
            'enabled = "no"',
            "soft = 1000",
            "hard = 960000",
            "tail = 2.5",
            "speed = 1",
        ].join("\n");
        expect(parseConfig(text)).toEqual({
            config: DEFAULT_CONFIG,
            warnings: [
                "config.toml: compaction.enabled must be true or false",
                "config.toml: compaction.soft must be a whole number from 2000 to 900000",
                "config.toml: compaction.hard must be a whole number from 4000 to 950000",
                "config.toml: compaction.tail must be a whole number from 500 to 200000",
                "config.toml: unknown key compaction.speed",
            ],
        });
    });

    it("takes all three defaults when tail < soft < hard fails", () => {
        const { config, warnings } = parseConfig(
            "[compaction]\nsoft = 9000\nhard = 8000\n",
        );
        expect(config.compaction).toEqual(DEFAULT_CONFIG.compaction);
        expect(warnings).toEqual([
            "config.toml: compaction needs tail < soft < hard; using the defaults for all three",
        ]);
    });

    it("keeps a soft below the default tail as long as tail is lowered too", () => {
        const { config, warnings } = parseConfig(
            "[compaction]\nsoft = 3000\nhard = 6000\ntail = 600\n",
        );
        expect(config.compaction).toEqual({
            enabled: true,
            soft: 3000,
            hard: 6000,
            tail: 600,
        });
        expect(warnings).toEqual([]);
    });

    it("warns when compaction is not a table", () => {
        expect(parseConfig("compaction = 1")).toEqual({
            config: DEFAULT_CONFIG,
            warnings: ["config.toml: compaction is not a table"],
        });
    });
```

The existing expectations that spell out a whole `config` object with
`memory: DEFAULT_CONFIG.memory` and no `compaction` (the statusline test)
need `compaction: DEFAULT_CONFIG.compaction` added; the ones that spread
`...DEFAULT_CONFIG` already have it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/config.test.ts`
Expected: FAIL: the budget is 2000; `compaction` is an unknown key.

- [ ] **Step 3: Implement**

In `src/config.ts`, add after `MemoryConfig`:

```ts
export type CompactionConfig = {
    enabled: boolean;
    // Context tokens past which compaction runs at the next idle.
    soft: number;
    // Context tokens past which the next message waits for it.
    hard: number;
    // Estimated tokens of the newest turns kept word for word.
    tail: number;
};
```

Add `compaction: CompactionConfig;` to `Config`, set `budget: 4000` in
`DEFAULT_CONFIG.memory`, and add to `DEFAULT_CONFIG`:

```ts
    compaction: {
        enabled: true,
        soft: 64000,
        hard: 128000,
        tail: 16000,
    },
```

Replace `MEMORY_SWITCHES`, `MEMORY_NUMBERS` and `parseMemory` with one
table parser and its two uses:

```ts
type NumberKey<T> = readonly [
    key: string,
    field: keyof T,
    min: number,
    max: number,
];

// A table of switches and whole numbers: each bad value warns and keeps its
// default.
function parseTable<T extends Record<string, boolean | number>>(
    table: string,
    value: unknown,
    defaults: T,
    switches: readonly (keyof T & string)[],
    numbers: readonly NumberKey<T>[],
    warnings: string[],
): T {
    if (!isRecord(value)) {
        warnings.push(`config.toml: ${table} is not a table`);
        return defaults;
    }
    const parsed: Record<string, boolean | number> = { ...defaults };
    for (const [key, field] of Object.entries(value)) {
        const toggle = switches.find((name) => name === key);
        const number = numbers.find(([name]) => name === key);
        if (toggle !== undefined) {
            if (typeof field === "boolean") {
                parsed[toggle] = field;
            } else {
                warnings.push(
                    `config.toml: ${table}.${key} must be true or false`,
                );
            }
        } else if (number !== undefined) {
            const [, name, min, max] = number;
            if (
                typeof field === "number" &&
                Number.isInteger(field) &&
                field >= min &&
                field <= max
            ) {
                parsed[name as string] = field;
            } else {
                warnings.push(
                    `config.toml: ${table}.${key} must be a whole number from ${min} to ${max}`,
                );
            }
        } else {
            warnings.push(`config.toml: unknown key ${table}.${key}`);
        }
    }
    return parsed as T;
}

const parseMemory = (value: unknown, warnings: string[]): MemoryConfig =>
    parseTable(
        "memory",
        value,
        DEFAULT_CONFIG.memory,
        ["enabled", "recall"],
        [
            ["budget", "budget", 200, 20000],
            ["idle-seconds", "idleSeconds", 10, 3600],
            ["half-life-days", "halfLifeDays", 1, 3650],
            ["catch-up", "catchUp", 0, 50],
        ],
        warnings,
    );

// The thresholds only make sense together: compacting must leave a tail
// smaller than what set it off, below the point that holds a message.
function parseCompaction(
    value: unknown,
    warnings: string[],
): CompactionConfig {
    const parsed = parseTable(
        "compaction",
        value,
        DEFAULT_CONFIG.compaction,
        ["enabled"],
        [
            ["soft", "soft", 2000, 900000],
            ["hard", "hard", 4000, 950000],
            ["tail", "tail", 500, 200000],
        ],
        warnings,
    );
    if (parsed.tail < parsed.soft && parsed.soft < parsed.hard) {
        return parsed;
    }
    warnings.push(
        "config.toml: compaction needs tail < soft < hard; using the defaults for all three",
    );
    const { soft, hard, tail } = DEFAULT_CONFIG.compaction;
    return { ...parsed, soft, hard, tail };
}
```

In `parseConfig`, add a branch after the `memory` one:

```ts
        } else if (key === "compaction") {
            config.compaction = parseCompaction(value, warnings);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/config.test.ts`
Expected: PASS, including the existing `[memory]` tests unchanged.

- [ ] **Step 5: Check and commit**

```bash
bunx biome check --write src/config.ts src/config.test.ts
bun run check
git add src/config.ts src/config.test.ts
git commit -m "feat(config): Add [compaction], raise the budget"
git log --oneline -1 && git status --short
```

### Task 3: Clusters in the sidecar, compaction in the transcript

**Files:**

- Modify: `src/memory/sidecar.ts`
- Modify: `src/transcript.ts`
- Test: `src/memory/sidecar.test.ts`, `src/transcript.test.ts`

**Interfaces:**

- Produces: `type Cluster = { from: number; through: number; abstract:
  string; at: string; model: string }`; `Sidecar.clusters: Cluster[]`
  (oldest first, `[]` in `EMPTY_SIDECAR`); `appendClusters(current: Sidecar
  | null, clusters: readonly Cluster[]): Sidecar | null`; `type
  CompactionEvent = { v: 1; kind: "compaction"; at: string; through:
  number; clusters: number }` in `TranscriptEvent`; `toTurn` ignores
  `compaction`.

- [ ] **Step 1: Write the failing tests**

In `src/memory/sidecar.test.ts`, add `appendClusters` and `type Cluster` to
the import from `./sidecar.js`, and add:

```ts
const cluster = (from: number, through: number, abstract = "About it.") =>
    ({
        from,
        through,
        abstract,
        at: "2026-10-07T08:00:00.000Z",
        model: "claude-test",
    }) satisfies Cluster;

describe("clusters", () => {
    it("are empty in a new sidecar and in one written before them", () => {
        expect(EMPTY_SIDECAR.clusters).toEqual([]);
        const read = parseSidecar(JSON.stringify({ v: 1, title: "T" }));
        expect(read.kind === "ok" && read.sidecar.clusters).toEqual([]);
    });

    it("read back as written, normalised", () => {
        const read = parseSidecar(
            JSON.stringify({
                ...EMPTY_SIDECAR,
                clusters: [
                    cluster(1, 4, "  Cats\nand  dogs. "),
                    cluster(5, 9),
                ],
            }),
        );
        expect(read.kind === "ok" && read.sidecar.clusters).toEqual([
            cluster(1, 4, "Cats and dogs."),
            cluster(5, 9),
        ]);
    });

    it("stop at the first that does not follow on", () => {
        const bad = [
            [cluster(2, 4)],
            [cluster(1, 4), cluster(6, 9)],
            [cluster(1, 4), cluster(5, 4)],
            [cluster(1, 4), cluster(5, 9, "   ")],
            [cluster(1, 4), cluster(5, 9, "x".repeat(1001))],
            [cluster(1, 4), { ...cluster(5, 9), at: 3 }],
            [cluster(1, 4), { ...cluster(5, 9), model: null }],
            [cluster(1, 4), { ...cluster(5, 9), from: 5.5 }],
        ];
        for (const clusters of bad) {
            const read = parseSidecar(
                JSON.stringify({ ...EMPTY_SIDECAR, clusters }),
            );
            expect(
                read.kind === "ok" &&
                    read.sidecar.clusters.map((kept) => kept.through),
            ).toEqual(clusters[0]?.from === 1 ? [4] : []);
        }
    });

    it("are appended when they follow on", () => {
        const first = appendClusters(null, [cluster(1, 4), cluster(5, 9)]);
        expect(first?.clusters.map((kept) => kept.through)).toEqual([4, 9]);
        const next = appendClusters(first, [cluster(10, 12)]);
        expect(next?.clusters.map((kept) => kept.from)).toEqual([1, 5, 10]);
    });

    it("are not appended over turns already covered, or past a gap", () => {
        const first = appendClusters(null, [cluster(1, 4)]);
        expect(appendClusters(first, [cluster(3, 6)])).toBeNull();
        expect(appendClusters(first, [cluster(6, 8)])).toBeNull();
        expect(appendClusters(first, [])).toBeNull();
    });
});
```

Existing tests in that file that compare a whole parsed sidecar with
`toEqual` against an object built without `...EMPTY_SIDECAR` need
`clusters: []` added.

In `src/transcript.test.ts`, add:

```ts
describe("compaction events", () => {
    it("are not turns, and are not malformed", () => {
        expect(
            toTurn({ v: 1, kind: "compaction", at: "x", through: 4, clusters: 1 }),
        ).toBe("ignore");
        const read = parseTranscript(
            [
                JSON.stringify({ v: 1, kind: "user", at: "a", text: "Hi." }),
                JSON.stringify({
                    v: 1,
                    kind: "compaction",
                    at: "b",
                    through: 1,
                    clusters: 1,
                }),
                JSON.stringify({
                    v: 1,
                    kind: "assistant",
                    at: "c",
                    text: "Hello.",
                    interrupted: false,
                }),
            ].join("\n"),
        );
        expect(read.turns.map((turn) => turn.text)).toEqual(["Hi.", "Hello."]);
        expect(read.skipped).toBe(0);
    });
});
```

(Add `toTurn` and `parseTranscript` to that file's import from
`./transcript.js` if they are not there already.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/memory/sidecar.test.ts src/transcript.test.ts`
Expected: FAIL: `appendClusters` is not exported; `clusters` is undefined;
the compaction line is counted as skipped.

- [ ] **Step 3: Implement**

In `src/memory/sidecar.ts`, after `Failures`, add:

```ts
// A run of a conversation's turns that compaction took out of Dorothy's
// context, and her abstract of it. Turns count from 1, both ends included;
// each cluster starts on the turn after the one before it ends.
export type Cluster = {
    from: number;
    through: number;
    abstract: string;
    at: string;
    model: string;
};
```

Add to `Sidecar`, after `failures`:

```ts
    // Oldest first; written once, never revised.
    clusters: Cluster[];
```

Add `clusters: [],` to `EMPTY_SIDECAR`, and in `parseSidecar` change the
initial object to:

```ts
    const sidecar: Sidecar = {
        ...EMPTY_SIDECAR,
        titles: [],
        fields: {},
        appraisals: {},
        clusters: readClusters(data.clusters),
    };
```

Add, before `parseSidecar`:

```ts
const isTurn = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 1;

// The clusters that follow on from turn 1, up to the first that does not.
function readClusters(value: unknown): Cluster[] {
    const clusters: Cluster[] = [];
    for (const entry of Array.isArray(value) ? value : []) {
        const from = (clusters.at(-1)?.through ?? 0) + 1;
        const abstract =
            isRecord(entry) && typeof entry.abstract === "string"
                ? normalise(entry.abstract)
                : "";
        if (
            !isRecord(entry) ||
            entry.from !== from ||
            !isTurn(entry.through) ||
            entry.through < from ||
            abstract === "" ||
            overLimit("abstract", abstract) !== null ||
            typeof entry.at !== "string" ||
            typeof entry.model !== "string"
        ) {
            break;
        }
        clusters.push({
            from,
            through: entry.through,
            abstract,
            at: entry.at,
            model: entry.model,
        });
    }
    return clusters;
}
```

(`overLimit` is defined above `readNote`; move `readClusters` below it if
the order matters to the linter.)

Add, after `markReviewed`:

```ts
// New clusters go on the end, and only if they start where the last one
// ended; anything else would cover turns twice or leave a gap.
export function appendClusters(
    current: Sidecar | null,
    clusters: readonly Cluster[],
): Sidecar | null {
    const base = current ?? EMPTY_SIDECAR;
    const next = (base.clusters.at(-1)?.through ?? 0) + 1;
    if (clusters[0]?.from !== next) {
        return null;
    }
    return { ...base, clusters: [...base.clusters, ...clusters] };
}
```

In `src/transcript.ts`, add after `StatsEvent`:

```ts
// The moment a new session took over from a compacted one: through is the
// last turn compacted, clusters how many clusters this compaction added.
export type CompactionEvent = {
    v: 1;
    kind: "compaction";
    at: string;
    through: number;
    clusters: number;
};
```

Add `| CompactionEvent` to `TranscriptEvent`, and in `toTurn` change the
last line to:

```ts
    return kind === "session" || kind === "stats" || kind === "compaction"
        ? "ignore"
        : "malformed";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/memory/sidecar.test.ts src/transcript.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
bunx biome check --write src/memory/sidecar.ts src/memory/sidecar.test.ts src/transcript.ts src/transcript.test.ts
bun run check
git add src/memory/sidecar.ts src/memory/sidecar.test.ts src/transcript.ts src/transcript.test.ts
git commit -m "feat(sdk): Keep clusters and compaction events"
git log --oneline -1 && git status --short
```

### Task 4: The `recollect` vocabulary

**Files:**

- Modify: `src/recall/types.ts`
- Modify: `src/transcript.ts` (`toRecall`)
- Modify: `src/tui/state.ts` (`lookupLine`)
- Test: `src/recall/types.test.ts`, `src/transcript.test.ts`,
  `src/tui/state.test.ts`

**Interfaces:**

- Consumes: `WindowTurn` (existing, `src/recall/types.ts`).
- Produces: `TOOLS = ["search", "open", "recollect"]`; `ALLOWED_TOOLS`
  stays `["mcp__memory__search", "mcp__memory__open"]`;
  `RECOLLECT_TOOL = "mcp__memory__recollect"`;
  `type RecollectInput = { cluster: number; words?: string | undefined;
  turn?: number | undefined }`;
  `type RecollectResult = { cluster: number; turns: [number, number];
  total: number; matched?: boolean; window: WindowTurn[] }`;
  `type RecollectLookup = { tool: "recollect"; cluster: number; words?:
  string; turns: [number, number] | null }` in `Lookup`.

- [ ] **Step 1: Write the failing tests**

In `src/recall/types.test.ts`, add `RECOLLECT_TOOL` and
`type RecollectResult` to the import, and add:

```ts
describe("recollect's vocabulary", () => {
    it("names recollect, but keeps it out of the external pair", () => {
        expect(toolOf("mcp__memory__recollect")).toBe("recollect");
        expect(RECOLLECT_TOOL).toBe("mcp__memory__recollect");
        expect(ALLOWED_TOOLS).not.toContain(RECOLLECT_TOOL);
    });

    it("describes a recollection by its cluster, words and turns", () => {
        const result: RecollectResult = {
            cluster: 2,
            turns: [15, 31],
            total: 40,
            matched: true,
            window: [
                { turn: 18, role: "user", at: "x", text: "a" },
                { turn: 24, role: "assistant", at: "y", text: "b" },
            ],
        };
        expect(
            describeLookup(
                "recollect",
                { cluster: 2, words: "render" },
                JSON.stringify(result),
            ),
        ).toEqual({
            tool: "recollect",
            cluster: 2,
            words: "render",
            turns: [18, 24],
        });
    });

    it("describes a failed recollection with no turns", () => {
        expect(describeLookup("recollect", { cluster: 7 }, null)).toEqual({
            tool: "recollect",
            cluster: 7,
            turns: null,
        });
        expect(describeLookup("recollect", {}, null)).toEqual({
            tool: "recollect",
            cluster: 0,
            turns: null,
        });
    });
});
```

In `src/transcript.test.ts`, add:

```ts
describe("recollect events", () => {
    const event = {
        v: 1,
        kind: "recall",
        at: "2026-10-07T08:00:00.000Z",
        id: "toolu_9",
        ok: true,
        offset: 4,
        tool: "recollect",
        cluster: 2,
        words: "render",
        turns: [18, 24],
    };

    it("read back as written", () => {
        expect(toRecall(event)).toEqual(event);
        const { words: _, ...plain } = event;
        expect(toRecall({ ...plain, turns: null })).toEqual({
            ...plain,
            turns: null,
        });
    });

    it("are refused with no cluster, or a bad range", () => {
        expect(toRecall({ ...event, cluster: 0 })).toBeNull();
        expect(toRecall({ ...event, cluster: "2" })).toBeNull();
        expect(toRecall({ ...event, turns: [18] })).toBeNull();
        expect(toRecall({ ...event, words: 3 })).toBeNull();
    });
});
```

(Add `toRecall` to that file's import if it is not there.)

In `src/tui/state.test.ts`, inside `describe("lookupLine", ...)`, add:

```ts
    it("names the cluster and the turns recollected", () => {
        const recollected = {
            tool: "recollect" as const,
            cluster: 2,
            turns: [18, 24] as [number, number],
        };
        expect(lookupLine(true, recollected)).toEqual({
            text: "⌕ recollected cluster 2, turns 18-24",
        });
        expect(lookupLine(true, { ...recollected, turns: null })).toEqual({
            text: "⌕ recollected cluster 2",
        });
        expect(lookupLine(false, recollected)).toEqual({
            text: "⌕ couldn't recollect cluster 2",
        });
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/recall/types.test.ts src/transcript.test.ts src/tui/state.test.ts`
Expected: FAIL: `RECOLLECT_TOOL` is not exported; `toolOf` refuses
`recollect`; `toRecall` returns null.

- [ ] **Step 3: Implement**

In `src/recall/types.ts`, replace the tool constants with:

```ts
// The server's name; the CLI calls its tools mcp__memory__search,
// mcp__memory__open and mcp__memory__recollect.
export const SERVER_NAME = "memory";
export const TOOLS = ["search", "open", "recollect"] as const;
export type Tool = (typeof TOOLS)[number];
// The external pair, over other conversations, allowed in every session
// with recall.
export const ALLOWED_TOOLS = ["search", "open"].map(
    (tool) => `mcp__${SERVER_NAME}__${tool}`,
);
// The internal tool, over this conversation's clusters, allowed only in a
// session seeded with clusters.
export const RECOLLECT_TOOL = `mcp__${SERVER_NAME}__recollect`;
```

Add, after `OpenInput`:

```ts
export type RecollectInput = {
    cluster: number;
    words?: string | undefined;
    turn?: number | undefined;
};
```

Add, after `OpenResult`:

```ts
// A cluster of this conversation, word for word from where reading
// started. matched says whether words were found, when words were given.
export type RecollectResult = {
    cluster: number;
    turns: [number, number];
    total: number;
    matched?: boolean;
    window: WindowTurn[];
};
```

Add, after `OpenLookup`:

```ts
export type RecollectLookup = {
    tool: "recollect";
    cluster: number;
    words?: string;
    turns: [number, number] | null;
};
export type Lookup = SearchLookup | OpenLookup | RecollectLookup;
```

(replacing the old `Lookup` line). In `describeLookup`, after the `search`
branch, add:

```ts
    if (tool === "recollect") {
        const lookup: RecollectLookup = {
            tool,
            cluster:
                typeof fields.cluster === "number" &&
                Number.isFinite(fields.cluster)
                    ? Math.round(fields.cluster)
                    : 0,
            turns: null,
        };
        if (typeof fields.words === "string") {
            lookup.words = fields.words;
        }
        lookup.turns = windowRange(parse<RecollectResult>(result)?.window);
        return lookup;
    }
```

and replace the window handling at the end of the `open` path with the same
helper:

```ts
    lookup.turns = windowRange(opened?.window);
    return lookup;
```

defining the helper above `describeLookup`:

```ts
// The first and last turn of a window, or null for none.
function windowRange(window: unknown): [number, number] | null {
    const turns = Array.isArray(window) ? (window as WindowTurn[]) : [];
    const first = turns[0];
    const last = turns.at(-1);
    return first !== undefined && last !== undefined
        ? [first.turn, last.turn]
        : null;
}
```

In `src/transcript.ts`, in `toRecall`, before the final `return null;`,
add:

```ts
    if (
        event.tool === "recollect" &&
        Number.isInteger(event.cluster) &&
        (event.cluster as number) >= 1 &&
        (event.words === undefined || typeof event.words === "string") &&
        (event.turns === null || isTurnRange(event.turns))
    ) {
        return {
            ...base,
            tool: "recollect",
            cluster: event.cluster as number,
            ...(typeof event.words === "string" ? { words: event.words } : {}),
            turns: event.turns,
        };
    }
```

In `src/tui/state.ts`, in `lookupLine`, after the `search` branch, add:

```ts
    if (lookup.tool === "recollect") {
        const cluster = `cluster ${lookup.cluster}`;
        if (!ok) {
            return { text: `⌕ couldn't recollect ${cluster}` };
        }
        return {
            text:
                lookup.turns === null
                    ? `⌕ recollected ${cluster}`
                    : `⌕ recollected ${cluster}, turns ${lookup.turns[0]}-${lookup.turns[1]}`,
        };
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/recall/types.test.ts src/transcript.test.ts src/tui/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
bunx biome check --write src/recall/types.ts src/recall/types.test.ts src/transcript.ts src/transcript.test.ts src/tui/state.ts src/tui/state.test.ts
bun run check
git add src/recall/types.ts src/recall/types.test.ts src/transcript.ts src/transcript.test.ts src/tui/state.ts src/tui/state.test.ts
git commit -m "feat(sdk): Name recollect and its lookups"
git log --oneline -1 && git status --short
```

### Task 5: The `clusters` table

**Files:**

- Modify: `src/recall/store.ts`
- Modify: `src/recall/sync.ts`
- Test: `src/recall/sync.test.ts`, `src/recall/store.test.ts`

**Interfaces:**

- Consumes: `Sidecar.clusters` (Task 3).
- Produces: `SCHEMA_VERSION = 2`; table `clusters (phrase TEXT, n INTEGER,
  first_turn INTEGER, last_turn INTEGER, PRIMARY KEY (phrase, n))`, `n`
  counting from 1 in sidecar order.

- [ ] **Step 1: Write the failing tests**

In `src/recall/sync.test.ts`, using its fixtures (`A`, `user`,
`transcript`, `sidecar`, `dir`, `index`), add:

```ts
describe("clusters", () => {
    const cluster = (from: number, through: number) => ({
        from,
        through,
        abstract: `Turns ${from} to ${through}.`,
        at: "2026-10-07T08:00:00.000Z",
        model: "claude-test",
    });
    const rows = () =>
        index.db
            .query(
                "SELECT phrase, n, first_turn AS first, last_turn AS last FROM clusters ORDER BY phrase, n",
            )
            .all();

    it("are synced from the sidecar, numbered from 1", async () => {
        await writeFile(transcript(A), user(1, "hello"));
        await sidecar(A, { clusters: [cluster(1, 4), cluster(5, 9)] });
        await syncIndex(index, dir);
        expect(rows()).toEqual([
            { phrase: A, n: 1, first: 1, last: 4 },
            { phrase: A, n: 2, first: 5, last: 9 },
        ]);
    });

    it("follow the sidecar as it changes, and go with the transcript", async () => {
        await writeFile(transcript(A), user(1, "hello"));
        await sidecar(A, { clusters: [cluster(1, 4)] });
        await syncIndex(index, dir);
        await sidecar(A, { clusters: [cluster(1, 4), cluster(5, 6)] });
        // A new mtime, as a rename by updateSidecar would give it.
        const later = new Date(Date.now() + 5000);
        await utimes(sidecarPath(dir, A), later, later);
        await syncIndex(index, dir);
        expect(rows()).toHaveLength(2);
        await rm(transcript(A));
        await syncIndex(index, dir);
        expect(rows()).toEqual([]);
    });
});
```

In `src/recall/store.test.ts`, add:

```ts
it("is at schema version 2, with a clusters table", () => {
    const index = RecallIndex.open(path);
    try {
        expect(SCHEMA_VERSION).toBe(2);
        expect(
            index.db
                .query(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'clusters'",
                )
                .get(),
        ).toEqual({ name: "clusters" });
    } finally {
        index.close();
    }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/recall/sync.test.ts src/recall/store.test.ts`
Expected: FAIL: no such table: clusters.

- [ ] **Step 3: Implement**

In `src/recall/store.ts`, set `export const SCHEMA_VERSION = 2;` and add to
`SCHEMA`, after `claims`:

```ts
    `CREATE TABLE clusters (
        phrase TEXT NOT NULL,
        n INTEGER NOT NULL,
        first_turn INTEGER NOT NULL,
        last_turn INTEGER NOT NULL,
        PRIMARY KEY (phrase, n)
    )`,
```

In `src/recall/sync.ts`, add `"DELETE FROM clusters WHERE phrase = ?",` to
`forget`'s list before the `conversations` delete, and at the end of
`syncSidecar` add:

```ts
    index.db.run("DELETE FROM clusters WHERE phrase = ?", [phrase]);
    for (const [at, cluster] of (sidecar?.clusters ?? []).entries()) {
        index.db.run(
            "INSERT INTO clusters (phrase, n, first_turn, last_turn) VALUES (?, ?, ?, ?)",
            [phrase, at + 1, cluster.from, cluster.through],
        );
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/recall/`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
bunx biome check --write src/recall/store.ts src/recall/sync.ts src/recall/sync.test.ts src/recall/store.test.ts
bun run check
git add src/recall/store.ts src/recall/sync.ts src/recall/sync.test.ts src/recall/store.test.ts
git commit -m "feat(sdk): Index each conversation's clusters"
git log --oneline -1 && git status --short
```

### Task 6: `recollect`, and serving it

**Files:**

- Modify: `src/recall/query.ts`
- Modify: `src/recall/server.ts`
- Modify: `src/index.ts`
- Test: `src/recall/query.test.ts`, `src/recall/server.test.ts`,
  `src/index.test.ts`

**Interfaces:**

- Consumes: the `clusters` table (Task 5); `RecollectInput`,
  `RecollectResult` (Task 4); `termsOf`, `windowOf`, `RecallError`
  (existing).
- Produces: `recollect(index: RecallIndex, input: RecollectInput,
  options: { phrase: string | null }): RecollectResult`;
  `NO_CLUSTER = "No cluster by that number."`; `RECOLLECT_DESCRIPTION`;
  `RecallServerOptions.recollect?: boolean`; `runRecallServer(exclude:
  string | null, recollect: boolean, env?: Env)`; the parsed mode
  `{ kind: "recall-server"; exclude: string | null; recollect: boolean }`.

- [ ] **Step 1: Write the failing query tests**

In `src/recall/query.test.ts`, add `NO_CLUSTER` and `recollect` to the
import from `./query.js`, and add:

```ts
describe("recollect", () => {
    const cluster = (from: number, through: number) => ({
        from,
        through,
        abstract: `Turns ${from} to ${through}.`,
        at: day(1),
        model: "m",
    });
    // Eight turns: two clusters of three, and two turns of tail.
    beforeEach(async () => {
        await conversation(
            LIVE,
            [
                session(day(1)),
                user(day(1, 1), "the cat sat"),
                reply(day(1, 2), "on the mat"),
                user(day(1, 3), "a render bug"),
                reply(day(1, 4), "the dog barked"),
                user(day(1, 5), "a render fix"),
                reply(day(1, 6), "the bird sang"),
                user(day(1, 7), "now"),
                reply(day(1, 8), "then"),
            ],
            { clusters: [cluster(1, 3), cluster(4, 6)] },
        );
        await syncIndex(index, dir);
    });
    const opened = (input: Parameters<typeof recollect>[1]) =>
        recollect(index, input, { phrase: LIVE });

    it("opens a cluster from its first turn, never past its last", () => {
        const result = opened({ cluster: 1 });
        expect(result.cluster).toBe(1);
        expect(result.turns).toEqual([1, 3]);
        expect(result.total).toBe(8);
        expect(result.matched).toBeUndefined();
        expect(result.window.map((turn) => turn.turn)).toEqual([1, 2, 3]);
    });

    it("starts at the turn asked for", () => {
        expect(
            opened({ cluster: 2, turn: 5 }).window.map((turn) => turn.turn),
        ).toEqual([5, 6]);
    });

    it("centres on the first turn matching the words", () => {
        const result = opened({ cluster: 2, words: "render" });
        expect(result.matched).toBe(true);
        expect(result.window[0]?.turn).toBe(4);
    });

    it("looks for words only from the turn asked for, within the cluster", () => {
        const after = opened({ cluster: 2, words: "render bug", turn: 5 });
        expect(after.matched).toBe(true);
        expect(after.window[0]?.turn).toBe(5);
        const before = opened({ cluster: 2, words: "dog", turn: 5 });
        expect(before.matched).toBe(false);
        expect(before.window[0]?.turn).toBe(5);
        const elsewhere = opened({ cluster: 1, words: "bird" });
        expect(elsewhere.matched).toBe(false);
        expect(elsewhere.window.map((turn) => turn.turn)).toEqual([1, 2, 3]);
    });

    it("refuses an unknown cluster, a turn outside it and empty words", () => {
        expect(() => opened({ cluster: 3 })).toThrow(NO_CLUSTER);
        expect(() => opened({ cluster: 1, turn: 4 })).toThrow(
            "turn must be from 1 to 3, within cluster 1.",
        );
        expect(() => opened({ cluster: 1, words: " ?? " })).not.toThrow();
        expect(() => opened({ cluster: 1, words: "   " })).toThrow(
            "Give some words to look for.",
        );
        expect(() =>
            recollect(index, { cluster: 1 }, { phrase: null }),
        ).toThrow(NO_CLUSTER);
    });

    it("never opens another conversation's clusters", async () => {
        await conversation(A, [user(day(2), "elsewhere")], {
            clusters: [cluster(1, 1)],
        });
        await syncIndex(index, dir);
        expect(opened({ cluster: 1 }).window[0]?.text).toBe("the cat sat");
    });
});
```

The words `"render bug"` from turn 5 match turn 5 by the any-word fallback
(`render`), since no turn from 5 on holds both.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/recall/query.test.ts`
Expected: FAIL: `recollect` is not exported.

- [ ] **Step 3: Implement `recollect`**

In `src/recall/query.ts`, add `RecollectInput` and `RecollectResult` to the
type import from `./types.js`, and add after `NOT_FOUND`:

```ts
export const NO_CLUSTER = "No cluster by that number.";
```

Add at the end of the file:

```ts
type TurnRow = {
    turn: number;
    role: "user" | "assistant";
    at: number;
    text: string;
};

// A cluster of the live conversation, read from turn (its first by
// default) and never past its last. With words, the window centres on the
// first turn from there on that holds them all, or any of them.
export function recollect(
    index: RecallIndex,
    input: RecollectInput,
    options: { phrase: string | null },
): RecollectResult {
    const phrase = options.phrase;
    const n = Number.isFinite(input.cluster) ? Math.round(input.cluster) : 0;
    const range =
        phrase === null
            ? null
            : (index.db
                  .query(
                      "SELECT first_turn AS first, last_turn AS last FROM clusters WHERE phrase = ? AND n = ?",
                  )
                  .get(phrase, n) as { first: number; last: number } | null);
    if (phrase === null || range === null) {
        throw new RecallError(NO_CLUSTER);
    }
    let start = range.first;
    if (input.turn !== undefined) {
        const turn = Number.isFinite(input.turn)
            ? Math.round(input.turn)
            : Number.NaN;
        if (!(turn >= range.first && turn <= range.last)) {
            throw new RecallError(
                `turn must be from ${range.first} to ${range.last}, within cluster ${n}.`,
            );
        }
        start = turn;
    }
    let centre = start;
    let matched: boolean | undefined;
    if (input.words !== undefined) {
        if (normalise(input.words) === "") {
            throw new RecallError("Give some words to look for.");
        }
        const terms = termsOf(input.words);
        const find = (expression: string) =>
            index.db
                .query(
                    `SELECT t.n AS n FROM turns_fts
                     JOIN turns t ON t.rowid = turns_fts.rowid
                     WHERE turns_fts MATCH ? AND t.phrase = ?
                         AND t.n BETWEEN ? AND ?
                     ORDER BY t.n LIMIT 1`,
                )
                .get(expression, phrase, start, range.last) as {
                n: number;
            } | null;
        const hit =
            find(terms.join(" ")) ??
            (terms.length > 1 ? find(terms.join(" OR ")) : null);
        matched = hit !== null;
        centre = hit?.n ?? start;
    }
    const turns = index.db
        .query(
            "SELECT n AS turn, role, at, text FROM turns WHERE phrase = ? AND n BETWEEN ? AND ? ORDER BY n",
        )
        .all(phrase, start, range.last) as TurnRow[];
    const total =
        (
            index.db
                .query("SELECT turns FROM conversations WHERE phrase = ?")
                .get(phrase) as { turns: number } | null
        )?.turns ?? 0;
    const at = turns.findIndex((turn) => turn.turn === centre);
    return {
        cluster: n,
        turns: [range.first, range.last],
        total,
        ...(matched === undefined ? {} : { matched }),
        window: windowOf(turns, at === -1 ? 1 : at + 1).map((turn) => ({
            ...turn,
            at: new Date(turn.at).toISOString(),
        })),
    };
}
```

Words made only of punctuation (`" ?? "`) are quoted terms that match
nothing: `matched` is false, as `search` treats them.

- [ ] **Step 4: Run the query tests to verify they pass**

Run: `bun test src/recall/query.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing server and argument tests**

In `src/recall/server.test.ts`, add:

```ts
describe("recollect on the server", () => {
    it("is offered only when asked for, and only with a phrase", async () => {
        const names = async (options: Partial<RecallServerOptions>) =>
            (await (await connect(options)).listTools()).tools
                .map((tool) => tool.name)
                .sort();
        expect(await names({})).toEqual(["open", "search"]);
        expect(await names({ recollect: true })).toEqual([
            "open",
            "recollect",
            "search",
        ]);
        expect(await names({ recollect: true, exclude: null })).toEqual([
            "open",
            "search",
        ]);
    });

    it("opens a cluster of the live conversation", async () => {
        await writeFile(
            sidecarPath(dir, LIVE),
            JSON.stringify({
                ...EMPTY_SIDECAR,
                clusters: [
                    {
                        from: 1,
                        through: 1,
                        abstract: "Rendering.",
                        at: "2026-10-04T12:00:00.000Z",
                        model: "m",
                    },
                ],
            }),
        );
        const client = await connect({ recollect: true });
        const opened = await client.callTool({
            name: "recollect",
            arguments: { cluster: 1 },
        });
        expect(opened.isError).toBeFalsy();
        const result = JSON.parse(textOf(opened)) as RecollectResult;
        expect(result.window.map((turn) => turn.text)).toEqual(["render now"]);
        const missing = await client.callTool({
            name: "recollect",
            arguments: { cluster: 2 },
        });
        expect(missing.isError).toBe(true);
        expect(textOf(missing)).toBe("No cluster by that number.");
    });
});
```

(Import `EMPTY_SIDECAR` and `sidecarPath` from `../memory/sidecar.js` and
`type RecollectResult` from `./types.js`.)

In `src/index.test.ts`, change the two existing `recall-server`
expectations to include `recollect: false`, change the refusal message to
`"--recall-server takes only --exclude <phrase> [--recollect]"`, and add:

```ts
    it("serves recollect when asked, with a phrase", () => {
        expect(
            parseArgs(
                ["--recall-server", "--exclude", phrase, "--recollect"],
                false,
            ),
        ).toEqual({ kind: "recall-server", exclude: phrase, recollect: true });
        for (const rest of [
            ["--recollect"],
            ["--exclude", phrase, "--other"],
            ["--exclude", phrase, "--recollect", "x"],
        ]) {
            expect(parseArgs(["--recall-server", ...rest], false)).toEqual({
                kind: "usage",
                message:
                    "--recall-server takes only --exclude <phrase> [--recollect]",
            });
        }
    });
```

`phrase` is the file's own fixture. Add `recollect: false` to both
expectations in "serves recall, terminal or not, with or without an
exclusion", and change the message in "refuses anything else after
--recall-server" to
`"--recall-server takes only --exclude <phrase> [--recollect]"`.

- [ ] **Step 6: Run them to verify they fail**

Run: `bun test src/recall/server.test.ts src/index.test.ts`
Expected: FAIL: no `recollect` tool; `recollect` missing from the mode.

- [ ] **Step 7: Implement the server and the argument**

In `src/recall/server.ts`, import `recollect` from `./query.js`, and add
after `OPEN_DESCRIPTION`:

```ts
export const RECOLLECT_DESCRIPTION = [
    "Open one cluster of this conversation, from your summaries of its",
    "earlier turns, to read what was said word for word. Give words to start",
    "at the first turn in the cluster that contains them, or a turn number;",
    "call again with a later turn to read further.",
].join(" ");
```

Add to `RecallServerOptions`:

```ts
    // Serve recollect over the live conversation's clusters; the session
    // was seeded with them.
    recollect?: boolean;
```

Before `return server;` in `createRecallServer`, add:

```ts
    const live = options.exclude;
    if (options.recollect === true && live !== null) {
        server.registerTool(
            "recollect",
            {
                description: RECOLLECT_DESCRIPTION,
                inputSchema: {
                    cluster: z.number(),
                    words: z.string().optional(),
                    turn: z.number().optional(),
                },
            },
            (input) =>
                answer((index) => recollect(index, input, { phrase: live })),
        );
    }
```

Change `runRecallServer`'s signature and its options:

```ts
export async function runRecallServer(
    exclude: string | null,
    recollect: boolean,
    env: Env = process.env,
): Promise<number> {
    const { config } = await readConfig(env);
    const server = createRecallServer({
        openIndex: () => RecallIndex.open(indexPath(env)),
        dir: transcriptDir(env),
        exclude,
        recollect,
        halfLifeDays: config.memory.halfLifeDays,
    });
```

(the rest unchanged). The local import name `recollect` from `./query.js`
clashes with the parameter: import it as
`import { openConversation, RecallError, recollect as recollectIn, search } from "./query.js";`
and call `recollectIn(index, input, { phrase: live })` in the tool.

In `src/index.ts`, change the mode to
`| { kind: "recall-server"; exclude: string | null; recollect: boolean }`,
the usage line to
`"       dorothy --recall-server    memory search for MCP clients (stdio)"`
(unchanged), and the parser branch to:

```ts
    if (first === "--recall-server") {
        if (rest.length === 0) {
            return { kind: "recall-server", exclude: null, recollect: false };
        }
        const [flag, phrase, extra] = rest;
        const recollect = extra === "--recollect";
        return (rest.length === 2 || (rest.length === 3 && recollect)) &&
            flag === "--exclude" &&
            phrase !== undefined &&
            isPhrase(phrase)
            ? { kind: "recall-server", exclude: phrase, recollect }
            : {
                  kind: "usage",
                  message:
                      "--recall-server takes only --exclude <phrase> [--recollect]",
              };
    }
```

and the call to `runRecallServer(mode.exclude, mode.recollect)`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test src/recall/ src/index.test.ts`
Expected: PASS.

- [ ] **Step 9: Check and commit**

```bash
bunx biome check --write src/recall/query.ts src/recall/query.test.ts src/recall/server.ts src/recall/server.test.ts src/index.ts src/index.test.ts
bun run check
git add src/recall/query.ts src/recall/query.test.ts src/recall/server.ts src/recall/server.test.ts src/index.ts src/index.test.ts
git commit -m "feat(sdk): Serve recollect over clusters"
git log --oneline -1 && git status --short
```

### Task 7: The seed with clusters, and compaction's events

**Files:**

- Modify: `src/persona.ts` (`withClusters`)
- Modify: `src/conversation.ts` (`SessionSetup`, `conversationOptions`,
  `ConversationEvent`)
- Modify: `src/tui/state.ts` (`reduceEvent`)
- Test: `src/persona.test.ts`, `src/conversation.test.ts`,
  `src/tui/state.test.ts`

**Interfaces:**

- Consumes: `Cluster` (Task 3); `RECOLLECT_TOOL`, `ALLOWED_TOOLS` (Task 4);
  `escapeXml` (`src/memory/block.ts`).
- Produces: `withClusters(prompt: string, clusters: readonly Cluster[],
  recollect: boolean): string`; `SessionSetup.clusters?: readonly
  Cluster[]`; `ConversationEvent` gains `{ type: "compacting" }`,
  `{ type: "compacted"; from: number; through: number; clusters: number }`
  and `{ type: "memory-cost"; usd: number }`.

- [ ] **Step 1: Write the failing tests**

In `src/persona.test.ts`, add `withClusters` to the import from
`./persona.js` and add:

```ts
describe("withClusters", () => {
    const clusters = [
        {
            from: 1,
            through: 14,
            abstract: "Cats & <dogs>.",
            at: "x",
            model: "m",
        },
        { from: 15, through: 31, abstract: "Render bugs.", at: "y", model: "m" },
    ];

    it("adds nothing without clusters", () => {
        expect(withClusters("P", [], true)).toBe("P");
    });

    it("lists each cluster's turns and abstract, escaped", () => {
        expect(withClusters("P", clusters, true)).toBe(
            [
                "P",
                "",
                "Earlier in this conversation, in your own summaries; recollect opens a cluster's turns word for word:",
                "",
                "<earlier>",
                '<cluster n="1" turns="1-14">Cats &amp; &lt;dogs&gt;.</cluster>',
                '<cluster n="2" turns="15-31">Render bugs.</cluster>',
                "</earlier>",
            ].join("\n"),
        );
    });

    it("leaves recollect out of the preamble when it is not offered", () => {
        expect(withClusters("P", clusters, false)).toContain(
            "Earlier in this conversation, in your own summaries:\n",
        );
    });
});
```

In `src/conversation.test.ts`, add `withClusters` to the import from
`./persona.js`, and inside `describe("Conversation with recall", ...)` add:

```ts
    const CLUSTERS = [
        { from: 1, through: 2, abstract: "Cats.", at: "x", model: "m" },
    ];

    it("seeds clusters between the memory and the tail, and offers recollect", () => {
        const fake = fakeQuery([]);
        const history: Turn[] = [{ role: "user", text: "Later" }];
        new Conversation({
            queryFn: fake.fn,
            recall: RECALL,
            memory: "<memory/>",
            clusters: CLUSTERS,
            history,
        }).start();
        expect(fake.options?.systemPrompt).toBe(
            withHistory(
                withClusters(
                    withMemory(personaPrompt({ recall: true }), "<memory/>"),
                    CLUSTERS,
                    true,
                ),
                history,
            ),
        );
        expect(fake.options?.mcpServers).toEqual({
            memory: {
                type: "stdio",
                command: RECALL.command,
                args: [...RECALL.args, "--recollect"],
            },
        });
        expect(fake.options?.allowedTools).toEqual([
            "mcp__memory__search",
            "mcp__memory__open",
            "mcp__memory__recollect",
        ]);
    });

    it("seeds clusters without recall, offering no tool", () => {
        const fake = fakeQuery([]);
        new Conversation({ queryFn: fake.fn, clusters: CLUSTERS }).start();
        expect(fake.options?.systemPrompt).toBe(
            withHistory(withClusters(systemPrompt, CLUSTERS, false), []),
        );
        expect(fake.options?.mcpServers).toBeUndefined();
    });
```

In `src/tui/state.test.ts`, add:

```ts
describe("compaction events", () => {
    const after = (...events: ConversationEvent[]) =>
        events.reduce(
            (state, event) => reduce(state, { type: "event", event }),
            initialState([]),
        );

    it("show compacting, then what was compacted, as dim lines", () => {
        const state = after(
            { type: "compacting" },
            { type: "compacted", from: 1, through: 31, clusters: 2 },
            { type: "compacted", from: 32, through: 40, clusters: 1 },
        );
        expect(
            state.lines.map((line) => [line.role, line.text]),
        ).toEqual([
            ["lookup", "compacting…"],
            ["lookup", "compacted turns 1-31 into 2 clusters"],
            ["lookup", "compacted turns 32-40 into 1 cluster"],
        ]);
    });

    it("counts compaction's cost as memory's", () => {
        expect(
            after(
                { type: "memory-cost", usd: 0.25 },
                { type: "memory-cost", usd: 0.5 },
            ).memoryCostUsd,
        ).toBe(0.75);
    });
});
```

(Import `type ConversationEvent` from `../conversation.js` if the file does
not.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/persona.test.ts src/conversation.test.ts src/tui/state.test.ts`
Expected: FAIL: `withClusters` is not exported; `clusters` is not a
`SessionSetup` field; the reducer does not know the new events.

- [ ] **Step 3: Implement**

In `src/persona.ts`, add the imports:

```ts
import { escapeXml } from "./memory/block.js";
import type { Cluster } from "./memory/sidecar.js";
```

and after `withMemory`:

```ts
// The abstracts of a compacted conversation's earlier turns go after the
// notes on other conversations and before the turns still in full, so the
// prompt reads oldest first.
export function withClusters(
    prompt: string,
    clusters: readonly Cluster[],
    recollect: boolean,
): string {
    if (clusters.length === 0) {
        return prompt;
    }
    const preamble = recollect
        ? "Earlier in this conversation, in your own summaries; recollect opens a cluster's turns word for word:"
        : "Earlier in this conversation, in your own summaries:";
    const entries = clusters.map(
        (cluster, at) =>
            `<cluster n="${at + 1}" turns="${cluster.from}-${cluster.through}">${escapeXml(cluster.abstract)}</cluster>`,
    );
    return [prompt, "", preamble, "", "<earlier>", ...entries, "</earlier>"].join(
        "\n",
    );
}
```

In `src/conversation.ts`, import `type Cluster` from
`./memory/sidecar.js`, add `withClusters` to the import from
`./persona.js` and `RECOLLECT_TOOL` to the import from
`./recall/types.js`. Add to `ConversationEvent`:

```ts
    // Compaction is under way and the next message waits for it.
    | { type: "compacting" }
    // Turns from to through now live in clusters of a new session.
    | { type: "compacted"; from: number; through: number; clusters: number }
    // What a background call for memory cost, such as compaction's.
    | { type: "memory-cost"; usd: number }
```

Add to `SessionSetup`:

```ts
    // The abstracts of the turns compaction took out; history then holds
    // only the turns after them.
    clusters?: readonly Cluster[];
```

Replace `conversationOptions` with:

```ts
export function conversationOptions({
    history = [],
    memory = "",
    recall = null,
    persona = "chat",
    clusters = [],
}: SessionSetup = {}): Options {
    const recollect = recall !== null && clusters.length > 0;
    return {
        ...baseOptions,
        ...cliOptions(),
        systemPrompt: withHistory(
            withClusters(
                withMemory(
                    personaPrompt({ recall: recall !== null, mode: persona }),
                    memory,
                ),
                clusters,
                recollect,
            ),
            history,
        ),
        ...(recall === null
            ? {}
            : {
                  mcpServers: {
                      [SERVER_NAME]: {
                          type: "stdio",
                          command: recall.command,
                          args: recollect
                              ? [...recall.args, "--recollect"]
                              : recall.args,
                      },
                  },
                  allowedTools: recollect
                      ? [...ALLOWED_TOOLS, RECOLLECT_TOOL]
                      : ALLOWED_TOOLS,
              }),
    };
}
```

The existing test "launches the recall server and allows only its tools"
expects `{ type: "stdio", ...RECALL }`, which is the same object; it keeps
passing.

In `src/tui/state.ts`, add to `reduceEvent`'s switch:

```ts
        case "compacting":
            return {
                ...state,
                lines: append(state.lines, {
                    role: "lookup",
                    text: "compacting…",
                }),
            };
        case "compacted":
            return {
                ...state,
                lines: append(state.lines, {
                    role: "lookup",
                    text: `compacted turns ${event.from}-${event.through} into ${event.clusters} cluster${event.clusters === 1 ? "" : "s"}`,
                }),
            };
        case "memory-cost":
            return reduce(state, { type: "memory-cost", usd: event.usd });
```

and widen the comment on `Line.role`'s `lookup` (in the `Line` type, add a
comment above `role`): `// lookup: a dim memory line, a lookup or a
compaction.`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/persona.test.ts src/conversation.test.ts src/tui/`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
bunx biome check --write src/persona.ts src/persona.test.ts src/conversation.ts src/conversation.test.ts src/tui/state.ts src/tui/state.test.ts
bun run check
git add src/persona.ts src/persona.test.ts src/conversation.ts src/conversation.test.ts src/tui/state.ts src/tui/state.test.ts
git commit -m "feat(sdk): Seed sessions with clusters"
git log --oneline -1 && git status --short
```

### Task 8: Abstracts charged to the budget, and reviews over them

**Files:**

- Modify: `src/memory/block.ts` (`unescapeXml`, moved)
- Modify: `src/memory/rank.ts` (`buildMemory`)
- Modify: `src/memory/review.ts` (`reviewPrompt`, `CLUSTERS_INSTRUCTION`)
- Modify: `src/memory/service.ts` (`block`, the review's instructions)
- Test: `src/memory/rank.test.ts`, `src/memory/review.test.ts`,
  `src/memory/service.test.ts`, `src/memory/block.test.ts`

**Interfaces:**

- Consumes: `Sidecar.clusters` (Task 3).
- Produces: `unescapeXml(text: string): string` exported from
  `src/memory/block.ts`; `buildMemory(entries, { now, config, exclude,
  reserved?: number })`; `MemoryService.block(reserved?: number): string`;
  `CLUSTERS_INSTRUCTION`.

- [ ] **Step 1: Write the failing tests**

In `src/memory/block.test.ts`, add `unescapeXml` to the import and:

```ts
it("unescapes what escapeXml escaped, once", () => {
    expect(unescapeXml(escapeXml("a & <b> &lt;"))).toBe("a & <b> &lt;");
});
```

In `src/memory/rank.test.ts`, inside `describe("buildMemory", ...)`, add:

```ts
    it("charges the abstracts first, leaving the rest less room", () => {
        const entries = [entry("a", full("Kept")), entry("b", full("Next"))];
        const config = { ...DEFAULT_CONFIG.memory, budget: 200 };
        const room = buildMemory(entries, { now: NOW, config, exclude: null });
        expect(room.block).toContain("<title>Next</title>");
        const crowded = buildMemory(entries, {
            now: NOW,
            config,
            exclude: null,
            reserved: 190,
        });
        expect(crowded.block).not.toContain("<title>Next</title>");
        expect(crowded.warnings).toEqual([]);
    });

    it("still shows pins past abstracts that fill the budget, and says so", () => {
        const pinned = entry("a", full("Pinned", { pinned: true }));
        const { block, warnings } = buildMemory(
            [pinned, entry("b", full("Other"))],
            {
                now: NOW,
                config: { ...DEFAULT_CONFIG.memory, budget: 200 },
                exclude: null,
                reserved: 250,
            },
        );
        expect(block).toContain("<title>Pinned</title>");
        expect(block).not.toContain("Other");
        expect(warnings).toEqual([
            expect.stringMatching(
                /^memory: this conversation's summaries take ~250 tokens and pinned notes ~\d+, over the budget of 200$/,
            ),
        ]);
    });
```

In `src/memory/review.test.ts`, add `CLUSTERS_INSTRUCTION` to the import
and add:

```ts
describe("reviewing a compacted conversation", () => {
    const turns: ResumedTurn[] = [
        { role: "user", text: "Old one." },
        { role: "assistant", text: "Old two." },
        { role: "user", text: "New <one>." },
        { role: "assistant", text: "New two." },
    ];
    const current = {
        ...EMPTY_SIDECAR,
        clusters: [
            {
                from: 1,
                through: 2,
                abstract: "Old & settled.",
                at: AT,
                model: "m",
            },
        ],
    };

    it("gives the abstracts, then only the turns after them", () => {
        const prompt = reviewPrompt(turns, current);
        expect(prompt).toContain(
            [
                "<conversation>",
                "<earlier>",
                '<cluster n="1" turns="1-2">Old &amp; settled.</cluster>',
                "</earlier>",
                "",
                "User: New &lt;one&gt;.",
                "",
                "Dorothy: New two.",
                "</conversation>",
            ].join("\n"),
        );
        expect(prompt).not.toContain("Old one.");
    });

    it("says how to read them", () => {
        expect(CLUSTERS_INSTRUCTION).toContain("<earlier>");
    });
});
```

In `src/memory/service.test.ts`, add:

```ts
describe("the block for a compacted session", () => {
    it("leaves the abstracts' tokens out of the budget", () => {
        const { memory } = setup({
            queryFn: reviews().fn,
            config: { ...DEFAULT_CONFIG.memory, budget: 200 },
            entries: [
                entry(phrase(1), { ...NOTES, title: "First" }),
                entry(phrase(2), { ...NOTES, title: "Second" }),
            ],
        });
        expect(memory.block()).toContain("Second");
        expect(memory.block(190)).not.toContain("Second");
    });

    it("tells a review of a compacted conversation how to read it", async () => {
        await transcript(LIVE, [
            user("Old"),
            reply("Older"),
            user("New"),
            reply("Newer"),
        ]);
        await writeFile(
            sidecarPath(dir, LIVE),
            JSON.stringify({
                ...EMPTY_SIDECAR,
                ...NOTES,
                clusters: [
                    {
                        from: 1,
                        through: 2,
                        abstract: "Old.",
                        at: NOW.toISOString(),
                        model: "claude-test",
                    },
                ],
            }),
        );
        const query = reviews(NOTES);
        const { memory } = setup({ queryFn: query.fn });
        memory.turnEnded();
        await until(() => query.calls.length > 0);
        const call = query.calls[0];
        expect(String(call?.options.systemPrompt)).toEndWith(
            CLUSTERS_INSTRUCTION,
        );
        expect(call?.prompt).toContain(
            '<cluster n="1" turns="1-2">Old.</cluster>',
        );
        expect(call?.prompt).not.toContain("Older");
    });
});
```

(`setup`, `reviews`, `entry`, `transcript`, `user`, `reply`, `NOTES`,
`LIVE` and `dir` are the file's own fixtures; import
`CLUSTERS_INSTRUCTION` from `./review.js` and `writeFile` from
`node:fs/promises` if missing.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/memory/`
Expected: FAIL: `unescapeXml` is not exported from `block.ts`; `reserved`
is ignored; `CLUSTERS_INSTRUCTION` is not exported; `block()` takes no
argument.

- [ ] **Step 3: Implement**

In `src/memory/block.ts`, after `escapeXml`, add (moving it from
`review.ts`):

```ts
// What a model echoes of escaped text is read as text. &amp; goes last, so
// &amp;lt; decodes once, to &lt;.
export const unescapeXml = (text: string) =>
    text
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&");
```

In `src/memory/review.ts`, delete its own `unescapeXml` and import it from
`./block.js` beside `escapeXml`.

In `src/memory/rank.ts`, replace `buildMemory` with:

```ts
// reserved: tokens already spent on this conversation's own abstracts,
// which come before every note on other conversations.
export function buildMemory(
    entries: readonly Entry[],
    {
        now,
        config,
        exclude,
        reserved = 0,
    }: {
        now: number;
        config: MemoryConfig;
        exclude: string | null;
        reserved?: number;
    },
): { block: string; tiered: Tiered; warnings: string[] } {
    const tiered = tier(
        rank(entries, { now, halfLifeDays: config.halfLifeDays, exclude }),
        Math.max(0, config.budget - reserved),
    );
    const over = reserved + tiered.pinTokens > config.budget;
    const warnings = !over
        ? []
        : reserved === 0
          ? [
                `memory: pinned notes take ~${tiered.pinTokens} tokens, over the budget of ${config.budget}`,
            ]
          : [
                `memory: this conversation's summaries take ~${reserved} tokens and pinned notes ~${tiered.pinTokens}, over the budget of ${config.budget}`,
            ];
    return {
        block: renderBlock(tiered.placed, tiered.omitted.length),
        tiered,
        warnings,
    };
}
```

In `src/memory/review.ts`, add after `READS_INSTRUCTION`:

```ts
export const CLUSTERS_INSTRUCTION = [
    "Its earlier turns are given as your own summaries in <earlier>, as",
    "they were in your context; write your notes on the whole",
    "conversation.",
].join(" ");
```

and in `reviewPrompt`, replace the `conversation` constant with:

```ts
    const clusters = current?.clusters ?? [];
    const covered = clusters.at(-1)?.through ?? 0;
    const earlier =
        clusters.length === 0
            ? []
            : [
                  "<earlier>",
                  ...clusters.map(
                      (cluster, at) =>
                          `<cluster n="${at + 1}" turns="${cluster.from}-${cluster.through}">${escapeXml(cluster.abstract)}</cluster>`,
                  ),
                  "</earlier>",
                  "",
              ];
    const conversation = [
        ...earlier,
        turns
            .slice(covered)
            .map(
                (turn) =>
                    `${turn.role === "user" ? "User" : "Dorothy"}: ${escapeXml(marked(turn, ids))}`,
            )
            .join("\n\n"),
    ].join("\n");
```

In `src/memory/service.ts`, import `CLUSTERS_INSTRUCTION` from
`./review.js`. Replace `block()` with:

```ts
    // The block a new session starts with, as of the latest review, with
    // reserved tokens of the live conversation's own abstracts charged
    // first. A pin overrun is told once a run.
    block(reserved = 0): string {
        if (reserved === 0) {
            return this.#block;
        }
        const built = this.#build(this.#phrase, reserved);
        const [warning] = built.warnings;
        if (warning !== undefined && !this.#pinWarned) {
            this.#pinWarned = true;
            this.#warn(warning);
        }
        return built.block;
    }
```

change `#build` to pass `reserved`:

```ts
    #build(
        exclude: string,
        reserved = 0,
    ): { block: string; warnings: string[] } {
        return buildMemory([...this.#entries.values()], {
            now: this.#now().getTime(),
            config: this.#config,
            exclude,
            reserved,
        });
    }
```

and in `#reviewClaimed`, build the review's instructions with the clusters
instruction when there are clusters:

```ts
        const instructions = [
            REVIEW_INSTRUCTIONS,
            ...(reads.length > 0 ? [READS_INSTRUCTION] : []),
            ...((current?.clusters.length ?? 0) > 0
                ? [CLUSTERS_INSTRUCTION]
                : []),
        ].join(" ");
```

passing `systemPrompt: [withMemory(systemPrompt, this.#build(phrase).block),
instructions].join("\n\n")` to `runReview` in place of the old ternary.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/memory/`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
bunx biome check --write src/memory/
bun run check
git add src/memory/
git commit -m "feat(sdk): Charge abstracts first in memory"
git log --oneline -1 && git status --short
```

### Task 9: Structured calls, and reviews on them

**Files:**

- Create: `src/compaction/types.ts`
- Create: `src/compaction/boundary.test.ts`
- Create: `src/structured.ts`
- Create: `src/structured.test.ts`
- Modify: `src/memory/review.ts` (`runReview`, its query types)

**Interfaces:**

- Produces, in `src/compaction/types.ts`:

  ```ts
  export type StructuredRequest = {
      what: string;
      system: string;
      prompt: string;
      schema: Record<string, unknown>;
      timeoutMs: number;
      signal?: AbortSignal;
  };
  export type StructuredOutcome =
      | { ok: true; output: unknown; model: string; costUsd: number }
      | { ok: false; reason: string; costUsd: number };
  export type StructuredCall = (
      request: StructuredRequest,
  ) => Promise<StructuredOutcome>;
  ```

- Produces, in `src/structured.ts`: `type StructuredHandle`,
  `type StructuredQueryFn`, `structuredCall({ queryFn?, timers? }):
  StructuredCall`.
- `src/memory/review.ts` keeps exporting `ReviewHandle` and
  `ReviewQueryFn`, now aliases of the two above; `runReview`'s signature
  and outcomes are unchanged.

- [ ] **Step 1: Write the types and the boundary test**

Create `src/compaction/types.ts` with the repository header and:

```ts
// One question to a model, answered as JSON matching schema. Compaction
// defines it and is given an implementation, so nothing here depends on
// the Agent SDK; after the move to the Messages API only the
// implementation changes.
export type StructuredRequest = {
    // Names the call in its errors: "the review ended without a result".
    what: string;
    system: string;
    prompt: string;
    schema: Record<string, unknown>;
    timeoutMs: number;
    signal?: AbortSignal;
};

// A failed call still reports what it cost.
export type StructuredOutcome =
    | { ok: true; output: unknown; model: string; costUsd: number }
    | { ok: false; reason: string; costUsd: number };

export type StructuredCall = (
    request: StructuredRequest,
) => Promise<StructuredOutcome>;
```

Create `src/compaction/boundary.test.ts` with the repository header and:

```ts
import { describe, expect, it } from "bun:test";
import { Glob } from "bun";

describe("compaction", () => {
    it("imports nothing from the Agent SDK", async () => {
        const importers: string[] = [];
        for await (const path of new Glob("*.ts").scan(import.meta.dir)) {
            const text = await Bun.file(`${import.meta.dir}/${path}`).text();
            if (
                path !== import.meta.file &&
                text.includes("@anthropic-ai/claude-agent-sdk")
            ) {
                importers.push(path);
            }
        }
        expect(importers.sort()).toEqual([]);
    });

    it("reaches the SDK only through what it is given", async () => {
        const importers: string[] = [];
        for await (const path of new Glob("*.ts").scan(import.meta.dir)) {
            const text = await Bun.file(`${import.meta.dir}/${path}`).text();
            if (
                path !== import.meta.file &&
                /from "\.\.\/(structured|conversation|memory\/review|memory\/service)\.js"/.test(
                    text.replaceAll(/import type [^;]+;/g, ""),
                )
            ) {
                importers.push(path);
            }
        }
        expect(importers.sort()).toEqual([]);
    });
});
```

The second test allows `import type` from `../conversation.js` (for
`ChatSession`) but no value import from a module that loads the SDK.

- [ ] **Step 2: Write the failing structured-call tests**

Create `src/structured.test.ts` with the repository header and:

```ts
import { describe, expect, it } from "bun:test";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { StructuredRequest } from "./compaction/types.js";
import type { Timers } from "./memory/scheduler.js";
import { baseOptions, cliOptions } from "./persona.js";
import { type StructuredQueryFn, structuredCall } from "./structured.js";

const init = (model = "claude-test") =>
    ({
        type: "system",
        subtype: "init",
        model,
        session_id: "s",
    }) as unknown as SDKMessage;
const success = (output: unknown, cost = 0.25) =>
    ({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
        structured_output: output,
        total_cost_usd: cost,
    }) as unknown as SDKMessage;
const failure = (errors: string[]) =>
    ({
        type: "result",
        subtype: "error_max_structured_output_retries",
        is_error: true,
        errors,
        total_cost_usd: 0.5,
    }) as unknown as SDKMessage;

type Fake = {
    fn: StructuredQueryFn;
    prompt: string | null;
    options: Options | null;
    closed: boolean;
};

// "hang" never yields, standing for a call that never answers.
function fakeQuery(script: SDKMessage[] | "hang" | Error): Fake {
    const fake: Fake = {
        fn: ({ prompt, options }) => {
            fake.prompt = prompt;
            fake.options = options;
            async function* run(): AsyncGenerator<SDKMessage> {
                if (script === "hang") {
                    await new Promise(() => {});
                    return;
                }
                if (script instanceof Error) {
                    throw script;
                }
                yield* script;
            }
            return Object.assign(run(), {
                close: () => {
                    fake.closed = true;
                },
            });
        },
        prompt: null,
        options: null,
        closed: false,
    };
    return fake;
}

// Timers that fire only when told to.
function manualTimers() {
    const pending = new Map<number, () => void>();
    let next = 1;
    const timers: Timers = {
        set: (fn) => {
            const id = next++;
            pending.set(id, fn);
            return id;
        },
        clear: (handle) => {
            pending.delete(handle as number);
        },
    };
    const fire = () => {
        for (const [id, fn] of [...pending]) {
            pending.delete(id);
            fn();
        }
    };
    return { timers, pending, fire };
}

const REQUEST: StructuredRequest = {
    what: "compaction",
    system: "You are Dorothy.",
    prompt: "<turns/>",
    schema: { type: "object" },
    timeoutMs: 120_000,
};

describe("structuredCall", () => {
    it("asks once, with no tools, on the CLI's private home", async () => {
        const fake = fakeQuery([init(), success({ a: 1 })]);
        await structuredCall({ queryFn: fake.fn })(REQUEST);
        expect(fake.prompt).toBe("<turns/>");
        expect(fake.options).toEqual({
            ...baseOptions,
            ...cliOptions(),
            systemPrompt: "You are Dorothy.",
            includePartialMessages: false,
            outputFormat: { type: "json_schema", schema: { type: "object" } },
        });
        expect(fake.closed).toBe(true);
    });

    it("answers with the output, the model and the cost", async () => {
        const fake = fakeQuery([init("claude-x"), success({ a: 1 }, 0.3)]);
        expect(await structuredCall({ queryFn: fake.fn })(REQUEST)).toEqual({
            ok: true,
            output: { a: 1 },
            model: "claude-x",
            costUsd: 0.3,
        });
    });

    it("fails with the errors, keeping the cost", async () => {
        const fake = fakeQuery([init(), failure(["bad output"])]);
        expect(await structuredCall({ queryFn: fake.fn })(REQUEST)).toEqual({
            ok: false,
            reason: "bad output",
            costUsd: 0.5,
        });
    });

    it("names itself when it ends without a result", async () => {
        const fake = fakeQuery([init()]);
        expect(await structuredCall({ queryFn: fake.fn })(REQUEST)).toEqual({
            ok: false,
            reason: "the compaction ended without a result",
            costUsd: 0,
        });
    });

    it("fails with what the query threw", async () => {
        const fake = fakeQuery(new Error("offline"));
        expect(await structuredCall({ queryFn: fake.fn })(REQUEST)).toEqual({
            ok: false,
            reason: "offline",
            costUsd: 0,
        });
    });

    it("times out, closing the query", async () => {
        const fake = fakeQuery("hang");
        const { timers, fire } = manualTimers();
        const answer = structuredCall({ queryFn: fake.fn, timers })(REQUEST);
        fire();
        expect(await answer).toEqual({
            ok: false,
            reason: "timed out after 120s",
            costUsd: 0,
        });
        expect(fake.closed).toBe(true);
    });

    it("stops when cancelled, before or during", async () => {
        const controller = new AbortController();
        controller.abort();
        const before = fakeQuery([init(), success({})]);
        expect(
            await structuredCall({ queryFn: before.fn })({
                ...REQUEST,
                signal: controller.signal,
            }),
        ).toEqual({ ok: false, reason: "cancelled", costUsd: 0 });
        expect(before.prompt).toBeNull();
        const during = new AbortController();
        const hang = fakeQuery("hang");
        const { timers, pending } = manualTimers();
        const answer = structuredCall({ queryFn: hang.fn, timers })({
            ...REQUEST,
            signal: during.signal,
        });
        during.abort();
        expect(await answer).toEqual({
            ok: false,
            reason: "cancelled",
            costUsd: 0,
        });
        expect(pending.size).toBe(0);
    });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `bun test src/structured.test.ts src/compaction/`
Expected: FAIL: `./structured.js` does not exist. The boundary tests pass.

- [ ] **Step 4: Implement `structuredCall`**

Create `src/structured.ts` with the repository header and:

```ts
import { type Options, query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
    StructuredCall,
    StructuredOutcome,
    StructuredRequest,
} from "./compaction/types.js";
import { REAL_TIMERS, type Timers } from "./memory/scheduler.js";
import { baseOptions, cliOptions } from "./persona.js";

export type StructuredHandle = AsyncIterable<SDKMessage> & { close(): void };
// The SDK's query() fits this; tests pass a fake.
export type StructuredQueryFn = (params: {
    prompt: string;
    options: Options;
}) => StructuredHandle;

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// One-shot query() calls on Dorothy's model, answering with structured
// output: her reviews and her compactions. A timeout or a cancel ends the
// call even if the query never yields again.
export function structuredCall({
    queryFn = query,
    timers = REAL_TIMERS,
}: { queryFn?: StructuredQueryFn; timers?: Timers } = {}): StructuredCall {
    return (request) => run(queryFn, timers, request);
}

async function run(
    queryFn: StructuredQueryFn,
    timers: Timers,
    { what, system, prompt, schema, timeoutMs, signal }: StructuredRequest,
): Promise<StructuredOutcome> {
    if (signal?.aborted) {
        return { ok: false, reason: "cancelled", costUsd: 0 };
    }
    let handle: StructuredHandle;
    try {
        handle = queryFn({
            prompt,
            options: {
                ...baseOptions,
                ...cliOptions(),
                systemPrompt: system,
                includePartialMessages: false,
                outputFormat: { type: "json_schema", schema },
            },
        });
    } catch (error) {
        return { ok: false, reason: describeError(error), costUsd: 0 };
    }
    let stopped: string | null = null;
    let wake = () => {};
    const halted = new Promise<void>((resolve) => {
        wake = resolve;
    });
    const stop = (reason: string) => {
        stopped ??= reason;
        wake();
    };
    const timer = timers.set(
        () => stop(`timed out after ${timeoutMs / 1000}s`),
        timeoutMs,
    );
    const onAbort = () => stop("cancelled");
    signal?.addEventListener("abort", onAbort);

    let model = "unknown";
    let result: ResultMessage | null = null;
    let thrown: string | null = null;
    const consume = async () => {
        for await (const message of handle) {
            if (message.type === "system" && message.subtype === "init") {
                model = message.model;
            } else if (message.type === "result") {
                result = message;
                return;
            }
        }
    };
    try {
        await Promise.race([
            consume().catch((error: unknown) => {
                thrown = describeError(error);
            }),
            halted,
        ]);
    } finally {
        timers.clear(timer);
        signal?.removeEventListener("abort", onAbort);
        handle.close();
    }

    if (stopped !== null) {
        return { ok: false, reason: stopped, costUsd: 0 };
    }
    if (thrown !== null) {
        return { ok: false, reason: thrown, costUsd: 0 };
    }
    const final = result as ResultMessage | null;
    if (final === null) {
        return {
            ok: false,
            reason: `the ${what} ended without a result`,
            costUsd: 0,
        };
    }
    const costUsd = final.total_cost_usd;
    if (final.subtype !== "success") {
        return {
            ok: false,
            reason: final.errors.join("; ") || final.subtype,
            costUsd,
        };
    }
    if (final.is_error) {
        return { ok: false, reason: final.result || "error", costUsd };
    }
    return { ok: true, output: final.structured_output, model, costUsd };
}
```

- [ ] **Step 5: Run the structured-call tests to verify they pass**

Run: `bun test src/structured.test.ts src/compaction/`
Expected: PASS.

- [ ] **Step 6: Rebuild `runReview` on it**

In `src/memory/review.ts`, replace the `ReviewHandle` and `ReviewQueryFn`
declarations with:

```ts
// The SDK's query() fits this; tests pass a fake.
export type ReviewHandle = StructuredHandle;
export type ReviewQueryFn = StructuredQueryFn;
```

importing `{ type StructuredHandle, type StructuredQueryFn, structuredCall }`
from `../structured.js`. Replace `runReview`'s body (keeping its signature
and its doc comment) with:

```ts
    const outcome = await structuredCall({ queryFn, timers })({
        what: "review",
        system: systemPrompt,
        prompt,
        schema,
        timeoutMs,
        ...(signal === undefined ? {} : { signal }),
    });
    if (!outcome.ok) {
        return outcome;
    }
    const checked = validateReview(outcome.output, readIds);
    return checked.ok
        ? {
              ok: true,
              notes: checked.notes,
              appraisals: checked.appraisals,
              model: outcome.model,
              costUsd: outcome.costUsd,
          }
        : { ok: false, reason: checked.reason, costUsd: outcome.costUsd };
```

Delete the now-unused `ResultMessage` type, `describeError` (if nothing
else in the file uses it), and the `baseOptions`, `cliOptions`, `Options`
and `SDKMessage` imports that only `runReview` used.

- [ ] **Step 7: Run every review test to verify nothing changed**

Run: `bun test src/memory/ src/structured.test.ts src/compaction/`
Expected: PASS, with `src/memory/review.test.ts` and
`src/memory/service.test.ts` unchanged.

- [ ] **Step 8: Check and commit**

```bash
bunx biome check --write src/compaction/ src/structured.ts src/structured.test.ts src/memory/review.ts
bun run check
git add src/compaction/ src/structured.ts src/structured.test.ts src/memory/review.ts
git commit -m "feat(sdk): Add structured calls, used by reviews"
git log --oneline -1 && git status --short
```

### Task 10: Planning a compaction

**Files:**

- Create: `src/compaction/plan.ts`
- Create: `src/compaction/plan.test.ts`

**Interfaces:**

- Consumes: `Cluster` (Task 3), `withClusters` (Task 7), `tokens`
  (`src/memory/rank.ts`), `Turn` (`src/persona.ts`).
- Produces:

  ```ts
  export type Range = { from: number; through: number };
  export function covered(clusters: readonly Cluster[]): number;
  export function seedTurns<T>(turns: readonly T[], clusters: readonly Cluster[]): T[];
  export function outgoing(turns: readonly Turn[], clusters: readonly Cluster[], tail: number): Range | null;
  export function clusterTokens(clusters: readonly Cluster[], recollect: boolean): number;
  export type Pressure = "none" | "soft" | "hard";
  export function pressure(context: number, limits: { soft: number; hard: number }): Pressure;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/compaction/plan.test.ts` with the repository header and:

```ts
import { describe, expect, it } from "bun:test";
import type { Cluster } from "../memory/sidecar.js";
import { type Turn, withClusters } from "../persona.js";
import {
    clusterTokens,
    covered,
    outgoing,
    pressure,
    seedTurns,
} from "./plan.js";

// Four characters make a token.
const user = (text = "abcd"): Turn => ({ role: "user", text });
const reply = (text = "abcd"): Turn => ({ role: "assistant", text });
const cluster = (from: number, through: number): Cluster => ({
    from,
    through,
    abstract: "About it.",
    at: "x",
    model: "m",
});
const SIX = [user(), reply(), user(), reply(), user(), reply()];

describe("covered and seedTurns", () => {
    it("start after the last cluster", () => {
        expect(covered([])).toBe(0);
        expect(covered([cluster(1, 2), cluster(3, 4)])).toBe(4);
        expect(seedTurns(SIX, [cluster(1, 4)])).toEqual(SIX.slice(4));
        expect(seedTurns(SIX, [])).toEqual(SIX);
    });
});

describe("outgoing", () => {
    it("keeps the newest turns that fit the tail, compacting the rest", () => {
        expect(outgoing(SIX, [], 4)).toEqual({ from: 1, through: 2 });
    });

    it("starts after what is already compacted", () => {
        expect(outgoing(SIX, [cluster(1, 1)], 3)).toEqual({
            from: 2,
            through: 3,
        });
    });

    it("always keeps the latest exchange, however large", () => {
        const turns = [user(), reply(), user("x".repeat(400)), reply()];
        expect(outgoing(turns, [], 4)).toEqual({ from: 1, through: 2 });
    });

    it("finds nothing when the latest exchange is all there is", () => {
        expect(outgoing([user("x".repeat(400)), reply()], [], 4)).toBeNull();
    });

    it("finds nothing when everything else fits the tail", () => {
        expect(outgoing(SIX, [], 100)).toBeNull();
        expect(outgoing(SIX, [cluster(1, 3)], 3)).toBeNull();
    });

    it("keeps a reply still to come with its message", () => {
        const waiting = [user(), reply(), user(), reply(), user()];
        expect(outgoing(waiting, [], 1)).toEqual({ from: 1, through: 4 });
    });
});

describe("clusterTokens", () => {
    it("costs what withClusters adds, and nothing without clusters", () => {
        const clusters = [cluster(1, 4)];
        expect(clusterTokens([], true)).toBe(0);
        expect(clusterTokens(clusters, true)).toBe(
            Math.ceil([...withClusters("", clusters, true)].length / 4),
        );
    });
});

describe("pressure", () => {
    it("is soft past soft and hard past hard", () => {
        const limits = { soft: 100, hard: 200 };
        expect(pressure(100, limits)).toBe("none");
        expect(pressure(101, limits)).toBe("soft");
        expect(pressure(201, limits)).toBe("hard");
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/compaction/plan.test.ts`
Expected: FAIL: `./plan.js` does not exist.

- [ ] **Step 3: Implement**

Create `src/compaction/plan.ts` with the repository header and:

```ts
import { tokens } from "../memory/rank.js";
import type { Cluster } from "../memory/sidecar.js";
import { type Turn, withClusters } from "../persona.js";

// Turns from to through, counting from 1, both included.
export type Range = { from: number; through: number };

// The last turn the clusters cover; 0 for none.
export const covered = (clusters: readonly Cluster[]): number =>
    clusters.at(-1)?.through ?? 0;

// What a session is seeded with in full: the turns after the clusters.
export function seedTurns<T>(
    turns: readonly T[],
    clusters: readonly Cluster[],
): T[] {
    return turns.slice(covered(clusters));
}

// The turns that leave the context: after the clusters, before the newest
// turns that fit in tail. The latest exchange, from the user's last message
// on, always stays, however large. Null when nothing would leave.
export function outgoing(
    turns: readonly Turn[],
    clusters: readonly Cluster[],
    tail: number,
): Range | null {
    const done = covered(clusters);
    const lastUser = turns.findLastIndex((turn) => turn.role === "user");
    // The index of the first turn kept.
    let keep = Math.max(done, lastUser === -1 ? turns.length : lastUser);
    let used = turns
        .slice(keep)
        .reduce((sum, turn) => sum + tokens(turn.text), 0);
    while (keep > done) {
        const size = tokens((turns[keep - 1] as Turn).text);
        if (used + size > tail) {
            break;
        }
        used += size;
        keep--;
    }
    return keep > done ? { from: done + 1, through: keep } : null;
}

// What the abstracts cost in a session's prompt, charged to the memory
// budget before any note on another conversation.
export function clusterTokens(
    clusters: readonly Cluster[],
    recollect: boolean,
): number {
    return clusters.length === 0
        ? 0
        : tokens(withClusters("", clusters, recollect));
}

export type Pressure = "none" | "soft" | "hard";

export function pressure(
    context: number,
    { soft, hard }: { soft: number; hard: number },
): Pressure {
    return context > hard ? "hard" : context > soft ? "soft" : "none";
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test src/compaction/`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
bunx biome check --write src/compaction/plan.ts src/compaction/plan.test.ts
bun run check
git add src/compaction/plan.ts src/compaction/plan.test.ts
git commit -m "feat: Plan which turns leave the context"
git log --oneline -1 && git status --short
```

### Task 11: Dorothy's clusters

**Files:**

- Create: `src/compaction/clusters.ts`
- Create: `src/compaction/compact.ts`
- Create: `src/compaction/clusters.test.ts`, `src/compaction/compact.test.ts`

**Interfaces:**

- Consumes: `Range`, `outgoing` (Task 10); `StructuredCall` (Task 9);
  `escapeXml`, `unescapeXml` (Task 8); `Cluster`, `LIMITS`, `normalise`,
  `overLimit` (`src/memory/sidecar.ts`).
- Produces:

  ```ts
  export const CLUSTER_INSTRUCTIONS: string;
  export function clusterPrompt(turns: readonly Turn[], range: Range, clusters: readonly Cluster[]): string;
  export function clusterSchema(range: Range): Record<string, unknown>;
  export function validateClusters(output: unknown, range: Range, stamp: { at: string; model: string }):
      { ok: true; clusters: Cluster[] } | { ok: false; reason: string };
  export const COMPACTION_TIMEOUT_MS = 120_000;
  export type CompactOutcome =
      | { kind: "compacted"; range: Range; clusters: Cluster[]; costUsd: number }
      | { kind: "nothing" }
      | { kind: "failed"; reason: string; costUsd: number };
  export function compact(request: {
      turns: readonly Turn[]; clusters: readonly Cluster[]; tail: number;
      persona: string; call: StructuredCall; now: () => Date; signal?: AbortSignal;
  }): Promise<CompactOutcome>;
  ```

- [ ] **Step 1: Write the failing cluster tests**

Create `src/compaction/clusters.test.ts` with the repository header and:

```ts
import { describe, expect, it } from "bun:test";
import type { Cluster } from "../memory/sidecar.js";
import type { Turn } from "../persona.js";
import {
    CLUSTER_INSTRUCTIONS,
    clusterPrompt,
    clusterSchema,
    validateClusters,
} from "./clusters.js";

const STAMP = { at: "2026-10-07T08:00:00.000Z", model: "claude-test" };
const RANGE = { from: 3, through: 6 };
const turns: Turn[] = [
    { role: "user", text: "One." },
    { role: "assistant", text: "Two." },
    { role: "user", text: "Cats & <dogs>?" },
    { role: "assistant", text: "Four." },
    { role: "user", text: "Five." },
    { role: "assistant", text: "Six." },
    { role: "user", text: "Seven." },
];
const earlier: Cluster[] = [
    { from: 1, through: 2, abstract: "The start.", ...STAMP },
];

describe("clusterPrompt", () => {
    it("gives the earlier abstracts, then the outgoing turns, numbered", () => {
        expect(clusterPrompt(turns, RANGE, earlier)).toBe(
            [
                "Your summaries of the turns before these, for context; do not repeat them:",
                "<earlier>",
                '<cluster n="1" turns="1-2">The start.</cluster>',
                "</earlier>",
                "",
                "The turns leaving your context, numbered:",
                "<turns>",
                '<turn n="3">User: Cats &amp; &lt;dogs&gt;?</turn>',
                '<turn n="4">Dorothy: Four.</turn>',
                '<turn n="5">User: Five.</turn>',
                '<turn n="6">Dorothy: Six.</turn>',
                "</turns>",
            ].join("\n"),
        );
    });

    it("leaves out the earlier part when there is none", () => {
        expect(clusterPrompt(turns, { from: 1, through: 2 }, [])).toBe(
            [
                "The turns leaving your context, numbered:",
                "<turns>",
                '<turn n="1">User: One.</turn>',
                '<turn n="2">Dorothy: Two.</turn>',
                "</turns>",
            ].join("\n"),
        );
    });
});

describe("the instructions and schema", () => {
    it("ask for topical clusters and abstracts within their limit", () => {
        expect(CLUSTER_INSTRUCTIONS).toContain("where the topic changes");
        expect(CLUSTER_INSTRUCTIONS).toContain("1,000 characters");
        expect(clusterSchema(RANGE)).toEqual({
            type: "object",
            properties: {
                clusters: {
                    type: "array",
                    minItems: 1,
                    items: {
                        type: "object",
                        properties: {
                            through: { type: "integer", minimum: 3, maximum: 6 },
                            abstract: {
                                type: "string",
                                minLength: 1,
                                maxLength: 1000,
                            },
                        },
                        required: ["through", "abstract"],
                        additionalProperties: false,
                    },
                },
            },
            required: ["clusters"],
            additionalProperties: false,
        });
    });
});

describe("validateClusters", () => {
    const valid = (output: unknown) => validateClusters(output, RANGE, STAMP);

    it("fills in each cluster's start, unescaped and normalised", () => {
        expect(
            valid({
                clusters: [
                    { through: 4, abstract: " Cats &amp;\n dogs. " },
                    { through: 6, abstract: "Five and six." },
                ],
            }),
        ).toEqual({
            ok: true,
            clusters: [
                { from: 3, through: 4, abstract: "Cats & dogs.", ...STAMP },
                { from: 5, through: 6, abstract: "Five and six.", ...STAMP },
            ],
        });
    });

    it("refuses what does not cover the range in order", () => {
        const reasons = [
            [{}, "no clusters in the result"],
            [{ clusters: [] }, "no clusters in the result"],
            [
                { clusters: [{ through: 7, abstract: "a" }] },
                "cluster 1 ends at 7, outside 3-6",
            ],
            [
                {
                    clusters: [
                        { through: 5, abstract: "a" },
                        { through: 4, abstract: "b" },
                    ],
                },
                "cluster 2 ends at 4, outside 6-6",
            ],
            [
                { clusters: [{ through: 4.5, abstract: "a" }] },
                "cluster 1 ends at 4.5, outside 3-6",
            ],
            [
                { clusters: [{ through: 5, abstract: "a" }] },
                "the last cluster ends at 5, not 6",
            ],
            [
                { clusters: [{ through: 6, abstract: "  " }] },
                "the abstract of cluster 1 is empty",
            ],
            [
                { clusters: [{ through: 6, abstract: "x".repeat(1001) }] },
                "cluster 1: abstract is 1001 characters, over 1000",
            ],
        ] as const;
        for (const [output, reason] of reasons) {
            expect(valid(output)).toEqual({ ok: false, reason });
        }
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/compaction/clusters.test.ts`
Expected: FAIL: `./clusters.js` does not exist.

- [ ] **Step 3: Implement `clusters.ts`**

Create `src/compaction/clusters.ts` with the repository header and:

```ts
import { escapeXml, unescapeXml } from "../memory/block.js";
import {
    type Cluster,
    LIMITS,
    normalise,
    overLimit,
} from "../memory/sidecar.js";
import type { Turn } from "../persona.js";
import type { Range } from "./plan.js";

export const CLUSTER_INSTRUCTIONS = [
    "This time you are not chatting. The message holds the oldest turns of",
    "your current conversation with the user that are still word for word in",
    "your context; they are about to leave it. Divide them into consecutive",
    "clusters, starting a new cluster where the topic changes; one cluster is",
    "fine when they hold one topic. For each cluster give the number of its",
    "last turn, and write an abstract of at most 1,000 characters, in your",
    "own words and from your point of view, of what was said, decided and",
    "left open, noting what you might want to look up later. Your abstracts",
    "stay in your context for the rest of the conversation, and you can open",
    "any cluster's turns word for word. If you said you were in development",
    "mode, say so in the abstract. The message escapes &, < and > as &amp;,",
    "&lt; and &gt;; write the abstracts as plain text, not escaped.",
].join(" ");

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// The earlier abstracts for context, then the outgoing turns by number.
export function clusterPrompt(
    turns: readonly Turn[],
    range: Range,
    clusters: readonly Cluster[],
): string {
    const earlier =
        clusters.length === 0
            ? []
            : [
                  "Your summaries of the turns before these, for context; do not repeat them:",
                  "<earlier>",
                  ...clusters.map(
                      (cluster, at) =>
                          `<cluster n="${at + 1}" turns="${cluster.from}-${cluster.through}">${escapeXml(cluster.abstract)}</cluster>`,
                  ),
                  "</earlier>",
                  "",
              ];
    const outgoing = turns
        .slice(range.from - 1, range.through)
        .map(
            (turn, at) =>
                `<turn n="${range.from + at}">${turn.role === "user" ? "User" : "Dorothy"}: ${escapeXml(turn.text)}</turn>`,
        );
    return [
        ...earlier,
        "The turns leaving your context, numbered:",
        "<turns>",
        ...outgoing,
        "</turns>",
    ].join("\n");
}

export function clusterSchema(range: Range): Record<string, unknown> {
    return {
        type: "object",
        properties: {
            clusters: {
                type: "array",
                minItems: 1,
                items: {
                    type: "object",
                    properties: {
                        through: {
                            type: "integer",
                            minimum: range.from,
                            maximum: range.through,
                        },
                        abstract: {
                            type: "string",
                            minLength: 1,
                            maxLength: LIMITS.abstract,
                        },
                    },
                    required: ["through", "abstract"],
                    additionalProperties: false,
                },
            },
        },
        required: ["clusters"],
        additionalProperties: false,
    };
}

// The schema asked for this; the model's output is checked again. Each
// cluster starts on the turn after the one before, so only the ends need
// checking: in order, within the range, the last at its end.
export function validateClusters(
    output: unknown,
    range: Range,
    stamp: { at: string; model: string },
): { ok: true; clusters: Cluster[] } | { ok: false; reason: string } {
    const list = isRecord(output) ? output.clusters : undefined;
    if (!Array.isArray(list) || list.length === 0) {
        return { ok: false, reason: "no clusters in the result" };
    }
    const clusters: Cluster[] = [];
    let from = range.from;
    for (const [at, item] of list.entries()) {
        const n = at + 1;
        const fields = isRecord(item) ? item : {};
        const through = fields.through;
        if (
            typeof through !== "number" ||
            !Number.isInteger(through) ||
            through < from ||
            through > range.through
        ) {
            return {
                ok: false,
                reason: `cluster ${n} ends at ${String(through)}, outside ${from}-${range.through}`,
            };
        }
        const abstract =
            typeof fields.abstract === "string"
                ? normalise(unescapeXml(fields.abstract))
                : "";
        if (abstract === "") {
            return { ok: false, reason: `the abstract of cluster ${n} is empty` };
        }
        const problem = overLimit("abstract", abstract);
        if (problem !== null) {
            return { ok: false, reason: `cluster ${n}: ${problem}` };
        }
        clusters.push({ from, through, abstract, ...stamp });
        from = through + 1;
    }
    const last = (clusters.at(-1) as Cluster).through;
    if (last !== range.through) {
        return {
            ok: false,
            reason: `the last cluster ends at ${last}, not ${range.through}`,
        };
    }
    return { ok: true, clusters };
}
```

- [ ] **Step 4: Run the cluster tests to verify they pass**

Run: `bun test src/compaction/clusters.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `compact` tests**

Create `src/compaction/compact.test.ts` with the repository header and:

```ts
import { describe, expect, it } from "bun:test";
import type { Turn } from "../persona.js";
import { CLUSTER_INSTRUCTIONS } from "./clusters.js";
import { COMPACTION_TIMEOUT_MS, compact } from "./compact.js";
import type {
    StructuredCall,
    StructuredOutcome,
    StructuredRequest,
} from "./types.js";

const NOW = new Date("2026-10-07T08:00:00.000Z");
const turns: Turn[] = [
    { role: "user", text: "abcd" },
    { role: "assistant", text: "abcd" },
    { role: "user", text: "abcd" },
    { role: "assistant", text: "abcd" },
];

function answering(outcome: StructuredOutcome) {
    const requests: StructuredRequest[] = [];
    const call: StructuredCall = async (request) => {
        requests.push(request);
        return outcome;
    };
    return { call, requests };
}
const run = (call: StructuredCall, signal?: AbortSignal) =>
    compact({
        turns,
        clusters: [],
        tail: 2,
        persona: "You are Dorothy,",
        call,
        now: () => NOW,
        ...(signal === undefined ? {} : { signal }),
    });

describe("compact", () => {
    it("asks Dorothy about the outgoing turns, as herself", async () => {
        const { call, requests } = answering({
            ok: true,
            output: { clusters: [{ through: 2, abstract: "The start." }] },
            model: "claude-test",
            costUsd: 0.1,
        });
        expect(await run(call)).toEqual({
            kind: "compacted",
            range: { from: 1, through: 2 },
            clusters: [
                {
                    from: 1,
                    through: 2,
                    abstract: "The start.",
                    at: NOW.toISOString(),
                    model: "claude-test",
                },
            ],
            costUsd: 0.1,
        });
        expect(requests[0]?.what).toBe("compaction");
        expect(requests[0]?.system).toBe(
            `You are Dorothy,\n\n${CLUSTER_INSTRUCTIONS}`,
        );
        expect(requests[0]?.prompt).toContain('<turn n="2">');
        expect(requests[0]?.prompt).not.toContain('<turn n="3">');
        expect(requests[0]?.timeoutMs).toBe(COMPACTION_TIMEOUT_MS);
    });

    it("asks nothing when nothing would leave", async () => {
        const { call, requests } = answering({
            ok: false,
            reason: "unused",
            costUsd: 0,
        });
        expect(
            await compact({
                turns,
                clusters: [],
                tail: 100,
                persona: "P",
                call,
                now: () => NOW,
            }),
        ).toEqual({ kind: "nothing" });
        expect(requests).toEqual([]);
    });

    it("fails with the call's reason, or the output's, keeping the cost", async () => {
        expect(
            await run(
                answering({ ok: false, reason: "offline", costUsd: 0.2 }).call,
            ),
        ).toEqual({ kind: "failed", reason: "offline", costUsd: 0.2 });
        expect(
            await run(
                answering({
                    ok: true,
                    output: { clusters: [{ through: 1, abstract: "a" }] },
                    model: "m",
                    costUsd: 0.3,
                }).call,
            ),
        ).toEqual({
            kind: "failed",
            reason: "the last cluster ends at 1, not 2",
            costUsd: 0.3,
        });
    });

    it("passes the signal on", async () => {
        const controller = new AbortController();
        const { call, requests } = answering({
            ok: false,
            reason: "cancelled",
            costUsd: 0,
        });
        await run(call, controller.signal);
        expect(requests[0]?.signal).toBe(controller.signal);
    });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `bun test src/compaction/compact.test.ts`
Expected: FAIL: `./compact.js` does not exist.

- [ ] **Step 7: Implement `compact.ts`**

Create `src/compaction/compact.ts` with the repository header and:

```ts
import type { Cluster } from "../memory/sidecar.js";
import type { Turn } from "../persona.js";
import {
    CLUSTER_INSTRUCTIONS,
    clusterPrompt,
    clusterSchema,
    validateClusters,
} from "./clusters.js";
import { outgoing, type Range } from "./plan.js";
import type { StructuredCall } from "./types.js";

// As long as a review may take.
export const COMPACTION_TIMEOUT_MS = 120_000;

export type CompactOutcome =
    | { kind: "compacted"; range: Range; clusters: Cluster[]; costUsd: number }
    | { kind: "nothing" }
    | { kind: "failed"; reason: string; costUsd: number };

// One compaction: which turns leave, Dorothy's clusters of them, checked.
// It writes nothing; the caller saves what it returns.
export async function compact({
    turns,
    clusters,
    tail,
    persona,
    call,
    now,
    signal,
}: {
    turns: readonly Turn[];
    clusters: readonly Cluster[];
    tail: number;
    persona: string;
    call: StructuredCall;
    now: () => Date;
    signal?: AbortSignal;
}): Promise<CompactOutcome> {
    const range = outgoing(turns, clusters, tail);
    if (range === null) {
        return { kind: "nothing" };
    }
    const outcome = await call({
        what: "compaction",
        system: [persona, CLUSTER_INSTRUCTIONS].join("\n\n"),
        prompt: clusterPrompt(turns, range, clusters),
        schema: clusterSchema(range),
        timeoutMs: COMPACTION_TIMEOUT_MS,
        ...(signal === undefined ? {} : { signal }),
    });
    if (!outcome.ok) {
        return {
            kind: "failed",
            reason: outcome.reason,
            costUsd: outcome.costUsd,
        };
    }
    const checked = validateClusters(outcome.output, range, {
        at: now().toISOString(),
        model: outcome.model,
    });
    return checked.ok
        ? {
              kind: "compacted",
              range,
              clusters: checked.clusters,
              costUsd: outcome.costUsd,
          }
        : { kind: "failed", reason: checked.reason, costUsd: outcome.costUsd };
}
```

- [ ] **Step 8: Run them to verify they pass**

Run: `bun test src/compaction/`
Expected: PASS.

- [ ] **Step 9: Check and commit**

```bash
bunx biome check --write src/compaction/
bun run check
git add src/compaction/
git commit -m "feat: Ask Dorothy to cluster the outgoing turns"
git log --oneline -1 && git status --short
```

### Task 12: The compacting session

**Files:**

- Create: `src/compaction/session.ts`
- Create: `src/compaction/session.test.ts`

**Interfaces:**

- Consumes: `compact`, `CompactOutcome` (Task 11); `pressure`, `seedTurns`
  (Task 10); `StructuredCall` (Task 9); `ChatSession`, `ConversationEvent`
  with `contextTokens`, `compacting`, `compacted`, `memory-cost` (Tasks 1
  and 7, type imports only); `Cluster` (Task 3); `CompactionConfig`
  (Task 2); `Timers`, `REAL_TIMERS` (`src/memory/scheduler.ts`).
- Produces:

  ```ts
  export const CLAIM_RETRY_MS = 2000;
  export const MAX_FAILURES = 3;
  export type Seed = { turns: Turn[]; clusters: readonly Cluster[] };
  export type Claim = { take(): Promise<boolean>; release(): Promise<void> };
  export type SaveResult = { ok: true } | { ok: false; reason: string };
  export type CompactionOptions = {
      config: Pick<CompactionConfig, "soft" | "hard" | "tail">;
      idleMs: number;
      clusters: readonly Cluster[];
      persona: string;
      call: StructuredCall;
      save(clusters: readonly Cluster[]): Promise<SaveResult>;
      record(entry: { through: number; clusters: number }): Promise<void>;
      estimate(seed: Seed): number;
      claim?: Claim | null;
      timers?: Timers;
      now?: () => Date;
  };
  export class Compaction {
      constructor(options: CompactionOptions);
      clusters(): readonly Cluster[];
      seed(turns: readonly Turn[]): Seed;
      session(turns: readonly Turn[], connect: (seed: Seed) => ChatSession): ChatSession;
      stop(): Promise<void>;
  }
  ```

The `Compaction` lives for the whole run and keeps the clusters and the
failure count; each `session()` call (first start, `--resume`,
reconnecting) wraps a new inner session made by `connect`, and replaces it
with another at each compaction.

- [ ] **Step 1: Write the failing tests**

Create `src/compaction/session.test.ts` with the repository header and:

```ts
import { describe, expect, it } from "bun:test";
import type {
    ChatSession,
    ConversationEvent,
    TurnStats,
} from "../conversation.js";
import type { Timers } from "../memory/scheduler.js";
import type { Cluster } from "../memory/sidecar.js";
import type { Turn } from "../persona.js";
import {
    CLAIM_RETRY_MS,
    type Claim,
    Compaction,
    type SaveResult,
    type Seed,
} from "./session.js";
import type { StructuredOutcome, StructuredRequest } from "./types.js";

const NOW = new Date("2026-10-07T08:00:00.000Z");
const STATS: TurnStats = {
    inputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 1,
    ttftMs: null,
    durationMs: 1,
    costUsd: 0,
    sessionCostUsd: 0,
};
// Four characters make a token; with a tail of 4, four turns of history
// and an exchange compact turns 1 and 2.
const turn = (role: Turn["role"]): Turn => ({ role, text: "abcd" });
const HISTORY = [turn("user"), turn("assistant"), turn("user"), turn("assistant")];
const CLUSTERED: StructuredOutcome = {
    ok: true,
    output: { clusters: [{ through: 2, abstract: "The start." }] },
    model: "claude-test",
    costUsd: 0.1,
};

class FakeTimers implements Timers {
    #next = 1;
    #now = 0;
    readonly pending = new Map<number, { fn: () => void; at: number }>();
    set(fn: () => void, ms: number): number {
        const id = this.#next++;
        this.pending.set(id, { fn, at: this.#now + ms });
        return id;
    }
    clear(handle: unknown): void {
        this.pending.delete(handle as number);
    }
    advance(ms: number): void {
        this.#now += ms;
        for (const [id, timer] of [...this.pending]) {
            if (timer.at <= this.#now) {
                this.pending.delete(id);
                timer.fn();
            }
        }
    }
}

class FakeSession implements ChatSession {
    readonly sent: string[] = [];
    closed = false;
    readonly #listeners = new Set<(event: ConversationEvent) => void>();
    constructor(readonly seed: Seed) {}
    subscribe(listener: (event: ConversationEvent) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }
    send(text: string): void {
        this.sent.push(text);
    }
    interrupt(): Promise<void> {
        return Promise.resolve();
    }
    async close(): Promise<void> {
        this.closed = true;
    }
    emit(event: ConversationEvent): void {
        for (const listener of this.#listeners) {
            listener(event);
        }
    }
    reply(contextTokens: number, text = "abcd"): void {
        this.emit({
            type: "turn-end",
            reply: text,
            interrupted: false,
            stats: STATS,
            contextTokens,
        });
    }
}

// A call answered when the test says so.
type Pending = {
    request: StructuredRequest;
    answer: (outcome: StructuredOutcome) => void;
};

function harness({
    estimate = 0,
    claim = null,
    clusters = [],
    save = { ok: true },
}: {
    estimate?: number;
    claim?: Claim | null;
    clusters?: Cluster[];
    save?: SaveResult;
} = {}) {
    const timers = new FakeTimers();
    const sessions: FakeSession[] = [];
    const calls: Pending[] = [];
    const saved: Cluster[][] = [];
    const recorded: { through: number; clusters: number }[] = [];
    const compaction = new Compaction({
        config: { soft: 100, hard: 200, tail: 4 },
        idleMs: 1000,
        clusters,
        persona: "You are Dorothy,",
        call: (request) =>
            new Promise((answer) => {
                calls.push({ request, answer });
                request.signal?.addEventListener("abort", () =>
                    answer({ ok: false, reason: "cancelled", costUsd: 0 }),
                );
            }),
        save: async (added) => {
            saved.push([...added]);
            return save;
        },
        record: async (entry) => {
            recorded.push(entry);
        },
        estimate: () => estimate,
        claim,
        timers,
        now: () => NOW,
    });
    const connect = (seed: Seed) => {
        const session = new FakeSession(seed);
        sessions.push(session);
        return session;
    };
    const events: ConversationEvent[] = [];
    const open = (turns: Turn[] = HISTORY) => {
        const session = compaction.session(turns, connect);
        session.subscribe((event) => events.push(event));
        return session;
    };
    return { compaction, open, timers, sessions, calls, saved, recorded, events };
}

async function until(predicate: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !predicate(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(predicate()).toBe(true);
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const warnings = (events: ConversationEvent[]) =>
    events.flatMap((event) => (event.type === "warning" ? [event.message] : []));

describe("Compaction", () => {
    it("connects at once, seeded with the clusters and the turns after them", () => {
        const { open, sessions } = harness({
            clusters: [
                { from: 1, through: 2, abstract: "a", at: "x", model: "m" },
            ],
        });
        open();
        expect(sessions).toHaveLength(1);
        expect(sessions[0]?.seed.turns).toEqual(HISTORY.slice(2));
        expect(sessions[0]?.seed.clusters).toHaveLength(1);
    });

    it("compacts at the next idle past soft, then hands over", async () => {
        const h = harness();
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        expect(h.calls).toHaveLength(0);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions.length === 2);
        expect(h.saved).toEqual([
            [
                {
                    from: 1,
                    through: 2,
                    abstract: "The start.",
                    at: NOW.toISOString(),
                    model: "claude-test",
                },
            ],
        ]);
        expect(h.recorded).toEqual([{ through: 2, clusters: 1 }]);
        expect(h.sessions[0]?.closed).toBe(true);
        expect(h.sessions[1]?.seed.turns).toHaveLength(4);
        expect(h.sessions[1]?.seed.clusters.map((c) => c.through)).toEqual([2]);
        expect(h.compaction.clusters()).toHaveLength(1);
        expect(h.events).toContainEqual({
            type: "compacted",
            from: 1,
            through: 2,
            clusters: 1,
        });
        expect(h.events).toContainEqual({ type: "memory-cost", usd: 0.1 });
    });

    it("holds a message past hard until the new session takes it", async () => {
        const h = harness();
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("next");
        expect(h.sessions[0]?.sent).toEqual(["abcd"]);
        expect(h.events).toContainEqual({ type: "compacting" });
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions.length === 2);
        await until(() => h.sessions[1]?.sent.length === 1);
        expect(h.sessions[1]?.sent).toEqual(["next"]);
        expect(h.sessions[1]?.seed.turns.map((t) => t.text)).not.toContain(
            "next",
        );
    });

    it("sends a message during an idle compaction to the old session, into the tail", async () => {
        const h = harness();
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        session.send("during");
        expect(h.sessions[0]?.sent).toEqual(["abcd", "during"]);
        h.calls[0]?.answer(CLUSTERED);
        await settle();
        // The handover waits for the reply to the message sent meanwhile.
        expect(h.sessions).toHaveLength(1);
        h.sessions[0]?.reply(50, "done");
        await until(() => h.sessions.length === 2);
        const tail = h.sessions[1]?.seed.turns.map((t) => t.text) ?? [];
        expect(tail.slice(-2)).toEqual(["during", "done"]);
        expect(h.saved[0]?.at(-1)?.through).toBe(2);
    });

    it("seeds a reconnection from the clusters, not the whole conversation", async () => {
        const h = harness();
        const first = h.open();
        first.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions.length === 2);
        const all = [...HISTORY, turn("user"), turn("assistant")];
        h.open(all);
        expect(h.sessions[2]?.seed.turns).toEqual(all.slice(2));
        expect(h.sessions[2]?.seed.clusters).toHaveLength(1);
    });

    it("compacts before connecting a seed already past hard", async () => {
        const h = harness({ estimate: 500 });
        const session = h.open([...HISTORY, turn("user"), turn("assistant")]);
        expect(h.sessions).toHaveLength(0);
        session.send("early");
        await until(() => h.calls.length === 1);
        expect(h.events).toContainEqual({ type: "compacting" });
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions.length === 1);
        expect(h.sessions[0]?.seed.clusters).toHaveLength(1);
        await until(() => h.sessions[0]?.sent.length === 1);
        expect(h.sessions[0]?.sent).toEqual(["early"]);
    });

    it("on failure, warns and sends the held message to the old session", async () => {
        const h = harness();
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("next");
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer({ ok: false, reason: "offline", costUsd: 0.2 });
        await until(() => h.sessions[0]?.sent.includes("next") === true);
        expect(h.sessions).toHaveLength(1);
        expect(h.saved).toEqual([]);
        expect(warnings(h.events)).toEqual([
            "compaction failed: offline",
            "compaction: the context is nearly full; sending anyway",
        ]);
        expect(h.events).toContainEqual({ type: "memory-cost", usd: 0.2 });
    });

    it("waits twice as long after a failure, and gives up after three", async () => {
        const h = harness();
        const session = h.open();
        for (let failure = 0; failure < 3; failure++) {
            session.send("abcd");
            h.sessions[0]?.reply(150);
            h.timers.advance(1000 * 2 ** failure - 1);
            await settle();
            expect(h.calls).toHaveLength(failure);
            h.timers.advance(1);
            await until(() => h.calls.length === failure + 1);
            h.calls[failure]?.answer({ ok: false, reason: "bad", costUsd: 0 });
            await settle();
        }
        expect(warnings(h.events).at(-1)).toBe(
            "compaction failed: bad; no more tries until the next launch",
        );
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("straight");
        expect(h.sessions[0]?.sent.at(-1)).toBe("straight");
        h.timers.advance(100_000);
        await settle();
        expect(h.calls).toHaveLength(3);
    });

    it("skips when the latest exchange alone fills the tail, until another", async () => {
        const h = harness();
        const session = h.open([]);
        session.send("x".repeat(40));
        h.sessions[0]?.reply(150, "x".repeat(40));
        h.timers.advance(1000);
        await settle();
        expect(h.calls).toHaveLength(0);
        expect(warnings(h.events)).toEqual([
            "compaction: nothing to compact; the latest exchange alone fills the tail",
        ]);
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
    });

    it("writes nothing when closed while Dorothy is asked", async () => {
        const h = harness();
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        await session.close();
        await h.compaction.stop();
        expect(h.saved).toEqual([]);
        expect(h.recorded).toEqual([]);
        expect(h.sessions[0]?.closed).toBe(true);
        expect(h.sessions).toHaveLength(1);
    });

    it("leaves an idle compaction to whoever holds the claim", async () => {
        const taken: boolean[] = [];
        const claim: Claim = {
            take: async () => {
                taken.push(false);
                return false;
            },
            release: async () => {},
        };
        const h = harness({ claim });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => taken.length === 1);
        await settle();
        expect(h.calls).toHaveLength(0);
        expect(h.timers.pending.size).toBe(0);
    });

    it("asks again for the claim while holding a message", async () => {
        const answers = [false, true];
        let released = 0;
        const claim: Claim = {
            take: async () => answers.shift() ?? true,
            release: async () => {
                released++;
            },
        };
        const h = harness({ claim });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("next");
        await until(() => h.timers.pending.size === 1);
        expect(h.calls).toHaveLength(0);
        h.timers.advance(CLAIM_RETRY_MS);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions.length === 2);
        await until(() => released === 1);
    });

    it("counts a failed save as a failure, and hands over nothing", async () => {
        const h = harness({ save: { ok: false, reason: "disk full" } });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => warnings(h.events).length === 1);
        expect(warnings(h.events)).toEqual(["compaction failed: disk full"]);
        expect(h.sessions).toHaveLength(1);
        expect(h.recorded).toEqual([]);
        expect(h.compaction.clusters()).toEqual([]);
    });

    it("passes the inner session's events through, and its interrupts", async () => {
        const h = harness();
        const session = h.open();
        h.sessions[0]?.emit({ type: "delta", text: "Hi" });
        expect(h.events).toEqual([{ type: "delta", text: "Hi" }]);
        await session.interrupt();
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/compaction/session.test.ts`
Expected: FAIL: `./session.js` does not exist.

- [ ] **Step 3: Implement**

Create `src/compaction/session.ts` with the repository header and:

```ts
import type { CompactionConfig } from "../config.js";
import type { ChatSession, ConversationEvent } from "../conversation.js";
import { REAL_TIMERS, type Timers } from "../memory/scheduler.js";
import type { Cluster } from "../memory/sidecar.js";
import type { Turn } from "../persona.js";
import { type CompactOutcome, compact } from "./compact.js";
import { pressure, seedTurns } from "./plan.js";
import type { StructuredCall } from "./types.js";

// How often a compaction holding a message asks again for a claim that
// another call holds.
export const CLAIM_RETRY_MS = 2000;
// Failures in a run after which compaction stops until the next launch.
export const MAX_FAILURES = 3;

// What a session starts with: the clusters, and the turns after them.
export type Seed = { turns: Turn[]; clusters: readonly Cluster[] };
// The conversation's claim in the recall index, which reviews take too.
export type Claim = { take(): Promise<boolean>; release(): Promise<void> };
export type SaveResult = { ok: true } | { ok: false; reason: string };

export type CompactionOptions = {
    config: Pick<CompactionConfig, "soft" | "hard" | "tail">;
    // The idle time before compacting, as reviews wait.
    idleMs: number;
    // The clusters the conversation already has.
    clusters: readonly Cluster[];
    // Dorothy's persona, for her call.
    persona: string;
    call: StructuredCall;
    // Appends new clusters to the sidecar.
    save(clusters: readonly Cluster[]): Promise<SaveResult>;
    // Writes the transcript's compaction event.
    record(entry: { through: number; clusters: number }): Promise<void>;
    // Estimated tokens of the prompt a session with this seed starts with.
    estimate(seed: Seed): number;
    claim?: Claim | null;
    timers?: Timers;
    now?: () => Date;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// A wait that ends early, and quietly, when the signal aborts.
function sleep(timers: Timers, ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve();
            return;
        }
        const timer = timers.set(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            timers.clear(timer);
            resolve();
        };
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

// One run's compaction: the clusters so far, the failures, and the
// sessions it wraps. It outlives each session, so that reconnecting starts
// from the clusters too.
export class Compaction {
    readonly options: CompactionOptions;
    readonly timers: Timers;
    readonly now: () => Date;
    #clusters: Cluster[];
    #failures = 0;
    readonly #runs = new Map<AbortController, Promise<void>>();

    constructor(options: CompactionOptions) {
        this.options = options;
        this.timers = options.timers ?? REAL_TIMERS;
        this.now = options.now ?? (() => new Date());
        this.#clusters = [...options.clusters];
    }

    clusters(): readonly Cluster[] {
        return this.#clusters;
    }

    seed(turns: readonly Turn[]): Seed {
        return {
            turns: seedTurns(turns, this.#clusters),
            clusters: [...this.#clusters],
        };
    }

    // A session over every turn so far; App passes them all, and the
    // clusters decide which reach the seed.
    session(
        turns: readonly Turn[],
        connect: (seed: Seed) => ChatSession,
    ): ChatSession {
        return new CompactingSession(this, turns, connect);
    }

    // Quitting: every call is cancelled, and the promise settles once each
    // has let go of its claim.
    async stop(): Promise<void> {
        for (const controller of this.#runs.keys()) {
            controller.abort();
        }
        await Promise.all(this.#runs.values());
    }

    // For CompactingSession.
    get exhausted(): boolean {
        return this.#failures >= MAX_FAILURES;
    }

    idleDelay(): number {
        return this.options.idleMs * 2 ** this.#failures;
    }

    failed(): void {
        this.#failures++;
    }

    added(clusters: readonly Cluster[]): void {
        this.#clusters = [...this.#clusters, ...clusters];
    }

    track(controller: AbortController, done: Promise<void>): void {
        this.#runs.set(controller, done);
        void done.finally(() => this.#runs.delete(controller));
    }
}

// Passes one inner session through, and between turns replaces it with a
// new one seeded with the clusters a compaction just made.
class CompactingSession implements ChatSession {
    readonly #compaction: Compaction;
    readonly #connect: (seed: Seed) => ChatSession;
    readonly #listeners = new Set<(event: ConversationEvent) => void>();
    // Every turn sent on so far, as App and the transcript count them; a
    // held message joins them when it is sent.
    readonly #turns: Turn[];
    #inner: ChatSession | null = null;
    #held: string[] = [];
    #announced = false;
    #streaming = false;
    #settled: (() => void)[] = [];
    // Past hard: the next message waits for compaction.
    #urgent = false;
    #idle: unknown = null;
    #run: AbortController | null = null;
    #closed = false;
    // How many turns there were when compaction last found nothing to do.
    #nothingAt = -1;

    constructor(
        compaction: Compaction,
        turns: readonly Turn[],
        connect: (seed: Seed) => ChatSession,
    ) {
        this.#compaction = compaction;
        this.#connect = connect;
        this.#turns = [...turns];
        const seed = compaction.seed(this.#turns);
        if (
            !compaction.exhausted &&
            compaction.options.estimate(seed) > compaction.options.config.hard
        ) {
            this.#urgent = true;
            // After the caller has subscribed.
            queueMicrotask(() => {
                this.#announce();
                this.#start();
            });
        } else {
            this.#attach(connect(seed));
        }
    }

    subscribe(listener: (event: ConversationEvent) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    send(text: string): void {
        this.#cancelIdle();
        if (this.#closed) {
            return;
        }
        if (
            this.#inner === null ||
            (this.#urgent && !this.#compaction.exhausted)
        ) {
            this.#announce();
            this.#held.push(text);
            this.#start();
            return;
        }
        this.#forward(text);
    }

    interrupt(): Promise<void> {
        return this.#inner?.interrupt() ?? Promise.resolve();
    }

    async close(): Promise<void> {
        this.#closed = true;
        this.#cancelIdle();
        this.#run?.abort();
        await this.#inner?.close();
    }

    #emit(event: ConversationEvent): void {
        for (const listener of this.#listeners) {
            listener(event);
        }
    }

    #warn(message: string): void {
        this.#emit({ type: "warning", message });
    }

    #announce(): void {
        if (!this.#announced) {
            this.#announced = true;
            this.#emit({ type: "compacting" });
        }
    }

    #forward(text: string): void {
        this.#turns.push({ role: "user", text });
        this.#streaming = true;
        this.#inner?.send(text);
    }

    #attach(inner: ChatSession): void {
        this.#inner = inner;
        inner.subscribe((event) => {
            if (inner !== this.#inner) {
                return;
            }
            if (event.type === "turn-end") {
                this.#turns.push({ role: "assistant", text: event.reply });
                this.#settle();
                this.#emit(event);
                this.#measure(event.contextTokens ?? 0);
                return;
            }
            if (event.type === "error") {
                if (event.partial) {
                    this.#turns.push({ role: "assistant", text: event.partial });
                }
                this.#settle();
            }
            this.#emit(event);
        });
    }

    #settle(): void {
        this.#streaming = false;
        for (const wake of this.#settled.splice(0)) {
            wake();
        }
    }

    // Resolves once no reply is streaming, or the signal aborts.
    #whenSettled(signal: AbortSignal): Promise<void> {
        return new Promise((resolve) => {
            if (!this.#streaming || signal.aborted) {
                resolve();
                return;
            }
            this.#settled.push(resolve);
            signal.addEventListener("abort", () => resolve(), { once: true });
        });
    }

    #measure(context: number): void {
        const level = pressure(context, this.#compaction.options.config);
        if (
            level === "none" ||
            this.#compaction.exhausted ||
            this.#turns.length === this.#nothingAt
        ) {
            return;
        }
        if (level === "hard") {
            this.#urgent = true;
        }
        this.#cancelIdle();
        this.#idle = this.#compaction.timers.set(() => {
            this.#idle = null;
            this.#start();
        }, this.#compaction.idleDelay());
    }

    #cancelIdle(): void {
        if (this.#idle !== null) {
            this.#compaction.timers.clear(this.#idle);
            this.#idle = null;
        }
    }

    #start(): void {
        if (this.#run !== null || this.#closed) {
            return;
        }
        const controller = new AbortController();
        this.#run = controller;
        const done = this.#compactOnce(controller.signal)
            .catch((error: unknown) => {
                this.#warn(`compaction failed: ${describeError(error)}`);
            })
            .finally(() => {
                this.#run = null;
                this.#afterRun();
            });
        this.#compaction.track(controller, done);
    }

    async #compactOnce(signal: AbortSignal): Promise<void> {
        const compaction = this.#compaction;
        const { claim = null } = compaction.options;
        const holding = this.#urgent || this.#inner === null;
        if (claim !== null) {
            while (!(await claim.take())) {
                if (!holding || signal.aborted) {
                    return;
                }
                await sleep(compaction.timers, CLAIM_RETRY_MS, signal);
                if (signal.aborted) {
                    return;
                }
            }
        }
        try {
            const outcome = await compact({
                turns: [...this.#turns],
                clusters: compaction.clusters(),
                tail: compaction.options.config.tail,
                persona: compaction.options.persona,
                call: compaction.options.call,
                now: compaction.now,
                signal,
            });
            if (signal.aborted) {
                return;
            }
            await this.#land(outcome, signal);
        } finally {
            await claim?.release();
        }
    }

    async #land(outcome: CompactOutcome, signal: AbortSignal): Promise<void> {
        const compaction = this.#compaction;
        if (outcome.kind === "nothing") {
            this.#nothingAt = this.#turns.length;
            this.#warn(
                "compaction: nothing to compact; the latest exchange alone fills the tail",
            );
            return;
        }
        if (outcome.costUsd > 0) {
            this.#emit({ type: "memory-cost", usd: outcome.costUsd });
        }
        if (outcome.kind === "failed") {
            this.#fail(outcome.reason);
            return;
        }
        await this.#whenSettled(signal);
        if (signal.aborted) {
            return;
        }
        const saved = await compaction.options.save(outcome.clusters);
        if (!saved.ok) {
            this.#fail(saved.reason);
            return;
        }
        compaction.added(outcome.clusters);
        await compaction.options.record({
            through: outcome.range.through,
            clusters: outcome.clusters.length,
        });
        const old = this.#inner;
        this.#urgent = false;
        this.#attach(this.#connect(compaction.seed(this.#turns)));
        void old?.close();
        this.#emit({
            type: "compacted",
            from: outcome.range.from,
            through: outcome.range.through,
            clusters: outcome.clusters.length,
        });
    }

    #fail(reason: string): void {
        this.#compaction.failed();
        this.#warn(
            this.#compaction.exhausted
                ? `compaction failed: ${reason}; no more tries until the next launch`
                : `compaction failed: ${reason}`,
        );
    }

    // Whatever happened, a session exists afterwards and held messages go
    // to it: after a failure, to the session that is nearly full.
    #afterRun(): void {
        if (this.#closed) {
            return;
        }
        if (this.#inner === null) {
            this.#attach(this.#connect(this.#compaction.seed(this.#turns)));
        }
        const held = this.#held.splice(0);
        if (held.length > 0 && this.#urgent) {
            this.#warn("compaction: the context is nearly full; sending anyway");
        }
        this.#urgent = false;
        this.#announced = false;
        for (const text of held) {
            this.#forward(text);
        }
    }
}
```

Two behaviours the tests pin and the code above must keep:

- A claim refused to an idle compaction ends the run with no call and no
  retry timer; the next idle (after another turn) tries again.
- `#afterRun` connects even when compaction failed before connecting, so a
  seed past `hard` that cannot be compacted still gets a session, the whole
  seed, and the user's message.

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test src/compaction/`
Expected: PASS. If the test "waits twice as long after a failure" fails on
the first iteration's timing, check that `#measure` uses
`idleDelay()`, which reads the failure count at the time of the turn.

- [ ] **Step 5: Check and commit**

```bash
bunx biome check --write src/compaction/session.ts src/compaction/session.test.ts
bun run check
git add src/compaction/session.ts src/compaction/session.test.ts
git commit -m "feat: Hand a compacted chat to a new session"
git log --oneline -1 && git status --short
```

### Task 13: Compaction in the chat

**Files:**

- Modify: `src/tui/run.tsx`
- Modify: `src/tui/boundary.test.ts`

**Interfaces:**

- Consumes: `Compaction`, `Seed` (Task 12); `seedTurns`, `clusterTokens`
  (Task 10); `COMPACTION_TIMEOUT_MS` (Task 11); `structuredCall` (Task 9);
  `MemoryService.block(reserved)` (Task 8); `conversationOptions` with
  `clusters` (Task 7); `appendClusters`, `readSidecar`, `updateSidecar`
  (Task 3 and existing); `tokens` (`src/memory/rank.ts`);
  `config.compaction` (Task 2).
- Produces: every chat session seeded from the conversation's clusters; a
  `Compaction` per run when `[compaction] enabled`.

- [ ] **Step 1: Write the failing boundary test**

In `src/tui/boundary.test.ts`, add inside `describe("the TUI", ...)`:

```ts
    it("leaves compaction to run.tsx, which wires it in", async () => {
        const importers: string[] = [];
        for await (const path of new Glob("*.{ts,tsx}").scan(import.meta.dir)) {
            const text = await Bun.file(`${import.meta.dir}/${path}`).text();
            if (path !== import.meta.file && text.includes("../compaction/")) {
                importers.push(path);
            }
        }
        expect(importers.sort()).toEqual(["run.tsx"]);
    });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/tui/boundary.test.ts`
Expected: FAIL: no file imports `../compaction/` yet (`[]`, not
`["run.tsx"]`).

- [ ] **Step 3: Wire compaction into `run.tsx`**

Replace `src/tui/run.tsx` from the imports to the end of `runTui` with the
following (the header comment block stays):

```tsx
import { randomBytes } from "node:crypto";
import { render } from "ink";
import { COMPACTION_TIMEOUT_MS } from "../compaction/compact.js";
import { clusterTokens, seedTurns } from "../compaction/plan.js";
import { Compaction, type Seed } from "../compaction/session.js";
import { readConfig } from "../config.js";
import {
    type ChatSession,
    Conversation,
    conversationOptions,
    recallLaunch,
    type SessionSetup,
} from "../conversation.js";
import { indexCatalogue } from "../memory/catalogue.js";
import { tokens } from "../memory/rank.js";
import { MemoryService } from "../memory/service.js";
import {
    appendClusters,
    type Cluster,
    readSidecar,
    updateSidecar,
} from "../memory/sidecar.js";
import { trackMemory } from "../memory/track.js";
import { type PersonaMode, personaPrompt, promptHash } from "../persona.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { newPhrase } from "../session-id.js";
import { structuredCall } from "../structured.js";
import {
    type ResumedTurn,
    readTranscript,
    TranscriptWriter,
    transcriptDir,
    transcriptPath,
} from "../transcript.js";
import { App } from "./App.js";
import { editInEditor } from "./external-editor.js";

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// A claim outlives the longest compaction by this much, as reviews' do.
const CLAIM_MARGIN_MS = 30_000;

export async function runTui(
    resume: string | null,
    persona: PersonaMode = "chat",
): Promise<number> {
    const phrase = resume ?? newPhrase();
    const path = transcriptPath(phrase);
    const dir = transcriptDir();
    let history: ResumedTurn[] = [];
    let costUsd = 0;
    const warnings: string[] = [];
    const { config, warnings: configWarnings } = await readConfig();
    warnings.push(...configWarnings);

    // A resumed conversation starts from its clusters. Notes that cannot be
    // read are never written, so compaction stays off for this chat.
    let clusters: Cluster[] = [];
    let compactable = config.compaction.enabled;
    if (resume !== null) {
        try {
            const read = await readTranscript(path);
            history = read.turns;
            costUsd = read.costUsd;
            if (read.skipped > 0) {
                warnings.push(
                    `skipped ${read.skipped} malformed line(s) in ${path}`,
                );
            }
        } catch (error) {
            process.stderr.write(
                `dorothy: cannot resume ${resume}: ${path}: ${describeError(error)}\n`,
            );
            return 1;
        }
        const notes = await readSidecar(dir, phrase);
        if (notes.kind === "ok") {
            clusters = notes.sidecar.clusters;
        } else if (notes.kind === "unparseable" && compactable) {
            compactable = false;
            warnings.push(
                `compaction: off for this chat; its notes can't be read (${notes.reason})`,
            );
        }
    }

    let writer: TranscriptWriter | null = null;
    try {
        writer = await TranscriptWriter.open(path);
    } catch (error) {
        warnings.push(`transcript not saved: ${describeError(error)}`);
    }

    // The index is opened before the first session, whose prompt carries
    // the block; without it, the chat starts without memory or recall.
    let index: RecallIndex | null = null;
    if (config.memory.enabled || config.memory.recall) {
        try {
            index = RecallIndex.open(indexPath());
        } catch (error) {
            const lost = [
                ...(config.memory.enabled ? ["memory"] : []),
                ...(config.memory.recall ? ["recall"] : []),
            ].join(" and ");
            warnings.push(
                `memory: the index can't be opened (${describeError(error)}); starting without ${lost}`,
            );
        }
    }
    let memory: MemoryService | null = null;
    if (config.memory.enabled && index !== null) {
        const loaded = await indexCatalogue(index, dir).load();
        warnings.push(...loaded.warnings);
        const transcript = writer;
        memory = new MemoryService({
            dir,
            phrase,
            history,
            config: config.memory,
            entries: loaded.entries,
            index,
            // Without a transcript the live chat is left alone.
            flushed: transcript === null ? null : () => transcript.flushed(),
        });
        warnings.push(...memory.warnings());
    }

    const recall =
        config.memory.recall && index !== null ? recallLaunch(phrase) : null;

    // Every session, first, resumed, reconnected or compacted, starts the
    // same way: the clusters, the notes on other conversations with the
    // clusters' tokens charged first, then the turns after the clusters.
    const setup = (seed: Seed): SessionSetup => ({
        history: seed.turns,
        clusters: seed.clusters,
        memory:
            memory?.block(clusterTokens(seed.clusters, recall !== null)) ?? "",
        recall,
        persona,
    });
    const connect = (seed: Seed): ChatSession => {
        const conversation = new Conversation(setup(seed));
        conversation.start();
        return memory === null ? conversation : trackMemory(conversation, memory);
    };

    const claims = index;
    const transcript = writer;
    const owner = `${process.pid}-${randomBytes(4).toString("hex")}`;
    const compaction = compactable
        ? new Compaction({
              config: config.compaction,
              idleMs: config.memory.idleSeconds * 1000,
              clusters,
              persona: personaPrompt({ recall: false, mode: persona }),
              call: structuredCall(),
              // Without a transcript there is no conversation for notes to
              // describe; the clusters live in this run only.
              save: async (added) => {
                  if (transcript === null) {
                      return { ok: true };
                  }
                  const result = await updateSidecar(
                      dir,
                      phrase,
                      (current) => appendClusters(current, added),
                      claims?.lock,
                  );
                  return result.kind === "written"
                      ? { ok: true }
                      : result.kind === "unchanged"
                        ? {
                              ok: false,
                              reason: "the notes already cover those turns",
                          }
                        : { ok: false, reason: result.reason };
              },
              record: async (entry) => {
                  await transcript?.append({ kind: "compaction", ...entry });
              },
              estimate: (seed) =>
                  tokens(String(conversationOptions(setup(seed)).systemPrompt)),
              claim:
                  claims === null
                      ? null
                      : {
                            take: () =>
                                claims.claim(
                                    phrase,
                                    owner,
                                    Date.now(),
                                    COMPACTION_TIMEOUT_MS + CLAIM_MARGIN_MS,
                                ),
                            release: () => claims.release(phrase, owner),
                        },
          })
        : null;

    const app = render(
        <App
            phrase={phrase}
            promptHash={promptHash(
                personaPrompt({ recall: recall !== null, mode: persona }),
            )}
            history={history}
            editDraft={(text) => editInEditor(text)}
            createSession={(turns) =>
                compaction === null
                    ? connect({ turns: seedTurns(turns, clusters), clusters })
                    : compaction.session(turns, connect)
            }
            notices={memory ?? undefined}
            transcript={writer}
            initialWarnings={warnings}
            initialCostUsd={costUsd}
            config={config}
        />,
        // Kitty-protocol terminals report Shift+Enter apart from Enter.
        { exitOnCtrlC: false, kittyKeyboard: { mode: "auto" } },
    );
    try {
        await app.waitUntilExit();
    } finally {
        // Running reviews and compactions are closed unsaved, and let go
        // of their claims before the index they are held in closes.
        await compaction?.stop();
        await memory?.stop();
        index?.close();
        await writer?.close();
    }
    return 0;
}
```

- [ ] **Step 4: Run the TUI tests and the typecheck**

Run: `bun test src/tui/ && bun run typecheck`
Expected: PASS. `src/tui/run.test.ts` still exits 1 before rendering for a
missing transcript.

- [ ] **Step 5: Check and commit**

```bash
bunx biome check --write src/tui/run.tsx src/tui/boundary.test.ts
bun run check
git add src/tui/run.tsx src/tui/boundary.test.ts
git commit -m "feat(tui): Compact long chats"
git log --oneline -1 && git status --short
```

### Task 14: The compacted seed in `--dump-context`

**Files:**

- Modify: `src/dump.ts`
- Test: `src/dump.test.ts`

**Interfaces:**

- Consumes: `readSidecar` (existing); `seedTurns`, `clusterTokens`
  (Task 10); `buildMemory` with `reserved` (Task 8); `conversationOptions`
  with `clusters` (Task 7).

- [ ] **Step 1: Write the failing test**

In `src/dump.test.ts`, add to the imports
`import { mkdir, writeFile } from "node:fs/promises";` (merging with the
existing `node:fs/promises` import) and
`import { EMPTY_SIDECAR } from "./memory/sidecar.js";`, and inside
`describe("runDump", ...)` add:

```ts
    it("dumps a compacted chat as it would resume: abstracts, then the tail", async () => {
        const phrase = newPhrase();
        const transcripts = join(dir, "data", "dorothy", "transcripts");
        await mkdir(transcripts, { recursive: true });
        const line = (kind: string, text: string) =>
            JSON.stringify({
                v: 1,
                kind,
                at: "2026-10-07T08:00:00.000Z",
                text,
                ...(kind === "assistant" ? { interrupted: false } : {}),
            });
        await writeFile(
            join(transcripts, `${phrase}.jsonl`),
            `${[
                line("user", "Old question."),
                line("assistant", "Old answer."),
                line("user", "New question."),
                line("assistant", "New answer."),
            ].join("\n")}\n`,
        );
        await writeFile(
            join(transcripts, `${phrase}.meta.json`),
            JSON.stringify({
                ...EMPTY_SIDECAR,
                clusters: [
                    {
                        from: 1,
                        through: 2,
                        abstract: "The old exchange.",
                        at: "2026-10-07T08:00:00.000Z",
                        model: "claude-test",
                    },
                ],
            }),
        );
        const fake = posting();
        const code = await runDump(
            { resume: phrase, message: "hi", persona: "chat" },
            { env, queryFn: fake, write },
        );
        expect(code).toBe(0);
        const body = JSON.parse(out) as { system: string };
        expect(body.system).toContain(
            '<cluster n="1" turns="1-2">The old exchange.</cluster>',
        );
        expect(body.system).toContain("User: New question.");
        expect(body.system).not.toContain("Old question.");
        expect(
            (fake.options?.mcpServers?.memory as { args: string[] }).args,
        ).toContain("--recollect");
    });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/dump.test.ts`
Expected: FAIL: the dump seeds every turn and no clusters.

- [ ] **Step 3: Implement**

In `src/dump.ts`, import `clusterTokens` and `seedTurns` from
`./compaction/plan.js` and `{ type Cluster, readSidecar }` from
`./memory/sidecar.js`. After the history is read and the config loaded,
read the clusters, and seed as a chat would:

```ts
    let clusters: Cluster[] = [];
    if (request.resume !== null) {
        const notes = await readSidecar(transcriptDir(env), phrase);
        if (notes.kind === "ok") {
            clusters = notes.sidecar.clusters;
        }
    }
```

(place it right after the `readConfig` line). Compute `recall` before the
memory block, so the block can charge the abstracts first: move

```ts
        const recall =
            config.memory.recall && index !== null
                ? recallLaunch(phrase)
                : null;
```

to the top of the `try` block, and pass `reserved` to `buildMemory`:

```ts
            const built = buildMemory(loaded.entries, {
                now: Date.now(),
                config: config.memory,
                exclude: phrase,
                reserved: clusterTokens(clusters, recall !== null),
            });
```

and the seed to `conversationOptions`:

```ts
            options: conversationOptions({
                history: seedTurns(history, clusters),
                clusters,
                memory,
                recall,
                persona: request.persona,
            }),
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test src/dump.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
bunx biome check --write src/dump.ts src/dump.test.ts
bun run check
git add src/dump.ts src/dump.test.ts
git commit -m "feat(sdk): Dump the compacted seed"
git log --oneline -1 && git status --short
```

### Task 15: Documentation and live probes

**Files:**

- Modify: `README.md`
- Modify: `.claude/CLAUDE.md`
- Create: `docs/reports/2026-10-07-compaction.md`

**Interfaces:**

- Consumes: everything above.

- [ ] **Step 1: Probe the CLI's switch**

With temporary XDG directories and the real credentials (the entry guard
loads them), compare the CLI with and without `DISABLE_COMPACT`. Write the
probe to `.superpowers/probes/probe-compact.ts`, inside the repository's
gitignored `.superpowers/`, so that its imports resolve against the
repository's `node_modules`; never commit it:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { config } from "@dotenvx/dotenvx";
import { baseOptions, cliOptions, prepareCliHome } from "../../src/persona.ts";

config({ quiet: true });
const home = mkdtempSync(join(tmpdir(), "dorothy-probe-"));
const env = { ...process.env, XDG_CACHE_HOME: join(home, "cache") };
prepareCliHome(env);

async function run(disabled: boolean): Promise<string[]> {
    const options = cliOptions(env);
    const probeEnv: Record<string, string | undefined> = {
        ...options.env,
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: "2000",
        CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "1",
    };
    if (!disabled) {
        delete probeEnv.DISABLE_COMPACT;
    }
    const seen: string[] = [];
    async function* prompts() {
        for (const text of ["Say hello in ten words.", "And again.", "Once more."]) {
            yield { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null } as const;
        }
    }
    for await (const message of query({
        prompt: prompts(),
        options: { ...baseOptions, ...options, env: probeEnv, systemPrompt: "x ".repeat(3000) },
    }) as AsyncIterable<SDKMessage>) {
        if (message.type === "system") {
            seen.push(message.subtype);
        }
        if (message.type === "result" && seen.filter((s) => s === "init").length >= 3) {
            break;
        }
    }
    return seen;
}

console.log("without DISABLE_COMPACT:", await run(false));
console.log("with DISABLE_COMPACT:", await run(true));
```

Run it from the repository root with
`bun .superpowers/probes/probe-compact.ts`.

Expected: without the switch, `compact_boundary` appears among the system
subtypes; with it, it does not. If neither run compacts, the CLI clamps the
window: raise the prompt's size (`"x ".repeat(...)`) until the run without
the switch compacts, then compare. Record the CLI version
(`node_modules/@anthropic-ai/claude-agent-sdk/package.json`), the exact
variables, and both outcomes for the report. If the switched run still
compacts, stop and report: the design depends on it.

- [ ] **Step 2: Probe a compacting chat live**

In tmux, with every XDG directory temporary and a hand-written
`config.toml` with tiny thresholds:

```bash
probe=$(mktemp -d)
mkdir -p "$probe/config/dorothy"
cat > "$probe/config/dorothy/config.toml" <<'EOF'
[memory]
idle-seconds = 10

[compaction]
soft = 2000
hard = 4000
tail = 500
EOF
tmux new-session -d -s probe -x 120 -y 40 \
  "XDG_CONFIG_HOME=$probe/config XDG_DATA_HOME=$probe/data XDG_CACHE_HOME=$probe/cache bun run dev"
```

Send four or five messages that each ask for a long answer on different
topics (`tmux send-keys -t probe '...' Enter`), waiting for each reply.
Check, with `tmux capture-pane -p -t probe`:

- a dim `compacted turns 1-N into K clusters` line appears after an idle;
- asking "what did we say about <the first topic>, word for word?" makes
  Dorothy call `recollect`, shown as `⌕ recollected cluster 1, turns a-b`;
- the sidecar under `$probe/data/dorothy/transcripts/` holds `clusters`, and
  the transcript a `compaction` event before the next `session` event.

Then quit, and check the resumed seed without spending tokens:

```bash
XDG_CONFIG_HOME=$probe/config XDG_DATA_HOME=$probe/data XDG_CACHE_HOME=$probe/cache \
  bun run dev -- --dump-context --resume <phrase> | head -c 4000
```

Expected: the system prompt holds the `<earlier>` abstracts and only the
turns after the last cluster, and the request offers
`mcp__memory__recollect`.

Remove `$probe` afterwards.

- [ ] **Step 3: Write the report**

Create `docs/reports/2026-10-07-compaction.md` with the repository's
Markdown header (copy `docs/reports/2026-10-07-context-leak.md`'s front
matter and comment block, with this file's path, title "Compaction probes"
and a one-line description), recording: the CLI version; the switch probe's
variables and outcomes; the live probe's thresholds, what appeared, and the
dump's shape; anything that surprised.

- [ ] **Step 4: Document the feature**

In `README.md`, under `### Memory`, after the recall paragraph and its
`--recall-server` block, add:

````markdown
A long chat does not outgrow Dorothy's context. Once it passes a threshold,
she compacts it while you are idle: the oldest turns leave her context in
clusters, split where the topic changes, each summarised by her in an
abstract that stays with her for the rest of the chat. The newest turns stay
word for word. She can open any cluster to read it exactly again, shown as a
dim `⌕ recollected` line, and her notes on other chats shrink to make room
as the chat grows. The abstracts sit in the chat's notes; `--resume` starts
from them.

```toml
[compaction]
enabled = true  # false: no compaction at all
soft = 64000    # context tokens before compacting at idle
hard = 128000   # context tokens before the next message waits for it
tail = 16000    # newest turns kept word for word, in tokens
```
````

and change the `budget` line of the `[memory]` example to
`budget = 4000        # estimated tokens of notes per chat, 200 to 20000`.

In `.claude/CLAUDE.md`, after the Recall paragraph, add:

```markdown
Compaction (`src/compaction/`) keeps a long chat within Dorothy's context.
Past `[compaction] soft` tokens, at the next idle (past `hard`, before the
next message), `compact()` asks her through an injected `StructuredCall`
to split the turns leaving the verbatim tail into topical clusters with an
abstract each (`clusters.ts`, `plan.ts`). `Compaction` (`session.ts`)
wraps the `ChatSession`, appends the clusters to the sidecar, writes a
`compaction` transcript event, and swaps in a new `Conversation` seeded by
`withClusters` with the abstracts and the turns after them; every session
in `run.tsx` is seeded that way, and the memory block charges the abstracts
to its budget first. `recollect` on the recall server opens a cluster word
for word; the server registers it only with `--recollect`, which
`conversationOptions` adds when there are clusters. Nothing in
`src/compaction/` imports the Agent SDK (`boundary.test.ts`);
`src/structured.ts` is the SDK side, and reviews use it too. The CLI's own
compaction is off: `cliOptions()` sets `DISABLE_COMPACT=1`, and a
`compact_boundary` message is reported as an error. Probes:
`docs/reports/2026-10-07-compaction.md`.
```

and bump its front matter `mtime` to `2026-10-07`.

- [ ] **Step 5: Check and commit**

```bash
bun run check
git add README.md docs/reports/2026-10-07-compaction.md
git commit -m "docs: Describe compaction, report its probes"
git add .claude/CLAUDE.md
git commit -m "docs(claude): Describe compaction"
git log --oneline -2 && git status --short
```
