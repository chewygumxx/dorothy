// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/fixtures.ts
//
//

// Synthetic records in the shapes inspected on 2026-10-20. No value
// comes from a user's rollout. Only discriminators, keys and nesting do.
export const SESSION = "11111111-2222-4333-8444-555555555555";
export const at = (second: number) =>
    new Date(Date.UTC(2026, 9, 20, 9, 0, second)).toISOString();
export const line = (type: string, payload: unknown, second = 0) =>
    JSON.stringify({ timestamp: at(second), type, payload });
export const meta = () =>
    line("session_meta", {
        id: SESSION,
        session_id: SESSION,
        cwd: "/fixture/project",
        timestamp: at(0),
        originator: "fixture",
        source: "cli",
        model_provider: "fixture-provider",
        base_instructions: { text: "Synthetic instructions." },
    });
export const context = (cwd = "/fixture/project", model = "fixture-model") =>
    line("turn_context", {
        cwd,
        model,
        turn_id: "fixture-turn",
        approval_policy: "never",
        sandbox_policy: { type: "read-only" },
        collaboration_mode: { mode: "default", settings: { model } },
    });
export const message = (role: string, text: string, second = 1) =>
    line(
        "response_item",
        {
            type: "message",
            id: "fixture-message",
            role,
            content: [
                {
                    type: role === "assistant" ? "output_text" : "input_text",
                    text,
                },
            ],
        },
        second,
    );
export const call = (
    type: string,
    id: string,
    name: string,
    input: string,
    second = 2,
) =>
    line(
        "response_item",
        {
            type,
            call_id: id,
            name,
            ...(type === "function_call" ? { arguments: input } : { input }),
        },
        second,
    );
export const output = (type: string, id: string, value: unknown, second = 3) =>
    line("response_item", { type, call_id: id, output: value }, second);

// Every observed bookkeeping discriminator, with synthetic nested values.
export const bookkeeping = [
    line("compacted", {
        message: "Synthetic summary.",
        replacement_history: [],
    }),
    line("token_usage_record", {
        usage: { input_tokens: 1, output_tokens: 2 },
    }),
    line("world_state", { full: true, state: { model: "fixture-model" } }),
    line("inter_agent_communication_metadata", { trigger_turn: false }),
    line("response_item", {
        type: "reasoning",
        summary: [],
        encrypted_content: "synthetic",
    }),
    line("response_item", {
        type: "agent_message",
        author: "fixture",
        recipient: "fixture-peer",
        content: [{ type: "input_text", text: "Synthetic agent note." }],
    }),
    ...[
        "item_completed",
        "task_started",
        "task_complete",
        "thread_settings_applied",
        "token_count",
    ].map((type) => line("event_msg", { type })),
];
