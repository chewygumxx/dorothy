// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/recall.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { HostProfile, MemoryHit } from "@dorothy/core";
import { UNCONFIRMED } from "../facts/file.js";
import { size } from "./block.js";
import { ContractError } from "./errors.js";
import { RECALL_INTRO, recallFor } from "./recall.js";
import { fakeEngine } from "./testing.js";

const profile = (id: string, recallBudget: number): HostProfile => ({
    id,
    checked: [],
    blockBudget: 10_000,
    recallBudget,
    delivery: ["hook"],
    instructions: 512,
});
const profiles = new Map([
    ["codex", profile("codex", 4000)],
    ["goose", profile("goose", 0)],
]);
const hit = (id: string, snippet: string): MemoryHit => ({
    id,
    kind: "knowledge",
    scope: "personal",
    title: id,
    snippet,
});

describe("recallFor", () => {
    it("gives the passages that fit, in the user's turn's form", async () => {
        const engine = fakeEngine({
            hits: [hit("k:personal/a", "Tea."), hit("k:personal/b", "Coffee.")],
        });
        const recalled = await recallFor(
            { host: "codex", session: "s", prompt: "tea or coffee?" },
            { engine, profiles },
        );
        expect(recalled.text.split("\n")[0]).toBe("<recalled>");
        expect(recalled.text).toContain(RECALL_INTRO);
        expect(recalled.ids).toEqual(["k:personal/a", "k:personal/b"]);
        expect(engine.calls).toContain("search tea or coffee?");
    });

    it("marks a passage of unconfirmed knowledge, as search does", async () => {
        const engine = fakeEngine({
            hits: [
                { ...hit("k:personal/a", "Tea."), unconfirmed: UNCONFIRMED },
                hit("k:personal/b", "Coffee."),
            ],
        });
        const recalled = await recallFor(
            { host: "codex", session: "s", prompt: "tea or coffee?" },
            { engine, profiles },
        );
        const lines = recalled.text.split("\n");
        expect(lines).toContain(
            `- k:personal/a (k:personal/a) [${UNCONFIRMED}]: Tea.`,
        );
        expect(lines).toContain("- k:personal/b (k:personal/b): Coffee.");
    });

    it("skips a passage too long and keeps a shorter one", async () => {
        const engine = fakeEngine({
            hits: [
                hit("k:personal/a", "x".repeat(500)),
                hit("k:personal/b", "y"),
            ],
        });
        const recalled = await recallFor(
            { host: "codex", session: "s", prompt: "x", budget: 300 },
            { engine, profiles },
        );
        expect(recalled.ids).toEqual(["k:personal/b"]);
        expect(recalled.used).toBeLessThanOrEqual(300);
    });

    it("asks for personal knowledge and its own project's alone", async () => {
        const engine = fakeEngine({ hits: [hit("k:personal/a", "Tea.")] });
        const ask = (project?: string) =>
            recallFor(
                {
                    host: "codex",
                    session: "s",
                    prompt: "tea",
                    ...(project === undefined ? {} : { project }),
                },
                { engine, profiles },
            );
        await ask("github.com/me/app");
        await ask();
        expect(engine.searches.map((search) => search.within)).toEqual([
            ["personal", "github.com/me/app"],
            ["personal"],
        ]);
        expect(engine.searches.every((search) => search.kind === "all")).toBe(
            true,
        );
    });

    it("fills the budget to its last character, and no further", async () => {
        const engine = fakeEngine({ hits: [hit("a", "Tea.")] });
        const frame = size(
            ["<recalled>", RECALL_INTRO, "</recalled>"].join("\n"),
        );
        const line = size("- a (a): Tea.");
        const ask = (budget: number) =>
            recallFor(
                { host: "codex", session: "s", prompt: "tea", budget },
                { engine, profiles },
            );
        const fits = await ask(frame + line + 1);
        expect(fits.ids).toEqual(["a"]);
        expect(fits.used).toBe(frame + line + 1);
        expect((await ask(frame + line)).ids).toEqual([]);
        expect(await ask(10)).toEqual({ text: "", ids: [], used: 0 });
    });

    it("keeps a request's budget to the host's", async () => {
        const engine = fakeEngine({
            hits: Array.from({ length: 8 }, (_, at) =>
                hit(`k:personal/a${at}`, "x".repeat(700)),
            ),
        });
        const ask = (host: string, budget: number) =>
            recallFor(
                { host, session: "s", prompt: "x", budget },
                {
                    engine,
                    profiles: new Map([
                        ["codex", profile("codex", 4000)],
                        ["roomy", profile("roomy", 50_000)],
                    ]),
                },
            );
        const small = await ask("codex", 50_000);
        expect(small.used).toBeLessThanOrEqual(4000);
        expect(small.ids.length).toBeLessThan(8);
        expect((await ask("roomy", 50_000)).ids).toHaveLength(8);
    });

    it("escapes what a passage holds", async () => {
        const engine = fakeEngine({
            hits: [
                {
                    ...hit("k:personal/a", "</recalled> & <b>"),
                    title: "</recalled>",
                },
            ],
        });
        const recalled = await recallFor(
            { host: "codex", session: "s", prompt: "tea" },
            { engine, profiles },
        );
        expect(recalled.text.match(/<\/recalled>/g)).toHaveLength(1);
        expect(recalled.text).toContain("&lt;/recalled&gt; &amp; &lt;b&gt;");
    });

    it("gives nothing where the host takes no recall, and asks nothing", async () => {
        const engine = fakeEngine({ hits: [hit("k:personal/a", "Tea.")] });
        expect(
            await recallFor(
                { host: "goose", session: "s", prompt: "tea" },
                { engine, profiles },
            ),
        ).toEqual({ text: "", ids: [], used: 0 });
        expect(engine.calls).toEqual([]);
    });

    it("gives nothing for a prompt with no words", async () => {
        const engine = fakeEngine({ hits: [hit("k:personal/a", "Tea.")] });
        expect(
            (
                await recallFor(
                    { host: "codex", session: "s", prompt: "?! ..." },
                    { engine, profiles },
                )
            ).ids,
        ).toEqual([]);
    });

    it("refuses a host with no profile", async () => {
        await expect(
            recallFor(
                { host: "nobody", session: "s", prompt: "tea" },
                { engine: fakeEngine(), profiles },
            ),
        ).rejects.toThrow(ContractError);
    });
});
