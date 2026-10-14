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

const PRIVATE_KEY =
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
// GitHub's API takes `Authorization: token <credential>`.
const BEARER = /\b(Bearer|Basic|[Tt]oken)\s+[A-Za-z0-9._~+/=-]{8,}/g;
// The prefixes providers give their keys.
const PREFIXED =
    /\b(?:sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/g;
// key=value or key: value, quoted or not, where the key names a secret.
// A value that is a scheme was handled above. The runs round the key word
// are bounded, as an unbounded pair backtracks quadratically on long text.
const NAMED =
    /\b([\w.-]{0,64}(?:token|key|secret|password|passwd|auth)[\w.-]{0,64})(["']?\s*[=:]\s*)(["']?)(?!(?:Bearer|Basic|token)\s)([^\s"'&,;]+)/gi;

export function scrub(text: string): string {
    return text
        .replace(PRIVATE_KEY, SECRET)
        .replace(BEARER, (_, scheme: string) => `${scheme} ${SECRET}`)
        .replace(PREFIXED, SECRET)
        .replace(
            NAMED,
            (_, key: string, separator: string, quote: string) =>
                `${key}${separator}${quote}${SECRET}`,
        );
}
