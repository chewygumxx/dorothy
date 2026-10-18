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

import type { ArchiveConversation } from "@dorothy/memory/evaluation";
import { z } from "zod";
import { UsageError } from "../errors.js";
import { CallCap, failureOf, type Message } from "../models/client.js";
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

export function countsFor(
    count: number,
    given: Partial<Record<GeneratedType, number>> = {},
): Record<GeneratedType, number> {
    const total = Object.values(SHARES).reduce((sum, each) => sum + each, 0);
    return Object.fromEntries(
        GENERATED_TYPES.map((type) => [
            type,
            given[type] ?? Math.round((count * SHARES[type]) / total),
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
            const groups = groupsOf(conversations);
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
                project: key.startsWith("project:")
                    ? key.slice("project:".length)
                    : null,
            };
        }
        case "knowledge-update": {
            const retired = pick(
                knowledge.filter((each) => each.retired !== null),
                random,
            );
            if (retired === undefined) {
                return null;
            }
            const live = shuffled(
                knowledge.filter(
                    (each) =>
                        each.retired === null &&
                        each.scope === retired.scope &&
                        each.type === retired.type,
                ),
                random,
            ).slice(0, 6);
            return live.length === 0
                ? null
                : {
                      type,
                      items: [retired, ...live].map((each) => ({
                          id: each.id,
                          text: knowledgeText(each),
                      })),
                      // The retired file is never the answer's evidence.
                      ids: live.map((each) => each.id),
                      asOf: today,
                      project:
                          retired.scope === "personal" ? null : retired.scope,
                  };
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

export function draftPrompt(sample: Sample, n: number): Message[] {
    return [
        {
            role: "system",
            content: `${COMMON}\n\n${GUIDANCE[sample.type]}\n\nToday is ${sample.asOf}. Write at most ${n} questions.`,
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
    const enough = Math.max(2, Math.ceil(terms.length / 2));
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
    context: { model: string; ids: Set<string>; corpus: Corpus },
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
    const id = questionId(question, evidence);
    if (context.ids.has(id)) {
        return "duplicate";
    }
    const older = draft.older.trim();
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
        note: sample.type === "knowledge-update" && older !== "" ? older : null,
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
}): Promise<{
    made: Question[];
    dropped: Record<string, number>;
    stopped: string | null;
}> {
    const ids = new Set(options.existing.map((question) => question.id));
    const made: Question[] = [];
    const dropped: Record<string, number> = {};
    const drop = (reason: string) => {
        dropped[reason] = (dropped[reason] ?? 0) + 1;
    };
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
                if (error instanceof CallCap) {
                    return { made, dropped, stopped: error.message };
                }
                const why = failureOf(error);
                drop(`failed call: ${why}`);
                failures++;
                const status = (error as { status?: unknown } | null)?.status;
                if (status === 401 || status === 403 || failures >= 3) {
                    return {
                        made,
                        dropped,
                        stopped: `the generating model failed: ${why}`,
                    };
                }
                continue;
            }
            for (const each of drafts.slice(0, n)) {
                const accepted = acceptDraft(each, sample, {
                    model: options.model,
                    ids,
                    corpus: options.corpus,
                });
                if (typeof accepted === "string") {
                    drop(accepted);
                    continue;
                }
                ids.add(accepted.id);
                made.push(accepted);
                have++;
            }
        }
    }
    return { made, dropped, stopped: null };
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
