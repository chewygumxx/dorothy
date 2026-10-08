// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/record.fixture.ts
//
//

// A chat as a series of steps and the transcript entries App recorded
// for it, so that the move of recording from App to memory is checked
// against the same file.

import type { ConversationEvent, TurnStats } from "@dorothy/core";
import type { TranscriptEntry } from "../transcript.js";

export const PHRASE = "tumble-orchid-vapor-lantern";
export const HASH = "abc";

const STATS: TurnStats = {
    inputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 2,
    ttftMs: 10,
    durationMs: 20,
    costUsd: 0.01,
    sessionCostUsd: 0.01,
};

// send: the user sends text (after an error, this reconnects first).
// emit: a session emits an event, the latest unless one is named.
export type Step =
    | { send: string }
    | { emit: ConversationEvent; session?: number };

export const SCRIPT: Step[] = [
    { emit: { type: "ready", model: "m", sdkSessionId: "sdk-1" } },
    { send: "hello" },
    {
        emit: {
            type: "lookup",
            id: "toolu_1",
            ok: true,
            offset: 4,
            lookup: { tool: "search", query: "render", hits: 2 },
        },
    },
    {
        emit: {
            type: "turn-end",
            reply: "Hi there",
            interrupted: false,
            stats: STATS,
        },
    },
    { send: "again" },
    { emit: { type: "error", message: "boom", partial: "Par" } },
    { send: "third" },
    { emit: { type: "ready", model: "m", sdkSessionId: "sdk-2" } },
    // The first session, closed by the reconnect, is heard no more.
    {
        emit: {
            type: "turn-end",
            reply: "Stale",
            interrupted: false,
            stats: STATS,
        },
        session: 0,
    },
    {
        emit: {
            type: "turn-end",
            reply: "Done",
            interrupted: false,
            stats: STATS,
        },
    },
];

export const EXPECTED: TranscriptEntry[] = [
    {
        kind: "session",
        phrase: PHRASE,
        sdkSessionId: "sdk-1",
        model: "m",
        promptHash: HASH,
        resumed: false,
    },
    { kind: "user", text: "hello" },
    {
        kind: "recall",
        id: "toolu_1",
        ok: true,
        offset: 4,
        tool: "search",
        query: "render",
        hits: 2,
    },
    { kind: "assistant", text: "Hi there", interrupted: false },
    { kind: "stats", ...STATS },
    { kind: "user", text: "again" },
    { kind: "assistant", text: "Par", interrupted: true },
    { kind: "user", text: "third" },
    {
        kind: "session",
        phrase: PHRASE,
        sdkSessionId: "sdk-2",
        model: "m",
        promptHash: HASH,
        resumed: true,
    },
    { kind: "assistant", text: "Done", interrupted: false },
    { kind: "stats", ...STATS },
];
