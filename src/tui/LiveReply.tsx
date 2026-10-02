// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/LiveReply.tsx
//
//

import { Box, Text } from "ink";
import type { TurnStats } from "../conversation.js";

export const LABEL_WIDTH = 9;

export function formatStats(stats: TurnStats): string {
    const parts = [`${stats.inputTokens} in`, `${stats.outputTokens} out`];
    if (stats.ttftMs !== null) {
        parts.push(`ttft ${(stats.ttftMs / 1000).toFixed(1)}s`);
    }
    parts.push(
        `${(stats.durationMs / 1000).toFixed(1)}s`,
        `$${stats.costUsd.toFixed(4)} (session $${stats.sessionCostUsd.toFixed(4)})`,
    );
    return parts.join(" · ");
}

// Greedy word wrap by code point, breaking words longer than the width.
export function wrapRows(text: string, width: number): string[] {
    const limit = Math.max(1, width);
    const rows: string[] = [];
    for (const paragraph of text.split("\n")) {
        let row: string[] = [];
        for (const char of Array.from(paragraph)) {
            row.push(char);
            if (row.length > limit) {
                const space = row.lastIndexOf(" ", limit);
                const cut = space > 0 ? space : limit;
                rows.push(row.slice(0, cut).join(""));
                row = row.slice(space > 0 ? cut + 1 : cut);
            }
        }
        rows.push(row.join(""));
    }
    return rows;
}

// Only the last rows that fit are drawn while streaming, so the live region
// stays shorter than the terminal; the finished reply goes to History whole.
export function LiveReply({
    text,
    streaming,
    width,
    maxRows,
}: {
    text: string;
    streaming: boolean;
    width: number;
    maxRows: number;
}) {
    if (!streaming) {
        return null;
    }
    const rows = wrapRows(`${text}▍`, width - LABEL_WIDTH).slice(-maxRows);
    return (
        <Box>
            <Box width={LABEL_WIDTH} flexShrink={0}>
                <Text color="magenta" bold>
                    dorothy
                </Text>
            </Box>
            <Box flexDirection="column">
                {rows.map((row, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
                    <Text key={index} wrap="truncate">
                        {row}
                    </Text>
                ))}
            </Box>
        </Box>
    );
}
