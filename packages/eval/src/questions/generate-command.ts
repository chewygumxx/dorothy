// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/generate-command.ts
//
//

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    type Command,
    intOf,
    modelsOf,
    modelsOption,
    workOf,
} from "../command.js";
import { EXIT_TEMPFAIL, UsageError } from "../errors.js";
import { writeAtomic } from "../files.js";
import { Models } from "../models/client.js";
import { readEvalConfig, requireRole } from "../models/config.js";
import { loadModelSecrets } from "../secrets.js";
import { readSnapshot, workEnv } from "../snapshot/snapshot.js";
import { openCorpus } from "../systems/corpus.js";
import {
    mergeQuestions,
    type Question,
    readQuestionsToRewrite,
    underLock,
    updateQuestions,
} from "./file.js";
import {
    BATCH,
    countsFor,
    draftPrompt,
    draftsSchema,
    GENERATED_TYPES,
    generateQuestions,
    latestDay,
    parseTypeCounts,
    seeded,
} from "./generate.js";

// <work>/generated.json: each generation's seed, model, counts, drops
// and reported tokens by role. Older entries need no token field.
async function readGenerations(work: string): Promise<unknown[]> {
    let text: string;
    try {
        text = await readFile(join(work, "generated.json"), "utf8");
    } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (code === "ENOENT") {
            return [];
        }
        if (typeof code === "string") {
            throw new UsageError(
                `cannot read ${join(work, "generated.json")}: ${code}; mend it, or remove it to start again`,
            );
        }
        throw error;
    }
    let read: unknown;
    try {
        read = JSON.parse(text);
    } catch {
        read = null;
    }
    if (!Array.isArray(read)) {
        throw new UsageError("generated.json is not a list: mend or remove it");
    }
    return read;
}

// Under the question file's lock, as two generations can end together
// and each read the list before the other wrote it back.
export const recordGeneration = (work: string, entry: object): Promise<void> =>
    underLock(work, async () => {
        const entries = await readGenerations(work);
        await writeAtomic(
            join(work, "generated.json"),
            `${JSON.stringify([...entries, entry], null, 4)}\n`,
        );
    });

const byType = (questions: Question[]) => {
    const counts: Record<string, number> = {};
    for (const question of questions) {
        counts[question.type] = (counts[question.type] ?? 0) + 1;
    }
    return counts;
};

export const generateCommand: Command = {
    summary: "draft questions of each type with a model",
    options: {
        work: { type: "string", description: "the evaluation's directory" },
        count: {
            type: "string",
            description: "questions to draft in all, 300 by default",
        },
        type: {
            type: "string",
            multiple: true,
            description: "a type's own count, as temporal=40",
        },
        seed: {
            type: "string",
            description:
                "the seed samples are drawn by, to repeat a generation",
        },
        models: modelsOption,
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
        const snapshot = await readSnapshot(work);
        const counts = countsFor(
            intOf(values, "count", 300, 1, 5000),
            parseTypeCounts((values.type as string[] | undefined) ?? []),
        );
        const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
        if (values["dry-run"] === true) {
            const calls = GENERATED_TYPES.reduce(
                (sum, type) => sum + Math.ceil(counts[type] / BATCH),
                0,
            );
            io.out(
                `dry run: at least ${calls} calls to the generating model, each tried up to three times, for ${total} questions\n`,
            );
            return 0;
        }
        const existing = await readQuestionsToRewrite(work);
        // Mended before any call is paid for.
        await readGenerations(work);
        const config = await readEvalConfig(work, modelsOf(values));
        const role = requireRole(config, "generate", modelsOf(values));
        if (!(await loadModelSecrets(io))) return 1;
        const models = new Models(config, {
            ...io.modelOptions,
            env: io.env,
            maxCalls:
                values["max-calls"] === undefined
                    ? null
                    : intOf(values, "max-calls", 0, 1, 1_000_000),
        });
        // A missing key is said before anything is opened.
        models.prepare("generate");
        const seed = intOf(
            values,
            "seed",
            Math.floor(Math.random() * 2 ** 31),
            0,
            2 ** 31 - 1,
        );
        // Said before the first call, so that the seed survives a Ctrl-C.
        io.out(`seed ${seed}\n`);
        // Each call's drafts join the file as it is then, under its lock,
        // so a review meanwhile loses nothing and stopping loses no paid
        // draft. Those another command's writes made redundant are
        // counted, not claimed.
        let notAdded = 0;
        const keep = async (drafts: Question[]) => {
            notAdded += await updateQuestions(work, (current) => {
                const merged = mergeQuestions(current, drafts);
                return {
                    questions: merged.questions,
                    result: drafts.length - merged.added,
                };
            });
        };
        const corpus = await openCorpus(workEnv(work));
        try {
            const result = await generateQuestions({
                corpus,
                counts,
                random: seeded(seed),
                model: role.model,
                existing,
                today: latestDay(corpus) ?? snapshot.at.slice(0, 10),
                draft: async (sample, n) =>
                    (
                        await models.structured(
                            "generate",
                            draftsSchema,
                            "questions",
                            draftPrompt(sample, n),
                        )
                    ).value.questions,
                keep,
            });
            let stopped = result.stopped;
            if (result.unkept.length > 0) {
                // Tried once more; failing again, the drafts are said, so
                // that what was paid for can be kept by hand.
                try {
                    await keep(result.unkept);
                    stopped = `${stopped}; kept at the end, on a second try`;
                } catch (error) {
                    io.err(
                        `${result.unkept.map((each) => JSON.stringify(each)).join("\n")}\n`,
                    );
                    throw error;
                }
            }
            const drafted = result.made.length - notAdded;
            try {
                await recordGeneration(work, {
                    at: new Date().toISOString(),
                    seed,
                    model: role.model,
                    tokens: models.tokens,
                    asked: counts,
                    made: byType(result.made),
                    notAdded,
                    dropped: result.dropped,
                    stopped,
                });
            } catch (error) {
                const why =
                    error instanceof UsageError
                        ? error.message
                        : `cannot write generated.json: ${(error as { code?: unknown } | null)?.code ?? "failed"}`;
                throw new UsageError(
                    `${why}; the ${drafted} drafts are in questions.jsonl`,
                );
            }
            io.out(
                `drafted ${drafted} questions (seed ${seed}); review them with \`bun run eval -- review --work ${work}\`\n`,
            );
            for (const [reason, n] of Object.entries(result.dropped)) {
                io.out(`  dropped ${n}: ${reason}\n`);
            }
            const made = byType(result.made);
            for (const type of GENERATED_TYPES) {
                if ((made[type] ?? 0) < counts[type]) {
                    io.out(
                        `  short: ${type} made ${made[type] ?? 0} of ${counts[type]}\n`,
                    );
                }
            }
            if (notAdded > 0) {
                io.out(
                    `  not added ${notAdded}: another command had written the same ids\n`,
                );
            }
            if (stopped !== null) {
                io.out(`stopped: ${stopped}\n`);
            }
            // A plan's limit is waited out: a wrapper can run again on 75.
            return result.limited ? EXIT_TEMPFAIL : 0;
        } finally {
            corpus.close();
        }
    },
};
