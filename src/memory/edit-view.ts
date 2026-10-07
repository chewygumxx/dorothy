// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/edit-view.ts
//
//

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

const day = (at: string) => at.slice(0, 10);

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

// shown: the sidecar the template was rendered from. Only what differs from
// it, whitespace aside, is an edit.
export function parseEditView(
    text: string,
    shown: Sidecar | null,
    tags?: TagsContext,
): EditParse {
    // Some editors save a byte order mark at the start of the file.
    const lines = text
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .filter((line) => !line.startsWith("#"));
    if (lines.every((line) => line.trim() === "")) {
        return { kind: "unchanged" };
    }
    const found = new Map<string, string[]>();
    let open: string | null = null;
    for (const line of lines) {
        const header = HEADER.exec(line);
        if (header !== null) {
            const [, name = "", rest = ""] = header;
            if (found.has(name)) {
                return { kind: "error", reason: `${name} appears twice` };
            }
            found.set(name, [rest]);
            open = PARAGRAPHS.has(name) ? name : null;
        } else if (open !== null) {
            found.get(open)?.push(line);
        } else if (line.trim() !== "") {
            const unknown = UNKNOWN.exec(line);
            return {
                kind: "error",
                reason:
                    unknown === null
                        ? `"${line.trim()}" is under no field`
                        : `there is no field ${unknown[1]}`,
            };
        }
    }

    const base = shown ?? EMPTY_SIDECAR;
    const changes: EditChanges = {};
    for (const field of FIELDS) {
        const given = found.get(LABELS[field]);
        if (given === undefined) {
            continue;
        }
        const value = normalise(given.join(" "));
        const problem = overLimit(field, value);
        if (problem !== null) {
            return { kind: "error", reason: problem };
        }
        if (value !== (base[field] ?? "")) {
            changes[field] = value === "" ? null : value;
        }
    }
    for (const [label, key] of [
        ["Pinned", "pinned"],
        ["Hidden", "hidden"],
    ] as const) {
        const given = found.get(label);
        if (given === undefined) {
            continue;
        }
        const answer = normalise(given.join(" "));
        const yes = answer.toLowerCase() === "yes";
        if (!yes && answer.toLowerCase() !== "no") {
            return {
                kind: "error",
                reason: `${label} takes yes or no, not "${answer}"`,
            };
        }
        if (yes !== base[key]) {
            changes[key] = yes;
        }
    }
    const given = found.get("Tags");
    if (given !== undefined) {
        if (tags === undefined) {
            return { kind: "error", reason: "there is no field Tags" };
        }
        if (tags.kind === "broken") {
            return {
                kind: "error",
                reason: "Tags can't be set while the vocabulary can't be read",
            };
        }
        const ids: string[] = [];
        for (const label of normalise(given.join(" "))
            .split(";")
            .map(normalise)) {
            if (label === "") {
                continue;
            }
            const id = resolveLabel(tags.vocabulary, label);
            if (id === null) {
                return {
                    kind: "error",
                    reason: `No tag by that name: ${label}`,
                };
            }
            if (!ids.includes(id)) {
                ids.push(id);
            }
        }
        if (ids.length > TAG_LIMITS.tags) {
            return {
                kind: "error",
                reason: `Tags takes at most ${TAG_LIMITS.tags} tags`,
            };
        }
        const current = resolveTags(tags.vocabulary, base.tags);
        const same =
            ids.length === current.length &&
            ids.every((id, at) => id === current[at]);
        if (!same) {
            changes.tags = ids.length === 0 ? null : ids;
        }
    }
    return Object.keys(changes).length === 0
        ? { kind: "unchanged" }
        : { kind: "edit", changes };
}
