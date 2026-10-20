// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/codex.ts
//
//

// Pure rollout decoding. The contract's record path scrubs and trims
// tool text when these events are written. No host store is opened here.
import type { RecordEvent } from "@dorothy/core";

type Json = Record<string, unknown>;
export type CodexHalt = { line: number; type: string | null; reason: string };
export type CodexRead = {
    session: string | null;
    cwd: string | null;
    model: string | null;
    at: string | null;
    events: RecordEvent[];
    halt: CodexHalt | null;
    unknown: { line: number; type: string }[];
    // Zero-based line of an unanswered call; its sourceId is line + 1.
    pending: number | null;
};

// Shapes seen in the probe, plus older Codex bookkeeping spellings.
const BOOKKEEPING = new Set([
    "compacted",
    "token_usage_record",
    "world_state",
    "inter_agent_communication_metadata",
    "response_item/reasoning",
    "response_item/agent_message",
    "event_msg/item_completed",
    "event_msg/task_started",
    "event_msg/task_complete",
    "event_msg/thread_settings_applied",
    "event_msg/token_count",
    "event_msg/user_message",
    "event_msg/agent_message",
    "event_msg/agent_reasoning",
    "event_msg/turn_aborted",
    "event_msg/context_compacted",
]);
class Unreadable extends Error {}
const object = (value: unknown): value is Json =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, reason: string): string => {
    if (typeof value !== "string") throw new Unreadable(reason);
    return value;
};
const nonempty = (value: unknown, reason: string) => {
    const result = text(value, reason);
    if (result.trim() === "") throw new Unreadable(reason);
    return result;
};
function time(record: Json): string {
    const value = Date.parse(text(record.timestamp, "no timestamp"));
    if (!Number.isFinite(value)) throw new Unreadable("invalid timestamp");
    return new Date(value).toISOString();
}
function blocks(value: unknown, separator = "\n\n"): string {
    if (!Array.isArray(value)) throw new Unreadable("text without its blocks");
    return value
        .map((block) => {
            if (
                !object(block) ||
                !["input_text", "output_text"].includes(String(block.type))
            ) {
                throw new Unreadable("an unsupported text block");
            }
            return text(block.text, "a text block without its text");
        })
        .join(separator);
}

type Decoded =
    | { line: number; event: RecordEvent }
    | {
          line: number;
          call: {
              answerKey: string;
              name: string;
              input: string;
              at: string;
              sourceId: string;
          };
      };
export type CodexReadOptions = { ended?: boolean };

export function readCodex(
    lines: readonly string[],
    { ended = false }: CodexReadOptions = {},
): CodexRead {
    const read: CodexRead = {
        session: null,
        cwd: null,
        model: null,
        at: null,
        events: [],
        halt: null,
        unknown: [],
        pending: null,
    };
    const known = new Set<string>();
    const decoded: Decoded[] = [];
    // Only the valid prefix can supply answers. Nothing after a malformed
    // record is allowed to acknowledge an earlier call.
    const answers = new Map<string, string>();
    for (const [index, raw] of lines.entries()) {
        if (raw.trim() === "") continue;
        let type: string | null = null;
        try {
            let record: unknown;
            try {
                record = JSON.parse(raw);
            } catch {
                throw new Unreadable("not JSON");
            }
            if (!object(record)) throw new Unreadable("not a JSON object");
            type = nonempty(record.type, "no type");
            if (
                [
                    "session_meta",
                    "turn_context",
                    "response_item",
                    "event_msg",
                ].includes(type)
            ) {
                if (!object(record.payload))
                    throw new Unreadable("no payload object");
                const payload = record.payload;
                if (type === "response_item" || type === "event_msg") {
                    type += `/${nonempty(payload.type, "no payload type")}`;
                }
                switch (type) {
                    case "session_meta": {
                        const session = nonempty(
                            payload.id ?? payload.session_id,
                            "no session id",
                        );
                        if (read.session !== null && read.session !== session)
                            throw new Unreadable("a different session id");
                        const at = time(record);
                        const cwd =
                            payload.cwd === undefined
                                ? null
                                : nonempty(payload.cwd, "no working directory");
                        read.session = session;
                        read.at ??= at;
                        read.cwd ??= cwd;
                        continue;
                    }
                    case "turn_context": {
                        const cwd = nonempty(
                            payload.cwd,
                            "no working directory",
                        );
                        const model = nonempty(payload.model, "no model");
                        time(record);
                        read.cwd = cwd;
                        read.model = model;
                        continue;
                    }
                    case "response_item/function_call":
                    case "response_item/custom_tool_call": {
                        const id = nonempty(
                            payload.call_id,
                            "a tool call without its id",
                        );
                        const name = nonempty(
                            payload.name,
                            "a tool call without its name",
                        );
                        const input = text(
                            type === "response_item/function_call"
                                ? payload.arguments
                                : payload.input,
                            "a tool call without its input",
                        );
                        decoded.push({
                            line: index,
                            call: {
                                answerKey: `${type}_output/${id}`,
                                name,
                                input,
                                at: time(record),
                                sourceId: String(index + 1),
                            },
                        });
                        continue;
                    }
                    case "response_item/function_call_output":
                    case "response_item/custom_tool_call_output": {
                        const id = nonempty(
                            payload.call_id,
                            "a tool output without its call id",
                        );
                        const output =
                            typeof payload.output === "string"
                                ? payload.output
                                : blocks(payload.output, "\n");
                        time(record);
                        answers.set(`${type}/${id}`, output);
                        continue;
                    }
                    case "response_item/message": {
                        if (
                            payload.role === "system" ||
                            payload.role === "developer"
                        )
                            continue;
                        if (
                            payload.role !== "user" &&
                            payload.role !== "assistant"
                        )
                            throw new Unreadable("an unsupported message role");
                        const said = blocks(payload.content);
                        const at = time(record);
                        if (said.trim() !== "")
                            decoded.push({
                                line: index,
                                event: {
                                    kind: payload.role,
                                    text: said,
                                    sourceId: String(index + 1),
                                    at,
                                    ...(payload.role === "assistant"
                                        ? { interrupted: false }
                                        : {}),
                                },
                            });
                        continue;
                    }
                }
            }
            if (!BOOKKEEPING.has(type) && !known.has(type)) {
                read.unknown.push({ line: index, type });
                known.add(type);
            }
        } catch (error) {
            if (!(error instanceof Unreadable)) throw error;
            read.halt = { line: index, type, reason: error.message };
            break;
        }
    }
    for (const item of decoded) {
        if ("event" in item) {
            read.events.push(item.event);
            continue;
        }
        const { answerKey, ...call } = item.call;
        const output = answers.get(answerKey);
        if (output === undefined && !ended) {
            read.pending = item.line;
            break;
        }
        read.events.push({
            kind: "tool",
            ...call,
            output: output ?? "",
            ok: output !== undefined,
        });
    }
    return read;
}
