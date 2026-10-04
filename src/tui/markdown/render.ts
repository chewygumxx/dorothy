// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/markdown/render.ts
//
//

import { type MarkedToken, marked, type Token } from "marked";
import { highlight } from "./highlight.js";
import {
    breakSpans,
    PLAIN,
    type Row,
    type Span,
    type Style,
    splitLines,
    wrapSpans,
} from "./spans.js";

const DIM: Style = { dim: true };
const GUTTER: Span = { text: "┃ ", style: DIM };
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
