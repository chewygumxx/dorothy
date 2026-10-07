// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/compaction/session.ts
//
//

import type { ChatSession, ConversationEvent } from "../conversation.js";
import type { Cluster } from "../memory/sidecar.js";
import type { Turn } from "../persona.js";
import { pressure } from "./plan.js";
import { type Chained, compactOnce, type Landing } from "./run.js";
import {
    type CompactionOptions,
    describeError,
    type Seed,
    Shared,
} from "./shared.js";

export { CLAIM_RETRY_MS } from "./run.js";
export type { Claim, CompactionOptions, SaveResult, Seed } from "./shared.js";
export { MAX_FAILURES, QUIT_GRACE_MS } from "./shared.js";

type Held = { text: string; interrupted: boolean };
// A run under way, and how it landed: null until its clusters are saved
// and its new session, if any, has taken over, so that a throw from then
// on, such as a listener's, is not a failed compaction; "chained" when
// another run follows at once, "handed" when a session took over.
type Run = {
    controller: AbortController;
    landed: "chained" | "handed" | null;
};

// What a session is doing about compaction, which decides where a message
// sent goes:
// - waiting: App reconnected while another session's run saves; the seed
//   waits for the save and its record. Messages are held; no run starts.
// - open: messages go on to the inner session, or, past hard or before
//   the first session, are held while a run compacts.
// - handing: a run is saving its clusters, or runs follow one another
//   with no session between; messages are held for the session that takes
//   over. stale: the inner session's seed predates clusters saved since.
// - closed: closed, or failed to connect; final.
// Moves: a session starts open, or waiting when a save is under way;
// waiting becomes open once the save settles (and stays waiting when
// quitting comes first); a run's save moves open to handing; a run that
// chains marks handing stale when an inner session exists; a handover, or
// the reconnect after a chain, makes it fresh; the end of the last run
// makes it open; close() or a failed connect makes any phase closed.
type Phase =
    | { kind: "waiting" }
    | { kind: "open" }
    | { kind: "handing"; stale: boolean }
    | { kind: "closed" };

// The reply to a message sent has started: its text, a lookup, or the
// API's stream.
const streams = (event: ConversationEvent) =>
    event.type === "delta" ||
    event.type === "lookup" ||
    (event.type === "sdk" && event.message.type === "stream_event");

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
    #run: Run | null = null;
    #phase: Phase = { kind: "open" };
    // The claim of the runs under way, one after another with no gap: let
    // go once no run follows, so a review waiting for it runs after them.
    #claim: Chained | null = null;

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
            this.#enter({ kind: "waiting" });
            void saving
                .then((done) => {
                    // Quitting: no session is wanted.
                    if (!done) {
                        return;
                    }
                    this.#enter({ kind: "open" });
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

    // Every move between phases; none leaves closed.
    #enter(next: Phase): void {
        if (this.#phase.kind !== "closed") {
            this.#phase = next;
        }
    }

    get #closed(): boolean {
        return this.#phase.kind === "closed";
    }

    // Esc on a held message: no run follows the current one, which hands
    // over even to a seed still past hard.
    get #cutShort(): boolean {
        return this.#held.some((held) => held.interrupted);
    }

    // The inner session, once a chain ends, is seeded afresh.
    #fresh(): void {
        if (this.#phase.kind === "handing") {
            this.#enter({ kind: "handing", stale: false });
        }
    }

    #begin(): void {
        if (this.#closed) {
            return;
        }
        const shared = this.#shared;
        const seed = shared.seed(this.#turns);
        // A seed that can't be estimated is taken as under hard, as after
        // a save: a sizing error doesn't keep the session from starting.
        const after: string[] = [];
        if (!shared.exhausted && this.#pastHard(seed, after)) {
            this.#urgent = true;
            // Esc on these, held for a save, ends the chain this starts
            // after its first call, as Esc during it would.
            // After the caller has subscribed.
            queueMicrotask(() => {
                this.#announce();
                this.#start();
            });
            return;
        }
        this.#attach(this.#connect(seed));
        // Esc on these, held for a save, ends no chain to come: they go.
        this.#sendHeld(this.#held.splice(0));
        if (after.length > 0) {
            // After the caller has subscribed; no caller hears a throw.
            queueMicrotask(() => {
                for (const message of after) {
                    try {
                        this.#warn(message);
                    } catch {}
                }
            });
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
        if (this.#phase.kind === "waiting") {
            this.#held.push({ text, interrupted: false });
            return;
        }
        if (
            this.#inner === null ||
            this.#phase.kind === "handing" ||
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
        this.#enter({ kind: "closed" });
        this.#cancelIdle();
        this.#run?.controller.abort();
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
        const run: Run = { controller, landed: null };
        this.#run = run;
        const done = this.#compactOnce(run)
            .catch((error: unknown) => {
                if (run.landed !== null) {
                    this.#warn(
                        `compaction: after ${run.landed === "chained" ? "saving" : "handing over"}: ${describeError(error)}`,
                    );
                } else {
                    this.#fail(describeError(error));
                }
            })
            .finally(() => {
                this.#run = null;
                try {
                    this.#afterRun(run);
                } catch (error) {
                    this.#escaped(error);
                }
            })
            // Inside the run's promise, so that Compaction.stop waits for
            // the claim to be let go.
            .finally(() => this.#endChain())
            // The catch above can throw too, on a listener's: the run's
            // promise is awaited by Compaction.stop, which must settle.
            .catch((error: unknown) => this.#escaped(error));
        this.#shared.track(controller, done);
    }

    // A throw nothing above can take, such as a listener's: it is told as a
    // warning, and if that throws too, no one hears it.
    #escaped(error: unknown): void {
        try {
            this.#warn(`compaction: ${describeError(error)}`);
        } catch {}
    }

    // One run, then what its landing asks of this session.
    async #compactOnce(run: Run): Promise<void> {
        const shared = this.#shared;
        if (this.#claim === null) {
            const claim = shared.options.claims?.() ?? null;
            this.#claim = claim === null ? null : { claim, held: false };
        }
        const signal = run.controller.signal;
        const landing = await compactOnce(shared, this.#claim, signal, {
            holding: () => this.#urgent || this.#inner === null,
            turns: () => this.#turns,
            cost: (usd) => this.#emit({ type: "memory-cost", usd }),
            settled: (signal) => this.#whenSettled(signal),
            saving: () => {
                if (this.#phase.kind === "open") {
                    this.#enter({ kind: "handing", stale: false });
                }
            },
        });
        switch (landing.kind) {
            case "none":
                return;
            case "off":
                shared.switchOff();
                this.#cancelIdle();
                this.#warn(
                    `compaction: off until the next launch; ${landing.reason}`,
                );
                return;
            case "nothing":
                this.#warn(
                    "compaction: nothing to compact; the latest exchange alone fills the tail",
                );
                return;
            case "failed":
                this.#fail(landing.reason);
                return;
            case "saved":
                this.#land(landing, run);
        }
    }

    // Once no run follows, the chain lets go of its claim; one that can't
    // be let go expires.
    async #endChain(): Promise<void> {
        const chained = this.#claim;
        if (this.#run !== null || chained === null) {
            return;
        }
        this.#claim = null;
        if (!chained.held) {
            return;
        }
        try {
            await chained.claim.release();
        } catch (error) {
            this.#warn(
                `compaction: couldn't let go of the claim: ${describeError(error)}`,
            );
        }
    }

    // Hands over to a session seeded with the clusters saved, or chains
    // another run while the seed is still past hard.
    #land(landing: Extract<Landing, { kind: "saved" }>, run: Run): void {
        const shared = this.#shared;
        const after = landing.after;
        // Closed or quitting meanwhile: the clusters are kept, but no new
        // session is wanted.
        if (run.controller.signal.aborted || this.#closed) {
            for (const message of after) {
                this.#warn(message);
            }
            return;
        }
        // One run compacts at most a call's worth of turns. While a
        // message waits, or before the first session, a seed still past
        // hard is compacted again at once, with no session between, unless
        // Esc cut the chain short. A seed that can't be estimated is taken
        // as under hard: the clusters are saved, so the handover goes ahead.
        const seed = shared.seed(this.#turns);
        const past =
            (this.#held.length > 0 || this.#inner === null) &&
            this.#pastHard(seed, after);
        if (past && !this.#cutShort) {
            this.#enter({ kind: "handing", stale: this.#inner !== null });
            run.landed = "chained";
        } else {
            const old = this.#inner;
            // A connect that throws here, after the save, still counts as a
            // failed compaction: no session took over and the context is
            // as full as before, so the wait before the next try doubles
            // as it does for any failure. The clusters stay saved. Urgency
            // stands until the session connects, so that a held message
            // sent on to the old session is warned of, and after it when
            // the new seed is still past hard.
            const next = this.#connect(seed);
            this.#urgent = past;
            // The old session's last reply may have started an idle wait.
            this.#cancelIdle();
            this.#attach(next);
            this.#fresh();
            if (old !== null) {
                this.#shared.retire(old, this);
            }
            run.landed = "handed";
        }
        // Warned even when a listener throws on the event; the first throw
        // is the one rethrown, not a later one on a warning.
        let failure: { error: unknown } | null = null;
        try {
            this.#emit({
                type: "compacted",
                from: landing.from,
                through: landing.through,
                clusters: landing.clusters,
            });
        } catch (error) {
            failure = { error };
        }
        for (const message of after) {
            try {
                this.#warn(message);
            } catch (error) {
                failure ??= { error };
            }
        }
        if (failure !== null) {
            throw failure.error;
        }
    }

    #pastHard(seed: Seed, warnings: string[]): boolean {
        try {
            return (
                this.#shared.options.estimate(seed) >
                this.#shared.options.config.hard
            );
        } catch (error) {
            warnings.push(
                `compaction: couldn't estimate the new session: ${describeError(error)}`,
            );
            return false;
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
        this.#enter({ kind: "closed" });
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
    #afterRun(run: Run): void {
        if (this.#closed) {
            return;
        }
        if (run.landed === "chained") {
            // Quitting: no run follows.
            if (run.controller.signal.aborted) {
                return;
            }
            if (!this.#cutShort) {
                this.#start();
                return;
            }
            // Esc came after the run chose to go on: its seed is past hard.
            this.#urgent = true;
        }
        if (
            this.#inner === null ||
            (this.#phase.kind === "handing" && this.#phase.stale)
        ) {
            const old = this.#inner;
            try {
                this.#attach(this.#connect(this.#shared.seed(this.#turns)));
            } catch (error) {
                this.#die(error);
                return;
            }
            this.#fresh();
            if (old !== null) {
                this.#shared.retire(old, this);
            }
        }
        const held = this.#held.splice(0);
        // Held messages go on even when a listener throws on the warning.
        try {
            if (held.length > 0 && this.#urgent) {
                this.#warn(
                    "compaction: the context is nearly full; sending anyway",
                );
            }
        } finally {
            this.#urgent = false;
            this.#announced = false;
            this.#enter({ kind: "open" });
            this.#sendHeld(held);
        }
    }

    // Sends held messages on; one that can't be sent is warned of and
    // doesn't keep back the rest.
    #sendHeld(held: readonly Held[]): void {
        for (const message of held) {
            try {
                this.#forward(message);
            } catch (error) {
                try {
                    this.#warn(
                        `compaction: couldn't send a held message: ${describeError(error)}`,
                    );
                } catch {}
            }
        }
    }
}
