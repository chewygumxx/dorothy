// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/hermes-fixtures.ts
//
//

import type { Database } from "bun:sqlite";

// Table DDL from installed Hermes hermes_state_common.py, SCHEMA_SQL,
// inspected read-only on 2026-10-20. Fixture rows are wholly synthetic.
export const HERMES_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    created_source TEXT,
    user_id TEXT,
    session_key TEXT,
    chat_id TEXT,
    chat_type TEXT,
    thread_id TEXT,
    display_name TEXT,
    origin_json TEXT,
    expiry_finalized INTEGER DEFAULT 0,
    model TEXT,
    model_config TEXT,
    system_prompt TEXT,
    system_prompt_hash TEXT,
    parent_session_id TEXT,
    started_at REAL NOT NULL,
    ended_at REAL,
    end_reason TEXT,
    message_count INTEGER DEFAULT 0,
    tool_call_count INTEGER DEFAULT 0,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    cache_write_tokens INTEGER DEFAULT 0,
    reasoning_tokens INTEGER DEFAULT 0,
    cwd TEXT,
    git_branch TEXT,
    git_repo_root TEXT,
    git_metadata_generation INTEGER NOT NULL DEFAULT 0,
    billing_provider TEXT,
    billing_base_url TEXT,
    billing_mode TEXT,
    estimated_cost_usd REAL,
    actual_cost_usd REAL,
    cost_status TEXT,
    cost_source TEXT,
    pricing_version TEXT,
    title TEXT,
    title_source TEXT,
    last_activity_at REAL,
    last_activity_description TEXT,
    last_activity_provenance TEXT,
    api_call_count INTEGER DEFAULT 0,
    handoff_state TEXT,
    handoff_platform TEXT,
    handoff_error TEXT,
    compression_failure_cooldown_until REAL,
    compression_failure_error TEXT,
    compression_fallback_streak INTEGER NOT NULL DEFAULT 0,
    compression_ineffective_count INTEGER NOT NULL DEFAULT 0,
    compression_recovery_deadline REAL,
    compression_overload_streak INTEGER NOT NULL DEFAULT 0,
    profile_name TEXT,
    transport_profile TEXT,
    rewind_count INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    auto_archived INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    last_read_at REAL,
    tool_names TEXT,
    FOREIGN KEY (parent_session_id) REFERENCES sessions(id),
    FOREIGN KEY (system_prompt_hash) REFERENCES system_prompts(hash)
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL,
    content TEXT,
    tool_call_id TEXT,
    tool_calls TEXT,
    tool_name TEXT,
    effect_disposition TEXT,
    timestamp REAL NOT NULL,
    token_count INTEGER,
    finish_reason TEXT,
    reasoning TEXT,
    reasoning_content TEXT,
    reasoning_details TEXT,
    codex_reasoning_items TEXT,
    codex_message_items TEXT,
    platform_message_id TEXT,
    observed INTEGER DEFAULT 0,
    _compressed_summary INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    compacted INTEGER NOT NULL DEFAULT 0,
    api_content TEXT,
    display_kind TEXT,
    display_metadata TEXT,
    display_identity BLOB,
    display_order INTEGER,
    message_uid TEXT,
    absorbed_message_uids TEXT,
    tool_call_uids TEXT,
    tool_call_uid TEXT
);
`;

export const hermesAt = (second: number) =>
    new Date(Date.UTC(2026, 9, 20, 10, 0, second)).toISOString();
export const seconds = (second: number) => Date.parse(hermesAt(second)) / 1000;
export function hermesSession(
    db: Database,
    id = "fixture-session",
    options: {
        source?: string;
        cwd?: string | null;
        origin?: string | null;
        model?: string | null;
        ended?: number | null;
    } = {},
) {
    db.run(
        `INSERT INTO sessions
         (id, source, cwd, origin_json, model, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            options.source ?? "cli",
            options.cwd ?? null,
            options.origin ?? null,
            options.model ?? "fixture-model",
            seconds(0),
            options.ended ?? null,
        ],
    );
}
export function hermesMessage(
    db: Database,
    id: number,
    role: string,
    content: string | null,
    options: {
        session?: string;
        second?: number;
        calls?: string | null;
        callId?: string | null;
        display?: string | null;
        summary?: number;
        active?: number;
        compacted?: number;
        api?: string | null;
    } = {},
) {
    db.run(
        `INSERT INTO messages
         (id, session_id, role, content, timestamp, tool_calls,
          tool_call_id, display_kind, _compressed_summary, active,
          compacted, api_content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            options.session ?? "fixture-session",
            role,
            content,
            seconds(options.second ?? id),
            options.calls ?? null,
            options.callId ?? null,
            options.display ?? null,
            options.summary ?? 0,
            options.active ?? 1,
            options.compacted ?? 0,
            options.api ?? null,
        ],
    );
}
export const hermesContent = (value: unknown) =>
    `\0json:${JSON.stringify(value)}`;
export const hermesCall = (id: string, name = "fixture", args = "{}") => ({
    id,
    type: "function",
    function: { name, arguments: args },
});
