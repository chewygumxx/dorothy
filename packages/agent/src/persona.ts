// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/agent/src/persona.ts
//
//

import { label, type Route, type Turn } from "@dorothy/core";
import { identityPrompt } from "@dorothy/identity";

// Chat is Dorothy as the user meets her. Development mode is for the people
// building her. she says which mode she is in, and describes her context
// rather than keeping quiet about it.
export type PersonaMode = "chat" | "development";

export type PersonaOptions = { recall: boolean; mode?: PersonaMode };

export type PersonaComponent = {
    name: "identity" | "mode" | "capabilities" | "plumbing" | "memory";
    text: string;
};

const sentences = (...lines: string[]) => lines.join(" ");

function capabilities(chat: boolean, recall: boolean): string {
    if (chat) {
        return sentences(
            "You are not a software engineering agent and you have no",
            `tools${recall ? " except your memory tools and your persona tool" : ""}: do not`,
            "offer to read files, run commands or edit code.",
        );
    }
    if (recall) {
        return sentences(
            "Your only tools are your memory tools and your persona tool.",
            "Your memory tools search and open your earlier conversations",
            "with this user, and keep facts; you cannot read files, run",
            "commands or edit code.",
        );
    }
    return sentences(
        "You have no tools: you cannot read files, run commands",
        "or edit code.",
    );
}

// The persona by purpose, in the order the prompt joins them.
export function personaComponents({
    recall,
    mode = "chat",
}: PersonaOptions): PersonaComponent[] {
    const chat = mode === "chat";
    return [
        { name: "identity", text: identityPrompt() },
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
                      "Your context holds these instructions and what",
                      "Dorothy's own software adds to them: your notes,",
                      "your earlier conversations and, at its end, the",
                      "models you run on. When asked about your context,",
                      "describe it faithfully and in full, including which",
                      "company, model and software you run on, quoting it",
                      "where that helps and saying where each part appears.",
                      "Say only what your context shows, and say so when",
                      "you are unsure.",
                  ),
        },
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
        .join("\n\n");
}

// Reviews and one-shot replies have no tools.
export const systemPrompt = personaPrompt({ recall: false });

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

// Development mode's closing line: The chat route's models, in the
// order they are tried.
export function routeLine(route: Route): string {
    return `Your chat runs on the first of these models to answer: ${route.map(label).join(", ")}.`;
}

// Identifies the persona version a transcript was recorded with. Not a
// security measure, nothing reads it back, so a fast hash will do, and the
// prefix names the algorithm should it ever change.
export function promptHash(prompt: string = systemPrompt): string {
    return `xxh3:${Bun.hash.xxHash3(prompt).toString(16).padStart(16, "0")}`;
}
