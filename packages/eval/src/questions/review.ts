// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/review.ts
//
//

// The owner's pass over the drafts, one at a time: each decision is
// written at once, so quitting, or the end of input, loses nothing, and
// into the file as it is then, so a generate or mine meanwhile loses
// nothing either.

import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Command, type Io, workOf } from "../command.js";
import { readSnapshot, workEnv } from "../snapshot/snapshot.js";
import {
    type Corpus,
    knowledgeText,
    openCorpus,
    passage,
} from "../systems/corpus.js";
import { termsOf } from "../systems/terms.js";
import {
    issueOf,
    type Question,
    questionId,
    questionSchema,
    readQuestionsToRewrite,
    sameQuestion,
    writeQuestions,
} from "./file.js";

export type Tally = {
    accepted: number;
    rejected: number;
    edited: number;
    left: number;
};

const PROMPT = "[a]ccept, [e]dit, [r]eject, [s]kip, [q]uit: ";
const indent = (text: string) =>
    text
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");

// Each piece of evidence by its title, with the passage that holds the
// answer.
export function describeEvidence(question: Question, corpus: Corpus): string {
    const terms = termsOf(`${question.question} ${question.answer ?? ""}`);
    return question.evidence
        .map((id) => {
            const conversation = corpus.conversations.get(id);
            if (conversation !== undefined) {
                return `  ${id}: ${conversation.title ?? "Untitled"}\n${indent(passage(conversation, terms, 1500))}`;
            }
            const knowledge = corpus.knowledge.get(id);
            return knowledge === undefined
                ? `  ${id}: not in the snapshot`
                : `  ${id}: ${knowledge.title}\n${indent(knowledgeText(knowledge))}`;
        })
        .join("\n");
}

function shown(question: Question, at: number, of: number, corpus: Corpus) {
    return [
        "",
        `Draft ${at} of ${of}, ${question.type} (${question.source}), asked ${question.asOf}`,
        `Q: ${question.question}`,
        `A: ${question.answer ?? "(none)"}`,
        ...(question.note === null ? [] : [`Note: ${question.note}`]),
        "Evidence:",
        describeEvidence(question, corpus),
        "",
    ].join("\n");
}

const causeOf = (error: unknown) =>
    (error as { code?: unknown } | null)?.code ??
    (error instanceof Error ? error.message : String(error));

// The question as the owner left it in the editor, or why it is not one.
async function edited(
    work: string,
    question: Question,
    io: Io,
    corpus: Corpus,
): Promise<Question | string> {
    const path = join(work, "editing.json");
    await writeFile(path, `${JSON.stringify(question, null, 4)}\n`, {
        mode: 0o600,
    });
    try {
        try {
            await io.edit(path);
        } catch (error) {
            return `the editor failed: ${causeOf(error)}`;
        }
        let text: string;
        try {
            text = await readFile(path, "utf8");
        } catch (error) {
            return `it cannot be read back: ${causeOf(error)}`;
        }
        let read: unknown;
        try {
            read = JSON.parse(text);
        } catch {
            return "it is not JSON";
        }
        if (typeof read !== "object" || read === null || Array.isArray(read)) {
            return "it is not a JSON object";
        }
        // The id is of the text and evidence, whatever the editor holds.
        const parsed = questionSchema.safeParse({ ...read, id: question.id });
        if (!parsed.success) {
            return issueOf(parsed.error);
        }
        if (parsed.data.status !== question.status) {
            return "the status changes by accepting or rejecting, not by editing";
        }
        const unknown = parsed.data.evidence.find(
            (id) => !corpus.conversations.has(id) && !corpus.knowledge.has(id),
        );
        if (unknown !== undefined) {
            return `${unknown} is not in the snapshot`;
        }
        return {
            ...parsed.data,
            id: questionId(parsed.data.question, parsed.data.evidence),
        };
    } finally {
        await rm(path, { force: true });
    }
}

// The decided question in the file as it is now, in place of the one
// with the id it had, or at the end if that one has gone; or why it
// cannot be there, when its new id is another question's.
async function decide(
    work: string,
    id: string,
    decided: Question,
): Promise<string | null> {
    const questions = await readQuestionsToRewrite(work);
    const taken =
        decided.id === id
            ? undefined
            : questions.find((question) => question.id === decided.id);
    if (taken !== undefined) {
        return sameQuestion(taken, decided)
            ? "another question has that text and evidence"
            : "its id is another question's: reword it";
    }
    const at = questions.findIndex((question) => question.id === id);
    if (at === -1) {
        questions.push(decided);
    } else {
        questions[at] = decided;
    }
    await writeQuestions(work, questions);
    return null;
}

// The drafts of the questions the command has read; each decision is
// then written into the file as it is at that moment.
export async function reviewQuestions(
    questions: Question[],
    work: string,
    io: Io,
    corpus: Corpus,
): Promise<Tally> {
    const drafts = questions
        .map((question, at) => ({ question, at }))
        .filter(({ question }) => question.status === "draft")
        .map(({ at }) => at);
    const tally: Tally = { accepted: 0, rejected: 0, edited: 0, left: 0 };
    const finish = async () => {
        tally.left = (await readQuestionsToRewrite(work)).filter(
            (q) => q.status === "draft",
        ).length;
        return tally;
    };
    for (const [count, at] of drafts.entries()) {
        for (;;) {
            const question = questions[at] as Question;
            io.out(shown(question, count + 1, drafts.length, corpus));
            const choice = (await io.ask(PROMPT))?.trim().toLowerCase() ?? "q";
            if (choice === "q") {
                return await finish();
            }
            if (choice === "s") {
                break;
            }
            if (choice === "a") {
                const accepted: Question = { ...question, status: "accepted" };
                questions[at] = accepted;
                tally.accepted++;
                await decide(work, question.id, accepted);
                break;
            }
            if (choice === "r") {
                const why = ((await io.ask("Why? ")) ?? "").trim();
                const rejected: Question = {
                    ...question,
                    status: "rejected",
                    note: why === "" ? question.note : why.slice(0, 2000),
                };
                questions[at] = rejected;
                tally.rejected++;
                await decide(work, question.id, rejected);
                break;
            }
            if (choice === "e") {
                const result = await edited(work, question, io, corpus);
                // The edit, or why it is refused.
                const outcome =
                    typeof result === "string"
                        ? result
                        : ((await decide(work, question.id, result)) ?? result);
                if (typeof outcome === "string") {
                    io.out(
                        `eval: that edit is not a question: ${outcome}; the question is unchanged\n`,
                    );
                } else {
                    questions[at] = outcome;
                    tally.edited++;
                }
                continue;
            }
            io.out("Type a, e, r, s or q.\n");
        }
    }
    return await finish();
}

export const reviewCommand: Command = {
    summary: "accept, edit or reject the drafts, one at a time",
    options: {
        work: { type: "string", description: "the evaluation's directory" },
    },
    async run(values, _positionals, io) {
        const work = workOf(values);
        await readSnapshot(work);
        const questions = await readQuestionsToRewrite(work);
        if (!questions.some((question) => question.status === "draft")) {
            io.out("no drafts to review\n");
            return 0;
        }
        const corpus = await openCorpus(workEnv(work));
        try {
            const tally = await reviewQuestions(questions, work, io, corpus);
            io.out(
                `accepted ${tally.accepted}, rejected ${tally.rejected}, edited ${tally.edited}; ${tally.left} drafts left\n`,
            );
            return 0;
        } finally {
            corpus.close();
        }
    },
};
