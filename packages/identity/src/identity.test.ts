// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/identity/src/identity.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { identityPrompt, personaVersion } from "./index.js";

// Change it only when Dorothy is meant to change.
const VERSION = "xxh3:d9cf4772e233ac1d";

describe("identityPrompt", () => {
    it("is soul.md without its header", () => {
        const prompt = identityPrompt();
        expect(prompt.startsWith("You are Dorothy")).toBe(true);
        for (const marker of ["---\n", ":::", "vim:set"]) {
            expect(prompt).not.toContain(marker);
        }
    });

    it("is the same on every call", () => {
        expect(identityPrompt()).toBe(identityPrompt());
    });

    it("is pinned", () => {
        expect(personaVersion()).toBe(VERSION);
    });

    it("names no host or provider", () => {
        expect(identityPrompt()).not.toMatch(
            /\b(?:Claude|Anthropic|OpenAI|Codex|pi|Hermes|Featherless)\b/i,
        );
    });
});
