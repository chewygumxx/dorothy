// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/markdown-links.ts
//
//

export type Link = { path: string; fragment: string | undefined };

const withoutFences = (markdown: string): string =>
    markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");

// Relative inline links and reference definitions, skipping example code.
export const links = (markdown: string): Link[] => {
    const prose = withoutFences(markdown).replace(/`[^`\n]*`/g, "");
    const inline = [...prose.matchAll(/\]\(\s*(?:<([^>\n]*)>|([^)\s]+))/g)];
    const defined = [
        ...prose.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]*)>|(\S+))/gm),
    ];
    return [...inline, ...defined]
        .map((match) => (match[1] ?? match[2]) as string)
        .filter((target) => !/^[a-z][a-z+.-]*:/i.test(target))
        .map((target) => {
            const hash = target.indexOf("#");
            return {
                path: hash === -1 ? target : target.slice(0, hash),
                fragment: hash === -1 ? undefined : target.slice(hash + 1),
            };
        });
};

export const linkTargets = (markdown: string): string[] =>
    links(markdown)
        .map((link) => link.path)
        .filter((path) => path !== "");

const underscoreEmphasis =
    /(?<!\p{ID_Continue})(_+)(\S(?:.*?\S)?)\1(?!\p{ID_Continue})/gu;

export const headingSlugs = (markdown: string): Set<string> => {
    const slugs = new Set<string>();
    const headings = withoutFences(markdown).matchAll(
        /^ {0,3}#{1,6}[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*$/gm,
    );
    for (const heading of headings) {
        const base = (heading[1] as string)
            .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
            .replace(/`[^`\n]*`|[^`]+/g, (part) =>
                part.startsWith("`")
                    ? part
                    : part.replace(underscoreEmphasis, "$2"),
            )
            .replace(/[`*]/g, "")
            .toLowerCase()
            .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
            .replace(/ /g, "-");
        let slug = base;
        let suffix = 0;
        while (slugs.has(slug)) {
            slug = `${base}-${++suffix}`;
        }
        slugs.add(slug);
    }
    return slugs;
};
