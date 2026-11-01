// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/contracts/structured.ts
//
//

// One question to a model, answered as JSON matching schema. Memory's
// reviews and compaction are both given an implementation, so neither
// depends on a provider's SDK; agent's `structuredCall` implements it on
// a route.
export type StructuredRequest = {
    // Names the call in its errors: "the review ended without a result".
    what: string;
    system: string;
    prompt: string;
    schema: Record<string, unknown>;
    timeoutMs: number;
    signal?: AbortSignal;
};

// A failed call still reports what it cost.
// notes: what the call's route said on its way, a fallback's warning
// among them; set only when there is one.
export type StructuredOutcome =
    | {
          ok: true;
          output: unknown;
          model: string;
          costUsd: number;
          notes?: string[];
      }
    | { ok: false; reason: string; costUsd: number; notes?: string[] };

export type StructuredCall = (
    request: StructuredRequest,
) => Promise<StructuredOutcome>;
