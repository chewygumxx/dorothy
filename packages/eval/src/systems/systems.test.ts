// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/systems.test.ts
//
//

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { conversationText, passage } from "@dorothy/memory/evaluation";
import { workEnv } from "../snapshot/snapshot.js";
import { GARDEN, READER, snapshotFixture, TEA, tempRoot } from "../testing.js";
import { type Corpus, openCorpus } from "./corpus.js";
import { type Asked, makeSystem } from "./system.js";
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
        const hits = await corpus.archive.engine.search({
            query: question,
            within: "all",
            kind: "all",
            limit: 10,
            project: null,
        });
        const block = await corpus.archive.block({
            project: null,
            budget: 3200,
            exclude: null,
        });
        const found = await makeSystem("dorothy", corpus).retrieve(
            asked(question),
            8000,
        );
        const given = hits.map((hit) => hit.id);
        expect(found.ranked).toEqual([
            ...given,
            ...block.ids.filter((id) => !given.includes(id)),
        ]);
        // The hits lead, though the block holds the knowledge first.
        expect(found.ranked[0]).toBe(`c:${GARDEN}`);
        expect(given).not.toEqual(block.ids);
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
