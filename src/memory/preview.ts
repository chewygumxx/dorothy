// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/preview.ts
//
//

// What a chat would start with, read without opening history or a
// transcript, for --dump-context: the turns after the clusters, the
// memory block with the clusters charged first, and recall as the config
// has it.

import {
    type Env,
    newPhrase,
    type RecallLaunch,
    readConfig,
    type SessionStart,
    type Turn,
} from "@dorothy/core";
import { clusterTokens, seedTurns } from "../compaction/plan.js";
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
    let history: Turn[] = [];
    if (resume !== null) {
        const path = transcriptPath(phrase, env);
        try {
            history = (await readTranscript(path)).turns;
        } catch (error) {
            return {
                ok: false,
                message: `cannot resume ${phrase}: ${path}: ${describeError(error)}`,
            };
        }
    }
    const { config, warnings } = await readConfig(env);
    let clusters: Cluster[] = [];
    if (resume !== null) {
        const notes = await readSidecar(transcriptDir(env), phrase);
        if (notes.kind === "ok") {
            clusters = notes.sidecar.clusters;
        }
    }
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
        let memory = "";
        if (config.memory.enabled && index !== null) {
            const loaded = await indexCatalogue(
                index,
                transcriptDir(env),
            ).load();
            const built = buildMemory(loaded.entries, {
                now: Date.now(),
                config: config.memory,
                exclude: phrase,
                reserved: clusterTokens(clusters, recall !== null),
            });
            warnings.push(...loaded.warnings, ...built.warnings);
            memory = built.block;
        }
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
