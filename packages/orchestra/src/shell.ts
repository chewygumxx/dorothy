// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/shell.ts
//
//

// A deliberately small shell grammar: lists of pipelines of simple commands,
// with literal words and redirections. Unrecognised syntax stays untrusted.
export type Word = { text: string; literal: boolean };
export type SimpleCommand = {
    words: Word[];
    redirects: Word[];
    pipeline: number;
};
type Token = { kind: "word"; word: Word } | { kind: "op"; text: string };

function lex(text: string): { tokens: Token[]; plain: boolean } {
    const tokens: Token[] = [];
    let plain = true;
    let i = 0;
    while (i < text.length) {
        const char = text[i] as string;
        if (char === " " || char === "\t" || char === "\r") {
            i++;
            continue;
        }
        if (char === "#") {
            while (i < text.length && text[i] !== "\n") i++;
            continue;
        }
        const op = /^(?:[0-9]*(?:>>?|<)(?:&[0-9-]+)?|&&|\|\||[;|\n&()])/.exec(
            text.slice(i),
        );
        if (op) {
            tokens.push({ kind: "op", text: op[0] });
            i += op[0].length;
            continue;
        }
        let value = "";
        let literal = true;
        let quote = "";
        while (i < text.length) {
            const c = text[i] as string;
            if (!quote && /[ \t\r\n;&|<>()]/.test(c)) break;
            i++;
            if (c === quote) {
                quote = "";
                continue;
            }
            if (!quote && (c === "'" || c === '"')) {
                quote = c;
                continue;
            }
            if (c === "\\" && quote !== "'") {
                const next = text[i];
                if (next === undefined) {
                    literal = false;
                    break;
                }
                if (!quote || '$`"\\\n'.includes(next)) {
                    i++;
                    if (next !== "\n") value += next;
                    continue;
                }
            }
            if (quote !== "'" && /[$`]/.test(c)) literal = false;
            if (!quote && /[*?[\]{}~!]/.test(c)) literal = false;
            if (c === "\0") literal = false;
            value += c;
        }
        if (quote) literal = false;
        plain &&= literal;
        tokens.push({ kind: "word", word: { text: value, literal } });
    }
    return { tokens, plain };
}

export function parseShell(text: string): {
    commands: SimpleCommand[];
    plain: boolean;
} {
    const lexed = lex(text);
    const commands: SimpleCommand[] = [];
    let plain = lexed.plain;
    let pipeline = 0;
    let current: SimpleCommand = { words: [], redirects: [], pipeline };
    let needsCommand = false;
    const finish = () => {
        if (!current.words.length) plain = false;
        if (current.words.length || current.redirects.length)
            commands.push(current);
        current = { words: [], redirects: [], pipeline };
    };
    for (let i = 0; i < lexed.tokens.length; i++) {
        const token = lexed.tokens[i] as Token;
        if (token.kind === "word") {
            current.words.push(token.word);
            needsCommand = false;
        } else if (/^[0-9]*(?:>>?|<)/.test(token.text)) {
            if (/&[0-9-]+$/.test(token.text)) continue;
            const target = lexed.tokens[++i];
            if (target?.kind !== "word") {
                plain = false;
                i--;
            } else current.redirects.push(target.word);
        } else if (["|", "&&", "||", ";", "\n"].includes(token.text)) {
            if (token.text === "\n" && !current.words.length) continue;
            finish();
            if (token.text !== "|") pipeline++;
            current.pipeline = pipeline;
            needsCommand = ["|", "&&", "||"].includes(token.text);
        } else {
            plain = false;
        }
    }
    if (current.words.length || current.redirects.length) finish();
    return { commands, plain: plain && commands.length > 0 && !needsCommand };
}
