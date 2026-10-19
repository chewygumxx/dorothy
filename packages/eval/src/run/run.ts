// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/run/run.ts
//
//

// Every accepted question asked of every system: retrieved within the
// budget, checked for its evidence, answered and judged. Each record is
// appended as it completes, so a stopped run resumes where it stopped.

import { createHash } from "node:crypto";
import { appendFile, mkdir, stat, writeFile } from "node:fs/promises";
import { UsageError } from "../errors.js";
import { CallCap, failureOf, type Models } from "../models/client.js";
import type { EvalConfig, RoleConfig } from "../models/config.js";
import type { Question } from "../questions/file.js";
import { writeRunReport } from "../report/command.js";
import type { Summary } from "../report/summary.js";
import type { SnapshotInfo } from "../snapshot/snapshot.js";
import type { Corpus } from "../systems/corpus.js";
import { makeSystem, type Retrieved, type System } from "../systems/system.js";
import {
    answerPrompt,
    declines,
    type Judge,
    type Judges,
    makeJudges,
} from "./judges.js";
import {
    type RunInfo,
    type RunRecord,
    readRecords,
    recordsPath,
    runDir,
    runInfoPath,
    succeeded,
    type Verdict,
} from "./record.js";

export type RunSettings = {
    systems: string[];
    budget: number;
    fullBudget: number;
    retrievalOnly: boolean;
};

// A base URL as run.json keeps it: its user, password, query and
// fragment may carry a key, so only the scheme, host and path stay.
export function servedAt(baseUrl: string): string {
    try {
        const url = new URL(baseUrl);
        return `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
        return "(not a URL)";
    }
}

// The answer and judge roles' models and where they are served, or none
// for a run that asks no model.
function rolesOf(config: EvalConfig, retrievalOnly: boolean) {
    const of = (
        role: "answer" | "judge",
        what: (found: RoleConfig) => string,
    ) => {
        const found = config[role];
        return retrievalOnly || found === null ? null : what(found);
    };
    return {
        models: {
            answer: of("answer", (found) => found.model),
            judge: of("judge", (found) => found.model),
        },
        baseUrls: {
            answer: of("answer", (found) => servedAt(found.baseUrl)),
            judge: of("judge", (found) => servedAt(found.baseUrl)),
        },
    };
}

export function newRunInfo(
    settings: RunSettings,
    accepted: Question[],
    config: EvalConfig,
    snapshot: SnapshotInfo,
    now: Date,
): RunInfo {
    const { models, baseUrls } = rolesOf(config, settings.retrievalOnly);
    const hash = createHash("sha256")
        .update(
            JSON.stringify({
                ids: accepted.map((question) => question.id),
                settings,
                models,
                baseUrls,
            }),
        )
        .digest("hex")
        .slice(0, 8);
    const at = now.toISOString();
    return {
        // To the millisecond, so two runs a second apart stay apart.
        id: `${at.replace(/[-:.]/g, "").slice(0, 18)}-${hash}`,
        at,
        ...settings,
        models,
        baseUrls,
        snapshot,
        questions: accepted.length,
        questionIds: accepted.map((question) => question.id),
    };
}

// A resumed run goes on with the snapshot, models and providers it began
// with: a record of another corpus or model would make run.json untrue.
// A run that kept no base URLs is held to its models alone.
export function checkResumable(
    info: RunInfo,
    config: EvalConfig,
    snapshot: SnapshotInfo,
): void {
    if (snapshot.at !== info.snapshot.at) {
        throw new UsageError(
            `the snapshot was taken at ${snapshot.at}, but run ${info.id} used ${info.snapshot.at}; start a new run`,
        );
    }
    if (info.retrievalOnly) {
        return;
    }
    const now = rolesOf(config, false);
    const kept = [
        ["model", now.models, info.models],
        ...(info.baseUrls === undefined
            ? []
            : [["base URL", now.baseUrls, info.baseUrls] as const]),
    ] as const;
    for (const [what, current, recorded] of kept) {
        for (const role of ["answer", "judge"] as const) {
            if (current[role] !== recorded[role]) {
                throw new UsageError(
                    `the ${role} ${what} is now ${current[role] ?? "none"}, but run ${info.id} used ${recorded[role] ?? "none"}; start a new run`,
                );
            }
        }
    }
}

// The model calls a run would make: none for a lookup, an answer and a
// judgement for an abstention, an answer and two judgements for the rest,
// and one more for an update with an older answer.
export function modelCalls(info: RunInfo, accepted: Question[]): number {
    if (info.retrievalOnly) {
        return 0;
    }
    const each = accepted.reduce(
        (sum, question) =>
            sum +
            (question.type === "lookup"
                ? 0
                : question.type === "abstention"
                  ? 2
                  : question.type === "knowledge-update" &&
                      question.note !== null
                    ? 4
                    : 3),
        0,
    );
    return each * info.systems.length;
}

// The cap reached at a judgement: the answer was paid for, so its record
// is kept, with that judgement's failure, before the run stops.
class Capped extends CallCap {
    constructor(
        message: string,
        readonly record: RunRecord,
    ) {
        super(message);
    }
}

const hasEvidence = (ranked: string[], evidence: string[]) =>
    ranked.some((id) => evidence.includes(id));

async function ask(
    question: Question,
    system: System,
    info: RunInfo,
    models: Models | null,
    judges: Judges | null,
): Promise<RunRecord> {
    const started = performance.now();
    let retrieved: Retrieved = { ranked: [], context: "" };
    let error: string | null = null;
    try {
        retrieved = await system.retrieve(
            {
                text: question.question,
                asOf: question.asOf,
                project: question.project,
                exclude: question.exclude,
            },
            system.name === "full" ? info.fullBudget : info.budget,
        );
    } catch (caught) {
        error = failureOf(caught);
    }
    const record: RunRecord = {
        question: question.id,
        system: system.name,
        type: question.type,
        retrieval: {
            ranked: retrieved.ranked.slice(0, 10),
            chars: retrieved.context.length,
            ms: Math.round(performance.now() - started),
            error,
        },
        recall:
            question.evidence.length === 0
                ? null
                : {
                      at5: hasEvidence(
                          retrieved.ranked.slice(0, 5),
                          question.evidence,
                      ),
                      at10: hasEvidence(
                          retrieved.ranked.slice(0, 10),
                          question.evidence,
                      ),
                      // For full, whether it fitted the context.
                      inContext: hasEvidence(
                          retrieved.ranked,
                          question.evidence,
                      ),
                  },
        answer: null,
        judged: {
            strict: null,
            lenient: null,
            declined: null,
            stale: null,
            reasons: {},
        },
        failures: [],
    };
    // A failed retrieval is a miss already: nothing more is spent on it.
    if (
        error !== null ||
        models === null ||
        judges === null ||
        question.type === "lookup"
    ) {
        return record;
    }
    try {
        record.answer = await models.complete(
            "answer",
            answerPrompt(question, retrieved.context),
        );
    } catch (caught) {
        if (caught instanceof CallCap) {
            throw caught;
        }
        record.failures.push(`answer: ${failureOf(caught)}`);
        return record;
    }
    const outputs = record.answer.text;
    const verdict = async (name: Verdict, judge: Judge, reference?: string) => {
        try {
            const { score, reasoning } = await judge({
                inputs: question.question,
                outputs,
                ...(reference === undefined
                    ? {}
                    : { referenceOutputs: reference }),
            });
            record.judged[name] = score;
            if (reasoning !== null) {
                record.judged.reasons = {
                    ...record.judged.reasons,
                    [name]: reasoning,
                };
            }
        } catch (caught) {
            record.failures.push(`${name}: ${failureOf(caught)}`);
            if (caught instanceof CallCap) {
                throw new Capped(caught.message, record);
            }
        }
    };
    if (question.type === "abstention") {
        await verdict("declined", judges.declined);
        return record;
    }
    const reference = question.answer ?? "";
    await verdict("strict", judges.strict, reference);
    await verdict("lenient", judges.lenient, reference);
    record.judged.declined = declines(outputs);
    if (question.type === "knowledge-update" && question.note !== null) {
        await verdict("stale", judges.stale, question.note);
    }
    return record;
}

export async function runEvaluation(
    info: RunInfo,
    deps: {
        work: string;
        corpus: Corpus;
        questions: Question[];
        models: Models | null;
        concurrency: number;
        systems?: System[];
    },
): Promise<{ summary: Summary; stopped: string | null }> {
    const asked = new Set(info.questionIds);
    const accepted = deps.questions.filter(
        (q) => q.status === "accepted" && asked.has(q.id),
    );
    if (accepted.length === 0) {
        throw new UsageError(
            "no accepted questions: mine or generate some, then review them",
        );
    }
    await mkdir(runDir(deps.work, info.id), { recursive: true, mode: 0o700 });
    const written = await stat(runInfoPath(deps.work, info.id)).then(
        () => true,
        () => false,
    );
    if (!written) {
        await writeFile(
            runInfoPath(deps.work, info.id),
            `${JSON.stringify(info, null, 4)}\n`,
            { mode: 0o600 },
        );
    }
    const done = new Set(
        (await readRecords(deps.work, info.id))
            .filter(succeeded)
            .map((record) => `${record.question}\t${record.system}`),
    );
    const systems =
        deps.systems ??
        info.systems.map((name) => makeSystem(name, deps.corpus));
    const models = info.retrievalOnly ? null : deps.models;
    const judges = models === null ? null : makeJudges(models);
    const tasks = accepted
        .flatMap((question) => systems.map((system) => ({ question, system })))
        .filter(
            ({ question, system }) =>
                !done.has(`${question.id}\t${system.name}`),
        );
    for (const system of systems) {
        await system.prepare?.();
    }
    let stopped: string | null = null;
    let next = 0;
    // Appends one at a time, in the order records complete.
    let writing = Promise.resolve();
    const append = (record: RunRecord) => {
        writing = writing.then(() =>
            appendFile(
                recordsPath(deps.work, info.id),
                `${JSON.stringify(record)}\n`,
                { mode: 0o600 },
            ),
        );
        return writing;
    };
    const worker = async () => {
        while (stopped === null && next < tasks.length) {
            const task = tasks[next++] as (typeof tasks)[number];
            try {
                await append(
                    await ask(task.question, task.system, info, models, judges),
                );
            } catch (error) {
                if (error instanceof CallCap) {
                    if (error instanceof Capped) {
                        await append(error.record);
                    }
                    stopped = error.message;
                    return;
                }
                throw error;
            }
        }
    };
    try {
        await Promise.all(
            Array.from(
                {
                    length: Math.max(
                        1,
                        Math.min(deps.concurrency, tasks.length),
                    ),
                },
                worker,
            ),
        );
        await writing;
    } finally {
        for (const system of systems) {
            await system.close?.();
        }
    }
    return { summary: await writeRunReport(deps.work, info.id), stopped };
}
