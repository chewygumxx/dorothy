---
ctime: 2026-10-31
mtime: 2026-10-31
spdx: GPL-3.0-only
title: The memory engine, implementation plan
description: >-
  Task-by-task plan for delivering passages: eval's passage code moved
  into memory, one delivery step shared by recall and the evaluation,
  hits carrying their turns, system variants, and retrieval reported
  stage by stage.
tags:
  - dorothy
  - memory
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-31-memory-engine.md
   -
   -->

# The memory engine, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `subagent-driven-development` to carry out this plan task by task, one
> subagent at a time, never in parallel. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** as [the spec](../specs/2026-10-31-memory-engine-design.md)
says: Dorothy delivers the passage that holds a fact, through one step
her service's recall and her evaluation share, and the evaluation
reports each stage of retrieval apart.

**Architecture:** the passage code moves from `@dorothy/eval` into
`@dorothy/memory`'s `contract/`, beside a new `deliver` and an evidence
source over the recall index. The baseline engine's hits gain their
matched turns and alternate knowledge with episodes. `recallFor` and
eval's `dorothy` system both deliver through `deliver`; eval gains
system variants, a `cited` ceiling and stage counts.

**Tech stack:** Bun, TypeScript, `bun:test`, SQLite FTS5 through
`bun:sqlite`, Biome.

**Spec:** `docs/specs/2026-10-31-memory-engine-design.md`. Every task's
implementer reads its Decisions table.

## Global Constraints

- Every new file carries the house header, copied from a sibling of its
  kind (`packages/memory/src/contract/recall.ts` for TypeScript).
- Imports end in `.js`. Eval imports memory only through
  `@dorothy/memory/evaluation`; whatever eval needs from memory is
  exported there.
- Tests never touch real user data, `secrets.json`, `~/eval` or
  `$XDG_*/dorothy`: roots are `mkdtemp` directories or the existing
  fixtures (`writeArchive`, `snapshotFixture`).
- No model is called by any test or step in this plan.
- `MemoryEngine` keeps its six methods; nothing adds an engine, index or
  service.
- `MemoryHit.turns` is optional and additive; no existing host breaks.
- Markdown lines at most 80 characters, inline code included; no em
  dash anywhere; relative Markdown links, never `[[...]]`.
- `AGENTS.md` budgets: 150 lines for a package's and a nested one,
  header included. `packages/memory/AGENTS.md` and
  `packages/eval/AGENTS.md` are at 150 already: add nothing to them
  without removing as much; memory's changes go in
  `packages/memory/src/contract/AGENTS.md`, eval's systems detail in a
  new `packages/eval/src/systems/AGENTS.md` (Task 6).
- Commits: Conventional Commits, capitalised subject, header at most 50
  characters, body lines at most 72, no agent trailers. Scopes: `core`,
  `memory`, `eval`. Run `bunx biome check --write <paths>` on
  TypeScript first.
- Test-first; `bun run check` passes before each task's last commit.

## Review Focus

1. A hit whose `turns` name turns the conversation no longer holds (a
   re-sync, a hidden turn) gets a passage from word overlap, not an
   empty one or a crash (Task 2).
2. An evidence source that throws for one hit (an unreadable fact file,
   a closed database) leaves that hit as its title and snippet and
   delivers the rest (Task 2).
3. Recall over text holding `</recalled>`, `&` or `<item` stays escaped,
   framed once, within its budget (Task 5).
4. A variant name with a repeated key, an empty or spaced value, a
   trailing colon or options on a system that takes none fails with a
   usage line before the corpus opens or any model is called (Task 3).
5. A question whose gold answer has no terms (only common or short
   words) has coverage `null`, never 0 or `NaN` (Task 6).

## Departures from the spec

Each ruled here, to be recorded in the ledger:

1. `order` is `mergeHits`'s argument, not a `DeliveryPolicy` field: the
   baseline cuts to its limit before delivery sees the hits, so the
   order must be settled where they merge. Cost: none.
2. The policy's `cap` is in characters; the share is `ITEM_SHARE` and
   `dorothy`'s `cap` option, of the whole budget, as the old
   `budget / 4` was. Cost: none.
3. `deliver` takes the query, for passages and excerpts, and an
   `escape` flag for recall's XML frame, besides the spec's arguments;
   each item keeps its delivered text, for coverage. Cost: none.
4. Unconfirmed knowledge carries its warning in the evaluation too, as
   recall needs it; the characterization fixture holds confirmed
   knowledge only. This is the one difference between today's context
   and the new code under today's options. Cost: a context unlike the
   old one where knowledge is unconfirmed.
5. Today's `dorothy` caps passages, never knowledge. The policy gains
   `wholeKnowledge`, and `dorothy` the option `knowledge` (`capped`,
   the default, or `whole`), so that today's behaviour is reproducible
   and the knowledge cap is measured on its own. The spec's runs become:
   1. `dorothy:order=knowledge-first:dedupe=off:seeds=overlap:knowledge=whole`,
      today's;
   2. `dorothy:dedupe=off:seeds=overlap:knowledge=whole`, alternation;
   3. `dorothy:seeds=overlap:knowledge=whole`, duplicates removed;
   4. `dorothy:seeds=overlap`, knowledge capped;
   5. `dorothy:block=0.2` and `dorothy:block=0.6` beside `dorothy`.

   `cited` delivers its knowledge whole, as the spec says. Cost: one
   run more.
6. Escaping comes before the cap, which clips back to an entity's
   start, so an escaped item keeps within its cap; packing may still
   cut the last item inside an entity, which leaves a stray `&am` but
   never breaks the frame. Cost: a few odd characters at the end of a
   cut recall.
7. Delivered and covered count opened items only, and knowledge the
   block gave in full, which `dorothy` reports as items marked
   `block`; a stand-in title and snippet is not delivered evidence.
   Cost: none.

---

## File map

| File | Task | What it holds |
| --- | --- | --- |
| `packages/memory/src/contract/terms.ts` | 1 | `termsOf`, `scoreOf`, `firstTermAt`, moved from eval |
| `packages/memory/src/contract/passage.ts` | 1, 2 | Evidence types, `clip`, `conversationText`, `knowledgeText`, `passage`, `pack` |
| `packages/memory/src/contract/deliver.ts` | 2 | `deliver`, `DeliveryPolicy`, `DeliveredItem`, `EvidenceSource` |
| `packages/memory/src/contract/evidence.ts` | 2 | `indexEvidence`, `turnsOf`, `knowledgeRecord` |
| `packages/memory/src/engine/merge.ts` | 2 | `mergeHits`, `HIT_ORDERS` |
| `packages/memory/src/engine/archive.ts` | 1, 2 | Types alias the evidence types; `block` gives `full` |
| `packages/memory/src/engine/baseline.ts` | 4 | Hits carry `turns`; kinds alternate |
| `packages/core/src/contracts/memory.ts` | 4 | `MemoryHit.turns` |
| `packages/memory/src/contract/recall.ts` | 5 | Recall through `deliver` |
| `packages/memory/src/service/service.ts` | 5 | Recall's evidence source |
| `packages/memory/src/evaluation.ts` | 1, 2 | Exports for eval |
| `packages/eval/src/systems/system.ts` | 3, 6 | Variant names, `Retrieved`'s new fields, `cited` |
| `packages/eval/src/systems/dorothy.ts` | 3 | Through `deliver`, with options |
| `packages/eval/src/systems/cited.ts` | 6 | The ceiling system |
| `packages/eval/src/run/run.ts`, `record.ts` | 6 | Stage fields |
| `packages/eval/src/report/summary.ts`, `markdown.ts` | 6 | Stage counts |
| `docs/reports/2026-10-31-first-evaluation.md`, `README.md` | 7 | Corrections, variants |

---

### Task 1: Move eval's passage code into memory

A pure move: nothing changes behaviour. A characterization test first
records what the `dorothy` system gives today, so later tasks can prove
they kept it.

**Files:**

- Create: `packages/memory/src/contract/terms.ts`,
  `packages/memory/src/contract/terms.test.ts`,
  `packages/memory/src/contract/passage.ts`,
  `packages/memory/src/contract/passage.test.ts`,
  `packages/eval/src/systems/today.fixture.ts`
- Modify: `packages/memory/src/engine/archive.ts`,
  `packages/memory/src/evaluation.ts`,
  `packages/eval/src/systems/corpus.ts`, `system.ts`, `dorothy.ts`,
  `lexical.ts`, `full.ts`, `systems.test.ts`,
  `packages/eval/src/questions/generate.ts`, `review.ts`,
  `packages/eval/AGENTS.md`, `packages/memory/src/contract/AGENTS.md`
- Delete: `packages/eval/src/systems/terms.ts`

**Interfaces:**

- Produces, exported from `@dorothy/memory/evaluation`:

  ```ts
  export type EvidenceTurn = {
      n: number;
      role: "user" | "assistant";
      at: string;
      text: string;
  };
  export type EvidenceConversation = {
      id: string;
      phrase: string;
      project: string | null;
      title: string | null;
      firstAt: string;
      lastAt: string;
      turns: EvidenceTurn[];
  };
  export type EvidenceKnowledge = {
      id: string;
      scope: string;
      type: string;
      title: string;
      description: string;
      body: string;
      at: string;
      retired: { at: string; why: string } | null;
  };
  export function termsOf(text: string): string[];
  export function scoreOf(text: string, terms: readonly string[]): number;
  export function firstTermAt(
      text: string,
      terms: readonly string[],
  ): number | undefined;
  export const clip: (text: string, chars: number) => string;
  export function conversationText(
      conversation: EvidenceConversation,
      turns?: EvidenceTurn[],
  ): string;
  export function knowledgeText(knowledge: EvidenceKnowledge): string;
  export function passage(
      conversation: EvidenceConversation,
      terms: readonly string[],
      chars: number,
  ): string;
  export function pack(
      items: readonly { id: string; text: string }[],
      budget: number,
  ): { text: string; ids: string[] };
  ```

- `archive.ts` keeps its exported names as aliases:
  `ArchiveTurn = EvidenceTurn`,
  `ArchiveConversation = EvidenceConversation & { tags: string[] }`,
  `ArchiveKnowledge = EvidenceKnowledge`.

- [ ] **Step 1: Record today's `dorothy` context**

Before moving anything, write a throwaway script under
`$CLAUDE_JOB_DIR/tmp` (or `mktemp -d`), never in the repository, that
opens the eval fixture corpus as `systems.test.ts` does
(`tempRoot`, `snapshotFixture`, `workEnv`, `openCorpus`) and prints, as
JSON, `{ ranked, context }` of
`makeSystem("dorothy", corpus).retrieve(asked(q), 8000)` for each of:

```ts
const TODAY_QUESTIONS = [
    "Where is my allotment plot?",
    "What do I drink at four in the afternoon?",
    "How do I fix a bicycle puncture?",
] as const;
```

with `asked(q)` as `systems.test.ts` builds it. Write the output into
`packages/eval/src/systems/today.fixture.ts`:

```ts
// What the dorothy system gave on the fixture corpus before delivery
// moved into memory, at a budget of 8,000: with today's options it must
// give exactly this.

export const TODAY_QUESTIONS = [
    "Where is my allotment plot?",
    "What do I drink at four in the afternoon?",
    "How do I fix a bicycle puncture?",
] as const;

export const TODAY: Record<
    (typeof TODAY_QUESTIONS)[number],
    { ranked: string[]; context: string }
> = {
    // The printed values, verbatim.
};
```

Run the script twice. Salience decay is a factor common to every
conversation, so the block's order should not drift with the clock;
if the two outputs differ all the same, stop and report
`NEEDS_CONTEXT` with both outputs, changing nothing.

- [ ] **Step 2: Add the characterization test**

Append to `packages/eval/src/systems/systems.test.ts`:

```ts
describe("the dorothy system's context today", () => {
    for (const question of TODAY_QUESTIONS) {
        it(`holds for ${question}`, async () => {
            const found = await makeSystem("dorothy", corpus).retrieve(
                asked(question),
                8000,
            );
            expect({
                ranked: found.ranked,
                context: found.context,
            }).toEqual(TODAY[question]);
        });
    }
});
```

importing `TODAY` and `TODAY_QUESTIONS` from `./today.fixture.js`.

Run: `bun test packages/eval/src/systems/systems.test.ts`
Expected: PASS (it records today's behaviour).

- [ ] **Step 3: Move the code**

- `packages/eval/src/systems/terms.ts` moves whole to
  `packages/memory/src/contract/terms.ts` (header path updated).
- From `packages/eval/src/systems/corpus.ts`, `clip`, `day`, `minute`,
  `conversationText`, `knowledgeText`, `passage`, `ELLIPSIS` and
  `excerpt` move verbatim to `packages/memory/src/contract/passage.ts`,
  typed with the evidence types above (defined there) instead of the
  archive's, and importing `firstTermAt` and `scoreOf` from
  `./terms.js`. `corpus.ts` keeps `Corpus` and `openCorpus` only.
- `packed` in `packages/eval/src/systems/system.ts` moves verbatim to
  `passage.ts` as `pack`; `packItems` is deleted, its one caller
  (`questions/generate.ts`) using `pack(...).text`.
- `archive.ts` deletes its own three types and declares the aliases
  above, importing the evidence types from `../contract/passage.js`.
- `evaluation.ts` adds:

  ```ts
  export {
      clip,
      conversationText,
      type EvidenceConversation,
      type EvidenceKnowledge,
      type EvidenceTurn,
      knowledgeText,
      pack,
      passage,
  } from "./contract/passage.js";
  export { firstTermAt, scoreOf, termsOf } from "./contract/terms.js";
  ```

- Every eval import of a moved name comes from
  `@dorothy/memory/evaluation`; `bun run typecheck` finds each.

- [ ] **Step 4: Move their tests**

- The `terms` describe block of `systems.test.ts` moves to
  `packages/memory/src/contract/terms.test.ts`.
- The `passage` describe block, and the first two tests of `items`
  (`pack within the budget...`, `report the ids that went in...`),
  rewritten for `pack` (`packItems(x, n)` becomes `pack(x, n).text`),
  move to `packages/memory/src/contract/passage.test.ts`, its
  `longTurn` typed `EvidenceConversation` (drop `tags`).
- `pass the turns that match, with their neighbours` stays in
  `systems.test.ts`, as it reads the eval fixture, importing `passage`
  from `@dorothy/memory/evaluation`.

- [ ] **Step 5: Guides**

- `packages/eval/AGENTS.md`, the systems bullet becomes, still five
  lines:

  ```markdown
  - `systems/`: `System` and `makeSystem` (`system.ts`); the corpus, the
    snapshot's archive opened once (`corpus.ts`); and the three systems,
    `dorothy.ts`, `lexical.ts` and `full.ts`, whose passages, terms and
    packing are memory's, from `@dorothy/memory/evaluation`. A new system
    is a maker in `system.ts`'s table.
  ```

- `packages/memory/src/contract/AGENTS.md`, Files: add
  "- `passage.ts`, `terms.ts`: items as text a model reads, passages of
  a conversation by its matching turns, packing within a budget, and
  the query's terms; shared with the evaluation."
- The evaluation's door section: it also exports the passage and term
  code.

- [ ] **Step 6: Verify and commit**

Run: `bun run check`
Expected: PASS, the characterization test among them.

```bash
git add packages/memory packages/eval
git commit -m "refactor(memory): Move eval's passage code here"
```

---

### Task 2: Delivery in memory

The new primitives: hits merged by kind, passages seeded from matched
turns, packing that reports what went in, `deliver`, and an evidence
source over the recall index. Nothing calls them yet but tests.

**Files:**

- Create: `packages/memory/src/engine/merge.ts`, `merge.test.ts`,
  `packages/memory/src/contract/deliver.ts`, `deliver.test.ts`,
  `packages/memory/src/contract/evidence.ts`, `evidence.test.ts`
- Modify: `packages/memory/src/contract/passage.ts`,
  `passage.test.ts`, `packages/memory/src/engine/archive.ts`,
  `archive.test.ts`, `packages/memory/src/evaluation.ts`,
  `packages/eval/src/systems/lexical.ts`, `dorothy.ts`, `full.ts`,
  `systems.test.ts`, `packages/eval/src/questions/review.ts`,
  `packages/memory/src/contract/AGENTS.md`

**Interfaces:**

- Consumes: Task 1's evidence types, `pack`, `passage`, `termsOf`.
- Produces:

  ```ts
  // engine/merge.ts
  export const HIT_ORDERS = ["alternate", "knowledge-first"] as const;
  export type HitOrder = (typeof HIT_ORDERS)[number];
  export function mergeHits(
      knowledge: readonly MemoryHit[],
      episodes: readonly MemoryHit[],
      order: HitOrder,
      limit: number,
  ): MemoryHit[];

  // contract/passage.ts (changed)
  export type TurnRange = { from: number; through: number };
  export type Passage = {
      text: string;
      turns: TurnRange | null;
      cut: boolean;
  };
  export function passage(
      conversation: EvidenceConversation,
      terms: readonly string[],
      chars: number,
      seeds?: readonly number[],
  ): Passage;
  export function pack(
      items: readonly { id: string; text: string }[],
      budget: number,
  ): { text: string; ids: string[]; texts: string[]; cut: boolean };

  // contract/deliver.ts
  export type EvidenceSource = {
      conversation(id: string): Promise<EvidenceConversation | undefined>;
      knowledge(id: string): Promise<EvidenceKnowledge | undefined>;
  };
  export const PASSAGE_SEEDS = ["search", "overlap"] as const;
  export type PassageSeeds = (typeof PASSAGE_SEEDS)[number];
  export const ITEM_SHARE = 0.25;
  export type DeliveryPolicy = {
      cap: number;
      seeds: PassageSeeds;
      shown: readonly string[];
      wholeKnowledge: boolean;
  };
  export type DeliveredItem = {
      id: string;
      kind: "knowledge" | "episode";
      turns: TurnRange | null;
      text: string;
      cut: boolean;
      opened: boolean;
  };
  export type Delivery = { text: string; items: DeliveredItem[] };
  export type DeliveryRequest = {
      query: string;
      hits: readonly MemoryHit[];
      budget: number;
      policy?: Partial<DeliveryPolicy>;
      escape?: boolean;
  };
  export function deliver(
      request: DeliveryRequest,
      source: EvidenceSource,
  ): Promise<Delivery>;

  // contract/evidence.ts
  export function turnsOf(index: RecallIndex, phrase: string): EvidenceTurn[];
  export function knowledgeRecord(scope: Scope, fact: Fact): EvidenceKnowledge;
  export function indexEvidence(
      index: RecallIndex,
      root: string,
  ): EvidenceSource;

  // engine/archive.ts: Archive.block now resolves to
  // { text: string; ids: string[]; full: string[] }
  ```

  All of these but `turnsOf`, `knowledgeRecord` and `indexEvidence` are
  exported from `@dorothy/memory/evaluation`.

- [ ] **Step 1: Write the failing merge tests**

`packages/memory/src/engine/merge.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { MemoryHit } from "@dorothy/core";
import { mergeHits } from "./merge.js";

const hit = (id: string): MemoryHit => ({
    id,
    kind: id.startsWith("k:") ? "knowledge" : "episode",
    scope: "personal",
    title: id,
    snippet: "",
});
const ids = (hits: MemoryHit[]) => hits.map((each) => each.id);
const k = ["k:personal/a", "k:personal/b", "k:personal/c"].map(hit);
const e = ["c:one", "c:two"].map(hit);

describe("mergeHits", () => {
    it("alternates by rank, the best episode first", () => {
        expect(ids(mergeHits(k, e, "alternate", 10))).toEqual([
            "c:one",
            "k:personal/a",
            "c:two",
            "k:personal/b",
            "k:personal/c",
        ]);
    });

    it("keeps every knowledge hit first when asked", () => {
        expect(ids(mergeHits(k, e, "knowledge-first", 4))).toEqual([
            "k:personal/a",
            "k:personal/b",
            "k:personal/c",
            "c:one",
        ]);
    });

    it("cuts to the limit after merging, so neither kind starves", () => {
        expect(ids(mergeHits(k, e, "alternate", 2))).toEqual([
            "c:one",
            "k:personal/a",
        ]);
    });

    it("takes either list empty", () => {
        expect(ids(mergeHits([], e, "alternate", 10))).toEqual(ids(e));
        expect(ids(mergeHits(k, [], "alternate", 10))).toEqual(ids(k));
        expect(mergeHits([], [], "alternate", 10)).toEqual([]);
    });
});
```

Run: `bun test packages/memory/src/engine/merge.test.ts`
Expected: FAIL, `./merge.js` not found.

- [ ] **Step 2: Write `merge.ts`**

```ts
// Knowledge and episode hits as one list. Their BM25 scores come from
// different tables, so rank is all they share: alternating them is what
// reciprocal rank fusion gives two lists that never share an item.

import type { MemoryHit } from "@dorothy/core";

export const HIT_ORDERS = ["alternate", "knowledge-first"] as const;
export type HitOrder = (typeof HIT_ORDERS)[number];

// At most limit hits: alternating by rank, the best episode first, or
// every knowledge hit first, as the baseline gave them before.
export function mergeHits(
    knowledge: readonly MemoryHit[],
    episodes: readonly MemoryHit[],
    order: HitOrder,
    limit: number,
): MemoryHit[] {
    if (order === "knowledge-first") {
        return [...knowledge, ...episodes].slice(0, Math.max(0, limit));
    }
    const merged: MemoryHit[] = [];
    const longest = Math.max(knowledge.length, episodes.length);
    for (let at = 0; at < longest; at++) {
        for (const hit of [episodes[at], knowledge[at]]) {
            if (hit !== undefined) {
                merged.push(hit);
            }
        }
    }
    return merged.slice(0, Math.max(0, limit));
}
```

Run: `bun test packages/memory/src/engine/merge.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing passage and pack tests**

Add to `packages/memory/src/contract/passage.test.ts` (existing passage
tests now read `.text` of the result):

```ts
const AT = "2026-10-01T09:00:00.000Z";
const talk: EvidenceConversation = {
    id: "c:talk",
    phrase: "talk",
    project: null,
    title: "Talk",
    firstAt: AT,
    lastAt: AT,
    turns: [
        { n: 1, role: "user", at: AT, text: "Hello there." },
        { n: 2, role: "assistant", at: AT, text: "Hi." },
        { n: 3, role: "user", at: AT, text: "My bicycle is crimson." },
        { n: 4, role: "assistant", at: AT, text: "Noted, crimson." },
        { n: 5, role: "user", at: AT, text: "Anything else?" },
    ],
};

describe("passage seeds", () => {
    it("starts from the seeds, with their neighbours", () => {
        const found = passage(talk, ["hello"], 1000, [3]);
        expect(found.turns).toEqual({ from: 1, through: 4 });
        expect(found.text).toContain("[3] user");
        // The seed's neighbours come before the overlap's turn.
        const tight = passage(talk, ["hello"], 130, [3]);
        expect(tight.text).toContain("crimson");
    });

    it("falls back to overlap for seeds the conversation lacks", () => {
        expect(passage(talk, ["hello"], 1000, [99]).turns).toEqual({
            from: 1,
            through: 2,
        });
    });

    it("gives no range when only the head fits", () => {
        const found = passage(talk, ["bicycle"], 10);
        expect(found.turns).toBeNull();
        expect(found.text.length).toBeLessThanOrEqual(10);
    });

    it("gives an excerpt's turn as its range", () => {
        const long: EvidenceConversation = {
            ...talk,
            turns: [
                {
                    n: 7,
                    role: "user",
                    at: AT,
                    text: `My bicycle is crimson. ${"word ".repeat(500)}`,
                },
            ],
        };
        const found = passage(long, ["bicycle"], 200);
        expect(found.turns).toEqual({ from: 7, through: 7 });
        expect(found.cut).toBe(true);
        expect(passage(talk, ["bicycle"], 1000).cut).toBe(false);
    });
});

describe("pack's account", () => {
    it("gives each item's text as it went in, and whether one was cut", () => {
        const items = [
            { id: "c:a", text: "x".repeat(50) },
            { id: "c:b", text: "y".repeat(50) },
        ];
        const whole = pack(items, 400);
        expect(whole.texts).toEqual(["x".repeat(50), "y".repeat(50)]);
        expect(whole.cut).toBe(false);
        const cut = pack(items, 120);
        expect(cut.ids).toEqual(["c:a", "c:b"]);
        expect(cut.texts[1]?.length).toBeLessThan(50);
        expect(cut.cut).toBe(true);
        expect(pack(items, 0)).toEqual({
            text: "",
            ids: [],
            texts: [],
            cut: false,
        });
    });
});
```

In the `tight` case, 130 characters hold the head (30) and turns 2
and 3 (118 in all); turn 4 would make 167.

Run: `bun test packages/memory/src/contract/passage.test.ts`
Expected: FAIL (`turns` undefined; `pack` lacks `texts`).

- [ ] **Step 4: Change `passage` and `pack`**

In `passage.ts`:

```ts
export type TurnRange = { from: number; through: number };
// A passage, its first and last turn, and whether its text was cut
// short rather than ended at a turn.
export type Passage = {
    text: string;
    turns: TurnRange | null;
    cut: boolean;
};

// The turns that best match, each with its neighbours, in order, within
// chars: the seeds first (search's matched turns, by number), then the
// turns by how many terms they hold; the first turn where nothing
// matches. A first turn too long for chars is excerpted around its first
// match, not left out.
export function passage(
    conversation: EvidenceConversation,
    terms: readonly string[],
    chars: number,
    seeds: readonly number[] = [],
): Passage {
    const turns = conversation.turns;
    const seeded = seeds
        .map((n) => turns.findIndex((turn) => turn.n === n))
        .filter((at) => at >= 0);
    const scored = turns
        .map((turn, at) => ({ at, score: scoreOf(turn.text, terms) }))
        .filter((each) => each.score > 0)
        .sort((a, b) => b.score - a.score || a.at - b.at)
        .map((each) => each.at);
    const order = [...new Set([...seeded, ...scored])];
    if (order.length === 0) {
        order.push(0);
    }
    const chosen = new Set<number>();
    const picked = () =>
        [...chosen]
            .sort((a, b) => a - b)
            .map((at) => turns[at] as EvidenceTurn);
    const result = (whole: string): Passage => {
        const numbers = picked().map((turn) => turn.n);
        const [from, through] = [numbers[0], numbers.at(-1)];
        const text = clip(whole, chars);
        return {
            text,
            turns:
                from === undefined || through === undefined
                    ? null
                    : { from, through },
            cut: text.length < whole.length,
        };
    };
    const render = () => conversationText(conversation, picked());
    for (const at of order) {
        for (const near of [at, at - 1, at + 1]) {
            if (near < 0 || near >= turns.length || chosen.has(near)) {
                continue;
            }
            chosen.add(near);
            if (render().length > chars) {
                chosen.delete(near);
                return chosen.size === 0
                    ? excerpt(
                          conversation,
                          turns[near] as EvidenceTurn,
                          terms,
                          chars,
                      )
                    : result(render());
            }
        }
    }
    return result(render());
}
```

`excerpt` returns a `Passage`: `{ text, turns: { from: turn.n, through:
turn.n }, cut: true }`, or `{ text: clip(...), turns: null, cut: true }`
where no room is left. With no seeds the order is today's, so the
existing tests, read through `.text`, still pass.

`pack` keeps its loop and also collects each packed text and whether
the last was cut:

```ts
// Items as <item> elements within budget, the last one cut to fit: the
// text, the ids that went in, each one's text as it went in, and
// whether the last was cut.
export function pack(
    items: readonly { id: string; text: string }[],
    budget: number,
): { text: string; ids: string[]; texts: string[]; cut: boolean } {
    const parts: string[] = [];
    const ids: string[] = [];
    const texts: string[] = [];
    let left = budget;
    let cut = false;
    for (const item of items) {
        const open = `<item id="${item.id}">\n`;
        const close = "\n</item>\n";
        const room = left - open.length - close.length;
        if (room <= 0) {
            break;
        }
        const text = item.text.slice(0, room);
        parts.push(open + text + close);
        ids.push(item.id);
        texts.push(text);
        left -= open.length + text.length + close.length;
        if (text.length < item.text.length) {
            cut = true;
            break;
        }
    }
    return { text: parts.join(""), ids, texts, cut };
}
```

Eval's callers of `passage` take `.text`: `lexical.ts`, `dorothy.ts`,
`questions/review.ts` (its `indent(...)`) and the test `pass the turns
that match, with their neighbours` in `systems.test.ts`.

Run: `bun test packages/memory/src/contract/passage.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing delivery tests**

`packages/memory/src/contract/deliver.test.ts`, reusing the `talk`
conversation of Step 3 (copy it; tests do not import each other):

```ts
import { describe, expect, it } from "bun:test";
import type { MemoryHit } from "@dorothy/core";
import { UNCONFIRMED } from "../facts/file.js";
import { deliver, type EvidenceSource } from "./deliver.js";
import type {
    EvidenceConversation,
    EvidenceKnowledge,
} from "./passage.js";

// talk, as in passage.test.ts.
const tea: EvidenceKnowledge = {
    id: "k:personal/likes-tea",
    scope: "personal",
    type: "user",
    title: "Likes tea",
    description: "Tea.",
    body: "The user likes green tea.",
    at: AT,
    retired: null,
};
const sourceOf = (
    conversations: EvidenceConversation[],
    knowledge: EvidenceKnowledge[],
): EvidenceSource => ({
    conversation: async (id) => conversations.find((c) => c.id === id),
    knowledge: async (id) => knowledge.find((k) => k.id === id),
});
const source = sourceOf([talk], [tea]);
const episode = (id: string, turns?: number[]): MemoryHit => ({
    id,
    kind: "episode",
    scope: "personal",
    title: "Talk",
    snippet: "a snippet",
    ...(turns === undefined ? {} : { turns }),
});
const fact = (id: string, unconfirmed?: string): MemoryHit => ({
    id,
    kind: "knowledge",
    scope: "personal",
    title: "Likes tea",
    snippet: "Tea.",
    ...(unconfirmed === undefined ? {} : { unconfirmed }),
});
const ask = (hits: MemoryHit[], budget = 8000) => ({
    query: "what colour is my bicycle",
    hits,
    budget,
});

describe("deliver", () => {
    it("gives an episode as a passage around its matched turns", async () => {
        const { items, text } = await deliver(
            ask([episode("c:talk", [3])]),
            source,
        );
        expect(items[0]?.turns).toEqual({ from: 2, through: 4 });
        expect(items[0]?.opened).toBe(true);
        expect(text).toContain('<item id="c:talk">');
        expect(text).toContain("My bicycle is crimson.");
    });

    it("ignores the matched turns when seeds are overlap", async () => {
        const { items } = await deliver(
            {
                ...ask([episode("c:talk", [5])]),
                query: "hello",
                policy: { seeds: "overlap" },
            },
            source,
        );
        expect(items[0]?.turns).toEqual({ from: 1, through: 2 });
    });

    it("gives knowledge whole, its warning first", async () => {
        const { items } = await deliver(
            ask([fact("k:personal/likes-tea", UNCONFIRMED)]),
            source,
        );
        expect(items[0]?.text).toStartWith(`[${UNCONFIRMED}]\nLikes tea`);
        expect(items[0]?.text).toContain("The user likes green tea.");
    });

    it("keeps the hits' order", async () => {
        const { items } = await deliver(
            ask([fact("k:personal/likes-tea"), episode("c:talk", [3])]),
            source,
        );
        expect(items.map((item) => item.id)).toEqual([
            "k:personal/likes-tea",
            "c:talk",
        ]);
    });

    it("leaves out knowledge shown, not an episode whose note was", async () => {
        const { items } = await deliver(
            {
                ...ask([fact("k:personal/likes-tea"), episode("c:talk")]),
                policy: { shown: ["k:personal/likes-tea", "c:talk"] },
            },
            source,
        );
        expect(items.map((item) => item.id)).toEqual(["c:talk"]);
    });

    it("cuts an item to the cap and says so", async () => {
        const long = { ...tea, body: "word ".repeat(1000) };
        const { items } = await deliver(
            ask([fact("k:personal/likes-tea")]),
            sourceOf([], [long]),
        );
        expect(items[0]?.text.length).toBeLessThanOrEqual(2000);
        expect(items[0]?.cut).toBe(true);
    });

    it("gives knowledge whole past the cap when told", async () => {
        const long = { ...tea, body: "word ".repeat(1000) };
        const { items } = await deliver(
            {
                ...ask([fact("k:personal/likes-tea")]),
                policy: { wholeKnowledge: true },
            },
            sourceOf([], [long]),
        );
        expect(items[0]?.text.length).toBeGreaterThan(2000);
        expect(items[0]?.cut).toBe(false);
    });

    it("keeps an escaped item within its cap, never inside an entity", async () => {
        const sharp = { ...tea, body: "&".repeat(1000) };
        const { items } = await deliver(
            { ...ask([fact("k:personal/likes-tea")]), escape: true },
            sourceOf([], [sharp]),
        );
        const text = items[0]?.text ?? "";
        expect(text.length).toBeLessThanOrEqual(2000);
        expect(text).toMatch(/&amp;$/);
        expect(items[0]?.cut).toBe(true);
    });

    it("stands an unopened source's title and snippet in", async () => {
        const { items } = await deliver(ask([episode("c:gone", [1])]), source);
        expect(items[0]).toMatchObject({
            text: "Talk: a snippet",
            opened: false,
            turns: null,
        });
    });

    it("stands the snippet in where the source throws", async () => {
        const broken: EvidenceSource = {
            conversation: async () => {
                throw new Error("database closed");
            },
            knowledge: async (id) => (id === tea.id ? tea : undefined),
        };
        const { items } = await deliver(
            ask([episode("c:talk", [3]), fact("k:personal/likes-tea")]),
            broken,
        );
        expect(items.map((item) => item.opened)).toEqual([false, true]);
    });

    it("delivers nothing where no item's frame fits", async () => {
        expect(await deliver(ask([episode("c:talk", [3])], 10), source))
            .toEqual({ text: "", items: [] });
    });

    it("escapes for an XML frame when asked", async () => {
        const sharp = { ...tea, body: "</recalled> & <b>" };
        const { text } = await deliver(
            { ...ask([fact("k:personal/likes-tea")]), escape: true },
            sourceOf([], [sharp]),
        );
        expect(text).toContain("&lt;/recalled&gt; &amp; &lt;b&gt;");
        expect(text).not.toContain("</recalled>");
    });
});
```

Run: `bun test packages/memory/src/contract/deliver.test.ts`
Expected: FAIL, `./deliver.js` not found.

- [ ] **Step 6: Write `deliver.ts`**

```ts
// Ranked hits as the text a model reads, within a budget: each episode
// as a passage around the turns search matched, each piece of knowledge
// as its text, none past its cap. Recall and the evaluation both deliver
// through it, so the evaluation measures what hosts receive.

import type { MemoryHit } from "@dorothy/core";
import { escapeXml } from "../memory/block.js";
import {
    clip,
    type EvidenceConversation,
    type EvidenceKnowledge,
    knowledgeText,
    pack,
    passage,
    type TurnRange,
} from "./passage.js";
import { termsOf } from "./terms.js";

// What delivery reads, by contract id: undefined for what it cannot
// open.
export type EvidenceSource = {
    conversation(id: string): Promise<EvidenceConversation | undefined>;
    knowledge(id: string): Promise<EvidenceKnowledge | undefined>;
};
export const PASSAGE_SEEDS = ["search", "overlap"] as const;
export type PassageSeeds = (typeof PASSAGE_SEEDS)[number];
// The share of a budget one item may take, by default.
export const ITEM_SHARE = 0.25;
export type DeliveryPolicy = {
    // Characters at most for one item.
    cap: number;
    // Whether a passage starts from search's matched turns, or from the
    // turns sharing most of the query's words.
    seeds: PassageSeeds;
    // Ids given in full already: knowledge among them is left out.
    shown: readonly string[];
    // Whether knowledge goes in whole, past the cap, as the evaluation's
    // dorothy system gave it before delivery was shared.
    wholeKnowledge: boolean;
};
export type DeliveredItem = {
    id: string;
    kind: "knowledge" | "episode";
    // A passage's first and last turn; null for anything else.
    turns: TurnRange | null;
    // As it went into the text.
    text: string;
    cut: boolean;
    // False where its title and snippet stood in for its source.
    opened: boolean;
};
export type Delivery = { text: string; items: DeliveredItem[] };
export type DeliveryRequest = {
    query: string;
    hits: readonly MemoryHit[];
    budget: number;
    policy?: Partial<DeliveryPolicy>;
    // Escaped for an XML frame, as recall's is; the evaluation reads
    // raw text.
    escape?: boolean;
};

type Rendered = Omit<DeliveredItem, "text"> & { whole: string };
// How an item's text is made ready: escaped or not, then cut to a
// length, never inside an entity the escaping made.
type Finish = (text: string, chars: number) => string;

const raw: Finish = (text, chars) => clip(text, chars);
const escaped: Finish = (text, chars) =>
    clip(escapeXml(text), chars).replace(/&[a-z]*$/, "");

async function render(
    hit: MemoryHit,
    source: EvidenceSource,
    terms: readonly string[],
    policy: DeliveryPolicy,
    finish: Finish,
): Promise<Rendered> {
    const mark = hit.unconfirmed === undefined ? "" : `[${hit.unconfirmed}]\n`;
    const item = (
        text: string,
        chars: number,
        fields: Pick<Rendered, "turns" | "opened"> & { cut?: boolean },
    ): Rendered => {
        const whole = finish(text, chars);
        return {
            id: hit.id,
            kind: hit.kind,
            turns: fields.turns,
            whole,
            cut: (fields.cut ?? false) || whole.length < finish(text, Infinity).length,
            opened: fields.opened,
        };
    };
    try {
        if (hit.kind === "episode") {
            const conversation = await source.conversation(hit.id);
            if (conversation !== undefined) {
                const seeds =
                    policy.seeds === "search" ? (hit.turns ?? []) : [];
                const found = passage(conversation, terms, policy.cap, seeds);
                return item(found.text, policy.cap, {
                    turns: found.turns,
                    opened: true,
                    cut: found.cut,
                });
            }
        } else {
            const knowledge = await source.knowledge(hit.id);
            if (knowledge !== undefined) {
                return item(
                    mark + knowledgeText(knowledge),
                    policy.wholeKnowledge ? Infinity : policy.cap,
                    { turns: null, opened: true },
                );
            }
        }
    } catch {
        // An unreadable source stands in as its title and snippet.
    }
    return item(`${mark}${hit.title}: ${hit.snippet}`, policy.cap, {
        turns: null,
        opened: false,
    });
}

export async function deliver(
    request: DeliveryRequest,
    source: EvidenceSource,
): Promise<Delivery> {
    const policy: DeliveryPolicy = {
        cap: Math.floor(request.budget * ITEM_SHARE),
        seeds: "search",
        shown: [],
        wholeKnowledge: false,
        ...request.policy,
    };
    const finish = request.escape === true ? escaped : raw;
    const terms = termsOf(request.query);
    const shown = new Set(policy.shown);
    const rendered: Rendered[] = [];
    for (const hit of request.hits) {
        if (hit.kind === "knowledge" && shown.has(hit.id)) {
            continue;
        }
        rendered.push(await render(hit, source, terms, policy, finish));
    }
    const packed = pack(
        rendered.map((item) => ({ id: item.id, text: item.whole })),
        Math.max(0, request.budget),
    );
    const last = packed.ids.length - 1;
    return {
        text: packed.text,
        items: packed.ids.map((_, at) => {
            const { whole: _whole, ...item } = rendered[at] as Rendered;
            return {
                ...item,
                text: packed.texts[at] as string,
                cut: item.cut || (at === last && packed.cut),
            };
        }),
    };
}
```

`clip(text, Infinity)` returns the text whole: `text.length <=
Infinity`. An item's `text` is what went into the context, escaped
where `escape` is set.

Run: `bun test packages/memory/src/contract/deliver.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing evidence tests**

`packages/memory/src/contract/evidence.test.ts`, building an index over
`writeArchive` as `archive.test.ts` sets up its environment:

```ts
let root: string;
let env: Record<string, string>;
let index: RecallIndex;
const [tea, secret] = [1, 3].map(fixturePhrase) as [string, string];
const at = "2026-10-15T09:30:00.000Z";

beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "dorothy-evidence-"));
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
                phrase: secret,
                hidden: true,
                turns: [{ role: "user", text: "A secret.", at }],
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
        ],
    });
    mkdirSync(dirname(indexPath(env)), { recursive: true });
    index = RecallIndex.open(indexPath(env));
    await baselineEngine({
        env,
        index,
        halfLifeDays: 30,
        reviewer: null,
    }).index();
});
afterEach(() => {
    index.close();
    rmSync(root, { recursive: true, force: true });
});

describe("indexEvidence", () => {
    it("gives a visible conversation's turns in order", async () => {
        const found = await indexEvidence(index, dataRoot(env)).conversation(
            `c:${tea}`,
        );
        expect(found).toMatchObject({
            id: `c:${tea}`,
            phrase: tea,
            project: "github.com/me/app",
            title: "Tea",
        });
        expect(found?.turns.map((turn) => turn.text)).toEqual([
            "I like green tea.",
            "Noted.",
        ]);
        expect(found?.turns[0]?.at).toBe(at);
    });

    it("gives nothing for a hidden, unknown or malformed id", async () => {
        const evidence = indexEvidence(index, dataRoot(env));
        expect(await evidence.conversation(`c:${secret}`)).toBeUndefined();
        expect(await evidence.conversation("c:nothing-here")).toBeUndefined();
        expect(await evidence.conversation("k:personal/likes-tea"))
            .toBeUndefined();
    });

    it("gives knowledge by its id", async () => {
        const evidence = indexEvidence(index, dataRoot(env));
        expect(await evidence.knowledge("k:personal/likes-tea"))
            .toMatchObject({
                title: "Likes tea",
                scope: "personal",
                body: "The user likes green tea.",
                retired: null,
            });
        expect(await evidence.knowledge("k:personal/nothing")).toBeUndefined();
        expect(await evidence.knowledge("c:nothing")).toBeUndefined();
    });

    it("gives a project's knowledge by its id", async () => {
        await writeArchive(env, {
            conversations: [],
            knowledge: [
                {
                    scope: "github.com/me/app",
                    name: "uses-rust",
                    title: "Uses Rust",
                    body: "The app is in Rust.",
                    at,
                },
            ],
        });
        expect(
            await indexEvidence(index, dataRoot(env)).knowledge(
                "k:projects/github.com/me/app/uses-rust",
            ),
        ).toMatchObject({ scope: "github.com/me/app", title: "Uses Rust" });
    });
});
```

with the imports these need (`bun:test`; `node:fs`'s `mkdirSync`,
`mkdtempSync`, `rmSync`; `node:os`'s `tmpdir`; `node:path`'s `dirname`,
`join`; `baselineEngine`, `dataRoot`, `fixturePhrase`, `writeArchive`,
`indexPath`, `RecallIndex`, `indexEvidence`).

Run: `bun test packages/memory/src/contract/evidence.test.ts`
Expected: FAIL, `./evidence.js` not found.

- [ ] **Step 8: Write `evidence.ts`, and use it in the archive**

```ts
// What delivery reads of Dorothy's own archive: a visible conversation's
// turns from the recall index by contract id, under the index's lock,
// and a piece of knowledge from its own file.

import { knowledgeId, parseMemoryId } from "@dorothy/core";
import { knowledgePath } from "../engine/engine.js";
import type { Fact } from "../facts/file.js";
import {
    factPath,
    PERSONAL,
    readFactFile,
    type Scope,
} from "../facts/store.js";
import type { RecallIndex } from "../recall/store.js";
import type { EvidenceSource } from "./deliver.js";
import type {
    EvidenceConversation,
    EvidenceKnowledge,
    EvidenceTurn,
} from "./passage.js";

type TurnRow = {
    n: number;
    role: "user" | "assistant";
    at: number;
    text: string;
};
type ConversationRow = {
    project: string | null;
    title: string | null;
    first_at: number;
    last_at: number;
};

const iso = (ms: number) => new Date(ms).toISOString();

export function turnsOf(index: RecallIndex, phrase: string): EvidenceTurn[] {
    return (
        index.db
            .query(
                "SELECT n, role, at, text FROM turns WHERE phrase = ? ORDER BY n",
            )
            .all(phrase) as TurnRow[]
    ).map((turn) => ({ ...turn, at: iso(turn.at) }));
}

export function knowledgeRecord(scope: Scope, fact: Fact): EvidenceKnowledge {
    return {
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
    };
}

// A knowledge id's scope and name: personal/<name>, or
// projects/<id>/<name>, whose id may hold slashes.
function scopeOf(path: string): { scope: Scope; name: string } | null {
    const at = path.lastIndexOf("/");
    const [where, name] = [path.slice(0, at), path.slice(at + 1)];
    if (where === "personal") {
        return { scope: PERSONAL, name };
    }
    return where.startsWith("projects/")
        ? { scope: { kind: "project", id: where.slice(9) }, name }
        : null;
}

export function indexEvidence(
    index: RecallIndex,
    root: string,
): EvidenceSource {
    return {
        async conversation(id): Promise<EvidenceConversation | undefined> {
            const parsed = parseMemoryId(id);
            if (parsed === null || parsed.kind !== "conversation") {
                return undefined;
            }
            return index.exclusive(() => {
                const row = index.db
                    .query(
                        `SELECT project, title, first_at, last_at
                         FROM conversations
                         WHERE phrase = ? AND hidden = 0
                             AND first_at IS NOT NULL`,
                    )
                    .get(parsed.phrase) as ConversationRow | null;
                return row === null
                    ? undefined
                    : {
                          id,
                          phrase: parsed.phrase,
                          project: row.project,
                          title: row.title,
                          firstAt: iso(row.first_at),
                          lastAt: iso(row.last_at),
                          turns: turnsOf(index, parsed.phrase),
                      };
            });
        },
        async knowledge(id) {
            const parsed = parseMemoryId(id);
            const target =
                parsed?.kind === "knowledge" ? scopeOf(parsed.path) : null;
            if (target === null) {
                return undefined;
            }
            const read = await readFactFile(
                factPath(root, target.scope, target.name),
                target.name,
            );
            return read.kind === "ok"
                ? knowledgeRecord(target.scope, read.fact)
                : undefined;
        },
    };
}
```

In `archive.ts`: `knowledge()` maps with `knowledgeRecord`;
`conversations()` reads each conversation's turns with `turnsOf` (its
own turn query and `TurnRow` go); `block` also returns
`full: response.items.filter((item) => item.tier === "full").map((item)
=> item.id)`, and the `Archive` type says so. Add to `archive.test.ts`:

```ts
it("names the block's items given in full", async () => {
    const block = await (archive as Archive).block({
        project: null,
        budget: 10_000,
        exclude: null,
    });
    expect(block.full.length).toBeGreaterThan(0);
    expect(block.full.every((id) => block.ids.includes(id))).toBe(true);
});
```

Run: `bun test packages/memory/src/contract packages/memory/src/engine`
Expected: PASS.

- [ ] **Step 9: Exports and guide**

`evaluation.ts` adds `deliver`, `ITEM_SHARE`, `PASSAGE_SEEDS` and the
types `DeliveredItem`, `Delivery`, `DeliveryPolicy`, `EvidenceSource`,
`PassageSeeds` from `./contract/deliver.js`; `type Passage` and
`type TurnRange` from `./contract/passage.js`; `HIT_ORDERS`,
`mergeHits` and `type HitOrder` from `./engine/merge.js`.

`packages/memory/src/contract/AGENTS.md`, Files: add

```text
- `deliver.ts`: ranked hits as the text a model reads, within a
  budget: episodes as passages from search's matched turns, knowledge
  whole, each within its cap, knowledge already shown left out, and an
  unreadable source as its title and snippet. Recall and the
  evaluation's `dorothy` system deliver through it. `evidence.ts`: its
  source over the recall index, visible conversations only.
```

and in the `../engine/` line, `merge.ts`'s `mergeHits`.

- [ ] **Step 10: Verify and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add packages/memory packages/eval
git commit -m "feat(memory): Deliver hits as passages"
```

---

### Task 3: Eval's system variants, and `dorothy` through delivery

**Files:**

- Modify: `packages/eval/src/systems/system.ts`, `dorothy.ts`,
  `corpus.ts`, `systems.test.ts`, `packages/eval/src/run/run.ts`,
  `packages/eval/src/run/command.ts`, `packages/eval/src/cli.test.ts`
  or wherever `--systems` errors are tested (find with
  `grep -rn "systems takes" packages/eval/src`)

**Interfaces:**

- Consumes: `deliver`, `mergeHits`, `HIT_ORDERS`, `HitOrder`,
  `PASSAGE_SEEDS`, `PassageSeeds`, `DeliveredItem`, `EvidenceSource`,
  `clip` from `@dorothy/memory/evaluation`; `Archive.block`'s `full`.
- Produces:

  ```ts
  // system.ts
  export type Asked = {
      text: string;
      asOf: string;
      project: string | null;
      exclude: string | null;
      // The question's evidence ids, for the cited ceiling alone.
      evidence: readonly string[];
  };
  export type Retrieved = {
      ranked: string[];
      context: string;
      // The engine's hits before packing, best first; systems with an
      // engine only.
      found?: string[];
      // What went into the context, as delivered; dorothy adds the
      // knowledge her block gave in full, marked block.
      items?: (DeliveredItem & { block?: true })[];
  };
  export const DEFAULT_SYSTEMS: readonly string[];
  export const baseOf: (name: string) => string;
  export function parseSystemName(name: string): {
      base: SystemName;
      options: Map<string, string>;
  };
  export function checkSystem(name: string): void;
  export function makeSystem(name: string, corpus: Corpus): System;

  // dorothy.ts
  export type DorothyOptions = {
      block: number;
      order: HitOrder;
      cap: number;
      seeds: PassageSeeds;
      dedupe: boolean;
      wholeKnowledge: boolean;
  };
  export const DOROTHY_DEFAULTS: DorothyOptions;
  export function dorothyOptions(
      raw: ReadonlyMap<string, string>,
      name?: string,
  ): DorothyOptions;
  export function dorothySystem(
      corpus: Corpus,
      options?: DorothyOptions,
  ): System;

  // corpus.ts
  export const corpusEvidence: (corpus: Corpus) => EvidenceSource;
  ```

- [ ] **Step 1: Write the failing tests**

In `systems.test.ts`: `asked` adds `evidence: []`. The
characterization test now asks for today's options by name:

```ts
const TODAY_SYSTEM =
    "dorothy:order=knowledge-first:dedupe=off:seeds=overlap:knowledge=whole";
// in the characterization test:
const found = await makeSystem(TODAY_SYSTEM, corpus).retrieve(
    asked(question),
    8000,
);
```

`ranks the hits as her search gave them, then the block's` computes
the hits as the system now does:

```ts
const search = (kind: "knowledge" | "episodes") =>
    corpus.archive.engine.search({
        query: question,
        within: "all",
        kind,
        limit: 10,
        project: null,
    });
const hits = mergeHits(
    await search("knowledge"),
    await search("episodes"),
    "alternate",
    10,
);
```

and the block as the system fetches it, then expects:

```ts
const block = await corpus.archive.block({
    project: null,
    budget: Math.floor(8000 * 0.4),
    exclude: null,
});
const delivered = hits
    .filter(
        (hit) => !(hit.kind === "knowledge" && block.full.includes(hit.id)),
    )
    .map((hit) => hit.id);
expect(found.ranked).toEqual([
    ...delivered,
    ...block.ids.filter((id) => !delivered.includes(id)),
]);
```

New tests:

```ts
describe("system names", () => {
    it("names a variant by its options, and keeps the name", () => {
        expect(makeSystem("dorothy:block=0.2", corpus).name).toBe(
            "dorothy:block=0.2",
        );
        expect(dorothyOptions(new Map([["dedupe", "off"]]))).toEqual({
            ...DOROTHY_DEFAULTS,
            dedupe: false,
        });
    });

    for (const [name, says] of [
        ["dorothy:size=3", "dorothy takes block, order, cap, seeds, dedupe, knowledge, not size"],
        ["dorothy:seeds=random", "seeds takes search or overlap, not random"],
        ["dorothy:dedupe=yes", "dedupe takes on or off, not yes"],
        ["dorothy:knowledge=all", "knowledge takes capped or whole, not all"],
        ["dorothy:cap=x", "cap takes a share above 0, up to 1, not x"],
        ["dorothy:block=1", "block takes a share from 0 to under 1, not 1"],
        ["dorothy:cap=0", "cap takes a share above 0, up to 1, not 0"],
        ["dorothy:order=random", "order takes alternate or knowledge-first"],
        ["dorothy:block=0.2:block=0.3", "block is given twice"],
        ["dorothy:", 'each option is key=value, not ""'],
        ["dorothy:block= 0.2", "each option is key=value"],
        ["lexical:block=0.2", "lexical takes no options"],
        ["nobody", "no system nobody; the systems are"],
    ] as const) {
        it(`refuses ${name}`, () => {
            expect(() => checkSystem(name)).toThrow(says);
        });
    }

    it("takes each key's values", () => {
        const of = (key: string, value: string) =>
            dorothyOptions(new Map([[key, value]]));
        expect(of("block", "0").block).toBe(0);
        expect(of("block", "0.6").block).toBe(0.6);
        expect(of("cap", "1").cap).toBe(1);
        expect(of("order", "knowledge-first").order).toBe("knowledge-first");
        expect(of("seeds", "overlap").seeds).toBe("overlap");
        expect(of("dedupe", "on").dedupe).toBe(true);
        expect(of("knowledge", "whole").wholeKnowledge).toBe(true);
        expect(of("knowledge", "capped").wholeKnowledge).toBe(false);
        expect(dorothyOptions(new Map())).toEqual(DOROTHY_DEFAULTS);
    });
});

describe("the dorothy system's delivery", () => {
    it("opens her search's conversation as a passage", async () => {
        const found = await makeSystem("dorothy", corpus).retrieve(
            asked("Where is my allotment plot?"),
            8000,
        );
        expect(found.found).toContain(`c:${GARDEN}`);
        const item = found.items?.find((each) => each.id === `c:${GARDEN}`);
        expect(item?.kind).toBe("episode");
        expect(item?.turns).not.toBeNull();
    });

    it("leaves out knowledge the block gave in full, unless told", async () => {
        // A question whose search finds k:personal/uses-helix; check
        // with corpus.archive.engine.search first, and pick another if
        // this one does not.
        const question = "Do I use Helix?";
        const deduped = await makeSystem("dorothy", corpus).retrieve(
            asked(question),
            8000,
        );
        const kept = await makeSystem("dorothy:dedupe=off", corpus).retrieve(
            asked(question),
            8000,
        );
        // The hits delivered, not the block's knowledge reported beside.
        const ids = (found: Retrieved) =>
            (found.items ?? [])
                .filter((each) => each.block !== true)
                .map((each) => each.id);
        expect(ids(deduped)).not.toContain("k:personal/uses-helix");
        expect(ids(kept)).toContain("k:personal/uses-helix");
    });

    it("gives no block at a share of nothing", async () => {
        const found = await makeSystem("dorothy:block=0", corpus).retrieve(
            asked("Where is my allotment plot?"),
            8000,
        );
        expect(found.context).not.toContain("<memory>");
        expect(found.context.length).toBeLessThanOrEqual(8000);
    });
});
```

`makeSystem`'s existing error test keeps its text.

Run: `bun test packages/eval/src/systems/systems.test.ts`
Expected: FAIL (`checkSystem`, `dorothyOptions` missing; variant names
refused).

- [ ] **Step 2: Variant names in `system.ts`**

```ts
// A system by name, with any options: <system>[:<key>=<value>]...,
// as dorothy:block=0.2:order=knowledge-first.

export const DEFAULT_SYSTEMS = ["dorothy", "lexical", "full"] as const;

// What a system takes for options, checked before anything opens.
const OPTIONS = {
    dorothy: dorothyOptions,
    lexical: noOptions,
    full: noOptions,
};
const MAKERS: {
    [K in keyof typeof OPTIONS]: (
        corpus: Corpus,
        options: ReturnType<(typeof OPTIONS)[K]>,
    ) => System;
} = {
    dorothy: dorothySystem,
    lexical: (corpus) => lexicalSystem(corpus),
    full: (corpus) => fullSystem(corpus),
};
type SystemName = keyof typeof MAKERS;
export const SYSTEM_NAMES = Object.keys(MAKERS) as SystemName[];

export const baseOf = (name: string) => name.split(":")[0] as string;

function noOptions(raw: ReadonlyMap<string, string>, name: string): null {
    if (raw.size > 0) {
        throw new UsageError(`${name}: ${baseOf(name)} takes no options`);
    }
    return null;
}

export function parseSystemName(name: string): {
    base: SystemName;
    options: Map<string, string>;
} {
    const [base = "", ...pairs] = name.split(":");
    if (!(SYSTEM_NAMES as readonly string[]).includes(base)) {
        throw new UsageError(
            `no system ${base}; the systems are ${SYSTEM_NAMES.join(", ")}`,
        );
    }
    const options = new Map<string, string>();
    for (const pair of pairs) {
        const match = /^([a-z]+)=([^\s:=]+)$/.exec(pair);
        if (match === null) {
            throw new UsageError(
                `${name}: each option is key=value, not "${pair}"`,
            );
        }
        const [, key, value] = match as unknown as [string, string, string];
        if (options.has(key)) {
            throw new UsageError(`${name}: ${key} is given twice`);
        }
        options.set(key, value);
    }
    return { base: base as SystemName, options };
}

export function checkSystem(name: string): void {
    const { base, options } = parseSystemName(name);
    OPTIONS[base](options, name);
}

export function makeSystem(name: string, corpus: Corpus): System {
    const { base, options } = parseSystemName(name);
    const make = MAKERS[base] as (corpus: Corpus, options: unknown) => System;
    return { ...make(corpus, OPTIONS[base](options, name)), name };
}
```

`Asked` and `Retrieved` change as the Interfaces say; `packed` is gone
(Task 1), and `lexical.ts` and `full.ts` use memory's `pack`.

- [ ] **Step 3: `dorothy.ts` through delivery**

```ts
// Dorothy's memory as a host receives it: her opening block with its
// share of the budget, then her search's hits, knowledge and episodes
// merged, delivered as passages and knowledge within the rest.

export type DorothyOptions = {
    // The block's share of the budget.
    block: number;
    order: HitOrder;
    // One item's share of the budget at most.
    cap: number;
    seeds: PassageSeeds;
    // Whether knowledge the block gave in full is left out of the hits.
    dedupe: boolean;
    // Whether knowledge goes in whole, past the cap, as it did before.
    wholeKnowledge: boolean;
};
export const DOROTHY_DEFAULTS: DorothyOptions = {
    block: 0.4,
    order: "alternate",
    cap: ITEM_SHARE,
    seeds: "search",
    dedupe: true,
    wholeKnowledge: false,
};
const KEYS = ["block", "order", "cap", "seeds", "dedupe", "knowledge"] as const;

export function dorothyOptions(
    raw: ReadonlyMap<string, string>,
    name = "dorothy",
): DorothyOptions {
    const options = { ...DOROTHY_DEFAULTS };
    for (const [key, value] of raw) {
        const wrong = (allowed: string) =>
            new UsageError(`${name}: ${key} takes ${allowed}, not ${value}`);
        const among = <T extends string>(allowed: readonly T[]): T => {
            if (!(allowed as readonly string[]).includes(value)) {
                throw wrong(allowed.join(" or "));
            }
            return value as T;
        };
        switch (key) {
            case "block": {
                const share = Number(value);
                if (!(share >= 0 && share < 1)) {
                    throw wrong("a share from 0 to under 1");
                }
                options.block = share;
                break;
            }
            case "cap": {
                const share = Number(value);
                if (!(share > 0 && share <= 1)) {
                    throw wrong("a share above 0, up to 1");
                }
                options.cap = share;
                break;
            }
            case "order":
                options.order = among(HIT_ORDERS);
                break;
            case "seeds":
                options.seeds = among(PASSAGE_SEEDS);
                break;
            case "dedupe":
                options.dedupe = among(["on", "off"] as const) === "on";
                break;
            case "knowledge":
                options.wholeKnowledge =
                    among(["capped", "whole"] as const) === "whole";
                break;
            default:
                throw new UsageError(
                    `${name}: dorothy takes ${KEYS.join(", ")}, not ${key}`,
                );
        }
    }
    return options;
}

export function dorothySystem(
    corpus: Corpus,
    options: DorothyOptions = DOROTHY_DEFAULTS,
): System {
    return {
        name: "dorothy",
        async retrieve(asked, budget) {
            const block = await corpus.archive.block({
                project: asked.project,
                budget: Math.floor(budget * options.block),
                exclude: asked.exclude,
            });
            const search = (kind: "knowledge" | "episodes") =>
                corpus.archive.engine.search({
                    query: asked.text,
                    within: "all",
                    kind,
                    limit: 10,
                    project: asked.project,
                    exclude: asked.exclude,
                });
            const hits = mergeHits(
                await search("knowledge"),
                await search("episodes"),
                options.order,
                10,
            );
            const delivery = await deliver(
                {
                    query: asked.text,
                    hits,
                    budget: Math.max(0, budget - block.text.length - 1),
                    policy: {
                        cap: Math.floor(budget * options.cap),
                        seeds: options.seeds,
                        shown: options.dedupe ? block.full : [],
                        wholeKnowledge: options.wholeKnowledge,
                    },
                },
                corpusEvidence(corpus),
            );
            const delivered = delivery.items.map((item) => item.id);
            const given = new Set(delivered);
            return {
                // Her hits that went in, then what the block gave
                // besides.
                ranked: [
                    ...delivered,
                    ...block.ids.filter((id) => !given.has(id)),
                ],
                context: clip(`${block.text}\n${delivery.text}`, budget),
                found: hits.map((hit) => hit.id),
                // The block's knowledge given in full is delivered too,
                // for the stages; ranked keeps to what the hits gave.
                items: [
                    ...delivery.items,
                    ...block.full.flatMap((id) => {
                        const knowledge = corpus.knowledge.get(id);
                        return knowledge === undefined
                            ? []
                            : [
                                  {
                                      id,
                                      kind: "knowledge" as const,
                                      turns: null,
                                      text: knowledgeText(knowledge),
                                      cut: false,
                                      opened: true,
                                      block: true as const,
                                  },
                              ];
                    }),
                ],
            };
        },
    };
}
```

`dorothy.ts` imports `clip`, `deliver`, `HIT_ORDERS`, `ITEM_SHARE`,
`knowledgeText`, `mergeHits`, `PASSAGE_SEEDS` and the types it names
from `@dorothy/memory/evaluation`, and `UsageError` from
`../errors.js`.

`corpus.ts` adds:

```ts
// What delivery reads of the corpus: its own records, by contract id.
export const corpusEvidence = (corpus: Corpus): EvidenceSource => ({
    conversation: async (id) => corpus.conversations.get(id),
    knowledge: async (id) => corpus.knowledge.get(id),
});
```

Under today's options this reproduces the old context exactly, but for
the warning on unconfirmed knowledge, which the fixture lacks: two
searches merged knowledge first equal the baseline's own merge, the
passage cap is a quarter of the whole budget as the old `budget / 4`,
knowledge goes in whole as before, and overlap seeds are the old
passage order. If the characterization test fails, find which of these
differs before changing anything else.

- [ ] **Step 4: The run and the command**

- `run.ts`'s `ask` passes `evidence: question.evidence` in `Asked`, and
  chooses the full budget by `baseOf(system.name) === "full"`.
- `command.ts`'s `systemsOf`:

  ```ts
  function systemsOf(text: string): string[] {
      const names = [
          ...new Set(
              text
                  .split(",")
                  .map((name) => name.trim())
                  .filter((name) => name !== ""),
          ),
      ];
      if (names.length === 0) {
          throw new UsageError(
              `--systems takes some of ${SYSTEM_NAMES.join(", ")}, comma-separated, each with any options, as dorothy:block=0.2`,
          );
      }
      for (const name of names) {
          checkSystem(name);
      }
      return names;
  }
  ```

  and the default is `DEFAULT_SYSTEMS.join(",")`. Update any test
  matching the old message.

Run: `bun test packages/eval`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add packages/eval
git commit -m "feat(eval): System variants through delivery"
```

---

### Task 4: Hits carry their turns; the kinds alternate

**Files:**

- Modify: `packages/core/src/contracts/memory.ts`,
  `packages/memory/src/engine/baseline.ts`, `baseline.test.ts`,
  `packages/memory/src/contract/tools.test.ts`,
  `packages/memory/src/contract/AGENTS.md`

**Interfaces:**

- Consumes: `mergeHits` (Task 2).
- Produces: `MemoryHit.turns?: number[] | undefined`; the baseline's
  `search` returns episode hits with up to three matched turn numbers,
  best first, and merges the kinds with
  `mergeHits(knowledge, episodes, "alternate", request.limit)`.

- [ ] **Step 1: Write the failing tests**

Add to `baseline.test.ts`, using its `converse` and `fact` helpers:

```ts
describe("search's turns and order", () => {
    it("gives up to three matched turns, best first", async () => {
        const phrase = newPhrase(() =>
            Uint8Array.from([90, 1, 2, 3, 4, 5, 6, 7]),
        );
        mkdirSync(transcriptDir(env), { recursive: true });
        writeFileSync(
            transcriptPath(phrase, env),
            line("session", 0, {
                phrase: "p",
                sdkSessionId: "",
                model: "m",
                promptHash: "",
                resumed: false,
            }) +
                line("user", 1, { text: "a kumquat" }) +
                line("assistant", 2, {
                    text: "kumquat kumquat, a fine kumquat",
                }) +
                line("user", 3, { text: "nothing here" }) +
                line("assistant", 4, {
                    text: "kumquat once, among a good many other words here",
                }) +
                line("user", 5, { text: "kumquat kumquat" }),
        );
        const hits = await engine().search({
            query: "kumquat",
            within: "all",
            kind: "episodes",
            limit: 10,
            project: null,
        });
        // The index's own order of this conversation's matching turns.
        const best = (
            index.db
                .query(
                    `SELECT t.n AS n FROM turns_fts
                     JOIN turns t ON t.rowid = turns_fts.rowid
                     WHERE turns_fts MATCH '"kumquat"' AND t.phrase = ?
                     ORDER BY bm25(turns_fts) LIMIT 3`,
                )
                .all(phrase) as { n: number }[]
        ).map((row) => row.n);
        expect(best).toHaveLength(3);
        expect(hits.find((each) => each.id === `c:${phrase}`)?.turns).toEqual(
            best,
        );
    });

    it("keeps an episode among ten knowledge hits", async () => {
        const root = dataRoot(env);
        for (let at = 0; at < 12; at++) {
            await putFact(root, PERSONAL, fact(`kumquat-${at}`));
        }
        const phrase = converse(2, null, "kumquat");
        const hits = await engine().search({
            query: "kumquat",
            within: "all",
            kind: "all",
            limit: 10,
            project: null,
        });
        expect(hits).toHaveLength(10);
        expect(hits[0]?.id).toBe(`c:${phrase}`);
        expect(hits[1]?.kind).toBe("knowledge");
    });
});
```

The first test reads the index after `engine().search` has synced it
(`index` is the file's own). Four turns match, so three come back.

In `tools.test.ts`, a `search` through the fake engine whose hit
carries `turns: [3, 1]` returns them in its JSON. This pins that the
tool passes the field through; it passes before the change, as the
tool returns the engine's hits as they are:

```ts
it("returns an episode's matched turns", async () => {
    // Build the server as the file's other search tests do, its fake
    // engine giving one episode hit with turns: [3, 1].
    const { text } = await call("search", { query: "tea" });
    expect(JSON.parse(text)[0].turns).toEqual([3, 1]);
});
```

Run: `bun test packages/memory/src/engine/baseline.test.ts`
Expected: FAIL (no `turns`; knowledge fills all ten). The `tools.test.ts`
case passes already.

- [ ] **Step 2: The contract field**

In `packages/core/src/contracts/memory.ts`'s `MemoryHit`, after
`date`:

```ts
    // An episode's matched turns, best first, at most three: where a
    // passage or an open starts.
    turns?: number[] | undefined;
```

- [ ] **Step 3: The baseline**

In `baseline.ts`'s `search`, collect knowledge hits and episode hits in
two arrays, as now, and return
`mergeHits(knowledge, episodes, "alternate", request.limit)`. Each
episode hit gains its turns:

```ts
episodes.push({
    id: conversationId(hit.identifier),
    kind: "episode",
    scope,
    title: hit.name ?? hit.identifier,
    snippet: hit.matches[0]?.text ?? hit.description ?? "",
    date: hit.dateModified,
    ...(hit.matches.length === 0
        ? {}
        : { turns: hit.matches.map((match) => match.turn) }),
});
```

Update the header comment to say hits carry their turns and the kinds
alternate. Fix any test that expected knowledge first from a `kind:
"all"` search (`grep -rn 'kind: "all"' packages/memory/src`).

- [ ] **Step 4: Guide**

`packages/memory/src/contract/AGENTS.md`, the `../engine/` line: the
baseline's hits carry matched turns and alternate knowledge with
episodes through `mergeHits`.

- [ ] **Step 5: Verify and commit**

Run: `bun run check`
Expected: PASS, eval's characterization test among them (eval asks
for each kind apart, so the baseline's order does not reach it).

```bash
git add packages/core packages/memory
git commit -m "feat(memory): Hits carry turns; kinds alternate"
```

---

### Task 5: Recall delivers passages

**Files:**

- Modify: `packages/memory/src/contract/recall.ts`, `recall.test.ts`,
  `packages/memory/src/contract/testing.ts`,
  `packages/memory/src/service/service.ts`, and any other caller of
  `recallFor` (`grep -rn recallFor packages`),
  `packages/memory/src/contract/AGENTS.md`

**Interfaces:**

- Consumes: `deliver`, `indexEvidence`, `EvidenceSource`.
- Produces: `recallFor(request, deps: { engine: MemoryEngine; profiles:
  Profiles; evidence: () => EvidenceSource })`, its response's shape
  unchanged; `testing.ts` gains `fakeEvidence`.

- [ ] **Step 1: Write the failing tests**

`testing.ts` adds:

```ts
// An evidence source over the records given, by id.
export function fakeEvidence(
    parts: {
        conversations?: EvidenceConversation[];
        knowledge?: EvidenceKnowledge[];
    } = {},
): EvidenceSource {
    return {
        conversation: async (id) =>
            parts.conversations?.find((each) => each.id === id),
        knowledge: async (id) =>
            parts.knowledge?.find((each) => each.id === id),
    };
}
```

Every `recallFor` call in `recall.test.ts` passes
`evidence: () => fakeEvidence()` beside `engine` and `profiles`, so
hits stand in as their title and snippet. Rewrite the tests whose lines
changed form:

```ts
it("marks a passage of unconfirmed knowledge, as search does", async () => {
    // engine as before
    expect(recalled.text).toContain(
        `<item id="k:personal/a">\n[${UNCONFIRMED}]\nk:personal/a: Tea.\n</item>`,
    );
    expect(recalled.text).toContain(
        '<item id="k:personal/b">\nk:personal/b: Coffee.\n</item>',
    );
});

it("cuts a long passage to its share, and keeps the next", async () => {
    const engine = fakeEngine({
        hits: [
            hit("k:personal/a", "x".repeat(500)),
            hit("k:personal/b", "y"),
        ],
    });
    const recalled = await recallFor(
        { host: "codex", session: "s", prompt: "x", budget: 300 },
        { engine, profiles, evidence: () => fakeEvidence() },
    );
    expect(recalled.ids).toEqual(["k:personal/a", "k:personal/b"]);
    expect(recalled.used).toBeLessThanOrEqual(300);
});

it("gives a conversation's passage, not its snippet", async () => {
    const talk: EvidenceConversation = {
        id: "c:talk",
        phrase: "talk",
        project: null,
        title: "Talk",
        firstAt: "2026-10-01T09:00:00.000Z",
        lastAt: "2026-10-01T09:00:00.000Z",
        turns: [
            {
                n: 1,
                role: "user",
                at: "2026-10-01T09:00:00.000Z",
                text: "My bicycle is crimson.",
            },
        ],
    };
    const engine = fakeEngine({
        hits: [
            {
                id: "c:talk",
                kind: "episode",
                scope: "personal",
                title: "Talk",
                snippet: "«bicycle»",
                turns: [1],
            },
        ],
    });
    const recalled = await recallFor(
        { host: "codex", session: "s", prompt: "my bicycle" },
        {
            engine,
            profiles,
            evidence: () => fakeEvidence({ conversations: [talk] }),
        },
    );
    expect(recalled.text).toContain("[1] user, 2026-10-01 09:00: My bicycle is crimson.");
});
```

`fills the budget to its last character, and no further` measures the
item's frame instead of the line:

```ts
const frame = size(["<recalled>", RECALL_INTRO, "</recalled>"].join("\n"));
const item = size('<item id="a">\na: Tea.\n</item>\n');
const fits = await ask(frame + item);
expect(fits.ids).toEqual(["a"]);
expect(fits.used).toBe(frame + item);
// One character less cuts the item by one; packing cuts, never skips.
const short = await ask(frame + item - 1);
expect(short.ids).toEqual(["a"]);
expect(short.text).toContain("a: Tea\n</item>");
expect(await ask(10)).toEqual({ text: "", ids: [], used: 0 });
```

At `frame + item` the room is the item's 30 characters (14, 7 and 9),
whose quarter, 7, is exactly `a: Tea.`'s length.

`escapes what a passage holds` keeps its assertions.

Run: `bun test packages/memory/src/contract/recall.test.ts`
Expected: FAIL.

- [ ] **Step 2: `recall.ts`**

```ts
// Recall for a prompt: the passages that may bear on the user's
// message, delivered within the host's budget, for a host to put in the
// user's turn, never in a system prompt, so the cache holds.

export async function recallFor(
    request: RecallRequest,
    deps: {
        engine: MemoryEngine;
        profiles: Profiles;
        // A fresh source for each request, as knowledge is read once.
        evidence: () => EvidenceSource;
    },
): Promise<RecallResponse> {
    // profile, budget and the empty cases as now
    const hits = await deps.engine.search({ /* as now */ });
    const head = `<recalled>\n${RECALL_INTRO}\n`;
    const tail = "</recalled>";
    const delivery = await deliver(
        {
            query: request.prompt,
            hits,
            budget: budget - size(head) - size(tail),
            escape: true,
        },
        deps.evidence(),
    );
    if (delivery.items.length === 0) {
        return EMPTY;
    }
    const text = `${head}${delivery.text}${tail}`;
    return {
        text,
        ids: delivery.items.map((item) => item.id),
        used: size(text),
    };
}
```

`size` counts code points and `pack` counts UTF-16 units, so the text
never passes the budget. Item ids are contract ids, safe in an
attribute; item text is escaped.

- [ ] **Step 3: The service**

In `service.ts`'s recall route pass
`evidence: () => indexEvidence(index, root)`, `root` being the data
root its `FactStore` already holds. Any other caller of `recallFor`
does the same with its own index and root.

In `service.test.ts`, beside `recalls for a prompt`, a test that writes
a conversation into the service's temporary data root (as the file's
other tests that record or index one do), recalls with a prompt
matching one of its turns, and expects that turn's text in the
response's `text` and the conversation's `c:` id in `ids`.

- [ ] **Step 4: Guide**

`packages/memory/src/contract/AGENTS.md`, `recall.ts`'s line: passages
for a prompt, delivered through `deliver` from a fresh
`indexEvidence`, escaped, within the host's recall budget.

- [ ] **Step 5: Verify and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add packages/memory
git commit -m "feat(memory): Recall delivers passages"
```

---

### Task 6: Retrieval by stage, and the cited ceiling

**Files:**

- Create: `packages/eval/src/systems/cited.ts`,
  `packages/eval/src/systems/AGENTS.md`
- Modify: `packages/eval/src/systems/system.ts`, `lexical.ts`,
  `full.ts`, `systems.test.ts`, `packages/eval/src/run/record.ts`,
  `run.ts`, `run.test.ts`, `packages/eval/src/report/summary.ts`,
  `markdown.ts`, `report.test.ts`, `packages/eval/AGENTS.md`

**Interfaces:**

- Consumes: `Retrieved.found` and `.items`, `Asked.evidence`,
  `deliver`, `corpusEvidence`, `termsOf`, `scoreOf`.
- Produces:

  ```ts
  // record.ts
  export type RecordedItem = {
      id: string;
      kind: "knowledge" | "episode";
      turns: { from: number; through: number } | null;
      chars: number;
      cut: boolean;
      opened: boolean;
      // Knowledge the opening block gave in full, not a hit.
      block?: true;
  };
  // RunRecord.retrieval gains: items?: RecordedItem[]
  // RunRecord.recall gains, each absent where the system gave no
  // found or items: found?: boolean; delivered?: boolean;
  // covered?: number | null

  // run.ts
  export function coverageOf(
      answer: string | null,
      texts: readonly string[],
  ): number | null;

  // summary.ts: Cell gains
  //   found: Rate | null;
  //   delivered: Rate | null;
  //   covered: { total: number; full: Rate } | null;
  ```

- [ ] **Step 1: Write the failing tests**

`run.test.ts`:

```ts
describe("coverageOf", () => {
    it("is the share of the answer's terms the texts hold", () => {
        expect(
            coverageOf("Green tea at four", ["I drink green tea daily."]),
        ).toBeCloseTo(2 / 3);
        expect(coverageOf("Green tea at four", [])).toBe(0);
    });

    it("is null for no answer, or one with no terms", () => {
        expect(coverageOf(null, ["text"])).toBeNull();
        expect(coverageOf("It is so.", ["text"])).toBeNull();
    });
});
```

(`termsOf("Green tea at four")` is `["green", "tea", "four"]`: "at" is
short; check `termsOf("It is so.")` is empty, or pick a phrase that
is.)

A run test, on the fixture with retrieval only and the systems
`dorothy,lexical,cited`, reads its records and expects: `dorothy`'s to
have `recall.found` and `recall.delivered` booleans, `covered` a
number or null, and `retrieval.items` with `chars` and no `text`;
`lexical`'s to have `delivered` but no `found`; `cited`'s `delivered`
true for every question with evidence.

`report.test.ts`: a summary of hand-built records gives `found`,
`delivered` and `covered` as counted, `null` for a system whose records
lack them, and the Markdown table's header reads:

```text
| System | Strict | Lenient | Found | Recall@5 | Recall@10 | Delivered | Delivered or noted | Covered | Abstained | Declined wrongly | Older answer |
```

with `covered` shown as `62.5% (3/8 whole)` (mean, then how many had
every term). A run with a `cited` system says, under the overall table:
`cited is given each question's evidence: a ceiling, not a contender.`
and `cited` is never "alone right" or "alone wrong".

`systems.test.ts`:

```ts
describe("the cited system", () => {
    it("delivers exactly the question's evidence", async () => {
        const found = await makeSystem("cited", corpus).retrieve(
            { ...asked("Where is my allotment plot?"), evidence: [`c:${GARDEN}`] },
            8000,
        );
        expect(found.ranked).toEqual([`c:${GARDEN}`]);
        expect(found.context).toContain(`<item id="c:${GARDEN}">`);
    });

    it("gives nothing for a question with none", async () => {
        const found = await makeSystem("cited", corpus).retrieve(
            asked("Anything?"),
            8000,
        );
        expect(found).toMatchObject({ ranked: [], context: "" });
    });
});
```

and `makeSystem`'s error test now lists `dorothy, lexical, full, cited`.

Run: `bun test packages/eval`
Expected: FAIL.

- [ ] **Step 2: `cited.ts` and the systems' items**

```ts
// A ceiling, never a contender: each question's own evidence, delivered
// as Dorothy delivers, to show how far passage selection alone can go.

import type { MemoryHit } from "@dorothy/core";
import { deliver } from "@dorothy/memory/evaluation";
import { type Corpus, corpusEvidence } from "./corpus.js";
import type { System } from "./system.js";

export function citedSystem(corpus: Corpus): System {
    return {
        name: "cited",
        async retrieve(asked, budget) {
            const hits: MemoryHit[] = asked.evidence.flatMap(
                (id): MemoryHit[] => {
                    const conversation = corpus.conversations.get(id);
                    if (conversation !== undefined) {
                        return [
                            {
                                id,
                                kind: "episode",
                                scope: conversation.project ?? "personal",
                                title: conversation.title ?? "Untitled",
                                snippet: "",
                            },
                        ];
                    }
                    const knowledge = corpus.knowledge.get(id);
                    return knowledge === undefined
                        ? []
                        : [
                              {
                                  id,
                                  kind: "knowledge",
                                  scope: knowledge.scope,
                                  title: knowledge.title,
                                  snippet: knowledge.description,
                              },
                          ];
                },
            );
            const delivery = await deliver(
                {
                    query: asked.text,
                    hits,
                    budget,
                    policy: {
                        cap: Math.floor(budget / Math.max(1, hits.length)),
                        seeds: "overlap",
                        wholeKnowledge: true,
                    },
                },
                corpusEvidence(corpus),
            );
            return {
                ranked: delivery.items.map((item) => item.id),
                context: delivery.text,
                items: delivery.items,
            };
        },
    };
}
```

`@dorothy/core` must be in eval's `package.json` dependencies (it is;
check). In `system.ts`: `OPTIONS` gains `cited: noOptions`, `MAKERS`
gains `cited: (corpus) => citedSystem(corpus)`, and
`DEFAULT_SYSTEMS` stays `dorothy, lexical, full`.

`lexical.ts` and `full.ts` return `items` from their `pack`:

```ts
const fitted = pack(/* as now */);
return {
    ranked: fitted.ids,
    context: fitted.text,
    items: fitted.ids.map((id, at) => ({
        id,
        kind: id.startsWith("k:") ? "knowledge" : "episode",
        turns: null,
        text: fitted.texts[at] as string,
        cut: fitted.cut && at === fitted.ids.length - 1,
        opened: true,
    })),
};
```

- [ ] **Step 3: Records**

`record.ts`: `RecordedItem` as above; `retrieval.items?:
RecordedItem[]`; `recall` gains `found?`, `delivered?` and `covered?`,
each commented as the Interfaces say.

`run.ts`:

```ts
// The share of the gold answer's terms that the texts hold; null where
// there is no answer, or it has no terms.
export function coverageOf(
    answer: string | null,
    texts: readonly string[],
): number | null {
    if (answer === null) {
        return null;
    }
    const terms = termsOf(answer);
    return terms.length === 0
        ? null
        : scoreOf(texts.join("\n"), terms) / terms.length;
}
```

In `ask`, when `retrieved.items` is defined, `retrieval` gains
`items: retrieved.items.map(({ text, ...item }) => ({ ...item, chars:
text.length }))`, and `recall`, for a question with evidence, gains:

```ts
...(retrieved.found === undefined
    ? {}
    : { found: hasEvidence(retrieved.found, question.evidence) }),
...(retrieved.items === undefined
    ? {}
    : (() => {
          // Opened evidence only: a stand-in title and snippet is not
          // the evidence delivered.
          const cited = retrieved.items.filter(
              (item) => item.opened && question.evidence.includes(item.id),
          );
          return {
              delivered: cited.length > 0,
              covered: coverageOf(
                  question.answer,
                  cited.map((item) => item.text),
              ),
          };
      })()),
```

A failed retrieval leaves the record without these fields, as it has
no `found` or `items`; the summary counts it as a miss (Step 4).

- [ ] **Step 4: Summary and report**

`summary.ts`'s `Cell` gains the three fields, `emptyCell` starting
`found: rate()`, `delivered: rate()`, `covered: { total: 0, full:
rate() }`. In `add`, for a record with `recall`:

- one whose `retrieval.error` is set counts as a miss in each of the
  three that the cell still keeps (`of` up by one; for `covered`,
  `full.of` up by one and nothing added to `total`), as `tally`'s
  `owed` does for verdicts;
- otherwise each follows `inContext`'s rule: lacking the field makes
  the cell's value `null` for good; having it tallies it (`covered`: a
  `null` value is skipped; a number adds to `total`, counts in
  `full.of`, and in `full.hits` when it is 1).

Add a test: a system's records, one with a retrieval error among them,
keep their stage counts, the errored one counted a miss.
In `summarise`, the verdicts for "alone" skip any system whose
`baseOf(name)` is `cited`.

`markdown.ts`: the header above; each row's cells in that order, `-`
for a null rate; `covered` by:

```ts
const coverage = (covered: Cell["covered"]) =>
    covered === null
        ? "-"
        : covered.full.of === 0
          ? "n/a"
          : `${((100 * covered.total) / covered.full.of).toFixed(1)}% (${covered.full.hits}/${covered.full.of} whole)`;
```

and, under the overall table when any system's base is `cited`, the
ceiling line above.

- [ ] **Step 5: Guides**

Create `packages/eval/src/systems/AGENTS.md` (header from
`packages/memory/src/contract/AGENTS.md`), holding:

- what a system meets (`Asked`, `Retrieved` and its `found` and
  `items`), and that every ranked id is in the context;
- variant names, `<system>[:<key>=<value>]...`, `checkSystem` before
  anything opens, `dorothy`'s options and defaults;
- the four systems: `dorothy` through memory's `deliver` with its block
  and merged hits, `lexical`, `full`, and `cited`, the ceiling, never in
  the default systems or "alone";
- that the passage, term and packing code is memory's.

In `packages/eval/AGENTS.md`, replace the systems bullet with one line
linking [the systems' guide](./src/systems/AGENTS.md), and say in the
`run/` and `report/` bullets that records and summaries carry found,
delivered and covered, without passing 150 lines.

- [ ] **Step 6: Verify and commit**

Run: `bun run check`
Expected: PASS.

Commit in two: the `cited` system with its tests, then the stages.

```bash
git add packages/eval/src/systems
git commit -m "feat(eval): Add the cited ceiling system"
git add packages/eval
git commit -m "feat(eval): Report retrieval by stage"
```

---

### Task 7: The first evaluation's corrections, and the README

**Files:**

- Modify: `docs/reports/2026-10-31-first-evaluation.md`, `README.md`

- [ ] **Step 1: Correct the report**

In "What it shows", the bullet beginning "She does not answer from what
she finds" and the one beginning "The test leans towards lexical
search": keep their findings, and correct the two claims, with a
dated note:

- Her evaluated system does select passages, with the same function as
  lexical search's; they never fit beside the opening block and the
  knowledge ranked ahead of them. Of the 58 questions whose evidence
  reached the answering model, 49 reached it only as a note in the
  block.
- Lexical search reads knowledge too, scored with the conversations.

Add one line linking
[the engine's spec](../specs/2026-10-31-memory-engine-design.md), which
the correction came from. Bump `mtime`.

- [ ] **Step 2: The README**

In "Measuring her memory", after the paragraph on `--resume` and
`--models`, add:

```markdown
`--systems` takes `dorothy`, `lexical`, `full` and `cited`, the first
three by default, each with any options after colons:
`dorothy:block=0.2:order=knowledge-first` sets the opening block's
share and how knowledge and conversations interleave (`alternate`, the
default); `cap`, `seeds` (`search` or `overlap`) and `dedupe` (`on` or
`off`) the rest. `cited` is given each question's evidence, a ceiling
for passage selection. Each record and report counts four stages:
evidence found by search, delivered as a passage or knowledge,
delivered or only noted in the block, and covered: the share of the
gold answer's words in what was delivered of its evidence.
```

- [ ] **Step 3: Verify and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add docs/reports/2026-10-31-first-evaluation.md README.md
git commit -m "docs: Correct the first evaluation's report"
```

---

## Verification, after the tasks

The coordinating agent, not an implementer:

1. `bun run check` under temporary XDG roots.
2. A retrieval-only run on a copy of the owner's evaluation data, as
   the spec says: it calls no model, and the copy takes the run and
   the recall index the run syncs, leaving `~/eval` untouched:

   ```sh
   copy=$(mktemp -d)/eval && cp -a ~/eval "$copy"
   bun run eval -- run --work "$copy" --retrieval-only --systems \
   "dorothy:order=knowledge-first:dedupe=off:seeds=overlap:knowledge=whole,\
   dorothy:dedupe=off:seeds=overlap:knowledge=whole,\
   dorothy:seeds=overlap:knowledge=whole,dorothy:seeds=overlap,\
   dorothy:block=0.2,dorothy:block=0.6,dorothy,lexical,cited"
   ```

   Its first system must match the reviewed rerun's recall at 10 and
   delivered-or-noted counts, read from `~/eval/runs` without writing;
   the report records each system's found, delivered and covered
   counts, overall and by type, counts only. The copy is removed after.
3. The paid runs the spec lists, after the user approves the spend and
   the models' budgets allow; their results and the decision go in the
   phase's report.
