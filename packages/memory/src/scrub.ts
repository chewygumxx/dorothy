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
// Schemes are case-insensitive in Authorization headers. Outside a
// header, lowercase schemes are also ordinary words, so require a
// credential's shape rather than redacting "basic understanding".
// Whitespace on either side of a value's quote must be separated by
// that quote: adjacent optional runs backtrack quadratically without it.
const BEARER =
    /(?:\b((?:proxy-)?authorization["']?\s*[:=]\s*(?:["']\s*)?))?\b(Bearer|Basic|token)\s+([A-Za-z0-9._~+/=-]{8,})/gi;

function redactScheme(
    whole: string,
    header: string | undefined,
    scheme: string,
    credential: string,
): string {
    const shaped =
        /[0-9_~+/=-]|\.(?=.)/.test(credential) ||
        (scheme.toLowerCase() === "basic" &&
            /^[A-Za-z0-9+/]+={0,2}$/.test(credential) &&
            /^[\x20-\x7e]+:[\x20-\x7e]*$/.test(
                Buffer.from(credential, "base64").toString("utf8"),
            ));
    return header !== undefined || scheme !== scheme.toLowerCase() || shaped
        ? `${header ?? ""}${scheme} ${SECRET}`
        : whole;
}
// The prefixes providers give their keys.
const PREFIXED =
    /\b(?:sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/g;
// key=value or key: value, quoted or not, where the key names a secret.
// A value that is a scheme was handled above. A quoted value's first
// character is matched here and the rest by quotedEnd: a repeated group
// in the pattern costs the engine a frame a character, and past some
// hundred thousand it stops matching and the secret is kept.
// The runs round the key word are bounded, as an unbounded pair
// backtracks quadratically on long text. An unquoted value's first
// character is matched here too, and runEnd takes the rest, so that a
// key skipped as no secret's costs no more than its own length.
const NAMED =
    /\b([\w.-]{0,64}(?:token|key|secret|password|passwd|auth)[\w.-]{0,64})(["']?\s*[=:]\s*)(["']?)(?!(?:Bearer|Basic|token)\s)((?<=")(?:\\[^\n]|[^"\\\n])|(?<=')(?:\\[^\n]|[^'\\\n])|[^\s"'&,;])/gi;

// Whether a matched key names a secret: one of its words does, a word
// being a run of letters and digits between separators or a change of
// case, and it ends in a secret's word. `author`, `authority`,
// `keyboard` and `monkey` match the pattern and are no secrets.
const SECRET_WORD =
    /^(?:o?auth|authorization|authentication|[a-z0-9]*(?:(?<!mon|don|tur|hoc|joc|whis|lac|pok|hok)keys?|tokens?|secrets?|passwords?|passwd))$/;
const isSecretKey = (key: string): boolean =>
    key
        .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)
        .some((word) => SECRET_WORD.test(word.toLowerCase()));

// Where an unquoted value ends.
function runEnd(text: string, from: number): number {
    let at = from;
    while (at < text.length && !/[\s"'&,;]/.test(text[at] as string)) {
        at += 1;
    }
    return at;
}

// Where a quoted value ends: before its closing quote, a line feed or a
// backslash with nothing after it on its line, whichever comes first.
// The value may hold spaces and any number of escaped quotes, and a
// backslash escapes a carriage return or a Unicode line separator.
function quotedEnd(text: string, from: number, quote: string): number {
    let at = from;
    while (at < text.length) {
        const character = text[at] as string;
        if (character === quote || character === "\n") {
            break;
        }
        if (character === "\\") {
            const next = text[at + 1];
            if (next === undefined || next === "\n") {
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
        if (!isSecretKey(key as string)) {
            NAMED.lastIndex =
                match.index +
                (key as string).length +
                (separator as string).length;
            continue;
        }
        const matched = match.index + (whole as string).length;
        const end = quote
            ? quotedEnd(text, matched, quote)
            : runEnd(text, matched);
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
            .replace(BEARER, redactScheme)
            .replace(PREFIXED, SECRET),
    );
}
