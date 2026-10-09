// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/compaction/compact.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type {
    StructuredCall,
    StructuredOutcome,
    StructuredRequest,
    Turn,
} from "@dorothy/core";
import { clusterInstructions } from "./clusters.js";
import { COMPACTION_TIMEOUT_MS, compact } from "./compact.js";

const NOW = new Date("2026-10-07T08:00:00.000Z");
const turns: Turn[] = [
    { role: "user", text: "abcd" },
    { role: "assistant", text: "abcd" },
    { role: "user", text: "abcd" },
    { role: "assistant", text: "abcd" },
];

function answering(outcome: StructuredOutcome) {
    const requests: StructuredRequest[] = [];
    const call: StructuredCall = async (request) => {
        requests.push(request);
        return outcome;
    };
    return { call, requests };
}
const run = (call: StructuredCall, signal?: AbortSignal, recollect = true) =>
    compact({
        turns,
        clusters: [],
        tail: 2,
        persona: "You are Dorothy,",
        recollect,
        call,
        now: () => NOW,
        ...(signal === undefined ? {} : { signal }),
    });

describe("compact", () => {
    it("asks Dorothy about the outgoing turns, as herself", async () => {
        const { call, requests } = answering({
            ok: true,
            output: { clusters: [{ through: 2, abstract: "The start." }] },
            model: "claude-test",
            costUsd: 0.1,
        });
        expect(await run(call)).toEqual({
            kind: "compacted",
            range: { from: 1, through: 2 },
            clusters: [
                {
                    from: 1,
                    through: 2,
                    abstract: "The start.",
                    at: NOW.toISOString(),
                    model: "claude-test",
                },
            ],
            costUsd: 0.1,
        });
        expect(requests[0]?.what).toBe("compaction");
        expect(requests[0]?.system).toBe(
            `You are Dorothy,\n\n${clusterInstructions(true)}`,
        );
        expect(requests[0]?.prompt).toContain('<turn n="2">');
        expect(requests[0]?.prompt).not.toContain('<turn n="3">');
        expect(requests[0]?.timeoutMs).toBe(COMPACTION_TIMEOUT_MS);
    });

    it("leaves reopening out of the instructions without recollect", async () => {
        const { call, requests } = answering({
            ok: false,
            reason: "unused",
            costUsd: 0,
        });
        await run(call, undefined, false);
        expect(requests[0]?.system).toBe(
            `You are Dorothy,\n\n${clusterInstructions(false)}`,
        );
    });

    it("asks nothing when nothing would leave", async () => {
        const { call, requests } = answering({
            ok: false,
            reason: "unused",
            costUsd: 0,
        });
        expect(
            await compact({
                turns,
                clusters: [],
                tail: 100,
                persona: "P",
                recollect: true,
                call,
                now: () => NOW,
            }),
        ).toEqual({ kind: "nothing" });
        expect(requests).toEqual([]);
    });

    it("sends one call only the oldest turns that fit its cap", async () => {
        const { call, requests } = answering({
            ok: true,
            output: { clusters: [{ through: 1, abstract: "The start." }] },
            model: "claude-test",
            costUsd: 0.1,
        });
        const outcome = await compact({
            turns,
            clusters: [],
            tail: 2,
            cap: 1,
            persona: "P",
            recollect: true,
            call,
            now: () => NOW,
        });
        expect(outcome.kind === "compacted" && outcome.range).toEqual({
            from: 1,
            through: 1,
        });
        expect(requests[0]?.prompt).toContain('<turn n="1">');
        expect(requests[0]?.prompt).not.toContain('<turn n="2">');
    });

    it("fails with the call's reason, or the output's, keeping the cost", async () => {
        expect(
            await run(
                answering({ ok: false, reason: "offline", costUsd: 0.2 }).call,
            ),
        ).toEqual({ kind: "failed", reason: "offline", costUsd: 0.2 });
        expect(
            await run(
                answering({
                    ok: true,
                    output: { clusters: [{ through: 1, abstract: "a" }] },
                    model: "m",
                    costUsd: 0.3,
                }).call,
            ),
        ).toEqual({
            kind: "failed",
            reason: "the last cluster ends at 1, not 2",
            costUsd: 0.3,
        });
    });

    it("passes the signal on", async () => {
        const controller = new AbortController();
        const { call, requests } = answering({
            ok: false,
            reason: "cancelled",
            costUsd: 0,
        });
        await run(call, controller.signal);
        expect(requests[0]?.signal).toBe(controller.signal);
    });
});
