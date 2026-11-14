// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/identity/src/strip.ts
//
//

export function stripHouseHeader(source: string): string {
    const body = source
        .replace(/^\uFEFF/, "")
        .replaceAll("\r\n", "\n")
        .replace(/^---\n(?:.*\n)*?---(?:\n|$)/, "")
        .replace(/<!--[\s\S]*?-->/, (comment) =>
            comment.includes(":::") ? "" : comment,
        )
        .replace(/(?:^|\n)<!-- vim:[^\n]*-->[ \t\n]*$/, "")
        .trim();

    if (!body) {
        throw new Error("Markdown body is empty");
    }

    return body;
}
