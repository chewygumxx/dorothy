// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/generate-command.ts
//
//

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Command, intOf, workOf } from "../command.js";
import { UsageError } from "../errors.js";
import { Models } from "../models/client.js";
import { readEvalConfig, requireRole } from "../models/config.js";
import { readSnapshot, workEnv } from "../snapshot/snapshot.js";
import { openCorpus } from "../systems/corpus.js";
import {
    mergeQuestions,
    type Question,
    readQuestionsToRewrite,
    writeQuestions,
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

// <work>/generated.json: each generation's seed, model, counts and drops.
async function readGenerations(work: string): Promise<unknown[]> {
    let text: string;
    try {
        text = await readFile(join(work, "generated.json"), "utf8");
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") {
            return [];
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

async function recordGeneration(work: string, entry: object): Promise<void> {
    const entries = await readGenerations(work);
    await writeFile(
        join(work, "generated.json"),
        `${JSON.stringify([...entries, entry], null, 4)}\n`,
        { mode: 0o600 },
    );
}

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
        work: { type: "string" },
        count: { type: "string" },
        type: { type: "string", multiple: true },
        seed: { type: "string" },
        "max-calls": { type: "string" },
        "dry-run": { type: "boolean" },
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
        const config = await readEvalConfig(work);
        const role = requireRole(config, "generate");
        const models = new Models(config, {
            env: io.env,
            maxCalls:
                values["max-calls"] === undefined
                    ? null
                    : intOf(values, "max-calls", 0, 1, 1_000_000),
        });
        // A missing key is said before anything is opened.
        models.chat("generate");
        const seed = intOf(
            values,
            "seed",
            Math.floor(Math.random() * 2 ** 31),
            0,
            2 ** 31 - 1,
        );
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
            });
            // Both read again, before either is written: a review in
            // another terminal may have written meanwhile.
            await readGenerations(work);
            const current = await readQuestionsToRewrite(work);
            await writeQuestions(
                work,
                mergeQuestions(current, result.made).questions,
            );
            await recordGeneration(work, {
                at: new Date().toISOString(),
                seed,
                model: role.model,
                asked: counts,
                made: byType(result.made),
                dropped: result.dropped,
                stopped: result.stopped,
            });
            io.out(
                `drafted ${result.made.length} questions (seed ${seed}); review them with \`bun run eval -- review --work ${work}\`\n`,
            );
            for (const [reason, n] of Object.entries(result.dropped)) {
                io.out(`  dropped ${n}: ${reason}\n`);
            }
            if (result.stopped !== null) {
                io.out(`stopped: ${result.stopped}\n`);
            }
            return 0;
        } finally {
            corpus.close();
        }
    },
};
