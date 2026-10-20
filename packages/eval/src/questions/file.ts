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

import { createHash, randomUUID } from "node:crypto";
import {
    type FileHandle,
    link,
    open,
    readFile,
    rename,
    rm,
    stat,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { codeOf, UsageError } from "../errors.js";
import { writeAtomic } from "../files.js";

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

// A digest of all that decides how a question is asked and judged, which
// its id leaves out (the gold answer, the older answer, the date, the
// project and the conversation excluded), so that a run can tell the
// question it began with from one edited since. The evidence is in the
// order of its ids, as questionId takes it.
export function definitionOf(question: Question): string {
    return createHash("sha256")
        .update(
            JSON.stringify([
                question.type,
                question.question,
                question.answer,
                [...question.evidence].sort(),
                question.exclude,
                question.asOf,
                question.project,
                question.note,
            ]),
        )
        .digest("hex")
        .slice(0, 16);
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
            problem(
                `${question.id} is not the id of its text and evidence (it should be ${questionId(question.question, question.evidence)})`,
            );
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
    await writeAtomic(
        questionsPath(work),
        questions.map((question) => `${JSON.stringify(question)}\n`).join(""),
    );
}

// How a writer waits for the lock on the file: tries, and a pause
// between them. A lock is stale when the process named in it is gone, or,
// where it names none, when it is older than staleMs. The rest are the
// world's, passed in so that tests can play it.
export type Locking = {
    staleMs: number;
    tries: number;
    pauseMs: number;
    sleep(ms: number): Promise<void>;
    alive(pid: number): boolean;
    now(): number;
    write(handle: FileHandle, text: string): Promise<void>;
};
export const locking: Locking = {
    staleMs: 30_000,
    tries: 200,
    pauseMs: 50,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    alive(pid) {
        try {
            process.kill(pid, 0);
            return true;
        } catch (error) {
            // EPERM: there, and not ours.
            return codeOf(error) !== "ESRCH";
        }
    },
    now: () => Date.now(),
    write: (handle, text) => handle.writeFile(text),
};

// What a lock file holds: undefined if there is none, null if it cannot
// be read.
async function readLock(path: string): Promise<string | null | undefined> {
    try {
        return await readFile(path, "utf8");
    } catch (error) {
        return codeOf(error) === "ENOENT" ? undefined : null;
    }
}

// A lock as it was judged: what it held, and when and as which file.
type Judged = { text: string | null; ino: number; mtimeMs: number };

// Removes a stale lock by moving it aside under a name of our own, which
// one writer alone can do. If what was moved is not what was judged, in
// content, file or time (a fresh lock is empty for an instant, as old
// as the last), another writer took the lock first: it is put back,
// unless a lock is there again.
async function takenOver(path: string, judged: Judged): Promise<boolean> {
    const aside = `${path}.stale.${process.pid}.${randomUUID()}`;
    try {
        await rename(path, aside);
    } catch (error) {
        return codeOf(error) === "ENOENT";
    }
    try {
        const moved = await stat(aside);
        if (
            (await readLock(aside)) === judged.text &&
            moved.ino === judged.ino &&
            moved.mtimeMs === judged.mtimeMs
        ) {
            await rm(aside, { force: true });
            return true;
        }
        await link(aside, path);
    } catch (error) {
        if (codeOf(error) !== "EEXIST") {
            await rm(aside, { force: true });
            throw error;
        }
    }
    await rm(aside, { force: true });
    return false;
}

// Whether a lock held is a dead writer's, and so removed. A lock already
// gone counts as stale: the caller tries to make its own again.
async function staleLock(path: string, timing: Locking): Promise<boolean> {
    const text = await readLock(path);
    let seen: { ino: number; mtimeMs: number };
    try {
        seen = await stat(path);
    } catch (error) {
        if (codeOf(error) !== "ENOENT") {
            throw error;
        }
        return true;
    }
    if (text === undefined) {
        return true;
    }
    const owner = /^(\d+) \S+\n$/.exec(text ?? "");
    const stale =
        owner !== null
            ? !timing.alive(Number(owner[1]))
            : timing.now() - seen.mtimeMs > timing.staleMs;
    return stale && (await takenOver(path, { text, ...seen }));
}

// An advisory lock beside the file, made exclusively with this writer's
// pid and a token of its own; returns its release, which removes the lock
// only while it holds that token.
async function lockQuestions(
    work: string,
    timing: Locking,
): Promise<() => Promise<void>> {
    const path = `${questionsPath(work)}.lock`;
    const held = `${process.pid} ${randomUUID()}\n`;
    for (let attempt = 1; ; attempt++) {
        try {
            const handle = await open(path, "wx", 0o600);
            try {
                await timing.write(handle, held);
            } catch (error) {
                await rm(path, { force: true });
                throw error;
            } finally {
                await handle.close();
            }
            return async () => {
                if ((await readLock(path)) === held) {
                    await rm(path, { force: true });
                }
            };
        } catch (error) {
            if (codeOf(error) !== "EEXIST") {
                throw typeof codeOf(error) === "string"
                    ? new UsageError(`cannot lock ${path}: ${codeOf(error)}`)
                    : error;
            }
        }
        // A takeover counts as a try, so that a lock which cannot be
        // taken over for good still ends in giving up.
        const taken = await staleLock(path, timing);
        if (attempt >= timing.tries) {
            throw new UsageError(
                `${path} is held by another command; if none is running, remove it`,
            );
        }
        if (!taken) {
            await timing.sleep(timing.pauseMs);
        }
    }
}

// Runs act under the lock, which serves every file of the work directory
// that is read, changed and written back: the question file, and the
// list of generations. It is released however act ends.
export async function underLock<T>(
    work: string,
    act: () => Promise<T>,
    timing: Locking = locking,
): Promise<T> {
    const release = await lockQuestions(work, timing);
    try {
        return await act();
    } finally {
        await release();
    }
}

// The one way the question file is changed: under its lock, the file as
// it is then is read, changed and written back, so that no two commands
// (a review beside a generation) overwrite each other's writes. A change
// that gives no questions leaves the file as it is.
export const updateQuestions = <T>(
    work: string,
    change: (
        questions: Question[],
    ) =>
        | { questions: Question[] | null; result: T }
        | Promise<{ questions: Question[] | null; result: T }>,
    timing: Locking = locking,
): Promise<T> =>
    underLock(
        work,
        async () => {
            const { questions, result } = await change(
                await readQuestionsToRewrite(work),
            );
            if (questions !== null) {
                await writeQuestions(work, questions);
            }
            return result;
        },
        timing,
    );

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
