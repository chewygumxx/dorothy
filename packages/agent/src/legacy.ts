// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/legacy.ts
//
//

import type { Options } from "@anthropic-ai/claude-agent-sdk";
import {
    ALLOWED_TOOLS,
    RECOLLECT_TOOL,
    SERVER_NAME,
    withSection,
} from "@dorothy/core";
import type { SessionSetup } from "./conversation.js";
import {
    baseOptions,
    cliOptions,
    personaPrompt,
    withHistory,
} from "./persona.js";

// What a session starts with, shared with --dump-context so that the dump
// shows exactly what a chat would send.
// The Agent SDK's options, for --dump-context until it moves onto
// Conversation; removed then.
export function conversationOptions({
    history = [],
    memory = "",
    earlier = "",
    recall = null,
    recollect = false,
    persona = "chat",
}: SessionSetup = {}): Options {
    const offered = recall !== null && recollect;
    return {
        ...baseOptions,
        ...cliOptions(),
        systemPrompt: withHistory(
            withSection(
                withSection(
                    personaPrompt({ recall: recall !== null, mode: persona }),
                    memory,
                ),
                earlier,
            ),
            history,
        ),
        ...(recall === null
            ? {}
            : {
                  mcpServers: {
                      [SERVER_NAME]: {
                          type: "stdio",
                          command: recall.command,
                          args: offered
                              ? [...recall.args, "--recollect"]
                              : recall.args,
                      },
                  },
                  allowedTools: offered
                      ? [...ALLOWED_TOOLS, RECOLLECT_TOOL]
                      : ALLOWED_TOOLS,
              }),
    };
}
