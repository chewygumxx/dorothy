// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/claude-code.ts
//
//

// Claude Code's transcript lines as Dorothy's events. Pure: the hook
// reads the file and appends what this returns, so the mapping is tested
// on fixture lines alone. Main thread only; thinking is not kept, as
// chat keeps none; a call and its result are one event, at the call's
// line. A line of a type it maps but in a shape it does not expect halts
// the reading there, so a format that changes loses nothing.

import {
    CLAUDE_REMEMBER_TOOL,
    CLAUDE_SERVER_NAME,
    describeLookup,
    toolOf,
} from "@dorothy/core";
import { type TranscriptEntry, toolEntry } from "../transcript.js";

// Claude Code's bookkeeping, passed over in silence: the recording probe
// and the planning survey found these, none with a uuid.
export const BOOKKEEPING: ReadonlySet<string> = new Set([
    "agent-name",
    "agent-setting",
    "ai-title",
    "api-request",
    "api-request-blob",
    "api-request-shape",
    "atis-latch",
    "continued-in",
    "cost-state",
    "custom-title",
    "file-history-delta",
    "file-history-snapshot",
    "last-prompt",
    "mode",
    "permission-mode",
    "pr-link",
    "queue-operation",
    "relocated",
    "summary",
    "worktree-state",
]);
// The types the reader maps. system lines are all bookkeeping, but a
// type it knows.
const MAPPED: ReadonlySet<string> = new Set([
    "user",
    "assistant",
    "attachment",
    "system",
]);

export type ReadEvent = { entry: TranscriptEntry; uuid: string; at: string };
// Where the reading halted and why; line indexes the lines given.
export type Halt = {
    line: number;
    type: string | null;
    uuid: string | null;
    reason: string;
};
// A line of a type the reader neither maps nor lists, passed over.
export type Unknown = { line: number; type: string };
export type LinesRead = {
    events: ReadEvent[];
    // The first model an assistant line names, but Claude Code's own
    // <synthetic>.
    model: string | null;
    // The session ids the lines name, in order.
    sessions: string[];
    halt: Halt | null;
    unknown: Unknown[];
};
export type ReadOptions = {
    // The session is over: a call never answered is recorded failed,
    // not waited for.
    ended?: boolean;
    // The uuids already recorded, whose lines are passed over.
    recorded?: ReadonlySet<string>;
    // Lines before this time, in milliseconds, are not recorded: a
    // session new to Dorothy is hers from the launch on.
    since?: number | null;
};

type Json = Record<string, unknown>;
type Result = { text: string; ok: boolean };

const isRecord = (value: unknown): value is Json =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// A shape the reader does not expect: the reading halts.
class Unreadable extends Error {}

const OWN_OUTPUT =
    /^<(local-command-stdout|local-command-stderr|local-command-caveat|bash-stdout|bash-stderr|task-notification)>/;
const INTERRUPTED = /^\[Request interrupted by user[^\]]*\]$/;
// Claude Code's two shapes of a command as typed: its name first, or
// its message first. Markup inside her prose is her words.
const COMMAND_START = /^<command-(name|message)>/;
const COMMAND = /<command-name>([^<]*)<\/command-name>/;
const ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
const BASH = /^<bash-input>([\s\S]*)<\/bash-input>$/;

// What the user said in a user text: a command as typed, or the text;
// null for Claude Code's own output and markers, and a command without
// its name.
export function spoken(text: string): string | null {
    const trimmed = text.trim();
    if (
        trimmed === "" ||
        OWN_OUTPUT.test(trimmed) ||
        INTERRUPTED.test(trimmed)
    ) {
        return null;
    }
    const command = COMMAND_START.test(trimmed) ? COMMAND.exec(trimmed) : null;
    if (command !== null) {
        const name = (command[1] ?? "").trim();
        if (name === "") {
            return null;
        }
        const args = ARGS.exec(trimmed)?.[1]?.trim() ?? "";
        return `${name} ${args}`.trim();
    }
    const bash = BASH.exec(trimmed);
    return bash === null ? text : `! ${bash[1]}`;
}

// The user's words an attachment carries: a prompt queued while she
// worked. Any other attachment is bookkeeping.
function spokenAttachment(attachment: Json): string | null {
    if (attachment.type !== "queued_command") {
        return null;
    }
    if (
        attachment.commandMode !== undefined &&
        attachment.commandMode !== "prompt"
    ) {
        return null;
    }
    if (typeof attachment.prompt !== "string") {
        throw new Unreadable("a queued command without its prompt");
    }
    return spoken(attachment.prompt);
}

// A result's content as text: other blocks by their type.
function resultText(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }
    if (!Array.isArray(content)) {
        return "";
    }
    return content
        .map((block) =>
            isRecord(block) &&
            block.type === "text" &&
            typeof block.text === "string"
                ? block.text
                : `[${isRecord(block) && typeof block.type === "string" ? block.type : "block"}]`,
        )
        .join("\n");
}

function contentOf(line: Json, what: string): Json[] | string {
    const content = isRecord(line.message) ? line.message.content : undefined;
    if (typeof content === "string") {
        return content;
    }
    if (
        Array.isArray(content) &&
        content.every(
            (block) => isRecord(block) && typeof block.type === "string",
        )
    ) {
        return content as Json[];
    }
    throw new Unreadable(`${what} line without its content`);
}

function timeOf(line: Json): string {
    const time =
        typeof line.timestamp === "string"
            ? Date.parse(line.timestamp)
            : Number.NaN;
    if (!Number.isFinite(time)) {
        throw new Unreadable("no timestamp");
    }
    return new Date(time).toISOString();
}

// A call with its result: her lookups as recall events, her remember as
// her own tool event, any other as the store keeps tools.
function callEntry(
    id: string,
    name: string,
    input: unknown,
    answer: Result | undefined,
): TranscriptEntry {
    const output = answer?.text ?? "";
    const ok = answer?.ok ?? false;
    const tool = toolOf(name, CLAUDE_SERVER_NAME);
    if (tool !== null) {
        return {
            kind: "recall",
            id,
            ok,
            offset: 0,
            ...describeLookup(tool, input, ok ? output : null),
        };
    }
    return toolEntry({
        name,
        input: JSON.stringify(input ?? null),
        output,
        ok,
        memory: name === CLAUDE_REMEMBER_TOOL,
    });
}

// Every result in the lines, by its call's id, so a call is recorded
// with its answer wherever that came.
function resultsIn(lines: readonly (Json | null)[]): Map<string, Result> {
    const results = new Map<string, Result>();
    for (const line of lines) {
        if (line?.type !== "user" || line.isSidechain === true) {
            continue;
        }
        const content = isRecord(line.message)
            ? line.message.content
            : undefined;
        for (const block of Array.isArray(content) ? content : []) {
            if (
                isRecord(block) &&
                block.type === "tool_result" &&
                typeof block.tool_use_id === "string"
            ) {
                results.set(block.tool_use_id, {
                    text: resultText(block.content),
                    ok: block.is_error !== true,
                });
            }
        }
    }
    return results;
}

export function readLines(
    lines: readonly string[],
    { ended = false, recorded = new Set(), since = null }: ReadOptions = {},
): LinesRead {
    const parsed = lines.map(parseLine);
    const reading: Reading = {
        read: {
            events: [],
            model: null,
            sessions: [],
            halt: null,
            unknown: [],
        },
        results: resultsIn(parsed),
        ended,
        recorded,
        since,
    };
    const { read } = reading;
    for (const [index, line] of parsed.entries()) {
        if ((lines[index] ?? "").trim() === "") {
            continue;
        }
        const mark = read.events.length;
        const type = typeof line?.type === "string" ? line.type : null;
        try {
            if (!readLine(line, index, type, reading)) {
                // The line is read again with its answer: none of it now.
                read.events.length = mark;
                break;
            }
        } catch (error) {
            if (!(error instanceof Unreadable)) {
                throw error;
            }
            read.events.length = mark;
            read.halt = {
                line: index,
                type,
                uuid: uuidOf(line),
                reason: error.message,
            };
            break;
        }
    }
    return read;
}

const uuidOf = (line: Json | null) =>
    typeof line?.uuid === "string" ? line.uuid : null;

function parseLine(text: string): Json | null {
    try {
        const value: unknown = JSON.parse(text);
        return isRecord(value) ? value : null;
    } catch {
        return null;
    }
}

// What reading the lines shares: what it has read so far, every call's
// result, and the options.
type Reading = {
    read: LinesRead;
    results: ReadonlyMap<string, Result>;
    ended: boolean;
    recorded: ReadonlySet<string>;
    since: number | null;
};

// Reads one line; false when the reading waits here for a call's
// answer. Throws Unreadable for a shape it does not expect.
function readLine(
    line: Json | null,
    index: number,
    type: string | null,
    reading: Reading,
): boolean {
    if (line === null) {
        throw new Unreadable("not a JSON object");
    }
    if (type === null) {
        throw new Unreadable("no type");
    }
    const { read } = reading;
    if (
        typeof line.sessionId === "string" &&
        !read.sessions.includes(line.sessionId)
    ) {
        read.sessions.push(line.sessionId);
    }
    if (!MAPPED.has(type)) {
        if (!BOOKKEEPING.has(type)) {
            read.unknown.push({ line: index, type });
        }
        return true;
    }
    return (
        passedOver(line, type, reading.since) || mapLine(line, type, reading)
    );
}

// Lines outside her conversation: Claude Code's system lines, its
// subagents', meta and compaction lines, and what came before the launch,
// whatever its shape.
function passedOver(line: Json, type: string, since: number | null): boolean {
    if (
        type === "system" ||
        line.isSidechain === true ||
        line.isMeta === true ||
        line.isCompactSummary === true
    ) {
        return true;
    }
    if (since === null || typeof line.timestamp !== "string") {
        return false;
    }
    const stamped = Date.parse(line.timestamp);
    return Number.isFinite(stamped) && stamped < since;
}

// A line's shape is checked before its uuid and time.
function mapLine(line: Json, type: string, reading: Reading): boolean {
    if (type === "attachment") {
        return mapAttachment(line, reading);
    }
    const content = contentOf(
        line,
        type === "user" ? "a user" : "an assistant",
    );
    if (type === "assistant" && typeof content === "string") {
        throw new Unreadable("an assistant line without its content");
    }
    const emit = stampOf(line, reading);
    if (emit === null) {
        return true;
    }
    if (type === "user") {
        const said = userWords(content);
        if (said !== null) {
            emit({ kind: "user", text: said });
        }
        return true;
    }
    return mapAssistant(line, content as Json[], emit, reading);
}

type Emit = (entry: TranscriptEntry) => void;

// How to record the line's events, stamped with its uuid and time; null
// for a line already recorded or from before the launch.
function stampOf(line: Json, { read, recorded, since }: Reading): Emit | null {
    if (typeof line.uuid !== "string") {
        throw new Unreadable("no uuid");
    }
    const uuid = line.uuid;
    const at = timeOf(line);
    if (recorded.has(uuid) || (since !== null && Date.parse(at) < since)) {
        return null;
    }
    return (entry) => read.events.push({ entry, uuid, at });
}

function mapAttachment(line: Json, reading: Reading): boolean {
    if (!isRecord(line.attachment)) {
        throw new Unreadable("an attachment without its object");
    }
    const words = spokenAttachment(line.attachment);
    if (words !== null) {
        stampOf(line, reading)?.({ kind: "user", text: words });
    }
    return true;
}

// What the user said in a user line: its text as spoken, and its images.
function userWords(content: Json[] | string): string | null {
    if (typeof content === "string") {
        return spoken(content);
    }
    const parts = content
        .map(userBlock)
        .filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join("\n\n") : null;
}

function userBlock(block: Json): string | null {
    if (block.type === "text") {
        return typeof block.text === "string" ? spoken(block.text) : null;
    }
    if (block.type === "image") {
        return "[image]";
    }
    if (block.type === "tool_result" && typeof block.tool_use_id !== "string") {
        throw new Unreadable("a tool result without its call's id");
    }
    return null;
}

// Her words and her calls; false when a call's answer has not come and
// the session goes on.
function mapAssistant(
    line: Json,
    content: readonly Json[],
    emit: Emit,
    reading: Reading,
): boolean {
    noteModel(line, reading.read);
    for (const block of content) {
        const entry = assistantBlock(block, reading);
        if (entry === UNANSWERED) {
            return false;
        }
        if (entry !== null) {
            emit(entry);
        }
    }
    return true;
}

// The first model an assistant line names, but Claude Code's own.
function noteModel(line: Json, read: LinesRead): void {
    const model = isRecord(line.message) ? line.message.model : undefined;
    if (
        read.model === null &&
        typeof model === "string" &&
        model !== "<synthetic>"
    ) {
        read.model = model;
    }
}

// A call whose answer has not come, in a session not yet over.
const UNANSWERED = Symbol("unanswered");

function assistantBlock(
    block: Json,
    { results, ended }: Reading,
): TranscriptEntry | null | typeof UNANSWERED {
    if (block.type === "text") {
        if (typeof block.text !== "string") {
            throw new Unreadable("a text block without its text");
        }
        return block.text.trim() === ""
            ? null
            : { kind: "assistant", text: block.text, interrupted: false };
    }
    if (block.type !== "tool_use") {
        return null;
    }
    if (typeof block.id !== "string" || typeof block.name !== "string") {
        throw new Unreadable("a tool call without its id or name");
    }
    const answer = results.get(block.id);
    return answer === undefined && !ended
        ? UNANSWERED
        : callEntry(block.id, block.name, block.input, answer);
}
