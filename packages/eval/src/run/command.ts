// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/run/command.ts
//
//

import { type Command, intOf, stringOf, workOf } from "../command.js";
import { UsageError } from "../errors.js";
import { Models } from "../models/client.js";
import {
    type EvalConfig,
    readEvalConfig,
    requireRole,
    vendorOf,
} from "../models/config.js";
import { readQuestions } from "../questions/file.js";
import { readSnapshot, workEnv } from "../snapshot/snapshot.js";
import { openCorpus } from "../systems/corpus.js";
import { SYSTEM_NAMES } from "../systems/system.js";
import { readRecords, readRunInfo, reportPath } from "./record.js";
import {
    checkResumable,
    modelCalls,
    newRunInfo,
    pendingOf,
    runEvaluation,
} from "./run.js";

function systemsOf(text: string): string[] {
    const names = [
        ...new Set(
            text
                .split(",")
                .map((name) => name.trim())
                .filter((name) => name !== ""),
        ),
    ];
    const unknown = names.find(
        (name) => !(SYSTEM_NAMES as readonly string[]).includes(name),
    );
    if (names.length === 0 || unknown !== undefined) {
        throw new UsageError(
            `--systems takes some of ${SYSTEM_NAMES.join(", ")}, comma-separated`,
        );
    }
    return names;
}

// What run.json holds, so a resume takes no other.
const SETTINGS = ["systems", "budget", "full-budget", "retrieval-only"];

export const runCommand: Command = {
    summary: "ask the accepted questions of each system, and report",
    options: {
        work: { type: "string", description: "the evaluation's directory" },
        systems: {
            type: "string",
            description: "the systems to ask, comma-separated; all by default",
        },
        budget: {
            type: "string",
            description: "characters each system may retrieve, 8000 by default",
        },
        "full-budget": {
            type: "string",
            description: "characters full may retrieve, 400000 by default",
        },
        "retrieval-only": {
            type: "boolean",
            description: "measure retrieval alone, with no model",
        },
        resume: {
            type: "string",
            description: "the id of a stopped run, to finish it",
        },
        concurrency: {
            type: "string",
            description: "questions asked at once, 4 by default",
        },
        "max-calls": {
            type: "string",
            description: "stop after this many model calls",
        },
        "dry-run": {
            type: "boolean",
            description: "count the model calls, and make none",
        },
    },
    async run(values, _positionals, io) {
        const work = workOf(values);
        const resume = stringOf(values, "resume");
        const given = SETTINGS.find((name) => values[name] !== undefined);
        if (resume !== null && given !== undefined) {
            throw new UsageError(
                `--${given} is the run's own on --resume: leave it out`,
            );
        }
        // Every run records its snapshot, and a resume checks it.
        const snapshot = await readSnapshot(work);
        const resumed =
            resume === null ? null : await readRunInfo(work, resume);
        const { questions, problems } = await readQuestions(work);
        for (const problem of problems) {
            io.err(`eval: skipped ${problem}\n`);
        }
        const accepted = questions.filter((q) => q.status === "accepted");
        const retrievalOnly =
            resumed?.retrievalOnly ?? values["retrieval-only"] === true;
        // A run that asks no model reads no eval.toml.
        const config: EvalConfig = retrievalOnly
            ? { generate: null, answer: null, judge: null }
            : await readEvalConfig(work);
        const info =
            resumed !== null
                ? resumed
                : newRunInfo(
                      {
                          systems: systemsOf(
                              stringOf(values, "systems") ??
                                  SYSTEM_NAMES.join(","),
                          ),
                          budget: intOf(values, "budget", 8000, 500, 1_000_000),
                          fullBudget: intOf(
                              values,
                              "full-budget",
                              400_000,
                              500,
                              10_000_000,
                          ),
                          retrievalOnly,
                      },
                      accepted,
                      config,
                      snapshot,
                      new Date(),
                  );
        if (resume !== null) {
            checkResumable(info, config, snapshot, accepted);
        }
        if (values["dry-run"] === true) {
            const asked = new Set(info.questionIds);
            const theirs = accepted.filter((q) => asked.has(q.id));
            const records =
                resume === null ? [] : await readRecords(work, info.id);
            const left =
                resume === null
                    ? ""
                    : `, ${pendingOf(info, theirs, records).length} left to ask`;
            io.out(
                `dry run: ${theirs.length} questions, ${info.systems.length} systems${left}; ${modelCalls(info, theirs, records)} model calls\n`,
            );
            return 0;
        }
        let models: Models | null = null;
        if (!info.retrievalOnly) {
            const answer = requireRole(config, "answer");
            const judge = requireRole(config, "judge");
            if (vendorOf(answer.model) === vendorOf(judge.model)) {
                io.err(
                    `eval: the judge (${judge.model}) is of the answering model's vendor; a model of another family judges more fairly\n`,
                );
            }
            models = new Models(config, {
                env: io.env,
                maxCalls:
                    values["max-calls"] === undefined
                        ? null
                        : intOf(values, "max-calls", 0, 1, 1_000_000),
            });
            // A missing key is said before anything is asked.
            models.chat("answer");
            models.chat("judge");
        }
        const corpus = await openCorpus(workEnv(work));
        try {
            const { stopped } = await runEvaluation(info, {
                work,
                corpus,
                questions: accepted,
                models,
                concurrency: intOf(values, "concurrency", 4, 1, 32),
            });
            io.out(`run ${info.id}: ${reportPath(work, info.id)}\n`);
            if (stopped !== null) {
                io.out(
                    `stopped: ${stopped}; resume with \`bun run eval -- run --work ${work} --resume ${info.id}\`\n`,
                );
            }
            return 0;
        } finally {
            corpus.close();
        }
    },
};
