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
import { type Reviewed, Reviewer } from "./reviewer.js";
import {
    readSidecar,
    recordingFor,
    type Sidecar,
    setBackfilled,
    updateSidecar,
} from "./sidecar.js";
import { vocabularyPath } from "./vocabulary.js";

// reviewed and marked wrote notes; unchanged wrote none (declined, or
// another writer got there first); held is another owner's claim.
export type ReviewBackfillOutcome =
    | "reviewed"
    | "marked"
    | "unchanged"
    | "held"
    | "failed";
export type ReviewBackfillCounts = Record<ReviewBackfillOutcome, number>;
export type ReviewBackfillOptions = {
    env: Env;
    count?: number;
    // Phrases left out of the candidates before the count caps them.
    skip?: ReadonlySet<string>;
    call: StructuredCall;
    persona: string;
    progress?: (phrase: string, outcome: ReviewBackfillOutcome) => void;
    // A failed model call ends the batch; this says why, by its first line.
    stopped?: (reason: string) => void;
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

// An error's first line, never longer than a warning should be.
const reasonOf = (error: unknown) =>
    (error instanceof Error ? error.message : String(error))
        .split("\n", 1)[0]
        ?.slice(0, 200) ?? "";

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
// service. The cap applies to candidates, including held claims, once
// `skip` has left its phrases out. A failed
// model call, likelier to fail the rest too, gives the conversation its
// mark back and stops the batch, whatever the plan or the API says next.
export async function runReviewBackfill({
    env,
    count = 25,
    skip,
    call,
    persona,
    progress,
    stopped,
    now = () => new Date(),
    warn = (message) => {
        process.stderr.write(`dorothy: ${message}\n`);
    },
}: ReviewBackfillOptions): Promise<ReviewBackfillCounts> {
    if (!Number.isInteger(count) || count < 1)
        throw new RangeError("count must be a positive integer");
    const totals: ReviewBackfillCounts = {
        reviewed: 0,
        marked: 0,
        unchanged: 0,
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
        const lock = versions?.lock ?? index.lock;
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
        let callFailure: string | null = null;
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
                if (issue.kind === "call")
                    callFailure = reasonOf(issue.error ?? "the call failed");
                warn(message);
            },
            cost: () => {},
        });
        // The mark and failures the conversation began the batch with, as
        // if nothing had been tried: a later batch can take it up again.
        const restoreMark = async (
            phrase: string,
            failures: Sidecar["failures"],
        ) => {
            const result = await updateSidecar(
                dir,
                phrase,
                (latest) =>
                    latest === null || latest.hidden
                        ? null
                        : { ...latest, backfilled: true, failures },
                lock,
                recordingFor(
                    versions,
                    `review: ${phrase} (dorothy, backfill restored)`,
                ),
            );
            if (result.kind === "failed")
                warn(
                    `memory: couldn't restore the backfill mark on ${phrase}: ${result.reason.split("\n", 1)[0]?.slice(0, 200)}`,
                );
        };
        const chosen = (await candidates(dir))
            .filter(({ phrase }) => !skip?.has(phrase))
            .slice(0, count);
        for (const { phrase } of chosen) {
            const claim = indexClaims(index, phrase)();
            let outcome: ReviewBackfillOutcome;
            let stop: string | null = null;
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
                            return null;
                        const path = await setBackfilled(dir, phrase, false);
                        if (path === null)
                            throw new Error("backfill mark was not cleared");
                        await versions?.recorder(
                            [path],
                            `review: ${phrase} (dorothy, backfill)`,
                        );
                        return { failures: read.sidecar.failures };
                    });
                    // The lock and the commit may have outlasted the lease.
                    if (!(await claim.take())) {
                        outcome = "held";
                    } else if (cleared === null) {
                        outcome = "unchanged";
                    } else {
                        problem = false;
                        callFailure = null;
                        let reviewed: Reviewed;
                        try {
                            reviewed = await reviewer.review(
                                phrase,
                                new AbortController().signal,
                            );
                        } catch (error) {
                            warn(
                                `memory: couldn't review ${phrase}: ${reasonOf(error)}`,
                            );
                            callFailure = reasonOf(error);
                            reviewed = { kind: "none" };
                            problem = true;
                        }
                        if (callFailure !== null) {
                            stop = callFailure;
                            await restoreMark(phrase, cleared.failures);
                        }
                        outcome = problem
                            ? "failed"
                            : reviewed.kind === "none"
                              ? "unchanged"
                              : reviewed.kind;
                        if (stop === null && reviewed.kind !== "none") {
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
                } catch (error) {
                    // Any other failure leaves the mark clear, so a chat's
                    // catch-up can retry the conversation later.
                    warn(
                        `memory: couldn't review ${phrase}: ${reasonOf(error)}`,
                    );
                    outcome = "failed";
                } finally {
                    try {
                        await claim.release();
                    } catch (error) {
                        warn(
                            `memory: couldn't release the claim on ${phrase}: ${reasonOf(error)}`,
                        );
                    }
                }
            }
            totals[outcome]++;
            progress?.(phrase, outcome);
            if (stop !== null) {
                stopped?.(stop);
                break;
            }
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
