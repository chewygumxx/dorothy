// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/layout.ts
//
//

// Rows of the status bar besides the input (border, header) and of the raw
// pane's frame (two borders and its title).
const STATUS_ROWS = 2;
const RAW_FRAME_ROWS = 3;
// One row spare for a header or key hint that wraps, and one so the live
// region never fills the terminal.
const SPARE_ROWS = 2;

export type Layout = { replyRows: number; rawRows: number; inputRows: number };

// Ink clears the whole terminal, scrollback included, and repaints every line
// on each frame once the live region is as tall as the window, so the
// streaming reply, the raw pane and the input share whatever rows are left.
// The input asks for its draft's rows and gets at most a third of the
// terminal (3 at least), less when the window is too short for that.
export function fitLayout(
    rows: number,
    {
        showRaw,
        rawCount,
        warnings,
        inputRows: wanted,
    }: {
        showRaw: boolean;
        rawCount: number;
        warnings: number;
        inputRows: number;
    },
): Layout {
    const fixed = STATUS_ROWS + warnings + SPARE_ROWS;
    // The reply and the raw pane each keep at least one row.
    const room = rows - fixed - 1 - (showRaw ? RAW_FRAME_ROWS + 1 : 0);
    const inputRows = Math.max(
        1,
        Math.min(wanted, Math.max(3, Math.floor(rows / 3)), room),
    );
    const rest = rows - fixed - inputRows;
    const rawRows = showRaw
        ? Math.min(rawCount, Math.max(1, Math.floor(rest / 3)))
        : 0;
    const used = fixed + inputRows + rawRows + (showRaw ? RAW_FRAME_ROWS : 0);
    return { replyRows: Math.max(1, rows - used), rawRows, inputRows };
}
