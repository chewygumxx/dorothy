// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/index.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { options, resolvePrompt, systemPrompt } from "./index.js";

describe("resolvePrompt", () => {
    it("joins argv into a single prompt string", () => {
        expect(resolvePrompt(["What", "is", "your", "name?"])).toBe(
            "What is your name?",
        );
    });

    it("falls back to a default greeting when no argv is given", () => {
        expect(resolvePrompt([])).toBe("Hello, who are you?");
    });
});

describe("systemPrompt", () => {
    it("identifies the assistant as Dorothy", () => {
        expect(systemPrompt).toContain("Dorothy");
    });
});

describe("options", () => {
    it("disables built-in tools", () => {
        expect(options.tools).toEqual([]);
    });

    it("skips filesystem settings, hooks and plugins", () => {
        expect(options.settingSources).toEqual([]);
    });

    it("streams partial messages", () => {
        expect(options.includePartialMessages).toBe(true);
    });
});
