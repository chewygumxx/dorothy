// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/hooks/fixtures.ts
//
//

// Payloads hosts send a hook on stdin, as Task 1's probe recorded them
// (docs/reports/2026-11-01-delivery/probes.md).

export const CODEX_SESSION_START = {
    session_id: "019a0000-0000-7000-8000-000000000001",
    transcript_path: "/tmp/codex/sessions/rollout.jsonl",
    cwd: "/tmp/project",
    hook_event_name: "SessionStart",
    model: "gpt-6.1-sol",
    source: "startup",
};

export const CODEX_PROMPT = {
    session_id: "019a0000-0000-7000-8000-000000000001",
    turn_id: "turn-1",
    transcript_path: "/tmp/codex/sessions/rollout.jsonl",
    cwd: "/tmp/project",
    hook_event_name: "UserPromptSubmit",
    model: "gpt-6.1-sol",
    prompt: "what did we decide about the engine?",
};

// Her Hermes provider's own payloads, in Codex's shape.
export const HERMES_SESSION_START = {
    session_id: "hermes-1",
    cwd: "/tmp/project",
    source: "startup",
};

export const HERMES_PROMPT = {
    session_id: "hermes-1",
    cwd: "/tmp/project",
    prompt: "what did we decide about the engine?",
};
