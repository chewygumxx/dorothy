// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/result.ts
//
//

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type ResultMessage = Extract<SDKMessage, { type: "result" }>;

// What an error result says: API failures (auth, rate limit, overload) do
// not throw, but end the turn with a result flagged is_error, carrying the
// text in place of a reply.
export function failureText(message: ResultMessage): string {
    const text =
        message.subtype === "success"
            ? message.result
            : message.errors.join("; ");
    return text || message.subtype;
}
