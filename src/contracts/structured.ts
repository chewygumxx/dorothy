// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/contracts/structured.ts
//
//

// One question to a model, answered as JSON matching schema. Memory's
// reviews and compaction are both given an implementation, so neither
// depends on the Agent SDK; after the move to the Messages API only the
// implementation changes.
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
export type StructuredOutcome =
    | { ok: true; output: unknown; model: string; costUsd: number }
    | { ok: false; reason: string; costUsd: number };

export type StructuredCall = (
    request: StructuredRequest,
) => Promise<StructuredOutcome>;
