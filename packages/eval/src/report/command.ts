// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/report/command.ts
//
//

import { readFile, writeFile } from "node:fs/promises";
import { type Command, workOf } from "../command.js";
import { UsageError } from "../errors.js";
import {
    checkRunId,
    readRecords,
    readRunInfo,
    reportPath,
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
    await writeFile(
        summaryPath(work, id),
        `${JSON.stringify(summary, null, 4)}\n`,
        { mode: 0o600 },
    );
    await writeFile(reportPath(work, id), reportOf(summary), { mode: 0o600 });
    return summary;
}

async function readSummary(work: string, id: string): Promise<Summary> {
    try {
        return JSON.parse(await readFile(summaryPath(work, id), "utf8"));
    } catch {
        throw new UsageError(
            `run ${id} has no summary: finish it with \`bun run eval -- run --work ${work} --resume ${id}\``,
        );
    }
}

export const compareCommand: Command = {
    summary: "compare two runs' summaries",
    options: { work: { type: "string" } },
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
        io.out(compareOf(a, b));
        return 0;
    },
};
