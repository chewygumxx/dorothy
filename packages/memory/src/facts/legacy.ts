// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/facts/legacy.ts
//
//

// The store's form before the Open Knowledge Format: read once by the
// migration, and rendered by its tests.

import { isPhrase } from "@dorothy/core";
import {
    type Extra,
    FACT_LIMITS,
    type Fact,
    type FactProvenance,
    type FactRead,
    folded,
    frontmatterOf,
    isRecord,
    ORIGINS,
    oneOf,
    only,
    Problem,
    readCommon,
    readImportance,
    readRetired,
    readTags,
    text,
    time,
    visible,
    WRITERS,
} from "./file.js";

const json = (value: Extra) => JSON.stringify(value);

export function renderLegacyFact(fact: Fact): string {
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

const KEYS = [
    "name",
    "title",
    "description",
    "metadata",
    "tags",
    "importance",
    "provenance",
    "retired",
] as const;

export function parseLegacyFact(source: string, stem?: string): FactRead {
    try {
        const { data, body } = frontmatterOf(source);
        only(data, KEYS, "its frontmatter");
        const tags = readTags(data.tags);
        const importance = readImportance(data.importance);
        const common = readCommon(data, body, stem);
        return {
            kind: "ok",
            fact: {
                name: common.name,
                title: text(data.title, "title", FACT_LIMITS.title),
                description: common.description,
                type: common.type,
                extra: common.extra,
                tags,
                importance,
                provenance: readProvenance(data.provenance),
                retired: readRetired(data.retired),
                body: common.body,
            },
        };
    } catch (error) {
        if (error instanceof Problem) {
            return { kind: "unparseable", reason: error.message };
        }
        throw error;
    }
}
