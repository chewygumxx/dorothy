// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/systems.test.ts
//
//

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
    conversationText,
    mergeHits,
    passage,
} from "@dorothy/memory/evaluation";
import { workEnv } from "../snapshot/snapshot.js";
import { GARDEN, READER, snapshotFixture, TEA, tempRoot } from "../testing.js";
import { type Corpus, openCorpus } from "./corpus.js";
import { DOROTHY_DEFAULTS, dorothyOptions } from "./dorothy.js";
import {
    type Asked,
    checkSystem,
    makeSystem,
    type Retrieved,
} from "./system.js";
import { TODAY, TODAY_QUESTIONS } from "./today.fixture.js";

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

const asked = (
    text: string,
    exclude: string | null = null,
    project: string | null = null,
): Asked => ({
    text,
    asOf: "2026-10-19",
    project,
    exclude,
    evidence: [],
});
// Whether the context holds an item, or the block's mention, of an id.
const mentions = (context: string, id: string) => context.includes(`"${id}"`);

describe("items", () => {
    it("pass the turns that match, with their neighbours", () => {
        const tea = corpus.conversations.get(`c:${TEA}`);
        if (tea === undefined) {
            throw new Error("the fixture lacks its tea");
        }
        const { text } = passage(tea, ["tea"], 1000);
        expect(text).toContain("green tea at four every afternoon");
        expect(text).toContain("Green tea at four, noted.");
        expect(passage(tea, ["tea"], 20).text.length).toBeLessThanOrEqual(20);
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
        const system = makeSystem("lexical", corpus);
        const question = "What do I drink in the afternoon?";
        expect((await system.retrieve(asked(question), 4000)).ranked).toContain(
            `c:${READER}`,
        );
        const found = await system.retrieve(asked(question, READER), 4000);
        expect(found.ranked).not.toContain(`c:${READER}`);
        expect(found.context).not.toContain(`c:${READER}`);
    });

    it("ranks only what its context holds", async () => {
        const system = makeSystem("lexical", corpus);
        const question = "What do I drink at four in the afternoon?";
        const roomy = await system.retrieve(asked(question), 4000);
        expect(roomy.ranked.length).toBeGreaterThan(1);
        for (const budget of [60, 100]) {
            const found = await system.retrieve(asked(question), budget);
            expect(found.context.length).toBeLessThanOrEqual(budget);
            expect(found.ranked.length).toBeLessThan(roomy.ranked.length);
            for (const id of found.ranked) {
                expect(found.context).toContain(`<item id="${id}">`);
            }
            // Best first, as when there is room.
            expect(found.ranked).toEqual(
                roomy.ranked.slice(0, found.ranked.length),
            );
        }
    });

    it("scores a conversation of any number of turns", async () => {
        const turns = Array.from({ length: 200_000 }, (_, n) => ({
            n,
            role: "user" as const,
            at: "2026-10-01T00:00:00.000Z",
            text: n === 199_999 ? "green tea" : "nothing",
        }));
        const long = {
            id: "c:long",
            phrase: "long",
            project: null,
            title: "Long",
            tags: [],
            firstAt: "2026-10-01T00:00:00.000Z",
            lastAt: "2026-10-01T00:00:00.000Z",
            turns,
        };
        const found = await makeSystem("lexical", {
            ...corpus,
            conversations: new Map([["c:long", long]]),
            knowledge: new Map(),
        }).retrieve(asked("green tea"), 1000);
        expect(found.ranked).toEqual(["c:long"]);
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
        for (const id of some.ranked) {
            expect(some.context).toContain(`<item id="${id}">`);
        }
        expect(some.ranked).toEqual(all.ranked.slice(0, some.ranked.length));
    });

    it("leaves out the conversation a question came from", async () => {
        const system = makeSystem("full", corpus);
        const found = await system.retrieve(asked("anything", READER), 400_000);
        expect(found.ranked).toHaveLength(6);
        expect(found.ranked).not.toContain(`c:${READER}`);
        expect(found.context).not.toContain(`c:${READER}`);
        expect(found.ranked[0]).toBe("k:personal/uses-helix");
        // And the next question has it again.
        const again = await system.retrieve(asked("anything"), 400_000);
        expect(again.ranked).toHaveLength(7);
    });

    it("builds the corpus's texts once, not for each question", async () => {
        let reads = 0;
        const counted = new Map(corpus.conversations);
        const values = counted.values.bind(counted);
        counted.values = () => {
            reads++;
            return values();
        };
        const system = makeSystem("full", {
            ...corpus,
            conversations: counted,
        });
        await system.retrieve(asked("one"), 1000);
        await system.retrieve(asked("two", READER), 1000);
        await system.retrieve(asked("three"), 1000);
        expect(reads).toBe(1);
    });

    it("holds the same text as the conversation's own", async () => {
        const found = await makeSystem("full", corpus).retrieve(
            asked("anything"),
            400_000,
        );
        const tea = corpus.conversations.get(`c:${TEA}`);
        expect(found.context).toContain(
            conversationText(tea as NonNullable<typeof tea>),
        );
    });
});

describe("the dorothy system", () => {
    it("gives her block and her search's hits", async () => {
        const found = await makeSystem("dorothy", corpus).retrieve(
            asked("Where is my allotment plot?"),
            8000,
        );
        expect(found.ranked).toContain(`c:${GARDEN}`);
        // The block's knowledge, after the hits.
        expect(found.ranked).toContain("k:personal/uses-helix");
        expect(found.context).toContain("<memory>");
        expect(found.context).toContain(`<item id="c:${GARDEN}">`);
        expect(found.context.length).toBeLessThanOrEqual(8000);
    });

    it("ranks the hits as her search gave them, then the block's", async () => {
        const question = "Where is my allotment plot?";
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
        const block = await corpus.archive.block({
            project: null,
            budget: Math.floor(8000 * 0.4),
            exclude: null,
        });
        const found = await makeSystem("dorothy", corpus).retrieve(
            asked(question),
            8000,
        );
        const delivered = hits
            .filter(
                (hit) =>
                    !(
                        hit.kind === "knowledge" &&
                        block.full.some((item) => item.id === hit.id)
                    ),
            )
            .map((hit) => hit.id);
        expect(found.ranked).toEqual([
            ...delivered,
            ...block.ids.filter((id) => !delivered.includes(id)),
        ]);
        // The hits lead, though the block holds the knowledge first.
        expect(found.ranked[0]).toBe(`c:${GARDEN}`);
        expect(delivered).not.toEqual(block.ids);
    });

    it("ranks only the hits that fitted, and what the block holds", async () => {
        const system = makeSystem("dorothy", corpus);
        const question = "What do I drink at four in the afternoon?";
        const roomy = await system.retrieve(asked(question), 8000);
        const tight = await system.retrieve(asked(question), 500);
        expect(tight.context.length).toBeLessThanOrEqual(500);
        expect(tight.ranked.length).toBeLessThan(roomy.ranked.length);
        for (const id of tight.ranked) {
            expect(
                tight.context.includes(`<item id="${id}">`) ||
                    mentions(tight.context, id) ||
                    tight.context.includes(`(${id})`),
            ).toBe(true);
        }
    });

    it("leaves out the conversation a question came from", async () => {
        const system = makeSystem("dorothy", corpus);
        const question = "What do I drink in the afternoon?";
        const held = await system.retrieve(asked(question), 8000);
        expect(held.ranked).toContain(`c:${READER}`);
        expect(held.context).toContain(`c:${READER}`);
        const found = await system.retrieve(asked(question, READER), 8000);
        expect(found.ranked).not.toContain(`c:${READER}`);
        // Neither its hit nor its line in the block.
        expect(found.context).not.toContain(`c:${READER}`);
    });

    it("scopes the block and the search to the question's project", async () => {
        const system = makeSystem("dorothy", corpus);
        const question = "Where is my allotment plot?";
        const tea = `c:${TEA}`;
        // The tea conversation belongs to github.com/me/app alone.
        const own = await system.retrieve(
            asked(question, null, "github.com/me/app"),
            8000,
        );
        const other = await system.retrieve(
            asked(question, null, "github.com/other/x"),
            8000,
        );
        expect(own.ranked).toContain(tea);
        expect(other.ranked).not.toContain(tea);
        expect(other.context).not.toContain(tea);
        expect(other.ranked).toContain(`c:${GARDEN}`);
    });

    it("falls back to the hit's title and snippet outside the corpus", async () => {
        const found = await makeSystem("dorothy", {
            ...corpus,
            conversations: new Map(),
            knowledge: new Map(),
        }).retrieve(asked("Where is my allotment plot?"), 8000);
        const item = found.context.match(
            new RegExp(`<item id="c:${GARDEN}">\\n([^\\n]*)`),
        );
        expect(item?.[1]).toStartWith("The allotment: ");
        expect(item?.[1]).toContain("plot");
    });
});

describe("makeSystem", () => {
    it("names the systems it has when asked for another", () => {
        expect(() => makeSystem("hindsight", corpus)).toThrow(
            "no system hindsight; the systems are dorothy, lexical, full",
        );
    });
});

const TODAY_SYSTEM =
    "dorothy:order=knowledge-first:dedupe=off:seeds=overlap:knowledge=whole";

describe("the dorothy system's context today", () => {
    for (const question of TODAY_QUESTIONS) {
        it(`holds for ${question}`, async () => {
            const found = await makeSystem(TODAY_SYSTEM, corpus).retrieve(
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
        [
            "dorothy:size=3",
            "dorothy takes block, order, cap, seeds, dedupe, knowledge, not size",
        ],
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
        // No block at all: not its frame, not its closing reminder,
        // and no separator charged.
        expect(found.context).toStartWith("<item id=");
        expect(found.context.length).toBeLessThanOrEqual(8000);
        expect(found.ranked).toEqual(
            (found.items ?? []).map((item) => item.id),
        );
    });
});
