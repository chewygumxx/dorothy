// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/preview.ts
//
//

// What a chat would start with, read without opening history or a
// transcript, for --dump-context: the turns after the clusters, the
// memory block with the clusters charged first, and recall as the config
// has it.

import {
    type Config,
    type Env,
    newPhrase,
    type RecallLaunch,
    readConfig,
    type SessionStart,
    type Turn,
} from "@dorothy/core";
import { clusterTokens, seedTurns } from "../compaction/plan.js";
import { dataRoot } from "../facts/store.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import {
    readTranscript,
    transcriptDir,
    transcriptPath,
} from "../transcript.js";
import { earlierSection } from "./block.js";
import { indexCatalogue } from "./catalogue.js";
import { buildMemory } from "./rank.js";
import { type Cluster, readSidecar } from "./sidecar.js";

export type Preview =
    | { ok: true; phrase: string; start: SessionStart; warnings: string[] }
    | { ok: false; message: string };

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

export async function previewStart({
    resume,
    recallLaunch,
    env = process.env,
}: {
    resume: string | null;
    recallLaunch(phrase: string): RecallLaunch;
    env?: Env;
}): Promise<Preview> {
    const phrase = resume ?? newPhrase();
    const resumed = resume === null ? FRESH : await resumedOf(phrase, env);
    if ("message" in resumed) {
        return { ok: false, message: resumed.message };
    }
    const { history, clusters } = resumed;
    const { config, warnings } = await readConfig(env);
    let index: RecallIndex | null = null;
    if (config.memory.enabled || config.memory.recall) {
        try {
            index = RecallIndex.open(indexPath(env));
        } catch (error) {
            warnings.push(
                `memory: the index can't be opened (${describeError(error)})`,
            );
        }
    }
    try {
        const recall =
            config.memory.recall && index !== null
                ? recallLaunch(phrase)
                : null;
        const memory =
            config.memory.enabled && index !== null
                ? await memoryOf(index, {
                      phrase,
                      config,
                      reserved: clusterTokens(clusters, recall !== null),
                      warnings,
                      env,
                  })
                : "";
        return {
            ok: true,
            phrase,
            warnings,
            start: {
                history: seedTurns(history, clusters),
                memory,
                earlier: earlierSection(clusters, recall !== null),
                recall,
                recollect: recall !== null && clusters.length > 0,
            },
        };
    } finally {
        index?.close();
    }
}

type Resumed = { history: Turn[]; clusters: Cluster[] };

const FRESH: Resumed = { history: [], clusters: [] };

// A resumed chat's turns and clusters; or why it can't be resumed.
async function resumedOf(
    phrase: string,
    env: Env,
): Promise<Resumed | { message: string }> {
    const path = transcriptPath(phrase, env);
    let history: Turn[];
    try {
        history = (await readTranscript(path)).turns;
    } catch (error) {
        return {
            message: `cannot resume ${phrase}: ${path}: ${describeError(error)}`,
        };
    }
    const notes = await readSidecar(transcriptDir(env), phrase);
    return {
        history,
        clusters: notes.kind === "ok" ? notes.sidecar.clusters : [],
    };
}

// The memory block, as chat would build it, the chat's clusters' tokens
// reserved first.
async function memoryOf(
    index: RecallIndex,
    {
        phrase,
        config,
        reserved,
        warnings,
        env,
    }: {
        phrase: string;
        config: Config;
        reserved: number;
        warnings: string[];
        env: Env;
    },
): Promise<string> {
    const loaded = await indexCatalogue(
        index,
        transcriptDir(env),
        null,
        dataRoot(env),
    ).load();
    const built = buildMemory(loaded.entries, {
        now: Date.now(),
        config: config.memory,
        exclude: phrase,
        reserved,
    });
    warnings.push(...loaded.warnings, ...built.warnings);
    return built.block;
}
