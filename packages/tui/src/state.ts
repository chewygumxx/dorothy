// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/state.ts
//
//

import type {
    ConversationEvent,
    Lookup,
    OpenLookup,
    RawMessage,
    RecollectLookup,
    ResumedTurn,
    SearchLookup,
    TagsLookup,
    TurnStats,
} from "@dorothy/core";

export const RAW_LIMIT = 20;
export const WARNING_LIMIT = 3;

export type Line = {
    id: number;
    // lookup: a dim memory line, a lookup or a compaction.
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

const plural = (count: number, noun: string) =>
    `${count} ${noun}${count === 1 ? "" : "s"}`;

// A lookup's or a remember's dim row, and what it adds below.
type DimLine = { text: string; detail?: string };

export function lookupLine(ok: boolean, lookup: Lookup): DimLine {
    switch (lookup.tool) {
        case "search":
            return searchLine(ok, lookup);
        case "tags":
            return tagsLine(ok, lookup);
        case "recollect":
            return recollectLine(ok, lookup);
        default:
            return openLine(ok, lookup);
    }
}

function searchLine(ok: boolean, lookup: SearchLookup): DimLine {
    const query = oneRow(lookup.query);
    const tags = (lookup.tags ?? [])
        .map(oneRow)
        .filter((label) => label !== "");
    const subject = [
        ...(query === "" ? [] : [`"${query}"`]),
        ...(tags.length === 0 ? [] : [`tagged ${tags.join(", ")}`]),
    ].join(" ");
    if (!ok) {
        return { text: `⌕ couldn't search ${subject}` };
    }
    const facts = lookup.facts ?? 0;
    const counts = [
        ...(facts > 0 ? [plural(facts, "fact")] : []),
        ...(lookup.hits > 0 ? [plural(lookup.hits, "conversation")] : []),
    ];
    const found = counts.length === 0 ? "nothing found" : counts.join(", ");
    return { text: `⌕ searched ${subject} · ${found}` };
}

function tagsLine(ok: boolean, lookup: TagsLookup): DimLine {
    if (!ok) {
        return { text: "⌕ couldn't list tags" };
    }
    const under = oneRow(lookup.under ?? "");
    const what = under === "" ? "tags" : `tags under ${under}`;
    const count = lookup.hits === 0 ? "no tags" : plural(lookup.hits, "tag");
    return { text: `⌕ listed ${what} · ${count}` };
}

function recollectLine(ok: boolean, lookup: RecollectLookup): DimLine {
    const cluster = `cluster ${lookup.cluster}`;
    if (!ok) {
        return { text: `⌕ couldn't recollect ${cluster}` };
    }
    return {
        text:
            lookup.turns === null
                ? `⌕ recollected ${cluster}`
                : `⌕ recollected ${cluster}, turns ${lookup.turns[0]}-${lookup.turns[1]}`,
    };
}

function openLine(ok: boolean, lookup: OpenLookup): DimLine {
    const name = oneRow(lookup.name);
    return ok
        ? {
              text: `⌕ opened ${name}`,
              detail: `for: ${oneRow(lookup.purpose)}`,
          }
        : { text: `⌕ couldn't open ${name}` };
}

// A remember call as a dim line: what she kept or retired, or why she
// could not.
export function rememberLine(
    ok: boolean,
    input: unknown,
    output: string,
): DimLine {
    const fields =
        typeof input === "object" && input !== null
            ? (input as Record<string, unknown>)
            : {};
    const name = oneRow(typeof fields.name === "string" ? fields.name : "");
    const retiring = fields.action === "retire";
    if (!ok) {
        const why = oneRow(output);
        return {
            text: `✎ couldn't ${retiring ? "retire" : "remember"} ${name}`,
            ...(why === "" ? {} : { detail: why }),
        };
    }
    let id = name;
    try {
        const parsed: unknown = JSON.parse(output);
        const named = (parsed as { id?: unknown } | null)?.id;
        if (typeof named === "string") {
            id = oneRow(named);
        }
    } catch {
        // The name she gave stands.
    }
    return { text: `✎ ${retiring ? "retired" : "remembered"} ${id}` };
}

// A resumed reply, split where its lookups and remembers happened, as it
// was shown live.
function replyLines(turn: ResumedTurn): Omit<Line, "id">[] {
    const memory = [
        ...(turn.lookups ?? []).map((lookup) => ({
            offset: lookup.offset,
            line: lookupLine(lookup.ok, lookup),
        })),
        ...(turn.remembers ?? []).map((made) => ({
            offset: made.offset,
            line: rememberLine(made.ok, made.input, made.output),
        })),
    ].sort((a, b) => a.offset - b.offset);
    if (memory.length === 0) {
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
    for (const { offset, line } of memory) {
        const at = Math.min(Math.max(offset, from), turn.text.length);
        const segment = turn.text.slice(from, at).trim();
        if (segment !== "") {
            lines.push({ role: "dorothy", text: segment, continued: shown });
            shown = true;
        }
        lines.push({ role: "lookup", ...line });
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

// A dim memory line where a lookup or a remember happened: the live text
// so far moves above it, and the reply goes on below.
function memoryLine(
    state: ChatState,
    line: { text: string; detail?: string },
    offset: number,
): ChatState {
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
        lines: append(lines, { role: "lookup", ...line }),
        live: "",
        split: true,
        continued: state.continued || segment !== "",
        replyOffset: offset,
    };
}

// The lines with the reply a failure cut short marked: its live text, or
// with nothing live, the line a lookup pending at the failure may just
// have flushed.
function interruptedLines(state: ChatState): Line[] {
    if (state.live) {
        return append(state.lines, {
            role: "dorothy",
            text: state.live,
            interrupted: true,
            continued: state.continued,
        });
    }
    const last = state.lines.findLastIndex((line) => line.role === "dorothy");
    if (!state.continued || last === -1) {
        return state.lines;
    }
    return state.lines.map((line, index) =>
        index === last ? { ...line, interrupted: true } : line,
    );
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
        case "compacting":
            return {
                ...state,
                lines: append(state.lines, {
                    role: "lookup",
                    text: "compacting…",
                }),
            };
        // Compaction's warnings tell of failures and a full context, which
        // a compaction that succeeds has ended; but not of compaction being
        // off until the next launch, which one run's success doesn't undo.
        // That warning is worded in src/compaction/session.ts, where a
        // `ready` refusal switches compaction off: keep "until the next
        // launch" in it.
        case "compacted":
            return {
                ...state,
                warnings: state.warnings.filter(
                    (warning) =>
                        !warning.startsWith("compaction") ||
                        warning.includes("until the next launch"),
                ),
                lines: append(state.lines, {
                    role: "lookup",
                    text: `compacted turns ${event.from}-${event.through} into ${plural(event.clusters, "cluster")}`,
                }),
            };
        case "memory-cost":
            return reduce(state, { type: "memory-cost", usd: event.usd });
        case "lookup":
            return memoryLine(
                state,
                lookupLine(event.ok, event.lookup),
                event.offset,
            );
        case "remember":
            return memoryLine(
                state,
                rememberLine(event.ok, event.input, event.output),
                event.offset,
            );
        case "error":
            return {
                ...state,
                lines: append(interruptedLines(state), {
                    role: "error",
                    text: event.message,
                }),
                live: "",
                streaming: false,
                split: false,
                continued: false,
                replyOffset: 0,
                status: "disconnected",
            };
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
