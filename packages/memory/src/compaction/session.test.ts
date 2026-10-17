// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/compaction/session.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { clusterInstructions } from "./clusters.js";
import { Compaction } from "./session.js";
import {
    CLUSTERED,
    HISTORY,
    harness,
    NOW,
    settle,
    turn,
    until,
    warnings,
} from "./testing.js";

describe("Compaction", () => {
    it("shows only its four members", () => {
        const { compaction } = harness();
        expect(Object.getOwnPropertyNames(Compaction.prototype).sort()).toEqual(
            ["clusters", "constructor", "seed", "session", "stop"],
        );
        expect(Object.keys(compaction)).toEqual([]);
    });

    it("connects at once, seeded with the clusters and the turns after them", () => {
        const { open, sessions } = harness({
            clusters: [
                { from: 1, through: 2, abstract: "a", at: "x", model: "m" },
            ],
        });
        open();
        expect(sessions).toHaveLength(1);
        expect(sessions[0]?.seed.turns).toEqual(HISTORY.slice(2));
        expect(sessions[0]?.seed.clusters).toHaveLength(1);
    });

    it("tells Dorothy whether she can reopen the turns", async () => {
        for (const recollect of [true, false]) {
            const h = harness({ recollect });
            const session = h.open();
            session.send("abcd");
            h.sessions[0]?.reply(150);
            h.timers.advance(1000);
            await until(() => h.calls.length === 1);
            expect(h.calls[0]?.request.system).toBe(
                `You are Dorothy,\n\n${clusterInstructions(recollect)}`,
            );
            await h.compaction.stop();
        }
    });

    it("compacts at the next idle past soft, then hands over", async () => {
        const h = harness();
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        expect(h.calls).toHaveLength(0);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions.length === 2);
        expect(h.saved).toEqual([
            [
                {
                    from: 1,
                    through: 2,
                    abstract: "The start.",
                    at: NOW.toISOString(),
                    model: "claude-test",
                },
            ],
        ]);
        // The compaction's cost is saved with its clusters.
        expect(h.costs).toEqual([0.1]);
        expect(h.recorded).toEqual([{ through: 2, clusters: 1 }]);
        expect(h.sessions[0]?.closed).toBe(true);
        expect(h.sessions[1]?.seed.turns).toHaveLength(4);
        expect(h.sessions[1]?.seed.clusters.map((c) => c.through)).toEqual([2]);
        expect(h.compaction.clusters()).toHaveLength(1);
        expect(h.events).toContainEqual({
            type: "compacted",
            from: 1,
            through: 2,
            clusters: 1,
        });
        expect(h.events).toContainEqual({ type: "memory-cost", usd: 0.1 });
    });

    it("holds a message past hard until the new session takes it", async () => {
        const h = harness();
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("next");
        expect(h.sessions[0]?.sent).toEqual(["abcd"]);
        expect(h.events).toContainEqual({ type: "compacting" });
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions.length === 2);
        await until(() => h.sessions[1]?.sent.length === 1);
        expect(h.sessions[1]?.sent).toEqual(["next"]);
        expect(h.sessions[1]?.seed.turns.map((t) => t.text)).not.toContain(
            "next",
        );
    });

    it("sends a message during an idle compaction to the old session, into the tail", async () => {
        const h = harness();
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        session.send("during");
        expect(h.sessions[0]?.sent).toEqual(["abcd", "during"]);
        h.calls[0]?.answer(CLUSTERED);
        await settle();
        // The handover waits for the reply to the message sent meanwhile.
        expect(h.sessions).toHaveLength(1);
        // The old session replies past soft; its idle wait dies with it.
        h.sessions[0]?.reply(150, "done");
        await until(() => h.sessions.length === 2);
        const tail = h.sessions[1]?.seed.turns.map((t) => t.text) ?? [];
        expect(tail.slice(-2)).toEqual(["during", "done"]);
        expect(h.saved[0]?.at(-1)?.through).toBe(2);
        h.timers.advance(100_000);
        await settle();
        expect(h.calls).toHaveLength(1);
    });

    it("sends every held message on when sending one throws", async () => {
        const h = harness();
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("first");
        session.send("second");
        await until(() => h.calls.length === 1);
        h.faults.send = "first";
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions[1]?.sent.length === 1);
        await settle();
        expect(h.sessions[1]?.sent).toEqual(["second"]);
        expect(warnings(h.events)).toEqual([
            "compaction: couldn't send a held message: pipe closed",
        ]);
    });

    it("holds a message sent while the clusters are saved, for the new session", async () => {
        let saveDone = () => {};
        const saving = new Promise<void>((resolve) => {
            saveDone = resolve;
        });
        const h = harness({ saving });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.saved.length === 1);
        session.send("racing");
        expect(h.sessions[0]?.sent).toEqual(["abcd"]);
        saveDone();
        await until(() => h.sessions.length === 2);
        await until(() => h.sessions[1]?.sent.length === 1);
        expect(h.sessions[1]?.sent).toEqual(["racing"]);
        expect(h.sessions[1]?.seed.turns.map((t) => t.text)).not.toContain(
            "racing",
        );
    });

    it("seeds a reconnection from the clusters, not the whole conversation", async () => {
        const h = harness();
        const first = h.open();
        first.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions.length === 2);
        const all = [...HISTORY, turn("user"), turn("assistant")];
        h.open(all);
        expect(h.sessions[2]?.seed.turns).toEqual(all.slice(2));
        expect(h.sessions[2]?.seed.clusters).toHaveLength(1);
    });

    it("seeds a reconnection made while the clusters are saved from those clusters", async () => {
        let saveDone = () => {};
        const saving = new Promise<void>((resolve) => {
            saveDone = resolve;
        });
        const h = harness({ saving });
        const first = h.open();
        first.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.saved.length === 1);
        // App reconnects: it closes the old session without waiting and
        // opens the next at once.
        void first.close();
        const all = [...HISTORY, turn("user"), turn("assistant")];
        const next = h.open(all);
        next.send("waiting");
        expect(h.sessions).toHaveLength(1);
        saveDone();
        await until(() => h.sessions.length === 2);
        expect(h.sessions[1]?.seed.turns).toEqual(all.slice(2));
        expect(h.sessions[1]?.seed.clusters).toHaveLength(1);
        expect(h.sessions[1]?.sent).toEqual(["waiting"]);
        expect(h.events).not.toContainEqual({ type: "compacting" });
    });

    it("sends every message held for a save on when sending one throws", async () => {
        let saveDone = () => {};
        const saving = new Promise<void>((resolve) => {
            saveDone = resolve;
        });
        const h = harness({ saving });
        const first = h.open();
        first.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.saved.length === 1);
        void first.close();
        const next = h.open([...HISTORY, turn("user"), turn("assistant")]);
        next.send("first");
        next.send("second");
        h.faults.send = "first";
        saveDone();
        await until(() => h.sessions[1]?.sent.length === 1);
        await settle();
        expect(h.sessions[1]?.sent).toEqual(["second"]);
        expect(h.events.filter((e) => e.type === "error")).toEqual([]);
        expect(warnings(h.events)).toEqual([
            "compaction: couldn't send a held message: pipe closed",
        ]);
        await next.close();
    });

    it("seeds a reconnection made while the compaction is recorded only once it is", async () => {
        let recordDone = () => {};
        const recording = new Promise<void>((resolve) => {
            recordDone = resolve;
        });
        const h = harness({ recording });
        const first = h.open();
        first.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.recorded.length === 1);
        void first.close();
        const next = h.open([...HISTORY, turn("user"), turn("assistant")]);
        await settle();
        // The transcript's compaction event comes before the new session's.
        expect(h.sessions).toHaveLength(1);
        recordDone();
        await until(() => h.sessions.length === 2);
        expect(h.sessions[1]?.seed.clusters).toHaveLength(1);
        await next.close();
    });

    it("passes the inner session's events through, and its interrupts", async () => {
        const h = harness();
        const session = h.open();
        h.sessions[0]?.emit({ type: "delta", text: "Hi" });
        expect(h.events).toEqual([{ type: "delta", text: "Hi" }]);
        await session.interrupt();
        expect(h.sessions[0]?.interrupts).toBe(1);
    });
});
