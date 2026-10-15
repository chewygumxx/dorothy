// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/scrub.ts
//
//

// The shapes of secrets a tool call's text may carry, replaced before the
// call is written to a transcript. A secret with no telling shape, such as
// a password with no key beside it, is not caught.

const SECRET = "[secret]";

// An OpenSSH, PEM or PGP private key's block; PGP's armour ends in BLOCK.
// A block cut short, as `head` leaves one, is redacted to the end of the
// text. Without the m flag `$` is the text's end alone, so a run of
// headers with no end is crossed once, not once per header.
const PRIVATE_KEY =
    /-----BEGIN [A-Z ]{0,40}PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]{0,40}PRIVATE KEY(?: BLOCK)?-----|$)/g;
// GitHub's API takes `Authorization: token <credential>`.
const BEARER = /\b(Bearer|Basic|[Tt]oken)\s+[A-Za-z0-9._~+/=-]{8,}/g;
// The prefixes providers give their keys.
const PREFIXED =
    /\b(?:sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/g;
// key=value or key: value, quoted or not, where the key names a secret.
// A value that is a scheme was handled above. A quoted value's first
// character is matched here and the rest by quotedEnd: a repeated group
// in the pattern costs the engine a frame a character, and past some
// hundred thousand it stops matching and the secret is kept.
// The runs round the key word are bounded, as an unbounded pair
// backtracks quadratically on long text.
const NAMED =
    /\b([\w.-]{0,64}(?:token|key|secret|password|passwd|auth)[\w.-]{0,64})(["']?\s*[=:]\s*)(["']?)(?!(?:Bearer|Basic|token)\s)((?<=")(?:\\.|[^"\\\n])|(?<=')(?:\\.|[^'\\\n])|[^\s"'&,;]+)/gi;
// What a regular expression's dot does not match.
const LINE_END = /[\n\r\u2028\u2029]/;

// Where a quoted value ends: before its closing quote, a line feed or a
// backslash with nothing it can escape, whichever comes first. The value
// may hold spaces and any number of escaped quotes.
function quotedEnd(text: string, from: number, quote: string): number {
    let at = from;
    while (at < text.length) {
        const character = text[at] as string;
        if (character === quote || character === "\n") {
            break;
        }
        if (character === "\\") {
            const next = text[at + 1];
            if (next === undefined || LINE_END.test(next)) {
                break;
            }
            at += 2;
        } else {
            at += 1;
        }
    }
    return at;
}

function redactNamed(text: string): string {
    let scrubbed = "";
    let kept = 0;
    NAMED.lastIndex = 0;
    for (let match = NAMED.exec(text); match; match = NAMED.exec(text)) {
        const [whole, key, separator, quote] = match as unknown as string[];
        const matched = match.index + (whole as string).length;
        const end = quote ? quotedEnd(text, matched, quote) : matched;
        scrubbed += `${text.slice(kept, match.index)}${key}${separator}${quote}${SECRET}`;
        kept = end;
        NAMED.lastIndex = end;
    }
    return scrubbed + text.slice(kept);
}

export function scrub(text: string): string {
    return redactNamed(
        text
            .replace(PRIVATE_KEY, SECRET)
            .replace(BEARER, (_, scheme: string) => `${scheme} ${SECRET}`)
            .replace(PREFIXED, SECRET),
    );
}
