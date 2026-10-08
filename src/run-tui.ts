// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/run-tui.ts
//
//

// A chat on the terminal: memory opened with the model side's prompts
// and sessions, the screen run over it, and memory closed after.

import { Conversation, conversationOptions } from "./conversation.js";
import { openMemory } from "./memory/open.js";
import {
    type PersonaMode,
    personaPrompt,
    promptHash,
    systemPrompt,
} from "./persona.js";
import { recallLaunch } from "./recall-launch.js";
import { structuredCall } from "./structured.js";
import { runApp } from "./tui/run-app.js";

export async function runTui(
    resume: string | null,
    persona: PersonaMode = "chat",
): Promise<number> {
    const opened = await openMemory({
        resume,
        call: structuredCall(),
        prompts: {
            review: systemPrompt,
            compaction: personaPrompt({ recall: false, mode: persona }),
            hash: (recall) =>
                promptHash(personaPrompt({ recall, mode: persona })),
            session: (start) =>
                String(conversationOptions({ ...start, persona }).systemPrompt),
        },
        connect: (start) => {
            const conversation = new Conversation({ ...start, persona });
            conversation.start();
            return conversation;
        },
        recallLaunch,
    });
    if (!opened.ok) {
        process.stderr.write(`dorothy: ${opened.message}\n`);
        return 1;
    }
    const { memory } = opened;
    try {
        await runApp({
            phrase: memory.phrase,
            history: memory.history,
            createSession: (turns) => memory.createSession(turns),
            notices: memory.notices,
            initialWarnings: memory.warnings,
            initialCostUsd: memory.costUsd,
            config: memory.config,
        });
    } finally {
        await memory.close();
    }
    return 0;
}
