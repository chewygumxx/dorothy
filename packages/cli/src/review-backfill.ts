// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/review-backfill.ts
//
//

import type { Env, StructuredCall } from "@dorothy/core";
import {
    type ReviewBackfillCounts,
    type ReviewBackfillOptions,
    runReviewBackfill,
} from "@dorothy/memory";

// The reviewer the hooks and the service get: reviewAgent in index.ts,
// which drops Claude Code's variables and loads this checkout's secrets.
export type BackfillAgent =
    | { review: { call: StructuredCall; persona: string } }
    | { review: null; noReviews: string };

export type ReviewBackfillDeps = {
    agent: () => Promise<BackfillAgent>;
    // The environment the agent was loaded into, which the review reads.
    env?: Env;
    run?: (options: ReviewBackfillOptions) => Promise<ReviewBackfillCounts>;
    out?: (text: string) => void;
    err?: (text: string) => void;
};

const COUNTED = [
    "reviewed",
    "marked",
    "unchanged",
    "held",
    "failed",
] as const satisfies readonly (keyof ReviewBackfillCounts)[];

// An error's first line, as a run's reason should be.
const firstLine = (error: unknown) =>
    (error instanceof Error ? error.message : String(error)).split("\n", 1)[0];

const BATCH = 25;
// Exit status for a stopped pass, as EX_TEMPFAIL: run it again later.
const RETRY_LATER = 75;

// dorothy --review-backfill: a line a conversation as it is done, then
// the counts. It fails when a failed model call stopped the batch, or when
// a batch did nothing and something failed; the agent that cannot load, or
// a store that cannot open, fails it too. With `all`, batches of 25 repeat
// until one reports no conversation, each leaving out every phrase an
// earlier one reported, so a held conversation cannot fill a batch; a
// stopped pass exits 75, for a caller to run again later.
export async function runBackfillReview(
    count: number | "all",
    {
        agent,
        env = process.env,
        run = runReviewBackfill,
        out = (text) => {
            process.stdout.write(text);
        },
        err = (text) => {
            process.stderr.write(text);
        },
    }: ReviewBackfillDeps,
): Promise<number> {
    const loaded = await agent();
    // The agent has said why, as reviews are off.
    if (loaded.review === null) {
        return 1;
    }
    const all = count === "all";
    const seen = new Set<string>();
    const totals: ReviewBackfillCounts = {
        reviewed: 0,
        marked: 0,
        unchanged: 0,
        held: 0,
        failed: 0,
    };
    let stopped: string | null = null;
    try {
        let reported: number;
        do {
            reported = 0;
            const counts = await run({
                env,
                count: all ? BATCH : count,
                ...(all ? { skip: seen } : {}),
                call: loaded.review.call,
                persona: loaded.review.persona,
                progress: (phrase, outcome) => {
                    reported++;
                    seen.add(phrase);
                    out(`${phrase}: ${outcome}\n`);
                },
                stopped: (reason) => {
                    stopped = reason;
                },
            });
            for (const name of COUNTED) totals[name] += counts[name];
        } while (all && reported > 0 && stopped === null);
        out(
            `total: ${COUNTED.map((name) => `${totals[name]} ${name}`).join(", ")}\n`,
        );
        if (stopped !== null) {
            err(
                `dorothy: --review-backfill stopped after a failed call: ${stopped}; the rest stay marked\n`,
            );
            return all ? RETRY_LATER : 1;
        }
        if (
            all &&
            totals.held > 0 &&
            COUNTED.every((name) => name === "held" || totals[name] === 0)
        ) {
            out(
                "review-backfill: every marked conversation is held by another process\n",
            );
            return 0;
        }
        return totals.reviewed + totals.marked === 0 && totals.failed > 0
            ? 1
            : 0;
    } catch (error) {
        err(`dorothy: --review-backfill stopped: ${firstLine(error)}\n`);
        return 1;
    }
}
