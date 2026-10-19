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

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { UsageError } from "../errors.js";
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
    } catch {
        return [];
    }
    const records = new Map<string, RunRecord>();
    for (const line of text.split("\n")) {
        if (line.trim() === "") {
            continue;
        }
        try {
            const record = JSON.parse(line) as RunRecord;
            records.set(`${record.question}\t${record.system}`, record);
        } catch {
            // Cut short.
        }
    }
    return [...records.values()];
}

// Whether a record stands as asked: no failure, no retrieval error.
export const succeeded = (record: RunRecord) =>
    record.failures.length === 0 && record.retrieval.error === null;

export async function readRunInfo(work: string, id: string): Promise<RunInfo> {
    try {
        return JSON.parse(
            await readFile(runInfoPath(work, id), "utf8"),
        ) as RunInfo;
    } catch {
        throw new UsageError(`no run ${id} in ${join(work, "runs")}`);
    }
}
