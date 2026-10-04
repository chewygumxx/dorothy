// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/editor.ts
//
//

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
