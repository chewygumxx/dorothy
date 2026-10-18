// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/transcript.ts
//
//

import { type FileHandle, mkdir, open, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
    type Env,
    type RecallEvent,
    type ResumedTurn,
    type Turn,
    type TurnStats,
    xdgDir,
} from "@dorothy/core";
import { scrub } from "./scrub.js";

// The body a session ran in: chat, or a host as its profile names it.
export type Source = string;
const SOURCE = /^[a-z][a-z0-9-]{0,39}$/;
export type SessionEvent = {
    v: 1;
    kind: "session";
    at: string;
    phrase: string;
    sdkSessionId: string;
    model: string;
    promptHash: string;
    resumed: boolean;
    source?: Source;
    // The body's own session id, so a resumed session continues its
    // conversation.
    sourceSession?: string;
    // The host session this one resumed or forked from, keyed as
    // sourceSession is.
    parentSession?: string;
    // The project the session ran in; none for chat.
    project?: string;
};
// A body's tool call, its text scrubbed of secrets and trimmed. memory
// marks a call to Dorothy's own memory tools, so that no review learns as
// new what memory supplied.
export type ToolEvent = {
    v: 1;
    kind: "tool";
    at: string;
    name: string;
    input: string;
    output: string;
    ok: boolean;
    cut: { input: number; output: number };
    memory?: true;
};
export type UserEvent = { v: 1; kind: "user"; at: string; text: string };
export type AssistantEvent = {
    v: 1;
    kind: "assistant";
    at: string;
    text: string;
    interrupted: boolean;
};
export type StatsEvent = {
    v: 1;
    kind: "stats";
    at: string;
    inputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    ttftMs: number | null;
    durationMs: number;
    costUsd: number;
    sessionCostUsd: number;
};
// The moment a new session took over from a compacted one: through is the
// last turn compacted, clusters how many clusters this compaction added.
export type CompactionEvent = {
    v: 1;
    kind: "compaction";
    at: string;
    through: number;
    clusters: number;
};
export type TranscriptEvent =
    | SessionEvent
    | UserEvent
    | AssistantEvent
    | StatsEvent
    | CompactionEvent
    | ToolEvent
    | RecallEvent;

// An event as callers write it; the writer stamps `v` and `at`.
type Unstamped<E> = E extends unknown ? Omit<E, "v" | "at"> : never;
export type TranscriptEntry = Unstamped<TranscriptEvent>;

export const sourceOf = (event: { source?: unknown }): Source =>
    typeof event.source === "string" && SOURCE.test(event.source)
        ? event.source
        : "chat";

// Each side of a tool call keeps this many characters, counted in code
// points.
export const TOOL_TEXT_LIMIT = 2000;

function trimmed(text: string): { text: string; cut: number } {
    const points = [...text];
    return points.length <= TOOL_TEXT_LIMIT
        ? { text, cut: 0 }
        : {
              text: points.slice(0, TOOL_TEXT_LIMIT).join(""),
              cut: points.length - TOOL_TEXT_LIMIT,
          };
}

// A tool call as a transcript entry: scrubbed first, so a secret is never
// half kept by the trim.
export function toolEntry({
    name,
    input,
    output,
    ok,
    memory = false,
}: {
    name: string;
    input: string;
    output: string;
    ok: boolean;
    memory?: boolean;
}): Extract<TranscriptEntry, { kind: "tool" }> {
    const inside = trimmed(scrub(input));
    const outside = trimmed(scrub(output));
    return {
        kind: "tool",
        name,
        input: inside.text,
        output: outside.text,
        ok,
        cut: { input: inside.cut, output: outside.cut },
        ...(memory ? { memory: true as const } : {}),
    };
}

export function transcriptDir(env: Env = process.env): string {
    return join(
        xdgDir(env, "XDG_DATA_HOME", ".local/share"),
        "dorothy",
        "transcripts",
    );
}

export function transcriptPath(phrase: string, env: Env = process.env): string {
    return join(transcriptDir(env), `${phrase}.jsonl`);
}

export function toTurn(event: unknown): Turn | "ignore" | "malformed" {
    if (typeof event !== "object" || event === null) {
        return "malformed";
    }
    const { kind, text } = event as { kind?: unknown; text?: unknown };
    if ((kind === "user" || kind === "assistant") && typeof text === "string") {
        return { role: kind, text };
    }
    return kind === "session" ||
        kind === "stats" ||
        kind === "compaction" ||
        kind === "tool"
        ? "ignore"
        : "malformed";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const isTurnRange = (value: unknown): value is [number, number] =>
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((turn) => Number.isInteger(turn) && turn >= 1);
const isStringList = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string");

// A recall event as written, or null for one that cannot be read.
export function toRecall(event: unknown): RecallEvent | null {
    if (!isRecord(event) || event.kind !== "recall") {
        return null;
    }
    const { at, id, ok, offset } = event;
    if (
        typeof at !== "string" ||
        typeof id !== "string" ||
        typeof ok !== "boolean" ||
        typeof offset !== "number" ||
        !Number.isInteger(offset) ||
        offset < 0
    ) {
        return null;
    }
    const base: RecallBase = { v: 1, kind: "recall", at, id, ok, offset };
    switch (event.tool) {
        case "search":
            return searchRecall(event, base);
        case "open":
            return openRecall(event, base);
        case "recollect":
            return recollectRecall(event, base);
        case "tags":
            return tagsRecall(event, base);
        default:
            return null;
    }
}

type RecallBase = {
    v: 1;
    kind: "recall";
    at: string;
    id: string;
    ok: boolean;
    offset: number;
};
type Written = Record<string, unknown>;

function searchRecall(event: Written, base: RecallBase): RecallEvent | null {
    if (
        typeof event.query !== "string" ||
        typeof event.hits !== "number" ||
        !Number.isInteger(event.hits)
    ) {
        return null;
    }
    return {
        ...base,
        tool: "search",
        query: event.query,
        hits: event.hits,
        ...(typeof event.after === "string" ? { after: event.after } : {}),
        ...(typeof event.before === "string" ? { before: event.before } : {}),
        ...(isStringList(event.tags) ? { tags: event.tags } : {}),
        ...(event.searched === "conversations" || event.searched === "facts"
            ? { searched: event.searched }
            : {}),
        ...(Number.isInteger(event.facts)
            ? { facts: event.facts as number }
            : {}),
    };
}

function openRecall(event: Written, base: RecallBase): RecallEvent | null {
    if (
        typeof event.name !== "string" ||
        typeof event.purpose !== "string" ||
        !(event.turns === null || isTurnRange(event.turns))
    ) {
        return null;
    }
    const open = {
        ...base,
        tool: "open" as const,
        name: event.name,
        purpose: event.purpose,
        turns: event.turns,
    };
    if (typeof event.conversation === "string") {
        return { ...open, conversation: event.conversation };
    }
    return typeof event.fact === "string"
        ? { ...open, fact: event.fact }
        : null;
}

function recollectRecall(event: Written, base: RecallBase): RecallEvent | null {
    const { cluster, words, turns } = event;
    if (
        typeof cluster !== "number" ||
        !Number.isInteger(cluster) ||
        cluster < 0 ||
        !(words === undefined || typeof words === "string") ||
        !(turns === null || isTurnRange(turns))
    ) {
        return null;
    }
    return {
        ...base,
        tool: "recollect",
        cluster,
        ...(typeof words === "string" ? { words } : {}),
        turns,
    };
}

function tagsRecall(event: Written, base: RecallBase): RecallEvent | null {
    const { hits, under } = event;
    if (
        typeof hits !== "number" ||
        !Number.isInteger(hits) ||
        !(under === undefined || typeof under === "string")
    ) {
        return null;
    }
    return {
        ...base,
        tool: "tags",
        hits,
        ...(typeof under === "string" ? { under } : {}),
    };
}

const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

// Transcripts from before cache use was recorded have no cache counts.
function toStats(event: Record<string, unknown>): TurnStats | null {
    const stats = {
        inputTokens: event.inputTokens,
        cacheReadTokens: event.cacheReadTokens ?? 0,
        cacheWriteTokens: event.cacheWriteTokens ?? 0,
        outputTokens: event.outputTokens,
        ttftMs: event.ttftMs,
        durationMs: event.durationMs,
        costUsd: event.costUsd,
        sessionCostUsd: event.sessionCostUsd,
    };
    const { ttftMs, ...counts } = stats;
    return Object.values(counts).every(finite) &&
        (ttftMs === null || finite(ttftMs))
        ? (stats as TurnStats)
        : null;
}

export type TranscriptRead = {
    turns: ResumedTurn[];
    skipped: number;
    costUsd: number;
    // The Claude Code session that last joined a Claude Code
    // conversation; null for a chat.
    claudeSession: string | null;
};

export async function readTranscript(path: string): Promise<TranscriptRead> {
    return parseTranscript(await readFile(path, "utf8"));
}

// The memory catalogue counts turns from text it has already read.
export function parseTranscript(text: string): TranscriptRead {
    const parsing: Parsing = {
        read: { turns: [], skipped: 0, costUsd: 0, claudeSession: null },
        reply: null,
        lookups: [],
    };
    for (const line of text.split("\n")) {
        if (line.trim() === "") {
            continue;
        }
        let event: unknown;
        try {
            event = JSON.parse(line);
        } catch {
            parsing.read.skipped++;
            continue;
        }
        takeEvent(event, parsing);
    }
    return parsing.read;
}

function takeEvent(event: unknown, parsing: Parsing): void {
    const kind = isRecord(event) ? event.kind : undefined;
    if (kind === "stats") {
        takeStats(event as Written, parsing);
    } else if (kind === "recall") {
        takeRecall(event, parsing);
    } else {
        if (kind === "session") {
            takeSession(event as Written, parsing);
        }
        takeTurn(event, parsing);
    }
}

// The Claude Code session that last joined a Claude Code conversation.
function takeSession(event: Written, parsing: Parsing): void {
    if (sourceOf(event) === "claude-code") {
        const session = event.sourceSession;
        parsing.read.claudeSession = typeof session === "string" ? session : "";
    }
}

// What reading a transcript has read so far, the reply a stats line
// would belong to, and the lookups awaiting the reply after them.
type Parsing = {
    read: TranscriptRead;
    reply: ResumedTurn | null;
    lookups: RecallEvent[];
};

function takeStats(fields: Written, parsing: Parsing): void {
    const { read, reply } = parsing;
    if (finite(fields.costUsd)) {
        read.costUsd += fields.costUsd;
    }
    const stats = toStats(fields);
    if (reply !== null && stats !== null) {
        reply.stats = stats;
        reply.chatCostUsd = read.costUsd;
    }
    parsing.reply = null;
}

function takeRecall(event: unknown, parsing: Parsing): void {
    const recall = toRecall(event);
    if (recall === null) {
        parsing.read.skipped++;
    } else {
        parsing.lookups.push(recall);
    }
}

// Lookups belong to the reply after them; a user message means the reply
// they began never came.
function takeTurn(event: unknown, parsing: Parsing): void {
    const turn = toTurn(event);
    if (turn === "malformed") {
        parsing.read.skipped++;
        return;
    }
    if (turn === "ignore") {
        return;
    }
    const resumed: ResumedTurn = turn;
    if (turn.role === "assistant" && parsing.lookups.length > 0) {
        resumed.lookups = parsing.lookups;
    }
    parsing.lookups = [];
    parsing.read.turns.push(resumed);
    parsing.reply = turn.role === "assistant" ? resumed : null;
}

// Chats are private: new transcripts are the user's alone.
const openAppend = (path: string) => open(path, "a", 0o600);

// An event's own time, where it is not the moment it is written, and
// the uuid of the Claude Code line it was recorded from, by which the
// next reading knows where to take up.
export type Stamp = { at?: string; sourceUuid?: string };

export class TranscriptWriter {
    readonly #path: string;
    #handle: FileHandle;
    readonly #now: () => Date;
    #pending: Promise<void> = Promise.resolve();

    private constructor(path: string, handle: FileHandle, now: () => Date) {
        this.#path = path;
        this.#handle = handle;
        this.#now = now;
    }

    static async open(
        path: string,
        now: () => Date = () => new Date(),
    ): Promise<TranscriptWriter> {
        // New directories are the user's alone too.
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        return new TranscriptWriter(path, await openAppend(path), now);
    }

    // Appends are chained so un-awaited calls still land in call order, and a
    // failed write does not block the ones after it.
    append(entry: TranscriptEntry, stamp: Stamp = {}): Promise<void> {
        const { kind, ...fields } = entry;
        const event = {
            v: 1,
            kind,
            at: stamp.at ?? this.#now().toISOString(),
            ...fields,
            ...(stamp.sourceUuid === undefined
                ? {}
                : { sourceUuid: stamp.sourceUuid }),
        };
        const line = `${JSON.stringify(event)}\n`;
        const write = this.#pending.then(async () => {
            await this.#follow();
            await this.#handle.appendFile(line, "utf8");
        });
        this.#pending = write.catch(() => {});
        return write;
    }

    // A file put in the transcript's place (history restoring it) or
    // removed would take every later append with the old one: the path is
    // reopened when it no longer names the file held open.
    async #follow(): Promise<void> {
        const held = await this.#handle.stat();
        let current: { dev: number; ino: number } | null = null;
        try {
            current = await stat(this.#path);
        } catch {
            // Gone: reopening makes it again.
        }
        if (current?.ino === held.ino && current.dev === held.dev) {
            return;
        }
        const replaced = this.#handle;
        this.#handle = await openAppend(this.#path);
        await replaced.close();
    }

    // Resolves once every append queued so far has landed or failed, so a
    // reader of the file sees them.
    async flushed(): Promise<void> {
        await this.#pending;
    }

    async close(): Promise<void> {
        await this.#pending;
        await this.#handle.close();
    }
}
