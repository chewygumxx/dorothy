// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/compaction/session.ts
//
//

import type { CompactionConfig } from "../config.js";
import type { ChatSession, ConversationEvent } from "../conversation.js";
import { REAL_TIMERS, type Timers } from "../memory/scheduler.js";
import type { Cluster } from "../memory/sidecar.js";
import type { Turn } from "../persona.js";
import { type CompactOutcome, compact } from "./compact.js";
import { pressure, seedTurns } from "./plan.js";
import type { StructuredCall } from "./types.js";

// How often a compaction holding a message asks again for a claim that
// another call holds.
export const CLAIM_RETRY_MS = 2000;
// Failures in a run after which compaction stops until the next launch.
export const MAX_FAILURES = 3;

// What a session starts with: the clusters, and the turns after them.
export type Seed = { turns: Turn[]; clusters: readonly Cluster[] };
// The conversation's claim in the recall index, which reviews take too.
export type Claim = { take(): Promise<boolean>; release(): Promise<void> };
export type SaveResult = { ok: true } | { ok: false; reason: string };

export type CompactionOptions = {
    config: Pick<CompactionConfig, "soft" | "hard" | "tail">;
    // The idle time before compacting, as reviews wait.
    idleMs: number;
    // The clusters the conversation already has.
    clusters: readonly Cluster[];
    // Dorothy's persona, for her call.
    persona: string;
    call: StructuredCall;
    // Appends new clusters to the sidecar.
    save(clusters: readonly Cluster[]): Promise<SaveResult>;
    // Writes the transcript's compaction event.
    record(entry: { through: number; clusters: number }): Promise<void>;
    // Estimated tokens of the prompt a session with this seed starts with.
    estimate(seed: Seed): number;
    claim?: Claim | null;
    timers?: Timers;
    now?: () => Date;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// A wait that ends early, and quietly, when the signal aborts.
function sleep(timers: Timers, ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve();
            return;
        }
        const timer = timers.set(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            timers.clear(timer);
            resolve();
        };
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

// One run's compaction: the clusters so far, the failures, and the
// sessions it wraps. It outlives each session, so that reconnecting starts
// from the clusters too.
export class Compaction {
    readonly options: CompactionOptions;
    readonly timers: Timers;
    readonly now: () => Date;
    #clusters: Cluster[];
    #failures = 0;
    readonly #runs = new Map<AbortController, Promise<void>>();

    constructor(options: CompactionOptions) {
        this.options = options;
        this.timers = options.timers ?? REAL_TIMERS;
        this.now = options.now ?? (() => new Date());
        this.#clusters = [...options.clusters];
    }

    clusters(): readonly Cluster[] {
        return this.#clusters;
    }

    seed(turns: readonly Turn[]): Seed {
        return {
            turns: seedTurns(turns, this.#clusters),
            clusters: [...this.#clusters],
        };
    }

    // A session over every turn so far; App passes them all, and the
    // clusters decide which reach the seed.
    session(
        turns: readonly Turn[],
        connect: (seed: Seed) => ChatSession,
    ): ChatSession {
        return new CompactingSession(this, turns, connect);
    }

    // Quitting: every call is cancelled, and the promise settles once each
    // has let go of its claim.
    async stop(): Promise<void> {
        for (const controller of this.#runs.keys()) {
            controller.abort();
        }
        await Promise.all(this.#runs.values());
    }

    // For CompactingSession.
    get exhausted(): boolean {
        return this.#failures >= MAX_FAILURES;
    }

    idleDelay(): number {
        return this.options.idleMs * 2 ** this.#failures;
    }

    failed(): void {
        this.#failures++;
    }

    added(clusters: readonly Cluster[]): void {
        this.#clusters = [...this.#clusters, ...clusters];
    }

    track(controller: AbortController, done: Promise<void>): void {
        this.#runs.set(controller, done);
        void done.finally(() => this.#runs.delete(controller));
    }
}

// Passes one inner session through, and between turns replaces it with a
// new one seeded with the clusters a compaction just made.
class CompactingSession implements ChatSession {
    readonly #compaction: Compaction;
    readonly #connect: (seed: Seed) => ChatSession;
    readonly #listeners = new Set<(event: ConversationEvent) => void>();
    // Every turn sent on so far, as App and the transcript count them; a
    // held message joins them when it is sent.
    readonly #turns: Turn[];
    #inner: ChatSession | null = null;
    #held: string[] = [];
    #announced = false;
    #streaming = false;
    #settled: (() => void)[] = [];
    // Past hard: the next message waits for compaction.
    #urgent = false;
    #idle: unknown = null;
    #run: AbortController | null = null;
    #closed = false;
    // How many turns there were when compaction last found nothing to do.
    #nothingAt = -1;

    constructor(
        compaction: Compaction,
        turns: readonly Turn[],
        connect: (seed: Seed) => ChatSession,
    ) {
        this.#compaction = compaction;
        this.#connect = connect;
        this.#turns = [...turns];
        const seed = compaction.seed(this.#turns);
        if (
            !compaction.exhausted &&
            compaction.options.estimate(seed) > compaction.options.config.hard
        ) {
            this.#urgent = true;
            // After the caller has subscribed.
            queueMicrotask(() => {
                this.#announce();
                this.#start();
            });
        } else {
            this.#attach(connect(seed));
        }
    }

    subscribe(listener: (event: ConversationEvent) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    send(text: string): void {
        this.#cancelIdle();
        if (this.#closed) {
            return;
        }
        if (
            this.#inner === null ||
            (this.#urgent && !this.#compaction.exhausted)
        ) {
            this.#announce();
            this.#held.push(text);
            this.#start();
            return;
        }
        this.#forward(text);
    }

    interrupt(): Promise<void> {
        return this.#inner?.interrupt() ?? Promise.resolve();
    }

    async close(): Promise<void> {
        this.#closed = true;
        this.#cancelIdle();
        this.#run?.abort();
        await this.#inner?.close();
    }

    #emit(event: ConversationEvent): void {
        for (const listener of this.#listeners) {
            listener(event);
        }
    }

    #warn(message: string): void {
        this.#emit({ type: "warning", message });
    }

    #announce(): void {
        if (!this.#announced) {
            this.#announced = true;
            this.#emit({ type: "compacting" });
        }
    }

    #forward(text: string): void {
        this.#turns.push({ role: "user", text });
        this.#streaming = true;
        this.#inner?.send(text);
    }

    #attach(inner: ChatSession): void {
        this.#inner = inner;
        inner.subscribe((event) => {
            if (inner !== this.#inner) {
                return;
            }
            if (event.type === "turn-end") {
                this.#turns.push({ role: "assistant", text: event.reply });
                this.#settle();
                this.#emit(event);
                this.#measure(event.contextTokens ?? 0);
                return;
            }
            if (event.type === "error") {
                if (event.partial) {
                    this.#turns.push({
                        role: "assistant",
                        text: event.partial,
                    });
                }
                this.#settle();
            }
            this.#emit(event);
        });
    }

    #settle(): void {
        this.#streaming = false;
        for (const wake of this.#settled.splice(0)) {
            wake();
        }
    }

    // Resolves once no reply is streaming, or the signal aborts.
    #whenSettled(signal: AbortSignal): Promise<void> {
        return new Promise((resolve) => {
            if (!this.#streaming || signal.aborted) {
                resolve();
                return;
            }
            this.#settled.push(resolve);
            signal.addEventListener("abort", () => resolve(), { once: true });
        });
    }

    #measure(context: number): void {
        const level = pressure(context, this.#compaction.options.config);
        if (
            level === "none" ||
            this.#compaction.exhausted ||
            this.#turns.length === this.#nothingAt
        ) {
            return;
        }
        if (level === "hard") {
            this.#urgent = true;
        }
        this.#cancelIdle();
        this.#idle = this.#compaction.timers.set(() => {
            this.#idle = null;
            this.#start();
        }, this.#compaction.idleDelay());
    }

    #cancelIdle(): void {
        if (this.#idle !== null) {
            this.#compaction.timers.clear(this.#idle);
            this.#idle = null;
        }
    }

    #start(): void {
        if (this.#run !== null || this.#closed) {
            return;
        }
        const controller = new AbortController();
        this.#run = controller;
        const done = this.#compactOnce(controller.signal)
            .catch((error: unknown) => {
                this.#warn(`compaction failed: ${describeError(error)}`);
            })
            .finally(() => {
                this.#run = null;
                this.#afterRun();
            });
        this.#compaction.track(controller, done);
    }

    async #compactOnce(signal: AbortSignal): Promise<void> {
        const compaction = this.#compaction;
        const { claim = null } = compaction.options;
        const holding = this.#urgent || this.#inner === null;
        if (claim !== null) {
            while (!(await claim.take())) {
                if (!holding || signal.aborted) {
                    return;
                }
                await sleep(compaction.timers, CLAIM_RETRY_MS, signal);
                if (signal.aborted) {
                    return;
                }
            }
        }
        try {
            const outcome = await compact({
                turns: [...this.#turns],
                clusters: compaction.clusters(),
                tail: compaction.options.config.tail,
                persona: compaction.options.persona,
                call: compaction.options.call,
                now: compaction.now,
                signal,
            });
            if (signal.aborted) {
                return;
            }
            await this.#land(outcome, signal);
        } finally {
            await claim?.release();
        }
    }

    async #land(outcome: CompactOutcome, signal: AbortSignal): Promise<void> {
        const compaction = this.#compaction;
        if (outcome.kind === "nothing") {
            this.#nothingAt = this.#turns.length;
            this.#warn(
                "compaction: nothing to compact; the latest exchange alone fills the tail",
            );
            return;
        }
        if (outcome.costUsd > 0) {
            this.#emit({ type: "memory-cost", usd: outcome.costUsd });
        }
        if (outcome.kind === "failed") {
            this.#fail(outcome.reason);
            return;
        }
        await this.#whenSettled(signal);
        if (signal.aborted) {
            return;
        }
        const saved = await compaction.options.save(outcome.clusters);
        if (!saved.ok) {
            this.#fail(saved.reason);
            return;
        }
        compaction.added(outcome.clusters);
        await compaction.options.record({
            through: outcome.range.through,
            clusters: outcome.clusters.length,
        });
        const old = this.#inner;
        this.#urgent = false;
        this.#attach(this.#connect(compaction.seed(this.#turns)));
        void old?.close();
        this.#emit({
            type: "compacted",
            from: outcome.range.from,
            through: outcome.range.through,
            clusters: outcome.clusters.length,
        });
    }

    #fail(reason: string): void {
        this.#compaction.failed();
        this.#warn(
            this.#compaction.exhausted
                ? `compaction failed: ${reason}; no more tries until the next launch`
                : `compaction failed: ${reason}`,
        );
    }

    // Whatever happened, a session exists afterwards and held messages go
    // to it: after a failure, to the session that is nearly full.
    #afterRun(): void {
        if (this.#closed) {
            return;
        }
        if (this.#inner === null) {
            this.#attach(this.#connect(this.#compaction.seed(this.#turns)));
        }
        const held = this.#held.splice(0);
        if (held.length > 0 && this.#urgent) {
            this.#warn(
                "compaction: the context is nearly full; sending anyway",
            );
        }
        this.#urgent = false;
        this.#announced = false;
        for (const text of held) {
            this.#forward(text);
        }
    }
}
