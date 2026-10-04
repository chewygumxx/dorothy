// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/layout.ts
//
//

import { WARNING_LIMIT } from "./state.js";

// The narrowest window the TUI draws in, and the most rows a draft shows.
export const MIN_COLUMNS = 40;
export const INPUT_MAX_ROWS = 5;
// The border above the warnings, the header under the statusline, and the
// raw pane's frame (two borders and its title).
const BORDER_ROWS = 1;
const HEADER_ROWS = 1;
const RAW_FRAME_ROWS = 3;
// One row spare for a row Ink wraps despite the measuring, and one so the
// live region never fills the terminal.
const SPARE_ROWS = 2;
// The fewest rows the reply has in the smallest window.
const MIN_REPLY_ROWS = 3;

export type Layout = { replyRows: number; rawRows: number; inputRows: number };

// The fewest rows that hold every part at its largest at once: three
// warnings, the raw pane with an entry, a full draft and every statusline
// line. Below it the TUI draws nothing but tooSmallMessage.
export const minRows = (statusLines: number): number =>
    BORDER_ROWS +
    WARNING_LIMIT +
    INPUT_MAX_ROWS +
    statusLines +
    HEADER_ROWS +
    SPARE_ROWS +
    RAW_FRAME_ROWS +
    1 +
    MIN_REPLY_ROWS;

export function tooSmallMessage(
    neededRows: number,
    rows: number,
    columns: number,
): string {
    return `Too Small: Dorothy's TUI needs at least ${neededRows} lines and ${MIN_COLUMNS} columns (this window is ${rows} × ${columns})`;
}

// Ink clears the whole terminal, scrollback included, and repaints every line
// on each frame once the live region is as tall as the window, so the
// streaming reply and the raw pane share the rows the rest leaves. At or
// above minRows nothing else needs squeezing.
export function fitLayout(
    rows: number,
    {
        showRaw,
        rawCount,
        warnings,
        statusRows,
        inputRows: wanted,
    }: {
        showRaw: boolean;
        rawCount: number;
        warnings: number;
        statusRows: number;
        inputRows: number;
    },
): Layout {
    const inputRows = Math.max(1, Math.min(wanted, INPUT_MAX_ROWS));
    const rest =
        rows -
        BORDER_ROWS -
        warnings -
        inputRows -
        statusRows -
        HEADER_ROWS -
        SPARE_ROWS -
        (showRaw ? RAW_FRAME_ROWS : 0);
    const rawRows = showRaw
        ? Math.min(rawCount, Math.max(1, Math.floor(rest / 3)))
        : 0;
    return { replyRows: Math.max(1, rest - rawRows), rawRows, inputRows };
}
