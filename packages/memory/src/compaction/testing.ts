// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/compaction/testing.ts
//
//

// The harness and fixtures Compaction's tests share.

import { expect } from "bun:test";
import type {
    ChatSession,
    ConversationEvent,
    StructuredOutcome,
    StructuredRequest,
    Timers,
    Turn,
    TurnStats,
} from "@dorothy/core";
import type { Cluster } from "../memory/sidecar.js";
import {
    type Claim,
    Compaction,
    type SaveResult,
    type Seed,
} from "./session.js";

export const NOW = new Date("2026-10-07T08:00:00.000Z");
export const STATS: TurnStats = {
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
export const turn = (role: Turn["role"]): Turn => ({ role, text: "abcd" });
export const HISTORY = [
    turn("user"),
    turn("assistant"),
    turn("user"),
    turn("assistant"),
];
export const CLUSTERED: Extract<StructuredOutcome, { ok: true }> = {
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
        // Called on each send, and may throw.
        readonly sending: (text: string) => void = () => {},
    ) {}
    subscribe(listener: (event: ConversationEvent) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }
    send(text: string): void {
        this.sending(text);
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
export type Pending = {
    request: StructuredRequest;
    answer: (outcome: StructuredOutcome) => void;
};

export function harness({
    estimate = 0,
    claim = null,
    claims,
    clusters = [],
    save = { ok: true },
    saving = Promise.resolve(),
    record = null,
    recording = Promise.resolve(),
    closing = Promise.resolve(),
    ready,
    recollect = true,
    cancels = true,
}: {
    // Tokens for every seed, or by the seed.
    estimate?: number | ((seed: Seed) => number);
    // One claim for every run, unless claims makes each run its own.
    claim?: Claim | null;
    claims?: () => Claim;
    clusters?: Cluster[];
    // An error is thrown rather than returned; a function answers each.
    save?: SaveResult | Error | (() => SaveResult);
    // Settles when the save may finish.
    saving?: Promise<void>;
    // Thrown by the transcript's record, when given.
    record?: Error | null;
    // Settles when the record may finish.
    recording?: Promise<void>;
    // Settles when the first session may finish closing.
    closing?: Promise<void>;
    // What the check before Dorothy's call answers; no check without.
    ready?: SaveResult;
    // Whether the sessions offer recollect.
    recollect?: boolean;
    // Whether a call answers "cancelled" when aborted, as a real one does;
    // without, it answers only when the test says, even after an abort.
    cancels?: boolean;
} = {}) {
    const timers = new FakeTimers();
    const sessions: FakeSession[] = [];
    const calls: Pending[] = [];
    const saved: Cluster[][] = [];
    // What each save was given as the compaction's cost.
    const costs: number[] = [];
    const recorded: { through: number; clusters: number }[] = [];
    // Set to make connecting, estimating a seed, or sending this text,
    // throw.
    const faults: {
        connect: Error | null;
        estimate: Error | null;
        send: string | null;
    } = {
        connect: null,
        estimate: null,
        send: null,
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
                if (cancels) {
                    request.signal?.addEventListener("abort", () =>
                        answer({ ok: false, reason: "cancelled", costUsd: 0 }),
                    );
                }
            }),
        save: async (added, costUsd) => {
            saved.push([...added]);
            costs.push(costUsd);
            await saving;
            if (save instanceof Error) {
                throw save;
            }
            return typeof save === "function" ? save() : save;
        },
        record: async (entry) => {
            recorded.push(entry);
            await recording;
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
            (text) => {
                if (text === faults.send) {
                    throw new Error("pipe closed");
                }
            },
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

export async function until(predicate: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !predicate(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(predicate()).toBe(true);
}
export const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
export const warnings = (events: ConversationEvent[]) =>
    events.flatMap((event) =>
        event.type === "warning" ? [event.message] : [],
    );
// A turn of n tokens, and a seed's tokens counted as the budget counts.
export const sized = (role: Turn["role"], n: number): Turn => ({
    role,
    text: "x".repeat(4 * n),
});
export const seedSize = (seed: Seed) =>
    seed.turns.reduce((sum, t) => sum + Math.ceil(t.text.length / 4), 0);
export const through = (n: number): StructuredOutcome => ({
    ...CLUSTERED,
    output: { clusters: [{ through: n, abstract: "Some turns." }] },
});
export const compactedRanges = (events: ConversationEvent[]) =>
    events.flatMap((event) =>
        event.type === "compacted" ? [[event.from, event.through]] : [],
    );
