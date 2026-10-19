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
    FACT_LIMITS,
    FACT_NAME,
    type Fact,
    folded,
    frontmatterOf,
    Problem,
    readCommon,
} from "../facts/file.js";
import { characters, normalise } from "../memory/sidecar.js";

export type ExportedFact = Pick<
    Fact,
    "name" | "description" | "type" | "extra" | "body"
>;
export type ExportedRead =
    | { kind: "ok"; form: ExportedFact }
    | { kind: "unparseable"; reason: string };

// The fact a repository file of this stem holds, or null if no fact has
// that name. Claude Code names its files in snake case, feedback_testing;
// the fact is feedback-testing, and its file keeps the name it has.
export function nameOfStem(stem: string): string | null {
    const name = stem.replaceAll("_", "-");
    return FACT_NAME.test(name) && name.length <= FACT_LIMITS.name
        ? name
        : null;
}

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

// A file's stem is its fact's name or, in snake case, that name's; the
// frontmatter may give either.
export function parseExported(source: string, stem: string): ExportedRead {
    try {
        const { data, body } = frontmatterOf(source);
        const unknown = Object.keys(data).find(
            (key) => !EXPORTED_KEYS.includes(key),
        );
        if (unknown !== undefined) {
            throw new Problem(`its frontmatter has an unknown key, ${unknown}`);
        }
        const name = nameOfStem(stem) ?? stem;
        const named = data.name === stem ? { ...data, name } : data;
        return { kind: "ok", form: readCommon(named, body, name) };
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
    // The stem of the fact's file, its name unless the file is in snake
    // case.
    file?: string;
    title: string;
    description: string;
    // The lines a hand gave the entry, kept in place of the description.
    hook?: readonly string[];
    importance: number | null;
    created: string;
};

const escapeLink = (text: string) => text.replace(/[\\[\]]/g, (c) => `\\${c}`);
// A word that would open a line as a list marker, `-` or `1.`, escaped:
// under an entry it would read as a nested list, to Markdown and to
// isGeneratedIndex alike.
const unlisted = (word: string) =>
    /^[-*+]$/.test(word)
        ? `\\${word}`
        : /^\d{1,9}[.)]$/.test(word)
          ? `${word.slice(0, -1)}\\${word.slice(-1)}`
          : word;
// A description wrapped to width, as wrap does, escaping a marker that
// would open a line.
function described(text: string, width: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
        if (line === "") {
            line = unlisted(word);
        } else if (characters(line) + 1 + characters(word) <= width) {
            line += ` ${word}`;
        } else {
            lines.push(line);
            line = unlisted(word);
        }
    }
    lines.push(line);
    return lines;
}
const entryLines = (entry: IndexEntry) => [
    `- [${escapeLink(entry.title)}](./${entry.file ?? entry.name}.md)`,
    ...(entry.hook ?? described(entry.description, 78)).map(
        (line) => `  ${line}`,
    ),
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

// A file's stem: a fact's name, or snake case.
const STEM = "[a-z0-9]+(?:[-_][a-z0-9]+)*";
// An entry as renderIndex writes it.
const ENTRY = new RegExp(
    `^- \\[((?:\\\\.|[^\\]\\\\])*)\\]\\(\\./(${STEM})\\.md\\)\\s*$`,
);
// An entry as a hand or Claude Code writes one: either bullet, the link
// with or without `./`, and anything after it on the line, such as a dash
// and the fact's hook.
const ANY_ENTRY = new RegExp(
    `^[-*] \\[((?:\\\\.|[^\\]\\\\])*)\\]\\((?:\\./)?(${STEM})\\.md\\).*$`,
);
// A line of an entry's description: indented as renderIndex indents it,
// and no list item of its own.
const DESCRIPTION = /^ {2}(?![-*+](?:\s|$)|\d{1,9}[.)](?:\s|$))\S/;

// Each entry's title, by the stem of its file, in the index's order.
export function indexTitles(text: string): Map<string, string> {
    const titles = new Map<string, string>();
    for (const line of text.split("\n")) {
        const [, title, name] = ANY_ENTRY.exec(line) ?? [];
        if (title !== undefined && name !== undefined && !titles.has(name)) {
            titles.set(name, normalise(title.replace(/\\(.)/g, "$1")));
        }
    }
    return titles;
}

// The lines of each entry's hook (its description), by the stem of its
// file, in an index renderIndex wrote or a hand edited to the same form.
export function indexHooks(text: string): Map<string, string[]> {
    const hooks = new Map<string, string[]>();
    let lines: string[] | null = null;
    for (const line of text.split("\n")) {
        const stem = ENTRY.exec(line)?.[2];
        if (stem !== undefined) {
            lines = [];
            if (!hooks.has(stem)) {
                hooks.set(stem, lines);
            }
        } else if (DESCRIPTION.test(line)) {
            lines?.push(line.slice(2));
        } else {
            lines = null;
        }
    }
    return hooks;
}

// Whether every line of an index is one renderIndex writes: a blank line,
// an entry, or a line of the description beneath an entry. An index with
// a heading, prose, a nested list or a paragraph after a blank line holds
// a hand's work.
export function isGeneratedIndex(text: string): boolean {
    let inEntry = false;
    for (const line of text.split("\n")) {
        if (line.trim() === "") {
            inEntry = false;
        } else if (DESCRIPTION.test(line)) {
            if (!inEntry) {
                return false;
            }
        } else if (ENTRY.test(line)) {
            inEntry = true;
        } else {
            return false;
        }
    }
    return true;
}
