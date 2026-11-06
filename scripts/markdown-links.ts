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

const prose = (markdown: string): string =>
    withoutFences(markdown).replace(/`[^`\n]*`/g, "");

const inlineTarget = /\]\(\s*(?:<([^>\n]*)>|([^)\s]+))/g;
const referenceDefinition = /^ {0,3}\[([^\]\n]+)\]:\s*(?:<([^>\n]*)>|(\S+))/gm;

const relativeLinks = (targets: string[]): Link[] =>
    targets
        .filter((target) => !/^[a-z][a-z+.-]*:/i.test(target))
        .map((target) => {
            const hash = target.indexOf("#");
            return {
                path: hash === -1 ? target : target.slice(0, hash),
                fragment: hash === -1 ? undefined : target.slice(hash + 1),
            };
        });

// Relative inline links and reference definitions, skipping example code.
export const links = (markdown: string): Link[] => {
    const text = prose(markdown);
    return relativeLinks([
        ...[...text.matchAll(inlineTarget)].map(
            (match) => (match[1] ?? match[2]) as string,
        ),
        ...[...text.matchAll(referenceDefinition)].map(
            (match) => (match[2] ?? match[3]) as string,
        ),
    ]);
};

const referenceLabel = (label: string): string =>
    label.trim().replace(/\s+/g, " ").toLowerCase();

// Count uses, not definitions, for ordinary inline and reference syntax.
export const linkOccurrences = (markdown: string): Link[] => {
    const text = prose(markdown);
    const references = new Map<string, string>();
    for (const match of text.matchAll(referenceDefinition)) {
        const label = referenceLabel(match[1] as string);
        if (!references.has(label)) {
            references.set(label, (match[2] ?? match[3]) as string);
        }
    }
    const body = text.replace(
        new RegExp(`${referenceDefinition.source}[^\\n]*`, "gm"),
        "",
    );
    // Consuming the whole inline link keeps its label out of shortcut uses.
    const uses = new RegExp(
        `\\[[^\\]]*${inlineTarget.source}[^\\n)]*\\)|` +
            "\\[([^\\[\\]]+)\\](?:\\[([^\\[\\]]*)\\])?",
        "g",
    );
    const targets: string[] = [];
    for (const match of body.matchAll(uses)) {
        const target =
            match[1] ??
            match[2] ??
            references.get(referenceLabel((match[4] || match[3]) as string));
        if (target !== undefined) targets.push(target);
    }
    return relativeLinks(targets);
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
