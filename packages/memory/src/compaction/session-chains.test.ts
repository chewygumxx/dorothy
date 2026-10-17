// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/compaction/session-chains.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    CLUSTERED,
    compactedRanges,
    HISTORY,
    harness,
    seedSize,
    settle,
    sized,
    through,
    turn,
    until,
    warnings,
} from "./testing.js";

describe("Compaction: connecting, chains and failures", () => {
    it("connects, with a warning, a first seed that can't be estimated", () => {
        const h = harness();
        h.faults.estimate = new Error("guess failed");
        h.open();
        expect(h.sessions).toHaveLength(1);
        return until(
            () =>
                warnings(h.events).join() ===
                "compaction: couldn't estimate the new session: guess failed",
        );
    });

    it("connects, with a warning, a seed after a save that can't be estimated", async () => {
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
        next.send("waiting");
        h.faults.estimate = new Error("guess failed");
        saveDone();
        await until(() => h.sessions.length === 2);
        expect(h.sessions[1]?.sent).toEqual(["waiting"]);
        await settle();
        expect(h.events.filter((e) => e.type === "error")).toEqual([]);
        expect(warnings(h.events)).toContain(
            "compaction: couldn't estimate the new session: guess failed",
        );
        await next.close();
    });

    it("fails as a session does when the seed after a save can't connect", async () => {
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
        next.send("waiting");
        h.faults.connect = new Error("spawn failed");
        saveDone();
        await until(() => h.events.some((e) => e.type === "error"));
        expect(h.events.filter((e) => e.type === "error")).toEqual([
            {
                type: "error",
                message: "couldn't start Dorothy's session: spawn failed",
            },
        ]);
        // Dead, as a session that failed: App reconnects at the next
        // message, and nothing is paid for meanwhile.
        next.send("again");
        await settle();
        expect(h.calls).toHaveLength(1);
        expect(h.sessions).toHaveLength(1);
        await next.close();
    });

    it("leaves no unhandled rejection when a listener throws on the error after a save", async () => {
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on("unhandledRejection", onUnhandled);
        try {
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
            next.subscribe((event) => {
                if (event.type === "error") {
                    throw new Error("listener broke");
                }
            });
            h.faults.connect = new Error("spawn failed");
            saveDone();
            await until(() => h.events.some((e) => e.type === "error"));
            await settle();
            expect(unhandled).toEqual([]);
        } finally {
            process.off("unhandledRejection", onUnhandled);
        }
    });

    it("fails as a session does when the session after a run can't connect", async () => {
        const h = harness({ estimate: 500 });
        const session = h.open([...HISTORY, turn("user"), turn("assistant")]);
        session.send("early");
        await until(() => h.calls.length === 1);
        h.faults.connect = new Error("spawn failed");
        h.calls[0]?.answer({ ok: false, reason: "offline", costUsd: 0 });
        await until(() => h.events.some((e) => e.type === "error"));
        expect(h.events.filter((e) => e.type === "error")).toEqual([
            {
                type: "error",
                message: "couldn't start Dorothy's session: spawn failed",
            },
        ]);
        session.send("again");
        await settle();
        expect(h.calls).toHaveLength(1);
        expect(h.sessions).toHaveLength(0);
    });

    it("compacts before connecting a seed already past hard", async () => {
        const h = harness({ estimate: 500 });
        const session = h.open([...HISTORY, turn("user"), turn("assistant")]);
        expect(h.sessions).toHaveLength(0);
        session.send("early");
        await until(() => h.calls.length === 1);
        expect(h.events).toContainEqual({ type: "compacting" });
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions.length === 1);
        expect(h.sessions[0]?.seed.clusters).toHaveLength(1);
        await until(() => h.sessions[0]?.sent.length === 1);
        expect(h.sessions[0]?.sent).toEqual(["early"]);
    });

    it("compacts a long history in calls of at most soft less tail, oldest first, before connecting", async () => {
        // Ten turns of 40 tokens; soft 100 less tail 4 takes two a call.
        const history = Array.from({ length: 10 }, (_, i) =>
            sized(i % 2 === 0 ? "user" : "assistant", 40),
        );
        const h = harness({ estimate: seedSize });
        const session = h.open(history);
        session.send("early");
        for (const [n, last] of [2, 4, 6].entries()) {
            await until(() => h.calls.length === n + 1);
            const prompt = h.calls[n]?.request.prompt ?? "";
            expect(prompt).toContain(`<turn n="${last}">`);
            expect(prompt).not.toContain(`<turn n="${last + 1}">`);
            expect(h.sessions).toHaveLength(0);
            h.calls[n]?.answer(through(last));
        }
        await until(() => h.sessions.length === 1);
        expect(h.calls).toHaveLength(3);
        expect(compactedRanges(h.events)).toEqual([
            [1, 2],
            [3, 4],
            [5, 6],
        ]);
        expect(h.recorded.map((r) => r.through)).toEqual([2, 4, 6]);
        expect(h.sessions[0]?.seed.clusters.map((c) => c.through)).toEqual([
            2, 4, 6,
        ]);
        expect(h.sessions[0]?.seed.turns).toEqual(history.slice(6));
        await until(() => h.sessions[0]?.sent.length === 1);
        expect(h.sessions[0]?.sent).toEqual(["early"]);
        expect(h.events.filter((e) => e.type === "compacting")).toHaveLength(1);
        expect(warnings(h.events)).toEqual([]);
    });

    it("holds a message past hard through as many calls as bring the seed under hard, then hands over once", async () => {
        const history = Array.from({ length: 6 }, (_, i) =>
            sized(i % 2 === 0 ? "user" : "assistant", 30),
        );
        const h = harness({ estimate: seedSize });
        const session = h.open(history);
        session.send("y".repeat(240));
        h.sessions[0]?.reply(250, "z".repeat(240));
        session.send("next");
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(through(3));
        // Turns 4 to 8 still estimate past hard: another call at once,
        // with no session between.
        await until(() => h.calls.length === 2);
        expect(h.sessions).toHaveLength(1);
        expect(h.calls[1]?.request.prompt).toContain('<turn n="4">');
        h.calls[1]?.answer(through(6));
        await until(() => h.sessions.length === 2);
        await until(() => h.sessions[1]?.sent.length === 1);
        expect(h.sessions[1]?.sent).toEqual(["next"]);
        expect(h.sessions[1]?.seed.clusters.map((c) => c.through)).toEqual([
            3, 6,
        ]);
        expect(h.sessions[0]?.sent).toHaveLength(1);
        expect(h.sessions[0]?.closed).toBe(true);
        expect(compactedRanges(h.events)).toEqual([
            [1, 3],
            [4, 6],
        ]);
        expect(warnings(h.events)).toEqual([]);
    });

    it("says a listener's throw came after saving, not handing over, in a run that doesn't hand over", async () => {
        const history = Array.from({ length: 6 }, (_, i) =>
            sized(i % 2 === 0 ? "user" : "assistant", 30),
        );
        const h = harness({ estimate: seedSize });
        const session = h.open(history);
        let thrown = false;
        session.subscribe((event) => {
            if (event.type === "compacted" && !thrown) {
                thrown = true;
                throw new Error("listener broke");
            }
        });
        session.send("y".repeat(240));
        h.sessions[0]?.reply(250, "z".repeat(240));
        session.send("next");
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(through(3));
        await until(() => h.calls.length === 2);
        expect(warnings(h.events)).toEqual([
            "compaction: after saving: listener broke",
        ]);
        h.calls[1]?.answer(through(6));
        await until(() => h.sessions[1]?.sent.length === 1);
        expect(h.sessions[1]?.sent).toEqual(["next"]);
    });

    it("hands over as usual, with a warning, when the new seed can't be estimated after a save", async () => {
        const history = Array.from({ length: 6 }, (_, i) =>
            sized(i % 2 === 0 ? "user" : "assistant", 30),
        );
        const h = harness({ estimate: seedSize });
        const session = h.open(history);
        session.send("y".repeat(240));
        h.sessions[0]?.reply(250, "z".repeat(240));
        session.send("next");
        await until(() => h.calls.length === 1);
        h.faults.estimate = new Error("guess failed");
        h.calls[0]?.answer(through(3));
        await until(() => h.sessions[1]?.sent.length === 1);
        expect(h.sessions[1]?.sent).toEqual(["next"]);
        expect(h.calls).toHaveLength(1);
        expect(
            h.events
                .filter((e) => e.type === "compacted" || e.type === "warning")
                .map((e) => (e.type === "warning" ? e.message : e.type)),
        ).toEqual([
            "compacted",
            "compaction: couldn't estimate the new session: guess failed",
        ]);
    });

    it("sends a held message on, from the clusters saved so far, when a later call fails", async () => {
        const history = Array.from({ length: 6 }, (_, i) =>
            sized(i % 2 === 0 ? "user" : "assistant", 30),
        );
        const h = harness({ estimate: seedSize });
        const session = h.open(history);
        session.send("y".repeat(240));
        h.sessions[0]?.reply(250, "z".repeat(240));
        session.send("next");
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(through(3));
        await until(() => h.calls.length === 2);
        h.calls[1]?.answer({ ok: false, reason: "offline", costUsd: 0 });
        await until(() => h.sessions[1]?.sent.length === 1);
        expect(h.sessions).toHaveLength(2);
        expect(h.sessions[1]?.sent).toEqual(["next"]);
        expect(h.sessions[1]?.seed.clusters.map((c) => c.through)).toEqual([3]);
        expect(h.sessions[0]?.sent).toHaveLength(1);
        expect(h.sessions[0]?.closed).toBe(true);
        expect(warnings(h.events)).toEqual([
            "compaction failed: offline",
            "compaction: the context is nearly full; sending anyway",
        ]);
    });

    it("on failure, warns and sends the held message to the old session", async () => {
        const h = harness();
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("next");
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer({ ok: false, reason: "offline", costUsd: 0.2 });
        await until(() => h.sessions[0]?.sent.includes("next") === true);
        expect(h.sessions).toHaveLength(1);
        expect(h.saved).toEqual([]);
        expect(warnings(h.events)).toEqual([
            "compaction failed: offline",
            "compaction: the context is nearly full; sending anyway",
        ]);
        expect(h.events).toContainEqual({ type: "memory-cost", usd: 0.2 });
    });

    it("warns that the context is nearly full when the new session can't connect after a save, and the held message goes to the old one", async () => {
        const h = harness();
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("next");
        await until(() => h.calls.length === 1);
        h.faults.connect = new Error("spawn failed");
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions[0]?.sent.includes("next") === true);
        // Saved and kept, but counted as a failed compaction: no session
        // took over, so the wait before the next try doubles.
        expect(h.saved).toHaveLength(1);
        expect(warnings(h.events)).toEqual([
            "compaction failed: spawn failed",
            "compaction: the context is nearly full; sending anyway",
        ]);
        expect(h.sessions).toHaveLength(1);
    });

    it("lets Compaction.stop settle when a listener throws on the warning that follows a run", async () => {
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on("unhandledRejection", onUnhandled);
        try {
            const h = harness();
            const session = h.open();
            session.subscribe((event) => {
                if (
                    event.type === "warning" &&
                    event.message.includes("nearly full")
                ) {
                    throw new Error("listener broke");
                }
            });
            session.send("abcd");
            h.sessions[0]?.reply(250);
            session.send("next");
            await until(() => h.calls.length === 1);
            await expect(h.compaction.stop()).resolves.toBeUndefined();
            await settle();
            expect(unhandled).toEqual([]);
            // The held message still went on.
            expect(h.sessions[0]?.sent).toContain("next");
        } finally {
            process.off("unhandledRejection", onUnhandled);
        }
    });
});
