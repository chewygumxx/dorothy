// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/LiveReply.tsx
//
//

import { Box, Text } from "ink";
import stringWidth from "string-width";
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

const graphemes = new Intl.Segmenter();
// Newlines are split on first; anything else would move the terminal's
// cursor in ways no width counts.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

type Cell = { text: string; width: number };
const widthOf = (cells: Cell[]) =>
    cells.reduce((sum, cell) => sum + cell.width, 0);
const join = (cells: Cell[]) => cells.map((cell) => cell.text).join("");

// Greedy word wrap by grapheme and display width (a CJK character or emoji
// takes two columns), breaking words wider than the width.
export function wrapRows(text: string, width: number): string[] {
    const limit = Math.max(1, width);
    const rows: string[] = [];
    const clean = text.replace(/\t/g, "    ").replace(CONTROLS, "");
    for (const paragraph of clean.split("\n")) {
        let row: Cell[] = [];
        for (const { segment } of graphemes.segment(paragraph)) {
            row.push({ text: segment, width: stringWidth(segment) });
            while (row.length > 1 && widthOf(row) > limit) {
                // The last space after which the row still fits, else the
                // most graphemes that fit, at least one.
                let fit = 0;
                let space = -1;
                for (let used = 0; fit < row.length; fit++) {
                    const cell = row[fit] as Cell;
                    if (cell.text === " " && fit > 0) {
                        space = fit;
                    }
                    if (used + cell.width > limit) {
                        break;
                    }
                    used += cell.width;
                }
                const cut = space > 0 ? space : Math.max(1, fit);
                rows.push(join(row.slice(0, cut)));
                row = row.slice(space > 0 ? cut + 1 : cut);
            }
        }
        rows.push(join(row));
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
