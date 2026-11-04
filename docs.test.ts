// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/docs.test.ts
//
//

// The wiki's integrity: every link and fragment resolves, every dated record
// is catalogued and every wiki page is reachable from its home.

import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { headingSlugs, links } from "./scripts/markdown-links.js";

const ROOT = import.meta.dir;
const at = (...parts: string[]) => join(ROOT, ...parts);

const RECORD_DIRECTORIES = ["specs", "plans", "reports", "notes", "deferred"];

// A dated record is a Markdown file at the top of a record directory.
const isRecord = (name: string, isDirectory: boolean): boolean =>
    !isDirectory && /^\d{4}-\d{2}-\d{2}.*\.md$/.test(name);

const markdownFiles = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return markdownFiles(path);
        return entry.name.endsWith(".md") ? [path] : [];
    });

const wikiPages = (): string[] => {
    const directory = at("docs", "wiki");
    return existsSync(directory) ? markdownFiles(directory).sort() : [];
};

const records = (): string[] =>
    RECORD_DIRECTORIES.flatMap((directory) =>
        readdirSync(at("docs", directory), { withFileTypes: true })
            .filter((entry) => isRecord(entry.name, entry.isDirectory()))
            .map((entry) => join("docs", directory, entry.name)),
    ).sort();

const read = (path: string): string => readFileSync(path, "utf8");

const decode = (path: string): string => {
    try {
        return decodeURIComponent(path);
    } catch {
        return path;
    }
};

// Where a page's link points, a leading slash meaning the repository root.
const resolveLink = (page: string, path: string): string => {
    const target = decode(path);
    if (target === "") return page;
    return target.startsWith("/")
        ? resolve(ROOT, `.${target}`)
        : resolve(dirname(page), target);
};

const linkedFrom = (page: string): Set<string> =>
    new Set(
        links(read(page)).map((link) =>
            relative(ROOT, resolveLink(page, link.path)),
        ),
    );

describe("the wiki", () => {
    it("resolves every link and fragment in the wiki", () => {
        const pages = [
            at("docs", "README.md"),
            ...wikiPages(),
            at("docs", "roadmap.md"),
            at("README.md"),
        ];
        const failures: string[] = [];
        for (const page of pages) {
            for (const link of links(read(page))) {
                const target = resolveLink(page, link.path);
                const name = `${relative(ROOT, page)}: ${link.path}${
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
        expect(failures).toEqual([]);
    });

    it("catalogues every dated record", () => {
        const catalogued = linkedFrom(at("docs", "wiki", "records.md"));
        expect(records().filter((record) => !catalogued.has(record))).toEqual(
            [],
        );
    });

    it("links every wiki page from home", () => {
        const linked = linkedFrom(at("docs", "README.md"));
        expect(
            wikiPages()
                .map((page) => relative(ROOT, page))
                .filter((page) => !linked.has(page)),
        ).toEqual([]);
    });

    it("counts only top-level records", () => {
        const names: [string, boolean][] = [
            ["2026-10-18-protocol-diversity.md", false],
            ["AGENTS.md", false],
            ["2026-10-18-protocol-diversity", true],
        ];
        expect(
            names
                .filter(([name, isDirectory]) => isRecord(name, isDirectory))
                .map(([name]) => name),
        ).toEqual(["2026-10-18-protocol-diversity.md"]);
    });
});
