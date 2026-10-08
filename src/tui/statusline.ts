// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/statusline.ts
//
//

import type { LineConfig, ModuleName, TurnStats } from "@dorothy/core";
import stringWidth from "string-width";

export const SEPARATOR = " · ";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const dollars = (usd: number) => `$${usd.toFixed(4)}`;

// A module's text, or null when it has nothing to say: no turn yet, or
// cache use or a first token there was none of.
export function renderModule(
    name: ModuleName,
    stats: TurnStats | null,
    chatCostUsd: number,
    memoryCostUsd = 0,
): string | null {
    if (name === "chat-cost") {
        return `chat ${dollars(chatCostUsd)}`;
    }
    // Nothing until a review has cost something, so memory switched off
    // takes no room.
    if (name === "memory-cost") {
        return memoryCostUsd > 0 ? `memory ${dollars(memoryCostUsd)}` : null;
    }
    if (stats === null) {
        return null;
    }
    switch (name) {
        case "in":
            return `${stats.inputTokens} in`;
        case "cache-read":
            return stats.cacheReadTokens > 0
                ? `${stats.cacheReadTokens} cache read`
                : null;
        case "cache-write":
            return stats.cacheWriteTokens > 0
                ? `${stats.cacheWriteTokens} cache write`
                : null;
        case "out":
            return `${stats.outputTokens} out`;
        case "ttft":
            return stats.ttftMs === null
                ? null
                : `ttft ${seconds(stats.ttftMs)}`;
        case "duration":
            return seconds(stats.durationMs);
        case "cost":
            return dollars(stats.costUsd);
    }
}

// Pieces fill rows left to right and never split. The first that fits
// neither the current row nor a new one ends the line, so a later, shorter
// piece never shows without one ranked before it.
export function fitModules(
    pieces: string[],
    width: number,
    maxLines: number,
): string[] {
    const rows: string[] = [];
    for (const piece of pieces) {
        const last = rows.at(-1);
        const joined =
            last === undefined ? null : `${last}${SEPARATOR}${piece}`;
        if (joined !== null && stringWidth(joined) <= width) {
            rows[rows.length - 1] = joined;
        } else if (rows.length < maxLines && stringWidth(piece) <= width) {
            rows.push(piece);
        } else {
            break;
        }
    }
    return rows;
}

export function moduleRows(
    line: LineConfig,
    stats: TurnStats | null,
    chatCostUsd: number,
    width: number,
    memoryCostUsd = 0,
): string[] {
    const pieces = line.modules
        .map((name) => renderModule(name, stats, chatCostUsd, memoryCostUsd))
        .filter((piece): piece is string => piece !== null);
    return fitModules(pieces, width, line.maxLines);
}
