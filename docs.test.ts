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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
    catalogueFailures,
    linkFailures,
    resolveLink,
} from "./scripts/docs-links.js";
import { links } from "./scripts/markdown-links.js";

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

const linkedFrom = (page: string): Set<string> =>
    new Set(
        links(read(page)).map((link) =>
            relative(ROOT, resolveLink(ROOT, page, link.path)),
        ),
    );

describe("the wiki", () => {
    it("resolves every link and fragment in the wiki", () => {
        const pages = [
            at("docs", "README.md"),
            ...wikiPages(),
            at("docs", "roadmap.md"),
            at("README.md"),
            at("AGENTS.md"),
            at("docs", "AGENTS.md"),
        ];
        expect(linkFailures(ROOT, pages)).toEqual([]);
    });

    it("catalogues every dated record", () => {
        expect(
            catalogueFailures(
                ROOT,
                at("docs", "wiki", "records.md"),
                records(),
            ),
        ).toEqual({ missing: [], duplicates: [] });
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
