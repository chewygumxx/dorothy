// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/run-tui.ts
//
//

// A chat on the terminal: memory opened with the model side's prompts
// and sessions, the screen run over it, and memory closed after.

import {
    Conversation,
    conversationSetup,
    type PersonaMode,
    personaPrompt,
    promptHash,
    routeLine,
    structuredCall,
    systemPrompt,
} from "@dorothy/agent";
import type { Routing } from "@dorothy/core";
import { openMemory } from "@dorothy/memory";
import { runApp } from "@dorothy/tui";
import { userShell } from "./claude.js";
import { COOLDOWNS } from "./models.js";
import { recallLaunch } from "./recall-launch.js";

// What each chat session takes from the routes: the chat route, every
// provider's key names, which its recall server is withheld, and the
// process's cooldowns.
export function chatDeps({ routes, keys }: Routing) {
    return { route: routes.chat, keys, cooldowns: COOLDOWNS };
}

export async function runTui(
    resume: string | null,
    persona: PersonaMode,
    routing: Routing,
): Promise<number> {
    const { routes } = routing;
    // The directory the user ran dorothy from, under bun run dev too.
    const cwd = userShell(process.env).cwd ?? process.cwd();
    const compactionPrompt = personaPrompt({ recall: false, mode: persona });
    const opened = await openMemory({
        resume,
        calls: {
            review: structuredCall({
                route: routes.review,
                cooldowns: COOLDOWNS,
            }),
            compaction: structuredCall({
                route: routes.compaction,
                cooldowns: COOLDOWNS,
            }),
        },
        prompts: {
            review: systemPrompt,
            // Development mode names the models, as its chat's does.
            compaction:
                persona === "chat"
                    ? compactionPrompt
                    : `${compactionPrompt}\n\n${routeLine(routes.chat)}`,
            hash: (recall) =>
                promptHash(personaPrompt({ recall, mode: persona })),
            session: (start) =>
                conversationSetup({ ...start, persona }, routes.chat).system,
        },
        connect: (start) => {
            const conversation = new Conversation({
                ...start,
                persona,
                ...chatDeps(routing),
            });
            conversation.start();
            return conversation;
        },
        recallLaunch: (phrase) => recallLaunch(phrase, cwd),
        cwd,
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
