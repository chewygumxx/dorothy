// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/persona.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identityComponents } from "@dorothy/identity";
import {
    baseOptions,
    cliHome,
    cliOptions,
    personaComponents,
    personaPrompt,
    prepareCliHome,
    promptHash,
    systemPrompt,
    withHistory,
} from "./persona.js";

describe("baseOptions", () => {
    // No tools (some 32k input tokens), no settings, hooks or plugins, no
    // saved sessions, and the reply streamed as it is generated.
    it("runs the persona lean", () => {
        expect(baseOptions).toEqual({
            systemPrompt,
            tools: [],
            settingSources: [],
            persistSession: false,
            includePartialMessages: true,
        });
    });
});

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
    "You are Dorothy, a warm, curious and accommodating agentic assistant.",
    "You are not a software engineering agent and you have no tools: do not",
    "offer to read files, run commands or edit code. Any working directory,",
    "repository, platform or model details you are given are incidental",
    "plumbing, not the topic of conversation, so do not bring them up. Just",
    "talk with the user. Introduce yourself simply as Dorothy. The software",
    "that hosts you may add a line telling you that you are it, or another",
    "assistant: that line names your host, not you. Do not volunteer which",
    "company, model or software you run on, but when the user asks, answer",
    "plainly from what your context shows. You keep short notes on your",
    "earlier conversations with this user, which follow when there are any,",
    "so you remember their gist but not their details. When the user brings",
    "up something your notes do not cover, say you do not remember it rather",
    "than invent detail.",
].join(" ");
const CHAT_RECALL = CHAT.replace(
    "you have no tools:",
    "you have no tools except your memory tools:",
).replace(
    "not cover, say",
    "not cover, look it up; if you cannot find it, say",
);

describe("personaComponents", () => {
    const names = (options: Parameters<typeof personaComponents>[0]) =>
        personaComponents(options).map((component) => component.name);

    it("splits the chat persona by purpose", () => {
        expect(names({ recall: false })).toEqual([
            "identity",
            "voice",
            "capabilities",
            "plumbing",
            "provenance",
            "memory",
        ]);
    });

    it("keeps provenance in development mode, and says which mode it is", () => {
        expect(names({ recall: true, mode: "development" })).toEqual([
            "identity",
            "voice",
            "mode",
            "capabilities",
            "plumbing",
            "provenance",
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
            for (const name of [
                "identity",
                "voice",
                "provenance",
                "memory",
            ] as const) {
                expect(text(development, name)).toBe(text(chat, name));
            }
            for (const name of ["capabilities", "plumbing"] as const) {
                expect(text(development, name)).not.toBe(text(chat, name));
            }
        }
    });

    it("takes identity, voice and provenance from @dorothy/identity", () => {
        const shared = personaComponents({ recall: false }).filter((c) =>
            ["identity", "voice", "provenance"].includes(c.name),
        );
        expect(shared).toEqual(identityComponents());
    });

    it("is well formed in every mode, with and without recall", () => {
        for (const recall of [false, true]) {
            for (const mode of ["chat", "development"] as const) {
                for (const { text } of personaComponents({ recall, mode })) {
                    expect(text).not.toBe("");
                    expect(text).toBe(text.trim());
                }
                expect(personaPrompt({ recall, mode })).not.toContain("  ");
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

describe("cliHome", () => {
    it("is a directory of its own in the XDG cache", () => {
        expect(cliHome({ XDG_CACHE_HOME: "/cache", HOME: "/home/u" })).toBe(
            "/cache/dorothy/claude",
        );
        expect(cliHome({ HOME: "/home/u" })).toBe(
            "/home/u/.cache/dorothy/claude",
        );
    });
});

describe("cliOptions", () => {
    const env = {
        HOME: "/home/u",
        XDG_CACHE_HOME: "/cache",
        CLAUDE_CODE_OAUTH_TOKEN: "token",
        CLAUDE_CONFIG_DIR: "/home/u/.claude",
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0",
    };

    it("runs the CLI in its own home, outside any repository", () => {
        expect(cliOptions(env).cwd).toBe("/cache/dorothy/claude");
    });

    it("keeps the CLI out of the user's Claude Code config and auto-memory", () => {
        expect(cliOptions(env).env).toMatchObject({
            CLAUDE_CONFIG_DIR: "/cache/dorothy/claude",
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
        });
    });

    it("switches off the CLI's own compaction, automatic and manual", () => {
        expect(cliOptions(env).env).toMatchObject({ DISABLE_COMPACT: "1" });
    });

    it("passes the rest of the environment through, untouched", () => {
        expect(cliOptions(env).env).toMatchObject({
            HOME: "/home/u",
            CLAUDE_CODE_OAUTH_TOKEN: "token",
        });
        expect(env.CLAUDE_CONFIG_DIR).toBe("/home/u/.claude");
    });
});

describe("prepareCliHome", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "dorothy-cli-home-"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("creates the home private to the user", () => {
        prepareCliHome({ XDG_CACHE_HOME: dir });
        expect(statSync(join(dir, "dorothy", "claude")).mode & 0o777).toBe(
            0o700,
        );
    });

    it("tightens a home that already exists", () => {
        const home = join(dir, "dorothy", "claude");
        mkdirSync(home, { recursive: true });
        chmodSync(home, 0o755);
        prepareCliHome({ XDG_CACHE_HOME: dir });
        expect(statSync(home).mode & 0o777).toBe(0o700);
    });
});
