// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/edit-view.ts
//
//

import { localDay as day } from "./list.js";
import {
    type Author,
    type EditChanges,
    EMPTY_SIDECAR,
    FIELDS,
    type Field,
    normalise,
    overLimit,
    type Provenance,
    type Sidecar,
} from "./sidecar.js";
import {
    type Concept,
    resolveLabel,
    resolveTags,
    TAG_LIMITS,
    type Vocabulary,
} from "./vocabulary.js";

const WIDTH = 72;
const LABELS: Record<Field, string> = {
    title: "Title",
    description: "Description",
    abstract: "Abstract",
};
const HEADER = /^(Title|Pinned|Hidden|Tags|Description|Abstract):(.*)$/;
// The vocabulary as read for the view, or why it could not be.
export type TagsContext =
    | { kind: "ok"; vocabulary: Vocabulary }
    | { kind: "broken"; reason: string };
// The error for a Tags: line given while the vocabulary is broken.
export const TAGS_BROKEN =
    "Tags can't be set while the vocabulary can't be read";
const UNKNOWN = /^([A-Z][A-Za-z-]*):/;
// These take the lines after them, up to the next field.
const PARAGRAPHS = new Set(["Description", "Abstract"]);
const AUTHOR_NAMES: Record<Author, string> = {
    prompt: "provisional",
    dorothy: "Dorothy",
    user: "yours",
};

export type EditParse =
    | { kind: "unchanged" }
    | { kind: "error"; reason: string }
    | { kind: "edit"; changes: EditChanges };

// A line starting with # is a comment and one starting with a field name is
// a field, so neither may start a wrapped line: such a word stays on the
// line before, however long, and opening a paragraph it is indented.
const startsBadly = (word: string, header: RegExp) =>
    word.startsWith("#") || header.test(word);

// Greedy, at spaces.
export function wrap(
    text: string,
    width = WIDTH,
    header: RegExp = HEADER,
): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
        if (word === "") {
            continue;
        }
        if (line === "") {
            line = startsBadly(word, header) ? ` ${word}` : word;
        } else if (
            line.length + 1 + word.length <= width ||
            startsBadly(word, header)
        ) {
            line += ` ${word}`;
        } else {
            lines.push(line);
            line = word;
        }
    }
    if (line !== "") {
        lines.push(line);
    }
    return lines;
}

function owner(value: string | null, source: Provenance | undefined): string {
    if (value === null) {
        return " (empty)";
    }
    if (source === undefined) {
        return "";
    }
    const parts = [AUTHOR_NAMES[source.by]];
    if (source.by === "dorothy" && source.model !== undefined) {
        parts.push(source.model);
    }
    parts.push(day(source.at));
    return ` (${parts.join(", ")})`;
}

// A conversation's tags as the view shows them: preferred labels, merges
// followed.
function tagsText(vocabulary: Vocabulary, sidecar: Sidecar): string {
    return resolveTags(vocabulary, sidecar.tags)
        .map((id) => (vocabulary.concepts[id] as Concept).prefLabel)
        .join("; ");
}

function tagLines(sidecar: Sidecar, tags: TagsContext | undefined): string[] {
    if (tags === undefined) {
        return [];
    }
    if (tags.kind === "broken") {
        return [
            "",
            `# Tags can't be shown: the vocabulary can't be read (${tags.reason}).`,
        ];
    }
    const text = tagsText(tags.vocabulary, sidecar);
    return [
        "",
        `# Tags${owner(text === "" ? null : text, sidecar.fields.tags)}`,
        `Tags: ${text}`.trimEnd(),
    ];
}

export function renderEditView(
    phrase: string,
    sidecar: Sidecar | null,
    tags?: TagsContext,
): string {
    const shown = sidecar ?? EMPTY_SIDECAR;
    const lines = [
        `# Dorothy's notes on ${phrase}.`,
        "# Lines starting with # are ignored. Change a field to make it yours;",
        "# empty it to hand it back to Dorothy. Pinned and Hidden take yes or no.",
        "",
        `Title: ${shown.title ?? ""}`.trimEnd(),
        `Pinned: ${shown.pinned ? "yes" : "no"}`,
        `Hidden: ${shown.hidden ? "yes" : "no"}`,
        ...tagLines(shown, tags),
    ];
    for (const field of ["description", "abstract"] as const) {
        lines.push(
            "",
            `# ${LABELS[field]}${owner(shown[field], shown.fields[field])}`,
            `${LABELS[field]}:`,
            ...wrap(shown[field] ?? ""),
        );
    }
    if (shown.titles.length > 0) {
        lines.push(
            "",
            "# Earlier titles:",
            ...shown.titles.map(
                (past) =>
                    `#   ${past.title} (${AUTHOR_NAMES[past.by]}, ${day(past.at)})`,
            ),
        );
    }
    return `${lines.join("\n")}\n`;
}

// A view's lines but its comments; null for a view left empty. Some
// editors save a byte order mark at the start of the file.
export function viewLines(text: string): string[] | null {
    const lines = text
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .filter((line) => !line.startsWith("#"));
    return lines.every((line) => line.trim() === "") ? null : lines;
}

// shown: the sidecar the template was rendered from. Only what differs from
// it, whitespace aside, is an edit.
export function parseEditView(
    text: string,
    shown: Sidecar | null,
    tags?: TagsContext,
    renderedTags = tags,
): EditParse {
    const lines = viewLines(text);
    if (lines === null) {
        return { kind: "unchanged" };
    }
    const found = readFields(lines);
    if (typeof found === "string") {
        return { kind: "error", reason: found };
    }
    const base = shown ?? EMPTY_SIDECAR;
    const joined = abstractJoined(found, base);
    if (joined !== null) {
        return { kind: "error", reason: joined };
    }
    const changes: EditChanges = {};
    const problem =
        textChanges(found, base, changes) ??
        flagChanges(found, base, changes) ??
        tagsChange(found.get("Tags"), tags, base, changes, renderedTags);
    if (problem !== null) {
        return { kind: "error", reason: problem };
    }
    return Object.keys(changes).length === 0
        ? { kind: "unchanged" }
        : { kind: "edit", changes };
}

// Each field given, normalised; or why the lines are not fields. A
// paragraph runs on to the next field.
function readFields(lines: readonly string[]): Map<string, string> | string {
    const found = new Map<string, string[]>();
    let open: string | null = null;
    for (const line of lines) {
        const header = HEADER.exec(line);
        if (header !== null) {
            const [, name = "", rest = ""] = header;
            if (found.has(name)) {
                return `${name} appears twice`;
            }
            found.set(name, [rest]);
            open = PARAGRAPHS.has(name) ? name : null;
        } else if (open !== null) {
            found.get(open)?.push(line);
        } else if (line.trim() !== "") {
            return strayLine(line);
        }
    }
    return new Map(
        [...found].map(([name, given]) => [name, normalise(given.join(" "))]),
    );
}

// Without its Abstract: line the abstract's text, which follows the
// description, reads as part of it. When the description is now the old one
// and the old abstract together, that is what happened, and saving it would
// quietly make the description the user's.
function abstractJoined(
    found: ReadonlyMap<string, string>,
    base: Sidecar,
): string | null {
    const description = found.get(LABELS.description);
    if (
        found.has(LABELS.abstract) ||
        description === undefined ||
        base.abstract === null ||
        description !== normalise(`${base.description ?? ""} ${base.abstract}`)
    ) {
        return null;
    }
    return "the Abstract: line is gone, so the abstract's text joined the description; keep the Abstract: line, or delete the abstract's text along with it";
}

function strayLine(line: string): string {
    const unknown = UNKNOWN.exec(line);
    return unknown === null
        ? `"${line.trim()}" is under no field`
        : `there is no field ${unknown[1]}`;
}

// Title, Description and Abstract; an emptied one is handed back.
function textChanges(
    found: ReadonlyMap<string, string>,
    base: Sidecar,
    changes: EditChanges,
): string | null {
    for (const field of FIELDS) {
        const value = found.get(LABELS[field]);
        if (value === undefined) {
            continue;
        }
        const problem = overLimit(field, value);
        if (problem !== null) {
            return problem;
        }
        if (value !== (base[field] ?? "")) {
            changes[field] = value === "" ? null : value;
        }
    }
    return null;
}

function flagChanges(
    found: ReadonlyMap<string, string>,
    base: Sidecar,
    changes: EditChanges,
): string | null {
    for (const [label, key] of [
        ["Pinned", "pinned"],
        ["Hidden", "hidden"],
    ] as const) {
        const answer = found.get(label);
        if (answer === undefined) {
            continue;
        }
        const yes = answer.toLowerCase() === "yes";
        if (!yes && answer.toLowerCase() !== "no") {
            return `${label} takes yes or no, not "${answer}"`;
        }
        if (yes !== base[key]) {
            changes[key] = yes;
        }
    }
    return null;
}

function tagsChange(
    given: string | undefined,
    tags: TagsContext | undefined,
    base: Sidecar,
    changes: EditChanges,
    rendered: TagsContext | undefined,
): string | null {
    if (given === undefined) {
        return null;
    }
    if (tags === undefined) {
        return "there is no field Tags";
    }
    if (tags.kind === "broken") {
        return TAGS_BROKEN;
    }
    // An untouched line names what was rendered, even after a rename or
    // deletion. An already lapsed fixed set returns only with another edit.
    if (
        rendered?.kind === "ok" &&
        given === tagsText(rendered.vocabulary, base)
    ) {
        if (
            given === "" &&
            base.fields.tags?.by === "user" &&
            Object.keys(changes).length > 0
        )
            changes.tags = null;
        return null;
    }
    const ids = tagIds(given, tags.vocabulary);
    if (typeof ids === "string") {
        return ids;
    }
    const current = resolveTags(tags.vocabulary, base.tags);
    const same =
        ids.length === current.length &&
        ids.every((id, at) => id === current[at]);
    // A fixed set whose concepts are all gone shows as an empty line,
    // which hands it back as emptying it would.
    const lapsed = ids.length === 0 && base.fields.tags?.by === "user";
    if (!same || lapsed) {
        changes.tags = ids.length === 0 ? null : ids;
    }
    return null;
}

// The concepts a Tags: line names, once each; or why it can't.
function tagIds(given: string, vocabulary: Vocabulary): string[] | string {
    const ids: string[] = [];
    for (const label of given.split(";").map(normalise)) {
        if (label === "") {
            continue;
        }
        const id = resolveLabel(vocabulary, label);
        if (id === null) {
            return `No tag by that name: ${label}`;
        }
        if (!ids.includes(id)) {
            ids.push(id);
        }
    }
    return ids.length > TAG_LIMITS.tags
        ? `Tags takes at most ${TAG_LIMITS.tags} tags`
        : ids;
}
