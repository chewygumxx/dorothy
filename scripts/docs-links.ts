// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/scripts/docs-links.ts
//
//

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { headingSlugs, linkOccurrences, links } from "./markdown-links.js";

const read = (path: string): string => readFileSync(path, "utf8");

const decode = (path: string): string => {
    try {
        return decodeURIComponent(path);
    } catch {
        return path;
    }
};

// Where a page's link points, a leading slash meaning the repository root.
export const resolveLink = (
    root: string,
    page: string,
    path: string,
): string => {
    const target = decode(path);
    if (target === "") return page;
    return target.startsWith("/")
        ? resolve(root, `.${target}`)
        : resolve(dirname(page), target);
};

export const linkFailures = (root: string, pages: string[]): string[] => {
    const failures: string[] = [];
    for (const page of pages) {
        for (const link of links(read(page))) {
            const target = resolveLink(root, page, link.path);
            const name = `${relative(root, page)}: ${link.path}${
                link.fragment === undefined ? "" : `#${link.fragment}`
            }`;
            if (!existsSync(target)) {
                failures.push(name);
            } else if (
                link.fragment !== undefined &&
                target.endsWith(".md") &&
                statSync(target).isFile() &&
                !headingSlugs(read(target)).has(decode(link.fragment))
            ) {
                failures.push(name);
            }
        }
    }
    return failures;
};

export const catalogueFailures = (
    root: string,
    page: string,
    records: string[],
): { missing: string[]; duplicates: string[] } => {
    const expected = new Set(records);
    const counts = new Map<string, number>();
    for (const { path } of linkOccurrences(read(page))) {
        const record = relative(root, resolveLink(root, page, path));
        if (expected.has(record)) {
            counts.set(record, (counts.get(record) ?? 0) + 1);
        }
    }
    return {
        missing: records.filter((record) => !counts.has(record)),
        duplicates: [...counts]
            .filter(([, count]) => count > 1)
            .map(([record]) => record)
            .sort(),
    };
};
