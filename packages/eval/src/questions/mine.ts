// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/mine.ts
//
//

// Questions her data already answers: each read her review judged useful
// or essential is a real query, her purpose, with a known answer, what
// she opened. They score retrieval alone, as they have no reference
// answer, and the conversation she read from is left out of retrieval.

import { type AppraisedRead, openArchive } from "@dorothy/memory/evaluation";
import { type Command, workOf } from "../command.js";
import { readSnapshot, workEnv } from "../snapshot/snapshot.js";
import {
    mergeQuestions,
    type Question,
    questionId,
    questionSchema,
    readQuestionsToRewrite,
    writeQuestions,
} from "./file.js";

export function lookupQuestions(
    reads: AppraisedRead[],
    projects: Map<string, string | null>,
    present: Set<string>,
): Question[] {
    const made = new Map<string, Question>();
    for (const read of reads) {
        const question = read.purpose.trim();
        if (
            question === "" ||
            read.target === `c:${read.reader}` ||
            !present.has(read.target)
        ) {
            continue;
        }
        const evidence = [read.target];
        const id = questionId(question, evidence);
        const parsed = questionSchema.safeParse({
            id,
            type: "lookup",
            question,
            answer: null,
            evidence,
            exclude: read.reader,
            asOf: read.at.slice(0, 10),
            project: projects.get(read.reader) ?? null,
            source: "mined",
            status: "accepted",
            note: null,
        });
        if (parsed.success && !made.has(id)) {
            made.set(id, parsed.data);
        }
    }
    return [...made.values()];
}

export const mineCommand: Command = {
    summary: "make lookup questions from her appraised reads",
    options: { work: { type: "string" } },
    async run(values, _positionals, io) {
        const work = workOf(values);
        await readSnapshot(work);
        const existing = await readQuestionsToRewrite(work);
        const archive = await openArchive(workEnv(work));
        try {
            const conversations = archive.conversations();
            const projects = new Map(
                conversations.map(
                    (each) => [each.phrase, each.project] as const,
                ),
            );
            // A hidden conversation or a retired file is in no system's
            // reach, so a question on it would measure nothing.
            const present = new Set([
                ...conversations.map((each) => each.id),
                ...(await archive.knowledge())
                    .filter((each) => each.retired === null)
                    .map((each) => each.id),
            ]);
            const mined = lookupQuestions(
                await archive.appraisedReads(),
                projects,
                present,
            );
            const merged = mergeQuestions(existing, mined);
            await writeQuestions(work, merged.questions);
            io.out(
                `mined ${mined.length} lookups, ${merged.added} new; ${merged.questions.length} questions in all\n`,
            );
            return 0;
        } finally {
            archive.close();
        }
    },
};
