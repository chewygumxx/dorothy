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
import { readFile, rename, writeFile } from "node:fs/promises";
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

export const questionSchema = z
    .object({
        id: z.string().regex(/^q-[0-9a-f]{8}$/),
        type: z.enum(QUESTION_TYPES),
        question: z.string().trim().min(1).max(2000),
        answer: z.string().trim().min(1).max(4000).nullable(),
        evidence: z.array(z.string().regex(/^[kc]:\S+$/)).max(10),
        exclude: z.string().min(1).nullable(),
        asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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

const problemOf = (error: unknown) =>
    error instanceof z.ZodError
        ? (error.issues[0]?.message ?? "not a question")
        : "not JSON";

export async function readQuestions(
    work: string,
): Promise<{ questions: Question[]; problems: string[] }> {
    let text: string;
    try {
        text = await readFile(questionsPath(work), "utf8");
    } catch (error) {
        // Only a missing file is empty; any other failure must not look
        // like one, or a rewrite would overwrite what it could not read.
        if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
        ) {
            return { questions: [], problems: [] };
        }
        throw error;
    }
    const questions: Question[] = [];
    const problems: string[] = [];
    for (const [at, line] of text.split("\n").entries()) {
        if (line.trim() === "") {
            continue;
        }
        try {
            questions.push(questionSchema.parse(JSON.parse(line)));
        } catch (error) {
            problems.push(`questions.jsonl:${at + 1}: ${problemOf(error)}`);
        }
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
            `${problems.join("; ")}: mend or remove these lines first`,
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
    await writeFile(
        temporary,
        questions.map((question) => `${JSON.stringify(question)}\n`).join(""),
        { mode: 0o600 },
    );
    await rename(temporary, path);
}

export function mergeQuestions(
    existing: Question[],
    incoming: Question[],
): { questions: Question[]; added: number } {
    const ids = new Set(existing.map((question) => question.id));
    const questions = [...existing];
    for (const question of incoming) {
        if (!ids.has(question.id)) {
            ids.add(question.id);
            questions.push(question);
        }
    }
    return { questions, added: questions.length - existing.length };
}
