// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/History.tsx
//
//

import { Box, Static, Text } from "ink";
import { formatStats, LABEL_WIDTH } from "./LiveReply.js";
import type { Line } from "./state.js";

const LABELS: Record<Line["role"], { text: string; color: string }> = {
    you: { text: "you", color: "cyan" },
    dorothy: { text: "dorothy", color: "magenta" },
    error: { text: "error", color: "red" },
};

export function LineView({ line }: { line: Line }) {
    const label = LABELS[line.role];
    return (
        <Box flexDirection="column">
            <Box>
                <Box width={LABEL_WIDTH} flexShrink={0}>
                    <Text color={label.color} bold>
                        {label.text}
                    </Text>
                </Box>
                <Text color={line.role === "error" ? "red" : undefined}>
                    {line.text}
                    {line.interrupted ? " [interrupted]" : ""}
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
// finished turns are never redrawn.
export function History({ lines }: { lines: Line[] }) {
    return (
        <Static items={lines}>
            {(line) => <LineView key={line.id} line={line} />}
        </Static>
    );
}
