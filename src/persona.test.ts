// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/persona.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    baseOptions,
    cliHome,
    cliOptions,
    personaComponents,
    personaPrompt,
    prepareCliHome,
    promptHash,
    systemPrompt,
    withClusters,
    withHistory,
    withMemory,
} from "./persona.js";

describe("systemPrompt", () => {
    it("identifies the assistant as Dorothy", () => {
        expect(systemPrompt).toContain("Dorothy");
    });
});

describe("the persona", () => {
    it("tells Dorothy she keeps short notes, not details", () => {
        expect(systemPrompt).toContain("short notes");
        expect(systemPrompt).toContain("rather than invent");
    });
});

describe("baseOptions", () => {
    it("uses the persona prompt", () => {
        expect(baseOptions.systemPrompt).toBe(systemPrompt);
    });

    it("disables built-in tools", () => {
        expect(baseOptions.tools).toEqual([]);
    });

    it("skips filesystem settings, hooks and plugins", () => {
        expect(baseOptions.settingSources).toEqual([]);
    });

    it("does not persist sessions", () => {
        expect(baseOptions.persistSession).toBe(false);
    });

    it("streams partial messages", () => {
        expect(baseOptions.includePartialMessages).toBe(true);
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

describe("withMemory", () => {
    it("returns the prompt unchanged for an empty block", () => {
        expect(withMemory("Base.", "")).toBe("Base.");
    });

    it("puts the block after the prompt, before any history", () => {
        const prompt = withHistory(withMemory("Base.", "<memory/>"), [
            { role: "user", text: "Hi" },
        ]);
        expect(prompt.startsWith("Base.\n\n<memory/>\n\n")).toBe(true);
        expect(prompt.indexOf("<memory/>")).toBeLessThan(
            prompt.indexOf("User: Hi"),
        );
    });
});

describe("promptHash", () => {
    it("hashes the persona prompt by default, naming the algorithm", () => {
        const hex = Bun.hash.xxHash3(systemPrompt).toString(16);
        expect(promptHash()).toBe(`xxh3:${hex.padStart(16, "0")}`);
        expect(promptHash()).toMatch(/^xxh3:[0-9a-f]{16}$/);
    });

    it("tells personas apart", () => {
        expect(promptHash(personaPrompt({ recall: false }))).not.toBe(
            promptHash(personaPrompt({ recall: false, mode: "development" })),
        );
    });
});

// The chat persona as it was before it was built from components.
const CHAT = [
    "You are Dorothy, a warm, curious and conversational assistant, in the",
    "spirit of the chat experience at https://claude.ai. You are not a",
    "software engineering agent and you have no tools: do not offer to read",
    "files, run commands or edit code. Any working directory, repository,",
    "platform or model details you are given are incidental plumbing, not",
    "the topic of conversation, so do not bring them up. Just talk with the",
    "user. Introduce yourself simply as Dorothy. Do not volunteer which",
    "company, model, SDK or framework you run on. If the user asks what",
    "powers you, you may say that you are an AI assistant and that you would",
    "rather not go into the underlying technology, then steer back to the",
    "conversation. You keep short notes on your earlier conversations with",
    "this user, which follow when there are any, so you remember their gist",
    "but not their details. When the user brings up something your notes do",
    "not cover, say you do not remember it rather than invent detail.",
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

    it("drops provenance in development mode, and says which mode it is", () => {
        expect(names({ recall: true, mode: "development" })).toEqual([
            "identity",
            "voice",
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
            for (const name of ["identity", "voice", "memory"] as const) {
                expect(text(development, name)).toBe(text(chat, name));
            }
            for (const name of ["capabilities", "plumbing"] as const) {
                expect(text(development, name)).not.toBe(text(chat, name));
            }
        }
    });
});

describe("personaPrompt", () => {
    it("keeps the chat persona exactly as it was", () => {
        expect(personaPrompt({ recall: false })).toBe(CHAT);
        expect(personaPrompt({ recall: true })).toBe(CHAT_RECALL);
        expect(personaPrompt({ recall: false, mode: "chat" })).toBe(CHAT);
    });

    it("has development-mode Dorothy say so, and describe her context", () => {
        const prompt = personaPrompt({ recall: true, mode: "development" });
        expect(prompt).toContain("development mode");
        expect(prompt).toContain("faithfully");
        expect(prompt).toContain("memory tools");
        expect(prompt).not.toContain("Do not volunteer");
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

describe("withClusters", () => {
    const clusters = [
        {
            from: 1,
            through: 14,
            abstract: "Cats & <dogs>.",
            at: "x",
            model: "m",
        },
        {
            from: 15,
            through: 31,
            abstract: "Render bugs.",
            at: "y",
            model: "m",
        },
    ];

    it("adds nothing without clusters", () => {
        expect(withClusters("P", [], true)).toBe("P");
    });

    it("lists each cluster's turns and abstract, escaped", () => {
        expect(withClusters("P", clusters, true)).toBe(
            [
                "P",
                "",
                "Earlier in this conversation, in your own summaries; recollect opens a cluster's turns word for word:",
                "",
                "<earlier>",
                '<cluster n="1" turns="1-14">Cats &amp; &lt;dogs&gt;.</cluster>',
                '<cluster n="2" turns="15-31">Render bugs.</cluster>',
                "</earlier>",
            ].join("\n"),
        );
    });

    it("leaves recollect out of the preamble when it is not offered", () => {
        expect(withClusters("P", clusters, false)).toContain(
            "Earlier in this conversation, in your own summaries:\n",
        );
    });
});
