// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/file.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { tempRoot } from "../testing.js";
import {
    mergeQuestions,
    type Question,
    questionId,
    questionSchema,
    questionsPath,
    readQuestions,
    readQuestionsToRewrite,
    writeQuestions,
} from "./file.js";

let temp: ReturnType<typeof tempRoot>;
beforeEach(() => {
    temp = tempRoot("questions");
});
afterEach(() => temp.remove());

const lookup = (question: string): Question => ({
    id: questionId(question, ["c:x"]),
    type: "lookup",
    question,
    answer: null,
    evidence: ["c:x"],
    exclude: "reader",
    asOf: "2026-10-01",
    project: null,
    source: "mined",
    status: "accepted",
    note: null,
});

describe("a question's id", () => {
    it("is q- and eight hex digits, whatever the evidence's order", () => {
        const id = questionId("When?", ["c:a", "k:b"]);
        expect(id).toMatch(/^q-[0-9a-f]{8}$/);
        expect(questionId("When?", ["k:b", "c:a"])).toBe(id);
        expect(questionId("Where?", ["c:a", "k:b"])).not.toBe(id);
    });
});

describe("a question's shape", () => {
    it("takes a lookup with evidence and no answer", () => {
        expect(questionSchema.safeParse(lookup("Which tea?")).success).toBe(
            true,
        );
    });

    it("refuses a lookup without evidence", () => {
        const bad = { ...lookup("Which tea?"), evidence: [] };
        expect(questionSchema.safeParse(bad).success).toBe(false);
    });

    it("refuses an abstention with evidence, or without an answer", () => {
        const base = {
            ...lookup("Where did I go?"),
            type: "abstention",
            answer: "The memory does not say.",
            evidence: [],
            source: "generated:m",
        };
        expect(questionSchema.safeParse(base).success).toBe(true);
        expect(
            questionSchema.safeParse({ ...base, evidence: ["c:x"] }).success,
        ).toBe(false);
        expect(
            questionSchema.safeParse({ ...base, answer: null }).success,
        ).toBe(false);
    });

    it("refuses a key it does not know", () => {
        const bad = { ...lookup("Which tea?"), extra: 1 };
        expect(questionSchema.safeParse(bad).success).toBe(false);
    });
});

describe("the question file", () => {
    it("is empty before anything is written", async () => {
        expect(await readQuestions(temp.root)).toEqual({
            questions: [],
            problems: [],
        });
    });

    it("writes and reads back, private to the user", async () => {
        const questions = [lookup("Which tea?"), lookup("Which plot?")];
        await writeQuestions(temp.root, questions);
        expect((await readQuestions(temp.root)).questions).toEqual(questions);
        expect(statSync(questionsPath(temp.root)).mode & 0o777).toBe(0o600);
        expect(readFileSync(questionsPath(temp.root), "utf8")).toEndWith("}\n");
    });

    it("reports a malformed line by number and reads the rest", async () => {
        await writeQuestions(temp.root, [lookup("Which tea?")]);
        const path = questionsPath(temp.root);
        writeFileSync(
            path,
            `${readFileSync(path, "utf8")}{"id": "nope"}\nnot json\n\n`,
        );
        const { questions, problems } = await readQuestions(temp.root);
        expect(questions).toHaveLength(1);
        expect(problems).toHaveLength(2);
        expect(problems[0]).toStartWith("questions.jsonl:2: ");
        expect(problems[1]).toStartWith("questions.jsonl:3: ");
    });

    it("refuses to rewrite a file with a malformed line", async () => {
        await writeQuestions(temp.root, [lookup("Which tea?")]);
        const path = questionsPath(temp.root);
        writeFileSync(path, `${readFileSync(path, "utf8")}not json\n`);
        await expect(readQuestionsToRewrite(temp.root)).rejects.toThrow(
            "questions.jsonl:2: ",
        );
    });

    it("merges by id, keeping the owner's decisions", () => {
        const kept = { ...lookup("Which tea?"), status: "rejected" as const };
        const merged = mergeQuestions(
            [kept],
            [lookup("Which tea?"), lookup("Which plot?")],
        );
        expect(merged.added).toBe(1);
        expect(merged.questions.map((each) => each.status)).toEqual([
            "rejected",
            "accepted",
        ]);
    });
});
