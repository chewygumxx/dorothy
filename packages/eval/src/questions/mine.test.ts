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
import {
    type FixtureConversation,
    fixturePhrase,
} from "@dorothy/memory/evaluation";
import { runCli } from "../cli.js";
import {
    collidingTexts,
    extraQuestion,
    FIXTURE,
    fakeIo,
    READER,
    snapshotFixture,
    TEA,
    tempRoot,
    whileLocked,
} from "../testing.js";
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
        ).questions;
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
            new Map([["r", null]]),
            new Set(["c:r", "c:t"]),
        );
        expect(found.questions.map((each) => each.question)).toEqual(["again"]);
        expect(found.dropped).toEqual({});
    });

    it("leaves out what no system could give: hidden, gone or retired", () => {
        expect(
            lookupQuestions(
                [read("an old editor", "k:personal/uses-vim")],
                new Map([["r", null]]),
                new Set(["c:t"]),
            ).questions,
        ).toEqual([]);
    });

    it("counts a purpose too long to be a question", () => {
        const found = lookupQuestions(
            [read("x".repeat(2001), "c:t"), read("which tea", "c:t")],
            new Map([["r", null]]),
            new Set(["c:t"]),
        );
        expect(found.questions.map((each) => each.question)).toEqual([
            "which tea",
        ]);
        expect(found.dropped).toEqual({
            "a purpose that is not a question": 1,
        });
    });

    it("keeps the first reader's exclusion when two read the same purpose", () => {
        const found = lookupQuestions(
            [read("which tea", "c:t", "r"), read("which tea", "c:t", "s")],
            new Map([
                ["r", null],
                ["s", null],
            ]),
            new Set(["c:t"]),
        );
        expect(found.questions.map((each) => each.exclude)).toEqual(["r"]);
    });

    it("counts a purpose whose id is another purpose's", () => {
        const [a, b] = collidingTexts();
        const found = lookupQuestions(
            [read(a, "c:x"), read(b, "c:x"), read(a, "c:x")],
            new Map([["r", null]]),
            new Set(["c:x"]),
        );
        expect(found.questions.map((each) => each.question)).toEqual([a]);
        expect(found.dropped).toEqual({
            "a purpose whose id is another question's": 1,
        });
    });

    it("passes over a read by a conversation the snapshot lacks", () => {
        const found = lookupQuestions(
            [read("which tea", "c:t", "hidden")],
            new Map([["r", null]]),
            new Set(["c:t"]),
        );
        expect(found.questions).toEqual([]);
        expect(found.dropped).toEqual({
            "a read by a hidden or absent conversation": 1,
        });
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

    it("passes over reads of, and by, hidden conversations", async () => {
        const [SECRET, SECRET_READER] = [5, 6].map(fixturePhrase) as [
            string,
            string,
        ];
        const turns = (text: string) => [
            { role: "user" as const, text, at: "2026-10-02T09:00:00.000Z" },
            {
                role: "assistant" as const,
                text: "Noted.",
                at: "2026-10-02T09:00:05.000Z",
            },
        ];
        const [first, ...others] = FIXTURE.conversations;
        const fixture = {
            ...FIXTURE,
            conversations: [
                {
                    ...(first as FixtureConversation),
                    reads: [
                        {
                            id: "h1",
                            target: { conversation: SECRET },
                            purpose: "what the user keeps private",
                            served: "useful" as const,
                        },
                    ],
                },
                ...others,
                {
                    phrase: SECRET,
                    title: "Private",
                    turns: turns("A private matter."),
                    hidden: true,
                },
                {
                    phrase: SECRET_READER,
                    title: "Private reader",
                    turns: turns("Looking for the tea."),
                    hidden: true,
                    reads: [
                        {
                            id: "h2",
                            target: { conversation: TEA },
                            purpose: "when the user drinks tea in private",
                            served: "essential" as const,
                        },
                    ],
                },
            ],
        };
        const work = await snapshotFixture(temp.root, fixture);
        const { io, out } = fakeIo();
        expect(await runCli(["mine", "--work", work], io)).toBe(0);
        expect(out.join("")).toBe(
            "mined 2 lookups, 2 new; 2 questions in all\n  dropped 1: a read by a hidden or absent conversation\n",
        );
    });

    it("waits for another writer, and keeps what it wrote", async () => {
        const work = await snapshotFixture(temp.root);
        const extra = extraQuestion("Which river runs by my allotment?");
        const { io, out } = fakeIo();
        await whileLocked(work, extra, () =>
            runCli(["mine", "--work", work], io),
        );
        expect(out.join("")).toBe(
            "mined 2 lookups, 2 new; 3 questions in all\n",
        );
        const { questions } = await readQuestions(work);
        expect(questions.map((question) => question.type)).toEqual([
            "single-session",
            "lookup",
            "lookup",
        ]);
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
