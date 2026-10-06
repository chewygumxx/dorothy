// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/persona.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    baseOptions,
    cliHome,
    cliOptions,
    personaPrompt,
    prepareCliHome,
    promptSha256,
    systemPrompt,
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

describe("promptSha256", () => {
    it("hashes the persona prompt by default", () => {
        const expected = createHash("sha256")
            .update(systemPrompt)
            .digest("hex");
        expect(promptSha256()).toBe(expected);
    });
});

describe("personaPrompt", () => {
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
