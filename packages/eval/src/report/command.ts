// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/report/command.ts
//
//

import { type Command, workOf } from "../command.js";
import { UsageError } from "../errors.js";
import { readRecord, writeAtomic } from "../files.js";
import {
    checkRunId,
    readRecords,
    readRunInfo,
    reportPath,
    runInfoSchema,
    summaryPath,
} from "../run/record.js";
import { compareOf, reportOf } from "./markdown.js";
import { type Summary, summarise } from "./summary.js";

export async function writeRunReport(
    work: string,
    id: string,
): Promise<Summary> {
    const summary = summarise(
        await readRunInfo(work, id),
        await readRecords(work, id),
    );
    await writeAtomic(
        summaryPath(work, id),
        `${JSON.stringify(summary, null, 4)}\n`,
    );
    await writeAtomic(reportPath(work, id), reportOf(summary));
    return summary;
}

// Whether two runs asked the same questions of the same snapshot, without
// which a difference's noise mark means little.
function alike(a: Summary, b: Summary): boolean {
    const ids = (summary: Summary) =>
        JSON.stringify([...summary.run.questionIds].sort());
    return a.run.snapshot.at === b.run.snapshot.at && ids(a) === ids(b);
}

const isTable = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// Only a summary not yet written is "unfinished"; one that cannot be read
// or is no summary is said so.
const readSummary = (work: string, id: string): Promise<Summary> =>
    readRecord(summaryPath(work, id), {
        missing: `run ${id} has no summary: finish it with \`bun run eval -- run --work ${work} --resume ${id}\``,
        what: "a summary",
        again: `write it again with \`bun run eval -- run --work ${work} --resume ${id}\``,
        check: (read) => {
            if (!isTable(read) || !isTable(read.systems)) {
                return "it lacks run or systems";
            }
            const run = runInfoSchema.safeParse(read.run);
            return run.success
                ? (read as unknown as Summary)
                : `run.${run.error.issues[0]?.path.join(".") || "run"}: ${run.error.issues[0]?.message}`;
        },
    });

export const compareCommand: Command = {
    summary: "compare two runs' summaries",
    args: "<run> <run>",
    options: {
        work: { type: "string", description: "the evaluation's directory" },
    },
    async run(values, positionals, io) {
        const work = workOf(values);
        const [first, second] = positionals;
        if (
            first === undefined ||
            second === undefined ||
            positionals.length > 2
        ) {
            throw new UsageError(
                "give two run ids: compare --work <dir> <run> <run>",
            );
        }
        const a = await readSummary(work, checkRunId(first));
        const b = await readSummary(work, checkRunId(second));
        if (!alike(a, b)) {
            io.err(
                `eval: ${a.run.id} and ${b.run.id} differ in their snapshot or questions; the noise mark then means little\n`,
            );
        }
        io.out(compareOf(a, b));
        return 0;
    },
};
