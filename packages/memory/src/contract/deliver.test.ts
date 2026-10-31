// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/deliver.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { MemoryHit } from "@dorothy/core";
import { UNCONFIRMED } from "../facts/file.js";
import { deliver, type EvidenceSource } from "./deliver.js";
import {
    type EvidenceConversation,
    type EvidenceKnowledge,
    turnsIn,
} from "./passage.js";

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

    it("narrows a passage's range to what packing left", async () => {
        const { items } = await deliver(
            {
                ...ask([episode("c:talk", [3])], 100),
                policy: { cap: 1000 },
            },
            source,
        );
        expect(items[0]?.cut).toBe(true);
        expect(items[0]?.turns).toEqual(turnsIn(items[0]?.text ?? ""));
        expect(items[0]?.turns?.through ?? 0).toBeLessThan(4);
    });

    it("gives no range where packing left only the head", async () => {
        const { items } = await deliver(
            { ...ask([episode("c:talk", [3])], 60), policy: { cap: 1000 } },
            source,
        );
        expect(items[0]?.turns).toBeNull();
        expect(items[0]?.opened).toBe(true);
    });

    it("keeps the matched words of an escaped passage", async () => {
        const amp: EvidenceConversation = {
            ...talk,
            turns: [
                {
                    n: 1,
                    role: "user",
                    at: AT,
                    text: `${"&".repeat(1000)} bicycle crimson ${"&".repeat(1000)}`,
                },
            ],
        };
        const { items } = await deliver(
            { ...ask([episode("c:talk", [1])], 800), escape: true },
            sourceOf([amp], []),
        );
        expect(items[0]?.text).toContain("bicycle");
        expect(items[0]?.text.length).toBeLessThanOrEqual(200);
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
        expect(
            await deliver(ask([episode("c:talk", [3])], 10), source),
        ).toEqual({ text: "", items: [] });
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
