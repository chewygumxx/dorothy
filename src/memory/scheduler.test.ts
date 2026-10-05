// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/scheduler.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { ReviewScheduler, type Timers } from "./scheduler.js";

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
    const timers = new FakeTimers();
    const started: string[] = [];
    const signals: AbortSignal[] = [];
    const finishers: (() => void)[] = [];
    const scheduler = new ReviewScheduler({
        idleMs: 60_000,
        timers,
        review: (phrase, signal) => {
            started.push(phrase);
            signals.push(signal);
            return new Promise<void>((resolve) => finishers.push(resolve));
        },
    });
    // Finishes the review running now and lets the next one start.
    const finish = async () => {
        finishers.shift()?.();
        await settle();
    };
    return { timers, started, signals, scheduler, finish };
}

describe("ReviewScheduler", () => {
    it("reviews once the user has been idle for a while", () => {
        const { timers, started, scheduler } = setup();
        scheduler.idle("a");
        timers.advance(59_999);
        expect(started).toEqual([]);
        timers.advance(1);
        expect(started).toEqual(["a"]);
    });

    it("forgets the idle timer when the user sends", () => {
        const { timers, started, scheduler } = setup();
        scheduler.idle("a");
        scheduler.cancelIdle();
        timers.advance(60_000);
        expect(started).toEqual([]);
    });

    it("restarts the idle timer at each finished turn", () => {
        const { timers, started, scheduler } = setup();
        scheduler.idle("a");
        timers.advance(30_000);
        scheduler.idle("a");
        timers.advance(30_000);
        expect(started).toEqual([]);
        timers.advance(30_000);
        expect(started).toEqual(["a"]);
    });

    it("runs one review at a time, the live conversation ahead of catch-up", async () => {
        const { started, scheduler, finish } = setup();
        scheduler.later(["b", "c"]);
        scheduler.now("a");
        expect(started).toEqual(["b"]);
        await finish();
        expect(started).toEqual(["b", "a"]);
        await finish();
        expect(started).toEqual(["b", "a", "c"]);
    });

    it("reviews a conversation once more when asked during its review", async () => {
        const { started, scheduler, finish } = setup();
        scheduler.now("a");
        scheduler.now("a");
        scheduler.now("a");
        await finish();
        expect(started).toEqual(["a", "a"]);
        await finish();
        expect(started).toEqual(["a", "a"]);
    });

    it("queues a conversation for catch-up once", async () => {
        const { started, scheduler, finish } = setup();
        scheduler.later(["a", "b", "a"]);
        scheduler.later(["b"]);
        await finish();
        await finish();
        await finish();
        expect(started).toEqual(["a", "b"]);
    });

    it("carries on after a review fails", async () => {
        const started: string[] = [];
        const scheduler = new ReviewScheduler({
            idleMs: 60_000,
            timers: new FakeTimers(),
            review: async (phrase) => {
                started.push(phrase);
                throw new Error("boom");
            },
        });
        scheduler.later(["a", "b"]);
        await settle();
        await settle();
        expect(started).toEqual(["a", "b"]);
    });

    it("on stop, cancels the running review and starts nothing more", async () => {
        const { timers, started, signals, scheduler, finish } = setup();
        scheduler.later(["a", "b"]);
        scheduler.idle("c");
        scheduler.stop();
        expect(signals[0]?.aborted).toBe(true);
        await finish();
        timers.advance(60_000);
        scheduler.now("d");
        expect(started).toEqual(["a"]);
    });
});
