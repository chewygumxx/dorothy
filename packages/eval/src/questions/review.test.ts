// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/review.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { runCli } from "../cli.js";
import { fakeIo, GARDEN, snapshotFixture, tempRoot } from "../testing.js";
import {
    type Question,
    questionId,
    questionsPath,
    readQuestions,
    writeQuestions,
} from "./file.js";

let temp: ReturnType<typeof tempRoot>;
let work: string;

const drafted = (question: string): Question => ({
    id: questionId(question, [`c:${GARDEN}`]),
    type: "single-session",
    question,
    answer: "Plot twelve, by the river.",
    evidence: [`c:${GARDEN}`],
    exclude: null,
    asOf: "2026-10-19",
    project: null,
    source: "generated:m/1",
    status: "draft",
    note: null,
});

beforeEach(async () => {
    temp = tempRoot("review");
    work = await snapshotFixture(temp.root);
    await writeQuestions(work, [
        drafted("Which plot is my allotment?"),
        drafted("Where is my allotment?"),
        drafted("By what is my allotment?"),
    ]);
});
afterEach(() => temp.remove());

const statuses = async () =>
    (await readQuestions(work)).questions.map((question) => question.status);

describe("bun run eval -- review", () => {
    it("accepts, rejects with a note, skips, and says what is left", async () => {
        const { io, out } = fakeIo({
            answers: ["a", "r", "too close to the first", "s"],
        });
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        expect(await statuses()).toEqual(["accepted", "rejected", "draft"]);
        expect((await readQuestions(work)).questions[1]?.note).toBe(
            "too close to the first",
        );
        const shown = out.join("");
        expect(shown).toContain("Draft 1 of 3, single-session");
        expect(shown).toContain("Plot twelve, by the river.");
        expect(shown).toContain(`c:${GARDEN}: The allotment`);
        expect(shown).toContain("plot twelve by the river");
        expect(shown).toEndWith(
            "accepted 1, rejected 1, edited 0; 1 drafts left\n",
        );
    });

    it("keeps every decision made before its input ends", async () => {
        const { io } = fakeIo({ answers: ["a"] });
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        expect(await statuses()).toEqual(["accepted", "draft", "draft"]);
    });

    it("takes an edit, gives it a new id, and shows it again", async () => {
        const { io } = fakeIo({
            answers: ["e", "a", "q"],
            onEdit: (path) => {
                const question = JSON.parse(readFileSync(path, "utf8"));
                question.question = "What number is my allotment plot?";
                writeFileSync(path, JSON.stringify(question));
            },
        });
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        const [first] = (await readQuestions(work)).questions;
        expect(first?.question).toBe("What number is my allotment plot?");
        expect(first?.id).toBe(
            questionId("What number is my allotment plot?", [`c:${GARDEN}`]),
        );
        expect(first?.status).toBe("accepted");
    });

    it("refuses an edit that is no question, leaving it as it was", async () => {
        const { io, out } = fakeIo({
            answers: ["e", "q"],
            onEdit: (path) => {
                const question = JSON.parse(readFileSync(path, "utf8"));
                question.evidence = ["c:nowhere"];
                writeFileSync(path, JSON.stringify(question));
            },
        });
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        expect(out.join("")).toContain("the question is unchanged");
        expect((await readQuestions(work)).questions[0]?.evidence).toEqual([
            `c:${GARDEN}`,
        ]);
    });

    it("keeps a question the file gains between two decisions", async () => {
        const { io } = fakeIo({
            answers: ["a", "e", "a", "q"],
            onEdit: (path) => {
                const question = JSON.parse(readFileSync(path, "utf8"));
                question.question = "Where is my allotment plot?";
                writeFileSync(path, JSON.stringify(question));
            },
        });
        const ask = io.ask;
        let prompts = 0;
        io.ask = async (prompt) => {
            if (prompt.startsWith("[a]ccept") && ++prompts === 2) {
                const { questions } = await readQuestions(work);
                await writeQuestions(work, [
                    ...questions,
                    drafted("Which river runs by my allotment?"),
                ]);
            }
            return ask(prompt);
        };
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        const { questions } = await readQuestions(work);
        expect(questions.map((question) => question.question)).toEqual([
            "Which plot is my allotment?",
            "Where is my allotment plot?",
            "By what is my allotment?",
            "Which river runs by my allotment?",
        ]);
        expect(questions.map((question) => question.status)).toEqual([
            "accepted",
            "accepted",
            "draft",
            "draft",
        ]);
    });

    it("asks again for a key it does not know", async () => {
        const { io, out } = fakeIo({ answers: ["x", "q"] });
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        expect(out.join("")).toContain("Type a, e, r, s or q.");
    });

    it("says when there is nothing to review", async () => {
        await writeQuestions(work, []);
        const { io, out } = fakeIo();
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        expect(out.join("")).toBe("no drafts to review\n");
    });

    it("writes nothing while the file has a malformed line", async () => {
        writeFileSync(questionsPath(work), "not json\n");
        const { io } = fakeIo({ answers: ["a"] });
        expect(await runCli(["review", "--work", work], io)).toBe(1);
        expect(readFileSync(questionsPath(work), "utf8")).toBe("not json\n");
    });
});
