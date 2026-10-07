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

// What one run's compaction keeps across its sessions: the clusters so
// far, the failures, and the calls under way. Only this module sees it.
class Shared {
    readonly options: CompactionOptions;
    readonly timers: Timers;
    readonly now: () => Date;
    clusters: Cluster[];
    #failures = 0;
    readonly #runs = new Map<AbortController, Promise<void>>();

    constructor(options: CompactionOptions) {
        this.options = options;
        this.timers = options.timers ?? REAL_TIMERS;
        this.now = options.now ?? (() => new Date());
        this.clusters = [...options.clusters];
    }

    seed(turns: readonly Turn[]): Seed {
        return {
            turns: seedTurns(turns, this.clusters),
            clusters: [...this.clusters],
        };
    }

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
        this.clusters = [...this.clusters, ...clusters];
    }

    track(controller: AbortController, done: Promise<void>): void {
        this.#runs.set(controller, done);
        void done.finally(() => this.#runs.delete(controller));
    }

    async stop(): Promise<void> {
        for (const controller of this.#runs.keys()) {
            controller.abort();
        }
        await Promise.all(this.#runs.values());
    }
}

// One run's compaction. It outlives each session, so that reconnecting
// starts from the clusters too.
export class Compaction {
    readonly #shared: Shared;

    constructor(options: CompactionOptions) {
        this.#shared = new Shared(options);
    }

    clusters(): readonly Cluster[] {
        return this.#shared.clusters;
    }

    seed(turns: readonly Turn[]): Seed {
        return this.#shared.seed(turns);
    }

    // A session over every turn so far; App passes them all, and the
    // clusters decide which reach the seed.
    session(
        turns: readonly Turn[],
        connect: (seed: Seed) => ChatSession,
    ): ChatSession {
        return new CompactingSession(this.#shared, turns, connect);
    }

    // Quitting: every call is cancelled, and the promise settles once each
    // has let go of its claim.
    stop(): Promise<void> {
        return this.#shared.stop();
    }
}

// Passes one inner session through, and between turns replaces it with a
// new one seeded with the clusters a compaction just made.
class CompactingSession implements ChatSession {
    readonly #shared: Shared;
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
    // Saving the clusters for the handover: a message waits for the new
    // session rather than going to the old one, which is about to close.
    #handing = false;

    constructor(
        shared: Shared,
        turns: readonly Turn[],
        connect: (seed: Seed) => ChatSession,
    ) {
        this.#shared = shared;
        this.#connect = connect;
        this.#turns = [...turns];
        const seed = shared.seed(this.#turns);
        if (
            !shared.exhausted &&
            shared.options.estimate(seed) > shared.options.config.hard
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
            this.#handing ||
            (this.#urgent && !this.#shared.exhausted)
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
        const level = pressure(context, this.#shared.options.config);
        if (level === "none" || this.#shared.exhausted) {
            return;
        }
        if (level === "hard") {
            this.#urgent = true;
        }
        this.#armIdle();
    }

    #armIdle(): void {
        this.#cancelIdle();
        this.#idle = this.#shared.timers.set(() => {
            this.#idle = null;
            this.#start();
        }, this.#shared.idleDelay());
    }

    #cancelIdle(): void {
        if (this.#idle !== null) {
            this.#shared.timers.clear(this.#idle);
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
                this.#fail(describeError(error));
            })
            .finally(() => {
                this.#run = null;
                this.#afterRun();
            });
        this.#shared.track(controller, done);
    }

    async #compactOnce(signal: AbortSignal): Promise<void> {
        const shared = this.#shared;
        const { claim = null } = shared.options;
        if (claim !== null) {
            while (!(await claim.take())) {
                // Asked when refused: a turn may have crossed hard, and a
                // message been held, since the run started.
                const holding = this.#urgent || this.#inner === null;
                if (!holding || signal.aborted) {
                    return;
                }
                await sleep(shared.timers, CLAIM_RETRY_MS, signal);
                if (signal.aborted) {
                    return;
                }
            }
        }
        try {
            const outcome = await compact({
                turns: [...this.#turns],
                clusters: shared.clusters,
                tail: shared.options.config.tail,
                persona: shared.options.persona,
                call: shared.options.call,
                now: shared.now,
                signal,
            });
            if (signal.aborted) {
                return;
            }
            await this.#land(outcome, signal);
        } finally {
            if (claim !== null) {
                await this.#release(claim);
            }
        }
    }

    // After the outcome: a claim that can't be let go expires.
    async #release(claim: Claim): Promise<void> {
        try {
            await claim.release();
        } catch (error) {
            this.#warn(
                `compaction: couldn't let go of the claim: ${describeError(error)}`,
            );
        }
    }

    async #land(outcome: CompactOutcome, signal: AbortSignal): Promise<void> {
        const shared = this.#shared;
        // Compaction is tried again only after a turn-end, which adds an
        // exchange, so finding nothing is not retried until another.
        if (outcome.kind === "nothing") {
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
        this.#handing = true;
        const saved = await shared.options.save(outcome.clusters);
        if (!saved.ok) {
            this.#fail(saved.reason);
            return;
        }
        shared.added(outcome.clusters);
        // The event only tells; the sidecar holds the clusters.
        try {
            await shared.options.record({
                through: outcome.range.through,
                clusters: outcome.clusters.length,
            });
        } catch (error) {
            this.#warn(
                `compaction: couldn't record the compaction in the transcript: ${describeError(error)}`,
            );
        }
        // Closed or quitting meanwhile: the clusters are kept, but no new
        // session is wanted.
        if (signal.aborted || this.#closed) {
            return;
        }
        const old = this.#inner;
        this.#urgent = false;
        // The old session's last reply may have started an idle wait.
        this.#cancelIdle();
        this.#attach(this.#connect(shared.seed(this.#turns)));
        void old?.close();
        this.#emit({
            type: "compacted",
            from: outcome.range.from,
            through: outcome.range.through,
            clusters: outcome.clusters.length,
        });
    }

    #fail(reason: string): void {
        this.#shared.failed();
        this.#warn(
            this.#shared.exhausted
                ? `compaction failed: ${reason}; no more tries until the next launch`
                : `compaction failed: ${reason}`,
        );
        // A reply past soft while the call ran started an idle wait timed
        // before this failure: it waits the doubled delay instead, or not
        // at all once compaction has given up.
        if (this.#idle !== null) {
            this.#cancelIdle();
            if (!this.#shared.exhausted) {
                this.#armIdle();
            }
        }
    }

    // Whatever happened, a session exists afterwards and held messages go
    // to it: after a failure, to the session that is nearly full.
    #afterRun(): void {
        if (this.#closed) {
            return;
        }
        if (this.#inner === null) {
            this.#attach(this.#connect(this.#shared.seed(this.#turns)));
        }
        const held = this.#held.splice(0);
        if (held.length > 0 && this.#urgent) {
            this.#warn(
                "compaction: the context is nearly full; sending anyway",
            );
        }
        this.#urgent = false;
        this.#announced = false;
        this.#handing = false;
        for (const text of held) {
            this.#forward(text);
        }
    }
}
