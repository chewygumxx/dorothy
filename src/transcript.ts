// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/transcript.ts
//
//

import { type FileHandle, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TurnStats } from "./conversation.js";
import type { Turn } from "./persona.js";
import type { Lookup } from "./recall/types.js";
import { type Env, xdgDir } from "./xdg.js";

export type SessionEvent = {
    v: 1;
    kind: "session";
    at: string;
    phrase: string;
    sdkSessionId: string;
    model: string;
    promptHash: string;
    resumed: boolean;
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
// A lookup Dorothy made mid-reply. offset is where in the reply's text it
// happened, in UTF-16 code units, so a resumed chat can place it.
type RecallBase = {
    v: 1;
    kind: "recall";
    at: string;
    id: string;
    ok: boolean;
    offset: number;
};
export type RecallEvent = RecallBase & Lookup;
export type TranscriptEvent =
    | SessionEvent
    | UserEvent
    | AssistantEvent
    | StatsEvent
    | CompactionEvent
    | RecallEvent;

// An event as callers write it; the writer stamps `v` and `at`.
type Unstamped<E> = E extends unknown ? Omit<E, "v" | "at"> : never;
export type TranscriptEntry = Unstamped<TranscriptEvent>;

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
    return kind === "session" || kind === "stats" || kind === "compaction"
        ? "ignore"
        : "malformed";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const isTurnRange = (value: unknown): value is [number, number] =>
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((turn) => Number.isInteger(turn) && turn >= 1);

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
    const base = { v: 1, kind: "recall", at, id, ok, offset } as const;
    if (
        event.tool === "search" &&
        typeof event.query === "string" &&
        typeof event.hits === "number" &&
        Number.isInteger(event.hits)
    ) {
        return {
            ...base,
            tool: "search",
            query: event.query,
            hits: event.hits,
            ...(typeof event.after === "string" ? { after: event.after } : {}),
            ...(typeof event.before === "string"
                ? { before: event.before }
                : {}),
        };
    }
    if (
        event.tool === "open" &&
        typeof event.conversation === "string" &&
        typeof event.name === "string" &&
        typeof event.purpose === "string" &&
        (event.turns === null || isTurnRange(event.turns))
    ) {
        return {
            ...base,
            tool: "open",
            conversation: event.conversation,
            name: event.name,
            purpose: event.purpose,
            turns: event.turns,
        };
    }
    return null;
}

// A turn read back from a transcript: a reply keeps the stats recorded after
// it, what the chat had cost by then, and the lookups made while writing it.
export type ResumedTurn = Turn & {
    stats?: TurnStats;
    chatCostUsd?: number;
    lookups?: RecallEvent[];
};

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
};

export async function readTranscript(path: string): Promise<TranscriptRead> {
    return parseTranscript(await readFile(path, "utf8"));
}

// The memory catalogue counts turns from text it has already read.
export function parseTranscript(text: string): TranscriptRead {
    const turns: ResumedTurn[] = [];
    // The reply a stats line would belong to.
    let reply: ResumedTurn | null = null;
    let lookups: RecallEvent[] = [];
    let skipped = 0;
    let costUsd = 0;
    for (const line of text.split("\n")) {
        if (line.trim() === "") {
            continue;
        }
        let event: unknown;
        try {
            event = JSON.parse(line);
        } catch {
            skipped++;
            continue;
        }
        if ((event as { kind?: unknown } | null)?.kind === "stats") {
            const fields = event as Record<string, unknown>;
            const cost = fields.costUsd;
            if (finite(cost)) {
                costUsd += cost;
            }
            const stats = toStats(fields);
            if (reply !== null && stats !== null) {
                reply.stats = stats;
                reply.chatCostUsd = costUsd;
            }
            reply = null;
            continue;
        }
        if ((event as { kind?: unknown } | null)?.kind === "recall") {
            const recall = toRecall(event);
            if (recall === null) {
                skipped++;
            } else {
                lookups.push(recall);
            }
            continue;
        }
        const turn = toTurn(event);
        if (turn === "malformed") {
            skipped++;
        } else if (turn !== "ignore") {
            // Lookups belong to the reply after them; a user message means
            // the reply they began never came.
            const resumed: ResumedTurn = turn;
            if (turn.role === "assistant" && lookups.length > 0) {
                resumed.lookups = lookups;
            }
            lookups = [];
            turns.push(resumed);
            reply = turn.role === "assistant" ? resumed : null;
        }
    }
    return { turns, skipped, costUsd };
}

export class TranscriptWriter {
    readonly #handle: FileHandle;
    readonly #now: () => Date;
    #pending: Promise<void> = Promise.resolve();

    private constructor(handle: FileHandle, now: () => Date) {
        this.#handle = handle;
        this.#now = now;
    }

    static async open(
        path: string,
        now: () => Date = () => new Date(),
    ): Promise<TranscriptWriter> {
        // Chats are private: new directories and transcripts are the user's
        // alone.
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        return new TranscriptWriter(await open(path, "a", 0o600), now);
    }

    // Appends are chained so un-awaited calls still land in call order, and a
    // failed write does not block the ones after it.
    append(entry: TranscriptEntry): Promise<void> {
        const { kind, ...fields } = entry;
        const event = { v: 1, kind, at: this.#now().toISOString(), ...fields };
        const line = `${JSON.stringify(event)}\n`;
        const write = this.#pending.then(() =>
            this.#handle.appendFile(line, "utf8"),
        );
        this.#pending = write.catch(() => {});
        return write;
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
