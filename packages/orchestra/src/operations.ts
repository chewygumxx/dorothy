// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/operations.ts
//
//

// Operations: every tool that changes something, keyed by the caller's
// operationId with a digest of its tool and arguments, recorded before
// it runs, so that a repeated call changes nothing twice. Records live
// in memory for the server's life; the log holds each change. Those of
// one queue, a worker's, run one at a time in order, pending until their
// turn, when stop_worker may cancel them. A running one goes on, as an
// effect already sent cannot be recalled; at the server's close it has a
// grace, then its processes are killed and its outcome reconciled, or
// logged unknown.

import { createHash } from "node:crypto";
import type { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import type { Clock, Timers } from "@dorothy/core";
import type { Outcome } from "./broker/push.js";
import type { Log } from "./log.js";

// For running operations at the close, and again for their
// reconciliation once killed.
export const GRACE_MS = 10_000;

export type Status = "pending" | "running" | Outcome["status"];

export type OperationRecord = {
    operationId: string;
    tool: string;
    digest: string;
    // The worker it acts on, or the one start_worker made.
    worker: string | null;
    status: Status;
    detail: string;
    // What it fixed before acting, a push's record among them.
    values: Record<string, unknown> | null;
};

export type OperationInput = {
    operationId: string;
    tool: string;
    // The tool's arguments but the operationId, defaults applied.
    args: Record<string, unknown>;
    worker: string | null;
    // Operations of one queue run one at a time, in order.
    queue?: string;
};

export type Run = {
    operationId: string;
    // Aborted when the close abandons it, killing its processes.
    signal: AbortSignal;
    // Values fixed before its effect is sent, recorded and logged.
    record(values: Record<string, unknown>): void;
};

export type Work = (run: Run) => Promise<Outcome>;

export type OperationsDeps = {
    log: Log;
    clock: Clock;
    timers: Timers;
    // Every worker stopped, at the close: the engine's.
    stopWorkers: () => Promise<void>;
};

type Entry = {
    record: OperationRecord;
    abort: AbortController;
    // Its turn taken, never rejected.
    done: Promise<void>;
};

// Keys sorted, so that their order in a call counts for nothing.
const canonical = (value: unknown) =>
    JSON.stringify(value, (_, inner) =>
        inner !== null && typeof inner === "object" && !Array.isArray(inner)
            ? Object.fromEntries(
                  Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1)),
              )
            : inner,
    );

const digestOf = (tool: string, args: Record<string, unknown>) =>
    createHash("sha256").update(canonical({ tool, args })).digest("hex");

export class Operations {
    readonly #deps: OperationsDeps;
    readonly #entries = new Map<string, Entry>();
    readonly #queues = new Map<string, Promise<void>>();
    #closing: Promise<void> | null = null;

    constructor(deps: OperationsDeps) {
        this.#deps = deps;
    }

    // A repeat's record, or undefined for a new id; the id under another
    // digest is refused.
    find({ operationId, tool, args }: OperationInput) {
        const entry = this.#entries.get(operationId);
        if (entry === undefined) {
            return undefined;
        }
        if (entry.record.digest !== digestOf(tool, args)) {
            throw new Error(
                `operation ${operationId} was ${entry.record.tool} with other arguments`,
            );
        }
        return { ...entry.record };
    }

    // Recorded pending, then run in its turn; a repeat acts not again.
    begin(input: OperationInput, work: Work): OperationRecord {
        const repeat = this.find(input);
        if (repeat !== undefined) {
            return repeat;
        }
        if (this.#closing !== null) {
            throw new Error("the server is closing");
        }
        const record: OperationRecord = {
            operationId: input.operationId,
            tool: input.tool,
            digest: digestOf(input.tool, input.args),
            worker: input.worker,
            status: "pending",
            detail: "",
            values: null,
        };
        this.#log(record);
        const previous =
            (input.queue && this.#queues.get(input.queue)) || Promise.resolve();
        const entry: Entry = {
            record,
            abort: new AbortController(),
            done: previous.then(() => this.#run(entry, work)),
        };
        this.#entries.set(input.operationId, entry);
        if (input.queue) {
            this.#queues.set(input.queue, entry.done);
        }
        return { ...record };
    }

    // read_operation's.
    read(operationId: string): OperationRecord {
        const entry = this.#entries.get(operationId);
        if (entry === undefined) {
            throw new Error(`no operation ${operationId}`);
        }
        return { ...entry.record };
    }

    // stop_worker's: its pending operations never run.
    cancel(worker: string): void {
        this.#cancel(worker, "cancelled: its worker stopped");
    }

    // At the client's EOF or a signal, once.
    close(): Promise<void> {
        this.#closing ??= this.#close();
        return this.#closing;
    }

    #log(record: OperationRecord) {
        const at = new Date(this.#deps.clock.now()).toISOString();
        this.#deps.log({ at, event: "operation", ...record });
    }

    #settle(record: OperationRecord, { status, detail }: Outcome) {
        record.status = status;
        record.detail = detail;
        this.#log(record);
    }

    #cancel(worker: string | null, detail: string) {
        for (const { record } of this.#entries.values()) {
            if (
                record.status === "pending" &&
                (worker === null || record.worker === worker)
            ) {
                this.#settle(record, { status: "failed", detail });
            }
        }
    }

    async #run({ record, abort }: Entry, work: Work) {
        if (record.status !== "pending") {
            return;
        }
        record.status = "running";
        this.#log(record);
        let outcome: Outcome;
        try {
            outcome = await work({
                operationId: record.operationId,
                signal: abort.signal,
                record: (values) => {
                    record.values = values;
                    this.#log(record);
                },
            });
        } catch (error) {
            outcome = {
                status: "failed",
                detail: error instanceof Error ? error.message : String(error),
            };
        }
        // Unless the close has logged it unknown meanwhile.
        if (record.status === "running") {
            this.#settle(record, outcome);
        }
    }

    async #close() {
        this.#cancel(null, "cancelled: the server closed");
        await Promise.all([this.#deps.stopWorkers(), this.#abandon()]);
    }

    // The grace, then the kill, which a push or pull request reconciles;
    // what has not settled after another grace is unknown.
    async #abandon() {
        const running = [...this.#entries.values()].filter(
            ({ record }) => record.status === "running",
        );
        const done = Promise.all(running.map((entry) => entry.done));
        if (await this.#within(done)) {
            return;
        }
        for (const { abort } of running) {
            abort.abort();
        }
        if (await this.#within(done)) {
            return;
        }
        for (const { record } of running) {
            if (record.status === "running") {
                this.#settle(record, {
                    status: "unknown",
                    detail: "the server closed before its outcome was known",
                });
            }
        }
    }

    #within(promise: Promise<unknown>): Promise<boolean> {
        return new Promise((resolve) => {
            const timer = this.#deps.timers.set(() => resolve(false), GRACE_MS);
            promise.then(() => {
                this.#deps.timers.clear(timer);
                resolve(true);
            });
        });
    }
}

const SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"];

// The client's EOF on input, or a signal, closes the server, once.
export function closeOn(
    input: Readable,
    signals: EventEmitter,
    close: () => unknown,
): void {
    let closed = false;
    const once = () => {
        if (!closed) {
            closed = true;
            close();
        }
    };
    input.once("end", once);
    for (const signal of SIGNALS) {
        signals.once(signal, once);
    }
}
