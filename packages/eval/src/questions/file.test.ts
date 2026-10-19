// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/file.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { runCli } from "../cli.js";
import { UsageError } from "../errors.js";
import { fakeIo, snapshotFixture, tempRoot } from "../testing.js";
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

    it("fails on a file it cannot read, naming the path and the code", async () => {
        mkdirSync(questionsPath(temp.root));
        const said = `cannot read ${questionsPath(temp.root)}: EISDIR`;
        const error = await readQuestions(temp.root).catch((each) => each);
        expect(error).toBeInstanceOf(UsageError);
        expect(error.message).toStartWith(said);
        await expect(readQuestionsToRewrite(temp.root)).rejects.toThrow(said);
    });

    it("reaches the command line as a usage error, not a fault", async () => {
        const work = await snapshotFixture(temp.root);
        mkdirSync(questionsPath(work));
        const { io, err } = fakeIo();
        expect(await runCli(["mine", "--work", work], io)).toBe(1);
        expect(err.join("")).toContain(
            `cannot read ${questionsPath(work)}: EISDIR`,
        );
    });

    it("removes its temporary file when a write fails", async () => {
        // A directory where the file goes: the rename fails.
        mkdirSync(questionsPath(temp.root));
        await expect(
            writeQuestions(temp.root, [lookup("Which tea?")]),
        ).rejects.toThrow();
        expect(readdirSync(temp.root)).toEqual(["questions.jsonl"]);
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

    const writeLines = (...lines: unknown[]) =>
        writeFileSync(
            questionsPath(temp.root),
            lines.map((each) => `${JSON.stringify(each)}\n`).join(""),
        );

    it("reports a repeated id once, at the later line", async () => {
        const first = lookup("Which tea?");
        writeLines(first, lookup("Which plot?"), first);
        const { questions, problems } = await readQuestions(temp.root);
        expect(questions).toHaveLength(2);
        expect(problems).toEqual([
            `questions.jsonl:3: ${first.id} repeats line 1`,
        ]);
    });

    it("reports an id that does not match its text and evidence", async () => {
        const wrong = { ...lookup("Which tea?"), id: "q-00000000" };
        writeLines(wrong);
        const { questions, problems } = await readQuestions(temp.root);
        expect(questions).toEqual([]);
        expect(problems).toEqual([
            "questions.jsonl:1: q-00000000 is not the id of its text and evidence",
        ]);
    });

    it("reports a date that is none, though it has the form", async () => {
        writeLines(
            { ...lookup("Which tea?"), asOf: "2026-02-30" },
            { ...lookup("Which plot?"), asOf: "2026-13-01" },
            { ...lookup("Which bike?"), asOf: "2024-02-29" },
        );
        const { questions, problems } = await readQuestions(temp.root);
        expect(questions.map((each) => each.asOf)).toEqual(["2024-02-29"]);
        expect(problems).toEqual([
            "questions.jsonl:1: asOf: not a real date, as YYYY-MM-DD",
            "questions.jsonl:2: asOf: not a real date, as YYYY-MM-DD",
        ]);
    });

    it("lists the problems that stop a rewrite one to a line", async () => {
        writeFileSync(questionsPath(temp.root), "not json\nnot json\n");
        await expect(readQuestionsToRewrite(temp.root)).rejects.toThrow(
            "questions.jsonl:1: not JSON\nquestions.jsonl:2: not JSON\nmend or remove these lines first",
        );
    });

    it("merges by id, keeping the owner's decisions", () => {
        const kept = { ...lookup("Which tea?"), status: "rejected" as const };
        const merged = mergeQuestions(
            [kept],
            [lookup("Which tea?"), lookup("Which plot?")],
        );
        expect(merged.added).toBe(1);
        expect(merged.collided).toBe(0);
        expect(merged.questions.map((each) => each.status)).toEqual([
            "rejected",
            "accepted",
        ]);
    });

    it("counts an incoming question whose id is another's, not a repeat", () => {
        const held = lookup("Which tea?");
        const other = { ...lookup("Which plot?"), id: held.id };
        const merged = mergeQuestions([held], [held, other]);
        expect(merged.added).toBe(0);
        expect(merged.collided).toBe(1);
        expect(merged.questions).toEqual([held]);
    });
});
