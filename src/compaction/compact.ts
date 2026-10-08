// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/compaction/compact.ts
//
//

import type { StructuredCall } from "../contracts/structured.js";
import type { Cluster } from "../memory/sidecar.js";
import type { Turn } from "../persona.js";
import {
    clusterInstructions,
    clusterPrompt,
    clusterSchema,
    validateClusters,
} from "./clusters.js";
import { outgoing, type Range } from "./plan.js";

// As long as a review may take.
export const COMPACTION_TIMEOUT_MS = 120_000;

export type CompactOutcome =
    | { kind: "compacted"; range: Range; clusters: Cluster[]; costUsd: number }
    | { kind: "nothing" }
    | { kind: "failed"; reason: string; costUsd: number };

// One compaction: which turns leave, Dorothy's clusters of them, checked.
// It writes nothing; the caller saves what it returns.
export async function compact({
    turns,
    clusters,
    tail,
    cap,
    persona,
    recollect,
    call,
    now,
    signal,
}: {
    turns: readonly Turn[];
    clusters: readonly Cluster[];
    tail: number;
    // The most tokens of turns the call is sent; see callCap.
    cap?: number;
    persona: string;
    // Whether her sessions will offer recollect on the clusters.
    recollect: boolean;
    call: StructuredCall;
    now: () => Date;
    signal?: AbortSignal;
}): Promise<CompactOutcome> {
    const range = outgoing(turns, clusters, tail, cap);
    if (range === null) {
        return { kind: "nothing" };
    }
    const outcome = await call({
        what: "compaction",
        system: [persona, clusterInstructions(recollect)].join("\n\n"),
        prompt: clusterPrompt(turns, range, clusters),
        schema: clusterSchema(range),
        timeoutMs: COMPACTION_TIMEOUT_MS,
        ...(signal === undefined ? {} : { signal }),
    });
    if (!outcome.ok) {
        return {
            kind: "failed",
            reason: outcome.reason,
            costUsd: outcome.costUsd,
        };
    }
    const checked = validateClusters(outcome.output, range, {
        at: now().toISOString(),
        model: outcome.model,
    });
    return checked.ok
        ? {
              kind: "compacted",
              range,
              clusters: checked.clusters,
              costUsd: outcome.costUsd,
          }
        : { kind: "failed", reason: checked.reason, costUsd: outcome.costUsd };
}
