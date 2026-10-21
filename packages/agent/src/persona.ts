// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/persona.ts
//
//

import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { type Env, type Turn, xdgDir } from "@dorothy/core";
import { type IdentityComponent, identityComponents } from "@dorothy/identity";

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

// Who she is, how she speaks and what she says of what runs her are the
// same in every host, so they come from @dorothy/identity.
function shared(name: IdentityComponent["name"]): PersonaComponent {
    const component = identityComponents().find((c) => c.name === name);
    if (component === undefined) {
        throw new Error(`@dorothy/identity has no ${name} component`);
    }
    return component;
}

function capabilities(chat: boolean, recall: boolean): string {
    if (chat) {
        return sentences(
            "You are not a software engineering agent and you have no",
            `tools${recall ? " except your memory tools" : ""}: do not`,
            "offer to read files, run commands or edit code.",
        );
    }
    if (recall) {
        return sentences(
            "Your only tools are your memory tools, which search and",
            "open your earlier conversations with this user, and keep",
            "facts; you cannot read files, run commands or edit code.",
        );
    }
    return sentences(
        "You have no tools: you cannot read files, run commands",
        "or edit code.",
    );
}

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
        shared("identity"),
        shared("voice"),
        ...(chat
            ? []
            : [
                  {
                      name: "mode" as const,
                      text: sentences(
                          "You are in development mode: The user is one of the",
                          "people building you, and wants to understand how you",
                          "work. Say that you are in development mode when you",
                          "first reply, so that your notes on this conversation",
                          "record it.",
                      ),
                  },
              ]),
        { name: "capabilities", text: capabilities(chat, recall) },
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
        shared("provenance"),
        {
            name: "memory",
            text: sentences(
                "You keep short notes on your earlier conversations with this",
                "user, which follow when there are any, so you remember their",
                "gist but not their details. When the user brings up something",
                "your notes do not cover,",
                recall ? "look it up; if you cannot find it, say" : "say",
                "you do not remember it rather than invent detail.",
                ...(recall
                    ? [
                          "When you learn something lasting about the user or",
                          "their work, keep it with your remember tool, and",
                          "correct or retire what you kept when it changes.",
                      ]
                    : []),
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
    // Skip ~/.claude and .claude/ settings: loading them runs every enabled
    // plugin and hook on each start. When measured, this repository's (a
    // full bun install among them) were most of the startup delay, and
    // Dorothy needs none of them.
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
// at each call, after core has loaded the sops secrets into process.env.
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
