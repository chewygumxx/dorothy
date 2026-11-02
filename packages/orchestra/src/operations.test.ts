// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/operations.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { Outcome } from "./broker/push.js";
import { FakeTimers } from "./fixtures/timers.js";
import {
    closeOn,
    GRACE_MS,
    type OperationInput,
    Operations,
    type Run,
} from "./operations.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// A work that runs until the test settles it, its runs counted.
function held() {
    const runs: Run[] = [];
    let finish: (outcome: Outcome) => void = () => {};
    const work = (run: Run) => {
        runs.push(run);
        return new Promise<Outcome>((resolve) => {
            finish = resolve;
        });
    };
    return { work, runs, finish: (outcome: Outcome) => finish(outcome) };
}

function setup() {
    const timers = new FakeTimers();
    const entries: Record<string, unknown>[] = [];
    let stopped = 0;
    const operations = new Operations({
        log: (entry) => entries.push(entry),
        clock: { now: () => Date.UTC(2026, 10, 2) },
        timers,
        stopWorkers: async () => {
            stopped++;
        },
    });
    return { timers, entries, operations, stopped: () => stopped };
}

const push = (operationId: string, args = {}): OperationInput => ({
    operationId,
    tool: "push_worker",
    args: { worker: "codex-1", forceWithLease: false, ...args },
    worker: "codex-1",
    queue: "codex-1",
});

const done: Outcome = { status: "succeeded", detail: "pushed" };

describe("operations", () => {
    it("records an operation before it runs, then its outcome, in the log", async () => {
        const { entries, operations } = setup();
        const work = held();
        const record = operations.begin(push("op-1"), work.work);
        expect(record).toMatchObject({
            operationId: "op-1",
            tool: "push_worker",
            worker: "codex-1",
            status: "pending",
        });
        expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
        await settle();
        expect(operations.read("op-1").status).toBe("running");
        work.runs[0]?.record({ oid: "a".repeat(40) });
        work.finish(done);
        await settle();
        expect(operations.read("op-1")).toMatchObject({
            status: "succeeded",
            detail: "pushed",
            values: { oid: "a".repeat(40) },
        });
        expect(entries.map((entry) => entry.status)).toEqual([
            "pending",
            "running",
            "running",
            "succeeded",
        ]);
        expect(entries[0]).toMatchObject({
            at: "2026-11-02T00:00:00.000Z",
            event: "operation",
            operationId: "op-1",
        });
        expect(JSON.stringify(entries)).not.toContain("forceWithLease");
    });

    it("returns the record of a repeat without acting again", async () => {
        const { operations } = setup();
        const work = held();
        operations.begin(push("op-1"), work.work);
        await settle();
        expect(operations.begin(push("op-1"), work.work).status).toBe(
            "running",
        );
        work.finish(done);
        await settle();
        const again = operations.begin(
            {
                ...push("op-1"),
                args: { forceWithLease: false, worker: "codex-1" },
            },
            work.work,
        );
        await settle();
        expect(again.status).toBe("succeeded");
        expect(work.runs).toHaveLength(1);
    });

    it("refuses a reused id with other arguments", async () => {
        const { operations } = setup();
        const work = held();
        operations.begin(push("op-1"), work.work);
        expect(() =>
            operations.begin(push("op-1", { forceWithLease: true }), work.work),
        ).toThrow(/op-1 .*other arguments/);
        expect(() =>
            operations.find({ ...push("op-1"), tool: "stop_worker" }),
        ).toThrow(/other arguments/);
        await settle();
        expect(work.runs).toHaveLength(1);
    });

    it("refuses to read an operation it does not hold", () => {
        expect(() => setup().operations.read("op-9")).toThrow(
            /no operation op-9/,
        );
    });

    it("fails an operation whose work throws, with its reason", async () => {
        const { operations } = setup();
        operations.begin(push("op-1"), async () => {
            throw new Error("the remote cannot be read");
        });
        await settle();
        expect(operations.read("op-1")).toMatchObject({
            status: "failed",
            detail: "the remote cannot be read",
        });
    });

    it("runs a queue's operations one at a time, in order", async () => {
        const { operations } = setup();
        const first = held();
        const second = held();
        operations.begin(push("op-1"), first.work);
        operations.begin(push("op-2"), second.work);
        await settle();
        expect(operations.read("op-2").status).toBe("pending");
        expect(second.runs).toHaveLength(0);
        first.finish(done);
        await settle();
        expect(operations.read("op-2").status).toBe("running");
    });

    it("cancels a stopped worker's pending operations; a running one goes on", async () => {
        const { operations } = setup();
        const first = held();
        const second = held();
        operations.begin(push("op-1"), first.work);
        operations.begin(push("op-2"), second.work);
        await settle();
        operations.cancel("codex-1");
        expect(operations.read("op-2")).toMatchObject({
            status: "failed",
            detail: "cancelled: its worker stopped",
        });
        expect(first.runs[0]?.signal.aborted).toBe(false);
        first.finish(done);
        await settle();
        expect(operations.read("op-1").status).toBe("succeeded");
        expect(second.runs).toHaveLength(0);
    });

    describe("closing", () => {
        it("stops every worker and lets a running operation finish within the grace", async () => {
            const { operations, timers, stopped } = setup();
            const first = held();
            const second = held();
            operations.begin(push("op-1"), first.work);
            operations.begin(push("op-2"), second.work);
            await settle();
            const closing = operations.close();
            expect(stopped()).toBe(1);
            expect(operations.read("op-2").status).toBe("failed");
            timers.advance(GRACE_MS - 1);
            first.finish(done);
            await closing;
            expect(first.runs[0]?.signal.aborted).toBe(false);
            expect(operations.read("op-1").status).toBe("succeeded");
            expect(() => operations.begin(push("op-3"), second.work)).toThrow(
                /closing/,
            );
        });

        it("aborts a running operation after the grace, taking the outcome it reconciles", async () => {
            const { operations, timers } = setup();
            const work = held();
            operations.begin(push("op-1"), work.work);
            await settle();
            const closing = operations.close();
            timers.advance(GRACE_MS - 1);
            await settle();
            expect(work.runs[0]?.signal.aborted).toBe(false);
            timers.advance(1);
            await settle();
            expect(work.runs[0]?.signal.aborted).toBe(true);
            work.finish({ status: "failed", detail: "the remote holds none" });
            await closing;
            expect(operations.read("op-1")).toMatchObject({
                status: "failed",
                detail: "the remote holds none",
            });
        });

        it("logs unknown what has not settled after the kill", async () => {
            const { operations, timers, entries } = setup();
            const work = held();
            operations.begin(push("op-1"), work.work);
            await settle();
            const closing = operations.close();
            timers.advance(GRACE_MS);
            await settle();
            timers.advance(GRACE_MS);
            await closing;
            expect(operations.read("op-1").status).toBe("unknown");
            work.finish(done);
            await settle();
            expect(operations.read("op-1").status).toBe("unknown");
            expect(entries.at(-1)).toMatchObject({ status: "unknown" });
        });

        it("closes once on the client's EOF or a signal", async () => {
            for (const trigger of ["end", "SIGTERM"]) {
                const input = new PassThrough();
                const signals = new EventEmitter();
                let closed = 0;
                closeOn(input, signals, async () => {
                    closed++;
                });
                input.resume();
                if (trigger === "end") {
                    input.end();
                } else {
                    signals.emit(trigger);
                }
                signals.emit("SIGINT");
                await settle();
                expect(closed).toBe(1);
            }
        });
    });
});
