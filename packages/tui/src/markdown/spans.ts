// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/markdown/spans.ts
//
//

import stringWidth from "string-width";

export type Style = {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    dim?: boolean;
    color?: string;
};
export type Span = { text: string; style: Style };
export type Row = Span[];

export const PLAIN: Style = {};

const segmenter = new Intl.Segmenter();

export function graphemes(text: string): string[] {
    return Array.from(segmenter.segment(text), (part) => part.segment);
}

export const rowText = (row: Row): string =>
    row.map((span) => span.text).join("");

export const rowWidth = (row: Row): number =>
    row.reduce((sum, span) => sum + stringWidth(span.text), 0);

type Cell = { text: string; width: number; style: Style };

// Control characters would reach the terminal as commands, so they are
// dropped; a tab, which string-width measures as nothing, becomes spaces.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const CONTROL = /^[\u0000-\u0008\u000B-\u001F\u007F]+$/;

function cellLines(spans: Span[]): Cell[][] {
    const lines: Cell[][] = [];
    let line: Cell[] = [];
    lines.push(line);
    for (const span of spans) {
        for (const text of graphemes(span.text)) {
            if (text === "\n" || text === "\r\n") {
                line = [];
                lines.push(line);
            } else if (text === "\t") {
                for (let i = 0; i < 4; i++) {
                    line.push({ text: " ", width: 1, style: span.style });
                }
            } else if (!CONTROL.test(text)) {
                line.push({
                    text,
                    width: stringWidth(text),
                    style: span.style,
                });
            }
        }
    }
    return lines;
}

// Adjacent cells that share a style object become one span.
function toRow(cells: Cell[]): Row {
    const row: Row = [];
    for (const cell of cells) {
        const last = row.at(-1);
        if (last && last.style === cell.style) {
            last.text += cell.text;
        } else {
            row.push({ text: cell.text, style: cell.style });
        }
    }
    return row;
}

const cellsWidth = (cells: Cell[]) =>
    cells.reduce((sum, cell) => sum + cell.width, 0);

function wrapLine(cells: Cell[], limit: number): Row[] {
    const rows: Row[] = [];
    let row: Cell[] = [];
    let used = 0;
    for (const cell of cells) {
        if (used + cell.width <= limit) {
            row.push(cell);
            used += cell.width;
            continue;
        }
        if (cell.text === " ") {
            rows.push(toRow(row));
            row = [];
            used = 0;
            continue;
        }
        const space = row.findLastIndex((each) => each.text === " ");
        if (space > 0) {
            rows.push(toRow(row.slice(0, space)));
            row = row.slice(space + 1);
        } else if (row.length > 0) {
            rows.push(toRow(row));
            row = [];
        }
        row.push(cell);
        used = cellsWidth(row);
    }
    rows.push(toRow(row));
    return rows;
}

// Greedy word wrap over styled spans, measured in terminal columns. A row
// breaks at its last space, which is dropped (Ink would start the next row
// with it), or inside a word wider than the width.
export function wrapSpans(spans: Span[], width: number): Row[] {
    const limit = Math.max(1, width);
    return cellLines(spans).flatMap((cells) => wrapLine(cells, limit));
}

// Breaks one line by grapheme, keeping every character: for code, where
// spaces matter. Rows after the first get `rest` columns.
export function breakSpans(spans: Span[], first: number, rest: number): Row[] {
    const rows: Row[] = [];
    let row: Cell[] = [];
    let used = 0;
    for (const cell of cellLines(spans).flat()) {
        const limit = Math.max(1, rows.length === 0 ? first : rest);
        if (used + cell.width > limit && row.length > 0) {
            rows.push(toRow(row));
            row = [];
            used = 0;
        }
        row.push(cell);
        used += cell.width;
    }
    rows.push(toRow(row));
    return rows;
}

export function splitLines(spans: Span[]): Span[][] {
    const lines: Span[][] = [];
    let line: Span[] = [];
    lines.push(line);
    for (const span of spans) {
        span.text.split("\n").forEach((part, index) => {
            if (index > 0) {
                line = [];
                lines.push(line);
            }
            if (part !== "") {
                line.push({ text: part, style: span.style });
            }
        });
    }
    return lines;
}
