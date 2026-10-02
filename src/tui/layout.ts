// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/layout.ts
//
//

// Rows of the status bar (border, header, input) and of the raw pane's frame
// (two borders and its title).
const STATUS_ROWS = 3;
const RAW_FRAME_ROWS = 3;
// One row spare for a header or key hint that wraps, and one so the live
// region never fills the terminal.
const SPARE_ROWS = 2;

export type Layout = { replyRows: number; rawRows: number };

// Ink clears the whole terminal, scrollback included, and repaints every line
// on each frame once the live region is as tall as the window, so the
// streaming reply and the raw pane share whatever rows are left.
export function fitLayout(
    rows: number,
    {
        showRaw,
        rawCount,
        warning,
    }: { showRaw: boolean; rawCount: number; warning: boolean },
): Layout {
    const fixed = STATUS_ROWS + (warning ? 1 : 0) + SPARE_ROWS;
    const rawRows = showRaw
        ? Math.min(rawCount, Math.max(1, Math.floor((rows - fixed) / 3)))
        : 0;
    const used = fixed + rawRows + (showRaw ? RAW_FRAME_ROWS : 0);
    return { replyRows: Math.max(1, rows - used), rawRows };
}
