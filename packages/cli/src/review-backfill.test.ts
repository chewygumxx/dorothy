// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/review-backfill.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { Env, StructuredCall } from "@dorothy/core";
import type {
    ReviewBackfillCounts,
    ReviewBackfillOptions,
    ReviewBackfillOutcome,
} from "@dorothy/memory";
import { runBackfillReview } from "./review-backfill.js";

const call: StructuredCall = async () => ({
    ok: false,
    reason: "not called here",
    costUsd: 0,
});

const counted = (
    outcomes: [string, ReviewBackfillOutcome][],
): ReviewBackfillCounts => {
    const counts = {
        reviewed: 0,
        marked: 0,
        unchanged: 0,
        held: 0,
        failed: 0,
    };
    for (const [, outcome] of outcomes) {
        counts[outcome] += 1;
    }
    return counts;
};

// A run that reports each outcome, as the real one does, and records the
// options it was given.
function harness(outcomes: [string, ReviewBackfillOutcome][]) {
    const seen: ReviewBackfillOptions[] = [];
    const out: string[] = [];
    const err: string[] = [];
    const env: Env = { HOME: "/nowhere" };
    return {
        seen,
        out,
        err,
        deps: {
            agent: async () => ({
                review: { call, persona: "synthetic persona" },
            }),
            env,
            run: async (options: ReviewBackfillOptions) => {
                seen.push(options);
                for (const [phrase, outcome] of outcomes) {
                    options.progress?.(phrase, outcome);
                }
                return counted(outcomes);
            },
            out: (text: string) => {
                out.push(text);
            },
            err: (text: string) => {
                err.push(text);
            },
        },
        env,
    };
}

describe("runBackfillReview", () => {
    it("runs the batch on the agent's call and persona", async () => {
        const h = harness([]);
        expect(await runBackfillReview(7, h.deps)).toBe(0);
        expect(h.seen).toHaveLength(1);
        expect(h.seen[0]?.count).toBe(7);
        expect(h.seen[0]?.env).toBe(h.env);
        expect(h.seen[0]?.call).toBe(call);
        expect(h.seen[0]?.persona).toBe("synthetic persona");
    });

    it("prints a line a conversation, then a total of all five", async () => {
        const h = harness([
            ["amber-brook-cedar-dune", "reviewed"],
            ["birch-cove-delta-ember", "marked"],
            ["clay-dawn-eagle-fern", "unchanged"],
            ["dusk-elm-flint-glade", "held"],
            ["ember-fjord-grove-heath", "failed"],
            ["fawn-glen-hazel-isle", "reviewed"],
        ]);
        expect(await runBackfillReview(25, h.deps)).toBe(0);
        expect(h.out.join("")).toBe(
            [
                "amber-brook-cedar-dune: reviewed",
                "birch-cove-delta-ember: marked",
                "clay-dawn-eagle-fern: unchanged",
                "dusk-elm-flint-glade: held",
                "ember-fjord-grove-heath: failed",
                "fawn-glen-hazel-isle: reviewed",
                "total: 2 reviewed, 1 marked, 1 unchanged, 1 held, 1 failed",
                "",
            ].join("\n"),
        );
        expect(h.err).toEqual([]);
    });

    it("prints a total of zeros for no backfilled conversation", async () => {
        const h = harness([]);
        expect(await runBackfillReview(25, h.deps)).toBe(0);
        expect(h.out).toEqual([
            "total: 0 reviewed, 0 marked, 0 unchanged, 0 held, 0 failed\n",
        ]);
    });

    it("exits 1 when nothing was reviewed or marked and one failed", async () => {
        const h = harness([
            ["amber-brook-cedar-dune", "failed"],
            ["birch-cove-delta-ember", "held"],
            ["clay-dawn-eagle-fern", "unchanged"],
        ]);
        expect(await runBackfillReview(25, h.deps)).toBe(1);
    });

    it.each([["reviewed"], ["marked"]] as [ReviewBackfillOutcome][])(
        "exits 0 when %s beside a failure",
        async (outcome) => {
            const h = harness([
                ["amber-brook-cedar-dune", "failed"],
                ["birch-cove-delta-ember", outcome],
            ]);
            expect(await runBackfillReview(25, h.deps)).toBe(0);
        },
    );

    it("exits 0 when nothing failed, though nothing was reviewed", async () => {
        const h = harness([
            ["amber-brook-cedar-dune", "held"],
            ["birch-cove-delta-ember", "unchanged"],
        ]);
        expect(await runBackfillReview(25, h.deps)).toBe(0);
    });

    it("exits 1 without a run where the agent cannot review", async () => {
        const h = harness([]);
        const code = await runBackfillReview(25, {
            ...h.deps,
            agent: async () => ({ review: null, noReviews: "no secrets" }),
        });
        expect(code).toBe(1);
        expect(h.seen).toEqual([]);
        expect(h.out).toEqual([]);
    });

    it("says why and exits 1 when the batch itself cannot run", async () => {
        const h = harness([]);
        const code = await runBackfillReview(25, {
            ...h.deps,
            run: async () => {
                throw new Error("the index is locked\nsecond line");
            },
        });
        expect(code).toBe(1);
        expect(h.err.join("")).toContain("the index is locked");
        expect(h.out).toEqual([]);
    });
});
