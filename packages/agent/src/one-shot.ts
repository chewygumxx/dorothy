// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/agent/src/one-shot.ts
//
//

// One reply, streamed to stdout, for dorothy <prompt>: no memory, no
// recall, no transcript. A session of its own, so that it sends what a
// chat sends; a failure is said on stderr, and the exit code set.

import { Conversation, type ConversationDeps } from "./conversation.js";
import type { PersonaMode } from "./persona.js";

export type OneShotDeps = ConversationDeps & {
    write?: { out: (text: string) => void; err: (text: string) => void };
};

const STDIO = {
    out: (text: string) => {
        process.stdout.write(text);
    },
    err: (text: string) => {
        process.stderr.write(text);
    },
};

export async function runOneShot(
    prompt: string,
    persona: PersonaMode,
    { write = STDIO, ...deps }: OneShotDeps = {},
): Promise<void> {
    const conversation = new Conversation({ ...deps, persona });
    const done = new Promise<void>((resolve) => {
        conversation.subscribe((event) => {
            switch (event.type) {
                case "delta":
                    write.out(event.text);
                    break;
                case "warning":
                    write.err(`dorothy: ${event.message}\n`);
                    break;
                case "turn-end":
                    write.out("\n");
                    resolve();
                    break;
                case "error":
                    write.err(`${event.message}\n`);
                    process.exitCode = 1;
                    resolve();
                    break;
            }
        });
    });
    conversation.start();
    conversation.send(prompt);
    await done;
    await conversation.close();
}
