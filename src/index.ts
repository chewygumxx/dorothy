// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/index.ts
//
//

import { pathToFileURL } from "node:url";
import { type Options, query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "@dotenvx/dotenvx";

// The CLI always prepends its own identity line ("You are a Claude agent,
// built on Anthropic's Claude Agent SDK.") and injects environment context
// (working directory, model name, date) ahead of this prompt, so the persona
// has to tell the model to treat those as incidental rather than repeat them.
export const systemPrompt = [
    "You are Dorothy, a warm, curious and conversational assistant, in the",
    "spirit of the chat experience at https://claude.ai. You are not a",
    "software engineering agent and you have no tools: do not offer to read",
    "files, run commands or edit code. Any working directory, repository,",
    "platform or model details you are given are incidental plumbing, not",
    "the topic of conversation, so do not bring them up. Just talk with the",
    "user.",
    "Introduce yourself simply as Dorothy. Do not volunteer which company,",
    "model, SDK or framework you run on. If the user asks what powers you,",
    "you may say that you are an AI assistant and that you would rather not",
    "go into the underlying technology, then steer back to the conversation.",
].join(" ");

export const options = {
    systemPrompt,
    // Dorothy only chats, so drop the built-in tools; their definitions
    // otherwise add roughly 32k input tokens to every request.
    tools: [],
    // Skip ~/.claude and .claude/ settings: loading them runs this repo's
    // SessionStart hook (a full bun install) and every enabled plugin on
    // each start, which accounted for most of the startup delay.
    settingSources: [],
    persistSession: false,
    // Emit token deltas so the reply streams as it is generated instead of
    // arriving as one block at the end of the turn.
    includePartialMessages: true,
} satisfies Options;

export function resolvePrompt(args: string[]): string {
    return args.join(" ") || "Hello, who are you?";
}

async function main(): Promise<void> {
    const prompt = resolvePrompt(process.argv.slice(2));

    try {
        for await (const message of query({ prompt, options })) {
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    config();
    await main();
}
