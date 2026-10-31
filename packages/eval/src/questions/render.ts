// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/render.ts
//
//

// The drafts as Markdown for an agent to screen, and the owner's
// spot-check of what the agents decided: the way into review's --apply
// and out of it. Both only read the work directory.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomic } from "../files.js";
import { workEnv } from "../snapshot/snapshot.js";
import { openCorpus } from "../systems/corpus.js";
import { type Question, readQuestionsToRewrite } from "./file.js";
import { describeEvidence, EVIDENCE_CHARS, readReviews } from "./review.js";

// The drafts of a source as review --render names it: `generated:` is
// understood where a model's name is given bare.
const sourceOf = (source: string) =>
    source.includes(":") ? source : `generated:${source}`;

// The question, its answer and its older claim, as lines.
const fields = (question: Question, noted: string) => [
    `Q: ${question.question}`,
    `A: ${question.answer ?? "(none)"}`,
    ...(question.note === null ? [] : [`${noted}: ${question.note}`]),
];

// Sizes of `parts` contiguous parts of `total`, the larger first.
function sizesOf(total: number, parts: number): number[] {
    const each = Math.floor(total / parts);
    const more = total % parts;
    return Array.from({ length: parts }, (_, at) => each + (at < more ? 1 : 0));
}

// Writes the drafts, with the evidence the question cites, in
// <dir>/drafts-<k>.md, k from 1; the sizes of the files. Nothing, not
// the directory, is made when there are no drafts.
export async function renderDrafts(
    work: string,
    dir: string,
    opts: { batches: number; source: string | null; chars: number },
): Promise<number[]> {
    const wanted = opts.source === null ? null : sourceOf(opts.source);
    const drafts = (await readQuestionsToRewrite(work)).filter(
        (question) =>
            question.status === "draft" &&
            (wanted === null || question.source === wanted),
    );
    if (drafts.length === 0) {
        return [];
    }
    const sizes = sizesOf(drafts.length, Math.min(opts.batches, drafts.length));
    const corpus = await openCorpus(workEnv(work));
    try {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        let first = 0;
        for (const [k, size] of sizes.entries()) {
            const blocks = drafts
                .slice(first, first + size)
                .map((question, at) =>
                    [
                        `## Draft ${first + at + 1} of ${drafts.length}: id ${question.id}`,
                        `Type: ${question.type}; asked ${question.asOf}; project: ${question.project ?? "none"}`,
                        ...fields(question, "Older claim (note)"),
                        "Evidence:",
                        describeEvidence(question, corpus, opts.chars),
                        "",
                    ].join("\n"),
                );
            await writeAtomic(
                join(dir, `drafts-${k + 1}.md`),
                blocks.join("\n"),
            );
            first += size;
        }
    } finally {
        corpus.close();
    }
    return sizes;
}

// A shuffle by Fisher and Yates, of a copy.
function shuffled<T>(items: T[], random: () => number): T[] {
    const copy = [...items];
    for (let at = copy.length - 1; at > 0; at--) {
        const other = Math.floor(random() * (at + 1));
        [copy[at], copy[other]] = [copy[other] as T, copy[at] as T];
    }
    return copy;
}

// The drafts the agents left, and a sample of each reviewer's accepts,
// into a file for the owner. A reviewer's accepts are the questions it
// accepted or edited (the edit by the id it gave) that are accepted now,
// each one with the first reviewer to name it.
export async function spotCheck(
    work: string,
    file: string,
    opts: { per: number; random: () => number },
): Promise<{ unsure: number; sampled: number }> {
    const questions = await readQuestionsToRewrite(work);
    const accepted = new Map(
        questions
            .filter((question) => question.status === "accepted")
            .map((question) => [question.id, question]),
    );
    // Each reviewer's questions, by the way it decided them, in the log's
    // order of reviewers and of decisions.
    const byReviewer = new Map<string, Map<string, string>>();
    const claimed = new Set<string>();
    for (const entry of await readReviews(work)) {
        if (entry.decision !== "accept" && entry.decision !== "edit") {
            continue;
        }
        const id = entry.newId ?? entry.id;
        const held =
            byReviewer.get(entry.reviewer) ?? new Map<string, string>();
        byReviewer.set(entry.reviewer, held);
        if (accepted.has(id) && (held.has(id) || !claimed.has(id))) {
            claimed.add(id);
            held.set(
                id,
                `${entry.reviewer} (${entry.decision}${entry.reason === "" ? "" : `: ${entry.reason}`})`,
            );
        }
    }
    const sample = [...byReviewer.values()].flatMap((held) =>
        shuffled([...held.entries()], opts.random).slice(0, opts.per),
    );
    const drafts = questions.filter((question) => question.status === "draft");
    const corpus = await openCorpus(workEnv(work));
    try {
        const block = (question: Question, label: string, decided: string) =>
            [
                `## ${label}: ${question.id} (${question.type}, by ${question.source})`,
                decided,
                ...fields(question, "Older claim"),
                "Evidence:",
                describeEvidence(question, corpus, EVIDENCE_CHARS),
                "",
            ].join("\n");
        const text = [
            "# Spot-check: overturn an accept with review --reopen <id> --reason <why>",
            "",
            ...drafts.map((question, at) =>
                block(
                    question,
                    `Unsure ${at + 1}`,
                    "Left for you: the agent was unsure.",
                ),
            ),
            ...sample.map(([id, how], at) =>
                block(
                    accepted.get(id) as Question,
                    `Sample ${at + 1}`,
                    `Decided by ${how}`,
                ),
            ),
        ].join("\n");
        await writeAtomic(file, text);
    } finally {
        corpus.close();
    }
    return { unsure: drafts.length, sampled: sample.length };
}
