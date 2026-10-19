// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/run/run.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../cli.js";
import { Models } from "../models/client.js";
import { configPath, readEvalConfig } from "../models/config.js";
import {
    type Question,
    questionId,
    readQuestions,
    writeQuestions,
} from "../questions/file.js";
import { readSnapshot, workEnv } from "../snapshot/snapshot.js";
import { openCorpus } from "../systems/corpus.js";
import {
    fakeIo,
    GARDEN,
    snapshotFixture,
    stubConfig,
    stubModels,
    tempRoot,
} from "../testing.js";
import { readRecords, recordsPath, reportPath, summaryPath } from "./record.js";
import { newRunInfo, runEvaluation } from "./run.js";

let temp: ReturnType<typeof tempRoot>;
let work: string;
let stub: ReturnType<typeof stubModels> | null = null;

const accepted = (
    question: string,
    fields: Partial<Question> & Pick<Question, "type">,
): Question => {
    const evidence = fields.evidence ?? [];
    return {
        id: questionId(question, evidence),
        question,
        answer: "An answer.",
        evidence,
        exclude: null,
        asOf: "2026-10-19",
        project: null,
        source: "generated:m/1",
        status: "accepted",
        note: null,
        ...fields,
    };
};

beforeEach(async () => {
    temp = tempRoot("run");
    work = await snapshotFixture(temp.root);
    expect(await runCli(["mine", "--work", work], fakeIo().io)).toBe(0);
    const { questions } = await readQuestions(work);
    await writeQuestions(work, [
        ...questions,
        accepted("Which plot is my allotment?", {
            type: "single-session",
            answer: "Plot twelve, by the river.",
            evidence: [`c:${GARDEN}`],
        }),
        accepted("What colour is my canoe?", {
            type: "abstention",
            answer: "The memory does not say.",
        }),
        accepted("Which editor do I use?", {
            type: "knowledge-update",
            answer: "Helix.",
            evidence: ["k:personal/uses-helix"],
            note: "Vim.",
        }),
    ]);
});
afterEach(() => {
    stub?.stop();
    stub = null;
    temp.remove();
});

// Judges ask for a schema; the answering model does not.
const serve = (answer: { status?: number; content?: string }) => {
    stub = stubModels((request) =>
        request.body.response_format === undefined
            ? answer
            : { json: { reasoning: "Checked.", score: true } },
    );
    writeFileSync(configPath(work), stubConfig(stub.url));
    return stub;
};
const idOf = (out: string[]) =>
    /run ([0-9A-Za-z-]+):/.exec(out.join(""))?.[1] ?? "";

describe("bun run eval -- run", () => {
    it("measures retrieval alone with no model", async () => {
        const { io, out } = fakeIo();
        expect(
            await runCli(["run", "--work", work, "--retrieval-only"], io),
        ).toBe(0);
        const id = idOf(out);
        const records = await readRecords(work, id);
        expect(records).toHaveLength(15);
        expect(records.every((each) => each.answer === null)).toBe(true);
        const tea = records.find(
            (each) =>
                each.system === "lexical" &&
                each.type === "lookup" &&
                each.retrieval.ranked.length > 0 &&
                each.recall !== null,
        );
        expect(tea?.recall?.at5).toBe(true);
        expect(existsSync(reportPath(work, id))).toBe(true);
        expect(existsSync(summaryPath(work, id))).toBe(true);
    });

    it("answers and judges, but never a lookup", async () => {
        const { requests } = serve({ content: "Plot twelve, by the river." });
        const { io, out } = fakeIo();
        expect(
            await runCli(
                [
                    "run",
                    "--work",
                    work,
                    "--systems",
                    "lexical",
                    "--concurrency",
                    "1",
                ],
                io,
            ),
        ).toBe(0);
        const records = await readRecords(work, idOf(out));
        const byType = new Map(records.map((each) => [each.type, each]));
        expect(byType.get("lookup")?.answer).toBeNull();
        expect(byType.get("single-session")?.judged).toEqual({
            strict: true,
            lenient: true,
            declined: false,
            stale: null,
        });
        expect(byType.get("abstention")?.judged.declined).toBe(true);
        expect(byType.get("abstention")?.judged.strict).toBeNull();
        expect(byType.get("knowledge-update")?.judged.stale).toBe(true);
        // Three answers, then judges: two, one and three.
        expect(requests).toHaveLength(9);
        const asked = JSON.stringify(requests[0]?.body.messages);
        expect(asked).toContain("<memory>");
        expect(asked).toContain("Which plot is my allotment?");
    });

    it("stops at --max-calls and resumes without asking twice", async () => {
        serve({ content: "Plot twelve, by the river." });
        const first = fakeIo();
        expect(
            await runCli(
                [
                    "run",
                    "--work",
                    work,
                    "--systems",
                    "lexical",
                    "--concurrency",
                    "1",
                    "--max-calls",
                    "4",
                ],
                first.io,
            ),
        ).toBe(0);
        const id = idOf(first.out);
        expect(first.out.join("")).toContain(
            "stopped: reached --max-calls (4); resume with",
        );
        expect(await readRecords(work, id)).toHaveLength(3);
        const again = fakeIo();
        expect(
            await runCli(["run", "--work", work, "--resume", id], again.io),
        ).toBe(0);
        const records = await readRecords(work, id);
        expect(records).toHaveLength(5);
        expect(new Set(records.map((each) => each.question)).size).toBe(5);
    });

    it("refuses to resume on another snapshot or model", async () => {
        const { requests } = serve({ content: "Plot twelve, by the river." });
        const first = fakeIo();
        const lexical = ["run", "--work", work, "--systems", "lexical"];
        expect(await runCli(lexical, first.io)).toBe(0);
        const id = idOf(first.out);
        const kept = (await readRecords(work, id)).length;
        const calls = requests.length;
        const resume = ["run", "--work", work, "--resume", id];

        const config = readFileSync(configPath(work), "utf8");
        writeFileSync(
            configPath(work),
            config.replace("judge/model", "judge/other"),
        );
        const judged = fakeIo();
        expect(await runCli(resume, judged.io)).toBe(1);
        expect(judged.err.join("")).toContain(
            `the judge model is now judge/other, but run ${id} used judge/model; start a new run`,
        );
        writeFileSync(
            configPath(work),
            config.replace("answer/model", "answer/other"),
        );
        const answered = fakeIo();
        expect(await runCli(resume, answered.io)).toBe(1);
        expect(answered.err.join("")).toContain("the answer model is now");
        writeFileSync(configPath(work), config);

        const path = join(work, "snapshot.json");
        const snapshot = JSON.parse(readFileSync(path, "utf8"));
        writeFileSync(
            path,
            JSON.stringify({ ...snapshot, at: "2020-01-01T00:00:00.000Z" }),
        );
        const taken = fakeIo();
        expect(await runCli(resume, taken.io)).toBe(1);
        expect(taken.err.join("")).toContain(
            "the snapshot was taken at 2020-01-01T00:00:00.000Z, but run",
        );
        expect(taken.err.join("")).toContain("start a new run");
        expect(await readRecords(work, id)).toHaveLength(kept);
        expect(requests).toHaveLength(calls);
    });

    it("counts a dry run's calls and makes none", async () => {
        const { requests } = serve({ content: "x" });
        const { io, out } = fakeIo();
        expect(
            await runCli(
                ["run", "--work", work, "--systems", "lexical", "--dry-run"],
                io,
            ),
        ).toBe(0);
        expect(out.join("")).toBe(
            "dry run: 5 questions, 1 systems; 9 model calls\n",
        );
        expect(requests).toHaveLength(0);
    });

    it("names a key's variable that is not set", async () => {
        stub = stubModels(() => ({ content: "x" }));
        writeFileSync(configPath(work), stubConfig(stub.url, "EVAL_KEY"));
        const { io, err } = fakeIo();
        expect(await runCli(["run", "--work", work], io)).toBe(1);
        expect(err.join("")).toContain("EVAL_KEY is not set");
    });

    it("says there is nothing to ask, or no such run", async () => {
        const { io, err } = fakeIo();
        expect(
            await runCli(["run", "--work", work, "--resume", "nope"], io),
        ).toBe(1);
        expect(err.join("")).toContain("no run nope");
        await writeQuestions(work, []);
        expect(
            await runCli(["run", "--work", work, "--retrieval-only"], io),
        ).toBe(1);
        expect(err.join("")).toContain("no accepted questions");
    });
});

describe("a run", () => {
    it("records a system's failure and goes on", async () => {
        const corpus = await openCorpus(workEnv(work));
        try {
            const { questions } = await readQuestions(work);
            const info = newRunInfo(
                {
                    systems: ["broken"],
                    budget: 8000,
                    fullBudget: 400_000,
                    retrievalOnly: true,
                },
                questions,
                await readEvalConfig(work),
                await readSnapshot(work),
                new Date("2026-10-19T01:00:00.000Z"),
            );
            const { summary } = await runEvaluation(info, {
                work,
                corpus,
                questions,
                models: null,
                concurrency: 2,
                systems: [
                    {
                        name: "broken",
                        retrieve: async () => {
                            throw new Error("down");
                        },
                    },
                ],
            });
            const records = await readRecords(work, info.id);
            expect(records).toHaveLength(5);
            expect(records[0]?.retrieval.error).toBe("down");
            expect(summary.systems.broken?.all.failures).toBe(5);
        } finally {
            corpus.close();
        }
    });

    it("records a model's failure and goes on", async () => {
        serve({ status: 500 });
        const corpus = await openCorpus(workEnv(work));
        try {
            const { questions } = await readQuestions(work);
            const config = await readEvalConfig(work);
            const info = newRunInfo(
                {
                    systems: ["lexical"],
                    budget: 8000,
                    fullBudget: 400_000,
                    retrievalOnly: false,
                },
                questions,
                config,
                await readSnapshot(work),
                new Date("2026-10-19T01:00:00.000Z"),
            );
            await runEvaluation(info, {
                work,
                corpus,
                questions,
                models: new Models(config, { env: {}, retryMs: 1 }),
                concurrency: 1,
            });
            const records = await readRecords(work, info.id);
            expect(records).toHaveLength(5);
            const failed = records.find(
                (each) => each.type === "single-session",
            );
            expect(failed?.failures[0]).toStartWith("answer: 500");
            expect(failed?.judged.strict).toBeNull();
        } finally {
            corpus.close();
        }
    });

    describe("on resume", () => {
        const settings = {
            systems: ["lexical"],
            budget: 8000,
            fullBudget: 400_000,
            retrievalOnly: false,
        };
        const lines = (id: string) =>
            readFileSync(recordsPath(work, id), "utf8")
                .split("\n")
                .filter((line) => line !== "");

        it("asks a failed record again, and only that", async () => {
            let failing = true;
            stub = stubModels((request) =>
                failing
                    ? { status: 500 }
                    : request.body.response_format === undefined
                      ? { content: "Plot twelve, by the river." }
                      : { json: { reasoning: "Checked.", score: true } },
            );
            writeFileSync(configPath(work), stubConfig(stub.url));
            const corpus = await openCorpus(workEnv(work));
            try {
                const { questions } = await readQuestions(work);
                const config = await readEvalConfig(work);
                const info = newRunInfo(
                    settings,
                    questions,
                    config,
                    await readSnapshot(work),
                    new Date("2026-10-19T01:00:00.000Z"),
                );
                const go = () =>
                    runEvaluation(info, {
                        work,
                        corpus,
                        questions,
                        models: new Models(config, { env: {}, retryMs: 1 }),
                        concurrency: 1,
                    });
                expect((await go()).summary.systems.lexical?.all.failures).toBe(
                    3,
                );
                expect(lines(info.id)).toHaveLength(5);
                failing = false;
                const before = stub.requests.length;
                const { summary } = await go();
                // Three answers and six judgements, no lookup asked.
                expect(stub.requests.length - before).toBe(9);
                expect(lines(info.id)).toHaveLength(8);
                const records = await readRecords(work, info.id);
                expect(records).toHaveLength(5);
                expect(
                    records.every((each) => each.failures.length === 0),
                ).toBe(true);
                expect(summary.systems.lexical?.all.failures).toBe(0);
                // What succeeded is not asked again.
                const after = stub.requests.length;
                await go();
                expect(stub.requests).toHaveLength(after);
                expect(lines(info.id)).toHaveLength(8);
            } finally {
                corpus.close();
            }
        });

        it("spends no model call on a failed retrieval", async () => {
            const { requests } = serve({ content: "Plot twelve." });
            const corpus = await openCorpus(workEnv(work));
            try {
                const { questions } = await readQuestions(work);
                const config = await readEvalConfig(work);
                const info = newRunInfo(
                    { ...settings, systems: ["broken"] },
                    questions,
                    config,
                    await readSnapshot(work),
                    new Date("2026-10-19T01:00:00.000Z"),
                );
                await runEvaluation(info, {
                    work,
                    corpus,
                    questions,
                    models: new Models(config, { env: {}, retryMs: 1 }),
                    concurrency: 1,
                    systems: [
                        {
                            name: "broken",
                            retrieve: async () => {
                                throw new Error("down");
                            },
                        },
                    ],
                });
                expect(requests).toHaveLength(0);
                const records = await readRecords(work, info.id);
                expect(records).toHaveLength(5);
                expect(
                    records.every(
                        (each) =>
                            each.retrieval.error === "down" &&
                            each.answer === null,
                    ),
                ).toBe(true);
            } finally {
                corpus.close();
            }
        });
    });
});
