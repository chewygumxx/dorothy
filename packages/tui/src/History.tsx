// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/History.tsx
//
//

import type { LineConfig } from "@dorothy/core";
import { Box, Static, Text, useWindowSize } from "ink";
import stringWidth from "string-width";
import { LABEL_WIDTH } from "./LiveReply.js";
import { RowsView } from "./Markdown.js";
import { renderMarkdown } from "./markdown/render.js";
import {
    graphemes,
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
    lookup: { text: "", color: "gray" },
    error: { text: "error", color: "red" },
};

const RED = { color: "red" };
const DIM = { dim: true };
const INTERRUPTED: Span = { text: " [interrupted]", style: DIM };

// Cut with an ellipsis to fit width cells, whole characters only.
export function cutToWidth(text: string, width: number): string {
    if (stringWidth(text) <= width) {
        return text;
    }
    let kept = "";
    for (const grapheme of graphemes(text)) {
        if (stringWidth(`${kept}${grapheme}…`) > width) {
            break;
        }
        kept += grapheme;
    }
    return `${kept}…`;
}

function rowsOf(line: Line, width: number): Row[] {
    if (line.role === "lookup") {
        return [line.text, ...(line.detail ? [`  ${line.detail}`] : [])].map(
            (text) => [{ text: cutToWidth(text, width), style: DIM }],
        );
    }
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
    const label =
        line.role === "lookup" || line.continued ? null : LABELS[line.role];
    const { columns } = useWindowSize();
    const rows = rowsOf(line, columns - LABEL_WIDTH);
    return (
        <Box flexDirection="column">
            {rows.length > 0 ? (
                <Box>
                    <Box width={LABEL_WIDTH} flexShrink={0}>
                        {label ? (
                            <Text color={label.color} bold>
                                {label.text}
                            </Text>
                        ) : null}
                    </Box>
                    <RowsView rows={rows} />
                </Box>
            ) : null}
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
