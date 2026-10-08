// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/review.ts
//
//

import type { ResumedTurn } from "../contracts/session.js";
import type { StructuredCall } from "../contracts/structured.js";
import { escapeXml, renderClusters, unescapeXml } from "./block.js";
import {
    FIELDS,
    LIMITS,
    type Notes,
    normalise,
    overLimit,
    SERVED,
    type Served,
    type Sidecar,
} from "./sidecar.js";
import { readTagOutput, type TagOutput } from "./tagging.js";
import {
    byLabel,
    type Concept,
    resolveTags,
    TAG_LIMITS,
    type Vocabulary,
} from "./vocabulary.js";

export const REVIEW_TIMEOUT_MS = 120_000;

export const REVIEW_SCHEMA = {
    type: "object",
    properties: {
        title: { type: "string", minLength: 1, maxLength: LIMITS.title },
        description: {
            type: "string",
            minLength: 1,
            maxLength: LIMITS.description,
        },
        abstract: { type: "string", minLength: 1, maxLength: LIMITS.abstract },
    },
    required: ["title", "description", "abstract"],
    additionalProperties: false,
};

export const REVIEW_INSTRUCTIONS = [
    "This time you are not chatting. The message holds one of your",
    "conversations with the user; write notes on it for your future self,",
    "who will see them at the start of later chats. Give a title of at most",
    "60 characters, keeping the current title unless the conversation's main",
    "subject has changed; a title marked provisional was cut from the user's",
    "first message, so replace it. Give one sentence of at most 160",
    "characters describing the conversation, and one paragraph of at most",
    "1,000 characters summarising what was discussed, what was decided and",
    "what was left open, including what you learned about the user. If you",
    "said you were in development mode, say so in the description. A note",
    "marked fixed was written by the user: return it exactly as it is, and",
    "keep your other notes consistent with it. The message escapes &, < and",
    "> as &amp;, &lt; and &gt;; write the notes as plain text, not escaped.",
].join(" ");

export const READS_INSTRUCTION = [
    "For each read listed in <reads>, marked [read id] where it happened,",
    "judge how well what you found served its purpose, by what happened",
    "afterwards: none, slight, useful or essential.",
].join(" ");

export const CLUSTERS_INSTRUCTION = [
    "Its earlier turns are given as your own summaries in <earlier>, as",
    "they were in your context; write your notes on the whole",
    "conversation.",
].join(" ");

export const TAGS_INSTRUCTION = [
    "Give up to 5 tags for the conversation's main subjects, most",
    "important first, using a concept's label, or one of its",
    "alternatives, wherever one fits. Only when none fits, coin a",
    "concept: a label of ideally 12 characters and at most 50,",
    "descriptive on its own, with a sentence of at most 160",
    "characters saying what it covers, and the labels of any broader",
    "concepts. Coin at most 3. Tags marked fixed were set by the",
    "user: return them exactly as they are and coin nothing.",
].join(" ");

const LABEL = {
    type: "string",
    minLength: 1,
    maxLength: TAG_LIMITS.label,
} as const;

export const TAG_PROPERTIES = {
    tags: { type: "array", maxItems: TAG_LIMITS.tags, items: LABEL },
    coined: {
        type: "array",
        maxItems: TAG_LIMITS.coined,
        items: {
            type: "object",
            properties: {
                prefLabel: LABEL,
                altLabel: {
                    type: "array",
                    maxItems: TAG_LIMITS.altLabels,
                    items: LABEL,
                },
                broader: { type: "array", items: LABEL },
                scopeNote: {
                    type: "string",
                    minLength: 1,
                    maxLength: TAG_LIMITS.scopeNote,
                },
            },
            required: ["prefLabel", "scopeNote"],
            additionalProperties: false,
        },
    },
} as const;

// The vocabulary as read for a review, and the concepts she is shown
// from it, in label order.
export type ReviewTags = {
    vocabulary: Vocabulary;
    concepts: readonly [string, Concept][];
};

// A read awaiting Dorothy's appraisal: an open that succeeded.
export type PendingRead = {
    id: string;
    name: string;
    purpose: string;
    turns: [number, number] | null;
};

export function pendingReads(
    turns: readonly ResumedTurn[],
    appraised: Readonly<Record<string, unknown>>,
    nameOf: (phrase: string) => string,
): PendingRead[] {
    return turns.flatMap((turn) =>
        (turn.lookups ?? []).flatMap((lookup) =>
            lookup.tool === "open" &&
            lookup.ok &&
            !Object.hasOwn(appraised, lookup.id)
                ? [
                      {
                          id: lookup.id,
                          name: nameOf(lookup.conversation),
                          purpose: lookup.purpose,
                          turns: lookup.turns,
                      },
                  ]
                : [],
        ),
    );
}

const escapeAttribute = (text: string) =>
    escapeXml(text).replaceAll('"', "&quot;");

// A reply with [read id] where each pending read happened, latest first so
// earlier offsets stay true.
function marked(turn: ResumedTurn, ids: ReadonlySet<string>): string {
    let text = turn.text;
    const marks = (turn.lookups ?? [])
        .filter((lookup) => ids.has(lookup.id))
        .sort((a, b) => b.offset - a.offset);
    for (const mark of marks) {
        const at = Math.min(mark.offset, text.length);
        text = `${text.slice(0, at)}[read ${mark.id}]${text.slice(at)}`;
    }
    return text;
}

export type ReviewOutcome =
    | {
          ok: true;
          notes: Notes;
          appraisals: Record<string, Served>;
          tags?: TagOutput;
          model: string;
          costUsd: number;
      }
    | { ok: false; reason: string; costUsd: number };

// One line per concept she may see; a broader concept she may not see
// is left unnamed.
function conceptLine(tags: ReviewTags, concept: Concept): string {
    const shown = new Set(tags.concepts.map(([id]) => id));
    const broader = concept.broader
        .filter((parent) => shown.has(parent))
        .map(
            (parent) => (tags.vocabulary.concepts[parent] as Concept).prefLabel,
        )
        .sort(byLabel);
    const alt =
        concept.altLabel.length > 0
            ? ` alt="${escapeAttribute(concept.altLabel.join("; "))}"`
            : "";
    const under =
        broader.length > 0
            ? ` broader="${escapeAttribute(broader.join("; "))}"`
            : "";
    return `<concept label="${escapeAttribute(concept.prefLabel)}"${alt}${under}>${escapeXml(concept.scopeNote)}</concept>`;
}

// The conversation's tags by label; the user's set is fixed.
function tagsLine(tags: ReviewTags, current: Sidecar | null): string {
    const labels = resolveTags(tags.vocabulary, current?.tags ?? []).map(
        (id) => (tags.vocabulary.concepts[id] as Concept).prefLabel,
    );
    const mark = current?.fields.tags?.by === "user" ? ' fixed="true"' : "";
    return labels.length === 0
        ? `<tags${mark}/>`
        : `<tags${mark}>${escapeXml(labels.join("; "))}</tags>`;
}

// The conversation, then the notes as they stand, then the earlier titles,
// then the vocabulary when she tags.
export function reviewPrompt(
    turns: readonly ResumedTurn[],
    current: Sidecar | null,
    reads: readonly PendingRead[] = [],
    tags?: ReviewTags,
): string {
    const ids = new Set(reads.map((read) => read.id));
    const clusters = current?.clusters ?? [];
    const covered = clusters.at(-1)?.through ?? 0;
    const earlier =
        clusters.length === 0 ? [] : [...renderClusters(clusters), ""];
    const conversation = [
        ...earlier,
        turns
            .slice(covered)
            .map(
                (turn) =>
                    `${turn.role === "user" ? "User" : "Dorothy"}: ${escapeXml(marked(turn, ids))}`,
            )
            .join("\n\n"),
    ].join("\n");
    const notes = [
        ...FIELDS.map((field) => {
            const value = current?.[field] ?? null;
            if (value === null) {
                return `<${field}/>`;
            }
            const by = current?.fields[field]?.by;
            const mark =
                by === "user"
                    ? ' fixed="true"'
                    : by === "prompt"
                      ? ' provisional="true"'
                      : "";
            return `<${field}${mark}>${escapeXml(value)}</${field}>`;
        }),
        ...(tags === undefined ? [] : [tagsLine(tags, current)]),
    ];
    const titles = (current?.titles ?? []).map(
        (past) => `<title>${escapeXml(past.title)}</title>`,
    );
    return [
        "<conversation>",
        conversation,
        "</conversation>",
        ...(reads.length > 0
            ? [
                  "",
                  "Your reads during it, to appraise:",
                  "<reads>",
                  ...reads.map(
                      (read) =>
                          `<read id="${escapeAttribute(read.id)}" conversation="${escapeAttribute(read.name)}"${
                              read.turns === null
                                  ? ""
                                  : ` turns="${read.turns[0]}-${read.turns[1]}"`
                          }>${escapeXml(read.purpose)}</read>`,
                  ),
                  "</reads>",
              ]
            : []),
        "",
        "Your current notes on it:",
        "<notes>",
        ...notes,
        "</notes>",
        ...(titles.length > 0
            ? [
                  "",
                  "Its earlier titles, oldest first:",
                  "<titles>",
                  ...titles,
                  "</titles>",
              ]
            : []),
        ...(tags === undefined
            ? []
            : [
                  "",
                  "The concepts you tag with:",
                  ...(tags.concepts.length === 0
                      ? ["<vocabulary/>"]
                      : [
                            "<vocabulary>",
                            ...tags.concepts.map(([, concept]) =>
                                conceptLine(tags, concept),
                            ),
                            "</vocabulary>",
                        ]),
              ]),
    ].join("\n");
}

// The schema already asked for this; the model's output is checked again.
export function validateNotes(
    output: unknown,
): { ok: true; notes: Notes } | { ok: false; reason: string } {
    if (typeof output !== "object" || output === null) {
        return { ok: false, reason: "no notes in the result" };
    }
    const notes: Partial<Notes> = {};
    for (const field of FIELDS) {
        const value = (output as Record<string, unknown>)[field];
        if (typeof value !== "string") {
            return { ok: false, reason: `no ${field} in the notes` };
        }
        const text = normalise(unescapeXml(value));
        if (text === "") {
            return { ok: false, reason: `the ${field} is empty` };
        }
        const problem = overLimit(field, text);
        if (problem !== null) {
            return { ok: false, reason: problem };
        }
        notes[field] = text;
    }
    return { ok: true, notes: notes as Notes };
}

// One appraisal per read, exactly: the schema makes it a constraint, not
// a request. While she tags, tags and coined concepts are asked for too.
export function reviewSchema(
    readIds: readonly string[],
    tagging = false,
): Record<string, unknown> {
    const base = tagging
        ? {
              ...REVIEW_SCHEMA,
              properties: { ...REVIEW_SCHEMA.properties, ...TAG_PROPERTIES },
              required: [...REVIEW_SCHEMA.required, "tags", "coined"],
          }
        : REVIEW_SCHEMA;
    if (readIds.length === 0) {
        return base;
    }
    return {
        ...base,
        properties: {
            ...base.properties,
            appraisals: {
                type: "array",
                minItems: readIds.length,
                maxItems: readIds.length,
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string", enum: [...readIds] },
                        served: { type: "string", enum: [...SERVED] },
                    },
                    required: ["id", "served"],
                    additionalProperties: false,
                },
            },
        },
        required: [...base.required, "appraisals"],
    };
}

export function validateReview(
    output: unknown,
    readIds: readonly string[] = [],
    tagging = false,
):
    | {
          ok: true;
          notes: Notes;
          appraisals: Record<string, Served>;
          tags?: TagOutput;
      }
    | { ok: false; reason: string } {
    const checked = validateNotes(output);
    if (!checked.ok) {
        return checked;
    }
    const tags = tagging ? { tags: readTagOutput(output) } : {};
    if (readIds.length === 0) {
        return { ...checked, appraisals: {}, ...tags };
    }
    const list = (output as Record<string, unknown>).appraisals;
    if (!Array.isArray(list)) {
        return { ok: false, reason: "no appraisals in the notes" };
    }
    const appraisals: Record<string, Served> = {};
    for (const item of list) {
        const { id, served } = (item ?? {}) as Record<string, unknown>;
        if (typeof id !== "string" || !readIds.includes(id)) {
            return { ok: false, reason: "an appraisal names no read" };
        }
        if (Object.hasOwn(appraisals, id)) {
            return { ok: false, reason: `${id} is appraised twice` };
        }
        if (!SERVED.includes(served as Served)) {
            return {
                ok: false,
                reason: `${id} is not appraised as none, slight, useful or essential`,
            };
        }
        appraisals[id] = served as Served;
    }
    if (Object.keys(appraisals).length !== readIds.length) {
        return { ok: false, reason: "not every read is appraised" };
    }
    return { ...checked, appraisals, ...tags };
}

// A one-shot query on Dorothy's model and persona, answering with notes.
export async function runReview({
    call,
    systemPrompt,
    prompt,
    signal,
    timeoutMs = REVIEW_TIMEOUT_MS,
    schema = REVIEW_SCHEMA,
    readIds = [],
    tagging = false,
}: {
    call: StructuredCall;
    systemPrompt: string;
    prompt: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    schema?: Record<string, unknown>;
    readIds?: readonly string[];
    tagging?: boolean;
}): Promise<ReviewOutcome> {
    const outcome = await call({
        what: "review",
        system: systemPrompt,
        prompt,
        schema,
        timeoutMs,
        ...(signal === undefined ? {} : { signal }),
    });
    if (!outcome.ok) {
        return outcome;
    }
    const checked = validateReview(outcome.output, readIds, tagging);
    return checked.ok
        ? {
              ok: true,
              notes: checked.notes,
              appraisals: checked.appraisals,
              ...(checked.tags === undefined ? {} : { tags: checked.tags }),
              model: outcome.model,
              costUsd: outcome.costUsd,
          }
        : { ok: false, reason: checked.reason, costUsd: outcome.costUsd };
}
