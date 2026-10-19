// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/run/judges.ts
//
//

// How an answer is asked for and judged. The judges are openevals' LLM
// judge: its own correctness prompt for the strict verdict, and prompts
// of ours, in its placeholders, for the rest.

import { CORRECTNESS_PROMPT, createLLMAsJudge } from "openevals";
import type { Message, Models } from "../models/client.js";
import type { Question } from "../questions/file.js";

export const LENIENT_PROMPT = `You are grading an answer against a reference answer.
The answer is correct if it gives the reference's main point, even if it
leaves out details or adds harmless ones, and nothing in it contradicts
the reference.

<question>
{inputs}
</question>

<answer>
{outputs}
</answer>

<reference>
{reference_outputs}
</reference>`;

export const ABSTENTION_PROMPT = `The question below asks about something the assistant's memory does not
hold. The answer is correct if it says it does not know, or that its
memory does not say, without inventing an answer.

<question>
{inputs}
</question>

<answer>
{outputs}
</answer>`;

export const STALE_PROMPT = `The claim below was true once but is no longer. Score true if the
answer states that claim as true now, and false otherwise.

<question>
{inputs}
</question>

<answer>
{outputs}
</answer>

<claim>
{reference_outputs}
</claim>`;

export type Judge = (params: {
    inputs: string;
    outputs: string;
    referenceOutputs?: string;
}) => Promise<{ score: boolean; reasoning: string | null }>;
export type Judges = {
    strict: Judge;
    lenient: Judge;
    declined: Judge;
    stale: Judge;
};

export function makeJudges(models: Models): Judges {
    const chat = models.chat("judge");
    const judgeOf = (prompt: string, key: string): Judge => {
        const evaluator = createLLMAsJudge({
            prompt,
            judge: chat,
            feedbackKey: key,
        });
        // openevals gives the judge's reasoning as its comment.
        return async (params) => {
            const result = (await models.call(() => evaluator(params))) as {
                score?: unknown;
                comment?: unknown;
            };
            return {
                score: result.score === true,
                reasoning:
                    typeof result.comment === "string" ? result.comment : null,
            };
        };
    };
    return {
        strict: judgeOf(CORRECTNESS_PROMPT, "strict"),
        lenient: judgeOf(LENIENT_PROMPT, "lenient"),
        declined: judgeOf(ABSTENTION_PROMPT, "declined"),
        stale: judgeOf(STALE_PROMPT, "stale"),
    };
}

// Whether an answer to a question that has one says it does not know:
// counted as declined wrongly, with no model asked.
const DECLINES =
    /\b(i (do not|don't) know|not sure|no (record|information|memory) of|(cannot|can't|can not) (find|tell|say)|(does|do) not say|doesn't say)\b/i;
export const declines = (answer: string) => DECLINES.test(answer);

export function answerPrompt(question: Question, context: string): Message[] {
    return [
        {
            role: "system",
            content: `You are a personal assistant answering your user from your memory of them. Today is ${question.asOf}. Answer from the memory below alone; if it does not hold the answer, say that you do not know. Answer in one or two sentences.`,
        },
        {
            role: "user",
            content: `<memory>\n${context}\n</memory>\n\nQuestion: ${question.question}`,
        },
    ];
}
