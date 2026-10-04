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
import { type Env, xdgDir } from "./xdg.js";

export type SessionEvent = {
    v: 1;
    kind: "session";
    at: string;
    phrase: string;
    sdkSessionId: string;
    model: string;
    promptSha256: string;
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
export type TranscriptEvent =
    | SessionEvent
    | UserEvent
    | AssistantEvent
    | StatsEvent;

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

function toTurn(event: unknown): Turn | "ignore" | "malformed" {
    if (typeof event !== "object" || event === null) {
        return "malformed";
    }
    const { kind, text } = event as { kind?: unknown; text?: unknown };
    if ((kind === "user" || kind === "assistant") && typeof text === "string") {
        return { role: kind, text };
    }
    return kind === "session" || kind === "stats" ? "ignore" : "malformed";
}

// A turn read back from a transcript: a reply keeps the stats recorded after
// it and what the chat had cost by then.
export type ResumedTurn = Turn & { stats?: TurnStats; chatCostUsd?: number };

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

export async function readTranscript(
    path: string,
): Promise<{ turns: ResumedTurn[]; skipped: number; costUsd: number }> {
    const text = await readFile(path, "utf8");
    const turns: ResumedTurn[] = [];
    // The reply a stats line would belong to.
    let reply: ResumedTurn | null = null;
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
        const turn = toTurn(event);
        if (turn === "malformed") {
            skipped++;
        } else if (turn !== "ignore") {
            turns.push(turn);
            reply = turn.role === "assistant" ? turn : null;
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

    async close(): Promise<void> {
        await this.#pending;
        await this.#handle.close();
    }
}
