// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/compaction/session-interrupt.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    CLUSTERED,
    compactedRanges,
    HISTORY,
    harness,
    STATS,
    seedSize,
    settle,
    sized,
    through,
    turn,
    until,
    warnings,
} from "./testing.js";

describe("Compaction: interrupts and Esc", () => {
    it("sends a message interrupted while held, and interrupts it once it streams", async () => {
        const h = harness();
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("next");
        await until(() => h.calls.length === 1);
        await session.interrupt();
        expect(h.sessions[0]?.interrupts).toBe(0);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions[1]?.sent.length === 1);
        expect(h.sessions[1]?.sent).toEqual(["next"]);
        expect(h.sessions[1]?.interrupts).toBe(0);
        h.sessions[1]?.emit({ type: "delta", text: "Of" });
        expect(h.sessions[1]?.interrupts).toBe(1);
        h.sessions[1]?.emit({ type: "delta", text: " course" });
        h.sessions[1]?.emit({
            type: "turn-end",
            reply: "Of course",
            interrupted: true,
            stats: STATS,
            contextTokens: 10,
        });
        expect(h.sessions[1]?.interrupts).toBe(1);
        expect(h.events).toContainEqual(
            expect.objectContaining({ type: "turn-end", interrupted: true }),
        );
        // The next message is not interrupted.
        session.send("again");
        h.sessions[1]?.emit({ type: "delta", text: "Yes" });
        expect(h.sessions[1]?.interrupts).toBe(1);
    });

    it("ends a chain at the current call when a held message is interrupted, and sends it on nearly full", async () => {
        // Three calls would bring the seed under hard.
        const history = Array.from({ length: 10 }, (_, i) =>
            sized(i % 2 === 0 ? "user" : "assistant", 40),
        );
        const h = harness({ estimate: seedSize });
        const session = h.open(history);
        session.send("early");
        await until(() => h.calls.length === 1);
        await session.interrupt();
        h.calls[0]?.answer(through(2));
        await until(() => h.sessions[0]?.sent.length === 1);
        await settle();
        expect(h.calls).toHaveLength(1);
        expect(h.sessions).toHaveLength(1);
        expect(h.sessions[0]?.seed.clusters.map((c) => c.through)).toEqual([2]);
        expect(h.sessions[0]?.sent).toEqual(["early"]);
        expect(compactedRanges(h.events)).toEqual([[1, 2]]);
        expect(warnings(h.events)).toEqual([
            "compaction: the context is nearly full; sending anyway",
        ]);
        expect(h.sessions[0]?.interrupts).toBe(0);
        h.sessions[0]?.emit({ type: "delta", text: "Of" });
        expect(h.sessions[0]?.interrupts).toBe(1);
    });

    it("ends a chain with a session at the current call when a held message is interrupted", async () => {
        const history = Array.from({ length: 6 }, (_, i) =>
            sized(i % 2 === 0 ? "user" : "assistant", 30),
        );
        const h = harness({ estimate: seedSize });
        const session = h.open(history);
        session.send("y".repeat(240));
        h.sessions[0]?.reply(250, "z".repeat(240));
        session.send("next");
        await until(() => h.calls.length === 1);
        await session.interrupt();
        h.calls[0]?.answer(through(3));
        await until(() => h.sessions[1]?.sent.length === 1);
        await settle();
        expect(h.calls).toHaveLength(1);
        expect(h.sessions).toHaveLength(2);
        expect(h.sessions[0]?.closed).toBe(true);
        expect(h.sessions[1]?.sent).toEqual(["next"]);
        expect(warnings(h.events)).toEqual([
            "compaction: the context is nearly full; sending anyway",
        ]);
        h.sessions[1]?.emit({ type: "delta", text: "Of" });
        expect(h.sessions[1]?.interrupts).toBe(1);
    });

    it("ends a chain with a session at its second call when a held message is interrupted, handing over once", async () => {
        // Turns 1 to 6 of 30 tokens, then two exchanges of 60: three calls
        // would bring the seed under hard.
        const history = Array.from({ length: 6 }, (_, i) =>
            sized(i % 2 === 0 ? "user" : "assistant", 30),
        );
        const h = harness({ estimate: seedSize });
        const session = h.open(history);
        session.send("y".repeat(240));
        h.sessions[0]?.reply(10, "z".repeat(240));
        session.send("y".repeat(240));
        h.sessions[0]?.reply(250, "z".repeat(240));
        session.send("next");
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(through(3));
        await until(() => h.calls.length === 2);
        expect(h.sessions).toHaveLength(1);
        await session.interrupt();
        expect(h.calls[1]?.request.prompt).toContain('<turn n="6">');
        h.calls[1]?.answer(through(6));
        await until(() => h.sessions[1]?.sent.length === 1);
        await settle();
        expect(h.calls).toHaveLength(2);
        expect(h.sessions).toHaveLength(2);
        expect(h.sessions[0]?.closed).toBe(true);
        expect(h.sessions[0]?.sent).toHaveLength(2);
        expect(h.sessions[1]?.seed.clusters.map((c) => c.through)).toEqual([
            3, 6,
        ]);
        expect(h.sessions[1]?.sent).toEqual(["next"]);
        expect(compactedRanges(h.events)).toEqual([
            [1, 3],
            [4, 6],
        ]);
        expect(warnings(h.events)).toEqual([
            "compaction: the context is nearly full; sending anyway",
        ]);
        expect(h.sessions[1]?.interrupts).toBe(0);
        h.sessions[1]?.emit({ type: "delta", text: "Of" });
        expect(h.sessions[1]?.interrupts).toBe(1);
        expect(h.sessions[0]?.interrupts).toBe(0);
    });

    it("ends a chain when Esc comes after the run chose to go on", async () => {
        const history = Array.from({ length: 10 }, (_, i) =>
            sized(i % 2 === 0 ? "user" : "assistant", 40),
        );
        const h = harness({ estimate: seedSize });
        const session = h.open(history);
        session.subscribe((event) => {
            if (event.type === "compacted") {
                void session.interrupt();
            }
        });
        session.send("early");
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(through(2));
        await until(() => h.sessions[0]?.sent.length === 1);
        await settle();
        expect(h.calls).toHaveLength(1);
        expect(h.sessions[0]?.sent).toEqual(["early"]);
        expect(warnings(h.events)).toEqual([
            "compaction: the context is nearly full; sending anyway",
        ]);
    });

    it("ends a chain with a session when Esc comes after the run chose to go on", async () => {
        // Turns 1 to 6 of 30 tokens, then two exchanges of 60: three calls
        // would bring the seed under hard.
        const history = Array.from({ length: 6 }, (_, i) =>
            sized(i % 2 === 0 ? "user" : "assistant", 30),
        );
        const h = harness({ estimate: seedSize });
        const session = h.open(history);
        session.subscribe((event) => {
            if (event.type === "compacted") {
                void session.interrupt();
            }
        });
        session.send("y".repeat(240));
        h.sessions[0]?.reply(10, "z".repeat(240));
        session.send("y".repeat(240));
        h.sessions[0]?.reply(250, "z".repeat(240));
        session.send("next");
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(through(3));
        await until(() => h.sessions[1]?.sent.length === 1);
        await settle();
        expect(h.calls).toHaveLength(1);
        expect(h.sessions).toHaveLength(2);
        expect(h.sessions[0]?.closed).toBe(true);
        expect(h.sessions[0]?.sent).toHaveLength(2);
        expect(h.sessions[1]?.seed.clusters.map((c) => c.through)).toEqual([3]);
        expect(h.sessions[1]?.sent).toEqual(["next"]);
        expect(compactedRanges(h.events)).toEqual([[1, 3]]);
        expect(warnings(h.events)).toEqual([
            "compaction: the context is nearly full; sending anyway",
        ]);
        h.sessions[1]?.emit({ type: "delta", text: "Of" });
        expect(h.sessions[1]?.interrupts).toBe(1);
        expect(h.sessions[0]?.interrupts).toBe(0);
    });

    it("lets Esc on a message held for a save end no later chain", async () => {
        let saveDone = () => {};
        const saving = new Promise<void>((resolve) => {
            saveDone = resolve;
        });
        let sizing = false;
        const h = harness({
            saving,
            estimate: (seed) => (sizing ? seedSize(seed) : 0),
        });
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
        await next.interrupt();
        saveDone();
        await until(() => h.sessions[1]?.sent.length === 1);
        h.sessions[1]?.reply(10, "x".repeat(4 * 60));
        for (let exchange = 0; exchange < 3; exchange++) {
            next.send("y".repeat(4 * 60));
            h.sessions[1]?.reply(10, "z".repeat(4 * 60));
        }
        // Past hard, two calls or more bring the seed under it.
        sizing = true;
        h.sessions[1]?.reply(250);
        next.send("held");
        await until(() => h.calls.length === 2);
        const prompt = h.calls[1]?.request.prompt ?? "";
        const last = Math.max(
            ...[...prompt.matchAll(/<turn n="(\d+)">/g)].map((m) =>
                Number(m[1]),
            ),
        );
        h.calls[1]?.answer(through(last));
        await until(() => h.calls.length === 3);
        expect(h.sessions).toHaveLength(2);
        await h.compaction.stop();
    });

    it("lets Esc on a message held for a save end the chain a seed past hard starts, after its first call", async () => {
        let saveDone = () => {};
        const saving = new Promise<void>((resolve) => {
            saveDone = resolve;
        });
        let sizing = false;
        const h = harness({
            saving,
            estimate: (seed) => (sizing ? seedSize(seed) : 0),
        });
        const first = h.open();
        first.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.saved.length === 1);
        void first.close();
        // Turns 7 to 14, of 40 tokens each, put the seed past hard; three
        // calls would bring it under.
        const all = [
            ...HISTORY,
            turn("user"),
            turn("assistant"),
            ...Array.from({ length: 8 }, (_, i) =>
                sized(i % 2 === 0 ? "user" : "assistant", 40),
            ),
        ];
        const next = h.open(all);
        next.send("waiting");
        await next.interrupt();
        sizing = true;
        saveDone();
        await until(() => h.calls.length === 2);
        expect(h.sessions).toHaveLength(1);
        const prompt = h.calls[1]?.request.prompt ?? "";
        expect(prompt).toContain('<turn n="8">');
        expect(prompt).not.toContain('<turn n="9">');
        h.calls[1]?.answer(through(8));
        await until(() => h.sessions[1]?.sent.length === 1);
        await settle();
        expect(h.calls).toHaveLength(2);
        expect(h.sessions).toHaveLength(2);
        expect(h.sessions[1]?.seed.clusters.map((c) => c.through)).toEqual([
            2, 8,
        ]);
        expect(h.sessions[1]?.sent).toEqual(["waiting"]);
        expect(warnings(h.events)).toEqual([
            "compaction: the context is nearly full; sending anyway",
        ]);
        h.sessions[1]?.emit({ type: "delta", text: "Of" });
        expect(h.sessions[1]?.interrupts).toBe(1);
        await next.close();
    });

    it("interrupts a held message sent on after a failed compaction", async () => {
        const h = harness();
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("next");
        await until(() => h.calls.length === 1);
        await session.interrupt();
        h.calls[0]?.answer({ ok: false, reason: "offline", costUsd: 0 });
        await until(() => h.sessions[0]?.sent.includes("next") === true);
        expect(h.sessions[0]?.interrupts).toBe(0);
        h.sessions[0]?.emit({
            type: "sdk",
            message: { type: "stream_event", event: { type: "message_start" } },
        });
        expect(h.sessions[0]?.interrupts).toBe(1);
    });

    it("interrupts nothing after a held message that couldn't be sent", async () => {
        const h = harness();
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("next");
        await until(() => h.calls.length === 1);
        await session.interrupt();
        h.faults.send = "next";
        h.calls[0]?.answer({ ok: false, reason: "offline", costUsd: 0 });
        await until(() =>
            warnings(h.events).includes(
                "compaction: couldn't send a held message: pipe closed",
            ),
        );
        h.sessions[0]?.emit({
            type: "sdk",
            message: { type: "stream_event", event: { type: "message_start" } },
        });
        expect(h.sessions[0]?.interrupts).toBe(0);
    });
});
