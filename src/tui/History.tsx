// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/History.tsx
//
//

import { Box, Static, Text, useWindowSize } from "ink";
import type { LineConfig } from "../config.js";
import { LABEL_WIDTH } from "./LiveReply.js";
import { RowsView } from "./Markdown.js";
import { renderMarkdown } from "./markdown/render.js";
import {
    PLAIN,
    type Row,
    rowWidth,
    type Span,
    wrapSpans,
} from "./markdown/spans.js";
import type { Line } from "./state.js";
import { moduleRows } from "./statusline.js";

const LABELS: Record<Line["role"], { text: string; color: string }> = {
    you: { text: "you", color: "cyan" },
    dorothy: { text: "dorothy", color: "magenta" },
    error: { text: "error", color: "red" },
};

const RED = { color: "red" };
const DIM = { dim: true };
const INTERRUPTED: Span = { text: " [interrupted]", style: DIM };

function rowsOf(line: Line, width: number): Row[] {
    const rows =
        line.role === "dorothy"
            ? renderMarkdown(line.text, width)
            : wrapSpans(
                  [
                      {
                          text: line.text,
                          style: line.role === "error" ? RED : PLAIN,
                      },
                  ],
                  width,
              );
    if (line.interrupted) {
        const last = rows.at(-1);
        if (last && rowWidth(last) + rowWidth([INTERRUPTED]) <= width) {
            last.push(INTERRUPTED);
        } else {
            rows.push([{ text: INTERRUPTED.text.trim(), style: DIM }]);
        }
    }
    return rows;
}

export function LineView({
    line,
    replyStats,
}: {
    line: Line;
    replyStats: LineConfig;
}) {
    const label = LABELS[line.role];
    const { columns } = useWindowSize();
    const rows = rowsOf(line, columns - LABEL_WIDTH);
    return (
        <Box flexDirection="column">
            <Box>
                <Box width={LABEL_WIDTH} flexShrink={0}>
                    <Text color={label.color} bold>
                        {label.text}
                    </Text>
                </Box>
                <RowsView rows={rows} />
            </Box>
            {line.stats ? (
                <Box marginLeft={LABEL_WIDTH} flexDirection="column">
                    {moduleRows(
                        replyStats,
                        line.stats,
                        line.chatCostUsd ?? line.stats.sessionCostUsd,
                        columns - LABEL_WIDTH,
                    ).map((row, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
                        <Text key={index} dimColor>
                            {row}
                        </Text>
                    ))}
                </Box>
            ) : null}
        </Box>
    );
}

// <Static> prints each line once into the terminal's own scrollback, so
// finished turns are never redrawn. Ink positions it absolutely, which frees
// it from the terminal's width unless it is given one.
const FULL_WIDTH = { width: "100%" };

export function History({
    lines,
    replyStats,
}: {
    lines: Line[];
    replyStats: LineConfig;
}) {
    return (
        <Static items={lines} style={FULL_WIDTH}>
            {(line) => (
                <LineView key={line.id} line={line} replyStats={replyStats} />
            )}
        </Static>
    );
}
