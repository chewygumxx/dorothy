// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/markdown/render.ts
//
//

import { type MarkedToken, marked, type Token, type Tokens } from "marked";
import stringWidth from "string-width";
import { highlight } from "./highlight.js";
import {
    breakSpans,
    PLAIN,
    type Row,
    rowWidth,
    type Span,
    type Style,
    splitLines,
    wrapSpans,
} from "./spans.js";

const DIM: Style = { dim: true };
const GUTTER: Span = { text: "┃ ", style: DIM };
const QUOTE: Span = { text: "│ ", style: DIM };
const CONTINUED: Span = { text: "↪ ", style: DIM };

const ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
};

// marked leaves text as written, so only entities the model typed need
// decoding; unknown names and invalid code points stay as they are.
export function decodeEntities(text: string): string {
    return text.replace(
        /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g,
        (match, name: string) => {
            if (!name.startsWith("#")) {
                return ENTITIES[name] ?? match;
            }
            const code =
                name[1] === "x" || name[1] === "X"
                    ? Number.parseInt(name.slice(2), 16)
                    : Number(name.slice(1));
            return code <= 0x10ffff ? String.fromCodePoint(code) : match;
        },
    );
}

function inline(tokens: Token[] | undefined, style: Style): Span[] {
    return (tokens ?? []).flatMap((token) =>
        inlineToken(token as MarkedToken, style),
    );
}

function inlineToken(token: MarkedToken, style: Style): Span[] {
    switch (token.type) {
        case "text":
            return token.tokens
                ? inline(token.tokens, style)
                : [
                      {
                          text: decodeEntities(token.text).replace(/\n/g, " "),
                          style,
                      },
                  ];
        case "strong":
            return inline(token.tokens, { ...style, bold: true });
        case "em":
            return inline(token.tokens, { ...style, italic: true });
        case "del":
            return inline(token.tokens, { ...style, strikethrough: true });
        case "codespan":
            return [{ text: token.text, style: { ...style, color: "cyan" } }];
        case "br":
            return [{ text: "\n", style }];
        case "escape":
            return [{ text: token.text, style }];
        case "link": {
            const text = inline(token.tokens, { ...style, underline: true });
            return token.text === token.href
                ? text
                : [
                      ...text,
                      {
                          text: ` (${token.href})`,
                          style: { ...style, dim: true },
                      },
                  ];
        }
        case "image":
            return [
                { text: `[image: ${token.text}]`, style },
                { text: ` (${token.href})`, style: { ...style, dim: true } },
            ];
        case "html":
            return [{ text: token.text, style }];
        case "checkbox":
            return [];
        default:
            return [{ text: decodeEntities(token.raw), style }];
    }
}

export function withGutter(rows: Row[], first: Span, rest: Span): Row[] {
    return rows.map((row, index) => [index === 0 ? first : rest, ...row]);
}

function codeBlock(
    code: string,
    lang: string | undefined,
    width: number,
): Row[] {
    const source = code.replace(/\t/g, "    ");
    const spans = highlight(source, lang) ?? [{ text: source, style: PLAIN }];
    const rows: Row[] = lang
        ? wrapSpans([{ text: lang, style: DIM }], width)
        : [];
    for (const line of splitLines(spans)) {
        breakSpans(line, width - 2, width - 4).forEach((row, index) => {
            rows.push(
                index === 0 ? [GUTTER, ...row] : [GUTTER, CONTINUED, ...row],
            );
        });
    }
    return rows;
}

// Each item hangs its text under its first word; a nested list starts there.
function list(token: Tokens.List, width: number): Row[] {
    const start = token.start === "" ? 1 : token.start;
    const numbers = token.items.map((_, index) => `${start + index}.`);
    const numberWidth = Math.max(...numbers.map((number) => number.length));
    const rows: Row[] = [];
    token.items.forEach((item, index) => {
        const bullet = token.ordered
            ? (numbers[index] ?? "").padStart(numberWidth)
            : "•";
        const box = item.checked ? "☑" : "☐";
        // A task's box replaces its bullet, as on GitHub; a number stays.
        const marker = !item.task
            ? `${bullet} `
            : token.ordered
              ? `${bullet} ${box} `
              : `${box} `;
        const indent = stringWidth(marker);
        const body = blocks(item.tokens, width - indent, item.loose);
        if (item.loose && index > 0) {
            rows.push([]);
        }
        rows.push(
            ...withGutter(
                body.length > 0 ? body : [[]],
                { text: marker, style: PLAIN },
                { text: " ".repeat(indent), style: PLAIN },
            ),
        );
    });
    return rows;
}

const MIN_COLUMN = 3;
const BORDER: Style = DIM;

// Water-filling: a column no wider than an equal share of the room left
// keeps its natural width, and the wider ones split the rest evenly, so a
// long column wraps before a short one breaks mid-word. Each share is at
// least room / columns, so no column drops below 3.
export function fitColumns(natural: number[], room: number): number[] | null {
    const total = natural.reduce((sum, width) => sum + width, 0);
    if (total <= room) {
        return natural;
    }
    if (MIN_COLUMN * natural.length > room) {
        return null;
    }
    const widths = [...natural];
    let open = natural.map((_, column) => column);
    let left = room;
    for (;;) {
        const share = left / open.length;
        const kept = open.filter((column) => (natural[column] ?? 0) <= share);
        if (kept.length === 0) {
            break;
        }
        for (const column of kept) {
            left -= natural[column] ?? 0;
        }
        open = open.filter((column) => !kept.includes(column));
    }
    // The widest columns take any columns left over.
    open.sort((a, b) => (natural[b] ?? 0) - (natural[a] ?? 0));
    const each = Math.floor(left / open.length);
    open.forEach((column, rank) => {
        widths[column] = each + (rank < left - each * open.length ? 1 : 0);
    });
    return widths;
}

const naturalWidth = (spans: Span[]) =>
    Math.max(0, ...wrapSpans(spans, Number.MAX_SAFE_INTEGER).map(rowWidth));

type Align = Tokens.Table["align"][number];

function pad(row: Row, width: number, align: Align): Row {
    const space = Math.max(0, width - rowWidth(row));
    const before =
        align === "right"
            ? space
            : align === "center"
              ? Math.floor(space / 2)
              : 0;
    return [
        { text: " ".repeat(before), style: PLAIN },
        ...row,
        { text: " ".repeat(space - before), style: PLAIN },
    ];
}

function tableRow(cells: Span[][], widths: number[], align: Align[]): Row[] {
    const wrapped = widths.map((width, column) =>
        wrapSpans(cells[column] ?? [], width),
    );
    const height = Math.max(...wrapped.map((rows) => rows.length));
    const rows: Row[] = [];
    for (let line = 0; line < height; line++) {
        const row: Row = [{ text: "│ ", style: BORDER }];
        widths.forEach((width, column) => {
            if (column > 0) {
                row.push({ text: " │ ", style: BORDER });
            }
            row.push(
                ...pad(
                    wrapped[column]?.[line] ?? [],
                    width,
                    align[column] ?? null,
                ),
            );
        });
        row.push({ text: " │", style: BORDER });
        rows.push(row);
    }
    return rows;
}

function plainTable(header: Span[][], body: Span[][][], width: number): Row[] {
    const separator: Span = { text: " │ ", style: BORDER };
    return [header, ...body].flatMap((cells) =>
        wrapSpans(
            cells.flatMap((spans, column) =>
                column === 0 ? spans : [separator, ...spans],
            ),
            width,
        ),
    );
}

// Borders and a space either side of each cell take 3 * columns + 1.
function table(token: Tokens.Table, width: number): Row[] {
    const header = token.header.map((cell) =>
        inline(cell.tokens, { bold: true }),
    );
    const body = token.rows.map((row) =>
        row.map((cell) => inline(cell.tokens, PLAIN)),
    );
    const natural = header.map((_, column) =>
        Math.max(
            1,
            ...[header, ...body].map((cells) =>
                naturalWidth(cells[column] ?? []),
            ),
        ),
    );
    const widths = fitColumns(natural, width - (3 * natural.length + 1));
    if (!widths) {
        return plainTable(header, body, width);
    }
    const border = (left: string, join: string, right: string): Row => [
        {
            text:
                left +
                widths.map((each) => "─".repeat(each + 2)).join(join) +
                right,
            style: BORDER,
        },
    ];
    return [
        border("┌", "┬", "┐"),
        ...tableRow(header, widths, token.align),
        border("├", "┼", "┤"),
        ...body.flatMap((cells) => tableRow(cells, widths, token.align)),
        border("└", "┴", "┘"),
    ];
}

function block(token: MarkedToken, width: number): Row[] {
    switch (token.type) {
        case "space":
        case "def":
        case "checkbox":
            return [];
        case "paragraph":
            return wrapSpans(inline(token.tokens, PLAIN), width);
        case "text":
            return wrapSpans(
                token.tokens
                    ? inline(token.tokens, PLAIN)
                    : [{ text: decodeEntities(token.text), style: PLAIN }],
                width,
            );
        case "heading":
            return wrapSpans(
                inline(token.tokens, {
                    bold: true,
                    ...(token.depth <= 2 ? { underline: true } : {}),
                }),
                width,
            );
        case "hr":
            return [[{ text: "─".repeat(Math.max(1, width)), style: DIM }]];
        case "code":
            return codeBlock(token.text, token.lang, width);
        case "html":
            return wrapSpans(
                [{ text: token.text.replace(/\n+$/, ""), style: PLAIN }],
                width,
            );
        case "blockquote":
            return withGutter(blocks(token.tokens, width - 2), QUOTE, QUOTE);
        case "list":
            return list(token, width);
        case "table":
            return table(token, width);
        default:
            return wrapSpans(
                [{ text: token.raw.trimEnd(), style: PLAIN }],
                width,
            );
    }
}

// Blocks are separated by one empty row; a tight list item's blocks are not.
function blocks(tokens: Token[], width: number, gap = true): Row[] {
    const rows: Row[] = [];
    for (const token of tokens) {
        const own = block(token as MarkedToken, width);
        if (own.length === 0) {
            continue;
        }
        if (gap && rows.length > 0) {
            rows.push([]);
        }
        rows.push(...own);
    }
    return rows;
}

export function renderMarkdown(text: string, width: number): Row[] {
    return blocks(marked.lexer(text, { gfm: true }), width);
}
