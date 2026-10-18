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
import { fakeIo, READER, snapshotFixture, TEA, tempRoot } from "../testing.js";
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
            new Set(["c:t"]),
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
            new Set(["c:r", "c:t"]),
        );
        expect(found.map((question) => question.question)).toEqual(["again"]);
    });

    it("leaves out what no system could give: hidden, gone or retired", () => {
        expect(
            lookupQuestions(
                [read("an old editor", "k:personal/uses-vim")],
                new Map(),
                new Set(["c:t"]),
            ),
        ).toEqual([]);
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
