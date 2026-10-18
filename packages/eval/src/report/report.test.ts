// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/report/report.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runCli } from "../cli.js";
import {
    type RunInfo,
    type RunRecord,
    recordsPath,
    reportPath,
    runDir,
    runInfoPath,
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
            "| dorothy | 50.0% (1/2) | 50.0% (1/2) | 100.0% (2/2) |",
        );
        expect(text).toContain("### abstention");
        expect(text).toContain("answering answer/model, judging judge/model");
        expect(text).toContain("| n/a |");
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

    const write = (id: string) => {
        mkdirSync(runDir(temp.root, id), { recursive: true });
        writeFileSync(runInfoPath(temp.root, id), JSON.stringify(info(id)));
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
        const { io, out } = fakeIo();
        expect(
            await runCli(["compare", "--work", temp.root, "r1", "r2"], io),
        ).toBe(0);
        expect(out.join("")).toContain("Comparing r1 with r2");
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
