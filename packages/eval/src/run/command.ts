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
import { readEvalConfig, requireRole, vendorOf } from "../models/config.js";
import { readQuestions } from "../questions/file.js";
import { readSnapshot, workEnv } from "../snapshot/snapshot.js";
import { openCorpus } from "../systems/corpus.js";
import { SYSTEM_NAMES } from "../systems/system.js";
import { readRunInfo, reportPath } from "./record.js";
import { modelCalls, newRunInfo, runEvaluation } from "./run.js";

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

export const runCommand: Command = {
    summary: "ask the accepted questions of each system, and report",
    options: {
        work: { type: "string" },
        systems: { type: "string" },
        budget: { type: "string" },
        "full-budget": { type: "string" },
        "retrieval-only": { type: "boolean" },
        resume: { type: "string" },
        concurrency: { type: "string" },
        "max-calls": { type: "string" },
        "dry-run": { type: "boolean" },
    },
    async run(values, _positionals, io) {
        const work = workOf(values);
        const snapshot = await readSnapshot(work);
        const { questions, problems } = await readQuestions(work);
        for (const problem of problems) {
            io.err(`eval: skipped ${problem}\n`);
        }
        const accepted = questions.filter((q) => q.status === "accepted");
        const config = await readEvalConfig(work);
        const resume = stringOf(values, "resume");
        const info =
            resume !== null
                ? await readRunInfo(work, resume)
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
                          retrievalOnly: values["retrieval-only"] === true,
                      },
                      accepted,
                      config,
                      snapshot,
                      new Date(),
                  );
        if (values["dry-run"] === true) {
            const asked = new Set(info.questionIds);
            const theirs = accepted.filter((q) => asked.has(q.id));
            io.out(
                `dry run: ${theirs.length} questions, ${info.systems.length} systems; ${modelCalls(info, theirs)} model calls\n`,
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
