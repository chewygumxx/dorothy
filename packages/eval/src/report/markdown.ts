// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/report/markdown.ts
//
//

// A run's report, and two runs compared, as Markdown. Every rate goes
// with its counts: some types hold few questions.

import { QUESTION_TYPES } from "../questions/file.js";
import type { Cell, Rate, Summary } from "./summary.js";

export const ADOPTION_RULE = [
    "Adoption rule: a provider is adopted only if its strict accuracy beats",
    "Dorothy improved's by 10 points on these questions, it passes both of",
    "the note's checks (a corrected memory survives a re-ingest; two clients",
    "write while a second machine reads), and it holds with the smaller",
    "ingest model.",
].join("\n");

export const percent = (rate: Rate) =>
    rate.of === 0
        ? "n/a"
        : `${((100 * rate.hits) / rate.of).toFixed(1)}% (${rate.hits}/${rate.of})`;

const ACCURACY = [
    "| System | Strict | Lenient | Recall@5 | Recall@10 | In context | Abstained | Declined wrongly | Older answer |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
];
// In context is a dash for records written before it was kept.
const accuracyRow = (name: string, cell: Cell) =>
    `| ${name} | ${[
        cell.strict,
        cell.lenient,
        cell.at5,
        cell.at10,
        cell.inContext,
        cell.declined,
        cell.wronglyDeclined,
        cell.stale,
    ]
        .map((each) => (each === null ? "-" : percent(each)))
        .join(" | ")} |`;

export function reportOf(summary: Summary): string {
    const { run } = summary;
    const models = run.retrievalOnly
        ? "retrieval alone, with no model"
        : `answering ${run.models.answer}, judging ${run.models.judge}`;
    const systems = Object.entries(summary.systems);
    const lines = [
        `# Memory evaluation ${run.id}`,
        "",
        `Run ${run.at}, of a snapshot of \`${run.snapshot.source}\` taken ${run.snapshot.at}: ${run.snapshot.conversations} conversations and ${run.snapshot.knowledge} knowledge files. ${run.questions} questions; a budget of ${run.budget} characters (${run.fullBudget} for full); ${models}.`,
        "",
        "## Overall",
        "",
        ...ACCURACY,
        ...systems.map(([name, each]) => accuracyRow(name, each.all)),
        "",
        "## By type",
    ];
    for (const type of QUESTION_TYPES) {
        const rows = systems.flatMap(([name, each]) => {
            const cell = each.byType[type];
            return cell === undefined ? [] : [accuracyRow(name, cell)];
        });
        if (rows.length > 0) {
            lines.push("", `### ${type}`, "", ...ACCURACY, ...rows);
        }
    }
    lines.push(
        "",
        "## Cost",
        "",
        "| System | Retrieval ms | Characters | Answer ms | Input tokens | Output tokens | Failures |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        ...systems.map(
            ([name, { all }]) =>
                `| ${name} | ${all.retrievalMs} | ${all.chars} | ${all.answerMs} | ${all.input} | ${all.output} | ${all.failures} |`,
        ),
        "",
        "## Alone",
        "",
    );
    const alone = systems.flatMap(([name, { alone: split }]) => [
        ...(split.right.length === 0
            ? []
            : [`- ${name} alone right: ${split.right.join(", ")}`]),
        ...(split.wrong.length === 0
            ? []
            : [`- ${name} alone wrong: ${split.wrong.join(", ")}`]),
    ]);
    lines.push(
        ...(alone.length === 0 ? ["No question split the systems so."] : alone),
        "",
    );
    return lines.join("\n");
}

// A difference smaller than two questions of its kind is marked noise.
function difference(a: Rate, b: Rate): string {
    const of = Math.min(a.of, b.of);
    if (a.of === 0 || b.of === 0) {
        return "n/a";
    }
    const points = (100 * b.hits) / b.of - (100 * a.hits) / a.of;
    const sign = points > 0 ? "+" : "";
    const noise = Math.abs(points) < 200 / of ? " (noise)" : "";
    return `${sign}${points.toFixed(1)} points${noise}`;
}

export function compareOf(a: Summary, b: Summary): string {
    const lines = [
        `Comparing ${a.run.id} with ${b.run.id}`,
        "",
        "| System | Type | Strict before | Strict after | Difference |",
        "| --- | --- | --- | --- | --- |",
    ];
    const shared = Object.keys(a.systems).filter((name) => name in b.systems);
    for (const name of shared) {
        const [before, after] = [a.systems[name], b.systems[name]];
        if (before === undefined || after === undefined) {
            continue;
        }
        const rows: [string, Cell | undefined, Cell | undefined][] = [
            ["all", before.all, after.all],
            ...QUESTION_TYPES.map(
                (type) =>
                    [type, before.byType[type], after.byType[type]] as [
                        string,
                        Cell | undefined,
                        Cell | undefined,
                    ],
            ),
        ];
        for (const [type, x, y] of rows) {
            if (
                x !== undefined &&
                y !== undefined &&
                x.strict.of + y.strict.of > 0
            ) {
                lines.push(
                    `| ${name} | ${type} | ${percent(x.strict)} | ${percent(y.strict)} | ${difference(x.strict, y.strict)} |`,
                );
            }
        }
    }
    const only = [
        ...Object.keys(a.systems)
            .filter((name) => !(name in b.systems))
            .map((name) => `${name} only in ${a.run.id}`),
        ...Object.keys(b.systems)
            .filter((name) => !(name in a.systems))
            .map((name) => `${name} only in ${b.run.id}`),
    ];
    lines.push(
        "",
        ...(only.length === 0 ? [] : [`Not compared: ${only.join("; ")}.`, ""]),
        "A difference smaller than two questions' worth of its type is marked noise.",
        "",
        ADOPTION_RULE,
        "",
    );
    return lines.join("\n");
}
