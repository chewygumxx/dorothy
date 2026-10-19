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
    type Question,
    questionId,
    questionSchema,
    readQuestionsToRewrite,
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

// The question as the owner left it in the editor, or why it is not one.
async function edited(
    work: string,
    question: Question,
    io: Io,
    others: Set<string>,
    corpus: Corpus,
): Promise<Question | string> {
    const path = join(work, "editing.json");
    await writeFile(path, `${JSON.stringify(question, null, 4)}\n`, {
        mode: 0o600,
    });
    try {
        await io.edit(path);
        const read = JSON.parse(await readFile(path, "utf8"));
        const parsed = questionSchema.safeParse({
            ...read,
            id: questionId(String(read.question ?? ""), read.evidence ?? []),
        });
        if (!parsed.success) {
            return parsed.error.issues[0]?.message ?? "not a question";
        }
        const unknown = parsed.data.evidence.find(
            (id) => !corpus.conversations.has(id) && !corpus.knowledge.has(id),
        );
        if (unknown !== undefined) {
            return `${unknown} is not in the snapshot`;
        }
        if (others.has(parsed.data.id)) {
            return "another question has that text and evidence";
        }
        return parsed.data;
    } catch {
        return "it is not JSON";
    } finally {
        await rm(path, { force: true });
    }
}

// The decided question in the file as it is now, in place of the one
// with the id it had, or at the end if that one has gone.
async function decide(
    work: string,
    id: string,
    decided: Question,
): Promise<void> {
    const questions = await readQuestionsToRewrite(work);
    const at = questions.findIndex((question) => question.id === id);
    if (at === -1) {
        questions.push(decided);
    } else {
        questions[at] = decided;
    }
    await writeQuestions(work, questions);
}

export async function reviewQuestions(
    work: string,
    io: Io,
    corpus: Corpus,
): Promise<Tally> {
    const questions = await readQuestionsToRewrite(work);
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
                const others = new Set(
                    (await readQuestionsToRewrite(work))
                        .map((q) => q.id)
                        .filter((id) => id !== question.id),
                );
                const result = await edited(work, question, io, others, corpus);
                if (typeof result === "string") {
                    io.out(
                        `eval: that edit is not a question: ${result}; the question is unchanged\n`,
                    );
                } else {
                    questions[at] = result;
                    tally.edited++;
                    await decide(work, question.id, result);
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
    options: { work: { type: "string" } },
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
            const tally = await reviewQuestions(work, io, corpus);
            io.out(
                `accepted ${tally.accepted}, rejected ${tally.rejected}, edited ${tally.edited}; ${tally.left} drafts left\n`,
            );
            return 0;
        } finally {
            corpus.close();
        }
    },
};
