// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/pi.ts
//
//

// Pure decoding of a Pi v3 session file into archive segments. Shapes are
// re-declared from @earendil-works/pi-coding-agent 1.5.0, never imported:
// dist/core/session-manager.d.ts (SessionHeader, SessionEntry), docs/
// session-format.md, docs/message-types.md and pi-agent-core's
// dist/agent-loop.js (tool results). Callers resolve a fork's parent and
// pass its ancestry; nothing here opens a file. The contract's record
// path scrubs and trims tool text when these events are written.
//
// Invariants, pinned by pi.test.ts:
// - An event id is `e-` and the SHA-256 of origin session, entry id, kind
//   and occurrence, NUL-joined; content and time never choose it. A tool
//   event is its call's: the assistant entry and the call's index there,
//   so a hook's finalized call shares it.
// - A result pairs with the nearest assistant entry on its branch, with
//   the first call of its id no earlier result there answered. The first
//   result in append order emits the evidence, once, in its own segment.
//   A call Pi abandoned (its response aborted or errored, or a later
//   user or assistant entry below it) is recorded failed at the call;
//   any other unanswered call holds its segment after its entry
//   (`pending`) until `ended`, with no halt or torn tail, fails it.
// - A header naming `parentSession` without ancestry is held: `pending`,
//   no segments. A partial last line waits; other faults halt at the last
//   sound boundary, with a code that quotes no contents.
// - Speech keeps its original text through `context_edit`. System,
//   custom, summary and compaction context, thinking and bookkeeping emit
//   nothing; `bashExecution` is a `bash` tool event; images are `[image]`.
//   Unknown entry types are kept once and join the tree; unknown roles
//   and content blocks halt, as they could carry speech.
// - A `dorothy.tool-final` custom entry, which Dorothy's extension writes
//   for a call Pi finalized without persisting its result, answers the
//   first unanswered call of its id in the assistant entry it names, an
//   ancestor on its own branch. It has that call's identity and is used
//   only where no ordinary result anywhere in the file answered the
//   call, so a result, a final and a failure are never all emitted. One
//   that names no such call, or is malformed, is ignored, never a halt.
import type { RecordEvent } from "@dorothy/core";
import {
    digestOf,
    type PiAncestry,
    PiHalt,
    PiTree,
    payloadDigest,
    type TreeNode,
} from "./pi-tree.js";

export type { PiAncestry } from "./pi-tree.js";
export type PiSegment = {
    session: string;
    parent: string | null;
    anchor: string | null;
    events: RecordEvent[];
    pending: boolean;
};
export type PiRead = {
    nativeSession: string | null;
    cwd: string | null;
    segments: PiSegment[];
    ancestry: PiAncestry | null;
    pending: boolean;
    // Zero-based indexes in the supplied lines; codes quote no contents.
    halt: { line: number; code: string } | null;
    unknown: { line: number; type: string }[];
};
export type PiReadOptions = {
    // The parent file's ancestry when the header names a parentSession.
    parent: PiAncestry | null;
    // The native session is over: an unanswered call is recorded failed.
    ended: boolean;
};

type Json = Record<string, unknown>;
// SessionEntry's discriminators; any other type is unknown bookkeeping.
const KNOWN = new Set([
    "message",
    "thinking_level_change",
    "model_change",
    "usage",
    "compaction",
    "branch_summary",
    "custom",
    "custom_message",
    "context_edit",
    "label",
    "session_info",
]);
// System prompts and extension or summary context: never speech.
const CONTEXT_ROLES = new Set([
    "system",
    "custom",
    "branchSummary",
    "compactionSummary",
]);

type CallSpec = { callId: string; name: string; input: string };
type Message =
    | { role: "user"; text: string }
    | {
          role: "assistant";
          text: string;
          interrupted: boolean;
          calls: CallSpec[];
      }
    | { role: "toolResult"; callId: string; output: string; ok: boolean }
    | { role: "bashExecution"; command: string; output: string; ok: boolean }
    | { role: "context" };
type Call = CallSpec & { sourceId: string; at: string };
type Local = {
    node: TreeNode;
    line: number;
    at: string;
    role: Message["role"] | null;
    calls: Call[];
    // The call a tool result answered, for later results on its branch.
    paired: string | null;
    // Pi will never answer this entry's unanswered calls.
    abandoned: boolean;
};
type Placed = { line: number; order: number; event: RecordEvent };
// A result Dorothy's extension saw for calls of one id in one entry.
type Final = {
    node: TreeNode;
    line: number;
    at: string;
    calls: Call[];
    output: string;
    ok: boolean;
};
type State = {
    read: PiRead;
    tree: PiTree;
    locals: Map<string, Local>;
    placed: Map<string, Placed[]>;
    finalized: Set<string>;
    finals: Final[];
    known: Set<string>;
};

export const TOOL_FINAL = "dorothy.tool-final";

const object = (value: unknown): value is Json =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const halt = (code: string): never => {
    throw new PiHalt(code);
};
const text = (value: unknown, code: string) =>
    typeof value === "string" ? value : halt(code);
const nonempty = (value: unknown, code: string) =>
    text(value, code) === "" ? halt(code) : (value as string);
function time(value: unknown): string {
    const parsed = Date.parse(text(value, "entry"));
    return Number.isFinite(parsed)
        ? new Date(parsed).toISOString()
        : halt("entry");
}
export const eventId = (
    origin: string,
    entry: string,
    kind: RecordEvent["kind"],
    occurrence: number,
) => `e-${digestOf([origin, entry, kind, String(occurrence)])}`;

// TextContent and ImageContent; an image is never opened.
function spoken(content: unknown, separator: string): string {
    if (!Array.isArray(content)) return halt("content");
    return content
        .map((block) => {
            if (!object(block)) return halt("content");
            if (block.type === "text") return text(block.text, "content");
            if (block.type === "image") return "[image]";
            return halt("content");
        })
        .join(separator);
}
function assistantMessage(message: Json): Message {
    if (!Array.isArray(message.content)) return halt("content");
    const said: string[] = [];
    const calls: CallSpec[] = [];
    for (const block of message.content) {
        if (!object(block)) return halt("content");
        if (block.type === "text") said.push(text(block.text, "content"));
        else if (block.type === "toolCall") {
            if (!object(block.arguments)) return halt("content");
            calls.push({
                callId: nonempty(block.id, "content"),
                name: nonempty(block.name, "content"),
                input: JSON.stringify(block.arguments),
            });
        } else if (block.type !== "thinking") return halt("content");
    }
    return {
        role: "assistant",
        text: said.join("\n\n"),
        interrupted:
            message.stopReason === "aborted" || message.stopReason === "error",
        calls,
    };
}
function decodeMessage(message: unknown): Message {
    if (!object(message) || typeof message.role !== "string")
        return halt("message");
    switch (message.role) {
        case "user":
            return {
                role: "user",
                text:
                    typeof message.content === "string"
                        ? message.content
                        : spoken(message.content, "\n\n"),
            };
        case "assistant":
            return assistantMessage(message);
        case "toolResult":
            if (typeof message.isError !== "boolean") return halt("message");
            return {
                role: "toolResult",
                callId: nonempty(message.toolCallId, "message"),
                output: spoken(message.content, "\n"),
                ok: !message.isError,
            };
        case "bashExecution":
            return {
                role: "bashExecution",
                command: text(message.command, "message"),
                output: text(message.output, "message"),
                ok: message.cancelled !== true && message.exitCode === 0,
            };
        default:
            return CONTEXT_ROLES.has(message.role)
                ? { role: "context" }
                : halt("role");
    }
}

function openHeader(record: unknown, read: PiRead) {
    if (!object(record) || record.type !== "session" || record.version !== 3)
        return halt("header");
    read.nativeSession = nonempty(record.id, "header");
    read.cwd = nonempty(record.cwd, "header");
    if (!Number.isFinite(Date.parse(text(record.timestamp, "header"))))
        halt("header");
    const forked = record.parentSession !== undefined;
    if (forked) nonempty(record.parentSession, "header");
    return { session: read.nativeSession, forked };
}

// The nearest assistant entry on this branch, and its first call with
// this id that no earlier result on the same branch answered.
function pair(state: State, node: TreeNode, callId: string) {
    const answered = new Set<string>();
    let id = node.parentId;
    while (id !== null) {
        const local = state.locals.get(id);
        // Unknown bookkeeping is in the tree alone; pass over it.
        if (!local) {
            id = state.tree.node(id)?.parentId ?? null;
            continue;
        }
        if (local.role === "user") return undefined;
        if (local.role === "assistant")
            return local.calls.find(
                (call) =>
                    call.callId === callId && !answered.has(call.sourceId),
            );
        if (local.paired !== null) answered.add(local.paired);
        id = local.node.parentId;
    }
    return undefined;
}

// Pi persists nothing between a call and its results (agent-session.js
// defers custom and bash messages while streaming; agent-loop.js appends
// a batch's results before the next turn). A user or assistant entry
// below an assistant entry therefore abandons its unanswered calls.
function moveOn(state: State, node: TreeNode) {
    let id = node.parentId;
    while (id !== null) {
        const local = state.locals.get(id);
        if (local?.role === "user") return;
        if (local?.role === "assistant") {
            local.abandoned = true;
            return;
        }
        id = (local?.node ?? state.tree.node(id))?.parentId ?? null;
    }
}

// The calls a tool-final entry answers: its named entry's calls of its
// id, where that entry is an assistant entry above it on its branch.
function finalOf(state: State, local: Local, data: unknown): Final | null {
    if (
        !object(data) ||
        typeof data.entryId !== "string" ||
        typeof data.toolCallId !== "string" ||
        typeof data.isError !== "boolean"
    )
        return null;
    let output: string;
    try {
        output = spoken(data.content, "\n");
    } catch (error) {
        if (error instanceof PiHalt) return null;
        throw error;
    }
    let id = local.node.parentId;
    while (id !== null && id !== data.entryId)
        id =
            (state.locals.get(id)?.node ?? state.tree.node(id))?.parentId ??
            null;
    const target = id === null ? undefined : state.locals.get(id);
    if (target?.role !== "assistant") return null;
    const calls = target.calls.filter(
        (call) => call.callId === data.toolCallId,
    );
    if (calls.length === 0) return null;
    return { ...local, calls, output, ok: !data.isError };
}

function place(state: State, local: Local, message: Message | null) {
    const { node, line, at } = local;
    state.locals.set(node.id, local);
    const emit = (event: RecordEvent) => {
        if (node.inherited) return;
        const owned = state.placed.get(node.owner) ?? [];
        owned.push({ line, order: 0, event });
        state.placed.set(node.owner, owned);
    };
    const id = (kind: RecordEvent["kind"], occurrence = 0) =>
        eventId(node.origin, node.id, kind, occurrence);
    if (message?.role === "user" || message?.role === "assistant")
        moveOn(state, node);
    switch (message?.role) {
        case "user":
            if (message.text.trim() !== "")
                emit({
                    kind: "user",
                    text: message.text,
                    sourceId: id("user"),
                    at,
                });
            return;
        case "assistant":
            if (message.text.trim() !== "")
                emit({
                    kind: "assistant",
                    text: message.text,
                    interrupted: message.interrupted,
                    sourceId: id("assistant"),
                    at,
                });
            local.calls = message.calls.map((call, occurrence) => ({
                ...call,
                sourceId: id("tool", occurrence),
                at,
            }));
            // agent-loop.js runs no call of an aborted or errored response.
            local.abandoned = message.interrupted;
            return;
        case "bashExecution":
            emit({
                kind: "tool",
                name: "bash",
                input: message.command,
                output: message.output,
                ok: message.ok,
                sourceId: id("tool"),
                at,
            });
            return;
        case "toolResult": {
            const call = pair(state, node, message.callId);
            if (!call) return;
            local.paired = call.sourceId;
            // Evidence is emitted once, at the first result in append order.
            if (state.finalized.has(call.sourceId)) return;
            state.finalized.add(call.sourceId);
            emit({
                kind: "tool",
                name: call.name,
                input: call.input,
                output: message.output,
                ok: message.ok,
                sourceId: call.sourceId,
                at,
            });
            return;
        }
    }
}

function decodeEntry(record: unknown, line: number, state: State) {
    if (!object(record)) return halt("entry");
    const type = nonempty(record.type, "entry");
    if (type === "session") return halt("header");
    if (!KNOWN.has(type)) {
        if (!state.known.has(type)) {
            state.read.unknown.push({ line, type });
            state.known.add(type);
        }
        // Unknown bookkeeping with a sound id still joins the tree.
        const { id, parentId } = record;
        if (
            typeof id === "string" &&
            id !== "" &&
            (parentId === null || typeof parentId === "string")
        )
            state.tree.add(id, parentId, payloadDigest(record), true);
        return;
    }
    const id = nonempty(record.id, "entry");
    const parentId =
        record.parentId === null ? null : nonempty(record.parentId, "entry");
    const at = time(record.timestamp);
    const message = type === "message" ? decodeMessage(record.message) : null;
    const node = state.tree.add(
        id,
        parentId,
        payloadDigest(record),
        type !== "usage",
    );
    if (node === null) return;
    const local: Local = {
        node,
        line,
        at,
        role: message?.role ?? null,
        calls: [],
        paired: null,
        abandoned: false,
    };
    place(state, local, message);
    if (type === "custom" && record.customType === TOOL_FINAL) {
        const final = finalOf(state, local, record.data);
        if (final !== null) state.finals.push(final);
    }
}

// Each tool-final, in append order, answers the first of its calls no
// ordinary result or earlier final did, in its own segment.
function finish(state: State) {
    for (const { node, line, at, calls, output, ok } of state.finals) {
        const call = calls.find((each) => !state.finalized.has(each.sourceId));
        if (!call) continue;
        state.finalized.add(call.sourceId);
        if (node.inherited) continue;
        const owned = state.placed.get(node.owner) ?? [];
        owned.push({
            line,
            order: 0,
            event: {
                kind: "tool",
                name: call.name,
                input: call.input,
                output,
                ok,
                sourceId: call.sourceId,
                at,
            },
        });
        state.placed.set(node.owner, owned);
    }
}

// Unanswered local calls: recorded failed once Pi abandoned them, or the
// session is over and wholly read; else they hold their segment's later
// events. Either way a failed call has its call's id and position.
function settle(state: State, final: boolean): PiSegment[] {
    finish(state);
    const held = new Map<string, number>();
    for (const { node, line, at, calls, abandoned } of state.locals.values()) {
        if (node.inherited) continue;
        for (const [occurrence, call] of calls.entries()) {
            if (state.finalized.has(call.sourceId)) continue;
            if (!final && !abandoned) {
                if (!held.has(node.owner)) held.set(node.owner, line);
                continue;
            }
            const owned = state.placed.get(node.owner) ?? [];
            owned.push({
                line,
                order: 1 + occurrence,
                event: {
                    kind: "tool",
                    name: call.name,
                    input: call.input,
                    output: "",
                    ok: false,
                    sourceId: call.sourceId,
                    at,
                },
            });
            state.placed.set(node.owner, owned);
        }
    }
    return state.tree.segments.map((segment) => {
        const stop = held.get(segment.session);
        const events = (state.placed.get(segment.session) ?? [])
            .filter((placed) => stop === undefined || placed.line <= stop)
            .sort((a, b) => a.line - b.line || a.order - b.order)
            .map((placed) => placed.event);
        return { ...segment, events, pending: stop !== undefined };
    });
}

export function readPi(
    lines: readonly string[],
    { parent, ended }: PiReadOptions,
): PiRead {
    const read: PiRead = {
        nativeSession: null,
        cwd: null,
        segments: [],
        ancestry: null,
        pending: false,
        halt: null,
        unknown: [],
    };
    let last = lines.length - 1;
    while (last >= 0 && lines[last]?.trim() === "") last--;
    let state: State | null = null;
    let torn = false;
    for (const [index, raw] of lines.entries()) {
        if (raw.trim() === "") continue;
        let record: unknown;
        try {
            record = JSON.parse(raw);
        } catch {
            // A partial trailing line waits for the rest of its record.
            if (index === last) torn = true;
            else read.halt = { line: index, code: "json" };
            break;
        }
        try {
            if (state !== null) {
                decodeEntry(record, index, state);
                continue;
            }
            const { session, forked } = openHeader(record, read);
            // A fork waits for its parent's ancestry, never guessing it.
            if (forked && parent === null) {
                read.pending = true;
                return read;
            }
            state = {
                read,
                tree: new PiTree(session, parent),
                locals: new Map(),
                placed: new Map(),
                finalized: new Set(),
                finals: [],
                known: new Set(),
            };
        } catch (error) {
            if (!(error instanceof PiHalt)) throw error;
            read.halt = { line: index, code: error.code };
            break;
        }
    }
    if (state !== null) {
        read.segments = settle(state, ended && read.halt === null && !torn);
        read.ancestry = state.tree.ancestry();
    }
    read.pending = torn || read.segments.some((segment) => segment.pending);
    return read;
}
