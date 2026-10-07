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
import type { Cluster } from "../memory/sidecar.js";
import type { Turn } from "../persona.js";
import { REAL_TIMERS, type Timers } from "../timers.js";
import { type CompactOutcome, compact } from "./compact.js";
import { callCap, covered, pressure, seedTurns } from "./plan.js";
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
// Saved; or, with clusters, not saved because another writer's clusters,
// these, already cover the turns, and the run takes them up instead.
export type SaveResult =
    | { ok: true; clusters?: readonly Cluster[] }
    | { ok: false; reason: string };

export type CompactionOptions = {
    config: Pick<CompactionConfig, "soft" | "hard" | "tail">;
    // The idle time before compacting, as reviews wait.
    idleMs: number;
    // The clusters the conversation already has.
    clusters: readonly Cluster[];
    // Dorothy's persona, for her call.
    persona: string;
    // Whether the sessions offer recollect, which her call is told.
    recollect: boolean;
    call: StructuredCall;
    // Appends new clusters to the sidecar, with what their compaction cost.
    save(clusters: readonly Cluster[], costUsd: number): Promise<SaveResult>;
    // Writes the transcript's compaction event.
    record(entry: { through: number; clusters: number }): Promise<void>;
    // Estimated tokens of the prompt a session with this seed starts with.
    estimate(seed: Seed): number;
    // Checked before each call to Dorothy: a refusal, such as notes that
    // can no longer be read, turns compaction off until the next launch,
    // and its reason ends the warning that says so.
    ready?(): Promise<SaveResult>;
    // A claim for one run, made afresh for each: runs, even two of one
    // TUI, exclude each other as two TUIs do.
    claims?: (() => Claim) | null;
    timers?: Timers;
    now?: () => Date;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

type Held = { text: string; interrupted: boolean };

// The reply to a message sent has started: its text, a lookup, or the
// API's stream.
const streams = (event: ConversationEvent) =>
    event.type === "delta" ||
    event.type === "lookup" ||
    (event.type === "sdk" && event.message.type === "stream_event");

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
// far, the failures, and the calls, saves and closings under way. Only
// this module sees it.
class Shared {
    readonly options: CompactionOptions;
    readonly timers: Timers;
    readonly now: () => Date;
    clusters: Cluster[];
    #failures = 0;
    #off = false;
    readonly #runs = new Map<AbortController, Promise<void>>();
    // Sessions a handover replaced, still closing, each by the wrapper
    // that replaced it.
    readonly #closing = new Map<Promise<void>, object>();
    // Saves under way, each settling once its clusters are added.
    readonly #saving = new Set<Promise<void>>();

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

    // Given up on: too many failures, or switched off.
    get exhausted(): boolean {
        return this.#off || this.#failures >= MAX_FAILURES;
    }

    switchOff(): void {
        this.#off = true;
    }

    idleDelay(): number {
        return this.options.idleMs * 2 ** this.#failures;
    }

    failed(): void {
        this.#failures++;
    }

    // Appends the clusters to the sidecar and, once saved, to these; or
    // takes up another writer's that already cover their turns.
    save(clusters: readonly Cluster[], costUsd: number): Promise<SaveResult> {
        const saving = this.options.save(clusters, costUsd).then((saved) => {
            if (saved.ok) {
                this.clusters = [
                    ...(saved.clusters ?? [...this.clusters, ...clusters]),
                ];
            }
            return saved;
        });
        const settled = saving.then(
            () => {},
            () => {},
        );
        this.#saving.add(settled);
        void settled.then(() => this.#saving.delete(settled));
        return saving;
    }

    // Settles once every save under way has; null when none is.
    saved(): Promise<void> | null {
        return this.#saving.size === 0
            ? null
            : Promise.all(this.#saving).then(() => {});
    }

    track(controller: AbortController, done: Promise<void>): void {
        this.#runs.set(controller, done);
        void done.finally(() => this.#runs.delete(controller));
    }

    // Closes a session owner replaced. Its errors go unreported, as App's
    // do when it replaces a session.
    retire(session: ChatSession, owner: object): void {
        const closing = session.close().catch(() => {});
        this.#closing.set(closing, owner);
        void closing.finally(() => this.#closing.delete(closing));
    }

    // The sessions owner replaced that are still closing; these never
    // reject.
    retiring(owner: object): Promise<void>[] {
        return [...this.#closing].flatMap(([closing, by]) =>
            by === owner ? [closing] : [],
        );
    }

    async stop(): Promise<void> {
        for (const controller of this.#runs.keys()) {
            controller.abort();
        }
        await Promise.all(this.#runs.values());
        await Promise.all(this.#closing.keys());
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
    // has let go of its claim and each replaced session has closed.
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
    // Messages waiting for compaction; Esc marks them interrupted.
    #held: Held[] = [];
    #announced = false;
    #streaming = false;
    #settled: (() => void)[] = [];
    // A message interrupted while held was sent: it is interrupted once
    // its reply starts.
    #interrupting = false;
    // Past hard: the next message waits for compaction.
    #urgent = false;
    #idle: unknown = null;
    #run: AbortController | null = null;
    #closed = false;
    // Saving the clusters for the handover: a message waits for the new
    // session rather than going to the old one, which is about to close.
    #handing = false;
    // Connecting waits for a save under way; messages wait with it.
    #waiting = false;
    // The run's new session has taken over: a throw from here on, such as
    // a listener's, is not a failed compaction.
    #landed = false;
    // The run's clusters left the seed past hard while a message waits:
    // another run follows at once.
    #again = false;
    // The inner session's seed predates clusters saved since, by runs that
    // followed one another without a session between.
    #behind = false;

    constructor(
        shared: Shared,
        turns: readonly Turn[],
        connect: (seed: Seed) => ChatSession,
    ) {
        this.#shared = shared;
        this.#connect = connect;
        this.#turns = [...turns];
        const saving = shared.saved();
        if (saving === null) {
            this.#begin();
        } else {
            // App reconnecting during a handover: the seed waits for the
            // clusters being saved, so their turns don't go in whole.
            this.#waiting = true;
            void saving
                .then(() => {
                    this.#waiting = false;
                    try {
                        this.#begin();
                    } catch (error) {
                        this.#die(error);
                    }
                })
                // Only a listener's throw on the error #die emitted gets
                // here; the error was told, and no caller hears this.
                .catch(() => {});
        }
    }

    #begin(): void {
        if (this.#closed) {
            return;
        }
        const shared = this.#shared;
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
            return;
        }
        this.#attach(this.#connect(seed));
        for (const held of this.#held.splice(0)) {
            this.#forward(held);
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
        if (this.#waiting) {
            this.#held.push({ text, interrupted: false });
            return;
        }
        if (
            this.#inner === null ||
            this.#handing ||
            (this.#urgent && !this.#shared.exhausted)
        ) {
            this.#announce();
            this.#held.push({ text, interrupted: false });
            this.#start();
            return;
        }
        this.#forward({ text, interrupted: false });
    }

    // A held message is sent as usual once compaction ends, and then
    // interrupted, so it ends as any interrupted turn does.
    interrupt(): Promise<void> {
        if (this.#held.length > 0) {
            for (const held of this.#held) {
                held.interrupted = true;
            }
            return Promise.resolve();
        }
        return this.#inner?.interrupt() ?? Promise.resolve();
    }

    async close(): Promise<void> {
        this.#closed = true;
        this.#cancelIdle();
        this.#run?.abort();
        await Promise.all([
            this.#inner?.close(),
            ...this.#shared.retiring(this),
        ]);
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

    #forward({ text, interrupted }: Held): void {
        this.#turns.push({ role: "user", text });
        this.#streaming = true;
        this.#interrupting = interrupted;
        this.#inner?.send(text);
    }

    #attach(inner: ChatSession): void {
        this.#inner = inner;
        inner.subscribe((event) => {
            if (inner !== this.#inner) {
                return;
            }
            if (this.#interrupting && streams(event)) {
                this.#interrupting = false;
                inner.interrupt().catch((error: unknown) => {
                    this.#warn(`interrupt failed: ${describeError(error)}`);
                });
            }
            if (event.type === "turn-end") {
                this.#turns.push({ role: "assistant", text: event.reply });
                this.#settle();
                // Before the listeners: memory, which hears of the turn-end
                // among them, arms a review's idle wait of the same length,
                // and compaction goes first.
                this.#measure(event.contextTokens ?? 0);
                this.#emit(event);
                return;
            }
            if (event.type === "error") {
                this.#interrupting = false;
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
        this.#interrupting = false;
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
        this.#landed = false;
        const done = this.#compactOnce(controller.signal)
            .catch((error: unknown) => {
                if (this.#landed) {
                    this.#warn(
                        `compaction: after handing over: ${describeError(error)}`,
                    );
                } else {
                    this.#fail(describeError(error));
                }
            })
            .finally(() => {
                this.#run = null;
                this.#afterRun();
            });
        this.#shared.track(controller, done);
    }

    async #compactOnce(signal: AbortSignal): Promise<void> {
        const shared = this.#shared;
        const claim = shared.options.claims?.() ?? null;
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
            const ready = (await shared.options.ready?.()) ?? { ok: true };
            if (!ready.ok) {
                shared.switchOff();
                this.#cancelIdle();
                this.#warn(
                    `compaction: off until the next launch; ${ready.reason}`,
                );
                return;
            }
            const outcome = await compact({
                turns: [...this.#turns],
                clusters: shared.clusters,
                tail: shared.options.config.tail,
                cap: callCap(shared.options.config),
                persona: shared.options.persona,
                recollect: shared.options.recollect,
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
        const saved = await shared.save(outcome.clusters, outcome.costUsd);
        if (!saved.ok) {
            this.#fail(saved.reason);
            return;
        }
        // Another writer's clusters, taken up, are theirs to record; the
        // screen tells of the turns they cover past this run's start.
        const landed =
            saved.clusters === undefined
                ? { through: outcome.range.through, clusters: outcome.clusters }
                : {
                      through: covered(saved.clusters),
                      clusters: saved.clusters.filter(
                          (cluster) => cluster.from >= outcome.range.from,
                      ),
                  };
        // The event only tells; the sidecar holds the clusters. Its warning
        // follows the compacted event, which clears compaction's warnings.
        let unrecorded: string | null = null;
        try {
            if (saved.clusters === undefined) {
                await shared.options.record({
                    through: outcome.range.through,
                    clusters: outcome.clusters.length,
                });
            }
        } catch (error) {
            unrecorded = `compaction: couldn't record the compaction in the transcript: ${describeError(error)}`;
        }
        // Closed or quitting meanwhile: the clusters are kept, but no new
        // session is wanted.
        if (signal.aborted || this.#closed) {
            if (unrecorded !== null) {
                this.#warn(unrecorded);
            }
            return;
        }
        // One run compacts at most a call's worth of turns. While a
        // message waits, or before the first session, a seed still past
        // hard is compacted again at once, with no session between.
        const seed = shared.seed(this.#turns);
        if (
            (this.#held.length > 0 || this.#inner === null) &&
            shared.options.estimate(seed) > shared.options.config.hard
        ) {
            this.#again = true;
            this.#behind = this.#inner !== null;
        } else {
            const old = this.#inner;
            this.#urgent = false;
            // The old session's last reply may have started an idle wait.
            this.#cancelIdle();
            this.#attach(this.#connect(seed));
            this.#behind = false;
            if (old !== null) {
                this.#shared.retire(old, this);
            }
        }
        this.#landed = true;
        // Warned even when a listener throws on the event.
        try {
            this.#emit({
                type: "compacted",
                from: outcome.range.from,
                through: landed.through,
                clusters: landed.clusters.length,
            });
        } finally {
            if (unrecorded !== null) {
                this.#warn(unrecorded);
            }
        }
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

    // Connecting failed where no caller hears the throw: the wrapper ends
    // as a session that failed does, with an error event, so App
    // reconnects at the next message. Held messages are in App's turns.
    #die(error: unknown): void {
        this.#closed = true;
        this.#cancelIdle();
        this.#held = [];
        this.#emit({
            type: "error",
            message: `couldn't start Dorothy's session: ${describeError(error)}`,
        });
    }

    // Unless another run follows, a session exists afterwards and held
    // messages go to it: after a failure, to the session that is nearly
    // full, seeded from the clusters saved so far.
    #afterRun(): void {
        if (this.#closed) {
            return;
        }
        if (this.#again) {
            this.#again = false;
            this.#start();
            return;
        }
        if (this.#inner === null || this.#behind) {
            const old = this.#inner;
            try {
                this.#attach(this.#connect(this.#shared.seed(this.#turns)));
            } catch (error) {
                this.#die(error);
                return;
            }
            this.#behind = false;
            if (old !== null) {
                this.#shared.retire(old, this);
            }
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
        for (const message of held) {
            this.#forward(message);
        }
    }
}
