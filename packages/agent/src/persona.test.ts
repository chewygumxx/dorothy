// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/agent/src/persona.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { anthropicEntry } from "@dorothy/core";
import { identityPrompt } from "@dorothy/identity";
import {
    personaComponents,
    personaPrompt,
    promptHash,
    routeLine,
    systemPrompt,
    withHistory,
} from "./persona.js";

describe("withHistory", () => {
    it("returns the prompt unchanged without history", () => {
        expect(withHistory("Base.", [])).toBe("Base.");
    });

    it("appends prior turns after the prompt, labelled by speaker", () => {
        const result = withHistory("Base.", [
            { role: "user", text: "My cat is Miso." },
            { role: "assistant", text: "Hello, Miso!" },
        ]);
        expect(result.startsWith("Base.\n\n")).toBe(true);
        expect(result).toContain("User: My cat is Miso.");
        expect(result).toContain("Dorothy: Hello, Miso!");
        expect(result.indexOf("User:")).toBeLessThan(
            result.indexOf("Dorothy:"),
        );
    });
});

describe("routeLine", () => {
    it("names the route's models in a line", () => {
        expect(
            routeLine([
                anthropicEntry("claude-opus-5-5"),
                { ...anthropicEntry("x"), provider: "other" },
            ]),
        ).toBe(
            "Your chat runs on the first of these models to answer: anthropic:claude-opus-5-5, other:x.",
        );
    });
});

describe("promptHash", () => {
    it("hashes with xxh3, naming the algorithm", () => {
        expect(promptHash("You are Dorothy.")).toBe("xxh3:fba57612cdaab878");
    });

    it("hashes the persona prompt by default", () => {
        expect(promptHash()).toBe(promptHash(systemPrompt));
    });

    it("tells personas apart", () => {
        expect(promptHash(personaPrompt({ recall: false }))).not.toBe(
            promptHash(personaPrompt({ recall: false, mode: "development" })),
        );
    });
});

// The chat persona, byte for byte: change it only when the persona is
// meant to change.
const CHAT = [
    identityPrompt(),
    [
        "You are not a software engineering agent and you have no tools: do not",
        "offer to read files, run commands or edit code.",
    ].join(" "),
    [
        "Any working directory, repository, platform or model details you are",
        "given are incidental plumbing, not the topic of conversation, so do",
        "not bring them up. Just talk with the user.",
    ].join(" "),
    [
        "You keep short notes on your earlier conversations with this user,",
        "which follow when there are any, so you remember their gist but not",
        "their details. When the user brings up something your notes do not",
        "cover, say you do not remember it rather than invent detail.",
    ].join(" "),
].join("\n\n");
const CHAT_RECALL = CHAT.replace(
    "you have no tools:",
    "you have no tools except your memory tools:",
)
    .replace(
        "not cover, say",
        "not cover, look it up; if you cannot find it, say",
    )
    .replace(
        "rather than invent detail.",
        "rather than invent detail. When you learn something lasting about the user or their work, keep it with your remember tool, and correct or retire what you kept when it changes.",
    );

describe("personaComponents", () => {
    const names = (options: Parameters<typeof personaComponents>[0]) =>
        personaComponents(options).map((component) => component.name);

    it("splits the chat persona by purpose", () => {
        expect(names({ recall: false })).toEqual([
            "identity",
            "capabilities",
            "plumbing",
            "memory",
        ]);
    });

    it("starts with identity in development mode, and says which mode it is", () => {
        expect(names({ recall: true, mode: "development" })).toEqual([
            "identity",
            "mode",
            "capabilities",
            "plumbing",
            "memory",
        ]);
    });

    it("changes only capabilities and plumbing between the two", () => {
        for (const recall of [false, true]) {
            const chat = personaComponents({ recall });
            const development = personaComponents({
                recall,
                mode: "development",
            });
            const text = (
                components: typeof chat,
                name: (typeof chat)[number]["name"],
            ) => components.find((component) => component.name === name)?.text;
            for (const name of ["identity", "memory"] as const) {
                expect(text(development, name)).toBe(text(chat, name));
            }
            for (const name of ["capabilities", "plumbing"] as const) {
                expect(text(development, name)).not.toBe(text(chat, name));
            }
        }
    });

    it("takes its first component from @dorothy/identity", () => {
        for (const mode of ["chat", "development"] as const) {
            expect(personaComponents({ recall: false, mode })[0]).toEqual({
                name: "identity",
                text: identityPrompt(),
            });
        }
    });

    it("is well formed in every mode, with and without recall", () => {
        for (const recall of [false, true]) {
            for (const mode of ["chat", "development"] as const) {
                for (const { text } of personaComponents({ recall, mode })) {
                    expect(text).not.toBe("");
                    expect(text).toBe(text.trim());
                }
                expect(personaPrompt({ recall, mode })).toBe(
                    personaComponents({ recall, mode })
                        .map((c) => c.text)
                        .join("\n\n"),
                );
            }
        }
    });
});

describe("personaPrompt", () => {
    it("is the chat persona, byte for byte", () => {
        expect(personaPrompt({ recall: false })).toBe(CHAT);
        expect(personaPrompt({ recall: true })).toBe(CHAT_RECALL);
        expect(personaPrompt({ recall: false, mode: "chat" })).toBe(CHAT);
    });

    it("has development-mode Dorothy say so, and describe her context", () => {
        const prompt = personaPrompt({ recall: true, mode: "development" });
        expect(prompt).toContain("development mode");
        expect(prompt).toContain("faithfully");
        expect(prompt).toContain("memory tools");
        expect(prompt).toContain(
            "open your earlier conversations with this user, and keep facts; you",
        );
        expect(prompt).not.toContain("incidental plumbing");
    });

    it("is the plain persona without recall", () => {
        expect(personaPrompt({ recall: false })).toBe(systemPrompt);
        expect(systemPrompt).toContain("you have no tools: do not offer");
        expect(systemPrompt).toContain(
            "cover, say you do not remember it rather than invent detail.",
        );
    });

    it("gives her memory tools, and has her look before she forgets", () => {
        const prompt = personaPrompt({ recall: true });
        expect(prompt).toContain(
            "you have no tools except your memory tools: do not offer",
        );
        expect(prompt).toContain(
            "cover, look it up; if you cannot find it, say you do not remember it rather than invent detail.",
        );
    });
});
