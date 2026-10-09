// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/LiveReply.tsx
//
//

import { Box, Text } from "ink";
import { PLAIN, rowText, wrapSpans } from "./markdown/spans.js";

export const LABEL_WIDTH = 9;

// Plain-text rows for the streaming reply, measured in terminal columns.
export function wrapRows(text: string, width: number): string[] {
    return wrapSpans([{ text, style: PLAIN }], width).map(rowText);
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
