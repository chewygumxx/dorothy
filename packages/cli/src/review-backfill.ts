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

// dorothy --review-backfill: a line a conversation as it is done, then
// the counts. It fails only when a batch did nothing and something failed;
// the agent that cannot load, or a store that cannot open, fails it too.
export async function runBackfillReview(
    count: number,
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
    try {
        const counts = await run({
            env,
            count,
            call: loaded.review.call,
            persona: loaded.review.persona,
            progress: (phrase, outcome) => {
                out(`${phrase}: ${outcome}\n`);
            },
        });
        out(
            `total: ${COUNTED.map((name) => `${counts[name]} ${name}`).join(", ")}\n`,
        );
        return counts.reviewed + counts.marked === 0 && counts.failed > 0
            ? 1
            : 0;
    } catch (error) {
        err(
            `dorothy: --review-backfill stopped: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        return 1;
    }
}
