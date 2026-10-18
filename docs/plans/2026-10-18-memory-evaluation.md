---
ctime: 2026-10-19
mtime: 2026-10-19
spdx: GPL-3.0-only
title: Dorothy's memory evaluation implementation plan
description: >-
  Task-by-task plan for the memory evaluation: an evaluation entry point
  in memory, the @dorothy/eval package with its snapshot, questions mined,
  generated and reviewed, three systems, models through ChatOpenAI and
  openevals, a resumable runner, and its report.
tags:
  - dorothy
  - memory
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-18-memory-evaluation.md
   -
   -->

# Dorothy's memory evaluation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `subagent-driven-development` to carry out this plan task by task, one
> subagent at a time, never in parallel. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** measure Dorothy's memory on questions drawn from her own data,
so the engine spec can choose what sits behind the contract.

**Architecture:** `memory` gains one entry point,
`@dorothy/memory/evaluation`, which opens an archive (the baseline
engine over an environment's roots, and plain records of its
conversations, knowledge and appraised reads). A new package,
`@dorothy/eval`, run with `bun run eval`, snapshots a data directory,
mines and generates questions, has the owner review them, asks them of
three systems through one interface, answers and judges with models
over OpenAI-compatible Chat Completions (`@langchain/openai`, openevals),
and reports.

**Tech Stack:** Bun 1.4, TypeScript (strict, `nodenext`), `bun:test`,
zod 4, `@langchain/openai` 1.6, `@langchain/core` 1.2, openevals 0.2,
Biome.

**Spec:** [the evaluation's design](../specs/2026-10-18-memory-evaluation-design.md).
Read it before any task.

## Global Constraints

- Every new file carries the house header, copied from a sibling: for a
  `.ts` file the `vim:set` line, the SPDX line and the breadcrumb
  (`// ::: :/<path from the repository root>`); JSON files carry none.
- Imports end in `.js`, as `nodenext` resolves them; a package imports
  only what its `package.json` declares, and only declared entry points.
- `@dorothy/eval` depends on `@dorothy/core` and `@dorothy/memory`
  alone of the `@dorothy` packages, and nothing depends on it.
- Tests never read a real data directory (`$XDG_DATA_HOME/dorothy`) or
  cache: every root is made under `mkdtempSync(join(tmpdir(), ...))`
  and removed after. No test reaches the network: models are a stub
  server on `127.0.0.1`, port 0.
- No key is ever written to a file, a log, a record, a report or an
  error message; a key is named only by its variable.
- Commits: Conventional Commits, header at most 50 characters, body lines
  at most 72, no agent trailers, no em dash anywhere. Scopes: `memory`,
  `eval`, `config`, `docs`. Run `bunx biome check --write <paths>` before
  each commit.
- Markdown prose lines at most 80 characters; no em dash.
- `packages/memory/AGENTS.md` is at its 150-line budget, the root
  `AGENTS.md` at its 100: an edit replaces lines, never adds them.
- Run the task's tests while working, and `bun run check` before the
  task's last commit; it must pass.

## Review Focus

1. A `questions.jsonl` with a malformed line: `mine`, `generate` and
   `review` refuse, naming the line, and write nothing; `run` skips it
   with a warning. Tests: Task 3, Task 4.
2. A key pasted into `eval.toml` where a variable's name belongs: refused,
   and the message never repeats the value. Test: Task 5.
3. A work directory inside the data directory, or the reverse: refused
   before anything is copied. Test: Task 2.
4. A model that answers 429 with no headers, or a 5xx: retried twice,
   then recorded as a failure while the run goes on. Tests: Task 5,
   Task 10.
5. A run stopped by `--max-calls` and resumed: no question and system
   asked twice, and no duplicate record. Test: Task 10.

## Files

```text
packages/memory/src/evaluation.ts          entry point (Task 1)
packages/memory/src/engine/archive.ts      openArchive (Task 1)
packages/memory/src/engine/fixture.ts      writeArchive, for tests (Task 1)
packages/eval/package.json                 (Task 2; deps in Task 5)
packages/eval/AGENTS.md                    the package's guide (Task 2, then each task)
packages/eval/src/main.ts                  process entry (Task 2)
packages/eval/src/cli.ts                   command table, runCli (Task 2, then each command)
packages/eval/src/command.ts               Io, Command, option helpers (Task 2)
packages/eval/src/errors.ts                EvalError (Task 2)
packages/eval/src/testing.ts               fakeIo, fixtures, stub server (Tasks 2, 5)
packages/eval/src/snapshot/snapshot.ts     takeSnapshot, readSnapshot, workEnv (Task 2)
packages/eval/src/snapshot/command.ts      snapshot (Task 2)
packages/eval/src/questions/file.ts        the question file (Task 3)
packages/eval/src/questions/mine.ts        lookups, mine (Task 4)
packages/eval/src/models/config.ts         eval.toml (Task 5)
packages/eval/src/models/client.ts         Models (Task 5)
packages/eval/src/systems/corpus.ts        Corpus, texts, passage (Task 6)
packages/eval/src/systems/terms.ts         termsOf, scoreOf (Task 6)
packages/eval/src/systems/system.ts        System, makeSystem, packItems (Task 6)
packages/eval/src/systems/dorothy.ts       (Task 6)
packages/eval/src/systems/lexical.ts       (Task 6)
packages/eval/src/systems/full.ts          (Task 6)
packages/eval/src/questions/generate.ts    generation (Task 7)
packages/eval/src/questions/generate-command.ts  generate (Task 7)
packages/eval/src/questions/review.ts      review (Task 8)
packages/eval/src/run/record.ts            RunRecord, RunInfo, paths (Task 9)
packages/eval/src/report/summary.ts        summarise (Task 9)
packages/eval/src/report/markdown.ts       report, compare (Task 9)
packages/eval/src/report/command.ts        compare (Task 9)
packages/eval/src/run/judges.ts            prompts and judges (Task 10)
packages/eval/src/run/run.ts               runEvaluation (Task 10)
packages/eval/src/run/command.ts           run (Task 10)
```

Each `.ts` file has a `.test.ts` beside it where it holds logic.

---

### Task 1: the archive, through `@dorothy/memory/evaluation`

**Files:**

- Create: `packages/memory/src/engine/archive.ts`
- Create: `packages/memory/src/engine/fixture.ts`
- Create: `packages/memory/src/engine/archive.test.ts`
- Create: `packages/memory/src/evaluation.ts`
- Modify: `packages/memory/package.json` (exports)
- Modify: `workspace.test.ts` (memory's entries)
- Modify: `packages/memory/AGENTS.md:43` (one line, no more)
- Modify: `packages/memory/src/contract/AGENTS.md` (a short section)

**Interfaces:**

- Consumes: `baselineEngine`, `knowledgePath` (`engine/baseline.ts`);
  `buildBlock` (`contract/block.ts`); `RecallIndex`, `indexPath`
  (`recall/store.ts`); `keywordsOf`, `vocabularyBroken`
  (`recall/tags.ts`); `listFacts`, `putFact`, `dataRoot`, `PERSONAL`
  (`facts/store.ts`); `readTranscript`, `transcriptDir`,
  `transcriptPath` (`transcript.ts`); `EMPTY_SIDECAR`, `updateSidecar`,
  `Served` (`memory/sidecar.ts`); `conversationId`, `knowledgeId`,
  `newPhrase`, `DEFAULT_CONFIG`, `Env` (`@dorothy/core`).
- Produces, from `@dorothy/memory/evaluation`:
  - `openArchive(env: Env, options?: { now?: () => number }):
    Promise<Archive>`
  - `type Archive = { engine: MemoryEngine; block(request: { project:
    string | null; budget: number; exclude: string | null }): Promise<{
    text: string; ids: string[] }>; conversations():
    ArchiveConversation[]; knowledge(): Promise<ArchiveKnowledge[]>;
    appraisedReads(): Promise<AppraisedRead[]>; close(): void }`
  - `type ArchiveConversation = { id: string; phrase: string; project:
    string | null; title: string | null; tags: string[]; firstAt:
    string; lastAt: string; turns: ArchiveTurn[] }`
  - `type ArchiveTurn = { n: number; role: "user" | "assistant"; at:
    string; text: string }`
  - `type ArchiveKnowledge = { id: string; scope: string; type: string;
    title: string; description: string; body: string; at: string;
    retired: { at: string; why: string } | null }` (`scope` is
    `"personal"` or a project's id)
  - `type AppraisedRead = { reader: string; target: string; purpose:
    string; served: "useful" | "essential"; at: string }` (`target` a
    contract id)
  - `writeArchive(env: Env, fixture: ArchiveFixture): Promise<void>`
    and `fixturePhrase(seed: number): string`, for tests
  - `type ArchiveFixture = { conversations: FixtureConversation[];
    knowledge: FixtureKnowledge[] }`, as defined in Step 3
  - `type MemoryEngine`, re-exported

- [ ] **Step 1: Write the fixture writer**

`packages/memory/src/engine/fixture.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/engine/fixture.ts
//
//

// A small archive written as Dorothy writes hers, for the tests of the
// memory evaluation: transcripts with their sidecars, appraised reads,
// and knowledge files. Every path comes from the environment given.

import { mkdirSync, writeFileSync } from "node:fs";
import { type Env, newPhrase } from "@dorothy/core";
import type { FactType } from "../facts/file.js";
import { dataRoot, PERSONAL, putFact } from "../facts/store.js";
import { EMPTY_SIDECAR, type Served, updateSidecar } from "../memory/sidecar.js";
import { transcriptDir, transcriptPath } from "../transcript.js";

export type FixtureRead = {
    id: string;
    // A conversation's phrase, or a fact as recall names it:
    // personal/<name> or <project id>/<name>.
    target: { conversation: string } | { fact: string };
    purpose: string;
    served: Served;
};
export type FixtureConversation = {
    phrase: string;
    project?: string | null;
    title?: string | null;
    hidden?: boolean;
    turns: { role: "user" | "assistant"; text: string; at: string }[];
    // Opens made before the first reply, and how her review judged each.
    reads?: FixtureRead[];
};
export type FixtureKnowledge = {
    // "personal", or a project's id.
    scope: string;
    name: string;
    title: string;
    description?: string;
    type?: FactType;
    body: string;
    at: string;
    retired?: { at: string; why: string };
};
export type ArchiveFixture = {
    conversations: FixtureConversation[];
    knowledge: FixtureKnowledge[];
};

// A valid phrase, the same for the same seed.
export const fixturePhrase = (seed: number) =>
    newPhrase((size) => Uint8Array.from({ length: size }, () => seed));

const line = (at: string, kind: string, fields: object) =>
    `${JSON.stringify({ v: 1, kind, at, ...fields })}\n`;

function transcriptOf(conversation: FixtureConversation): string {
    const first = conversation.turns[0]?.at ?? "2026-01-01T00:00:00.000Z";
    const project = conversation.project ?? null;
    let text = line(first, "session", {
        phrase: conversation.phrase,
        sdkSessionId: "",
        model: "fixture",
        promptHash: "",
        resumed: false,
        ...(project === null ? {} : { project }),
    });
    let read = false;
    for (const turn of conversation.turns) {
        if (turn.role === "assistant" && !read) {
            read = true;
            for (const each of conversation.reads ?? []) {
                text += line(turn.at, "recall", {
                    id: each.id,
                    ok: true,
                    offset: 0,
                    tool: "open",
                    ...each.target,
                    name: "fixture",
                    purpose: each.purpose,
                    turns: null,
                });
            }
        }
        text +=
            turn.role === "user"
                ? line(turn.at, "user", { text: turn.text })
                : line(turn.at, "assistant", {
                      text: turn.text,
                      interrupted: false,
                  });
    }
    return text;
}

export async function writeArchive(
    env: Env,
    fixture: ArchiveFixture,
): Promise<void> {
    const dir = transcriptDir(env);
    mkdirSync(dir, { recursive: true });
    for (const conversation of fixture.conversations) {
        writeFileSync(
            transcriptPath(conversation.phrase, env),
            transcriptOf(conversation),
        );
        const at = conversation.turns.at(-1)?.at ?? "2026-01-01T00:00:00.000Z";
        await updateSidecar(dir, conversation.phrase, () => ({
            ...EMPTY_SIDECAR,
            title: conversation.title ?? null,
            hidden: conversation.hidden ?? false,
            appraisals: Object.fromEntries(
                (conversation.reads ?? []).map((each) => [
                    each.id,
                    { served: each.served, at, model: "fixture" },
                ]),
            ),
        }));
    }
    for (const knowledge of fixture.knowledge) {
        await putFact(
            dataRoot(env),
            knowledge.scope === "personal"
                ? PERSONAL
                : { kind: "project", id: knowledge.scope },
            {
                name: knowledge.name,
                title: knowledge.title,
                description: knowledge.description ?? `About ${knowledge.title}.`,
                type: knowledge.type ?? "user",
                extra: {},
                tags: [],
                importance: null,
                provenance: {
                    origin: "user",
                    by: "user",
                    at: knowledge.at,
                    created: knowledge.at,
                },
                retired:
                    knowledge.retired === undefined
                        ? null
                        : { ...knowledge.retired, by: "user" },
                body: knowledge.body,
            },
        );
    }
}
```

If `updateSidecar`'s change function or `putFact`'s return differs from
what this assumes, read `contract/tools.test.ts:262-290`, which calls
both the same way, and match it.

- [ ] **Step 2: Write the failing test**

`packages/memory/src/engine/archive.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/engine/archive.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Archive, openArchive } from "./archive.js";
import { fixturePhrase, writeArchive } from "./fixture.js";

let root: string;
let env: Record<string, string>;
let archive: Archive | null = null;
const [tea, reader, secret] = [
    fixturePhrase(1),
    fixturePhrase(2),
    fixturePhrase(3),
];
const at = "2026-10-15T09:30:00.000Z";

beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "dorothy-archive-"));
    env = {
        HOME: root,
        XDG_DATA_HOME: join(root, "data"),
        XDG_CACHE_HOME: join(root, "cache"),
        XDG_STATE_HOME: join(root, "state"),
        XDG_CONFIG_HOME: join(root, "config"),
    };
    await writeArchive(env, {
        conversations: [
            {
                phrase: tea,
                project: "github.com/me/app",
                title: "Tea",
                turns: [
                    { role: "user", text: "I like green tea.", at },
                    { role: "assistant", text: "Noted.", at },
                ],
            },
            {
                phrase: reader,
                title: "Asking",
                turns: [
                    { role: "user", text: "What tea do I like?", at },
                    { role: "assistant", text: "Green tea.", at },
                ],
                reads: [
                    {
                        id: "t1",
                        target: { conversation: tea },
                        purpose: "which tea the user likes",
                        served: "essential",
                    },
                    {
                        id: "t2",
                        target: { fact: "personal/likes-tea" },
                        purpose: "the user's tea",
                        served: "useful",
                    },
                    {
                        id: "t3",
                        target: { conversation: tea },
                        purpose: "an idle look",
                        served: "none",
                    },
                ],
            },
            {
                phrase: secret,
                hidden: true,
                turns: [{ role: "user", text: "Hidden.", at }],
            },
        ],
        knowledge: [
            {
                scope: "personal",
                name: "likes-tea",
                title: "Likes tea",
                body: "The user likes green tea.",
                at,
            },
            {
                scope: "personal",
                name: "likes-coffee",
                title: "Likes coffee",
                body: "The user likes coffee.",
                at,
                retired: { at, why: "No longer true." },
            },
        ],
    });
    archive = await openArchive(env, { now: () => Date.parse(at) });
});
afterEach(() => {
    archive?.close();
    archive = null;
    rmSync(root, { recursive: true, force: true });
});

describe("an archive", () => {
    it("lists the visible conversations with their turns", () => {
        const found = archive?.conversations() ?? [];
        expect(found.map((each) => each.id).sort()).toEqual(
            [`c:${tea}`, `c:${reader}`].sort(),
        );
        const first = found.find((each) => each.phrase === tea);
        expect(first?.project).toBe("github.com/me/app");
        expect(first?.title).toBe("Tea");
        expect(first?.turns.map((turn) => [turn.role, turn.text])).toEqual([
            ["user", "I like green tea."],
            ["assistant", "Noted."],
        ]);
        expect(first?.turns[0]?.at).toBe(at);
    });

    it("lists knowledge, the retired included", async () => {
        const found = (await archive?.knowledge()) ?? [];
        const byId = new Map(found.map((each) => [each.id, each]));
        expect(byId.get("k:personal/likes-tea")?.retired).toBeNull();
        expect(byId.get("k:personal/likes-tea")?.scope).toBe("personal");
        expect(byId.get("k:personal/likes-coffee")?.retired?.why).toBe(
            "No longer true.",
        );
    });

    it("gives the reads appraised useful or essential, with purposes", async () => {
        expect(await archive?.appraisedReads()).toEqual([
            {
                reader,
                target: `c:${tea}`,
                purpose: "which tea the user likes",
                served: "essential",
                at,
            },
            {
                reader,
                target: "k:personal/likes-tea",
                purpose: "the user's tea",
                served: "useful",
                at,
            },
        ]);
    });

    it("builds the opening block from live knowledge", async () => {
        const block = await archive?.block({
            project: null,
            budget: 8000,
            exclude: null,
        });
        expect(block?.ids).toContain("k:personal/likes-tea");
        expect(block?.ids).not.toContain("k:personal/likes-coffee");
        expect(block?.text).toContain("<memory>");
    });

    it("searches through its engine", async () => {
        const hits = await archive?.engine.search({
            query: "green tea",
            within: "all",
            kind: "all",
            limit: 10,
            project: null,
        });
        expect(hits?.map((hit) => hit.id)).toContain(`c:${tea}`);
    });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `bun test packages/memory/src/engine/archive.test.ts`
Expected: FAIL, "Cannot find module './archive.js'".

- [ ] **Step 4: Write the archive**

`packages/memory/src/engine/archive.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/engine/archive.ts
//
//

// The archive as the memory evaluation reads it: the baseline engine over
// an environment's roots, and the conversations, knowledge and appraised
// reads it holds, as plain records. It writes only the recall index,
// where the environment points.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
    conversationId,
    DEFAULT_CONFIG,
    type Env,
    knowledgeId,
} from "@dorothy/core";
import { buildBlock } from "../contract/block.js";
import { dataRoot, listFacts } from "../facts/store.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { keywordsOf, vocabularyBroken } from "../recall/tags.js";
import { readTranscript, transcriptPath } from "../transcript.js";
import { baselineEngine, knowledgePath } from "./baseline.js";
import type { MemoryEngine } from "./engine.js";

export type ArchiveTurn = {
    n: number;
    role: "user" | "assistant";
    at: string;
    text: string;
};
export type ArchiveConversation = {
    id: string;
    phrase: string;
    project: string | null;
    title: string | null;
    // Her concepts' labels.
    tags: string[];
    firstAt: string;
    lastAt: string;
    turns: ArchiveTurn[];
};
export type ArchiveKnowledge = {
    id: string;
    // "personal", or the project's id.
    scope: string;
    type: string;
    title: string;
    description: string;
    body: string;
    at: string;
    retired: { at: string; why: string } | null;
};
// A read her review judged useful or essential: her purpose, and what
// she opened for it, as a contract id.
export type AppraisedRead = {
    reader: string;
    target: string;
    purpose: string;
    served: "useful" | "essential";
    at: string;
};
export type Archive = {
    engine: MemoryEngine;
    block(request: {
        project: string | null;
        budget: number;
        exclude: string | null;
    }): Promise<{ text: string; ids: string[] }>;
    conversations(): ArchiveConversation[];
    knowledge(): Promise<ArchiveKnowledge[]>;
    appraisedReads(): Promise<AppraisedRead[]>;
    close(): void;
};

type ConversationRow = {
    phrase: string;
    project: string | null;
    title: string | null;
    first_at: number;
    last_at: number;
};
type TurnRow = { n: number; role: "user" | "assistant"; at: number; text: string };
type ReadRow = {
    id: string;
    reader: string;
    target: string;
    at: number;
    served: "useful" | "essential";
};

const iso = (ms: number) => new Date(ms).toISOString();

// The purpose of each open in a transcript, by its tool call's id.
async function purposesOf(path: string): Promise<Map<string, string>> {
    const byId = new Map<string, string>();
    try {
        const { turns } = await readTranscript(path);
        for (const turn of turns) {
            for (const lookup of turn.lookups ?? []) {
                if (lookup.tool === "open") {
                    byId.set(lookup.id, lookup.purpose);
                }
            }
        }
    } catch {
        // A transcript gone since the index was built has no purposes.
    }
    return byId;
}

export async function openArchive(
    env: Env,
    options: { now?: () => number } = {},
): Promise<Archive> {
    mkdirSync(dirname(indexPath(env)), { recursive: true, mode: 0o700 });
    const index = RecallIndex.open(indexPath(env));
    const engine = baselineEngine({
        env,
        index,
        halfLifeDays: DEFAULT_CONFIG.memory.halfLifeDays,
        reviewer: null,
        now: options.now,
    });
    try {
        await engine.index();
    } catch (error) {
        index.close();
        throw error;
    }
    const isConversation = (phrase: string) =>
        index.db
            .query("SELECT 1 FROM conversations WHERE phrase = ?")
            .get(phrase) !== null;
    // A fact as recall names it, personal/<name> or <project>/<name>.
    const targetOf = (target: string) =>
        isConversation(target)
            ? conversationId(target)
            : knowledgeId(
                  target.startsWith("personal/")
                      ? target
                      : `projects/${target}`,
              );
    return {
        engine,
        async block(request) {
            const response = await buildBlock(request, engine);
            return {
                text: response.text,
                ids: response.items.map((item) => item.id),
            };
        },
        conversations() {
            const labelled = vocabularyBroken(index) === null;
            const rows = index.db
                .query(
                    `SELECT phrase, project, title, first_at, last_at
                     FROM conversations
                     WHERE hidden = 0 AND first_at IS NOT NULL
                     ORDER BY first_at, phrase`,
                )
                .all() as ConversationRow[];
            const turns = index.db.query(
                "SELECT n, role, at, text FROM turns WHERE phrase = ? ORDER BY n",
            );
            return rows.map((row) => ({
                id: conversationId(row.phrase),
                phrase: row.phrase,
                project: row.project,
                title: row.title,
                tags: labelled ? keywordsOf(index, row.phrase) : [],
                firstAt: iso(row.first_at),
                lastAt: iso(row.last_at),
                turns: (turns.all(row.phrase) as TurnRow[]).map((turn) => ({
                    n: turn.n,
                    role: turn.role,
                    at: iso(turn.at),
                    text: turn.text,
                })),
            }));
        },
        async knowledge() {
            const { facts } = await listFacts(dataRoot(env));
            return facts.map(({ scope, fact }) => ({
                id: knowledgeId(knowledgePath(scope, fact.name)),
                scope: scope.kind === "personal" ? "personal" : scope.id,
                type: fact.type,
                title: fact.title,
                description: fact.description,
                body: fact.body,
                at: fact.provenance.at,
                retired:
                    fact.retired === null
                        ? null
                        : { at: fact.retired.at, why: fact.retired.why },
            }));
        },
        async appraisedReads() {
            const rows = index.db
                .query(
                    `SELECT r.id, r.reader, r.target, r.at, a.served
                     FROM reads r
                     JOIN appraisals a ON a.reader = r.reader AND a.id = r.id
                     WHERE a.served IN ('useful', 'essential')
                     ORDER BY r.at, r.id`,
                )
                .all() as ReadRow[];
            const purposes = new Map<string, Map<string, string>>();
            const found: AppraisedRead[] = [];
            for (const row of rows) {
                let byId = purposes.get(row.reader);
                if (byId === undefined) {
                    byId = await purposesOf(transcriptPath(row.reader, env));
                    purposes.set(row.reader, byId);
                }
                const purpose = byId.get(row.id);
                if (purpose === undefined) {
                    continue;
                }
                found.push({
                    reader: row.reader,
                    target: targetOf(row.target),
                    purpose,
                    served: row.served,
                    at: iso(row.at),
                });
            }
            return found;
        },
        close() {
            index.close();
        },
    };
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `bun test packages/memory/src/engine/archive.test.ts`
Expected: PASS, 5 tests. If the reads come back empty, check with
`sqlite3` on the test's index that `reads` and `appraisals` hold rows:
`recall/sync.ts:336-346` and `:408-414` fill them from the transcript's
recall events and the sidecar's appraisals.

- [ ] **Step 6: Add the entry point**

`packages/memory/src/evaluation.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/evaluation.ts
//
//

// What the memory evaluation (@dorothy/eval) reads of an archive: the
// baseline engine over an environment, and the conversations, knowledge
// and appraised reads it holds; and a writer of small archives for its
// tests.

export {
    type AppraisedRead,
    type Archive,
    type ArchiveConversation,
    type ArchiveKnowledge,
    type ArchiveTurn,
    openArchive,
} from "./engine/archive.js";
export type { MemoryEngine } from "./engine/engine.js";
export {
    type ArchiveFixture,
    type FixtureConversation,
    type FixtureKnowledge,
    type FixtureRead,
    fixturePhrase,
    writeArchive,
} from "./engine/fixture.js";
```

In `packages/memory/package.json`, add to `exports`, after
`"./bridge"`:

```json
        "./evaluation": "./src/evaluation.ts"
```

In `workspace.test.ts`, memory's `ENTRIES` becomes:

```ts
    memory: [
        ".",
        "./bridge",
        "./claude-hook",
        "./client",
        "./commands",
        "./evaluation",
        "./recall-server",
        "./service",
    ],
```

- [ ] **Step 7: Document it within the budgets**

In `packages/memory/AGENTS.md`, replace line 43:

```markdown
  `"./service"`, `"./client"`, `"./bridge"`: [the contract's guide](./src/contract/AGENTS.md).
```

with:

```markdown
  `"./service"`, `"./client"`, `"./bridge"`, `"./evaluation"`: [the contract's guide](./src/contract/AGENTS.md).
```

Then check: `wc -l packages/memory/AGENTS.md` prints 150.

At the end of `packages/memory/src/contract/AGENTS.md`, add:

```markdown

## The evaluation's door

`"./evaluation"` (`src/evaluation.ts`) is for `@dorothy/eval` alone:
`openArchive` opens the baseline engine over an environment's roots and
lists its conversations, knowledge and appraised reads as plain
records; `writeArchive` writes a small archive for its tests. It writes
only the recall index, where the environment points.
```

- [ ] **Step 8: Check and commit**

Run: `bun test packages/memory workspace.test.ts agents.test.ts`
Expected: PASS.

Run: `bun run check`
Expected: exit 0.

```bash
bunx biome check --write packages/memory/src/engine packages/memory/src/evaluation.ts workspace.test.ts
git add packages/memory workspace.test.ts
git commit -m "feat(memory): Open the archive for the evaluation" \
  -m "A new entry point, @dorothy/memory/evaluation, gives the baseline
engine over an environment and the conversations, knowledge and
appraised reads it holds, with a writer of small archives for tests."
```

---

### Task 2: the eval package and its snapshot

**Files:**

- Create: `packages/eval/package.json`
- Create: `packages/eval/AGENTS.md`
- Create: `packages/eval/src/errors.ts`
- Create: `packages/eval/src/command.ts`
- Create: `packages/eval/src/cli.ts`
- Create: `packages/eval/src/main.ts`
- Create: `packages/eval/src/testing.ts`
- Create: `packages/eval/src/snapshot/snapshot.ts`
- Create: `packages/eval/src/snapshot/command.ts`
- Test: `packages/eval/src/snapshot/snapshot.test.ts`
- Test: `packages/eval/src/cli.test.ts`
- Modify: `package.json` (root: the `eval` script)
- Modify: `workspace.test.ts` (the graph, entries and a resolve check)
- Modify: `.commitlintrc.mts` (the `eval` scope)
- Modify: `AGENTS.md` (root: the package paragraph, same line count)

**Interfaces:**

- Consumes: `writeArchive`, `fixturePhrase`, `ArchiveFixture` from
  `@dorothy/memory/evaluation` (Task 1); `Env` from `@dorothy/core`.
- Produces:
  - `class EvalError extends Error` (`errors.ts`)
  - `type Io = { env: Env; out(text: string): void; err(text: string):
    void; ask(prompt: string): Promise<string | null>; edit(path:
    string): Promise<void> }` (`command.ts`)
  - `type Values = Record<string, string | boolean | string[] |
    undefined>`; `type Command = { summary: string; options: Options;
    run(values: Values, positionals: string[], io: Io): Promise<number>
    }`; `type Options` (`command.ts`)
  - `workOf(values: Values): string` (absolute; EvalError if absent),
    `stringOf(values, name): string | null`, `intOf(values, name,
    fallback, min, max): number` (`command.ts`)
  - `COMMANDS: Record<string, Command>`, `runCli(argv: string[], io:
    Io): Promise<number>`, `usage(): string` (`cli.ts`)
  - `type SnapshotInfo = { source: string; at: string; conversations:
    number; knowledge: number }`; `takeSnapshot(from: string, work:
    string, options?: { replace?: boolean; now?: () => Date }):
    Promise<SnapshotInfo>`; `readSnapshot(work: string):
    Promise<SnapshotInfo>`; `workEnv(work: string): Env`;
    `snapshotDir(work: string): string` (`snapshot/snapshot.ts`)
  - From `testing.ts`: `fakeIo(options?: { env?: Env; answers?:
    string[]; onEdit?: (path: string) => void }): { io: Io; out:
    string[]; err: string[] }`; `tempRoot(prefix: string): { root:
    string; remove(): void }`; `FIXTURE: ArchiveFixture` and its
    phrases `TEA`, `GARDEN`, `BIKE`, `READER`; `writeFixtureData(root:
    string): Promise<string>` (returns the data directory);
    `snapshotFixture(root: string): Promise<string>` (returns the work
    directory, snapshot taken)

- [ ] **Step 1: Make the package**

`packages/eval/package.json`:

```json
{
    "name": "@dorothy/eval",
    "private": true,
    "type": "module",
    "dependencies": {
        "@dorothy/core": "workspace:*",
        "@dorothy/memory": "workspace:*",
        "zod": "^4.6.7"
    }
}
```

In the root `package.json`'s `scripts`, after `"dev"`, add:

```json
        "eval": "bun packages/eval/src/main.ts",
```

In `.commitlintrc.mts`, after the `cli` scope, add:

```ts
        {
            name: "eval",
            fullName: "Eval",
            description: "The memory evaluation, ie. packages/eval/",
        },
```

In `workspace.test.ts`, add `eval: ["core", "memory"],` to `GRAPH`
after `core`, `eval: [],` to `ENTRIES` after `core`, and inside the
"resolves only what a package declares" test, before its closing:

```ts
        expect(() =>
            Bun.resolveSync("@dorothy/memory/evaluation", from("eval")),
        ).not.toThrow();
        expect(() =>
            Bun.resolveSync("@dorothy/agent", from("eval")),
        ).toThrow();
```

Run: `bun install`
Expected: it links `@dorothy/eval`, with no error.

In the root `AGENTS.md`, replace the seven lines from "Seven Bun
workspace packages" to "linker fails an undeclared or internal import
under Bun and `tsc`." with these seven:

```markdown
Eight Bun workspace packages under `packages/`, each `@dorothy/<name>`.
`core` holds the contracts the others meet on, `identity` who Dorothy is;
`memory` and `tui` depend on `core` alone, `agent` and `gateway` on it
and `identity`, never on each other, `eval` on `core` and `memory`; `cli`
on all but `identity` and `eval`, and wires them. A package exports only
the entry points its `package.json` names and imports only what it
declares, as Bun's isolated linker fails an undeclared or internal import.
```

Then check: `wc -l AGENTS.md` prints 100.

- [ ] **Step 2: Write the shared pieces**

`packages/eval/src/errors.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/errors.ts
//
//

// A failure the user can mend, said in one line: what is wrong and what
// to run or set. Anything else is a fault and keeps its stack.
export class EvalError extends Error {}
```

`packages/eval/src/command.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/command.ts
//
//

// What every command meets: the terminal, passed in so tests can play
// it, and the options' readers.

import { resolve } from "node:path";
import type { Env } from "@dorothy/core";
import { EvalError } from "./errors.js";

export type Io = {
    env: Env;
    out(text: string): void;
    err(text: string): void;
    // A line typed at the terminal; null at the end of its input.
    ask(prompt: string): Promise<string | null>;
    // Opens the editor on a file and waits for it to close.
    edit(path: string): Promise<void>;
};
export type Options = Record<
    string,
    { type: "string" | "boolean"; multiple?: boolean }
>;
export type Values = Record<string, string | boolean | string[] | undefined>;
export type Command = {
    summary: string;
    options: Options;
    run(values: Values, positionals: string[], io: Io): Promise<number>;
};

export function stringOf(values: Values, name: string): string | null {
    const value = values[name];
    return typeof value === "string" && value !== "" ? value : null;
}

// The work directory, which every command needs, made absolute.
export function workOf(values: Values): string {
    const work = stringOf(values, "work");
    if (work === null) {
        throw new EvalError("give --work, the evaluation's directory");
    }
    return resolve(work);
}

export function intOf(
    values: Values,
    name: string,
    fallback: number,
    min: number,
    max: number,
): number {
    const text = stringOf(values, name);
    if (text === null) {
        return fallback;
    }
    const value = Number(text);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new EvalError(
            `--${name} must be a whole number from ${min} to ${max}`,
        );
    }
    return value;
}
```

- [ ] **Step 3: Write the snapshot's failing tests**

`packages/eval/src/testing.ts` (later tasks add to it):

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/testing.ts
//
//

// What the evaluation's tests share: a terminal to play, temporary roots,
// and one small archive with a snapshot of it. Nothing here reads a real
// data directory.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env } from "@dorothy/core";
import {
    type ArchiveFixture,
    fixturePhrase,
    writeArchive,
} from "@dorothy/memory/evaluation";
import type { Io } from "./command.js";
import { takeSnapshot } from "./snapshot/snapshot.js";

export function fakeIo(
    options: {
        env?: Env;
        answers?: string[];
        onEdit?: (path: string) => void;
    } = {},
): { io: Io; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    const answers = [...(options.answers ?? [])];
    return {
        out,
        err,
        io: {
            env: options.env ?? {},
            out: (text) => out.push(text),
            err: (text) => err.push(text),
            ask: async (prompt) => {
                out.push(prompt);
                return answers.shift() ?? null;
            },
            edit: async (path) => options.onEdit?.(path),
        },
    };
}

export function tempRoot(prefix: string): { root: string; remove(): void } {
    const root = mkdtempSync(join(tmpdir(), `dorothy-${prefix}-`));
    return {
        root,
        remove: () => rmSync(root, { recursive: true, force: true }),
    };
}

export const [TEA, GARDEN, BIKE, READER] = [1, 2, 3, 4].map(fixturePhrase) as [
    string,
    string,
    string,
    string,
];

export const FIXTURE: ArchiveFixture = {
    conversations: [
        {
            phrase: TEA,
            project: "github.com/me/app",
            title: "Tea at four",
            turns: [
                {
                    role: "user",
                    text: "I drink green tea at four every afternoon.",
                    at: "2026-09-01T16:00:00.000Z",
                },
                {
                    role: "assistant",
                    text: "Green tea at four, noted.",
                    at: "2026-09-01T16:00:05.000Z",
                },
            ],
        },
        {
            phrase: GARDEN,
            title: "The allotment",
            turns: [
                {
                    role: "user",
                    text: "My allotment is plot twelve by the river.",
                    at: "2026-09-05T10:00:00.000Z",
                },
                {
                    role: "assistant",
                    text: "Plot twelve, by the river.",
                    at: "2026-09-05T10:00:05.000Z",
                },
            ],
        },
        {
            phrase: BIKE,
            title: "Bicycle repair",
            turns: [
                {
                    role: "user",
                    text: "The rear derailleur on my bicycle slips in third gear.",
                    at: "2026-09-10T18:00:00.000Z",
                },
                {
                    role: "assistant",
                    text: "Turn the barrel adjuster a quarter turn.",
                    at: "2026-09-10T18:00:05.000Z",
                },
            ],
        },
        {
            phrase: READER,
            title: "Afternoon plans",
            turns: [
                {
                    role: "user",
                    text: "What do I drink in the afternoon?",
                    at: "2026-10-01T15:00:00.000Z",
                },
                {
                    role: "assistant",
                    text: "Green tea, at four.",
                    at: "2026-10-01T15:00:05.000Z",
                },
            ],
            reads: [
                {
                    id: "r1",
                    target: { conversation: TEA },
                    purpose: "what the user drinks in the afternoon",
                    served: "essential",
                },
                {
                    id: "r2",
                    target: { fact: "personal/prefers-mornings" },
                    purpose: "when the user likes to work",
                    served: "useful",
                },
                {
                    id: "r3",
                    target: { conversation: BIKE },
                    purpose: "nothing much",
                    served: "none",
                },
            ],
        },
    ],
    knowledge: [
        {
            scope: "personal",
            name: "prefers-mornings",
            title: "Prefers working in the mornings",
            body: "The user does their best work before noon.",
            at: "2026-08-01T09:00:00.000Z",
        },
        {
            scope: "personal",
            name: "uses-vim",
            title: "Uses Vim",
            body: "The user edits in Vim.",
            at: "2026-07-01T09:00:00.000Z",
            retired: { at: "2026-09-20T09:00:00.000Z", why: "Moved to Helix." },
        },
        {
            scope: "personal",
            name: "uses-helix",
            title: "Uses Helix",
            body: "The user edits in Helix.",
            at: "2026-09-20T09:00:00.000Z",
        },
    ],
};

// A data directory holding FIXTURE, under root/source; returns its path.
export async function writeFixtureData(root: string): Promise<string> {
    const env = {
        HOME: join(root, "source"),
        XDG_DATA_HOME: join(root, "source", "data"),
        XDG_CACHE_HOME: join(root, "source", "cache"),
        XDG_STATE_HOME: join(root, "source", "state"),
        XDG_CONFIG_HOME: join(root, "source", "config"),
    };
    await writeArchive(env, FIXTURE);
    return join(root, "source", "data", "dorothy");
}

// A work directory under root/work holding a snapshot of FIXTURE.
export async function snapshotFixture(root: string): Promise<string> {
    const work = join(root, "work");
    await takeSnapshot(await writeFixtureData(root), work);
    return work;
}
```

`packages/eval/src/snapshot/snapshot.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/snapshot/snapshot.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { EvalError } from "../errors.js";
import { tempRoot, writeFixtureData } from "../testing.js";
import {
    readSnapshot,
    snapshotDir,
    takeSnapshot,
    workEnv,
} from "./snapshot.js";

let temp: ReturnType<typeof tempRoot>;
let data: string;
let work: string;

beforeEach(async () => {
    temp = tempRoot("snapshot");
    data = await writeFixtureData(temp.root);
    work = join(temp.root, "work");
});
afterEach(() => temp.remove());

// Every file under dir with its contents, to see that nothing changed.
const tree = (dir: string) =>
    (readdirSync(dir, { recursive: true }) as string[])
        .sort()
        .map((name) => {
            const path = join(dir, name);
            return statSync(path).isFile()
                ? `${name}:${readFileSync(path, "utf8")}`
                : name;
        });

describe("a snapshot", () => {
    it("copies transcripts, knowledge and tags, never .git", async () => {
        mkdirSync(join(data, ".git"));
        writeFileSync(join(data, ".git", "HEAD"), "ref\n");
        writeFileSync(join(data, "tags.json"), "{}\n");
        const info = await takeSnapshot(data, work, {
            now: () => new Date("2026-10-19T00:00:00.000Z"),
        });
        expect(info).toEqual({
            source: data,
            at: "2026-10-19T00:00:00.000Z",
            conversations: 4,
            knowledge: 3,
        });
        const copy = snapshotDir(work);
        expect(existsSync(join(copy, "transcripts"))).toBe(true);
        expect(existsSync(join(copy, "knowledge"))).toBe(true);
        expect(existsSync(join(copy, "tags.json"))).toBe(true);
        expect(existsSync(join(copy, ".git"))).toBe(false);
        expect(await readSnapshot(work)).toEqual(info);
    });

    it("leaves the data directory as it was", async () => {
        const before = tree(data);
        await takeSnapshot(data, work);
        expect(tree(data)).toEqual(before);
    });

    it("refuses a second snapshot unless told to replace it", async () => {
        await takeSnapshot(data, work);
        await expect(takeSnapshot(data, work)).rejects.toThrow(
            "holds a snapshot already: give --replace",
        );
        const transcripts = join(data, "transcripts");
        const gone = readdirSync(transcripts).find((name) =>
            name.endsWith(".jsonl"),
        ) as string;
        rmSync(join(transcripts, gone));
        const info = await takeSnapshot(data, work, { replace: true });
        expect(info.conversations).toBe(3);
        expect(
            existsSync(join(snapshotDir(work), "transcripts", gone)),
        ).toBe(false);
    });

    it("refuses a directory with no transcripts", async () => {
        const empty = join(temp.root, "empty");
        mkdirSync(empty);
        await expect(takeSnapshot(empty, work)).rejects.toThrow(
            "has no transcripts/",
        );
    });

    it("refuses a work directory inside the data directory, or around it", async () => {
        await expect(takeSnapshot(data, join(data, "eval"))).rejects.toThrow(
            EvalError,
        );
        await expect(takeSnapshot(data, temp.root)).rejects.toThrow(
            "must not contain each other",
        );
        expect(existsSync(join(data, "eval"))).toBe(false);
    });

    it("says what to run when there is none", async () => {
        await expect(readSnapshot(work)).rejects.toThrow(
            "holds no snapshot: run `bun run eval -- snapshot",
        );
    });

    it("points every root into the work directory", () => {
        const env = workEnv(work);
        for (const name of [
            "HOME",
            "XDG_DATA_HOME",
            "XDG_CACHE_HOME",
            "XDG_STATE_HOME",
            "XDG_CONFIG_HOME",
        ]) {
            expect(env[name]?.startsWith(`${work}/`)).toBe(true);
        }
    });
});
```

- [ ] **Step 4: Run them to see them fail**

Run: `bun test packages/eval/src/snapshot`
Expected: FAIL, "Cannot find module './snapshot.js'".

- [ ] **Step 5: Write the snapshot**

`packages/eval/src/snapshot/snapshot.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/snapshot/snapshot.ts
//
//

// A copy of a data directory in the work directory, so that nothing the
// evaluation does reaches her archive, and the environment that points
// every root at it.

import {
    cp,
    mkdir,
    readdir,
    readFile,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import type { Env } from "@dorothy/core";
import { EvalError } from "../errors.js";

export type SnapshotInfo = {
    source: string;
    at: string;
    conversations: number;
    knowledge: number;
};

// What a snapshot takes of a data directory: never .git, which holds
// history, nor anything not named here. facts/ is there only where the
// directory has not yet moved it to knowledge/.
const COPIED = ["transcripts", "knowledge", "facts", "tags.json"];

export const snapshotDir = (work: string) => join(work, "data", "dorothy");
const infoPath = (work: string) => join(work, "snapshot.json");

export function workEnv(work: string): Env {
    return {
        HOME: join(work, "home"),
        XDG_DATA_HOME: join(work, "data"),
        XDG_CACHE_HOME: join(work, "cache"),
        XDG_STATE_HOME: join(work, "state"),
        XDG_CONFIG_HOME: join(work, "config"),
    };
}

const exists = (path: string) =>
    stat(path).then(
        () => true,
        () => false,
    );
const within = (path: string, dir: string) =>
    path === dir || path.startsWith(dir + sep);

async function count(
    dir: string,
    keep: (name: string) => boolean,
): Promise<number> {
    try {
        const names = await readdir(dir, { recursive: true });
        return names.filter((name) => keep(String(name))).length;
    } catch {
        return 0;
    }
}

export async function takeSnapshot(
    from: string,
    work: string,
    options: { replace?: boolean; now?: () => Date } = {},
): Promise<SnapshotInfo> {
    const source = resolve(from);
    const target = resolve(work);
    if (!(await exists(join(source, "transcripts")))) {
        throw new EvalError(
            `${source} is no data directory of Dorothy's: it has no transcripts/`,
        );
    }
    if (within(target, source) || within(source, target)) {
        throw new EvalError(
            "the work directory and the data directory must not contain each other",
        );
    }
    const copy = snapshotDir(target);
    if ((await exists(infoPath(target))) || (await exists(copy))) {
        if (options.replace !== true) {
            throw new EvalError(
                `${target} holds a snapshot already: give --replace to take it again`,
            );
        }
        await rm(copy, { recursive: true, force: true });
        // The index was built from the old copy.
        await rm(join(target, "cache"), { recursive: true, force: true });
    }
    await mkdir(copy, { recursive: true, mode: 0o700 });
    for (const name of COPIED) {
        if (await exists(join(source, name))) {
            await cp(join(source, name), join(copy, name), {
                recursive: true,
                filter: (path) => basename(path) !== ".git",
            });
        }
    }
    const markdown = (name: string) => name.endsWith(".md");
    const info: SnapshotInfo = {
        source,
        at: (options.now?.() ?? new Date()).toISOString(),
        conversations: await count(join(copy, "transcripts"), (name) =>
            name.endsWith(".jsonl"),
        ),
        knowledge:
            (await count(join(copy, "knowledge"), markdown)) +
            (await count(join(copy, "facts"), markdown)),
    };
    await writeFile(infoPath(target), `${JSON.stringify(info, null, 4)}\n`, {
        mode: 0o600,
    });
    return info;
}

export async function readSnapshot(work: string): Promise<SnapshotInfo> {
    try {
        return JSON.parse(
            await readFile(infoPath(work), "utf8"),
        ) as SnapshotInfo;
    } catch {
        throw new EvalError(
            `${work} holds no snapshot: run \`bun run eval -- snapshot --from <data directory> --work ${work}\` first`,
        );
    }
}
```

`mkdir` with `recursive` and `mode` makes the work directory too, so it
is 0700 when this makes it. If the `knowledge` count comes out over 3
because `putFact` keeps a `MEMORY.md` or similar beside the files, count
only files named after a fact (`/^[a-z0-9-]+\.md$/` on the basename) and
say so in the test.

- [ ] **Step 6: Run the snapshot's tests to see them pass**

Run: `bun test packages/eval/src/snapshot`
Expected: PASS, 7 tests.

- [ ] **Step 7: Write the CLI's failing tests**

`packages/eval/src/cli.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/cli.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { runCli } from "./cli.js";
import { fakeIo, tempRoot, writeFixtureData } from "./testing.js";

let temp: ReturnType<typeof tempRoot>;
beforeEach(() => {
    temp = tempRoot("cli");
});
afterEach(() => temp.remove());

describe("bun run eval", () => {
    it("gives its usage, and fails, with no command", async () => {
        const { io, err } = fakeIo();
        expect(await runCli([], io)).toBe(1);
        expect(err.join("")).toContain("Usage: bun run eval -- <command>");
        expect(err.join("")).toContain("snapshot");
    });

    it("gives its usage on --help, and succeeds", async () => {
        const { io, out } = fakeIo();
        expect(await runCli(["--help"], io)).toBe(0);
        expect(out.join("")).toContain("Usage:");
    });

    it("names a command it lacks", async () => {
        const { io, err } = fakeIo();
        expect(await runCli(["dance"], io)).toBe(1);
        expect(err.join("")).toContain("eval: no command dance");
    });

    it("names an option a command lacks", async () => {
        const { io, err } = fakeIo();
        expect(await runCli(["snapshot", "--frm", "x"], io)).toBe(1);
        expect(err.join("")).toStartWith("eval: ");
        expect(err.join("")).toContain("--frm");
    });

    it("asks for --from and --work", async () => {
        const { io, err } = fakeIo();
        expect(await runCli(["snapshot", "--work", "w"], io)).toBe(1);
        expect(err.join("")).toContain("give --from");
        expect(await runCli(["snapshot", "--from", "d"], io)).toBe(1);
        expect(err.join("")).toContain("give --work");
    });

    it("takes a snapshot", async () => {
        const data = await writeFixtureData(temp.root);
        const { io, out } = fakeIo();
        const work = join(temp.root, "work");
        expect(
            await runCli(["snapshot", "--from", data, "--work", work], io),
        ).toBe(0);
        expect(out.join("")).toBe(
            `copied 4 conversations and 3 knowledge files from ${data}\n`,
        );
    });
});
```

- [ ] **Step 8: Write the command, the CLI and the entry**

`packages/eval/src/snapshot/command.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/snapshot/command.ts
//
//

import { type Command, stringOf, workOf } from "../command.js";
import { EvalError } from "../errors.js";
import { takeSnapshot } from "./snapshot.js";

export const snapshotCommand: Command = {
    summary: "copy a data directory into the work directory",
    options: {
        from: { type: "string" },
        work: { type: "string" },
        replace: { type: "boolean" },
    },
    async run(values, _positionals, io) {
        // Never a default: nothing reads her real data unless named.
        const from = stringOf(values, "from");
        if (from === null) {
            throw new EvalError(
                "give --from, Dorothy's data directory (such as ~/.local/share/dorothy)",
            );
        }
        const info = await takeSnapshot(from, workOf(values), {
            replace: values.replace === true,
        });
        io.out(
            `copied ${info.conversations} conversations and ${info.knowledge} knowledge files from ${info.source}\n`,
        );
        return 0;
    },
};
```

`packages/eval/src/cli.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/cli.ts
//
//

// bun run eval -- <command>: the commands in the order a user meets them.

import { parseArgs } from "node:util";
import type { Command, Io, Values } from "./command.js";
import { EvalError } from "./errors.js";
import { snapshotCommand } from "./snapshot/command.js";

export const COMMANDS: Record<string, Command> = {
    snapshot: snapshotCommand,
};

export function usage(): string {
    const lines = [
        "Usage: bun run eval -- <command> [options]",
        "",
        "Commands:",
    ];
    for (const [name, command] of Object.entries(COMMANDS)) {
        lines.push(`  ${name.padEnd(10)}${command.summary}`);
    }
    return `${lines.join("\n")}\n`;
}

// node:util's parseArgs marks its own errors with these codes.
const isArgumentError = (error: unknown) =>
    String((error as { code?: unknown }).code ?? "").startsWith(
        "ERR_PARSE_ARGS",
    );

export async function runCli(argv: string[], io: Io): Promise<number> {
    const [name, ...rest] = argv;
    if (name === "--help") {
        io.out(usage());
        return 0;
    }
    const command = name === undefined ? undefined : COMMANDS[name];
    if (command === undefined) {
        io.err(
            name === undefined ? usage() : `eval: no command ${name}\n${usage()}`,
        );
        return 1;
    }
    try {
        const { values, positionals } = parseArgs({
            args: rest,
            options: command.options,
            allowPositionals: true,
            strict: true,
        });
        return await command.run(values as Values, positionals, io);
    } catch (error) {
        if (error instanceof EvalError || isArgumentError(error)) {
            io.err(`eval: ${(error as Error).message}\n`);
            return 1;
        }
        throw error;
    }
}
```

`packages/eval/src/main.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/main.ts
//
//

// bun run eval: the process around runCli, with the real terminal.

import { spawnSync } from "node:child_process";
import { createInterface, type Interface } from "node:readline/promises";
import { runCli } from "./cli.js";

let reader: Interface | null = null;

const ask = (prompt: string) =>
    new Promise<string | null>((done) => {
        reader ??= createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        const ended = () => done(null);
        reader.once("close", ended);
        reader.question(prompt).then(
            (answer) => {
                reader?.off("close", ended);
                done(answer);
            },
            () => done(null),
        );
    });

// $VISUAL or $EDITOR may carry arguments, so a shell runs it.
const edit = async (path: string) => {
    const editor = process.env.VISUAL || process.env.EDITOR || "vi";
    spawnSync("sh", ["-c", `${editor} "$1"`, "sh", path], {
        stdio: "inherit",
    });
};

process.exitCode = await runCli(process.argv.slice(2), {
    env: process.env,
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    ask,
    edit,
});
reader?.close();
```

- [ ] **Step 9: Write the package's guide**

`packages/eval/AGENTS.md`:

```markdown
---
ctime: 2026-10-19
mtime: 2026-10-19
spdx: GPL-3.0-only
title: packages/eval/AGENTS.md
description: >-
  The evaluation package's guide: measuring Dorothy's memory on
  questions drawn from her own data.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/eval/AGENTS.md
   -
   -->

# packages/eval/AGENTS.md

`@dorothy/eval` measures Dorothy's memory, as
[its spec](../../docs/specs/2026-10-18-memory-evaluation-design.md)
says: a snapshot of a data directory, questions mined and generated
from it, systems asked them, answers judged, and a report. It is a tool
for her builders, run as `bun run eval -- <command>`; nothing imports
it, and it has no entry point.

## Entry points and imports

None. Of the `@dorothy` packages it depends on `core` and `memory`, and
of memory only `@dorothy/memory/evaluation`, which opens an archive. It
reads no file of memory's itself.

## Rules

- Every command but `snapshot` takes `--work` and runs with
  `workEnv(work)`, which points every root into the work directory.
  Nothing reads a data directory but `snapshot`, and only the one
  `--from` names.
- Tests build their archive with `writeFixtureData` or
  `snapshotFixture` from `src/testing.ts`, under a temporary root.
- A failure the user can mend is an `EvalError`, said in one line by
  `runCli`; anything else is a fault and keeps its stack.

## Files

- `main.ts`: the process around `runCli`, with the real terminal.
- `cli.ts`: the command table and `runCli`.
- `command.ts`: `Io`, `Command` and the options' readers.
- `snapshot/`: `takeSnapshot`, `readSnapshot`, `workEnv`, and the
  `snapshot` command.
- `testing.ts`: `fakeIo`, temporary roots and the fixture archive.
```

- [ ] **Step 10: Run everything and commit**

Run: `bun test packages/eval workspace.test.ts agents.test.ts`
Expected: PASS.

Run: `bun run check`
Expected: exit 0.

Run: `bun run eval -- --help`
Expected: the usage, naming `snapshot`.

```bash
bunx biome check --write packages/eval workspace.test.ts .commitlintrc.mts
git add packages/eval package.json bun.lock workspace.test.ts .commitlintrc.mts AGENTS.md
git commit -m "feat(eval): Add the package and its snapshot" \
  -m "bun run eval -- snapshot copies a data directory into a work
directory, which every later command reads instead of her archive."
```

---

### Task 3: the question file

**Files:**

- Create: `packages/eval/src/questions/file.ts`
- Test: `packages/eval/src/questions/file.test.ts`
- Modify: `packages/eval/AGENTS.md` (Files)

**Interfaces:**

- Consumes: `EvalError` (Task 2).
- Produces:
  - `QUESTION_TYPES`, `type QuestionType` (the seven types)
  - `questionSchema` (zod), `type Question = { id: string; type:
    QuestionType; question: string; answer: string | null; evidence:
    string[]; exclude: string | null; asOf: string; project: string |
    null; source: string; status: "draft" | "accepted" | "rejected";
    note: string | null }`
  - `questionId(question: string, evidence: readonly string[]): string`
  - `questionsPath(work: string): string`
  - `readQuestions(work: string): Promise<{ questions: Question[];
    problems: string[] }>`
  - `readQuestionsToRewrite(work: string): Promise<Question[]>`, which
    throws an `EvalError` naming each malformed line
  - `writeQuestions(work: string, questions: Question[]): Promise<void>`
  - `mergeQuestions(existing: Question[], incoming: Question[]): {
    questions: Question[]; added: number }`

- [ ] **Step 1: Write the failing test**

`packages/eval/src/questions/file.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/file.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { tempRoot } from "../testing.js";
import {
    mergeQuestions,
    type Question,
    questionId,
    questionSchema,
    questionsPath,
    readQuestions,
    readQuestionsToRewrite,
    writeQuestions,
} from "./file.js";

let temp: ReturnType<typeof tempRoot>;
beforeEach(() => {
    temp = tempRoot("questions");
});
afterEach(() => temp.remove());

const lookup = (question: string): Question => ({
    id: questionId(question, ["c:x"]),
    type: "lookup",
    question,
    answer: null,
    evidence: ["c:x"],
    exclude: "reader",
    asOf: "2026-10-01",
    project: null,
    source: "mined",
    status: "accepted",
    note: null,
});

describe("a question's id", () => {
    it("is q- and eight hex digits, whatever the evidence's order", () => {
        const id = questionId("When?", ["c:a", "k:b"]);
        expect(id).toMatch(/^q-[0-9a-f]{8}$/);
        expect(questionId("When?", ["k:b", "c:a"])).toBe(id);
        expect(questionId("Where?", ["c:a", "k:b"])).not.toBe(id);
    });
});

describe("a question's shape", () => {
    it("takes a lookup with evidence and no answer", () => {
        expect(questionSchema.safeParse(lookup("Which tea?")).success).toBe(
            true,
        );
    });

    it("refuses a lookup without evidence", () => {
        const bad = { ...lookup("Which tea?"), evidence: [] };
        expect(questionSchema.safeParse(bad).success).toBe(false);
    });

    it("refuses an abstention with evidence, or without an answer", () => {
        const base = {
            ...lookup("Where did I go?"),
            type: "abstention",
            answer: "The memory does not say.",
            evidence: [],
            source: "generated:m",
        };
        expect(questionSchema.safeParse(base).success).toBe(true);
        expect(
            questionSchema.safeParse({ ...base, evidence: ["c:x"] }).success,
        ).toBe(false);
        expect(questionSchema.safeParse({ ...base, answer: null }).success).toBe(
            false,
        );
    });

    it("refuses a key it does not know", () => {
        const bad = { ...lookup("Which tea?"), extra: 1 };
        expect(questionSchema.safeParse(bad).success).toBe(false);
    });
});

describe("the question file", () => {
    it("is empty before anything is written", async () => {
        expect(await readQuestions(temp.root)).toEqual({
            questions: [],
            problems: [],
        });
    });

    it("writes and reads back, private to the user", async () => {
        const questions = [lookup("Which tea?"), lookup("Which plot?")];
        await writeQuestions(temp.root, questions);
        expect((await readQuestions(temp.root)).questions).toEqual(questions);
        expect(statSync(questionsPath(temp.root)).mode & 0o777).toBe(0o600);
        expect(readFileSync(questionsPath(temp.root), "utf8")).toEndWith("}\n");
    });

    it("reports a malformed line by number and reads the rest", async () => {
        await writeQuestions(temp.root, [lookup("Which tea?")]);
        const path = questionsPath(temp.root);
        writeFileSync(
            path,
            `${readFileSync(path, "utf8")}{"id": "nope"}\nnot json\n\n`,
        );
        const { questions, problems } = await readQuestions(temp.root);
        expect(questions).toHaveLength(1);
        expect(problems).toHaveLength(2);
        expect(problems[0]).toStartWith("questions.jsonl:2: ");
        expect(problems[1]).toStartWith("questions.jsonl:3: ");
    });

    it("refuses to rewrite a file with a malformed line", async () => {
        await writeQuestions(temp.root, [lookup("Which tea?")]);
        const path = questionsPath(temp.root);
        writeFileSync(path, `${readFileSync(path, "utf8")}not json\n`);
        await expect(readQuestionsToRewrite(temp.root)).rejects.toThrow(
            "questions.jsonl:2: ",
        );
    });

    it("merges by id, keeping the owner's decisions", () => {
        const kept = { ...lookup("Which tea?"), status: "rejected" as const };
        const merged = mergeQuestions(
            [kept],
            [lookup("Which tea?"), lookup("Which plot?")],
        );
        expect(merged.added).toBe(1);
        expect(merged.questions.map((each) => each.status)).toEqual([
            "rejected",
            "accepted",
        ]);
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test packages/eval/src/questions/file.test.ts`
Expected: FAIL, "Cannot find module './file.js'".

- [ ] **Step 3: Write the question file**

`packages/eval/src/questions/file.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/file.ts
//
//

// <work>/questions.jsonl: one question a line, mined or generated, and
// the owner's decision on it.

import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { EvalError } from "../errors.js";

export const QUESTION_TYPES = [
    "single-session",
    "preference",
    "multi-session",
    "knowledge-update",
    "temporal",
    "abstention",
    "lookup",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const questionSchema = z
    .object({
        id: z.string().regex(/^q-[0-9a-f]{8}$/),
        type: z.enum(QUESTION_TYPES),
        question: z.string().trim().min(1).max(2000),
        answer: z.string().trim().min(1).max(4000).nullable(),
        evidence: z
            .array(z.string().regex(/^[kc]:\S+$/))
            .max(10),
        exclude: z.string().min(1).nullable(),
        asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        project: z.string().min(1).nullable(),
        source: z.string().regex(/^(mined|generated:\S+)$/),
        status: z.enum(["draft", "accepted", "rejected"]),
        note: z.string().max(2000).nullable(),
    })
    .strict()
    .superRefine((question, context) => {
        const problem =
            question.type === "lookup"
                ? question.answer !== null
                    ? "a lookup has no answer"
                    : question.evidence.length === 0
                      ? "a lookup needs evidence"
                      : null
                : question.answer === null
                  ? "only a lookup goes without an answer"
                  : question.type === "abstention"
                    ? question.evidence.length > 0
                        ? "an abstention has no evidence"
                        : null
                    : question.evidence.length === 0
                      ? `a ${question.type} question needs evidence`
                      : null;
        if (problem !== null) {
            context.addIssue({ code: "custom", message: problem });
        }
    });
export type Question = z.infer<typeof questionSchema>;

export function questionId(
    question: string,
    evidence: readonly string[],
): string {
    const digest = createHash("sha256")
        .update(`${question}\n${[...evidence].sort().join("\n")}`)
        .digest("hex");
    return `q-${digest.slice(0, 8)}`;
}

export const questionsPath = (work: string) => join(work, "questions.jsonl");

const problemOf = (error: unknown) =>
    error instanceof z.ZodError
        ? (error.issues[0]?.message ?? "not a question")
        : "not JSON";

export async function readQuestions(
    work: string,
): Promise<{ questions: Question[]; problems: string[] }> {
    let text: string;
    try {
        text = await readFile(questionsPath(work), "utf8");
    } catch {
        return { questions: [], problems: [] };
    }
    const questions: Question[] = [];
    const problems: string[] = [];
    for (const [at, line] of text.split("\n").entries()) {
        if (line.trim() === "") {
            continue;
        }
        try {
            questions.push(questionSchema.parse(JSON.parse(line)));
        } catch (error) {
            problems.push(`questions.jsonl:${at + 1}: ${problemOf(error)}`);
        }
    }
    return { questions, problems };
}

// For the commands that write the file back: a malformed line would be
// lost, so they stop until it is mended.
export async function readQuestionsToRewrite(
    work: string,
): Promise<Question[]> {
    const { questions, problems } = await readQuestions(work);
    if (problems.length > 0) {
        throw new EvalError(
            `${problems.join("; ")}: mend or remove these lines first`,
        );
    }
    return questions;
}

export async function writeQuestions(
    work: string,
    questions: Question[],
): Promise<void> {
    const path = questionsPath(work);
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(
        temporary,
        questions.map((question) => `${JSON.stringify(question)}\n`).join(""),
        { mode: 0o600 },
    );
    await rename(temporary, path);
}

export function mergeQuestions(
    existing: Question[],
    incoming: Question[],
): { questions: Question[]; added: number } {
    const ids = new Set(existing.map((question) => question.id));
    const questions = [...existing];
    for (const question of incoming) {
        if (!ids.has(question.id)) {
            ids.add(question.id);
            questions.push(question);
        }
    }
    return { questions, added: questions.length - existing.length };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `bun test packages/eval/src/questions/file.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Add the file to the guide and commit**

In `packages/eval/AGENTS.md`'s Files, after the `snapshot/` bullet:

```markdown
- `questions/file.ts`: the question file, its schema and ids; the
  commands that rewrite it read it with `readQuestionsToRewrite`.
```

```bash
bunx biome check --write packages/eval
git add packages/eval
git commit -m "feat(eval): Keep questions in a file"
```

---
### Task 4: mining her appraised reads

**Files:**

- Create: `packages/eval/src/questions/mine.ts`
- Test: `packages/eval/src/questions/mine.test.ts`
- Modify: `packages/eval/src/cli.ts` (the `mine` command)
- Modify: `packages/eval/AGENTS.md` (Files)

**Interfaces:**

- Consumes: `openArchive`, `AppraisedRead` (`@dorothy/memory/evaluation`,
  Task 1); `Command`, `workOf` (Task 2); `readSnapshot`, `workEnv`
  (Task 2); `Question`, `questionId`, `questionSchema`,
  `readQuestionsToRewrite`, `writeQuestions`, `mergeQuestions` (Task 3);
  `snapshotFixture`, `fakeIo`, `tempRoot`, `TEA`, `READER` (Task 2).
- Produces:
  - `lookupQuestions(reads: AppraisedRead[], projects: Map<string,
    string | null>): Question[]` (projects by the reader's phrase)
  - `mineCommand: Command`

- [ ] **Step 1: Write the failing test**

`packages/eval/src/questions/mine.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/mine.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { runCli } from "../cli.js";
import {
    fakeIo,
    READER,
    snapshotFixture,
    TEA,
    tempRoot,
} from "../testing.js";
import { questionsPath, readQuestions } from "./file.js";
import { lookupQuestions } from "./mine.js";

let temp: ReturnType<typeof tempRoot>;
beforeEach(() => {
    temp = tempRoot("mine");
});
afterEach(() => temp.remove());

const read = (purpose: string, target: string, reader = "r") => ({
    reader,
    target,
    purpose,
    served: "useful" as const,
    at: "2026-10-01T15:00:05.000Z",
});

describe("lookups", () => {
    it("asks her purpose, with what she opened as evidence", () => {
        const [question] = lookupQuestions(
            [read("which tea the user likes", "c:t")],
            new Map([["r", "github.com/me/app"]]),
        );
        expect(question).toMatchObject({
            type: "lookup",
            question: "which tea the user likes",
            answer: null,
            evidence: ["c:t"],
            exclude: "r",
            asOf: "2026-10-01",
            project: "github.com/me/app",
            source: "mined",
            status: "accepted",
            note: null,
        });
        expect(question?.id).toMatch(/^q-[0-9a-f]{8}$/);
    });

    it("leaves out a read of the reader itself, an empty purpose and a repeat", () => {
        const found = lookupQuestions(
            [
                read("the same", "c:r"),
                read("   ", "c:t"),
                read("again", "c:t"),
                read("again", "c:t"),
            ],
            new Map(),
        );
        expect(found.map((question) => question.question)).toEqual(["again"]);
    });
});

describe("bun run eval -- mine", () => {
    it("mines the snapshot's appraised reads, once", async () => {
        const work = await snapshotFixture(temp.root);
        const first = fakeIo();
        expect(await runCli(["mine", "--work", work], first.io)).toBe(0);
        expect(first.out.join("")).toBe(
            "mined 2 lookups, 2 new; 2 questions in all\n",
        );
        const { questions } = await readQuestions(work);
        expect(questions.map((question) => question.evidence[0])).toEqual([
            `c:${TEA}`,
            "k:personal/prefers-mornings",
        ]);
        expect(questions.every((q) => q.exclude === READER)).toBe(true);
        const again = fakeIo();
        expect(await runCli(["mine", "--work", work], again.io)).toBe(0);
        expect(again.out.join("")).toBe(
            "mined 2 lookups, 0 new; 2 questions in all\n",
        );
    });

    it("writes nothing while the file has a malformed line", async () => {
        const work = await snapshotFixture(temp.root);
        writeFileSync(questionsPath(work), "not json\n");
        const { io, err } = fakeIo();
        expect(await runCli(["mine", "--work", work], io)).toBe(1);
        expect(err.join("")).toContain("questions.jsonl:1: ");
        expect(readFileSync(questionsPath(work), "utf8")).toBe("not json\n");
    });

    it("asks for a snapshot first", async () => {
        const { io, err } = fakeIo();
        expect(await runCli(["mine", "--work", temp.root], io)).toBe(1);
        expect(err.join("")).toContain("holds no snapshot");
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test packages/eval/src/questions/mine.test.ts`
Expected: FAIL, "Cannot find module './mine.js'".

- [ ] **Step 3: Write the mining and its command**

`packages/eval/src/questions/mine.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/mine.ts
//
//

// Questions her data already answers: each read her review judged useful
// or essential is a real query, her purpose, with a known answer, what
// she opened. They score retrieval alone, as they have no reference
// answer, and the conversation she read from is left out of retrieval.

import {
    type AppraisedRead,
    openArchive,
} from "@dorothy/memory/evaluation";
import { type Command, workOf } from "../command.js";
import { readSnapshot, workEnv } from "../snapshot/snapshot.js";
import {
    mergeQuestions,
    type Question,
    questionId,
    questionSchema,
    readQuestionsToRewrite,
    writeQuestions,
} from "./file.js";

export function lookupQuestions(
    reads: AppraisedRead[],
    projects: Map<string, string | null>,
): Question[] {
    const made = new Map<string, Question>();
    for (const read of reads) {
        const question = read.purpose.trim();
        if (question === "" || read.target === `c:${read.reader}`) {
            continue;
        }
        const evidence = [read.target];
        const id = questionId(question, evidence);
        const parsed = questionSchema.safeParse({
            id,
            type: "lookup",
            question,
            answer: null,
            evidence,
            exclude: read.reader,
            asOf: read.at.slice(0, 10),
            project: projects.get(read.reader) ?? null,
            source: "mined",
            status: "accepted",
            note: null,
        });
        if (parsed.success && !made.has(id)) {
            made.set(id, parsed.data);
        }
    }
    return [...made.values()];
}

export const mineCommand: Command = {
    summary: "make lookup questions from her appraised reads",
    options: { work: { type: "string" } },
    async run(values, _positionals, io) {
        const work = workOf(values);
        await readSnapshot(work);
        const existing = await readQuestionsToRewrite(work);
        const archive = await openArchive(workEnv(work));
        try {
            const projects = new Map(
                archive
                    .conversations()
                    .map((each) => [each.phrase, each.project] as const),
            );
            const mined = lookupQuestions(
                await archive.appraisedReads(),
                projects,
            );
            const merged = mergeQuestions(existing, mined);
            await writeQuestions(work, merged.questions);
            io.out(
                `mined ${mined.length} lookups, ${merged.added} new; ${merged.questions.length} questions in all\n`,
            );
            return 0;
        } finally {
            archive.close();
        }
    },
};
```

In `packages/eval/src/cli.ts`, import it and add it to `COMMANDS` after
`snapshot`:

```ts
import { mineCommand } from "./questions/mine.js";
```

```ts
export const COMMANDS: Record<string, Command> = {
    snapshot: snapshotCommand,
    mine: mineCommand,
};
```

- [ ] **Step 4: Run it to see it pass**

Run: `bun test packages/eval/src/questions`
Expected: PASS.

- [ ] **Step 5: Add the file to the guide and commit**

In `packages/eval/AGENTS.md`'s Files, after `questions/file.ts`:

```markdown
- `questions/mine.ts`: lookup questions from her appraised reads, and
  the `mine` command.
```

```bash
bunx biome check --write packages/eval
git add packages/eval
git commit -m "feat(eval): Mine questions from appraised reads"
```

---

### Task 5: the models

**Files:**

- Create: `packages/eval/src/models/config.ts`
- Create: `packages/eval/src/models/client.ts`
- Test: `packages/eval/src/models/config.test.ts`
- Test: `packages/eval/src/models/client.test.ts`
- Modify: `packages/eval/package.json` (dependencies)
- Modify: `packages/eval/src/testing.ts` (the stub server)
- Modify: `packages/eval/AGENTS.md` (Files)

**Interfaces:**

- Consumes: `EvalError` (Task 2); `Env` (`@dorothy/core`).
- Produces:
  - `ROLES`, `type Role = "generate" | "answer" | "judge"`, `type
    RoleConfig = { baseUrl: string; model: string; key: string | null }`,
    `type EvalConfig = Record<Role, RoleConfig | null>`
  - `readEvalConfig(work: string): Promise<EvalConfig>`,
    `requireRole(config: EvalConfig, role: Role): RoleConfig`,
    `vendorOf(model: string): string`, `configPath(work: string): string`
  - `type Message = { role: "system" | "user"; content: string }`,
    `type Completion = { text: string; input: number; output: number;
    ms: number }`
  - `class CallCap extends EvalError`
  - `class Models` with `constructor(config: EvalConfig, options: {
    env: Env; maxCalls?: number | null; timeoutMs?: number; retryMs?:
    number })`, `calls: number` (getter), `chat(role: Role): ChatOpenAI`,
    `call<T>(work: () => Promise<T>): Promise<T>`, `complete(role: Role,
    messages: Message[]): Promise<Completion>`, `structured<T>(role:
    Role, schema: z.ZodType<T>, name: string, messages: Message[]):
    Promise<{ value: T; input: number; output: number }>`
  - `failureOf(error: unknown): string`, one line without a key
  - From `testing.ts`: `stubModels(reply: (request: StubRequest, count:
    number) => StubReply): { url: string; requests: StubRequest[];
    stop(): void }`, `type StubRequest = { path: string;
    authorization: string | null; body: Record<string, unknown> }`,
    `type StubReply = { status?: number; content?: string; json?:
    unknown }`, `stubConfig(url: string, key?: string | null): string`

- [ ] **Step 1: Add the dependencies**

In `packages/eval/package.json`, `dependencies` becomes:

```json
    "dependencies": {
        "@dorothy/core": "workspace:*",
        "@dorothy/memory": "workspace:*",
        "@langchain/core": "^1.2.18",
        "@langchain/openai": "^1.6.2",
        "openevals": "^0.2.2",
        "zod": "^4.6.7"
    }
```

Run: `bun install`
Expected: it installs them, with no error. LangSmith comes in as
openevals' dependency; nothing here calls it, and no LangSmith variable
is set.

- [ ] **Step 2: Add the stub server to testing.ts**

At the end of `packages/eval/src/testing.ts`, and its import at the
top:

```ts
import { ROLES } from "./models/config.js";
```

```ts
export type StubRequest = {
    path: string;
    authorization: string | null;
    body: Record<string, unknown>;
};
export type StubReply = { status?: number; content?: string; json?: unknown };

// An OpenAI-compatible Chat Completions server on loopback, answering as
// reply says: a status other than 200 refuses; json is sent as the
// message's content, as a model answering a schema does.
export function stubModels(
    reply: (request: StubRequest, count: number) => StubReply,
): { url: string; requests: StubRequest[]; stop(): void } {
    const requests: StubRequest[] = [];
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(request) {
            const body = (await request.json()) as Record<string, unknown>;
            const seen: StubRequest = {
                path: new URL(request.url).pathname,
                authorization: request.headers.get("authorization"),
                body,
            };
            requests.push(seen);
            const answer = reply(seen, requests.length);
            if (answer.status !== undefined && answer.status !== 200) {
                return new Response("refused", { status: answer.status });
            }
            return Response.json({
                id: "stub",
                object: "chat.completion",
                created: 0,
                model: body.model,
                choices: [
                    {
                        index: 0,
                        message: {
                            role: "assistant",
                            content:
                                answer.json === undefined
                                    ? (answer.content ?? "")
                                    : JSON.stringify(answer.json),
                        },
                        finish_reason: "stop",
                    },
                ],
                usage: {
                    prompt_tokens: 11,
                    completion_tokens: 7,
                    total_tokens: 18,
                },
            });
        },
    });
    return {
        url: `http://127.0.0.1:${server.port}/v1`,
        requests,
        stop: () => server.stop(true),
    };
}

// eval.toml with every role on the stub, each of its own vendor.
export function stubConfig(url: string, key: string | null = null): string {
    return ROLES.map(
        (role) =>
            `[models.${role}]\nbase-url = "${url}"\nmodel = "${role}/model"\n${
                key === null ? "" : `key = "${key}"\n`
            }`,
    ).join("\n");
}
```

- [ ] **Step 3: Write the failing tests**

`packages/eval/src/models/config.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/models/config.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { tempRoot } from "../testing.js";
import {
    configPath,
    readEvalConfig,
    requireRole,
    vendorOf,
} from "./config.js";

let temp: ReturnType<typeof tempRoot>;
beforeEach(() => {
    temp = tempRoot("config");
});
afterEach(() => temp.remove());

const write = (text: string) => writeFileSync(configPath(temp.root), text);

describe("eval.toml", () => {
    it("names no role when it is missing", async () => {
        expect(await readEvalConfig(temp.root)).toEqual({
            generate: null,
            answer: null,
            judge: null,
        });
    });

    it("reads each role", async () => {
        write(
            '[models.answer]\nbase-url = "https://openrouter.ai/api/v1"\nmodel = "openai/gpt-oss-120b"\nkey = "OPENROUTER_API_KEY"\n\n[models.judge]\nbase-url = "http://127.0.0.1:8080/v1"\nmodel = "local"\n',
        );
        expect(await readEvalConfig(temp.root)).toEqual({
            generate: null,
            answer: {
                baseUrl: "https://openrouter.ai/api/v1",
                model: "openai/gpt-oss-120b",
                key: "OPENROUTER_API_KEY",
            },
            judge: {
                baseUrl: "http://127.0.0.1:8080/v1",
                model: "local",
                key: null,
            },
        });
    });

    it("refuses a role it does not know", async () => {
        write('[models.critic]\nbase-url = "http://x"\nmodel = "m"\n');
        await expect(readEvalConfig(temp.root)).rejects.toThrow(
            "no role critic; the roles are generate, answer, judge",
        );
    });

    it("refuses a key in place of a variable's name, never repeating it", async () => {
        write(
            '[models.answer]\nbase-url = "http://x"\nmodel = "m"\nkey = "sk-or-v1-0123456789abcdef"\n',
        );
        const error = await readEvalConfig(temp.root).catch(
            (caught: Error) => caught,
        );
        expect(String(error)).toContain("key names a variable");
        expect(String(error)).not.toContain("0123456789abcdef");
    });

    it("refuses a base-url that is no http URL, and a setting it lacks", async () => {
        write('[models.answer]\nbase-url = "openrouter"\nmodel = "m"\n');
        await expect(readEvalConfig(temp.root)).rejects.toThrow(
            "needs base-url",
        );
        write(
            '[models.answer]\nbase-url = "http://x"\nmodel = "m"\ntemperature = 0\n',
        );
        await expect(readEvalConfig(temp.root)).rejects.toThrow(
            "has no setting temperature",
        );
    });

    it("says where to add a role a command needs", () => {
        expect(() =>
            requireRole({ generate: null, answer: null, judge: null }, "judge"),
        ).toThrow("eval.toml has no [models.judge]");
    });
});

describe("a model's vendor", () => {
    it("is the id's prefix, or its first word", () => {
        expect(vendorOf("openai/gpt-oss-120b")).toBe("openai");
        expect(vendorOf("gpt-4o")).toBe("gpt");
        expect(vendorOf("local")).toBe("local");
    });
});
```

`packages/eval/src/models/client.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/models/client.test.ts
//
//

import { afterEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { EvalError } from "../errors.js";
import { type StubReply, stubModels } from "../testing.js";
import { CallCap, failureOf, Models } from "./client.js";
import type { EvalConfig } from "./config.js";

let stub: ReturnType<typeof stubModels> | null = null;
afterEach(() => {
    stub?.stop();
    stub = null;
});

const serve = (reply: (count: number) => StubReply) => {
    stub = stubModels((_request, count) => reply(count));
    return stub;
};
const configOf = (url: string, key: string | null = null): EvalConfig => ({
    generate: { baseUrl: url, model: "generate/model", key },
    answer: { baseUrl: url, model: "answer/model", key },
    judge: { baseUrl: url, model: "judge/model", key },
});
const ask = [{ role: "user" as const, content: "Hello?" }];

describe("Models", () => {
    it("completes, with the tokens it used", async () => {
        const { url, requests } = serve(() => ({ content: "Hi." }));
        const models = new Models(configOf(url), { env: {} });
        const done = await models.complete("answer", ask);
        expect(done).toMatchObject({ text: "Hi.", input: 11, output: 7 });
        expect(requests[0]?.path).toBe("/v1/chat/completions");
        expect(requests[0]?.body.model).toBe("answer/model");
        expect(models.calls).toBe(1);
    });

    it("sends the key from its variable", async () => {
        const { url, requests } = serve(() => ({ content: "Hi." }));
        const models = new Models(configOf(url, "EVAL_KEY"), {
            env: { EVAL_KEY: "secret" },
        });
        await models.complete("answer", ask);
        expect(requests[0]?.authorization).toBe("Bearer secret");
    });

    it("names a variable that is not set, and calls nothing", async () => {
        const { url, requests } = serve(() => ({ content: "Hi." }));
        const models = new Models(configOf(url, "EVAL_KEY"), { env: {} });
        await expect(models.complete("answer", ask)).rejects.toThrow(
            "EVAL_KEY is not set",
        );
        expect(requests).toHaveLength(0);
    });

    it("retries a headerless 429 twice", async () => {
        const { url, requests } = serve((count) =>
            count < 3 ? { status: 429 } : { content: "Hi." },
        );
        const models = new Models(configOf(url), { env: {}, retryMs: 1 });
        expect((await models.complete("answer", ask)).text).toBe("Hi.");
        expect(requests).toHaveLength(3);
        expect(models.calls).toBe(3);
    });

    it("gives up after two retries of a server's fault", async () => {
        const { url, requests } = serve(() => ({ status: 500 }));
        const models = new Models(configOf(url), { env: {}, retryMs: 1 });
        const error = await models.complete("answer", ask).catch((e) => e);
        expect(failureOf(error)).toStartWith("500");
        expect(requests).toHaveLength(3);
    });

    it("never retries a request the server refuses", async () => {
        const { url, requests } = serve(() => ({ status: 400 }));
        const models = new Models(configOf(url), { env: {}, retryMs: 1 });
        await expect(models.complete("answer", ask)).rejects.toThrow();
        expect(requests).toHaveLength(1);
    });

    it("stops at --max-calls", async () => {
        const { url, requests } = serve(() => ({ content: "Hi." }));
        const models = new Models(configOf(url), { env: {}, maxCalls: 2 });
        await models.complete("answer", ask);
        await models.complete("answer", ask);
        await expect(models.complete("answer", ask)).rejects.toThrow(CallCap);
        expect(requests).toHaveLength(2);
    });

    it("parses a structured reply against its schema", async () => {
        const { url, requests } = serve(() => ({ json: { n: 3 } }));
        const models = new Models(configOf(url), { env: {} });
        const done = await models.structured(
            "generate",
            z.object({ n: z.number() }),
            "count",
            ask,
        );
        expect(done.value).toEqual({ n: 3 });
        expect(
            (requests[0]?.body.response_format as { type: string }).type,
        ).toBe("json_schema");
    });

    it("refuses a reply that does not match, without retrying it", async () => {
        const { url, requests } = serve(() => ({ json: { n: "three" } }));
        const models = new Models(configOf(url), { env: {}, retryMs: 1 });
        await expect(
            models.structured(
                "generate",
                z.object({ n: z.number() }),
                "count",
                ask,
            ),
        ).rejects.toThrow(EvalError);
        expect(requests).toHaveLength(1);
    });
});
```

- [ ] **Step 4: Run them to see them fail**

Run: `bun test packages/eval/src/models`
Expected: FAIL, "Cannot find module './config.js'".

- [ ] **Step 5: Write the configuration**

`packages/eval/src/models/config.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/models/config.ts
//
//

// <work>/eval.toml: a base URL and a model for each role, and the name of
// the variable that holds its key. A key itself never goes in the file.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EvalError } from "../errors.js";

export const ROLES = ["generate", "answer", "judge"] as const;
export type Role = (typeof ROLES)[number];
export type RoleConfig = { baseUrl: string; model: string; key: string | null };
export type EvalConfig = Record<Role, RoleConfig | null>;

const SETTINGS = ["base-url", "model", "key"];
const KEY_NAME = /^[A-Z_][A-Z0-9_]*$/;

export const configPath = (work: string) => join(work, "eval.toml");

const isTable = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function roleOf(role: Role, table: unknown): RoleConfig {
    const where = `eval.toml: [models.${role}]`;
    if (!isTable(table)) {
        throw new EvalError(`${where} must be a table`);
    }
    const extra = Object.keys(table).filter((key) => !SETTINGS.includes(key));
    if (extra.length > 0) {
        throw new EvalError(`${where} has no setting ${extra.join(", ")}`);
    }
    const baseUrl = table["base-url"];
    const model = table.model;
    const key = table.key;
    if (typeof baseUrl !== "string" || !/^https?:\/\/\S+$/.test(baseUrl)) {
        throw new EvalError(`${where} needs base-url, an http or https URL`);
    }
    if (typeof model !== "string" || model.trim() === "") {
        throw new EvalError(`${where} needs model`);
    }
    // The message never repeats what was written, which may be a key.
    if (key !== undefined && (typeof key !== "string" || !KEY_NAME.test(key))) {
        throw new EvalError(
            `${where}: key names a variable, such as "OPENROUTER_API_KEY", never the key itself`,
        );
    }
    return { baseUrl, model, key: key ?? null };
}

export async function readEvalConfig(work: string): Promise<EvalConfig> {
    const config: EvalConfig = { generate: null, answer: null, judge: null };
    let text: string;
    try {
        text = await readFile(configPath(work), "utf8");
    } catch {
        return config;
    }
    let parsed: unknown;
    try {
        parsed = Bun.TOML.parse(text);
    } catch (error) {
        throw new EvalError(`eval.toml: ${(error as Error).message}`);
    }
    const models = isTable(parsed) ? (parsed.models ?? {}) : {};
    if (!isTable(models)) {
        throw new EvalError("eval.toml: [models] must be a table");
    }
    const unknown = Object.keys(models).filter(
        (name) => !(ROLES as readonly string[]).includes(name),
    );
    if (unknown.length > 0) {
        throw new EvalError(
            `eval.toml: no role ${unknown.join(", ")}; the roles are ${ROLES.join(", ")}`,
        );
    }
    for (const role of ROLES) {
        if (models[role] !== undefined) {
            config[role] = roleOf(role, models[role]);
        }
    }
    return config;
}

export function requireRole(config: EvalConfig, role: Role): RoleConfig {
    const found = config[role];
    if (found === null) {
        throw new EvalError(
            `eval.toml has no [models.${role}]: the README's evaluation section shows one`,
        );
    }
    return found;
}

// openai/gpt-oss-120b is openai's; gpt-4o, with no prefix, gpt's.
export const vendorOf = (model: string) =>
    model.includes("/")
        ? model.slice(0, model.indexOf("/"))
        : (model.split(/[-:]/)[0] ?? model);
```

- [ ] **Step 6: Write the client**

`packages/eval/src/models/client.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/models/client.ts
//
//

// The models of eval.toml over OpenAI-compatible Chat Completions, with
// one client per role, retries of its own and a cap on calls. The
// client's own retries are off: it does not retry a 429 without headers.

import type { Env } from "@dorothy/core";
import { ChatOpenAI } from "@langchain/openai";
import type { z } from "zod";
import { EvalError } from "../errors.js";
import { type EvalConfig, type Role, type RoleConfig, requireRole } from "./config.js";

export type Message = { role: "system" | "user"; content: string };
export type Completion = { text: string; input: number; output: number; ms: number };

// --max-calls spent: what is done is kept, and a run resumes.
export class CallCap extends EvalError {}

export type ModelsOptions = {
    env: Env;
    maxCalls?: number | null;
    timeoutMs?: number;
    // The first retry's wait; the second waits twice as long.
    retryMs?: number;
};

const statusOf = (error: unknown) => {
    const status = (error as { status?: unknown } | null)?.status;
    return typeof status === "number" ? status : null;
};

// A rate limit, a timeout, a server's fault or a lost connection may come
// right; a refusal will not.
function retryable(error: unknown): boolean {
    if (error instanceof EvalError) {
        return false;
    }
    const status = statusOf(error);
    return status === null || status === 408 || status === 429 || status >= 500;
}

// One line for a record: the status and the message's first line, which
// carry no key.
export function failureOf(error: unknown): string {
    const status = statusOf(error);
    const message = (error instanceof Error ? error.message : String(error))
        .split("\n")[0]
        ?.slice(0, 200);
    return status === null || message?.startsWith(String(status))
        ? (message ?? "failed")
        : `${status} ${message}`;
}

const textOf = (content: unknown): string =>
    typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
                .map((part) =>
                    typeof part === "object" && part !== null && "text" in part
                        ? String((part as { text: unknown }).text)
                        : "",
                )
                .join("")
          : "";

type Usage = { input_tokens?: number; output_tokens?: number } | undefined;

export class Models {
    #calls = 0;
    readonly #chats = new Map<Role, ChatOpenAI>();

    constructor(
        readonly config: EvalConfig,
        readonly options: ModelsOptions,
    ) {}

    get calls(): number {
        return this.#calls;
    }

    #keyOf(found: RoleConfig): string {
        if (found.key === null) {
            // A local server takes any key.
            return "none";
        }
        const key = this.options.env[found.key];
        if (key === undefined || key === "") {
            throw new EvalError(
                `${found.key} is not set: set it with \`dotenvx set ${found.key}\`, then run under \`dotenvx run --\``,
            );
        }
        return key;
    }

    chat(role: Role): ChatOpenAI {
        let chat = this.#chats.get(role);
        if (chat === undefined) {
            const found = requireRole(this.config, role);
            chat = new ChatOpenAI({
                model: found.model,
                apiKey: this.#keyOf(found),
                maxRetries: 0,
                timeout: this.options.timeoutMs ?? 120_000,
                configuration: { baseURL: found.baseUrl },
            });
            this.#chats.set(role, chat);
        }
        return chat;
    }

    // Each attempt spends one of --max-calls; a retryable failure is tried
    // twice more, waiting retryMs, then twice that.
    async call<T>(work: () => Promise<T>): Promise<T> {
        for (let attempt = 0; ; attempt++) {
            const cap = this.options.maxCalls ?? null;
            if (cap !== null && this.#calls >= cap) {
                throw new CallCap(`reached --max-calls (${cap})`);
            }
            this.#calls++;
            try {
                return await work();
            } catch (error) {
                if (attempt >= 2 || !retryable(error)) {
                    throw error;
                }
                await Bun.sleep((this.options.retryMs ?? 2000) * (attempt + 1));
            }
        }
    }

    async complete(role: Role, messages: Message[]): Promise<Completion> {
        const chat = this.chat(role);
        const started = performance.now();
        const reply = await this.call(() => chat.invoke(messages));
        const usage = reply.usage_metadata as Usage;
        return {
            text: textOf(reply.content),
            input: usage?.input_tokens ?? 0,
            output: usage?.output_tokens ?? 0,
            ms: Math.round(performance.now() - started),
        };
    }

    async structured<T>(
        role: Role,
        schema: z.ZodType<T>,
        name: string,
        messages: Message[],
    ): Promise<{ value: T; input: number; output: number }> {
        const chat = this.chat(role).withStructuredOutput(schema, {
            name,
            includeRaw: true,
        });
        const reply = (await this.call(async () => {
            try {
                return await chat.invoke(messages);
            } catch (error) {
                // A reply that breaks the schema: no retry mends it.
                if (Array.isArray((error as { issues?: unknown }).issues)) {
                    throw new EvalError("the model's reply did not match its schema");
                }
                throw error;
            }
        })) as unknown as { raw: { usage_metadata?: Usage }; parsed: T | null };
        if (reply.parsed === null) {
            throw new EvalError("the model's reply did not match its schema");
        }
        return {
            value: reply.parsed,
            input: reply.raw.usage_metadata?.input_tokens ?? 0,
            output: reply.raw.usage_metadata?.output_tokens ?? 0,
        };
    }
}
```

If `tsc` rejects `withStructuredOutput(schema, ...)` for a generic
`z.ZodType<T>`, cast the schema as `z.ZodType<Record<string, unknown>>`
at the call and the result as written; the probe in the spec's
Models section shows the shapes at run time.

- [ ] **Step 7: Run them to see them pass**

Run: `bun test packages/eval/src/models`
Expected: PASS, 16 tests.

- [ ] **Step 8: Add the files to the guide and commit**

In `packages/eval/AGENTS.md`'s Files, after `questions/mine.ts`:

```markdown
- `models/config.ts`: `eval.toml`, a base URL, model and key variable
  per role; `models/client.ts`: `Models`, one `ChatOpenAI` per role,
  with retries of its own (the client's are off: it does not retry a
  headerless 429) and the `--max-calls` cap.
```

Run: `bun run check`
Expected: exit 0.

```bash
bunx biome check --write packages/eval
git add packages/eval bun.lock
git commit -m "feat(eval): Call models over Chat Completions" \
  -m "eval.toml names a base URL, a model and a key's variable for each
role. Calls retry a rate limit or a fault twice and stop at a cap."
```

---

### Task 6: the systems

**Files:**

- Create: `packages/eval/src/systems/terms.ts`
- Create: `packages/eval/src/systems/corpus.ts`
- Create: `packages/eval/src/systems/system.ts`
- Create: `packages/eval/src/systems/dorothy.ts`
- Create: `packages/eval/src/systems/lexical.ts`
- Create: `packages/eval/src/systems/full.ts`
- Test: `packages/eval/src/systems/systems.test.ts`
- Modify: `packages/eval/AGENTS.md` (Files)

**Interfaces:**

- Consumes: `openArchive`, `Archive`, `ArchiveConversation`,
  `ArchiveKnowledge`, `ArchiveTurn` (Task 1); `EvalError`, `workEnv`,
  `snapshotFixture`, `tempRoot`, `TEA`, `GARDEN`, `READER` (Task 2).
- Produces:
  - `termsOf(text: string): string[]`, `scoreOf(text: string, terms:
    readonly string[]): number` (`terms.ts`)
  - `type Corpus = { archive: Archive; conversations: Map<string,
    ArchiveConversation>; knowledge: Map<string, ArchiveKnowledge>;
    close(): void }` (keyed by contract id); `openCorpus(env: Env):
    Promise<Corpus>`; `conversationText(conversation:
    ArchiveConversation, turns?: ArchiveTurn[]): string`;
    `knowledgeText(knowledge: ArchiveKnowledge): string`;
    `passage(conversation: ArchiveConversation, terms: readonly
    string[], chars: number): string`; `clip(text: string, chars:
    number): string` (`corpus.ts`)
  - `type Asked = { text: string; asOf: string; project: string |
    null; exclude: string | null }`; `type Retrieved = { ranked:
    string[]; context: string }`; `interface System { readonly name:
    string; retrieve(asked: Asked, budget: number):
    Promise<Retrieved>; prepare?(): Promise<void>; close?():
    Promise<void> }`; `SYSTEM_NAMES`; `makeSystem(name: string, corpus:
    Corpus): System`; `packItems(items: { id: string; text: string
    }[], budget: number): string` (`system.ts`)
  - `dorothySystem`, `lexicalSystem`, `fullSystem`, each `(corpus:
    Corpus) => System`

- [ ] **Step 1: Write the failing test**

`packages/eval/src/systems/systems.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/systems.test.ts
//
//

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { workEnv } from "../snapshot/snapshot.js";
import {
    GARDEN,
    READER,
    snapshotFixture,
    TEA,
    tempRoot,
} from "../testing.js";
import { type Corpus, openCorpus, passage } from "./corpus.js";
import { makeSystem, packItems, type Asked } from "./system.js";
import { scoreOf, termsOf } from "./terms.js";

let temp: ReturnType<typeof tempRoot>;
let corpus: Corpus;

beforeAll(async () => {
    temp = tempRoot("systems");
    corpus = await openCorpus(workEnv(await snapshotFixture(temp.root)));
});
afterAll(() => {
    corpus.close();
    temp.remove();
});

const asked = (text: string, exclude: string | null = null): Asked => ({
    text,
    asOf: "2026-10-19",
    project: null,
    exclude,
});

describe("terms", () => {
    it("keeps words of three letters or more, not the common ones", () => {
        expect(termsOf("What do I drink at four in the afternoon?")).toEqual([
            "drink",
            "four",
            "afternoon",
        ]);
    });

    it("counts the terms a text holds", () => {
        expect(
            scoreOf("I drink green tea at four.", ["drink", "four", "plot"]),
        ).toBe(2);
    });
});

describe("items", () => {
    it("pack within the budget, the last cut to fit", () => {
        const packed = packItems(
            [
                { id: "c:a", text: "x".repeat(50) },
                { id: "c:b", text: "y".repeat(50) },
            ],
            100,
        );
        expect(packed.length).toBeLessThanOrEqual(100);
        expect(packed).toStartWith('<item id="c:a">\n');
        expect(packed).toContain('<item id="c:b">');
    });

    it("pass the turns that match, with their neighbours", () => {
        const tea = corpus.conversations.get(`c:${TEA}`);
        if (tea === undefined) {
            throw new Error("the fixture lacks its tea");
        }
        const text = passage(tea, ["tea"], 1000);
        expect(text).toContain("green tea at four every afternoon");
        expect(text).toContain("Green tea at four, noted.");
        expect(passage(tea, ["tea"], 20).length).toBeLessThanOrEqual(20);
    });
});

describe("the lexical system", () => {
    it("ranks by the question's terms", async () => {
        const system = makeSystem("lexical", corpus);
        const found = await system.retrieve(
            asked("What do I drink at four in the afternoon?"),
            4000,
        );
        expect(found.ranked.slice(0, 2)).toEqual([`c:${TEA}`, `c:${READER}`]);
        expect(found.context.length).toBeLessThanOrEqual(4000);
        expect(found.context).toContain(`<item id="c:${TEA}">`);
    });

    it("leaves out the conversation a question came from", async () => {
        const found = await makeSystem("lexical", corpus).retrieve(
            asked("What do I drink in the afternoon?", READER),
            4000,
        );
        expect(found.ranked).not.toContain(`c:${READER}`);
    });
});

describe("the full system", () => {
    it("gives everything newest first, as far as the budget goes", async () => {
        const system = makeSystem("full", corpus);
        const all = await system.retrieve(asked("anything"), 400_000);
        expect(all.ranked[0]).toBe(`c:${READER}`);
        expect(all.ranked).toHaveLength(7);
        const some = await system.retrieve(asked("anything"), 300);
        expect(some.ranked.length).toBeLessThan(7);
        expect(some.context.length).toBeLessThanOrEqual(300);
    });
});

describe("the dorothy system", () => {
    it("gives her block and her search's hits", async () => {
        const found = await makeSystem("dorothy", corpus).retrieve(
            asked("Where is my allotment plot?"),
            8000,
        );
        expect(found.ranked).toContain(`c:${GARDEN}`);
        expect(found.context).toContain("<memory>");
        expect(found.context).toContain(`<item id="c:${GARDEN}">`);
        expect(found.context.length).toBeLessThanOrEqual(8000);
    });

    it("leaves out the conversation a question came from", async () => {
        const found = await makeSystem("dorothy", corpus).retrieve(
            asked("What do I drink in the afternoon?", READER),
            8000,
        );
        expect(found.ranked).not.toContain(`c:${READER}`);
    });
});

describe("makeSystem", () => {
    it("names the systems it has when asked for another", () => {
        expect(() => makeSystem("hindsight", corpus)).toThrow(
            "no system hindsight; the systems are dorothy, lexical, full",
        );
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test packages/eval/src/systems`
Expected: FAIL, "Cannot find module './corpus.js'".

- [ ] **Step 3: Write the terms**

`packages/eval/src/systems/terms.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/terms.ts
//
//

// Words as plain grep would weigh them: a question's terms, and how many
// of them a text holds.

const COMMON = new Set([
    "about", "after", "all", "also", "and", "any", "are", "before", "but",
    "can", "could", "did", "does", "for", "from", "had", "has", "have",
    "her", "hers", "him", "his", "how", "into", "its", "just", "may",
    "might", "more", "most", "must", "not", "our", "over", "she", "should",
    "some", "such", "than", "that", "the", "their", "them", "then", "there",
    "these", "they", "this", "those", "very", "was", "were", "what", "when",
    "where", "which", "who", "whom", "why", "will", "with", "would", "you",
    "your", "user", "dorothy",
]);

const wordsOf = (text: string) =>
    text.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u);

export function termsOf(text: string): string[] {
    const terms = new Set<string>();
    for (const word of wordsOf(text)) {
        if (word.length >= 3 && !COMMON.has(word)) {
            terms.add(word);
        }
    }
    return [...terms];
}

export function scoreOf(text: string, terms: readonly string[]): number {
    const words = new Set(wordsOf(text));
    return terms.filter((term) => words.has(term)).length;
}
```

Biome will reflow the list one word a line; leave its layout.

- [ ] **Step 4: Write the corpus**

`packages/eval/src/systems/corpus.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/corpus.ts
//
//

// The snapshot's archive, opened once for every system, and its items as
// text a model reads.

import type { Env } from "@dorothy/core";
import {
    type Archive,
    type ArchiveConversation,
    type ArchiveKnowledge,
    type ArchiveTurn,
    openArchive,
} from "@dorothy/memory/evaluation";
import { scoreOf } from "./terms.js";

export type Corpus = {
    archive: Archive;
    // By contract id.
    conversations: Map<string, ArchiveConversation>;
    knowledge: Map<string, ArchiveKnowledge>;
    close(): void;
};

export async function openCorpus(env: Env): Promise<Corpus> {
    const archive = await openArchive(env);
    try {
        return {
            archive,
            conversations: new Map(
                archive.conversations().map((each) => [each.id, each]),
            ),
            knowledge: new Map(
                (await archive.knowledge()).map((each) => [each.id, each]),
            ),
            close: () => archive.close(),
        };
    } catch (error) {
        archive.close();
        throw error;
    }
}

export const clip = (text: string, chars: number) =>
    text.length <= chars ? text : text.slice(0, Math.max(0, chars));

const day = (at: string) => at.slice(0, 10);
const minute = (at: string) => at.slice(0, 16).replace("T", " ");

export function conversationText(
    conversation: ArchiveConversation,
    turns: ArchiveTurn[] = conversation.turns,
): string {
    const project =
        conversation.project === null ? "" : ` (${conversation.project})`;
    const head = `${conversation.title ?? "Untitled"}${project}, ${day(conversation.firstAt)} to ${day(conversation.lastAt)}`;
    return [
        head,
        ...turns.map(
            (turn) => `[${turn.n}] ${turn.role}, ${minute(turn.at)}: ${turn.text}`,
        ),
    ].join("\n");
}

export function knowledgeText(knowledge: ArchiveKnowledge): string {
    const retired =
        knowledge.retired === null
            ? ""
            : `, retired ${day(knowledge.retired.at)}: ${knowledge.retired.why}`;
    return [
        `${knowledge.title} (${knowledge.type}, ${knowledge.scope}, ${day(knowledge.at)}${retired})`,
        knowledge.description,
        knowledge.body,
    ]
        .filter((line) => line !== "")
        .join("\n");
}

// The turns that best match terms, each with its neighbours, in order,
// within chars; the first turns where none match.
export function passage(
    conversation: ArchiveConversation,
    terms: readonly string[],
    chars: number,
): string {
    const turns = conversation.turns;
    const scored = turns
        .map((turn, at) => ({ at, score: scoreOf(turn.text, terms) }))
        .filter((each) => each.score > 0)
        .sort((a, b) => b.score - a.score || a.at - b.at);
    const order = scored.length > 0 ? scored : [{ at: 0, score: 0 }];
    const chosen = new Set<number>();
    const render = () =>
        conversationText(
            conversation,
            [...chosen]
                .sort((a, b) => a - b)
                .map((at) => turns[at] as ArchiveTurn),
        );
    for (const { at } of order) {
        for (const near of [at, at - 1, at + 1]) {
            if (near < 0 || near >= turns.length || chosen.has(near)) {
                continue;
            }
            chosen.add(near);
            if (render().length > chars) {
                chosen.delete(near);
                return clip(render(), chars);
            }
        }
    }
    return clip(render(), chars);
}
```

- [ ] **Step 5: Write the interface and the three systems**

`packages/eval/src/systems/system.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/system.ts
//
//

// What every system meets: a question, a budget of characters, and back
// its ids best first with the context the answering model reads.

import { EvalError } from "../errors.js";
import type { Corpus } from "./corpus.js";
import { dorothySystem } from "./dorothy.js";
import { fullSystem } from "./full.js";
import { lexicalSystem } from "./lexical.js";

export type Asked = {
    text: string;
    asOf: string;
    project: string | null;
    // The phrase of a conversation left out of retrieval.
    exclude: string | null;
};
// Contract ids best first, for evidence recall, and the context.
export type Retrieved = { ranked: string[]; context: string };

export interface System {
    readonly name: string;
    retrieve(asked: Asked, budget: number): Promise<Retrieved>;
    // For systems with a store of their own, as providers have.
    prepare?(): Promise<void>;
    close?(): Promise<void>;
}

const MAKERS = {
    dorothy: dorothySystem,
    lexical: lexicalSystem,
    full: fullSystem,
} as const;
export const SYSTEM_NAMES = Object.keys(MAKERS) as (keyof typeof MAKERS)[];

export function makeSystem(name: string, corpus: Corpus): System {
    const make = MAKERS[name as keyof typeof MAKERS];
    if (make === undefined) {
        throw new EvalError(
            `no system ${name}; the systems are ${SYSTEM_NAMES.join(", ")}`,
        );
    }
    return make(corpus);
}

// Items as <item> elements within budget, the last one cut to fit.
export function packItems(
    items: { id: string; text: string }[],
    budget: number,
): string {
    const parts: string[] = [];
    let left = budget;
    for (const item of items) {
        const open = `<item id="${item.id}">\n`;
        const close = "\n</item>\n";
        const room = left - open.length - close.length;
        if (room <= 0) {
            break;
        }
        const text = item.text.slice(0, room);
        parts.push(open + text + close);
        left -= open.length + text.length + close.length;
        if (text.length < item.text.length) {
            break;
        }
    }
    return parts.join("");
}
```

`system.ts` imports the three makers and they import `packItems` from
it; the cycle is safe, as nothing runs at import time but `MAKERS`,
which holds functions already hoisted. If Bun reports one of them
undefined at load, move `packItems` and the types into
`systems/items.ts` and import them from there in all four files.

`packages/eval/src/systems/lexical.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/lexical.ts
//
//

// The bound from below: every turn and knowledge file scored by how many
// of the question's terms it holds, with no index, as grep would find.

import { type Corpus, knowledgeText, passage } from "./corpus.js";
import { packItems, type System } from "./system.js";
import { scoreOf, termsOf } from "./terms.js";

type Scored = { id: string; score: number; at: string; text: () => string };

const newestFirst = (a: Scored, b: Scored) =>
    b.score - a.score ||
    (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) ||
    (a.id < b.id ? -1 : 1);

export function lexicalSystem(corpus: Corpus): System {
    return {
        name: "lexical",
        async retrieve(asked, budget) {
            const terms = termsOf(asked.text);
            const scored: Scored[] = [];
            for (const conversation of corpus.conversations.values()) {
                if (conversation.phrase === asked.exclude) {
                    continue;
                }
                const score = Math.max(
                    0,
                    ...conversation.turns.map((turn) =>
                        scoreOf(turn.text, terms),
                    ),
                );
                if (score > 0) {
                    scored.push({
                        id: conversation.id,
                        score,
                        at: conversation.lastAt,
                        text: () =>
                            passage(conversation, terms, Math.floor(budget / 3)),
                    });
                }
            }
            for (const knowledge of corpus.knowledge.values()) {
                const score = scoreOf(knowledgeText(knowledge), terms);
                if (score > 0) {
                    scored.push({
                        id: knowledge.id,
                        score,
                        at: knowledge.at,
                        text: () => knowledgeText(knowledge),
                    });
                }
            }
            scored.sort(newestFirst);
            const best = scored.slice(0, 20);
            return {
                ranked: best.slice(0, 10).map((each) => each.id),
                context: packItems(
                    best.map((each) => ({ id: each.id, text: each.text() })),
                    budget,
                ),
            };
        },
    };
}
```

`packages/eval/src/systems/full.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/full.ts
//
//

// The bound from above, where it fits: everything, newest first, until
// the budget. Its ranked ids are what fitted.

import { type Corpus, conversationText, knowledgeText } from "./corpus.js";
import { packItems, type System } from "./system.js";

export function fullSystem(corpus: Corpus): System {
    return {
        name: "full",
        async retrieve(asked, budget) {
            const items = [
                ...[...corpus.conversations.values()]
                    .filter((each) => each.phrase !== asked.exclude)
                    .map((each) => ({
                        id: each.id,
                        at: each.lastAt,
                        text: conversationText(each),
                    })),
                ...[...corpus.knowledge.values()].map((each) => ({
                    id: each.id,
                    at: each.at,
                    text: knowledgeText(each),
                })),
            ].sort(
                (a, b) =>
                    (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) ||
                    (a.id < b.id ? -1 : 1),
            );
            const context = packItems(items, budget);
            return {
                ranked: items
                    .map((each) => each.id)
                    .filter((id) => context.includes(`<item id="${id}">`)),
                context,
            };
        },
    };
}
```

`packages/eval/src/systems/dorothy.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/dorothy.ts
//
//

// Her memory as a harness gets it today, without a model choosing the
// calls: the opening block for the question's project, then search over
// every scope, then the top hits opened until the budget is spent.

import {
    type Corpus,
    clip,
    knowledgeText,
    passage,
} from "./corpus.js";
import { packItems, type System } from "./system.js";
import { termsOf } from "./terms.js";

// The block's share of the budget; the hits take the rest.
const BLOCK_SHARE = 0.4;

export function dorothySystem(corpus: Corpus): System {
    return {
        name: "dorothy",
        async retrieve(asked, budget) {
            const block = await corpus.archive.block({
                project: asked.project,
                budget: Math.floor(budget * BLOCK_SHARE),
                exclude: asked.exclude,
            });
            const hits = await corpus.archive.engine.search({
                query: asked.text,
                within: "all",
                kind: "all",
                limit: 10,
                project: asked.project,
                exclude: asked.exclude,
            });
            const terms = termsOf(asked.text);
            const opened = hits.map((hit) => {
                const conversation = corpus.conversations.get(hit.id);
                const knowledge = corpus.knowledge.get(hit.id);
                return {
                    id: hit.id,
                    text:
                        conversation !== undefined
                            ? passage(conversation, terms, Math.floor(budget / 4))
                            : knowledge !== undefined
                              ? knowledgeText(knowledge)
                              : `${hit.title}: ${hit.snippet}`,
                };
            });
            const left = budget - block.text.length - 1;
            return {
                ranked: hits.map((hit) => hit.id),
                context: clip(
                    `${block.text}\n${packItems(opened, Math.max(0, left))}`,
                    budget,
                ),
            };
        },
    };
}
```

- [ ] **Step 6: Run it to see it pass**

Run: `bun test packages/eval/src/systems`
Expected: PASS, 10 tests. If the lexical test finds READER's
conversation above TEA's, check `scoreOf`: TEA's first turn holds
"drink", "four" and "afternoon"; READER's holds "drink" and
"afternoon".

- [ ] **Step 7: Add the files to the guide and commit**

In `packages/eval/AGENTS.md`'s Files, after `models/client.ts`:

```markdown
- `systems/`: `System` and `makeSystem` (`system.ts`); the corpus, the
  snapshot's archive opened once, with items as text (`corpus.ts`);
  `termsOf` and `scoreOf` (`terms.ts`); and the three systems,
  `dorothy.ts`, `lexical.ts` and `full.ts`. A new system is a maker in
  `system.ts`'s table.
```

```bash
bunx biome check --write packages/eval
git add packages/eval
git commit -m "feat(eval): Ask three systems through one interface" \
  -m "Dorothy as a harness gets her today, a lexical bound from below and
a full-context bound from above, each over the snapshot's archive."
```

---
### Task 7: generating questions

**Files:**

- Create: `packages/eval/src/questions/generate.ts`
- Create: `packages/eval/src/questions/generate-command.ts`
- Test: `packages/eval/src/questions/generate.test.ts`
- Modify: `packages/eval/src/cli.ts` (the `generate` command)
- Modify: `packages/eval/AGENTS.md` (Files)

**Interfaces:**

- Consumes: `Corpus`, `openCorpus`, `conversationText`, `knowledgeText`,
  `clip` (Task 6); `packItems` (Task 6); `termsOf`, `scoreOf` (Task 6);
  `Models`, `CallCap`, `Message`, `readEvalConfig`, `requireRole`
  (Task 5); `Question`, `QuestionType`, `questionId`, `questionSchema`,
  `readQuestionsToRewrite`, `writeQuestions` (Task 3); `Command`,
  `workOf`, `intOf`, `stringOf`, `readSnapshot`, `workEnv`, `EvalError`
  (Task 2); `stubModels`, `stubConfig`, `snapshotFixture`, `fakeIo`,
  `tempRoot` (Tasks 2, 5).
- Produces:
  - `type GeneratedType = Exclude<QuestionType, "lookup">`,
    `GENERATED_TYPES`, `SHARES`, `BATCH` (5)
  - `countsFor(count: number, given?: Partial<Record<GeneratedType,
    number>>): Record<GeneratedType, number>`
  - `parseTypeCounts(values: readonly string[]):
    Partial<Record<GeneratedType, number>>`
  - `seeded(seed: number): () => number`
  - `type Sample = { type: GeneratedType; items: { id: string; text:
    string }[]; ids: string[]; asOf: string; project: string | null }`
  - `sampleFor(type: GeneratedType, corpus: Corpus, random: () =>
    number, today: string): Sample | null`
  - `type Draft = { question: string; answer: string; evidence:
    string[]; older: string }`, `draftsSchema`
  - `draftPrompt(sample: Sample, n: number): Message[]`
  - `acceptDraft(draft: Draft, sample: Sample, context: { model:
    string; ids: Set<string>; corpus: Corpus }): Question | string`
    (a string is why it was dropped)
  - `answerable(question: string, corpus: Corpus): boolean`
  - `generateQuestions(options: { corpus: Corpus; counts:
    Record<GeneratedType, number>; random: () => number; model: string;
    existing: Question[]; today: string; draft: (sample: Sample, n:
    number) => Promise<Draft[]> }): Promise<{ made: Question[];
    dropped: Record<string, number>; stopped: string | null }>`
  - `latestDay(corpus: Corpus): string | null`
  - `generateCommand: Command`

- [ ] **Step 1: Write the failing test**

`packages/eval/src/questions/generate.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/generate.test.ts
//
//

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../cli.js";
import { CallCap } from "../models/client.js";
import { configPath } from "../models/config.js";
import { workEnv } from "../snapshot/snapshot.js";
import { type Corpus, openCorpus } from "../systems/corpus.js";
import {
    fakeIo,
    GARDEN,
    snapshotFixture,
    stubConfig,
    stubModels,
    tempRoot,
} from "../testing.js";
import { readQuestions } from "./file.js";
import {
    acceptDraft,
    countsFor,
    type Draft,
    generateQuestions,
    parseTypeCounts,
    type Sample,
    sampleFor,
    seeded,
} from "./generate.js";

let temp: ReturnType<typeof tempRoot>;
let work: string;
let corpus: Corpus;

beforeAll(async () => {
    temp = tempRoot("generate");
    work = await snapshotFixture(temp.root);
    corpus = await openCorpus(workEnv(work));
});
afterAll(() => {
    corpus.close();
    temp.remove();
});

const garden: Sample = {
    type: "single-session",
    items: [{ id: `c:${GARDEN}`, text: "The allotment" }],
    ids: [`c:${GARDEN}`],
    asOf: "2026-10-01",
    project: null,
};
const draft = (fields: Partial<Draft> = {}): Draft => ({
    question: "Which plot is my allotment?",
    answer: "Plot twelve, by the river.",
    evidence: [`c:${GARDEN}`],
    older: "",
    ...fields,
});
const context = () => ({ model: "m/1", ids: new Set<string>(), corpus });

describe("counts", () => {
    it("follow LongMemEval-S's shares, scaled", () => {
        expect(countsFor(530)).toEqual({
            "single-session": 126,
            preference: 30,
            "multi-session": 133,
            "knowledge-update": 78,
            temporal: 133,
            abstention: 30,
        });
        expect(countsFor(300, { temporal: 40 }).temporal).toBe(40);
    });

    it("are read from type=count", () => {
        expect(parseTypeCounts(["temporal=40", "preference=0"])).toEqual({
            temporal: 40,
            preference: 0,
        });
        expect(() => parseTypeCounts(["lookup=3"])).toThrow(
            "--type takes single-session, preference",
        );
        expect(() => parseTypeCounts(["temporal=many"])).toThrow(
            "--type takes",
        );
    });
});

describe("samples", () => {
    it("repeat for a seed", () => {
        const [a, b] = [seeded(7), seeded(7)];
        expect([a(), a(), a()]).toEqual([b(), b(), b()]);
        expect(seeded(8)()).not.toBe(seeded(7)());
    });

    it("take one conversation for a single session", () => {
        const sample = sampleFor("single-session", corpus, seeded(1), "2026-10-19");
        expect(sample?.ids).toHaveLength(1);
        expect(sample?.ids[0]).toStartWith("c:");
    });

    it("take live personal preferences, never a retired one", () => {
        const sample = sampleFor("preference", corpus, seeded(1), "2026-10-19");
        expect(sample?.ids.sort()).toEqual([
            "k:personal/prefers-mornings",
            "k:personal/uses-helix",
        ]);
    });

    it("show a retired file beside the live ones that may replace it", () => {
        const sample = sampleFor(
            "knowledge-update",
            corpus,
            seeded(1),
            "2026-10-19",
        );
        expect(sample?.items[0]?.id).toBe("k:personal/uses-vim");
        expect(sample?.ids).not.toContain("k:personal/uses-vim");
        expect(sample?.ids).toContain("k:personal/uses-helix");
    });

    it("find nothing for many sessions where none share a project or tag", () => {
        expect(
            sampleFor("multi-session", corpus, seeded(1), "2026-10-19"),
        ).toBeNull();
    });

    it("show the topics there are for an abstention, with no evidence", () => {
        const sample = sampleFor("abstention", corpus, seeded(1), "2026-10-19");
        expect(sample?.ids).toEqual([]);
        expect(sample?.items[0]?.text).toContain("Tea at four");
    });
});

describe("a draft", () => {
    it("becomes a draft question", () => {
        expect(acceptDraft(draft(), garden, context())).toMatchObject({
            type: "single-session",
            evidence: [`c:${GARDEN}`],
            exclude: null,
            asOf: "2026-10-01",
            source: "generated:m/1",
            status: "draft",
            note: null,
        });
    });

    it("is dropped for evidence outside its sample, or an empty answer", () => {
        expect(acceptDraft(draft({ evidence: ["c:x"] }), garden, context())).toBe(
            "evidence not in its sample",
        );
        expect(acceptDraft(draft({ answer: " " }), garden, context())).toBe(
            "empty",
        );
        expect(acceptDraft(draft({ evidence: [] }), garden, context())).toBe(
            "no evidence",
        );
    });

    it("is dropped as an abstention the snapshot can answer", () => {
        const topics: Sample = { ...garden, type: "abstention", ids: [] };
        expect(
            acceptDraft(
                draft({
                    question: "What do I drink at four every afternoon?",
                    evidence: [],
                }),
                topics,
                context(),
            ),
        ).toBe("answerable");
        expect(
            acceptDraft(
                draft({
                    question: "What colour is my canoe on the lake?",
                    answer: "The memory does not say.",
                    evidence: ["c:x"],
                }),
                topics,
                context(),
            ),
        ).toMatchObject({ type: "abstention", evidence: [] });
    });

    it("keeps an update's older answer as its note", () => {
        const update: Sample = {
            ...garden,
            type: "knowledge-update",
            ids: ["k:personal/uses-helix"],
        };
        expect(
            acceptDraft(
                draft({
                    question: "Which editor do I use?",
                    answer: "Helix.",
                    evidence: ["k:personal/uses-helix"],
                    older: "Vim.",
                }),
                update,
                context(),
            ),
        ).toMatchObject({ note: "Vim." });
    });
});

describe("generation", () => {
    const counts = {
        "single-session": 2,
        preference: 0,
        "multi-session": 1,
        "knowledge-update": 0,
        temporal: 0,
        abstention: 0,
    };

    it("asks until it has the counts, and says what it dropped", async () => {
        let n = 0;
        const result = await generateQuestions({
            corpus,
            counts,
            random: seeded(3),
            model: "m/1",
            existing: [],
            today: "2026-10-19",
            draft: async (sample) => [
                {
                    question: `Question ${++n}?`,
                    answer: "An answer.",
                    evidence: sample.ids,
                    older: "",
                },
            ],
        });
        expect(result.made).toHaveLength(2);
        expect(result.dropped).toEqual({ "no material for multi-session": 1 });
        expect(result.stopped).toBeNull();
    });

    it("stops at the cap, keeping what it made", async () => {
        const result = await generateQuestions({
            corpus,
            counts,
            random: seeded(3),
            model: "m/1",
            existing: [],
            today: "2026-10-19",
            draft: async () => {
                throw new CallCap("reached --max-calls (0)");
            },
        });
        expect(result.made).toEqual([]);
        expect(result.stopped).toBe("reached --max-calls (0)");
    });
});

describe("bun run eval -- generate", () => {
    let stub: ReturnType<typeof stubModels> | null = null;
    afterEach(() => {
        stub?.stop();
        stub = null;
    });

    it("drafts questions and records its seed", async () => {
        stub = stubModels((request) => {
            const content = JSON.stringify(request.body.messages);
            const id = /<item id=\\"([^\\]+)\\">/.exec(content)?.[1] ?? "";
            return {
                json: {
                    questions: [
                        {
                            question: "What did I say there?",
                            answer: "Something.",
                            evidence: [id],
                            older: "",
                        },
                    ],
                },
            };
        });
        writeFileSync(configPath(work), stubConfig(stub.url));
        const { io, out } = fakeIo();
        const code = await runCli(
            [
                "generate",
                "--work",
                work,
                "--count",
                "1",
                "--type",
                "single-session=1",
                "--seed",
                "5",
            ],
            io,
        );
        expect(code).toBe(0);
        expect(out.join("")).toContain("drafted 1 questions (seed 5)");
        const { questions } = await readQuestions(work);
        expect(questions.at(-1)).toMatchObject({
            status: "draft",
            source: "generated:generate/model",
        });
        const record = JSON.parse(
            readFileSync(join(work, "generated.json"), "utf8"),
        );
        expect(record.at(-1)).toMatchObject({ seed: 5, model: "generate/model" });
        expect(
            (stub.requests[0]?.body.response_format as { type: string }).type,
        ).toBe("json_schema");
    });

    it("counts its calls on a dry run, and makes none", async () => {
        stub = stubModels(() => ({ content: "" }));
        writeFileSync(configPath(work), stubConfig(stub.url));
        const { io, out } = fakeIo();
        expect(
            await runCli(
                ["generate", "--work", work, "--count", "300", "--dry-run"],
                io,
            ),
        ).toBe(0);
        expect(out.join("")).toContain("dry run: at least 62 calls");
        expect(stub.requests).toHaveLength(0);
    });
});
```

The regular expression in the first command test reads the first
`<item id="...">` out of the JSON-encoded request, where each `"` is
written `\"`.

- [ ] **Step 2: Run it to see it fail**

Run: `bun test packages/eval/src/questions/generate.test.ts`
Expected: FAIL, "Cannot find module './generate.js'".

- [ ] **Step 3: Write the generation**

`packages/eval/src/questions/generate.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/generate.ts
//
//

// Questions a model drafts from samples of the snapshot, in LongMemEval's
// types, each checked before it is kept as a draft for the owner.

import type { ArchiveConversation } from "@dorothy/memory/evaluation";
import { z } from "zod";
import { EvalError } from "../errors.js";
import { CallCap, type Message } from "../models/client.js";
import {
    clip,
    type Corpus,
    conversationText,
    knowledgeText,
} from "../systems/corpus.js";
import { packItems } from "../systems/system.js";
import { scoreOf, termsOf } from "../systems/terms.js";
import {
    type Question,
    type QuestionType,
    questionId,
    questionSchema,
} from "./file.js";

export type GeneratedType = Exclude<QuestionType, "lookup">;

// LongMemEval-S's 500 questions by type, with its 30 abstentions beside.
export const SHARES: Record<GeneratedType, number> = {
    "single-session": 126,
    preference: 30,
    "multi-session": 133,
    "knowledge-update": 78,
    temporal: 133,
    abstention: 30,
};
export const GENERATED_TYPES = Object.keys(SHARES) as GeneratedType[];
// Questions asked of one sample in one call.
export const BATCH = 5;

export function countsFor(
    count: number,
    given: Partial<Record<GeneratedType, number>> = {},
): Record<GeneratedType, number> {
    const total = Object.values(SHARES).reduce((sum, each) => sum + each, 0);
    return Object.fromEntries(
        GENERATED_TYPES.map((type) => [
            type,
            given[type] ?? Math.round((count * SHARES[type]) / total),
        ]),
    ) as Record<GeneratedType, number>;
}

export function parseTypeCounts(
    values: readonly string[],
): Partial<Record<GeneratedType, number>> {
    const counts: Partial<Record<GeneratedType, number>> = {};
    for (const value of values) {
        const match = /^([a-z-]+)=(\d{1,4})$/.exec(value);
        const type = match?.[1] as GeneratedType | undefined;
        if (match === null || type === undefined || !(type in SHARES)) {
            throw new EvalError(
                `--type takes ${GENERATED_TYPES.join(", ")}, each as type=count`,
            );
        }
        counts[type] = Number(match[2]);
    }
    return counts;
}

// mulberry32: small, and the same everywhere for a seed.
export function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const pick = <T>(items: readonly T[], random: () => number): T | undefined =>
    items[Math.floor(random() * items.length)];

function shuffled<T>(items: readonly T[], random: () => number): T[] {
    const copy = [...items];
    for (let at = copy.length - 1; at > 0; at--) {
        const other = Math.floor(random() * (at + 1));
        [copy[at], copy[other]] = [copy[other] as T, copy[at] as T];
    }
    return copy;
}

export type Sample = {
    type: GeneratedType;
    // What the model reads.
    items: { id: string; text: string }[];
    // What evidence may name.
    ids: string[];
    asOf: string;
    project: string | null;
};

// Conversations by a project or a tag they share, two or more a group.
function groupsOf(conversations: ArchiveConversation[]) {
    const groups = new Map<string, ArchiveConversation[]>();
    for (const conversation of conversations) {
        const keys = [
            ...(conversation.project === null
                ? []
                : [`project:${conversation.project}`]),
            ...conversation.tags.map((tag) => `tag:${tag}`),
        ];
        for (const key of keys) {
            groups.set(key, [...(groups.get(key) ?? []), conversation]);
        }
    }
    return new Map(
        [...groups].filter(([, members]) => members.length >= 2).sort(),
    );
}

export function sampleFor(
    type: GeneratedType,
    corpus: Corpus,
    random: () => number,
    today: string,
): Sample | null {
    const conversations = [...corpus.conversations.values()];
    const knowledge = [...corpus.knowledge.values()];
    switch (type) {
        case "single-session":
        case "temporal": {
            const chosen = pick(
                conversations.filter((each) => each.turns.length >= 2),
                random,
            );
            return chosen === undefined
                ? null
                : {
                      type,
                      items: [
                          {
                              id: chosen.id,
                              text: clip(conversationText(chosen), 12_000),
                          },
                      ],
                      ids: [chosen.id],
                      asOf: today,
                      project: chosen.project,
                  };
        }
        case "preference": {
            const chosen = shuffled(
                knowledge.filter(
                    (each) =>
                        each.retired === null &&
                        each.scope === "personal" &&
                        (each.type === "user" || each.type === "feedback"),
                ),
                random,
            ).slice(0, 8);
            return chosen.length === 0
                ? null
                : {
                      type,
                      items: chosen.map((each) => ({
                          id: each.id,
                          text: knowledgeText(each),
                      })),
                      ids: chosen.map((each) => each.id),
                      asOf: today,
                      project: null,
                  };
        }
        case "multi-session": {
            const groups = groupsOf(conversations);
            const key = pick([...groups.keys()], random);
            if (key === undefined) {
                return null;
            }
            const chosen = shuffled(groups.get(key) ?? [], random).slice(0, 3);
            return {
                type,
                items: chosen.map((each) => ({
                    id: each.id,
                    text: clip(conversationText(each), 5000),
                })),
                ids: chosen.map((each) => each.id),
                asOf: today,
                project: key.startsWith("project:")
                    ? key.slice("project:".length)
                    : null,
            };
        }
        case "knowledge-update": {
            const retired = pick(
                knowledge.filter((each) => each.retired !== null),
                random,
            );
            if (retired === undefined) {
                return null;
            }
            const live = shuffled(
                knowledge.filter(
                    (each) =>
                        each.retired === null &&
                        each.scope === retired.scope &&
                        each.type === retired.type,
                ),
                random,
            ).slice(0, 6);
            return live.length === 0
                ? null
                : {
                      type,
                      items: [retired, ...live].map((each) => ({
                          id: each.id,
                          text: knowledgeText(each),
                      })),
                      // The retired file is never the answer's evidence.
                      ids: live.map((each) => each.id),
                      asOf: today,
                      project: retired.scope === "personal" ? null : retired.scope,
                  };
        }
        case "abstention": {
            const titles = [
                ...conversations.map((each) => each.title ?? ""),
                ...knowledge.map((each) => each.title),
            ].filter((title) => title !== "");
            return {
                type,
                items: [
                    {
                        id: "topics",
                        text: shuffled(titles, random).slice(0, 80).join("\n"),
                    },
                ],
                ids: [],
                asOf: today,
                project: null,
            };
        }
    }
}

export type Draft = {
    question: string;
    answer: string;
    evidence: string[];
    older: string;
};
// Every field required, as strict structured output asks.
export const draftsSchema = z.object({
    questions: z.array(
        z.object({
            question: z.string(),
            answer: z.string(),
            evidence: z.array(z.string()),
            older: z.string(),
        }),
    ),
});

const COMMON = [
    "You write questions for testing a personal memory: an assistant's",
    "memory of its past conversations with its user and of what it knows",
    "of them. Write questions the user might really ask the assistant",
    "later, in their own voice, answerable only from the items given. Each",
    "question has: question; answer, short and complete; evidence, the ids",
    "of the items that hold the answer; and older, empty unless the",
    "guidance below asks for it.",
].join(" ");

const GUIDANCE: Record<GeneratedType, string> = {
    "single-session":
        "Ask about one specific detail stated in this conversation.",
    temporal:
        "Ask when something happened, the order of events, or how long passed between them; the answer is a date, an order or a span, read from the dated turns.",
    preference:
        "Ask for advice or a recommendation whose best answer depends on one of these preferences, without naming it. The answer says what a good reply takes into account.",
    "multi-session":
        "Ask something whose answer needs details from at least two of these conversations, and give each one's id in evidence.",
    "knowledge-update":
        "The first item was retired. If one of the others replaced it, ask what is true now: the answer is the newer fact, evidence its id, and older the retired fact's claim. If none replaced it, return no questions.",
    abstention:
        "These are the topics the memory holds. Ask questions about the user's life that sound plausible but that nothing here could answer. The answer says the memory does not know; evidence is empty.",
};

export function draftPrompt(sample: Sample, n: number): Message[] {
    return [
        {
            role: "system",
            content: `${COMMON}\n\n${GUIDANCE[sample.type]}\n\nToday is ${sample.asOf}. Write at most ${n} questions.`,
        },
        { role: "user", content: packItems(sample.items, 16_000) },
    ];
}

// Whether the snapshot holds enough of a question's terms together for
// it to be answerable; such an abstention is dropped.
export function answerable(question: string, corpus: Corpus): boolean {
    const terms = termsOf(question);
    if (terms.length === 0) {
        return false;
    }
    const enough = Math.max(2, Math.ceil(terms.length / 2));
    for (const conversation of corpus.conversations.values()) {
        if (conversation.turns.some((turn) => scoreOf(turn.text, terms) >= enough)) {
            return true;
        }
    }
    for (const knowledge of corpus.knowledge.values()) {
        if (scoreOf(knowledgeText(knowledge), terms) >= enough) {
            return true;
        }
    }
    return false;
}

export function acceptDraft(
    draft: Draft,
    sample: Sample,
    context: { model: string; ids: Set<string>; corpus: Corpus },
): Question | string {
    const question = draft.question.trim();
    const answer = draft.answer.trim();
    if (question === "" || answer === "") {
        return "empty";
    }
    const abstention = sample.type === "abstention";
    const evidence = abstention ? [] : [...new Set(draft.evidence)];
    if (evidence.some((id) => !sample.ids.includes(id))) {
        return "evidence not in its sample";
    }
    if (!abstention && evidence.length === 0) {
        return "no evidence";
    }
    if (sample.type === "multi-session" && evidence.length < 2) {
        return "one conversation";
    }
    if (abstention && answerable(question, context.corpus)) {
        return "answerable";
    }
    const id = questionId(question, evidence);
    if (context.ids.has(id)) {
        return "duplicate";
    }
    const older = draft.older.trim();
    const parsed = questionSchema.safeParse({
        id,
        type: sample.type,
        question,
        answer,
        evidence,
        exclude: null,
        asOf: sample.asOf,
        project: sample.project,
        source: `generated:${context.model}`,
        status: "draft",
        note: sample.type === "knowledge-update" && older !== "" ? older : null,
    });
    return parsed.success ? parsed.data : "malformed";
}

export async function generateQuestions(options: {
    corpus: Corpus;
    counts: Record<GeneratedType, number>;
    random: () => number;
    model: string;
    existing: Question[];
    today: string;
    draft: (sample: Sample, n: number) => Promise<Draft[]>;
}): Promise<{
    made: Question[];
    dropped: Record<string, number>;
    stopped: string | null;
}> {
    const ids = new Set(options.existing.map((question) => question.id));
    const made: Question[] = [];
    const dropped: Record<string, number> = {};
    const drop = (reason: string) => {
        dropped[reason] = (dropped[reason] ?? 0) + 1;
    };
    for (const type of GENERATED_TYPES) {
        const want = options.counts[type];
        let have = 0;
        // A sample may give nothing; three tries a batch, then move on.
        const tries = Math.ceil(want / BATCH) * 3;
        for (let tried = 0; have < want && tried < tries; tried++) {
            const sample = sampleFor(type, options.corpus, options.random, options.today);
            if (sample === null) {
                drop(`no material for ${type}`);
                break;
            }
            const n = Math.min(BATCH, want - have);
            let drafts: Draft[];
            try {
                drafts = await options.draft(sample, n);
            } catch (error) {
                if (error instanceof CallCap) {
                    return { made, dropped, stopped: error.message };
                }
                drop("failed call");
                continue;
            }
            for (const each of drafts.slice(0, n)) {
                const accepted = acceptDraft(each, sample, {
                    model: options.model,
                    ids,
                    corpus: options.corpus,
                });
                if (typeof accepted === "string") {
                    drop(accepted);
                    continue;
                }
                ids.add(accepted.id);
                made.push(accepted);
                have++;
            }
        }
    }
    return { made, dropped, stopped: null };
}

// The day of the snapshot's last turn: questions are asked as of then.
export function latestDay(corpus: Corpus): string | null {
    let latest: string | null = null;
    for (const conversation of corpus.conversations.values()) {
        if (latest === null || conversation.lastAt > latest) {
            latest = conversation.lastAt;
        }
    }
    return latest?.slice(0, 10) ?? null;
}
```

- [ ] **Step 4: Write the command**

`packages/eval/src/questions/generate-command.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/generate-command.ts
//
//

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Command, intOf, workOf } from "../command.js";
import { Models } from "../models/client.js";
import { readEvalConfig, requireRole } from "../models/config.js";
import { readSnapshot, workEnv } from "../snapshot/snapshot.js";
import { openCorpus } from "../systems/corpus.js";
import {
    type Question,
    readQuestionsToRewrite,
    writeQuestions,
} from "./file.js";
import {
    BATCH,
    countsFor,
    draftPrompt,
    draftsSchema,
    GENERATED_TYPES,
    generateQuestions,
    latestDay,
    parseTypeCounts,
    seeded,
} from "./generate.js";

// <work>/generated.json: each generation's seed, model, counts and drops.
async function recordGeneration(work: string, entry: object): Promise<void> {
    const path = join(work, "generated.json");
    let entries: unknown[] = [];
    try {
        const read = JSON.parse(await readFile(path, "utf8"));
        entries = Array.isArray(read) ? read : [];
    } catch {
        // None yet.
    }
    await writeFile(path, `${JSON.stringify([...entries, entry], null, 4)}\n`, {
        mode: 0o600,
    });
}

const byType = (questions: Question[]) => {
    const counts: Record<string, number> = {};
    for (const question of questions) {
        counts[question.type] = (counts[question.type] ?? 0) + 1;
    }
    return counts;
};

export const generateCommand: Command = {
    summary: "draft questions of each type with a model",
    options: {
        work: { type: "string" },
        count: { type: "string" },
        type: { type: "string", multiple: true },
        seed: { type: "string" },
        "max-calls": { type: "string" },
        "dry-run": { type: "boolean" },
    },
    async run(values, _positionals, io) {
        const work = workOf(values);
        const snapshot = await readSnapshot(work);
        const counts = countsFor(
            intOf(values, "count", 300, 1, 5000),
            parseTypeCounts((values.type as string[] | undefined) ?? []),
        );
        const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
        if (values["dry-run"] === true) {
            const calls = GENERATED_TYPES.reduce(
                (sum, type) => sum + Math.ceil(counts[type] / BATCH),
                0,
            );
            io.out(
                `dry run: at least ${calls} calls to the generating model, at most ${calls * 3}, for ${total} questions\n`,
            );
            return 0;
        }
        const existing = await readQuestionsToRewrite(work);
        const config = await readEvalConfig(work);
        const role = requireRole(config, "generate");
        const models = new Models(config, {
            env: io.env,
            maxCalls:
                values["max-calls"] === undefined
                    ? null
                    : intOf(values, "max-calls", 0, 1, 1_000_000),
        });
        // A missing key is said before anything is opened.
        models.chat("generate");
        const seed = intOf(
            values,
            "seed",
            Math.floor(Math.random() * 2 ** 31),
            0,
            2 ** 31 - 1,
        );
        const corpus = await openCorpus(workEnv(work));
        try {
            const result = await generateQuestions({
                corpus,
                counts,
                random: seeded(seed),
                model: role.model,
                existing,
                today: latestDay(corpus) ?? snapshot.at.slice(0, 10),
                draft: async (sample, n) =>
                    (
                        await models.structured(
                            "generate",
                            draftsSchema,
                            "questions",
                            draftPrompt(sample, n),
                        )
                    ).value.questions,
            });
            await writeQuestions(work, [...existing, ...result.made]);
            await recordGeneration(work, {
                at: new Date().toISOString(),
                seed,
                model: role.model,
                asked: counts,
                made: byType(result.made),
                dropped: result.dropped,
                stopped: result.stopped,
            });
            io.out(
                `drafted ${result.made.length} questions (seed ${seed}); review them with \`bun run eval -- review --work ${work}\`\n`,
            );
            for (const [reason, n] of Object.entries(result.dropped)) {
                io.out(`  dropped ${n}: ${reason}\n`);
            }
            if (result.stopped !== null) {
                io.out(`stopped: ${result.stopped}\n`);
            }
            return 0;
        } finally {
            corpus.close();
        }
    },
};
```

In `packages/eval/src/cli.ts`, import it and add `generate:
generateCommand,` to `COMMANDS` after `mine`:

```ts
import { generateCommand } from "./questions/generate-command.js";
```

- [ ] **Step 5: Run it to see it pass**

Run: `bun test packages/eval/src/questions`
Expected: PASS. The dry run's 62 is the sum of `ceil(n / 5)` over
`countsFor(300)` (71, 17, 75, 44, 75, 17): 15 + 4 + 15 + 9 + 15 + 4.
If `countsFor(300)` rounds differently, correct the test's number to
that sum, not the code.

- [ ] **Step 6: Add the files to the guide and commit**

In `packages/eval/AGENTS.md`'s Files, after `questions/mine.ts`:

```markdown
- `questions/generate.ts`: samples, prompts and checks for drafting
  each type; `questions/generate-command.ts`: the `generate` command,
  which records each generation's seed in `generated.json`.
```

Run: `bun run check`
Expected: exit 0.

```bash
bunx biome check --write packages/eval
git add packages/eval
git commit -m "feat(eval): Draft questions with a model" \
  -m "generate samples the snapshot for each of LongMemEval's types,
asks the generating model for questions, and keeps those that pass its
checks as drafts for the owner."
```

---

### Task 8: the owner's review

**Files:**

- Create: `packages/eval/src/questions/review.ts`
- Test: `packages/eval/src/questions/review.test.ts`
- Modify: `packages/eval/src/cli.ts` (the `review` command)
- Modify: `packages/eval/AGENTS.md` (Files)

**Interfaces:**

- Consumes: `Question`, `questionId`, `questionSchema`,
  `readQuestionsToRewrite`, `writeQuestions` (Task 3); `Corpus`,
  `openCorpus`, `passage`, `knowledgeText` (Task 6); `termsOf` (Task
  6); `Command`, `Io`, `workOf`, `readSnapshot`, `workEnv` (Task 2);
  `fakeIo`, `snapshotFixture`, `tempRoot`, `GARDEN` (Task 2).
- Produces:
  - `type Tally = { accepted: number; rejected: number; edited: number;
    left: number }`
  - `reviewQuestions(work: string, io: Io, corpus: Corpus):
    Promise<Tally>`
  - `describeEvidence(question: Question, corpus: Corpus): string`
  - `reviewCommand: Command`

- [ ] **Step 1: Write the failing test**

`packages/eval/src/questions/review.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/review.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { runCli } from "../cli.js";
import {
    fakeIo,
    GARDEN,
    snapshotFixture,
    tempRoot,
} from "../testing.js";
import {
    type Question,
    questionId,
    questionsPath,
    readQuestions,
    writeQuestions,
} from "./file.js";

let temp: ReturnType<typeof tempRoot>;
let work: string;

const drafted = (question: string): Question => ({
    id: questionId(question, [`c:${GARDEN}`]),
    type: "single-session",
    question,
    answer: "Plot twelve, by the river.",
    evidence: [`c:${GARDEN}`],
    exclude: null,
    asOf: "2026-10-19",
    project: null,
    source: "generated:m/1",
    status: "draft",
    note: null,
});

beforeEach(async () => {
    temp = tempRoot("review");
    work = await snapshotFixture(temp.root);
    await writeQuestions(work, [
        drafted("Which plot is my allotment?"),
        drafted("Where is my allotment?"),
        drafted("By what is my allotment?"),
    ]);
});
afterEach(() => temp.remove());

const statuses = async () =>
    (await readQuestions(work)).questions.map((question) => question.status);

describe("bun run eval -- review", () => {
    it("accepts, rejects with a note, skips, and says what is left", async () => {
        const { io, out } = fakeIo({
            answers: ["a", "r", "too close to the first", "s"],
        });
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        expect(await statuses()).toEqual(["accepted", "rejected", "draft"]);
        expect((await readQuestions(work)).questions[1]?.note).toBe(
            "too close to the first",
        );
        const shown = out.join("");
        expect(shown).toContain("Draft 1 of 3, single-session");
        expect(shown).toContain("Plot twelve, by the river.");
        expect(shown).toContain(`c:${GARDEN}: The allotment`);
        expect(shown).toContain("plot twelve by the river");
        expect(shown).toEndWith("accepted 1, rejected 1, edited 0; 1 drafts left\n");
    });

    it("keeps every decision made before its input ends", async () => {
        const { io } = fakeIo({ answers: ["a"] });
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        expect(await statuses()).toEqual(["accepted", "draft", "draft"]);
    });

    it("takes an edit, gives it a new id, and shows it again", async () => {
        const { io } = fakeIo({
            answers: ["e", "a", "q"],
            onEdit: (path) => {
                const question = JSON.parse(readFileSync(path, "utf8"));
                question.question = "What number is my allotment plot?";
                writeFileSync(path, JSON.stringify(question));
            },
        });
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        const [first] = (await readQuestions(work)).questions;
        expect(first?.question).toBe("What number is my allotment plot?");
        expect(first?.id).toBe(
            questionId("What number is my allotment plot?", [`c:${GARDEN}`]),
        );
        expect(first?.status).toBe("accepted");
    });

    it("refuses an edit that is no question, leaving it as it was", async () => {
        const { io, out } = fakeIo({
            answers: ["e", "q"],
            onEdit: (path) => {
                const question = JSON.parse(readFileSync(path, "utf8"));
                question.evidence = ["c:nowhere"];
                writeFileSync(path, JSON.stringify(question));
            },
        });
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        expect(out.join("")).toContain("the question is unchanged");
        expect((await readQuestions(work)).questions[0]?.evidence).toEqual([
            `c:${GARDEN}`,
        ]);
    });

    it("asks again for a key it does not know", async () => {
        const { io, out } = fakeIo({ answers: ["x", "q"] });
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        expect(out.join("")).toContain("Type a, e, r, s or q.");
    });

    it("says when there is nothing to review", async () => {
        await writeQuestions(work, []);
        const { io, out } = fakeIo();
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        expect(out.join("")).toBe("no drafts to review\n");
    });

    it("writes nothing while the file has a malformed line", async () => {
        writeFileSync(questionsPath(work), "not json\n");
        const { io } = fakeIo({ answers: ["a"] });
        expect(await runCli(["review", "--work", work], io)).toBe(1);
        expect(readFileSync(questionsPath(work), "utf8")).toBe("not json\n");
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test packages/eval/src/questions/review.test.ts`
Expected: FAIL, "eval: no command review".

- [ ] **Step 3: Write the review**

`packages/eval/src/questions/review.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/review.ts
//
//

// The owner's pass over the drafts, one at a time: each decision is
// written at once, so quitting, or the end of input, loses nothing.

import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Command, type Io, workOf } from "../command.js";
import { readSnapshot, workEnv } from "../snapshot/snapshot.js";
import {
    type Corpus,
    knowledgeText,
    openCorpus,
    passage,
} from "../systems/corpus.js";
import { termsOf } from "../systems/terms.js";
import {
    type Question,
    questionId,
    questionSchema,
    readQuestionsToRewrite,
    writeQuestions,
} from "./file.js";

export type Tally = {
    accepted: number;
    rejected: number;
    edited: number;
    left: number;
};

const PROMPT = "[a]ccept, [e]dit, [r]eject, [s]kip, [q]uit: ";
const indent = (text: string) =>
    text
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");

// Each piece of evidence by its title, with the passage that holds the
// answer.
export function describeEvidence(question: Question, corpus: Corpus): string {
    const terms = termsOf(`${question.question} ${question.answer ?? ""}`);
    return question.evidence
        .map((id) => {
            const conversation = corpus.conversations.get(id);
            if (conversation !== undefined) {
                return `  ${id}: ${conversation.title ?? "Untitled"}\n${indent(passage(conversation, terms, 1500))}`;
            }
            const knowledge = corpus.knowledge.get(id);
            return knowledge === undefined
                ? `  ${id}: not in the snapshot`
                : `  ${id}: ${knowledge.title}\n${indent(knowledgeText(knowledge))}`;
        })
        .join("\n");
}

function shown(question: Question, at: number, of: number, corpus: Corpus) {
    return [
        "",
        `Draft ${at} of ${of}, ${question.type} (${question.source}), asked ${question.asOf}`,
        `Q: ${question.question}`,
        `A: ${question.answer ?? "(none)"}`,
        ...(question.note === null ? [] : [`Note: ${question.note}`]),
        "Evidence:",
        describeEvidence(question, corpus),
        "",
    ].join("\n");
}

// The question as the owner left it in the editor, or why it is not one.
async function edited(
    work: string,
    question: Question,
    io: Io,
    others: Set<string>,
    corpus: Corpus,
): Promise<Question | string> {
    const path = join(work, "editing.json");
    await writeFile(path, `${JSON.stringify(question, null, 4)}\n`, {
        mode: 0o600,
    });
    try {
        await io.edit(path);
        const read = JSON.parse(await readFile(path, "utf8"));
        const parsed = questionSchema.safeParse({
            ...read,
            id: questionId(String(read.question ?? ""), read.evidence ?? []),
        });
        if (!parsed.success) {
            return parsed.error.issues[0]?.message ?? "not a question";
        }
        const unknown = parsed.data.evidence.find(
            (id) => !corpus.conversations.has(id) && !corpus.knowledge.has(id),
        );
        if (unknown !== undefined) {
            return `${unknown} is not in the snapshot`;
        }
        if (others.has(parsed.data.id)) {
            return "another question has that text and evidence";
        }
        return parsed.data;
    } catch {
        return "it is not JSON";
    } finally {
        await rm(path, { force: true });
    }
}

export async function reviewQuestions(
    work: string,
    io: Io,
    corpus: Corpus,
): Promise<Tally> {
    const questions = await readQuestionsToRewrite(work);
    const drafts = questions
        .map((question, at) => ({ question, at }))
        .filter(({ question }) => question.status === "draft")
        .map(({ at }) => at);
    const tally: Tally = { accepted: 0, rejected: 0, edited: 0, left: 0 };
    const finish = () => {
        tally.left = questions.filter((q) => q.status === "draft").length;
        return tally;
    };
    for (const [count, at] of drafts.entries()) {
        for (;;) {
            const question = questions[at] as Question;
            io.out(shown(question, count + 1, drafts.length, corpus));
            const choice = (await io.ask(PROMPT))?.trim().toLowerCase() ?? "q";
            if (choice === "q") {
                return finish();
            }
            if (choice === "s") {
                break;
            }
            if (choice === "a") {
                questions[at] = { ...question, status: "accepted" };
                tally.accepted++;
                await writeQuestions(work, questions);
                break;
            }
            if (choice === "r") {
                const why = ((await io.ask("Why? ")) ?? "").trim();
                questions[at] = {
                    ...question,
                    status: "rejected",
                    note: why === "" ? question.note : why.slice(0, 2000),
                };
                tally.rejected++;
                await writeQuestions(work, questions);
                break;
            }
            if (choice === "e") {
                const others = new Set(
                    questions.filter((_, other) => other !== at).map((q) => q.id),
                );
                const result = await edited(work, question, io, others, corpus);
                if (typeof result === "string") {
                    io.out(
                        `eval: that edit is not a question: ${result}; the question is unchanged\n`,
                    );
                } else {
                    questions[at] = result;
                    tally.edited++;
                    await writeQuestions(work, questions);
                }
                continue;
            }
            io.out("Type a, e, r, s or q.\n");
        }
    }
    return finish();
}

export const reviewCommand: Command = {
    summary: "accept, edit or reject the drafts, one at a time",
    options: { work: { type: "string" } },
    async run(values, _positionals, io) {
        const work = workOf(values);
        await readSnapshot(work);
        const questions = await readQuestionsToRewrite(work);
        if (!questions.some((question) => question.status === "draft")) {
            io.out("no drafts to review\n");
            return 0;
        }
        const corpus = await openCorpus(workEnv(work));
        try {
            const tally = await reviewQuestions(work, io, corpus);
            io.out(
                `accepted ${tally.accepted}, rejected ${tally.rejected}, edited ${tally.edited}; ${tally.left} drafts left\n`,
            );
            return 0;
        } finally {
            corpus.close();
        }
    },
};
```

In `packages/eval/src/cli.ts`, import it and add `review:
reviewCommand,` to `COMMANDS` after `generate`:

```ts
import { reviewCommand } from "./questions/review.js";
```

- [ ] **Step 4: Run it to see it pass**

Run: `bun test packages/eval/src/questions/review.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add the file to the guide and commit**

In `packages/eval/AGENTS.md`'s Files, after `questions/generate.ts`:

```markdown
- `questions/review.ts`: the owner's pass over the drafts, and the
  `review` command; an edit goes through `editing.json` in the work
  directory, and takes a new id from its text and evidence.
```

```bash
bunx biome check --write packages/eval
git add packages/eval
git commit -m "feat(eval): Review drafts one at a time"
```

---
### Task 9: records, the report and compare

**Files:**

- Create: `packages/eval/src/run/record.ts`
- Create: `packages/eval/src/report/summary.ts`
- Create: `packages/eval/src/report/markdown.ts`
- Create: `packages/eval/src/report/command.ts`
- Test: `packages/eval/src/report/report.test.ts`
- Modify: `packages/eval/src/cli.ts` (the `compare` command)
- Modify: `packages/eval/AGENTS.md` (Files)

**Interfaces:**

- Consumes: `QuestionType` (Task 3); `SnapshotInfo`, `Command`,
  `workOf`, `EvalError` (Task 2); `fakeIo`, `tempRoot` (Task 2).
- Produces:
  - `type Judged = { strict: boolean | null; lenient: boolean | null;
    declined: boolean | null; stale: boolean | null }`
  - `type RunRecord = { question: string; system: string; type:
    QuestionType; retrieval: { ranked: string[]; chars: number; ms:
    number; error: string | null }; recall: { at5: boolean; at10:
    boolean } | null; answer: { text: string; input: number; output:
    number; ms: number } | null; judged: Judged; failures: string[] }`
  - `type RunInfo = { id: string; at: string; systems: string[];
    budget: number; fullBudget: number; retrievalOnly: boolean; models:
    { answer: string | null; judge: string | null }; snapshot:
    SnapshotInfo; questions: number }`
  - `runDir(work, id)`, `recordsPath(work, id)`, `runInfoPath(work,
    id)`, `summaryPath(work, id)`, `reportPath(work, id)`;
    `checkRunId(id: string): string`; `readRecords(work: string, id:
    string): Promise<RunRecord[]>`; `readRunInfo(work: string, id:
    string): Promise<RunInfo>` (`run/record.ts`)
  - `type Rate = { hits: number; of: number }`, `type Cell`, `type
    Summary = { run: RunInfo; systems: Record<string, { all: Cell;
    byType: Partial<Record<QuestionType, Cell>>; alone: { right:
    string[]; wrong: string[] } }> }`, `summarise(info: RunInfo,
    records: RunRecord[]): Summary` (`report/summary.ts`)
  - `percent(rate: Rate): string`, `reportOf(summary: Summary): string`,
    `compareOf(a: Summary, b: Summary): string`, `ADOPTION_RULE`
    (`report/markdown.ts`)
  - `writeRunReport(work: string, id: string): Promise<Summary>`,
    `compareCommand: Command` (`report/command.ts`)

- [ ] **Step 1: Write the failing test**

`packages/eval/src/report/report.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/report/report.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runCli } from "../cli.js";
import {
    recordsPath,
    reportPath,
    type RunInfo,
    type RunRecord,
    runDir,
    runInfoPath,
} from "../run/record.js";
import { fakeIo, tempRoot } from "../testing.js";
import { writeRunReport } from "./command.js";
import { compareOf, percent, reportOf } from "./markdown.js";
import { summarise } from "./summary.js";

const info = (id: string): RunInfo => ({
    id,
    at: "2026-10-19T01:00:00.000Z",
    systems: ["dorothy", "lexical"],
    budget: 8000,
    fullBudget: 400_000,
    retrievalOnly: false,
    models: { answer: "answer/model", judge: "judge/model" },
    snapshot: {
        source: "/data",
        at: "2026-10-18T00:00:00.000Z",
        conversations: 4,
        knowledge: 3,
    },
    questions: 3,
});

const record = (
    question: string,
    system: string,
    fields: Partial<RunRecord> = {},
): RunRecord => ({
    question,
    system,
    type: "single-session",
    retrieval: { ranked: [], chars: 100, ms: 10, error: null },
    recall: { at5: true, at10: true },
    answer: { text: "An answer.", input: 50, output: 5, ms: 20 },
    judged: { strict: true, lenient: true, declined: false, stale: null },
    failures: [],
    ...fields,
});

const RECORDS: RunRecord[] = [
    record("q-1", "dorothy"),
    record("q-1", "lexical", {
        recall: { at5: false, at10: true },
        judged: { strict: false, lenient: true, declined: false, stale: null },
    }),
    record("q-2", "dorothy", {
        type: "abstention",
        recall: null,
        judged: { strict: null, lenient: null, declined: true, stale: null },
    }),
    record("q-2", "lexical", {
        type: "abstention",
        recall: null,
        judged: { strict: null, lenient: null, declined: false, stale: null },
    }),
    record("q-3", "dorothy", {
        type: "knowledge-update",
        judged: { strict: false, lenient: false, declined: true, stale: true },
        retrieval: { ranked: [], chars: 300, ms: 30, error: null },
    }),
    record("q-3", "lexical", {
        type: "knowledge-update",
        recall: { at5: false, at10: false },
        retrieval: { ranked: [], chars: 0, ms: 0, error: "down" },
        answer: null,
        judged: { strict: null, lenient: null, declined: null, stale: null },
        failures: ["answer: 500 refused"],
    }),
];

describe("a summary", () => {
    const summary = summarise(info("r1"), RECORDS);
    const dorothy = summary.systems.dorothy;
    const lexical = summary.systems.lexical;

    it("counts each rate over the records that have it", () => {
        expect(dorothy?.all.strict).toEqual({ hits: 1, of: 2 });
        expect(dorothy?.all.at5).toEqual({ hits: 2, of: 2 });
        expect(dorothy?.all.declined).toEqual({ hits: 1, of: 1 });
        expect(dorothy?.all.wronglyDeclined).toEqual({ hits: 1, of: 2 });
        expect(dorothy?.all.stale).toEqual({ hits: 1, of: 1 });
        expect(lexical?.all.at5).toEqual({ hits: 0, of: 2 });
        expect(lexical?.all.failures).toBe(2);
    });

    it("averages retrieval and sums tokens", () => {
        expect(dorothy?.all.n).toBe(3);
        expect(dorothy?.all.retrievalMs).toBe(17);
        expect(dorothy?.all.chars).toBe(167);
        expect(dorothy?.all.input).toBe(150);
    });

    it("splits by type", () => {
        expect(dorothy?.byType.abstention?.declined).toEqual({
            hits: 1,
            of: 1,
        });
        expect(dorothy?.byType["single-session"]?.strict).toEqual({
            hits: 1,
            of: 1,
        });
    });

    it("names what one system alone got right or wrong", () => {
        expect(dorothy?.alone.right).toEqual(["q-1"]);
        expect(lexical?.alone.wrong).toEqual(["q-1"]);
    });
});

describe("the report", () => {
    it("gives rates with their counts, and n/a for none", () => {
        expect(percent({ hits: 1, of: 2 })).toBe("50.0% (1/2)");
        expect(percent({ hits: 0, of: 0 })).toBe("n/a");
    });

    it("tables each system, overall and by type", () => {
        const text = reportOf(summarise(info("r1"), RECORDS));
        expect(text).toStartWith("# Memory evaluation r1\n");
        expect(text).toContain(
            "| dorothy | 50.0% (1/2) | 50.0% (1/2) | 100.0% (2/2) |",
        );
        expect(text).toContain("### abstention");
        expect(text).toContain("answering answer/model, judging judge/model");
        expect(text).toContain("| n/a |");
    });

    it("compares two runs, marking what two questions could undo", () => {
        const before = summarise(info("r1"), RECORDS);
        const after = summarise(info("r2"), [
            ...RECORDS.filter((each) => each.question !== "q-1"),
            record("q-1", "dorothy", {
                judged: {
                    strict: false,
                    lenient: true,
                    declined: false,
                    stale: null,
                },
            }),
            record("q-1", "lexical"),
        ]);
        const text = compareOf(before, after);
        expect(text).toContain("Comparing r1 with r2");
        expect(text).toContain("| dorothy | all | 50.0% (1/2) | 0.0% (0/2) | -50.0 points (noise) |");
        expect(text).toContain("Adoption rule:");
    });
});

describe("bun run eval -- compare", () => {
    let temp: ReturnType<typeof tempRoot>;
    beforeEach(() => {
        temp = tempRoot("report");
    });
    afterEach(() => temp.remove());

    const write = (id: string) => {
        mkdirSync(runDir(temp.root, id), { recursive: true });
        writeFileSync(runInfoPath(temp.root, id), JSON.stringify(info(id)));
        writeFileSync(
            recordsPath(temp.root, id),
            RECORDS.map((each) => `${JSON.stringify(each)}\n`).join(""),
        );
    };

    it("writes a run's report, then compares two", async () => {
        write("r1");
        write("r2");
        await writeRunReport(temp.root, "r1");
        await writeRunReport(temp.root, "r2");
        expect(readFileSync(reportPath(temp.root, "r1"), "utf8")).toContain(
            "# Memory evaluation r1",
        );
        const { io, out } = fakeIo();
        expect(
            await runCli(["compare", "--work", temp.root, "r1", "r2"], io),
        ).toBe(0);
        expect(out.join("")).toContain("Comparing r1 with r2");
    });

    it("says how to finish a run with no summary", async () => {
        write("r1");
        const { io, err } = fakeIo();
        expect(
            await runCli(["compare", "--work", temp.root, "r1", "r1"], io),
        ).toBe(1);
        expect(err.join("")).toContain("--resume r1");
    });

    it("refuses a run id that could leave the runs directory", async () => {
        const { io, err } = fakeIo();
        expect(
            await runCli(["compare", "--work", temp.root, "../x", "r1"], io),
        ).toBe(1);
        expect(err.join("")).toContain("is no run id");
    });
});
```

The `chars` average is (100 + 100 + 300) / 3, rounded: 167. The
retrieval time is (10 + 10 + 30) / 3: 17.

- [ ] **Step 2: Run it to see it fail**

Run: `bun test packages/eval/src/report`
Expected: FAIL, "Cannot find module '../run/record.js'".

- [ ] **Step 3: Write the records**

`packages/eval/src/run/record.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/run/record.ts
//
//

// <work>/runs/<id>/: run.json, the settings; records.jsonl, one record a
// question and system, appended as each completes; summary.json and
// report.md, written at the end.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EvalError } from "../errors.js";
import type { QuestionType } from "../questions/file.js";
import type { SnapshotInfo } from "../snapshot/snapshot.js";

export type Judged = {
    strict: boolean | null;
    lenient: boolean | null;
    declined: boolean | null;
    stale: boolean | null;
};
export type RunRecord = {
    question: string;
    system: string;
    type: QuestionType;
    retrieval: {
        // The first ten ids.
        ranked: string[];
        chars: number;
        ms: number;
        error: string | null;
    };
    // Null for a question with no evidence.
    recall: { at5: boolean; at10: boolean } | null;
    answer: { text: string; input: number; output: number; ms: number } | null;
    judged: Judged;
    failures: string[];
};
export type RunInfo = {
    id: string;
    at: string;
    systems: string[];
    budget: number;
    fullBudget: number;
    retrievalOnly: boolean;
    models: { answer: string | null; judge: string | null };
    snapshot: SnapshotInfo;
    questions: number;
};

// A run id names a directory, so it may hold nothing that leaves runs/.
export function checkRunId(id: string): string {
    if (!/^[0-9A-Za-z-]{1,64}$/.test(id)) {
        throw new EvalError(`${id} is no run id`);
    }
    return id;
}

export const runDir = (work: string, id: string) =>
    join(work, "runs", checkRunId(id));
export const recordsPath = (work: string, id: string) =>
    join(runDir(work, id), "records.jsonl");
export const runInfoPath = (work: string, id: string) =>
    join(runDir(work, id), "run.json");
export const summaryPath = (work: string, id: string) =>
    join(runDir(work, id), "summary.json");
export const reportPath = (work: string, id: string) =>
    join(runDir(work, id), "report.md");

// A line cut short by an interrupted write is passed over; its question
// is asked again on resume.
export async function readRecords(
    work: string,
    id: string,
): Promise<RunRecord[]> {
    let text: string;
    try {
        text = await readFile(recordsPath(work, id), "utf8");
    } catch {
        return [];
    }
    const records: RunRecord[] = [];
    for (const line of text.split("\n")) {
        if (line.trim() === "") {
            continue;
        }
        try {
            records.push(JSON.parse(line) as RunRecord);
        } catch {
            // Cut short.
        }
    }
    return records;
}

export async function readRunInfo(work: string, id: string): Promise<RunInfo> {
    try {
        return JSON.parse(
            await readFile(runInfoPath(work, id), "utf8"),
        ) as RunInfo;
    } catch {
        throw new EvalError(`no run ${id} in ${join(work, "runs")}`);
    }
}
```

- [ ] **Step 4: Write the summary**

`packages/eval/src/report/summary.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/report/summary.ts
//
//

// A run's records counted: each rate over the records that have it, by
// system, overall and by type.

import type { QuestionType } from "../questions/file.js";
import type { RunInfo, RunRecord } from "../run/record.js";

export type Rate = { hits: number; of: number };
export type Cell = {
    n: number;
    strict: Rate;
    lenient: Rate;
    at5: Rate;
    at10: Rate;
    // Of abstentions, those declined; of the rest, those declined wrongly.
    declined: Rate;
    wronglyDeclined: Rate;
    // Of updates, those that gave the older answer.
    stale: Rate;
    // Means.
    retrievalMs: number;
    chars: number;
    // Sums.
    input: number;
    output: number;
    failures: number;
};
export type SystemSummary = {
    all: Cell;
    byType: Partial<Record<QuestionType, Cell>>;
    alone: { right: string[]; wrong: string[] };
};
export type Summary = { run: RunInfo; systems: Record<string, SystemSummary> };

const rate = (): Rate => ({ hits: 0, of: 0 });
const emptyCell = (): Cell => ({
    n: 0,
    strict: rate(),
    lenient: rate(),
    at5: rate(),
    at10: rate(),
    declined: rate(),
    wronglyDeclined: rate(),
    stale: rate(),
    retrievalMs: 0,
    chars: 0,
    input: 0,
    output: 0,
    failures: 0,
});

function tally(into: Rate, value: boolean | null): void {
    if (value !== null) {
        into.of++;
        into.hits += value ? 1 : 0;
    }
}

function add(cell: Cell, record: RunRecord): void {
    cell.n++;
    tally(cell.strict, record.judged.strict);
    tally(cell.lenient, record.judged.lenient);
    tally(cell.at5, record.recall?.at5 ?? null);
    tally(cell.at10, record.recall?.at10 ?? null);
    tally(
        record.type === "abstention" ? cell.declined : cell.wronglyDeclined,
        record.judged.declined,
    );
    tally(cell.stale, record.judged.stale);
    cell.retrievalMs += record.retrieval.ms;
    cell.chars += record.retrieval.chars;
    cell.input += record.answer?.input ?? 0;
    cell.output += record.answer?.output ?? 0;
    cell.failures +=
        record.failures.length + (record.retrieval.error === null ? 0 : 1);
}

// Sums of time and characters become means.
function settle(cell: Cell): Cell {
    return cell.n === 0
        ? cell
        : {
              ...cell,
              retrievalMs: Math.round(cell.retrievalMs / cell.n),
              chars: Math.round(cell.chars / cell.n),
          };
}

export function summarise(info: RunInfo, records: RunRecord[]): Summary {
    const systems: Record<string, SystemSummary> = {};
    const cells = new Map<
        string,
        { all: Cell; byType: Map<QuestionType, Cell> }
    >();
    for (const name of info.systems) {
        cells.set(name, { all: emptyCell(), byType: new Map() });
    }
    // Each question's strict verdict by system, for what one alone got.
    const verdicts = new Map<string, Map<string, boolean>>();
    for (const record of records) {
        const cell = cells.get(record.system);
        if (cell === undefined) {
            continue;
        }
        add(cell.all, record);
        const byType = cell.byType.get(record.type) ?? emptyCell();
        add(byType, record);
        cell.byType.set(record.type, byType);
        if (record.judged.strict !== null) {
            const of = verdicts.get(record.question) ?? new Map();
            of.set(record.system, record.judged.strict);
            verdicts.set(record.question, of);
        }
    }
    for (const [name, cell] of cells) {
        systems[name] = {
            all: settle(cell.all),
            byType: Object.fromEntries(
                [...cell.byType].map(([type, each]) => [type, settle(each)]),
            ),
            alone: { right: [], wrong: [] },
        };
    }
    for (const [question, of] of [...verdicts].sort(([a], [b]) =>
        a < b ? -1 : 1,
    )) {
        if (of.size < 2) {
            continue;
        }
        const right = [...of].filter(([, strict]) => strict);
        const wrong = [...of].filter(([, strict]) => !strict);
        if (right.length === 1) {
            systems[right[0]?.[0] as string]?.alone.right.push(question);
        }
        if (wrong.length === 1) {
            systems[wrong[0]?.[0] as string]?.alone.wrong.push(question);
        }
    }
    return { run: info, systems };
}
```

- [ ] **Step 5: Write the Markdown**

`packages/eval/src/report/markdown.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/report/markdown.ts
//
//

// A run's report, and two runs compared, as Markdown. Every rate goes
// with its counts: some types hold few questions.

import { QUESTION_TYPES } from "../questions/file.js";
import type { Cell, Rate, Summary } from "./summary.js";

export const ADOPTION_RULE = [
    "Adoption rule: a provider is adopted only if its strict accuracy beats",
    "Dorothy improved's by 10 points on these questions, it passes both of",
    "the note's checks (a corrected memory survives a re-ingest; two clients",
    "write while a second machine reads), and it holds with the smaller",
    "ingest model.",
].join("\n");

export const percent = (rate: Rate) =>
    rate.of === 0
        ? "n/a"
        : `${((100 * rate.hits) / rate.of).toFixed(1)}% (${rate.hits}/${rate.of})`;

const ACCURACY = [
    "| System | Strict | Lenient | Recall@5 | Recall@10 | Abstained | Declined wrongly | Older answer |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
];
const accuracyRow = (name: string, cell: Cell) =>
    `| ${name} | ${[
        cell.strict,
        cell.lenient,
        cell.at5,
        cell.at10,
        cell.declined,
        cell.wronglyDeclined,
        cell.stale,
    ]
        .map(percent)
        .join(" | ")} |`;

export function reportOf(summary: Summary): string {
    const { run } = summary;
    const models = run.retrievalOnly
        ? "retrieval alone, with no model"
        : `answering ${run.models.answer}, judging ${run.models.judge}`;
    const systems = Object.entries(summary.systems);
    const lines = [
        `# Memory evaluation ${run.id}`,
        "",
        `Run ${run.at}, of a snapshot of \`${run.snapshot.source}\` taken ${run.snapshot.at}: ${run.snapshot.conversations} conversations and ${run.snapshot.knowledge} knowledge files. ${run.questions} questions; a budget of ${run.budget} characters (${run.fullBudget} for full); ${models}.`,
        "",
        "## Overall",
        "",
        ...ACCURACY,
        ...systems.map(([name, each]) => accuracyRow(name, each.all)),
        "",
        "## By type",
    ];
    for (const type of QUESTION_TYPES) {
        const rows = systems.flatMap(([name, each]) => {
            const cell = each.byType[type];
            return cell === undefined ? [] : [accuracyRow(name, cell)];
        });
        if (rows.length > 0) {
            lines.push("", `### ${type}`, "", ...ACCURACY, ...rows);
        }
    }
    lines.push(
        "",
        "## Cost",
        "",
        "| System | Retrieval ms | Characters | Input tokens | Output tokens | Failures |",
        "| --- | --- | --- | --- | --- | --- |",
        ...systems.map(
            ([name, { all }]) =>
                `| ${name} | ${all.retrievalMs} | ${all.chars} | ${all.input} | ${all.output} | ${all.failures} |`,
        ),
        "",
        "## Alone",
        "",
    );
    const alone = systems.flatMap(([name, { alone: split }]) => [
        ...(split.right.length === 0
            ? []
            : [`- ${name} alone right: ${split.right.join(", ")}`]),
        ...(split.wrong.length === 0
            ? []
            : [`- ${name} alone wrong: ${split.wrong.join(", ")}`]),
    ]);
    lines.push(
        ...(alone.length === 0 ? ["No question split the systems so."] : alone),
        "",
    );
    return lines.join("\n");
}

// A difference smaller than two questions of its kind is marked noise.
function difference(a: Rate, b: Rate): string {
    const of = Math.min(a.of, b.of);
    if (a.of === 0 || b.of === 0) {
        return "n/a";
    }
    const points = (100 * b.hits) / b.of - (100 * a.hits) / a.of;
    const sign = points > 0 ? "+" : "";
    const noise = Math.abs(points) < 200 / of ? " (noise)" : "";
    return `${sign}${points.toFixed(1)} points${noise}`;
}

export function compareOf(a: Summary, b: Summary): string {
    const lines = [
        `Comparing ${a.run.id} with ${b.run.id}`,
        "",
        "| System | Type | Strict before | Strict after | Difference |",
        "| --- | --- | --- | --- | --- |",
    ];
    const shared = Object.keys(a.systems).filter((name) => name in b.systems);
    for (const name of shared) {
        const [before, after] = [a.systems[name], b.systems[name]];
        if (before === undefined || after === undefined) {
            continue;
        }
        const rows: [string, Cell | undefined, Cell | undefined][] = [
            ["all", before.all, after.all],
            ...QUESTION_TYPES.map(
                (type) =>
                    [type, before.byType[type], after.byType[type]] as [
                        string,
                        Cell | undefined,
                        Cell | undefined,
                    ],
            ),
        ];
        for (const [type, x, y] of rows) {
            if (x !== undefined && y !== undefined && x.strict.of + y.strict.of > 0) {
                lines.push(
                    `| ${name} | ${type} | ${percent(x.strict)} | ${percent(y.strict)} | ${difference(x.strict, y.strict)} |`,
                );
            }
        }
    }
    const only = [
        ...Object.keys(a.systems)
            .filter((name) => !(name in b.systems))
            .map((name) => `${name} only in ${a.run.id}`),
        ...Object.keys(b.systems)
            .filter((name) => !(name in a.systems))
            .map((name) => `${name} only in ${b.run.id}`),
    ];
    lines.push(
        "",
        ...(only.length === 0 ? [] : [`Not compared: ${only.join("; ")}.`, ""]),
        "A difference smaller than two questions' worth of its type is marked noise.",
        "",
        ADOPTION_RULE,
        "",
    );
    return lines.join("\n");
}
```

In the compare test, dorothy's strict falls from 1 of 2 to 0 of 2:
-50.0 points, and two questions of two are 100 points' worth, so it is
noise. Correct the test's expected row only if the table's columns
differ from this code; the arithmetic is the spec's rule.

- [ ] **Step 6: Write the command and the writer**

`packages/eval/src/report/command.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/report/command.ts
//
//

import { readFile, writeFile } from "node:fs/promises";
import { type Command, workOf } from "../command.js";
import { EvalError } from "../errors.js";
import {
    checkRunId,
    readRecords,
    readRunInfo,
    reportPath,
    summaryPath,
} from "../run/record.js";
import { compareOf, reportOf } from "./markdown.js";
import { type Summary, summarise } from "./summary.js";

export async function writeRunReport(
    work: string,
    id: string,
): Promise<Summary> {
    const summary = summarise(
        await readRunInfo(work, id),
        await readRecords(work, id),
    );
    await writeFile(
        summaryPath(work, id),
        `${JSON.stringify(summary, null, 4)}\n`,
        { mode: 0o600 },
    );
    await writeFile(reportPath(work, id), reportOf(summary), { mode: 0o600 });
    return summary;
}

async function readSummary(work: string, id: string): Promise<Summary> {
    try {
        return JSON.parse(await readFile(summaryPath(work, id), "utf8"));
    } catch {
        throw new EvalError(
            `run ${id} has no summary: finish it with \`bun run eval -- run --work ${work} --resume ${id}\``,
        );
    }
}

export const compareCommand: Command = {
    summary: "compare two runs' summaries",
    options: { work: { type: "string" } },
    async run(values, positionals, io) {
        const work = workOf(values);
        const [first, second] = positionals;
        if (first === undefined || second === undefined || positionals.length > 2) {
            throw new EvalError("give two run ids: compare --work <dir> <run> <run>");
        }
        const a = await readSummary(work, checkRunId(first));
        const b = await readSummary(work, checkRunId(second));
        io.out(compareOf(a, b));
        return 0;
    },
};
```

In `packages/eval/src/cli.ts`, import it and add `compare:
compareCommand,` to `COMMANDS` after `review` (Task 10 puts `run`
between them):

```ts
import { compareCommand } from "./report/command.js";
```

- [ ] **Step 7: Run it to see it pass**

Run: `bun test packages/eval/src/report`
Expected: PASS, 10 tests.

- [ ] **Step 8: Add the files to the guide and commit**

In `packages/eval/AGENTS.md`'s Files, after `systems/`:

```markdown
- `run/record.ts`: a run's directory, its records and settings;
  `report/`: `summarise`, the Markdown report and `compareOf`, and the
  `compare` command with `writeRunReport`.
```

```bash
bunx biome check --write packages/eval
git add packages/eval
git commit -m "feat(eval): Report runs and compare them"
```

---

### Task 10: the run

**Files:**

- Create: `packages/eval/src/run/judges.ts`
- Create: `packages/eval/src/run/run.ts`
- Create: `packages/eval/src/run/command.ts`
- Test: `packages/eval/src/run/run.test.ts`
- Modify: `packages/eval/src/cli.ts` (the `run` command)
- Modify: `packages/eval/AGENTS.md` (Files)

**Interfaces:**

- Consumes: `Models`, `CallCap`, `failureOf`, `Message` (Task 5);
  `EvalConfig`, `readEvalConfig`, `requireRole`, `vendorOf` (Task 5);
  `Corpus`, `openCorpus`, `System`, `makeSystem`, `SYSTEM_NAMES`,
  `Asked`, `Retrieved` (Task 6); `Question`, `readQuestions` (Task 3);
  `RunInfo`, `RunRecord`, `readRecords`, `readRunInfo`, `runDir`,
  `runInfoPath`, `recordsPath`, `reportPath` (Task 9);
  `writeRunReport`, `Summary` (Task 9); `Command`, `workOf`,
  `stringOf`, `intOf`, `readSnapshot`, `workEnv`, `SnapshotInfo`,
  `EvalError` (Task 2); `stubModels`, `stubConfig`, `snapshotFixture`,
  `fakeIo`, `tempRoot`, `GARDEN` (Tasks 2, 5).
- Produces:
  - `LENIENT_PROMPT`, `ABSTENTION_PROMPT`, `STALE_PROMPT`; `type Judge
    = (params: { inputs: string; outputs: string; referenceOutputs?:
    string }) => Promise<boolean>`; `type Judges = { strict: Judge;
    lenient: Judge; declined: Judge; stale: Judge }`;
    `makeJudges(models: Models): Judges`; `declines(answer: string):
    boolean`; `answerPrompt(question: Question, context: string):
    Message[]` (`run/judges.ts`)
  - `type RunSettings = { systems: string[]; budget: number;
    fullBudget: number; retrievalOnly: boolean }`;
    `newRunInfo(settings: RunSettings, accepted: Question[], config:
    EvalConfig, snapshot: SnapshotInfo, now: Date): RunInfo`;
    `runEvaluation(info: RunInfo, deps: { work: string; corpus:
    Corpus; questions: Question[]; models: Models | null;
    concurrency: number; systems?: System[] }): Promise<{ summary:
    Summary; stopped: string | null }>`; `modelCalls(info: RunInfo,
    accepted: Question[]): number` (`run/run.ts`)
  - `runCommand: Command` (`run/command.ts`)

- [ ] **Step 1: Write the failing test**

`packages/eval/src/run/run.test.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/run/run.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { runCli } from "../cli.js";
import { Models } from "../models/client.js";
import { configPath, readEvalConfig } from "../models/config.js";
import {
    type Question,
    questionId,
    readQuestions,
    writeQuestions,
} from "../questions/file.js";
import { readSnapshot, workEnv } from "../snapshot/snapshot.js";
import { openCorpus } from "../systems/corpus.js";
import {
    fakeIo,
    GARDEN,
    snapshotFixture,
    stubConfig,
    stubModels,
    tempRoot,
} from "../testing.js";
import { readRecords, reportPath, summaryPath } from "./record.js";
import { newRunInfo, runEvaluation } from "./run.js";

let temp: ReturnType<typeof tempRoot>;
let work: string;
let stub: ReturnType<typeof stubModels> | null = null;

const accepted = (
    question: string,
    fields: Partial<Question> & Pick<Question, "type">,
): Question => {
    const evidence = fields.evidence ?? [];
    return {
        id: questionId(question, evidence),
        question,
        answer: "An answer.",
        evidence,
        exclude: null,
        asOf: "2026-10-19",
        project: null,
        source: "generated:m/1",
        status: "accepted",
        note: null,
        ...fields,
    };
};

beforeEach(async () => {
    temp = tempRoot("run");
    work = await snapshotFixture(temp.root);
    expect(await runCli(["mine", "--work", work], fakeIo().io)).toBe(0);
    const { questions } = await readQuestions(work);
    await writeQuestions(work, [
        ...questions,
        accepted("Which plot is my allotment?", {
            type: "single-session",
            answer: "Plot twelve, by the river.",
            evidence: [`c:${GARDEN}`],
        }),
        accepted("What colour is my canoe?", {
            type: "abstention",
            answer: "The memory does not say.",
        }),
        accepted("Which editor do I use?", {
            type: "knowledge-update",
            answer: "Helix.",
            evidence: ["k:personal/uses-helix"],
            note: "Vim.",
        }),
    ]);
});
afterEach(() => {
    stub?.stop();
    stub = null;
    temp.remove();
});

// Judges ask for a schema; the answering model does not.
const serve = (answer: { status?: number; content?: string }) => {
    stub = stubModels((request) =>
        request.body.response_format === undefined
            ? answer
            : { json: { reasoning: "Checked.", score: true } },
    );
    writeFileSync(configPath(work), stubConfig(stub.url));
    return stub;
};
const idOf = (out: string[]) =>
    /run ([0-9A-Za-z-]+):/.exec(out.join(""))?.[1] ?? "";

describe("bun run eval -- run", () => {
    it("measures retrieval alone with no model", async () => {
        const { io, out } = fakeIo();
        expect(await runCli(["run", "--work", work, "--retrieval-only"], io)).toBe(0);
        const id = idOf(out);
        const records = await readRecords(work, id);
        expect(records).toHaveLength(15);
        expect(records.every((each) => each.answer === null)).toBe(true);
        const tea = records.find(
            (each) =>
                each.system === "lexical" &&
                each.type === "lookup" &&
                each.retrieval.ranked.length > 0 &&
                each.recall !== null,
        );
        expect(tea?.recall?.at5).toBe(true);
        expect(existsSync(reportPath(work, id))).toBe(true);
        expect(existsSync(summaryPath(work, id))).toBe(true);
    });

    it("answers and judges, but never a lookup", async () => {
        const { requests } = serve({ content: "Plot twelve, by the river." });
        const { io, out } = fakeIo();
        expect(
            await runCli(
                ["run", "--work", work, "--systems", "lexical", "--concurrency", "1"],
                io,
            ),
        ).toBe(0);
        const records = await readRecords(work, idOf(out));
        const byType = new Map(records.map((each) => [each.type, each]));
        expect(byType.get("lookup")?.answer).toBeNull();
        expect(byType.get("single-session")?.judged).toEqual({
            strict: true,
            lenient: true,
            declined: false,
            stale: null,
        });
        expect(byType.get("abstention")?.judged.declined).toBe(true);
        expect(byType.get("abstention")?.judged.strict).toBeNull();
        expect(byType.get("knowledge-update")?.judged.stale).toBe(true);
        // Three answers, then judges: two, one and three.
        expect(requests).toHaveLength(9);
        const asked = JSON.stringify(requests[0]?.body.messages);
        expect(asked).toContain("<memory>");
        expect(asked).toContain("Which plot is my allotment?");
    });

    it("stops at --max-calls and resumes without asking twice", async () => {
        serve({ content: "Plot twelve, by the river." });
        const first = fakeIo();
        expect(
            await runCli(
                [
                    "run",
                    "--work",
                    work,
                    "--systems",
                    "lexical",
                    "--concurrency",
                    "1",
                    "--max-calls",
                    "4",
                ],
                first.io,
            ),
        ).toBe(0);
        const id = idOf(first.out);
        expect(first.out.join("")).toContain(
            "stopped: reached --max-calls (4); resume with",
        );
        expect(await readRecords(work, id)).toHaveLength(3);
        const again = fakeIo();
        expect(
            await runCli(["run", "--work", work, "--resume", id], again.io),
        ).toBe(0);
        const records = await readRecords(work, id);
        expect(records).toHaveLength(5);
        expect(new Set(records.map((each) => each.question)).size).toBe(5);
    });

    it("counts a dry run's calls and makes none", async () => {
        const { requests } = serve({ content: "x" });
        const { io, out } = fakeIo();
        expect(
            await runCli(
                ["run", "--work", work, "--systems", "lexical", "--dry-run"],
                io,
            ),
        ).toBe(0);
        expect(out.join("")).toBe(
            "dry run: 5 questions, 1 systems; 9 model calls\n",
        );
        expect(requests).toHaveLength(0);
    });

    it("names a key's variable that is not set", async () => {
        stub = stubModels(() => ({ content: "x" }));
        writeFileSync(configPath(work), stubConfig(stub.url, "EVAL_KEY"));
        const { io, err } = fakeIo();
        expect(await runCli(["run", "--work", work], io)).toBe(1);
        expect(err.join("")).toContain("EVAL_KEY is not set");
    });

    it("says there is nothing to ask, or no such run", async () => {
        const { io, err } = fakeIo();
        expect(
            await runCli(["run", "--work", work, "--resume", "nope"], io),
        ).toBe(1);
        expect(err.join("")).toContain("no run nope");
        await writeQuestions(work, []);
        expect(await runCli(["run", "--work", work, "--retrieval-only"], io)).toBe(1);
        expect(err.join("")).toContain("no accepted questions");
    });
});

describe("a run", () => {
    it("records a system's failure and goes on", async () => {
        const corpus = await openCorpus(workEnv(work));
        try {
            const { questions } = await readQuestions(work);
            const info = newRunInfo(
                {
                    systems: ["broken"],
                    budget: 8000,
                    fullBudget: 400_000,
                    retrievalOnly: true,
                },
                questions,
                await readEvalConfig(work),
                await readSnapshot(work),
                new Date("2026-10-19T01:00:00.000Z"),
            );
            const { summary } = await runEvaluation(info, {
                work,
                corpus,
                questions,
                models: null,
                concurrency: 2,
                systems: [
                    {
                        name: "broken",
                        retrieve: async () => {
                            throw new Error("down");
                        },
                    },
                ],
            });
            const records = await readRecords(work, info.id);
            expect(records).toHaveLength(5);
            expect(records[0]?.retrieval.error).toBe("down");
            expect(summary.systems.broken?.all.failures).toBe(5);
        } finally {
            corpus.close();
        }
    });

    it("records a model's failure and goes on", async () => {
        serve({ status: 500 });
        const corpus = await openCorpus(workEnv(work));
        try {
            const { questions } = await readQuestions(work);
            const config = await readEvalConfig(work);
            const info = newRunInfo(
                {
                    systems: ["lexical"],
                    budget: 8000,
                    fullBudget: 400_000,
                    retrievalOnly: false,
                },
                questions,
                config,
                await readSnapshot(work),
                new Date("2026-10-19T01:00:00.000Z"),
            );
            await runEvaluation(info, {
                work,
                corpus,
                questions,
                models: new Models(config, { env: {}, retryMs: 1 }),
                concurrency: 1,
            });
            const records = await readRecords(work, info.id);
            expect(records).toHaveLength(5);
            const failed = records.find((each) => each.type === "single-session");
            expect(failed?.failures[0]).toStartWith("answer: 500");
            expect(failed?.judged.strict).toBeNull();
        } finally {
            corpus.close();
        }
    });
});
```

The question file holds five accepted questions: the two mined
lookups and the three written here. With `--systems lexical`, the
model calls are three answers and six judgements (single-session two,
abstention one, knowledge-update three), so 9. With `--max-calls 4` and
one at a time, the lookups take none, the single-session question
three, and the abstention's answer the fourth; its judgement finds the
cap spent, so three records are written and the abstention is asked
again on resume.

- [ ] **Step 2: Run it to see it fail**

Run: `bun test packages/eval/src/run/run.test.ts`
Expected: FAIL, "Cannot find module './run.js'".

- [ ] **Step 3: Write the judges**

`packages/eval/src/run/judges.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/run/judges.ts
//
//

// How an answer is asked for and judged. The judges are openevals' LLM
// judge: its own correctness prompt for the strict verdict, and prompts
// of ours, in its placeholders, for the rest.

import { CORRECTNESS_PROMPT, createLLMAsJudge } from "openevals";
import type { Message, Models } from "../models/client.js";
import type { Question } from "../questions/file.js";

export const LENIENT_PROMPT = `You are grading an answer against a reference answer.
The answer is correct if it gives the reference's main point, even if it
leaves out details or adds harmless ones, and nothing in it contradicts
the reference.

<question>
{inputs}
</question>

<answer>
{outputs}
</answer>

<reference>
{reference_outputs}
</reference>`;

export const ABSTENTION_PROMPT = `The question below asks about something the assistant's memory does not
hold. The answer is correct if it says it does not know, or that its
memory does not say, without inventing an answer.

<question>
{inputs}
</question>

<answer>
{outputs}
</answer>`;

export const STALE_PROMPT = `The claim below was true once but is no longer. Score true if the
answer states that claim as true now, and false otherwise.

<question>
{inputs}
</question>

<answer>
{outputs}
</answer>

<claim>
{reference_outputs}
</claim>`;

export type Judge = (params: {
    inputs: string;
    outputs: string;
    referenceOutputs?: string;
}) => Promise<boolean>;
export type Judges = {
    strict: Judge;
    lenient: Judge;
    declined: Judge;
    stale: Judge;
};

export function makeJudges(models: Models): Judges {
    const chat = models.chat("judge");
    const judgeOf = (prompt: string, key: string): Judge => {
        const evaluator = createLLMAsJudge({
            prompt,
            judge: chat,
            feedbackKey: key,
        });
        return async (params) => {
            const result = await models.call(() => evaluator(params));
            return (result as { score?: unknown }).score === true;
        };
    };
    return {
        strict: judgeOf(CORRECTNESS_PROMPT, "strict"),
        lenient: judgeOf(LENIENT_PROMPT, "lenient"),
        declined: judgeOf(ABSTENTION_PROMPT, "declined"),
        stale: judgeOf(STALE_PROMPT, "stale"),
    };
}

// Whether an answer to a question that has one says it does not know:
// counted as declined wrongly, with no model asked.
const DECLINES =
    /\b(i (do not|don't) know|not sure|no (record|information|memory) of|(cannot|can't|can not) (find|tell|say)|(does|do) not say|doesn't say)\b/i;
export const declines = (answer: string) => DECLINES.test(answer);

export function answerPrompt(question: Question, context: string): Message[] {
    return [
        {
            role: "system",
            content: `You are a personal assistant answering your user from your memory of them. Today is ${question.asOf}. Answer from the memory below alone; if it does not hold the answer, say that you do not know. Answer in one or two sentences.`,
        },
        {
            role: "user",
            content: `<memory>\n${context}\n</memory>\n\nQuestion: ${question.question}`,
        },
    ];
}
```

- [ ] **Step 4: Write the run**

`packages/eval/src/run/run.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/run/run.ts
//
//

// Every accepted question asked of every system: retrieved within the
// budget, checked for its evidence, answered and judged. Each record is
// appended as it completes, so a stopped run resumes where it stopped.

import { createHash } from "node:crypto";
import { appendFile, mkdir, stat, writeFile } from "node:fs/promises";
import { EvalError } from "../errors.js";
import { CallCap, failureOf, type Models } from "../models/client.js";
import type { EvalConfig } from "../models/config.js";
import type { Question } from "../questions/file.js";
import { writeRunReport } from "../report/command.js";
import type { Summary } from "../report/summary.js";
import type { SnapshotInfo } from "../snapshot/snapshot.js";
import type { Corpus } from "../systems/corpus.js";
import { makeSystem, type Retrieved, type System } from "../systems/system.js";
import {
    answerPrompt,
    declines,
    type Judge,
    type Judges,
    makeJudges,
} from "./judges.js";
import {
    readRecords,
    recordsPath,
    type RunInfo,
    type RunRecord,
    runDir,
    runInfoPath,
} from "./record.js";

export type RunSettings = {
    systems: string[];
    budget: number;
    fullBudget: number;
    retrievalOnly: boolean;
};

export function newRunInfo(
    settings: RunSettings,
    accepted: Question[],
    config: EvalConfig,
    snapshot: SnapshotInfo,
    now: Date,
): RunInfo {
    const models = {
        answer: settings.retrievalOnly ? null : (config.answer?.model ?? null),
        judge: settings.retrievalOnly ? null : (config.judge?.model ?? null),
    };
    const hash = createHash("sha256")
        .update(
            JSON.stringify({
                ids: accepted.map((question) => question.id),
                settings,
                models,
            }),
        )
        .digest("hex")
        .slice(0, 8);
    const at = now.toISOString();
    return {
        id: `${at.replace(/[-:]/g, "").slice(0, 15)}-${hash}`,
        at,
        ...settings,
        models,
        snapshot,
        questions: accepted.length,
    };
}

// The model calls a run would make: none for a lookup, an answer and a
// judgement for an abstention, an answer and two judgements for the rest,
// and one more for an update with an older answer.
export function modelCalls(info: RunInfo, accepted: Question[]): number {
    if (info.retrievalOnly) {
        return 0;
    }
    const each = accepted.reduce(
        (sum, question) =>
            sum +
            (question.type === "lookup"
                ? 0
                : question.type === "abstention"
                  ? 2
                  : question.type === "knowledge-update" && question.note !== null
                    ? 4
                    : 3),
        0,
    );
    return each * info.systems.length;
}

const hasEvidence = (ranked: string[], evidence: string[]) =>
    ranked.some((id) => evidence.includes(id));

async function ask(
    question: Question,
    system: System,
    info: RunInfo,
    models: Models | null,
    judges: Judges | null,
): Promise<RunRecord> {
    const started = performance.now();
    let retrieved: Retrieved = { ranked: [], context: "" };
    let error: string | null = null;
    try {
        retrieved = await system.retrieve(
            {
                text: question.question,
                asOf: question.asOf,
                project: question.project,
                exclude: question.exclude,
            },
            system.name === "full" ? info.fullBudget : info.budget,
        );
    } catch (caught) {
        error = failureOf(caught);
    }
    const record: RunRecord = {
        question: question.id,
        system: system.name,
        type: question.type,
        retrieval: {
            ranked: retrieved.ranked.slice(0, 10),
            chars: retrieved.context.length,
            ms: Math.round(performance.now() - started),
            error,
        },
        recall:
            question.evidence.length === 0
                ? null
                : {
                      at5: hasEvidence(retrieved.ranked.slice(0, 5), question.evidence),
                      at10: hasEvidence(retrieved.ranked.slice(0, 10), question.evidence),
                  },
        answer: null,
        judged: { strict: null, lenient: null, declined: null, stale: null },
        failures: [],
    };
    if (models === null || judges === null || question.type === "lookup") {
        return record;
    }
    try {
        record.answer = await models.complete(
            "answer",
            answerPrompt(question, retrieved.context),
        );
    } catch (caught) {
        if (caught instanceof CallCap) {
            throw caught;
        }
        record.failures.push(`answer: ${failureOf(caught)}`);
        return record;
    }
    const outputs = record.answer.text;
    const verdict = async (
        name: keyof RunRecord["judged"],
        judge: Judge,
        reference?: string,
    ) => {
        try {
            record.judged[name] = await judge({
                inputs: question.question,
                outputs,
                ...(reference === undefined ? {} : { referenceOutputs: reference }),
            });
        } catch (caught) {
            if (caught instanceof CallCap) {
                throw caught;
            }
            record.failures.push(`${name}: ${failureOf(caught)}`);
        }
    };
    if (question.type === "abstention") {
        await verdict("declined", judges.declined);
        return record;
    }
    const reference = question.answer ?? "";
    await verdict("strict", judges.strict, reference);
    await verdict("lenient", judges.lenient, reference);
    record.judged.declined = declines(outputs);
    if (question.type === "knowledge-update" && question.note !== null) {
        await verdict("stale", judges.stale, question.note);
    }
    return record;
}

export async function runEvaluation(
    info: RunInfo,
    deps: {
        work: string;
        corpus: Corpus;
        questions: Question[];
        models: Models | null;
        concurrency: number;
        systems?: System[];
    },
): Promise<{ summary: Summary; stopped: string | null }> {
    const accepted = deps.questions.filter((q) => q.status === "accepted");
    if (accepted.length === 0) {
        throw new EvalError(
            "no accepted questions: mine or generate some, then review them",
        );
    }
    await mkdir(runDir(deps.work, info.id), { recursive: true, mode: 0o700 });
    const written = await stat(runInfoPath(deps.work, info.id)).then(
        () => true,
        () => false,
    );
    if (!written) {
        await writeFile(
            runInfoPath(deps.work, info.id),
            `${JSON.stringify(info, null, 4)}\n`,
            { mode: 0o600 },
        );
    }
    const done = new Set(
        (await readRecords(deps.work, info.id)).map(
            (record) => `${record.question}\t${record.system}`,
        ),
    );
    const systems =
        deps.systems ?? info.systems.map((name) => makeSystem(name, deps.corpus));
    const models = info.retrievalOnly ? null : deps.models;
    const judges = models === null ? null : makeJudges(models);
    const tasks = accepted
        .flatMap((question) => systems.map((system) => ({ question, system })))
        .filter(({ question, system }) => !done.has(`${question.id}\t${system.name}`));
    for (const system of systems) {
        await system.prepare?.();
    }
    let stopped: string | null = null;
    let next = 0;
    // Appends one at a time, in the order records complete.
    let writing = Promise.resolve();
    const append = (record: RunRecord) => {
        writing = writing.then(() =>
            appendFile(
                recordsPath(deps.work, info.id),
                `${JSON.stringify(record)}\n`,
                { mode: 0o600 },
            ),
        );
        return writing;
    };
    const worker = async () => {
        while (stopped === null && next < tasks.length) {
            const task = tasks[next++] as (typeof tasks)[number];
            try {
                await append(await ask(task.question, task.system, info, models, judges));
            } catch (error) {
                if (error instanceof CallCap) {
                    stopped = error.message;
                    return;
                }
                throw error;
            }
        }
    };
    try {
        await Promise.all(
            Array.from(
                { length: Math.max(1, Math.min(deps.concurrency, tasks.length)) },
                worker,
            ),
        );
        await writing;
    } finally {
        for (const system of systems) {
            await system.close?.();
        }
    }
    return { summary: await writeRunReport(deps.work, info.id), stopped };
}
```

- [ ] **Step 5: Write the command**

`packages/eval/src/run/command.ts`:

```ts
// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/run/command.ts
//
//

import { type Command, intOf, stringOf, workOf } from "../command.js";
import { EvalError } from "../errors.js";
import { Models } from "../models/client.js";
import { readEvalConfig, requireRole, vendorOf } from "../models/config.js";
import { readQuestions } from "../questions/file.js";
import { readSnapshot, workEnv } from "../snapshot/snapshot.js";
import { openCorpus } from "../systems/corpus.js";
import { SYSTEM_NAMES } from "../systems/system.js";
import { readRunInfo, reportPath } from "./record.js";
import { modelCalls, newRunInfo, runEvaluation } from "./run.js";

function systemsOf(text: string): string[] {
    const names = [
        ...new Set(
            text
                .split(",")
                .map((name) => name.trim())
                .filter((name) => name !== ""),
        ),
    ];
    const unknown = names.find(
        (name) => !(SYSTEM_NAMES as readonly string[]).includes(name),
    );
    if (names.length === 0 || unknown !== undefined) {
        throw new EvalError(
            `--systems takes some of ${SYSTEM_NAMES.join(", ")}, comma-separated`,
        );
    }
    return names;
}

export const runCommand: Command = {
    summary: "ask the accepted questions of each system, and report",
    options: {
        work: { type: "string" },
        systems: { type: "string" },
        budget: { type: "string" },
        "full-budget": { type: "string" },
        "retrieval-only": { type: "boolean" },
        resume: { type: "string" },
        concurrency: { type: "string" },
        "max-calls": { type: "string" },
        "dry-run": { type: "boolean" },
    },
    async run(values, _positionals, io) {
        const work = workOf(values);
        const snapshot = await readSnapshot(work);
        const { questions, problems } = await readQuestions(work);
        for (const problem of problems) {
            io.err(`eval: skipped ${problem}\n`);
        }
        const accepted = questions.filter((q) => q.status === "accepted");
        const config = await readEvalConfig(work);
        const resume = stringOf(values, "resume");
        const info =
            resume !== null
                ? await readRunInfo(work, resume)
                : newRunInfo(
                      {
                          systems: systemsOf(
                              stringOf(values, "systems") ?? SYSTEM_NAMES.join(","),
                          ),
                          budget: intOf(values, "budget", 8000, 500, 1_000_000),
                          fullBudget: intOf(
                              values,
                              "full-budget",
                              400_000,
                              500,
                              10_000_000,
                          ),
                          retrievalOnly: values["retrieval-only"] === true,
                      },
                      accepted,
                      config,
                      snapshot,
                      new Date(),
                  );
        if (values["dry-run"] === true) {
            io.out(
                `dry run: ${accepted.length} questions, ${info.systems.length} systems; ${modelCalls(info, accepted)} model calls\n`,
            );
            return 0;
        }
        let models: Models | null = null;
        if (!info.retrievalOnly) {
            const answer = requireRole(config, "answer");
            const judge = requireRole(config, "judge");
            if (vendorOf(answer.model) === vendorOf(judge.model)) {
                io.err(
                    `eval: the judge (${judge.model}) is of the answering model's vendor; a model of another family judges more fairly\n`,
                );
            }
            models = new Models(config, {
                env: io.env,
                maxCalls:
                    values["max-calls"] === undefined
                        ? null
                        : intOf(values, "max-calls", 0, 1, 1_000_000),
            });
            // A missing key is said before anything is asked.
            models.chat("answer");
            models.chat("judge");
        }
        const corpus = await openCorpus(workEnv(work));
        try {
            const { stopped } = await runEvaluation(info, {
                work,
                corpus,
                questions: accepted,
                models,
                concurrency: intOf(values, "concurrency", 4, 1, 32),
            });
            io.out(`run ${info.id}: ${reportPath(work, info.id)}\n`);
            if (stopped !== null) {
                io.out(
                    `stopped: ${stopped}; resume with \`bun run eval -- run --work ${work} --resume ${info.id}\`\n`,
                );
            }
            return 0;
        } finally {
            corpus.close();
        }
    },
};
```

In `packages/eval/src/cli.ts`, import it and add `run: runCommand,` to
`COMMANDS` between `review` and `compare`:

```ts
import { runCommand } from "./run/command.js";
```

`COMMANDS` is then, in order: `snapshot`, `mine`, `generate`, `review`,
`run`, `compare`.

- [ ] **Step 6: Run it to see it pass**

Run: `bun test packages/eval/src/run`
Expected: PASS, 8 tests. If the dry run counts other than 9, or the
capped run writes other than 3 records, recount from the paragraph
under Step 1 against the question file the test writes; correct the
code if it asks a lookup or judges an abstention twice.

- [ ] **Step 7: Add the files to the guide and commit**

In `packages/eval/AGENTS.md`'s Files, after `run/record.ts`:

```markdown
- `run/judges.ts`: the answering prompt, the judges (openevals' strict
  prompt and ours) and `declines`; `run/run.ts`: `runEvaluation`, which
  appends a record per question and system and resumes where a run
  stopped; `run/command.ts`: the `run` command.
```

Run: `bun run check`
Expected: exit 0.

```bash
bunx biome check --write packages/eval
git add packages/eval
git commit -m "feat(eval): Run the evaluation and resume it" \
  -m "run asks every accepted question of every system, answers within
one budget and judges with openevals, appending a record as each
completes, and writes the report at the end."
```

---

### Task 11: documentation

**Files:**

- Modify: `README.md` (a section on measuring her memory)
- Modify: `packages/eval/AGENTS.md` (Commands)
- Modify: `docs/specs/2026-10-18-memory-evaluation-design.md` (only
  where the code settled a detail differently)

**Interfaces:**

- Consumes: everything above, as built.
- Produces: documents only.

- [ ] **Step 1: Write the README's section**

In `README.md`, after the memory service's section (the paragraph that
ends "`facts/` is moved there once."), add:

````markdown
### Measuring her memory

`bun run eval` measures her memory on questions drawn from her own
data, as [the evaluation's spec](./docs/specs/2026-10-18-memory-evaluation-design.md)
describes. It works on a copy: take a snapshot into a work directory of
your choosing, kept as private as the data directory, since the copy,
the questions and the reports hold her data in clear.

```sh
bun run eval -- snapshot --from ~/.local/share/dorothy --work ~/eval
bun run eval -- mine --work ~/eval     # questions her own reads answer
bun run eval -- run --work ~/eval --retrieval-only
```

`mine` and a retrieval-only run need no model. To draft questions of
LongMemEval's types and to answer and judge them, name a model for each
role in `~/eval/eval.toml`, any OpenAI-compatible Chat Completions
endpoint, with the variable that holds its key:

```toml
[models.generate]
base-url = "https://openrouter.ai/api/v1"
model = "deepseek/deepseek-v3.2"
key = "OPENROUTER_API_KEY"

[models.answer]
base-url = "https://openrouter.ai/api/v1"
model = "openai/gpt-oss-120b"
key = "OPENROUTER_API_KEY"

[models.judge]
base-url = "https://openrouter.ai/api/v1"
model = "google/gemini-2.5-flash"
key = "OPENROUTER_API_KEY"
```

Set the key with `dotenvx set OPENROUTER_API_KEY`, and run under
`dotenvx run --`, so it is read from the encrypted `.env`:

```sh
dotenvx run -- bun run eval -- generate --work ~/eval --count 300
bun run eval -- review --work ~/eval   # accept, edit or reject each
dotenvx run -- bun run eval -- run --work ~/eval --dry-run
dotenvx run -- bun run eval -- run --work ~/eval
bun run eval -- compare --work ~/eval <run> <run>
```

These send passages of her data to the providers you name; a local
server (llama.cpp, Ollama) keeps them home. The judge and the generator
must support structured output. `--max-calls` caps a command's calls,
and a run stopped by it resumes with `--resume <run>`. Each run's
report is `~/eval/runs/<run>/report.md`.
````

- [ ] **Step 2: Add the commands to the package's guide**

In `packages/eval/AGENTS.md`, before `## Files`, add:

```markdown
## Commands

`snapshot`, `mine`, `generate`, `review`, `run` and `compare`, in the
order a user meets them; the README's "Measuring her memory" shows
each. A new command is a `Command` in `cli.ts`'s table, with its
options declared, its failures as `EvalError`s, and a test through
`runCli` with `fakeIo`.
```

- [ ] **Step 3: Check the spec against the code**

Read the spec's Questions, Systems, Models, A run and The report
sections against the code. Where the code settled a detail the spec
leaves open or says otherwise (for instance, that a wrong decline is
caught by `declines`, a pattern, rather than a judge), add a sentence
saying what the code does, and bump the spec's `mtime`. Change no
decision.

- [ ] **Step 4: Check and commit**

Run: `bun run lint:md && bun run check`
Expected: exit 0.

```bash
git add README.md packages/eval/AGENTS.md docs/specs/2026-10-18-memory-evaluation-design.md
git commit -m "docs(eval): Document measuring her memory"
```

---

## Self-review

- **Spec coverage.** Snapshot: Task 2. The question file, its fields and
  malformed lines: Task 3. Mined lookups: Task 4. Generated types,
  counts, schema checks, the abstention's lexical check and the seed:
  Task 7. Review: Task 8. Systems: Task 6. Models, keys by variable,
  retries, the vendor warning, `--max-calls` and `--dry-run`: Tasks 5,
  7 and 10. A run, evidence recall, answering, strict, lenient and
  abstention judgements, records and resume: Task 10. The report and
  compare: Task 9. Failures and privacy: across Tasks 2 to 10 and the
  README in Task 11. Testing with fixtures and a fake model: every task.
- **Not built, as the spec's Later says:** the other systems, an
  agentic mode, LongMemEval-S as a snapshot, the provider checks and a
  second ingest model.
