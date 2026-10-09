// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/editor.ts
//
//

import stringWidth from "string-width";
import { graphemes, PLAIN, rowText, wrapSpans } from "./markdown/spans.js";

// A draft is its text and a cursor, a UTF-16 offset that always sits on a
// grapheme boundary. Every edit is a pure function of a draft.
export type Draft = { text: string; cursor: number };
export type Kill = { draft: Draft; killed: string };

export const EMPTY_DRAFT: Draft = { text: "", cursor: 0 };

const segmenter = new Intl.Segmenter();

function boundaries(text: string): number[] {
    const offsets = Array.from(segmenter.segment(text), (part) => part.index);
    offsets.push(text.length);
    return offsets;
}

function previousBoundary(text: string, offset: number): number {
    let previous = 0;
    for (const boundary of boundaries(text)) {
        if (boundary >= offset) {
            break;
        }
        previous = boundary;
    }
    return previous;
}

const nextBoundary = (text: string, offset: number): number =>
    boundaries(text).find((boundary) => boundary > offset) ?? text.length;

const isSpace = (char: string | undefined) =>
    char !== undefined && /\s/.test(char);

export function insert(draft: Draft, text: string): Draft {
    return {
        text:
            draft.text.slice(0, draft.cursor) +
            text +
            draft.text.slice(draft.cursor),
        cursor: draft.cursor + text.length,
    };
}

function cut(draft: Draft, from: number, to: number): Kill {
    return {
        draft: {
            text: draft.text.slice(0, from) + draft.text.slice(to),
            cursor: from,
        },
        killed: draft.text.slice(from, to),
    };
}

export const backspace = (draft: Draft): Draft =>
    cut(draft, previousBoundary(draft.text, draft.cursor), draft.cursor).draft;

export const deleteForward = (draft: Draft): Draft =>
    cut(draft, draft.cursor, nextBoundary(draft.text, draft.cursor)).draft;

export const left = (draft: Draft): Draft => ({
    ...draft,
    cursor: previousBoundary(draft.text, draft.cursor),
});

export const right = (draft: Draft): Draft => ({
    ...draft,
    cursor: nextBoundary(draft.text, draft.cursor),
});

export function wordLeft(draft: Draft): Draft {
    let cursor = draft.cursor;
    while (cursor > 0 && isSpace(draft.text[cursor - 1])) {
        cursor--;
    }
    while (cursor > 0 && !isSpace(draft.text[cursor - 1])) {
        cursor--;
    }
    return { ...draft, cursor };
}

export function wordRight(draft: Draft): Draft {
    let cursor = draft.cursor;
    while (cursor < draft.text.length && isSpace(draft.text[cursor])) {
        cursor++;
    }
    while (cursor < draft.text.length && !isSpace(draft.text[cursor])) {
        cursor++;
    }
    return { ...draft, cursor };
}

export const lineStart = (draft: Draft): Draft => ({
    ...draft,
    cursor: draft.text.lastIndexOf("\n", draft.cursor - 1) + 1,
});

export function lineEnd(draft: Draft): Draft {
    const newline = draft.text.indexOf("\n", draft.cursor);
    return { ...draft, cursor: newline === -1 ? draft.text.length : newline };
}

// At the end of a line with nothing after it, the newline itself goes.
export function killLineEnd(draft: Draft): Kill {
    const end = lineEnd(draft).cursor;
    return cut(
        draft,
        draft.cursor,
        end === draft.cursor && end < draft.text.length ? end + 1 : end,
    );
}

export const killLineStart = (draft: Draft): Kill =>
    cut(draft, lineStart(draft).cursor, draft.cursor);

export const killWordBack = (draft: Draft): Kill =>
    cut(draft, wordLeft(draft).cursor, draft.cursor);

export type DraftRow = { text: string; start: number };
export type DraftLayout = {
    rows: DraftRow[];
    cursorRow: number;
    cursorColumn: number;
};

// Wraps each logical line as the transcript is wrapped (wrapSpans drops the
// one space it breaks at), keeping each row's offset into the draft. A cursor
// on a dropped space shows at the end of the row before it.
export function layoutDraft(draft: Draft, width: number): DraftLayout {
    const rows: DraftRow[] = [];
    let cursorRow = 0;
    let cursorColumn = 0;
    let lineOffset = 0;
    for (const line of draft.text.split("\n")) {
        const wrapped = wrapSpans([{ text: line, style: PLAIN }], width).map(
            rowText,
        );
        let start = 0;
        wrapped.forEach((text, index) => {
            const end = start + text.length;
            const next =
                index === wrapped.length - 1
                    ? line.length + 1
                    : end + (line[end] === " " ? 1 : 0);
            const cursor = draft.cursor - lineOffset;
            if (cursor >= start && cursor < next) {
                cursorRow = rows.length;
                cursorColumn = stringWidth(
                    text.slice(0, Math.min(cursor - start, text.length)),
                );
            }
            rows.push({ text, start: lineOffset + start });
            start = next;
        });
        lineOffset += line.length + 1;
    }
    return { rows, cursorRow, cursorColumn };
}

// The offset of the grapheme at a display column, or the row's end.
export function offsetAt(row: DraftRow, column: number): number {
    let used = 0;
    let offset = 0;
    for (const grapheme of graphemes(row.text)) {
        const width = stringWidth(grapheme);
        if (used + width > column) {
            break;
        }
        used += width;
        offset += grapheme.length;
    }
    return row.start + offset;
}

function vertical(
    draft: Draft,
    width: number,
    step: number,
    column: number | undefined,
): Draft | null {
    const layout = layoutDraft(draft, width);
    const row = layout.rows[layout.cursorRow + step];
    if (!row) {
        return null;
    }
    const cursor = offsetAt(row, column ?? layout.cursorColumn);
    // Where a row breaks without a space, its end is the next row's start;
    // stop on its last grapheme instead, or the cursor would not leave the
    // row it is on (or would skip the one it meant to reach).
    const next = layout.rows[layout.cursorRow + step + 1];
    return {
        ...draft,
        cursor:
            next?.start === cursor && cursor > row.start
                ? previousBoundary(draft.text, cursor)
                : cursor,
    };
}

export const up = (draft: Draft, width: number, column?: number) =>
    vertical(draft, width, -1, column);

export const down = (draft: Draft, width: number, column?: number) =>
    vertical(draft, width, 1, column);

// A draft taller than the window shows the rows ending at the cursor's.
export function draftWindow(
    layout: DraftLayout,
    maxRows: number,
): { first: number; last: number } {
    const count = Math.min(layout.rows.length, maxRows);
    const first = Math.min(
        Math.max(0, layout.cursorRow - count + 1),
        layout.rows.length - count,
    );
    return { first, last: first + count };
}
