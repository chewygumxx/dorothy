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
import type { Lookup } from "../recall/types.js";
import type { ResumedTurn } from "../transcript.js";

export const RAW_LIMIT = 20;
export const WARNING_LIMIT = 3;

export type Line = {
    id: number;
    role: "you" | "dorothy" | "lookup" | "error";
    text: string;
    // A lookup's second line: what Dorothy opened a conversation for.
    detail?: string;
    // A later part of a reply whose earlier part was already shown under the
    // label; it has none of its own.
    continued?: boolean;
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
    // What this run's memory reviews have cost.
    memoryCostUsd: number;
    // The latest finished turn's, for the statusline.
    lastStats: TurnStats | null;
    // Where in the live reply the latest lookup happened, and whether the
    // reply has been split around one.
    replyOffset: number;
    split: boolean;
    // Whether the live reply has shown a labelled dorothy line yet.
    continued: boolean;
};

export type Action =
    | { type: "event"; event: ConversationEvent }
    | { type: "sent"; text: string }
    | { type: "toggle-raw" }
    | { type: "reconnecting" }
    | { type: "closing" }
    | { type: "warning"; message: string }
    | { type: "memory-cost"; usd: number };

// What the model chose to search for or open may hold newlines and control
// characters; neither may break the lookup's single dim row.
const oneRow = (text: string) =>
    text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu, " ").trim();

export function lookupLine(
    ok: boolean,
    lookup: Lookup,
): { text: string; detail?: string } {
    if (lookup.tool === "search") {
        const query = `"${oneRow(lookup.query)}"`;
        if (!ok) {
            return { text: `⌕ couldn't search ${query}` };
        }
        const found =
            lookup.hits === 0
                ? "nothing found"
                : lookup.hits === 1
                  ? "1 conversation"
                  : `${lookup.hits} conversations`;
        return { text: `⌕ searched ${query} · ${found}` };
    }
    const name = oneRow(lookup.name);
    return ok
        ? {
              text: `⌕ opened ${name}`,
              detail: `for: ${oneRow(lookup.purpose)}`,
          }
        : { text: `⌕ couldn't open ${name}` };
}

// A resumed reply, split where its lookups happened, as it was shown live.
function replyLines(turn: ResumedTurn): Omit<Line, "id">[] {
    const lookups = [...(turn.lookups ?? [])].sort(
        (a, b) => a.offset - b.offset,
    );
    if (lookups.length === 0) {
        return [
            {
                role: "dorothy",
                text: turn.text,
                stats: turn.stats,
                chatCostUsd: turn.chatCostUsd,
            },
        ];
    }
    const lines: Omit<Line, "id">[] = [];
    let from = 0;
    // Whether a dorothy line, which carries the label, is already out.
    let shown = false;
    for (const lookup of lookups) {
        const at = Math.min(Math.max(lookup.offset, from), turn.text.length);
        const segment = turn.text.slice(from, at).trim();
        if (segment !== "") {
            lines.push({ role: "dorothy", text: segment, continued: shown });
            shown = true;
        }
        lines.push({ role: "lookup", ...lookupLine(lookup.ok, lookup) });
        from = at;
    }
    lines.push({
        role: "dorothy",
        text: turn.text.slice(from).trim(),
        stats: turn.stats,
        chatCostUsd: turn.chatCostUsd,
        continued: shown,
    });
    return lines;
}

export function initialState(
    history: readonly ResumedTurn[],
    warnings: readonly string[] = [],
    costUsd = 0,
): ChatState {
    return {
        lines: history
            .flatMap((turn): Omit<Line, "id">[] =>
                turn.role === "user"
                    ? [{ role: "you", text: turn.text }]
                    : replyLines(turn),
            )
            .map((line, id) => ({ id, ...line })),
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
        memoryCostUsd: 0,
        lastStats:
            history.findLast((turn) => turn.stats !== undefined)?.stats ?? null,
        replyOffset: 0,
        split: false,
        continued: false,
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
            const text = state.split
                ? event.reply.slice(state.replyOffset).trim()
                : event.reply;
            return {
                ...state,
                lines: append(state.lines, {
                    role: "dorothy",
                    text,
                    stats: event.stats,
                    chatCostUsd: costUsd,
                    interrupted: event.interrupted,
                    continued: state.continued,
                }),
                costUsd,
                lastStats: event.stats,
                live: "",
                streaming: false,
                split: false,
                continued: false,
                replyOffset: 0,
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
        case "warning":
            return reduce(state, { type: "warning", message: event.message });
        case "lookup": {
            const segment = state.live.trim();
            const lines =
                segment === ""
                    ? state.lines
                    : append(state.lines, {
                          role: "dorothy",
                          text: segment,
                          continued: state.continued,
                      });
            return {
                ...state,
                lines: append(lines, {
                    role: "lookup",
                    ...lookupLine(event.ok, event.lookup),
                }),
                live: "",
                split: true,
                continued: state.continued || segment !== "",
                replyOffset: event.offset,
            };
        }
        case "error": {
            const lines = state.live
                ? append(state.lines, {
                      role: "dorothy",
                      text: state.live,
                      interrupted: true,
                      continued: state.continued,
                  })
                : state.lines;
            return {
                ...state,
                lines: append(lines, { role: "error", text: event.message }),
                live: "",
                streaming: false,
                split: false,
                continued: false,
                replyOffset: 0,
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
                split: false,
                continued: false,
                replyOffset: 0,
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
        case "memory-cost":
            return {
                ...state,
                memoryCostUsd: state.memoryCostUsd + action.usd,
            };
        case "event":
            return reduceEvent(state, action.event);
    }
}
