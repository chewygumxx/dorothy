// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/reviewer.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, newPhrase, type StructuredCall } from "@dorothy/core";
import { Reviewer, type ReviewProblem } from "./reviewer.js";
import { readSidecar } from "./sidecar.js";

const NOW = new Date("2026-10-15T09:00:00.000Z");
const PHRASE = newPhrase(() => Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
const NOTES = {
    title: "Tea",
    description: "About tea.",
    abstract: "Tea at four.",
};

let dir = "";
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-reviewer-"));
    await writeFile(
        join(dir, `${PHRASE}.jsonl`),
        [
            { v: 1, kind: "user", at: NOW.toISOString(), text: "tea?" },
            {
                v: 1,
                kind: "assistant",
                at: NOW.toISOString(),
                text: "At four.",
                interrupted: false,
            },
        ]
            .map((event) => JSON.stringify(event))
            .join("\n") + "\n",
    );
});
afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

const reviewer = (
    call: StructuredCall,
    said: string[] = [],
    spent: number[] = [],
) =>
    new Reviewer({
        dir,
        config: DEFAULT_CONFIG.memory,
        index: null,
        vocabulary: null,
        versions: null,
        call,
        persona: "You are Dorothy.",
        now: () => NOW,
        entries: () => [],
        warn: (message) => said.push(message),
        cost: (usd) => spent.push(usd),
    });

describe("Reviewer", () => {
    it("reviews a conversation alone, writing its notes and saying what it cost", async () => {
        const spent: number[] = [];
        const reviewed = await reviewer(
            async () => ({
                ok: true,
                output: NOTES,
                model: "m",
                costUsd: 0.25,
            }),
            [],
            spent,
        ).review(PHRASE, new AbortController().signal);
        expect(reviewed).toMatchObject({ kind: "reviewed", turns: 2 });
        const read = await readSidecar(dir, PHRASE);
        expect(read.kind === "ok" && read.sidecar.title).toBe("Tea");
        expect(spent).toEqual([0.25]);
    });

    it("marks a failure and says why", async () => {
        const said: string[] = [];
        const reviewed = await reviewer(
            async () => ({ ok: false, reason: "no credentials", costUsd: 0 }),
            said,
        ).review(PHRASE, new AbortController().signal);
        expect(reviewed.kind).toBe("marked");
        expect(said).toEqual([
            `memory: couldn't review "${PHRASE}": no credentials`,
        ]);
    });

    it("names what went wrong by kind beside the warning", async () => {
        const problems: ReviewProblem[] = [];
        const options = {
            dir,
            config: DEFAULT_CONFIG.memory,
            index: null,
            vocabulary: null,
            versions: null,
            persona: "You are Dorothy.",
            now: () => NOW,
            entries: () => [],
            warn: (_message: string, problem: ReviewProblem) =>
                problems.push(problem),
            cost: () => {},
        };
        await new Reviewer({
            ...options,
            call: async () => ({ ok: false, reason: "words", costUsd: 0 }),
        }).review(PHRASE, new AbortController().signal);
        await new Reviewer({
            ...options,
            now: () => new Date(NOW.getTime() + 2 * 3_600_000),
            call: async () => ({
                ok: true,
                output: { title: "a" },
                model: "m",
                costUsd: 0,
            }),
        }).review(PHRASE, new AbortController().signal);
        expect(problems).toEqual([
            { phrase: PHRASE, kind: "call" },
            { phrase: PHRASE, kind: "notes" },
        ]);
    });

    it("does nothing for a conversation already reviewed through its end", async () => {
        const call: StructuredCall = async () => ({
            ok: true,
            output: NOTES,
            model: "m",
            costUsd: 0,
        });
        const one = reviewer(call);
        await one.review(PHRASE, new AbortController().signal);
        expect(await one.review(PHRASE, new AbortController().signal)).toEqual({
            kind: "none",
        });
    });
});
