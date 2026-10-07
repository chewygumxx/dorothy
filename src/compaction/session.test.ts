// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/compaction/session.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type {
    ChatSession,
    ConversationEvent,
    TurnStats,
} from "../conversation.js";
import type { Cluster } from "../memory/sidecar.js";
import type { Turn } from "../persona.js";
import type { Timers } from "../timers.js";
import { clusterInstructions } from "./clusters.js";
import {
    CLAIM_RETRY_MS,
    type Claim,
    Compaction,
    type SaveResult,
    type Seed,
} from "./session.js";
import type { StructuredOutcome, StructuredRequest } from "./types.js";

const NOW = new Date("2026-10-07T08:00:00.000Z");
const STATS: TurnStats = {
    inputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 1,
    ttftMs: null,
    durationMs: 1,
    costUsd: 0,
    sessionCostUsd: 0,
};
// Four characters make a token; with a tail of 4, four turns of history
// and an exchange compact turns 1 and 2.
const turn = (role: Turn["role"]): Turn => ({ role, text: "abcd" });
const HISTORY = [
    turn("user"),
    turn("assistant"),
    turn("user"),
    turn("assistant"),
];
const CLUSTERED: StructuredOutcome = {
    ok: true,
    output: { clusters: [{ through: 2, abstract: "The start." }] },
    model: "claude-test",
    costUsd: 0.1,
};

class FakeTimers implements Timers {
    #next = 1;
    #now = 0;
    readonly pending = new Map<number, { fn: () => void; at: number }>();
    set(fn: () => void, ms: number): number {
        const id = this.#next++;
        this.pending.set(id, { fn, at: this.#now + ms });
        return id;
    }
    clear(handle: unknown): void {
        this.pending.delete(handle as number);
    }
    advance(ms: number): void {
        this.#now += ms;
        for (const [id, timer] of [...this.pending]) {
            if (timer.at <= this.#now) {
                this.pending.delete(id);
                timer.fn();
            }
        }
    }
}

class FakeSession implements ChatSession {
    readonly sent: string[] = [];
    closed = false;
    interrupts = 0;
    readonly #listeners = new Set<(event: ConversationEvent) => void>();
    constructor(
        readonly seed: Seed,
        // Settles when closing finishes, as the CLI's subprocess ends.
        readonly closing: Promise<void> = Promise.resolve(),
    ) {}
    subscribe(listener: (event: ConversationEvent) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }
    send(text: string): void {
        this.sent.push(text);
    }
    interrupt(): Promise<void> {
        this.interrupts++;
        return Promise.resolve();
    }
    async close(): Promise<void> {
        this.closed = true;
        await this.closing;
    }
    emit(event: ConversationEvent): void {
        for (const listener of this.#listeners) {
            listener(event);
        }
    }
    reply(contextTokens: number, text = "abcd"): void {
        this.emit({
            type: "turn-end",
            reply: text,
            interrupted: false,
            stats: STATS,
            contextTokens,
        });
    }
}

// A call answered when the test says so.
type Pending = {
    request: StructuredRequest;
    answer: (outcome: StructuredOutcome) => void;
};

function harness({
    estimate = 0,
    claim = null,
    claims,
    clusters = [],
    save = { ok: true },
    saving = Promise.resolve(),
    record = null,
    closing = Promise.resolve(),
    ready,
    recollect = true,
}: {
    // Tokens for every seed, or by the seed.
    estimate?: number | ((seed: Seed) => number);
    // One claim for every run, unless claims makes each run its own.
    claim?: Claim | null;
    claims?: () => Claim;
    clusters?: Cluster[];
    // An error is thrown rather than returned.
    save?: SaveResult | Error;
    // Settles when the save may finish.
    saving?: Promise<void>;
    // Thrown by the transcript's record, when given.
    record?: Error | null;
    // Settles when the first session may finish closing.
    closing?: Promise<void>;
    // What the check before Dorothy's call answers; no check without.
    ready?: SaveResult;
    // Whether the sessions offer recollect.
    recollect?: boolean;
} = {}) {
    const timers = new FakeTimers();
    const sessions: FakeSession[] = [];
    const calls: Pending[] = [];
    const saved: Cluster[][] = [];
    // What each save was given as the compaction's cost.
    const costs: number[] = [];
    const recorded: { through: number; clusters: number }[] = [];
    // Set to make connecting, or estimating a seed, throw.
    const faults: { connect: Error | null; estimate: Error | null } = {
        connect: null,
        estimate: null,
    };
    const compaction = new Compaction({
        config: { soft: 100, hard: 200, tail: 4 },
        idleMs: 1000,
        clusters,
        persona: "You are Dorothy,",
        recollect,
        call: (request) =>
            new Promise((answer) => {
                calls.push({ request, answer });
                request.signal?.addEventListener("abort", () =>
                    answer({ ok: false, reason: "cancelled", costUsd: 0 }),
                );
            }),
        save: async (added, costUsd) => {
            saved.push([...added]);
            costs.push(costUsd);
            await saving;
            if (save instanceof Error) {
                throw save;
            }
            return save;
        },
        record: async (entry) => {
            recorded.push(entry);
            if (record !== null) {
                throw record;
            }
        },
        estimate: (seed) => {
            if (faults.estimate !== null) {
                throw faults.estimate;
            }
            return typeof estimate === "number" ? estimate : estimate(seed);
        },
        ...(ready === undefined ? {} : { ready: async () => ready }),
        claims: claims ?? (claim === null ? null : () => claim),
        timers,
        now: () => NOW,
    });
    const connect = (seed: Seed) => {
        if (faults.connect !== null) {
            throw faults.connect;
        }
        const session = new FakeSession(
            seed,
            sessions.length === 0 ? closing : Promise.resolve(),
        );
        sessions.push(session);
        return session;
    };
    const events: ConversationEvent[] = [];
    const open = (turns: Turn[] = HISTORY) => {
        const session = compaction.session(turns, connect);
        session.subscribe((event) => events.push(event));
        return session;
    };
    return {
        compaction,
        open,
        timers,
        sessions,
        calls,
        saved,
        costs,
        recorded,
        events,
        faults,
    };
}

async function until(predicate: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !predicate(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(predicate()).toBe(true);
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const warnings = (events: ConversationEvent[]) =>
    events.flatMap((event) =>
        event.type === "warning" ? [event.message] : [],
    );
// A turn of n tokens, and a seed's tokens counted as the budget counts.
const sized = (role: Turn["role"], n: number): Turn => ({
    role,
    text: "x".repeat(4 * n),
});
const seedSize = (seed: Seed) =>
    seed.turns.reduce((sum, t) => sum + Math.ceil(t.text.length / 4), 0);
const through = (n: number): StructuredOutcome => ({
    ...CLUSTERED,
    output: { clusters: [{ through: n, abstract: "Some turns." }] },
});
const compactedRanges = (events: ConversationEvent[]) =>
    events.flatMap((event) =>
        event.type === "compacted" ? [[event.from, event.through]] : [],
    );

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

    it("fails as a session does when the seed after a save can't connect", async () => {
        for (const fault of ["connect", "estimate"] as const) {
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
            h.faults[fault] = new Error("spawn failed");
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
        }
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

    it("leaves an idle compaction to whoever holds the claim", async () => {
        const taken: boolean[] = [];
        const claim: Claim = {
            take: async () => {
                taken.push(false);
                return false;
            },
            release: async () => {},
        };
        const h = harness({ claim });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => taken.length === 1);
        await settle();
        expect(h.calls).toHaveLength(0);
        expect(h.timers.pending.size).toBe(0);
    });

    it("gives each run its own claim, so a reconnected session's waits for the old run's", async () => {
        // The index's claims: one holder for the conversation, by owner.
        let holder: symbol | null = null;
        const claims = (): Claim => {
            const owner = Symbol("run");
            return {
                take: async () => {
                    holder ??= owner;
                    return holder === owner;
                },
                release: async () => {
                    if (holder === owner) {
                        holder = null;
                    }
                },
            };
        };
        const h = harness({ claims });
        const old = h.open();
        old.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        // App reconnects while the old run is still in Dorothy's call.
        const next = h.open([...HISTORY, turn("user"), turn("assistant")]);
        next.send("abcd");
        h.sessions[1]?.reply(250);
        next.send("held");
        await until(() => h.timers.pending.size === 1);
        expect(h.calls).toHaveLength(1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => holder === null);
        h.timers.advance(CLAIM_RETRY_MS);
        await until(() => h.calls.length === 2);
        expect(holder).not.toBeNull();
    });

    it("asks again for the claim while holding a message", async () => {
        const answers = [false, true];
        let released = 0;
        const claim: Claim = {
            take: async () => answers.shift() ?? true,
            release: async () => {
                released++;
            },
        };
        const h = harness({ claim });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("next");
        await until(() => h.timers.pending.size === 1);
        expect(h.calls).toHaveLength(0);
        h.timers.advance(CLAIM_RETRY_MS);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions.length === 2);
        await until(() => released === 1);
    });

    it("asks again for the claim when a message is held while an idle compaction waits for it", async () => {
        let refuse = (_taken: boolean) => {};
        const answers = [
            new Promise<boolean>((resolve) => {
                refuse = resolve;
            }),
        ];
        const claim: Claim = {
            take: () => answers.shift() ?? Promise.resolve(true),
            release: async () => {},
        };
        const h = harness({ claim });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        // While the claim is asked for, a reply crosses hard and the next
        // message is held.
        session.send("during");
        h.sessions[0]?.reply(250);
        session.send("next");
        refuse(false);
        await settle();
        expect(h.sessions[0]?.sent).toEqual(["abcd", "during"]);
        h.timers.advance(CLAIM_RETRY_MS);
        await until(() => h.calls.length === 1);
        // The exchange sent meanwhile moves the outgoing turns on.
        h.calls[0]?.answer({
            ...CLUSTERED,
            output: { clusters: [{ through: 5, abstract: "The start." }] },
        });

        await until(() => h.sessions[1]?.sent.length === 1);
        expect(h.sessions[1]?.sent).toEqual(["next"]);
    });

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

    it("passes the inner session's events through, and its interrupts", async () => {
        const h = harness();
        const session = h.open();
        h.sessions[0]?.emit({ type: "delta", text: "Hi" });
        expect(h.events).toEqual([{ type: "delta", text: "Hi" }]);
        await session.interrupt();
        expect(h.sessions[0]?.interrupts).toBe(1);
    });
});
