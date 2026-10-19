// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/run/record.ts
//
//

// <work>/runs/<id>/: run.json, the settings; records.jsonl, one record a
// question and system, appended as each completes; summary.json and
// report.md, written at the end.

import { appendFile, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { codeOf, UsageError } from "../errors.js";
import { readRecord } from "../files.js";
import type { QuestionType } from "../questions/file.js";
import type { SnapshotInfo } from "../snapshot/snapshot.js";

export type Verdict = "strict" | "lenient" | "declined" | "stale";
export type Judged = Record<Verdict, boolean | null> & {
    // Each judge's reasoning, by its verdict; a record written before
    // reasons were kept has none.
    reasons?: Partial<Record<Verdict, string>>;
};
export type RunRecord = {
    question: string;
    system: string;
    type: QuestionType;
    retrieval: {
        // The first ten ids.
        ranked: string[];
        chars: number;
        ms: number;
        error: string | null;
    };
    // Null for a question with no evidence. inContext: whether any
    // evidence id is anywhere in the system's ranked ids, past the ten
    // kept; a record written before it was kept has none.
    recall: { at5: boolean; at10: boolean; inContext?: boolean } | null;
    answer: { text: string; input: number; output: number; ms: number } | null;
    judged: Judged;
    failures: string[];
};
export type RunInfo = {
    id: string;
    at: string;
    systems: string[];
    budget: number;
    fullBudget: number;
    retrievalOnly: boolean;
    models: { answer: string | null; judge: string | null };
    // Where each model was served, with no credential or query; a run
    // written before they were kept has none.
    baseUrls?: { answer: string | null; judge: string | null };
    snapshot: SnapshotInfo;
    questions: number;
    // The questions it asks, so a resumed run asks no others.
    questionIds: string[];
};

// A run id names a directory, so it may hold nothing that leaves runs/.
export function checkRunId(id: string): string {
    if (!/^[0-9A-Za-z-]{1,64}$/.test(id)) {
        throw new UsageError(`${id} is no run id`);
    }
    return id;
}

export const runDir = (work: string, id: string) =>
    join(work, "runs", checkRunId(id));
export const recordsPath = (work: string, id: string) =>
    join(runDir(work, id), "records.jsonl");
export const runInfoPath = (work: string, id: string) =>
    join(runDir(work, id), "run.json");
export const summaryPath = (work: string, id: string) =>
    join(runDir(work, id), "summary.json");
export const reportPath = (work: string, id: string) =>
    join(runDir(work, id), "report.md");

// Whole JSON is not yet a record: what the report and a resume read of it.
// An answer or recall that is absent or not as run.ts writes it would read
// as answered, or break the summary, so the line is passed over instead.
function isRunRecord(value: unknown): value is RunRecord {
    const record = value as Record<string, unknown> | null;
    const table = (field: unknown): field is Record<string, unknown> =>
        typeof field === "object" && field !== null && !Array.isArray(field);
    const number = (field: unknown) => typeof field === "number";
    const answer = (field: unknown) =>
        field === null ||
        (table(field) &&
            typeof field.text === "string" &&
            number(field.input) &&
            number(field.output) &&
            number(field.ms));
    const recall = (field: unknown) =>
        field === null ||
        (table(field) &&
            typeof field.at5 === "boolean" &&
            typeof field.at10 === "boolean" &&
            (field.inContext === undefined ||
                typeof field.inContext === "boolean"));
    return (
        table(record) &&
        typeof record.question === "string" &&
        typeof record.system === "string" &&
        typeof record.type === "string" &&
        table(record.retrieval) &&
        answer(record.answer) &&
        recall(record.recall) &&
        table(record.judged) &&
        Array.isArray(record.failures)
    );
}

// A line cut short by an interrupted write is passed over; its question
// is asked again on resume. A question asked again leaves two records
// for a system; the last stands.
export async function readRecords(
    work: string,
    id: string,
): Promise<RunRecord[]> {
    let text: string;
    try {
        text = await readFile(recordsPath(work, id), "utf8");
    } catch (error) {
        // A run that has asked nothing has no file; any other failure must
        // not look like one, or a resume would ask everything again.
        const code = codeOf(error);
        if (code === "ENOENT") {
            return [];
        }
        throw new UsageError(
            `cannot read ${recordsPath(work, id)}: ${code ?? "failed"}; mend it, or start a new run`,
        );
    }
    const records = new Map<string, RunRecord>();
    for (const line of text.split("\n")) {
        if (line.trim() === "") {
            continue;
        }
        try {
            const record = JSON.parse(line) as unknown;
            if (isRunRecord(record)) {
                records.set(`${record.question}\t${record.system}`, record);
            }
        } catch {
            // Cut short.
        }
    }
    return [...records.values()];
}

// Ends a last line cut short by an interrupted write, so that the next
// record appended starts a line of its own rather than fusing with it.
export async function endRecords(work: string, id: string): Promise<void> {
    const path = recordsPath(work, id);
    let cut = false;
    try {
        const file = await open(path, "r");
        try {
            const { size } = await file.stat();
            const last = Buffer.alloc(1);
            if (size > 0) {
                await file.read(last, 0, 1, size - 1);
                cut = last[0] !== 0x0a;
            }
        } finally {
            await file.close();
        }
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") {
            return;
        }
        throw error;
    }
    if (cut) {
        await appendFile(path, "\n");
    }
}

// Whether a record stands as asked: no failure, no retrieval error.
export const succeeded = (record: RunRecord) =>
    record.failures.length === 0 && record.retrieval.error === null;

export const runInfoSchema = z.object({
    id: z.string(),
    at: z.string(),
    systems: z.array(z.string()),
    budget: z.number(),
    fullBudget: z.number(),
    retrievalOnly: z.boolean(),
    models: z.object({
        answer: z.string().nullable(),
        judge: z.string().nullable(),
    }),
    // Absent from a run written before they were kept.
    baseUrls: z
        .object({ answer: z.string().nullable(), judge: z.string().nullable() })
        .optional(),
    snapshot: z.object({ source: z.string(), at: z.string() }),
    questions: z.number(),
    questionIds: z.array(z.string()),
});

// A run's settings as run.json holds them, or why it does not.
export const readRunInfo = (work: string, id: string): Promise<RunInfo> =>
    readRecord(runInfoPath(work, id), {
        missing: `no run ${id} in ${join(work, "runs")}`,
        what: "a run record",
        // Its records are paid for and stay where they are.
        again: "start a new run (this run's records stay in records.jsonl)",
        check: (read) => {
            const parsed = runInfoSchema.safeParse(read);
            const issue = parsed.success ? null : parsed.error.issues[0];
            return parsed.success
                ? (read as RunInfo)
                : `${issue?.path.join(".") || "its form"}: ${issue?.message}`;
        },
    });
