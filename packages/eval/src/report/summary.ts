// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/report/summary.ts
//
//

// A run's records counted: each rate over the records that have it, by
// system, overall and by type.

import type { QuestionType } from "../questions/file.js";
import type { RunInfo, RunRecord } from "../run/record.js";
import { baseOf } from "../systems/system.js";

export type Rate = { hits: number; of: number };
export type Cell = {
    n: number;
    strict: Rate;
    lenient: Rate;
    at5: Rate;
    at10: Rate;
    // Anywhere in the ranked ids, as full's are what fitted; null where a
    // record was written before it was kept.
    inContext: Rate | null;
    // The retrieval stages, null where a record lacks them: whether the
    // engine's hits held the evidence, whether it went into the context
    // opened, and the share of the gold answer's terms it held (its sum,
    // and how many held every term), for answers that have terms.
    found: Rate | null;
    delivered: Rate | null;
    covered: { total: number; full: Rate } | null;
    // Of abstentions, those declined; of the rest, those declined wrongly.
    declined: Rate;
    wronglyDeclined: Rate;
    // Of updates, those that gave the older answer.
    stale: Rate;
    // Means.
    retrievalMs: number;
    chars: number;
    // Of the answered.
    answerMs: number;
    answered: number;
    // Sums.
    input: number;
    output: number;
    failures: number;
};
export type SystemSummary = {
    all: Cell;
    byType: Partial<Record<QuestionType, Cell>>;
    alone: { right: string[]; wrong: string[] };
};
export type Summary = { run: RunInfo; systems: Record<string, SystemSummary> };

const rate = (): Rate => ({ hits: 0, of: 0 });
const emptyCell = (): Cell => ({
    n: 0,
    strict: rate(),
    lenient: rate(),
    at5: rate(),
    at10: rate(),
    inContext: rate(),
    found: rate(),
    delivered: rate(),
    covered: { total: 0, full: rate() },
    declined: rate(),
    wronglyDeclined: rate(),
    stale: rate(),
    retrievalMs: 0,
    chars: 0,
    answerMs: 0,
    answered: 0,
    input: 0,
    output: 0,
    failures: 0,
});

// A verdict the run owed but lacks (the retrieval, answer or judgement
// failed) counts as a miss, so a flaky system does not score higher; one
// not owed is left out of the rate.
function tally(into: Rate, value: boolean | null, owed = false): void {
    if (value !== null) {
        into.of++;
        into.hits += value ? 1 : 0;
    } else if (owed) {
        into.of++;
    }
}

// Whether a record owes a strict verdict: a run that judges owes one to
// every question with a reference answer.
const graded = (record: RunRecord, judging: boolean) =>
    judging && record.type !== "lookup" && record.type !== "abstention";

// A record lacking a stage makes the cell's value for it null for good;
// a failed retrieval counts as a miss in found and delivered, as an
// unjudged verdict does, and its covered is tallied like any other.
function addStages(cell: Cell, record: RunRecord): void {
    const { recall } = record;
    if (recall === null) {
        return;
    }
    const failed = record.retrieval.error !== null;
    for (const stage of ["found", "delivered"] as const) {
        const rate = cell[stage];
        if (rate === null) {
            continue;
        }
        if (failed) {
            rate.of++;
        } else if (recall[stage] === undefined) {
            cell[stage] = null;
        } else {
            tally(rate, recall[stage]);
        }
    }
    if (cell.covered === null) {
        return;
    }
    if (recall.covered === undefined) {
        cell.covered = null;
    } else if (recall.covered !== null) {
        cell.covered.total += recall.covered;
        tally(cell.covered.full, recall.covered === 1);
    }
}

function add(cell: Cell, record: RunRecord, judging: boolean): void {
    cell.n++;
    tally(cell.strict, record.judged.strict, graded(record, judging));
    tally(cell.lenient, record.judged.lenient, graded(record, judging));
    tally(cell.at5, record.recall?.at5 ?? null);
    tally(cell.at10, record.recall?.at10 ?? null);
    if (record.recall !== null && record.recall.inContext === undefined) {
        cell.inContext = null;
    } else if (cell.inContext !== null) {
        tally(cell.inContext, record.recall?.inContext ?? null);
    }
    addStages(cell, record);
    tally(
        record.type === "abstention" ? cell.declined : cell.wronglyDeclined,
        record.judged.declined,
        judging && record.type === "abstention",
    );
    tally(cell.stale, record.judged.stale);
    cell.retrievalMs += record.retrieval.ms;
    cell.chars += record.retrieval.chars;
    cell.answerMs += record.answer?.ms ?? 0;
    cell.answered += record.answer === null ? 0 : 1;
    cell.input += record.answer?.input ?? 0;
    cell.output += record.answer?.output ?? 0;
    cell.failures +=
        record.failures.length + (record.retrieval.error === null ? 0 : 1);
}

// Sums of time and characters become means.
function settle(cell: Cell): Cell {
    return cell.n === 0
        ? cell
        : {
              ...cell,
              retrievalMs: Math.round(cell.retrievalMs / cell.n),
              chars: Math.round(cell.chars / cell.n),
              answerMs:
                  cell.answered === 0
                      ? 0
                      : Math.round(cell.answerMs / cell.answered),
          };
}

export function summarise(info: RunInfo, records: RunRecord[]): Summary {
    const systems: Record<string, SystemSummary> = {};
    const judging = !info.retrievalOnly;
    const cells = new Map<
        string,
        { all: Cell; byType: Map<QuestionType, Cell> }
    >();
    for (const name of info.systems) {
        cells.set(name, { all: emptyCell(), byType: new Map() });
    }
    // Each question's strict verdict by system, for what one alone got:
    // of every system that owed one, a failure counting as a miss, as it
    // does in the rates.
    const verdicts = new Map<string, Map<string, boolean>>();
    for (const record of records) {
        const cell = cells.get(record.system);
        if (cell === undefined) {
            continue;
        }
        add(cell.all, record, judging);
        const byType = cell.byType.get(record.type) ?? emptyCell();
        add(byType, record, judging);
        cell.byType.set(record.type, byType);
        if (graded(record, judging) && baseOf(record.system) !== "cited") {
            const of = verdicts.get(record.question) ?? new Map();
            of.set(record.system, record.judged.strict === true);
            verdicts.set(record.question, of);
        }
    }
    for (const [name, cell] of cells) {
        systems[name] = {
            all: settle(cell.all),
            byType: Object.fromEntries(
                [...cell.byType].map(([type, each]) => [type, settle(each)]),
            ),
            alone: { right: [], wrong: [] },
        };
    }
    for (const [question, of] of [...verdicts].sort(([a], [b]) =>
        a < b ? -1 : 1,
    )) {
        if (of.size < 2) {
            continue;
        }
        const right = [...of].filter(([, strict]) => strict);
        const wrong = [...of].filter(([, strict]) => !strict);
        if (right.length === 1) {
            systems[right[0]?.[0] as string]?.alone.right.push(question);
        }
        if (wrong.length === 1) {
            systems[wrong[0]?.[0] as string]?.alone.wrong.push(question);
        }
    }
    return { run: info, systems };
}
