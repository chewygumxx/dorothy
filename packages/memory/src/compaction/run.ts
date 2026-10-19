// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/compaction/run.ts
//
//

import { sleep, type Turn } from "@dorothy/core";
import type { Cluster } from "../memory/sidecar.js";
import { type CompactOutcome, compact } from "./compact.js";
import { callCap, covered, outgoing } from "./plan.js";
import {
    type Claim,
    describeError,
    type SaveResult,
    type Shared,
} from "./shared.js";

// How often a compaction past hard, a message held or not, or before the
// first session, asks again for a claim that another call holds.
export const CLAIM_RETRY_MS = 2000;

// A chain's claim, and whether its latest take was granted. The runs of a
// chain, one after another with no gap, share it.
export type Chained = { claim: Claim; held: boolean };

// What a run needs of the session it compacts for.
export type RunHost = {
    // Asked when the claim is refused: whether to ask again, as past hard
    // or before the first session. A turn may have crossed hard, and a
    // message been held, since the run started.
    holding(): boolean;
    // Every turn sent on so far, as App and the transcript count them.
    turns(): readonly Turn[];
    // What Dorothy's call cost, told as soon as it is known.
    cost(usd: number): void;
    // Resolves once no reply is streaming, or the signal aborts.
    settled(signal: AbortSignal): Promise<void>;
    // The save is about to start: messages wait for the session that
    // takes over rather than going to the old one, which is about to close.
    saving(): void;
};

// How one run ended.
export type Landing =
    // Nothing to tell: the claim is held elsewhere and nothing waits, or
    // the run was cancelled, or quitting came while it saved.
    | { kind: "none" }
    // The notes can no longer be read: compaction is off until the next
    // launch, for this reason.
    | { kind: "off"; reason: string }
    // The latest exchange alone fills the tail.
    | { kind: "nothing" }
    // Dorothy's call, or the save, failed.
    | { kind: "failed"; reason: string }
    // The clusters are saved, or another writer's taken up: the turns and
    // clusters the screen tells of, and warnings that follow its event.
    | {
          kind: "saved";
          from: number;
          through: number;
          clusters: number;
          after: string[];
      };

const NONE: Landing = { kind: "none" };

// One run: the claim, the check that the notes are readable and the turns
// leaving are the conversation's own, Dorothy's call, the wait for a reply streaming meanwhile, then saving or taking up
// another writer's clusters, and recording. Throws, such as a claim's or a
// save's, reach the caller.
export async function compactOnce(
    shared: Shared,
    chained: Chained | null,
    signal: AbortSignal,
    host: RunHost,
): Promise<Landing> {
    if (chained !== null && !(await takeClaim(chained, shared, signal, host))) {
        return NONE;
    }
    // One snapshot of the turns, for the check and the call alike.
    const turns = [...host.turns()];
    const { config } = shared.options;
    const cap = callCap(config);
    const range = outgoing(turns, shared.clusters, config.tail, cap);
    const ready = (await shared.options.ready?.(
        range === null
            ? null
            : {
                  from: range.from,
                  turns: turns.slice(range.from - 1, range.through),
              },
    )) ?? { ok: true };
    if (!ready.ok) {
        return { kind: "off", reason: ready.reason };
    }
    const outcome = await compact({
        turns,
        clusters: shared.clusters,
        tail: config.tail,
        cap,
        persona: shared.options.persona,
        recollect: shared.options.recollect,
        call: shared.options.call,
        now: shared.now,
        signal,
    });
    if (signal.aborted) {
        return NONE;
    }
    // Compaction is tried again only after a turn-end, which adds an
    // exchange, so finding nothing is not retried until another.
    if (outcome.kind === "nothing") {
        return outcome;
    }
    if (outcome.costUsd > 0) {
        host.cost(outcome.costUsd);
    }
    if (outcome.kind === "failed") {
        return { kind: "failed", reason: outcome.reason };
    }
    await host.settled(signal);
    if (signal.aborted) {
        return NONE;
    }
    host.saving();
    // The event only tells; the sidecar holds the clusters. Warnings of
    // the landing follow the compacted event, which clears compaction's
    // warnings.
    const after: string[] = [];
    const sent = host.turns();
    // Quitting waits for the save and record up to QUIT_GRACE_MS, then
    // leaves them to go on.
    const saved = await shared.unlessStopped(
        shared.landing(
            keep(
                shared,
                outcome,
                sent.findLastIndex((turn) => turn.role === "user") + 1,
                after,
            ),
        ),
    );
    if (saved === null) {
        return NONE;
    }
    if (!saved.ok) {
        return { kind: "failed", reason: saved.reason };
    }
    return landedAs(outcome, saved.clusters, after);
}

// The claim, taken once no other run holds it; false when the session
// stops holding messages or the run is cancelled first.
async function takeClaim(
    chained: Chained,
    shared: Shared,
    signal: AbortSignal,
    host: RunHost,
): Promise<boolean> {
    while (!(await chained.claim.take())) {
        chained.held = false;
        if (!host.holding() || signal.aborted) {
            return false;
        }
        await sleep(shared.timers, CLAIM_RETRY_MS, signal);
        if (signal.aborted) {
            return false;
        }
    }
    chained.held = true;
    return true;
}

// What the screen tells of a save. Another writer's clusters, taken up,
// are theirs to record; it tells of the turns they cover past this run's
// start.
function landedAs(
    outcome: Extract<CompactOutcome, { kind: "compacted" }>,
    taken: readonly Cluster[] | undefined,
    after: string[],
): Landing {
    const from = outcome.range.from;
    return taken === undefined
        ? {
              kind: "saved",
              from,
              through: outcome.range.through,
              clusters: outcome.clusters.length,
              after,
          }
        : {
              kind: "saved",
              from,
              through: covered(taken),
              clusters: taken.filter((cluster) => cluster.from >= from).length,
              after,
          };
}

// Saves the clusters, given latest, the turn of the newest message, and
// records the compaction unless another writer's were taken up, which are
// theirs to record. A record that fails is warned of after.
async function keep(
    shared: Shared,
    outcome: Extract<CompactOutcome, { kind: "compacted" }>,
    latest: number,
    after: string[],
): Promise<SaveResult> {
    const saved = await shared.save(outcome.clusters, outcome.costUsd, latest);
    if (saved.ok && saved.clusters === undefined) {
        try {
            await shared.options.record({
                through: outcome.range.through,
                clusters: outcome.clusters.length,
            });
        } catch (error) {
            after.push(
                `compaction: couldn't record the compaction in the transcript: ${describeError(error)}`,
            );
        }
    }
    return saved;
}
