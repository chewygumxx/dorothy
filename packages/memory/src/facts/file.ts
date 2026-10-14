// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/facts/file.ts
//
//

// A fact: Markdown with YAML frontmatter, one file each. Only Dorothy's
// code renders frontmatter, in a form with one reading: free text in
// normalised >- blocks, closed sets and patterns plain, the rest through
// JSON.stringify. Read, every value is checked for its type, so a YAML
// trap written by hand fails rather than being coerced.

import { isPhrase } from "@dorothy/core";
import { CONCEPT_ID, characters, normalise } from "../memory/sidecar.js";

export const FACT_TYPES = ["user", "feedback", "project", "reference"] as const;
export type FactType = (typeof FACT_TYPES)[number];
// Where a fact's content came from, most trusted last.
export const ORIGINS = ["external", "repo", "dorothy", "user"] as const;
export type Origin = (typeof ORIGINS)[number];
export const WRITERS = ["dorothy", "user", "review", "repo"] as const;
export type Writer = (typeof WRITERS)[number];

export const FACT_LIMITS = {
    name: 64,
    title: 60,
    description: 160,
    why: 160,
    body: 8000,
} as const;
// Written plain, so it must read back as text: it starts with a letter
// (no number, `0x1f` or `1e3`) and is neither `null`, `true` nor `false`.
export const FACT_NAME =
    /^(?!(?:null|true|false)$)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const EXTRA_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export type Extra = string | number | boolean;
export type FactProvenance = {
    origin: Origin;
    by: Writer;
    at: string;
    created: string;
    model?: string;
    from?: string;
};
export type Retired = { at: string; by: Writer; why: string };
export type Fact = {
    name: string;
    title: string;
    description: string;
    type: FactType;
    // metadata's keys besides type, as they were written.
    extra: Record<string, Extra>;
    tags: string[];
    importance: number | null;
    provenance: FactProvenance;
    retired: Retired | null;
    body: string;
};
export type FactRead =
    | { kind: "ok"; fact: Fact }
    | { kind: "unparseable"; reason: string };

// Why a fact cannot be read; thrown by the readers below, caught by
// whoever called them.
export class Problem extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// Controls but tab and newline, every format character (zero widths,
// bidirectional overrides, tags, joiners, the soft hyphen), the default
// ignorables (variation selectors, the Hangul filler) and the line and
// paragraph separators: text a model reads but a person does not see.
const HIDDEN =
    /(?![\t\n])[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/u;

export function hiddenCharacter(text: string): string | null {
    const found = HIDDEN.exec(text)?.[0];
    return found === undefined
        ? null
        : `U+${(found.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")}`;
}

// The frontmatter between the opening --- and the first line that is
// only ---, and the body after it.
export function splitFrontmatter(
    text: string,
): { yaml: string; body: string } | null {
    const whole = text.endsWith("\n") ? text : `${text}\n`;
    if (!whole.startsWith("---\n")) {
        return null;
    }
    const end = whole.indexOf("\n---\n", 3);
    if (end === -1) {
        return null;
    }
    return {
        yaml: whole.slice(4, end + 1),
        body: whole
            .slice(end + 5)
            .replace(/^\n+/, "")
            .trimEnd(),
    };
}

// Words onto lines of at most width code points; a longer word keeps a
// line of its own. Text is normalised first, so no line begins with a
// space and folding gives the text back.
export function wrap(text: string, width: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
        if (line === "") {
            line = word;
        } else if (characters(line) + 1 + characters(word) <= width) {
            line += ` ${word}`;
        } else {
            lines.push(line);
            line = word;
        }
    }
    lines.push(line);
    return lines;
}

// Free text as a chomped folded block scalar: always a string, never
// escaped.
export const folded = (key: string, text: string, indent = ""): string[] => [
    `${indent}${key}: >-`,
    ...wrap(text, 80 - indent.length - 2).map((line) => `${indent}  ${line}`),
];

const json = (value: Extra) => JSON.stringify(value);

export function renderFact(fact: Fact): string {
    const { provenance, retired } = fact;
    return [
        "---",
        `name: ${fact.name}`,
        ...folded("title", fact.title),
        ...folded("description", fact.description),
        "metadata:",
        `  type: ${fact.type}`,
        ...Object.entries(fact.extra).map(
            ([key, value]) => `  ${key}: ${json(value)}`,
        ),
        ...(fact.tags.length === 0
            ? []
            : ["tags:", ...fact.tags.map((id) => `  - ${id}`)]),
        ...(fact.importance === null ? [] : [`importance: ${fact.importance}`]),
        "provenance:",
        `  origin: ${provenance.origin}`,
        `  by: ${provenance.by}`,
        `  at: ${json(provenance.at)}`,
        `  created: ${json(provenance.created)}`,
        ...(provenance.model === undefined
            ? []
            : [`  model: ${json(provenance.model)}`]),
        ...(provenance.from === undefined
            ? []
            : [`  from: ${json(provenance.from)}`]),
        ...(retired === null
            ? []
            : [
                  "retired:",
                  `  at: ${json(retired.at)}`,
                  `  by: ${retired.by}`,
                  ...folded("why", retired.why, "  "),
              ]),
        "---",
        "",
        fact.body,
        "",
    ].join("\n");
}

// A decoded value may hold a character the source spelled as an escape.
function visible(value: string, key: string): void {
    const hidden = hiddenCharacter(value);
    if (hidden !== null) {
        throw new Problem(`${key} holds a hidden character, ${hidden}`);
    }
}

function text(value: unknown, key: string, limit: number): string {
    if (typeof value !== "string") {
        throw new Problem(`${key} is not text`);
    }
    visible(value, key);
    const normal = normalise(value);
    if (normal === "") {
        throw new Problem(`${key} is empty`);
    }
    if (characters(normal) > limit) {
        throw new Problem(
            `${key} is ${characters(normal)} characters, over ${limit}`,
        );
    }
    return normal;
}

function oneOf<T extends string>(
    value: unknown,
    key: string,
    set: readonly T[],
): T {
    if (
        typeof value !== "string" ||
        !(set as readonly string[]).includes(value)
    ) {
        throw new Problem(`${key} is not one of ${set.join(", ")}`);
    }
    return value as T;
}

// The form Date#toISOString writes.
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function time(value: unknown, key: string): string {
    if (
        typeof value !== "string" ||
        !TIME.test(value) ||
        !Number.isFinite(Date.parse(value))
    ) {
        throw new Problem(`${key} is not a time`);
    }
    return value;
}

function only(
    record: Record<string, unknown>,
    keys: readonly string[],
    where: string,
): void {
    const unknown = Object.keys(record).find((key) => !keys.includes(key));
    if (unknown !== undefined) {
        throw new Problem(`${where} has an unknown key, ${unknown}`);
    }
}

const LINK = /\]\(([^)\s]*\.md(?:#[^)\s]*)?)\)/g;
const SIBLING = /^\.\/([^#]*)\.md(?:#[^)\s]*)?$/;

export function checkBody(body: string): string {
    if (characters(body) > FACT_LIMITS.body) {
        throw new Problem(
            `its body is ${characters(body)} characters, over ${FACT_LIMITS.body}`,
        );
    }
    for (const [, target] of body.matchAll(LINK)) {
        const stem = SIBLING.exec(target as string)?.[1];
        if (stem === undefined || !FACT_NAME.test(stem)) {
            throw new Problem(`it links to ${target}, not a fact beside it`);
        }
    }
    return body;
}

// What every fact has, in the store and in a repository.
export function readCommon(
    data: Record<string, unknown>,
    body: string,
    stem?: string,
): Pick<Fact, "name" | "description" | "type" | "extra" | "body"> {
    const { name, metadata } = data;
    if (
        typeof name !== "string" ||
        !FACT_NAME.test(name) ||
        name.length > FACT_LIMITS.name
    ) {
        throw new Problem("name is not a fact's name");
    }
    if (stem !== undefined && name !== stem) {
        throw new Problem(`its name is ${name}, not its file's, ${stem}`);
    }
    if (!isRecord(metadata)) {
        throw new Problem("metadata is not a mapping");
    }
    const type = oneOf(metadata.type, "metadata.type", FACT_TYPES);
    const extra: Record<string, Extra> = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (key === "type") {
            continue;
        }
        if (
            key === "__proto__" ||
            !EXTRA_KEY.test(key) ||
            !(
                typeof value === "string" ||
                typeof value === "boolean" ||
                (typeof value === "number" && Number.isFinite(value))
            )
        ) {
            throw new Problem(
                `metadata.${key} is not text, a number or a boolean`,
            );
        }
        if (typeof value === "string") {
            visible(value, `metadata.${key}`);
        }
        extra[key] = value;
    }
    return {
        name,
        description: text(
            data.description,
            "description",
            FACT_LIMITS.description,
        ),
        type,
        extra,
        body: checkBody(body),
    };
}

const FROM = /^([a-z]+(?:-[a-z]+){3})(?:#[1-9][0-9]*)?$/;

function readProvenance(value: unknown): FactProvenance {
    if (!isRecord(value)) {
        throw new Problem("provenance is not a mapping");
    }
    only(
        value,
        ["origin", "by", "at", "created", "model", "from"],
        "provenance",
    );
    const provenance: FactProvenance = {
        origin: oneOf(value.origin, "provenance.origin", ORIGINS),
        by: oneOf(value.by, "provenance.by", WRITERS),
        at: time(value.at, "provenance.at"),
        created: time(value.created, "provenance.created"),
    };
    if (value.model !== undefined) {
        if (typeof value.model !== "string" || value.model === "") {
            throw new Problem("provenance.model is not text");
        }
        visible(value.model, "provenance.model");
        provenance.model = value.model;
    }
    if (value.from !== undefined) {
        const phrase =
            typeof value.from === "string"
                ? FROM.exec(value.from)?.[1]
                : undefined;
        if (phrase === undefined || !isPhrase(phrase)) {
            throw new Problem("provenance.from is not a conversation");
        }
        provenance.from = value.from as string;
    }
    return provenance;
}

function readRetired(value: unknown): Retired | null {
    if (value === undefined) {
        return null;
    }
    if (!isRecord(value)) {
        throw new Problem("retired is not a mapping");
    }
    only(value, ["at", "by", "why"], "retired");
    return {
        at: time(value.at, "retired.at"),
        by: oneOf(value.by, "retired.by", WRITERS),
        why: text(value.why, "retired.why", FACT_LIMITS.why),
    };
}

const STORE_KEYS = [
    "name",
    "title",
    "description",
    "metadata",
    "tags",
    "importance",
    "provenance",
    "retired",
] as const;

// The frontmatter as YAML, checked for hidden characters first.
export function frontmatterOf(source: string): {
    data: Record<string, unknown>;
    body: string;
} {
    const text = source.replaceAll("\r\n", "\n");
    const hidden = hiddenCharacter(text);
    if (hidden !== null) {
        throw new Problem(`it holds a hidden character, ${hidden}`);
    }
    const parts = splitFrontmatter(text);
    if (parts === null) {
        throw new Problem("it has no frontmatter");
    }
    let data: unknown;
    try {
        data = Bun.YAML.parse(parts.yaml);
    } catch (error) {
        throw new Problem(
            `its frontmatter is not YAML (${error instanceof Error ? error.message : String(error)})`,
        );
    }
    if (!isRecord(data)) {
        throw new Problem("its frontmatter is not a mapping");
    }
    return { data, body: parts.body };
}

function readFact(
    source: string,
    stem: string | undefined,
    provenanceOf: (value: unknown) => FactProvenance,
): Fact {
    const { data, body } = frontmatterOf(source);
    only(data, STORE_KEYS, "its frontmatter");
    const tags = data.tags ?? [];
    if (
        !Array.isArray(tags) ||
        !tags.every((id) => typeof id === "string" && CONCEPT_ID.test(id))
    ) {
        throw new Problem("tags are not concept ids");
    }
    const importance = data.importance ?? null;
    if (
        importance !== null &&
        !(
            typeof importance === "number" &&
            Number.isInteger(importance) &&
            importance >= 1 &&
            importance <= 10
        )
    ) {
        throw new Problem("importance is not a whole number from 1 to 10");
    }
    const common = readCommon(data, body, stem);
    return {
        name: common.name,
        title: text(data.title, "title", FACT_LIMITS.title),
        description: common.description,
        type: common.type,
        extra: common.extra,
        tags: tags as string[],
        importance: importance as number | null,
        provenance: provenanceOf(data.provenance),
        retired: readRetired(data.retired),
        body: common.body,
    };
}

export function parseFact(source: string, stem?: string): FactRead {
    try {
        return { kind: "ok", fact: readFact(source, stem, readProvenance) };
    } catch (error) {
        if (error instanceof Problem) {
            return { kind: "unparseable", reason: error.message };
        }
        throw error;
    }
}

// A fact the user added or edited by hand, rewritten as Dorothy writes
// one and made the user's; null when it is no fact. It may omit
// provenance, which a hand-added fact has none of.
export function handEdited(
    source: string,
    stem: string,
    now: Date,
): string | null {
    const at = now.toISOString();
    try {
        const fact = readFact(source, stem, (value) => {
            const before = value === undefined ? null : readProvenance(value);
            return {
                origin: "user",
                by: "user",
                at,
                created: before?.created ?? at,
                ...(before?.from === undefined ? {} : { from: before.from }),
            };
        });
        return renderFact(fact);
    } catch (error) {
        if (error instanceof Problem) {
            return null;
        }
        throw error;
    }
}

// A later version may lower a fact's origin; only one the user writes
// raises it, to the user's.
export function nextOrigin(
    previous: Origin | null,
    written: Origin,
    by: Writer,
): Origin {
    if (by === "user") {
        return "user";
    }
    if (previous === null) {
        return written;
    }
    return ORIGINS.indexOf(written) < ORIGINS.indexOf(previous)
        ? written
        : previous;
}
