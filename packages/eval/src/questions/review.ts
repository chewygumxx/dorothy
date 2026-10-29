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
// nothing either. An agent's decisions are applied from a file with the
// same checks, and every decision is logged with who made it.

import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type Command, type Io, intOf, stringOf, workOf } from "../command.js";
import { codeOf, UsageError } from "../errors.js";
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
    updateQuestions,
} from "./file.js";

// The characters of each cited conversation that review shows.
const EVIDENCE_CHARS = 6000;

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
export function describeEvidence(
    question: Question,
    corpus: Corpus,
    chars: number,
): string {
    const terms = termsOf(`${question.question} ${question.answer ?? ""}`);
    return question.evidence
        .map((id) => {
            const conversation = corpus.conversations.get(id);
            if (conversation !== undefined) {
                return `  ${id}: ${conversation.title ?? "Untitled"}\n${indent(passage(conversation, terms, chars))}`;
            }
            const knowledge = corpus.knowledge.get(id);
            return knowledge === undefined
                ? `  ${id}: not in the snapshot`
                : `  ${id}: ${knowledge.title}\n${indent(knowledgeText(knowledge))}`;
        })
        .join("\n");
}

function shown(
    question: Question,
    at: number,
    of: number,
    corpus: Corpus,
    chars: number,
) {
    return [
        "",
        `Draft ${at} of ${of}, ${question.type} (${question.source}), asked ${question.asOf}`,
        `Q: ${question.question}`,
        `A: ${question.answer ?? "(none)"}`,
        ...(question.note === null ? [] : [`Note: ${question.note}`]),
        "Evidence:",
        describeEvidence(question, corpus, chars),
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
        return checkedEdit(read, question, corpus);
    } finally {
        await rm(path, { force: true });
    }
}

// What an edit of a question makes of it, or why it is not a question:
// the schema, the status as it was, evidence in the snapshot, and an id
// of the new text and evidence, whatever the edit holds.
function checkedEdit(
    edit: object,
    question: Question,
    corpus: Corpus,
): Question | string {
    const parsed = questionSchema.safeParse({ ...edit, id: question.id });
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
}

// The decided question in the questions in place of the one with the id
// it had, or at the end if that one has gone; or why it cannot be there,
// when its new id is another question's, and then nothing changes.
function place(
    questions: Question[],
    id: string,
    decided: Question,
): string | null {
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
    return null;
}

// The decided question in the file as it is now.
async function decide(
    work: string,
    id: string,
    decided: Question,
): Promise<string | null> {
    return await updateQuestions(work, (questions) => {
        const why = place(questions, id, decided);
        return { questions: why === null ? questions : null, result: why };
    });
}

type Reviewed = {
    id: string;
    newId?: string;
    reviewer: string;
    decision: "accept" | "reject" | "edit" | "unsure";
    reason: string;
    at: string;
};

// Appends to <work>/reviews.jsonl what was decided and by whom, one line
// a decision: the question's older claim is in its note, and its new id
// here.
async function logReviews(work: string, reviewed: Reviewed[]): Promise<void> {
    if (reviewed.length > 0) {
        await appendFile(
            join(work, "reviews.jsonl"),
            reviewed.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
            { mode: 0o600 },
        );
    }
}

const OWNER = "owner";

// An interactive decision, once it is in the file.
const ownerDecided = (
    work: string,
    id: string,
    decision: "accept" | "reject",
    reason: string,
) =>
    logReviews(work, [
        {
            id,
            reviewer: OWNER,
            decision,
            reason,
            at: new Date().toISOString(),
        },
    ]);

// The drafts of the questions the command has read; each decision is
// then written into the file as it is at that moment.
export async function reviewQuestions(
    questions: Question[],
    work: string,
    io: Io,
    corpus: Corpus,
    chars: number,
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
            io.out(shown(question, count + 1, drafts.length, corpus, chars));
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
                await ownerDecided(work, question.id, "accept", "");
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
                await ownerDecided(work, question.id, "reject", why);
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

// One line of an agent's decisions.
const lineSchema = z.object({
    id: z.string().min(1),
    decision: z.enum(["accept", "reject", "edit", "unsure"]),
    reason: z.string().optional(),
    question: z.string().optional(),
    answer: z.string().optional(),
    evidence: z.array(z.string()).optional(),
});

type Applied = {
    counts: Record<Reviewed["decision"], number>;
    problems: string[];
};

// An agent's decisions, applied to the drafts as the owner's keys would
// and logged under the reviewer's name. All lines are applied to the file
// as it is then in one write (or none, on a dry run, which checks them
// against each other just the same); a line that cannot be applied is
// reported and skipped.
async function applyDecisions(
    work: string,
    text: string,
    reviewer: string,
    dryRun: boolean,
    corpus: Corpus,
): Promise<Applied> {
    const applied: Applied = {
        counts: { accept: 0, reject: 0, edit: 0, unsure: 0 },
        problems: [],
    };
    const reviewed: Reviewed[] = [];
    await updateQuestions(work, (questions) => {
        for (const [at, line] of text.split("\n").entries()) {
            if (line.trim() === "") {
                continue;
            }
            let read: unknown;
            try {
                read = JSON.parse(line);
            } catch {
                applied.problems.push(`line ${at + 1}: not JSON`);
                continue;
            }
            const parsed = lineSchema.safeParse(read);
            const named = (read as { id?: unknown } | null)?.id;
            const label =
                typeof named === "string" && named !== ""
                    ? named
                    : `line ${at + 1}`;
            if (!parsed.success) {
                applied.problems.push(`${label}: ${issueOf(parsed.error)}`);
                continue;
            }
            const { id, decision } = parsed.data;
            const reason = (parsed.data.reason ?? "").trim();
            const problem = applyOne(questions, parsed.data, reason, corpus);
            if (typeof problem === "string") {
                applied.problems.push(`${id}: ${problem}`);
                continue;
            }
            applied.counts[decision]++;
            reviewed.push({
                id,
                ...(problem.newId === id ? {} : { newId: problem.newId }),
                reviewer,
                decision,
                reason,
                at: new Date().toISOString(),
            });
        }
        return { questions: dryRun ? null : questions, result: null };
    });
    if (!dryRun) {
        await logReviews(work, reviewed);
    }
    return applied;
}

// One decision on the draft it names, among the questions, which it
// changes if it can: the id the question has after it, or why not.
function applyOne(
    questions: Question[],
    line: z.infer<typeof lineSchema>,
    reason: string,
    corpus: Corpus,
): { newId: string } | string {
    const { id, decision } = line;
    const held = questions.find((question) => question.id === id);
    if (held === undefined) {
        return "no such question";
    }
    if (held.status !== "draft") {
        return `already ${held.status}`;
    }
    if (
        decision !== "edit" &&
        (line.question ?? line.answer ?? line.evidence) !== undefined
    ) {
        return "only an edit gives a question, answer or evidence";
    }
    if (decision === "unsure") {
        return { newId: id };
    }
    let decided: Question;
    if (decision === "accept") {
        decided = { ...held, status: "accepted" };
    } else if (decision === "reject") {
        decided = {
            ...held,
            status: "rejected",
            note: reason === "" ? held.note : reason.slice(0, 2000),
        };
    } else {
        const edit = checkedEdit(
            {
                ...held,
                question: line.question ?? held.question,
                answer: line.answer ?? held.answer,
                evidence: line.evidence ?? held.evidence,
            },
            held,
            corpus,
        );
        if (typeof edit === "string") {
            return edit;
        }
        decided = { ...edit, status: "accepted" };
    }
    const why = place(questions, id, decided);
    return why ?? { newId: decided.id };
}

const countsOf = (counts: Applied["counts"]) =>
    `accepted ${counts.accept}, rejected ${counts.reject}, edited ${counts.edit}, unsure ${counts.unsure}`;

// The command's --apply: the counts on stdout, each problem on stderr,
// and exit 1 if there was one.
async function applyFile(
    work: string,
    file: string,
    reviewer: string,
    dryRun: boolean,
    io: Io,
): Promise<number> {
    let text: string;
    try {
        text = await readFile(file, "utf8");
    } catch (error) {
        throw new UsageError(
            `cannot read ${file}: ${codeOf(error) ?? "unreadable"}`,
        );
    }
    const corpus = await openCorpus(workEnv(work));
    try {
        const { counts, problems } = await applyDecisions(
            work,
            text,
            reviewer,
            dryRun,
            corpus,
        );
        io.out(
            `${dryRun ? "dry run, nothing written: " : ""}${countsOf(counts)}\n`,
        );
        if (problems.length > 0) {
            io.err(problems.map((problem) => `${problem}\n`).join(""));
        }
        return problems.length > 0 ? 1 : 0;
    } finally {
        corpus.close();
    }
}

export const reviewCommand: Command = {
    summary: "accept, edit or reject the drafts, one at a time",
    options: {
        work: { type: "string", description: "the evaluation's directory" },
        evidence: {
            type: "string",
            description: `characters shown of each cited conversation (default ${EVIDENCE_CHARS})`,
        },
        apply: {
            type: "string",
            description:
                "apply an agent's decisions from a file of JSON lines {id, decision, reason}, an edit adding question, answer or evidence; with --reviewer",
        },
        reviewer: {
            type: "string",
            description: "who made the decisions in --apply, for reviews.jsonl",
        },
        "dry-run": {
            type: "boolean",
            description:
                "with --apply: report what would be applied, writing nothing",
        },
    },
    async run(values, _positionals, io) {
        const work = workOf(values);
        const file = stringOf(values, "apply");
        const reviewer = stringOf(values, "reviewer");
        const dryRun = values["dry-run"] === true;
        const chars = intOf(values, "evidence", EVIDENCE_CHARS, 1, 10_000_000);
        if (file === null && (reviewer !== null || dryRun)) {
            throw new UsageError(
                `--${dryRun ? "dry-run" : "reviewer"} goes with --apply`,
            );
        }
        if (file !== null && reviewer === null) {
            throw new UsageError("--apply needs --reviewer, who made them");
        }
        if (file !== null && stringOf(values, "evidence") !== null) {
            throw new UsageError(
                "--evidence is for reviewing in the terminal, not --apply",
            );
        }
        await readSnapshot(work);
        if (file !== null && reviewer !== null) {
            return await applyFile(work, file, reviewer, dryRun, io);
        }
        const questions = await readQuestionsToRewrite(work);
        if (!questions.some((question) => question.status === "draft")) {
            io.out("no drafts to review\n");
            return 0;
        }
        const corpus = await openCorpus(workEnv(work));
        try {
            const tally = await reviewQuestions(
                questions,
                work,
                io,
                corpus,
                chars,
            );
            io.out(
                `accepted ${tally.accepted}, rejected ${tally.rejected}, edited ${tally.edited}; ${tally.left} drafts left\n`,
            );
            return 0;
        } finally {
            corpus.close();
        }
    },
};
