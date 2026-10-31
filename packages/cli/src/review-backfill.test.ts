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

    it("says that a failed call stopped the batch, and why, and exits 1", async () => {
        const h = harness([]);
        const code = await runBackfillReview(25, {
            ...h.deps,
            run: async (options) => {
                options.progress?.("amber-brook-cedar-dune", "reviewed");
                options.progress?.("birch-cove-delta-ember", "failed");
                options.stopped?.("usage limit reached");
                return counted([
                    ["amber-brook-cedar-dune", "reviewed"],
                    ["birch-cove-delta-ember", "failed"],
                ]);
            },
        });
        expect(code).toBe(1);
        expect(h.out.join("")).toBe(
            [
                "amber-brook-cedar-dune: reviewed",
                "birch-cove-delta-ember: failed",
                "total: 1 reviewed, 0 marked, 0 unchanged, 0 held, 1 failed",
                "",
            ].join("\n"),
        );
        expect(h.err.join("")).toBe(
            "dorothy: --review-backfill stopped after a failed call: usage limit reached; the rest stay marked\n",
        );
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
        expect(h.err.join("")).toBe(
            "dorothy: --review-backfill stopped: the index is locked\n",
        );
        expect(h.out).toEqual([]);
    });

    describe("all", () => {
        const names = (from: number, to: number) =>
            Array.from(
                { length: to - from },
                (_, n) => `held-${String(from + n).padStart(2, "0")}`,
            );
        // A run over a store of phrases, each with its outcome, that
        // honours skip and the count as the real one does.
        function store(
            phrases: [string, ReviewBackfillOutcome][],
            stopAt?: { batch: number; reason: string },
        ) {
            const h = harness([]);
            const batches: { count?: number; skip: string[] }[] = [];
            h.deps.run = async (options: ReviewBackfillOptions) => {
                batches.push({
                    count: options.count,
                    skip: [...(options.skip ?? [])],
                });
                const chosen = phrases
                    .filter(([phrase]) => !options.skip?.has(phrase))
                    .slice(0, options.count);
                const done: [string, ReviewBackfillOutcome][] = [];
                for (const entry of chosen) {
                    done.push(entry);
                    options.progress?.(...entry);
                    if (stopAt?.batch === batches.length) {
                        options.stopped?.(stopAt.reason);
                        break;
                    }
                }
                return counted(done);
            };
            return { ...h, batches };
        }

        it("reaches reviewable conversations behind a batch of held ones", async () => {
            const held = names(0, 25).map(
                (phrase) => [phrase, "held"] as [string, ReviewBackfillOutcome],
            );
            const h = store([
                ...held,
                ["amber-brook-cedar-dune", "reviewed"],
                ["birch-cove-delta-ember", "marked"],
            ]);
            expect(await runBackfillReview("all", h.deps)).toBe(0);
            expect(h.batches.map((batch) => batch.count)).toEqual([25, 25, 25]);
            expect(h.batches[1]?.skip).toEqual(names(0, 25));
            expect(h.batches[2]?.skip).toHaveLength(27);
            expect(h.out.slice(-3)).toEqual([
                "amber-brook-cedar-dune: reviewed\n",
                "birch-cove-delta-ember: marked\n",
                "total: 1 reviewed, 1 marked, 0 unchanged, 25 held, 0 failed\n",
            ]);
            expect(h.err).toEqual([]);
        });

        it("says so, and exits 0, where every conversation is held", async () => {
            const h = store(
                names(0, 3).map(
                    (phrase) =>
                        [phrase, "held"] as [string, ReviewBackfillOutcome],
                ),
            );
            expect(await runBackfillReview("all", h.deps)).toBe(0);
            expect(h.out.slice(-2)).toEqual([
                "total: 0 reviewed, 0 marked, 0 unchanged, 3 held, 0 failed\n",
                "review-backfill: every marked conversation is held by another process\n",
            ]);
        });

        it("does not call a pass with nothing to review held", async () => {
            const h = store([]);
            expect(await runBackfillReview("all", h.deps)).toBe(0);
            expect(h.batches).toHaveLength(1);
            expect(h.out).toEqual([
                "total: 0 reviewed, 0 marked, 0 unchanged, 0 held, 0 failed\n",
            ]);
        });

        it("exits 75 on a stopped batch, keeping the earlier totals", async () => {
            const first = names(0, 25).map(
                (phrase) =>
                    [phrase, "reviewed"] as [string, ReviewBackfillOutcome],
            );
            const h = store(
                [
                    ...first,
                    ["amber-brook-cedar-dune", "reviewed"],
                    ["birch-cove-delta-ember", "failed"],
                    ["clay-dawn-eagle-fern", "reviewed"],
                ],
                { batch: 2, reason: "usage limit reached" },
            );
            expect(await runBackfillReview("all", h.deps)).toBe(75);
            expect(h.batches).toHaveLength(2);
            expect(h.out.at(-1)).toBe(
                "total: 26 reviewed, 0 marked, 0 unchanged, 0 held, 0 failed\n",
            );
            expect(
                h.out.filter((line) => line.startsWith("total:")),
            ).toHaveLength(1);
            expect(h.err.join("")).toBe(
                "dorothy: --review-backfill stopped after a failed call: usage limit reached; the rest stay marked\n",
            );
        });

        it("exits 1 when a pass reviewed nothing and one failed", async () => {
            const h = store([["amber-brook-cedar-dune", "failed"]]);
            expect(await runBackfillReview("all", h.deps)).toBe(1);
        });

        it("leaves a numeric count one batch, with no skip", async () => {
            const h = harness([["amber-brook-cedar-dune", "reviewed"]]);
            expect(await runBackfillReview(3, h.deps)).toBe(0);
            expect(h.seen).toHaveLength(1);
            expect(h.seen[0]?.count).toBe(3);
            expect(h.seen[0]?.skip).toBeUndefined();
        });
    });
});
