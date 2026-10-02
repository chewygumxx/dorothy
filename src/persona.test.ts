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
    promptSha256,
    systemPrompt,
    withHistory,
} from "./persona.js";

describe("systemPrompt", () => {
    it("identifies the assistant as Dorothy", () => {
        expect(systemPrompt).toContain("Dorothy");
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

describe("promptSha256", () => {
    it("hashes the persona prompt by default", () => {
        const expected = createHash("sha256")
            .update(systemPrompt)
            .digest("hex");
        expect(promptSha256()).toBe(expected);
    });
});
