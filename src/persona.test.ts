// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/persona.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
    baseOptions,
    personaPrompt,
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
