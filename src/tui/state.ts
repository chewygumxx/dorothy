// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/state.ts
//
//

import type {
    ConversationEvent,
    RawMessage,
    TurnStats,
} from "../conversation.js";
import type { Turn } from "../persona.js";

export const RAW_LIMIT = 20;
export const WARNING_LIMIT = 3;

export type Line = {
    id: number;
    role: "you" | "dorothy" | "error";
    text: string;
    stats?: TurnStats;
    // What the whole chat has cost by the end of this reply, across
    // reconnects and resumes; a session's own total starts again with it.
    chatCostUsd?: number;
    interrupted?: boolean;
};
export type Status = "starting" | "ready" | "disconnected" | "closing";
export type RawEntry = { id: number; message: RawMessage };

export type ChatState = {
    lines: Line[];
    live: string;
    streaming: boolean;
    status: Status;
    model: string | null;
    sdkSessionId: string | null;
    raw: RawEntry[];
    rawCount: number;
    showRaw: boolean;
    warnings: string[];
    costUsd: number;
};

export type Action =
    | { type: "event"; event: ConversationEvent }
    | { type: "sent"; text: string }
    | { type: "toggle-raw" }
    | { type: "reconnecting" }
    | { type: "closing" }
    | { type: "warning"; message: string };

export function initialState(
    history: readonly Turn[],
    warnings: readonly string[] = [],
    costUsd = 0,
): ChatState {
    return {
        lines: history.map((turn, id) => ({
            id,
            role: turn.role === "user" ? "you" : "dorothy",
            text: turn.text,
        })),
        live: "",
        streaming: false,
        status: "starting",
        model: null,
        sdkSessionId: null,
        raw: [],
        rawCount: 0,
        showRaw: false,
        warnings: [...new Set(warnings)].slice(-WARNING_LIMIT),
        costUsd,
    };
}

// Lines are append-only and their ids are their indices, which keeps Ink's
// <Static> keys stable.
function append(lines: Line[], line: Omit<Line, "id">): Line[] {
    return [...lines, { id: lines.length, ...line }];
}

function reduceEvent(state: ChatState, event: ConversationEvent): ChatState {
    switch (event.type) {
        case "ready":
            return {
                ...state,
                status: "ready",
                model: event.model,
                sdkSessionId: event.sdkSessionId,
            };
        case "delta":
            return { ...state, live: state.live + event.text };
        case "turn-end": {
            const costUsd = state.costUsd + event.stats.costUsd;
            return {
                ...state,
                lines: append(state.lines, {
                    role: "dorothy",
                    text: event.reply,
                    stats: event.stats,
                    chatCostUsd: costUsd,
                    interrupted: event.interrupted,
                }),
                costUsd,
                live: "",
                streaming: false,
            };
        }
        case "sdk":
            return {
                ...state,
                raw: [
                    ...state.raw,
                    { id: state.rawCount, message: event.message },
                ].slice(-RAW_LIMIT),
                rawCount: state.rawCount + 1,
            };
        case "error": {
            const lines = state.live
                ? append(state.lines, {
                      role: "dorothy",
                      text: state.live,
                      interrupted: true,
                  })
                : state.lines;
            return {
                ...state,
                lines: append(lines, { role: "error", text: event.message }),
                live: "",
                streaming: false,
                status: "disconnected",
            };
        }
    }
}

export function reduce(state: ChatState, action: Action): ChatState {
    switch (action.type) {
        case "sent":
            return {
                ...state,
                lines: append(state.lines, { role: "you", text: action.text }),
                live: "",
                streaming: true,
            };
        case "toggle-raw":
            return { ...state, showRaw: !state.showRaw };
        case "reconnecting":
            return {
                ...state,
                status: "starting",
                model: null,
                sdkSessionId: null,
            };
        case "closing":
            return { ...state, status: "closing" };
        // A repeated warning shows once; the oldest give way to new ones.
        case "warning":
            return state.warnings.includes(action.message)
                ? state
                : {
                      ...state,
                      warnings: [...state.warnings, action.message].slice(
                          -WARNING_LIMIT,
                      ),
                  };
        case "event":
            return reduceEvent(state, action.event);
    }
}
