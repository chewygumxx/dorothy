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
