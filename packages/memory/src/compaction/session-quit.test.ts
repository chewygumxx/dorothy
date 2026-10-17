// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/compaction/session-quit.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { StructuredOutcome } from "@dorothy/core";
import { QUIT_GRACE_MS } from "./session.js";
import {
    CLUSTERED,
    HISTORY,
    harness,
    settle,
    turn,
    until,
    warnings,
} from "./testing.js";

describe("Compaction: retries and quitting", () => {
    it("waits twice as long after a failure, and gives up after three", async () => {
        const h = harness();
        const session = h.open();
        for (let failure = 0; failure < 3; failure++) {
            session.send("abcd");
            h.sessions[0]?.reply(150);
            h.timers.advance(1000 * 2 ** failure - 1);
            await settle();
            expect(h.calls).toHaveLength(failure);
            h.timers.advance(1);
            await until(() => h.calls.length === failure + 1);
            h.calls[failure]?.answer({ ok: false, reason: "bad", costUsd: 0 });
            await settle();
        }
        expect(warnings(h.events).at(-1)).toBe(
            "compaction failed: bad; no more tries until the next launch",
        );
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("straight");
        expect(h.sessions[0]?.sent.at(-1)).toBe("straight");
        h.timers.advance(100_000);
        await settle();
        expect(h.calls).toHaveLength(3);
    });

    it("skips when the latest exchange alone fills the tail, until another", async () => {
        const h = harness();
        const session = h.open([]);
        session.send("x".repeat(40));
        h.sessions[0]?.reply(150, "x".repeat(40));
        h.timers.advance(1000);
        await settle();
        expect(h.calls).toHaveLength(0);
        expect(warnings(h.events)).toEqual([
            "compaction: nothing to compact; the latest exchange alone fills the tail",
        ]);
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
    });

    it("writes nothing when closed while Dorothy is asked", async () => {
        const h = harness();
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        await session.close();
        await h.compaction.stop();
        expect(h.saved).toEqual([]);
        expect(h.recorded).toEqual([]);
        expect(h.sessions[0]?.closed).toBe(true);
        expect(h.sessions).toHaveLength(1);
    });

    it("drops what Dorothy's call answers after quitting, whether clusters or a failure", async () => {
        const answers: [string, StructuredOutcome][] = [
            ["clusters", CLUSTERED],
            ["a failure", { ok: false, reason: "offline", costUsd: 0.2 }],
        ];
        for (const [what, answer] of answers) {
            const h = harness({ cancels: false });
            const session = h.open();
            session.send("abcd");
            h.sessions[0]?.reply(150);
            h.timers.advance(1000);
            await until(() => h.calls.length === 1);
            const stopped = h.compaction.stop();
            h.calls[0]?.answer(answer);
            await stopped;
            await settle();
            expect(h.saved, what).toEqual([]);
            expect(h.recorded, what).toEqual([]);
            expect(warnings(h.events), what).toEqual([]);
            expect(
                h.events.filter((event) => event.type === "memory-cost"),
                what,
            ).toEqual([]);
            expect(h.sessions, what).toHaveLength(1);
        }
    });

    it("connects nothing when closed while the clusters are saved", async () => {
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
        await session.close();
        saveDone();
        await h.compaction.stop();
        // Saved clusters are recorded, so the sidecar and transcript agree.
        expect(h.recorded).toEqual([{ through: 2, clusters: 1 }]);
        expect(h.sessions).toHaveLength(1);
        expect(h.sessions[0]?.closed).toBe(true);
    });

    it("lets Compaction.stop wait for a save under way, and connect nothing after it", async () => {
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
        // What had been recorded when stop settled: nothing it writes to
        // is closed under the save.
        const recordedAtStop: number[] = [];
        void h.compaction.stop().then(() => {
            recordedAtStop.push(h.recorded.length);
        });
        await settle();
        expect(recordedAtStop).toEqual([]);
        h.timers.advance(QUIT_GRACE_MS - 1);
        saveDone();
        await until(() => recordedAtStop.length === 1);
        expect(recordedAtStop).toEqual([1]);
        await settle();
        expect(h.sessions).toHaveLength(1);
    });

    it("connects no session when quitting cancels a run before the first", async () => {
        const h = harness({ estimate: 500 });
        const session = h.open([...HISTORY, turn("user"), turn("assistant")]);
        session.send("early");
        await until(() => h.calls.length === 1);
        await h.compaction.stop();
        await settle();
        expect(h.sessions).toHaveLength(0);
    });

    it("connects no session when quitting comes while a run before the first saves", async () => {
        let saveDone = () => {};
        const saving = new Promise<void>((resolve) => {
            saveDone = resolve;
        });
        const h = harness({ estimate: 500, saving });
        const session = h.open([...HISTORY, turn("user"), turn("assistant")]);
        session.send("early");
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.saved.length === 1);
        const stopped = h.compaction.stop();
        saveDone();
        await stopped;
        await settle();
        expect(h.recorded).toEqual([{ through: 2, clusters: 1 }]);
        expect(h.sessions).toHaveLength(0);
    });

    it("lets Compaction.stop settle while a record never does", async () => {
        const h = harness({ recording: new Promise<void>(() => {}) });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.recorded.length === 1);
        let stopped = false;
        void h.compaction.stop().then(() => {
            stopped = true;
        });
        await settle();
        expect(stopped).toBe(false);
        h.timers.advance(QUIT_GRACE_MS);
        await until(() => stopped);
        expect(h.sessions).toHaveLength(1);
    });

    it("lets Compaction.stop settle while a save never does, and a reconnection waits for it", async () => {
        const h = harness({ saving: new Promise<void>(() => {}) });
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
        let stopped = false;
        void h.compaction.stop().then(() => {
            stopped = true;
        });
        h.timers.advance(QUIT_GRACE_MS - 1);
        await settle();
        expect(stopped).toBe(false);
        h.timers.advance(1);
        await until(() => stopped);
        await settle();
        expect(h.sessions).toHaveLength(1);
        expect(h.recorded).toEqual([]);
    });
});
