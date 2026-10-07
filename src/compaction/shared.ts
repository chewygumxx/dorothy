// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/compaction/shared.ts
//
//

import type { CompactionConfig } from "../config.js";
import type { ChatSession } from "../conversation.js";
import type { Cluster } from "../memory/sidecar.js";
import type { Turn } from "../persona.js";
import { REAL_TIMERS, type Timers } from "../timers.js";
import { covered, seedTurns } from "./plan.js";
import type { StructuredCall } from "./types.js";

// Failures in a run after which compaction stops until the next launch.
export const MAX_FAILURES = 3;

// What a session starts with: the clusters, and the turns after them.
export type Seed = { turns: Turn[]; clusters: readonly Cluster[] };
// The conversation's claim in the recall index, which reviews take too.
export type Claim = { take(): Promise<boolean>; release(): Promise<void> };
// Saved; or, with clusters, not saved because another writer's clusters,
// these, already reach the turns, and the run takes them up instead if
// they fit.
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
    // A claim for one chain of runs, made afresh for each: chains, even two
    // of one TUI, exclude each other as two TUIs do. Each run of a chain
    // takes it: the first gets it, and the runs chained after it renew it.
    claims?: (() => Claim) | null;
    timers?: Timers;
    now?: () => Date;
};

// Why another writer's clusters can't replace a run's, or null when they
// can: they must cover at least the run's first turn, and stop before the
// latest message, whose exchange the seed always keeps.
function misfit(
    theirs: readonly Cluster[],
    from: number,
    latest: number,
): string | null {
    const end = covered(theirs);
    if (end < from) {
        return `the notes' clusters end at turn ${end}, before turn ${from}`;
    }
    if (end >= latest) {
        return `the notes' clusters reach turn ${end}, this chat's latest message`;
    }
    return null;
}

// What one run's compaction keeps across its sessions: the clusters so
// far, the failures, and the calls, saves and closings under way. Only
// the compaction modules see it.
export class Shared {
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
    // Saves under way, each settling once its clusters are added and the
    // compaction recorded.
    readonly #saving = new Set<Promise<void>>();
    // Aborted on quitting: from then on nothing waits for a save or a
    // record, which may never settle.
    readonly #stopping = new AbortController();

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
    // takes up another writer's that already reach their turns, if they
    // fit before latest, the turn of the newest message.
    save(
        clusters: readonly Cluster[],
        costUsd: number,
        latest: number,
    ): Promise<SaveResult> {
        const from = clusters[0]?.from ?? covered(this.clusters) + 1;
        return this.options
            .save(clusters, costUsd)
            .then((saved): SaveResult => {
                if (!saved.ok) {
                    return saved;
                }
                if (saved.clusters === undefined) {
                    this.clusters = [...this.clusters, ...clusters];
                    return saved;
                }
                const reason = misfit(saved.clusters, from, latest);
                if (reason !== null) {
                    return { ok: false, reason };
                }
                this.clusters = [...saved.clusters];
                return saved;
            });
    }

    // Saving and recording: a session seeded meanwhile waits for both, so
    // that its seed has the clusters and the transcript's compaction event
    // comes before its session event.
    landing<T>(work: Promise<T>): Promise<T> {
        const settled = work.then(
            () => {},
            () => {},
        );
        this.#saving.add(settled);
        void settled.then(() => this.#saving.delete(settled));
        return work;
    }

    // Settles as work does, or with null once quitting, whichever comes
    // first; work goes on regardless.
    unlessStopped<T>(work: Promise<T>): Promise<T | null> {
        const signal = this.#stopping.signal;
        if (signal.aborted) {
            return Promise.resolve(null);
        }
        return new Promise((resolve, reject) => {
            const stop = () => resolve(null);
            signal.addEventListener("abort", stop, { once: true });
            work.then(resolve, reject).finally(() =>
                signal.removeEventListener("abort", stop),
            );
        });
    }

    // Settles once every save under way, and its record, has, with true;
    // with false once quitting; null when none is under way.
    saved(): Promise<boolean> | null {
        return this.#saving.size === 0
            ? null
            : this.unlessStopped(Promise.all(this.#saving)).then(
                  (done) => done !== null,
              );
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
        this.#stopping.abort();
        for (const controller of this.#runs.keys()) {
            controller.abort();
        }
        await Promise.all(this.#runs.values());
        await Promise.all(this.#closing.keys());
    }
}
