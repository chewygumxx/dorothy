// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/report/report.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    appendFileSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { runCli } from "../cli.js";
import {
    type RunInfo,
    type RunRecord,
    readRecords,
    recordsPath,
    reportPath,
    runDir,
    runInfoPath,
    summaryPath,
} from "../run/record.js";
import { fakeIo, tempRoot } from "../testing.js";
import { writeRunReport } from "./command.js";
import { compareOf, percent, reportOf } from "./markdown.js";
import { summarise } from "./summary.js";

const info = (id: string): RunInfo => ({
    id,
    at: "2026-10-19T01:00:00.000Z",
    systems: ["dorothy", "lexical"],
    budget: 8000,
    fullBudget: 400_000,
    retrievalOnly: false,
    models: { answer: "answer/model", judge: "judge/model" },
    snapshot: {
        source: "/data",
        at: "2026-10-18T00:00:00.000Z",
        conversations: 4,
        knowledge: 3,
    },
    questions: 3,
    questionIds: ["q-1", "q-2", "q-3"],
});

const record = (
    question: string,
    system: string,
    fields: Partial<RunRecord> = {},
): RunRecord => ({
    question,
    system,
    type: "single-session",
    retrieval: { ranked: [], chars: 100, ms: 10, error: null },
    recall: { at5: true, at10: true },
    answer: { text: "An answer.", input: 50, output: 5, ms: 20 },
    judged: { strict: true, lenient: true, declined: false, stale: null },
    failures: [],
    ...fields,
});

const RECORDS: RunRecord[] = [
    record("q-1", "dorothy"),
    record("q-1", "lexical", {
        recall: { at5: false, at10: true },
        judged: { strict: false, lenient: true, declined: false, stale: null },
    }),
    record("q-2", "dorothy", {
        type: "abstention",
        recall: null,
        judged: { strict: null, lenient: null, declined: true, stale: null },
    }),
    record("q-2", "lexical", {
        type: "abstention",
        recall: null,
        judged: { strict: null, lenient: null, declined: false, stale: null },
    }),
    record("q-3", "dorothy", {
        type: "knowledge-update",
        judged: { strict: false, lenient: false, declined: true, stale: true },
        retrieval: { ranked: [], chars: 300, ms: 30, error: null },
    }),
    record("q-3", "lexical", {
        type: "knowledge-update",
        recall: { at5: false, at10: false },
        retrieval: { ranked: [], chars: 0, ms: 0, error: "down" },
        answer: null,
        judged: { strict: null, lenient: null, declined: null, stale: null },
        failures: ["answer: 500 refused"],
    }),
];

describe("a summary", () => {
    const summary = summarise(info("r1"), RECORDS);
    const dorothy = summary.systems.dorothy;
    const lexical = summary.systems.lexical;

    it("counts each rate over the records that have it", () => {
        expect(dorothy?.all.strict).toEqual({ hits: 1, of: 2 });
        expect(dorothy?.all.at5).toEqual({ hits: 2, of: 2 });
        expect(dorothy?.all.declined).toEqual({ hits: 1, of: 1 });
        expect(dorothy?.all.wronglyDeclined).toEqual({ hits: 1, of: 2 });
        expect(dorothy?.all.stale).toEqual({ hits: 1, of: 1 });
        expect(lexical?.all.at5).toEqual({ hits: 0, of: 2 });
        expect(lexical?.all.failures).toBe(2);
    });

    it("counts a failed question as a miss, unless nothing was judged", () => {
        expect(lexical?.all.strict).toEqual({ hits: 0, of: 2 });
        expect(lexical?.byType["knowledge-update"]?.strict).toEqual({
            hits: 0,
            of: 1,
        });
        const retrieval = summarise(
            { ...info("r1"), retrievalOnly: true },
            RECORDS,
        );
        expect(retrieval.systems.lexical?.all.strict).toEqual({
            hits: 0,
            of: 1,
        });
    });

    it("averages retrieval and sums tokens", () => {
        expect(dorothy?.all.n).toBe(3);
        expect(dorothy?.all.retrievalMs).toBe(17);
        expect(dorothy?.all.chars).toBe(167);
        expect(dorothy?.all.input).toBe(150);
    });

    it("splits by type", () => {
        expect(dorothy?.byType.abstention?.declined).toEqual({
            hits: 1,
            of: 1,
        });
        expect(dorothy?.byType["single-session"]?.strict).toEqual({
            hits: 1,
            of: 1,
        });
    });

    it("names what one system alone got right or wrong", () => {
        expect(dorothy?.alone.right).toEqual(["q-1"]);
        expect(lexical?.alone.wrong).toEqual(["q-1"]);
    });

    it("counts a failed system's question as missed, as the rates do", () => {
        const three = {
            ...info("r1"),
            systems: ["dorothy", "lexical", "full"],
        };
        const failed = record("q-5", "full", {
            answer: null,
            judged: {
                strict: null,
                lenient: null,
                declined: null,
                stale: null,
            },
            failures: ["answer: 500 refused"],
        });
        const split = summarise(three, [
            record("q-5", "dorothy"),
            record("q-5", "lexical", {
                judged: {
                    strict: false,
                    lenient: false,
                    declined: false,
                    stale: null,
                },
            }),
            failed,
        ]).systems;
        // full missed it too, so lexical is not alone in missing it.
        expect(split.dorothy?.alone.right).toEqual(["q-5"]);
        expect(split.lexical?.alone.wrong).toEqual([]);
        expect(split.full?.all.strict).toEqual({ hits: 0, of: 1 });
        // Of two, the one that failed alone missed it.
        const two = summarise(info("r1"), [
            record("q-5", "dorothy"),
            { ...failed, system: "lexical" },
        ]).systems;
        expect(two.dorothy?.alone.right).toEqual(["q-5"]);
        expect(two.lexical?.alone.wrong).toEqual(["q-5"]);
        // A run that judged nothing names nothing.
        const retrieval = summarise({ ...three, retrievalOnly: true }, [
            { ...failed, system: "dorothy" },
            record("q-5", "lexical", {
                answer: null,
                judged: {
                    strict: null,
                    lenient: null,
                    declined: null,
                    stale: null,
                },
            }),
        ]).systems;
        expect(retrieval.dorothy?.alone).toEqual({ right: [], wrong: [] });
        expect(retrieval.lexical?.alone).toEqual({ right: [], wrong: [] });
    });
});

describe("the report", () => {
    it("gives rates with their counts, and n/a for none", () => {
        expect(percent({ hits: 1, of: 2 })).toBe("50.0% (1/2)");
        expect(percent({ hits: 0, of: 0 })).toBe("n/a");
    });

    it("tables each system, overall and by type", () => {
        const text = reportOf(summarise(info("r1"), RECORDS));
        expect(text).toStartWith("# Memory evaluation r1\n");
        expect(text).toContain(
            "| dorothy | 50.0% (1/2) | 50.0% (1/2) | - | 100.0% (2/2) |",
        );
        expect(text).toContain("### abstention");
        expect(text).toContain("answering answer/model, judging judge/model");
        expect(text).toContain("| n/a |");
    });

    it("reports role totals separately from the per-system answer costs", () => {
        const run = {
            ...info("r1"),
            tokens: {
                answer: { input: 150, output: 15 },
                judge: { input: 600, output: 60 },
            },
        };
        const text = reportOf(summarise(run, RECORDS));
        expect(text).toContain("## Tokens by role");
        expect(text).toContain("| Role | Input tokens | Output tokens |");
        expect(text).toContain("| answer | 150 | 15 |");
        expect(text).toContain("| judge | 600 | 60 |");
        expect(text).not.toContain("| generate |");
    });

    it("does not invent role totals for an older run", () => {
        expect(reportOf(summarise(info("r1"), RECORDS))).toContain(
            "Role token totals were not recorded for this run.",
        );
    });

    it("shows whether the evidence was in context, or a dash before", () => {
        const text = reportOf(
            summarise(info("r1"), [
                ...RECORDS,
                record("q-4", "lexical", {
                    type: "temporal",
                    recall: { at5: false, at10: false, inContext: true },
                }),
            ]),
        );
        expect(text).toContain(
            "| Recall@10 | Delivered | Delivered or noted |",
        );
        // The rest were written before it was kept.
        expect(text).toContain(
            "| dorothy | 50.0% (1/2) | 50.0% (1/2) | - | 100.0% (2/2) | 100.0% (2/2) | - | - | - |",
        );
        expect(text).toContain(
            "| lexical | 100.0% (1/1) | 100.0% (1/1) | - | 0.0% (0/1) | 0.0% (0/1) | - | 100.0% (1/1) | - |",
        );
    });

    it("heads each table by stage, with covered by mean and whole", () => {
        const staged = (
            question: string,
            covered: number | null,
            found = true,
            delivered = true,
        ) =>
            record(question, "dorothy", {
                recall: { at5: true, at10: true, found, delivered, covered },
            });
        const text = reportOf(
            summarise({ ...info("r1"), systems: ["dorothy"] }, [
                staged("a", 1),
                staged("b", 1),
                staged("c", 1),
                staged("d", 0.5, true, false),
                staged("e", 0, false, false),
                staged("f", 1),
                staged("g", 0.5),
                staged("h", 0),
                staged("skipped", null),
            ]),
        );
        expect(text).toContain(
            "| System | Strict | Lenient | Found | Recall@5 | Recall@10 | Delivered | Delivered or noted | Covered | Abstained | Declined wrongly | Older answer |",
        );
        // Of 8 answers with terms: 4 held whole, the shares summing to 5.
        expect(text).toContain(
            "| 88.9% (8/9) | 100.0% (9/9) | 100.0% (9/9) | 77.8% (7/9) | - | 62.5% (4/8 whole) |",
        );
    });

    it("counts a failed retrieval a miss in each stage", () => {
        const failed = (question: string, answer: boolean) =>
            record(question, "dorothy", {
                retrieval: { ranked: [], chars: 0, ms: 0, error: "down" },
                recall: {
                    at5: false,
                    at10: false,
                    covered: answer ? 0 : null,
                },
            });
        const cell = summarise({ ...info("r1"), systems: ["dorothy"] }, [
            record("a", "dorothy", {
                recall: {
                    at5: true,
                    at10: true,
                    found: true,
                    delivered: true,
                    covered: 1,
                },
            }),
            failed("b", true),
            // A lookup has no answer: out of coverage, failed or not.
            failed("c", false),
        ]).systems.dorothy?.all;
        expect(cell?.found).toEqual({ hits: 1, of: 3 });
        expect(cell?.delivered).toEqual({ hits: 1, of: 3 });
        expect(cell?.covered).toEqual({ total: 1, full: { hits: 1, of: 2 } });
    });

    it("leaves a stage null for a system whose records lack it", () => {
        const cell = summarise(info("r1"), RECORDS).systems.dorothy?.all;
        expect(cell?.found).toBeNull();
        expect(cell?.delivered).toBeNull();
        expect(cell?.covered).toBeNull();
    });

    it("says cited is a ceiling, and never has it alone", () => {
        const run = { ...info("r1"), systems: ["dorothy", "cited:x"] };
        const records = [
            record("q-1", "dorothy", {
                judged: {
                    strict: false,
                    lenient: false,
                    declined: false,
                    stale: null,
                },
            }),
            record("q-1", "cited"),
        ];
        const text = reportOf(summarise(run, records));
        expect(text).toContain(
            "cited is given each question's evidence: a ceiling, not a contender.",
        );
        expect(reportOf(summarise(info("r1"), RECORDS))).not.toContain(
            "a ceiling",
        );
        const { systems } = summarise(
            { ...info("r1"), systems: ["dorothy", "cited"] },
            records,
        );
        expect(systems.cited?.alone).toEqual({ right: [], wrong: [] });
        expect(systems.dorothy?.alone).toEqual({ right: [], wrong: [] });
        expect(text).not.toContain("cited alone");
    });

    it("says a run without models asked none", () => {
        const text = reportOf(
            summarise(
                {
                    ...info("r1"),
                    retrievalOnly: true,
                    models: { answer: null, judge: null },
                },
                RECORDS,
            ),
        );
        expect(text).toContain("; retrieval alone, with no model.");
        expect(text).not.toContain("answering");
    });

    it("names the systems only one run has, and compares the rest", () => {
        const before = summarise(info("r1"), RECORDS);
        const after = summarise(
            { ...info("r2"), systems: ["dorothy", "full"] },
            [
                ...RECORDS.filter((each) => each.system === "dorothy"),
                record("q-1", "full"),
            ],
        );
        const text = compareOf(before, after);
        expect(text).toContain(
            "Not compared: lexical only in r1; full only in r2.",
        );
        expect(text).toContain("| dorothy | all |");
        expect(text).not.toContain("| lexical |");
        expect(compareOf(before, before)).not.toContain("Not compared");
    });

    it("marks no noise on a difference of more than two questions", () => {
        const many = (strict: boolean, n: number) =>
            Array.from({ length: n }, (_, at) =>
                record(`q-${at}`, "dorothy", {
                    judged: {
                        strict,
                        lenient: strict,
                        declined: false,
                        stale: null,
                    },
                }),
            );
        const run = (id: string, strict: boolean) =>
            summarise({ ...info(id), systems: ["dorothy"] }, many(strict, 20));
        const text = compareOf(run("r1", false), run("r2", true));
        expect(text).toContain(
            "| dorothy | all | 0.0% (0/20) | 100.0% (20/20) | +100.0 points |",
        );
        expect(text).not.toContain("(noise)");
        // No difference at all is still inside the noise.
        expect(compareOf(run("r1", true), run("r2", true))).toContain(
            "0.0 points (noise)",
        );
    });

    it("compares two runs, marking what two questions could undo", () => {
        const before = summarise(info("r1"), RECORDS);
        const after = summarise(info("r2"), [
            ...RECORDS.filter((each) => each.question !== "q-1"),
            record("q-1", "dorothy", {
                judged: {
                    strict: false,
                    lenient: true,
                    declined: false,
                    stale: null,
                },
            }),
            record("q-1", "lexical"),
        ]);
        const text = compareOf(before, after);
        expect(text).toContain("Comparing r1 with r2");
        expect(text).toContain(
            "| dorothy | all | 50.0% (1/2) | 0.0% (0/2) | -50.0 points (noise) |",
        );
        expect(text).toContain("Adoption rule:");
    });
});

describe("bun run eval -- compare", () => {
    let temp: ReturnType<typeof tempRoot>;
    beforeEach(() => {
        temp = tempRoot("report");
    });
    afterEach(() => temp.remove());

    const write = (id: string, fields: Partial<RunInfo> = {}) => {
        mkdirSync(runDir(temp.root, id), { recursive: true });
        writeFileSync(
            runInfoPath(temp.root, id),
            JSON.stringify({ ...info(id), ...fields }),
        );
        writeFileSync(
            recordsPath(temp.root, id),
            RECORDS.map((each) => `${JSON.stringify(each)}\n`).join(""),
        );
    };

    it("writes a run's report, then compares two", async () => {
        write("r1");
        write("r2");
        await writeRunReport(temp.root, "r1");
        await writeRunReport(temp.root, "r2");
        expect(readFileSync(reportPath(temp.root, "r1"), "utf8")).toContain(
            "# Memory evaluation r1",
        );
        const { io, out, err } = fakeIo();
        expect(
            await runCli(["compare", "--work", temp.root, "r1", "r2"], io),
        ).toBe(0);
        expect(out.join("")).toContain("Comparing r1 with r2");
        expect(err.join("")).toBe("");
    });

    it("warns when the runs differ in snapshot or questions", async () => {
        write("r1");
        write("r2", {
            snapshot: {
                ...info("r2").snapshot,
                at: "2026-10-19T00:00:00.000Z",
            },
        });
        write("r3", { questionIds: ["q-1", "q-2", "q-4"] });
        // The same questions in another order are the same set.
        write("r4", { questionIds: ["q-3", "q-2", "q-1"] });
        for (const id of ["r1", "r2", "r3", "r4"]) {
            await writeRunReport(temp.root, id);
        }
        for (const [other, warned] of [
            ["r2", true],
            ["r3", true],
            ["r4", false],
        ] as const) {
            const { io, out, err } = fakeIo();
            expect(
                await runCli(["compare", "--work", temp.root, "r1", other], io),
            ).toBe(0);
            expect(out.join("")).toContain(`Comparing r1 with ${other}`);
            expect(err.join("")).toBe(
                warned
                    ? `eval: r1 and ${other} differ in their snapshot or questions; the noise mark then means little\n`
                    : "",
            );
        }
    });

    it("warns when one id stands for two definitions", async () => {
        const ids = { q1: "a1", q2: "b1", q3: "c1" };
        write("r1", { definitions: ids });
        write("r2", { definitions: { ...ids, q2: "b2" } });
        write("r3", { definitions: { ...ids } });
        // A run that kept none is held to its ids.
        write("r4");
        for (const id of ["r1", "r2", "r3", "r4"]) {
            await writeRunReport(temp.root, id);
        }
        for (const [other, warned] of [
            ["r2", true],
            ["r3", false],
            ["r4", false],
        ] as const) {
            const { io, err } = fakeIo();
            await runCli(["compare", "--work", temp.root, "r1", other], io);
            expect(err.join("") !== "").toBe(warned);
        }
    });

    it("refuses damaged token totals instead of reporting them", async () => {
        write("r1");
        const path = runInfoPath(temp.root, "r1");
        const run = JSON.parse(readFileSync(path, "utf8"));
        for (const tokens of [
            { judge: { input: -1, output: 2 } },
            { judge: { input: "one", output: 2 } },
            { unknown: { input: 1, output: 2 } },
        ]) {
            writeFileSync(path, JSON.stringify({ ...run, tokens }));
            await expect(writeRunReport(temp.root, "r1")).rejects.toThrow(
                "tokens",
            );
        }
    });

    it("persists role tokens in the report and summary", async () => {
        write("r1", {
            tokens: {
                answer: { input: 33, output: 21 },
                judge: { input: 66, output: 42 },
            },
        });
        await writeRunReport(temp.root, "r1");
        expect(
            JSON.parse(readFileSync(summaryPath(temp.root, "r1"), "utf8")).run
                .tokens,
        ).toEqual({
            answer: { input: 33, output: 21 },
            judge: { input: 66, output: 42 },
        });
        expect(readFileSync(reportPath(temp.root, "r1"), "utf8")).toContain(
            "| judge | 66 | 42 |",
        );
    });

    it("passes over a torn last line, as a resume does", async () => {
        write("r1");
        appendFileSync(
            recordsPath(temp.root, "r1"),
            '{"question": "q-9", "sys',
        );
        const summary = await writeRunReport(temp.root, "r1");
        expect(summary.systems.dorothy?.all.n).toBe(3);
        expect(summary.systems.lexical?.all.n).toBe(3);
        expect(readFileSync(reportPath(temp.root, "r1"), "utf8")).toContain(
            "# Memory evaluation r1",
        );
    });

    it("passes over a line whose answer or recall is not as written", async () => {
        write("r1");
        const damaged = (id: string, fields: object) =>
            JSON.stringify({ ...record(id, "dorothy"), ...fields });
        const lines = [
            record("a", "dorothy", { answer: null, recall: null }),
            record("b", "dorothy", {
                recall: { at5: true, at10: true, inContext: false },
            }),
        ].map((each) => JSON.stringify(each));
        const spoilt = [
            damaged("c", { answer: undefined }),
            damaged("d", { recall: undefined }),
            damaged("e", { answer: { text: "x" } }),
            damaged("f", { answer: "x" }),
            damaged("g", { recall: { at5: true } }),
            damaged("h", { recall: { at5: true, at10: 1 } }),
            damaged("i", { recall: { at5: true, at10: true, inContext: 1 } }),
            damaged("j", { recall: [] }),
            damaged("k", { recall: { at5: true, at10: true, found: 1 } }),
            damaged("l", { recall: { at5: true, at10: true, covered: "x" } }),
        ];
        writeFileSync(
            recordsPath(temp.root, "r1"),
            [...lines, ...spoilt].map((line) => `${line}\n`).join(""),
        );
        expect(
            (await readRecords(temp.root, "r1")).map((each) => each.question),
        ).toEqual(["a", "b"]);
    });

    it("writes a report whole or leaves the old one", async () => {
        write("r1");
        await writeRunReport(temp.root, "r1");
        const before = readFileSync(reportPath(temp.root, "r1"), "utf8");
        // A summary that cannot be replaced stops the report too.
        rmSync(summaryPath(temp.root, "r1"));
        mkdirSync(join(summaryPath(temp.root, "r1"), "held"), {
            recursive: true,
        });
        await expect(writeRunReport(temp.root, "r1")).rejects.toThrow();
        expect(readFileSync(reportPath(temp.root, "r1"), "utf8")).toBe(before);
        expect(
            readdirSync(runDir(temp.root, "r1")).filter((name) =>
                name.includes("tmp"),
            ),
        ).toEqual([]);
    });

    it("tells a run that is missing from one that cannot be read", async () => {
        await expect(writeRunReport(temp.root, "r1")).rejects.toThrow(
            `no run r1 in ${join(temp.root, "runs")}`,
        );
        write("r1");
        rmSync(runInfoPath(temp.root, "r1"));
        mkdirSync(runInfoPath(temp.root, "r1"));
        await expect(writeRunReport(temp.root, "r1")).rejects.toThrow(
            `cannot read ${runInfoPath(temp.root, "r1")}: EISDIR`,
        );
        rmSync(runInfoPath(temp.root, "r1"), { recursive: true });
        writeFileSync(runInfoPath(temp.root, "r1"), '{"id": "r1"');
        await expect(writeRunReport(temp.root, "r1")).rejects.toThrow(
            `${runInfoPath(temp.root, "r1")} is not JSON`,
        );
        writeFileSync(runInfoPath(temp.root, "r1"), '{"id": "r1"}');
        await expect(writeRunReport(temp.root, "r1")).rejects.toThrow(
            `${runInfoPath(temp.root, "r1")} is not a run record`,
        );
    });

    it("refuses base URLs of the wrong form by the run file's message", async () => {
        write("r1");
        const path = runInfoPath(temp.root, "r1");
        const info = JSON.parse(readFileSync(path, "utf8"));
        for (const bad of [
            null,
            {},
            { answer: "x" },
            { answer: 1, judge: null },
        ]) {
            writeFileSync(path, JSON.stringify({ ...info, baseUrls: bad }));
            await expect(writeRunReport(temp.root, "r1")).rejects.toThrow(
                `${path} is not a run record (baseUrls`,
            );
        }
        // Absent, as an older run left it, or whole, it reads.
        for (const good of [
            undefined,
            { answer: null, judge: "http://h/v1" },
        ]) {
            writeFileSync(path, JSON.stringify({ ...info, baseUrls: good }));
            await writeRunReport(temp.root, "r1");
        }
    });

    it("never advises deleting a run whose run.json is bad", async () => {
        write("r1");
        const path = runInfoPath(temp.root, "r1");
        for (const bad of ['{"id": "r1"', "{}"]) {
            writeFileSync(path, bad);
            const error = await writeRunReport(temp.root, "r1").catch((e) => e);
            expect(error.message).toStartWith(path);
            expect(error.message).toEndWith(
                "start a new run (this run's records stay in records.jsonl)",
            );
            expect(error.message).not.toMatch(/remove|delete/i);
        }
        rmSync(path);
        mkdirSync(path);
        const unreadable = await writeRunReport(temp.root, "r1").catch(
            (e) => e,
        );
        expect(unreadable.message).toContain(
            "mend it, or start a new run (this run's records stay in records.jsonl)",
        );
        expect(unreadable.message).not.toMatch(/remove|delete/i);
        // Its records are where they were.
        expect(readFileSync(recordsPath(temp.root, "r1"), "utf8")).toContain(
            "q-1",
        );
    });

    it("does not read an unreadable records file as an empty run", async () => {
        write("r1");
        rmSync(recordsPath(temp.root, "r1"));
        mkdirSync(recordsPath(temp.root, "r1"));
        await expect(writeRunReport(temp.root, "r1")).rejects.toThrow(
            `cannot read ${recordsPath(temp.root, "r1")}: EISDIR`,
        );
        const records = await writeRunReport(temp.root, "r1").catch((e) => e);
        expect(records.message).not.toMatch(/remove|delete/i);
        rmSync(recordsPath(temp.root, "r1"), { recursive: true });
        // A run that has asked nothing yet has no records file.
        expect(
            (await writeRunReport(temp.root, "r1")).systems.dorothy?.all.n,
        ).toBe(0);
    });

    it("tells a summary that cannot be read from one not yet written", async () => {
        write("r1");
        await writeRunReport(temp.root, "r1");
        const path = summaryPath(temp.root, "r1");
        writeFileSync(path, "[1");
        const { io, err } = fakeIo();
        expect(
            await runCli(["compare", "--work", temp.root, "r1", "r1"], io),
        ).toBe(1);
        expect(err.join("")).toContain(`${path} is not JSON`);
        expect(err.join("")).not.toContain("has no summary");
        // Objects, but not a run: alike() would meet a TypeError.
        writeFileSync(path, '{"run": {}, "systems": {}}');
        const second = fakeIo();
        expect(
            await runCli(
                ["compare", "--work", temp.root, "r1", "r1"],
                second.io,
            ),
        ).toBe(1);
        expect(second.err.join("")).toContain(`${path} is not a summary`);
        rmSync(path);
        mkdirSync(path);
        const third = fakeIo();
        expect(
            await runCli(
                ["compare", "--work", temp.root, "r1", "r1"],
                third.io,
            ),
        ).toBe(1);
        expect(third.err.join("")).toContain(`cannot read ${path}: EISDIR`);
    });

    it("says how to finish a run with no summary", async () => {
        write("r1");
        const { io, err } = fakeIo();
        expect(
            await runCli(["compare", "--work", temp.root, "r1", "r1"], io),
        ).toBe(1);
        expect(err.join("")).toContain("--resume r1");
    });

    it("refuses a run id that could leave the runs directory", async () => {
        const { io, err } = fakeIo();
        expect(
            await runCli(["compare", "--work", temp.root, "../x", "r1"], io),
        ).toBe(1);
        expect(err.join("")).toContain("is no run id");
    });
});
