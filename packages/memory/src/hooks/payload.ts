// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/hooks/payload.ts
//
//

// A host hook's payload, Codex's or her Hermes provider's, read into
// what a block or recall request needs. Anything unreadable is null: a
// hook answers nothing then, rather than failing the host's turn.

import { BLOCK_REASONS, type BlockReason } from "@dorothy/core";

export const HOOK_EVENTS = ["session-start", "prompt"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export type HookInput = {
    session: string;
    cwd: string;
    reason: BlockReason;
    prompt: string | null;
};

const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value : null;

// A source the contract does not name, such as a fork, opens as a start.
const reasonOf = (source: unknown): BlockReason =>
    BLOCK_REASONS.find((reason) => reason === source) ?? "startup";

export function parseHookInput(
    event: HookEvent,
    json: unknown,
): HookInput | null {
    if (typeof json !== "object" || json === null) {
        return null;
    }
    const payload = json as Record<string, unknown>;
    const session = text(payload.session_id);
    const cwd = text(payload.cwd);
    if (session === null || cwd === null) {
        return null;
    }
    if (event === "session-start") {
        return { session, cwd, reason: reasonOf(payload.source), prompt: null };
    }
    const prompt = text(payload.prompt);
    return prompt === null ? null : { session, cwd, reason: "startup", prompt };
}
