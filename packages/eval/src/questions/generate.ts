// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/generate.ts
//
//

// Questions a model drafts from samples of the snapshot, in LongMemEval's
// types, each checked before it is kept as a draft for the owner.

import type {
    ArchiveConversation,
    ArchiveKnowledge,
} from "@dorothy/memory/evaluation";
import { z } from "zod";
import { RunStop, UsageError } from "../errors.js";
import { failureOf, type Message } from "../models/client.js";
import {
    type Corpus,
    clip,
    conversationText,
    knowledgeText,
} from "../systems/corpus.js";
import { packItems } from "../systems/system.js";
import { scoreOf, termsOf } from "../systems/terms.js";
import {
    type Question,
    type QuestionType,
    questionId,
    questionSchema,
    sameQuestion,
} from "./file.js";

export type GeneratedType = Exclude<QuestionType, "lookup">;

// LongMemEval-S's 500 questions by type, with its 30 abstentions beside.
export const SHARES: Record<GeneratedType, number> = {
    "single-session": 126,
    preference: 30,
    "multi-session": 133,
    "knowledge-update": 78,
    temporal: 133,
    abstention: 30,
};
export const GENERATED_TYPES = Object.keys(SHARES) as GeneratedType[];
// Questions asked of one sample in one call.
export const BATCH = 5;

// count questions among the types by LongMemEval-S's shares: each type's
// share rounded down, the questions left over going to the largest
// fractions (the earlier type on a tie), so the total is count. A type
// in given has its own count instead.
export function countsFor(
    count: number,
    given: Partial<Record<GeneratedType, number>> = {},
): Record<GeneratedType, number> {
    const total = Object.values(SHARES).reduce((sum, each) => sum + each, 0);
    const exact = GENERATED_TYPES.map((type) => (count * SHARES[type]) / total);
    const counts = exact.map(Math.floor);
    const left = count - counts.reduce((sum, each) => sum + each, 0);
    const byFraction = exact
        .map((each, at) => ({ at, fraction: each - Math.floor(each) }))
        .sort((a, b) => b.fraction - a.fraction || a.at - b.at);
    for (const { at } of byFraction.slice(0, left)) {
        counts[at] = (counts[at] as number) + 1;
    }
    return Object.fromEntries(
        GENERATED_TYPES.map((type, at) => [
            type,
            given[type] ?? (counts[at] as number),
        ]),
    ) as Record<GeneratedType, number>;
}

export function parseTypeCounts(
    values: readonly string[],
): Partial<Record<GeneratedType, number>> {
    const counts: Partial<Record<GeneratedType, number>> = {};
    for (const value of values) {
        const match = /^([a-z-]+)=(\d{1,4})$/.exec(value);
        const type = match?.[1] as GeneratedType | undefined;
        if (match === null || type === undefined || !(type in SHARES)) {
            throw new UsageError(
                `--type takes ${GENERATED_TYPES.join(", ")}, each as type=count`,
            );
        }
        counts[type] = Number(match[2]);
    }
    return counts;
}

// mulberry32: small, and the same everywhere for a seed.
export function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const pick = <T>(items: readonly T[], random: () => number): T | undefined =>
    items[Math.floor(random() * items.length)];

function shuffled<T>(items: readonly T[], random: () => number): T[] {
    const copy = [...items];
    for (let at = copy.length - 1; at > 0; at--) {
        const other = Math.floor(random() * (at + 1));
        [copy[at], copy[other]] = [copy[other] as T, copy[at] as T];
    }
    return copy;
}

export type Sample = {
    type: GeneratedType;
    // What the model reads.
    items: { id: string; text: string }[];
    // What evidence may name.
    ids: string[];
    asOf: string;
    project: string | null;
    // Guidance of its own, where its type's would not fit its items.
    guidance?: string;
};

// Conversations by a project or a tag they share, two or more a group.
function groupsOf(conversations: ArchiveConversation[]) {
    const groups = new Map<string, ArchiveConversation[]>();
    for (const conversation of conversations) {
        const keys = [
            ...(conversation.project === null
                ? []
                : [`project:${conversation.project}`]),
            ...conversation.tags.map((tag) => `tag:${tag}`),
        ];
        for (const key of keys) {
            groups.set(key, [...(groups.get(key) ?? []), conversation]);
        }
    }
    return new Map(
        [...groups].filter(([, members]) => members.length >= 2).sort(),
    );
}

const projectOf = (key: string) =>
    key.startsWith("project:") ? key.slice("project:".length) : null;

// Where an update may be drawn from: a retired file beside the live files
// of its scope and type, one of which may have replaced it; or the
// latest conversation of a project or tag beside those of it that ended
// before it began, which it may revise. The latest, so that its answer
// is what is still true.
type UpdateSource =
    | { kind: "retired"; retired: ArchiveKnowledge; live: ArchiveKnowledge[] }
    | {
          kind: "revised";
          key: string;
          later: ArchiveConversation;
          earlier: ArchiveConversation[];
      };

// What sampling needs of a corpus, worked out once for it rather than
// on every try.
type Material = {
    groups: Map<string, ArchiveConversation[]>;
    updates: UpdateSource[];
};
const materials = new WeakMap<Corpus, Material>();

function materialOf(corpus: Corpus): Material {
    const known = materials.get(corpus);
    if (known !== undefined) {
        return known;
    }
    const knowledge = [...corpus.knowledge.values()];
    const groups = groupsOf([...corpus.conversations.values()]);
    const kindOf = (each: ArchiveKnowledge) => `${each.scope}\t${each.type}`;
    const live = new Map<string, ArchiveKnowledge[]>();
    for (const each of knowledge) {
        if (each.retired === null) {
            live.set(kindOf(each), [...(live.get(kindOf(each)) ?? []), each]);
        }
    }
    const updates: UpdateSource[] = [
        ...knowledge.flatMap((retired): UpdateSource[] => {
            const peers = live.get(kindOf(retired)) ?? [];
            return retired.retired === null || peers.length === 0
                ? []
                : [{ kind: "retired", retired, live: peers }];
        }),
        ...[...groups].flatMap(([key, members]): UpdateSource[] => {
            const later = members.reduce((a, b) =>
                b.firstAt > a.firstAt ? b : a,
            );
            const earlier = members.filter(
                (each) => each.lastAt < later.firstAt,
            );
            return earlier.length === 0
                ? []
                : [{ kind: "revised", key, later, earlier }];
        }),
    ];
    const made = { groups, updates };
    materials.set(corpus, made);
    return made;
}

function updateSample(
    source: UpdateSource,
    random: () => number,
    today: string,
): Sample {
    if (source.kind === "retired") {
        const live = shuffled(source.live, random).slice(0, 6);
        return {
            type: "knowledge-update",
            items: [source.retired, ...live].map((each) => ({
                id: each.id,
                text: knowledgeText(each),
            })),
            // The retired file is never the answer's evidence.
            ids: live.map((each) => each.id),
            asOf: today,
            project:
                source.retired.scope === "personal"
                    ? null
                    : source.retired.scope,
        };
    }
    const earlier = pick(source.earlier, random) as ArchiveConversation;
    return {
        type: "knowledge-update",
        items: [earlier, source.later].map((each) => ({
            id: each.id,
            text: clip(conversationText(each), 7000),
        })),
        // The earlier is never the answer's evidence.
        ids: [source.later.id],
        asOf: today,
        project: projectOf(source.key),
        guidance: REVISED_GUIDANCE,
    };
}

export function sampleFor(
    type: GeneratedType,
    corpus: Corpus,
    random: () => number,
    today: string,
): Sample | null {
    const conversations = [...corpus.conversations.values()];
    const knowledge = [...corpus.knowledge.values()];
    switch (type) {
        case "single-session":
        case "temporal": {
            const chosen = pick(
                conversations.filter((each) => each.turns.length >= 2),
                random,
            );
            return chosen === undefined
                ? null
                : {
                      type,
                      items: [
                          {
                              id: chosen.id,
                              text: clip(conversationText(chosen), 12_000),
                          },
                      ],
                      ids: [chosen.id],
                      asOf: today,
                      project: chosen.project,
                  };
        }
        case "preference": {
            const chosen = shuffled(
                knowledge.filter(
                    (each) =>
                        each.retired === null &&
                        each.scope === "personal" &&
                        (each.type === "user" || each.type === "feedback"),
                ),
                random,
            ).slice(0, 8);
            return chosen.length === 0
                ? null
                : {
                      type,
                      items: chosen.map((each) => ({
                          id: each.id,
                          text: knowledgeText(each),
                      })),
                      ids: chosen.map((each) => each.id),
                      asOf: today,
                      project: null,
                  };
        }
        case "multi-session": {
            const { groups } = materialOf(corpus);
            const key = pick([...groups.keys()], random);
            if (key === undefined) {
                return null;
            }
            const chosen = shuffled(groups.get(key) ?? [], random).slice(0, 3);
            return {
                type,
                items: chosen.map((each) => ({
                    id: each.id,
                    text: clip(conversationText(each), 5000),
                })),
                ids: chosen.map((each) => each.id),
                asOf: today,
                project: projectOf(key),
            };
        }
        case "knowledge-update": {
            // Every retired file and revising conversation alike, so each
            // source is drawn by how much of it the snapshot holds.
            const source = pick(materialOf(corpus).updates, random);
            return source === undefined
                ? null
                : updateSample(source, random, today);
        }
        case "abstention": {
            const titles = [
                ...conversations.map((each) => each.title ?? ""),
                ...knowledge.map((each) => each.title),
            ].filter((title) => title !== "");
            return {
                type,
                items: [
                    {
                        id: "topics",
                        text: shuffled(titles, random).slice(0, 80).join("\n"),
                    },
                ],
                ids: [],
                asOf: today,
                project: null,
            };
        }
    }
}

export type Draft = {
    question: string;
    answer: string;
    evidence: string[];
    older: string;
};
// Every field required, as strict structured output asks.
export const draftsSchema = z.object({
    questions: z.array(
        z.object({
            question: z.string(),
            answer: z.string(),
            evidence: z.array(z.string()),
            older: z.string(),
        }),
    ),
});

const COMMON = [
    "You write questions for testing a personal memory: an assistant's",
    "memory of its past conversations with its user and of what it knows",
    "of them. Write questions the user might really ask the assistant",
    "later, in their own voice, answerable only from the items given. Each",
    "question has: question; answer, short and complete; evidence, the ids",
    "of the items that hold the answer; and older, empty unless the",
    "guidance below asks for it.",
].join(" ");

const GUIDANCE: Record<GeneratedType, string> = {
    "single-session":
        "Ask about one specific detail stated in this conversation.",
    temporal:
        "Ask when something happened, the order of events, or how long passed between them; the answer is a date, an order or a span, read from the dated turns.",
    preference:
        "Ask for advice or a recommendation whose best answer depends on one of these preferences, without naming it. The answer says what a good reply takes into account.",
    "multi-session":
        "Ask something whose answer needs details from at least two of these conversations, and give each one's id in evidence.",
    "knowledge-update":
        "The first item was retired. If one of the others replaced it, ask what is true now: the answer is the newer fact, evidence its id, and older the retired fact's claim. If none replaced it, return no questions.",
    abstention:
        "These are the topics the memory holds. Ask questions about the user's life that sound plausible but that nothing here could answer. The answer says the memory does not know; evidence is empty.",
};

// For an update drawn from two conversations rather than a retired file.
const REVISED_GUIDANCE =
    "The first conversation is the earlier; the later is the latest of its project or tag. The later conversation may change something the earlier one said: a fact, a decision, a plan or a preference. If it does, ask what is true now: the answer is the later's, evidence the later conversation's id, and older the earlier claim. If it changes nothing, return no questions.";

export function draftPrompt(sample: Sample, n: number): Message[] {
    return [
        {
            role: "system",
            content: `${COMMON}\n\n${sample.guidance ?? GUIDANCE[sample.type]}\n\nToday is ${sample.asOf}. Write at most ${n} questions.`,
        },
        { role: "user", content: packItems(sample.items, 16_000) },
    ];
}

// Whether the snapshot holds enough of a question's terms together for
// it to be answerable; such an abstention is dropped.
export function answerable(question: string, corpus: Corpus): boolean {
    const terms = termsOf(question);
    if (terms.length === 0) {
        return false;
    }
    // Half the terms, two at the least; a question of one term needs it.
    const enough = Math.min(
        terms.length,
        Math.max(2, Math.ceil(terms.length / 2)),
    );
    for (const conversation of corpus.conversations.values()) {
        if (
            conversation.turns.some(
                (turn) => scoreOf(turn.text, terms) >= enough,
            )
        ) {
            return true;
        }
    }
    for (const knowledge of corpus.knowledge.values()) {
        if (scoreOf(knowledgeText(knowledge), terms) >= enough) {
            return true;
        }
    }
    return false;
}

export function acceptDraft(
    draft: Draft,
    sample: Sample,
    context: { model: string; ids: Map<string, Question>; corpus: Corpus },
): Question | string {
    const question = draft.question.trim();
    const answer = draft.answer.trim();
    if (question === "" || answer === "") {
        return "empty";
    }
    const abstention = sample.type === "abstention";
    const evidence = abstention ? [] : [...new Set(draft.evidence)];
    if (evidence.some((id) => !sample.ids.includes(id))) {
        return "evidence not in its sample";
    }
    if (!abstention && evidence.length === 0) {
        return "no evidence";
    }
    if (sample.type === "multi-session" && evidence.length < 2) {
        return "one conversation";
    }
    if (abstention && answerable(question, context.corpus)) {
        return "answerable";
    }
    // An update with nothing it replaced is a plain recall question
    // under the wrong type.
    const older = draft.older.trim();
    if (sample.type === "knowledge-update" && older === "") {
        return "no older claim";
    }
    const id = questionId(question, evidence);
    const held = context.ids.get(id);
    if (held !== undefined) {
        // The id is 32 bits of a hash: the same id may be another question.
        return sameQuestion(held, { question, evidence })
            ? "duplicate"
            : "id collision";
    }
    const parsed = questionSchema.safeParse({
        id,
        type: sample.type,
        question,
        answer,
        evidence,
        exclude: null,
        asOf: sample.asOf,
        project: sample.project,
        source: `generated:${context.model}`,
        status: "draft",
        note: sample.type === "knowledge-update" ? older : null,
    });
    return parsed.success ? parsed.data : "malformed";
}

export async function generateQuestions(options: {
    corpus: Corpus;
    counts: Record<GeneratedType, number>;
    random: () => number;
    model: string;
    existing: Question[];
    today: string;
    draft: (sample: Sample, n: number) => Promise<Draft[]>;
    // Takes each call's drafts as they arrive, so that stopping loses
    // none; if it fails, generation stops and hands them back unkept.
    keep?: (drafts: Question[]) => Promise<void>;
}): Promise<{
    made: Question[];
    unkept: Question[];
    dropped: Record<string, number>;
    stopped: string | null;
}> {
    const ids = new Map(
        options.existing.map((question) => [question.id, question]),
    );
    const made: Question[] = [];
    const dropped: Record<string, number> = {};
    const drop = (reason: string) => {
        dropped[reason] = (dropped[reason] ?? 0) + 1;
    };
    const stop = (stopped: string, unkept: Question[] = []) => ({
        made,
        unkept,
        dropped,
        stopped,
    });
    // Calls failed in a row; any call that returns resets it.
    let failures = 0;
    for (const type of GENERATED_TYPES) {
        const want = options.counts[type];
        let have = 0;
        // A sample may give nothing; three tries a batch, then move on.
        const tries = Math.ceil(want / BATCH) * 3;
        for (let tried = 0; have < want && tried < tries; tried++) {
            const sample = sampleFor(
                type,
                options.corpus,
                options.random,
                options.today,
            );
            if (sample === null) {
                drop(`no material for ${type}`);
                break;
            }
            const n = Math.min(BATCH, want - have);
            let drafts: Draft[];
            try {
                drafts = await options.draft(sample, n);
                failures = 0;
            } catch (error) {
                if (error instanceof RunStop) {
                    return stop(error.message);
                }
                const why = failureOf(error);
                drop(`failed call: ${why}`);
                failures++;
                const status = (error as { status?: unknown } | null)?.status;
                if (status === 401 || status === 403 || failures >= 3) {
                    return stop(`the generating model failed: ${why}`);
                }
                continue;
            }
            if (drafts.length === 0) {
                drop("reply with no questions");
            }
            const accepted: Question[] = [];
            for (const each of drafts.slice(0, n)) {
                const kept = acceptDraft(each, sample, {
                    model: options.model,
                    ids,
                    corpus: options.corpus,
                });
                if (typeof kept === "string") {
                    drop(kept);
                    continue;
                }
                ids.set(kept.id, kept);
                accepted.push(kept);
            }
            made.push(...accepted);
            have += accepted.length;
            if (accepted.length > 0) {
                try {
                    await options.keep?.(accepted);
                } catch (error) {
                    return stop(
                        `could not keep the drafts: ${failureOf(error)}`,
                        accepted,
                    );
                }
            }
        }
    }
    return { made, unkept: [], dropped, stopped: null };
}

// The day of the snapshot's last turn: questions are asked as of then.
export function latestDay(corpus: Corpus): string | null {
    let latest: string | null = null;
    for (const conversation of corpus.conversations.values()) {
        if (latest === null || conversation.lastAt > latest) {
            latest = conversation.lastAt;
        }
    }
    return latest?.slice(0, 10) ?? null;
}
