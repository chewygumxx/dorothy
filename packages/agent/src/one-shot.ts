// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/one-shot.ts
//
//

import { query } from "@anthropic-ai/claude-agent-sdk";
import {
    baseOptions,
    cliOptions,
    type PersonaMode,
    personaPrompt,
} from "./persona.js";

// One reply, streamed to stdout, for dorothy <prompt>: no memory, no
// recall, no transcript.
export async function runOneShot(
    prompt: string,
    persona: PersonaMode,
): Promise<void> {
    try {
        for await (const message of query({
            prompt,
            options: {
                ...baseOptions,
                ...cliOptions(),
                systemPrompt: personaPrompt({ recall: false, mode: persona }),
            },
        })) {
            if (
                message.type === "stream_event" &&
                message.event.type === "content_block_delta" &&
                message.event.delta.type === "text_delta"
            ) {
                process.stdout.write(message.event.delta.text);
            }
        }
    } catch (error) {
        process.stderr.write(
            `${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
        return;
    }
    process.stdout.write("\n");
}
