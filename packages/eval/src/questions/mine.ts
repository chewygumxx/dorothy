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

// The reads that make questions, and the reads dropped for a reason
// worth saying. A read passed over as the spec says (of its own reader,
// of what no system reaches, with no purpose or a repeat) is not
// counted. A question has one `exclude`: a purpose read from the same
// target by several conversations keeps the first's.
const HIDDEN_READER = "a read by a hidden or absent conversation";

export function lookupQuestions(
    reads: AppraisedRead[],
    projects: Map<string, string | null>,
    present: Set<string>,
): { questions: Question[]; dropped: Record<string, number> } {
    const made = new Map<string, Question>();
    const dropped: Record<string, number> = {};
    const drop = (reason: string) => {
        dropped[reason] = (dropped[reason] ?? 0) + 1;
    };
    for (const read of reads) {
        const question = read.purpose.trim();
        if (
            question === "" ||
            read.target === `c:${read.reader}` ||
            !present.has(read.target)
        ) {
            continue;
        }
        // Hidden conversations are not in the snapshot's list, so neither
        // is their project: asked in none, the question would score
        // differently from the one she met.
        if (!projects.has(read.reader)) {
            drop(HIDDEN_READER);
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
        if (!parsed.success) {
            drop("a purpose that is not a question");
        } else if (!made.has(id)) {
            made.set(id, parsed.data);
        }
    }
    return { questions: [...made.values()], dropped };
}

export const mineCommand: Command = {
    summary: "make lookup questions from her appraised reads",
    options: {
        work: { type: "string", description: "the evaluation's directory" },
    },
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
            // A hidden conversation is in no system's reach, and a retired
            // file beyond her engine's, though lexical and full reach it:
            // a read of either is passed over.
            const present = new Set([
                ...conversations.map((each) => each.id),
                ...(await archive.knowledge())
                    .filter((each) => each.retired === null)
                    .map((each) => each.id),
            ]);
            const { questions: mined, dropped } = lookupQuestions(
                await archive.appraisedReads(),
                projects,
                present,
            );
            const merged = mergeQuestions(existing, mined);
            await writeQuestions(work, merged.questions);
            io.out(
                `mined ${mined.length} lookups, ${merged.added} new; ${merged.questions.length} questions in all\n`,
            );
            for (const [reason, n] of Object.entries(dropped)) {
                io.out(`  dropped ${n}: ${reason}\n`);
            }
            if (merged.collided > 0) {
                io.out(
                    `  not added ${merged.collided}: their ids are other questions' ids\n`,
                );
            }
            return 0;
        } finally {
            archive.close();
        }
    },
};
