// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/file.ts
//
//

// <work>/questions.jsonl: one question a line, mined or generated, and
// the owner's decision on it.

import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { UsageError } from "../errors.js";

export const QUESTION_TYPES = [
    "single-session",
    "preference",
    "multi-session",
    "knowledge-update",
    "temporal",
    "abstention",
    "lookup",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

// A real day in YYYY-MM-DD: 2026-02-30 has the form and is no date.
function isDate(text: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return false;
    }
    const date = new Date(`${text}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
}

export const questionSchema = z
    .object({
        id: z.string().regex(/^q-[0-9a-f]{8}$/),
        type: z.enum(QUESTION_TYPES),
        question: z.string().trim().min(1).max(2000),
        answer: z.string().trim().min(1).max(4000).nullable(),
        evidence: z.array(z.string().regex(/^[kc]:\S+$/)).max(10),
        exclude: z.string().min(1).nullable(),
        asOf: z.string().refine(isDate, "not a real date, as YYYY-MM-DD"),
        project: z.string().min(1).nullable(),
        source: z.string().regex(/^(mined|generated:\S+)$/),
        status: z.enum(["draft", "accepted", "rejected"]),
        note: z.string().max(2000).nullable(),
    })
    .strict()
    .superRefine((question, context) => {
        const problem =
            question.type === "lookup"
                ? question.answer !== null
                    ? "a lookup has no answer"
                    : question.evidence.length === 0
                      ? "a lookup needs evidence"
                      : null
                : question.answer === null
                  ? "only a lookup goes without an answer"
                  : question.type === "abstention"
                    ? question.evidence.length > 0
                        ? "an abstention has no evidence"
                        : null
                    : question.evidence.length === 0
                      ? `a ${question.type} question needs evidence`
                      : null;
        if (problem !== null) {
            context.addIssue({ code: "custom", message: problem });
        }
    });
export type Question = z.infer<typeof questionSchema>;

export function questionId(
    question: string,
    evidence: readonly string[],
): string {
    const digest = createHash("sha256")
        .update(`${question}\n${[...evidence].sort().join("\n")}`)
        .digest("hex");
    return `q-${digest.slice(0, 8)}`;
}

export const questionsPath = (work: string) => join(work, "questions.jsonl");

// A schema failure in a line: the first issue, with the field it is in.
export function issueOf(error: z.ZodError): string {
    const issue = error.issues[0];
    if (issue === undefined) {
        return "not a question";
    }
    return issue.path.length === 0
        ? issue.message
        : `${issue.path.join(".")}: ${issue.message}`;
}

const problemOf = (error: unknown) =>
    error instanceof z.ZodError ? issueOf(error) : "not JSON";

// Whether two questions are the same one: ids are 32 bits of a hash, so
// the same id may come of different text.
export const sameQuestion = (
    a: Pick<Question, "question" | "evidence">,
    b: Pick<Question, "question" | "evidence">,
) =>
    a.question === b.question &&
    [...a.evidence].sort().join("\n") === [...b.evidence].sort().join("\n");

export async function readQuestions(
    work: string,
): Promise<{ questions: Question[]; problems: string[] }> {
    let text: string;
    try {
        text = await readFile(questionsPath(work), "utf8");
    } catch (error) {
        // Only a missing file is empty; any other failure must not look
        // like one, or a rewrite would overwrite what it could not read.
        const code = (error as { code?: unknown } | null)?.code;
        if (code === "ENOENT") {
            return { questions: [], problems: [] };
        }
        if (typeof code === "string") {
            throw new UsageError(
                `cannot read ${questionsPath(work)}: ${code}; mend it, or remove it to start again`,
            );
        }
        throw error;
    }
    const questions: Question[] = [];
    const problems: string[] = [];
    const lines = new Map<string, number>();
    const byId = new Map<string, Question>();
    for (const [at, line] of text.split("\n").entries()) {
        if (line.trim() === "") {
            continue;
        }
        const problem = (why: string) =>
            problems.push(`questions.jsonl:${at + 1}: ${why}`);
        let question: Question;
        try {
            question = questionSchema.parse(JSON.parse(line));
        } catch (error) {
            problem(problemOf(error));
            continue;
        }
        if (question.id !== questionId(question.question, question.evidence)) {
            problem(`${question.id} is not the id of its text and evidence`);
            continue;
        }
        const held = byId.get(question.id);
        if (held !== undefined) {
            const where = lines.get(question.id);
            problem(
                sameQuestion(held, question)
                    ? `${question.id} repeats line ${where}`
                    : `${question.id} is also the id of a different question on line ${where}`,
            );
            continue;
        }
        byId.set(question.id, question);
        lines.set(question.id, at + 1);
        questions.push(question);
    }
    return { questions, problems };
}

// For the commands that write the file back: a malformed line would be
// lost, so they stop until it is mended.
export async function readQuestionsToRewrite(
    work: string,
): Promise<Question[]> {
    const { questions, problems } = await readQuestions(work);
    if (problems.length > 0) {
        throw new UsageError(
            `${problems.join("\n")}\nmend or remove these lines first`,
        );
    }
    return questions;
}

export async function writeQuestions(
    work: string,
    questions: Question[],
): Promise<void> {
    const path = questionsPath(work);
    const temporary = `${path}.${process.pid}.tmp`;
    try {
        await writeFile(
            temporary,
            questions
                .map((question) => `${JSON.stringify(question)}\n`)
                .join(""),
            { mode: 0o600 },
        );
        await rename(temporary, path);
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}

// The incoming questions whose ids are new join the existing; one whose
// id is held by a different question is counted as collided, not added.
export function mergeQuestions(
    existing: Question[],
    incoming: Question[],
): { questions: Question[]; added: number; collided: number } {
    const held = new Map(existing.map((question) => [question.id, question]));
    const questions = [...existing];
    let collided = 0;
    for (const question of incoming) {
        const same = held.get(question.id);
        if (same === undefined) {
            held.set(question.id, question);
            questions.push(question);
        } else if (!sameQuestion(same, question)) {
            collided++;
        }
    }
    return { questions, added: questions.length - existing.length, collided };
}
