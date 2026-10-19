// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/compaction/session-saves.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { Cluster } from "../memory/sidecar.js";
import type { Claim, SaveResult } from "./session.js";
import {
    CLUSTERED,
    HISTORY,
    harness,
    settle,
    through,
    until,
    warnings,
} from "./testing.js";

describe("Compaction: saves and other writers", () => {
    it("counts a failed save as a failure, and hands over nothing", async () => {
        const h = harness({ save: { ok: false, reason: "disk full" } });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => warnings(h.events).length === 1);
        expect(warnings(h.events)).toEqual(["compaction failed: disk full"]);
        expect(h.sessions).toHaveLength(1);
        expect(h.recorded).toEqual([]);
        expect(h.compaction.clusters()).toEqual([]);
    });

    it("adopts the clusters another writer saved first, and hands over to them without a failure or a record", async () => {
        const theirs: Cluster[] = [
            { from: 1, through: 2, abstract: "a", at: "x", model: "m" },
            { from: 3, through: 4, abstract: "b", at: "x", model: "m" },
        ];
        const h = harness({ save: { ok: true, clusters: theirs } });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions.length === 2);
        expect(h.recorded).toEqual([]);
        expect(h.compaction.clusters()).toEqual(theirs);
        expect(h.sessions[1]?.seed.clusters).toEqual(theirs);
        expect(h.sessions[1]?.seed.turns).toHaveLength(2);
        expect(h.sessions[0]?.closed).toBe(true);
        expect(warnings(h.events)).toEqual([]);
        expect(h.events).toContainEqual({
            type: "compacted",
            from: 1,
            through: 4,
            clusters: 2,
        });
        // No failure counted: the next idle wait is not doubled.
        for (let exchange = 0; exchange < 2; exchange++) {
            session.send("abcd");
            h.sessions[1]?.reply(150);
        }
        h.timers.advance(1000);
        await until(() => h.calls.length === 2);
    });

    it("takes up another writer's clusters that cover only part of the run, and continues after them", async () => {
        const theirs: Cluster[] = [
            { from: 1, through: 1, abstract: "a", at: "x", model: "m" },
        ];
        const answers: SaveResult[] = [{ ok: true, clusters: theirs }];
        const h = harness({ save: () => answers.shift() ?? { ok: true } });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions.length === 2);
        expect(h.compaction.clusters()).toEqual(theirs);
        expect(h.sessions[1]?.seed.turns).toHaveLength(5);
        expect(h.recorded).toEqual([]);
        expect(warnings(h.events)).toEqual([]);
        for (let exchange = 0; exchange < 2; exchange++) {
            session.send("abcd");
            h.sessions[1]?.reply(150);
        }
        h.timers.advance(1000);
        await until(() => h.calls.length === 2);
        expect(h.calls[1]?.request.prompt).toContain('<turn n="2">');
        expect(h.calls[1]?.request.prompt).not.toContain('<turn n="1">');
    });

    it("fails a save whose other writer's clusters stop short of the run, or reach its latest message", async () => {
        const cluster = (through: number): Cluster => ({
            from: 1,
            through,
            abstract: "a",
            at: "x",
            model: "m",
        });
        for (const [theirs, reason] of [
            [[], "the notes' clusters end at turn 0, before turn 1"],
            [
                [cluster(5)],
                "the notes' clusters reach turn 5, this chat's latest message",
            ],
        ] as const) {
            const h = harness({ save: { ok: true, clusters: theirs } });
            const session = h.open();
            session.send("abcd");
            h.sessions[0]?.reply(150);
            h.timers.advance(1000);
            await until(() => h.calls.length === 1);
            h.calls[0]?.answer(CLUSTERED);
            await until(() => warnings(h.events).length === 1);
            expect(warnings(h.events)).toEqual([
                `compaction failed: ${reason}`,
            ]);
            expect(h.compaction.clusters()).toEqual([]);
            expect(h.sessions).toHaveLength(1);
        }
    });

    it("fails a save whose other writer's clusters leave a gap before the run", async () => {
        const cluster = (from: number, through: number): Cluster => ({
            from,
            through,
            abstract: "a",
            at: "x",
            model: "m",
        });
        // This TUI's clusters reach turn 2, so the run starts at turn 3;
        // the notes' end at turn 1, leaving turn 2 in no cluster.
        const ours = [cluster(1, 2)];
        const h = harness({
            clusters: ours,
            save: { ok: true, clusters: [cluster(1, 1)] },
        });
        const session = h.open([...HISTORY, ...HISTORY]);
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        expect(h.calls[0]?.request.prompt).toContain('<turn n="3">');
        expect(h.calls[0]?.request.prompt).not.toContain('<turn n="2">');
        h.calls[0]?.answer(through(6));
        await until(() => warnings(h.events).length === 1);
        expect(warnings(h.events)).toEqual([
            "compaction failed: the notes' clusters end at turn 1, before turn 3",
        ]);
        expect(h.compaction.clusters()).toEqual(ours);
        expect(h.sessions).toHaveLength(1);
    });

    it("hands over when recording fails after the save, rather than compacting again at every idle", async () => {
        const h = harness({ record: new Error("transcript gone") });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions.length === 2);
        expect(warnings(h.events)).toEqual([
            "compaction: couldn't record the compaction in the transcript: transcript gone",
        ]);
        expect(h.compaction.clusters()).toHaveLength(1);
        expect(h.sessions[0]?.closed).toBe(true);
        // After the compacted event, which clears compaction's warnings
        // from the screen; this one is news of the compaction itself.
        expect(
            h.events
                .filter((e) => e.type === "compacted" || e.type === "warning")
                .map((e) => e.type),
        ).toEqual(["compacted", "warning"]);
        expect(h.events).toContainEqual({
            type: "compacted",
            from: 1,
            through: 2,
            clusters: 1,
        });
    });

    it("counts a thrown save as a failure, so the next idle waits twice as long", async () => {
        const h = harness({ save: new Error("disk gone") });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => warnings(h.events).length === 1);
        expect(warnings(h.events)).toEqual(["compaction failed: disk gone"]);
        expect(h.sessions).toHaveLength(1);
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1999);
        await settle();
        expect(h.calls).toHaveLength(1);
        h.timers.advance(1);
        await until(() => h.calls.length === 2);
    });

    it("counts a thrown claim as a failure, and sends the held message on", async () => {
        const claim: Claim = {
            take: async () => {
                throw new Error("index gone");
            },
            release: async () => {},
        };
        const h = harness({ claim });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("next");
        await until(() => h.sessions[0]?.sent.includes("next") === true);
        expect(warnings(h.events)).toEqual([
            "compaction failed: index gone",
            "compaction: the context is nearly full; sending anyway",
        ]);
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1999);
        await settle();
        expect(h.timers.pending.size).toBe(1);
    });

    it("keeps a handover whose claim can't be let go, and counts no failure", async () => {
        const claim: Claim = {
            take: async () => true,
            release: async () => {
                throw new Error("index gone");
            },
        };
        const h = harness({ claim });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => warnings(h.events).length === 1);
        expect(warnings(h.events)).toEqual([
            "compaction: couldn't let go of the claim: index gone",
        ]);
        expect(h.sessions).toHaveLength(2);
        h.sessions[1]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 2);
    });

    it("counts no failure for a throw after the handover", async () => {
        const h = harness();
        const session = h.open();
        session.subscribe((event) => {
            if (event.type === "compacted") {
                throw new Error("listener broke");
            }
        });
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => warnings(h.events).length === 1);
        expect(warnings(h.events)).toEqual([
            "compaction: after handing over: listener broke",
        ]);
        expect(h.sessions).toHaveLength(2);
        // Not doubled: the next idle wait is the first's length.
        h.sessions[1]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 2);
    });

    it("still warns that recording failed when a listener throws on the compacted event", async () => {
        const h = harness({ record: new Error("transcript gone") });
        const session = h.open();
        session.subscribe((event) => {
            if (event.type === "compacted") {
                throw new Error("listener broke");
            }
        });
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() =>
            warnings(h.events).includes(
                "compaction: after handing over: listener broke",
            ),
        );
        expect(warnings(h.events)).toEqual([
            "compaction: couldn't record the compaction in the transcript: transcript gone",
            "compaction: after handing over: listener broke",
        ]);
    });

    it("keeps a listener's throw on the compacted event over its throw on the warning after", async () => {
        const h = harness({ record: new Error("transcript gone") });
        const session = h.open();
        session.subscribe((event) => {
            if (event.type === "compacted") {
                throw new Error("compacted broke");
            }
            if (
                event.type === "warning" &&
                event.message.includes("couldn't record")
            ) {
                throw new Error("warning broke");
            }
        });
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => warnings(h.events).length === 2);
        await settle();
        expect(warnings(h.events)).toEqual([
            "compaction: couldn't record the compaction in the transcript: transcript gone",
            "compaction: after handing over: compacted broke",
        ]);
    });

    it("re-arms an idle wait set while a compaction failed with the doubled delay", async () => {
        const h = harness();
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        // The reply to a message sent meanwhile starts an idle wait at the
        // delay before the failure.
        session.send("during");
        h.sessions[0]?.reply(150);
        h.calls[0]?.answer({ ok: false, reason: "bad", costUsd: 0 });
        await until(() => warnings(h.events).length === 1);
        h.timers.advance(1999);
        await settle();
        expect(h.calls).toHaveLength(1);
        h.timers.advance(1);
        await until(() => h.calls.length === 2);
    });

    it("drops an idle wait set while the last allowed compaction failed", async () => {
        const h = harness();
        const session = h.open();
        for (let failure = 0; failure < 3; failure++) {
            session.send("abcd");
            h.sessions[0]?.reply(150);
            h.timers.advance(1000 * 2 ** failure);
            await until(() => h.calls.length === failure + 1);
            if (failure === 2) {
                session.send("during");
                h.sessions[0]?.reply(150);
            }
            h.calls[failure]?.answer({ ok: false, reason: "bad", costUsd: 0 });
            await settle();
        }
        expect(h.timers.pending.size).toBe(0);
        h.timers.advance(100_000);
        await settle();
        expect(h.calls).toHaveLength(3);
    });

    it("waits for the old session to finish closing, so a quit just after the handover leaves no CLI running", async () => {
        let closed = () => {};
        const closing = new Promise<void>((resolve) => {
            closed = resolve;
        });
        const h = harness({ closing });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions[0]?.closed === true);
        const settled: string[] = [];
        void session.close().then(() => settled.push("close"));
        void h.compaction.stop().then(() => settled.push("stop"));
        await settle();
        expect(settled).toEqual([]);
        closed();
        await until(() => settled.length === 2);
    });

    it("arms its idle wait before listeners hear the turn-end, so it fires ahead of a review's armed there", async () => {
        const h = harness();
        const session = h.open();
        const armed: number[] = [];
        session.subscribe((event) => {
            if (event.type === "turn-end") {
                armed.push(h.timers.pending.size);
            }
        });
        session.send("abcd");
        h.sessions[0]?.reply(150);
        expect(armed).toEqual([1]);
    });

    it("checks the turns about to leave, with the number of the first, before asking Dorothy", async () => {
        const h = harness({ ready: { ok: true } });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("next");
        await until(() => h.calls.length === 1);
        // Four turns of history, an exchange, and a message held: the
        // oldest two leave, as the tail of four tokens allows.
        expect(h.checked).toEqual([{ from: 1, turns: HISTORY.slice(0, 2) }]);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.saved.length === 1);
    });

    it("stops compacting, without asking Dorothy, when the turns leaving are not the conversation's own", async () => {
        const h = harness({
            ready: (outgoing) =>
                outgoing?.from === 1
                    ? {
                          ok: false,
                          reason: "turn 1 here is not turn 1 of its transcript",
                      }
                    : { ok: true },
        });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("next");
        await until(() => h.sessions[0]?.sent.includes("next") === true);
        expect(h.calls).toHaveLength(0);
        expect(h.saved).toHaveLength(0);
        expect(warnings(h.events)[0]).toBe(
            "compaction: off until the next launch; turn 1 here is not turn 1 of its transcript",
        );
    });

    it("stops compacting, without asking Dorothy, once the notes became unreadable after launch", async () => {
        const h = harness({
            ready: { ok: false, reason: "its notes can't be read (not JSON)" },
        });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("next");
        await until(() => h.sessions[0]?.sent.includes("next") === true);
        expect(h.calls).toHaveLength(0);
        expect(warnings(h.events)).toEqual([
            "compaction: off until the next launch; its notes can't be read (not JSON)",
            "compaction: the context is nearly full; sending anyway",
        ]);
        h.sessions[0]?.reply(250);
        session.send("straight");
        expect(h.sessions[0]?.sent.at(-1)).toBe("straight");
        h.sessions[0]?.reply(150);
        expect(h.timers.pending.size).toBe(0);
        h.timers.advance(100_000);
        await settle();
        expect(h.calls).toHaveLength(0);
    });
});
