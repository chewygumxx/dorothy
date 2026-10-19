// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/launch.ts
//
//

// What dorothy --claude asks of memory before claude starts: chat's
// memory block, rendered by the same code, and a sync of the project
// claude starts in. Neither talks to a model.

import { type Env, readConfig } from "@dorothy/core";
import { dataRoot } from "../facts/store.js";
import { commandHistory } from "../history/commands.js";
import { indexCatalogue } from "../memory/catalogue.js";
import { buildMemory } from "../memory/rank.js";
import type { OpenHistory } from "../memory/sidecar.js";
import { vocabularyPath } from "../memory/vocabulary.js";
import { syncProject } from "../projects/sync.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { sessionPhrase } from "../recall/sync.js";
import { transcriptDir } from "../transcript.js";

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// Chat's block, its preamble and budget from config.toml, leaving out
// the conversation of session, the Claude Code session the arguments
// resume by id, as chat leaves out the live one. Its warnings are its
// own; the caller reads and reports config.toml's.
export async function claudeBlock({
    env = process.env,
    session = null,
}: {
    env?: Env;
    session?: string | null;
} = {}): Promise<{ block: string; warnings: string[] }> {
    const { config } = await readConfig(env);
    if (!config.memory.enabled) {
        return { block: "", warnings: [] };
    }
    const index = RecallIndex.open(indexPath(env));
    try {
        const loaded = await indexCatalogue(
            index,
            transcriptDir(env),
            vocabularyPath(env),
            dataRoot(env),
        ).load();
        const built = buildMemory(loaded.entries, {
            now: Date.now(),
            config: config.memory,
            exclude: session === null ? null : sessionPhrase(index, session),
        });
        return {
            block: built.block,
            warnings: [...loaded.warnings, ...built.warnings],
        };
    } finally {
        index.close();
    }
}

// Syncs the project dir is in, under the index's lock, or history's
// own without the index, history committing what changed and never
// pushing. Null when synced or dir is in no repository; else why not.
export async function syncDirectory(
    dir: string,
    {
        env = process.env,
        openHistory = commandHistory({ env, remindMirror: false }),
    }: { env?: Env; openHistory?: OpenHistory } = {},
): Promise<string | null> {
    let index: RecallIndex | null = null;
    try {
        index = RecallIndex.open(indexPath(env));
    } catch {
        // History's own lock stands in.
    }
    const versions = await openHistory(index);
    try {
        const lock = versions?.lock ?? index?.lock;
        if (lock === undefined) {
            return "neither the memory index nor history can lock the store";
        }
        const result = await syncProject(dir, {
            root: dataRoot(env),
            lock,
            recorder: versions?.recorder ?? null,
        });
        return result.kind === "failed" ? result.reason : null;
    } catch (error) {
        return describeError(error);
    } finally {
        await versions?.close();
        index?.close();
    }
}
