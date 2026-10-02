// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/History.tsx
//
//

import { Box, Static, Text, useWindowSize } from "ink";
import { formatStats, LABEL_WIDTH, wrapRows } from "./LiveReply.js";
import type { Line } from "./state.js";

const LABELS: Record<Line["role"], { text: string; color: string }> = {
    you: { text: "you", color: "cyan" },
    dorothy: { text: "dorothy", color: "magenta" },
    error: { text: "error", color: "red" },
};

export function LineView({ line }: { line: Line }) {
    const label = LABELS[line.role];
    const { columns } = useWindowSize();
    // Wrapped here rather than by Ink, which starts a row with the space it
    // broke at; Ink still wraps any row that wide characters push over.
    const text = wrapRows(
        `${line.text}${line.interrupted ? " [interrupted]" : ""}`,
        columns - LABEL_WIDTH,
    ).join("\n");
    return (
        <Box flexDirection="column">
            <Box>
                <Box width={LABEL_WIDTH} flexShrink={0}>
                    <Text color={label.color} bold>
                        {label.text}
                    </Text>
                </Box>
                <Text color={line.role === "error" ? "red" : undefined}>
                    {text}
                </Text>
            </Box>
            {line.stats ? (
                <Box marginLeft={LABEL_WIDTH}>
                    <Text dimColor>{formatStats(line.stats)}</Text>
                </Box>
            ) : null}
        </Box>
    );
}

// <Static> prints each line once into the terminal's own scrollback, so
// finished turns are never redrawn. Ink positions it absolutely, which frees
// it from the terminal's width unless it is given one.
const FULL_WIDTH = { width: "100%" };

export function History({ lines }: { lines: Line[] }) {
    return (
        <Static items={lines} style={FULL_WIDTH}>
            {(line) => <LineView key={line.id} line={line} />}
        </Static>
    );
}
