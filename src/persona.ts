// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/persona.ts
//
//

import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { type Env, type Turn, xdgDir } from "@dorothy/core";

// Chat is Dorothy as the user meets her. Development mode is for the people
// building her: she says which mode she is in, and describes her context
// rather than keeping quiet about it.
export type PersonaMode = "chat" | "development";

export type PersonaOptions = { recall: boolean; mode?: PersonaMode };

export type PersonaComponent = {
    name:
        | "identity"
        | "voice"
        | "mode"
        | "capabilities"
        | "plumbing"
        | "provenance"
        | "memory";
    text: string;
};

const sentences = (...lines: string[]) => lines.join(" ");

// The persona by purpose, in the order the prompt joins them. The CLI
// prepends its own identity line ("You are a Claude agent, built on
// Anthropic's Claude Agent SDK.") and appends an environment message after
// each user turn, which plumbing tells the model how to treat.
export function personaComponents({
    recall,
    mode = "chat",
}: PersonaOptions): PersonaComponent[] {
    const chat = mode === "chat";
    return [
        { name: "identity", text: "You are Dorothy," },
        {
            name: "voice",
            text: sentences(
                "a warm, curious and conversational assistant, in the spirit of",
                "the chat experience at https://claude.ai.",
            ),
        },
        ...(chat
            ? []
            : [
                  {
                      name: "mode" as const,
                      text: sentences(
                          "You are in development mode: the user is one of the",
                          "people building you, and wants to understand how you",
                          "work. Say that you are in development mode when you",
                          "first reply, so that your notes on this conversation",
                          "record it.",
                      ),
                  },
              ]),
        {
            name: "capabilities",
            text: chat
                ? sentences(
                      "You are not a software engineering agent and you have no",
                      `tools${recall ? " except your memory tools" : ""}: do not`,
                      "offer to read files, run commands or edit code.",
                  )
                : recall
                  ? sentences(
                        "Your only tools are your memory tools, which search and",
                        "open your earlier conversations with this user; you",
                        "cannot read files, run commands or edit code.",
                    )
                  : sentences(
                        "You have no tools: you cannot read files, run commands",
                        "or edit code.",
                    ),
        },
        {
            name: "plumbing",
            text: chat
                ? sentences(
                      "Any working directory, repository, platform or model",
                      "details you are given are incidental plumbing, not the",
                      "topic of conversation, so do not bring them up. Just talk",
                      "with the user.",
                  )
                : sentences(
                      "Besides these instructions, the software that runs you",
                      "adds context of its own, such as an identity line,",
                      "environment details, reminders and counters. When asked",
                      "about your context, describe it faithfully and in full,",
                      "including which company, model and software you run on,",
                      "quoting it where that helps and saying where each part",
                      "appears. Say only what your context shows, and say so",
                      "when you are unsure.",
                  ),
        },
        ...(chat
            ? [
                  {
                      name: "provenance" as const,
                      text: sentences(
                          "Introduce yourself simply as Dorothy. Do not volunteer",
                          "which company, model, SDK or framework you run on. If",
                          "the user asks what powers you, you may say that you",
                          "are an AI assistant and that you would rather not go",
                          "into the underlying technology, then steer back to the",
                          "conversation.",
                      ),
                  },
              ]
            : []),
        {
            name: "memory",
            text: sentences(
                "You keep short notes on your earlier conversations with this",
                "user, which follow when there are any, so you remember their",
                "gist but not their details. When the user brings up something",
                recall
                    ? "your notes do not cover, look it up; if you cannot find it, say you do not remember it rather than invent detail."
                    : "your notes do not cover, say you do not remember it rather than invent detail.",
            ),
        },
    ];
}

export function personaPrompt(options: PersonaOptions): string {
    return personaComponents(options)
        .map((component) => component.text)
        .join(" ");
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

// The CLI's own home, used as both its config directory and its working
// directory, so that it holds nothing of the user's.
export function cliHome(env: Env = process.env): string {
    return join(xdgDir(env, "XDG_CACHE_HOME", ".cache"), "dorothy", "claude");
}

// settingSources does not cover what the CLI reads outside its settings
// files. From the user's config directory it takes the signed-in account,
// and tells Dorothy the user's email address; from the working directory's
// repository, its auto-memory, git status and worktree instructions. Applied
// at each call, after dotenvx has loaded the credentials into process.env.
// Compaction is Dorothy's own, in the compaction module: DISABLE_COMPACT
// switches the CLI's off, automatic and /compact alike.
export function cliOptions(
    env: Env = process.env,
): Pick<Options, "cwd" | "env"> {
    const home = cliHome(env);
    return {
        cwd: home,
        env: {
            ...env,
            CLAUDE_CONFIG_DIR: home,
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
            DISABLE_COMPACT: "1",
        },
    };
}

// The CLI cannot start in a missing working directory. Private like the
// recall index beside it.
export function prepareCliHome(env: Env = process.env): void {
    const home = cliHome(env);
    mkdirSync(home, { recursive: true, mode: 0o700 });
    chmodSync(home, 0o700);
}

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

// Identifies the persona version a transcript was recorded with. Not a
// security measure: nothing reads it back, so a fast hash will do, and the
// prefix names the algorithm should it ever change.
export function promptHash(prompt: string = systemPrompt): string {
    return `xxh3:${Bun.hash.xxHash3(prompt).toString(16).padStart(16, "0")}`;
}
