// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/projects/export.ts
//
//

// A project's facts as its repository holds them: the exported form,
// which keeps what Claude Code's auto-memory reads (name, description,
// metadata and the body), its hash, and MEMORY.md, the index Claude Code
// loads at startup.

import { createHash } from "node:crypto";
import {
    type Fact,
    folded,
    frontmatterOf,
    Problem,
    readCommon,
    wrap,
} from "../facts/file.js";
import { normalise } from "../memory/sidecar.js";

export type ExportedFact = Pick<
    Fact,
    "name" | "description" | "type" | "extra" | "body"
>;
export type ExportedRead =
    | { kind: "ok"; form: ExportedFact }
    | { kind: "unparseable"; reason: string };

export const exportedForm = (fact: Fact): ExportedFact => ({
    name: fact.name,
    description: fact.description,
    type: fact.type,
    extra: fact.extra,
    body: fact.body,
});

export function renderExported(form: ExportedFact): string {
    return [
        "---",
        `name: ${form.name}`,
        ...folded("description", form.description),
        "metadata:",
        `  type: ${form.type}`,
        ...Object.entries(form.extra).map(
            ([key, value]) => `  ${key}: ${JSON.stringify(value)}`,
        ),
        "---",
        "",
        form.body,
        "",
    ].join("\n");
}

const EXPORTED_KEYS = ["name", "description", "metadata"];

export function parseExported(source: string, stem: string): ExportedRead {
    try {
        const { data, body } = frontmatterOf(source);
        const unknown = Object.keys(data).find(
            (key) => !EXPORTED_KEYS.includes(key),
        );
        if (unknown !== undefined) {
            throw new Problem(`its frontmatter has an unknown key, ${unknown}`);
        }
        return { kind: "ok", form: readCommon(data, body, stem) };
    } catch (error) {
        if (error instanceof Problem) {
            return { kind: "unparseable", reason: error.message };
        }
        throw error;
    }
}

const byKey = ([a]: [string, unknown], [b]: [string, unknown]) =>
    a < b ? -1 : a > b ? 1 : 0;

// Of the parsed form, so a file written another way hashes the same.
export function formHash(form: ExportedFact): string {
    return createHash("sha256")
        .update(
            JSON.stringify([
                form.name,
                form.description,
                form.type,
                Object.entries(form.extra).sort(byKey),
                form.body,
            ]),
        )
        .digest("hex");
}

// What Claude Code loads of MEMORY.md; it drops the rest silently.
export const INDEX_LIMITS = { lines: 200, bytes: 25_000 } as const;

export type IndexEntry = {
    name: string;
    title: string;
    description: string;
    importance: number | null;
    created: string;
};

const escapeLink = (text: string) => text.replace(/[\\[\]]/g, (c) => `\\${c}`);
const entryLines = (entry: IndexEntry) => [
    `- [${escapeLink(entry.title)}](./${entry.name}.md)`,
    ...wrap(entry.description, 78).map((line) => `  ${line}`),
];
const render = (entries: readonly IndexEntry[]) =>
    entries.length === 0 ? "" : `${entries.flatMap(entryLines).join("\n")}\n`;
const fits = (text: string) =>
    text.split("\n").length - 1 <= INDEX_LIMITS.lines &&
    Buffer.byteLength(text) <= INDEX_LIMITS.bytes;
const byCreated = (a: IndexEntry, b: IndexEntry) =>
    a.created < b.created
        ? -1
        : a.created > b.created
          ? 1
          : a.name < b.name
            ? -1
            : a.name > b.name
              ? 1
              : 0;
// A fact without importance ranks as a 5.
const byWeight = (a: IndexEntry, b: IndexEntry) =>
    (b.importance ?? 5) - (a.importance ?? 5) || byCreated(b, a);

// Every fact as it was created when they fit; otherwise as many as fit,
// the most important and then the newest first.
export function renderIndex(entries: readonly IndexEntry[]): {
    text: string;
    omitted: number;
} {
    const whole = render([...entries].sort(byCreated));
    if (fits(whole)) {
        return { text: whole, omitted: 0 };
    }
    const kept: IndexEntry[] = [];
    for (const entry of [...entries].sort(byWeight)) {
        if (fits(render([...kept, entry]))) {
            kept.push(entry);
        }
    }
    return { text: render(kept), omitted: entries.length - kept.length };
}

const ENTRY =
    /^- \[((?:\\.|[^\]\\])*)\]\(\.\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md\)\s*$/;

// Each entry's title, by its fact's name, in the index's order.
export function indexTitles(text: string): Map<string, string> {
    const titles = new Map<string, string>();
    for (const line of text.split("\n")) {
        const [, title, name] = ENTRY.exec(line) ?? [];
        if (title !== undefined && name !== undefined && !titles.has(name)) {
            titles.set(name, normalise(title.replace(/\\(.)/g, "$1")));
        }
    }
    return titles;
}
