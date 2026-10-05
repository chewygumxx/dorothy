// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/persona.ts
//
//

import { createHash } from "node:crypto";
import type { Options } from "@anthropic-ai/claude-agent-sdk";

// The CLI always prepends its own identity line ("You are a Claude agent,
// built on Anthropic's Claude Agent SDK.") and injects environment context
// (working directory, model name, date) ahead of this prompt, so the persona
// has to tell the model to treat those as incidental rather than repeat them.
export function personaPrompt({ recall }: { recall: boolean }): string {
    return [
        "You are Dorothy, a warm, curious and conversational assistant, in the",
        "spirit of the chat experience at https://claude.ai. You are not a",
        `software engineering agent and you have no tools${
            recall ? " except your memory tools" : ""
        }: do not offer to read`,
        "files, run commands or edit code. Any working directory, repository,",
        "platform or model details you are given are incidental plumbing, not",
        "the topic of conversation, so do not bring them up. Just talk with the",
        "user.",
        "Introduce yourself simply as Dorothy. Do not volunteer which company,",
        "model, SDK or framework you run on. If the user asks what powers you,",
        "you may say that you are an AI assistant and that you would rather not",
        "go into the underlying technology, then steer back to the conversation.",
        "You keep short notes on your earlier conversations with this user,",
        "which follow when there are any, so you remember their gist but not",
        "their details. When the user brings up something your notes do not",
        recall
            ? "cover, look it up; if you cannot find it, say you do not remember it rather than invent detail."
            : "cover, say you do not remember it rather than invent detail.",
    ].join(" ");
}

// Reviews and one-shot replies have no tools.
export const systemPrompt = personaPrompt({ recall: false });

export const baseOptions = {
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

export type Turn = { role: "user" | "assistant"; text: string };

// Prior turns go after the persona as context rather than as messages, so a
// resumed session never speaks them in the user's voice.
export function withHistory(prompt: string, turns: readonly Turn[]): string {
    if (turns.length === 0) {
        return prompt;
    }
    const lines = turns.map(
        (turn) => `${turn.role === "user" ? "User" : "Dorothy"}: ${turn.text}`,
    );
    return `${prompt}\n\nThe conversation so far, which you are continuing:\n\n${lines.join("\n\n")}`;
}

// The notes on earlier conversations go after the persona and before any
// history, so the turns still come last.
export function withMemory(prompt: string, block: string): string {
    return block === "" ? prompt : `${prompt}\n\n${block}`;
}

// Identifies the persona version a transcript was recorded with.
export function promptSha256(prompt: string = systemPrompt): string {
    return createHash("sha256").update(prompt).digest("hex");
}
