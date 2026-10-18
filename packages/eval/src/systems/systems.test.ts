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
import { GARDEN, READER, snapshotFixture, TEA, tempRoot } from "../testing.js";
import { type Corpus, openCorpus, passage } from "./corpus.js";
import { type Asked, makeSystem, packItems } from "./system.js";
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
            120,
        );
        expect(packed.length).toBeLessThanOrEqual(120);
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
        // The block's knowledge, after the hits.
        expect(found.ranked).toContain("k:personal/uses-helix");
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
