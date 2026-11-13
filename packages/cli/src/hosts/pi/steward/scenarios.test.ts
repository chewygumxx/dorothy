// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/scenarios.test.ts
//
//

// The stewardship scenarios, each under the default cast and a held-out
// one (every worker, pane, terminal and task id renamed, the registry and
// the reports reordered): no task sent twice, no task verified that the
// owner's test did not pass, and every unsettled task named as pending or
// unknown. The coordinator is scripted, so these show the plumbing and the
// ledger hold, not that a model chooses well.

import { describe, expect, it } from "bun:test";
import { measureReview } from "./owner.js";
import { runPiScenario } from "./pi-scenario.js";
import {
    failedChecks,
    runScenario,
    runSuite,
    SCENARIO_NAMES,
    type ScenarioResult,
    summaryOf,
    totalsOf,
} from "./scenarios.js";
import { DEFAULT_CAST, HELD_OUT_CAST } from "./simulation.js";

const CASTS = [DEFAULT_CAST, HELD_OUT_CAST];

// What each scenario must leave pending or unknown, by task key: an
// irresolvable fixture is named, never quietly dropped or called done.
const PENDING: Record<string, string[]> = {
    "fix-verified": ["next"],
    "review-loop": [],
    "busy-limited": ["fix"],
    "stale-identity": ["fix"],
    "conflicting-reports": ["misfiled"],
    "hostile-submission": ["rewrites-test", "honest"],
    "injected-authority": [],
    "delayed-output": [],
    "coordinator-crash": ["never", "uncertain"],
    cancellation: ["after", "refused"],
    "cancel-races-report": [],
    "failed-worker": ["gone", "retry", "said-failed"],
    "forged-report": [],
    "claimed-revision": ["invented"],
    "two-workers": [],
};

const keyed = (cast: { prefix: string }, ids: string[]) =>
    ids.map((id) => id.slice(cast.prefix.length + 1)).sort();

const results = new Map<string, ScenarioResult>();
async function result(name: string, cast = DEFAULT_CAST) {
    const key = `${cast.label}/${name}`;
    let found = results.get(key);
    if (!found) {
        found = await runScenario(name, cast);
        results.set(key, found);
    }
    return found;
}

describe("every scenario is covered", () => {
    it("has a pending expectation and a summary for each", () => {
        expect(Object.keys(PENDING).sort()).toEqual([...SCENARIO_NAMES].sort());
        for (const name of SCENARIO_NAMES) {
            expect(summaryOf(name).length).toBeGreaterThan(10);
        }
    });

    it("names the brief's cases", () => {
        expect(SCENARIO_NAMES).toEqual(
            expect.arrayContaining([
                "busy-limited",
                "stale-identity",
                "conflicting-reports",
                "injected-authority",
                "delayed-output",
                "coordinator-crash",
                "cancellation",
                "failed-worker",
                "forged-report",
                "claimed-revision",
                "review-loop",
                "hostile-submission",
            ]),
        );
    });
});

for (const cast of CASTS) {
    describe(`scenarios, ${cast.label} cast`, () => {
        for (const name of SCENARIO_NAMES) {
            it(`${name}: ${summaryOf(name)}`, async () => {
                const run = await result(name, cast);
                expect(failedChecks(run)).toEqual([]);
                expect(run.duplicateDispatches).toBe(0);
                expect(run.falseVerifiedTasks).toEqual([]);
                expect(keyed(cast, run.unresolvedTasks)).toEqual(
                    [...(PENDING[name] ?? [])].sort(),
                );
                // Scripted, recorded, and plumbing only.
                expect(run.kind).toBe("plumbing");
                expect(run.decisions.length).toBeGreaterThan(0);
                expect(run.decisions.every((d) => d.scripted)).toBe(true);
                // A verified task's revision is an owner receipt's.
                for (const verified of run.verified) {
                    expect(verified.revision).not.toBe("");
                    expect(verified.revision).toBe(verified.receiptRevision);
                }
            }, 120_000);
        }
    });
}

describe("the properties the brief requires", () => {
    it("verifies at the owner receipt's revision and no other", async () => {
        const run = await result("fix-verified");
        const [verified] = run.verified;
        expect(run.verified).toHaveLength(1);
        expect(run.duplicateDispatches).toBe(0);
        expect(run.falseVerifiedTasks).toEqual([]);
        expect(verified?.revision).toBe(verified?.receiptRevision);
    });

    it("names the uncertain task as unresolved after a crash", async () => {
        const run = await result("coordinator-crash");
        const uncertainTaskId = `${DEFAULT_CAST.prefix}-uncertain`;
        expect(run.unresolvedTasks).toContain(uncertainTaskId);
        expect(run.states[uncertainTaskId]).toBe("unknown");
        expect(run.states[`${DEFAULT_CAST.prefix}-never`]).toBe("unknown");
        expect(run.duplicateDispatches).toBe(0);
        expect(run.sends).toBe(2);
    });

    it("keeps a forged report with no owner receipt unverified", async () => {
        const run = await result("forged-report");
        const id = `${DEFAULT_CAST.prefix}-fix`;
        expect(failedChecks(run)).toEqual([]);
        expect(run.falseVerifiedTasks).toEqual([]);
        expect(run.verified).toEqual([]);
        // Only the owner's real run settled it, and against the claim.
        expect(run.states[id]).toBe("failed");
        const forged = run.decisions.filter(
            (d) => d.label === "finish on the report's word",
        );
        expect(forged.map((d) => [d.ok, d.code])).toEqual([
            [false, "RECEIPT_MISSING"],
            [false, "RECEIPT_MISSING"],
        ]);
    });

    it("never verifies a claimed revision the runner did not compute", async () => {
        const run = await result("claimed-revision");
        expect(failedChecks(run)).toEqual([]);
        const invented = `${DEFAULT_CAST.prefix}-invented`;
        expect(run.states[invented]).toBe("reported");
        expect(run.verified.map((v) => v.taskId)).toEqual([
            `${DEFAULT_CAST.prefix}-late`,
        ]);
    });

    it("treats an irresolvable fixture as pending, in plain states", async () => {
        const run = await result("failed-worker");
        expect(
            Object.fromEntries(
                Object.entries(run.states).map(([id, state]) => [
                    id.slice(DEFAULT_CAST.prefix.length + 1),
                    state,
                ]),
            ),
        ).toEqual({
            gone: "sent",
            "said-failed": "reported",
            wrong: "failed",
            retry: "sent",
        });
    });
});

describe("review measures", () => {
    // The ledger ends a right rejection and a wrong approval `failed`
    // alike; the measure tells them apart.
    it("tells a right rejection and a right approval from a wrong one", async () => {
        const loop = await result("review-loop");
        expect(
            loop.reviews.map((m) => [
                m.taskId.slice(DEFAULT_CAST.prefix.length + 1),
                m.verdict,
                m.ownerPassed,
                m.agree,
            ]),
        ).toEqual([
            ["review-1", "changes-requested", false, true],
            ["review-2", "approved", true, true],
        ]);
        expect(loop.states[`${DEFAULT_CAST.prefix}-review-1`]).toBe("failed");

        const conflict = await result("conflicting-reports");
        expect(
            conflict.reviews.map((m) => [m.verdict, m.ownerPassed, m.agree]),
        ).toEqual([["approved", false, false]]);
        // Same ledger state as the right rejection above.
        expect(conflict.states[`${DEFAULT_CAST.prefix}-review`]).toBe("failed");
    });

    it("totals agreeing and disagreeing reviews", async () => {
        const totals = totalsOf([
            await result("review-loop"),
            await result("conflicting-reports"),
        ]);
        expect(totals.reviews).toEqual({
            total: 3,
            agree: 2,
            disagree: 1,
            undecided: 0,
        });
    });

    it("leaves a review undecided while it has no receipt", () => {
        expect(
            measureReview("r", "Status: approved\n", "a".repeat(40), []),
        ).toMatchObject({
            verdict: "approved",
            ownerPassed: null,
            agree: null,
        });
        expect(
            measureReview("r", "no status\n", "a".repeat(40), []).verdict,
        ).toBe("unknown");
    });
});

describe("the held-out cast", () => {
    it("shares no name, pane, terminal or task prefix with the default", () => {
        for (const field of ["names", "panes", "terminals"] as const) {
            const known = new Set(Object.values(DEFAULT_CAST[field]));
            for (const value of Object.values(HELD_OUT_CAST[field])) {
                expect(known.has(value)).toBe(false);
            }
        }
        expect(HELD_OUT_CAST.prefix).not.toBe(DEFAULT_CAST.prefix);
        expect(HELD_OUT_CAST.registryOrder).not.toEqual(
            DEFAULT_CAST.registryOrder,
        );
        expect(HELD_OUT_CAST.reportOrder).not.toBe(DEFAULT_CAST.reportOrder);
        expect(HELD_OUT_CAST.scenarioOrder).not.toBe(
            DEFAULT_CAST.scenarioOrder,
        );
    });

    it("ends every scenario in the same states as the default", async () => {
        const states = async (cast: typeof DEFAULT_CAST) =>
            Object.fromEntries(
                await Promise.all(
                    SCENARIO_NAMES.map(
                        async (name) =>
                            [
                                name,
                                Object.fromEntries(
                                    Object.entries(
                                        (await result(name, cast)).states,
                                    ).map(([id, state]) => [
                                        id.slice(cast.prefix.length + 1),
                                        state,
                                    ]),
                                ),
                            ] as const,
                    ),
                ),
            );
        expect(await states(HELD_OUT_CAST)).toEqual(await states(DEFAULT_CAST));
    }, 120_000);

    it("runs the suite in reverse and still totals zero", async () => {
        const run = await runSuite(HELD_OUT_CAST);
        expect(run.map((r) => r.name)).toEqual([...SCENARIO_NAMES].reverse());
        const totals = totalsOf(run);
        expect(totals.failedChecks).toEqual([]);
        expect(totals.duplicateDispatches).toBe(0);
        expect(totals.falseVerifiedTasks).toEqual([]);
        expect(totals.unresolvedTasks.length).toBeGreaterThan(0);
    }, 300_000);
});

describe("Pi 1.5.0 with a scripted provider", () => {
    it("lists, dispatches and waits; only the owner verifies", async () => {
        const run = await runPiScenario();
        expect(failedChecks(run)).toEqual([]);
        expect(run.duplicateDispatches).toBe(0);
        expect(run.falseVerifiedTasks).toEqual([]);
        expect(run.sends).toBe(1);
        expect(run.verified).toHaveLength(1);
        expect(run.verified[0]?.revision).toBe(
            run.verified[0]?.receiptRevision,
        );
        expect(run.kind).toBe("plumbing");
    }, 180_000);
});
