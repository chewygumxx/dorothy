// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/transcript.ts
//
//

import { type FileHandle, mkdir, open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Turn } from "./persona.js";

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

type Env = Record<string, string | undefined>;

export function transcriptDir(env: Env = process.env): string {
    // XDG treats an empty XDG_DATA_HOME as unset.
    const data =
        env.XDG_DATA_HOME || join(env.HOME ?? homedir(), ".local", "share");
    return join(data, "dorothy", "transcripts");
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

export async function readTranscript(
    path: string,
): Promise<{ turns: Turn[]; skipped: number }> {
    const text = await readFile(path, "utf8");
    const turns: Turn[] = [];
    let skipped = 0;
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
        const turn = toTurn(event);
        if (turn === "malformed") {
            skipped++;
        } else if (turn !== "ignore") {
            turns.push(turn);
        }
    }
    return { turns, skipped };
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
        await mkdir(dirname(path), { recursive: true });
        return new TranscriptWriter(await open(path, "a"), now);
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
