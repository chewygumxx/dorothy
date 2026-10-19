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
    sameQuestion,
    updateQuestions,
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
        } else {
            const held = made.get(id);
            if (held === undefined) {
                made.set(id, parsed.data);
            } else if (!sameQuestion(held, parsed.data)) {
                // Eight hex digits: two purposes may share an id.
                drop("a purpose whose id is another question's");
            }
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
        // Refused before any work if the file wants mending; the merge
        // below reads it again, under the lock.
        await readQuestionsToRewrite(work);
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
            const appraised = await archive.appraisedReads();
            const { questions: mined, dropped } = lookupQuestions(
                appraised.reads,
                projects,
                present,
            );
            // Memory never gives a hidden reader's read; it is counted
            // with the reads lookupQuestions drops for the same reason.
            if (appraised.hidden > 0) {
                dropped[HIDDEN_READER] =
                    (dropped[HIDDEN_READER] ?? 0) + appraised.hidden;
            }
            const merged = await updateQuestions(work, (current) => {
                const result = mergeQuestions(current, mined);
                return { questions: result.questions, result };
            });
            io.out(
                `mined ${mined.length} lookups, ${merged.added} new; ${merged.questions.length} questions in all\n`,
            );
            for (const [reason, n] of Object.entries(dropped)) {
                io.out(`  dropped ${n}: ${reason}\n`);
            }
            for (const { reader, code } of appraised.unreadable) {
                io.err(
                    `  could not read the transcript of ${reader} (${code}); its reads are passed over\n`,
                );
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
