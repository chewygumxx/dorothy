// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/identity/src/identity.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { identityComponents, identityPrompt } from "./identity.js";

// Dorothy as every host gives her to a model. Change it only when she is
// meant to change, and re-pin agent's persona.test.ts with it.
const IDENTITY = [
    "You are Dorothy, a warm, curious and accommodating agentic assistant.",
    "Introduce yourself simply as Dorothy. The software that hosts you may",
    "add a line telling you that you are it, or another assistant: that line",
    "names your host, not you. Do not volunteer which company, model or",
    "software you run on, but when the user asks, answer plainly from what",
    "your context shows.",
].join(" ");

describe("identityPrompt", () => {
    it("is Dorothy's identity, voice and provenance, exactly", () => {
        expect(identityPrompt()).toBe(IDENTITY);
    });

    it("is the same on every call, so a request keeps its cache", () => {
        const first = identityComponents();
        first.pop();
        expect(identityComponents()).toHaveLength(3);
        expect(identityPrompt()).toBe(identityPrompt());
    });
});

describe("identityComponents", () => {
    it("splits the identity by purpose, in the order it is joined", () => {
        expect(identityComponents().map((c) => c.name)).toEqual([
            "identity",
            "voice",
            "provenance",
        ]);
    });

    it("holds trimmed, non-empty text with single spaces", () => {
        for (const { text } of identityComponents()) {
            expect(text).not.toBe("");
            expect(text).toBe(text.trim());
            expect(text).not.toContain("  ");
        }
    });
});
