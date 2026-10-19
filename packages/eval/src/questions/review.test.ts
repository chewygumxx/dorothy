// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/review.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { runCli } from "../cli.js";
import {
    extraQuestion,
    fakeIo,
    GARDEN,
    snapshotFixture,
    tempRoot,
    whileLocked,
} from "../testing.js";
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

    // An edit of the question as the editor holds it, then quit.
    const editing = (change: (question: Record<string, unknown>) => void) =>
        fakeIo({
            answers: ["e", "q"],
            onEdit: (path) => {
                const question = JSON.parse(readFileSync(path, "utf8"));
                change(question);
                writeFileSync(path, JSON.stringify(question));
            },
        });

    const refused = async (
        change: (question: Record<string, unknown>) => void,
        why: string,
    ) => {
        const before = readFileSync(questionsPath(work), "utf8");
        const inode = statSync(questionsPath(work)).ino;
        const { io, out } = editing(change);
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        expect(out.join("")).toContain(
            `that edit is not a question: ${why}; the question is unchanged`,
        );
        expect(readFileSync(questionsPath(work), "utf8")).toBe(before);
        // Not written again: the same file, not a copy renamed over it.
        expect(statSync(questionsPath(work)).ino).toBe(inode);
    };

    it("refuses an edit to evidence the snapshot lacks, leaving it as it was", async () => {
        await refused((question) => {
            question.evidence = ["c:nowhere"];
        }, "c:nowhere is not in the snapshot");
    });

    it("says which field of an edit is wrong", async () => {
        await refused((question) => {
            question.asOf = "2026-02-30";
        }, "asOf: not a real date, as YYYY-MM-DD");
        await refused((question) => {
            question.answer = null;
        }, "only a lookup goes without an answer");
        await refused((question) => {
            question.question = 7;
        }, "question: Invalid input: expected string, received number");
    });

    it("says an edit is not JSON, or not an object", async () => {
        const text = (written: string) =>
            fakeIo({
                answers: ["e", "q"],
                onEdit: (path) => writeFileSync(path, written),
            });
        for (const [written, why] of [
            ["{not json", "it is not JSON"],
            ["[1, 2]", "it is not a JSON object"],
            ["null", "it is not a JSON object"],
        ] as const) {
            const { io, out } = text(written);
            expect(await runCli(["review", "--work", work], io)).toBe(0);
            expect(out.join("")).toContain(
                `that edit is not a question: ${why}; the question is unchanged`,
            );
        }
    });

    it("says when the editor fails", async () => {
        const { io, out } = fakeIo({
            answers: ["e", "q"],
            onEdit: () => {
                throw new Error("editor exited 1");
            },
        });
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        expect(out.join("")).toContain(
            "that edit is not a question: the editor failed: editor exited 1;",
        );
    });

    it("refuses an edit that gives a question another's text and evidence", async () => {
        await refused((question) => {
            question.question = "Where is my allotment?";
        }, "another question has that text and evidence");
    });

    it("refuses an edit that sets the status, since only a decision does", async () => {
        await refused((question) => {
            question.status = "accepted";
        }, "the status changes by accepting or rejecting, not by editing");
    });

    it("shows a question again after an edit, as edited or as it was", async () => {
        const { io, out } = fakeIo({
            answers: ["e", "q"],
            onEdit: (path) => {
                const question = JSON.parse(readFileSync(path, "utf8"));
                question.question = "What number is my allotment plot?";
                writeFileSync(path, JSON.stringify(question));
            },
        });
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        const shown = out.join("");
        expect(shown.match(/Draft 1 of 3/g)).toHaveLength(2);
        expect(shown.split("Draft 1 of 3")[1]).toContain(
            "Q: Which plot is my allotment?",
        );
        expect(shown.split("Draft 1 of 3")[2]).toContain(
            "Q: What number is my allotment plot?",
        );
        expect(shown).toContain("edited 1");
    });

    it("tallies an edit once, and not as a decision", async () => {
        const { io, out } = fakeIo({
            answers: ["e", "q"],
            onEdit: (path) => {
                const question = JSON.parse(readFileSync(path, "utf8"));
                question.answer = "Plot twelve.";
                writeFileSync(path, JSON.stringify(question));
            },
        });
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        expect(out.join("")).toEndWith(
            "accepted 0, rejected 0, edited 1; 3 drafts left\n",
        );
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

    it("waits for another writer, and keeps what it wrote", async () => {
        const { io } = fakeIo({ answers: ["a", "q"] });
        const extra = extraQuestion("Which river runs by my allotment?");
        await whileLocked(work, extra, () =>
            runCli(["review", "--work", work], io),
        );
        const { questions } = await readQuestions(work);
        expect(questions.map((question) => question.status)).toEqual([
            "accepted",
            "draft",
            "draft",
            "draft",
        ]);
        expect(questions.at(-1)?.question).toBe(extra.question);
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
