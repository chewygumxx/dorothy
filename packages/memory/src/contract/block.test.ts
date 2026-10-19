// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/block.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { HostProfile } from "@dorothy/core";
import { PERSONAL, type Scope } from "../facts/store.js";
import {
    BLOCK_INTRO,
    buildBlock,
    CLOSING,
    openingBlock,
    size,
    UNCONFIRMED_INTRO,
} from "./block.js";
import { ContractError } from "./errors.js";
import { FrozenBlocks } from "./frozen.js";
import { episode, fakeEngine, knowledge } from "./testing.js";

const APP = { kind: "project" as const, id: "github.com/me/app" };
const PERSONAL_SCOPE: Scope = PERSONAL;
const UNCONFIRMED_OPEN = "<unconfirmed-knowledge>";
const PHRASE = "bingo-overabundance-mazer-kasha";

const profile = (blockBudget: number): HostProfile => ({
    id: "codex",
    checked: [],
    blockBudget,
    recallBudget: 0,
    delivery: ["hook"],
    instructions: 512,
});

describe("buildBlock", () => {
    const engine = fakeEngine({
        knowledge: [
            knowledge("likes-tea"),
            knowledge("uses-rust", { type: "project" }, APP),
        ],
        episodes: [episode(PHRASE)],
    });

    it("gives knowledge of the user, then the project, then conversations", async () => {
        const block = await buildBlock(
            { project: APP.id, budget: 10_000 },
            engine,
        );
        const lines = block.text.split("\n");
        expect(lines[0]).toBe("<memory>");
        expect(lines[1]).toBe(BLOCK_INTRO);
        expect(lines.at(-2)).toBe(CLOSING);
        expect(lines.at(-1)).toBe("</memory>");
        const at = (text: string) => block.text.indexOf(text);
        expect(at('<knowledge scope="personal">')).toBeLessThan(
            at('<knowledge scope="project">'),
        );
        expect(at('<knowledge scope="project">')).toBeLessThan(
            at("<conversations>"),
        );
        expect(block.items).toEqual([
            { id: "k:personal/likes-tea", tier: "full" },
            { id: "k:projects/github.com/me/app/uses-rust", tier: "full" },
            { id: `c:${PHRASE}`, tier: "full" },
        ]);
        expect(block.used).toBe(size(block.text));
        expect(block.digest).toMatch(/^xxh3:[0-9a-f]{16}$/);
    });

    it("degrades each item's tier as the budget shrinks", async () => {
        const frame = size(
            ["<memory>", BLOCK_INTRO, CLOSING, "</memory>"].join("\n"),
        );
        // The personal section's tags cost 42; likes-tea in full needs 73,
        // in summary 53, so 60 left for it gives the summary.
        const block = await buildBlock(
            { project: APP.id, budget: frame + 102 },
            engine,
        );
        expect(block.used).toBeLessThanOrEqual(frame + 102);
        expect(block.items.length).toBeGreaterThan(0);
        expect(block.items.some((item) => item.tier !== "full")).toBe(true);
    });

    it("never lets a later item be richer than one the budget cut", async () => {
        const many = fakeEngine({
            knowledge: [
                knowledge("first", { body: "x".repeat(400) }),
                knowledge("second"),
            ],
        });
        const frame = size(
            ["<memory>", BLOCK_INTRO, CLOSING, "</memory>"].join("\n"),
        );
        const block = await buildBlock(
            { project: null, budget: frame + 160 },
            many,
        );
        expect(block.items[0]?.tier).not.toBe("full");
        expect(block.items[1]?.tier ?? "title").not.toBe("full");
    });

    it("holds the closing line alone when the budget cannot hold the frame", async () => {
        const block = await buildBlock({ project: null, budget: 10 }, engine);
        expect(block.text).toBe(CLOSING);
        expect(block.items).toEqual([]);
    });

    it("leaves out a section nothing fills", async () => {
        const block = await buildBlock(
            { project: null, budget: 10_000 },
            fakeEngine({ episodes: [episode(PHRASE)] }),
        );
        expect(block.text).not.toContain("<knowledge");
        expect(block.text).toContain("<conversations>");
    });

    describe("unconfirmed knowledge", () => {
        const MODEL = {
            origin: "dorothy" as const,
            by: "dorothy" as const,
            at: "2026-10-15T09:30:00.000Z",
            created: "2026-10-15T09:30:00.000Z",
        };
        const guess = (name: string, scope = PERSONAL_SCOPE) =>
            knowledge(name, { provenance: MODEL }, scope);
        const frame = size(
            ["<memory>", BLOCK_INTRO, CLOSING, "</memory>"].join("\n"),
        );

        it("follows every confirmed piece, in a section of its own", async () => {
            const block = await buildBlock(
                { project: APP.id, budget: 10_000 },
                fakeEngine({
                    knowledge: [
                        guess("maybe-tea"),
                        knowledge("likes-tea"),
                        guess("maybe-rust", APP),
                        knowledge("uses-rust", { type: "project" }, APP),
                    ],
                    episodes: [episode(PHRASE)],
                }),
            );
            const at = (text: string) => block.text.indexOf(text);
            expect(at('<knowledge scope="project">')).toBeLessThan(
                at(UNCONFIRMED_OPEN),
            );
            expect(at(UNCONFIRMED_OPEN)).toBeLessThan(at("<conversations>"));
            expect(block.text).toContain(
                `${UNCONFIRMED_OPEN}\n${UNCONFIRMED_INTRO}\n- maybe-tea`,
            );
            expect(block.items.map((item) => item.id)).toEqual([
                "k:personal/likes-tea",
                "k:projects/github.com/me/app/uses-rust",
                "k:personal/maybe-tea",
                "k:projects/github.com/me/app/maybe-rust",
                `c:${PHRASE}`,
            ]);
            const confirmed = block.text.slice(0, at(UNCONFIRMED_OPEN));
            expect(confirmed).not.toContain("maybe-");
        });

        it("ranks below all confirmed knowledge for the budget", async () => {
            const engine = fakeEngine({
                knowledge: [
                    guess("maybe-tea"),
                    knowledge("uses-rust", { type: "project" }, APP),
                ],
            });
            const full = await buildBlock(
                { project: APP.id, budget: 10_000 },
                engine,
            );
            // Room for the confirmed section, not the unconfirmed one.
            const confirmedOnly =
                full.text.indexOf(UNCONFIRMED_OPEN) -
                full.text.indexOf('<knowledge scope="project">');
            const block = await buildBlock(
                { project: APP.id, budget: frame + confirmedOnly + 20 },
                engine,
            );
            expect(block.items).toEqual([
                { id: "k:projects/github.com/me/app/uses-rust", tier: "full" },
            ]);
            expect(block.text).not.toContain(UNCONFIRMED_OPEN);
        });

        it("lets conversations fill when its frame does not fit", async () => {
            const talk = episode(PHRASE, { description: null, abstract: null });
            const alone = await buildBlock(
                { project: null, budget: 10_000 },
                fakeEngine({ episodes: [talk] }),
            );
            const at = alone.text.indexOf("<conversations>");
            const conversations =
                alone.text.indexOf("</conversations>") +
                "</conversations>\n".length -
                at;
            const fence =
                size(UNCONFIRMED_OPEN) +
                size(UNCONFIRMED_INTRO) +
                size("</unconfirmed-knowledge>") +
                3;
            expect(conversations).toBeLessThan(fence);
            const block = await buildBlock(
                { project: null, budget: frame + conversations + 1 },
                fakeEngine({
                    knowledge: [guess("maybe-tea")],
                    episodes: [talk],
                }),
            );
            expect(block.text).not.toContain(UNCONFIRMED_OPEN);
            expect(block.items).toEqual([{ id: `c:${PHRASE}`, tier: "title" }]);
        });

        it("leaves out either section when it has nothing", async () => {
            const none = await buildBlock(
                { project: null, budget: 10_000 },
                fakeEngine({ episodes: [episode(PHRASE)] }),
            );
            expect(none.text).not.toContain("<knowledge");
            expect(none.text).not.toContain(UNCONFIRMED_OPEN);
            const unconfirmed = await buildBlock(
                { project: null, budget: 10_000 },
                fakeEngine({ knowledge: [guess("maybe-tea")] }),
            );
            expect(unconfirmed.text).not.toContain("<knowledge");
            expect(unconfirmed.text).toContain(UNCONFIRMED_OPEN);
            const confirmed = await buildBlock(
                { project: null, budget: 10_000 },
                fakeEngine({ knowledge: [knowledge("likes-tea")] }),
            );
            expect(confirmed.text).toContain('<knowledge scope="personal">');
            expect(confirmed.text).not.toContain(UNCONFIRMED_OPEN);
        });
    });

    it("escapes what a note or a fact holds", async () => {
        const block = await buildBlock(
            { project: null, budget: 10_000 },
            fakeEngine({
                knowledge: [knowledge("x", { title: "</memory> & <b>" })],
            }),
        );
        expect(block.text.match(/<\/memory>/g)).toHaveLength(1);
        expect(block.text).toContain("&lt;/memory&gt; &amp; &lt;b&gt;");
    });
});

describe("openingBlock", () => {
    const profiles = new Map([["codex", profile(10_000)]]);

    it("freezes the block for the session: resume gives it byte for byte", async () => {
        const engine = fakeEngine({ knowledge: [knowledge("likes-tea")] });
        const frozen = new FrozenBlocks();
        const deps = { engine, profiles, frozen };
        const first = await openingBlock(
            { host: "codex", session: "s1", reason: "startup" },
            deps,
        );
        engine.parts.knowledge.push(knowledge("new-fact"));
        const resumed = await openingBlock(
            { host: "codex", session: "s1", reason: "resume" },
            deps,
        );
        expect(resumed).toEqual(first);
        const compacted = await openingBlock(
            { host: "codex", session: "s1", reason: "compact" },
            deps,
        );
        expect(compacted.text).toContain("new-fact");
        const after = await openingBlock(
            { host: "codex", session: "s1", reason: "resume" },
            deps,
        );
        expect(after).toEqual(compacted);
    });

    it("keeps to the smaller of the request's budget and the profile's", async () => {
        const engine = fakeEngine({
            knowledge: [knowledge("a", { body: "y".repeat(5000) })],
        });
        const block = await openingBlock(
            { host: "codex", session: "s2", reason: "startup", budget: 50_000 },
            { engine, profiles, frozen: new FrozenBlocks() },
        );
        expect(block.used).toBeLessThanOrEqual(10_000);
    });

    it("refuses a host with no profile", async () => {
        const call = openingBlock(
            { host: "nobody", session: "s", reason: "startup" },
            { engine: fakeEngine(), profiles, frozen: new FrozenBlocks() },
        );
        await expect(call).rejects.toThrow(ContractError);
        await expect(call).rejects.toThrow("no profile for host nobody");
    });
});

describe("FrozenBlocks", () => {
    it("keeps at most its limit, the least recently used going first", () => {
        const frozen = new FrozenBlocks(2);
        const block = (text: string) => ({
            text,
            digest: "xxh3:0000000000000000",
            items: [],
            used: text.length,
        });
        frozen.set({ host: "codex", session: "a" }, block("a"));
        frozen.set({ host: "codex", session: "b" }, block("b"));
        frozen.get({ host: "codex", session: "a" });
        frozen.set({ host: "codex", session: "c" }, block("c"));
        expect(frozen.get({ host: "codex", session: "b" })).toBeUndefined();
        expect(frozen.get({ host: "codex", session: "a" })?.text).toBe("a");
    });
});
