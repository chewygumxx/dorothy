---
ctime: 2026-10-09
mtime: 2026-10-09
spdx: GPL-3.0-only
title: Workspace modularity plan
description: >-
  Implementation plan for splitting src/ into the five @dorothy workspace
  packages: contracts, seams, facades, the moves, and their checks.
tags:
  - dorothy
  - workspace
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-09-workspace-modularity.md
   -
   -->

# Workspace Modularity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `src/` into the Bun workspace packages `@dorothy/core`,
`memory`, `agent`, `tui` and `cli`, each declaring its dependencies and
offering only named entry points, with no change in behaviour.

**Architecture:** Untangle first, under `src/`: gather the shared types
into `src/contracts/`, cut the four seams (model calls, the editor,
session start, transcript writing), and build the facades (`openMemory`,
`previewStart`, `runApp`, `runOneShot`). Then move one package at a time
into `packages/`, under Bun's isolated linker, so that an undeclared or
internal import fails to resolve. A root test pins the graph.

**Tech Stack:** Bun 1.4 (workspaces, isolated linker, `bun test`),
TypeScript 7 (`tsc`, check only), Ink and React, the Claude Agent SDK.

**Spec:** `docs/specs/2026-10-09-workspace-modularity-design.md`, with
its diagram `docs/specs/2026-10-09-workspace-modularity-packages.html`.

## Global Constraints

- No behaviour changes: prompts, transcripts, sidecars, `tags.json`, the
  recall index and history stay byte for byte as they are.
  `persona.test.ts` pins the chat prompt and must pass unchanged.
- Packages: `@dorothy/core`, `@dorothy/memory`, `@dorothy/agent`,
  `@dorothy/tui`, `@dorothy/cli`, under `packages/<name>/`, each
  `private`, `"type": "module"`.
- The graph, exactly: `core` depends on no package; `memory`, `agent` and
  `tui` on `core` alone; `cli` on all four.
- Entry points, exactly: `core` `"."`; `memory` `"."`,
  `"./recall-server"`, `"./commands"`; `agent` `"."`; `tui` `"."`; `cli`
  none. Each points at a `.ts` source file. No wildcards.
- `@anthropic-ai/claude-agent-sdk` is declared by `agent` alone.
- `bunfig.toml` keeps `[env] file = false` and the test preload, and gains
  `[install] linker = "isolated"`.
- Every commit passes `bun run check`. Commits are Conventional, one line,
  header at most 50 characters. Until Task 9 adds them, scopes are `sdk`
  (under `src/` outside `src/tui/`), `tui` (`src/tui/`), `config` and
  `claude`; from Task 9, the package scopes `core`, `memory`, `agent`,
  `tui` and `cli`. Documentation commits take no scope.
- A commit that moves files changes nothing in them but import
  specifiers. Rewiring happens in commits of its own.
- After moving files, run `bunx sync-header-metadata --update` so each
  file's header names its new path (CI's `header-sync` checks it).
- Imports from one module are one declaration, with inline `type`
  modifiers: `import { type Env, readConfig } from "@dorothy/core";`.
  Biome neither merges nor flags duplicates, so merge them by hand.
- Comments follow the codebase: full sentences on why, British spelling.
- No em dashes anywhere (`bun run lint:emdash`). Markdown lines at most 80
  characters. Never edit `dist/` while it exists.
- Tests and probes never touch the user's data: every XDG directory is a
  temporary one, and nothing calls the real `dotenvx set`.
- Plain branch `feat/workspace-modularity`; no worktrees.

## Review Focus

1. A chat that reconnects or resumes keeps writing the same transcript
   entries in the same order, a closed session's late events recorded by
   no one. Pinned by Task 5's scripted transcript test.
2. A compacted session starts with exactly the system prompt it did:
   memory block, then the earlier section, then the turns. Pinned by
   Task 3's literal tests of `earlierSection` and `withSection`.
3. The recall server still starts from a moved entry script, since its
   launch command is `process.argv[1]`. Checked by Task 17's launch probe.
4. The data repository's pre-commit hook names the old entry path and is
   rewritten at the first launch. Checked by Task 17's launch probe.
5. A dependency that walks up `node_modules` for a peer (the Agent SDK's
   `zod`) fails under the isolated linker. Checked by Task 11's install
   check and Task 17's `--dump-context` probe.

---

## File Structure

During Tasks 1 to 8, under `src/`:

- `src/contracts/session.ts`: `Turn`, `TurnStats`, `RawMessage`, the
  session's events, `ChatSession`, `CLOSE_GRACE_MS`, `ResumedTurn`.
- `src/contracts/recall.ts`: the moved `recall/types.ts`, plus
  `RecallEvent`.
- `src/contracts/structured.ts`: the moved `compaction/types.ts`.
- `src/contracts/start.ts`: `RecallLaunch`, `SessionStart`,
  `withSection`.
- `src/contracts/notices.ts`: `Notice`, `NoticeSource`.
- `src/contracts/editor.ts`: `EditResult`, `Editor`.
- `src/memory/record.ts`: `sessionRecorder`, `noticeChannel`.
- `src/memory/record.fixture.ts`: the scripted chat and its entries.
- `src/memory/fake-session.ts`: the `FakeSession` memory's tests share.
- `src/memory/open.ts`: the moved `tui/run.tsx`, becoming `openMemory`.
- `src/memory/preview.ts`: `previewStart`, memory's half of `dump.ts`.
- `src/tui/run-app.tsx`: `runApp`.
- `src/one-shot.ts`: `runOneShot`, from `index.ts`.
- `src/capture.ts`: `captureServer` and `dumpRequest`, from `dump.ts`.
- `src/run-tui.ts`: `runTui`, wiring memory, the agent and the screen.
- `src/recall-launch.ts`: `recallLaunch`, from `conversation.ts`.

From Task 9, `packages/<name>/src/` holds the same files with their
relative layout kept, plus each package's entry modules.

---

### Task 1: Gather the contracts

**Files:**

- Move: `src/recall/types.ts` to `src/contracts/recall.ts`
- Move: `src/compaction/types.ts` to `src/contracts/structured.ts`
- Create: `src/contracts/session.ts`, `src/contracts/notices.ts`,
  `src/contracts/editor.ts`
- Modify: `src/conversation.ts`, `src/persona.ts`, `src/transcript.ts`,
  `src/tui/App.tsx`, `src/tui/external-editor.ts`,
  `src/memory/service.ts`, `src/compaction/shared.ts`,
  `src/conversation.test.ts`, and every importer of the moved names

**Interfaces:**

- Produces: `src/contracts/session.ts` exporting `Turn`, `TurnStats`,
  `RawMessage`, `ConversationEvent`, `ChatSession`, `CLOSE_GRACE_MS`,
  `ResumedTurn`; `src/contracts/recall.ts` exporting everything
  `recall/types.ts` did plus `RecallEvent`; `src/contracts/structured.ts`
  exporting `StructuredRequest`, `StructuredOutcome`, `StructuredCall`;
  `src/contracts/notices.ts` exporting `Notice`, `NoticeSource`;
  `src/contracts/editor.ts` exporting `EditResult`, `Editor`.

- [ ] **Step 1: Move the two type modules**

```bash
mkdir -p src/contracts
git mv src/recall/types.ts src/contracts/recall.ts
git mv src/compaction/types.ts src/contracts/structured.ts
```

Repoint their importers, changing specifiers only:

```bash
grep -rl --include='*.ts' --include='*.tsx' \
    -e 'recall/types\.js' -e '\./types\.js' src | sort
```

In each file listed, replace the specifier: from `src/recall/*` and
`src/compaction/*`, `./types.js` becomes `../contracts/recall.js` or
`../contracts/structured.js` by directory; from `src/` itself,
`./recall/types.js` becomes `./contracts/recall.js`; from `src/tui/`,
`../recall/types.js` becomes `../contracts/recall.js`. Check no other
`./types.js` (such as `src/memory/`'s, if any) is touched by mistake:
`git diff --stat` should list only specifier changes.

- [ ] **Step 2: Check and commit the move**

Run: `bunx sync-header-metadata --update && bun run check`
Expected: PASS, 1106 tests.

```bash
git add -A src
git commit -m "refactor(sdk): Move the shared types to contracts"
```

- [ ] **Step 3: Create `src/contracts/session.ts`**

Cut these declarations, verbatim with their comments, from their files
and paste them here, in this order: `Turn` from `src/persona.ts`;
`TurnStats`, `RawMessage`, `ConversationEvent`, `ChatSession` and
`CLOSE_GRACE_MS` (with its comment) from `src/conversation.ts`;
`ResumedTurn` from `src/transcript.ts`. Then move `RecallBase` and
`RecallEvent` from `src/transcript.ts` to the end of
`src/contracts/recall.ts`, exporting `RecallEvent` as before. The file
opens:

```ts
// What the packages meet on: a chat session as the screen, memory and
// the model side each see it. Nothing here runs a model.

import type { Lookup, RecallEvent } from "./recall.js";
```

Fix `CLOSE_GRACE_MS`'s comment, which names `compaction`'s
`QUIT_GRACE_MS` and `conversation.test.ts`, to read: "How long a closed
session waits for its subprocess to exit on its own before terminating
it. Compaction waits as long for the saves under way when quitting."

- [ ] **Step 4: Create the notices and editor contracts**

`src/contracts/notices.ts`, from `Notice` and `NoticeSource` in
`src/tui/App.tsx`, verbatim:

```ts
// What memory and history tell the chat. The shapes are reducer actions,
// so a notice is dispatched as it comes.
export type Notice =
    | { type: "warning"; message: string }
    | { type: "memory-cost"; usd: number };
export type NoticeSource = {
    subscribe(listener: (notice: Notice) => void): () => void;
};
```

`src/memory/service.ts` declares its own identical `Notice` (line 63):
delete it and import `Notice` from `../contracts/notices.js`, re-exporting
nothing.

`src/contracts/editor.ts`, with `EditResult` cut from
`src/tui/external-editor.ts`:

```ts
// What editing text in $EDITOR comes back with.
export type EditResult =
    | { ok: true; text: string }
    | { ok: false; message: string };

// Edits text in the user's editor; the screen supplies the real one.
export type Editor = (text: string) => Promise<EditResult>;
```

- [ ] **Step 5: Make compaction's grace the session's**

In `src/compaction/shared.ts`, replace `export const QUIT_GRACE_MS =
2000;` with:

```ts
export const QUIT_GRACE_MS = CLOSE_GRACE_MS;
```

importing `CLOSE_GRACE_MS` from `../contracts/session.js`, and reword its
comment to say it is the session's grace by definition. In
`src/conversation.test.ts`, delete the test asserting
`expect(QUIT_GRACE_MS).toBe(CLOSE_GRACE_MS)` (around line 502) and the
`QUIT_GRACE_MS` import: it now holds by construction.

- [ ] **Step 6: Repoint every importer**

```bash
NAMES='Turn|TurnStats|RawMessage|ConversationEvent|ChatSession'
NAMES="$NAMES|ResumedTurn|RecallEvent|Notice|NoticeSource|EditResult"
grep -rlnE --include='*.ts' --include='*.tsx' \
    "type ($NAMES)\b|CLOSE_GRACE_MS" src | sort
```

In each, import the moved names from `contracts/` instead. Where a module
re-exported nothing but used the name, the old import line simply
changes path. Leave no re-export behind in the old modules.

- [ ] **Step 7: Check and commit**

Run: `bunx sync-header-metadata --update && bun run check`
Expected: PASS, 1105 tests (the grace test is gone).

```bash
git add -A src
git commit -m "refactor(sdk): Gather the session contracts"
```

---

### Task 2: Reviews take a StructuredCall

Memory's reviews call the Agent SDK's `query()` through `structuredCall`
and read the persona from `persona.ts`. After this task they take a
`StructuredCall` and the persona's text, as compaction already does.

**Files:**

- Create: `src/contracts/start.ts` (only `withSection` for now)
- Modify: `src/memory/review.ts`, `src/memory/service.ts`,
  `src/memory/review.test.ts`, `src/memory/service.test.ts`,
  `src/tui/run.tsx`

**Interfaces:**

- Consumes: `StructuredCall`, `StructuredOutcome` from
  `src/contracts/structured.ts`.
- Produces: `withSection(prompt: string, section: string): string` in
  `src/contracts/start.ts`; `MemoryServiceOptions` with `call:
  StructuredCall` and `persona: string` in place of `queryFn?`;
  `runReview({ call, systemPrompt, prompt, signal?, timeoutMs?, schema?,
  readIds?, tagging? })`.

- [ ] **Step 1: Write `withSection` and its test**

`src/contracts/start.ts`:

```ts
// A system prompt with a section after it, a blank line between; an
// empty section leaves the prompt as it is. The memory block and the
// earlier turns' abstracts are both added this way.
export function withSection(prompt: string, section: string): string {
    return section === "" ? prompt : `${prompt}\n\n${section}`;
}
```

`src/contracts/start.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { withSection } from "./start.js";

describe("withSection", () => {
    it("adds a section after a blank line", () => {
        expect(withSection("You are Dorothy.", "<memory/>")).toBe(
            "You are Dorothy.\n\n<memory/>",
        );
    });

    it("leaves the prompt alone for an empty section", () => {
        expect(withSection("You are Dorothy.", "")).toBe("You are Dorothy.");
    });
});
```

Run: `bun test src/contracts/start.test.ts`
Expected: PASS.

- [ ] **Step 2: Turn the service tests' fake into a StructuredCall**

In `src/memory/service.test.ts`, replace `reviews()` with a fake call
that keeps the calls in the shape the assertions read, and answers as
`structuredCall` would:

```ts
// Answers each review in turn: notes, an error, "timeout" (fails as a
// call that timed out does) or "hang" (answers only once cancelled).
// Calls are kept in the shape the SDK was given, so assertions read the
// system prompt and schema where they did.
function reviews(...answers: (object | Error | "hang" | "timeout")[]) {
    const calls: {
        prompt: string;
        options: {
            systemPrompt: string;
            outputFormat: {
                type: "json_schema";
                schema: Record<string, unknown>;
            };
        };
    }[] = [];
    let closed = 0;
    const fn: StructuredCall = async ({ system, prompt, schema, signal }) => {
        calls.push({
            prompt,
            options: {
                systemPrompt: system,
                outputFormat: { type: "json_schema", schema },
            },
        });
        const answer = answers.shift() ?? new Error("no more answers");
        if (answer === "hang") {
            await new Promise<void>((resolve) => {
                if (signal?.aborted) {
                    resolve();
                    return;
                }
                signal?.addEventListener("abort", () => resolve(), {
                    once: true,
                });
            });
            closed++;
            return { ok: false, reason: "cancelled", costUsd: 0 };
        }
        if (answer === "timeout") {
            return { ok: false, reason: "timed out after 120s", costUsd: 0 };
        }
        if (answer instanceof Error) {
            return { ok: false, reason: answer.message, costUsd: 0 };
        }
        return {
            ok: true,
            output: answer,
            model: "claude-test",
            costUsd: 0.25,
        };
    };
    return { fn, calls, closed: () => closed };
}
```

Then, in the same file:

- `setup()` takes `Partial<MemoryServiceOptions> & { call: StructuredCall
  }` and passes `persona: PERSONA`, with `const PERSONA = "You are
  Dorothy, under test.";` near the top.
- Every `queryFn: x.fn` becomes `call: x.fn`.
- `expect(system.startsWith(systemPrompt))` becomes
  `expect(system.startsWith(PERSONA))`; drop the `systemPrompt` import
  from `../persona.js`.
- "counts a timeout, not a review cancelled by quitting": the first
  service is set up with `reviews("timeout")`, and the `settle()` and
  `timed.timers.advance(REVIEW_TIMEOUT_MS)` before the `until` go.
- Drop the SDK imports (`Options`, `SDKMessage`, `ReviewQueryFn`) the old
  fake used; import `StructuredCall` from `../contracts/structured.js`.

Run: `bun test src/memory/service.test.ts`
Expected: FAIL to typecheck at run time on `call` and `persona` not being
options (Bun reports the unknown option only through behaviour: reviews
still call `query`). Confirm with `bun run typecheck`: errors in
`service.test.ts` on `call` and `persona`.

- [ ] **Step 3: Give `runReview` and the service the call**

In `src/memory/review.ts`, `runReview` takes `call: StructuredCall` in
place of `queryFn` and `timers`, and calls it directly:

```ts
export async function runReview({
    call,
    systemPrompt,
    prompt,
    signal,
    timeoutMs = REVIEW_TIMEOUT_MS,
    schema = REVIEW_SCHEMA,
    readIds = [],
    tagging = false,
}: {
    call: StructuredCall;
    systemPrompt: string;
    prompt: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    schema?: Record<string, unknown>;
    readIds?: readonly string[];
    tagging?: boolean;
}): Promise<ReviewOutcome> {
    const outcome = await call({
        what: "review",
        system: systemPrompt,
        prompt,
        schema,
        timeoutMs,
        ...(signal === undefined ? {} : { signal }),
    });
```

The rest of `runReview` is unchanged. Delete `ReviewHandle`,
`ReviewQueryFn`, and the imports of `../structured.js` and `../timers.js`
if nothing else uses them.

In `src/memory/service.ts`:

- `MemoryServiceOptions` loses `queryFn?: ReviewQueryFn` and gains, with
  comments:

```ts
    // How a review asks the model; the agent supplies the real one.
    call: StructuredCall;
    // The persona reviews run on: the chat persona without recall.
    persona: string;
```

- `#queryFn` becomes `readonly #call: StructuredCall;` and `readonly
  #persona: string;`, set from the options; the `query` import from the
  SDK goes.
- The review's system prompt becomes:

```ts
            systemPrompt: [
                withSection(this.#persona, this.#build(phrase).block),
                instructions,
            ].join("\n\n"),
```

  with `call: this.#call` in place of `queryFn: this.#queryFn` and no
  `timers` passed to `runReview`. Import `withSection` from
  `../contracts/start.js`; drop `systemPrompt` and `withMemory` from the
  `../persona.js` import (keep `Turn` if still imported there, else
  import it from `../contracts/session.js`).

In `src/tui/run.tsx`, the `new MemoryService({...})` gains:

```ts
            call: structuredCall(),
            persona: systemPrompt,
```

importing `systemPrompt` from `../persona.js`.

- [ ] **Step 4: Rewrite the `runReview` tests on a fake call**

In `src/memory/review.test.ts`, the `runReview` tests build SDK messages
for `fakeQuery`; `structuredCall`'s own tests in `src/structured.test.ts`
already cover reading them (model, cost, errors, no result, a throw, the
timeout, cancelling, and the private home). Replace `fakeQuery` in the
`runReview` block with a fake call:

```ts
// A call answering with output, or failing with a reason, as the agent's
// structuredCall does; requests are kept for the assertions.
function fakeCall(
    outcome: StructuredOutcome,
): { call: StructuredCall; requests: StructuredRequest[] } {
    const requests: StructuredRequest[] = [];
    return {
        requests,
        call: async (request) => {
            requests.push(request);
            return outcome;
        },
    };
}
const answered = (output: unknown, costUsd = 0.25): StructuredOutcome => ({
    ok: true,
    output,
    model: "claude-test",
    costUsd,
});
```

Keep each test's assertions about notes, appraisals, normalising and
limits, with `fakeCall(answered(NOTES))` where it had
`fakeQuery([init("claude-test"), success(NOTES)])`. "fails on an error
result" becomes "passes a failed call's reason and cost through":

```ts
    it("passes a failed call's reason and cost through", async () => {
        const { call } = fakeCall({
            ok: false,
            reason: "no valid output",
            costUsd: 0.1,
        });
        expect(
            await runReview({ call, systemPrompt: "s", prompt: "p" }),
        ).toEqual({ ok: false, reason: "no valid output", costUsd: 0.1 });
    });
```

Delete "fails when the query cannot start" and any test of hanging or
timing out in this block: they test `structuredCall`, which keeps its own
tests. Delete the `cliOptions` import and its test if it checks the
query's options. Assertions on the schema read `requests[0]?.schema`.

- [ ] **Step 5: Run the tests**

Run: `bun run check`
Expected: PASS. The count drops by the `runReview` tests deleted in
Step 4; note the new count in the commit body.

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "refactor(sdk): Give reviews a StructuredCall" \
    -m "Reviews take the call and the persona's text, as compaction does,
so memory no longer imports the Agent SDK or the persona."
```

---

### Task 3: Memory renders the earlier section

The persona renders compacted clusters (`withClusters`) from sidecar
types, and compaction measures them through it. After this task memory
renders the section, prompt text and all, and the agent only appends text.

**Files:**

- Modify: `src/contracts/start.ts`, `src/memory/block.ts`,
  `src/memory/block.test.ts`, `src/compaction/plan.ts`,
  `src/compaction/plan.test.ts`, `src/persona.ts`, `src/conversation.ts`,
  `src/conversation.test.ts`, `src/tui/run.tsx`, `src/dump.ts`

**Interfaces:**

- Produces in `src/contracts/start.ts`:

```ts
// How the CLI starts the recall server: dorothy --recall-server.
export type RecallLaunch = { command: string; args: string[] };

// What a session starts with, as plain values: memory renders them, the
// agent puts them into its system prompt and its tools.
export type SessionStart = {
    // The turns after the clusters, in full.
    history: readonly Turn[];
    // The memory block, frozen for the session; "" for none.
    memory: string;
    // The earlier turns' abstracts as a section; "" for none.
    earlier: string;
    // How to launch the recall server; null leaves recall off.
    recall: RecallLaunch | null;
    // Whether the session offers recollect, which needs recall and
    // clusters.
    recollect: boolean;
};
```

- Produces in `src/memory/block.ts`: `earlierSection(clusters: readonly
  Cluster[], recollect: boolean): string`.
- Produces in `src/conversation.ts`: `type SessionSetup =
  Partial<SessionStart> & { persona?: PersonaMode }`.

- [ ] **Step 1: Pin the section's bytes**

Add to `src/memory/block.test.ts`:

```ts
describe("earlierSection", () => {
    const clusters = [
        { ...CLUSTER, from: 1, through: 4, abstract: "Tea & toast" },
        { ...CLUSTER, from: 5, through: 9, abstract: "Jam" },
    ];

    it("renders the abstracts with recollect's preamble", () => {
        expect(earlierSection(clusters, true)).toBe(
            [
                "Earlier in this conversation, in your own summaries; " +
                    "recollect opens a cluster's turns word for word:",
                "",
                "<earlier>",
                '<cluster n="1" turns="1-4">Tea &amp; toast</cluster>',
                '<cluster n="2" turns="5-9">Jam</cluster>',
                "</earlier>",
            ].join("\n"),
        );
    });

    it("renders the plain preamble without recollect", () => {
        expect(earlierSection(clusters, false)).toStartWith(
            "Earlier in this conversation, in your own summaries:\n\n",
        );
    });

    it("is empty without clusters", () => {
        expect(earlierSection([], true)).toBe("");
    });

    it("makes the prompt the persona made before", () => {
        // persona.withClusters joined [prompt, "", preamble, "", ...lines].
        expect(withSection("P", earlierSection(clusters, false))).toBe(
            [
                "P",
                "",
                "Earlier in this conversation, in your own summaries:",
                "",
                "<earlier>",
                '<cluster n="1" turns="1-4">Tea &amp; toast</cluster>',
                '<cluster n="2" turns="5-9">Jam</cluster>',
                "</earlier>",
            ].join("\n"),
        );
    });
});
```

`CLUSTER` is a complete `Cluster` fixture: reuse the one in
`block.test.ts` if it has one, else declare it from the `Cluster` type
in `src/memory/sidecar.ts` with every required field. Import
`withSection` from `../contracts/start.js`.

Run: `bun test src/memory/block.test.ts`
Expected: FAIL, `earlierSection` is not exported.

- [ ] **Step 2: Write `earlierSection`**

In `src/memory/block.ts`, after `renderClusters`, with the preambles
moved verbatim from `persona.withClusters`:

```ts
// The earlier turns' abstracts as a section of a session's system
// prompt, or "" for none. recollect: whether the session offers the tool
// that opens a cluster word for word.
export function earlierSection(
    clusters: readonly Cluster[],
    recollect: boolean,
): string {
    if (clusters.length === 0) {
        return "";
    }
    const preamble = recollect
        ? "Earlier in this conversation, in your own summaries; recollect opens a cluster's turns word for word:"
        : "Earlier in this conversation, in your own summaries:";
    return [preamble, "", ...renderClusters(clusters)].join("\n");
}
```

Run: `bun test src/memory/block.test.ts`
Expected: PASS.

- [ ] **Step 3: Measure clusters with memory's section**

In `src/compaction/plan.ts`, `clusterTokens` becomes:

```ts
export function clusterTokens(
    clusters: readonly Cluster[],
    recollect: boolean,
): number {
    return clusters.length === 0
        ? 0
        : tokens(withSection("", earlierSection(clusters, recollect)));
}
```

importing `withSection` from `../contracts/start.js` and `earlierSection`
from `../memory/block.js`, and dropping `withClusters` from the persona
import (keep `Turn` from `../contracts/session.js`). In
`src/compaction/plan.test.ts`, replace each `withClusters("", clusters,
r)` with `withSection("", earlierSection(clusters, r))`.

- [ ] **Step 4: The agent takes rendered text**

In `src/persona.ts`, delete `withMemory` and `withClusters` and the
imports of `./memory/block.js` and `./memory/sidecar.js`.

In `src/conversation.ts`, move `RecallLaunch` to `src/contracts/start.ts`
(Interfaces above) and replace `SessionSetup` and `conversationOptions`:

```ts
// A session's start and the persona it speaks with. Every field may be
// left out, for tests and the dump.
export type SessionSetup = Partial<SessionStart> & { persona?: PersonaMode };

// What a session starts with, shared with --dump-context so that the dump
// shows exactly what a chat would send.
export function conversationOptions({
    history = [],
    memory = "",
    earlier = "",
    recall = null,
    recollect = false,
    persona = "chat",
}: SessionSetup = {}): Options {
    const offered = recall !== null && recollect;
    return {
        ...baseOptions,
        ...cliOptions(),
        systemPrompt: withHistory(
            withSection(
                withSection(
                    personaPrompt({ recall: recall !== null, mode: persona }),
                    memory,
                ),
                earlier,
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
                          args: offered
                              ? [...recall.args, "--recollect"]
                              : recall.args,
                      },
                  },
                  allowedTools: offered
                      ? [...ALLOWED_TOOLS, RECOLLECT_TOOL]
                      : ALLOWED_TOOLS,
              }),
    };
}
```

Drop the `Cluster` import. `recallLaunch` stays in `conversation.ts`
until Task 7.

- [ ] **Step 5: The wiring renders the section**

In `src/tui/run.tsx`, `setup(seed)` becomes:

```ts
    const setup = (seed: Seed): SessionSetup => ({
        history: seed.turns,
        memory:
            memory?.block(clusterTokens(seed.clusters, recall !== null)) ?? "",
        earlier: earlierSection(seed.clusters, recall !== null),
        recall,
        recollect: recall !== null && seed.clusters.length > 0,
        persona,
    });
```

In `src/dump.ts`, `conversationOptions({...})` becomes:

```ts
            options: conversationOptions({
                history: seedTurns(history, clusters),
                memory,
                earlier: earlierSection(clusters, recall !== null),
                recall,
                recollect: recall !== null && clusters.length > 0,
                persona: request.persona,
            }),
```

- [ ] **Step 6: Rewrite the conversation tests on text**

In `src/conversation.test.ts`, replace `withMemory(p, b)` with
`withSection(p, b)`, and each `withClusters(p, CLUSTERS, r)` with
`withSection(p, EARLIER)`, where

```ts
// A rendered earlier section; memory's tests pin how it is rendered.
const EARLIER = "Earlier in this conversation:\n\n<earlier>\n</earlier>";
```

and the options passed say `earlier: EARLIER, recollect: r` in place of
`clusters: CLUSTERS`. A test that checked `--recollect` is offered only
with clusters now checks it is offered only with `recollect: true`.

- [ ] **Step 7: Check and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add -A src
git commit -m "refactor(sdk): Render the earlier section in memory" \
    -m "The persona appends rendered text; memory renders the clusters,
preamble and all, so the agent no longer reads sidecar types."
```

---

### Task 4: Memory's commands take their editor

**Files:**

- Modify: `src/memory/commands.ts`, `src/memory/commands.test.ts`,
  `src/index.ts`

**Interfaces:**

- Consumes: `Editor` from `src/contracts/editor.ts`.
- Produces: `runMemoryEdit(phrase, { edit: Editor, ... })` and
  `runTagsEdit({ edit: Editor, ... })`, `edit` required.

- [ ] **Step 1: Make `edit` required**

In `src/memory/commands.ts`, both functions lose the default `edit =
(text: string) => editInEditor(text)` and declare `edit: Editor;` in
their options type; delete the import of `../tui/external-editor.js` and
import `Editor` from `../contracts/editor.js`.

Run: `bun run typecheck`
Expected: errors where `src/index.ts` and `commands.test.ts` call them
without `edit`.

- [ ] **Step 2: Pass the editor in**

In `src/index.ts`, the `memory` and `tags-edit` branches pass the TUI's
editor:

```ts
    } else if (mode.kind === "memory") {
        const { runMemoryEdit } = await import("./memory/commands.js");
        const { commandHistory } = await import("./history/commands.js");
        const { editInEditor } = await import("./tui/external-editor.js");
        process.exitCode = await runMemoryEdit(mode.phrase, {
            openHistory: commandHistory(),
            edit: (text) => editInEditor(text),
        });
```

and likewise for `runTagsEdit`. In `commands.test.ts`, any call that
omits `edit` passes `edit: async (text) => ({ ok: true, text })`; import
`EditResult` from `../contracts/editor.js` if still used.

- [ ] **Step 3: Check and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add -A src
git commit -m "refactor(sdk): Pass memory's commands their editor"
```

---

### Task 5: Memory records the transcript

`App` writes each transcript entry from the session's events today. After
this task `sessionRecorder` in memory writes the same entries, and `App`
loses its `transcript` and `promptHash` props.

**Files:**

- Create: `src/memory/record.fixture.ts`, `src/memory/fake-session.ts`,
  `src/memory/record.ts`, `src/memory/record.test.ts`
- Modify: `src/tui/App.tsx`, `src/tui/App.test.tsx`, `src/tui/run.tsx`,
  `src/tui/smoke.test.tsx` if it passes `transcript`

**Interfaces:**

- Produces:

```ts
export type TranscriptSink = {
    append(entry: TranscriptEntry): Promise<void>;
};
export function sessionRecorder(options: {
    sink: TranscriptSink;
    phrase: string;
    promptHash: string;
    resumed: boolean;
    warn: (message: string) => void;
}): (session: ChatSession) => ChatSession;
export function noticeChannel(): NoticeSource & {
    warn(message: string): void;
};
```

- [ ] **Step 1: Write the scripted chat**

`src/memory/record.fixture.ts`:

```ts
// A chat as a series of steps and the transcript entries App recorded
// for it, so that the move of recording from App to memory is checked
// against the same file.

import type { ConversationEvent, TurnStats } from "../contracts/session.js";
import type { TranscriptEntry } from "../transcript.js";

export const PHRASE = "tumble-orchid-vapor-lantern";
export const HASH = "abc";

const STATS: TurnStats = {
    inputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 2,
    ttftMs: 10,
    durationMs: 20,
    costUsd: 0.01,
    sessionCostUsd: 0.01,
};

// send: the user sends text (after an error, this reconnects first).
// emit: a session emits an event, the latest unless one is named.
export type Step =
    | { send: string }
    | { emit: ConversationEvent; session?: number };

export const SCRIPT: Step[] = [
    { emit: { type: "ready", model: "m", sdkSessionId: "sdk-1" } },
    { send: "hello" },
    {
        emit: {
            type: "lookup",
            id: "toolu_1",
            ok: true,
            offset: 4,
            lookup: { tool: "search", query: "render", hits: 2 },
        },
    },
    {
        emit: {
            type: "turn-end",
            reply: "Hi there",
            interrupted: false,
            stats: STATS,
        },
    },
    { send: "again" },
    { emit: { type: "error", message: "boom", partial: "Par" } },
    { send: "third" },
    { emit: { type: "ready", model: "m", sdkSessionId: "sdk-2" } },
    // The first session, closed by the reconnect, is heard no more.
    {
        emit: {
            type: "turn-end",
            reply: "Stale",
            interrupted: false,
            stats: STATS,
        },
        session: 0,
    },
    {
        emit: {
            type: "turn-end",
            reply: "Done",
            interrupted: false,
            stats: STATS,
        },
    },
];

export const EXPECTED: TranscriptEntry[] = [
    {
        kind: "session",
        phrase: PHRASE,
        sdkSessionId: "sdk-1",
        model: "m",
        promptHash: HASH,
        resumed: false,
    },
    { kind: "user", text: "hello" },
    {
        kind: "recall",
        id: "toolu_1",
        ok: true,
        offset: 4,
        tool: "search",
        query: "render",
        hits: 2,
    },
    { kind: "assistant", text: "Hi there", interrupted: false },
    { kind: "stats", ...STATS },
    { kind: "user", text: "again" },
    { kind: "assistant", text: "Par", interrupted: true },
    { kind: "user", text: "third" },
    {
        kind: "session",
        phrase: PHRASE,
        sdkSessionId: "sdk-2",
        model: "m",
        promptHash: HASH,
        resumed: true,
    },
    { kind: "assistant", text: "Done", interrupted: false },
    { kind: "stats", ...STATS },
];
```

- [ ] **Step 2: Pin App's recording against it**

Add to `src/tui/App.test.tsx`, inside the main `describe`:

```ts
    it("records the scripted chat", async () => {
        const { sessions, entries, type } = setup();
        await tick();
        for (const step of SCRIPT) {
            if ("send" in step) {
                await type(step.send);
                await type("\r");
            } else {
                const target =
                    step.session === undefined
                        ? sessions.at(-1)
                        : sessions[step.session];
                target?.emit(step.emit);
            }
            await tick();
        }
        expect(entries).toEqual(EXPECTED);
    });
```

importing `SCRIPT` and `EXPECTED` from `../memory/record.fixture.js`.
The fixture's `PHRASE` and `HASH` are the ones `setup()` passes.

Run: `bun test src/tui/App.test.tsx -t "records the scripted chat"`
Expected: PASS. This is today's behaviour; if it fails, the fixture is
wrong, not App: correct `EXPECTED` to what App records, and say so in the
task report.

```bash
git add src/memory/record.fixture.ts src/tui/App.test.tsx
git commit -m "test(tui): Pin the transcript App records"
```

- [ ] **Step 3: Write the recorder's tests**

`src/memory/fake-session.ts`, shared by memory's tests of sessions:

```ts
// A session for tests: it keeps what is sent, and emits what a test
// tells it to.

import type { ChatSession, ConversationEvent } from "../contracts/session.js";

export class FakeSession implements ChatSession {
    readonly listeners = new Set<(event: ConversationEvent) => void>();
    readonly sent: string[] = [];
    closed = false;
    subscribe(listener: (event: ConversationEvent) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    send(text: string): void {
        this.sent.push(text);
    }
    async interrupt(): Promise<void> {}
    async close(): Promise<void> {
        this.closed = true;
    }
    emit(event: ConversationEvent): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }
}
```

`src/memory/record.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { Notice } from "../contracts/notices.js";
import type { ChatSession, ConversationEvent } from "../contracts/session.js";
import type { TranscriptEntry } from "../transcript.js";
import { FakeSession } from "./fake-session.js";
import { EXPECTED, HASH, PHRASE, SCRIPT } from "./record.fixture.js";
import { noticeChannel, sessionRecorder } from "./record.js";


function recorded(
    options: { resumed?: boolean; fail?: boolean } = {},
) {
    const entries: TranscriptEntry[] = [];
    const warnings: string[] = [];
    const wrap = sessionRecorder({
        sink: {
            append: async (entry) => {
                if (options.fail) {
                    throw new Error("disk full");
                }
                entries.push(entry);
            },
        },
        phrase: PHRASE,
        promptHash: HASH,
        resumed: options.resumed ?? false,
        warn: (message) => {
            warnings.push(message);
        },
    });
    return { entries, warnings, wrap };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("sessionRecorder", () => {
    // As App drives sessions: a send after an error closes the dead
    // session and opens a new one before sending.
    it("records the scripted chat as App did", async () => {
        const { entries, wrap } = recorded();
        const inner: FakeSession[] = [];
        let current: ChatSession | null = null;
        let dead = false;
        const connect = () => {
            void current?.close();
            const next = new FakeSession();
            inner.push(next);
            current = wrap(next);
        };
        connect();
        for (const step of SCRIPT) {
            if ("send" in step) {
                if (dead) {
                    connect();
                    dead = false;
                }
                current?.send(step.send);
            } else {
                const target =
                    step.session === undefined
                        ? inner.at(-1)
                        : inner[step.session];
                target?.emit(step.emit);
                dead ||= step.emit.type === "error";
            }
        }
        await settle();
        expect(entries).toEqual(EXPECTED);
    });

    it("records a resumed chat's first session as resumed", async () => {
        const { entries, wrap } = recorded({ resumed: true });
        const inner = new FakeSession();
        wrap(inner);
        inner.emit({ type: "ready", model: "m", sdkSessionId: "s" });
        await settle();
        expect(entries[0]).toMatchObject({ kind: "session", resumed: true });
    });

    it("passes events and messages through", async () => {
        const { wrap } = recorded();
        const inner = new FakeSession();
        const session = wrap(inner);
        const heard: ConversationEvent[] = [];
        session.subscribe((event) => heard.push(event));
        inner.emit({ type: "delta", text: "Hi" });
        session.send("hello");
        expect(heard).toEqual([{ type: "delta", text: "Hi" }]);
        expect(inner.sent).toEqual(["hello"]);
    });

    it("warns when an entry cannot be written, and goes on", async () => {
        const { warnings, wrap } = recorded({ fail: true });
        const inner = new FakeSession();
        wrap(inner).send("hello");
        await settle();
        expect(warnings).toEqual(["transcript not saved: disk full"]);
        expect(inner.sent).toEqual(["hello"]);
    });
});

describe("noticeChannel", () => {
    it("tells each listener of a warning until it stops listening", () => {
        const channel = noticeChannel();
        const heard: Notice[] = [];
        const stop = channel.subscribe((notice) => heard.push(notice));
        channel.warn("one");
        stop();
        channel.warn("two");
        expect(heard).toEqual([{ type: "warning", message: "one" }]);
    });
});
```

Run: `bun test src/memory/record.test.ts`
Expected: FAIL, `./record.js` not found.

- [ ] **Step 4: Write the recorder**

`src/memory/record.ts`:

```ts
// What a chat records of its sessions, as App did: each session once it
// is ready, each message as it is sent, each lookup, and each reply with
// its stats, or what was on screen of a reply cut short. A session that
// has been closed records nothing more, as App stopped hearing a session
// once it had moved on.

import type { Notice, NoticeSource } from "../contracts/notices.js";
import type { ChatSession, ConversationEvent } from "../contracts/session.js";
import type { TranscriptEntry } from "../transcript.js";

export type TranscriptSink = {
    append(entry: TranscriptEntry): Promise<void>;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

export function sessionRecorder({
    sink,
    phrase,
    promptHash,
    resumed,
    warn,
}: {
    sink: TranscriptSink;
    phrase: string;
    promptHash: string;
    // Whether the chat had turns before its first session.
    resumed: boolean;
    warn: (message: string) => void;
}): (session: ChatSession) => ChatSession {
    let wasResumed = resumed;
    const record = (entry: TranscriptEntry) => {
        sink.append(entry).catch((error: unknown) => {
            warn(`transcript not saved: ${describeError(error)}`);
        });
    };
    const recordEvent = (event: ConversationEvent) => {
        if (event.type === "ready") {
            record({
                kind: "session",
                phrase,
                sdkSessionId: event.sdkSessionId,
                model: event.model,
                promptHash,
                resumed: wasResumed,
            });
            wasResumed = true;
        } else if (event.type === "lookup") {
            record({
                kind: "recall",
                id: event.id,
                ok: event.ok,
                offset: event.offset,
                ...event.lookup,
            });
        } else if (event.type === "turn-end") {
            record({
                kind: "assistant",
                text: event.reply,
                interrupted: event.interrupted,
            });
            record({ kind: "stats", ...event.stats });
        } else if (event.type === "error" && event.partial) {
            record({
                kind: "assistant",
                text: event.partial,
                interrupted: true,
            });
        }
    };
    return (session) => {
        let open = true;
        const listeners = new Set<(event: ConversationEvent) => void>();
        session.subscribe((event) => {
            if (open) {
                recordEvent(event);
            }
            for (const listener of listeners) {
                listener(event);
            }
        });
        return {
            subscribe(listener) {
                listeners.add(listener);
                return () => {
                    listeners.delete(listener);
                };
            },
            send(text) {
                if (open) {
                    record({ kind: "user", text });
                }
                session.send(text);
            },
            interrupt: () => session.interrupt(),
            close: () => {
                open = false;
                return session.close();
            },
        };
    };
}

// Warnings raised outside the service and history, such as a transcript
// write that failed, told to the chat the same way.
export function noticeChannel(): NoticeSource & {
    warn(message: string): void;
} {
    const listeners = new Set<(notice: Notice) => void>();
    return {
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        warn(message) {
            for (const listener of listeners) {
                listener({ type: "warning", message });
            }
        },
    };
}
```

Run: `bun test src/memory/record.test.ts`
Expected: PASS.

```bash
git add src/memory/record.ts src/memory/record.test.ts \
    src/memory/fake-session.ts
git commit -m "feat(sdk): Record a chat's sessions in memory"
```

- [ ] **Step 5: Move recording out of App**

In `src/tui/App.tsx`: delete `TranscriptSink`, the `transcript` and
`promptHash` props, `resumed`, `record`, every `record(...)` call, and
the `TranscriptEntry` import. `onEvent` keeps only what touches
`turns.current`:

```ts
    const onEvent = (event: ConversationEvent) => {
        if (event.type === "turn-end") {
            turns.current.push({ role: "assistant", text: event.reply });
        } else if (event.type === "error" && event.partial) {
            // Keep what was already on screen, so a reconnect or --resume
            // carries it too.
            turns.current.push({ role: "assistant", text: event.partial });
        }
    };
```

In `src/tui/run.tsx`, the session maker's sessions are recorded, and its
warnings joined to the notices:

```ts
    const channel = noticeChannel();
    const record =
        transcript === null
            ? null
            : sessionRecorder({
                  sink: transcript,
                  phrase,
                  promptHash: promptHash(
                      personaPrompt({ recall: recall !== null, mode: persona }),
                  ),
                  resumed: history.length > 0,
                  warn: (message) => channel.warn(message),
              });
    const make = sessionMaker({
        compaction,
        connect,
        clusters,
        memory,
        turnEnded: turns?.ended ?? null,
    });
```

and `<App>` takes `createSession={(turns) => { const session =
make(turns); return record === null ? session : record(session); }}` (as
a named function above the render, for formatting), `notices=
{mergeNotices(memory, launched?.history, channel)}`, and neither
`transcript` nor `promptHash`.

In `src/tui/App.test.tsx`: `setup()` loses `failWrites` and the
`transcript` and `promptHash` props, and returns no `entries`. Delete the
tests whose subject was recording, now covered by `record.test.ts`:
"records the scripted chat", "records each lookup in the transcript",
"records a resumed session as resumed", and "warns once when the
transcript cannot be written, and keeps chatting". In the others, delete
only the `entries` assertions: "starts a session and records it once
ready" becomes "starts a session and shows it once ready"; "sends a
message, streams the reply and records the turn" becomes "sends a
message and streams the reply"; "ignores an empty or whitespace-only
Enter" keeps `sent` empty; "reconnects with full history after the
session dies mid-reply" keeps its `histories` and `sent` checks; "takes no
message while closing, and closes once" checks `session().sent` is empty
in place of the user entries. Remove the import of the fixture.

Run: `bun run check`
Expected: PASS.

```bash
git add -A src
git commit -m "refactor(tui): Leave the transcript to memory"
```

---

### Task 6: runApp fronts the screen

**Files:**

- Create: `src/tui/run-app.tsx`, `src/tui/run-app.test.tsx`
- Modify: `src/tui/run.tsx`

**Interfaces:**

- Produces:

```ts
export type RunAppOptions = Omit<AppProps, "editDraft"> & {
    editDraft?: AppProps["editDraft"];
};
export function runApp(options: RunAppOptions): Promise<void>;
```

- [ ] **Step 1: Write the test**

`runApp` renders to the process's terminal, which a test cannot drive,
so it takes the renderer as an optional second argument, Ink's by
default. `src/tui/run-app.test.tsx` checks what it renders and that it
waits; `App`'s behaviour has its own tests.

```tsx
import { describe, expect, it } from "bun:test";
import type { ReactElement } from "react";
import type { ChatSession } from "../contracts/session.js";
import { App } from "./App.js";
import { runApp } from "./run-app.js";

const session: ChatSession = {
    subscribe: () => () => {},
    send: () => {},
    interrupt: async () => {},
    close: async () => {},
};

// Renders nothing; keeps the tree, and counts the waits for an exit.
function recorder() {
    const shown: ReactElement[] = [];
    let waits = 0;
    return {
        shown,
        waits: () => waits,
        render: (tree: ReactElement) => {
            shown.push(tree);
            return {
                waitUntilExit: async () => {
                    waits++;
                },
            };
        },
    };
}

type Props = { phrase: string; editDraft: unknown };

describe("runApp", () => {
    it("renders App with its props and waits for it to exit", async () => {
        const io = recorder();
        await runApp(
            {
                phrase: "tumble-orchid-vapor-lantern",
                history: [],
                createSession: () => session,
            },
            io,
        );
        const tree = io.shown[0];
        expect(tree?.type).toBe(App);
        expect((tree?.props as Props).phrase).toBe(
            "tumble-orchid-vapor-lantern",
        );
        expect(typeof (tree?.props as Props).editDraft).toBe("function");
        expect(io.waits()).toBe(1);
    });

    it("opens drafts in the editor it is given", async () => {
        const io = recorder();
        const editDraft = async (text: string) => ({ ok: true, text }) as const;
        await runApp(
            {
                phrase: "tumble-orchid-vapor-lantern",
                history: [],
                createSession: () => session,
                editDraft,
            },
            io,
        );
        expect((io.shown[0]?.props as Props).editDraft).toBe(editDraft);
    });
});
```

Run: `bun test src/tui/run-app.test.tsx`
Expected: FAIL, `./run-app.js` not found.

- [ ] **Step 2: Write `runApp`**

`src/tui/run-app.tsx`:

```tsx
// The chat on the terminal: App rendered until it exits. The draft opens
// in $EDITOR unless another editor is given.

import { render } from "ink";
import type { ReactElement } from "react";
import { App, type AppProps } from "./App.js";
import { editInEditor } from "./external-editor.js";

export type RunAppOptions = Omit<AppProps, "editDraft"> & {
    editDraft?: AppProps["editDraft"];
};

type Rendered = { waitUntilExit(): Promise<unknown> };

export async function runApp(
    { editDraft = (text) => editInEditor(text), ...props }: RunAppOptions,
    {
        render: show = (tree: ReactElement): Rendered =>
            // Kitty-protocol terminals report Shift+Enter apart from
            // Enter.
            render(tree, {
                exitOnCtrlC: false,
                kittyKeyboard: { mode: "auto" },
            }),
    }: { render?: (tree: ReactElement) => Rendered } = {},
): Promise<void> {
    await show(<App {...props} editDraft={editDraft} />).waitUntilExit();
}
```

Run: `bun test src/tui/run-app.test.tsx`
Expected: PASS.

- [ ] **Step 3: Use it in the wiring**

In `src/tui/run.tsx`, replace `const app = render(<App ... />, {...});`
and `await app.waitUntilExit();` with:

```ts
    try {
        await runApp({
            phrase,
            history,
            createSession,
            notices: mergeNotices(memory, launched?.history, channel),
            initialWarnings: warnings,
            initialCostUsd: costUsd,
            config,
        });
    } finally {
```

where `createSession` is the function Task 5 named. Drop the `render`,
`App` and `editInEditor` imports; `run.tsx` now holds no JSX. Rename it
with `git mv src/tui/run.tsx src/tui/run.ts` in this commit, since its
content changed anyway, and update `src/index.ts`'s and
`src/tui/run.test.ts`'s specifiers if they name `.tsx` (they name
`./run.js`, which resolves either way).

Run: `bun run check`
Expected: PASS.

```bash
git add -A src
git commit -m "refactor(tui): Front the screen with runApp"
```

---

### Task 7: openMemory takes over the wiring

`src/tui/run.ts` is memory's wiring with a little of the agent's. After
this task it is `src/memory/open.ts`, exporting `openMemory`, and the
CLI's `runTui` in `src/run-tui.ts` only connects the packages.

**Files:**

- Move: `src/tui/run.ts` to `src/memory/open.ts`;
  `src/tui/run.test.ts` to `src/memory/open.test.ts`
- Create: `src/run-tui.ts`, `src/recall-launch.ts`
- Modify: `src/memory/open.ts`, `src/memory/open.test.ts`,
  `src/conversation.ts`, `src/dump.ts`, `src/index.ts`

**Interfaces:**

- Consumes: `sessionRecorder`, `noticeChannel` (Task 5); `runApp`
  (Task 6); `SessionStart`, `RecallLaunch`, `withSection` (Task 3);
  `earlierSection` (Task 3); `MemoryServiceOptions.call`, `.persona`
  (Task 2).
- Produces, in `src/memory/open.ts`:

```ts
export type MemoryPrompts = {
    review: string;
    compaction: string;
    hash(recall: boolean): string;
    session(start: SessionStart): string;
};
export type OpenMemoryOptions = {
    resume: string | null;
    call: StructuredCall;
    prompts: MemoryPrompts;
    connect(start: SessionStart): ChatSession;
    recallLaunch(phrase: string): RecallLaunch;
    env?: Env;
};
export type Memory = {
    phrase: string;
    history: ResumedTurn[];
    costUsd: number;
    config: Config;
    warnings: string[];
    notices: NoticeSource | undefined;
    createSession(turns: Turn[]): ChatSession;
    close(): Promise<void>;
};
export type OpenedMemory =
    | { ok: true; memory: Memory }
    | { ok: false; message: string };
export function openMemory(options: OpenMemoryOptions): Promise<OpenedMemory>;
```

and, in `src/recall-launch.ts`, `recallLaunch(phrase: string):
RecallLaunch`; in `src/run-tui.ts`, `runTui(resume: string | null,
persona?: PersonaMode): Promise<number>`.

- [ ] **Step 1: Move the wiring**

```bash
git mv src/tui/run.ts src/memory/open.ts
git mv src/tui/run.test.ts src/memory/open.test.ts
```

Fix relative specifiers in both (`../memory/x.js` becomes `./x.js`,
`./App.js` becomes `../tui/App.js` for now, and so on) and in
`src/index.ts` (`./tui/run.js` becomes `./memory/open.js`).

Run: `bunx sync-header-metadata --update && bun run check`
Expected: PASS.

```bash
git add -A src
git commit -m "refactor(sdk): Move the chat's wiring to memory"
```

- [ ] **Step 2: Move `recallLaunch` to the CLI**

`src/recall-launch.ts`, with `recallLaunch` cut verbatim from
`src/conversation.ts`:

```ts
// Dorothy's memory tools: this program again, as an MCP server, leaving
// out the conversation it serves. The flags are the CLI's, parsed in
// index.ts.

import { resolve } from "node:path";
import type { RecallLaunch } from "./contracts/start.js";

export function recallLaunch(phrase: string): RecallLaunch {
    return {
        command: process.execPath,
        args: [
            resolve(process.argv[1] ?? ""),
            "--recall-server",
            "--exclude",
            phrase,
        ],
    };
}
```

Repoint `recallLaunch`'s importers (`src/memory/open.ts`, `src/dump.ts`,
tests) to it.

- [ ] **Step 3: Write `openMemory`'s test**

Add to `src/memory/open.test.ts`. Its `beforeEach` already points
`XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_CACHE_HOME` at a temporary
`dir`, so the tests pass `env: process.env` (declare `const env =
process.env;` inside the `describe`), and history, if the default config
turns it on, adopts that temporary directory as the file's other tests'
launches do:

```ts
describe("openMemory", () => {
    const prompts: MemoryPrompts = {
        review: "R",
        compaction: "C",
        hash: (recall) => (recall ? "with" : "without"),
        session: (start) => withSection("S", start.memory),
    };
    const quiet: StructuredCall = async () => ({
        ok: false,
        reason: "not under test",
        costUsd: 0,
    });

    it("fails to resume a chat that has no transcript", async () => {
        const opened = await openMemory({
            resume: "tumble-orchid-vapor-lantern",
            call: quiet,
            prompts,
            connect: () => {
                throw new Error("no session expected");
            },
            recallLaunch: (phrase) => ({ command: "x", args: [phrase] }),
            env,
        });
        expect(opened.ok).toBe(false);
        if (!opened.ok) {
            expect(opened.message).toStartWith(
                "cannot resume tumble-orchid-vapor-lantern: ",
            );
        }
    });

    it("starts sessions with memory's start and records them", async () => {
        const starts: SessionStart[] = [];
        const inner = new FakeSession();
        const opened = await openMemory({
            resume: null,
            call: quiet,
            prompts,
            connect: (start) => {
                starts.push(start);
                return inner;
            },
            recallLaunch: (phrase) => ({ command: "x", args: [phrase] }),
            env,
        });
        if (!opened.ok) {
            throw new Error(opened.message);
        }
        const { memory } = opened;
        try {
            memory.createSession([]).send("hello");
            inner.emit({ type: "ready", model: "m", sdkSessionId: "s" });
            expect(starts).toHaveLength(1);
            expect(starts[0]).toMatchObject({
                history: [],
                earlier: "",
                recollect: false,
            });
            expect(inner.sent).toEqual(["hello"]);
        } finally {
            await memory.close();
        }
        const text = await Bun.file(
            transcriptPath(memory.phrase, env),
        ).text();
        expect(text).toContain('"kind":"user"');
        expect(text).toContain('"promptHash":"with"');
    });
});
```

`FakeSession` comes from `./fake-session.js` (Task 5).

Run: `bun test src/memory/open.test.ts -t openMemory`
Expected: FAIL, `openMemory` is not exported.

- [ ] **Step 4: Turn `runTui` into `openMemory`**

In `src/memory/open.ts`, add the Interfaces' types with these comments:

```ts
// What memory needs of the model side, as text: it never builds a
// prompt from the persona itself.
export type MemoryPrompts = {
    // Reviews run on the chat persona, without recall.
    review: string;
    // Compaction runs on the persona of this chat's mode, without recall.
    compaction: string;
    // The promptHash a session records, with recall on or off.
    hash(recall: boolean): string;
    // The system prompt a session starting so would have, for
    // compaction's estimate of what a compacted session costs.
    session(start: SessionStart): string;
};
```

Replace `runTui` with `openMemory`, which is `runTui` up to the render,
with these changes and no others:

- It takes `OpenMemoryOptions`; `phrase` is `resume ?? newPhrase()`;
  `transcriptPath`, `transcriptDir`, `vocabularyPath`, `readConfig` and
  `launchHistory` are given `env`; `openChatIndex` gains an `env`
  parameter (default `process.env`) passed to `indexPath(env)`.
- A resume that cannot be read closes history and the index as before
  and returns `{ ok: false, message: \`cannot resume ${resume}:
  ${path}: ${describeError(error)}\` }` in place of writing to stderr.
- The service is named `service`, and is given `call` and `persona:
  prompts.review`.
- The turn committer is named `committer`, freeing `turns` for the
  session maker's argument.
- `setup(seed)` becomes `startOf(seed): SessionStart`, the Task 3 values
  without `persona`. `connect` is the option, given `startOf(seed)`.
- Compaction is given `persona: prompts.compaction`, `call`, and
  `estimate: (seed) => tokens(prompts.session(startOf(seed)))`.
- The recorder is given `promptHash: prompts.hash(recall !== null)`.
- It returns:

```ts
    return {
        ok: true,
        memory: {
            phrase,
            history,
            costUsd,
            config,
            warnings,
            notices: mergeNotices(service, launched?.history, channel),
            createSession: (turns) => {
                const session = make(turns);
                return record === null ? session : record(session);
            },
            close: () =>
                closeInOrder([
                    () => compaction?.stop(),
                    () => service?.stop(),
                    () => committer?.settled(),
                    () => launched?.close(),
                    () => index?.close(),
                    () => writer?.close(),
                ]),
        },
    };
```

Remove the imports this leaves unused (`runApp`, `Conversation`,
`conversationOptions`, `personaPrompt`, `promptHash`, `structuredCall`,
`systemPrompt`); `open.ts` must import nothing from `../conversation.js`,
`../persona.js`, `../structured.js` or `../tui/`.

Run: `bun test src/memory/open.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the CLI's `runTui`**

`src/run-tui.ts`:

```ts
// A chat on the terminal: memory opened with the model side's prompts
// and sessions, the screen run over it, and memory closed after.

import { Conversation, conversationOptions } from "./conversation.js";
import { openMemory } from "./memory/open.js";
import {
    type PersonaMode,
    personaPrompt,
    promptHash,
    systemPrompt,
} from "./persona.js";
import { recallLaunch } from "./recall-launch.js";
import { structuredCall } from "./structured.js";
import { runApp } from "./tui/run-app.js";

export async function runTui(
    resume: string | null,
    persona: PersonaMode = "chat",
): Promise<number> {
    const opened = await openMemory({
        resume,
        call: structuredCall(),
        prompts: {
            review: systemPrompt,
            compaction: personaPrompt({ recall: false, mode: persona }),
            hash: (recall) =>
                promptHash(personaPrompt({ recall, mode: persona })),
            session: (start) =>
                String(conversationOptions({ ...start, persona }).systemPrompt),
        },
        connect: (start) => {
            const conversation = new Conversation({ ...start, persona });
            conversation.start();
            return conversation;
        },
        recallLaunch,
    });
    if (!opened.ok) {
        process.stderr.write(`dorothy: ${opened.message}\n`);
        return 1;
    }
    const { memory } = opened;
    try {
        await runApp({
            phrase: memory.phrase,
            history: memory.history,
            createSession: (turns) => memory.createSession(turns),
            notices: memory.notices,
            initialWarnings: memory.warnings,
            initialCostUsd: memory.costUsd,
            config: memory.config,
        });
    } finally {
        await memory.close();
    }
    return 0;
}
```

In `src/index.ts`, the chat branch imports `./run-tui.js`.

Run: `bun run check`
Expected: PASS.

```bash
git add -A src
git commit -m "refactor(sdk): Open memory for a chat in one call" \
    -m "openMemory takes over run.tsx's wiring of memory; runTui only
connects memory, the agent and the screen."
```

---

### Task 8: The one-shot reply and the dump split

**Files:**

- Create: `src/one-shot.ts`, `src/capture.ts`, `src/capture.test.ts`,
  `src/memory/preview.ts`, `src/memory/preview.test.ts`
- Modify: `src/index.ts`, `src/dump.ts`, `src/dump.test.ts`

**Interfaces:**

- Produces: `runOneShot(prompt: string, persona: PersonaMode):
  Promise<void>` in `src/one-shot.ts`; `CaptureQueryFn`,
  `captureServer`, `dumpRequest` in `src/capture.ts`; in
  `src/memory/preview.ts`:

```ts
export type Preview =
    | { ok: true; phrase: string; start: SessionStart; warnings: string[] }
    | { ok: false; message: string };
export function previewStart(options: {
    resume: string | null;
    recallLaunch(phrase: string): RecallLaunch;
    env?: Env;
}): Promise<Preview>;
```

- [ ] **Step 1: Move the one-shot reply**

Cut `oneShot` from `src/index.ts` into `src/one-shot.ts` as `export
async function runOneShot`, verbatim, with its imports (`query`,
`baseOptions`, `cliOptions`, `personaPrompt`, `PersonaMode`) and the
comment:

```ts
// One reply, streamed to stdout, for dorothy <prompt>: no memory, no
// recall, no transcript.
```

`src/index.ts` calls `await runOneShot(mode.prompt, mode.persona);`, and
loses the SDK import.

Run: `bun run check`
Expected: PASS.

```bash
git add -A src
git commit -m "refactor(sdk): Move the one-shot reply out of index"
```

- [ ] **Step 2: Split the capture out of the dump**

Cut `CaptureQueryFn`, `captureServer` and `dumpRequest`, verbatim, from
`src/dump.ts` into `src/capture.ts`, and their `describe` blocks from
`src/dump.test.ts` into `src/capture.test.ts`, each with the imports it
needs. `src/dump.ts` imports `dumpRequest` and `CaptureQueryFn` from
`./capture.js`.

Run: `bun run check`
Expected: PASS.

```bash
git add -A src
git commit -m "refactor(sdk): Split the request capture from the dump"
```

- [ ] **Step 3: Write `previewStart`'s tests**

Move "dumps a compacted chat as it would resume: abstracts, then the
tail" from `src/dump.test.ts` to `src/memory/preview.test.ts`, checking
the start where it checked the request body:

```ts
    it("starts a compacted chat as it would resume", async () => {
        // The fixture as the dump test wrote it: a transcript of turns
        // and a sidecar holding clusters over the first of them.
        const preview = await previewStart({
            resume: phrase,
            recallLaunch: (of) => ({ command: "x", args: [of] }),
            env,
        });
        if (!preview.ok) {
            throw new Error(preview.message);
        }
        expect(preview.start.earlier).toContain("<earlier>");
        expect(preview.start.history).toEqual(tail);
        expect(preview.start.recollect).toBe(true);
    });

    it("fails on a chat that cannot be resumed", async () => {
        const preview = await previewStart({
            resume: "tumble-orchid-vapor-lantern",
            recallLaunch: (of) => ({ command: "x", args: [of] }),
            env,
        });
        expect(preview).toMatchObject({ ok: false });
    });
```

taking the fixture-writing code, `phrase`, `tail` and the `env` setup
from the dump test as they are, and its sidecar written with
`EMPTY_SIDECAR` from `./sidecar.js` as before. Recall is on in the
default config only when the index opens; if `recollect` is false under
the test's config, assert what the dump test asserted of the body's
tools instead.

Run: `bun test src/memory/preview.test.ts`
Expected: FAIL, `./preview.js` not found.

- [ ] **Step 4: Write `previewStart`**

`src/memory/preview.ts`, from `runDump`'s reading half, verbatim in its
order and messages:

```ts
// What a chat would start with, read without opening history or a
// transcript, for --dump-context: the turns after the clusters, the
// memory block with the clusters charged first, and recall as the config
// has it.

import { type Env, readConfig } from "../config.js";
import type { Turn } from "../contracts/session.js";
import type { RecallLaunch, SessionStart } from "../contracts/start.js";
import { clusterTokens, seedTurns } from "../compaction/plan.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { newPhrase } from "../session-id.js";
import {
    readTranscript,
    transcriptDir,
    transcriptPath,
} from "../transcript.js";
import { earlierSection } from "./block.js";
import { indexCatalogue } from "./catalogue.js";
import { buildMemory } from "./rank.js";
import { type Cluster, readSidecar } from "./sidecar.js";

export type Preview =
    | { ok: true; phrase: string; start: SessionStart; warnings: string[] }
    | { ok: false; message: string };

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

export async function previewStart({
    resume,
    recallLaunch,
    env = process.env,
}: {
    resume: string | null;
    recallLaunch(phrase: string): RecallLaunch;
    env?: Env;
}): Promise<Preview> {
    const phrase = resume ?? newPhrase();
    let history: Turn[] = [];
    if (resume !== null) {
        const path = transcriptPath(phrase, env);
        try {
            history = (await readTranscript(path)).turns;
        } catch (error) {
            return {
                ok: false,
                message: `cannot resume ${phrase}: ${path}: ${describeError(error)}`,
            };
        }
    }
    const { config, warnings } = await readConfig(env);
    let clusters: Cluster[] = [];
    if (resume !== null) {
        const notes = await readSidecar(transcriptDir(env), phrase);
        if (notes.kind === "ok") {
            clusters = notes.sidecar.clusters;
        }
    }
    let index: RecallIndex | null = null;
    if (config.memory.enabled || config.memory.recall) {
        try {
            index = RecallIndex.open(indexPath(env));
        } catch (error) {
            warnings.push(
                `memory: the index can't be opened (${describeError(error)})`,
            );
        }
    }
    try {
        const recall =
            config.memory.recall && index !== null
                ? recallLaunch(phrase)
                : null;
        let memory = "";
        if (config.memory.enabled && index !== null) {
            const loaded = await indexCatalogue(
                index,
                transcriptDir(env),
            ).load();
            const built = buildMemory(loaded.entries, {
                now: Date.now(),
                config: config.memory,
                exclude: phrase,
                reserved: clusterTokens(clusters, recall !== null),
            });
            warnings.push(...loaded.warnings, ...built.warnings);
            memory = built.block;
        }
        return {
            ok: true,
            phrase,
            warnings,
            start: {
                history: seedTurns(history, clusters),
                memory,
                earlier: earlierSection(clusters, recall !== null),
                recall,
                recollect: recall !== null && clusters.length > 0,
            },
        };
    } finally {
        index?.close();
    }
}
```

Adjust the import paths to where Task 1 left `Env` and `readConfig`.

Run: `bun test src/memory/preview.test.ts`
Expected: PASS.

- [ ] **Step 5: The dump composes the two**

`runDump` in `src/dump.ts` becomes:

```ts
export async function runDump(
    request: DumpRequest,
    {
        env = process.env,
        queryFn,
        write = {
            out: (text: string) => {
                process.stdout.write(text);
            },
            err: (text: string) => {
                process.stderr.write(text);
            },
        },
    }: {
        env?: Env;
        queryFn?: CaptureQueryFn;
        write?: { out: (text: string) => void; err: (text: string) => void };
    } = {},
): Promise<number> {
    const preview = await previewStart({
        resume: request.resume,
        recallLaunch,
        env,
    });
    if (!preview.ok) {
        write.err(`dorothy: ${preview.message}\n`);
        return 1;
    }
    const body = await dumpRequest({
        prompt: request.message,
        options: conversationOptions({
            ...preview.start,
            persona: request.persona,
        }),
        ...(queryFn === undefined ? {} : { queryFn }),
    });
    for (const warning of preview.warnings) {
        write.err(`dorothy: ${warning}\n`);
    }
    if (body === null) {
        write.err("dorothy: the CLI sent no request to dump\n");
        return 1;
    }
    write.out(`${JSON.stringify(body, null, 2)}\n`);
    return 0;
}
```

`src/dump.ts` then imports nothing from `./memory/` but `previewStart`,
and nothing from `./compaction/`, `./recall/` or `./transcript.js`;
`src/dump.test.ts` drops the `EMPTY_SIDECAR` import with the test moved
in Step 3.

Run: `bun run check`
Expected: PASS.

```bash
git add -A src
git commit -m "refactor(sdk): Preview a chat's start in memory"
```

- [ ] **Step 6: Confirm the seams are cut**

Run each; every one must print nothing:

```bash
grep -rln -e 'conversation\.js' -e 'persona\.js' -e 'structured\.js' \
    -e '"\.\./tui/' -e 'claude-agent-sdk' \
    src/memory src/recall src/compaction src/history src/transcript.ts \
    src/sqlite-lock.ts
grep -rln -e 'memory/' -e 'recall/' -e 'compaction/' -e 'history/' \
    -e 'transcript\.js' src/conversation.ts src/structured.ts \
    src/persona.ts src/one-shot.ts src/capture.ts
grep -rln -e 'conversation\.js' -e 'persona\.js' -e 'memory/' \
    -e 'recall/' -e 'transcript\.js' --exclude='*.test.*' src/tui
```

Tests in `src/tui/` may still import fixtures from elsewhere. List them
with the command below, and repoint each to `src/contracts/` or a local
helper now, so that the tui package's tests import only `core`.

```bash
grep -rlE \
    '\.\./(memory|recall|compaction|history)/|persona\.js|conversation\.js' \
    src/tui
```

---

### Task 9: The workspace and @dorothy/core

**Files:**

- Modify: `.commitlintrc.mts`, `package.json`, `bunfig.toml`,
  `tsconfig.json`, `bun.lock`, every `src/` file importing a core module
- Move: `src/xdg.ts`, `src/xdg.test.ts`, `src/config.ts`,
  `src/config.test.ts`, `src/timers.ts`, `src/session-id.ts`,
  `src/session-id.test.ts`, `src/types/niceware.d.ts`, `src/contracts/`
  into `packages/core/src/`
- Create: `packages/core/package.json`, `packages/core/src/index.ts`

**Interfaces:**

- Produces: `@dorothy/core`, whose `"."` exports everything its modules
  export.

- [ ] **Step 1: Add the package scopes**

In `.commitlintrc.mts`, add after `tui`'s entry, keeping `sdk` and `tui`
for now:

```ts
        {
            name: "core",
            fullName: "Core",
            description: "Shared contracts and basics, ie. packages/core/",
        },
        {
            name: "memory",
            fullName: "Memory",
            description: "Her memory database, ie. packages/memory/",
        },
        {
            name: "agent",
            fullName: "Agent",
            description: "Her model side, ie. packages/agent/",
        },
        {
            name: "cli",
            fullName: "CLI",
            description: "The entry point, ie. packages/cli/",
        },
```

and change `tui`'s description to "Terminal chat interface, ie.
packages/tui/".

```bash
git add .commitlintrc.mts
git commit -m "chore(config): Add the package commit scopes"
```

- [ ] **Step 2: Make the root a workspace**

`package.json` gains, after `"engines"`:

```json
    "workspaces": ["packages/*"],
```

and `"@dorothy/core": "workspace:*"` in `dependencies`.

`bunfig.toml` gains:

```toml
[install]
# Each package sees only what its package.json declares, so an
# undeclared import fails to resolve under Bun and tsc alike.
linker = "isolated"
```

`tsconfig.json`'s `include` becomes `[".commitlintrc.mts",
"scripts/**/*.mjs", "src", "packages/*/src", "test-setup.ts"]`.

- [ ] **Step 3: Create the package and move core into it**

```bash
mkdir -p packages/core/src
git mv src/xdg.ts src/xdg.test.ts src/config.ts src/config.test.ts \
    src/timers.ts src/session-id.ts src/session-id.test.ts \
    packages/core/src/
git mv src/types packages/core/src/types
git mv src/contracts packages/core/src/contracts
```

`packages/core/package.json`:

```json
{
    "name": "@dorothy/core",
    "private": true,
    "type": "module",
    "exports": {
        ".": "./src/index.ts"
    },
    "dependencies": {
        "niceware": "^4.0.0"
    }
}
```

`packages/core/src/index.ts`:

```ts
// @dorothy/core: the contracts the packages meet on, and the basics they
// all use. Every module here is public as it stands.

export * from "./config.js";
export * from "./contracts/editor.js";
export * from "./contracts/notices.js";
export * from "./contracts/recall.js";
export * from "./contracts/session.js";
export * from "./contracts/start.js";
export * from "./contracts/structured.js";
export * from "./session-id.js";
export * from "./timers.js";
export * from "./xdg.js";
```

If two modules export one name, `tsc` reports it: rename the internal
one, never drop an export someone imports.

- [ ] **Step 4: Repoint `src/` to the package**

```bash
CORE='(?:xdg|config|timers|session-id|contracts/[a-z-]+)'
grep -rlP --include='*.ts' --include='*.tsx' \
    'from "(?:\.\.?/)+'"$CORE"'\.js"' src \
    | xargs -r perl -pi -e \
    's{from "(?:\.\.?/)+'"$CORE"'\.js"}{from "\@dorothy/core"}g'
```

(No directory below `src/` has a `config.ts`, `timers.ts`, `xdg.ts` or
`session-id.ts` of its own, so only the core modules match; tested on a
scratch tree.)

Then merge each file's imports from `@dorothy/core` into one declaration
(Global Constraints). Check that no `src/` file still names a moved
module: `grep -rnE '(xdg|config|timers|session-id|contracts/)[a-z/-]*\.js"' src`
prints only matches that are not core modules (such as
`history/config`, if any).

- [ ] **Step 5: Install, check and commit**

Run: `bun install && bunx sync-header-metadata --update && bun run check`
Expected: PASS, the same test count as after Task 8.

```bash
git add -A package.json bunfig.toml tsconfig.json bun.lock src packages
git commit -m "refactor(core): Make core a workspace package"
```

---

### Task 10: @dorothy/tui

**Files:**

- Move: everything in `src/tui/` into `packages/tui/src/`
- Create: `packages/tui/package.json`, `packages/tui/src/index.ts`
- Delete: `packages/tui/src/boundary.test.ts`
- Modify: `package.json`, `src/run-tui.ts`, `src/index.ts`

- [ ] **Step 1: Find the package's external imports**

```bash
grep -rhoE 'from "[^.@][^"]*"|from "@[^"/]+/[^"/"]+' src/tui \
    | sort -u
```

Expected: `ink`, `react`, `marked`, `lowlight`, `string-width`, and in
tests `ink-testing-library`; anything else found joins the manifest.

- [ ] **Step 2: Move and declare**

```bash
mkdir -p packages/tui
git mv src/tui packages/tui/src
git rm packages/tui/src/boundary.test.ts
```

`packages/tui/package.json`, with versions copied from the root's:

```json
{
    "name": "@dorothy/tui",
    "private": true,
    "type": "module",
    "exports": {
        ".": "./src/index.ts"
    },
    "dependencies": {
        "@dorothy/core": "workspace:*",
        "ink": "^7.1.1",
        "lowlight": "^3.3.0",
        "marked": "^18.0.14",
        "react": "^19.2.0",
        "string-width": "^8.3.0"
    },
    "devDependencies": {
        "@types/react": "^19.2.0",
        "ink-testing-library": "^4.0.0"
    }
}
```

`packages/tui/src/index.ts`:

```ts
// @dorothy/tui: the chat on the terminal, and the editor it opens.

export { editInEditor } from "./external-editor.js";
export { type RunAppOptions, runApp } from "./run-app.js";
```

The root `package.json` adds `"@dorothy/tui": "workspace:*"`.
`src/run-tui.ts` and `src/index.ts` import `runApp` and `editInEditor`
from `@dorothy/tui`.

- [ ] **Step 3: Install, check and commit**

Run: `bun install && bunx sync-header-metadata --update && bun run check`
Expected: PASS, three tests fewer than before (the boundary test's).

```bash
git add -A package.json bun.lock src packages
git commit -m "refactor(tui): Make the TUI a workspace package"
```

---

### Task 11: @dorothy/agent

**Files:**

- Move: `src/conversation.ts`, `src/conversation.test.ts`,
  `src/structured.ts`, `src/structured.test.ts`, `src/persona.ts`,
  `src/persona.test.ts`, `src/one-shot.ts`, `src/capture.ts`,
  `src/capture.test.ts` into `packages/agent/src/`
- Create: `packages/agent/package.json`, `packages/agent/src/index.ts`
- Modify: `package.json`, the remaining `src/` importers

- [ ] **Step 1: Move and declare**

```bash
mkdir -p packages/agent/src
git mv src/conversation.ts src/conversation.test.ts src/structured.ts \
    src/structured.test.ts src/persona.ts src/persona.test.ts \
    src/one-shot.ts src/capture.ts src/capture.test.ts \
    packages/agent/src/
```

`packages/agent/package.json`:

```json
{
    "name": "@dorothy/agent",
    "private": true,
    "type": "module",
    "exports": {
        ".": "./src/index.ts"
    },
    "dependencies": {
        "@anthropic-ai/claude-agent-sdk": "^0.3.283",
        "@dorothy/core": "workspace:*",
        "zod": "^4.6.5"
    }
}
```

`zod` is there because the Agent SDK takes it as a peer, which the
isolated linker resolves from the package that depends on the SDK. If
`bun install` reports no such peer, drop it.

`packages/agent/src/index.ts`:

```ts
// @dorothy/agent: Dorothy's model side, the only package that talks to
// the Agent SDK. A session, a structured call, her persona's prompts,
// the one-shot reply, and the request capture behind --dump-context.

export { type CaptureQueryFn, dumpRequest } from "./capture.js";
export {
    Conversation,
    conversationOptions,
    type SessionSetup,
} from "./conversation.js";
export { runOneShot } from "./one-shot.js";
export {
    type PersonaMode,
    personaPrompt,
    prepareCliHome,
    promptHash,
    systemPrompt,
} from "./persona.js";
export { structuredCall } from "./structured.js";
```

The root `package.json` adds `"@dorothy/agent": "workspace:*"`. In
`src/` (now only `index.ts`, `index.test.ts`, `dump.ts`, `dump.test.ts`,
`run-tui.ts`, `recall-launch.ts`, and memory's directories), point the
agent's names at `@dorothy/agent`. Memory's directories must need none:
if `tsc` finds one, the seam work missed it; fix it there, not with an
import.

- [ ] **Step 2: Install and probe the SDK**

Run: `bun install`
Expected: no unmet peer warning for the Agent SDK.

Run, from the root (whose package declares the agent):

```bash
bun -e 'const m = await import("@dorothy/agent");
console.log(Object.keys(m).sort().join(" "))'
```

Expected: the names exported above.

- [ ] **Step 3: Check and commit**

Run: `bunx sync-header-metadata --update && bun run check`
Expected: PASS.

```bash
git add -A package.json bun.lock src packages
git commit -m "refactor(agent): Make the agent a workspace package"
```

---

### Task 12: @dorothy/memory

**Files:**

- Move: `src/memory/`, `src/recall/`, `src/compaction/`, `src/history/`,
  `src/transcript.ts`, `src/transcript.test.ts`, `src/sqlite-lock.ts`
  into `packages/memory/src/`
- Create: `packages/memory/package.json`, `packages/memory/src/index.ts`,
  `packages/memory/src/recall-server.ts`,
  `packages/memory/src/commands.ts`
- Delete: the `boundary.test.ts` of `recall/`, `compaction/` and
  `history/`

- [ ] **Step 1: Move and declare**

```bash
mkdir -p packages/memory/src
git mv src/memory src/recall src/compaction src/history \
    src/transcript.ts src/transcript.test.ts src/sqlite-lock.ts \
    packages/memory/src/
git rm packages/memory/src/recall/boundary.test.ts \
    packages/memory/src/compaction/boundary.test.ts \
    packages/memory/src/history/boundary.test.ts
```

Find the externals as in Task 10 Step 1, over `packages/memory/src`.
Expected: `isomorphic-git`, `@modelcontextprotocol/sdk`, `zod`,
`@dotenvx/dotenvx`.

`packages/memory/package.json`:

```json
{
    "name": "@dorothy/memory",
    "private": true,
    "type": "module",
    "exports": {
        ".": "./src/index.ts",
        "./recall-server": "./src/recall-server.ts",
        "./commands": "./src/commands.ts"
    },
    "dependencies": {
        "@dorothy/core": "workspace:*",
        "@dotenvx/dotenvx": "^2.32.4",
        "@modelcontextprotocol/sdk": "^1.31.0",
        "isomorphic-git": "1.43.1",
        "zod": "^4.6.5"
    }
}
```

- [ ] **Step 2: Write the entry points**

`packages/memory/src/index.ts`:

```ts
// @dorothy/memory: her memory database. A chat opens it with
// openMemory; --dump-context previews a chat's start with previewStart.
// The recall server and the commands have entry points of their own, so
// that each process loads only what it runs.

export {
    type Memory,
    type MemoryPrompts,
    type OpenedMemory,
    type OpenMemoryOptions,
    openMemory,
} from "./memory/open.js";
export { type Preview, previewStart } from "./memory/preview.js";
```

`packages/memory/src/recall-server.ts`:

```ts
// @dorothy/memory/recall-server: dorothy --recall-server, which every
// chat session launches, loading the index and its queries alone.

export { runRecallServer } from "./recall/server.js";
```

`packages/memory/src/commands.ts`:

```ts
// @dorothy/memory/commands: the commands that read and edit memory and
// its history, each run once by a process of its own.

export { commandHistory, runCheck, runHistory, runMirror, runRecover,
    runRestore, runRollback } from "./history/commands.js";
export { runList, runMemoryEdit, runTags, runTagsEdit } from
    "./memory/commands.js";
```

(Biome formats these on `bun run format`; run it before the check.)

- [ ] **Step 3: Repoint the CLI**

The root `package.json` adds `"@dorothy/memory": "workspace:*"`. In
`src/index.ts`, every `await import("./memory/commands.js")` and
`await import("./history/commands.js")` becomes `await
import("@dorothy/memory/commands")`, and `./recall/server.js` becomes
`@dorothy/memory/recall-server`. `src/run-tui.ts` imports `openMemory`
from `@dorothy/memory`, and `src/dump.ts` imports `previewStart` from it.
`src/index.test.ts` and `src/dump.test.ts` import nothing from memory's
internals; if one does, it tests memory and moves into the package.

- [ ] **Step 4: Install, check and commit**

Run: `bun install && bun run format`, then
`bunx sync-header-metadata --update && bun run check`
Expected: PASS, with the three boundary tests' cases fewer.

```bash
git add -A package.json bun.lock src packages
git commit -m "refactor(memory): Make memory a workspace package"
```

---

### Task 13: @dorothy/cli, and src/ is gone

**Files:**

- Move: `src/index.ts`, `src/index.test.ts`, `src/dump.ts`,
  `src/dump.test.ts`, `src/run-tui.ts`, `src/recall-launch.ts` into
  `packages/cli/src/`
- Create: `packages/cli/package.json`
- Modify: `package.json`, `tsconfig.json`, `bunfig.toml`

- [ ] **Step 1: Move and declare**

```bash
mkdir -p packages/cli/src
git mv src/index.ts src/index.test.ts src/dump.ts src/dump.test.ts \
    src/run-tui.ts src/recall-launch.ts packages/cli/src/
test -z "$(git ls-files src)" && echo "src/ is empty"
```

`packages/cli/package.json`:

```json
{
    "name": "@dorothy/cli",
    "private": true,
    "type": "module",
    "dependencies": {
        "@dorothy/agent": "workspace:*",
        "@dorothy/core": "workspace:*",
        "@dorothy/memory": "workspace:*",
        "@dorothy/tui": "workspace:*",
        "@dotenvx/dotenvx": "^2.32.4"
    }
}
```

The root `package.json`'s `dependencies` become only
`"@dorothy/cli": "workspace:*"`; `devDependencies` keep every tool
except `@types/react` and `ink-testing-library`, now the TUI's.
`tsconfig.json`'s `include` drops `"src"`. In `bunfig.toml`, the comment
naming `src/index.ts` names `packages/cli/src/index.ts`.

- [ ] **Step 2: Install, check and commit**

Run: `bun install && bunx sync-header-metadata --update && bun run check`
Expected: PASS.

Run: `bun packages/cli/src/index.ts --help`
Expected: the usage text.

```bash
git add -A package.json bun.lock tsconfig.json bunfig.toml src packages
git commit -m "refactor(cli): Make the CLI a workspace package"
```

---

### Task 14: Pin the graph

**Files:**

- Create: `workspace.test.ts` at the root
- Modify: `tsconfig.json` (include it)

- [ ] **Step 1: Write the test**

`workspace.test.ts`:

```ts
// The workspace's shape, as the spec agreed it. The isolated linker
// enforces whatever the manifests declare; this keeps the manifests
// from drifting.

import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

type Manifest = {
    name: string;
    exports?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
};

const PACKAGES = join(import.meta.dir, "packages");

const GRAPH: Record<string, string[]> = {
    agent: ["core"],
    cli: ["agent", "core", "memory", "tui"],
    core: [],
    memory: ["core"],
    tui: ["core"],
};

const ENTRIES: Record<string, string[]> = {
    agent: ["."],
    cli: [],
    core: ["."],
    memory: [".", "./commands", "./recall-server"],
    tui: ["."],
};

const SDK = "@anthropic-ai/claude-agent-sdk";

const manifest = async (name: string): Promise<Manifest> =>
    Bun.file(join(PACKAGES, name, "package.json")).json();

const declared = (of: Manifest) => ({
    ...of.dependencies,
    ...of.devDependencies,
});

describe("the workspace", () => {
    it("holds exactly the agreed packages", () => {
        expect(readdirSync(PACKAGES).sort()).toEqual(Object.keys(GRAPH));
    });

    for (const name of Object.keys(GRAPH)) {
        it(`names ${name} @dorothy/${name}`, async () => {
            expect((await manifest(name)).name).toBe(`@dorothy/${name}`);
        });

        it(`gives ${name} its agreed packages`, async () => {
            const packages = Object.keys(declared(await manifest(name)))
                .filter((dependency) => dependency.startsWith("@dorothy/"))
                .map((dependency) => dependency.slice("@dorothy/".length))
                .sort();
            expect(packages).toEqual(GRAPH[name] as string[]);
        });

        it(`gives ${name} its agreed entry points`, async () => {
            const exports = (await manifest(name)).exports ?? {};
            expect(Object.keys(exports).sort()).toEqual(
                ENTRIES[name] as string[],
            );
            for (const target of Object.values(exports)) {
                expect(target).toEndWith(".ts");
                expect(existsSync(join(PACKAGES, name, target))).toBe(true);
            }
        });
    }

    it("leaves the Agent SDK to the agent", async () => {
        const holders: string[] = [];
        for (const name of Object.keys(GRAPH)) {
            if (SDK in declared(await manifest(name))) {
                holders.push(name);
            }
        }
        expect(holders).toEqual(["agent"]);
    });

    it("resolves only what a package declares, and only its doors", () => {
        const from = (name: string) => join(PACKAGES, name, "src");
        expect(() => Bun.resolveSync("@dorothy/core", from("memory"))).not
            .toThrow();
        expect(() =>
            Bun.resolveSync("@dorothy/memory/commands", from("cli")),
        ).not.toThrow();
        expect(() =>
            Bun.resolveSync("@dorothy/agent", from("memory")),
        ).toThrow();
        expect(() => Bun.resolveSync(SDK, from("memory"))).toThrow();
        expect(() => Bun.resolveSync(SDK, from("tui"))).toThrow();
        expect(() =>
            Bun.resolveSync("@dorothy/memory/src/memory/open.ts", from("cli")),
        ).toThrow();
    });
});
```

Add `"workspace.test.ts"` to `tsconfig.json`'s `include`.

- [ ] **Step 2: Run it**

Run: `bun test workspace.test.ts`
Expected: PASS. Then break it on purpose: add `"@dorothy/agent":
"workspace:*"` to `packages/memory/package.json`, run `bun install && bun
test workspace.test.ts`, see "gives memory its agreed packages" fail,
and revert both the manifest and the lockfile.

- [ ] **Step 3: Probe `tsc` the same way**

```bash
printf 'import "@dorothy/agent";\n' > packages/memory/src/probe.ts
bun run typecheck; echo "exit $?"
rm packages/memory/src/probe.ts
```

Expected: TS2307 "Cannot find module '@dorothy/agent'", exit 2. Repeat
with `import "@dorothy/memory/src/memory/open.ts";` in
`packages/cli/src/probe.ts`: the same error. Note both outputs in the
task report.

- [ ] **Step 4: Check and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add workspace.test.ts tsconfig.json
git commit -m "test(config): Pin the workspace's package graph"
```

---

### Task 15: Tooling

**Files:**

- Modify: `package.json`, `.commitlintrc.mts`, `.gitignore`
- Delete: `tsconfig.build.json`

- [ ] **Step 1: Scripts and the retired build**

In `package.json`'s `scripts`: delete `build`; `dev` and `start` become
`"bun packages/cli/src/index.ts"`.

```bash
git rm tsconfig.build.json
```

In `.gitignore`, delete the `/dist/` line, and `rm -rf dist` if one is
lying in the working tree (it is ignored, never tracked).

- [ ] **Step 2: Retire the `sdk` scope**

Delete the `sdk` entry from `.commitlintrc.mts`.

- [ ] **Step 3: Check and commit**

Run: `bun run check && bun run dev --help`
Expected: PASS, then the usage text.

```bash
git add -A package.json .gitignore .commitlintrc.mts tsconfig.build.json
git commit -m "chore(config): Retire the build and the sdk scope"
```

---

### Task 16: Documents

**Files:**

- Modify: `.claude/CLAUDE.md`, `README.md`, `docs/roadmap.md`

- [ ] **Step 1: CLAUDE.md**

Rewrite `.claude/CLAUDE.md`'s Architecture by package, keeping every fact
still true and its voice. It opens with the graph and the rules:

```markdown
Dorothy is five Bun workspace packages under `packages/`, each named
`@dorothy/<name>`. `core` holds the contracts the others meet on
(`ChatSession`, `SessionStart`, `StructuredCall`, the notices and the
editor) and the basics they share. `memory`, `agent` and `tui` depend on
`core` alone, never on each other; `cli` depends on all four and wires
them together. Each package exports only the entry points its
`package.json` names (`"."`, and memory's `./recall-server` and
`./commands`), and Bun's isolated linker resolves only what a package
declares, so an undeclared or internal import fails under Bun and `tsc`.
`workspace.test.ts` pins the graph.
```

Then a paragraph per package from today's text: memory's (catalogue,
recall, compaction, tags, history, now with `openMemory`, `sessionStart`
values, `wrap`ping by `createSession`, and transcript recording), the
agent's (persona, `Conversation`, `structuredCall`, the CLI home and the
context leak), the TUI's, and the CLI's (flags, modes, `runTui`,
`runDump`). Remove `dist/`, `src/` paths, `tsconfig.build.json` and the
boundary tests; paths become `packages/<name>/src/...`. Keep the auth,
dotenvx and `bunfig.toml` paragraphs, with `src/index.ts` as
`packages/cli/src/index.ts`.

- [ ] **Step 2: README and roadmap**

In `README.md`, development commands follow the scripts (`bun run dev`,
`bun run start`; no `build`). In `docs/roadmap.md`, follow its Revising
section: move Workspace Modularity to Done with links to the spec, the
plan and the report Task 17 writes, gather candidates from this work,
and add a Revisions line.

- [ ] **Step 3: Check and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add .claude/CLAUDE.md
git commit -m "ai: Describe Dorothy by package"
git add README.md docs/roadmap.md
git commit -m "docs: Record the workspace packages"
```

---

### Task 17: Launch probes and the report

Every probe runs under temporary XDG directories, never the user's.

**Files:**

- Create: `docs/reports/2026-10-09-workspace-modularity.md`

- [ ] **Step 1: Set up a throwaway home**

```bash
PROBE=$(mktemp -d)
export XDG_DATA_HOME=$PROBE/data XDG_CACHE_HOME=$PROBE/cache \
    XDG_CONFIG_HOME=$PROBE/config XDG_STATE_HOME=$PROBE/state
```

- [ ] **Step 2: The dump**

Run: `bun run dev --dump-context hello | head -20`
Expected: a JSON request body whose `system` starts with the chat
persona, and `mcpServers` naming the recall server with
`packages/cli/src/index.ts` as its script. This runs the Agent SDK's CLI
under the isolated linker and costs nothing (the API is a loopback
stand-in).

- [ ] **Step 3: The recall server's load time**

```bash
cat > "$PROBE/load.ts" <<'EOF'
const t = performance.now();
await import("@dorothy/memory/recall-server");
console.log(Math.round(performance.now() - t), "ms");
EOF
cp "$PROBE/load.ts" packages/cli/src/load-probe.ts
for i in 1 2 3; do bun packages/cli/src/load-probe.ts; done
rm packages/cli/src/load-probe.ts
```

Expected: about 90 ms each, as the server alone measured before; well
under the 290 ms all of memory took.

- [ ] **Step 4: A chat, and the hook**

With credentials available (`.env` decrypts), run `bun run dev`, wait
for the model's name in the header (the session is ready and the recall
server started), and quit with Ctrl+D without sending anything. Then:

```bash
cat "$XDG_DATA_HOME/dorothy/.git/hooks/pre-commit"
```

Expected: the hook names `packages/cli/src/index.ts`. To see it
rewritten, edit the path in it to `src/index.ts`, launch and quit again,
and read it back: the new path again.

- [ ] **Step 5: The commands**

Run: `bun run dev --list` and `bun run dev --history`
Expected: the catalogue (empty) and the probe's history, no errors.

- [ ] **Step 6: Write the report and clean up**

`docs/reports/2026-10-09-workspace-modularity.md`, in the house form (see
`docs/reports/2026-10-08-memory-history-implementation.md`): what was
built, the commits, the test count before and after with the retired
tests named, each probe's command and result, the rulings made during
execution, and known limitations.

```bash
rm -rf "$PROBE"
unset XDG_DATA_HOME XDG_CACHE_HOME XDG_CONFIG_HOME XDG_STATE_HOME
bun run check
git add docs/reports/2026-10-09-workspace-modularity.md
git commit -m "docs: Report the workspace packages"
```

## Rulings on the spec

- **Sessions come from a factory, not one session.** The spec's
  `wrap(session)` would wrap one session, but compaction starts a new
  `Conversation` for each pass and the screen starts one at each
  reconnect. `openMemory` therefore takes `connect(start)` and returns
  `createSession(turns)`, whose sessions are compacting, tracked and
  recorded. If wrong, only `Memory`'s shape changes.
- **`recallLaunch` belongs to the CLI.** Its flags are the CLI's, parsed
  in `index.ts`; memory receives it as an option.
- **Memory renders the earlier section, preamble included.** Compaction
  measures that section, so its text must be memory's; the persona keeps
  only `withSection`, which is in `core`.
- **`QUIT_GRACE_MS` is `CLOSE_GRACE_MS`.** The test that kept them equal
  across what become two packages is replaced by one constant in `core`.
- **Memory's surface is `openMemory` and `previewStart`.** The spec
  outlined `sessionStart`, `wrap` and `resume` on the handle; in the code
  the start is built inside (`startOf`) and handed to `connect`, the
  resumed turns come back as `Memory.history`, and the dump's start is
  `previewStart`, which opens no history. Nothing outside memory needed
  the finer methods.
- **The dump stays in the CLI.** The spec gave the agent a `dumpContext`;
  the agent exports `dumpRequest`, and `runDump`, which composes memory's
  preview with it, is the CLI's.
- **`runApp` takes App's props.** Rather than the spec's outline, it
  takes what `App` does, the editor defaulting to `$EDITOR`, plus an
  optional renderer for its tests.
- **`runReview`'s SDK-level tests are retired, not moved.**
  `structuredCall`'s tests already cover what they tested.

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
