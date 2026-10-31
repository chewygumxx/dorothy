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
import { join, resolve } from "node:path";
import { knowledgeText, passage, termsOf } from "@dorothy/memory/evaluation";
import { z } from "zod";
import {
    type Command,
    type Io,
    intOf,
    stringOf,
    type Values,
    workOf,
} from "../command.js";
import { codeOf, UsageError } from "../errors.js";
import { readSnapshot, workEnv } from "../snapshot/snapshot.js";
import { type Corpus, openCorpus } from "../systems/corpus.js";
import {
    issueOf,
    type Question,
    questionId,
    questionSchema,
    readQuestionsToRewrite,
    sameQuestion,
    updateQuestions,
} from "./file.js";
import { renderDrafts, spotCheck } from "./render.js";

// The characters of each cited conversation that review shows.
export const EVIDENCE_CHARS = 6000;

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
                return `  ${id}: ${conversation.title ?? "Untitled"}\n${indent(passage(conversation, terms, chars).text)}`;
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

type Decision = "accept" | "reject" | "edit" | "unsure";

// A line of reviews.jsonl: a reopen is the owner's alone.
const reviewedSchema = z.object({
    id: z.string().min(1),
    newId: z.string().min(1).optional(),
    reviewer: z.string().min(1),
    decision: z.enum(["accept", "reject", "edit", "unsure", "reopen"]),
    reason: z.string(),
    at: z.string(),
});
type Reviewed = z.infer<typeof reviewedSchema>;

// Every line of the log, in order; none if there is no log yet.
export async function readReviews(work: string): Promise<Reviewed[]> {
    const path = join(work, "reviews.jsonl");
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        if (codeOf(error) === "ENOENT") {
            return [];
        }
        throw new UsageError(
            `cannot read ${path}: ${codeOf(error) ?? "failed"}`,
        );
    }
    const reviews: Reviewed[] = [];
    for (const [at, line] of text.split("\n").entries()) {
        if (line.trim() === "") {
            continue;
        }
        let read: unknown;
        try {
            read = JSON.parse(line);
        } catch {
            throw new UsageError(`${path} line ${at + 1} is not JSON`);
        }
        const parsed = reviewedSchema.safeParse(read);
        if (!parsed.success) {
            throw new UsageError(
                `${path} line ${at + 1}: ${issueOf(parsed.error)}`,
            );
        }
        reviews.push(parsed.data);
    }
    return reviews;
}

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

// An interactive decision, once it is in the file; an edit also gives the
// id the question has after it.
const ownerDecided = (
    work: string,
    id: string,
    decision: Decision,
    reason: string,
    newId = id,
) =>
    logReviews(work, [
        {
            id,
            ...(newId === id ? {} : { newId }),
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
                    await ownerDecided(
                        work,
                        question.id,
                        "edit",
                        "",
                        outcome.id,
                    );
                }
                continue;
            }
            io.out("Type a, e, r, s or q.\n");
        }
    }
    return await finish();
}

// An accepted question made a draft again, as review writes the file, and
// the owner's reason logged: the way to overturn an accept.
export async function reopen(
    work: string,
    id: string,
    reason: string,
): Promise<void> {
    await updateQuestions(work, (questions) => {
        const held = questions.find((question) => question.id === id);
        if (held === undefined) {
            throw new UsageError(`no question ${id}`);
        }
        if (held.status !== "accepted") {
            throw new UsageError(`${id} is ${held.status}, not accepted`);
        }
        return {
            questions: questions.map((question) =>
                question === held ? { ...held, status: "draft" } : question,
            ),
            result: null,
        };
    });
    await logReviews(work, [
        {
            id,
            decision: "reopen",
            reviewer: OWNER,
            reason,
            at: new Date().toISOString(),
        },
    ]);
}

// One line of an agent's decisions. A key it does not know is a mistake
// in the line, which an edit would otherwise lose without a word.
const lineSchema = z.strictObject({
    id: z.string().min(1),
    decision: z.enum(["accept", "reject", "edit", "unsure"]),
    reason: z.string().optional(),
    question: z.string().optional(),
    answer: z.string().optional(),
    evidence: z.array(z.string()).optional(),
});

type Applied = {
    counts: Record<Decision, number>;
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
        if ((line.question ?? line.answer ?? line.evidence) === undefined) {
            return "an edit gives a question, answer or evidence";
        }
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
        if (edit.answer === held.answer && sameQuestion(edit, held)) {
            return "the edit changes nothing";
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

// The ways review goes other than one draft at a time, each by its
// option, and the options that belong to one only.
const MODES = ["apply", "render", "spot-check", "reopen"] as const;
type Mode = (typeof MODES)[number];
const BELONGS: Record<string, Mode> = {
    reviewer: "apply",
    "dry-run": "apply",
    batches: "render",
    source: "render",
    per: "spot-check",
    reason: "reopen",
};

// The mode the options name, or what is wrong with how they are given:
// two modes, or an option beside a mode it is not for.
function modeOf(values: Values): Mode | null {
    const named = MODES.filter((mode) => values[mode] !== undefined);
    const [mode, other] = named;
    if (mode !== undefined && other !== undefined) {
        throw new UsageError(`--${mode} cannot go with --${other}`);
    }
    if (mode !== undefined && stringOf(values, mode) === null) {
        throw new UsageError(`--${mode} needs a value`);
    }
    for (const [option, belongs] of Object.entries(BELONGS)) {
        if (values[option] === undefined || values[option] === false) {
            continue;
        }
        if (mode === undefined) {
            throw new UsageError(`--${option} goes with --${belongs}`);
        }
        if (mode !== belongs) {
            throw new UsageError(`--${option} cannot go with --${mode}`);
        }
    }
    // The terminal's --evidence is shown by --render too.
    if (mode !== undefined && mode !== "render") {
        if (stringOf(values, "evidence") !== null) {
            throw new UsageError(
                mode === "apply"
                    ? "--evidence is for reviewing in the terminal, not --apply"
                    : `--evidence cannot go with --${mode}`,
            );
        }
    }
    return mode ?? null;
}

const plural = (count: number, noun: string) =>
    `${count} ${noun}${count === 1 ? "" : "s"}`;

// The command's --render: each file and its drafts, or why there are none.
async function renderCommand(
    work: string,
    dir: string,
    values: Values,
    chars: number,
    io: Io,
): Promise<number> {
    const source = stringOf(values, "source");
    const sizes = await renderDrafts(work, resolve(dir), {
        batches: intOf(values, "batches", 1, 1, 100),
        source,
        chars,
    });
    io.out(
        sizes.length === 0
            ? `no drafts${source === null ? "" : ` from ${source}`} to render\n`
            : sizes
                  .map(
                      (size, k) =>
                          `drafts-${k + 1}.md: ${plural(size, "draft")}\n`,
                  )
                  .join(""),
    );
    return 0;
}

export const reviewCommand: Command = {
    summary: "accept, edit or reject the drafts, one at a time",
    options: {
        work: { type: "string", description: "the evaluation's directory" },
        evidence: {
            type: "string",
            description: `characters shown of each cited conversation (default ${EVIDENCE_CHARS}); with --render too`,
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
        render: {
            type: "string",
            description:
                "write the drafts as Markdown for an agent to screen into this directory, drafts-<k>.md",
        },
        batches: {
            type: "string",
            description:
                "with --render: files to split the drafts into (1 to 100, default 1)",
        },
        source: {
            type: "string",
            description:
                "with --render: only the drafts of a generator, by model or generated:<model>",
        },
        "spot-check": {
            type: "string",
            description:
                "write this file for your check of the unsure drafts and a sample of each reviewer's accepts",
        },
        per: {
            type: "string",
            description:
                "with --spot-check: accepts sampled of each reviewer (1 to 1000, default 15)",
        },
        reopen: {
            type: "string",
            description:
                "make this accepted question a draft again; with --reason",
        },
        reason: {
            type: "string",
            description: "with --reopen: why, for reviews.jsonl",
        },
    },
    async run(values, _positionals, io) {
        const work = workOf(values);
        const mode = modeOf(values);
        const file = stringOf(values, "apply");
        const reviewer = stringOf(values, "reviewer");
        const dryRun = values["dry-run"] === true;
        const chars = intOf(values, "evidence", EVIDENCE_CHARS, 1, 10_000_000);
        if (file !== null && reviewer === null) {
            throw new UsageError("--apply needs --reviewer, who made them");
        }
        const reopening = stringOf(values, "reopen");
        const reason = stringOf(values, "reason");
        if (reopening !== null && reason === null) {
            throw new UsageError("--reopen needs --reason, why");
        }
        await readSnapshot(work);
        if (mode === "render") {
            return await renderCommand(
                work,
                stringOf(values, "render") ?? "",
                values,
                chars,
                io,
            );
        }
        if (mode === "spot-check") {
            const target = resolve(stringOf(values, "spot-check") ?? "");
            const { unsure, sampled } = await spotCheck(work, target, {
                per: intOf(values, "per", 15, 1, 1000),
                random: Math.random,
            });
            io.out(`${unsure} unsure, ${sampled} sampled -> ${target}\n`);
            return 0;
        }
        if (reopening !== null && reason !== null) {
            await reopen(work, reopening, reason);
            io.out(`${reopening} is a draft again\n`);
            return 0;
        }
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
