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
import type { Timers } from "../memory/scheduler.js";
import type { Cluster } from "../memory/sidecar.js";
import type { Turn } from "../persona.js";
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
    constructor(readonly seed: Seed) {}
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
    clusters = [],
    save = { ok: true },
    saving = Promise.resolve(),
    record = null,
}: {
    estimate?: number;
    claim?: Claim | null;
    clusters?: Cluster[];
    // An error is thrown rather than returned.
    save?: SaveResult | Error;
    // Settles when the save may finish.
    saving?: Promise<void>;
    // Thrown by the transcript's record, when given.
    record?: Error | null;
} = {}) {
    const timers = new FakeTimers();
    const sessions: FakeSession[] = [];
    const calls: Pending[] = [];
    const saved: Cluster[][] = [];
    const recorded: { through: number; clusters: number }[] = [];
    const compaction = new Compaction({
        config: { soft: 100, hard: 200, tail: 4 },
        idleMs: 1000,
        clusters,
        persona: "You are Dorothy,",
        call: (request) =>
            new Promise((answer) => {
                calls.push({ request, answer });
                request.signal?.addEventListener("abort", () =>
                    answer({ ok: false, reason: "cancelled", costUsd: 0 }),
                );
            }),
        save: async (added) => {
            saved.push([...added]);
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
        estimate: () => estimate,
        claim,
        timers,
        now: () => NOW,
    });
    const connect = (seed: Seed) => {
        const session = new FakeSession(seed);
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
        recorded,
        events,
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

    it("passes the inner session's events through, and its interrupts", async () => {
        const h = harness();
        const session = h.open();
        h.sessions[0]?.emit({ type: "delta", text: "Hi" });
        expect(h.events).toEqual([{ type: "delta", text: "Hi" }]);
        await session.interrupt();
        expect(h.sessions[0]?.interrupts).toBe(1);
    });
});
