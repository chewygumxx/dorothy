// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/review-backfill.ts
//
//

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    type Env,
    isPhrase,
    readConfig,
    type StructuredCall,
} from "@dorothy/core";
import { dataRoot } from "../facts/store.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { transcriptDir } from "../transcript.js";
import { indexCatalogue } from "./catalogue.js";
import { indexClaims, type LaunchedHistory, launchHistory } from "./open.js";
import { Reviewer } from "./reviewer.js";
import { readSidecar, setBackfilled, writeLock } from "./sidecar.js";
import { vocabularyPath } from "./vocabulary.js";

export type ReviewBackfillOutcome = "reviewed" | "marked" | "held" | "failed";
export type ReviewBackfillCounts = Record<ReviewBackfillOutcome, number>;
export type ReviewBackfillOptions = {
    env: Env;
    count?: number;
    call: StructuredCall;
    persona: string;
    progress?: (phrase: string, outcome: ReviewBackfillOutcome) => void;
    now?: () => Date;
    warn?: (message: string) => void;
};

// Visits count user turns, and sidecars have no last-event timestamp.
// Read the transcript's final dated event, including stats/tool events.
async function lastEventAt(path: string): Promise<number> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch {
        // If selected, the Reviewer reports the unreadable transcript.
        return 0;
    }
    let last = 0;
    for (const line of text.split("\n")) {
        try {
            const event = JSON.parse(line) as { at?: unknown } | null;
            const at =
                typeof event?.at === "string" ? Date.parse(event.at) : NaN;
            if (Number.isFinite(at)) last = at;
        } catch {
            // A torn line is not an event.
        }
    }
    return last;
}

async function candidates(dir: string) {
    let names: string[];
    try {
        names = await readdir(dir);
    } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return [];
        throw error;
    }
    const found: { phrase: string; at: number }[] = [];
    for (const name of names) {
        if (!name.endsWith(".meta.json")) continue;
        const phrase = name.slice(0, -".meta.json".length);
        if (!isPhrase(phrase)) continue;
        const read = await readSidecar(dir, phrase);
        if (
            read.kind !== "ok" ||
            !read.sidecar.backfilled ||
            read.sidecar.hidden
        )
            continue;
        found.push({
            phrase,
            at: await lastEventAt(join(dir, `${phrase}.jsonl`)),
        });
    }
    return found.sort(
        (a, b) => b.at - a.at || a.phrase.localeCompare(b.phrase),
    );
}

// Explicitly chosen backfills use the same Reviewer and claim as the
// service. The cap applies to candidates, including held claims.
export async function runReviewBackfill({
    env,
    count = 25,
    call,
    persona,
    progress,
    now = () => new Date(),
    warn = (message) => {
        process.stderr.write(`${message}\n`);
    },
}: ReviewBackfillOptions): Promise<ReviewBackfillCounts> {
    if (!Number.isInteger(count) || count < 1)
        throw new RangeError("count must be a positive integer");
    const totals: ReviewBackfillCounts = {
        reviewed: 0,
        marked: 0,
        held: 0,
        failed: 0,
    };
    const { config, warnings } = await readConfig(env);
    const dir = transcriptDir(env);
    const vocabulary = vocabularyPath(env);
    const index = RecallIndex.open(indexPath(env));
    let launched: LaunchedHistory | null = null;
    try {
        launched = await launchHistory({ config, index, warnings, env });
        const versions = launched?.history.handle() ?? null;
        const lock = writeLock(index, versions) ?? index.lock;
        const loaded = await indexCatalogue(
            index,
            dir,
            vocabulary,
            dataRoot(env),
        ).load();
        for (const message of [...warnings, ...loaded.warnings]) warn(message);
        const entries = new Map(
            loaded.entries.map((entry) => [entry.phrase, entry]),
        );
        let problem = false;
        const reviewer = new Reviewer({
            dir,
            config: config.memory,
            index,
            vocabulary,
            versions,
            call,
            persona,
            now,
            entries: () => entries.values(),
            warn: (message, issue) => {
                if (issue.phrase !== null) problem = true;
                warn(message);
            },
            cost: () => {},
        });
        for (const { phrase } of (await candidates(dir)).slice(0, count)) {
            const claim = indexClaims(index, phrase)();
            let outcome: ReviewBackfillOutcome;
            if (!(await claim.take())) {
                outcome = "held";
            } else {
                try {
                    const cleared = await lock(async () => {
                        const read = await readSidecar(dir, phrase);
                        if (read.kind !== "ok")
                            throw new Error("backfill notes cannot be read");
                        // A live append or another batch may have got here
                        // since selection. Hidden notes stay untouched.
                        if (!read.sidecar.backfilled || read.sidecar.hidden)
                            return false;
                        const path = await setBackfilled(dir, phrase, false);
                        if (path === null)
                            throw new Error("backfill mark was not cleared");
                        await versions?.recorder(
                            [path],
                            `review: ${phrase} (dorothy, backfill)`,
                        );
                        return true;
                    });
                    problem = false;
                    if (!cleared) {
                        outcome = "marked";
                    } else {
                        const reviewed = await reviewer.review(
                            phrase,
                            new AbortController().signal,
                        );
                        outcome = problem
                            ? "failed"
                            : reviewed.kind === "reviewed"
                              ? "reviewed"
                              : "marked";
                        if (reviewed.kind !== "none") {
                            const entry = entries.get(phrase);
                            if (entry !== undefined)
                                entries.set(phrase, {
                                    ...entry,
                                    sidecar: {
                                        kind: "ok",
                                        sidecar: reviewed.sidecar,
                                    },
                                    turns: reviewed.turns ?? entry.turns,
                                });
                        }
                    }
                } catch {
                    // The mark deliberately stays clear after a failed
                    // call, so the ordinary service can retry it later.
                    outcome = "failed";
                } finally {
                    await claim.release();
                }
            }
            totals[outcome]++;
            progress?.(phrase, outcome);
        }
        return totals;
    } finally {
        try {
            await launched?.close();
        } finally {
            index.close();
        }
    }
}
