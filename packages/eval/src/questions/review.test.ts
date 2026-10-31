// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/review.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

const reviewsOf = () =>
    readFileSync(join(work, "reviews.jsonl"), "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line));

describe("bun run eval -- review, logging its decisions", () => {
    it("logs the owner's accepts and rejects, and not a skip", async () => {
        const { io } = fakeIo({
            answers: ["a", "r", "too close", "s", "q"],
        });
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        const [accepted, rejected, ...rest] = reviewsOf();
        expect(rest).toEqual([]);
        expect(accepted).toMatchObject({
            id: questionId("Which plot is my allotment?", [`c:${GARDEN}`]),
            reviewer: "owner",
            decision: "accept",
            reason: "",
        });
        expect(rejected).toMatchObject({
            id: questionId("Where is my allotment?", [`c:${GARDEN}`]),
            reviewer: "owner",
            decision: "reject",
            reason: "too close",
        });
        expect(new Date(accepted.at).toISOString()).toBe(accepted.at);
    });

    it("logs the owner's edit under its old id and its new", async () => {
        const old = questionId("Which plot is my allotment?", [`c:${GARDEN}`]);
        const { io } = fakeIo({
            answers: ["e", "q"],
            onEdit: (path) => {
                const question = JSON.parse(readFileSync(path, "utf8"));
                question.question = "What number is my allotment plot?";
                writeFileSync(path, JSON.stringify(question));
            },
        });
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        const [edit, ...rest] = reviewsOf();
        expect(rest).toEqual([]);
        expect(edit).toMatchObject({
            id: old,
            newId: questionId("What number is my allotment plot?", [
                `c:${GARDEN}`,
            ]),
            reviewer: "owner",
            decision: "edit",
            reason: "",
        });
    });

    it("logs nothing for an edit the owner is refused", async () => {
        const { io } = fakeIo({
            answers: ["e", "q"],
            onEdit: (path) => writeFileSync(path, "{not json"),
        });
        expect(await runCli(["review", "--work", work], io)).toBe(0);
        expect(existsSync(join(work, "reviews.jsonl"))).toBe(false);
    });
});

describe("bun run eval -- review --evidence", () => {
    let longTemp: ReturnType<typeof tempRoot>;
    let longWork: string;
    const turns = Array.from({ length: 80 }, (_, at) => ({
        role: (at % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        text: `Turn ${at}: my allotment plot is by the river, and ${"x".repeat(80)}`,
        at: `2026-09-05T10:${String(at % 60).padStart(2, "0")}:00.000Z`,
    }));

    beforeEach(async () => {
        longTemp = tempRoot("review-long");
        longWork = await snapshotFixture(longTemp.root, {
            conversations: [{ phrase: GARDEN, title: "The allotment", turns }],
            knowledge: [],
        });
        await writeQuestions(longWork, [
            drafted("Which plot is my allotment?"),
        ]);
    });
    afterEach(() => longTemp.remove());

    // The length of the passage shown for the one cited conversation.
    const shownLength = async (...options: string[]) => {
        const { io, out } = fakeIo({ answers: ["q"] });
        expect(
            await runCli(["review", "--work", longWork, ...options], io),
        ).toBe(0);
        const shown = out.join("");
        const from = shown.indexOf(`c:${GARDEN}: The allotment`);
        return shown.slice(from, shown.indexOf("\n[a]ccept")).length;
    };

    it("shows 6,000 characters of a conversation by default", async () => {
        const length = await shownLength();
        expect(length).toBeGreaterThan(3000);
        expect(length).toBeLessThan(6500);
    });

    it("shows as many as it is asked", async () => {
        expect(await shownLength("--evidence", "500")).toBeLessThan(900);
        expect(await shownLength("--evidence", "12000")).toBeGreaterThan(
            await shownLength(),
        );
    });

    it("wants a positive whole number", async () => {
        for (const bad of ["0", "-5", "1.5", "lots"]) {
            const { io, err } = fakeIo();
            expect(
                await runCli(
                    ["review", "--work", longWork, `--evidence=${bad}`],
                    io,
                ),
            ).toBe(1);
            expect(err.join("")).toContain("--evidence must be a whole number");
        }
    });
});

describe("bun run eval -- review --apply", () => {
    let more: Question;
    beforeEach(async () => {
        more = drafted("Which allotment plot is by the river?");
        await writeQuestions(work, [
            drafted("Which plot is my allotment?"),
            drafted("Where is my allotment?"),
            drafted("By what is my allotment?"),
            more,
        ]);
    });

    const idOf = (question: string) => questionId(question, [`c:${GARDEN}`]);

    const apply = async (lines: (object | string)[], ...options: string[]) => {
        const file = join(temp.root, "decisions.jsonl");
        writeFileSync(
            file,
            `${lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n")}\n`,
        );
        const { io, out, err } = fakeIo();
        const code = await runCli(
            [
                "review",
                "--work",
                work,
                "--apply",
                file,
                "--reviewer",
                "agent-1",
                ...options,
            ],
            io,
        );
        return { code, out: out.join(""), err: err.join("") };
    };

    it("applies accept, reject, edit and unsure, and logs who", async () => {
        const first = idOf("Which plot is my allotment?");
        const second = idOf("Where is my allotment?");
        const third = idOf("By what is my allotment?");
        const { code, out, err } = await apply([
            { id: first, decision: "accept", reason: "clear" },
            { id: second, decision: "reject", reason: "close to the first" },
            {
                id: third,
                decision: "edit",
                reason: "reworded",
                question: "What number is my allotment plot?",
                answer: "Plot twelve.",
            },
            { id: more.id, decision: "unsure", reason: "river unclear" },
        ]);
        expect(err).toBe("");
        expect(code).toBe(0);
        expect(out).toBe("accepted 1, rejected 1, edited 1, unsure 1\n");
        const { questions } = await readQuestions(work);
        expect(questions.map((question) => question.status)).toEqual([
            "accepted",
            "rejected",
            "accepted",
            "draft",
        ]);
        expect(questions[1]?.note).toBe("close to the first");
        expect(questions[2]).toMatchObject({
            id: idOf("What number is my allotment plot?"),
            question: "What number is my allotment plot?",
            answer: "Plot twelve.",
            evidence: [`c:${GARDEN}`],
        });
        const log = reviewsOf();
        expect(log.map((entry) => entry.decision)).toEqual([
            "accept",
            "reject",
            "edit",
            "unsure",
        ]);
        expect(log[0]).toMatchObject({
            id: first,
            reviewer: "agent-1",
            reason: "clear",
        });
        expect(log[0]).not.toHaveProperty("newId");
        expect(log[2]).toMatchObject({
            id: third,
            newId: idOf("What number is my allotment plot?"),
            reason: "reworded",
        });
        expect(log[3]).toMatchObject({ id: more.id, reviewer: "agent-1" });
        expect(new Date(log[3].at).toISOString()).toBe(log[3].at);
    });

    it("keeps a reject's note when it gives no reason", async () => {
        await writeQuestions(work, [
            { ...drafted("Which plot is my allotment?"), note: "older claim" },
        ]);
        const { code } = await apply([
            { id: idOf("Which plot is my allotment?"), decision: "reject" },
        ]);
        expect(code).toBe(0);
        expect((await readQuestions(work)).questions[0]).toMatchObject({
            status: "rejected",
            note: "older claim",
        });
    });

    it("edits only what the line gives", async () => {
        const id = idOf("Which plot is my allotment?");
        await apply([{ id, decision: "edit", answer: "Number twelve." }]);
        expect((await readQuestions(work)).questions[0]).toMatchObject({
            id,
            question: "Which plot is my allotment?",
            answer: "Number twelve.",
            status: "accepted",
        });
        expect(reviewsOf()[0]).not.toHaveProperty("newId");
    });

    it("refuses an edit review's editor would, and says why", async () => {
        const before = readFileSync(questionsPath(work), "utf8");
        const one = idOf("Which plot is my allotment?");
        const two = idOf("Where is my allotment?");
        const three = idOf("By what is my allotment?");
        const { code, out, err } = await apply([
            { id: one, decision: "edit", evidence: ["c:nowhere"] },
            { id: two, decision: "edit", question: "By what is my allotment?" },
            { id: three, decision: "edit", question: "  " },
        ]);
        expect(code).toBe(1);
        expect(out).toBe("accepted 0, rejected 0, edited 0, unsure 0\n");
        const lines = err.trimEnd().split("\n");
        expect(lines[0]).toBe(`${one}: c:nowhere is not in the snapshot`);
        expect(lines[1]).toBe(
            `${two}: another question has that text and evidence`,
        );
        expect(lines[2]).toStartWith(`${three}: question: `);
        expect(lines).toHaveLength(3);
        expect(readFileSync(questionsPath(work), "utf8")).toBe(before);
        expect(existsSync(join(work, "reviews.jsonl"))).toBe(false);
    });

    it("refuses an edit whose id is another question's text", async () => {
        const two = idOf("Where is my allotment?");
        const { err } = await apply([
            { id: two, decision: "edit", question: "By what is my allotment?" },
        ]);
        expect(err).toContain("another question has that text and evidence");
    });

    it("reports a key it does not know, and applies nothing of that line", async () => {
        const first = idOf("Which plot is my allotment?");
        const two = idOf("Where is my allotment?");
        const three = idOf("By what is my allotment?");
        const { code, out, err } = await apply([
            { id: first, decision: "edit", anwser: "Number twelve." },
            { id: two, decision: "reject", why: "too close" },
            { id: three, decision: "accept", confidence: 0.9 },
        ]);
        expect(code).toBe(1);
        expect(out).toBe("accepted 0, rejected 0, edited 0, unsure 0\n");
        const lines = err.trimEnd().split("\n");
        expect(lines[0]).toStartWith(`${first}: `);
        expect(lines[0]).toContain("anwser");
        expect(lines[1]).toStartWith(`${two}: `);
        expect(lines[1]).toContain("why");
        expect(lines[2]).toContain("confidence");
        expect(lines).toHaveLength(3);
        expect(await statuses()).toEqual(["draft", "draft", "draft", "draft"]);
        expect(existsSync(join(work, "reviews.jsonl"))).toBe(false);
    });

    it("refuses an edit that names no question, answer or evidence", async () => {
        const id = idOf("Which plot is my allotment?");
        const { code, err } = await apply([
            { id, decision: "edit" },
            { id, decision: "edit", reason: "wrong plot" },
            { id, decision: "edit", edit: { answer: "Number twelve." } },
        ]);
        expect(code).toBe(1);
        const lines = err.trimEnd().split("\n");
        expect(lines[0]).toBe(
            `${id}: an edit gives a question, answer or evidence`,
        );
        expect(lines[1]).toBe(lines[0]);
        expect(lines[2]).toStartWith(`${id}: `);
        expect(lines[2]).toContain("edit");
        expect(lines).toHaveLength(3);
        expect((await statuses())[0]).toBe("draft");
    });

    it("refuses an edit that changes nothing", async () => {
        const id = idOf("Which plot is my allotment?");
        const { code, out, err } = await apply([
            {
                id,
                decision: "edit",
                question: "Which plot is my allotment?",
                evidence: [`c:${GARDEN}`],
            },
        ]);
        expect(code).toBe(1);
        expect(out).toBe("accepted 0, rejected 0, edited 0, unsure 0\n");
        expect(err).toBe(`${id}: the edit changes nothing\n`);
        expect((await statuses())[0]).toBe("draft");
        expect(existsSync(join(work, "reviews.jsonl"))).toBe(false);
    });

    it("reports these on a dry run too", async () => {
        const id = idOf("Which plot is my allotment?");
        const before = readFileSync(questionsPath(work), "utf8");
        const { code, out, err } = await apply(
            [
                { id, decision: "edit", anwser: "x" },
                { id, decision: "edit" },
                {
                    id,
                    decision: "edit",
                    question: "Which plot is my allotment?",
                },
            ],
            "--dry-run",
        );
        expect(code).toBe(1);
        expect(out).toBe(
            "dry run, nothing written: accepted 0, rejected 0, edited 0, unsure 0\n",
        );
        expect(err.trimEnd().split("\n")).toHaveLength(3);
        expect(readFileSync(questionsPath(work), "utf8")).toBe(before);
    });

    it("reports a line naming no draft, or a decided one, and goes on", async () => {
        const first = idOf("Which plot is my allotment?");
        const { code, out, err } = await apply([
            { id: "q-00000000", decision: "accept" },
            { id: first, decision: "accept" },
            { id: first, decision: "reject", reason: "again" },
        ]);
        expect(code).toBe(1);
        expect(out).toBe("accepted 1, rejected 0, edited 0, unsure 0\n");
        expect(err).toBe(
            `q-00000000: no such question\n${first}: already accepted\n`,
        );
        expect(reviewsOf()).toHaveLength(1);
        const again = await apply([{ id: first, decision: "accept" }]);
        expect(again.err).toBe(`${first}: already accepted\n`);
        expect(again.code).toBe(1);
    });

    it("reports a line it cannot read, by its number", async () => {
        const first = idOf("Which plot is my allotment?");
        const { code, err } = await apply([
            { id: first, decision: "accept" },
            "{not json",
            "",
            { id: first, decision: "approve" },
            { decision: "accept" },
            { id: more.id, decision: "accept", answer: "Plot twelve." },
        ]);
        expect(code).toBe(1);
        const lines = err.trimEnd().split("\n");
        expect(lines[0]).toBe("line 2: not JSON");
        expect(lines[1]).toStartWith(`${first}: decision: `);
        expect(lines[2]).toStartWith("line 5: id: ");
        expect(lines[3]).toBe(
            `${more.id}: only an edit gives a question, answer or evidence`,
        );
        expect(lines).toHaveLength(4);
        expect(await statuses()).toEqual([
            "accepted",
            "draft",
            "draft",
            "draft",
        ]);
    });

    it("writes nothing on a dry run, but checks the lines against each other", async () => {
        const before = readFileSync(questionsPath(work), "utf8");
        const one = idOf("Which plot is my allotment?");
        const two = idOf("Where is my allotment?");
        const { code, out, err } = await apply(
            [
                {
                    id: one,
                    decision: "edit",
                    question: "What number is my allotment plot?",
                },
                {
                    id: two,
                    decision: "edit",
                    question: "What number is my allotment plot?",
                },
                { id: more.id, decision: "unsure" },
            ],
            "--dry-run",
        );
        expect(code).toBe(1);
        expect(out).toBe(
            "dry run, nothing written: accepted 0, rejected 0, edited 1, unsure 1\n",
        );
        expect(err).toBe(
            `${two}: another question has that text and evidence\n`,
        );
        expect(readFileSync(questionsPath(work), "utf8")).toBe(before);
        expect(existsSync(join(work, "reviews.jsonl"))).toBe(false);
    });

    it("exits 0 when every line applied", async () => {
        const { code, err } = await apply(
            [{ id: more.id, decision: "unsure" }],
            "--dry-run",
        );
        expect(code).toBe(0);
        expect(err).toBe("");
    });

    it("keeps a question the file gained while it ran, and the lock", async () => {
        const extra = extraQuestion("Which river runs by my allotment?");
        const first = idOf("Which plot is my allotment?");
        await whileLocked(work, extra, () =>
            apply([{ id: first, decision: "accept" }]),
        );
        const { questions } = await readQuestions(work);
        expect(questions.at(-1)?.question).toBe(extra.question);
        expect(questions[0]?.status).toBe("accepted");
    });

    it("needs a reviewer, and the options only together", async () => {
        const file = join(temp.root, "decisions.jsonl");
        writeFileSync(file, "");
        for (const [args, why] of [
            [["--apply", file], "--apply needs --reviewer"],
            [["--reviewer", "agent-1"], "--reviewer goes with --apply"],
            [["--dry-run"], "--dry-run goes with --apply"],
            [
                ["--apply", file, "--reviewer", "a", "--evidence", "9"],
                "--evidence is for reviewing in the terminal",
            ],
        ] as const) {
            const { io, err } = fakeIo();
            expect(await runCli(["review", "--work", work, ...args], io)).toBe(
                1,
            );
            expect(err.join("")).toContain(why);
        }
    });

    it("says when the decisions file cannot be read", async () => {
        const { io, err } = fakeIo();
        const missing = join(temp.root, "none.jsonl");
        expect(
            await runCli(
                [
                    "review",
                    "--work",
                    work,
                    "--apply",
                    missing,
                    "--reviewer",
                    "agent-1",
                ],
                io,
            ),
        ).toBe(1);
        expect(err.join("")).toContain(`cannot read ${missing}: ENOENT`);
    });

    it("never opens the editor or asks a question", async () => {
        const { io } = fakeIo();
        io.ask = async () => {
            throw new Error("asked");
        };
        io.edit = async () => {
            throw new Error("edited");
        };
        const file = join(temp.root, "decisions.jsonl");
        writeFileSync(
            file,
            `${JSON.stringify({ id: more.id, decision: "accept" })}\n`,
        );
        expect(
            await runCli(
                ["review", "--work", work, "--apply", file, "--reviewer", "a"],
                io,
            ),
        ).toBe(0);
    });
});

describe("bun run eval -- review --reopen", () => {
    const first = questionId("Which plot is my allotment?", [`c:${GARDEN}`]);
    const second = questionId("Where is my allotment?", [`c:${GARDEN}`]);
    const reopen = async (...args: string[]) => {
        const { io, out, err } = fakeIo();
        const code = await runCli(["review", "--work", work, ...args], io);
        return { code, out: out.join(""), err: err.join("") };
    };

    beforeEach(async () => {
        const [one, two, three] = (await readQuestions(work)).questions;
        await writeQuestions(work, [
            { ...(one as Question), status: "accepted", note: "kept" },
            two as Question,
            three as Question,
        ]);
    });

    it("makes an accepted question a draft, and logs why", async () => {
        const { code, out } = await reopen(
            "--reopen",
            first,
            "--reason",
            "the answer is stale",
        );
        expect(code).toBe(0);
        expect(out).toContain(first);
        const { questions } = await readQuestions(work);
        expect(questions.map((question) => question.status)).toEqual([
            "draft",
            "draft",
            "draft",
        ]);
        expect(questions[0]?.note).toBe("kept");
        const [entry, ...rest] = reviewsOf();
        expect(rest).toEqual([]);
        expect(entry).toMatchObject({
            id: first,
            decision: "reopen",
            reviewer: "owner",
            reason: "the answer is stale",
        });
        expect(new Date(entry.at).toISOString()).toBe(entry.at);
    });

    it("refuses a draft, or a rejected question, saying its status", async () => {
        const before = readFileSync(questionsPath(work), "utf8");
        const draft = await reopen("--reopen", second, "--reason", "why");
        expect(draft.code).toBe(1);
        expect(draft.err).toContain(`${second} is draft, not accepted`);
        expect(readFileSync(questionsPath(work), "utf8")).toBe(before);
        expect(existsSync(join(work, "reviews.jsonl"))).toBe(false);
        const [one, ...rest] = (await readQuestions(work)).questions;
        await writeQuestions(work, [
            { ...(one as Question), status: "rejected" },
            ...rest,
        ]);
        const rejected = await reopen("--reopen", first, "--reason", "why");
        expect(rejected.code).toBe(1);
        expect(rejected.err).toContain(`${first} is rejected, not accepted`);
    });

    it("says when no question has the id", async () => {
        const { code, err } = await reopen(
            "--reopen",
            "q-00000000",
            "--reason",
            "why",
        );
        expect(code).toBe(1);
        expect(err).toContain("no question q-00000000");
        expect(existsSync(join(work, "reviews.jsonl"))).toBe(false);
    });

    it("needs a reason, and the reason only with it", async () => {
        const missing = await reopen("--reopen", first);
        expect(missing.code).toBe(1);
        expect(missing.err).toContain("--reopen needs --reason");
        const alone = await reopen("--reason", "why");
        expect(alone.code).toBe(1);
        expect(alone.err).toContain("--reason goes with --reopen");
        expect((await readQuestions(work)).questions[0]?.status).toBe(
            "accepted",
        );
    });

    it("never opens the editor or asks a question", async () => {
        const { io } = fakeIo();
        io.ask = async () => {
            throw new Error("asked");
        };
        io.edit = async () => {
            throw new Error("edited");
        };
        expect(
            await runCli(
                ["review", "--work", work, "--reopen", first, "--reason", "x"],
                io,
            ),
        ).toBe(0);
    });
});

describe("bun run eval -- review, its modes apart", () => {
    const clash = async (args: string[], why: string) => {
        const { io, err, out } = fakeIo();
        expect(await runCli(["review", "--work", work, ...args], io)).toBe(1);
        expect(err.join("")).toContain(why);
        expect(out.join("")).toBe("");
        expect(existsSync(join(temp.root, "out"))).toBe(false);
    };
    const file = () => join(temp.root, "decisions.jsonl");

    it("takes one of --render, --spot-check, --reopen and --apply", async () => {
        writeFileSync(file(), "");
        const modes: Record<string, string[]> = {
            apply: ["--apply", file(), "--reviewer", "a"],
            render: ["--render", join(temp.root, "out")],
            "spot-check": ["--spot-check", join(temp.root, "out", "s.md")],
            reopen: ["--reopen", "q-00000000", "--reason", "x"],
        };
        const names = Object.keys(modes);
        for (const [at, a] of names.entries()) {
            for (const b of names.slice(at + 1)) {
                await clash(
                    [...(modes[a] ?? []), ...(modes[b] ?? [])],
                    `--${a} cannot go with --${b}`,
                );
            }
        }
    });

    it("names the options each mode leaves out", async () => {
        const out = join(temp.root, "out");
        await clash(
            ["--render", out, "--reviewer", "a"],
            "--reviewer cannot go with --render",
        );
        await clash(
            ["--render", out, "--dry-run"],
            "--dry-run cannot go with --render",
        );
        await clash(
            ["--render", out, "--per", "3"],
            "--per cannot go with --render",
        );
        await clash(
            ["--spot-check", out, "--evidence", "9"],
            "--evidence cannot go with --spot-check",
        );
        await clash(
            ["--spot-check", out, "--source", "m/1"],
            "--source cannot go with --spot-check",
        );
        await clash(
            ["--spot-check", out, "--batches", "2"],
            "--batches cannot go with --spot-check",
        );
        await clash(
            ["--reopen", "q-00000000", "--reason", "x", "--evidence", "9"],
            "--evidence cannot go with --reopen",
        );
        await clash(
            ["--apply", file(), "--reviewer", "a", "--batches", "2"],
            "--batches cannot go with --apply",
        );
    });

    it("says what an option beside no mode goes with", async () => {
        await clash(["--batches", "2"], "--batches goes with --render");
        await clash(["--source", "m/1"], "--source goes with --render");
        await clash(["--per", "2"], "--per goes with --spot-check");
    });

    it("bounds --batches and --per", async () => {
        const out = join(temp.root, "out");
        await clash(
            ["--render", out, "--batches", "0"],
            "--batches must be a whole number from 1 to 100",
        );
        await clash(
            ["--render", out, "--batches", "101"],
            "--batches must be a whole number from 1 to 100",
        );
        await clash(
            ["--spot-check", out, "--per", "1001"],
            "--per must be a whole number from 1 to 1000",
        );
    });
});

describe("bun run eval -- review --render and --spot-check", () => {
    it("renders the drafts and says how many parts", async () => {
        const dir = join(temp.root, "out", "drafts");
        const { io, out } = fakeIo();
        io.ask = async () => {
            throw new Error("asked");
        };
        expect(
            await runCli(
                ["review", "--work", work, "--render", dir, "--batches", "2"],
                io,
            ),
        ).toBe(0);
        expect(out.join("")).toBe(
            "drafts-1.md: 2 drafts\ndrafts-2.md: 1 draft\n",
        );
        expect(readFileSync(join(dir, "drafts-1.md"), "utf8")).toContain(
            "Draft 1 of 3",
        );
    });

    it("says plainly when there are no drafts, writing nothing", async () => {
        await writeQuestions(work, []);
        const dir = join(temp.root, "out");
        const { io, out } = fakeIo();
        expect(
            await runCli(["review", "--work", work, "--render", dir], io),
        ).toBe(0);
        expect(out.join("")).toBe("no drafts to render\n");
        expect(existsSync(dir)).toBe(false);
    });

    it("says when no draft is of the source", async () => {
        const dir = join(temp.root, "out");
        const { io, out } = fakeIo();
        expect(
            await runCli(
                ["review", "--work", work, "--render", dir, "--source", "x/9"],
                io,
            ),
        ).toBe(0);
        expect(out.join("")).toBe("no drafts from x/9 to render\n");
        expect(existsSync(dir)).toBe(false);
    });

    it("writes a spot-check and says what it holds", async () => {
        const file = join(temp.root, "spot.md");
        const { io, out } = fakeIo();
        expect(
            await runCli(
                ["review", "--work", work, "--spot-check", file, "--per", "2"],
                io,
            ),
        ).toBe(0);
        expect(out.join("")).toBe(`3 unsure, 0 sampled -> ${file}\n`);
        expect(readFileSync(file, "utf8")).toContain("Unsure 3:");
    });
});
